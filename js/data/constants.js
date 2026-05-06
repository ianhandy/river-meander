/**
 * constants.js — Simulation parameters, geological layers, and rendering constants.
 *
 * Every tunable parameter lives in PARAMS with:
 *   val   — default value
 *   min   — slider minimum
 *   max   — slider maximum
 *   step  — slider increment
 *   unit  — physical unit ('' if dimensionless)
 *   desc  — human-readable tooltip
 *   group — UI grouping
 *
 * The simulation reads state[key] at runtime (set from PARAMS[key].val at init,
 * then mutated by the dev panel). This file is the single source of truth for
 * what parameters exist, their defaults, and their documentation.
 */

// ── Timing & display ──────────────────────────────────────────────────────────

export const UI_H = 46;              // toolbar height (px)
export const MIN_WATER = 1e-4;       // threshold below which water is "dry"
export const YEARS_PER_STEP = 200;   // geological time per simulation step
export const CONTOUR_INTERVAL = 0.04;
export const MAJOR_CONTOUR_EVERY = 5;
export const MOUNTAIN_THRESHOLD = 0.68;
export const RAINFALL_MAX = 0.0001;  // max rainfall injection per cell per step
export const MAX_SOURCES = 2;        // max auto-placed water sources
export const TARGET_FPS = 30;
export const FRAME_MS = 1000 / TARGET_FPS;
export const TECTONIC_INTERVAL = 20; // steps between tectonic updates
export const MAX_DELTA_PER_STEP = 0.005; // max terrain change per cell per step

// ── Tunable simulation parameters ─────────────────────────────────────────────

