// UI controls — dev panel, bar settings, view toggles, legends
// The dev panel auto-generates sliders from the PARAMS registry.

import state from '../data/state.js';
import { PARAMS, PARAM_DEFAULTS } from '../data/constants.js';
import { init3D } from '../render/render3d.js';

// ── View / toggle functions ──────────────────────────────────────────────────

export function togglePlay() {
  state.running = !state.running;
  const btn = document.getElementById('btn-play');
  btn.textContent = state.running ? '\u23F8 Pause' : '\u25B6 Play';
  btn.classList.toggle('active', state.running);
  const btn2 = document.getElementById('btn-play2');
  if (btn2) btn2.textContent = state.running ? '\u23F8' : '\u25B6';
}

export function setView(mode, c3d) {
  state.viewMode = mode;
  document.getElementById('btn-view-terrain').classList.toggle('active', mode === 'terrain');
  document.getElementById('btn-view-height').classList.toggle('active', mode === 'height');
  document.getElementById('btn-view-3d').classList.toggle('active', mode === '3d');
  document.getElementById('c').classList.toggle('hidden-2d', mode === '3d');
  document.getElementById('c3d').classList.toggle('active-3d', mode === '3d');
  if (mode === '3d') init3D(c3d);
  updateLegend();
  saveBarSettings();
}

export function updateLegend() {
  const vm = state.viewMode;
  document.getElementById('legend-terrain').style.display = (vm === 'terrain' && !state.showLayers && !state.showPressure && !state.showVelocity) ? '' : 'none';
  document.getElementById('legend-height').style.display = vm === 'height' ? '' : 'none';
  document.getElementById('legend-layers').style.display = (state.showLayers && !state.showPressure && !state.showVelocity) ? '' : 'none';
  document.getElementById('legend-pressure').style.display = state.showPressure ? '' : 'none';
  document.getElementById('legend-velocity').style.display = state.showVelocity ? '' : 'none';
}

export function toggleContours() {
  state.showContours = !state.showContours;
  document.getElementById('btn-contours').classList.toggle('active', state.showContours);
  saveBarSettings();
}

export function toggleLayers() {
  state.showLayers = !state.showLayers;
  document.getElementById('btn-layers').classList.toggle('active', state.showLayers);
  updateLegend();
  saveBarSettings();
}

export function togglePressure() {
  state.showPressure = !state.showPressure;
  state.showVelocity = false;
  document.getElementById('btn-pressure').classList.toggle('active', state.showPressure);
  document.getElementById('btn-velocity').classList.remove('active');
  updateLegend();
  saveBarSettings();
}

export function toggleVelocity() {
  state.showVelocity = !state.showVelocity;
  state.showPressure = false;
  document.getElementById('btn-velocity').classList.toggle('active', state.showVelocity);
  document.getElementById('btn-pressure').classList.remove('active');
  updateLegend();
  saveBarSettings();
}

// ── Dev panel ────────────────────────────────────────────────────────────────
// Auto-generated from PARAMS registry. Each parameter gets a slider,
// value display, tick buttons, and click-to-edit.

// Map PARAMS keys to DOM element IDs
const DEV_BINDINGS = [];
for (const [key, p] of Object.entries(PARAMS)) {
  const id = `dev-${key}`;
  const valId = `dev-${key}-val`;
  DEV_BINDINGS.push([id, key, valId]);
}

const DEV_HTML_DEFAULTS = {};

function formatDevVal(v) {
  return v < 0.01 ? v.toFixed(4) : v < 1 ? v.toFixed(3) : v.toFixed(1);
}

function applyDevValue(id, key, valId, value) {
  const el = document.getElementById(id);
  if (!el) return;
  el.value = value;
  const v = parseFloat(value);
  state[key] = v;
  const valEl = document.getElementById(valId);
  if (valEl) valEl.textContent = formatDevVal(v);
}

function saveDevSettings() {
  const settings = {};
  DEV_BINDINGS.forEach(([id]) => {
    const el = document.getElementById(id);
    if (el) settings[id] = el.value;
  });
  localStorage.setItem('riverMeanderDev', JSON.stringify(settings));
}

const SETTINGS_VERSION = 34; // bump to invalidate stale localStorage

