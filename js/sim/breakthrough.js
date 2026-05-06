/**
 * breakthrough.js — Hydrostatic pressure erosion for pooled water.
 *
 * PHYSICAL MODEL:
 *
 *   When water pools behind a barrier (dam, ridge, moraine), the
 *   hydrostatic pressure at the base of the pool pushes against
 *   the barrier. Over time, this pressure erodes the weakest point
 *   in the barrier rim, eventually carving an outlet.
 *
 *   This is how real lakes find outlets: water doesn't spill evenly
 *   over the rim — it concentrates on the lowest/softest point and
 *   erodes a channel through it.
 *
 * ALGORITHM:
 *
 *   1. For each cell with pooled water (accumulating, not draining):
 *   2. Find the weakest barrier neighbor:
 *      score = (height_above_water) * hardness  — lowest score wins
 *   3. Compute erosion probability from pressure and barrier steepness:
 *      P = min(0.4, totalPressure * 0.08 * steepness)
 *   4. If triggered (stochastic), erode the barrier:
 *      erodeAmt = K * erodibility * pressure * 0.03 / hardness
 *
 *   The stochastic element prevents simultaneous multi-point breakthroughs
 *   while still allowing pools to eventually find outlets.
 *
 * WRITES TO: terrainDelta[], sedimentDelta[] (never touches terrain directly)
 */

import state from '../data/state.js';
import { getHardness } from '../util/helpers.js';

export function stepBreakthrough() {
  const { terrain, water, fluxL, fluxR, fluxU, fluxD,
          isOceanCell, trappedPressure, terrainDelta, sedimentDelta,
          GW, GH, gravity, K, erodibilityUI } = state;

  for (let y = 1; y < GH - 1; y++) {
    for (let x = 1; x < GW - 1; x++) {
      const i = y * GW + x;
      if (water[i] < 0.001) continue;
      if (isOceanCell[i]) continue;

      const waterSurface = terrain[i] + water[i];

      // ── Find weakest barrier ────────────────────────────────────────────
      // A barrier is a neighbor whose terrain is above the water surface.
      // Score = excess height * hardness (lower = easier to breach).
      let bestNi = -1, bestScore = Infinity;
      for (const ni of [i - 1, i + 1, i - GW, i + GW]) {
        if (terrain[ni] <= waterSurface) continue; // not blocking
        const excess = terrain[ni] - waterSurface;
        const score = excess * getHardness(ni);
        if (score < bestScore) { bestScore = score; bestNi = ni; }
      }
      if (bestNi < 0) continue; // no barriers = water can already flow

      // ── Accumulation check ──────────────────────────────────────────────
      // Only erode if water is accumulating (inflow > outflow).
      const totalOut = fluxL[i] + fluxR[i] + fluxU[i] + fluxD[i];
      const totalIn = (fluxR[i - 1] || 0) + (fluxL[i + 1] || 0) +
                       (fluxD[i - GW] || 0) + (fluxU[i + GW] || 0);
      const balance = totalOut > 0.0001 ? totalIn / totalOut : (totalIn > 0.0001 ? 5 : 1);
      const accumulationPush = balance > 1 ? Math.min(3, balance) : 0;
      if (accumulationPush < 0.1) continue;

      // ── Pressure computation ────────────────────────────────────────────
      const basePressure = water[i] * gravity;
      const trapped = trappedPressure ? (trappedPressure[i] || 0) : 0;
      const totalPressure = (basePressure + trapped * 2.0) * accumulationPush;

      // ── Stochastic erosion trigger ──────────────────────────────────────
      // Probability scales with pressure AND barrier steepness.
      // Steep, thin barriers are easier to breach than broad, gentle ones.
      const barrierExcess = terrain[bestNi] - waterSurface;
      const steepness = barrierExcess > 0 ? Math.min(1, barrierExcess * 20) : 0;
      const erodeChance = Math.min(0.4, totalPressure * 0.08 * steepness);
      if (Math.random() > erodeChance) continue;

      // ── Erode the barrier ───────────────────────────────────────────────
      const barrierH = getHardness(bestNi);
      const erodeAmt = Math.min(K * erodibilityUI * totalPressure * 0.03 / barrierH, 0.003);
      if (erodeAmt > 0) {
        terrainDelta[bestNi] -= erodeAmt;
        sedimentDelta[i] += erodeAmt; // mass conserved
      }
    }
  }
}
