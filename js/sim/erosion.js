/**
 * erosion.js — Pressure-based erosion.
 *
 * PRINCIPLES:
 *   1. All water exerts force proportional to its depth (pressure = depth * gravity)
 *   2. Force erodes walls perpendicular to flow direction more than parallel walls
 *   3. Water contained behind a wall builds pressure until it breaches
 *   4. Water chooses the steepest path with the fewest obstacles
 *   5. Erosion is mostly lateral (90%+) — rivers widen, not deepen
 *
 * FOR EACH WET CELL:
 *   - Compute flow direction from flux
 *   - Check all 8 neighbors as potential "walls"
 *   - For each wall: how perpendicular is it to the flow? How hard is it?
 *   - Erode walls proportional to: water_pressure * perpendicularity / hardness
 *   - Contained water (inflow > outflow) builds extra pressure for breakthrough
 *
 * DEPOSITION:
 *   When sediment exceeds carrying capacity, deposit onto terrain.
 *
 * WRITES TO: terrainDelta[], sedimentDelta[]
 */

import state from '../data/state.js';
import { MIN_WATER } from '../data/constants.js';
import { getHardness, getBeachiness } from '../util/helpers.js';

export function stepStreamPower() {
  const { terrain, water, sediment, fluxL, fluxR, fluxU, fluxD,
          origTerrain, isOceanCell, terrainDelta, sedimentDelta, flowSpeed,
          GW, GH, erodibilityUI, seaLevel,
          K, Kc, Kd, gravity, asymmetry,
          erodeWaterMin, erodeSpeedMin } = state;

  const erodMult = erodibilityUI;

  for (let y = 1; y < GH - 1; y++) {
    for (let x = 1; x < GW - 1; x++) {
      const i = y * GW + x;
      if (water[i] < erodeWaterMin) continue;
      if (isOceanCell[i]) continue;

      // ── Only moving water erodes ────────────────────────────────────────
      // Use flowSpeed which measures directionality — pools read as zero.
      // Still water builds pressure but does NOT erode.
      const speed = flowSpeed[i];
      if (speed < erodeSpeedMin) continue;

      // ── Flow direction from flux ────────────────────────────────────────
      const wd = Math.max(water[i], 0.01);
      const vx = ((fluxR[i - 1] || 0) - fluxL[i] + fluxR[i] - (fluxL[i + 1] || 0)) * 0.5 / wd;
      const vy = ((fluxD[i - GW] || 0) - fluxU[i] + fluxD[i] - (fluxU[i + GW] || 0)) * 0.5 / wd;
      const rawSpeed = Math.sqrt(vx * vx + vy * vy);
      if (rawSpeed < 0.001) continue; // no direction

      // ── Water pressure: based on speed and depth ────────────────────────
      // Moving water pushes harder when it's fast and deep.
      const pressure = speed * water[i] * gravity * 10;

      // Flow direction (normalized)
      let fnx = vx / rawSpeed, fny = vy / rawSpeed;

      // (Pool breakthrough pressure is handled by stepBreakthrough, not here)

      // ── Carrying capacity ───────────────────────────────────────────────
      const C_eq = Kc * speed * Math.sqrt(water[i]);

      // ── Beach damping ───────────────────────────────────────────────────
      const beach = getBeachiness(i);
      const beachDamp = beach > 0 ? (1 - beach * 0.9) : 1;

      // ── Curvature (for meander asymmetry) ───────────────────────────────
      let curvatureSign = 0;
      if (speed > 0.005) {
        const upX = x - Math.round(fnx), upY = y - Math.round(fny);
        if (upX >= 1 && upX < GW - 1 && upY >= 1 && upY < GH - 1) {
          const ui = upY * GW + upX;
          const uvx = ((fluxR[ui - 1] || 0) - fluxL[ui] + fluxR[ui] - (fluxL[ui + 1] || 0)) * 0.5;
          const uvy = ((fluxD[ui - GW] || 0) - fluxU[ui] + fluxD[ui] - (fluxU[ui + GW] || 0)) * 0.5;
          const uSpd = Math.sqrt(uvx * uvx + uvy * uvy);
          if (uSpd > 0.005) {
            curvatureSign = (uvx / uSpd) * fny - (uvy / uSpd) * fnx;
          }
        }
      }

      // ── Erode all 8 neighbors based on wall interaction ─────────────────
      const waterSurface = terrain[i] + water[i];
      const deficit = Math.max(0, C_eq - sediment[i]);

      if (deficit > 0) {
        const neighbors = [
          [-1,  0, 1.0], [ 1,  0, 1.0], [ 0, -1, 1.0], [ 0,  1, 1.0],
          [-1, -1, 0.707], [ 1, -1, 0.707], [-1,  1, 0.707], [ 1,  1, 0.707],
        ];

        for (const [dx, dy, distW] of neighbors) {
          const nx = x + dx, ny = y + dy;
          if (nx < 1 || nx >= GW - 1 || ny < 1 || ny >= GH - 1) continue;
          const bi = ny * GW + nx;

          // Only erode DRY walls — wet neighbors are part of the same
          // water body, not walls. This prevents adjacent wet cells from
          // eroding each other downward (the hole-digging bug).
          if (water[bi] > 0.005) continue; // neighbor is wet, skip

          // How much does this neighbor stick up as a "wall"?
          const wallHeight = terrain[bi] - terrain[i];
          if (wallHeight < -0.01) continue; // lower than us, not a wall

          // Is this wall higher than the water surface? (contained)
          const contained = terrain[bi] > waterSurface;

          // ── Perpendicularity ────────────────────────────────────────────
          // How head-on is the flow hitting this wall?
          // dot(flowDir, neighborDir) = 1 means flow points directly at wall
          const ndx = dx * distW, ndy = dy * distW;
          const flowDot = fnx * ndx + fny * ndy; // -1 to 1

          // Perpendicular component: walls to the side of flow
          const perpDot = Math.abs(fnx * ndy - fny * ndx);

          // Total wall interaction: head-on impact + perpendicular shear
          // Head-on walls get hit hardest, perpendicular walls get sheared
          const headOn = Math.max(0, flowDot); // 0-1, how directly flow hits
          const interaction = headOn * 0.7 + perpDot * 0.3;
          if (interaction < 0.1) continue;

          // ── Erosion force ───────────────────────────────────────────────
          // Momentum impact: how much flux was heading toward this wall?
          // The flux in that direction represents momentum that gets killed
          // when it hits the wall — that energy becomes erosion force.
          let momentumToward = 0;
          if (dx === 1)  momentumToward = fluxR[i];
          else if (dx === -1) momentumToward = fluxL[i];
          else if (dy === 1)  momentumToward = fluxD[i];
          else if (dy === -1) momentumToward = fluxU[i];
          else {
            // Diagonal: average the two cardinal components
            momentumToward = ((dx > 0 ? fluxR[i] : fluxL[i]) +
                              (dy > 0 ? fluxD[i] : fluxU[i])) * 0.5;
          }

          const wallH = getHardness(bi);
          // Force = pressure + momentum impact, shaped by perpendicularity
          let force = K * erodMult * (pressure + momentumToward * 50) * interaction * distW / wallH;

          // Deeper moving water has more force
          force *= (1 + water[i] * 10);

          // Meander asymmetry: outer bank erodes more on curves
          const cross = fnx * ndy - fny * ndx;
          if (Math.abs(curvatureSign) > 0.1) {
            const isOuterBank = cross * curvatureSign > 0;
            if (isOuterBank) force *= asymmetry;
          }

          force *= beachDamp;

          // Bank erosion with collapse: material falls into the channel.
          // The bank lowers, the channel floor raises. Mass is conserved
          // as terrain, not lost as sediment that drifts away.
          //
          // Split: 70% collapses as terrain into channel (fills the hole),
          //        30% becomes suspended sediment (carried downstream).
          const maxErode = Math.max(0, terrain[bi] - terrain[i]);
          const eroded = Math.min(force * deficit, 0.005, maxErode);
          if (eroded > 0.00001) {
            terrainDelta[bi] -= eroded;           // bank lowers
            terrainDelta[i] += eroded * 0.7;      // 70% collapses into channel
            sedimentDelta[i] += eroded * 0.3;     // 30% becomes sediment
          }
        }

        // No vertical erosion — channels deepen only via diffusion.

      } else {
        // ── Deposition ────────────────────────────────────────────────────
        const deposit = Kd * (sediment[i] - C_eq);
        terrainDelta[i] += deposit;
        sedimentDelta[i] -= deposit;

        // Floodplain building
        if (speed < 0.05 && sediment[i] > 0.0001) {
          const bankDep = sediment[i] * 0.05;
          const nb = [i - 1, i + 1, i - GW, i + GW];
          let dryCount = 0;
          for (const ni of nb) {
            if (water[ni] < MIN_WATER && terrain[ni] < terrain[i] + water[i]) dryCount++;
          }
          if (dryCount > 0) {
            const perBank = bankDep / dryCount;
            for (const ni of nb) {
              if (water[ni] < MIN_WATER && terrain[ni] < terrain[i] + water[i]) {
                terrainDelta[ni] += perBank;
                sedimentDelta[i] -= perBank;
              }
            }
          }
        }
      }
    }
  }
}
