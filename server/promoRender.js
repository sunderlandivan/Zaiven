/**
 * Frame-by-frame promo Short renderer. Runs as its own process so a 12-second render never blocks the portal:
 *   node server/promoRender.js <spec.json>
 * spec: { out, image, name, set, game, price, low, hook, sticker, seed }
 */
import fs from "node:fs";
import { once } from "node:events";
import { spawn } from "node:child_process";
import ffmpegPath from "ffmpeg-static";
import { createCanvas, loadImage, GlobalFonts } from "@napi-rs/canvas";

const W = 1080;
const H = 1920;
const FPS = 30;
const DUR = 12;

GlobalFonts.registerFromPath("C:/Windows/Fonts/impact.ttf", "Impact");
GlobalFonts.registerFromPath("C:/Windows/Fonts/ariblk.ttf", "Arial Black");
GlobalFonts.registerFromPath("C:/Windows/Fonts/seguiemj.ttf", "Segoe UI Emoji");
const IMPACT = "Impact";
const BLACK = '"Arial Black"';
const EMOJI_RE = /(\p{Extended_Pictographic}[\uFE0F\u200D\p{Extended_Pictographic}]*)/u;
const runs = (text) =>
  String(text)
    .split(EMOJI_RE)
    .filter(Boolean)
    .map((s) => ({ s, emoji: EMOJI_RE.test(s) }));

