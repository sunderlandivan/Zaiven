const keys: Record<string, boolean> = {};

let pointerX = 0;
let pointerY = 0;
let cannonFirePending = false;

export function initInput() {
  window.addEventListener('keydown', (e) => {
    keys[e.code] = true;
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => {
    keys[e.code] = false;
  });
}

/** Aim + left-click broadside; coordinates match canvas CSS pixels (same space as draw). */
export function initPointer(
  canvas: HTMLCanvasElement,
  onWheel?: (deltaY: number) => void
) {
  const sync = (clientX: number, clientY: number) => {
    const r = canvas.getBoundingClientRect();
    pointerX = clientX - r.left;
    pointerY = clientY - r.top;
  };
  canvas.addEventListener('mousemove', (e) => sync(e.clientX, e.clientY));
  canvas.addEventListener('mouseenter', (e) => sync(e.clientX, e.clientY));
  canvas.addEventListener('mousedown', (e) => {
    if (e.button === 0) {
      e.preventDefault();
      cannonFirePending = true;
    }
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  if (onWheel) {
    canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        onWheel(e.deltaY);
      },
      { passive: false }
    );
  }
}

export function getPointer(): { x: number; y: number } {
  return { x: pointerX, y: pointerY };
}

/** One-shot per left click (for spawning a volley). */
export function consumeCannonFire(): boolean {
  if (!cannonFirePending) return false;
  cannonFirePending = false;
  return true;
}

export function isKeyDown(code: string): boolean {
  return !!keys[code];
}

/** W increases throttle, S decreases; A/D only steer (handled separately). */
export function getThrottleInput(): number {
  let delta = 0;
  if (keys['KeyW']) delta += 1;
  if (keys['KeyS']) delta -= 1;
  return delta;
}

export function getSteerInput(): number {
  let steer = 0;
  if (keys['KeyD']) steer += 1;
  if (keys['KeyA']) steer -= 1;
  return steer;
}
