// Erosion, deposition, meander engine, and oxbow detection

import state from './state.js';
import { MIN_WATER } from './constants.js';
import { getHardness } from './helpers.js';

export function stepErosion() {
  const { terrain, water, sediment, fluxL, fluxR, fluxU, fluxD,
          origTerrain, isOceanCell, trappedPressure,
          GW, GH, erodibilityUI, seaLevel,
          SIM_Kc, SIM_Ks, SIM_Kd, SIM_Kt, SIM_PRESSURE_WT, SIM_GRAVITY,
          SIM_SLOPE_COLLAPSE, SIM_VERTICAL_EROSION,
          SIM_MEANDER_ASYMMETRY, SIM_LATERAL_RATE,
          SIM_ERODE_WATER_MIN, SIM_ERODE_SPEED_MIN } = state;
  const erodSlider = erodibilityUI;

  for (let y = 1; y < GH - 1; y++) {
    for (let x = 1; x < GW - 1; x++) {
      const i = y * GW + x;
      if (water[i] < SIM_ERODE_WATER_MIN) continue;
      if (isOceanCell[i]) continue;

      // Velocity = flux / depth (consistent with hydraulics)
      const wd = Math.max(water[i], 0.001);
      const vx = ((fluxR[i - 1] || 0) - fluxL[i] + fluxR[i] - (fluxL[i + 1] || 0)) * 0.5 / wd;
      const vy = ((fluxD[i - GW] || 0) - fluxU[i] + fluxD[i] - (fluxU[i + GW] || 0)) * 0.5 / wd;
      const speed = Math.sqrt(vx * vx + vy * vy);
      if (speed < SIM_ERODE_SPEED_MIN) continue;

      const dhdx = (terrain[i+1] - terrain[i-1]) * 0.5;
      const dhdy = (terrain[i+GW] - terrain[i-GW]) * 0.5;
      const slope = Math.sqrt(dhdx * dhdx + dhdy * dhdy);
      const slopeFactor = 1.0 + slope * 15;

      // Curvature: magnitude + sign
      const nvx = vx / speed, nvy = vy / speed;
      const upX = x - Math.round(nvx), upY = y - Math.round(nvy);
      let curvatureFactor = 1.0;
      let curvatureSign = 0;
      if (upX >= 1 && upX < GW-1 && upY >= 1 && upY < GH-1) {
        const ui = upY * GW + upX;
        const uvx = ((fluxR[ui-1]||0) - fluxL[ui] + fluxR[ui] - (fluxL[ui+1]||0)) * 0.5;
        const uvy = ((fluxD[ui-GW]||0) - fluxU[ui] + fluxD[ui] - (fluxU[ui+GW]||0)) * 0.5;
        const uSpd = Math.sqrt(uvx*uvx + uvy*uvy);
        if (uSpd > 0.005) {
          const unvx = uvx / uSpd, unvy = uvy / uSpd;
          const dot = nvx * unvx + nvy * unvy;
          curvatureFactor = 1.0 + (1.0 - Math.max(0, dot)) * 2.0;
          curvatureSign = unvx * nvy - unvy * nvx;
        }
      }

      const pressureBoost = 1.0 + SIM_PRESSURE_WT * water[i] * SIM_GRAVITY;
      const erosionForce = speed * pressureBoost * slopeFactor * curvatureFactor;

      const localH = getHardness(i);
      const Ks_eff = SIM_Ks * erodSlider / localH;
      const C_eq = SIM_Kc * erosionForce * Math.sqrt(water[i]);

      if (C_eq > sediment[i]) {
        const delta = Math.min(Ks_eff * (C_eq - sediment[i]), 0.015);
        const vertSplit = SIM_VERTICAL_EROSION ? 0.12 : 0;
        const verticalDelta = delta * vertSplit;
        const lateralDelta = delta * (1 - vertSplit);

        const maxChannelDepth = 0.03;
        const absFloor = origTerrain[i] - maxChannelDepth;
        const actualVertical = SIM_VERTICAL_EROSION ?
          Math.min(verticalDelta, Math.max(0, terrain[i] - absFloor)) : 0;
        terrain[i] -= actualVertical;
        sediment[i] += actualVertical;

        // Lateral erosion: two components
        // 1. Depth-driven: deeper water erodes banks to widen the channel
        // 2. Curvature-driven: bends erode outer bank (meander engine)
        if (speed > 0.005 && lateralDelta > 0.00001) {
          const fnx = vx / speed, fny = vy / speed;
          const perpX = Math.round(-fny), perpY = Math.round(fnx);
          const lbx = x + perpX, lby = y + perpY;
          const rbx = x - perpX, rby = y - perpY;

          // Depth-driven widening: deeper water = more bank pressure
          const depthPressure = Math.min(1, water[i] * 20); // 0-1, saturates at depth 0.05

          // Curvature-driven asymmetry (meander engine)
          const curvMag = Math.min(1, Math.abs(curvatureSign) * curvatureFactor * 0.5);

          // Erode both banks: base rate from depth, asymmetry from curvature
          const baseRate = SIM_LATERAL_RATE * depthPressure;
          const outerBoost = curvMag * (SIM_MEANDER_ASYMMETRY - 1);

          // Left bank
          if (lbx >= 1 && lbx < GW-1 && lby >= 1 && lby < GH-1) {
            const bi = lby * GW + lbx;
            if (terrain[bi] > terrain[i] && terrain[bi] >= seaLevel) {
              // Bank is higher than channel — erode it
              const outerness = -curvatureSign;
              const rate = baseRate * (1 + Math.max(0, outerness) * outerBoost);
              const eroded = Math.min(lateralDelta * rate / getHardness(bi), 0.003);
              terrain[bi] -= eroded;
              sediment[i] += eroded;
            }
          }

          // Right bank
          if (rbx >= 1 && rbx < GW-1 && rby >= 1 && rby < GH-1) {
            const bi = rby * GW + rbx;
            if (terrain[bi] > terrain[i] && terrain[bi] >= seaLevel) {
              const outerness = curvatureSign;
              const rate = baseRate * (1 + Math.max(0, outerness) * outerBoost);
              const eroded = Math.min(lateralDelta * rate / getHardness(bi), 0.003);
              terrain[bi] -= eroded;
              sediment[i] += eroded;
            }
          }
        }
      } else {
        const deposit = SIM_Kd * (sediment[i] - C_eq);
        terrain[i] += deposit;
        sediment[i] = Math.max(0, sediment[i] - deposit);
        sediment[i] *= 0.98;
      }

      // NaN guard
      if (!isFinite(terrain[i])) terrain[i] = origTerrain[i];
      if (!isFinite(sediment[i])) sediment[i] = 0;
    }
  }

  // Thermal smoothing — separate pass reading from snapshot to prevent cascade
  if (SIM_Kt > 0) {
    const tSnap = terrain.slice();
    for (let y = 1; y < GH - 1; y++) {
      for (let x = 1; x < GW - 1; x++) {
        const i = y * GW + x;
        const h = tSnap[i];
        const tSum = (tSnap[i-1] - h) + (tSnap[i+1] - h)
                   + (tSnap[i-GW] - h) + (tSnap[i+GW] - h);
        terrain[i] += SIM_Kt * tSum * 0.25;
        if (terrain[i] < -0.5) terrain[i] = -0.5;
      }
    }
  }

  // ── Directional slope collapse (rockfall / talus) ──
  // Steep slopes shed material from the top. Debris falls to the base
  // and fans out laterally — forming talus slopes and scree fields.
  // Uses a delta buffer so collapse order doesn't matter.
  if (SIM_SLOPE_COLLAPSE > 0) {
    const REPOSE = 0.02;  // angle of repose threshold (height diff per cell)
    const collapseStrength = SIM_SLOPE_COLLAPSE * 0.001;
    const delta = new Float32Array(GW * GH);

    for (let y = 1; y < GH - 1; y++) {
      for (let x = 1; x < GW - 1; x++) {
        const i = y * GW + x;
        const h = terrain[i];

        // Find the steepest downhill neighbor
        const nb = [
          { ni: i - 1,  dx: -1, dy:  0 },
          { ni: i + 1,  dx:  1, dy:  0 },
          { ni: i - GW, dx:  0, dy: -1 },
          { ni: i + GW, dx:  0, dy:  1 },
        ];

        let steepestDrop = 0, steepestIdx = -1, steepestDx = 0, steepestDy = 0;
        for (const { ni, dx, dy } of nb) {
          const drop = h - terrain[ni];
          if (drop > steepestDrop) {
            steepestDrop = drop;
            steepestIdx = ni;
            steepestDx = dx;
            steepestDy = dy;
          }
        }

        if (steepestDrop <= REPOSE) continue;

        // Collapse amount scales with excess over angle of repose
        const excess = steepestDrop - REPOSE;
        // Harder material resists collapse more
        const hardnessFactor = 1.0 / Math.max(1, getHardness(i) * 0.01);
        const collapsed = Math.min(excess * 0.5, collapseStrength * excess * hardnessFactor);

        // Remove from cliff top
        delta[i] -= collapsed;

        // Deposit at base: 60% directly below, 20% spread laterally on each side
        delta[steepestIdx] += collapsed * 0.6;

        // Lateral spread — perpendicular to the slope direction
        const perpA = (steepestDy === 0)
          ? i + GW   // slope is horizontal → spread vertically
          : i + 1;   // slope is vertical → spread horizontally
        const perpB = (steepestDy === 0)
          ? i - GW
          : i - 1;

        // Deposit laterally at the BASE level (neighbors of the low cell)
        const latA = steepestIdx + (perpA - i);
        const latB = steepestIdx + (perpB - i);
        if (latA >= 0 && latA < GW * GH) delta[latA] += collapsed * 0.15;
        if (latB >= 0 && latB < GW * GH) delta[latB] += collapsed * 0.15;

        // Remaining 10% deposits on the slope face itself (mid-slope scree)
        delta[steepestIdx] += collapsed * 0.1;
      }
    }

    // Apply all collapse deltas at once
    for (let i = 0; i < GW * GH; i++) {
      terrain[i] += delta[i];
      if (terrain[i] < -0.5) terrain[i] = -0.5;
    }
  }

  // Sediment transport
  const tmpSed = sediment.slice();
  for (let y = 1; y < GH - 1; y++) {
    for (let x = 1; x < GW - 1; x++) {
      const i = y * GW + x;
      if (sediment[i] < 1e-5 || water[i] < MIN_WATER) continue;
      const totalOut = fluxL[i] + fluxR[i] + fluxU[i] + fluxD[i];
      if (totalOut < 1e-8) continue;
      const moved = Math.min(sediment[i] * 0.4, sediment[i]);
      if (fluxR[i] > 0 && x < GW - 1) tmpSed[i + 1]  += moved * fluxR[i] / totalOut;
      if (fluxL[i] > 0 && x > 0)       tmpSed[i - 1]  += moved * fluxL[i] / totalOut;
      if (fluxD[i] > 0 && y < GH - 1) tmpSed[i + GW] += moved * fluxD[i] / totalOut;
      if (fluxU[i] > 0 && y > 0)       tmpSed[i - GW] += moved * fluxU[i] / totalOut;
      tmpSed[i] -= moved;
    }
  }
  sediment.set(tmpSed);

  // Hydrostatic pressure erosion — pooled water erodes the weakest barrier.
  // Concentrates on the single lowest/softest rim cell (not all 4 equally).
  // This is how lakes find outlets: water pushes through the weakest point.
  for (let y = 1; y < GH - 1; y++) {
    for (let x = 1; x < GW - 1; x++) {
      const i = y * GW + x;
      if (water[i] < 0.001) continue; // lower threshold — any real pooling
      if (isOceanCell[i]) continue;

      const waterSurface = terrain[i] + water[i];

      // Find the weakest barrier: neighbor terrain above water surface that's
      // easiest to erode through. Score = height above water * hardness.
      let bestNi = -1, bestScore = Infinity;
      for (const ni of [i-1, i+1, i-GW, i+GW]) {
        if (terrain[ni] <= waterSurface) continue; // not blocking — water can already flow over
        // How much does this barrier stick up above the water?
        const excess = terrain[ni] - waterSurface;
        const score = excess * getHardness(ni);
        if (score < bestScore) { bestScore = score; bestNi = ni; }
      }
      if (bestNi < 0) continue;

      // Pressure from water depth
      const basePressure = water[i] * SIM_GRAVITY;
      const trapped = trappedPressure ? (trappedPressure[i] || 0) : 0;
      const totalPressure = basePressure + trapped * 2.0;

      // Erode the weakest barrier — harder material resists more
      const barrierH = getHardness(bestNi);
      const erodeAmt = Math.min(SIM_Ks * erodSlider * totalPressure * 0.05 / barrierH, 0.005);
      if (erodeAmt > 0) {
        terrain[bestNi] -= erodeAmt;
        sediment[i] += erodeAmt; // mass conserved
      }
    }
  }
}

