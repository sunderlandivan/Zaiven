const $ = (id) => document.getElementById(id);

const modal = $("modal");
const joinBtn = $("joinBtn");
const soloBtn = $("soloBtn");
const backBtn = $("backBtn");
const seatStep = $("seatStep");
const nameInput = $("nameInput");
const roomInput = $("roomInput");
const errorBox = $("error");
const roomCode = $("roomCode");
const copyRoom = $("copyRoom");
const readyBtn = $("readyBtn");
const restartBtn = $("restartBtn");
const handEl = $("hand");
const handSub = $("handSub");
const banner = $("banner");
const roundNow = $("roundNow");
const roundTotal = $("roundTotal");
const roundPrompt = $("roundPrompt");
const roundPromptText = $("roundPromptText");
const gameWinPrompt = $("gameWinPrompt");
const gameWinPromptText = $("gameWinPromptText");

const seatIds = ["top", "left", "right", "bottom"];
const seatNameEl = Object.fromEntries(seatIds.map((s) => [s, $(`name-${s}`)]));
const seatScoreEl = Object.fromEntries(seatIds.map((s) => [s, $(`score-${s}`)]));
const seatStatusEl = Object.fromEntries(seatIds.map((s) => [s, $(`status-${s}`)]));
const seatPickedEl = Object.fromEntries(seatIds.map((s) => [s, $(`picked-${s}`)]));

/** @type {import("socket.io-client").Socket | any} */
let socket;
let state = {
  roomId: null,
  playerKey: null,
  seat: null,
  started: false,
  finished: false,
  round: 0,
  revealPicks: false,
  players: [],
};
let myHand = [];
let selectionLocked = false;
let joinStage = "details"; // "details" | "seat"
let requestedSeat = null; // "top"|"bottom"|"left"|"right"|null
let myReady = false;

const STORAGE_PLAYER_KEY = "tcg.playerKey";
const STORAGE_LAST_ROOM = "tcg.lastRoom";
const STORAGE_LAST_NAME = "tcg.lastName";

