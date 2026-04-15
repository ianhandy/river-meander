// Terrain generation — all terrain types including particle erosion pre-pass

import state from './data/state.js';
import { LAYERS } from './data/constants.js';
import { seedNoise, simplex2D, fbmSimplex, ridgedNoise, warpedRidged } from './util/noise.js';
import { lerp, smoothstep } from './util/math.js';

export function generateTerrain(seed, octaves, valleyDepthFrac, roughness, type, seaLvl, mtnHeight, forceOcean) {
  seedNoise(seed);
  const { GW, GH, genNumPlates, genErosionPasses } = state;

  const N = GW * GH;
  const t = new Float32Array(N);
  const hn = new Float32Array(N);
  const gain = 0.35 + roughness * 0.3;

  // Precompute high-frequency per-cell grain texture (position-based hash,
  // seed-independent so it's consistent across regenerations).
  const grainTexture = new Float32Array(N);
  for (let y = 0; y < GH; y++) {
    for (let x = 0; x < GW; x++) {
      const i = y * GW + x;
      let v = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
      grainTexture[i] = v - Math.floor(v);
    }
  }
  state.grainTexture = grainTexture;

  // ── Delta: river widens gradually into a coastal plain ─────────────────
  // One continuous river path from top to bottom. The valley width and
  // wall height change smoothly with latitude: narrow/deep upstream,
  // wide/flat near the coast. No separate zones — the delta emerges
  // naturally as the valley opens out and terrain relief drops to zero.
  // Ocean across the entire bottom edge.
  if (type === 'delta') {
    // ── Phase 1: Meandering river path, top to bottom ──
    const riverCenterX = GW * (0.42 + simplex2D(seed * 0.1, 0.5) * 0.16);
    const entryX = Math.round(riverCenterX);
    const pathSteps = Math.ceil(GH * 1.15);
    const riverPath = [];

    for (let s = 0; s <= pathSteps; s++) {
      const pt = s / pathSteps;
      const py = pt * (GH - 2) + 1;
      // Meander amplitude grows in the middle, shrinks near entry/exit
      const env = Math.sin(pt * Math.PI);
      const amp = GW * 0.08;
      const meander = (
        simplex2D(pt * 2.5 + seed * 0.13, 0.5) * amp * 0.7 +
        simplex2D(pt * 6   + seed * 0.37, 0.5) * amp * 0.3
      ) * env * env;
      const px = Math.max(3, Math.min(GW - 4, riverCenterX + meander));
      // Height: concave drop — steep upstream, gentle near coast
      // Channel must stay above sea level (same fix as river_valley)
      const entryH = 0.48, coastH = seaLvl + 0.01;
      const h = entryH - (entryH - coastH) * Math.pow(pt, 0.55);
      riverPath.push({ x: px, y: py, h });
    }

    // ── Phase 2: Distance field (projection-based, same as river_valley) ──
    const pathDist = new Float32Array(N);
    const pathH    = new Float32Array(N);
    for (let y = 0; y < GH; y++) {
      for (let x = 0; x < GW; x++) {
        // Delta path runs top→bottom, so projection ≈ y / GH
        const pt = Math.max(0, Math.min(1, y / (GH - 1)));
        const k = Math.min(pathSteps, Math.round(pt * pathSteps));
        const rp = riverPath[k];
        const dx = x - rp.x, dy = y - rp.y;
        const i = y * GW + x;
        pathDist[i] = Math.sqrt(dx * dx + dy * dy);
        pathH[i] = rp.h;
      }
    }

    // ── Phase 3: Build terrain — one continuous formula ──
    // All parameters vary smoothly with fy (latitude):
    //   channelR:  4 → 8         (channel widens toward coast)
    //   valleyR:   18 → 80       (valley opens out into plain)
    //   valleyH:   0.035 → 0.003 (walls shrink — delta is flat)
    //   outerMax:  0.20 → 0.02   (surrounding terrain drops)
    //   mtnScale:  1.0 → 0.0     (mountains only upstream)

    for (let y = 0; y < GH; y++) {
      for (let x = 0; x < GW; x++) {
        const i = y * GW + x;
        const fx = x / GW, fy = y / GH;
        const dist = pathDist[i];
        const riverH = pathH[i];

        // Smooth latitude-dependent parameters
        const coastT = Math.pow(fy, 1.5); // 0 at top, ~1 at bottom (nonlinear)
        const channelR = lerp(4, 8, coastT);
        const valleyR  = lerp(18, 80, coastT);
        const valleyH  = lerp(0.035, 0.003, coastT);
        const bankH    = lerp(0.008, 0.001, coastT);
        const outerMax = lerp(0.20, 0.02, coastT);
        const mtnScale = Math.max(0, 1 - coastT * 2.5); // fades to 0 at fy≈0.4

        let h;

        if (dist <= channelR) {
          const ct = dist / channelR;
          h = riverH + ct * ct * bankH;
        } else if (dist <= valleyR) {
          const vt = (dist - channelR) / (valleyR - channelR);
          h = riverH + bankH + vt * vt * valleyH;
          // Valley wall noise — less on the flat delta
          h += simplex2D(fx * 12 + seed * 0.7, fy * 12 + seed * 0.8) * 0.004 * vt * (1 - coastT);
          h += simplex2D(fx * 6 + seed * 0.9, fy * 6 + seed * 1.1) * 0.002 * vt * (1 - coastT);
        } else {
          const outerDist = dist - valleyR;
          const rise = Math.min(outerMax, outerDist * lerp(0.002, 0.0003, coastT));
          h = riverH + bankH + valleyH + rise;

          // Hills — amplitude fades toward coast
          const hillRamp = Math.min(1, outerDist / 40) * (1 - coastT * 0.8);
          h += fbmSimplex(fx * 5 + seed * 0.1, fy * 5 + seed * 0.2, 4, 2.0, 0.4) * 0.02 * hillRamp;
          h += fbmSimplex(fx * 10 + seed * 0.3, fy * 10 + seed * 0.4, 3, 2.0, 0.4) * 0.005 * (1 - coastT * 0.5);

          // Mountains — only upstream half
          if (mtnScale > 0 && outerDist > 35) {
            const mtnT = Math.min(1, (outerDist - 35) / 50);
            h += ridgedNoise(fx * 6 + seed * 0.05, fy * 6 + seed * 0.06, 3, 2.0, 0.5) * mtnHeight * 0.3 * mtnT * mtnScale;
          }
        }

        // Micro-texture (skip channel floor)
        if (dist > channelR) {
          h += simplex2D(fx * 25 + seed * 0.5, fy * 25 + seed * 0.6) * 0.001;
        }

        t[i] = Math.max(0.005, h);
        hn[i] = fbmSimplex(fx * 12 + 100, fy * 12 + 100, 4, 2.0, 0.5) * 0.5 + 0.5;
      }
    }

    // Smooth micro-depressions in uplands only (protect valley + delta plain)
    for (let pass = 0; pass < 6; pass++) {
      for (let y = 1; y < GH - 1; y++) {
        for (let x = 1; x < GW - 1; x++) {
          const i = y * GW + x;
          const fy = y / GH;
          const valleyR = lerp(18, 80, Math.pow(fy, 1.5));
          if (pathDist[i] <= valleyR) continue;
          const avg = (t[i - 1] + t[i + 1] + t[i - GW] + t[i + GW]) * 0.25;
          if (avg > t[i]) t[i] += (avg - t[i]) * 0.6;
        }
      }
    }

    // Monotonic enforcement — Bresenham rasterized (same as river_valley)
    {
      const spineCells = [];
      const onSpine = new Uint8Array(N);
      const addCell = (cx, cy) => {
        if (cx < 0 || cx >= GW || cy < 0 || cy >= GH) return;
        const idx = cy * GW + cx;
        if (!onSpine[idx]) { onSpine[idx] = 1; spineCells.push(idx); }
      };
      for (let k = 0; k < riverPath.length - 1; k++) {
        let x0 = Math.round(riverPath[k].x),   y0 = Math.round(riverPath[k].y);
        const x1 = Math.round(riverPath[k+1].x), y1 = Math.round(riverPath[k+1].y);
        const adx = Math.abs(x1 - x0), ady = Math.abs(y1 - y0);
        const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
        let err = adx - ady;
        while (true) {
          addCell(x0, y0);
          if (x0 === x1 && y0 === y1) break;
          const e2 = 2 * err;
          if (e2 > -ady) { err -= ady; x0 += sx; }
          if (e2 <  adx) { err += adx; y0 += sy; }
        }
      }
      let ceiling = t[spineCells[0]] + 0.001;
      for (const idx of spineCells) {
        if (t[idx] >= ceiling) t[idx] = Math.max(0.005, ceiling - 0.004);
        ceiling = t[idx];
      }
      const visited = new Uint8Array(N);
      const nearH   = new Float32Array(N);
      const queue    = [];
      for (const idx of spineCells) {
        visited[idx] = 1; nearH[idx] = t[idx]; queue.push(idx);
      }
      let head = 0;
      while (head < queue.length) {
        const idx = queue[head++];
        const d = visited[idx];
        const chR = lerp(4, 8, Math.pow(((idx / GW) | 0) / GH, 1.5));
        if (d > chR + 1) continue;
        const cx = idx % GW, cy = (idx / GW) | 0;
        for (const [ddx, ddy] of [[-1,0],[1,0],[0,-1],[0,1]]) {
          const nx = cx + ddx, ny = cy + ddy;
          if (nx < 0 || nx >= GW || ny < 0 || ny >= GH) continue;
          const ni = ny * GW + nx;
          if (visited[ni]) continue;
          visited[ni] = d + 1;
          nearH[ni] = nearH[idx];
          queue.push(ni);
          const target = nearH[ni] + d * 0.001;
          if (t[ni] > target) t[ni] = target;
        }
      }
    }

    // ── Set entry state ──
    state.mainRiverEntryEdge = 'top';
    state.mainRiverEntryT    = entryX / (GW - 1);
    state.hardnessNoise      = hn;
    state.initialFlowAccum   = null;
    state.plates             = [];
    state.tectonicStress     = new Float32Array(N);
    state.faultStress        = new Float32Array(N);
    return t;
  }

  // ── Central River: pre-carved river channel running N→S through center ──
  // High terrain flanks the channel on both sides. River has a gentle downhill
  // gradient so water flows naturally from source (top) to ocean (bottom).
  if (type === 'central_river') {
    // Build a meandering center-line X coordinate for each row
    const centerX = new Float32Array(GH);
    for (let y = 0; y < GH; y++) {
      const fy = y / GH;
      // Low-frequency meander using noise
      const meander = simplex2D(fy * 2.5 + seed * 0.1, 0.5) * 0.10
                    + simplex2D(fy * 6.0 + seed * 0.3, 0.5) * 0.04;
      centerX[y] = Math.max(GW * 0.15, Math.min(GW * 0.85, GW * (0.5 + meander)));
    }

    const channelW   = Math.max(4, GW * 0.04);  // river width in cells
    const bankW      = GW * 0.20;               // levee/floodplain width
    const riverDepth = 0.08;                     // how deep the channel is carved

    for (let y = 0; y < GH; y++) {
      for (let x = 0; x < GW; x++) {
        const i = y * GW + x;
        const fx = x / GW, fy = y / GH;

        // Base north-to-south slope: 0.75 at top → 0.05 at bottom
        let h = 0.75 - fy * 0.65;

        // Broad valley: terrain slopes down toward the river center
        const distFromRiver = Math.abs(x - centerX[y]);
        const valleyFalloff  = Math.min(1, distFromRiver / (bankW * 0.8));
        h += valleyFalloff * 0.12;  // flanks are higher than river corridor

        // Medium-scale noise for rolling hills on the flanks
        h += simplex2D(fx * 4 + seed * 0.15, fy * 4 + seed * 0.25) * 0.04;
        h += simplex2D(fx * 9 + seed * 0.4,  fy * 9 + seed * 0.5)  * 0.015;

        // Carve the channel — smooth cosine cross-section within channelW radius
        if (distFromRiver < channelW) {
          const t01 = distFromRiver / channelW; // 0 at center, 1 at bank edge
          const depth = (1 - t01 * t01) * riverDepth;
          h -= depth;
        }

        // Ocean at the southern quarter
        if (fy > 0.78) {
          const oceanT = (fy - 0.78) / 0.22;
          h -= oceanT * 0.35;
        }

        t[i] = Math.max(0.01, h);
        hn[i] = simplex2D(fx * 12 + 100, fy * 12 + 100) * 0.5 + 0.5;
      }
    }

    state.hardnessNoise = hn;
    state.initialFlowAccum = null;
    state.mainRiverEntryEdge = 'top';
    state.mainRiverEntryT = centerX[0] / GW;
    state.plates = [];
    state.tectonicStress = new Float32Array(N);
    state.faultStress = new Float32Array(N);
    return t;
  }

  // ── Floodplain: clean generation ──
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
    for (let x = 0; x < GW; x++) {
      const cy = Math.round(valleyY[x]);
      for (let dy = -2; dy <= 2; dy++) {
        const y = cy + dy;
        if (y < 0 || y >= GH) continue;
        const falloff = 1 - Math.abs(dy) / 3;
        t[y * GW + x] -= 0.04 * falloff;
      }
    }
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

  // ── River Valley: river-first terrain ──────────────────────────────────────
  // The river path is planned FIRST, then terrain is built around it.
  // This guarantees the river is the lowest path through the landscape,
  // with a monotonic gradient from entry edge down to the ocean corner.
  if (type === 'river_valley') {
    // ── Phase 1: Pick entry edge + ocean corner ──
    // Use seed to deterministically choose entry edge (never bottom — that's outlet)
    const edgeRand = simplex2D(seed * 0.7 + 100, 0.5);
    const edgeIdx = edgeRand < -0.33 ? 1 : edgeRand > 0.33 ? 2 : 0; // 0=top,1=left,2=right
    // Position along edge: 0.15-0.45 (toward the end that maximises diagonal)
    const edgePos = 0.15 + Math.abs(simplex2D(seed * 0.3 + 200, 0.5)) * 0.30;

    let entryX, entryY, entryEdge;
    if (edgeIdx === 0)      { entryEdge = 'top';   entryX = Math.round(edgePos * GW); entryY = 0; }
    else if (edgeIdx === 1) { entryEdge = 'left';  entryX = 0; entryY = Math.round(edgePos * GH); }
    else                    { entryEdge = 'right'; entryX = GW - 1; entryY = Math.round(edgePos * GH); }

    // Farthest corner from entry point → that's where the ocean goes
    const corners = [[0, GH - 1], [GW - 1, GH - 1], [0, 0], [GW - 1, 0]];
    let bestC = 0, bestD = 0;
    for (let c = 0; c < corners.length; c++) {
      const dx = entryX - corners[c][0], dy = entryY - corners[c][1];
      const d = dx * dx + dy * dy;
      if (d > bestD) { bestD = d; bestC = c; }
    }
    const [oceanX, oceanY] = corners[bestC];

    // ── Phase 2: Meandering river path ──
    const pdx = oceanX - entryX, pdy = oceanY - entryY;
    const pathLen = Math.sqrt(pdx * pdx + pdy * pdy);
    const steps = Math.ceil(pathLen * 1.2);
    const dirX = pdx / pathLen, dirY = pdy / pathLen;
    const perpX = -dirY, perpY = dirX; // perpendicular (90° CCW)

    const meaderAmp = Math.min(GW, GH) * 0.12;
    const riverPath = [];
    for (let s = 0; s <= steps; s++) {
      const pt = s / steps;
      let px = entryX + pt * pdx;
      let py = entryY + pt * pdy;

      // Meander envelope: 0 at ends, 1 in middle
      const env = Math.sin(pt * Math.PI);
      const env2 = env * env;
      const meander = (
        simplex2D(pt * 2.5 + seed * 0.13, 0.5) * meaderAmp * 0.7 +
        simplex2D(pt * 6.0 + seed * 0.37, 0.5) * meaderAmp * 0.3
      ) * env2;

      px += perpX * meander;
      py += perpY * meander;

      // Clamp within map
      px = Math.max(2, Math.min(GW - 3, px));
      py = Math.max(2, Math.min(GH - 3, py));

      // Monotonically decreasing height: concave power curve
      // Steep near the entry (mountain drainage), gentle near the ocean (delta).
      // This gives ~0.002/cell gradient at entry vs ~0.0005/cell near ocean.
      // Channel floor must stay ABOVE sea level — rivers flow INTO the
      // ocean, not under it.  If the floor drops below seaLvl, the ocean
      // BFS flood-fills up the channel and turns it into ocean cells.
      const entryH = 0.50, oceanH = seaLvl + 0.01;
      const h = entryH - (entryH - oceanH) * Math.pow(pt, 0.65);

      riverPath.push({ x: px, y: py, h });
    }

    // ── Phase 3: Row-based distance field ───────────────────────────────
    // For each row y, find the path point at that latitude. Since the path
    // always progresses entry→ocean (y always increases along the path),
    // each row maps to exactly one path crossing.  Every cell in a row
    // shares the same river height → heights are monotonically decreasing
    // by construction, with zero inversions at meander bends.
    //
    // pathDist = lateral distance |x - riverX(y)|
    // pathH    = river height at row y (monotonically decreasing)
    const rowRiverX = new Float32Array(GH);
    const rowRiverH = new Float32Array(GH);
    for (let y = 0; y < GH; y++) {
      let bestDy = Infinity, bestK = 0;
      for (let k = 0; k < riverPath.length; k++) {
        const dy = Math.abs(y - riverPath[k].y);
        if (dy < bestDy) { bestDy = dy; bestK = k; }
      }
      rowRiverX[y] = riverPath[bestK].x;
      rowRiverH[y] = riverPath[bestK].h;
    }
    // Force monotonic decrease across rows (handles ties / slight backtrack)
    let ceil = rowRiverH[0] + 0.001;
    for (let y = 0; y < GH; y++) {
      if (rowRiverH[y] >= ceil) rowRiverH[y] = ceil - 0.0003;
      ceil = rowRiverH[y];
    }

    const pathDist = new Float32Array(N);
    const pathH    = new Float32Array(N);
    for (let y = 0; y < GH; y++) {
      for (let x = 0; x < GW; x++) {
        const i = y * GW + x;
        pathDist[i] = Math.abs(x - rowRiverX[y]);
        pathH[i] = rowRiverH[y];
      }
    }

    // ── Phase 4: Build terrain from river outward ──
    const CHANNEL_R   = 5;      // channel floor radius (cells) — wide enough to see
    const VALLEY_R    = 22;     // valley half-width (cells)
    const VALLEY_H    = 0.035;  // valley wall height at rim above river
    const OUTER_SLOPE = 0.0015; // height gain per cell outside valley
    const MAX_OUTER   = 0.22;   // max rise above valley rim

    for (let y = 0; y < GH; y++) {
      for (let x = 0; x < GW; x++) {
        const i = y * GW + x;
        const fx = x / GW, fy = y / GH;
        const dist = pathDist[i];
        const riverH = pathH[i];
        let h;

        const BANK_H = 0.008; // channel bank edge height above deepest point
        if (dist <= CHANNEL_R) {
          // Channel floor: V-shaped — deepest at center, rises toward banks
          const ct = dist / CHANNEL_R;  // 0 at center, 1 at bank edge
          h = riverH + ct * ct * BANK_H;
        } else if (dist <= VALLEY_R) {
          // Valley walls: quadratic rise (U-shaped cross-section)
          const vt = (dist - CHANNEL_R) / (VALLEY_R - CHANNEL_R);
          h = riverH + BANK_H + vt * vt * VALLEY_H;
          // Subtle noise breaks up the perfect mathematical contour lines.
          // Amplitude grows from 0 at the channel bank to full at the rim.
          h += simplex2D(fx * 15 + seed * 0.7, fy * 15 + seed * 0.8) * 0.004 * vt;
          h += simplex2D(fx * 8 + seed * 0.9, fy * 8 + seed * 1.1) * 0.002 * vt;
        } else {
          // Outer terrain
          const outerDist = dist - VALLEY_R;
          const rise = Math.min(MAX_OUTER, outerDist * OUTER_SLOPE);
          h = riverH + BANK_H + VALLEY_H + rise;

          // Rolling hills noise (amplitude ramps with distance from river)
          const hillRamp = Math.min(1, outerDist / 40);
          h += fbmSimplex(fx * 4 + seed * 0.1, fy * 4 + seed * 0.2, 4, 2.0, 0.4) * 0.018 * hillRamp;
          h += fbmSimplex(fx * 10 + seed * 0.3, fy * 10 + seed * 0.4, 3, 2.0, 0.4) * 0.005;

          // Mountain ridges: only far from river.
          // ridgedNoise gives straight ridge lines without the spiral artifacts
          // that warpedRidged produces.
          const mtnStart = 40;
          if (outerDist > mtnStart) {
            const mtnT = Math.min(1, (outerDist - mtnStart) / 60);
            h += ridgedNoise(fx * 5 + seed * 0.05, fy * 5 + seed * 0.06, 4, 2.0, 0.5) * mtnHeight * 0.4 * mtnT;
            h += fbmSimplex(fx * 3 + seed * 0.5, fy * 3 + seed * 0.6, 3, 2.0, 0.45) * 0.03 * mtnT;
          }

          // Micro-texture only outside channel (prevents tiny dams in river)
          h += simplex2D(fx * 25 + seed * 0.5, fy * 25 + seed * 0.6) * 0.002;
        }

        t[i] = Math.max(0.01, h);
        hn[i] = fbmSimplex(fx * 12 + 100, fy * 12 + 100, 4, 2.0, 0.5) * 0.5 + 0.5;
      }
    }

    // Smooth micro-depressions in the OUTER terrain to prevent rainfall from
    // pooling in noise-created pits.  Skip the entire valley (dist ≤ VALLEY_R)
    // so the channel and banks keep their precise carved profile.
    for (let pass = 0; pass < 8; pass++) {
      for (let y = 1; y < GH - 1; y++) {
        for (let x = 1; x < GW - 1; x++) {
          const i = y * GW + x;
          if (pathDist[i] <= VALLEY_R) continue; // protect channel + valley walls
          const avg = (t[i - 1] + t[i + 1] + t[i - GW] + t[i + GW]) * 0.25;
          if (avg > t[i]) t[i] += (avg - t[i]) * 0.6;
        }
      }
    }

    // ── Phase 4b: Enforce monotonic decrease along river spine ──────────
    // Rasterize the parametric path onto the grid with Bresenham lines
    // so every grid cell is visited (no gaps when the path moves fast
    // at meander bends). Then BFS outward to flatten the inner channel.
    {
      // Bresenham line: visits every grid cell between (x0,y0)→(x1,y1)
      const spineCells = []; // ordered list of grid indices along spine
      const onSpine = new Uint8Array(N);
      const addCell = (cx, cy) => {
        if (cx < 0 || cx >= GW || cy < 0 || cy >= GH) return;
        const idx = cy * GW + cx;
        if (!onSpine[idx]) { onSpine[idx] = 1; spineCells.push(idx); }
      };
      for (let k = 0; k < riverPath.length - 1; k++) {
        let x0 = Math.round(riverPath[k].x),   y0 = Math.round(riverPath[k].y);
        const x1 = Math.round(riverPath[k+1].x), y1 = Math.round(riverPath[k+1].y);
        const adx = Math.abs(x1 - x0), ady = Math.abs(y1 - y0);
        const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
        let err = adx - ady;
        while (true) {
          addCell(x0, y0);
          if (x0 === x1 && y0 === y1) break;
          const e2 = 2 * err;
          if (e2 > -ady) { err -= ady; x0 += sx; }
          if (e2 <  adx) { err += adx; y0 += sy; }
        }
      }

      // Monotonic enforcement: walk rasterized spine, force each cell
      // strictly below the previous. No gaps possible.
      let ceiling = t[spineCells[0]] + 0.001;
      for (const idx of spineCells) {
        if (t[idx] >= ceiling) t[idx] = Math.max(0.005, ceiling - 0.004);
        ceiling = t[idx];
      }

      // BFS from spine: force inner channel (within CHANNEL_R) to be
      // at most spineH + small bank rise. Fills pits that trap water.
      const visited = new Uint8Array(N);
      const nearH   = new Float32Array(N);
      const queue    = [];
      for (const idx of spineCells) {
        visited[idx] = 1;
        nearH[idx] = t[idx];
        queue.push(idx);
      }
      let head = 0;
      while (head < queue.length) {
        const idx = queue[head++];
        const d = visited[idx];
        if (d > CHANNEL_R + 1) continue;
        const cx = idx % GW, cy = (idx / GW) | 0;
        for (const [ddx, ddy] of [[-1,0],[1,0],[0,-1],[0,1]]) {
          const nx = cx + ddx, ny = cy + ddy;
          if (nx < 0 || nx >= GW || ny < 0 || ny >= GH) continue;
          const ni = ny * GW + nx;
          if (visited[ni]) continue;
          visited[ni] = d + 1;
          nearH[ni] = nearH[idx];
          queue.push(ni);
          const target = nearH[ni] + (d * 0.001);
          if (t[ni] > target) t[ni] = target;
        }
      }
    }

    // ── Phase 5: Ocean depression at the ocean corner ──
    const oceanR = Math.min(GW, GH) * 0.22;
    for (let y = 0; y < GH; y++) {
      for (let x = 0; x < GW; x++) {
        const dx = x - oceanX, dy = y - oceanY;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < oceanR) {
          const falloff = 1 - d / oceanR;
          t[y * GW + x] -= falloff * falloff * 0.25;
          t[y * GW + x] = Math.max(0.005, t[y * GW + x]);
        }
      }
    }

    // ── Phase 6: Set state + return ──
    const entryT = entryEdge === 'top' ? entryX / (GW - 1)
                 : entryY / (GH - 1);  // left/right: position along vertical edge
    state.mainRiverEntryEdge = entryEdge;
    state.mainRiverEntryT    = entryT;
    state.hardnessNoise      = hn;
    state.initialFlowAccum   = null;
    state.plates             = [];
    state.tectonicStress     = new Float32Array(N);
    state.faultStress        = new Float32Array(N);
    return t;
  }

  // ── Step 1: Generate plate stress field ──
  let numPlates, hasContinentalMask;
  if (type === 'island') { numPlates = 2; hasContinentalMask = true; }
  else if (type === 'continent') { numPlates = 3; hasContinentalMask = true; }
  else if (type === 'mountain_range') { numPlates = 2; hasContinentalMask = false; }
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
      const warpAmt = Math.max(GW, GH) * 0.08;
      const warpX = x + simplex2D(fx * 2 + 300, fy * 2 + 300) * warpAmt;
      const warpY = y + simplex2D(fx * 2 + 400, fy * 2 + 400) * warpAmt;
      let d1 = Infinity, d2 = Infinity, p1 = 0, p2 = 0;
      for (let p = 0; p < numPlates; p++) {
        const dx = warpX - plates[p].px, dy = warpY - plates[p].py;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < d1) { d2 = d1; p2 = p1; d1 = d; p1 = p; }
        else if (d < d2) { d2 = d; p2 = p; }
      }
      const boundaryDist = Math.abs(d1 - d2);
      const falloffWidth = Math.max(GW, GH) * 0.15;
      const boundaryProx = Math.exp(-boundaryDist * boundaryDist / (falloffWidth * falloffWidth));
      const relVx = plates[p1].vx - plates[p2].vx;
      const relVy = plates[p1].vy - plates[p2].vy;
      const nx = plates[p2].px - plates[p1].px;
      const ny = plates[p2].py - plates[p1].py;
      const nl = Math.sqrt(nx * nx + ny * ny) || 1;
      const convergence = (relVx * nx / nl + relVy * ny / nl);
      stress[i] = convergence * boundaryProx;
    }
  }

  for (let pass = 0; pass < 20; pass++) {
    for (let y = 1; y < GH - 1; y++) {
      for (let x = 1; x < GW - 1; x++) {
        const i = y * GW + x;
        stress[i] = stress[i] * 0.5 +
          (stress[i-1] + stress[i+1] + stress[i-GW] + stress[i+GW]) * 0.125;
      }
    }
  }

  // ── Step 2: Build heightmap ──
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
        tectonicH = ridge * s * mtnHeight * 0.7;
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

      t[i] = Math.max(0, Math.min(1, h));
      hn[i] = fbmSimplex(fx * 12 + 100, fy * 12 + 100, 4, 2.0, 0.5) * 0.5 + 0.5;
    }
  }

  // Normalize
  let mn = Infinity, mx = -Infinity;
  for (let i = 0; i < N; i++) { if (t[i] < mn) mn = t[i]; if (t[i] > mx) mx = t[i]; }
  const range = mx - mn || 1;
  for (let i = 0; i < N; i++) t[i] = (t[i] - mn) / range;

  // Force ocean in corner
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

  // Compress tall peaks — prevents "vertical wall" mountains by flattening
  // the upper portion of the height range with a sqrt-like curve.
  for (let i = 0; i < N; i++) {
    if (t[i] > 0.55) {
      const excess = t[i] - 0.55;
      t[i] = 0.55 + excess * 0.55;
    }
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

  // Thermal erosion — more passes at tighter threshold to soften ridgelines
  for (let pass = 0; pass < 15; pass++) {
    for (let y = 1; y < GH - 1; y++) {
      for (let x = 1; x < GW - 1; x++) {
        const i = y * GW + x;
        const avg = (t[i-1] + t[i+1] + t[i-GW] + t[i+GW]) * 0.25;
        const diff = avg - t[i];
        if (Math.abs(diff) > 0.01) t[i] += diff * 0.4;
      }
    }
  }

  // ── Simulation-based erosion pre-pass ────────────────────────────────────
  // Run our actual water+erosion pipeline on the terrain before the player
  // sees it. This pre-carves channels that match how our water system works,
  // so rivers start in natural positions instead of random noise paths.
  //
  // Uses temporary state arrays, discards water after, keeps terrain changes.
  if (genErosionPasses > 0) {
    const steps = Math.round(genErosionPasses * 200);
    // Temporary arrays for the pre-pass
    const pw = new Float32Array(N);   // water
    const ps = new Float32Array(N);   // sediment
    const pfL = new Float32Array(N);  // flux L
    const pfR = new Float32Array(N);  // flux R
    const pfU = new Float32Array(N);  // flux U
    const pfD = new Float32Array(N);  // flux D
    const pfUL = new Float32Array(N); // flux UL
    const pfUR = new Float32Array(N); // flux UR
    const pfDL = new Float32Array(N); // flux DL
    const pfDR = new Float32Array(N); // flux DR
    const pTD = new Float32Array(N);  // terrain delta
    const pSD = new Float32Array(N);  // sediment delta
    const pFS = new Float32Array(N);  // flow speed

    const rainRate = 0.00005;
    const dt = 0.35, grav = 10, damp = 0.98, bedGravC = 0.6;

    for (let step = 0; step < steps; step++) {
      // Add rainfall
      for (let i = 0; i < N; i++) pw[i] += rainRate;

      // Simple 4-direction pipe model (fast, no features needed)
      for (let y = 0; y < GH; y++) {
        for (let x = 0; x < GW; x++) {
          const i = y * GW + x;
          pfL[i] *= damp; pfR[i] *= damp; pfU[i] *= damp; pfD[i] *= damp;
          const h = t[i] + pw[i];
          const w = pw[i];
          const bg = w > 0.0005 ? w * grav * bedGravC : 0;

          if (x < GW - 1) {
            const sd = h - t[i+1] - pw[i+1];
            const bs = t[i] - t[i+1];
            pfR[i] = Math.max(0, pfR[i] + dt * grav * sd + bg * Math.max(0, bs));
          }
          if (x > 0) {
            const sd = h - t[i-1] - pw[i-1];
            const bs = t[i] - t[i-1];
            pfL[i] = Math.max(0, pfL[i] + dt * grav * sd + bg * Math.max(0, bs));
          }
          if (y < GH - 1) {
            const sd = h - t[i+GW] - pw[i+GW];
            const bs = t[i] - t[i+GW];
            pfD[i] = Math.max(0, pfD[i] + dt * grav * sd + bg * Math.max(0, bs));
          }
          if (y > 0) {
            const sd = h - t[i-GW] - pw[i-GW];
            const bs = t[i] - t[i-GW];
            pfU[i] = Math.max(0, pfU[i] + dt * grav * sd + bg * Math.max(0, bs));
          }

          const tout = (pfL[i] + pfR[i] + pfU[i] + pfD[i]) * dt;
          if (tout > pw[i] + 0.0001) {
            const sc = (pw[i] + 0.0001) / tout;
            pfL[i] *= sc; pfR[i] *= sc; pfU[i] *= sc; pfD[i] *= sc;
          }
        }
      }

      // Update water depth
      for (let y = 0; y < GH; y++) {
        for (let x = 0; x < GW; x++) {
          const i = y * GW + x;
          const inR = x > 0 ? pfR[i-1] : 0;
          const inL = x < GW-1 ? pfL[i+1] : 0;
          const inD = y > 0 ? pfD[i-GW] : 0;
          const inU = y < GH-1 ? pfU[i+GW] : 0;
          pw[i] = Math.max(0, pw[i] + (inR + inL + inD + inU - pfL[i] - pfR[i] - pfU[i] - pfD[i]) * dt);

          // Edge drain
          if (x === 0 || x === GW-1 || y === 0 || y === GH-1) pw[i] *= 0.7;
          // Evaporate
          pw[i] *= 0.995;
        }
      }

      // Simple erosion: speed-based channel carving
      pTD.fill(0);
      for (let y = 1; y < GH - 1; y++) {
        for (let x = 1; x < GW - 1; x++) {
          const i = y * GW + x;
          if (pw[i] < 0.0001) continue;
          const wd = Math.max(pw[i], 0.01);
          const vx = (pfR[i] - pfL[i]) / wd;
          const vy = (pfD[i] - pfU[i]) / wd;
          const spd = Math.sqrt(vx * vx + vy * vy);
          if (spd < 0.01) continue;

          // Erode proportional to speed
          const erode = Math.min(spd * 0.001, 0.001);
          pTD[i] -= erode;
          // Deposit downstream
          const tot = pfL[i] + pfR[i] + pfU[i] + pfD[i];
          if (tot > 0.0001) {
            if (pfR[i] > 0 && x < GW-1) pTD[i+1] += erode * pfR[i] / tot * 0.5;
            if (pfL[i] > 0 && x > 0) pTD[i-1] += erode * pfL[i] / tot * 0.5;
            if (pfD[i] > 0 && y < GH-1) pTD[i+GW] += erode * pfD[i] / tot * 0.5;
            if (pfU[i] > 0 && y > 0) pTD[i-GW] += erode * pfU[i] / tot * 0.5;
          }
        }
      }
      // Apply terrain changes
      for (let i = 0; i < N; i++) {
        t[i] = Math.max(0.01, t[i] + Math.max(-0.002, Math.min(0.002, pTD[i])));
      }
    }

    // Smooth post-erosion artifacts
    for (let pass = 0; pass < 3; pass++) {
      for (let y = 1; y < GH - 1; y++) {
        for (let x = 1; x < GW - 1; x++) {
          const i = y * GW + x;
          const avg = (t[i-1] + t[i+1] + t[i-GW] + t[i+GW]) * 0.25;
          t[i] += (avg - t[i]) * 0.2;
        }
      }
    }
  }

  // Flow accumulation for source placement: each cell sends its
  // accumulation to its steepest downhill neighbor.
  const flowAccum = new Float32Array(N);
  // Sort cells by height (highest first)
  const sorted = Array.from({ length: N }, (_, i) => i);
  sorted.sort((a, b) => t[b] - t[a]);
  for (const i of sorted) {
    flowAccum[i] += 1; // each cell contributes 1
    const x = i % GW, y = (i / GW) | 0;
    let bestDrop = 0, bestNi = -1;
    for (const [dx, dy] of [[-1,0],[1,0],[0,-1],[0,1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || nx >= GW || ny < 0 || ny >= GH) continue;
      const ni = ny * GW + nx;
      const drop = t[i] - t[ni];
      if (drop > bestDrop) { bestDrop = drop; bestNi = ni; }
    }
    if (bestNi >= 0) flowAccum[bestNi] += flowAccum[i];
  }
  // Normalize to 0-1 range
  let maxFA = 0;
  for (let i = 0; i < N; i++) if (flowAccum[i] > maxFA) maxFA = flowAccum[i];
  if (maxFA > 0) for (let i = 0; i < N; i++) flowAccum[i] /= maxFA;

  // ── Flow-accumulation channel carving ────────────────────────────────────
  // Carve valleys proportional to upstream drainage area (Hack's Law analog).
  // Only affects high-accumulation cells (main channels), not every slope.
  // The power law exponent (0.45) matches empirical stream incision rates.
  // This is physically grounded — it approximates what millions of years of
  // erosion would produce, making rivers start in naturally correct positions.
  const CARVE_THRESHOLD = 0.04; // ignore small tributaries
  const CARVE_DEPTH     = 0.10; // max depth for the most-drained cell
  for (let i = 0; i < N; i++) {
    const fa = flowAccum[i];
    if (fa < CARVE_THRESHOLD) continue;
    // Power-law: big channels carve deep, small ones barely register
    const carve = Math.pow((fa - CARVE_THRESHOLD) / (1 - CARVE_THRESHOLD), 0.45) * CARVE_DEPTH;
    t[i] = Math.max(0.01, t[i] - carve);
  }

  // Light smoothing to blend carved channels into surrounding slopes
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 1; y < GH - 1; y++) {
      for (let x = 1; x < GW - 1; x++) {
        const i = y * GW + x;
        if (flowAccum[i] < CARVE_THRESHOLD) continue; // only smooth along channels
        const avg = (t[i-1] + t[i+1] + t[i-GW] + t[i+GW]) * 0.25;
        t[i] += (avg - t[i]) * 0.3;
      }
    }
  }

  // ── Find main river inlet + carve monotonic channel to ocean ────────────
  // The inlet is the highest-elevation non-ocean cell on the top/left/right
  // edges (we skip the bottom edge — that's the natural outlet side).
  // Entering from the highest point maximises the river's downhill run to
  // the ocean, guaranteeing it can reach it without dams.
  let entryEdge = 'top', entryX = 0, entryY = 0, entryT = 0.5;
  {
    let bestH = -1;
    // Average terrain over a thin strip near each edge so a single noisy peak
    // doesn't dominate; require the cell to be above sea level.
    const seaLvl = state.genSeaLevel || 0.20;
    const strip = Math.max(2, Math.floor(Math.min(GW, GH) * 0.02));
    const avgStrip = (getIdx) => {
      let s = 0; for (let d = 0; d < strip; d++) s += t[getIdx(d)]; return s / strip;
    };
    // Top edge: full width, skip first/last 10%
    for (let x = Math.floor(GW * 0.1); x < Math.floor(GW * 0.9); x++) {
      const h = avgStrip(d => d * GW + x);
      if (h > bestH && h > seaLvl) { bestH = h; entryEdge = 'top'; entryT = x / (GW - 1); entryX = x; entryY = 0; }
    }
    // Left/right edges: only top 55% (bottom half is the outlet/ocean side)
    for (let y = 2; y < Math.floor(GH * 0.55); y++) {
      const h = avgStrip(d => y * GW + d);
      if (h > bestH && h > seaLvl) { bestH = h; entryEdge = 'left'; entryT = y / (GH - 1); entryX = 0; entryY = y; }
    }
    for (let y = 2; y < Math.floor(GH * 0.55); y++) {
      const h = avgStrip(d => y * GW + (GW - 1 - d));
      if (h > bestH && h > seaLvl) { bestH = h; entryEdge = 'right'; entryT = y / (GH - 1); entryX = GW - 1; entryY = y; }
    }
  }

  // ── Dijkstra: carve minimum-uphill channel from entry to ocean ──────────
  // Edge cost = uphill rise to neighbour (0 if going downhill).
  // This finds the path that needs the least total carving to reach the
  // ocean, then carves it monotonically decreasing so water is guaranteed
  // to flow all the way from the entry edge to the sea.
  {
    // Tiny inline binary min-heap  [cost, cellIndex]
    const heapData = [];
    const heapPush = (c, i) => {
      heapData.push([c, i]);
      let k = heapData.length - 1;
      while (k > 0) {
        const p = (k - 1) >> 1;
        if (heapData[p][0] <= heapData[k][0]) break;
        [heapData[p], heapData[k]] = [heapData[k], heapData[p]]; k = p;
      }
    };
    const heapPop = () => {
      const top = heapData[0];
      const last = heapData.pop();
      if (heapData.length) {
        heapData[0] = last;
        let k = 0;
        for (;;) {
          const l = 2*k+1, r = 2*k+2;
          let m = k;
          if (l < heapData.length && heapData[l][0] < heapData[m][0]) m = l;
          if (r < heapData.length && heapData[r][0] < heapData[m][0]) m = r;
          if (m === k) break;
          [heapData[m], heapData[k]] = [heapData[k], heapData[m]]; k = m;
        }
      }
      return top;
    };

    const pathCost = new Float32Array(N).fill(1e9);
    const prevCell = new Int32Array(N).fill(-1);
    const startIdx = entryY * GW + entryX;
    pathCost[startIdx] = 0;
    heapPush(0, startIdx);
    let oceanCell = -1;

    while (heapData.length > 0) {
      const [c, idx] = heapPop();
      if (c > pathCost[idx] + 1e-7) continue; // stale entry
      const x = idx % GW, y = (idx / GW) | 0;
      // Reached ocean (below sea level or bottom edge)
      if (t[idx] < seaLvl || y >= GH - 1) { oceanCell = idx; break; }
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx2 = x + dx, ny2 = y + dy;
          if (nx2 < 0 || nx2 >= GW || ny2 < 0 || ny2 >= GH) continue;
          const ni = ny2 * GW + nx2;
          // Cost = uphill rise only; downhill is free
          const nc = c + Math.max(0, t[ni] - t[idx]);
          if (nc < pathCost[ni]) { pathCost[ni] = nc; prevCell[ni] = idx; heapPush(nc, ni); }
        }
      }
    }

    // Reconstruct path entry→ocean, carve a wide valley centered on the spine
    if (oceanCell >= 0) {
      const path = [];
      let ci = oceanCell;
      while (ci >= 0) { path.push(ci); ci = prevCell[ci]; }
      path.reverse(); // entry is now first

      // First pass: enforce strict monotonic decrease along the spine.
      // ceiling always tracks the ACTUAL height of the previous cell, so
      // each cell is forced strictly below the one before it — even across
      // long flat plateaus.  0.004 gradient ensures water keeps flowing.
      {
        let ceiling = t[path[0]] + 0.001; // +epsilon so first cell also drops
        for (const idx of path) {
          if (t[idx] >= ceiling) t[idx] = Math.max(0.005, ceiling - 0.004);
          ceiling = t[idx]; // always track actual current height
        }
      }

      // Second pass: BFS outward from the spine, each cell visited once.
      // Each cell gets a target height = nearestSpineH + dist * SLOPE.
      // Both carve ridges (lower if above target) AND fill depressions
      // (raise if below target) to produce a clean U-shaped valley
      // with no internal pits that could trap water.
      const VALLEY_R = 8;    // half-width in cells
      const SLOPE    = 0.008; // height gain per cell from spine
      const vDist    = new Uint8Array(N).fill(255);
      const nearestH = new Float32Array(N);
      const queue    = [];
      for (const idx of path) {
        vDist[idx] = 0;
        nearestH[idx] = t[idx];
        queue.push(idx);
      }
      let head = 0;
      while (head < queue.length) {
        const idx = queue[head++];
        const d = vDist[idx];
        if (d >= VALLEY_R) continue;
        const x = idx % GW, y = (idx / GW) | 0;
        for (const [dx, dy] of [[-1,0],[1,0],[0,-1],[0,1]]) {
          const nx2 = x + dx, ny2 = y + dy;
          if (nx2 < 0 || nx2 >= GW || ny2 < 0 || ny2 >= GH) continue;
          const ni = ny2 * GW + nx2;
          if (vDist[ni] !== 255) continue;
          vDist[ni] = d + 1;
          nearestH[ni] = nearestH[idx];
          queue.push(ni);
        }
      }
      // Apply valley profile: carve ridges AND fill pits within the valley
      for (let i = 0; i < N; i++) {
        if (vDist[i] === 255) continue;
        const target = Math.max(0.005, nearestH[i] + vDist[i] * SLOPE);
        // Only apply within 2 cells of spine for pit-filling (outer banks stay natural)
        if (vDist[i] <= 2) {
          t[i] = target; // force exact valley floor — no pits, no ridges
        } else {
          if (t[i] > target) t[i] = target; // carve ridges only on outer banks
        }
      }
    }
  }

  state.mainRiverEntryEdge = entryEdge;
  state.mainRiverEntryT    = entryT;
  state.hardnessNoise = hn;
  state.initialFlowAccum = flowAccum;
  return t;
}