export const PARAMS = {
  // ─── Water Physics ───
  gravity: {
    val: 10, min: 1, max: 30, step: 0.5,
    unit: 'm/s\u00B2',
    desc: 'Gravitational acceleration. Drives water flow speed and shear stress.',
    group: 'water',
  },
  dt: {
    val: 0.35, min: 0.05, max: 1.0, step: 0.05,
    unit: 's',
    desc: 'Simulation timestep. Lower = more stable but slower. Upper bound for stability: dt < 1/(4g).',
    group: 'water',
  },
  damping: {
    val: 0.98, min: 0.8, max: 1.0, step: 0.005,
    unit: '',
    desc: 'Viscous damping. Fraction of flux momentum retained each step. 1.0 = frictionless, 0.8 = heavy friction.',
    group: 'water',
  },
  springRate: {
    val: 0.003, min: 0, max: 0.05, step: 0.001,
    unit: 'm\u00B3/step',
    desc: 'Water injection rate per source point.',
    group: 'water',
  },
  evapRate: {
    val: 0.005, min: 0, max: 0.2, step: 0.001,
    unit: '1/step',
    desc: 'Base evaporation fraction. Multiplied by stagnancy: still water evaporates faster.',
    group: 'water',
  },
  absorbRate: {
    val: 0.001, min: 0, max: 0.02, step: 0.0005,
    unit: '1/step',
    desc: 'Base ground absorption rate. Beach sand absorbs 16x faster.',
    group: 'water',
  },
  stagnantEvapMult: {
    val: 2.0, min: 0, max: 10.0, step: 0.1,
    unit: '',
    desc: 'Evaporation multiplier for stagnant water (speed ~ 0). Added to movingEvapMult weighted by stagnancy.',
    group: 'water',
  },
  movingEvapMult: {
    val: 0.01, min: 0, max: 1.0, step: 0.01,
    unit: '',
    desc: 'Evaporation multiplier for fast-moving water. Low = rivers barely evaporate.',
    group: 'water',
  },
  stagnantAbsorbMult: {
    val: 0.9, min: 0, max: 4.0, step: 0.05,
    unit: '',
    desc: 'Absorption multiplier for stagnant water.',
    group: 'water',
  },
  movingAbsorbMult: {
    val: 0.05, min: 0, max: 1.0, step: 0.01,
    unit: '',
    desc: 'Absorption multiplier for fast-moving water.',
    group: 'water',
  },

  // ─── Stream Power Erosion ───
  // Governing equation: E = K * tau^m * (1/H) * max(0, C_eq - S)
  // where tau = rho * g * v * slope * A  (velocity + flow accumulation shear)
  //       C_eq = Kc * v * sqrt(d)        (carrying capacity)
  K: {
    val: 0.5, min: 0, max: 2.0, step: 0.01,
    unit: '',
    desc: 'Erosion coefficient. Higher = faster channel incision. Scales with speed-squared and inverse hardness.',
    group: 'erosion',
  },
  m: {
    val: 1.0, min: 0.5, max: 2.0, step: 0.1,
    unit: '',
    desc: 'Shear stress exponent. 1.0 = linear (detachment-limited). 1.5 = turbulent scour. Higher = faster water erodes disproportionately more.',
    group: 'erosion',
  },
  Kc: {
    val: 0.18, min: 0, max: 0.5, step: 0.01,
    unit: '',
    desc: 'Carrying capacity coefficient. Higher = water can carry more sediment before depositing.',
    group: 'erosion',
  },
  Kd: {
    val: 0.015, min: 0, max: 0.1, step: 0.005,
    unit: '1/step',
    desc: 'Deposition rate. Fraction of excess sediment dropped per step when over capacity.',
    group: 'erosion',
  },
  asymmetry: {
    val: 2.5, min: 1.0, max: 5.0, step: 0.1,
    unit: '',
    desc: 'Meander asymmetry ratio. Outer bank erodes this many times faster than inner bank on curves. 1.0 = symmetric.',
    group: 'erosion',
  },
  erodeWaterMin: {
    val: 0.0001, min: 0, max: 0.01, step: 0.0001,
    unit: 'm',
    desc: 'Minimum water depth for erosion to occur. Prevents dry-cell erosion artifacts.',
    group: 'erosion',
  },
  erodeSpeedMin: {
    val: 0.3, min: 0, max: 1.0, step: 0.01,
    unit: 'm/s',
    desc: 'Minimum flow speed for erosion to occur. Prevents stagnant-pool erosion.',
    group: 'erosion',
  },

  // ─── Diffusion ───
  // Governing equation: dh/dt = kappa * laplacian(h)
  // Replaces: thermal smoothing, slope collapse, beach equalization
  kappaRock: {
    val: 0.001, min: 0, max: 0.01, step: 0.0005,
    unit: '1/step',
    desc: 'Diffusion rate for hard rock (bedrock, limestone). Very slow weathering.',
    group: 'diffusion',
  },
  kappaSoil: {
    val: 0.008, min: 0, max: 0.05, step: 0.001,
    unit: '1/step',
    desc: 'Diffusion rate for soil and soft rock (alluvium, clay). Hillslope creep.',
    group: 'diffusion',
  },
  kappaSand: {
    val: 0.08, min: 0, max: 0.3, step: 0.01,
    unit: '1/step',
    desc: 'Diffusion rate for beach sand. Fast leveling — sand cannot hold steep slopes.',
    group: 'diffusion',
  },

  // ─── Tectonics ───
  tectonicSpeed: {
    val: 0.15, min: 0, max: 1.0, step: 0.01,
    unit: 'cells/step',
    desc: 'Plate drift speed. 0 = frozen plates. Higher = faster mountain building.',
    group: 'tectonics',
  },
  upliftRate: {
    val: 0.0008, min: 0, max: 0.005, step: 0.0001,
    unit: 'm/step',
    desc: 'Convergent boundary uplift rate.',
    group: 'tectonics',
  },
  riftRate: {
    val: 0.0004, min: 0, max: 0.003, step: 0.0001,
    unit: 'm/step',
    desc: 'Divergent boundary rift rate.',
    group: 'tectonics',
  },
  quakeThreshold: {
    val: 2.0, min: 0.5, max: 5.0, step: 0.1,
    unit: '',
    desc: 'Fault stress threshold for earthquake triggering.',
    group: 'tectonics',
  },
  faultErosion: {
    val: 0.01, min: 0, max: 0.05, step: 0.005,
    unit: '1/step',
    desc: 'Smoothing rate along active fault lines.',
    group: 'tectonics',
  },

  // ─── Display ───
  heightScale: {
    val: 0.25, min: 0.05, max: 1.0, step: 0.05,
    unit: '',
    desc: '3D height exaggeration factor.',
    group: 'display',
  },
  waterThresh: {
    val: 0.0001, min: 0, max: 0.05, step: 0.0001,
    unit: 'm',
    desc: 'Minimum water depth to render. Higher = hides thin films, shows only real channels.',
    group: 'display',
  },
  waterAlphaMin: {
    val: 0.15, min: 0, max: 1.0, step: 0.01,
    unit: '',
    desc: 'Minimum water opacity. 0 = thin water invisible, 1 = all water fully opaque.',
    group: 'display',
  },
  waterAlphaDepth: {
    val: 0.85, min: 0, max: 1.0, step: 0.01,
    unit: '',
    desc: 'How much depth adds to opacity. Higher = deep water much more opaque than shallow.',
    group: 'display',
  },
  waterColorR: {
    val: 30, min: 0, max: 255, step: 1,
    unit: '',
    desc: 'Water base color — red channel (0-255). Lower = bluer.',
    group: 'display',
  },
  waterColorG: {
    val: 100, min: 0, max: 255, step: 1,
    unit: '',
    desc: 'Water base color — green channel (0-255).',
    group: 'display',
  },
  waterColorB: {
    val: 145, min: 0, max: 255, step: 1,
    unit: '',
    desc: 'Water base color — blue channel (0-255).',
    group: 'display',
  },
  waterSmoothing: {
    val: 3, min: 0, max: 10, step: 1,
    unit: 'passes',
    desc: 'Water edge softening passes. Higher = smoother edges, nearby dots merge into blobs.',
    group: 'display',
  },

  // ─── Flow Dynamics ───
  streamAttract: {
    val: 0.4, min: 0, max: 2.0, step: 0.01,
    unit: '',
    desc: 'Stream attraction. Cells send more water toward neighbors with high flux (active streams). Higher = stronger lateral capture, fewer wider rivers.',
    group: 'water',
  },
  fluxAmp: {
    val: 1000, min: 0, max: 5000, step: 10,
    unit: '',
    desc: 'Nonlinear flux amplification. Higher = stronger winner-take-all path selection. 0 = linear (sheet flow).',
    group: 'water',
  },
};