function generateKey() {
  // URL-safe random key (no deps)
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function getPlayerKey({ forceNew = false } = {}) {
  if (forceNew) {
    const k = generateKey();
    localStorage.setItem(STORAGE_PLAYER_KEY, k);
    return k;
  }
  const existing = localStorage.getItem(STORAGE_PLAYER_KEY);
  if (existing && /^[a-z0-9]{16,}$/i.test(existing)) return existing;
  const k = generateKey();
  localStorage.setItem(STORAGE_PLAYER_KEY, k);
  return k;
}

function myPlayer() {
  if (!state.playerKey) return null;
  return state.players.find((p) => p.id === state.playerKey) || null;
}

function setError(msg) {
  if (!msg) {
    errorBox.classList.add("hidden");
    errorBox.textContent = "";
    return;
  }
  errorBox.textContent = msg;
  errorBox.classList.remove("hidden");
}

function setBanner(msg, kind = "info") {
  if (!msg) {
    banner.classList.add("hidden");
    banner.classList.remove("danger");
    banner.textContent = "";
    return;
  }
  banner.textContent = msg;
  banner.classList.remove("hidden");
  banner.classList.toggle("danger", kind === "danger");
}

let roundPromptTimer = null;
function showRoundPrompt(text) {
  if (!text) return;
  if (roundPromptTimer) clearTimeout(roundPromptTimer);
  roundPromptText.textContent = text;
  roundPrompt.classList.remove("hidden");
  roundPrompt.classList.remove("show");
  // Force reflow so the CSS animation restarts.
  void roundPrompt.offsetWidth;
  roundPrompt.classList.add("show");
  roundPromptTimer = setTimeout(() => hideRoundPrompt(), 5000);
}

function hideRoundPrompt() {
  roundPrompt.classList.add("hidden");
  roundPrompt.classList.remove("show");
}

function showGameWinPrompt(text) {
  if (!text) return;
  gameWinPromptText.textContent = text;
  gameWinPrompt.classList.remove("hidden");
  gameWinPrompt.classList.remove("show");
  void gameWinPrompt.offsetWidth;
  gameWinPrompt.classList.add("show");
}

function hideGameWinPrompt() {
  gameWinPrompt.classList.add("hidden");
  gameWinPrompt.classList.remove("show");
}

function normalizeRoomCode(input) {
  const raw = String(input ?? "").trim().toUpperCase();
  return raw.replace(/[^A-Z0-9]/g, "").slice(0, 12);
}

function renderSeats() {
  const bySeat = Object.fromEntries(seatIds.map((s) => [s, null]));
  for (const p of state.players) bySeat[p.seat] = p;

  for (const seat of seatIds) {
    const p = bySeat[seat];
    seatNameEl[seat].textContent = p ? p.name : "Waiting…";
    seatScoreEl[seat].textContent = p ? String(p.points) : "0";

    const statusParts = [];
    if (!p) {
      seatStatusEl[seat].textContent = "Open seat";
      seatPickedEl[seat].innerHTML = "";
      continue;
    }
    statusParts.push(p.isBot ? "Bot" : p.connected ? "Connected" : "Disconnected");
    if (!state.started) statusParts.push("Waiting to start");
    else if (state.finished) statusParts.push("Finished");
    else {
      const revealValue = state.revealPicks || seat === state.seat;
      statusParts.push(revealValue && p.selected != null ? "Selected" : "Choosing…");
    }
    if (!state.started && !p.isBot) statusParts.push(p.ready ? "Ready" : "Not ready");
    seatStatusEl[seat].textContent = statusParts.join(" • ");

    seatPickedEl[seat].innerHTML = "";
    const revealValue = state.revealPicks || seat === state.seat;
    if (revealValue && p.selected != null) {
      seatPickedEl[seat].appendChild(miniCard(String(p.selected), { showFace: true }));
    } else if (state.started) {
      // Face-down to keep other players' choices hidden until the reveal window.
      seatPickedEl[seat].appendChild(miniCard("", { showFace: false }));
    }
  }
}

function renderRound() {
  roundTotal.textContent = "3";
  roundNow.textContent = state.round ? String(state.round) : "—";
}

function miniCard(text, { showFace }) {
  const el = document.createElement("div");
  el.className = `mini-card ${showFace ? "" : "back"}`.trim();
  if (showFace && text) {
    const num = document.createElement("div");
    num.className = "mini-num";
    num.textContent = text;
    el.appendChild(num);
  }
  return el;
}

function cardEl(value, disabled) {
  const el = document.createElement("div");
  el.className = `card ${disabled ? "disabled" : ""}`.trim();
  el.tabIndex = disabled ? -1 : 0;

  const num = document.createElement("div");
  num.className = "card-num";
  num.textContent = String(value);
  el.appendChild(num);

  const pick = () => {
    if (disabled || selectionLocked) return;
    selectionLocked = true;
    setBanner("Card locked in. Waiting for others…");
    socket.emit("game:select", { roomId: state.roomId, value });
    renderHand();
  };

  el.addEventListener("click", pick);
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") pick();
  });
  return el;
}

function renderHand() {
  handEl.innerHTML = "";
  if (!state.started) {
    handSub.textContent = "Waiting for game…";
    return;
  }
  if (state.finished) {
    handSub.textContent = "Game finished.";
    return;
  }
  handSub.textContent = selectionLocked ? "Selected. Waiting…" : "Pick one card.";

  for (const v of myHand) {
    handEl.appendChild(cardEl(v, selectionLocked));
  }
}

