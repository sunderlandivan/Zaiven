import { Game } from './game.js';

const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const game = new Game(canvas);

function onResize() {
  game.resize(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', onResize);
onResize();

game.onHudUpdate((mph, windDirectionRad) => {
  const el = document.getElementById('speed-text');
  if (el) el.textContent = `${mph.toFixed(1)} mph`;
  const deg = (windDirectionRad * 180) / Math.PI;
  const arrow = document.getElementById('wind-arrow');
  if (arrow) arrow.setAttribute('transform', `rotate(${deg})`);
});

function loop(t: number) {
  game.update(t);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
