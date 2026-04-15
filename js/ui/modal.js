// Generation modal — terrain type selection, presets, generation params

import state from '../data/state.js';
import { RAINFALL_MAX, MOUNTAIN_THRESHOLD } from '../data/constants.js';

let _initSim = null;
export function setInitSim(fn) { _initSim = fn; }

export function showGenModal() {
  state.running = false;
  document.getElementById('btn-play').textContent = '\u25B6 Play';
  document.getElementById('btn-play').classList.remove('active');
  document.getElementById('gen-seed').value = Math.floor(Math.random() * 99999);
  document.getElementById('gen-mapsize').value = state.genMapKm;
  document.getElementById('gen-density').value = state.genCellsPerKm;
  document.getElementById('gen-octaves').value = state.genOctaves;
  document.getElementById('gen-valley').value = Math.round(state.genValley * 100);
  document.getElementById('gen-roughness').value = Math.round(state.genRoughness * 100);
  document.getElementById('gen-mtn-height').value = Math.round(state.genMtnHeight * 100);
  document.getElementById('gen-sea-level').value = Math.round(state.genSeaLevel * 100);
  document.getElementById('gen-rainfall').value = state.genRainfall;
  document.getElementById('gen-plates').value = state.genNumPlates;
  document.getElementById('gen-erosion-passes').value = state.genErosionPasses;
  document.querySelectorAll('.gen-type-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.type === state.genTerrainType);
  });
  updateGenLabels();
  document.getElementById('gen-overlay').classList.remove('hidden');
}

export function hideGenModal() {
  document.getElementById('gen-overlay').classList.add('hidden');
}

function updateGenLabels() {
  const km = parseInt(document.getElementById('gen-mapsize').value) || 5;
  const density = parseInt(document.getElementById('gen-density').value) || 100;
  const cells = km * density;
  document.getElementById('gen-mapsize-val').textContent = `${km} km (${cells}\u00D7${cells})`;
  document.getElementById('gen-density-val').textContent = `${density} /km`;
  document.getElementById('gen-octaves-val').textContent = document.getElementById('gen-octaves').value;
  document.getElementById('gen-valley-val').textContent = document.getElementById('gen-valley').value;
  document.getElementById('gen-roughness-val').textContent = document.getElementById('gen-roughness').value;
  document.getElementById('gen-mtn-height-val').textContent = document.getElementById('gen-mtn-height').value;
  document.getElementById('gen-sea-level-val').textContent = document.getElementById('gen-sea-level').value;
  document.getElementById('gen-rainfall-val').textContent = document.getElementById('gen-rainfall').value;
  const pv = parseInt(document.getElementById('gen-plates').value);
  document.getElementById('gen-plates-val').textContent = pv === 0 ? 'auto' : pv;
  document.getElementById('gen-erosion-passes-val').textContent = document.getElementById('gen-erosion-passes').value;
}

function generateFromModal() {
  state.currentSeed    = parseInt(document.getElementById('gen-seed').value) || 0;
  state.genMapKm       = parseInt(document.getElementById('gen-mapsize').value) || 5;
  state.genCellsPerKm  = parseInt(document.getElementById('gen-density').value) || 100;
  state.genMapSize     = state.genMapKm * state.genCellsPerKm;
  state.genOctaves     = parseInt(document.getElementById('gen-octaves').value);
  state.genValley      = parseInt(document.getElementById('gen-valley').value) / 100;
  state.genRoughness   = parseInt(document.getElementById('gen-roughness').value) / 100;
  state.genMtnHeight   = parseInt(document.getElementById('gen-mtn-height').value) / 100;
  state.genSeaLevel    = parseInt(document.getElementById('gen-sea-level').value) / 100;
  state.genRainfall    = parseInt(document.getElementById('gen-rainfall').value);
  state.genTerrainType = document.querySelector('.gen-type-btn.active').dataset.type;
  state.genNumPlates   = parseInt(document.getElementById('gen-plates').value) || 0;
  state.genErosionPasses = parseFloat(document.getElementById('gen-erosion-passes').value);
  state.genForceOcean  = document.getElementById('gen-force-ocean').checked;
  const startWater = document.getElementById('gen-water').checked;
  hideGenModal();
  if (_initSim) _initSim(startWater);
  state.running = true;
  document.getElementById('btn-play').textContent = '\u23F8 Pause';
  document.getElementById('btn-play').classList.add('active');
}