function updateFromRoom(room) {
  state.started = room.started;
  state.finished = room.finished;
  state.round = room.round;
  state.players = room.players;
  state.revealPicks = !!room.revealPicks;
  roomCode.textContent = room.id;
  copyRoom.disabled = false;
  const me = myPlayer();
  myReady = !!(me && me.ready);
  selectionLocked = !!(me && me.selected != null) || state.finished;
  readyBtn.disabled = !state.roomId || state.started || state.finished;
  readyBtn.textContent = myReady ? "Ready ✓" : "Ready";
  restartBtn.classList.toggle("hidden", !state.finished);
  restartBtn.disabled = !state.roomId;
  if (!state.finished) hideGameWinPrompt();
  if (!state.started) hideRoundPrompt();
  renderRound();
  renderSeats();
  renderHand();
}

function showModal(show) {
  modal.style.display = show ? "grid" : "none";
}

function connectSocket() {
  socket = io();

  socket.on("room:error", ({ message }) => {
    selectionLocked = false;
    setError(message || "Room error.");
  });

  socket.on("room:joined", ({ roomId, playerKey, seat, reconnected }) => {
    state.roomId = roomId;
    state.playerKey = playerKey;
    state.seat = seat;
    showModal(false);
    setError("");
    localStorage.setItem(STORAGE_LAST_ROOM, roomId);
    localStorage.setItem(STORAGE_PLAYER_KEY, playerKey);
    localStorage.setItem(STORAGE_LAST_NAME, nameInput.value.trim());
    setBanner(reconnected ? `Reconnected to room ${roomId}.` : `Joined room ${roomId}. Waiting for players…`);
    roomCode.textContent = roomId;
    copyRoom.disabled = false;
    readyBtn.disabled = false;
  });

  socket.on("room:update", (room) => {
    updateFromRoom(room);
    if (!room.started) setBanner("Click Ready when you’re set. Missing seats will be filled with bots.");
    if (room.started && !room.finished && room.round > 0 && !selectionLocked) {
      setBanner(`Round ${room.round}: pick your highest card.`, "info");
    }
  });

  socket.on("game:started", ({ room }) => {
    selectionLocked = false;
    readyBtn.disabled = true;
    hideRoundPrompt();
    hideGameWinPrompt();
    setBanner("Game started. Round 1: pick a card.");
    updateFromRoom(room);
  });

  socket.on("game:hand", ({ hand }) => {
    if (Array.isArray(hand)) {
      hideRoundPrompt();
      // Preserve hand order: server appends the new draw card each round.
      myHand = [...hand];
      const me = myPlayer();
      selectionLocked = !!(me && me.selected != null) || state.finished;
      renderHand();
    }
  });

  socket.on("round:resolved", ({ round, result, promptText, room }) => {
    updateFromRoom(room);
    selectionLocked = true;
    showRoundPrompt(promptText);
    const meWon = result?.winnerIds?.includes(state.playerKey);
    if (result?.tie) setBanner(`Round ${round}: tie at ${result.topValue}. No points awarded.`, "danger");
    else if (meWon) setBanner(`Round ${round}: you win (+1 point).`, "info");
    else setBanner(`Round ${round}: round winner chosen.`, "info");
  });

  socket.on("game:finished", ({ winners, winnerNames, maxPoints, room }) => {
    updateFromRoom(room);
    hideRoundPrompt();
    const meWon = winners?.includes(state.playerKey);
    const names = Array.isArray(winnerNames) ? winnerNames : [];
    if (names.length > 0) {
      const text = names.length === 1 ? `${names[0]} wins the game!` : `${names.join(", ")} tie for the win!`;
      showGameWinPrompt(`${text} (${maxPoints} points)`);
    } else {
      hideGameWinPrompt();
    }
    if (winners?.length > 1) setBanner(`Game over: tie at ${maxPoints} points.`, "danger");
    else if (meWon) setBanner(`Game over: you win with ${maxPoints} points.`, "info");
    else setBanner(`Game over: winner has ${maxPoints} points.`, "info");
    selectionLocked = true;
  });
}

