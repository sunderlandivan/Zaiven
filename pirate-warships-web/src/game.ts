import {
  initInput,
  initPointer,
  getThrottleInput,
  getSteerInput,
  getPointer,
  consumeCannonFire,
} from './input.js';

const MAX_MPH = 40;
const MIN_MPH = 0;
/** No wake below this speed; scales to full size at `MAX_MPH`. */
const WAKE_START_MPH = 7;
const THROTTLE_RATE_MPH_S = 22;
/** Seconds: actual speed catches throttle (asymmetric). */
const SPEED_TAU_ACCEL_S = 0.95;
const SPEED_TAU_DECEL_S = 1.25;
/** Rudder needs forward way: no turn authority below ~this speed (mph). */
const RUDDER_MIN_MPH = 3;
/** Peak yaw rate (rad/s) when authority and high-speed penalty are ideal. */
const YAW_RATE_MAX_RAD_S = 1.35;
/** v² term: higher = tighter turns at max speed are rarer (0.35 ≈ ~62% at full throttle). */
const YAW_HIGH_SPEED_DRAG = 0.38;
/** How fast ordered yaw rate is reached (1/s); lower = heavier, slower helm response. */
const YAW_RESPONSE = 5.5;
/** Wind direction re-rolls on this interval (seconds). */
const WIND_CHANGE_INTERVAL_S = 120;
/** With wind: aligned with wind → ×2, into wind → ×0.5 (linear in cos Δθ). */
const WIND_MULT_MIN = 0.5;
const WIND_MULT_MAX = 2;
/** Game units: world pixels per second at 40 mph (tunable feel). */
const MPH_TO_PX_PER_S = 5.5;
/**
 * Seamless water tile resolution (larger = sharper detail, closer to a photo texture).
 * 1024² is a good balance; edges still match when tiled.
 */
const WATER_TILE = 1024;
/** Smaller tile updated every frame for animated ripples (seamless + time phases). */
const WAVE_ANIM_TILE = 256;

/**
 * Furthest zoom out: visible world is this × wider/taller than the default view
 * (camera scale min = 1 / this). Tune here.
 */
const CAMERA_MAX_ZOOM_OUT_MULT = 2;

const CANNON_BALL_SPEED_PX_S = 800;
const CANNON_BALL_R = 4.6;
/** Max flight distance = this × larger ship sprite span (world px, matches `dw`/`dh`). */
const CANNON_BALL_RANGE_SHIP_MULT = 3;
const SALVO_STAGGER_S = 0.062;
/** Same-side broadside cooldown; other battery is independent. */
const CANNON_SIDE_COOLDOWN_MS = 7_000;
/**
 * Broadsides only: |aim·bow| must be ≤ this (cos of max angle from beam).
 * ~36° from bow/stern blocked — guns can’t bear fore or aft.
 */
const CANNON_MAX_AHEAD_AFT_DOT = Math.cos((36 * Math.PI) / 180);
/** Bow–stern gun positions as fraction of half-length `dw/2`. */
const GUN_ALONG_FR = [-0.38, -0.13, 0.13, 0.38] as const;
/** Gun row inset from centerline as fraction of half-beam (was ~0.88 → muzzles sat past the rail in open water). */
const GUN_BEAM_FR = 0.36;

type MuzzleParticle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  kind: 'smoke' | 'fire';
  baseR: number;
  spin: number;
};

type SplashParticle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  kind: 'ripple' | 'droplet';
};

/**
 * Gray, semi-transparent stock watermarks darken R,G,B roughly equally; thin strokes
 * are darker than a local color average. Blend those pixels toward the neighborhood
 * mean (does not shift saturated wood reds/browns much).
 */
function reduceGrayWatermarkOverlay(
  d: Uint8ClampedArray,
  w: number,
  h: number
): void {
  const copy = new Uint8ClampedArray(d);
  const rad = 6;
  for (let y = rad; y < h - rad; y++) {
    for (let x = rad; x < w - rad; x++) {
      const i = (y * w + x) * 4;
      if (copy[i + 3] < 18) continue;
      const r = copy[i];
      const gc = copy[i + 1];
      const b = copy[i + 2];
      const sat = Math.max(r, gc, b) - Math.min(r, gc, b);
      if (sat > 44) continue;

      let sr = 0;
      let sg = 0;
      let sb = 0;
      let sc = 0;
      for (let dy = -rad; dy <= rad; dy++) {
        for (let dx = -rad; dx <= rad; dx++) {
          const j = ((y + dy) * w + (x + dx)) * 4;
          if (copy[j + 3] < 22) continue;
          sr += copy[j];
          sg += copy[j + 1];
          sb += copy[j + 2];
          sc++;
        }
      }
      if (sc < 40) continue;
      const ar = sr / sc;
      const ag = sg / sc;
      const ab = sb / sc;
      const dr = ar - r;
      const dg = ag - gc;
      const db = ab - b;
      const dMean = (dr + dg + db) / 3;
      if (dMean < 7 || dMean > 58) continue;
      if (Math.abs(dr - dg) > 16 || Math.abs(dr - db) > 16 || Math.abs(dg - db) > 16)
        continue;

      const strength = Math.min(0.78, 0.35 + ((dMean - 7) / 51) * 0.45) * (1 - sat / 50);
      d[i] = Math.min(255, Math.round(r + dr * strength));
      d[i + 1] = Math.min(255, Math.round(gc + dg * strength));
      d[i + 2] = Math.min(255, Math.round(b + db * strength));
    }
  }
}

function edgeBackdropStats(data: Uint8ClampedArray, w: number, h: number) {
  let sumL = 0;
  let sumMin = 0;
  let n = 0;
  const stepX = Math.max(1, Math.floor(w / 80));
  const stepY = Math.max(1, Math.floor(h / 80));
  const add = (x: number, y: number) => {
    const xi = Math.min(Math.max(0, x), w - 1);
    const yi = Math.min(Math.max(0, y), h - 1);
    const i = (yi * w + xi) * 4;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    sumL += 0.299 * r + 0.587 * g + 0.114 * b;
    sumMin += Math.min(r, g, b);
    n++;
  };
  for (let x = 0; x < w; x += stepX) {
    add(x, 0);
    add(x, h - 1);
  }
  for (let y = 0; y < h; y += stepY) {
    add(0, y);
    add(w - 1, y);
  }
  if (n === 0) return { meanL: 128, meanMin: 128 };
  return { meanL: sumL / n, meanMin: sumMin / n };
}

