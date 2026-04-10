// Shared helpers used by both simulation and rendering

import state from '../data/state.js';
import { LAYERS } from '../data/constants.js';

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

// How "beachy" is this cell? 0 = not beach, 1 = full beach.
// Beach = near sea level, close to ocean, not submerged.
export function getBeachiness(i) {
  const { terrain, isOceanCell, seaLevel, GW, GH } = state;
  if (!isOceanCell || isOceanCell[i]) return 0;
  const elevAboveSea = terrain[i] - seaLevel;
  if (elevAboveSea < 0 || elevAboveSea > 0.06) return 0;

  const x = i % GW, y = (i / GW) | 0;
  let nearOcean = false;
  for (let dy = -3; dy <= 3 && !nearOcean; dy++) {
    for (let dx = -3; dx <= 3 && !nearOcean; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || nx >= GW || ny < 0 || ny >= GH) continue;
      if (isOceanCell[ny * GW + nx]) nearOcean = true;
    }
  }
  if (!nearOcean) return 0;

  return Math.max(0, 1 - elevAboveSea / 0.06);
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
  let h = baseHardness * (0.6 + noiseVal * 0.8);

  const beach = getBeachiness(i);
  if (beach > 0) h = h * (1 - beach) + 0.5 * beach;

  return h;
}

export function layerColor(i) {
  const depth = effectiveDepth(i);
  for (let l = LAYERS.length - 1; l >= 0; l--) {
    if (depth >= LAYERS[l].depth) return LAYERS[l];
  }
  return LAYERS[0];
}
