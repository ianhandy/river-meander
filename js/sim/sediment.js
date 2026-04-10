/**
 * sediment.js — Sediment transport and deposition.
 *
 * TRANSPORT (flux-weighted advection):
 *
 *   Each cell moves a fraction of its sediment to neighbors, weighted
 *   by the outgoing flux in each direction. This models suspended
 *   sediment being carried downstream by the flow.
 *
 *     moved = sediment[i] * transportFrac
 *     sediment[neighbor] += moved * flux[dir] / totalFlux
 *
 *   Uses a snapshot to prevent order-dependent cascade.
 *
 * BEACH DEPOSITION:
 *
 *   Sediment-laden water crossing beach sand loses carrying capacity
 *   (sand absorbs water, reducing velocity). A fraction of sediment
 *   drops proportional to the cell's beachiness.
 *
 * POOL SETTLING:
 *
 *   In stagnant water (speed < 0.02), sediment settles to the bottom
 *   at 10% per step. This builds soft lake-bed layers.
 *
 * WRITES TO: sediment[] in-place (using snapshot), terrain[] for deposition.
 * Called AFTER delta application — terrain is already updated for this step.
 */

import state from '../data/state.js';
import { MIN_WATER } from '../data/constants.js';
import { getBeachiness } from '../util/helpers.js';

const TRANSPORT_FRAC = 0.4;   // fraction of sediment moved per step
const BEACH_DROP_FRAC = 0.3;  // fraction dropped on beach per step
const SETTLE_FRAC = 0.1;      // fraction settling in stagnant pools
const SETTLE_SPEED_MAX = 0.02; // speed below which settling occurs

export function stepSediment() {
  const { terrain, water, sediment, fluxL, fluxR, fluxU, fluxD,
          flowSpeed, GW, GH } = state;
  const N = GW * GH;

  // ── Flux-weighted transport ─────────────────────────────────────────────
  // Snapshot prevents order-dependent cascade.
  const snap = sediment.slice();

  for (let y = 1; y < GH - 1; y++) {
    for (let x = 1; x < GW - 1; x++) {
      const i = y * GW + x;
      if (snap[i] < 1e-5 || water[i] < MIN_WATER) continue;

      const totalOut = fluxL[i] + fluxR[i] + fluxU[i] + fluxD[i];
      if (totalOut < 1e-8) continue;

      const moved = Math.min(snap[i] * TRANSPORT_FRAC, snap[i]);
      if (fluxR[i] > 0 && x < GW - 1) snap[i + 1]  += moved * fluxR[i] / totalOut;
      if (fluxL[i] > 0 && x > 0)       snap[i - 1]  += moved * fluxL[i] / totalOut;
      if (fluxD[i] > 0 && y < GH - 1) snap[i + GW] += moved * fluxD[i] / totalOut;
      if (fluxU[i] > 0 && y > 0)       snap[i - GW] += moved * fluxU[i] / totalOut;
      snap[i] -= moved;
    }
  }
  sediment.set(snap);

  // ── Beach deposition ────────────────────────────────────────────────────
  // Water slows on absorbent sand → loses carrying capacity → drops sediment.
  for (let y = 1; y < GH - 1; y++) {
    for (let x = 1; x < GW - 1; x++) {
      const i = y * GW + x;
      const beach = getBeachiness(i);
      if (beach < 0.1 || sediment[i] < 1e-5) continue;
      const drop = sediment[i] * beach * BEACH_DROP_FRAC;
      terrain[i] += drop;
      sediment[i] -= drop;
    }
  }

  // ── Stagnant pool settling ──────────────────────────────────────────────
  // Sediment settles to the bottom in still water (lake beds, pools).
  for (let y = 1; y < GH - 1; y++) {
    for (let x = 1; x < GW - 1; x++) {
      const i = y * GW + x;
      if (sediment[i] < 1e-5 || water[i] < 0.002) continue;
      const spd = flowSpeed ? flowSpeed[i] : 0;
      if (spd > SETTLE_SPEED_MAX) continue;
      const settle = sediment[i] * SETTLE_FRAC;
      terrain[i] += settle;
      sediment[i] -= settle;
    }
  }
}
