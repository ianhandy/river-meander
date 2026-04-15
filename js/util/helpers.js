// Shared helpers used by both simulation and rendering

import state from '../data/state.js';
import { LAYERS } from '../data/constants.js';

// Effective depth in the layer stack: combines elevation + erosion.
// High terrain = deep in stack (bedrock), low terrain = shallow (alluvium).
// Erosion cuts through layers from the surface down.
function effectiveDepth(i) {
  const { origTerrain, terrain, hardnessDepthUI, seaLevel } = state;
  const erosionDepth = origTerrain ? Math.max(0, origTerrain[i] - terrain[i]) : 0;
  const elevAboveSea = Math.max(0, terrain[i] - seaLevel);
  const elevContrib = Math.min(0.7, elevAboveSea * 1.4);
  return (erosionDepth + elevContrib) * hardnessDepthUI * 1.5;
}

// How "beachy" is this cell? 0 = not beach, 1 = full beach.
// Beach = near sea level, close to ocean, not submerged, and NOT a flowing river.
// Flowing water prevents sand from accumulating — rivers cut through to the ocean.
export function getBeachiness(i) {
  const { terrain, isOceanCell, seaLevel, flowSpeed, GW, GH } = state;
  if (!isOceanCell || isOceanCell[i]) return 0;

  // Rivers near the ocean are channels, not beaches
  if (flowSpeed && flowSpeed[i] > 0.1) return 0;

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

// Textured layer color: smooth blending between geological layer boundaries
// using low-frequency noise for wobbly edges, plus high-frequency per-cell
// grain for material texture (e.g. sandy speckle in alluvium, crystalline
// facets in bedrock). Deeper = harder rock = higher grain contrast.
export function layerColorTextured(i) {
  const { hardnessNoise, grainTexture } = state;
  const depth = effectiveDepth(i);

  // Add low-freq noise to create irregular layer boundaries
  const noiseA = hardnessNoise ? hardnessNoise[i] : 0.5;
  const noisyDepth = depth + (noiseA - 0.5) * 0.06;

  // Find the two surrounding layers for blending
  let loIdx = 0;
  for (let l = LAYERS.length - 1; l >= 0; l--) {
    if (noisyDepth >= LAYERS[l].depth) { loIdx = l; break; }
  }
  const hiIdx = Math.min(LAYERS.length - 1, loIdx + 1);
  const loLayer = LAYERS[loIdx];
  const hiLayer = LAYERS[hiIdx];

  // Smooth blend across layer boundary (smooth-step for soft cross-fade)
  const layerRange = hiLayer.depth - loLayer.depth;
  let blendT = layerRange > 0 ? (noisyDepth - loLayer.depth) / layerRange : 0;
  blendT = Math.max(0, Math.min(1, blendT));
  blendT = blendT * blendT * (3 - 2 * blendT); // smooth-step

  let r = loLayer.r + (hiLayer.r - loLayer.r) * blendT;
  let g = loLayer.g + (hiLayer.g - loLayer.g) * blendT;
  let b = loLayer.b + (hiLayer.b - loLayer.b) * blendT;

  // High-frequency grain: each layer has characteristic texture strength.
  // Alluvium=fine sand, clay=streaky, sandstone=speckled, bedrock=crystalline.
  const grain = grainTexture ? grainTexture[i] : 0.5;
  const grainStr = [10, 14, 12, 18, 14, 22][loIdx] || 14;
  const texOffset = (grain - 0.5) * grainStr;
  r = Math.max(0, Math.min(255, r + texOffset));
  g = Math.max(0, Math.min(255, g + texOffset * 0.85));
  b = Math.max(0, Math.min(255, b + texOffset * 0.7));

  return { r: r | 0, g: g | 0, b: b | 0 };
}