export function applyRiverPreset() {
  state.currentSeed    = Math.floor(Math.random() * 99999);
  state.genMapKm       = 25;
  state.genMapSize     = 25 * state.genCellsPerKm;
  state.genOctaves     = 4;
  state.genValley      = 0.6;
  state.genRoughness   = 0.3;
  state.genMtnHeight   = 0.25;
  state.genSeaLevel    = 0.18;
  state.genTerrainType = 'floodplain';
  state.genNumPlates   = 2;
  state.genErosionPasses = 2;
  state.genForceOcean  = true;
  state.genRainfall    = 30;
  state.tectonicSpeed = 0;
  const tEl = document.getElementById('dev-tectonicSpeed');
  if (tEl) { tEl.value = 0; const v = document.getElementById('dev-tectonicSpeed-val'); if (v) v.textContent = '0.00'; }
  hideGenModal();
  if (_initSim) _initSim(true);
  const { GW, GH, terrain, isOceanCell, saturation, water } = state;
  state.sources = [];
  let bestY = Math.floor(GH / 2), minH = Infinity;
  for (let y = Math.floor(GH * 0.3); y < Math.floor(GH * 0.7); y++) {
    const h = terrain[y * GW + (GW - 5)];
    if (h < minH) { minH = h; bestY = y; }
  }
  state.sources.push({ gx: GW - 5, gy: bestY, rate: state.springRate * 10 });
  for (let y = Math.floor(GH * 0.15); y < Math.floor(GH * 0.85); y++) {
    for (let x = 0; x < GW; x++) {
      const i = y * GW + x;
      if (!isOceanCell[i]) saturation[i] = 1.0;
    }
  }
  for (let x = 0; x < GW; x++) {
    let lowH = Infinity, lowY = Math.floor(GH / 2);
    for (let y = Math.floor(GH * 0.2); y < Math.floor(GH * 0.8); y++) {
      const i = y * GW + x;
      if (terrain[i] < lowH && !isOceanCell[i]) { lowH = terrain[i]; lowY = y; }
    }
    for (let dy = -1; dy <= 1; dy++) {
      const wy = lowY + dy;
      if (wy < 0 || wy >= GH) continue;
      const ci = wy * GW + x;
      if (!isOceanCell[ci]) {
        const falloff = 1 - Math.abs(dy) * 0.4;
        water[ci] = Math.max(water[ci], 0.012 * falloff);
      }
    }
  }
  state.running = true;
  document.getElementById('btn-play').textContent = '\u23F8 Pause';
  document.getElementById('btn-play').classList.add('active');
}

export function applyTestPreset() {
  state.currentSeed    = 42;
  state.genMapKm       = 1;
  state.genMapSize     = 25;
  state.genOctaves     = 2;
  state.genValley      = 0;
  state.genRoughness   = 0.1;
  state.genMtnHeight   = 0;
  state.genSeaLevel    = 0.15;
  state.genTerrainType = 'test';
  state.genNumPlates   = 0;
  state.genErosionPasses = 0;
  state.genForceOcean  = false;
  state.genRainfall    = 0;
  state.tectonicSpeed = 0;
  const tEl = document.getElementById('dev-tectonicSpeed');
  if (tEl) { tEl.value = 0; const v = document.getElementById('dev-tectonicSpeed-val'); if (v) v.textContent = '0.00'; }
  hideGenModal();
  if (_initSim) _initSim(true);
  const { GW, GH, terrain, water, saturation, isOceanCell } = state;
  state.sources = [];
  const srcX = Math.floor(GW / 2);
  state.sources.push({ gx: srcX, gy: 1, rate: 0.01 });
  for (let y = 0; y < Math.floor(GH * 0.28); y++) {
    for (let x = 0; x < GW; x++) {
      const i = y * GW + x;
      if (terrain[i] < 0.5 && !isOceanCell[i]) {
        water[i] = 0.008;
        saturation[i] = 1.0;
      }
    }
  }
  state.running = true;
  document.getElementById('btn-play').textContent = '\u23F8 Pause';
  document.getElementById('btn-play').classList.add('active');
}

export function initModal() {
  document.getElementById('btn-new').addEventListener('click', showGenModal);
  const btnNew2 = document.getElementById('btn-new2');
  if (btnNew2) btnNew2.addEventListener('click', showGenModal);
  document.getElementById('btn-river-preset').addEventListener('click', applyRiverPreset);
  // Test preset removed
  ['gen-mapsize','gen-density','gen-octaves','gen-valley','gen-roughness','gen-mtn-height',
   'gen-sea-level','gen-plates','gen-erosion-passes','gen-rainfall'].forEach(id => {
    document.getElementById(id).addEventListener('input', updateGenLabels);
  });
  document.querySelectorAll('.gen-type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.gen-type-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });
  document.getElementById('gen-go').addEventListener('click', generateFromModal);
  document.getElementById('gen-random-seed').addEventListener('click', () => {
    document.getElementById('gen-seed').value = Math.floor(Math.random() * 99999);
    updateGenLabels();
  });
  document.getElementById('gen-close').addEventListener('click', hideGenModal);
  document.getElementById('gen-overlay').addEventListener('click', (e) => {
    if (e.target === document.getElementById('gen-overlay')) hideGenModal();
  });
}
