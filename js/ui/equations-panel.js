/**
 * equations-panel.js — Live equation tooltip display.
 *
 * When showEquations is enabled (toggle with 'E' key), hovering over a
 * cell shows a tooltip with the filled-in math for all active equations:
 *
 *   - Stream Power Erosion: tau, C_eq, E, vertical/lateral split
 *   - Terrain Diffusion: kappa, laplacian, dh
 *   - Water Balance: fluxes, velocity, net flow, stagnancy
 *
 * Only computes for the single hovered cell — zero performance cost.
 * Reads cell data from state arrays and calls each equation's compute().
 */

import state from '../data/state.js';
import { EQUATIONS } from '../data/equations.js';
import { getHardness, getBeachiness } from '../util/helpers.js';

let tooltipEl = null;

export function initEquationsPanel() {
  tooltipEl = document.getElementById('eq-tooltip');
  if (!tooltipEl) {
    tooltipEl = document.createElement('div');
    tooltipEl.id = 'eq-tooltip';
    tooltipEl.className = 'eq-tooltip hidden';
    document.body.appendChild(tooltipEl);
  }
}

/**
 * Gather cell data and compute all equations for the hovered cell.
 * Called on mousemove when showEquations is true.
 */
export function updateEquationsTooltip(clientX, clientY) {
  if (!state.showEquations || !tooltipEl) {
    if (tooltipEl) tooltipEl.classList.add('hidden');
    return;
  }

  const i = state.hoveredCell;
  if (i < 0 || !state.terrain) {
    tooltipEl.classList.add('hidden');
    return;
  }

  const { terrain, water, sediment, fluxL, fluxR, fluxU, fluxD,
          flowSpeed, isOceanCell, hardness,
          GW, GH, K, m: mExp, Kc, Kd, gravity, erodibilityUI, asymmetry,
          evapRate, movingEvapMult, stagnantEvapMult,
          kappaRock, kappaSoil, kappaSand } = state;

  if (isOceanCell[i]) {
    tooltipEl.classList.add('hidden');
    return;
  }

  const x = i % GW, y = (i / GW) | 0;
  if (x < 1 || x >= GW - 1 || y < 1 || y >= GH - 1) {
    tooltipEl.classList.add('hidden');
    return;
  }

  // ── Compute slope ──────────────────────────────────────────────────────
  const dhdx = (terrain[i + 1] - terrain[i - 1]) * 0.5;
  const dhdy = (terrain[i + GW] - terrain[i - GW]) * 0.5;
  const slope = Math.sqrt(dhdx * dhdx + dhdy * dhdy);

  // ── Compute curvature ──────────────────────────────────────────────────
  const speed = flowSpeed ? flowSpeed[i] : 0;
  let curvature = 0;
  if (speed > 0.005 && water[i] > 0.0001) {
    const wd = Math.max(water[i], 0.001);
    const vx = ((fluxR[i - 1] || 0) - fluxL[i] + fluxR[i] - (fluxL[i + 1] || 0)) * 0.5 / wd;
    const vy = ((fluxD[i - GW] || 0) - fluxU[i] + fluxD[i] - (fluxU[i + GW] || 0)) * 0.5 / wd;
    const spd = Math.sqrt(vx * vx + vy * vy);
    if (spd > 0.005) {
      const nvx = vx / spd, nvy = vy / spd;
      const upX = x - Math.round(nvx), upY = y - Math.round(nvy);
      if (upX >= 1 && upX < GW - 1 && upY >= 1 && upY < GH - 1) {
        const ui = upY * GW + upX;
        const uvx = ((fluxR[ui - 1] || 0) - fluxL[ui] + fluxR[ui] - (fluxL[ui + 1] || 0)) * 0.5;
        const uvy = ((fluxD[ui - GW] || 0) - fluxU[ui] + fluxD[ui] - (fluxU[ui + GW] || 0)) * 0.5;
        const uSpd = Math.sqrt(uvx * uvx + uvy * uvy);
        if (uSpd > 0.005) {
          const dot = (nvx * uvx + nvy * uvy) / uSpd;
          curvature = 1.0 - Math.max(0, dot);
        }
      }
    }
  }

  // ── Compute diffusion values ───────────────────────────────────────────
  const laplacian = (terrain[i - 1] + terrain[i + 1] + terrain[i - GW] + terrain[i + GW] - 4 * terrain[i]) * 0.25;
  const beachiness = getBeachiness(i);
  const localH = getHardness(i);

  // Compute kappa (same logic as diffusion.js)
  const logH = Math.log(Math.max(1, localH));
  const t = Math.min(1, Math.max(0, logH / 7.3));
  let kappa = kappaSoil * (1 - t) + kappaRock * t;
  if (beachiness > 0) kappa = kappa * (1 - beachiness) + kappaSand * beachiness;

  // ── Compute water balance ──────────────────────────────────────────────
  const totalOut = fluxL[i] + fluxR[i] + fluxU[i] + fluxD[i];
  const totalIn = (fluxR[i - 1] || 0) + (fluxL[i + 1] || 0) +
                   (fluxD[i - GW] || 0) + (fluxU[i + GW] || 0);
  const stagnancy = Math.exp(-(flowSpeed[i] || 0) * 5);
  const evapMult = movingEvapMult + stagnancy * stagnantEvapMult;
  const evapFrac = evapRate * evapMult;

  // ── Run each equation ──────────────────────────────────────────────────
  const results = [];

  const spResult = EQUATIONS.streamPower.compute({
    water: water[i], speed, slope, hardness: localH,
    sediment: sediment[i], K, m: mExp, Kc, Kd, gravity,
    erodibility: erodibilityUI, curvature, asymmetry,
    totalIn,
  });
  if (spResult.active) results.push(spResult);

  const dfResult = EQUATIONS.diffusion.compute({
    kappa, laplacian, beachiness,
  });
  if (dfResult.active) results.push(dfResult);

  const wbResult = EQUATIONS.waterBalance.compute({
    water: water[i], speed,
    fluxL: fluxL[i], fluxR: fluxR[i], fluxU: fluxU[i], fluxD: fluxD[i],
    totalIn, totalOut, stagnancy, evapFrac,
  });
  if (wbResult.active) results.push(wbResult);

  if (results.length === 0) {
    tooltipEl.classList.add('hidden');
    return;
  }

  // ── Render tooltip ─────────────────────────────────────────────────────
  let html = '';
  for (const result of results) {
    for (const line of result.lines) {
      if (!line.label && !line.value) {
        html += '<div class="eq-spacer"></div>';
      } else if (line.bold) {
        html += `<div class="eq-title">${line.label}</div>`;
      } else if (line.dim) {
        html += `<div class="eq-formula">${line.label}</div>`;
      } else if (line.value !== undefined) {
        html += `<div class="eq-line"><span class="eq-var">${line.label}</span> <span class="eq-val">${line.value}</span></div>`;
      } else {
        html += `<div class="eq-line">${line.label}</div>`;
      }
    }
    html += '<div class="eq-divider"></div>';
  }

  tooltipEl.innerHTML = html;
  tooltipEl.classList.remove('hidden');

  // Position near cursor
  let left = clientX + 20;
  let top = clientY - 20;
  const tooltipW = 380;
  const tooltipH = tooltipEl.offsetHeight || 200;
  if (left + tooltipW > window.innerWidth) left = clientX - tooltipW - 10;
  if (top + tooltipH > window.innerHeight) top = window.innerHeight - tooltipH - 10;
  if (top < 10) top = 10;
  tooltipEl.style.left = left + 'px';
  tooltipEl.style.top = top + 'px';
}

export function hideEquationsTooltip() {
  if (tooltipEl) tooltipEl.classList.add('hidden');
}
