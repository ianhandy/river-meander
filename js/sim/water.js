/**
 * water.js — Pipe-model shallow water simulation.
 *
 * GOVERNING EQUATIONS:
 *
 * This implements the pipe model from Mei{ss}ner et al. (2007):
 * water flows between cells through virtual pipes driven by pressure
 * differences. Each cell has four outgoing flux values (L, R, U, D).
 *
 *   Flux update:    f_{t+1} = damp * f_t + dt * g * dh
 *   Mass balance:   w_{t+1} = w_t + dt * (sum_in - sum_out)
 *   Velocity:       v = |flux| / depth  (Venturi: narrow/shallow = fast)
 *
 * TWO PRESSURE SOURCES drive flux:
 *
 *   1. Surface pressure: water flows from high water surface to low
 *      dh = (terrain_i + water_i) - (terrain_j + water_j)
 *
 *   2. Bed gravity: water's own weight on a slope pulls it downhill
 *      F_bed = depth * g * bed_gravity_coeff * max(0, terrain_i - terrain_j)
 *      This prevents water from pooling on slopes when surface is level.
 *
 * STABILITY:
 *   - Viscous damping (0.98) prevents flux oscillation
 *   - Flux normalization ensures outflow <= available water
 *   - Timestep clamped to [0.05, 1.0]
 *
 * EVAPORATION MODEL:
 *   Fractional: water *= (1 - evapFrac)
 *   evapFrac = baseRate * (movingMult + stagnancy * stagnantMult)
 *   Stagnancy = exp(-speed * 5): smooth 1.0 at rest → 0.0 at high speed
 *   This means puddles evaporate fast, rivers barely lose water.
 */

import state from '../data/state.js';
import { MIN_WATER } from '../data/constants.js';
import { getOceanLevel } from '../util/ocean.js';
import { getBeachiness } from '../util/helpers.js';

const BED_GRAVITY_COEFF = 0.6;

