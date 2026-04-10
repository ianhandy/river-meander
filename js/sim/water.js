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
  const { terrain, water, fluxL, fluxR, fluxU, fluxD, fluxUL, fluxUR, fluxDL, fluxDR,
          flowSpeed, saturation, isOceanCell, sources,
          GW, GH, dt: rawDt, gravity, springRate,
          evapRate, absorbRate, stagnantEvapMult, stagnantAbsorbMult,
          movingEvapMult, movingAbsorbMult, damping,
          flowRateUI, rainfallRate, seaLevel } = state;

  const dt = Math.max(0.05, Math.min(1.0, rawDt));
  const g = gravity;
  const N = GW * GH;
  const wThresh = state.waterThresh || 0.002;

  // ── Kill invisible water ────────────────────────────────────────────────
  // If it doesn't get rendered, it doesn't exist. This prevents invisible
  // thin films from secretly draining pressure or creating ghost flows.
  for (let i = 0; i < N; i++) {
    if (water[i] > 0 && water[i] < wThresh && !isOceanCell[i]) {
      water[i] = 0;
      fluxL[i] = 0; fluxR[i] = 0; fluxU[i] = 0; fluxD[i] = 0;
      fluxUL[i] = 0; fluxUR[i] = 0; fluxDL[i] = 0; fluxDR[i] = 0;
    }
  }

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

  // ── Pass 1: Update outflow fluxes (8 directions) ────────────────────────
  //
  // 8 flux channels: 4 cardinal + 4 diagonal.
  // Diagonal flux weighted by 1/sqrt(2) ≈ 0.707 since the distance is longer.

  const DIAG_W = 0.707; // 1/sqrt(2)
  const AMP = state.fluxAmp;
  const ATTRACT = state.streamAttract;

  for (let y = 0; y < GH; y++) {
    for (let x = 0; x < GW; x++) {
      const i = y * GW + x;

      // Viscous damping
      fluxL[i] *= damping; fluxR[i] *= damping;
      fluxU[i] *= damping; fluxD[i] *= damping;
      fluxUL[i] *= damping; fluxUR[i] *= damping;
      fluxDL[i] *= damping; fluxDR[i] *= damping;

      const h = terrain[i] + water[i];
      const w = water[i];
      const bedGrav = w > 0.0005 ? w * g * BED_GRAVITY_COEFF : 0;

      // Compute flux for one neighbor direction
      const calcFlux = (oldFlux, ni, isOcean_ni, distWeight) => {
        const surfaceDiff = h - terrain[ni] - water[ni];
        const nlDiff = surfaceDiff * (1 + Math.abs(surfaceDiff) * AMP);
        const bedSlope = terrain[i] - terrain[ni];

        let slopeBoost;
        if (isOcean_ni) {
          slopeBoost = 10.0;
        } else if (bedSlope > 0) {
          slopeBoost = 1 + bedSlope * 1000;
        } else {
          slopeBoost = 0.02;
        }

        // Stream attraction: sum ALL 8 fluxes of neighbor
        const nFlux = fluxL[ni] + fluxR[ni] + fluxU[ni] + fluxD[ni]
                    + fluxUL[ni] + fluxUR[ni] + fluxDL[ni] + fluxDR[ni];
        const streamPull = nFlux * ATTRACT;

        const newFlux = oldFlux + (dt * g * nlDiff * distWeight + bedGrav * Math.max(0, bedSlope) * distWeight) * slopeBoost + streamPull * distWeight;

        if (newFlux <= 0 && oldFlux > 0.001) {
          return oldFlux * 0.85;
        }
        return Math.max(0, newFlux);
      };

      // 4 cardinal directions (weight 1.0)
      if (x < GW - 1) fluxR[i] = calcFlux(fluxR[i], i + 1, isOceanCell[i + 1], 1);
      else fluxR[i] = Math.max(0, fluxR[i] + dt * g * w);

      if (x > 0) fluxL[i] = calcFlux(fluxL[i], i - 1, isOceanCell[i - 1], 1);
      else fluxL[i] = Math.max(0, fluxL[i] + dt * g * w);

      if (y < GH - 1) fluxD[i] = calcFlux(fluxD[i], i + GW, isOceanCell[i + GW], 1);
      else fluxD[i] = Math.max(0, fluxD[i] + dt * g * w);

      if (y > 0) fluxU[i] = calcFlux(fluxU[i], i - GW, isOceanCell[i - GW], 1);
      else fluxU[i] = Math.max(0, fluxU[i] + dt * g * w);

      // 4 diagonal directions (weight 0.707)
      if (x > 0 && y > 0) {
        const ni = i - GW - 1;
        fluxUL[i] = calcFlux(fluxUL[i], ni, isOceanCell[ni], DIAG_W);
      } else { fluxUL[i] = 0; }

      if (x < GW - 1 && y > 0) {
        const ni = i - GW + 1;
        fluxUR[i] = calcFlux(fluxUR[i], ni, isOceanCell[ni], DIAG_W);
      } else { fluxUR[i] = 0; }

      if (x > 0 && y < GH - 1) {
        const ni = i + GW - 1;
        fluxDL[i] = calcFlux(fluxDL[i], ni, isOceanCell[ni], DIAG_W);
      } else { fluxDL[i] = 0; }

      if (x < GW - 1 && y < GH - 1) {
        const ni = i + GW + 1;
        fluxDR[i] = calcFlux(fluxDR[i], ni, isOceanCell[ni], DIAG_W);
      } else { fluxDR[i] = 0; }

      // Flux normalization: all 8 directions
      const totalOut = (fluxL[i] + fluxR[i] + fluxU[i] + fluxD[i]
                      + fluxUL[i] + fluxUR[i] + fluxDL[i] + fluxDR[i]) * dt;
      if (totalOut > water[i] + MIN_WATER) {
        const scale = (water[i] + MIN_WATER) / totalOut;
        fluxL[i] *= scale; fluxR[i] *= scale;
        fluxU[i] *= scale; fluxD[i] *= scale;
        fluxUL[i] *= scale; fluxUR[i] *= scale;
        fluxDL[i] *= scale; fluxDR[i] *= scale;
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

      // Inflow from all 8 neighbors (their outflow toward us)
      const inR  = x > 0                ? fluxR[i - 1]      : 0;
      const inL  = x < GW - 1           ? fluxL[i + 1]      : 0;
      const inD  = y > 0                ? fluxD[i - GW]      : 0;
      const inU  = y < GH - 1           ? fluxU[i + GW]      : 0;
      const inDR = (x > 0 && y > 0)     ? fluxDR[i - GW - 1] : 0;
      const inDL = (x < GW-1 && y > 0)  ? fluxDL[i - GW + 1] : 0;
      const inUR = (x > 0 && y < GH-1)  ? fluxUR[i + GW - 1] : 0;
      const inUL = (x < GW-1 && y < GH-1) ? fluxUL[i + GW + 1] : 0;

      const totalIn = inR + inL + inD + inU + inDR + inDL + inUR + inUL;
      const totalOutFlux = fluxL[i] + fluxR[i] + fluxU[i] + fluxD[i]
                         + fluxUL[i] + fluxUR[i] + fluxDL[i] + fluxDR[i];
      const net = (totalIn - totalOutFlux) * dt;
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
        // Directionality across all 8 flux channels.
        // River = most flux in one direction. Pool = spread evenly.
        const allFlux = [fluxL[i], fluxR[i], fluxU[i], fluxD[i],
                         fluxUL[i], fluxUR[i], fluxDL[i], fluxDR[i]];
        let totalFlux = 0, dominant = 0;
        for (let f = 0; f < 8; f++) {
          totalFlux += allFlux[f];
          if (allFlux[f] > dominant) dominant = allFlux[f];
        }
        const directionality = totalFlux > 0.0001 ? dominant / totalFlux : 0; // 0.125-1.0
        // Only count as speed if flow is directional (> 0.25 = mostly one way)
        const wd = Math.max(water[i], 0.01);
        const spd = directionality > 0.2 ? dominant * (directionality - 0.125) / wd : 0;
        flowSpeed[i] = flowSpeed[i] * 0.8 + spd * 0.2;

        // ── Stagnancy ─────────────────────────────────────────────────────
        // Smooth curve: 1.0 at rest, decays exponentially with speed
        const stagnancy = Math.exp(-flowSpeed[i] * 5);

        // ── Is this water still filling or already overflowing? ──────────
        // Filling = water surface below all neighbor terrain = trapped.
        // Overflowing = water surface above at least one neighbor terrain.
        // Filling water should NOT evaporate — it needs to rise.
        const waterSurf = terrain[i] + water[i];
        let isOverflowing = false;
        if (water[i] > 0) {
          for (const ni of [i-1, i+1, i-GW, i+GW]) {
            if (ni < 0 || ni >= GW * GH) continue;
            if (isOceanCell[ni]) { isOverflowing = true; break; }
            if (waterSurf > terrain[ni]) { isOverflowing = true; break; }
          }
        }

        // ── Evaporation ───────────────────────────────────────────────────
        if (water[i] > 0) {
          const evapMult = movingEvapMult + stagnancy * stagnantEvapMult;
          let evapFrac = evapRate * evapMult;

          if (!isOverflowing) {
            // Still filling — don't evaporate. Water must rise.
            evapFrac = 0;
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

          // Filling water saturates the ground — stops absorbing
          if (!isOverflowing || (stagnancy > 0.9 && water[i] > 0.01)) {
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