function loadDevSettings() {
  try {
    const ver = parseInt(localStorage.getItem('riverMeanderDevVer') || '0');
    if (ver < SETTINGS_VERSION) {
      localStorage.removeItem('riverMeanderDev');
      localStorage.removeItem('riverMeanderBar');
      localStorage.setItem('riverMeanderDevVer', SETTINGS_VERSION);
      return;
    }
    const saved = JSON.parse(localStorage.getItem('riverMeanderDev') || '{}');
    DEV_BINDINGS.forEach(([id, key, valId]) => {
      if (saved[id] !== undefined) applyDevValue(id, key, valId, saved[id]);
    });
  } catch(e) {}
}

function resetDevDefaults() {
  DEV_BINDINGS.forEach(([id, key, valId]) => {
    if (DEV_HTML_DEFAULTS[id]) applyDevValue(id, key, valId, DEV_HTML_DEFAULTS[id]);
  });
  localStorage.removeItem('riverMeanderDev');
}

// ── Bottom bar slider persistence ────────────────────────────────────────────

const BAR_SLIDER_MAP = {
  'speed': 'speedUI',
  'erodibility': 'erodibilityUI',
  'hardness-depth': 'hardnessDepthUI',
  'flow-rate': 'flowRateUI',
  'water-opacity': 'waterOpacityUI',
};
const BAR_IDS = Object.keys(BAR_SLIDER_MAP);
const BAR_DEFAULTS = {};

function syncBarToState() {
  state.speedUI = parseFloat(document.getElementById('speed').value);
  state.erodibilityUI = document.getElementById('erodibility').value / 100;
  state.hardnessDepthUI = document.getElementById('hardness-depth').value / 100;
  state.flowRateUI = document.getElementById('flow-rate').value / 100;
  state.waterOpacityUI = document.getElementById('water-opacity').value / 100;
}

export function saveBarSettings() {
  const s = {};
  BAR_IDS.forEach(id => { const el = document.getElementById(id); if (el) s[id] = el.value; });
  s.viewMode = state.viewMode;
  s.showContours = state.showContours;
  s.showLayers = state.showLayers;
  s.showPressure = state.showPressure;
  s.showVelocity = state.showVelocity;
  s.toolbarVisible = !document.getElementById('toolbar').classList.contains('hidden');
  localStorage.setItem('riverMeanderBar', JSON.stringify(s));
}

function loadBarSettings(c3d) {
  try {
    const s = JSON.parse(localStorage.getItem('riverMeanderBar') || '{}');
    BAR_IDS.forEach(id => {
      const el = document.getElementById(id);
      if (el && s[id] !== undefined) el.value = s[id];
    });
    setView(s.viewMode || state.viewMode, c3d);
    if (s.showContours === false) toggleContours();
    if (s.showLayers === true) toggleLayers();
    if (s.showPressure === true) togglePressure();
    if (s.showVelocity === true) toggleVelocity();
    if (s.toolbarVisible === true) document.getElementById('toolbar').classList.remove('hidden');
  } catch(e) {}
}

export function resetAllDefaults(c3d) {
  resetDevDefaults();
  BAR_IDS.forEach(id => {
    const el = document.getElementById(id);
    if (el && BAR_DEFAULTS[id]) el.value = BAR_DEFAULTS[id];
  });
  if (state.viewMode !== 'terrain') setView('terrain', c3d);
  if (!state.showContours) toggleContours();
  if (state.showLayers) toggleLayers();
  if (state.showPressure) togglePressure();
  if (state.showVelocity) toggleVelocity();
  localStorage.removeItem('riverMeanderBar');
  syncBarToState();
}

// ── Build dev panel DOM from PARAMS ──────────────────────────────────────────

