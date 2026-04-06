// Immutable configuration — defaults, layers, color stops

export const UI_H = 46;
export const MIN_WATER = 1e-4;
export const YEARS_PER_STEP = 200;
export const CONTOUR_INTERVAL = 0.04;
export const MAJOR_CONTOUR_EVERY = 5;
export const MOUNTAIN_THRESHOLD = 0.68;
export const RAINFALL_MAX = 0.0001;
export const MAX_SOURCES = 2;
export const TARGET_FPS = 30;
export const FRAME_MS = 1000 / TARGET_FPS;
export const TECTONIC_INTERVAL = 20;

export const LAYERS = [
  { depth: 0.00, hardness: 1.0,    r: 200, g: 184, b: 154 },  // alluvium
  { depth: 0.15, hardness: 2.5,    r: 176, g: 142, b: 110 },  // clay/silt
  { depth: 0.25, hardness: 15.0,   r: 160, g: 122, b:  80 },  // compacted clay
  { depth: 0.40, hardness: 80.0,   r: 138, g:  96, b:  64 },  // sandstone
  { depth: 0.55, hardness: 300.0,  r:  96, g: 112, b:  96 },  // limestone
  { depth: 0.70, hardness: 1500.0, r:  72, g:  80, b:  96 },  // bedrock
];

export const LAYER_NAMES = [
  'Alluvium', 'Clay/silt', 'Compacted clay', 'Sandstone', 'Limestone', 'Bedrock'
];

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

// Default values for all tunable SIM_* params (used by dev panel reset)
export const SIM_DEFAULTS = {
  SIM_GRAVITY: 10.0,
  SIM_DT: 0.35,
  SIM_SPRING_RATE: 0.003,
  SIM_EVAP: 0.01,
  SIM_ABSORB: 0.001,
  SIM_Kc: 0.18,
  SIM_Ks: 0.12,
  SIM_Kd: 0.015,
  SIM_Kt: 0.008,
  SIM_PRESSURE_WT: 0.4,
  SIM_WATER_THRESH: 0.0001,
  SIM_HEIGHT_SCALE: 0.25,
  SIM_TECTONIC_SPEED: 0.15,
  SIM_UPLIFT_RATE: 0.0008,
  SIM_RIFT_RATE: 0.0004,
  SIM_QUAKE_THRESHOLD: 2.0,
  SIM_FAULT_EROSION: 0.01,
  SIM_SLOPE_COLLAPSE: 30,
  SIM_VERTICAL_EROSION: true,
  SIM_MEANDER_ASYMMETRY: 3.0,
  SIM_LATERAL_RATE: 1.5,
  SIM_STAGNANT_EVAP: 2.0,
  SIM_STAGNANT_ABSORB: 0.9,
  SIM_MOVING_EVAP: 0.05,
  SIM_MOVING_ABSORB: 0.05,
  SIM_VISCOUS_DAMPING: 0.98,
};
