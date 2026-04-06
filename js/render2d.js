// Canvas 2D renderer — full resolution with bicubic terrain interpolation

import state from './state.js';
import { MIN_WATER, CONTOUR_INTERVAL, MAJOR_CONTOUR_EVERY, LAYERS } from './constants.js';
import { lerp, sampleGrid, sampleGridFast, elevColor } from './math.js';
import { layerColor } from './helpers.js';

export function render(canvas, ctx, maxDepth) {
  const { terrain, water, isOceanCell, saturation, hardnessNoise,
          flowSpeed, waterSmooth, sources, tectonicStress, faultStress,
          fluxL, fluxR, fluxU, fluxD,
          GW, GH, seaLevel, camX, camY, camZoom,
          viewMode, showContours, showLayers, showPressure, showVelocity,
          showFaultLines, SIM_WATER_THRESH, SIM_GRAVITY,
          waterOpacityUI } = state;

  const W = canvas.width, H = canvas.height;
  const N = GW * GH;
  if (!state.imgFull || state.imgFull.width !== W || state.imgFull.height !== H) {
    state.imgFull = ctx.createImageData(W, H);
  }
  if (!state.waterSmooth || state.waterSmooth.length !== N) {
    state.waterSmooth = new Float32Array(N);
  }

  // Light water smoothing — one pass, mostly preserves shape
  state.waterSmooth.set(water);
  const ws = state.waterSmooth;
  for (let y = 1; y < GH - 1; y++) {
    for (let x = 1; x < GW - 1; x++) {
      const i = y * GW + x;
      ws[i] = water[i] * 0.7 +
        (water[i-1] + water[i+1] + water[i-GW] + water[i+GW]) * 0.075;
    }
  }

  const d = state.imgFull.data;
  const REF_DEPTH = 0.04;
  const viewSize = GW / camZoom;
  const pxToGrid = viewSize / W;
  const pyToGrid = viewSize / H;

  // Compute stats for overlays (5-number summary of active data)
  let statMin = Infinity, statMax = -Infinity, statSum = 0, statCount = 0;
  const statSamples = [];
  if (showVelocity && flowSpeed) {
    for (let i = 0; i < N; i++) {
      if (water[i] > 0.001) {
        const v = flowSpeed[i];
        if (v < statMin) statMin = v;
        if (v > statMax) statMax = v;
        statSum += v; statCount++;
        statSamples.push(v);
      }
    }
  } else if (showPressure) {
    for (let i = 0; i < N; i++) {
      if (water[i] > 0.001) {
        const v = water[i];
        if (v < statMin) statMin = v;
        if (v > statMax) statMax = v;
        statSum += v; statCount++;
        statSamples.push(v);
      }
    }
  }
  statSamples.sort((a, b) => a - b);
  const statMedian = statSamples.length > 0 ? statSamples[Math.floor(statSamples.length / 2)] : 0;
  const statQ1 = statSamples.length > 3 ? statSamples[Math.floor(statSamples.length * 0.25)] : statMin;
  const statQ3 = statSamples.length > 3 ? statSamples[Math.floor(statSamples.length * 0.75)] : statMax;
  // For velocity rendering: normalize to the 95th percentile so outliers don't crush the range
  const velScale = statSamples.length > 10 ? statSamples[Math.floor(statSamples.length * 0.95)] : 1;

  for (let py = 0; py < H; py++) {
    const gyf = camY + py * pyToGrid;
    for (let px = 0; px < W; px++) {
      const gxf = camX + px * pxToGrid;
      const off = (py * W + px) * 4;

      if (gxf < 0 || gxf >= GW - 1 || gyf < 0 || gyf >= GH - 1) {
        d[off] = 13; d[off+1] = 17; d[off+2] = 23; d[off+3] = 255;
        continue;
      }

      let tr, tg, tb;
      const gx = Math.min(GW - 1, gxf | 0);
      const gy = Math.min(GH - 1, gyf | 0);
      const ci = gy * GW + gx;
      const h = sampleGridFast(terrain, gxf, gyf);
      const isOcean = isOceanCell ? isOceanCell[ci] : false;
      const w = Math.max(0, sampleGridFast(ws, gxf, gyf));

      if (viewMode === 'height') {
        const v = Math.max(0, Math.min(255, h * 280)) | 0;
        tr = v; tg = v; tb = v;
      } else if (viewMode === 'material') {
        const lc = layerColor(ci);
        const satShade = saturation ? (0.85 + (1 - saturation[ci]) * 0.15) : 1.0;
        tr = lc.r * satShade | 0;
        tg = lc.g * satShade | 0;
        tb = lc.b * satShade | 0;
      } else if (viewMode === 'exposed') {
        const isBelowSea = h < seaLevel;
        if (w > MIN_WATER * 2 || isBelowSea) {
          const depth = isBelowSea ? Math.min(1, (seaLevel - h) / 0.15) : Math.min(1, w / REF_DEPTH);
          tr = lerp(50, 15, depth) | 0;
          tg = lerp(120, 40, depth) | 0;
          tb = lerp(200, 130, depth) | 0;
        } else {
          const shade = 0.7 + h * 0.5;
          tr = 180 * shade | 0;
          tg = 165 * shade | 0;
          tb = 130 * shade | 0;
        }
      } else {
        if (showLayers) {
          const lc = layerColor(ci);
          const e = terrain[ci];
          const noiseShade = hardnessNoise ? (0.9 + hardnessNoise[ci] * 0.2) : 1.0;
          const shade = (0.75 + e * 0.45) * noiseShade;
          tr = lc.r * shade | 0;
          tg = lc.g * shade | 0;
          tb = lc.b * shade | 0;
        } else {
          [tr, tg, tb] = elevColor(h);
        }
      }

      // Contour lines
      if (showContours) {
        const hR = sampleGridFast(terrain, gxf + pxToGrid, gyf);
        const hD = sampleGridFast(terrain, gxf, gyf + pyToGrid);
        const lvl  = Math.floor(h / CONTOUR_INTERVAL);
        const lvlR = Math.floor(hR / CONTOUR_INTERVAL);
        const lvlD = Math.floor(hD / CONTOUR_INTERVAL);
        if (lvl !== lvlR || lvl !== lvlD) {
          const crossLvl = Math.max(lvl, lvlR, lvlD);
          const isMajor = crossLvl % MAJOR_CONTOUR_EVERY === 0;
          const boost = isMajor ? 55 : 20;
          tr = Math.min(255, tr + boost);
          tg = Math.min(255, tg + boost);
          tb = Math.min(255, tb + boost);
        }
      }

      // Water overlay
      if (viewMode !== 'exposed' && w > (isOcean ? 0.001 : SIM_WATER_THRESH)) {
        const depth = Math.min(1, w / REF_DEPTH);
        // Quick ramp to visible, then gradual increase with depth
        const alpha = Math.min(1, 0.6 + depth * 0.4) * waterOpacityUI;

        let wr, wg, wb;
        if (showPressure) {
          const pN = Math.min(1, w * SIM_GRAVITY * 1.5);
          wr = lerp(15, 180, pN) | 0; wg = lerp(60, 230, pN) | 0; wb = lerp(180, 255, pN) | 0;
        } else if (showVelocity) {
          // Smooth velocity sampling + auto-scale to 95th percentile
          let rawSpd = flowSpeed ? flowSpeed[ci] : 0;
          if (flowSpeed && ci > GW && ci < N - GW) {
            rawSpd = (flowSpeed[ci] * 0.4 +
              (flowSpeed[ci-1] + flowSpeed[ci+1] + flowSpeed[ci-GW] + flowSpeed[ci+GW]) * 0.15);
          }
          const spd = Math.min(1, velScale > 0 ? rawSpd / velScale : 0);
          if (spd < 0.5) {
            const t2 = spd * 2;
            wr = lerp(20, 50, t2) | 0; wg = lerp(40, 220, t2) | 0; wb = lerp(180, 80, t2) | 0;
          } else {
            const t2 = (spd - 0.5) * 2;
            wr = lerp(50, 255, t2) | 0; wg = lerp(220, 100, t2) | 0; wb = lerp(80, 20, t2) | 0;
          }
        } else {
          wr = lerp(30, 15, depth) | 0; wg = lerp(100, 50, depth) | 0; wb = lerp(210, 180, depth) | 0;
        }

        const a = alpha;
        tr = tr * (1 - a) + wr * a | 0;
        tg = tg * (1 - a) + wg * a | 0;
        tb = tb * (1 - a) + wb * a | 0;
      }

      d[off] = tr; d[off+1] = tg; d[off+2] = tb; d[off+3] = 255;
    }
  }

  ctx.putImageData(state.imgFull, 0, 0);

  // Helper: grid coords → screen coords
  const g2sx = gx => (gx - camX) / viewSize * W;
  const g2sy = gy => (gy - camY) / viewSize * H;
  const cellPx = W / viewSize;

  // Fault line overlay
  if (showFaultLines && tectonicStress) {
    ctx.globalAlpha = 0.6;
    for (let gy = 0; gy < GH; gy++) {
      for (let gx = 0; gx < GW; gx++) {
        const i = gy * GW + gx;
        const s = tectonicStress[i];
        const f = faultStress ? faultStress[i] : 0;
        const absS = Math.abs(s);
        if (absS < 0.05 && f < 0.1) continue;
        const sx = g2sx(gx), sy = g2sy(gy);
        if (sx < -cellPx || sx > W + cellPx || sy < -cellPx || sy > H + cellPx) continue;
        if (s > 0.05) ctx.fillStyle = `rgba(255,60,30,${Math.min(0.8, absS * 2)})`;
        else if (s < -0.05) ctx.fillStyle = `rgba(180,50,255,${Math.min(0.8, absS * 2)})`;
        else if (f > 0.1) ctx.fillStyle = `rgba(255,220,40,${Math.min(0.8, f * 0.5)})`;
        else continue;
        ctx.fillRect(sx, sy, Math.max(1, cellPx), Math.max(1, cellPx));
      }
    }
    ctx.globalAlpha = 1;
  }

  // Flow direction arrows (when velocity overlay is on)
  if (showVelocity && fluxL && fluxR && fluxU && fluxD) {
    // Draw arrows every N cells based on zoom level
    const arrowSpacing = Math.max(2, Math.floor(4 / camZoom));
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 1;

    for (let gy = arrowSpacing; gy < GH - 1; gy += arrowSpacing) {
      for (let gx = arrowSpacing; gx < GW - 1; gx += arrowSpacing) {
        const i = gy * GW + gx;
        if (water[i] < 0.001) continue;

        const wd = Math.max(water[i], 0.001);
        const vx = ((fluxR[i-1] || 0) - fluxL[i] + fluxR[i] - (fluxL[i+1] || 0)) * 0.5 / wd;
        const vy = ((fluxD[i-GW] || 0) - fluxU[i] + fluxD[i] - (fluxU[i+GW] || 0)) * 0.5 / wd;
        const mag = Math.sqrt(vx * vx + vy * vy);
        if (mag < 0.01) continue;

        const cx = g2sx(gx + 0.5);
        const cy = g2sy(gy + 0.5);
        if (cx < 0 || cx > W || cy < 0 || cy > H) continue;

        // Arrow length scales with speed, capped at 1.5 cells
        const arrowLen = Math.min(cellPx * 1.5, cellPx * 0.3 + (mag / (velScale || 1)) * cellPx);
        const nx = vx / mag, ny = vy / mag;
        const ex = cx + nx * arrowLen;
        const ey = cy + ny * arrowLen;

        // Line
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(ex, ey);
        ctx.stroke();

        // Arrowhead
        const headLen = Math.min(4, arrowLen * 0.35);
        const ax = -nx * headLen, ay = -ny * headLen;
        ctx.beginPath();
        ctx.moveTo(ex, ey);
        ctx.lineTo(ex + ax - ay * 0.4, ey + ay + ax * 0.4);
        ctx.lineTo(ex + ax + ay * 0.4, ey + ay - ax * 0.4);
        ctx.fill();
      }
    }
  }

  // Source markers
  for (const src of sources) {
    const sx = g2sx(src.gx + 0.5), sy = g2sy(src.gy + 0.5);
    if (sx < 0 || sx > W || sy < 0 || sy > H) continue;
    ctx.beginPath();
    ctx.arc(sx, sy, 4, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(100,200,255,0.5)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(150,230,255,0.8)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // 5-number summary stats overlay for pressure/velocity views
  if ((showPressure || showVelocity) && statCount > 0) {
    const label = showVelocity ? 'Velocity' : 'Pressure';
    const fmt = v => v < 0.001 ? v.toExponential(1) : v < 1 ? v.toFixed(3) : v.toFixed(1);
    const lines = [
      `${label} (${statCount} wet cells)`,
      `Min: ${fmt(statMin)}`,
      `Q1:  ${fmt(statQ1)}`,
      `Med: ${fmt(statMedian)}`,
      `Q3:  ${fmt(statQ3)}`,
      `Max: ${fmt(statMax)}`,
    ];
    ctx.font = '10px monospace';
    ctx.fillStyle = 'rgba(13,17,23,0.8)';
    const bx = W - 130, by = 8;
    ctx.fillRect(bx, by, 122, lines.length * 14 + 8);
    ctx.fillStyle = '#58a6ff';
    lines.forEach((line, idx) => {
      ctx.fillStyle = idx === 0 ? '#8b949e' : '#58a6ff';
      ctx.fillText(line, bx + 6, by + 14 + idx * 14);
    });
  }
}
