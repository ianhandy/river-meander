// UI controls — dev panel, bar settings, view toggles, legends

import state from './state.js';
import { SIM_DEFAULTS } from './constants.js';
import { init3D } from './render3d.js';

// ── View / toggle functions ──

export function togglePlay() {
  state.running = !state.running;
  const btn = document.getElementById('btn-play');
  btn.textContent = state.running ? '\u23F8 Pause' : '\u25B6 Play';
  btn.classList.toggle('active', state.running);
  const btn2 = document.getElementById('btn-play2');
  if (btn2) {
    btn2.textContent = state.running ? '\u23F8' : '\u25B6';
  }
}

export function setView(mode, c3d) {
  state.viewMode = mode;
  document.getElementById('btn-view-terrain').classList.toggle('active', mode === 'terrain');
  document.getElementById('btn-view-height').classList.toggle('active', mode === 'height');
  document.getElementById('btn-view-exposed').classList.toggle('active', mode === 'exposed');
  document.getElementById('btn-view-material').classList.toggle('active', mode === 'material');
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
  document.getElementById('legend-exposed').style.display = vm === 'exposed' ? '' : 'none';
  document.getElementById('legend-material').style.display = vm === 'material' ? '' : 'none';
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

// ── Dev panel ──

const DEV_BINDINGS = [
  ['dev-gravity',     'SIM_GRAVITY',        'dev-gravity-val'],
  ['dev-dt',          'SIM_DT',             'dev-dt-val'],
  ['dev-spring',      'SIM_SPRING_RATE',    'dev-spring-val'],
  ['dev-evap',        'SIM_EVAP',           'dev-evap-val'],
  ['dev-absorb',      'SIM_ABSORB',         'dev-absorb-val'],
  ['dev-kc',          'SIM_Kc',             'dev-kc-val'],
  ['dev-ks',          'SIM_Ks',             'dev-ks-val'],
  ['dev-kd',          'SIM_Kd',             'dev-kd-val'],
  ['dev-kt',          'SIM_Kt',             'dev-kt-val'],
  ['dev-slope',       'SIM_SLOPE_COLLAPSE', 'dev-slope-val'],
  ['dev-tspeed',      'SIM_TECTONIC_SPEED', 'dev-tspeed-val'],
  ['dev-uplift',      'SIM_UPLIFT_RATE',    'dev-uplift-val'],
  ['dev-rift',        'SIM_RIFT_RATE',      'dev-rift-val'],
  ['dev-quake',       'SIM_QUAKE_THRESHOLD','dev-quake-val'],
  ['dev-ferode',      'SIM_FAULT_EROSION',  'dev-ferode-val'],
  ['dev-hscale',      'SIM_HEIGHT_SCALE',   'dev-hscale-val'],
  ['dev-wthresh',     'SIM_WATER_THRESH',   'dev-wthresh-val'],
  ['dev-pw',          'SIM_PRESSURE_WT',    'dev-pw-val'],
  ['dev-asymmetry',   'SIM_MEANDER_ASYMMETRY', 'dev-asymmetry-val'],
  ['dev-lateral',     'SIM_LATERAL_RATE',   'dev-lateral-val'],
  ['dev-stag-evap',   'SIM_STAGNANT_EVAP',  'dev-stag-evap-val'],
  ['dev-stag-absorb', 'SIM_STAGNANT_ABSORB','dev-stag-absorb-val'],
  ['dev-move-evap',   'SIM_MOVING_EVAP',    'dev-move-evap-val'],
  ['dev-move-absorb', 'SIM_MOVING_ABSORB',  'dev-move-absorb-val'],
  ['dev-viscous',     'SIM_VISCOUS_DAMPING', 'dev-viscous-val'],
  ['dev-erode-wmin',  'SIM_ERODE_WATER_MIN', 'dev-erode-wmin-val'],
  ['dev-erode-smin',  'SIM_ERODE_SPEED_MIN', 'dev-erode-smin-val'],
  ['dev-lat-stag',    'SIM_LATERAL_STAGNANT','dev-lat-stag-val'],
  ['dev-lat-move',    'SIM_LATERAL_MOVING',  'dev-lat-move-val'],
  ['dev-talus-noise', 'SIM_TALUS_NOISE',     'dev-talus-noise-val'],
  ['dev-repose-min',  'SIM_REPOSE_MIN',      'dev-repose-min-val'],
  ['dev-repose-max',  'SIM_REPOSE_MAX',      'dev-repose-max-val'],
];

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
  document.getElementById(valId).textContent = formatDevVal(v);
}

function saveDevSettings() {
  const settings = {};
  DEV_BINDINGS.forEach(([id]) => {
    const el = document.getElementById(id);
    if (el) settings[id] = el.value;
  });
  localStorage.setItem('riverMeanderDev', JSON.stringify(settings));
}

const SETTINGS_VERSION = 8; // bump to invalidate stale localStorage

