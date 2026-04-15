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

/**
 * stepFlowMemoryErosion — Erode terrain where water has been flowing.
 *
 * Cells with established directional flow (high flowSpeed, meaningful depth)
 * get extra erosion that flattens the channel toward its downstream neighbor.
 *
 * CONSTRAINT (monotonic):
 *   - Only erode if terrain[i] > lowestNeighbor (positive slope exists)
 *   - Never erode below lowestNeighbor (preserves downhill gradient)
 *   - Never erode when already flat or lower than all neighbors
 *   - Eroded material becomes sediment (mass conserved)
 *
 * This naturally deepens channels where water flows consistently, without
 * creating pits that trap water. The result is smoother, more defined
 * river beds that improve over time.
 *
 * WRITES TO: terrainDelta[], sedimentDelta[]
 */
export function stepFlowMemoryErosion() {
  const { terrain, water, flowSpeed, isOceanCell, terrainDelta, sedimentDelta,
          GW, GH, erodibilityUI } = state;

  // Rate scales with the erodibility slider so it feels consistent
  const FLOW_EROSION_RATE = 0.0003 * erodibilityUI;
  // How much of the headroom we're allowed to eat per step (0.3 = 30%)
  const MAX_HEADROOM_FRAC = 0.25;
  // Minimum thresholds: cell must have real directional flow + water
  const MIN_SPEED = 0.08;
  const MIN_DEPTH = 0.002;

  for (let y = 1; y < GH - 1; y++) {
    for (let x = 1; x < GW - 1; x++) {
      const i = y * GW + x;

      const speed = flowSpeed[i];
      const depth = water[i];
      if (speed < MIN_SPEED || depth < MIN_DEPTH) continue;
      if (isOceanCell[i]) continue;

      // Find the lowest neighbor terrain (the downstream direction)
      const t_i = terrain[i];
      let lowestH = Infinity;
      const nb = [i - 1, i + 1, i - GW, i + GW,
                  i - GW - 1, i - GW + 1, i + GW - 1, i + GW + 1];
      for (const ni of nb) lowestH = Math.min(lowestH, terrain[ni]);

      // Headroom = how much higher we are than the lowest neighbor.
      // Only erode if positive (we're above it). Skip if flat or lower.
      const headroom = t_i - lowestH;
      if (headroom < 0.0002) continue; // flat or lower — don't touch

      // Erosion proportional to flow speed × depth (deeper+faster = more cutting)
      const rawErosion = speed * depth * FLOW_EROSION_RATE;

      // Cap: never eat more than MAX_HEADROOM_FRAC of the headroom.
      // This guarantees we stay ABOVE the lowest neighbor, keeping
      // the slope positive (downhill).
      const maxErosion = headroom * MAX_HEADROOM_FRAC;
      const erosion = Math.min(rawErosion, maxErosion);

      if (erosion > 1e-7) {
        terrainDelta[i] -= erosion;
        sedimentDelta[i] += erosion; // mass conservation
      }
    }
  }
}

