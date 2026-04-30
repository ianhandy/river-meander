// Canvas interactions — pan, zoom, carve, source placement, cell inspector

import state from '../data/state.js';
import { LAYERS } from '../data/constants.js';
import { layerColor } from '../util/helpers.js';
import { updateEquationsTooltip, hideEquationsTooltip } from './equations-panel.js';
import { createOffscreenRiver } from '../sim/offscreen-rivers.js';

export function initTools(canvas) {

  function canvasToGrid(e) {
    const rect = canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) / canvas.width;
    const my = (e.clientY - rect.top) / canvas.height;
    const viewSize = state.GW / state.camZoom;
    const gx = (state.camX + mx * viewSize) | 0;
    const gy = (state.camY + my * viewSize) | 0;
    return { gx, gy, clientX: e.clientX, clientY: e.clientY };
  }

  let activeToolMode = 'pan';
  let carveAdd = false;
  let carveSize = 3;
  let carveStrength = 0.04;

  const btnPan = document.getElementById('tbtn-pan');
  const btnCarve = document.getElementById('tbtn-carve');
  const btnFlow = document.getElementById('tbtn-flow');
  const btnSubtract = document.getElementById('tbtn-subtract');
  const btnAdd = document.getElementById('tbtn-add');
  const carveOpts = document.getElementById('carve-opts');
  const carveSizeSlider = document.getElementById('carve-size');
  const carveSizeVal = document.getElementById('carve-size-val');
  const carveStrSlider = document.getElementById('carve-strength');
  const carveStrVal = document.getElementById('carve-strength-val');

  function setToolMode(mode) {
    activeToolMode = mode;
    btnPan.classList.toggle('active', mode === 'pan');
    btnCarve.classList.toggle('active', mode === 'carve');
    btnFlow.classList.toggle('active', mode === 'flow');
    carveOpts.style.display = mode === 'carve' ? '' : 'none';
    canvas.style.cursor = mode === 'carve' ? 'crosshair'
                        : mode === 'flow' ? 'pointer' : 'grab';
  }

  btnPan.addEventListener('click', () => setToolMode('pan'));
  btnCarve.addEventListener('click', () => setToolMode('carve'));
  btnFlow.addEventListener('click', () => setToolMode('flow'));

  btnSubtract.addEventListener('click', () => {
    carveAdd = false;
    btnSubtract.classList.add('active');
    btnAdd.classList.remove('active');
  });
  btnAdd.addEventListener('click', () => {
    carveAdd = true;
    btnAdd.classList.add('active');
    btnSubtract.classList.remove('active');
  });

  carveSizeSlider.addEventListener('input', () => {
    carveSize = parseInt(carveSizeSlider.value);
    carveSizeVal.textContent = carveSize;
  });
  carveStrSlider.addEventListener('input', () => {
    carveStrength = parseInt(carveStrSlider.value) / 1000;
    carveStrVal.textContent = carveStrSlider.value;
  });

  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === 't' || e.key === 'T') { setToolMode('carve'); e.preventDefault(); }
    if (e.key === 'f' || e.key === 'F') { setToolMode('flow'); e.preventDefault(); }
    if (e.key === 'Escape') { setToolMode('pan'); }
  });

  function carveAt(gx, gy) {
    const { terrain, GW, GH } = state;
    const r = carveSize;
    const sign = carveAdd ? 1 : -1;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const ix = gx + dx, iy = gy + dy;
        if (ix < 0 || ix >= GW || iy < 0 || iy >= GH) continue;
        const dd = Math.sqrt(dx * dx + dy * dy);
        if (dd > r) continue;
        const falloff = 1 - dd / (r + 0.5);
        const idx = iy * GW + ix;
        terrain[idx] += sign * carveStrength * falloff;
        terrain[idx] = carveAdd ? Math.min(1.5, terrain[idx]) : Math.max(0.01, terrain[idx]);
      }
    }
  }

  // Source editor
  const srcEditor = document.getElementById('source-editor');
  const srcRateSlider = document.getElementById('se-rate');
  const srcRateVal = document.getElementById('se-rate-val');
  const srcDeleteBtn = document.getElementById('se-delete');

  function findNearbySource(gx, gy) {
    let best = null, bestDist = Infinity;
    for (let i = 0; i < state.sources.length; i++) {
      const s = state.sources[i];
      const d = Math.sqrt((s.gx - gx) ** 2 + (s.gy - gy) ** 2);
      if (d <= 5 && d < bestDist) { best = i; bestDist = d; }
    }
    return best;
  }

  function showSourceEditor(srcIdx, clientX, clientY) {
    state.editingSourceIdx = srcIdx;
    const src = state.sources[srcIdx];
    srcRateSlider.value = src.rate;
    srcRateVal.textContent = src.rate.toFixed(3);
    srcEditor.classList.remove('hidden');
    const ex = Math.min(clientX + 12, window.innerWidth - 200);
    const ey = Math.min(clientY - 40, window.innerHeight - 120);
    srcEditor.style.left = ex + 'px';
    srcEditor.style.top = Math.max(8, ey) + 'px';
  }

  function hideSourceEditor() {
    srcEditor.classList.add('hidden');
    state.editingSourceIdx = null;
  }

  srcRateSlider.addEventListener('input', () => {
    if (state.editingSourceIdx !== null && state.sources[state.editingSourceIdx]) {
      state.sources[state.editingSourceIdx].rate = parseFloat(srcRateSlider.value);
      srcRateVal.textContent = parseFloat(srcRateSlider.value).toFixed(3);
    }
  });

  srcDeleteBtn.addEventListener('click', () => {
    if (state.editingSourceIdx !== null) {
      state.sources.splice(state.editingSourceIdx, 1);
      hideSourceEditor();
    }
  });

  // ── Off-screen river editor ────────────────────────────────────────────────
  const riverEditor = document.getElementById('river-editor');
  const reRateSlider = document.getElementById('re-rate');
  const reRateVal = document.getElementById('re-rate-val');
  const reSwaySlider = document.getElementById('re-sway');
  const reSwayVal = document.getElementById('re-sway-val');
  const rePeriodSlider = document.getElementById('re-period');
  const rePeriodVal = document.getElementById('re-period-val');
  const reDeleteBtn = document.getElementById('re-delete');
  const reAngleBtns = riverEditor.querySelectorAll('.re-angle-btn');

  let editingRiverIdx = null;

  // Correct arrow glyphs for each edge (order matches data-angle: 0, 0.524, 1.047, -0.524, -1.047)
  const EDGE_ARROWS = {
    left:   ['→', '↘', '↓', '↗', '↑'],
    right:  ['←', '↙', '↓', '↖', '↑'],
    top:    ['↓', '↘', '→', '↙', '←'],
    bottom: ['↑', '↗', '→', '↖', '←'],
  };

  function showRiverEditor(rvIdx, clientX, clientY) {
    editingRiverIdx = rvIdx;
    const rv = state.offscreenRivers[rvIdx];
    reRateSlider.value = rv.rate;
    reRateVal.textContent = rv.rate.toFixed(3);
    reSwaySlider.value = rv.swayAmp;
    reSwayVal.textContent = rv.swayAmp.toFixed(2);
    rePeriodSlider.value = rv.swayPeriod;
    rePeriodVal.textContent = rv.swayPeriod;
    // Update arrow glyphs to match actual flow directions for this edge
    const arrows = EDGE_ARROWS[rv.edge] || EDGE_ARROWS.left;
    reAngleBtns.forEach((btn, idx) => {
      btn.textContent = arrows[idx];
      btn.classList.toggle('active', Math.abs(parseFloat(btn.dataset.angle) - rv.angle) < 0.01);
    });
    riverEditor.classList.remove('hidden');
    const ex = Math.min(clientX + 14, window.innerWidth - 210);
    const ey = Math.min(clientY - 40, window.innerHeight - 240);
    riverEditor.style.left = ex + 'px';
    riverEditor.style.top = Math.max(8, ey) + 'px';
  }

  function hideRiverEditor() {
    riverEditor.classList.add('hidden');
    editingRiverIdx = null;
  }

  reRateSlider.addEventListener('input', () => {
    if (editingRiverIdx !== null && state.offscreenRivers[editingRiverIdx]) {
      state.offscreenRivers[editingRiverIdx].rate = parseFloat(reRateSlider.value);
      reRateVal.textContent = parseFloat(reRateSlider.value).toFixed(3);
    }
  });
  reSwaySlider.addEventListener('input', () => {
    if (editingRiverIdx !== null && state.offscreenRivers[editingRiverIdx]) {
      state.offscreenRivers[editingRiverIdx].swayAmp = parseFloat(reSwaySlider.value);
      reSwayVal.textContent = parseFloat(reSwaySlider.value).toFixed(2);
    }
  });
  rePeriodSlider.addEventListener('input', () => {
    if (editingRiverIdx !== null && state.offscreenRivers[editingRiverIdx]) {
      state.offscreenRivers[editingRiverIdx].swayPeriod = parseInt(rePeriodSlider.value);
      rePeriodVal.textContent = rePeriodSlider.value;
    }
  });
  reAngleBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      if (editingRiverIdx !== null && state.offscreenRivers[editingRiverIdx]) {
        state.offscreenRivers[editingRiverIdx].angle = parseFloat(btn.dataset.angle);
        reAngleBtns.forEach(b => b.classList.toggle('active', b === btn));
      }
    });
  });
  reDeleteBtn.addEventListener('click', () => {
    if (editingRiverIdx !== null) {
      state.offscreenRivers.splice(editingRiverIdx, 1);
      hideRiverEditor();
    }
  });

  // Edge-click detection helpers — detect clicks near the grid boundary
  function getEdgeHit(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const scale = canvas.width / rect.width;
    const cpx = (clientX - rect.left) * scale;
    const cpy = (clientY - rect.top) * scale;
    const W = canvas.width, H = canvas.height;
    const { GW, GH, camX, camY, camZoom } = state;
    const viewSize = GW / camZoom;
    const g2sx = gx => (gx - camX) / viewSize * W;
    const g2sy = gy => (gy - camY) / viewSize * H;
    const s2gx = sx => sx / W * viewSize + camX;
    const s2gy = sy => sy / H * viewSize + camY;
    const thresh = 18;
    if (Math.abs(cpx - g2sx(0))  < thresh) return { edge: 'left',   edgeT: Math.max(0.02, Math.min(0.98, s2gy(cpy) / GH)) };
    if (Math.abs(cpx - g2sx(GW)) < thresh) return { edge: 'right',  edgeT: Math.max(0.02, Math.min(0.98, s2gy(cpy) / GH)) };
    if (Math.abs(cpy - g2sy(0))  < thresh) return { edge: 'top',    edgeT: Math.max(0.02, Math.min(0.98, s2gx(cpx) / GW)) };
    if (Math.abs(cpy - g2sy(GH)) < thresh) return { edge: 'bottom', edgeT: Math.max(0.02, Math.min(0.98, s2gx(cpx) / GW)) };
    return null;
  }

  function findNearbyRiver(clientX, clientY) {
    if (!state.offscreenRivers) return null;
    const rect = canvas.getBoundingClientRect();
    const scale = canvas.width / rect.width;
    const cpx = (clientX - rect.left) * scale;
    const cpy = (clientY - rect.top) * scale;
    const W = canvas.width, H = canvas.height;
    const { GW, GH, camX, camY, camZoom } = state;
    const viewSize = GW / camZoom;
    const g2sx = gx => (gx - camX) / viewSize * W;
    const g2sy = gy => (gy - camY) / viewSize * H;
    let best = null, bestDist = Infinity;
    for (let i = 0; i < state.offscreenRivers.length; i++) {
      const rv = state.offscreenRivers[i];
      // Use animated curT so click target matches the visual marker position
      const curT = Math.max(0.01, Math.min(0.99, rv.edgeT + rv.swayAmp * Math.sin(rv.swayPhase)));
      let sx, sy;
      if (rv.edge === 'left')   { sx = g2sx(0);  sy = g2sy(curT * GH); }
      if (rv.edge === 'right')  { sx = g2sx(GW); sy = g2sy(curT * GH); }
      if (rv.edge === 'top')    { sx = g2sx(curT * GW); sy = g2sy(0); }
      if (rv.edge === 'bottom') { sx = g2sx(curT * GW); sy = g2sy(GH); }
      const dist = Math.sqrt((cpx - sx) ** 2 + (cpy - sy) ** 2);
      if (dist < 32 && dist < bestDist) { best = i; bestDist = dist; }
    }
    return best;
  }

  document.addEventListener('mousedown', (e) => {
    if (state.editingSourceIdx !== null && !srcEditor.contains(e.target)) {
      hideSourceEditor();
    }
    if (editingRiverIdx !== null && !riverEditor.contains(e.target)) {
      hideRiverEditor();
    }
  });

  canvas.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || !state.terrain) return;

    // Edge click — off-screen river creation / editing (any tool mode)
    const edgeHit = getEdgeHit(e.clientX, e.clientY);
    if (edgeHit) {
      const rvIdx = findNearbyRiver(e.clientX, e.clientY);
      if (rvIdx !== null) {
        showRiverEditor(rvIdx, e.clientX, e.clientY);
      } else {
        if (!state.offscreenRivers) state.offscreenRivers = [];
        const rv = createOffscreenRiver(edgeHit.edge, edgeHit.edgeT);
        state.offscreenRivers.push(rv);
        showRiverEditor(state.offscreenRivers.length - 1, e.clientX, e.clientY);
      }
      e.stopPropagation(); // prevent document listener from immediately closing the popup
      e.preventDefault();
      return;
    }

    const { gx, gy, clientX, clientY } = canvasToGrid(e);
    if (gx < 0 || gx >= state.GW || gy < 0 || gy >= state.GH) return;

    if (activeToolMode === 'flow') {
      const srcIdx = findNearbySource(gx, gy);
      if (srcIdx !== null) {
        showSourceEditor(srcIdx, clientX, clientY);
        e.stopPropagation(); // prevent document listener from immediately closing the popup
      } else {
        state.sources.push({ gx, gy, rate: 0.06 });
      }
      return;
    }

    if (activeToolMode === 'carve') {
      state.isCarving = true;
      carveAt(gx, gy);
      e.preventDefault();
      return;
    }

    if (e.shiftKey) {
      state.sources.push({ gx, gy, rate: 0.06 });
      return;
    }

    state.isPanning = true;
    state.panStartX = e.clientX;
    state.panStartY = e.clientY;
    state.panStartCamX = state.camX;
    state.panStartCamY = state.camY;
    canvas.style.cursor = 'grabbing';
    e.preventDefault();
  });

  window.addEventListener('mousemove', (e) => {
    if (state.isCarving && state.terrain) {
      const { gx, gy } = canvasToGrid(e);
      if (gx >= 0 && gx < state.GW && gy >= 0 && gy < state.GH) carveAt(gx, gy);
    }
  });

  window.addEventListener('mouseup', () => {
    if (state.isCarving) state.isCarving = false;
  });

  // ── Cell inspector + equation tooltip ──────────────────────────────────
  const cellInfoEl = document.getElementById('cell-info');
  let cellInfoTimer = null;
  let lastInspectCell = -1;
  let lastMouseX = 0, lastMouseY = 0;

  function showCellInfo(clientX, clientY) {
    const { terrain, water, saturation, flowSpeed, sediment,
            origTerrain, isOceanCell, GW, GH, camX, camY, camZoom } = state;
    if (!terrain || !origTerrain) return;
    const rect = canvas.getBoundingClientRect();
    const mx = (clientX - rect.left) / canvas.width;
    const my = (clientY - rect.top) / canvas.height;
    const viewSize = GW / camZoom;
    const gx = (camX + mx * viewSize) | 0;
    const gy = (camY + my * viewSize) | 0;
    if (gx < 0 || gx >= GW || gy < 0 || gy >= GH) { cellInfoEl.style.display = 'none'; return; }

    const i = gy * GW + gx;
    state.hoveredCell = i;

    // If equations mode, show equation tooltip instead
    if (state.showEquations) {
      cellInfoEl.style.display = 'none';
      updateEquationsTooltip(clientX, clientY);
      return;
    }

    const h = terrain[i];
    const w = water ? water[i] : 0;
    const sat = saturation ? saturation[i] : 0;
    const spd = flowSpeed ? flowSpeed[i] : 0;
    let layerName = 'Unknown';
    try {
      const lc = layerColor(i);
      const layerIdx = LAYERS.findIndex(l => l === lc);
      layerName = lc.name || 'Unknown';
    } catch(e) {}
    const erosionDepth = Math.max(0, origTerrain[i] - h);
    const ocean = isOceanCell ? isOceanCell[i] : false;

    let html = '';
    html += `<span class="ci-label">Pos:</span> <span class="ci-val">${gx}, ${gy}</span><br>`;
    html += `<span class="ci-label">Elevation:</span> <span class="ci-val">${h.toFixed(4)}</span>`;
    if (ocean) html += ` <span class="ci-label">(ocean)</span>`;
    html += `<br>`;
    html += `<span class="ci-label">Material:</span> <span class="ci-val">${layerName}</span><br>`;
    html += `<span class="ci-label">Erosion depth:</span> <span class="ci-val">${erosionDepth.toFixed(4)}</span><br>`;
    if (w > 0.00001) {
      html += `<span class="ci-label">Water depth:</span> <span class="ci-val">${w.toFixed(4)}</span><br>`;
      html += `<span class="ci-label">Flow speed:</span> <span class="ci-val">${spd.toFixed(4)}</span><br>`;
    }
    html += `<span class="ci-label">Saturation:</span> <span class="ci-val">${(sat * 100).toFixed(0)}%</span>`;
    if (sediment && sediment[i] > 0.00001) {
      html += `<br><span class="ci-label">Sediment:</span> <span class="ci-val">${sediment[i].toFixed(4)}</span>`;
    }

    cellInfoEl.innerHTML = html;
    cellInfoEl.style.display = 'block';
    let left = clientX + 15;
    let top = clientY - 10;
    if (left + 200 > window.innerWidth) left = clientX - 210;
    if (top + 150 > window.innerHeight) top = clientY - 150;
    cellInfoEl.style.left = left + 'px';
    cellInfoEl.style.top = top + 'px';
  }

  canvas.addEventListener('mousemove', (e) => {
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;

    if (state.isPanning || state.isCarving || state.isDraggingTool) {
      cellInfoEl.style.display = 'none';
      hideEquationsTooltip();
      lastInspectCell = -1;
      state.hoveredCell = -1;
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) / canvas.width;
    const my = (e.clientY - rect.top) / canvas.height;
    const viewSize = state.GW / state.camZoom;
    const gx = (state.camX + mx * viewSize) | 0;
    const gy = (state.camY + my * viewSize) | 0;
    const cell = gy * state.GW + gx;

    if (cell === lastInspectCell && (cellInfoEl.style.display === 'block' || state.showEquations)) {
      // Just update position
      if (state.showEquations) {
        updateEquationsTooltip(e.clientX, e.clientY);
      } else {
        let left = e.clientX + 15;
        let top = e.clientY - 10;
        if (left + 200 > window.innerWidth) left = e.clientX - 210;
        if (top + 150 > window.innerHeight) top = e.clientY - 150;
        cellInfoEl.style.left = left + 'px';
        cellInfoEl.style.top = top + 'px';
      }
      return;
    }

    lastInspectCell = cell;
    cellInfoEl.style.display = 'none';
    hideEquationsTooltip();
    if (cellInfoTimer) clearTimeout(cellInfoTimer);
    cellInfoTimer = setTimeout(() => showCellInfo(lastMouseX, lastMouseY), 200);
  });

  canvas.addEventListener('mouseleave', () => {
    cellInfoEl.style.display = 'none';
    hideEquationsTooltip();
    lastInspectCell = -1;
    state.hoveredCell = -1;
    if (cellInfoTimer) { clearTimeout(cellInfoTimer); cellInfoTimer = null; }
  });

  // Legacy toolbar drag
  const dragGhost = document.getElementById('drag-ghost');
  const toolSource = document.getElementById('tool-source');
  if (toolSource) {
    toolSource.addEventListener('mousedown', (e) => {
      state.isDraggingTool = true;
      state.dragToolType = 'source';
      dragGhost.style.display = 'block';
      dragGhost.style.left = e.clientX + 'px';
      dragGhost.style.top = e.clientY + 'px';
      e.preventDefault();
    });
  }

  window.addEventListener('mousemove', (e) => {
    if (!state.isDraggingTool) return;
    dragGhost.style.left = e.clientX + 'px';
    dragGhost.style.top = e.clientY + 'px';
  });

  window.addEventListener('mouseup', (e) => {
    if (!state.isDraggingTool) return;
    state.isDraggingTool = false;
    dragGhost.style.display = 'none';
    if (state.dragToolType === 'source' && state.terrain) {
      const rect = canvas.getBoundingClientRect();
      const mx = (e.clientX - rect.left) / canvas.width;
      const my = (e.clientY - rect.top) / canvas.height;
      if (mx >= 0 && mx <= 1 && my >= 0 && my <= 1) {
        const viewSize = state.GW / state.camZoom;
        const gx = (state.camX + mx * viewSize) | 0;
        const gy = (state.camY + my * viewSize) | 0;
        if (gx >= 0 && gx < state.GW && gy >= 0 && gy < state.GH) {
          state.sources.push({ gx, gy, rate: state.springRate });
        }
      }
    }
    state.dragToolType = null;
  });

  // Zoom
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
    const oldZoom = state.camZoom;
    state.camZoom = Math.max(1, Math.min(20, state.camZoom * zoomFactor));
    const rect = canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) / canvas.width;
    const my = (e.clientY - rect.top) / canvas.height;
    const oldView = state.GW / oldZoom;
    const newView = state.GW / state.camZoom;
    state.camX += (oldView - newView) * mx;
    state.camY += (oldView - newView) * my;
    clampCam();
  }, { passive: false });

  // Pan
  window.addEventListener('mousemove', (e) => {
    if (!state.isPanning) return;
    const viewSize = state.GW / state.camZoom;
    const dx = (e.clientX - state.panStartX) / canvas.width * viewSize;
    const dy = (e.clientY - state.panStartY) / canvas.height * viewSize;
    state.camX = state.panStartCamX - dx;
    state.camY = state.panStartCamY - dy;
    clampCam();
  });

  window.addEventListener('mouseup', () => {
    if (state.isPanning) {
      state.isPanning = false;
      canvas.style.cursor = activeToolMode === 'carve' ? 'crosshair'
                          : activeToolMode === 'flow' ? 'pointer' : 'grab';
    }
  });

  setToolMode('pan');
}

function clampCam() {
  const viewSize = state.GW / state.camZoom;
  state.camX = Math.max(0, Math.min(state.GW - viewSize, state.camX));
  state.camY = Math.max(0, Math.min(state.GH - viewSize, state.camY));
}
