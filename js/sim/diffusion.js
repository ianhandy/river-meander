/**
 * diffusion.js — Terrain diffusion (hillslope processes).
 *
 * GOVERNING EQUATION:
 *
 *   dh/dt = kappa * laplacian(h)
 *
 *   where:
 *     h           = terrain elevation
 *     kappa       = diffusion coefficient (material-dependent, 1/step)
 *     laplacian   = (h_L + h_R + h_U + h_D - 4*h) / 4  (discrete 2D Laplacian)
 *
 * PHYSICAL INTERPRETATION:
 *
 *   Material moves downhill at a rate proportional to the local curvature
 *   of the terrain surface. Concave areas (valleys) fill in, convex areas
 *   (ridges) erode away. This models:
 *
 *   - Soil creep on hillslopes
 *   - Angle-of-repose collapse (steep slopes flatten)
 *   - Beach sand leveling (sand can't hold steep gradients)
 *   - Frost weathering on exposed rock
 *
 *   By using different kappa values for different materials, a single
 *   equation replaces the old thermal smoothing, slope collapse, AND
 *   beach equalization systems. Sand (kappa=0.08) levels 80x faster
 *   than bedrock (kappa=0.001), naturally producing flat beaches
 *   without special-case code.
 *
 * NUMERICAL METHOD:
 *
 *   Forward Euler with snapshot: reads terrain from a frozen copy,
 *   writes to terrainDelta. This prevents cascade (each cell sees
 *   the pre-step terrain, not partially-updated neighbors).
 *
 *   Stability constraint: kappa * dt < 0.25 for the discrete Laplacian.
 *   With kappa_max = 0.08 and dt = 0.35, kappa*dt = 0.028 < 0.25. Safe.
 *
 * REFERENCES:
 *   - Culling (1960), "Analytical theory of erosion"
 *   - Roering et al. (1999), "Evidence for nonlinear, diffusive sediment transport"
 *
 * WRITES TO: terrainDelta[] (never touches terrain directly)
 */

import state from '../data/state.js';
import { getBeachiness } from '../util/helpers.js';
import { LAYERS } from '../data/constants.js';

/**
 * Compute material-dependent diffusion coefficient for a cell.
 *
 * Interpolates between kappa_rock and kappa_soil based on hardness,
 * then blends toward kappa_sand based on beachiness.
 */
function getKappa(i) {
  const { kappaRock, kappaSoil, kappaSand, hardness } = state;
  const h = hardness[i];

  // Interpolate between rock and soil based on hardness
  // hardness 1 (alluvium) → full soil rate
  // hardness 1500 (bedrock) → full rock rate
  // Use log scale since hardness spans 3 orders of magnitude
  const logH = Math.log(Math.max(1, h));
  const logMin = 0;      // log(1) = 0
  const logMax = 7.3;    // log(1500) ~ 7.3
  const t = Math.min(1, Math.max(0, (logH - logMin) / (logMax - logMin)));
  let kappa = kappaSoil * (1 - t) + kappaRock * t;

  // Beach sand override: blend toward sand rate based on beachiness
  const beach = getBeachiness(i);
  if (beach > 0) {
    kappa = kappa * (1 - beach) + kappaSand * beach;
  }

  return kappa;
}

/**
 * Get the maximum slope angle a material can support.
 * Soft materials collapse at shallow angles, hard rock holds cliffs.
 *   alluvium (h=1): max slope 0.02 (very gentle)
 *   soil (h=2.5): max slope 0.04
 *   sandstone (h=80): max slope 0.15
 *   bedrock (h=1500): max slope 0.5 (near vertical)
 */
function getMaxSlope(i) {
  const { hardness } = state;
  const h = hardness[i];
  // Log scale: hardness 1 → 0.02, hardness 1500 → 0.5
  const logH = Math.log(Math.max(1, h));
  const t = Math.min(1, logH / 7.3);
  let maxSlope = 0.02 * (1 - t) + 0.5 * t;

  // Beach sand: very low angle of repose
  const beach = getBeachiness(i);
  if (beach > 0) {
    maxSlope = maxSlope * (1 - beach) + 0.015 * beach;
  }

  return maxSlope;
}

export function stepDiffusion() {
  const { terrain, terrainDelta, GW, GH } = state;

  // Snapshot terrain to prevent cascade
  const snap = terrain.slice();

  for (let y = 1; y < GH - 1; y++) {
    for (let x = 1; x < GW - 1; x++) {
      const i = y * GW + x;
      const h = snap[i];

      // ── Standard diffusion (slow creep) ─────────────────────────────────
      const laplacian = (snap[i - 1] + snap[i + 1] + snap[i - GW] + snap[i + GW] - 4 * h) * 0.25;
      const kappa = getKappa(i);
      let dh = kappa * laplacian;

      // ── Angle-of-repose collapse ────────────────────────────────────────
      // If slope to any neighbor exceeds the material's max angle,
      // material slides down. Soft materials collapse aggressively.
      const maxSlope = getMaxSlope(i);
      for (const ni of [i - 1, i + 1, i - GW, i + GW]) {
        const drop = h - snap[ni]; // positive = we're higher
        if (drop > maxSlope) {
          const excess = drop - maxSlope;
          const collapseRate = getKappa(i) * 10 + 0.01;
          const collapse = excess * Math.min(0.3, collapseRate);
          // Material slides from high cell to low cell — mass conserved
          dh -= collapse * 0.25;
          terrainDelta[ni] += collapse * 0.25;
        }
      }

      terrainDelta[i] += dh;
    }
  }
}
