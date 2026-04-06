// Canvas interactions — pan, zoom, carve, source placement, cell inspector, toolbar drag

import state from './state.js';
import { LAYERS, LAYER_NAMES } from './constants.js';
import { layerColor } from './helpers.js';

export function initTools(canvas) {
  // ── Carving ──

  function canvasToGrid(e) {
    const rect = canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) / canvas.width;
    const my = (e.clientY - rect.top) / canvas.height;
    const viewSize = state.GW / state.camZoom;
    const gx = (state.camX + mx * viewSize) | 0;
    const gy = (state.camY + my * viewSize) | 0;
    return { gx, gy, clientX: e.clientX, clientY: e.clientY };
  }

  function carveAt(gx, gy) {
    const { terrain, GW, GH } = state;
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        const ix = gx + dx, iy = gy + dy;
        if (ix < 0 || ix >= GW || iy < 0 || iy >= GH) continue;
        const dd = Math.sqrt(dx*dx+dy*dy);
        if (dd <= 3) terrain[iy * GW + ix] = Math.max(0.01, terrain[iy * GW + ix] - 0.08 * (1 - dd/3));
      }
    }
  }

  function findNearbySource(gx, gy) {
    let best = null, bestDist = Infinity;
    for (let i = 0; i < state.sources.length; i++) {
      const s = state.sources[i];
      const d = Math.sqrt((s.gx - gx) ** 2 + (s.gy - gy) ** 2);
      if (d <= 5 && d < bestDist) { best = i; bestDist = d; }
    }
    return best;
  }

  // ── Source editor ──
  const srcEditor = document.getElementById('source-editor');
  const srcRateSlider = document.getElementById('se-rate');
  const srcRateVal = document.getElementById('se-rate-val');
  const srcDeleteBtn = document.getElementById('se-delete');

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

  document.addEventListener('mousedown', (e) => {
    if (state.editingSourceIdx !== null && !srcEditor.contains(e.target)) {
      hideSourceEditor();
    }
  });

  // ── Active tool mode (toggled by keyboard) ──
  // 't' = terrain carve, 'f' = flow edit, null = default (pan)
  let activeToolMode = null;

  function setToolMode(mode) {
    activeToolMode = activeToolMode === mode ? null : mode;
    canvas.style.cursor = activeToolMode === 't' ? 'crosshair'
                        : activeToolMode === 'f' ? 'pointer'
                        : 'grab';
    // Update hint
    const hintEl = document.getElementById('hint');
    if (hintEl) {
      if (activeToolMode === 't') hintEl.textContent = 'TERRAIN EDIT — click to carve, press T to exit';
      else if (activeToolMode === 'f') hintEl.textContent = 'FLOW EDIT — click source to edit, click empty to add source, press F to exit';
      else hintEl.innerHTML = 'Drag — pan &nbsp; Scroll — zoom<br>T — carve terrain<br>F — edit flow / add source';
    }
  }

  window.addEventListener('keydown', (e) => {
    // Don't intercept if typing in an input
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === 't' || e.key === 'T') { setToolMode('t'); e.preventDefault(); }
    if (e.key === 'f' || e.key === 'F') { setToolMode('f'); e.preventDefault(); }
    if (e.key === 'Escape') { setToolMode(null); }
  });

  // ── Canvas mousedown ──
  canvas.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || !state.terrain) return;
    const { gx, gy, clientX, clientY } = canvasToGrid(e);
    if (gx < 0 || gx >= state.GW || gy < 0 || gy >= state.GH) return;

    // Flow edit mode (F key)
    if (activeToolMode === 'f') {
      const srcIdx = findNearbySource(gx, gy);
      if (srcIdx !== null) {
        showSourceEditor(srcIdx, clientX, clientY);
      } else {
        state.sources.push({ gx, gy, rate: 0.06 });
      }
      return;
    }

    // Terrain carve mode (T key)
    if (activeToolMode === 't') {
      state.isCarving = true;
      state.carveMoved = false;
      carveAt(gx, gy);
      return;
    }

    // Legacy: shift+click still adds source
    if (e.shiftKey) {
      state.sources.push({ gx, gy, rate: 0.06 });
      return;
    }

    // Pan
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
      state.carveMoved = true;
      const { gx, gy } = canvasToGrid(e);
      if (gx >= 0 && gx < state.GW && gy >= 0 && gy < state.GH) carveAt(gx, gy);
    }
  });

  window.addEventListener('mouseup', () => {
    if (state.isCarving) state.isCarving = false;
  });

  // ── Cell inspector ──
  const cellInfoEl = document.getElementById('cell-info');
  let cellInfoTimer = null;

  function showCellInfo(clientX, clientY) {
    const { terrain, water, saturation, flowSpeed, sediment,
            origTerrain, isOceanCell, GW, GH, camX, camY, camZoom } = state;
    if (!terrain) return;
    const rect = canvas.getBoundingClientRect();
    const mx = (clientX - rect.left) / canvas.width;
    const my = (clientY - rect.top) / canvas.height;
    const viewSize = GW / camZoom;
    const gx = (camX + mx * viewSize) | 0;
    const gy = (camY + my * viewSize) | 0;
    if (gx < 0 || gx >= GW || gy < 0 || gy >= GH) { cellInfoEl.style.display = 'none'; return; }

    const i = gy * GW + gx;
    const h = terrain[i];
    const w = water[i];
    const sat = saturation ? saturation[i] : 0;
    const spd = flowSpeed ? flowSpeed[i] : 0;
    const lc = layerColor(i);
    const layerIdx = LAYERS.indexOf(lc);
    const layerName = LAYER_NAMES[layerIdx] || 'Unknown';
    const erosionDepth = Math.max(0, origTerrain[i] - h);
    const ocean = isOceanCell ? isOceanCell[i] : false;

    let html = '';
    html += `<span class="ci-label">Pos:</span> <span class="ci-val">${gx}, ${gy}</span><br>`;
    html += `<span class="ci-label">Elevation:</span> <span class="ci-val">${h.toFixed(4)}</span>`;
    if (ocean) html += ` <span class="ci-label">(ocean)</span>`;
    html += `<br>`;
    html += `<span class="ci-label">Material:</span> <span class="ci-val">${layerName}</span> <span class="ci-label">h=${lc.hardness}</span><br>`;
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
    cellInfoEl.style.display = 'none';
    if (cellInfoTimer) clearTimeout(cellInfoTimer);
    if (state.isPanning || state.isCarving || state.isDraggingTool) return;
    cellInfoTimer = setTimeout(() => showCellInfo(e.clientX, e.clientY), 500);
  });

  canvas.addEventListener('mouseleave', () => {
    cellInfoEl.style.display = 'none';
    if (cellInfoTimer) { clearTimeout(cellInfoTimer); cellInfoTimer = null; }
  });

  // ── Toolbar drag ──
  const dragGhost = document.getElementById('drag-ghost');

  document.getElementById('tool-source').addEventListener('mousedown', (e) => {
    state.isDraggingTool = true;
    state.dragToolType = 'source';
    dragGhost.style.display = 'block';
    dragGhost.style.left = e.clientX + 'px';
    dragGhost.style.top = e.clientY + 'px';
    e.preventDefault();
  });

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
          state.sources.push({ gx, gy, rate: state.SIM_SPRING_RATE });
        }
      }
    }
    state.dragToolType = null;
  });

  // ── Zoom ──
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

  // ── Pan ──
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
      canvas.style.cursor = 'grab';
    }
  });
}

function clampCam() {
  const viewSize = state.GW / state.camZoom;
  state.camX = Math.max(0, Math.min(state.GW - viewSize, state.camX));
  state.camY = Math.max(0, Math.min(state.GH - viewSize, state.camY));
}