function buildDevPanel() {
  const container = document.getElementById('dev-sliders');
  if (!container) return;

  // Group params
  const groups = {};
  for (const [key, p] of Object.entries(PARAMS)) {
    const g = p.group || 'other';
    if (!groups[g]) groups[g] = [];
    groups[g].push({ key, ...p });
  }

  const groupLabels = {
    water: 'Water Physics',
    erosion: 'Stream Power Erosion',
    diffusion: 'Terrain Diffusion',
    tectonics: 'Tectonics',
    display: 'Display',
  };

  container.innerHTML = '';

  for (const [groupKey, params] of Object.entries(groups)) {
    const header = document.createElement('div');
    header.className = 'dev-group-header';
    header.textContent = groupLabels[groupKey] || groupKey;
    container.appendChild(header);

    for (const p of params) {
      const row = document.createElement('div');
      row.className = 'dev-row';

      const label = document.createElement('label');
      label.textContent = p.key;
      label.className = 'dev-label';
      if (p.desc) label.title = `${p.desc}${p.unit ? ` (${p.unit})` : ''}`;

      const slider = document.createElement('input');
      slider.type = 'range';
      slider.id = `dev-${p.key}`;
      slider.min = p.min;
      slider.max = p.max;
      slider.step = p.step;
      slider.value = p.val;
      slider.className = 'dev-slider';

      const valSpan = document.createElement('span');
      valSpan.id = `dev-${p.key}-val`;
      valSpan.className = 'dev-val';
      valSpan.textContent = formatDevVal(p.val);

      const unitSpan = document.createElement('span');
      unitSpan.className = 'dev-unit';
      unitSpan.textContent = p.unit || '';

      row.appendChild(label);
      row.appendChild(slider);
      row.appendChild(valSpan);
      if (p.unit) row.appendChild(unitSpan);
      container.appendChild(row);
    }
  }
}

// ── Initialize all UI ────────────────────────────────────────────────────────

