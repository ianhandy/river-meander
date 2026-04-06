// Pipe-model hydraulic flow simulation

import state from './state.js';
import { MIN_WATER, LAYERS } from './constants.js';
import { getOceanLevel } from './ocean.js';

export function stepHydraulic() {
  const { terrain, water, fluxL, fluxR, fluxU, fluxD, flowSpeed,
          saturation, isOceanCell, origTerrain, sources,
          GW, GH, SIM_DT, SIM_GRAVITY, SIM_SPRING_RATE,
          SIM_EVAP, SIM_ABSORB, SIM_STAGNANT_EVAP, SIM_STAGNANT_ABSORB,
          SIM_MOVING_EVAP, SIM_MOVING_ABSORB, SIM_VISCOUS_DAMPING,
          flowRateUI, rainfallRate, seaLevel } = state;
  // Stability: clamp timestep to prevent explosion
  const dt = Math.max(0.05, Math.min(1.0, SIM_DT));
  const g = SIM_GRAVITY;
  const N = GW * GH;

  // Inject water at sources
  for (const src of sources) {
    const si = src.gy * GW + src.gx;
    if (si >= 0 && si < N) {
      water[si] += SIM_SPRING_RATE * flowRateUI;
    }
  }

  // Rainfall
  if (rainfallRate > 0) {
    for (let i = 0; i < N; i++) {
      if (!isOceanCell[i]) water[i] += rainfallRate;
    }
  }

  // Pass 1: update outflow fluxes (pipe model)
  // Pure water-surface differential — no terrain bias
  const damp = SIM_VISCOUS_DAMPING;
  for (let y = 0; y < GH; y++) {
    for (let x = 0; x < GW; x++) {
      const i = y * GW + x;
      fluxL[i] *= damp; fluxR[i] *= damp;
      fluxU[i] *= damp; fluxD[i] *= damp;
      const h = terrain[i] + water[i];

      if (x < GW - 1) {
        fluxR[i] = Math.max(0, fluxR[i] + dt * g * (h - terrain[i+1] - water[i+1]));
      } else {
        fluxR[i] = Math.max(0, fluxR[i] + dt * g * water[i]);
      }

      if (x > 0) {
        fluxL[i] = Math.max(0, fluxL[i] + dt * g * (h - terrain[i-1] - water[i-1]));
      } else {
        fluxL[i] = Math.max(0, fluxL[i] + dt * g * water[i]);
      }

      if (y < GH - 1) {
        fluxD[i] = Math.max(0, fluxD[i] + dt * g * (h - terrain[i+GW] - water[i+GW]));
      } else {
        fluxD[i] = Math.max(0, fluxD[i] + dt * g * water[i]);
      }

      if (y > 0) {
        fluxU[i] = Math.max(0, fluxU[i] + dt * g * (h - terrain[i-GW] - water[i-GW]));
      } else {
        fluxU[i] = Math.max(0, fluxU[i] + dt * g * water[i]);
      }

      const totalOut = (fluxL[i] + fluxR[i] + fluxU[i] + fluxD[i]) * dt;
      if (totalOut > water[i] + MIN_WATER) {
        const scale = (water[i] + MIN_WATER) / totalOut;
        fluxL[i] *= scale; fluxR[i] *= scale;
        fluxU[i] *= scale; fluxD[i] *= scale;
      }
    }
  }

  // Pass 2: update water depth
  let maxDepth = 0;
  const oLvl = getOceanLevel();
  for (let y = 0; y < GH; y++) {
    for (let x = 0; x < GW; x++) {
      const i = y * GW + x;
      const inR = x > 0      ? fluxR[i - 1]  : 0;
      const inL = x < GW - 1 ? fluxL[i + 1]  : 0;
      const inD = y > 0      ? fluxD[i - GW]  : 0;
      const inU = y < GH - 1 ? fluxU[i + GW]  : 0;
      const net = (inR + inL + inD + inU - fluxL[i] - fluxR[i] - fluxU[i] - fluxD[i]) * dt;
      water[i] = Math.max(0, water[i] + net);

      if (isOceanCell[i]) {
        const target = Math.max(0, oLvl - terrain[i]);
        if (water[i] > target) {
          water[i] -= (water[i] - target) * 0.4;
        } else {
          water[i] = target;
        }
      } else {
        const _vx = ((x > 0 ? fluxR[i-1] : 0) - fluxL[i] + fluxR[i] - (x < GW-1 ? fluxL[i+1] : 0)) * 0.5;
        const _vy = ((y > 0 ? fluxD[i-GW] : 0) - fluxU[i] + fluxD[i] - (y < GH-1 ? fluxU[i+GW] : 0)) * 0.5;
        const ax = Math.abs(_vx), ay = Math.abs(_vy);
        const spd = ax > ay ? ax + ay * 0.4 : ay + ax * 0.4;
        flowSpeed[i] = flowSpeed[i] * 0.8 + spd * 0.2;
        const stagnancy = Math.max(0, 1 - flowSpeed[i] * 10);

        if (water[i] > 0) {
          // Moving water uses SIM_MOVING_EVAP, stagnant uses SIM_STAGNANT_EVAP
          const evapRate = SIM_EVAP * (SIM_MOVING_EVAP + stagnancy * SIM_STAGNANT_EVAP);
          const thinBoost = water[i] < 0.005 ? 3.0 : 1.0;
          water[i] -= Math.min(water[i], evapRate * thinBoost);
        }

        if (water[i] > 0 && saturation[i] < 1.0) {
          const erosionDepth = Math.max(0, origTerrain[i] - terrain[i]);
          let worstPermeability = 1.0;
          for (let l = 0; l < LAYERS.length; l++) {
            if (LAYERS[l].depth <= erosionDepth) {
              const layerPerm = 1.0 / LAYERS[l].hardness;
              if (layerPerm < worstPermeability) worstPermeability = layerPerm;
            }
          }
          // Moving water uses SIM_MOVING_ABSORB, stagnant uses SIM_STAGNANT_ABSORB
          const absorbScale = SIM_MOVING_ABSORB + stagnancy * SIM_STAGNANT_ABSORB;
          const absorbAmt = SIM_ABSORB * worstPermeability * (1.0 - saturation[i]) * absorbScale;
          const absorbed = Math.min(water[i], absorbAmt);
          water[i] -= absorbed;
          saturation[i] = Math.min(1.0, saturation[i] + absorbed * 20);
        } else if (water[i] <= 0 && saturation[i] > 0) {
          saturation[i] = Math.max(0, saturation[i] - 0.001);
        }

        if (x === 0 || x === GW - 1 || y === 0 || y === GH - 1) {
          if (isOceanCell[i]) {
            const edgeTarget = Math.max(0, seaLevel - terrain[i]);
            if (water[i] > edgeTarget) {
              water[i] -= (water[i] - edgeTarget) * 0.6;
            }
          }
        }
      }

      if (water[i] > maxDepth) maxDepth = water[i];
    }
  }
  return maxDepth;
}
