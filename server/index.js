import express from "express";
import http from "http";
import { Server } from "socket.io";
import { nanoid } from "nanoid";

const app = express();
app.use(express.static("public"));
app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: true, credentials: true },
});

/**
 * Game rules:
 * - 4 players max per room
 * - 3 rounds
 * - Each round: each player draws 7 (from their 40) and selects 1
 * - Higher selected number gets 1 point (ties give 0 points)
 */

const MAX_PLAYERS = 4;
const ROUNDS = 3;
const HAND_SIZE = 7;
const DECK_SIZE = 40;

/**
 * Reconnect model:
 * - `playerKey` persists in the browser (localStorage)
 * - room holds players keyed by `playerKey`
 * - socket can disconnect/reconnect and re-attach to same player
 */

/**
 * @typedef {{
 *  playerKey:string,
 *  socketId: string | null,
 *  name:string,
 *  seat: "top"|"left"|"right"|"bottom",
 *  deck:number[],
 *  deckIndex:number,
 *  hand:number[],
 *  selected?:number,
 *  selectedRound?:number,
 *  points:number,
 *  ready:boolean,
 *  isBot:boolean,
 *  connected:boolean,
 *  lastSeenAt:number
 * }} Player
 *
 * @typedef {{
 *  id:string,
 *  createdAt:number,
 *  started:boolean,
 *  finished:boolean,
 *  round:number,
 *  revealPicks:boolean,
 *  resolving:boolean,
 *  players:Map<string,Player>,
 *  socketToPlayerKey:Map<string,string>
 * }} Room
 */

/** @type {Map<string, Room>} */
const rooms = new Map();

const seatOrder = /** @type {const} */ (["bottom", "left", "top", "right"]);

