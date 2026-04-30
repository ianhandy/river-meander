/**
 * equations.js — Equation registry for the simulation.
 *
 * Each equation is a self-describing object with:
 *   name     — human-readable title
 *   formula  — Unicode equation string
 *   variables — variable definitions with symbols and units
 *   compute(cellData) — evaluates the equation for a single cell,
 *                        returns structured results for the tooltip
 *
 * The equation panel reads state.hoveredCell, gathers cell data,
 * and calls each equation's compute() to render the live math display.
 *
 * These equations mirror EXACTLY what the simulation computes.
 * If the simulation code changes, these must change too.
 */

import { LAYERS } from './constants.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(v, digits = 4) {
  if (v === 0) return '0';
  const abs = Math.abs(v);
  if (abs < 0.0001) return v.toExponential(1);
  if (abs < 0.01) return v.toFixed(digits);
  if (abs < 1) return v.toFixed(3);
  if (abs < 100) return v.toFixed(2);
  return v.toFixed(1);
}

function layerName(hardness) {
  for (let l = LAYERS.length - 1; l >= 0; l--) {
    if (hardness >= LAYERS[l].hardness * 0.5) return LAYERS[l].name;
  }
  return LAYERS[0].name;
}

// ── Equation definitions ──────────────────────────────────────────────────────

