// Terrain generation — all terrain types including particle erosion pre-pass

import state from './state.js';
import { LAYERS } from './constants.js';
import { seedNoise, simplex2D, fbmSimplex, ridgedNoise, warpedRidged } from './noise.js';
import { lerp, smoothstep } from './math.js';

export function generateTerrain(seed, octaves, valleyDepthFrac, roughness, type, seaLvl, mtnHeight, forceOcean) {
  seedNoise(seed);
  const { GW, GH, genNumPlates, genErosionPasses } = state;

  const N = GW * GH;
  const t = new Float32Array(N);
  const hn = new Float32Array(N);
  const gain = 0.35 + roughness * 0.3;

  // ── Test preset: 25x25 controlled slope ──
  // Lake at top, ocean at bottom, clear slope between. Water source feeds lake.
  if (type === 'test') {
    for (let y = 0; y < GH; y++) {
      for (let x = 0; x < GW; x++) {
        const i = y * GW + x;
        const fy = y / GH; // 0 = top, 1 = bottom

        // Linear slope: high at top (0.6), low at bottom (0.1)
        let h = lerp(0.6, 0.1, fy);

        // Lake depression at top center (top 25% of map)
        if (fy < 0.28) {
          const cx = (x / GW - 0.5) * 2; // -1 to 1
          const cy = (fy / 0.28 - 0.5) * 2;
          const dist = Math.sqrt(cx * cx * 0.6 + cy * cy);
          if (dist < 0.7) {
            h -= (0.7 - dist) * 0.15; // depression
          }
        }

        // Slight channel down the center to guide flow
        const distFromCenter = Math.abs(x / GW - 0.5);
        if (distFromCenter < 0.15) {
          h -= (0.15 - distFromCenter) * 0.08;
        }

        // Tiny micro-variation for visual interest
        h += simplex2D(x * 0.5 + seed * 0.1, y * 0.5 + seed * 0.2) * 0.005;

        t[i] = Math.max(0.01, h);
        hn[i] = 0.5;
      }
    }

    state.hardnessNoise = hn;
    state.initialFlowAccum = null;
    state.plates = [];
    state.tectonicStress = new Float32Array(N);
    state.faultStress = new Float32Array(N);
    return t;
  }

  // ── Floodplain: clean generation, bypasses tectonic/erosion pipeline ──
  if (type === 'floodplain') {
    const valleyY = new Float32Array(GW);
    for (let x = 0; x < GW; x++) {
      const fx = x / GW;
      valleyY[x] = (0.5 + simplex2D(fx * 3 + seed * 0.1, 0.5) * 0.06
                        + simplex2D(fx * 7 + seed * 0.2, 0.5) * 0.02) * GH;
    }

    for (let y = 0; y < GH; y++) {
      for (let x = 0; x < GW; x++) {
        const fx = x / GW;
        const i = y * GW + x;
        let h = fx * 0.20 + 0.12;
        const dfc = Math.abs(y - valleyY[x]) / GH;
        const vw = 0.3;
        if (dfc < vw) h -= (1 - (dfc / vw) ** 2) * 0.02;
        if (dfc > vw) h += (dfc - vw) * 0.5;
        h += simplex2D(fx * 15 + 50, (y / GH) * 15 + 50) * 0.001;
        t[i] = h;
        hn[i] = simplex2D(fx * 12 + 100, (y / GH) * 12 + 100) * 0.5 + 0.5;
      }
    }

    // Pre-carve sinuous channel
    for (let x = 0; x < GW; x++) {
      const cy = Math.round(valleyY[x]);
      for (let dy = -2; dy <= 2; dy++) {
        const y = cy + dy;
        if (y < 0 || y >= GH) continue;
        const falloff = 1 - Math.abs(dy) / 3;
        t[y * GW + x] -= 0.04 * falloff;
      }
    }

    // Fill micro-depressions
    for (let pass = 0; pass < 10; pass++) {
      for (let y = 1; y < GH - 1; y++) {
        for (let x = 1; x < GW - 1; x++) {
          const i = y * GW + x;
          const avg = (t[i-1] + t[i+1] + t[i-GW] + t[i+GW]) * 0.25;
          if (avg > t[i]) t[i] += (avg - t[i]) * 0.6;
        }
      }
    }

    state.hardnessNoise = hn;
    state.initialFlowAccum = null;
    state.plates = [];
    state.tectonicStress = new Float32Array(N);
    state.faultStress = new Float32Array(N);
    return t;
  }

  // ── Step 1: Generate plate stress field ──
  let numPlates, hasContinentalMask;
  if (type === 'island') { numPlates = 3; hasContinentalMask = true; }
  else if (type === 'continent') { numPlates = 3; hasContinentalMask = true; }
  else if (type === 'mountain_range') { numPlates = 3; hasContinentalMask = false; }
  else if (type === 'floodplain') { numPlates = 2; hasContinentalMask = false; }
  else { numPlates = 2; hasContinentalMask = false; }
  if (genNumPlates > 0) numPlates = genNumPlates;

  const plates = [];
  for (let p = 0; p < numPlates; p++) {
    const px = (simplex2D(p * 7.3 + seed * 0.1, 0.5) * 0.5 + 0.5) * GW;
    const py = (simplex2D(0.5, p * 7.3 + seed * 0.1) * 0.5 + 0.5) * GH;
    const angle = simplex2D(p * 3.7 + 100, seed * 0.3) * Math.PI * 2;
    const speed = 0.5 + Math.abs(simplex2D(p * 5.1, seed * 0.2 + 50)) * 1.5;
    plates.push({ px, py, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed });
  }
  state.plates = plates;

  const stress = new Float32Array(N);
  state.tectonicStress = stress;
  state.faultStress = new Float32Array(N);

  for (let y = 0; y < GH; y++) {
    for (let x = 0; x < GW; x++) {
      const i = y * GW + x;
      const fx = x / GW, fy = y / GH;
      const warpX = x + simplex2D(fx * 2.5 + 300, fy * 2.5 + 300) * 5;
      const warpY = y + simplex2D(fx * 2.5 + 400, fy * 2.5 + 400) * 5;
      let d1 = Infinity, d2 = Infinity, p1 = 0, p2 = 0;
      for (let p = 0; p < numPlates; p++) {
        const dx = warpX - plates[p].px, dy = warpY - plates[p].py;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < d1) { d2 = d1; p2 = p1; d1 = d; p1 = p; }
        else if (d < d2) { d2 = d; p2 = p; }
      }
      const boundaryDist = Math.abs(d1 - d2);
      const boundaryProx = Math.exp(-boundaryDist * boundaryDist / 400);
      const relVx = plates[p1].vx - plates[p2].vx;
      const relVy = plates[p1].vy - plates[p2].vy;
      const nx = plates[p2].px - plates[p1].px;
      const ny = plates[p2].py - plates[p1].py;
      const nl = Math.sqrt(nx * nx + ny * ny) || 1;
      const convergence = (relVx * nx / nl + relVy * ny / nl);
      stress[i] = convergence * boundaryProx;
    }
  }

  // Smooth stress field
  for (let pass = 0; pass < 20; pass++) {
    for (let y = 1; y < GH - 1; y++) {
      for (let x = 1; x < GW - 1; x++) {
        const i = y * GW + x;
        stress[i] = stress[i] * 0.5 +
          (stress[i-1] + stress[i+1] + stress[i-GW] + stress[i+GW]) * 0.125;
      }
    }
  }

  // ── Step 2: Build heightmap from noise modulated by stress ──
  for (let y = 0; y < GH; y++) {
    for (let x = 0; x < GW; x++) {
      const fx = x / GW, fy = y / GH;
      const i = y * GW + x;

      let continentalH = 1.0;
      if (hasContinentalMask) {
        const coastLo = fbmSimplex(fx * 3 + 50, fy * 3 + 50, 3, 2.0, 0.5) * 0.25;
        const coastHi = fbmSimplex(fx * 8 + 150, fy * 8 + 150, 4, 2.0, 0.45) * 0.12;
        const coastNoise = coastLo + coastHi;
        if (type === 'island') {
          const cx = (fx - 0.5) * 2, cy = (fy - 0.5) * 2;
          const dist = Math.sqrt(cx * cx + cy * cy);
          continentalH = smoothstep(0.9, 0.2, dist + coastNoise);
        } else {
          const edgeX = smoothstep(0, 0.22, fx) * smoothstep(0, 0.22, 1 - fx);
          const edgeY = smoothstep(0, 0.18, fy) * smoothstep(0, 0.18, 1 - fy);
          continentalH = Math.max(0, Math.min(1, edgeX * edgeY + coastNoise));
        }
      }

      const baseNoise = fbmSimplex(fx * 4, fy * 4, octaves, 2.0, gain);
      const midNoise = fbmSimplex(fx * 2.5 + 40, fy * 2.5 + 40, 3, 2.0, 0.45);
      const base = 0.35 + baseNoise * 0.2 + midNoise * 0.1;

      const s = stress[i];
      let tectonicH = 0;
      if (s > 0) {
        const ridge = warpedRidged(fx * 5, fy * 5, 4, 2.0, 0.5, 0.5);
        tectonicH = ridge * s * mtnHeight * 1.2;
      } else {
        tectonicH = s * 0.15;
      }

      const detail = fbmSimplex(fx * 8 + 30, fy * 8 + 30, Math.max(2, octaves - 1), 2.0, gain) * 0.1;
      const oceanFloor = 0.08 + fbmSimplex(fx * 3 + 200, fy * 3 + 200, 3, 2.0, 0.4) * 0.04;

      let h;
      if (continentalH < 0.2) {
        h = oceanFloor;
      } else if (continentalH < 0.45) {
        const ct = (continentalH - 0.2) / 0.25;
        h = lerp(oceanFloor, base, ct * ct);
      } else {
        let inlandness;
        if (hasContinentalMask) {
          inlandness = smoothstep(0.45, 0.9, continentalH);
        } else {
          inlandness = Math.min(fx, 1-fx, fy, 1-fy) * 4;
          inlandness = Math.min(1, inlandness);
        }
        const inlandBoost = inlandness * 0.18;
        h = base + tectonicH + detail + inlandBoost;
      }

      if (type === 'river_valley') {
        h += (1 - fx) * 0.25;
        if (valleyDepthFrac > 0) {
          const vc = 0.5 + simplex2D(fx * 2.5 + 10, 0.5) * 0.18
                         + simplex2D(fx * 5 + 20, 0.5) * 0.06;
          const dfc = Math.abs(fy - vc);
          const vw = 0.16 + simplex2D(fx * 3 + 30, fy * 0.3) * 0.05;
          h -= Math.max(0, 1 - (dfc / vw) ** 2) * valleyDepthFrac * 0.25;
        }
      }

      t[i] = Math.max(0, Math.min(1, h));
      hn[i] = fbmSimplex(fx * 12 + 100, fy * 12 + 100, 4, 2.0, 0.5) * 0.5 + 0.5;
    }
  }

  // Normalize
  let mn = Infinity, mx = -Infinity;
  for (let i = 0; i < N; i++) { if (t[i] < mn) mn = t[i]; if (t[i] > mx) mx = t[i]; }
  const range = mx - mn || 1;
  for (let i = 0; i < N; i++) t[i] = (t[i] - mn) / range;

  // ── Force ocean in corner ──
  if (forceOcean) {
    const corners = [
      { cx: 0, cy: 0 }, { cx: GW-1, cy: 0 },
      { cx: 0, cy: GH-1 }, { cx: GW-1, cy: GH-1 },
    ];
    const quadSize = Math.floor(Math.min(GW, GH) * 0.4);
    let bestCorner = 0, bestAvg = Infinity;
    for (let c = 0; c < 4; c++) {
      let sum = 0, count = 0;
      const sx = corners[c].cx === 0 ? 0 : GW - quadSize;
      const sy = corners[c].cy === 0 ? 0 : GH - quadSize;
      for (let y = sy; y < sy + quadSize && y < GH; y++) {
        for (let x = sx; x < sx + quadSize && x < GW; x++) {
          sum += t[y * GW + x]; count++;
        }
      }
      if (sum / count < bestAvg) { bestAvg = sum / count; bestCorner = c; }
    }

    const ocx = corners[bestCorner].cx, ocy = corners[bestCorner].cy;
    for (let y = 0; y < GH; y++) {
      for (let x = 0; x < GW; x++) {
        const fx = x / GW, fy = y / GH;
        const dx = (x - ocx) / GW, dy = (y - ocy) / GH;
        const cornerDist = Math.sqrt(dx * dx + dy * dy);
        const cornerDepth = Math.max(0, 1 - cornerDist / 0.7);
        const edgeDistX = ocx === 0 ? fx : (1 - fx);
        const edgeDistY = ocy === 0 ? fy : (1 - fy);
        const edgeDepthX = Math.max(0, 1 - edgeDistY / 0.35) * Math.max(0, 1 - edgeDistX / 0.8);
        const edgeDepthY = Math.max(0, 1 - edgeDistX / 0.35) * Math.max(0, 1 - edgeDistY / 0.8);
        const depression = Math.max(cornerDepth * cornerDepth, edgeDepthX, edgeDepthY);
        t[y * GW + x] -= depression * 0.4;
        t[y * GW + x] = Math.max(0.01, t[y * GW + x]);
      }
    }

    mn = Infinity; mx = -Infinity;
    for (let i = 0; i < N; i++) { if (t[i] < mn) mn = t[i]; if (t[i] > mx) mx = t[i]; }
    const range2 = mx - mn || 1;
    for (let i = 0; i < N; i++) t[i] = 0.03 + (t[i] - mn) / range2 * 0.94;
  }

  // Smooth micro-depressions
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 1; y < GH - 1; y++) {
      for (let x = 1; x < GW - 1; x++) {
        const i = y * GW + x;
        const avg = (t[i-1] + t[i+1] + t[i-GW] + t[i+GW]) * 0.25;
        if (avg > t[i]) t[i] += (avg - t[i]) * 0.5;
      }
    }
  }

  // Thermal erosion
  for (let pass = 0; pass < 8; pass++) {
    for (let y = 1; y < GH - 1; y++) {
      for (let x = 1; x < GW - 1; x++) {
        const i = y * GW + x;
        const avg = (t[i-1] + t[i+1] + t[i-GW] + t[i+GW]) * 0.25;
        const diff = avg - t[i];
        if (Math.abs(diff) > 0.015) t[i] += diff * 0.35;
      }
    }
  }

  // ── Particle hydraulic erosion pre-pass ──
  const NUM_PARTICLES = Math.round(GW * GH * genErosionPasses);
  const P_INERTIA = 0.4, P_CAPACITY = 6.0, P_DEPOSITION = 0.03;
  const P_EROSION = 0.015, P_EVAP = 0.005, P_GRAVITY = 10;
  const P_MIN_SLOPE = 0.001, P_RADIUS = 3;
  const flowAccum = new Float32Array(N);

  for (let particle = 0; particle < NUM_PARTICLES; particle++) {
    let px = Math.random() * (GW - 2) + 1;
    let py = Math.random() * (GH - 2) + 1;
    let dirX = 0, dirY = 0, pSpeed = 0, pWater = 1.0, pSediment = 0;

    for (let step = 0; step < 80; step++) {
      const ix = px | 0, iy = py | 0;
      if (ix < 1 || ix >= GW - 1 || iy < 1 || iy >= GH - 1) break;
      const ci = iy * GW + ix;
      const fx = px - ix, fy = py - iy;
      const h00 = t[ci], h10 = t[ci + 1], h01 = t[ci + GW], h11 = t[ci + GW + 1];
      const gradX = (h10 - h00) * (1 - fy) + (h11 - h01) * fy;
      const gradY = (h01 - h00) * (1 - fx) + (h11 - h10) * fx;

      dirX = dirX * P_INERTIA - gradX * (1 - P_INERTIA);
      dirY = dirY * P_INERTIA - gradY * (1 - P_INERTIA);
      const dl = Math.sqrt(dirX * dirX + dirY * dirY);
      if (dl < 0.0001) break;
      dirX /= dl; dirY /= dl;

      const newX = px + dirX, newY = py + dirY;
      if (newX < 1 || newX >= GW - 1 || newY < 1 || newY >= GH - 1) break;

      const ni = (newY | 0) * GW + (newX | 0);
      const newH = t[ni];
      const oldH = h00 * (1-fx) * (1-fy) + h10 * fx * (1-fy) + h01 * (1-fx) * fy + h11 * fx * fy;
      const hDiff = newH - oldH;
      const slope = Math.max(-hDiff, P_MIN_SLOPE);
      const capacity = Math.max(slope, P_MIN_SLOPE) * pSpeed * pWater * P_CAPACITY;

      if (pSediment > capacity || hDiff > 0) {
        const deposit = (hDiff > 0)
          ? Math.min(pSediment, hDiff)
          : (pSediment - capacity) * P_DEPOSITION;
        pSediment -= deposit;
        t[ci] += deposit * 0.5;
        if (ci + 1 < N) t[ci + 1] += deposit * 0.125;
        if (ci - 1 >= 0) t[ci - 1] += deposit * 0.125;
        if (ci + GW < N) t[ci + GW] += deposit * 0.125;
        if (ci - GW >= 0) t[ci - GW] += deposit * 0.125;
      } else {
        const erodeAmt = Math.min((capacity - pSediment) * P_EROSION, -hDiff * 0.5);
        for (let ey = -P_RADIUS; ey <= P_RADIUS; ey++) {
          for (let ex = -P_RADIUS; ex <= P_RADIUS; ex++) {
            const eix = (px | 0) + ex, eiy = (py | 0) + ey;
            if (eix < 0 || eix >= GW || eiy < 0 || eiy >= GH) continue;
            const dist = Math.sqrt(ex * ex + ey * ey);
            if (dist > P_RADIUS) continue;
            const weight = 1 - dist / (P_RADIUS + 0.5);
            t[eiy * GW + eix] -= erodeAmt * weight * 0.15;
          }
        }
        pSediment += erodeAmt;
      }

      pSpeed = Math.sqrt(Math.max(0, pSpeed * pSpeed + hDiff * P_GRAVITY));
      pWater *= (1 - P_EVAP);
      px = newX; py = newY;
      const fci = (py | 0) * GW + (px | 0);
      if (fci >= 0 && fci < N) flowAccum[fci] += pWater;
      if (pWater < 0.01) break;
    }
  }

  // Smooth pockmarks from particle erosion
  for (let pass = 0; pass < 6; pass++) {
    for (let y = 1; y < GH - 1; y++) {
      for (let x = 1; x < GW - 1; x++) {
        const i = y * GW + x;
        const avg = (t[i-1] + t[i+1] + t[i-GW] + t[i+GW]) * 0.25;
        t[i] += (avg - t[i]) * 0.3;
      }
    }
  }

  // Re-normalize
  let mn2 = Infinity, mx2 = -Infinity;
  for (let i = 0; i < N; i++) { if (t[i] < mn2) mn2 = t[i]; if (t[i] > mx2) mx2 = t[i]; }
  const range2 = mx2 - mn2 || 1;
  for (let i = 0; i < N; i++) t[i] = (t[i] - mn2) / range2;

  state.hardnessNoise = hn;
  state.initialFlowAccum = flowAccum;
  return t;
}