const T = { hookOut: 2.15, drop: 2.4, impact: 2.85, chip: 3.0, name: 3.25, price: 5.9, sticker: 6.6, cta: 8.7 };
const CARD = { cx: 540, cy: 620, box: 700 };
const GAME_LABELS = { pokemon: "POKÉMON", magic: "MAGIC", fab: "FLESH AND BLOOD", weiss: "WEISS SCHWARZ", riftbound: "RIFTBOUND" };

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, p) => a + (b - a) * p;
const prog = (t, a, b) => clamp((t - a) / (b - a));
const easeOutCubic = (x) => 1 - (1 - x) ** 3;
const easeInCubic = (x) => x ** 3;
const easeOutBack = (x, s = 2.2) => 1 + (s + 1) * (x - 1) ** 3 + s * (x - 1) ** 2;
const easeOutElastic = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : 2 ** (-10 * x) * Math.sin((x * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1);
const decay = (t, t0, d) => (t < t0 || t > t0 + d ? 0 : 1 - (t - t0) / d);

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let r = Math.imul(a ^ (a >>> 15), 1 | a);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function shake(t, t0, amp, d) {
  const k = decay(t, t0, d) ** 2 * amp;
  return [k * Math.sin(t * 93 + 1.3), k * Math.cos(t * 71)];
}

export async function renderPromo(spec) {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  const img = await loadImage(fs.readFileSync(spec.image));
  const rand = rng(spec.seed || 1);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";

  // ---------- precomputed layout ----------
  const fit = Math.min((CARD.box - 48) / img.width, (CARD.box - 48) / img.height);
  const cardW = img.width * fit + 48;
  const cardH = img.height * fit + 48;

  // Emoji are drawn as separate runs: mixing them into a font fallback list renders some words in the wrong face.
  function setFont(family, px, emoji) {
    ctx.font = emoji ? `${px}px "Segoe UI Emoji"` : `${px}px ${family}`;
  }
  function measure(text, family, px) {
    return runs(text).reduce((w, r) => {
      setFont(family, px, r.emoji);
      return w + ctx.measureText(r.s).width;
    }, 0);
  }

  const hookFont = (() => {
    for (let px = 124; px >= 70; px -= 6) {
      const words = layoutWords(spec.hook, IMPACT, px, 940, px * 1.12, 820);
      if (words.lines <= 4) return { px, words };
    }
    return { px: 70, words: layoutWords(spec.hook, IMPACT, 70, 940, 78, 820) };
  })();
  const hookStart = 0.15;
  const hookStep = Math.min(0.2, 1.5 / Math.max(1, hookFont.words.list.length));

  const nameLayout = (() => {
    for (let px = 64; px >= 38; px -= 2) {
      const lines = wrap(spec.name, BLACK, px, 920);
      if (lines.length <= 2) return { px, lines };
    }
    return { px: 38, lines: wrap(spec.name, BLACK, 38, 920).slice(0, 2) };
  })();

  const confetti = (n, speed) =>
    Array.from({ length: n }, () => ({
      a: rand() * Math.PI * 2,
      v: speed * (0.45 + rand() * 0.75),
      s: 8 + rand() * 14,
      spin: (rand() - 0.5) * 18,
      c: ["#ffd27a", "#ff7a3d", "#ffffff", "#ff4d6d", "#7ad7ff"][Math.floor(rand() * 5)],
    }));
  const burst1 = confetti(70, 1700);
  const burst2 = confetti(36, 1200);
  const sparkles = Array.from({ length: 14 }, () => {
    const side = rand();
    const ang = rand() * Math.PI * 2;
    return { x: CARD.cx + Math.cos(ang) * (cardW / 2 + 30 + side * 80), y: CARD.cy + Math.sin(ang) * (cardH / 2 + 30 + side * 80), s: 14 + rand() * 22, p: rand() * 6, f: 3 + rand() * 4 };
  });
  const wordTilt = hookFont.words.list.map(() => (rand() - 0.5) * 0.12);

  // ---------- drawing helpers ----------
  function layoutWords(text, family, px, maxW, lineH, cy) {
    const sp = measure(" ", family, px) * 1.3;
    const paras = String(text).split("\n");
    const lines = [];
    paras.forEach((raw, pi) => {
      let line = [];
      let w = 0;
      // A trailing emoji rides with the word before it so it never wraps onto a line alone.
      const words = raw.split(/\s+/).filter(Boolean).reduce((acc, word) => {
        if (acc.length && runs(word).every((r) => r.emoji)) acc[acc.length - 1] += ` ${word}`;
        else acc.push(word);
        return acc;
      }, []);
      for (const word of words) {
        const ww = measure(word, family, px);
        if (line.length && w + sp + ww > maxW) {
          lines.push({ words: line, w, pi });
          line = [];
          w = 0;
        }
        w += (line.length ? sp : 0) + ww;
        line.push({ text: word, w: ww });
      }
      if (line.length) lines.push({ words: line, w, pi });
    });
    const top = cy - ((lines.length - 1) * lineH) / 2;
    const list = [];
    lines.forEach((l, li) => {
      let x = W / 2 - l.w / 2;
      const punchline = paras.length > 1 ? l.pi === paras.length - 1 : li === lines.length - 1;
      for (const wd of l.words) {
        list.push({ text: wd.text, x: x + wd.w / 2, y: top + li * lineH, last: punchline });
        x += wd.w + sp;
      }
    });
    return { list, lines: lines.length };
  }

  function wrap(text, family, px, maxW) {
    const lines = [""];
    for (const word of String(text).split(/\s+/)) {
      const cur = lines[lines.length - 1];
      const next = cur ? `${cur} ${word}` : word;
      if (cur && measure(next, family, px) > maxW) lines.push(word);
      else lines[lines.length - 1] = next;
    }
    return lines;
  }

  /** Centered text with optional outline; emoji runs keep their own colors. */
  function outlined(text, x, y, family, px, fill, lw = 12, stroke = "#140504") {
    let cx = x - measure(text, family, px) / 2;
    ctx.textAlign = "left";
    for (const r of runs(text)) {
      setFont(family, px, r.emoji);
      const w = ctx.measureText(r.s).width;
      if (lw > 0 && !r.emoji) {
        ctx.lineWidth = lw;
        ctx.strokeStyle = stroke;
        ctx.strokeText(r.s, cx, y);
      }
      ctx.fillStyle = fill;
      ctx.fillText(r.s, cx, y);
      cx += w;
    }
    ctx.textAlign = "center";
  }

  function star(x, y, r) {
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const rr = i % 2 ? r * 0.28 : r;
      const a = (i * Math.PI) / 4 - Math.PI / 2;
      ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.fill();
  }

  function drawBackground(t) {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#2a0b07");
    g.addColorStop(1, "#060203");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    const pulse = 0.22 + 0.08 * Math.sin(t * 3) + 0.25 * decay(t, T.impact, 0.8);
    const r = ctx.createRadialGradient(CARD.cx, CARD.cy, 0, CARD.cx, CARD.cy, 1000);
    r.addColorStop(0, `rgba(255,96,32,${pulse})`);
    r.addColorStop(1, "rgba(255,96,32,0)");
    ctx.fillStyle = r;
    ctx.fillRect(0, 0, W, H);
  }

  function drawRays(t, alpha) {
    if (alpha <= 0) return;
    ctx.save();
    ctx.translate(CARD.cx, CARD.cy);
    ctx.rotate(t * 0.35);
    ctx.fillStyle = `rgba(255,200,100,${alpha})`;
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, 1500, a, a + Math.PI / 18);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  function drawConfetti(list, t, t0, ox, oy) {
    const age = t - t0;
    if (age < 0 || age > 1.8) return;
    ctx.globalAlpha = clamp(1.8 - age);
    for (const p of list) {
      const x = ox + Math.cos(p.a) * p.v * age * 0.9;
      const y = oy + Math.sin(p.a) * p.v * age * 0.9 + 0.5 * 2600 * age * age;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(p.spin * age);
      ctx.fillStyle = p.c;
      ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  function drawHook(t) {
    const out = prog(t, T.hookOut, T.drop);
    if (out >= 1) return;
    ctx.save();
    const zoom = 1 + easeInCubic(out) * 1.6;
    ctx.globalAlpha = 1 - out;
    ctx.translate(W / 2, 820);
    ctx.scale(zoom, zoom);
    ctx.translate(-W / 2, -820);
    hookFont.words.list.forEach((w, i) => {
      const t0 = hookStart + i * hookStep;
      if (t < t0) return;
      const s = easeOutBack(prog(t, t0, t0 + 0.22), 3);
      const wob = Math.sin(t * 5 + i) * 0.025;
      ctx.save();
      ctx.translate(w.x, w.y);
      ctx.rotate(wordTilt[i] * (1 - prog(t, t0, t0 + 0.3)) + wob);
      ctx.scale(s, s);
      outlined(w.text, 0, 0, IMPACT, hookFont.px, w.last && hookFont.words.lines > 1 ? "#ffe14d" : "#ffffff", 16);
      ctx.restore();
    });
    ctx.restore();
  }

  function drawCard(t) {
    let y = CARD.cy;
    let rot = 0;
    let sx = 1;
    let sy = 1;
    if (t < T.impact) {
      const p = prog(t, T.drop, T.impact);
      y = lerp(-cardH, CARD.cy, easeInCubic(p));
      rot = lerp(-0.35, 0, p);
    } else {
      const dt = t - T.impact;
      const spring = Math.exp(-6 * dt) * Math.sin(dt * 26);
      sx = 1 + 0.14 * spring;
      sy = 1 - 0.14 * spring;
      y += Math.sin((t - T.impact) * 2.2) * 10;
      rot = Math.sin((t - T.impact) * 1.6) * 0.025;
    }
    ctx.save();
    ctx.translate(CARD.cx, y + cardH / 2);
    ctx.rotate(rot);
    ctx.scale(sx, sy);
    ctx.translate(0, -cardH / 2);
    ctx.shadowColor = "rgba(0,0,0,0.6)";
    ctx.shadowBlur = 50;
    ctx.shadowOffsetY = 26;
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.roundRect(-cardW / 2, -cardH / 2, cardW, cardH, 28);
    ctx.fill();
    ctx.shadowColor = "transparent";
    ctx.drawImage(img, -cardW / 2 + 24, -cardH / 2 + 24, cardW - 48, cardH - 48);
    ctx.restore();
  }

  function pill(text, x, y, px, bg, fg, rot = 0, scale = 1) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.scale(scale, scale);
    const w = measure(text, BLACK, px) + 56;
    const h = px * 1.6;
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.roundRect(-w / 2, -h / 2, w, h, h / 2);
    ctx.fill();
    outlined(text, 0, 2, BLACK, px, fg, 0);
    ctx.restore();
  }

  function drawReveal(t) {
    drawRays(t, 0.16 * easeOutCubic(prog(t, T.impact, T.impact + 0.5)));
    if (t > T.impact) {
      ctx.fillStyle = "#ffe9a8";
      for (const s of sparkles) {
        const k = Math.max(0, Math.sin(t * s.f + s.p));
        if (k > 0.05) star(s.x, s.y + Math.sin(t + s.p) * 8, s.s * k);
      }
    }
    drawCard(t);
    drawConfetti(burst1, t, T.impact, CARD.cx, CARD.cy + cardH / 2 - 40);

    if (t > T.chip) {
      const p = easeOutBack(prog(t, T.chip, T.chip + 0.4));
      const chip = [GAME_LABELS[spec.game] || "", spec.set].filter(Boolean).join("  ·  ").slice(0, 46);
      if (chip) pill(chip, W / 2, lerp(120, 205, p), 28, "rgba(255,255,255,0.12)", "#ffd9b0");
    }

    if (t > T.name) {
      const total = nameLayout.lines.join(" ").length;
      let shown = Math.floor(prog(t, T.name, T.name + 0.9) * total);
      nameLayout.lines.forEach((line, i) => {
        const part = line.slice(0, Math.max(0, shown));
        shown -= line.length + 1;
        if (part) outlined(part, W / 2, 1040 + i * nameLayout.px * 1.15, BLACK, nameLayout.px, "#ffffff", 10);
      });
    }

    if (spec.low && t > T.impact + 0.4) {
      const pop = easeOutElastic(prog(t, T.impact + 0.4, T.impact + 1.2));
      pill("LOW STOCK 🔥", CARD.cx - cardW / 2 + 70, CARD.cy - cardH / 2 + 10, 30, "#e3243b", "#ffffff", -0.16, pop * (1 + 0.06 * Math.sin(t * 10)));
    }

    if (t > T.price) {
      const p = prog(t, T.price, T.price + 0.32);
      const s = lerp(3.4, 1, easeOutBack(p, 1.6)) * (1 + 0.025 * Math.sin((t - T.price) * 6));
      ctx.save();
      ctx.globalAlpha = clamp(p * 3);
      ctx.translate(W / 2, 1265);
      ctx.rotate(-0.09);
      ctx.scale(s, s);
      const g = ctx.createLinearGradient(0, -90, 0, 90);
      g.addColorStop(0, "#ffe08a");
      g.addColorStop(1, "#ff5a1f");
      ctx.shadowColor = "rgba(0,0,0,0.5)";
      ctx.shadowBlur = 24;
      ctx.shadowOffsetY = 12;
      outlined(`$${spec.price.toFixed(2)}`, 0, 0, IMPACT, 190, g, 18, "#2a0a00");
      ctx.restore();
      drawConfetti(burst2, t, T.price + 0.3, W / 2, 1265);
    }

    if (t > T.sticker && spec.sticker) {
      const pop = easeOutElastic(prog(t, T.sticker, T.sticker + 0.9));
      ctx.save();
      ctx.translate(CARD.cx + cardW / 2 - 40, CARD.cy - cardH / 2 + 30);
      ctx.rotate(0.13 + Math.sin(t * 5) * 0.05);
      ctx.scale(pop, pop);
      const lines = wrap(spec.sticker, BLACK, 38, 380);
      const w = Math.max(...lines.map((l) => measure(l, BLACK, 38))) + 60;
      const h = lines.length * 48 + 44;
      ctx.shadowColor = "rgba(0,0,0,0.45)";
      ctx.shadowBlur = 20;
      ctx.shadowOffsetY = 10;
      ctx.fillStyle = "#ffe14d";
      ctx.beginPath();
      ctx.roundRect(-w / 2, -h / 2, w, h, 14);
      ctx.fill();
      ctx.shadowColor = "transparent";
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      ctx.fillRect(-50, -h / 2 - 16, 100, 32);
      lines.forEach((l, i) => outlined(l, 0, -((lines.length - 1) * 48) / 2 + i * 48 + 2, BLACK, 38, "#1b1206", 0));
      ctx.restore();
    }

    if (t > T.cta) {
      const p = easeOutBack(prog(t, T.cta, T.cta + 0.5));
      const y = lerp(H + 120, 1430, p);
      const s = 1 + 0.04 * Math.sin((t - T.cta) * 8);
      ctx.save();
      ctx.translate(W / 2, y);
      ctx.scale(s, s);
      const g = ctx.createLinearGradient(-390, 0, 390, 0);
      g.addColorStop(0, "#ff8a3d");
      g.addColorStop(1, "#e3341c");
      ctx.shadowColor = "rgba(255,90,30,0.6)";
      ctx.shadowBlur = 40;
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.roundRect(-390, -64, 780, 128, 64);
      ctx.fill();
      ctx.shadowColor = "transparent";
      let px = 54;
      while (measure("preeminentstore.com", BLACK, px) > 700) px -= 2;
      outlined("preeminentstore.com", 0, 3, BLACK, px, "#ffffff", 0);
      ctx.restore();
      const bob = -Math.abs(Math.sin((t - T.cta) * 5)) * 16;
      ctx.globalAlpha = clamp(prog(t, T.cta + 0.4, T.cta + 0.7));
      outlined("🔗 LINK IN BIO", W / 2, 1545 + bob, IMPACT, 64, "#ffffff", 12);
      ctx.globalAlpha = 1;
    }
  }

  function frame(t) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    drawBackground(t);
    const [ax, ay] = shake(t, T.impact, 36, 0.55);
    const [bx, by] = shake(t, T.price + 0.3, 20, 0.35);
    const punch = 1 + 0.07 * decay(t, T.impact, 0.35) + 0.045 * decay(t, T.price + 0.3, 0.3);
    ctx.translate(W / 2 + ax + bx, H / 2 + ay + by);
    ctx.scale(punch, punch);
    ctx.translate(-W / 2, -H / 2);
    outlined("PREEMINENTSTORE.COM", W / 2, 120, BLACK, 40, "#ffd27a", 0);
    if (t < T.drop) drawHook(t);
    if (t >= T.drop) drawReveal(t);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const flash = 0.85 * decay(t, T.impact, 0.28) + 0.35 * decay(t, T.price + 0.3, 0.18);
    if (flash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${flash})`;
      ctx.fillRect(0, 0, W, H);
    }
  }

  // ---------- sound effects (synthesized, royalty free) ----------
  const SFX = {
    pop: { d: 0.14, e: "0.5*sin(2*PI*(500+3800*t)*t)*exp(-28*t)" },
    whoosh: { d: 0.45, e: "(random(0)*2-1)*0.55*sin(PI*t/0.45)", f: "highpass=f=400,lowpass=f=3500" },
    boom: { d: 1.0, e: "0.95*sin(2*PI*(120-80*t)*t)*exp(-4.5*t)+0.35*(random(0)*2-1)*exp(-22*t)" },
    ding: { d: 1.3, e: "0.28*(sin(2*PI*1319*t)+0.7*sin(2*PI*1976*t)+0.3*sin(2*PI*2637*t))*exp(-3.5*t)" },
    chk: { d: 0.12, e: "(random(0)*2-1)*0.45*exp(-35*t)", f: "highpass=f=2500" },
    boing: { d: 0.7, e: "0.4*sin(2*PI*(150+60*sin(2*PI*8*t))*t)*exp(-3.8*t)" },
  };
  const events = [
    ...hookFont.words.list.map((_, i) => ["pop", hookStart + i * hookStep]),
    ["whoosh", T.hookOut],
    ["boom", T.impact],
    ["chk", T.price + 0.22],
    ["ding", T.price + 0.3],
    ...(spec.sticker ? [["boing", T.sticker]] : []),
    ["whoosh", T.cta - 0.1],
    ["pop", T.cta + 0.35],
  ];
  const audio = events
    .map(([k, at], i) => {
      const s = SFX[k];
      const ms = Math.round(at * 1000);
      return `aevalsrc=exprs='${s.e}':s=44100:d=${s.d}${s.f ? `,${s.f}` : ""},adelay=delays=${ms}:all=1[a${i}]`;
    })
    .join(";");
  const mix = `${events.map((_, i) => `[a${i}]`).join("")}amix=inputs=${events.length}:normalize=0,alimiter=limit=0.9,apad,atrim=0:${DUR},aformat=channel_layouts=stereo[aout]`;

  const ff = spawn(
    ffmpegPath,
    [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "rawvideo", "-pix_fmt", "rgba", "-s", `${W}x${H}`, "-r", String(FPS), "-i", "pipe:0",
      "-filter_complex", `${audio};${mix}`,
      "-map", "0:v", "-map", "[aout]",
      "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "128k", "-t", String(DUR), "-movflags", "+faststart",
      spec.out,
    ],
    { windowsHide: true }
  );
  let stderr = "";
  ff.stderr.on("data", (d) => (stderr += d));
  const done = once(ff, "close");

  for (let f = 0; f < FPS * DUR; f++) {
    frame(f / FPS);
    const { data } = ctx.getImageData(0, 0, W, H);
    if (!ff.stdin.write(Buffer.from(data.buffer, data.byteOffset, data.byteLength))) await once(ff.stdin, "drain");
  }
  ff.stdin.end();
  const [code] = await done;
  if (code !== 0) throw new Error(`ffmpeg failed: ${stderr.trim().slice(-400)}`);
}

if (process.argv[1] && process.argv[1].replace(/\\/g, "/").endsWith("server/promoRender.js")) {
  renderPromo(JSON.parse(fs.readFileSync(process.argv[2], "utf8"))).catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