// Build a flat defaults object for quick state initialization
export const PARAM_DEFAULTS = {};
for (const [key, p] of Object.entries(PARAMS)) {
  PARAM_DEFAULTS[key] = p.val;
}

// ── Geological layers ─────────────────────────────────────────────────────────
// Each layer has a depth threshold (in effective depth units), hardness (erosion
// resistance multiplier), and RGB color for material view rendering.
//
// effectiveDepth = erosionDepth + elevationAboveSeaLevel * 1.4
// Mountains expose deep layers (bedrock) even without erosion.

export const LAYERS = [
  { depth: 0.00, hardness: 1.0,    r: 200, g: 184, b: 154, name: 'Alluvium' },
  { depth: 0.15, hardness: 2.5,    r: 176, g: 142, b: 110, name: 'Clay/silt' },
  { depth: 0.25, hardness: 15.0,   r: 160, g: 122, b:  80, name: 'Compacted clay' },
  { depth: 0.40, hardness: 80.0,   r: 138, g:  96, b:  64, name: 'Sandstone' },
  { depth: 0.55, hardness: 300.0,  r:  96, g: 112, b:  96, name: 'Limestone' },
  { depth: 0.70, hardness: 1500.0, r:  72, g:  80, b:  96, name: 'Bedrock' },
];

// ── Elevation color stops (terrain view) ──────────────────────────────────────

export const ELEV_STOPS = [
  [0.00,  45,  40,  30],
  [0.08,  65,  58,  42],
  [0.16,  95,  85,  60],
  [0.20, 155, 148, 115],
  [0.26, 165, 150,  95],
  [0.32, 125, 155,  82],
  [0.42, 100, 140,  68],
  [0.52, 130, 125,  68],
  [0.62, 148, 110,  62],
  [0.72, 138, 132, 128],
  [0.82, 175, 170, 165],
  [0.90, 215, 215, 220],
  [1.00, 242, 242, 248],
];
