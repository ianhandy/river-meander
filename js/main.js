// Main — boot sequence, initSim, main loop

import state from './state.js';
import { UI_H, MOUNTAIN_THRESHOLD, MAX_SOURCES, YEARS_PER_STEP,
         FRAME_MS, TECTONIC_INTERVAL, RAINFALL_MAX } from './constants.js';
import { generateTerrain } from './terrain.js';
import { computeOceanCells, computeDrainDistance, computeHydraulicHead } from './ocean.js';
import { getHardness } from './helpers.js';
import { stepHydraulic } from './hydraulics.js';
import { stepErosion, detectOxbows } from './erosion.js';
import { stepTectonics } from './tectonics.js';
import { render } from './render2d.js';
import { render3D } from './render3d.js';
import { initUI } from './ui.js';
import { initModal, setInitSim } from './modal.js';
import { initTools } from './tools.js';

const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');
const c3d = document.getElementById('c3d');

// ── initSim ──

function initSim(startWithWater) {
  const s = state;
  s.GW = s.genMapSize;
  s.GH = s.genMapSize;
  const GW = s.GW, GH = s.GH;
  const N = GW * GH;

  s.terrain = generateTerrain(s.currentSeed, s.genOctaves, s.genValley, s.genRoughness,
                               s.genTerrainType, s.genSeaLevel, s.genMtnHeight, s.genForceOcean);
  s.origTerrain = s.terrain.slice();
  computeOceanCells();
  computeDrainDistance();
  s.water       = new Float32Array(N);
  s.sediment    = new Float32Array(N);
  s.hardness    = new Float32Array(N);
  s.fluxL = new Float32Array(N);
  s.fluxR = new Float32Array(N);
  s.fluxU = new Float32Array(N);
  s.fluxD = new Float32Array(N);
  s.saturation = new Float32Array(N);
  s.flowSpeed = new Float32Array(N);
  s.hydraulicHead = new Float32Array(N);
  s.trappedPressure = new Float32Array(N);

  for (let i = 0; i < N; i++) s.hardness[i] = getHardness(i);

  s.camX = 0; s.camY = 0; s.camZoom = 1.0;
  s.seaLevel = s.genSeaLevel;
  s.rainfallRate = startWithWater !== false ? (s.genRainfall / 100) * RAINFALL_MAX : 0;

  s.hasOcean = false;
  for (let i = 0; i < N; i++) { if (s.isOceanCell[i]) { s.hasOcean = true; break; } }

  s.sources = [];
  if (startWithWater !== false) {
    // Pre-fill ocean
    for (let i = 0; i < N; i++) {
      if (s.isOceanCell[i]) {
        s.water[i] = Math.max(0, s.seaLevel - s.terrain[i]);
      }
    }

    // Seed water from flow accumulation
    if (s.initialFlowAccum) {
      const sorted = Array.from(s.initialFlowAccum).filter(v => v > 0).sort((a, b) => b - a);
      const threshold = sorted[Math.floor(sorted.length * 0.05)] || 1;
      for (let i = 0; i < N; i++) {
        if (s.terrain[i] >= s.seaLevel && s.initialFlowAccum[i] > threshold) {
          const amount = Math.min(0.01, (s.initialFlowAccum[i] / sorted[0]) * 0.01);
          s.water[i] = amount;
        }
      }
    }

    // Place persistent sources at high-accumulation mountain points
    if (s.initialFlowAccum) {
      let bestAccum = [];
      for (let y = 3; y < GH - 3; y++) {
        for (let x = 3; x < GW - 3; x++) {
          const i = y * GW + x;
          if (s.isOceanCell[i] || s.terrain[i] < MOUNTAIN_THRESHOLD * 0.8) continue;
          if (s.initialFlowAccum[i] > 0.5) {
            bestAccum.push({ x, y, accum: s.initialFlowAccum[i] });
          }
        }
      }
      bestAccum.sort((a, b) => b.accum - a.accum);
      for (let si = 0; si < Math.min(bestAccum.length, MAX_SOURCES); si++) {
        s.sources.push({ gx: bestAccum[si].x, gy: bestAccum[si].y, rate: s.SIM_SPRING_RATE });
      }
    }

    // Fallback source
    if (s.sources.length === 0) {
      let minH = Infinity, srcY = Math.floor(GH / 2);
      for (let y = GH * 0.2 | 0; y < GH * 0.8 | 0; y++) {
        const h = s.terrain[y * GW];
        if (h < minH && !(s.terrain[y * GW] < s.seaLevel)) { minH = h; srcY = y; }
      }
      s.sources = [{ gx: 0, gy: srcY, rate: s.SIM_SPRING_RATE }];
    }
  }

  s.year = 0;
  s.oxbows = [];
  s.prevChannelCells = null;
  document.getElementById('yr').textContent = '0';
  document.getElementById('seed-display').textContent = s.currentSeed;
  document.getElementById('max-depth').textContent = '0.0';
  const yr2 = document.getElementById('yr2');
  const sd2 = document.getElementById('seed-display2');
  if (yr2) yr2.textContent = '0';
  if (sd2) sd2.textContent = s.currentSeed;

  // Reset 3D — force back to 2D terrain view
  s.glInited = false;
  if (s.viewMode === '3d') {
    s.viewMode = 'terrain';
    document.getElementById('c').classList.remove('hidden-2d');
    document.getElementById('c3d').classList.remove('active-3d');
    document.getElementById('btn-view-terrain').classList.add('active');
    document.getElementById('btn-view-3d').classList.remove('active');
  }
}

