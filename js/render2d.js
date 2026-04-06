// Canvas 2D renderer — full resolution with bicubic terrain interpolation

import state from './state.js';
import { MIN_WATER, CONTOUR_INTERVAL, MAJOR_CONTOUR_EVERY, LAYERS } from './constants.js';
import { lerp, sampleGridFast, elevColor } from './math.js';
import { layerColor } from './helpers.js';

export function render(canvas, ctx, maxDepth) {
  const { terrain, water, isOceanCell, saturation, hardnessNoise,
          flowSpeed, waterSmooth, sources, tectonicStress, faultStress,
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

  // Pre-smooth water
  state.waterSmooth.set(water);
  const ws = state.waterSmooth;
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 1; y < GH - 1; y++) {
      for (let x = 1; x < GW - 1; x++) {
        const i = y * GW + x;
        ws[i] = water[i] * 0.4 +
          (ws[i-1] + ws[i+1] + ws[i-GW] + ws[i+GW]) * 0.15;
      }
    }
  }

  const d = state.imgFull.data;
  const REF_DEPTH = 0.04;
  const viewSize = GW / camZoom;
  const pxToGrid = viewSize / W;
  const pyToGrid = viewSize / H;

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
        const alpha = Math.min(1, (0.4 + depth * 0.6)) * waterOpacityUI;

        let wr, wg, wb;
        if (showPressure) {
          const pN = Math.min(1, w * SIM_GRAVITY * 1.5);
          wr = lerp(15, 180, pN) | 0; wg = lerp(60, 230, pN) | 0; wb = lerp(180, 255, pN) | 0;
        } else if (showVelocity) {
          const spd = flowSpeed ? Math.min(1, flowSpeed[ci] * 80) : 0;
          if (spd < 0.5) {
            const t2 = spd * 2;
            wr = lerp(20, 50, t2) | 0; wg = lerp(40, 220, t2) | 0; wb = lerp(180, 80, t2) | 0;
          } else {
            const t2 = (spd - 0.5) * 2;
            wr = lerp(50, 255, t2) | 0; wg = lerp(220, 100, t2) | 0; wb = lerp(80, 20, t2) | 0;
          }
        } else {
          wr = lerp(20, 65, depth) | 0; wg = lerp(80, 150, depth) | 0; wb = lerp(190, 220, depth) | 0;
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
}
