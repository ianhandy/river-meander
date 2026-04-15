/**
 * pipeline.js — Simulation step orchestrator.
 *
 * Owns the delta-buffer lifecycle: zero → accumulate → clamp → apply.
 *
 * ARCHITECTURE:
 * No simulation system directly mutates terrain[] or sediment[].
 * Instead, each writes proposed changes to terrainDelta[] and sedimentDelta[].
 * After all systems run, this module sums, clamps, and applies them once.
 *
 * This eliminates cascade bugs by construction: systems cannot see each
 * other's changes within a step, and the per-cell clamp prevents runaway
 * feedback from any single step.
 *
 * STEP ORDER:
 *   1. Water physics (in-place — water/flux are not delta-buffered)
 *   2. Stream power erosion → writes deltas
 *   3. Terrain diffusion    → writes deltas
 *   4. Pool breakthrough    → writes deltas
 *   5. Apply deltas (clamp, sum, commit to terrain/sediment)
 *   6. Sediment transport (advection via flux field, in-place)
 */

import state from '../data/state.js';
import { MAX_DELTA_PER_STEP } from '../data/constants.js';
import { stepWater } from './water.js';
import { stepStreamPower } from './erosion.js';
import { stepDiffusion } from './diffusion.js';
import { stepBreakthrough } from './breakthrough.js';
import { stepSediment } from './sediment.js';
import { stepOffscreenRivers } from './offscreen-rivers.js';

/**
 * Run one simulation step.
 * @returns {number} maxDepth — deepest water cell (for UI display)
 */
export function step() {
  const { GW, GH, terrain, sediment, terrainDelta, sedimentDelta } = state;
  const N = GW * GH;

  // ── Zero delta buffers ────────────────────────────────────────────────────
  terrainDelta.fill(0);
  sedimentDelta.fill(0);

  // ── Phase 1: Water physics ────────────────────────────────────────────────
  // Off-screen rivers inject water at the edge before the pipe model runs.
  stepOffscreenRivers();
  // Updates water[], flux[], flowSpeed[] in-place.
  const maxDepth = stepWater();

  // ── Phase 2: Erosion & diffusion (all write to delta buffers) ─────────────
  stepStreamPower();
  stepDiffusion();

  // ── Phase 3: Apply deltas ─────────────────────────────────────────────────
  // Clamp per-cell terrain change to prevent single-step blowups.
  // Sediment deltas are not clamped (transport is conservative).
  for (let i = 0; i < N; i++) {
    const td = terrainDelta[i];
    if (td !== 0) {
      const clamped = Math.max(-MAX_DELTA_PER_STEP, Math.min(MAX_DELTA_PER_STEP, td));
      terrain[i] += clamped;
      if (terrain[i] < -0.5) terrain[i] = -0.5;
    }
    if (sedimentDelta[i] !== 0) {
      sediment[i] = Math.max(0, sediment[i] + sedimentDelta[i]);
    }

    // NaN guard — should never trigger with delta architecture, but just in case
    if (!isFinite(terrain[i])) terrain[i] = state.origTerrain[i];
    if (!isFinite(sediment[i])) sediment[i] = 0;
  }

  // ── Phase 4: Sediment transport ───────────────────────────────────────────
  // Advects sediment along the flux field. In-place with snapshot.
  stepSediment();

  // ── Phase 5: Smooth water for rendering ─────────────────────────────────
  const { water } = state;
  if (!state.waterSmooth || state.waterSmooth.length !== N) {
    state.waterSmooth = new Float32Array(N);
  }
  const ws = state.waterSmooth;
  ws.set(water);
  const smoothPasses = state.waterSmoothing !== undefined ? state.waterSmoothing : 3;
  for (let pass = 0; pass < smoothPasses; pass++) {
    for (let y = 1; y < GH - 1; y++) {
      for (let x = 1; x < GW - 1; x++) {
        const ii = y * GW + x;
        ws[ii] = ws[ii] * 0.6 +
          (ws[ii - 1] + ws[ii + 1] + ws[ii - GW] + ws[ii + GW]) * 0.1;
      }
    }
  }

  return maxDepth;
}