// Inject initSim into modal to avoid circular import
setInitSim(initSim);

// ── Main loop ──
// Sim and render are decoupled: sim runs first, render only if time remains.
// This lets the browser breathe between frames.

let _prevTs = 0;
let _renderSkips = 0;

function loop(ts) {
  requestAnimationFrame(loop);
  if (!state.running || !state.terrain) return;

  // Measure actual frame time
  const elapsed = ts - _prevTs;
  if (elapsed < FRAME_MS) return; // rate limit
  _prevTs = ts;

  // FPS-aware step count
  const actualFPS = elapsed > 0 ? 1000 / elapsed : 30;
  let steps = state.realtimeMode ? 1 : Math.max(1, Math.round(state.speedUI / 10));
  if (actualFPS < 10 && steps > 1) steps = 1;

  // Sim step(s)
  const simStart = performance.now();
  let maxDepth = 0;
  for (let s = 0; s < steps; s++) {
    state.stepsSinceTectonics++;
    if (state.stepsSinceTectonics >= TECTONIC_INTERVAL) {
      stepTectonics();
      state.stepsSinceTectonics = 0;
    }
    maxDepth = stepHydraulic();
    stepErosion();
    state.year += YEARS_PER_STEP;
    state.stepsSinceOxbowCheck++;
  }
  const simMs = performance.now() - simStart;

  if (state.stepsSinceOxbowCheck > 50) {
    detectOxbows();
    state.stepsSinceOxbowCheck = 0;
  }

  if (state.stepsSinceOxbowCheck % 10 === 0) computeHydraulicHead();

  // Update stats — show elapsed time instead of years
  const totalSec = Math.floor(state.year / YEARS_PER_STEP / 30); // approx real seconds at 30fps
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  const timeStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
  const yrStr = Math.round(state.year).toLocaleString();
  document.getElementById('yr').textContent = `${yrStr}yr (${timeStr})`;
  document.getElementById('max-depth').textContent = (maxDepth * 100).toFixed(1);
  const yr2el = document.getElementById('yr2');
  if (yr2el) yr2el.textContent = `${yrStr}yr`;

  // Render only if sim didn't eat the whole frame budget.
  // Skip render every other frame if sim is taking >50% of budget.
  const budget = FRAME_MS;
  if (simMs > budget * 0.7) {
    _renderSkips++;
    if (_renderSkips % 2 === 0) return; // skip every other render when slow
  } else {
    _renderSkips = 0;
  }

  if (state.viewMode === '3d') {
    render3D(c3d);
  } else {
    render(canvas, ctx, maxDepth);
  }
}

// ── Resize ──

function resize() {
  const screenSize = Math.min(window.innerWidth, window.innerHeight - UI_H);
  // Cap internal resolution for performance — CSS scales to screen size
  const maxRes = Math.min(screenSize, 1200);
  canvas.style.width = screenSize + 'px';
  canvas.style.height = screenSize + 'px';
  canvas.width = maxRes;
  canvas.height = maxRes;
  c3d.style.width = screenSize + 'px';
  c3d.style.height = screenSize + 'px';
  c3d.width = Math.min(screenSize, 800);
  c3d.height = Math.min(screenSize, 800);

  if (!state.terrain) {
    state.currentSeed = Math.floor(Math.random() * 99999);
    initSim(true);
    return;
  }
  if (state.glInited && state.gl) {
    state.gl.viewport(0, 0, c3d.width, c3d.height);
  }
}

// ── Boot ──

initUI(c3d);
initModal();
initTools(canvas);
window.addEventListener('resize', resize);
resize();
requestAnimationFrame(loop);

// Fade hint after 4 seconds
setTimeout(() => {
  const h = document.getElementById('hint');
  if (h) h.classList.add('faded');
}, 4000);