/**
 * Auto: white studio sheet (new asset) or black backdrop → transparent;
 * then soften gray stock watermarks (Adobe / pngtree style).
 */
function prepareShipSprite(src: HTMLImageElement): HTMLCanvasElement {
  const w = src.naturalWidth;
  const h = src.naturalHeight;
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const g = out.getContext('2d')!;
  g.drawImage(src, 0, 0);
  const imgd = g.getImageData(0, 0, w, h);
  const d = imgd.data;

  const { meanL, meanMin } = edgeBackdropStats(d, w, h);
  const whiteSheet = meanMin > 170 && meanL > 195;

  if (whiteSheet) {
    const hi = 251;
    const lo = 228;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i];
      const gc = d[i + 1];
      const b = d[i + 2];
      const a0 = d[i + 3];
      if (a0 === 0) continue;
      const mn = Math.min(r, gc, b);
      const mx = Math.max(r, gc, b);
      if (mn >= hi) {
        d[i + 3] = 0;
        continue;
      }
      if (mn > lo && mx - mn < 42) {
        const u = (hi - mn) / (hi - lo);
        d[i + 3] = Math.floor(a0 * Math.min(1, Math.max(0, u)));
      }
    }
  } else {
    const cut = 14;
    const feather = 38;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i];
      const gc = d[i + 1];
      const b = d[i + 2];
      const a0 = d[i + 3];
      if (a0 === 0) continue;
      const mx = Math.max(r, gc, b);
      if (mx <= cut) {
        d[i + 3] = 0;
        continue;
      }
      if (mx < cut + feather) {
        const t = (mx - cut) / feather;
        d[i + 3] = Math.floor(a0 * Math.min(1, Math.max(0, t)));
      }
    }
  }

  reduceGrayWatermarkOverlay(d, w, h);
  reduceGrayWatermarkOverlay(d, w, h);
  g.putImageData(imgd, 0, 0);
  return out;
}

/**
 * Seamless ocean base: directional swells (wave fronts), not isotropic weave.
 * Sums of sin(ux·a + vy·b) only — no sin×sin grain (that reads as fabric).
 */