export const EQUATIONS = {

  // ─── Stream Power Erosion ───────────────────────────────────────────────────
  // Reference: Whipple & Tucker (1999), Howard (1994), Pelletier (2008)
  //
  // Modified stream power: uses velocity (v) and flow accumulation (A)
  // instead of depth (d) for channelization feedback. Converging flow
  // concentrates velocity and flux, creating a positive feedback loop
  // that carves dendritic channel networks from uniform rainfall.
  //
  // Erosion is split: 40% local, 60% downstream — extends channels
  // forward instead of just deepening pits.

  streamPower: {
    name: 'Stream Power Erosion',
    formula: 'E = K \u00B7 \u03C4\u1D50 \u00B7 (1/H) \u00B7 max(0, C\u2091\u2091 \u2212 S)',
    variables: {
      '\u03C4': { name: 'Shear stress', unit: 'Pa', formula: '\u03C1\u00B7g\u00B7v\u00B7s\u00B7A' },
      'A': { name: 'Flow accumulation', unit: '', formula: '1 + \u03A3inFlux \u00B7 10' },
      'C\u2091\u2091': { name: 'Carrying capacity', unit: '', formula: 'K_c \u00B7 v \u00B7 \u221Ad' },
      'H': { name: 'Hardness', unit: '', formula: 'from layer stack' },
      'S': { name: 'Sediment load', unit: '', formula: 'suspended sediment' },
      'K': { name: 'Erosion coefficient', unit: '' },
      'm': { name: 'Stress exponent', unit: '' },
    },

    /**
     * Compute stream power erosion for a single cell.
     * @param {Object} cell — { water, speed, slope, hardness, sediment, K, m, Kc, Kd, gravity, erodibility, curvature, asymmetry }
     * @returns {Object} — computed values for display
     */
    compute(cell) {
      const { water, speed, slope, hardness, sediment, K, m, Kc, Kd, gravity, erodibility, curvature, asymmetry } = cell;
      const rho = 1000; // water density kg/m^3

      // Speed bonus: 1 + v^2 * 5 (quadratic — fast water erodes more)
      const tau = 1.0 + speed * speed * 5;

      // Carrying capacity: C_eq = Kc * v * sqrt(d)
      const C_eq = Kc * speed * Math.sqrt(water);

      // Erosion rate: E = K * tau^m * (1/H) * max(0, C_eq - S)
      const deficit = Math.max(0, C_eq - sediment);
      const tauPow = Math.pow(tau, m);
      const E = K * erodibility * tauPow * (1 / hardness) * deficit;

      // Lateral split from curvature
      const curvMag = Math.abs(curvature);
      const lateralFrac = curvMag * asymmetry;
      const verticalShare = E * (1 - Math.min(0.8, lateralFrac * 0.3));
      const lateralShare = E * Math.min(0.8, lateralFrac * 0.3);

      // Deposition (when oversaturated)
      const deposit = sediment > C_eq ? Kd * (sediment - C_eq) : 0;

      // Material name
      const material = layerName(hardness);

      return {
        active: water > 0.0001 && speed > 0.001,
        lines: [
          { label: 'Stream Power Erosion', bold: true },
          { label: 'E = K \u00B7 \u03C4\u1D50 \u00B7 (1/H) \u00B7 (C\u2091\u2091 \u2212 S)', dim: true },
          { label: '' },
          { label: `Spd\u00B2`, value: `1 + v\u00B2\u00D75 = 1 + ${fmt(speed)}\u00B2\u00D75 = ${fmt(tau)}` },
          { label: `C\u2091\u2091`, value: `Kc\u00B7v\u00B7\u221Ad = ${fmt(Kc)}\u00D7${fmt(speed)}\u00D7${fmt(Math.sqrt(water))} = ${fmt(C_eq)}` },
          { label: 'H', value: `${fmt(hardness)} (${material})` },
          { label: 'S', value: fmt(sediment) },
          { label: '' },
          { label: 'E', value: `${fmt(K)}\u00D7${fmt(tauPow)}\u00D7(1/${fmt(hardness)})\u00D7${fmt(deficit)} = ${fmt(E)} m/step` },
          { label: '' },
          { label: '\u25B8 vertical', value: fmt(verticalShare) },
          { label: '\u25B8 lateral', value: `${fmt(lateralShare)}  curvature=${fmt(curvature)}` },
          ...(deposit > 0 ? [{ label: '\u25B8 depositing', value: fmt(deposit) }] : []),
        ],
      };
    },
  },

  // ─── Diffusion ──────────────────────────────────────────────────────────────
  // Reference: Culling (1960), hillslope diffusion equation
  //
  // Material moves downhill at a rate proportional to the slope (Laplacian).
  // Different materials diffuse at different rates: sand flows fast (beach
  // leveling), rock barely moves (deep weathering). This single equation
  // replaces thermal smoothing, slope collapse, and beach equalization.

  diffusion: {
    name: 'Terrain Diffusion',
    formula: '\u2202h/\u2202t = \u03BA \u00B7 \u2207\u00B2h',
    variables: {
      '\u03BA': { name: 'Diffusion coefficient', unit: '1/step', formula: 'from material type' },
      '\u2207\u00B2h': { name: 'Laplacian', unit: '', formula: 'sum of neighbor height differences' },
    },

    compute(cell) {
      const { kappa, laplacian, beachiness } = cell;
      const dh = kappa * laplacian;
      const material = beachiness > 0.3 ? 'beach sand' : kappa > 0.005 ? 'soil' : 'rock';

      return {
        active: Math.abs(laplacian) > 0.00001,
        lines: [
          { label: 'Terrain Diffusion', bold: true },
          { label: '\u2202h/\u2202t = \u03BA \u00B7 \u2207\u00B2h', dim: true },
          { label: '' },
          { label: '\u03BA', value: `${fmt(kappa)} (${material})` },
          { label: '\u2207\u00B2h', value: fmt(laplacian) },
          { label: '' },
          { label: '\u0394h', value: `${fmt(dh)} m/step` },
        ],
      };
    },
  },

  // ─── Water Balance ──────────────────────────────────────────────────────────
  // Reference: Mei\u00DFner et al. (2007), pipe model shallow water equations
  //
  // Water flows through a 4-directional pipe model. Each cell has outgoing
  // flux in L/R/U/D directions driven by water surface height differences.
  // The balance of inflow vs outflow determines whether water accumulates
  // (positive balance = pool forming) or drains.

  waterBalance: {
    name: 'Water Balance',
    formula: '\u2202w/\u2202t = \u03A3in \u2212 \u03A3out',
    variables: {
      '\u03A3in': { name: 'Total inflow', unit: 'm\u00B3/s', formula: 'sum of neighbor outward fluxes toward this cell' },
      '\u03A3out': { name: 'Total outflow', unit: 'm\u00B3/s', formula: 'sum of this cell outward fluxes' },
    },

    compute(cell) {
      const { water, speed, fluxL, fluxR, fluxU, fluxD, totalIn, totalOut, stagnancy, evapFrac } = cell;
      const net = totalIn - totalOut;
      const status = net > 0.001 ? 'accumulating' : net < -0.001 ? 'draining' : 'steady';

      return {
        active: water > 0.0001,
        lines: [
          { label: 'Water Balance', bold: true },
          { label: '\u2202w/\u2202t = \u03A3in \u2212 \u03A3out', dim: true },
          { label: '' },
          { label: 'Flux', value: `L=${fmt(fluxL)} R=${fmt(fluxR)} U=${fmt(fluxU)} D=${fmt(fluxD)}` },
          { label: '\u03A3in', value: fmt(totalIn) },
          { label: '\u03A3out', value: fmt(totalOut) },
          { label: '' },
          { label: 'v', value: `${fmt(speed)} m/s` },
          { label: 'd', value: `${fmt(water)} m` },
          { label: '\u2202w/\u2202t', value: `${fmt(net)} (${status})` },
          { label: '' },
          { label: 'stagnancy', value: `${fmt(stagnancy)} (${(stagnancy * 100).toFixed(0)}%)` },
          { label: 'evap rate', value: `${fmt(evapFrac)}/step` },
        ],
      };
    },
  },
};
