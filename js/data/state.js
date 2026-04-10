/**
 * state.js — Single source of truth for all mutable simulation state.
 *
 * Every module imports this and reads/writes via `state.property`.
 * Grid arrays are allocated in initSim() and are flat Float32Arrays
 * indexed as: i = y * GW + x
 *
 * Delta buffers (terrainDelta, sedimentDelta) are zeroed each step by
 * pipeline.js. Simulation systems write deltas; pipeline applies them.
 */

import { PARAM_DEFAULTS } from './constants.js';

const state = {
  // ── Grid dimensions ─────────────────────────────────────────────────────────
  GW: 0,
  GH: 0,

  // ── Grid arrays (allocated in initSim) ──────────────────────────────────────
  //
  // Primary state:
  terrain: null,       // Float32Array — bedrock + deposited material height
  water: null,         // Float32Array — surface water depth
  sediment: null,      // Float32Array — suspended sediment load
  hardness: null,      // Float32Array — material erosion resistance (derived)
  hardnessNoise: null, // Float32Array — per-cell noise for hardness variation
  //
  // Flux (pipe model — 8 directional flow rates):
  fluxL: null,         // Float32Array — leftward flux
  fluxR: null,         // Float32Array — rightward flux
  fluxU: null,         // Float32Array — upward flux
  fluxD: null,         // Float32Array — downward flux
  fluxUL: null,        // Float32Array — upper-left diagonal flux
  fluxUR: null,        // Float32Array — upper-right diagonal flux
  fluxDL: null,        // Float32Array — lower-left diagonal flux
  fluxDR: null,        // Float32Array — lower-right diagonal flux
  flowSpeed: null,     // Float32Array — velocity magnitude (derived from flux/depth)
  //
  // Delta buffers (zeroed each step, written by sim systems, applied once):
  terrainDelta: null,  // Float32Array — proposed terrain changes
  sedimentDelta: null, // Float32Array — proposed sediment changes
  //
  // Ocean & drainage:
  isOceanCell: null,   // Uint8Array — 1 if cell is ocean-connected below sea level
  drainDist: null,     // Float32Array — BFS distance to nearest ocean/drain
  saturation: null,    // Float32Array — ground saturation (0-1)
  hydraulicHead: null, // Float32Array — water surface elevation from ocean
  trappedPressure: null, // Float32Array — pressure from isolated pools
  //
  // Snapshots for initial state:
  origTerrain: null,   // Float32Array — terrain at generation time (for depth calc)
  initialFlowAccum: null, // Float32Array — particle erosion flow accumulation
  //
  // Render scratch:
  waterSmooth: null,   // Float32Array — smoothed water for rendering

  // ── Simulation state ────────────────────────────────────────────────────────
  sources: [],         // Array<{gx, gy, rate}> — water source points
  oxbows: [],          // Array<{cells, age, cx, cy}> — detected oxbow lakes
  year: 0,             // geological time elapsed
  running: true,       // simulation active flag
  hasOcean: false,     // whether any ocean cells exist
  seaLevel: 0.20,      // current sea level elevation
  rainfallRate: 0,     // active rainfall rate (fraction of RAINFALL_MAX)
  prevChannelCells: null, // Set — previous step's channel cells (for oxbow detection)

  // ── Tectonics ───────────────────────────────────────────────────────────────
  plates: [],          // Array<{px, py, vx, vy}> — tectonic plates
  tectonicStress: null, // Float32Array — convergence/divergence field
  faultStress: null,   // Float32Array — accumulated fault stress
  stepsSinceTectonics: 0,

  // ── Tunable parameters (mutated by dev panel) ──────────────────────────────
  ...PARAM_DEFAULTS,

  // ── UI-driven values (decoupled from DOM sliders) ──────────────────────────
  flowRateUI: 0.40,       // source flow rate multiplier (0-1)
  erodibilityUI: 0.35,    // global erosion multiplier (0-1)
  hardnessDepthUI: 0.50,  // layer depth mapping scale (0-1)
  waterOpacityUI: 0.90,   // water rendering opacity (0-1)
  speedUI: 15,            // sim steps per frame multiplier
  realtimeMode: false,    // 1:1 mode: one sim step per render frame

  // ── View state ──────────────────────────────────────────────────────────────
  viewMode: 'terrain',    // 'terrain' | 'height' | 'exposed' | 'material' | '3d'
  showLayers: false,
  showContours: true,
  showPressure: false,
  showVelocity: false,
  showFaultLines: false,
  showEquations: false,   // toggle equation tooltip mode
  showStreams: false,     // toggle pink stream highlight overlay
  currentSeed: 42,

  // ── Camera ──────────────────────────────────────────────────────────────────
  camX: 0, camY: 0, camZoom: 1.0,

  // ── Generation parameters ───────────────────────────────────────────────────
  genOctaves: 6,
  genValley: 0.55,
  genRoughness: 0.50,
  genTerrainType: 'river_valley',
  genSeaLevel: 0.20,
  genMtnHeight: 0.50,
  genRainfall: 30,
  genMapKm: 25,
  genCellsPerKm: 20,
  genMapSize: 500,
  genForceOcean: true,
  genNumPlates: 0,
  genErosionPasses: 1,

  // ── Render state ────────────────────────────────────────────────────────────
  imgFull: null,

  // ── 3D WebGL state ──────────────────────────────────────────────────────────
  gl: null,
  glProgram: null,
  glWaterProg: null,
  glBuffers: null,
  glInited: false,
  orbitTheta: Math.PI * 0.25,
  orbitPhi: Math.PI * 0.35,
  orbitDist: 2.2,
  orbitDragging: false,
  orbitLastX: 0, orbitLastY: 0,

  // ── Interaction state ───────────────────────────────────────────────────────
  isPanning: false,
  panStartX: 0, panStartY: 0,
  panStartCamX: 0, panStartCamY: 0,
  isCarving: false,
  carveMoved: false,
  isDraggingTool: false,
  dragToolType: null,
  editingSourceIdx: null,
  hoveredCell: -1,       // grid index of cell under cursor (-1 = none)

  // ── Main loop ───────────────────────────────────────────────────────────────
  lastRender: 0,
  stepsSinceOxbowCheck: 0,
};

export default state;
