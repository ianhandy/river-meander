// Shared helpers used by both simulation and rendering

import state from './state.js';
import { LAYERS } from './constants.js';

// Effective depth in the layer stack: combines elevation + erosion.
// High terrain = deep in stack (bedrock), low terrain = shallow (alluvium).
// Erosion cuts through layers from the surface down.
function effectiveDepth(i) {
  const { origTerrain, terrain, hardnessDepthUI, seaLevel } = state;
  const erosionDepth = Math.max(0, origTerrain[i] - terrain[i]);
  const elevAboveSea = Math.max(0, terrain[i] - seaLevel);
  const elevContrib = Math.min(0.7, elevAboveSea * 1.4);
  return (erosionDepth + elevContrib) * hardnessDepthUI * 1.5;
}

export function getHardness(i) {
  const { hardnessNoise } = state;
  const depth = effectiveDepth(i);
  let baseHardness = LAYERS[0].hardness;
  for (let l = LAYERS.length - 1; l >= 0; l--) {
    if (depth >= LAYERS[l].depth) {
      baseHardness = LAYERS[l].hardness;
      break;
    }
  }
  const noiseVal = hardnessNoise ? hardnessNoise[i] : 0.5;
  return baseHardness * (0.6 + noiseVal * 0.8);
}

export function layerColor(i) {
  const depth = effectiveDepth(i);
  for (let l = LAYERS.length - 1; l >= 0; l--) {
    if (depth >= LAYERS[l].depth) return LAYERS[l];
  }
  return LAYERS[0];
}