// Oxbow lake detection
export function detectOxbows() {
  const { GW, GH, water, isOceanCell, year, oxbows } = state;
  const threshold = 0.005;
  const channelCells = new Set();
  for (let i = 0; i < GW * GH; i++) {
    if (water[i] > threshold && !isOceanCell[i]) channelCells.add(i);
  }

  if (state.prevChannelCells) {
    const lostSet = new Set();
    for (const cell of state.prevChannelCells) {
      if (!channelCells.has(cell) && water[cell] > MIN_WATER * 0.5) lostSet.add(cell);
    }
    if (lostSet.size > 15) {
      const visited = new Set();
      for (const cell of lostSet) {
        if (visited.has(cell)) continue;
        const queue = [cell];
        const component = [];
        visited.add(cell);
        while (queue.length > 0) {
          const c = queue.shift();
          component.push(c);
          const cx = c % GW, cy = (c / GW) | 0;
          for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
            const nx = cx + dx, ny = cy + dy;
            if (nx < 0 || nx >= GW || ny < 0 || ny >= GH) continue;
            const ni = ny * GW + nx;
            if (!visited.has(ni) && lostSet.has(ni)) {
              visited.add(ni);
              queue.push(ni);
            }
          }
        }
        if (component.length > 20) {
          oxbows.push({
            cells: component,
            age: year,
            cx: component.reduce((s, c) => s + (c % GW), 0) / component.length,
            cy: component.reduce((s, c) => s + ((c / GW) | 0), 0) / component.length,
          });
        }
      }
    }
  }
  state.prevChannelCells = channelCells;
}