export function stepStreamPower() {
  const { terrain, water, sediment, fluxL, fluxR, fluxU, fluxD, fluxUL, fluxUR, fluxDL, fluxDR,
          origTerrain, isOceanCell, terrainDelta, sedimentDelta, flowSpeed, sources,
          GW, GH, erodibilityUI, seaLevel,
          K, Kc, Kd, gravity, asymmetry,
          erodeWaterMin, erodeSpeedMin } = state;

  const erodMult = erodibilityUI;

  for (let y = 1; y < GH - 1; y++) {
    for (let x = 1; x < GW - 1; x++) {
      const i = y * GW + x;
      if (water[i] < erodeWaterMin) continue;
      if (isOceanCell[i]) continue;

      // Skip source cells — injection points shouldn't erode
      let isSource = false;
      for (const src of sources) {
        if (src.gx === x && src.gy === y) { isSource = true; break; }
      }
      if (isSource) continue;

      // ── Flow speed (directionality-based, no depth divisor) ────────────
      const speed = flowSpeed[i];
      if (speed < erodeSpeedMin) continue;

      // ── Flow direction from 8-directional flux ────────────────────────
      const wd = Math.max(water[i], 0.01);
      const D = 0.707;
      const vx = (fluxR[i] - fluxL[i]
                + (fluxUR[i] + fluxDR[i]) * D - (fluxUL[i] + fluxDL[i]) * D) / wd;
      // Net y velocity: downward fluxes minus upward, including diagonals
      const vy = (fluxD[i] - fluxU[i]
                + (fluxDL[i] + fluxDR[i]) * D - (fluxUL[i] + fluxUR[i]) * D) / wd;
      const rawSpeed = Math.sqrt(vx * vx + vy * vy);
      if (rawSpeed < 0.001) continue; // no direction

      // ── Water pressure: based on speed and depth ────────────────────────
      // Moving water pushes harder when it's fast and deep.
      const pressure = speed * water[i] * gravity * 10;

      // Flow direction (normalized)
      let fnx = vx / rawSpeed, fny = vy / rawSpeed;

      // ── Flow directionality ────────────────────────────────────────────
      // How concentrated is the flow? 0.125 = pool (8-way spread), 1.0 = river
      const allF = [fluxL[i], fluxR[i], fluxU[i], fluxD[i],
                    fluxUL[i], fluxUR[i], fluxDL[i], fluxDR[i]];
      let totFlux = 0, domFlux = 0;
      for (let f = 0; f < 8; f++) { totFlux += allF[f]; if (allF[f] > domFlux) domFlux = allF[f]; }
      const directionality = totFlux > 0.0001 ? domFlux / totFlux : 0;

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

          // A "wall" is any neighbor with higher TERRAIN than us.
          // It can be wet or dry — what matters is the terrain difference.
          // The submergedFrac check below prevents hole-digging: we can only
          // erode the part of the wall that's below our water surface.
          const wallHeight = terrain[bi] - terrain[i];
          if (wallHeight < 0.002) continue; // not significantly higher, not a wall

          // Water erodes the wall at its own surface level — a notch at
          // the waterline. It can only lower the wall down to the water
          // surface, not below. A thin stream carves a thin notch at the
          // top of the contact zone. A deep stream carves a deeper notch.
          //
          // contactDepth: how much of the wall the water touches (from top down)
          // If wall is fully submerged: contactDepth = water depth
          // If wall sticks above water: contactDepth = waterSurface - wallBase
          const wallBase = Math.max(terrain[i], terrain[bi] - (terrain[bi] - terrain[i]));
          // Erosion only at the water surface — a thin band at the waterline.
          // The water carves a notch right at its level. Deeper water doesn't
          // erode the entire submerged face — just the surface contact.
          // Band thickness = min(water depth, 0.01) — thin streams = thin band.
          const band = Math.min(water[i], 0.01);
          // Wall must be within the band (near water surface) to be eroded
          const wallDistFromSurface = Math.abs(terrain[bi] - waterSurface);
          if (wallDistFromSurface > band) continue; // wall too far from waterline
          const contactFrac = 1.0 - wallDistFromSurface / (band + 0.001);

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
          // Momentum: use the actual flux channel pointing toward this neighbor
          let momentumToward = 0;
          if (dx === 1 && dy === 0)       momentumToward = fluxR[i];
          else if (dx === -1 && dy === 0) momentumToward = fluxL[i];
          else if (dx === 0 && dy === 1)  momentumToward = fluxD[i];
          else if (dx === 0 && dy === -1) momentumToward = fluxU[i];
          else if (dx === -1 && dy === -1) momentumToward = fluxUL[i];
          else if (dx === 1 && dy === -1)  momentumToward = fluxUR[i];
          else if (dx === -1 && dy === 1)  momentumToward = fluxDL[i];
          else if (dx === 1 && dy === 1)   momentumToward = fluxDR[i];

          const wallH = getHardness(bi);
          // Force = (pressure + momentum) * perpendicularity * contact fraction
          // Thin stream = thin contact zone = focused notch at waterline
          let force = K * erodMult * (pressure + momentumToward * 50) * interaction * contactFrac * distW / wallH;

          // Concentrated flow bonus: high directionality = more punch
          force *= (0.5 + directionality * 2); // concentrated = up to 2.5x

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
          // Wall can only be lowered to the water surface — not below.
          // The water carves a notch AT its level, then the overhanging
          // material above collapses (handled by diffusion angle-of-repose).
          const maxErode = Math.max(0, terrain[bi] - waterSurface);
          const eroded = Math.min(force * deficit, 0.003, maxErode);
          if (eroded > 0.00001) {
            terrainDelta[bi] -= eroded;           // bank lowers
            terrainDelta[i] += eroded * 0.7;      // 70% collapses into channel
            sedimentDelta[i] += eroded * 0.3;     // 30% becomes sediment
          }
        }

        // ── Vertical erosion — only for directional flow ─────────────────
        // High directionality = real river, not a pool. Only rivers cut down.
        // Capped very shallow so it carves a channel, not a canyon.
        if (directionality > 0.5) {
          const vertForce = K * erodMult * pressure * (directionality - 0.5) * 2 / getHardness(i);
          const maxDepth = 0.005 + Math.min(0.03, speed * 0.1);
          const absFloor = origTerrain[i] - maxDepth;
          const vertDelta = Math.min(vertForce * deficit, 0.001) * beachDamp;
          const actualVert = Math.min(vertDelta, Math.max(0, terrain[i] - absFloor));
          if (actualVert > 0.00001) {
            terrainDelta[i] -= actualVert;
            sedimentDelta[i] += actualVert;
          }
        }

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
