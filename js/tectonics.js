// Live plate tectonics — drift, uplift, rifting, earthquakes

import state from './state.js';
import { simplex2D } from './noise.js';

export function stepTectonics() {
  const { plates, tectonicStress, faultStress, terrain,
          GW, GH, year,
          SIM_TECTONIC_SPEED, SIM_UPLIFT_RATE, SIM_RIFT_RATE,
          SIM_QUAKE_THRESHOLD, SIM_FAULT_EROSION } = state;

  if (!plates.length || !tectonicStress) return;
  const numPlates = plates.length;

  // Move plates
  for (const p of plates) {
    p.px += p.vx * SIM_TECTONIC_SPEED;
    p.py += p.vy * SIM_TECTONIC_SPEED;
    if (p.px < 0) p.px += GW;
    if (p.px >= GW) p.px -= GW;
    if (p.py < 0) p.py += GH;
    if (p.py >= GH) p.py -= GH;
  }

  // Recompute stress field
  for (let y = 0; y < GH; y++) {
    for (let x = 0; x < GW; x++) {
      const i = y * GW + x;
      const fx = x / GW, fy = y / GH;
      const warpX = x + simplex2D(fx * 2.5 + 300, fy * 2.5 + 300) * 5;
      const warpY = y + simplex2D(fx * 2.5 + 400, fy * 2.5 + 400) * 5;

      let d1 = Infinity, d2 = Infinity, p1 = 0, p2 = 0;
      for (let p = 0; p < numPlates; p++) {
        let dx = warpX - plates[p].px;
        let dy = warpY - plates[p].py;
        if (dx > GW/2) dx -= GW; if (dx < -GW/2) dx += GW;
        if (dy > GH/2) dy -= GH; if (dy < -GH/2) dy += GH;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < d1) { d2 = d1; p2 = p1; d1 = d; p1 = p; }
        else if (d < d2) { d2 = d; p2 = p; }
      }

      const boundaryDist = Math.abs(d1 - d2);
      const boundaryProx = Math.exp(-boundaryDist * boundaryDist / 800);

      const relVx = plates[p1].vx - plates[p2].vx;
      const relVy = plates[p1].vy - plates[p2].vy;
      let nx = plates[p2].px - plates[p1].px;
      let ny = plates[p2].py - plates[p1].py;
      if (nx > GW/2) nx -= GW; if (nx < -GW/2) nx += GW;
      if (ny > GH/2) ny -= GH; if (ny < -GH/2) ny += GH;
      const nl = Math.sqrt(nx * nx + ny * ny) || 1;
      const nnx = nx / nl, nny = ny / nl;

      const convergence = relVx * nnx + relVy * nny;
      const tangent = Math.abs(relVx * (-nny) + relVy * nnx);

      tectonicStress[i] = convergence * boundaryProx;

      if (boundaryProx > 0.02) {
        if (convergence > 0) {
          // Soft cap: uplift slows as terrain gets very high
          const heightDamper = terrain[i] > 1.5 ? 0.5 / (terrain[i] - 0.5) : 1.0;
          terrain[i] += SIM_UPLIFT_RATE * convergence * boundaryProx * heightDamper;
        } else if (convergence < 0) {
          terrain[i] += SIM_RIFT_RATE * convergence * boundaryProx;
          if (terrain[i] < -0.5) terrain[i] = -0.5; // floor for rifts
        }

        if (tangent > 0.1 && boundaryProx > 0.05) {
          faultStress[i] += tangent * boundaryProx * 0.05;
          if (y > 0 && y < GH-1 && x > 0 && x < GW-1) {
            const h = terrain[i];
            const avg = (terrain[i-1] + terrain[i+1] + terrain[i-GW] + terrain[i+GW]) * 0.25;
            terrain[i] += (avg - h) * SIM_FAULT_EROSION * boundaryProx;
          }
        }
      }
    }
  }

  // Smooth stress field
  for (let pass = 0; pass < 5; pass++) {
    for (let y = 1; y < GH - 1; y++) {
      for (let x = 1; x < GW - 1; x++) {
        const i = y * GW + x;
        tectonicStress[i] = tectonicStress[i] * 0.5 +
          (tectonicStress[i-1] + tectonicStress[i+1] + tectonicStress[i-GW] + tectonicStress[i+GW]) * 0.125;
      }
    }
  }

  // Earthquakes
  for (let y = 2; y < GH - 2; y++) {
    for (let x = 2; x < GW - 2; x++) {
      const i = y * GW + x;
      if (faultStress[i] > SIM_QUAKE_THRESHOLD) {
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            const ni = (y+dy) * GW + (x+dx);
            const dist = Math.sqrt(dx*dx + dy*dy);
            if (dist > 2.5) continue;
            const intensity = (1 - dist/3) * 0.01;
            const jitter = simplex2D(x * 0.5 + year * 0.001, y * 0.5) * intensity;
            terrain[ni] += jitter;
          }
        }
        faultStress[i] = 0;
      }
    }
  }
}
