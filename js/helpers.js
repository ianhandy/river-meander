// Shared helpers used by both simulation and rendering

import state from './state.js';
import { LAYERS } from './constants.js';

export function getHardness(i) {
  const { origTerrain, terrain, hardnessNoise, hardnessDepthUI } = state;
  const depthFraction = Math.max(0, origTerrain[i] - terrain[i]);
  let baseHardness = LAYERS[0].hardness;
  for (let l = LAYERS.length - 1; l >= 0; l--) {
    if (depthFraction >= LAYERS[l].depth * hardnessDepthUI * 1.5) {
      baseHardness = LAYERS[l].hardness;
      break;
    }
  }
  const noiseVal = hardnessNoise ? hardnessNoise[i] : 0.5;
  return baseHardness * (0.6 + noiseVal * 0.8);
}

export function layerColor(i) {
  const { origTerrain, terrain, hardnessDepthUI } = state;
  const depthFraction = Math.max(0, origTerrain[i] - terrain[i]);
  for (let l = LAYERS.length - 1; l >= 0; l--) {
    if (depthFraction >= LAYERS[l].depth * hardnessDepthUI * 1.5) return LAYERS[l];
  }
  return LAYERS[0];
}
