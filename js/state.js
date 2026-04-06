// All mutable simulation state — single source of truth.
// Every module imports this and reads/writes via `state.property`.

import { SIM_DEFAULTS } from './constants.js';

const state = {
  // Grid dimensions
  GW: 0,
  GH: 0,

  // Grid arrays (allocated in initSim)
  terrain: null,
  origTerrain: null,
  water: null,
  sediment: null,
  hardness: null,
  hardnessNoise: null,
  fluxL: null, fluxR: null, fluxU: null, fluxD: null,
  flowSpeed: null,
  drainDist: null,
  saturation: null,
  hydraulicHead: null,
  trappedPressure: null,
  isOceanCell: null,
  initialFlowAccum: null,
  waterSmooth: null,

  // Simulation
  sources: [],
  oxbows: [],
  year: 0,
  running: true,
  hasOcean: false,
  seaLevel: 0.20,
  rainfallRate: 0,
  prevChannelCells: null,

  // Tectonics
  plates: [],
  tectonicStress: null,
  faultStress: null,
  stepsSinceTectonics: 0,

  // Tunable params (mutated by dev panel)
  ...SIM_DEFAULTS,

  // UI-driven slider values (decoupled from DOM)
  flowRateUI: 0.40,
  erodibilityUI: 0.35,
  hardnessDepthUI: 0.50,
  waterOpacityUI: 0.90,
  speedUI: 15,
  realtimeMode: false, // 1:1 mode: one sim step per render frame

  // View/UI state
  viewMode: 'terrain',
  showLayers: false,
  showContours: true,
  showPressure: false,
  showVelocity: false,
  showFaultLines: false,
  currentSeed: 42,

  // Camera
  camX: 0, camY: 0, camZoom: 1.0,

  // Generation params
  genOctaves: 6,
  genValley: 0.55,
  genRoughness: 0.50,
  genTerrainType: 'river_valley',
  genSeaLevel: 0.20,
  genMtnHeight: 0.50,
  genRainfall: 30,
  genMapKm: 25,         // map size in kilometers
  genCellsPerKm: 20,    // grid density: cells per kilometer
  genMapSize: 500,       // computed: genMapKm * genCellsPerKm
  genForceOcean: true,
  genNumPlates: 0,
  genErosionPasses: 1,

  // Render state
  imgFull: null,

  // 3D WebGL state
  gl: null,
  glProgram: null,
  glBuffers: null,
  glInited: false,
  orbitTheta: Math.PI * 0.25,
  orbitPhi: Math.PI * 0.35,
  orbitDist: 2.2,
  orbitDragging: false,
  orbitLastX: 0, orbitLastY: 0,

  // Interaction state
  isPanning: false,
  panStartX: 0, panStartY: 0,
  panStartCamX: 0, panStartCamY: 0,
  isCarving: false,
  carveMoved: false,
  isDraggingTool: false,
  dragToolType: null,
  editingSourceIdx: null,

  // Main loop
  lastRender: 0,
  stepsSinceOxbowCheck: 0,
};

export default state;