export function stepWater() {
  const { terrain, water, fluxL, fluxR, fluxU, fluxD, flowSpeed,
          saturation, isOceanCell, sources,
          GW, GH, dt: rawDt, gravity, springRate,
          evapRate, absorbRate, stagnantEvapMult, stagnantAbsorbMult,
          movingEvapMult, movingAbsorbMult, damping,
          flowRateUI, rainfallRate, seaLevel } = state;

  const dt = Math.max(0.05, Math.min(1.0, rawDt));
  const g = gravity;
  const N = GW * GH;

  // ── Inject water at sources ─────────────────────────────────────────────
  for (const src of sources) {
    const si = src.gy * GW + src.gx;
    if (si >= 0 && si < N) {
      water[si] += springRate * flowRateUI;
    }
  }

  // ── Rainfall ────────────────────────────────────────────────────────────
  if (rainfallRate > 0) {
    for (let i = 0; i < N; i++) {
      if (!isOceanCell[i]) water[i] += rainfallRate;
    }
  }

  // ── Pass 1: Update outflow fluxes ───────────────────────────────────────
  //
  // For each cell, compute flux in 4 directions from:
  //   f = damp * f_old + dt * g * surfaceDiff + bedGravity
  //
  // Then normalize so total outflow * dt <= available water.

  for (let y = 0; y < GH; y++) {
    for (let x = 0; x < GW; x++) {
      const i = y * GW + x;

      // Viscous damping: retain momentum from previous step
      fluxL[i] *= damping;
      fluxR[i] *= damping;
      fluxU[i] *= damping;
      fluxD[i] *= damping;

      const h = terrain[i] + water[i]; // water surface elevation
      const w = water[i];

      // Bed gravity: water weight creates downhill pull
      // Only active when cell actually has water (prevents phantom forces)
      const bedGrav = w > 0.0005 ? w * g * BED_GRAVITY_COEFF : 0;

      // Nonlinear flux amplification: "winner take all" drainage.
      // A cell that's even slightly lower gets disproportionately more flow.
      //   nonlinear: force = surfaceDiff * (1 + |surfaceDiff| * AMP)
      const AMP = state.fluxAmp;

      // Stream attraction: if a neighbor already carries high flux (it's
      // part of an active stream), boost our flux toward it. Water is
      // drawn into existing channels like tributaries joining a river.
      //   streamPull = neighborTotalFlux * ATTRACT
      // This creates lateral capture — adjacent cells converge on the
      // dominant flow path instead of flowing independently.
      const ATTRACT = state.streamAttract;

      // Helper: compute flux toward a neighbor.
      // Steep downhill = boosted flux. Gentle slope = penalized.
      // slopeBoost: terrain drop per cell. A drop of 0.1 = steep = boost 10x.
      // A drop of 0.001 = gentle = boost 0.1x (penalty).
      // Ocean neighbors always count as maximum relief (steep drop).
      const calcFlux = (oldFlux, ni, isOcean_ni) => {
        const surfaceDiff = h - terrain[ni] - water[ni];
        const nlDiff = surfaceDiff * (1 + Math.abs(surfaceDiff) * AMP);
        const bedSlope = terrain[i] - terrain[ni]; // positive = downhill

        // Slope steepness factor: water wants the steepest path.
        // Normalize bed slope: 0 = flat, 1 = very steep drop.
        // Ocean = maximum steepness (full relief).
        let slopeBoost;
        if (isOcean_ni) {
          slopeBoost = 10.0; // ocean is maximum relief
        } else if (bedSlope > 0) {
          // Downhill: strong preference for steepest drop.
          // bedSlope 0.01 → boost 2, bedSlope 0.05 → boost 26, bedSlope 0.1 → boost 101
          slopeBoost = 1 + bedSlope * 1000;
        } else {
          // Uphill: near-zero — water avoids going up
          slopeBoost = 0.02;
        }

        const neighborFlux = fluxL[ni] + fluxR[ni] + fluxU[ni] + fluxD[ni];
        const streamPull = neighborFlux * ATTRACT;

        return Math.max(0, oldFlux + (dt * g * nlDiff + bedGrav * Math.max(0, bedSlope)) * slopeBoost + streamPull);
      };

      // Right neighbor
      if (x < GW - 1) {
        const ni = i + 1;
        fluxR[i] = calcFlux(fluxR[i], ni, isOceanCell[ni]);
      } else {
        fluxR[i] = Math.max(0, fluxR[i] + dt * g * w);
      }

      // Left neighbor
      if (x > 0) {
        const ni = i - 1;
        fluxL[i] = calcFlux(fluxL[i], ni, isOceanCell[ni]);
      } else {
        fluxL[i] = Math.max(0, fluxL[i] + dt * g * w);
      }

      // Down neighbor
      if (y < GH - 1) {
        const ni = i + GW;
        fluxD[i] = calcFlux(fluxD[i], ni, isOceanCell[ni]);
      } else {
        fluxD[i] = Math.max(0, fluxD[i] + dt * g * w);
      }

      // Up neighbor
      if (y > 0) {
        const ni = i - GW;
        fluxU[i] = calcFlux(fluxU[i], ni, isOceanCell[ni]);
      } else {
        fluxU[i] = Math.max(0, fluxU[i] + dt * g * w);
      }

      // Flux normalization: ensure outflow doesn't exceed available water
      const totalOut = (fluxL[i] + fluxR[i] + fluxU[i] + fluxD[i]) * dt;
      if (totalOut > water[i] + MIN_WATER) {
        const scale = (water[i] + MIN_WATER) / totalOut;
        fluxL[i] *= scale;
        fluxR[i] *= scale;
        fluxU[i] *= scale;
        fluxD[i] *= scale;
      }
    }
  }

  // ── Pass 2: Update water depth ──────────────────────────────────────────
  //
  // Net water change = sum of inflows from neighbors - sum of outflows
  // Then apply evaporation, absorption, and edge drainage.

  let maxDepth = 0;
  const oLvl = getOceanLevel();

  for (let y = 0; y < GH; y++) {
    for (let x = 0; x < GW; x++) {
      const i = y * GW + x;

      // Inflow from neighbors (their outflow toward us)
      const inR = x > 0      ? fluxR[i - 1]  : 0;
      const inL = x < GW - 1 ? fluxL[i + 1]  : 0;
      const inD = y > 0      ? fluxD[i - GW]  : 0;
      const inU = y < GH - 1 ? fluxU[i + GW]  : 0;

      const net = (inR + inL + inD + inU - fluxL[i] - fluxR[i] - fluxU[i] - fluxD[i]) * dt;
      water[i] = Math.max(0, water[i] + net);

      if (isOceanCell[i]) {
        // Ocean cells held at sea level with relaxation
        const target = Math.max(0, oLvl - terrain[i]);
        if (water[i] > target) {
          water[i] -= (water[i] - target) * 0.4;
        } else {
          water[i] = target;
        }
      } else {
        // ── Velocity ──────────────────────────────────────────────────────
        // Speed = how directional is the flow?
        // A river has most flux going one way. A pool spreads evenly.
        //
        // Dominant flux: the largest single outgoing flux direction.
        // Total flux: sum of all outgoing flux.
        // Directionality: dominant / total. 1.0 = river, 0.25 = pool.
        //
        // Speed = (dominant flux) * directionality / depth
        // This makes pools near-zero and rivers fast.
        const fL = fluxL[i], fR = fluxR[i], fU = fluxU[i], fD = fluxD[i];
        const totalFlux = fL + fR + fU + fD;
        const dominant = Math.max(fL, fR, fU, fD);
        const directionality = totalFlux > 0.0001 ? dominant / totalFlux : 0; // 0.25-1.0
        // Only count as speed if flow is directional (> 0.5 = mostly one way)
        const wd = Math.max(water[i], 0.01);
        const spd = directionality > 0.35 ? dominant * (directionality - 0.25) / wd : 0;
        flowSpeed[i] = flowSpeed[i] * 0.8 + spd * 0.2;

        // ── Stagnancy ─────────────────────────────────────────────────────
        // Smooth curve: 1.0 at rest, decays exponentially with speed
        const stagnancy = Math.exp(-flowSpeed[i] * 5);

        // ── Evaporation ───────────────────────────────────────────────────
        // Does this water have a real outlet? An outlet is ocean, or a
        // neighbor that's ALREADY flowing (has significant outgoing flux).
        // A gentle slope isn't an outlet — water needs to find an actual
        // drain path, not just a slightly lower neighbor.
        let hasOutlet = false;
        if (water[i] > 0) {
          for (const ni of [i-1, i+1, i-GW, i+GW]) {
            if (ni < 0 || ni >= GW * GH) continue;
            if (isOceanCell[ni]) { hasOutlet = true; break; }
            // A neighbor is an outlet if it's already part of a flowing stream
            const nFlux = fluxL[ni] + fluxR[ni] + fluxU[ni] + fluxD[ni];
            if (nFlux > 0.05 && terrain[ni] < terrain[i]) { hasOutlet = true; break; }
          }
        }

        // ── Evaporation ───────────────────────────────────────────────────
        if (water[i] > 0) {
          const evapMult = movingEvapMult + stagnancy * stagnantEvapMult;
          let evapFrac = evapRate * evapMult;

          if (!hasOutlet) {
            evapFrac *= 0.02; // contained — barely evaporates
          }

          water[i] *= (1 - Math.min(0.5, evapFrac));
        }

        // ── Absorption ────────────────────────────────────────────────────
        // Beach sand absorbs 16x faster than regular ground.
        // Contained water (no relief) has saturated ground — skip absorption.
        if (water[i] > 0 && saturation[i] < 1.0) {
          const absorbMult = movingAbsorbMult + stagnancy * stagnantAbsorbMult;
          const beach = getBeachiness(i);
          const beachBoost = 1 + beach * 15;
          let absorbFrac = absorbRate * absorbMult * (1.0 - saturation[i]) * beachBoost;

          // Contained water saturates the ground — stops absorbing
          if (!hasOutlet || (stagnancy > 0.9 && water[i] > 0.01)) {
            saturation[i] = 1.0;
            absorbFrac = 0;
          }

          const absorbed = water[i] * Math.min(0.5, absorbFrac);
          water[i] -= absorbed;
          saturation[i] = Math.min(1.0, saturation[i] + absorbed * 10);
        } else if (water[i] <= 0 && saturation[i] > 0) {
          const beach = getBeachiness(i);
          saturation[i] = Math.max(0, saturation[i] - 0.001 * (1 + beach * 5));
        }

        // ── Edge drainage ─────────────────────────────────────────────────
        if (x === 0 || x === GW - 1 || y === 0 || y === GH - 1) {
          if (isOceanCell[i]) {
            water[i] = Math.max(0, seaLevel - terrain[i]);
          } else {
            water[i] *= 0.7; // 30% drain per step at non-ocean edges
          }
        }
      }

      if (water[i] > maxDepth) maxDepth = water[i];
    }
  }

  return maxDepth;
}