function makeDeck() {
  // 40 cards, each with a visible number. Keep it deterministic-ish but shuffled per player.
  const deck = Array.from({ length: DECK_SIZE }, (_, i) => i + 1);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function createRoom() {
  const id = nanoid(6).toUpperCase();
  /** @type {Room} */
  const room = {
    id,
    createdAt: Date.now(),
    started: false,
    finished: false,
    round: 0,
    revealPicks: false,
    resolving: false,
    players: new Map(),
    socketToPlayerKey: new Map(),
  };
  rooms.set(id, room);
  return room;
}

function getOrCreateRoom(roomIdMaybe) {
  if (roomIdMaybe && rooms.has(roomIdMaybe)) return rooms.get(roomIdMaybe);
  return createRoom();
}

function seatsInUse(room) {
  const used = new Set();
  for (const p of room.players.values()) used.add(p.seat);
  return used;
}

function assignSeat(room) {
  const used = seatsInUse(room);
  for (const seat of seatOrder) {
    if (!used.has(seat)) return seat;
  }
  return null;
}

function isValidSeat(seat) {
  return seat === "top" || seat === "bottom" || seat === "left" || seat === "right";
}

function publicRoomState(room) {
  const players = Array.from(room.players.values()).map((p) => ({
    id: p.playerKey,
    name: p.name,
    seat: p.seat,
    points: p.points,
    selected: p.selectedRound === room.round && typeof p.selected === "number" ? p.selected : null,
    handCount: p.hand.length,
    deckRemaining: Math.max(0, p.deck.length - p.deckIndex),
    connected: p.connected,
    ready: !!p.ready,
    isBot: !!p.isBot,
  }));

  return {
    id: room.id,
    started: room.started,
    finished: room.finished,
    round: room.round,
    revealPicks: room.revealPicks,
    roundsTotal: ROUNDS,
    handSize: HAND_SIZE,
    maxPlayers: MAX_PLAYERS,
    players,
  };
}

function allPlayersSelected(room) {
  if (room.players.size === 0) return false;
  for (const p of room.players.values()) {
    if (!p.connected) return false;
    if (p.selectedRound !== room.round) return false;
  }
  return true;
}

function dealHands(room) {
  for (const p of room.players.values()) {
    p.hand = [];
    p.selected = undefined;
    p.selectedRound = undefined;
    for (let i = 0; i < HAND_SIZE; i++) {
      const card = p.deck[p.deckIndex++];
      if (typeof card === "number") p.hand.push(card);
    }
  }
}

function scoreRound(room) {
  /** @type {{playerId:string, value:number}[]} */
  const picks = [];
  for (const p of room.players.values()) {
    if (p.selectedRound === room.round && typeof p.selected === "number") picks.push({ playerId: p.playerKey, value: p.selected });
  }
  picks.sort((a, b) => b.value - a.value);

  if (picks.length === 0) return { winnerIds: [], topValue: null, tie: false };

  const topValue = picks[0].value;
  const top = picks.filter((x) => x.value === topValue);
  if (top.length !== 1) return { winnerIds: [], topValue, tie: true };

  const winnerId = top[0].playerId;
  const winner = room.players.get(winnerId);
  if (winner) winner.points += 1;
  return { winnerIds: [winnerId], topValue, tie: false };
}

function startGame(room) {
  room.started = true;
  room.finished = false;
  room.round = 1;
  room.revealPicks = false;
  room.resolving = false;
  for (const p of room.players.values()) {
    p.points = 0;
    p.deck = makeDeck();
    p.deckIndex = 0;
    p.hand = [];
    p.selected = undefined;
    p.selectedRound = undefined;
    p.ready = true;
  }
  dealHands(room);
}

function finishGame(room) {
  room.finished = true;
}

function broadcastRoom(room) {
  io.to(room.id).emit("room:update", publicRoomState(room));
}

function sendHandToPlayer(room, player) {
  if (!player.socketId) return;
  io.to(player.socketId).emit("game:hand", { hand: player.hand });
}

function sendHands(room) {
  for (const p of room.players.values()) sendHandToPlayer(room, p);
}

function findPlayerBySocket(room, socketId) {
  const key = room.socketToPlayerKey.get(socketId);
  if (!key) return null;
  return room.players.get(key) || null;
}

function removeBots(room) {
  for (const [k, p] of room.players.entries()) {
    if (p.isBot) room.players.delete(k);
  }
}

function addBotsToFill(room) {
  const used = seatsInUse(room);
  const available = seatOrder.filter((s) => !used.has(s));
  for (const seat of available) {
    const key = `BOT_${nanoid(6)}`;
    /** @type {Player} */
    const bot = {
      playerKey: key,
      socketId: null,
      name: `Bot ${seat.toUpperCase()}`,
      seat,
      deck: makeDeck(),
      deckIndex: 0,
      hand: [],
      selected: undefined,
      points: 0,
      ready: true,
      isBot: true,
      connected: true,
      lastSeenAt: Date.now(),
    };
    room.players.set(key, bot);
  }
}

function allHumansReady(room) {
  const humans = Array.from(room.players.values()).filter((p) => !p.isBot);
  if (humans.length === 0) return false;
  for (const p of humans) {
    if (!p.connected) return false;
    if (!p.ready) return false;
  }
  return true;
}

function botAutoPick(room) {
  if (!room.started || room.finished) return;
  for (const p of room.players.values()) {
    if (!p.isBot) continue;
    if (typeof p.selected === "number") continue;
    if (!p.hand.length) continue;
    const v = Math.max(...p.hand);
    p.selected = v;
    p.selectedRound = room.round;
    p.hand = p.hand.filter((x) => x !== v);
  }
}

function resetGame(room) {
  room.started = false;
  room.finished = false;
  room.round = 0;
  room.revealPicks = false;
  room.resolving = false;

  for (const [k, p] of room.players.entries()) {
    if (p.isBot) {
      room.players.delete(k);
      continue;
    }
    p.points = 0;
    p.hand = [];
    p.selected = undefined;
    p.selectedRound = undefined;
    p.ready = false;
  }
}

io.on("connection", (socket) => {
  socket.on("room:join", ({ roomId, name, playerKey, seat }) => {
    const trimmed = String(name ?? "").trim().slice(0, 18) || "Player";
    const room = getOrCreateRoom(String(roomId ?? "").trim().toUpperCase() || null);
    const requestedKey = String(playerKey ?? "").trim();
    const requestedSeat = isValidSeat(seat) ? seat : null;

    // Reconnect path: reattach to existing playerKey in room.
    if (requestedKey && room.players.has(requestedKey)) {
      const player = room.players.get(requestedKey);
      // If a previous socket is still mapped, evict it.
      if (player.socketId && player.socketId !== socket.id) {
        room.socketToPlayerKey.delete(player.socketId);
      }
      player.socketId = socket.id;
      player.connected = true;
      player.lastSeenAt = Date.now();
      // Allow updating name on reconnect.
      player.name = trimmed;
      room.socketToPlayerKey.set(socket.id, requestedKey);
      socket.join(room.id);

      socket.emit("room:joined", { roomId: room.id, playerKey: player.playerKey, seat: player.seat, reconnected: true });
      broadcastRoom(room);
      if (room.started) {
        socket.emit("game:started", { room: publicRoomState(room) });
        sendHandToPlayer(room, player);
      }
      return;
    }

    // New join path.
    if (room.players.size >= MAX_PLAYERS) {
      socket.emit("room:error", { message: "Room is full (max 4 players)." });
      return;
    }

    if (!requestedSeat) {
      socket.emit("room:error", { message: "Please choose a seat (TOP/BOTTOM/LEFT/RIGHT)." });
      return;
    }

    const usedSeats = seatsInUse(room);
    if (usedSeats.has(requestedSeat)) {
      socket.emit("room:error", { message: `That seat is already taken (${requestedSeat.toUpperCase()}).` });
      return;
    }

    const key = requestedKey || nanoid(12);

    /** @type {Player} */
    const player = {
      playerKey: key,
      socketId: socket.id,
      name: trimmed,
      seat: requestedSeat,
      deck: makeDeck(),
      deckIndex: 0,
      hand: [],
      selected: undefined,
      points: 0,
      ready: false,
      isBot: false,
      connected: true,
      lastSeenAt: Date.now(),
    };

    room.players.set(key, player);
    room.socketToPlayerKey.set(socket.id, key);
    socket.join(room.id);

    socket.emit("room:joined", { roomId: room.id, playerKey: key, seat, reconnected: false });
    broadcastRoom(room);

    if (room.started) {
      socket.emit("game:started", { room: publicRoomState(room) });
      sendHandToPlayer(room, player);
    }
  });

  socket.on("room:ready", ({ roomId, ready }) => {
    const room = rooms.get(String(roomId ?? "").trim().toUpperCase());
    if (!room) return;
    if (room.started) return;

    const player = findPlayerBySocket(room, socket.id);
    if (!player || player.isBot) return;

    player.ready = !!ready;
    broadcastRoom(room);

    if (allHumansReady(room)) {
      removeBots(room);
      addBotsToFill(room);
      startGame(room);
      io.to(room.id).emit("game:started", { room: publicRoomState(room) });
      broadcastRoom(room);
      sendHands(room);
      botAutoPick(room);
      broadcastRoom(room);
    }
  });

  socket.on("game:restart", ({ roomId }) => {
    const room = rooms.get(String(roomId ?? "").trim().toUpperCase());
    if (!room) return;
    if (!room.finished) return;
    resetGame(room);
    broadcastRoom(room);
  });

  socket.on("game:select", ({ roomId, value }) => {
    const room = rooms.get(String(roomId ?? "").trim().toUpperCase());
    if (!room) return;
    if (!room.started || room.finished) return;
    if (room.resolving) return;

    const player = findPlayerBySocket(room, socket.id);
    if (!player) return;
    if (!player.connected) return;

    const v = Number(value);
    if (!Number.isFinite(v)) return;
    if (!player.hand.includes(v)) return;

    player.selected = v;
    player.selectedRound = room.round;
    player.hand = player.hand.filter((x) => x !== v);
    broadcastRoom(room);

    if (allPlayersSelected(room)) {
      if (room.resolving) return;
      room.resolving = true;
      room.revealPicks = true;
      broadcastRoom(room);

      const resolvedRound = room.round;
      const result = scoreRound(room);

      const winnerId = result?.winnerIds?.[0] ?? null;
      const winner = winnerId ? room.players.get(winnerId) : null;
      const winnerName = winner?.name ?? null;
      const winnerCard = result?.topValue ?? null;

      const promptText = result?.tie
        ? `Tie! No points awarded (card ${winnerCard}).`
        : `${winnerName} won the round with the card ${winnerCard}`;

      io.to(room.id).emit("round:resolved", {
        round: resolvedRound,
        result,
        promptText,
        room: publicRoomState(room),
      });

      setTimeout(() => {
        room.resolving = false;
        room.revealPicks = false;

        if (resolvedRound >= ROUNDS) {
          finishGame(room);
          const players = Array.from(room.players.values());
          const maxPoints = Math.max(...players.map((p) => p.points));
          const winnerIds = players.filter((p) => p.points === maxPoints).map((p) => p.playerKey);
          const winnerNames = winnerIds
            .map((id) => room.players.get(id)?.name)
            .filter((n) => typeof n === "string");
          io.to(room.id).emit("game:finished", {
            winners: winnerIds,
            winnerNames,
            maxPoints,
            room: publicRoomState(room),
          });
          broadcastRoom(room);
          return;
        }

        room.round = resolvedRound + 1;
        // Preserve existing hand contents; each player draws exactly 1 card.
        // Also clear selection so the next round can begin.
        for (const p of room.players.values()) {
          p.selected = undefined;
          p.selectedRound = undefined;
        }

        for (const p of room.players.values()) {
          const card = p.deck[p.deckIndex++];
          if (typeof card === "number") p.hand.push(card);
        }

        botAutoPick(room);
        broadcastRoom(room);
        sendHands(room);
      }, 5000);
    }
  });

  socket.on("disconnect", () => {
    for (const room of rooms.values()) {
      const player = findPlayerBySocket(room, socket.id);
      if (!player) continue;
      player.connected = false;
      player.lastSeenAt = Date.now();
      player.socketId = null;
      room.socketToPlayerKey.delete(socket.id);
      broadcastRoom(room);
      // Clean up rooms only when nobody is present (including disconnected placeholders)
      // For MVP, keep room until manually emptied or server restart.
      break;
    }
  });
});

const PORT = process.env.PORT || 5173;
server.listen(PORT, () => {
  console.log(`TCG server running on http://localhost:${PORT}`);
});