export function initUI(c3d) {
  // Build dev panel from PARAMS registry
  buildDevPanel();

  // Capture HTML defaults before loading saved state
  DEV_BINDINGS.forEach(([id]) => {
    const el = document.getElementById(id);
    if (el) DEV_HTML_DEFAULTS[id] = el.value;
  });
  BAR_IDS.forEach(id => {
    const el = document.getElementById(id);
    if (el) BAR_DEFAULTS[id] = el.value;
  });

  // Wire up dev panel sliders + tick buttons
  DEV_BINDINGS.forEach(([id, key, valId]) => {
    const el = document.getElementById(id);
    if (!el) return;
    const step = parseFloat(el.step) || 1;

    state[key] = parseFloat(el.value);
    const valEl = document.getElementById(valId);
    if (valEl) valEl.textContent = formatDevVal(parseFloat(el.value));

    el.addEventListener('input', () => {
      const v = parseFloat(el.value);
      state[key] = v;
      if (valEl) valEl.textContent = formatDevVal(v);
      saveDevSettings();
    });

    // Tick buttons
    if (!valEl) return;
    const ticks = document.createElement('div');
    ticks.className = 'dev-ticks';
    const btnUp = document.createElement('button');
    btnUp.className = 'dev-tick';
    btnUp.textContent = '\u25B2';
    btnUp.tabIndex = -1;
    const btnDown = document.createElement('button');
    btnDown.className = 'dev-tick';
    btnDown.textContent = '\u25BC';
    btnDown.tabIndex = -1;
    const nudge = (dir) => {
      const cur = state[key];
      const next = Math.max(0, +(cur + step * dir).toPrecision(10));
      el.value = next;
      state[key] = next;
      valEl.textContent = formatDevVal(next);
      saveDevSettings();
    };
    btnUp.addEventListener('click', (e) => { e.stopPropagation(); nudge(1); });
    btnDown.addEventListener('click', (e) => { e.stopPropagation(); nudge(-1); });
    ticks.appendChild(btnUp);
    ticks.appendChild(btnDown);
    valEl.parentNode.insertBefore(ticks, valEl.nextSibling);

    // Click-to-edit
    valEl.addEventListener('click', () => {
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'dev-val-input';
      input.value = el.value;
      const origText = valEl.textContent;
      valEl.textContent = '';
      valEl.appendChild(input);
      input.focus();
      input.select();
      const commit = () => {
        const v = parseFloat(input.value);
        if (!isNaN(v)) {
          const actual = Math.max(0, v);
          el.value = actual;
          state[key] = actual;
          valEl.textContent = formatDevVal(actual);
          saveDevSettings();
        } else {
          valEl.textContent = origText;
        }
      };
      input.addEventListener('blur', commit);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
        if (e.key === 'Escape') { valEl.textContent = origText; }
      });
    });
  });

  // Wire up bar sliders
  BAR_IDS.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', () => { syncBarToState(); saveBarSettings(); });
  });

  // Wire button events
  document.getElementById('btn-play').addEventListener('click', togglePlay);
  const btnPlay2 = document.getElementById('btn-play2');
  if (btnPlay2) btnPlay2.addEventListener('click', togglePlay);
  document.getElementById('btn-view-terrain').addEventListener('click', () => setView('terrain', c3d));
  document.getElementById('btn-view-height').addEventListener('click', () => setView('height', c3d));
  document.getElementById('btn-view-3d').addEventListener('click', () => setView('3d', c3d));
  document.getElementById('btn-contours').addEventListener('click', toggleContours);
  document.getElementById('btn-layers').addEventListener('click', toggleLayers);
  document.getElementById('btn-pressure').addEventListener('click', togglePressure);
  document.getElementById('btn-velocity').addEventListener('click', toggleVelocity);
  document.getElementById('btn-toolbar').addEventListener('click', () => {
    document.getElementById('toolbar').classList.toggle('hidden');
    saveBarSettings();
  });
  document.getElementById('dev-toggle').addEventListener('click', () => {
    document.getElementById('dev-panel').classList.toggle('hidden');
  });

  // 1:1 realtime toggle
  const btnRT = document.getElementById('btn-realtime');
  if (btnRT) {
    btnRT.addEventListener('click', () => {
      state.realtimeMode = !state.realtimeMode;
      btnRT.classList.toggle('active', state.realtimeMode);
    });
  }

  // Equations toggle (E key)
  const btnEq = document.getElementById('btn-equations');
  if (btnEq) {
    btnEq.addEventListener('click', () => {
      state.showEquations = !state.showEquations;
      btnEq.classList.toggle('active', state.showEquations);
    });
  }
  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === 'e' || e.key === 'E') {
      state.showEquations = !state.showEquations;
      const btn = document.getElementById('btn-equations');
      if (btn) btn.classList.toggle('active', state.showEquations);
    }
  });

  // Stream highlight toggle
  const btnStreams = document.getElementById('btn-streams');
  if (btnStreams) {
    btnStreams.addEventListener('click', () => {
      state.showStreams = !state.showStreams;
      btnStreams.classList.toggle('active', state.showStreams);
    });
  }

  // Fault lines toggle
  document.getElementById('btn-faults').addEventListener('click', () => {
    state.showFaultLines = !state.showFaultLines;
    document.getElementById('btn-faults').classList.toggle('active', state.showFaultLines);
  });

  // Reset all defaults
  const resetBtn = document.getElementById('dev-reset');
  if (resetBtn) resetBtn.addEventListener('click', () => resetAllDefaults(c3d));

  // Dev presets
  document.querySelectorAll('.dev-preset').forEach(btn => {
    const idx = btn.dataset.preset;
    const key = 'riverMeanderPreset' + idx;
    if (localStorage.getItem(key)) btn.classList.add('has-data');
    btn.addEventListener('click', (e) => {
      if (e.shiftKey) {
        const settings = {};
        DEV_BINDINGS.forEach(([id]) => {
          const el = document.getElementById(id);
          if (el) settings[id] = el.value;
        });
        localStorage.setItem(key, JSON.stringify(settings));
        btn.classList.add('has-data');
      } else {
        try {
          const saved = JSON.parse(localStorage.getItem(key) || '{}');
          if (Object.keys(saved).length === 0) return;
          DEV_BINDINGS.forEach(([id, stateKey, valId]) => {
            if (saved[id] !== undefined) applyDevValue(id, stateKey, valId, saved[id]);
          });
          saveDevSettings();
        } catch(e) {}
      }
    });
  });

  // Dev help tooltips
  let activeHelpPopup = null;
  document.addEventListener('click', (e) => {
    if (activeHelpPopup) { activeHelpPopup.remove(); activeHelpPopup = null; }
    const el = e.target.closest('.dev-help');
    if (!el) return;
    const text = el.getAttribute('title');
    if (!text) return;
    e.stopPropagation();
    const popup = document.createElement('div');
    popup.className = 'dev-help-popup';
    popup.textContent = text;
    document.body.appendChild(popup);
    const rect = el.getBoundingClientRect();
    let px = rect.left - 240;
    if (px < 8) px = rect.right + 8;
    popup.style.left = px + 'px';
    popup.style.top = Math.max(8, rect.top - 4) + 'px';
    activeHelpPopup = popup;
  });

  // Load saved settings
  loadDevSettings();
  loadBarSettings(c3d);
  syncBarToState();
}