function loadDevSettings() {
  try {
    const ver = parseInt(localStorage.getItem('riverMeanderDevVer') || '0');
    if (ver < SETTINGS_VERSION) {
      localStorage.removeItem('riverMeanderDev');
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

// ── Bottom bar slider persistence ──

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
    if (s.viewMode) setView(s.viewMode, c3d);
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

// ── Initialize all UI ──

export function initUI(c3d) {
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
    const min = parseFloat(el.min);
    const max = parseFloat(el.max);

    // Set initial state from HTML default
    state[key] = parseFloat(el.value);
    document.getElementById(valId).textContent = formatDevVal(parseFloat(el.value));

    el.addEventListener('input', () => {
      const v = parseFloat(el.value);
      state[key] = v;
      document.getElementById(valId).textContent = formatDevVal(v);
      saveDevSettings();
    });

    // Add up/down tick buttons after the value display
    const valEl = document.getElementById(valId);
    if (!valEl) return;
    const ticks = document.createElement('div');
    ticks.className = 'dev-ticks';
    const btnUp = document.createElement('button');
    btnUp.className = 'dev-tick';
    btnUp.textContent = '▲';
    btnUp.tabIndex = -1;
    const btnDown = document.createElement('button');
    btnDown.className = 'dev-tick';
    btnDown.textContent = '▼';
    btnDown.tabIndex = -1;

    const nudge = (dir) => {
      const cur = state[key]; // read from state, not slider (may exceed slider range)
      const next = Math.max(0, +(cur + step * dir).toPrecision(10));
      el.value = next; // slider clamps visually
      state[key] = next;
      valEl.textContent = formatDevVal(next);
      saveDevSettings();
    };
    btnUp.addEventListener('click', (e) => { e.stopPropagation(); nudge(1); });
    btnDown.addEventListener('click', (e) => { e.stopPropagation(); nudge(-1); });

    ticks.appendChild(btnUp);
    ticks.appendChild(btnDown);
    valEl.parentNode.insertBefore(ticks, valEl.nextSibling);
  });

  // Click-to-edit numeric values
  DEV_BINDINGS.forEach(([id, key, valId]) => {
    const valEl = document.getElementById(valId);
    const sliderEl = document.getElementById(id);
    if (!valEl || !sliderEl) return;
    valEl.addEventListener('click', () => {
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'dev-val-input';
      input.value = sliderEl.value;
      const origText = valEl.textContent;
      valEl.textContent = '';
      valEl.appendChild(input);
      input.focus();
      input.select();
      const commit = () => {
        const v = parseFloat(input.value);
        if (!isNaN(v)) {
          const actual = Math.max(0, v); // any non-negative value
          sliderEl.value = actual; // slider clamps visually, that's fine
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

  // Wire button events (replacing inline onclick)
  document.getElementById('btn-play').addEventListener('click', togglePlay);
  const btnPlay2 = document.getElementById('btn-play2');
  if (btnPlay2) btnPlay2.addEventListener('click', togglePlay);
  document.getElementById('btn-view-terrain').addEventListener('click', () => setView('terrain', c3d));
  document.getElementById('btn-view-height').addEventListener('click', () => setView('height', c3d));
  document.getElementById('btn-view-exposed').addEventListener('click', () => setView('exposed', c3d));
  document.getElementById('btn-view-material').addEventListener('click', () => setView('material', c3d));
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

  // Vertical erosion toggle
  document.getElementById('btn-vert-erode').addEventListener('click', () => {
    state.SIM_VERTICAL_EROSION = !state.SIM_VERTICAL_EROSION;
    document.getElementById('btn-vert-erode').classList.toggle('active', state.SIM_VERTICAL_EROSION);
  });

  // 1:1 realtime toggle
  const btnRT = document.getElementById('btn-realtime');
  if (btnRT) {
    btnRT.addEventListener('click', () => {
      state.realtimeMode = !state.realtimeMode;
      btnRT.classList.toggle('active', state.realtimeMode);
    });
  }

  // Fault lines toggle
  document.getElementById('btn-faults').addEventListener('click', () => {
    state.showFaultLines = !state.showFaultLines;
    document.getElementById('btn-faults').classList.toggle('active', state.showFaultLines);
  });

  // Reset all defaults button
  document.getElementById('dev-panel').querySelector('button').addEventListener('click', () => resetAllDefaults(c3d));

  // Dev presets — shift+click to save, click to load
  document.querySelectorAll('.dev-preset').forEach(btn => {
    const idx = btn.dataset.preset;
    const key = 'riverMeanderPreset' + idx;
    // Check if preset has saved data
    if (localStorage.getItem(key)) btn.classList.add('has-data');

    btn.addEventListener('click', (e) => {
      if (e.shiftKey) {
        // Save current slider values
        const settings = {};
        DEV_BINDINGS.forEach(([id]) => {
          const el = document.getElementById(id);
          if (el) settings[id] = el.value;
        });
        localStorage.setItem(key, JSON.stringify(settings));
        btn.classList.add('has-data');
      } else {
        // Load preset
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