function join(roomId, name, seat) {
  const rid = normalizeRoomCode(roomId);
  const nm = String(name ?? "").trim().slice(0, 18) || "Player";
  setError("");
  const params = new URLSearchParams(location.search);
  const forceNew = params.get("fresh") === "1";
  const pk = getPlayerKey({ forceNew });
  state.playerKey = pk;
  socket.emit("room:join", { roomId: rid || undefined, name: nm, playerKey: pk, seat });
}

function botFillLocal() {
  // Minimal local convenience: open 4 windows and auto-join same room.
  // This uses browser popup; if blocked, just manually open 4 tabs.
  const nm = (nameInput.value || "Player").trim() || "Player";
  const rid = normalizeRoomCode(roomInput.value) || "";
  // Join current tab first, then open 3 others using same room code (after we get it).
  requestedSeat = "bottom";
  join(rid, nm, requestedSeat);
  setTimeout(() => {
    const code = roomCode.textContent && roomCode.textContent !== "—" ? roomCode.textContent : rid;
    const base = `${location.origin}${location.pathname}?room=${encodeURIComponent(code)}&fresh=1`;
    const names = ["Alpha", "Beta", "Gamma"];
    for (const n of names) {
      window.open(`${base}&name=${encodeURIComponent(n)}`, "_blank", "noopener,noreferrer");
    }
  }, 600);
}

copyRoom.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(roomCode.textContent.trim());
    setBanner("Room code copied.");
    setTimeout(() => setBanner(""), 900);
  } catch {
    setBanner("Couldn't copy. Select the code manually.", "danger");
  }
});

soloBtn.addEventListener("click", botFillLocal);

nameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") joinBtn.click();
});
roomInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") joinBtn.click();
});

// Allow join via URL params
const params = new URLSearchParams(location.search);
if (params.get("name")) nameInput.value = params.get("name");
if (params.get("room")) roomInput.value = params.get("room");
if (!nameInput.value && localStorage.getItem(STORAGE_LAST_NAME)) {
  nameInput.value = localStorage.getItem(STORAGE_LAST_NAME);
}
if (!roomInput.value && localStorage.getItem(STORAGE_LAST_ROOM)) {
  roomInput.value = localStorage.getItem(STORAGE_LAST_ROOM);
}

connectSocket();

restartBtn.addEventListener("click", () => {
  if (!state.roomId) return;
  socket.emit("game:restart", { roomId: state.roomId });
});

readyBtn.addEventListener("click", () => {
  if (!state.roomId || state.started || state.finished) return;
  const next = !myReady;
  myReady = next;
  readyBtn.textContent = myReady ? "Ready ✓" : "Ready";
  socket.emit("room:ready", { roomId: state.roomId, ready: next });
});

function setJoinStage(stage) {
  joinStage = stage;
  if (stage === "details") {
    seatStep.classList.add("hidden");
    backBtn.classList.add("hidden");
    joinBtn.textContent = "Next";
  } else {
    seatStep.classList.remove("hidden");
    backBtn.classList.remove("hidden");
    joinBtn.textContent = "Join";
  }
}

function validateDetails() {
  const nm = String(nameInput.value ?? "").trim();
  if (!nm) {
    setError("Please enter your name.");
    return false;
  }
  setError("");
  return true;
}

function wireSeatButtons() {
  const buttons = Array.from(document.querySelectorAll(".seat-btn"));
  const setSelected = (seat) => {
    requestedSeat = seat;
    for (const b of buttons) b.classList.toggle("selected", b.dataset.seat === seat);
  };
  for (const b of buttons) {
    b.addEventListener("click", () => setSelected(b.dataset.seat));
  }
  // Default
  setSelected("bottom");
}

wireSeatButtons();
setJoinStage("details");

backBtn.addEventListener("click", () => {
  setError("");
  setJoinStage("details");
});

joinBtn.addEventListener("click", () => {
  if (joinStage === "details") {
    if (!validateDetails()) return;
    setJoinStage("seat");
    return;
  }
  if (!requestedSeat) {
    setError("Please choose a seat.");
    return;
  }
  join(roomInput.value, nameInput.value, requestedSeat);
});