function createSeamlessWaterTile(size: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const g = c.getContext('2d')!;
  const id = g.createImageData(size, size);
  const data = id.data;
  const k = (2 * Math.PI) / size;

  for (let y = 0; y < size; y++) {
    const vy = y * k;
    for (let x = 0; x < size; x++) {
      const ux = x * k;
      // Favor |vy| > |ux| terms so bands read as horizontal crests (view from above).
      let n =
        Math.sin(vy * 2 + ux * 1) * 0.34 +
        Math.sin(vy * 3 - ux * 2) * 0.26 +
        Math.sin(vy * 4 + ux * 1) * 0.18 +
        Math.sin(ux * 2 + vy * 5) * 0.16 +
        Math.sin(vy * 6 - ux * 3) * 0.1 +
        Math.sin(vy * 1 + ux * 4) * 0.08 +
        Math.sin(ux * 1 - vy * 7) * 0.06 +
        Math.sin(vy * 8 + ux * 5) * 0.045;
      n = Math.max(-1, Math.min(1, n * 0.72));
      const t = 0.48 + n * 0.38;

      const r = 10 + t * 52;
      const gc = 52 + t * 102;
      const b = 88 + t * 92;

      const i = (y * size + x) * 4;
      data[i] = r;
      data[i + 1] = gc;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }
  g.putImageData(id, 0, 0);
  return c;
}

/**
 * Traveling swell + chop: phase in mostly vy-dominated terms = fronts that move like waves.
 * No sin(sin(...)) or sin×sin — avoids moiré / fabric look.
 */
function fillAnimatedWaveTile(
  imageData: ImageData,
  waterTime: number,
  worldX: number,
  worldY: number
) {
  const size = WAVE_ANIM_TILE;
  const data = imageData.data;
  const k = (2 * Math.PI) / size;
  const p1 = waterTime * 2.05 + worldX * 0.0035;
  const p2 = waterTime * 1.45 - worldY * 0.004;
  const p3 = waterTime * 1.75 + worldX * 0.002 - worldY * 0.002;

  for (let y = 0; y < size; y++) {
    const vy = y * k;
    for (let x = 0; x < size; x++) {
      const ux = x * k;
      const swell =
        Math.sin(vy * 3 + ux * 1 + p1) * 0.42 +
        Math.sin(vy * 5 - ux * 2 + p2) * 0.33 +
        Math.sin(vy * 2 + ux * 3 + p3 * 0.65) * 0.22;
      const chop =
        Math.sin(vy * 7 + ux * 2 + p2 * 1.2) * 0.14 +
        Math.sin(vy * 9 - ux * 4 + p1 * 0.8) * 0.1;
      let h = swell + chop;
      h = Math.max(-1, Math.min(1, h * 0.85));
      const crest = 0.5 + 0.5 * h;
      const a = Math.floor(5 + Math.pow(crest, 1.35) * 46);

      const i = (y * size + x) * 4;
      data[i] = 188;
      data[i + 1] = 228;
      data[i + 2] = 255;
      data[i + 3] = a;
    }
  }
}

export class Game {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;
  private shipImg = new Image();
  /** Ship with black backdrop removed; hull pixels unchanged. */
  private shipDraw: HTMLCanvasElement | null = null;
  private waterPattern: CanvasPattern | null = null;
  private waterReady = false;
  private waterTileW = WATER_TILE;
  private waterTileH = WATER_TILE;
  private waveCanvas: HTMLCanvasElement;
  private waveCtx: CanvasRenderingContext2D;
  private waveImageData: ImageData;
  /** Seconds; drives gentle water motion. */
  private waterTime = 0;
  private lastFrameMs = 0;

  /** Ordered engine setting (0–40 mph). */
  throttleMph = 0;
  /** Actual forward speed through water (lags throttle). */
  speedMph = 0;
  /** Radians; 0 = bow toward +X (right), matching the ship art. */
  heading = 0;
  /** Current turn rate (rad/s); smoothed toward rudder target. */
  private yawRateRadS = 0;
  worldX = 0;
  worldY = 0;
  /** Ship-center positions in world space (oldest first) so the wake stems from midship. */
  private wakeTrail: Array<{ x: number; y: number }> = [];

  private pendingCannon: Array<{
    delay: number;
    wx: number;
    wy: number;
    vx: number;
    vy: number;
  }> = [];
  private cannonBalls: Array<{
    x: number;
    y: number;
    vx: number;
    vy: number;
    spawnX: number;
    spawnY: number;
    maxRangeSq: number;
  }> = [];
  private splashParticles: SplashParticle[] = [];
  private muzzleParticles: MuzzleParticle[] = [];
  private lastCannonPortMs = Number.NEGATIVE_INFINITY;
  private lastCannonStarboardMs = Number.NEGATIVE_INFINITY;
  /** RAF timestamp for reticle cooldown ring (same clock as broadside cooldown). */
  private animTimeMs = 0;
  /** World draw scale (1 = default); zoom in >1, zoom out <1. Clamped each wheel / resize. */
  private cameraZoom = 1;

  /**
   * Radians; direction the wind blows (same convention as `heading`: 0 = +X).
   * Random on load; new value every `WIND_CHANGE_INTERVAL_S`.
   */
  private windDirectionRad = Math.random() * Math.PI * 2;
  private windTimerS = 0;

  private onHudCb: (mph: number, windDirectionRad: number) => void = () => {};

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2d context required');
    this.ctx = ctx;
    this.waveCanvas = document.createElement('canvas');
    this.waveCanvas.width = WAVE_ANIM_TILE;
    this.waveCanvas.height = WAVE_ANIM_TILE;
    const wctx = this.waveCanvas.getContext('2d');
    if (!wctx) throw new Error('wave canvas 2d required');
    this.waveCtx = wctx;
    this.waveImageData = wctx.createImageData(WAVE_ANIM_TILE, WAVE_ANIM_TILE);
    initInput();
    initPointer(canvas, (dy) => this.onWheelZoom(dy));
    canvas.style.cursor = 'none';
    this.initAssets();
  }

  private initAssets() {
    const tile = createSeamlessWaterTile(WATER_TILE);
    this.waterPattern = this.ctx.createPattern(tile, 'repeat');
    this.waterTileW = WATER_TILE;
    this.waterTileH = WATER_TILE;
    this.waterReady = !!this.waterPattern;

    const bakeShip = () => {
      try {
        if (this.shipImg.naturalWidth > 0) {
          this.shipDraw = prepareShipSprite(this.shipImg);
        }
      } catch {
        this.shipDraw = null;
      }
    };
    this.shipImg.onload = bakeShip;
    this.shipImg.src = new URL('/assets/ship.png?v=stock', window.location.origin).href;
    if (this.shipImg.complete) bakeShip();
  }

  private spawnMuzzleBurst(wx: number, wy: number, shotVx: number, shotVy: number) {
    const spd = Math.hypot(shotVx, shotVy) || 1;
    const bx = shotVx / spd;
    const by = shotVy / spd;
    const px = -by;
    const py = bx;

    for (let i = 0; i < 16; i++) {
      const side = (Math.random() - 0.5) * 2;
      const back = 0.45 + Math.random() * 0.55;
      const maxLife = 0.52 + Math.random() * 0.38;
      this.muzzleParticles.push({
        x: wx + px * (Math.random() - 0.5) * 7,
        y: wy + py * (Math.random() - 0.5) * 7,
        vx:
          -bx * (18 + Math.random() * 38) * back +
          px * side * (14 + Math.random() * 22),
        vy:
          -by * (18 + Math.random() * 38) * back +
          py * side * (14 + Math.random() * 22),
        life: maxLife,
        maxLife,
        kind: 'smoke',
        baseR: 16 + Math.random() * 26,
        spin: Math.random() * Math.PI * 2,
      });
    }

    for (let i = 0; i < 4; i++) {
      const jitter = (Math.random() - 0.5) * 0.55;
      const c = Math.cos(jitter);
      const s = Math.sin(jitter);
      const fx = bx * c - by * s;
      const fy = bx * s + by * c;
      const maxLife = 0.09 + Math.random() * 0.07;
      this.muzzleParticles.push({
        x: wx + (Math.random() - 0.5) * 4,
        y: wy + (Math.random() - 0.5) * 4,
        vx: fx * (32 + Math.random() * 28) - bx * 18,
        vy: fy * (32 + Math.random() * 28) - by * 18,
        life: maxLife,
        maxLife,
        kind: 'fire',
        baseR: 8 + Math.random() * 10,
        spin: Math.random() * Math.PI * 2,
      });
    }
  }

  onHudUpdate(cb: (mph: number, windDirectionRad: number) => void) {
    this.onHudCb = cb;
  }

  resize(w: number, h: number) {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.floor(w * this.dpr);
    this.canvas.height = Math.floor(h * this.dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.clampCameraZoom();
  }

  private getCameraZoomMin(): number {
    return 1 / CAMERA_MAX_ZOOM_OUT_MULT;
  }

  /** Max zoom: ship’s larger span ≈ 88% of the shorter viewport edge (fills frame). */
  private getCameraZoomMax(): number {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    const { dw, dh } = this.shipSpriteScreenExtents();
    const shipSpan = Math.max(dw, dh);
    const vmin = Math.min(w, h);
    if (shipSpan < 1) return 3;
    return Math.max(1.02, (vmin * 0.88) / shipSpan);
  }

  private clampCameraZoom(): void {
    this.cameraZoom = Math.min(
      this.getCameraZoomMax(),
      Math.max(this.getCameraZoomMin(), this.cameraZoom)
    );
  }

  private onWheelZoom(deltaY: number): void {
    this.cameraZoom *= Math.exp(-deltaY * 0.00115);
    this.clampCameraZoom();
  }

  update(tMs: number) {
    this.animTimeMs = tMs;
    const dt =
      this.lastFrameMs > 0 ? Math.min(0.05, (tMs - this.lastFrameMs) / 1000) : 1 / 60;
    this.lastFrameMs = tMs;
    this.windTimerS += dt;
    if (this.windTimerS >= WIND_CHANGE_INTERVAL_S) {
      this.windTimerS -= WIND_CHANGE_INTERVAL_S;
      this.windDirectionRad = Math.random() * Math.PI * 2;
    }

    const throttleInput = getThrottleInput();
    if (throttleInput !== 0) {
      this.throttleMph += throttleInput * THROTTLE_RATE_MPH_S * dt;
      this.throttleMph = Math.max(MIN_MPH, Math.min(MAX_MPH, this.throttleMph));
    }

    const windAlign = Math.cos(this.heading - this.windDirectionRad);
    const windMult =
      WIND_MULT_MIN +
      ((windAlign + 1) * 0.5 * (WIND_MULT_MAX - WIND_MULT_MIN));
    const targetSpeedMph = this.throttleMph * windMult;

    const speedTau =
      targetSpeedMph > this.speedMph ? SPEED_TAU_ACCEL_S : SPEED_TAU_DECEL_S;
    this.speedMph +=
      (targetSpeedMph - this.speedMph) * (1 - Math.exp(-dt / speedTau));

    const steer = getSteerInput();
    const speedN = Math.min(1, Math.max(0, this.speedMph / MAX_MPH));
    const rudderAuthority = Math.min(1, this.speedMph / RUDDER_MIN_MPH);
    const highSpeedTurnCap = 1 - YAW_HIGH_SPEED_DRAG * speedN * speedN;
    const maxYawNow =
      YAW_RATE_MAX_RAD_S *
      rudderAuthority *
      Math.max(0.36, highSpeedTurnCap);
    const targetYawRate = steer * maxYawNow;
    this.yawRateRadS +=
      (targetYawRate - this.yawRateRadS) *
      Math.min(1, 1 - Math.exp(-YAW_RESPONSE * dt));
    this.heading += this.yawRateRadS * dt;

    const speedPx = (this.speedMph * MPH_TO_PX_PER_S) * dt;
    this.worldX += Math.cos(this.heading) * speedPx;
    this.worldY += Math.sin(this.heading) * speedPx;

    this.recordWakeTrail();

    this.updateCannon(dt);
    const cw = this.canvas.clientWidth;
    const ch = this.canvas.clientHeight;
    if (consumeCannonFire()) {
      this.queueBroadside(tMs, cw * 0.5, ch * 0.5);
    }

    this.waterTime += dt;
    this.onHudCb(this.speedMph, this.windDirectionRad);
    this.render();
  }

  /**
   * Seamless procedural water: main tile + light second phase for depth (no blur).
   */
  private renderWater(w: number, h: number, cx: number, cy: number) {
    const pattern = this.waterPattern;
    if (!pattern || !this.waterReady) return;

    const tw = this.waterTileW;
    const th = this.waterTileH;
    const t = this.waterTime;
    const driftX = Math.sin(t * 0.33) * 9 + Math.sin(t * 0.09) * 4;
    const driftY = Math.cos(t * 0.27) * 8 + Math.sin(t * 0.14) * 3.5;

    const scrollX = this.worldX + driftX;
    const scrollY = this.worldY + driftY;
    const ox = ((scrollX % tw) + tw) % tw;
    const oy = ((scrollY % th) + th) % th;

    const margin = Math.max(tw, th);

    this.ctx.save();
    this.ctx.imageSmoothingEnabled = true;
    this.ctx.imageSmoothingQuality = 'high';
    this.ctx.translate(cx, cy);

    this.ctx.fillStyle = '#153d5c';
    this.ctx.fillRect(-w * 0.55 - margin, -h * 0.55 - margin, w * 1.1 + margin * 2, h * 1.1 + margin * 2);

    const drawPatternLayer = (u: number, v: number, alpha: number, composite: GlobalCompositeOperation) => {
      this.ctx.save();
      this.ctx.globalAlpha = alpha;
      this.ctx.globalCompositeOperation = composite;
      this.ctx.translate(-u, -v);
      this.ctx.fillStyle = pattern;
      this.ctx.fillRect(-w - margin, -h - margin, w * 2 + margin * 2, h * 2 + margin * 2);
      this.ctx.restore();
    };

    drawPatternLayer(ox, oy, 1, 'source-over');
    drawPatternLayer(ox - tw * 0.5, oy - th * 0.5, 0.12, 'overlay');

    fillAnimatedWaveTile(this.waveImageData, t, this.worldX, this.worldY);
    this.waveCtx.putImageData(this.waveImageData, 0, 0);
    const wavePat = this.ctx.createPattern(this.waveCanvas, 'repeat');
    if (wavePat) {
      const wt = WAVE_ANIM_TILE;
      const wox = ((scrollX * 0.92 + t * 22) % wt + wt) % wt;
      const woy = ((scrollY * 0.92 + t * 17) % wt + wt) % wt;
      this.ctx.save();
      this.ctx.globalCompositeOperation = 'soft-light';
      this.ctx.globalAlpha = 1;
      this.ctx.translate(-wox, -woy);
      this.ctx.fillStyle = wavePat;
      this.ctx.fillRect(-w - margin, -h - margin, w * 2 + margin * 2, h * 2 + margin * 2);
      this.ctx.restore();
    }

    this.ctx.restore();
  }

  private render() {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    const cx = w * 0.5;
    const cy = h * 0.5;

    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    this.ctx.fillStyle = '#0d1f2d';
    this.ctx.fillRect(0, 0, w, h);

    const z = this.cameraZoom;

    this.ctx.save();
    this.ctx.translate(cx, cy);
    this.ctx.scale(z, z);
    this.ctx.translate(-cx, -cy);

    this.renderWater(w, h, cx, cy);

    this.drawWakeWorld(cx, cy);

    this.ctx.save();
    this.ctx.translate(cx, cy);
    this.ctx.rotate(this.heading);

    const src: CanvasImageSource =
      this.shipDraw && this.shipDraw.width > 0 ? this.shipDraw : this.shipImg;
    const { dw, dh } = this.shipSpriteScreenExtents();

    this.ctx.imageSmoothingEnabled = true;
    this.ctx.drawImage(src, -dw / 2, -dh / 2, dw, dh);
    this.ctx.restore();

    this.drawMuzzleParticles(cx, cy);
    this.drawCannonBalls(cx, cy);
    this.drawSplashParticles(cx, cy);

    this.ctx.restore();

    const ptr = getPointer();
    this.drawCrosshair(ptr.x, ptr.y, w, h, cx, cy);
  }

  /** Same scale as `drawImage` in `render` (CSS px). */
  private shipSpriteScreenExtents(): { dw: number; dh: number } {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    const maxW = Math.min(w, h) * 0.35;
    let dw = maxW;
    let dh = maxW;
    const src: CanvasImageSource =
      this.shipDraw && this.shipDraw.width > 0 ? this.shipDraw : this.shipImg;
    const iw =
      src instanceof HTMLCanvasElement ? src.width : this.shipImg.naturalWidth;
    const ih =
      src instanceof HTMLCanvasElement ? src.height : this.shipImg.naturalHeight;
    if (iw > 0 && ih > 0) {
      dh = maxW * (ih / iw);
    }
    return { dw, dh };
  }

  /**
   * Aim from pointer vs ship screen center: which battery would fire + unit aim dir (for ball velocity).
   */
  private aimFromCrosshair(cx: number, cy: number): {
    port: boolean;
    mdx: number;
    mdy: number;
  } {
    const { x: mx, y: my } = getPointer();
    let mdx = mx - cx;
    let mdy = my - cy;
    const len = Math.hypot(mdx, mdy);
    if (len < 10) {
      mdx = Math.cos(this.heading);
      mdy = Math.sin(this.heading);
    } else {
      mdx /= len;
      mdy /= len;
    }
    const h = this.heading;
    const port = Math.sin(h) * mdx - Math.cos(h) * mdy >= 0;
    return { port, mdx, mdy };
  }

  /**
   * Port broadside if crosshair lies to port of bow; else starboard.
   * Port outward in world: rotate local (0,-1) by heading → (sin h, -cos h); dot with aim picks side.
   */
  private queueBroadside(tMs: number, cx: number, cy: number) {
    const { dw, dh } = this.shipSpriteScreenExtents();
    if (dw < 4) return;

    const { port: portHemi, mdx, mdy } = this.aimFromCrosshair(cx, cy);
    const h = this.heading;
    const aimAlongBow = Math.cos(h) * mdx + Math.sin(h) * mdy;
    if (Math.abs(aimAlongBow) > CANNON_MAX_AHEAD_AFT_DOT) return;

    if (portHemi) {
      if (tMs - this.lastCannonPortMs < CANNON_SIDE_COOLDOWN_MS) return;
    } else {
      if (tMs - this.lastCannonStarboardMs < CANNON_SIDE_COOLDOWN_MS) return;
    }
    const ly = portHemi ? -GUN_BEAM_FR * (dh * 0.5) : GUN_BEAM_FR * (dh * 0.5);
    const ch = Math.cos(h);
    const sh = Math.sin(h);

    for (let i = 0; i < GUN_ALONG_FR.length; i++) {
      const lx = GUN_ALONG_FR[i] * dw * 0.5;
      const wx = this.worldX + lx * ch - ly * sh;
      const wy = this.worldY + lx * sh + ly * ch;
      const spread = (Math.random() - 0.5) * 0.1;
      const ang = Math.atan2(mdy, mdx) + spread;
      const vx = Math.cos(ang) * CANNON_BALL_SPEED_PX_S;
      const vy = Math.sin(ang) * CANNON_BALL_SPEED_PX_S;
      this.pendingCannon.push({
        delay: i * SALVO_STAGGER_S,
        wx,
        wy,
        vx,
        vy,
      });
    }

    if (portHemi) {
      this.lastCannonPortMs = tMs;
    } else {
      this.lastCannonStarboardMs = tMs;
    }
  }

  private cannonBallMaxRangePx(): number {
    const { dw, dh } = this.shipSpriteScreenExtents();
    const span = Math.max(dw, dh);
    return Math.max(24, CANNON_BALL_RANGE_SHIP_MULT * span);
  }

  private spawnSplash(wx: number, wy: number) {
    const ringLife = 0.52;
    for (let wave = 0; wave < 3; wave++) {
      this.splashParticles.push({
        x: wx,
        y: wy,
        vx: 0,
        vy: 0,
        life: ringLife - wave * 0.09,
        maxLife: ringLife - wave * 0.09,
        kind: 'ripple',
      });
    }
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2 + (Math.random() - 0.5) * 0.35;
      const sp = 95 + Math.random() * 110;
      const dropLife = 0.32 + Math.random() * 0.18;
      this.splashParticles.push({
        x: wx + (Math.random() - 0.5) * 6,
        y: wy + (Math.random() - 0.5) * 6,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: dropLife,
        maxLife: dropLife,
        kind: 'droplet',
      });
    }
  }

  private updateCannon(dt: number) {
    for (let i = this.splashParticles.length - 1; i >= 0; i--) {
      const s = this.splashParticles[i];
      s.life -= dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      const damp = Math.pow(0.86, dt * 60);
      s.vx *= damp;
      s.vy *= damp;
      if (s.life <= 0) {
        this.splashParticles.splice(i, 1);
      }
    }
    for (let i = this.muzzleParticles.length - 1; i >= 0; i--) {
      const q = this.muzzleParticles[i];
      q.life -= dt;
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      const drag = Math.pow(0.9, dt * 60);
      q.vx *= drag;
      q.vy *= drag;
      if (q.life <= 0) {
        this.muzzleParticles.splice(i, 1);
      }
    }
    for (let i = this.pendingCannon.length - 1; i >= 0; i--) {
      const p = this.pendingCannon[i];
      p.delay -= dt;
      if (p.delay <= 0) {
        this.spawnMuzzleBurst(p.wx, p.wy, p.vx, p.vy);
        const maxR = this.cannonBallMaxRangePx();
        this.cannonBalls.push({
          x: p.wx,
          y: p.wy,
          vx: p.vx,
          vy: p.vy,
          spawnX: p.wx,
          spawnY: p.wy,
          maxRangeSq: maxR * maxR,
        });
        this.pendingCannon.splice(i, 1);
      }
    }
    for (let i = this.cannonBalls.length - 1; i >= 0; i--) {
      const b = this.cannonBalls[i];
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      const dx = b.x - b.spawnX;
      const dy = b.y - b.spawnY;
      if (dx * dx + dy * dy >= b.maxRangeSq) {
        this.spawnSplash(b.x, b.y);
        this.cannonBalls.splice(i, 1);
      }
    }
  }

  private drawMuzzleParticles(cx: number, cy: number) {
    this.ctx.save();
    for (const pass of ['smoke', 'fire'] as const) {
      for (const p of this.muzzleParticles) {
        if (p.kind !== pass) continue;
        const u = p.maxLife > 0 ? p.life / p.maxLife : 0;
        if (u <= 0) continue;
        const sx = cx + (p.x - this.worldX);
        const sy = cy + (p.y - this.worldY);
        const grow = 1 - u;
        if (p.kind === 'smoke') {
          const rad = p.baseR + grow * 88;
          const alpha = u * u * 0.62;
          this.ctx.globalCompositeOperation = 'screen';
          this.ctx.globalAlpha = 1;
          this.ctx.save();
          this.ctx.translate(sx, sy);
          this.ctx.rotate(p.spin + grow * 0.8);
          this.ctx.scale(1, 0.68 + grow * 0.22);
          const g = this.ctx.createRadialGradient(0, 0, 0, 0, 0, rad);
          g.addColorStop(0, `rgba(255, 255, 255, ${alpha * 0.45})`);
          g.addColorStop(0.25, `rgba(210, 215, 225, ${alpha * 0.5})`);
          g.addColorStop(0.55, `rgba(140, 145, 158, ${alpha * 0.35})`);
          g.addColorStop(1, 'rgba(80, 82, 90, 0)');
          this.ctx.beginPath();
          this.ctx.arc(0, 0, rad, 0, Math.PI * 2);
          this.ctx.fillStyle = g;
          this.ctx.fill();
          this.ctx.restore();
        } else {
          const rad = p.baseR + grow * 36;
          const alpha = Math.min(1, u * 1.35);
          this.ctx.globalCompositeOperation = 'lighter';
          this.ctx.globalAlpha = 1;
          const g = this.ctx.createRadialGradient(
            sx - rad * 0.2,
            sy - rad * 0.2,
            0,
            sx,
            sy,
            rad
          );
          g.addColorStop(0, `rgba(255, 255, 245, ${alpha})`);
          g.addColorStop(0.2, `rgba(255, 220, 90, ${alpha * 0.95})`);
          g.addColorStop(0.45, `rgba(255, 120, 35, ${alpha * 0.65})`);
          g.addColorStop(0.75, `rgba(200, 40, 12, ${alpha * 0.25})`);
          g.addColorStop(1, 'rgba(40, 10, 0, 0)');
          this.ctx.beginPath();
          this.ctx.arc(sx, sy, rad, 0, Math.PI * 2);
          this.ctx.fillStyle = g;
          this.ctx.fill();
        }
      }
    }
    this.ctx.globalCompositeOperation = 'source-over';
    this.ctx.globalAlpha = 1;
    this.ctx.restore();
  }

  private drawCannonBalls(cx: number, cy: number) {
    const r = CANNON_BALL_R;
    this.ctx.save();
    this.ctx.globalCompositeOperation = 'source-over';
    for (const b of this.cannonBalls) {
      const sx = cx + (b.x - this.worldX);
      const sy = cy + (b.y - this.worldY);
      const grd = this.ctx.createRadialGradient(
        sx - r * 0.35,
        sy - r * 0.35,
        0,
        sx,
        sy,
        r * 1.15
      );
      grd.addColorStop(0, 'rgba(90, 88, 86, 0.95)');
      grd.addColorStop(0.45, 'rgba(28, 26, 24, 1)');
      grd.addColorStop(1, 'rgba(12, 10, 9, 1)');
      this.ctx.beginPath();
      this.ctx.arc(sx, sy, r, 0, Math.PI * 2);
      this.ctx.fillStyle = grd;
      this.ctx.fill();
      this.ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      this.ctx.lineWidth = 1;
      this.ctx.stroke();
    }
    this.ctx.restore();
  }

  private drawSplashParticles(cx: number, cy: number) {
    this.ctx.save();
    for (const s of this.splashParticles) {
      const uRaw = s.maxLife > 0 ? s.life / s.maxLife : 0;
      const u = Math.min(1, Math.max(0, uRaw));
      if (u <= 0) continue;
      const sx = cx + (s.x - this.worldX);
      const sy = cy + (s.y - this.worldY);
      const grow = 1 - u;

      if (s.kind === 'ripple') {
        const rad = Math.max(0.5, 6 + grow * 52);
        const alpha = u * u * 0.75;
        this.ctx.globalCompositeOperation = 'screen';
        this.ctx.strokeStyle = `rgba(200, 235, 255, ${alpha})`;
        this.ctx.lineWidth = 2.2 + grow * 1.5;
        this.ctx.beginPath();
        this.ctx.arc(sx, sy, rad, 0, Math.PI * 2);
        this.ctx.stroke();
        this.ctx.strokeStyle = `rgba(255, 255, 255, ${alpha * 0.55})`;
        this.ctx.lineWidth = 1;
        this.ctx.beginPath();
        this.ctx.arc(sx, sy, Math.max(0.5, rad * 0.92), 0, Math.PI * 2);
        this.ctx.stroke();
      } else {
        const radCore = Math.max(0.25, (1.8 + grow * 4) * u);
        const radOuter = Math.max(0.5, radCore * 2.2);
        const alpha = u * 0.9;
        this.ctx.globalCompositeOperation = 'lighter';
        const g = this.ctx.createRadialGradient(sx, sy, 0, sx, sy, radOuter);
        g.addColorStop(0, `rgba(255, 255, 255, ${alpha})`);
        g.addColorStop(0.35, `rgba(180, 220, 255, ${alpha * 0.65})`);
        g.addColorStop(1, 'rgba(60, 120, 180, 0)');
        this.ctx.beginPath();
        this.ctx.arc(sx, sy, radOuter, 0, Math.PI * 2);
        this.ctx.fillStyle = g;
        this.ctx.fill();
      }
    }
    this.ctx.globalCompositeOperation = 'source-over';
    this.ctx.globalAlpha = 1;
    this.ctx.restore();
  }

  private drawCrosshair(
    mx: number,
    my: number,
    w: number,
    h: number,
    shipCx: number,
    shipCy: number
  ) {
    mx = Math.max(0, Math.min(w, mx));
    my = Math.max(0, Math.min(h, my));
    const arm = 20;
    const gap = 5;
    const ringR = 28;
    const cooldownR = ringR - 5;
    const arcW = 5;
    const aim = this.aimFromCrosshair(shipCx, shipCy);
    const aimAlongBow =
      Math.cos(this.heading) * aim.mdx + Math.sin(this.heading) * aim.mdy;
    const aimValid = Math.abs(aimAlongBow) <= CANNON_MAX_AHEAD_AFT_DOT;
    const lastMs = aim.port ? this.lastCannonPortMs : this.lastCannonStarboardMs;
    const elapsed = this.animTimeMs - lastMs;
    const ready = elapsed >= CANNON_SIDE_COOLDOWN_MS;
    const progress = Math.min(1, Math.max(0, elapsed / CANNON_SIDE_COOLDOWN_MS));

    this.ctx.save();
    this.ctx.globalCompositeOperation = 'source-over';

    if (ready && aimValid) {
      this.ctx.beginPath();
      this.ctx.arc(mx, my, ringR - 1.5, 0, Math.PI * 2);
      this.ctx.fillStyle = 'rgba(38, 190, 85, 0.92)';
      this.ctx.fill();
    } else if (ready && !aimValid) {
      this.ctx.strokeStyle = 'rgba(200, 140, 45, 0.95)';
      this.ctx.lineWidth = 4;
      this.ctx.setLineDash([5, 4]);
      this.ctx.beginPath();
      this.ctx.arc(mx, my, ringR - 2, 0, Math.PI * 2);
      this.ctx.stroke();
      this.ctx.setLineDash([]);
    } else {
      this.ctx.strokeStyle = 'rgba(70, 22, 22, 0.6)';
      this.ctx.lineWidth = arcW;
      this.ctx.lineCap = 'round';
      this.ctx.beginPath();
      this.ctx.arc(mx, my, cooldownR, 0, Math.PI * 2);
      this.ctx.stroke();

      this.ctx.strokeStyle = 'rgba(235, 65, 55, 0.98)';
      this.ctx.lineWidth = arcW;
      this.ctx.beginPath();
      const a0 = -Math.PI / 2;
      const a1 = a0 + Math.PI * 2 * progress;
      this.ctx.arc(mx, my, cooldownR, a0, a1, false);
      this.ctx.stroke();
    }

    const drawRing = (lineW: number, stroke: string) => {
      this.ctx.strokeStyle = stroke;
      this.ctx.lineWidth = lineW;
      this.ctx.beginPath();
      this.ctx.arc(mx, my, ringR, 0, Math.PI * 2);
      this.ctx.stroke();
    };
    drawRing(3, 'rgba(0,0,0,0.5)');
    drawRing(1.25, 'rgba(255, 248, 220, 0.92)');
    const drawHair = (lineW: number, stroke: string) => {
      this.ctx.strokeStyle = stroke;
      this.ctx.lineWidth = lineW;
      this.ctx.lineCap = 'square';
      this.ctx.beginPath();
      this.ctx.moveTo(Math.max(0, mx - arm - gap), my);
      this.ctx.lineTo(Math.max(0, mx - gap), my);
      this.ctx.moveTo(Math.min(w, mx + gap), my);
      this.ctx.lineTo(Math.min(w, mx + arm + gap), my);
      this.ctx.moveTo(mx, Math.max(0, my - arm - gap));
      this.ctx.lineTo(mx, Math.max(0, my - gap));
      this.ctx.moveTo(mx, Math.min(h, my + gap));
      this.ctx.lineTo(mx, Math.min(h, my + arm + gap));
      this.ctx.stroke();
    };
    drawHair(3, 'rgba(0,0,0,0.5)');
    drawHair(1.25, 'rgba(255, 248, 220, 0.95)');

    if (!aimValid) {
      const xh = 11;
      this.ctx.lineCap = 'round';
      this.ctx.lineJoin = 'round';
      const drawNoFireX = (lineW: number, stroke: string) => {
        this.ctx.strokeStyle = stroke;
        this.ctx.lineWidth = lineW;
        this.ctx.beginPath();
        this.ctx.moveTo(mx - xh, my - xh);
        this.ctx.lineTo(mx + xh, my + xh);
        this.ctx.moveTo(mx + xh, my - xh);
        this.ctx.lineTo(mx - xh, my + xh);
        this.ctx.stroke();
      };
      drawNoFireX(4, 'rgba(0, 0, 0, 0.62)');
      drawNoFireX(2, 'rgba(255, 55, 55, 0.98)');
    }

    this.ctx.restore();
  }

  private recordWakeTrail() {
    const denom = MAX_MPH - WAKE_START_MPH;
    const wakeT = Math.max(0, Math.min(1, denom > 0 ? (this.speedMph - WAKE_START_MPH) / denom : 0));

    if (wakeT <= 0) {
      if (this.wakeTrail.length > 0) {
        const drop = Math.min(this.wakeTrail.length, Math.ceil(this.wakeTrail.length * 0.18) + 3);
        this.wakeTrail.splice(0, drop);
      }
      return;
    }

    const sx = this.worldX;
    const sy = this.worldY;

    const last = this.wakeTrail[this.wakeTrail.length - 1];
    if (last) {
      const gap = Math.hypot(sx - last.x, sy - last.y);
      const minGap = 0.35 + (1 - wakeT) * 1.2;
      if (gap < minGap) return;
    }

    this.wakeTrail.push({ x: sx, y: sy });
    const maxLen = Math.floor(110 + wakeT * 620);
    while (this.wakeTrail.length > maxLen) {
      this.wakeTrail.shift();
    }
  }

  /**
   * Motorboat-style wake: wide V with scalloped outer foam, inner wash, bright prop spine.
   * Trail stays in world space (oldest index 0 → newest at ship center).
   */
  private drawWakeWorld(cx: number, cy: number) {
    const pts = this.wakeTrail;
    const n = pts.length;
    if (n < 2) return;

    const denom = MAX_MPH - WAKE_START_MPH;
    const wakeT = Math.max(0, Math.min(1, denom > 0 ? (this.speedMph - WAKE_START_MPH) / denom : 0));
    const baseHalfW = 6 + wakeT * 56;
    const baseA = wakeT > 0 ? 0.12 + wakeT * 0.22 : 0.045;
    const tAnim = this.waterTime;

    const screen = pts.map((p) => ({
      x: cx + (p.x - this.worldX),
      y: cy + (p.y - this.worldY),
    }));

    const left: { x: number; y: number }[] = new Array(n);
    const right: { x: number; y: number }[] = new Array(n);

    for (let i = 0; i < n; i++) {
      const tx = screen[Math.min(i + 1, n - 1)].x - screen[Math.max(i - 1, 0)].x;
      const ty = screen[Math.min(i + 1, n - 1)].y - screen[Math.max(i - 1, 0)].y;
      const len = Math.hypot(tx, ty) || 1;
      const ux = tx / len;
      const uy = ty / len;
      const px = -uy;
      const py = ux;

      const along = n > 1 ? i / (n - 1) : 1;
      let halfW =
        baseHalfW * (0.24 + 0.88 * Math.pow(along, 1.06));

      const farBlend = along < 0.22 ? Math.pow(along / 0.22, 0.5) : 1;
      halfW *= 0.5 + 0.5 * farBlend;

      const scallop = 4 + wakeT * 15 + along * (6 + wakeT * 10);
      const jL =
        Math.sin(i * 0.4 + tAnim * 4.3) * scallop +
        Math.sin(i * 1.62 + tAnim * 1.2 + 1.6) * (scallop * 0.48) +
        Math.sin(i * 5.2 + 2.3) * (2.5 + wakeT * 4);
      const jR =
        Math.sin(i * 0.43 + tAnim * 3.95 + 2.7) * scallop +
        Math.sin(i * 1.68 + tAnim * 1.08 + 0.35) * (scallop * 0.44) +
        Math.sin(i * 5.9 + 5.1) * (2.5 + wakeT * 4);

      const patchy =
        along < 0.14
          ? 0.32 + 0.68 * Math.pow(Math.sin(i * 7.07 + 3.1) * 0.5 + 0.5, 2.1)
          : 1;
      halfW *= patchy;

      left[i] = {
        x: screen[i].x + px * (halfW + jL),
        y: screen[i].y + py * (halfW + jL),
      };
      right[i] = {
        x: screen[i].x - px * (halfW + jR),
        y: screen[i].y - py * (halfW + jR),
      };
    }

    const innerL = screen.map((c, i) => {
      const along = n > 1 ? i / (n - 1) : 1;
      const inset = 0.38 + 0.1 * (1 - along);
      return {
        x: c.x + (left[i].x - c.x) * inset,
        y: c.y + (left[i].y - c.y) * inset,
      };
    });
    const innerR = screen.map((c, i) => {
      const along = n > 1 ? i / (n - 1) : 1;
      const inset = 0.38 + 0.1 * (1 - along);
      return {
        x: c.x + (right[i].x - c.x) * inset,
        y: c.y + (right[i].y - c.y) * inset,
      };
    });

    const fillHull = (
      L: { x: number; y: number }[],
      R: { x: number; y: number }[],
      rgba: string,
      comp: GlobalCompositeOperation
    ) => {
      this.ctx.globalCompositeOperation = comp;
      this.ctx.globalAlpha = 1;
      this.ctx.beginPath();
      this.ctx.moveTo(L[0].x, L[0].y);
      for (let i = 1; i < n; i++) this.ctx.lineTo(L[i].x, L[i].y);
      for (let i = n - 1; i >= 0; i--) this.ctx.lineTo(R[i].x, R[i].y);
      this.ctx.closePath();
      this.ctx.fillStyle = rgba;
      this.ctx.fill();
    };

    this.ctx.save();
    this.ctx.imageSmoothingEnabled = true;
    this.ctx.imageSmoothingQuality = 'high';

    fillHull(
      left,
      right,
      `rgba(185, 228, 255, ${baseA * 0.75})`,
      'soft-light'
    );
    fillHull(
      innerL,
      innerR,
      `rgba(240, 248, 255, ${baseA * (0.55 + wakeT * 0.12)})`,
      'screen'
    );

    this.ctx.globalCompositeOperation = 'soft-light';
    this.ctx.globalAlpha = 1;
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
    this.ctx.lineWidth = 1.05 + wakeT * 1.8;
    this.ctx.strokeStyle = `rgba(255, 255, 255, ${0.16 + wakeT * 0.2})`;
    this.ctx.beginPath();
    this.ctx.moveTo(left[0].x, left[0].y);
    for (let i = 1; i < n; i++) this.ctx.lineTo(left[i].x, left[i].y);
    this.ctx.stroke();
    this.ctx.beginPath();
    this.ctx.moveTo(right[0].x, right[0].y);
    for (let i = 1; i < n; i++) this.ctx.lineTo(right[i].x, right[i].y);
    this.ctx.stroke();

    this.ctx.globalCompositeOperation = 'source-over';
    this.ctx.restore();
  }
}
