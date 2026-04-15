/**
 * offscreen-rivers.js — Water sources entering from beyond the map edge.
 *
 * Each river injects water along a span of edge cells, biasing flux
 * perpendicular to the edge (inward) plus a lateral angle component.
 * Both the entry position and angle oscillate sinusoidally (sway),
 * simulating a river that meanders back and forth over time.
 *
 * DATA MODEL (per river, stored in state.offscreenRivers[]):
 *   edge       — 'left' | 'right' | 'top' | 'bottom'
 *   edgeT      — base entry position along edge, 0–1
 *   angle      — base flow angle from perpendicular, radians (-PI/3 to PI/3)
 *   rate       — water injected per cell per step
 *   width      — injection span as fraction of edge length
 *   swayAmp    — oscillation amplitude: scales both position and angle sway
 *   swayPeriod — steps per full oscillation cycle
 *   swayPhase  — accumulated phase (radians, modulo 2π)
 *   enabled    — boolean
 *   id         — unique integer
 */

import state from '../data/state.js';

let _nextId = 1;

export function createOffscreenRiver(edge, edgeT) {
  return {
    id: _nextId++,
    edge,
    edgeT: Math.max(0.05, Math.min(0.95, edgeT)),
    angle: 0,                 // flow direction offset from perpendicular
    rate: 0.008,              // water per edge-cell per step
    width: 0.08,              // injection span (fraction of edge length)
    swayAmp: 0.08,            // oscillation amplitude
    swayPeriod: 400,          // steps per full oscillation
    swayPhase: Math.random() * Math.PI * 2,
    enabled: true,
  };
}

// Angle preset cycle: 0 = straight in, ±PI/6 = 30°, ±PI/3 = 60°, null = disabled
const ANGLE_CYCLE = [0, Math.PI / 6, Math.PI / 3, -Math.PI / 6, -Math.PI / 3, 'disabled'];

export function cycleRiverAngle(river) {
  if (!river.enabled) {
    river.enabled = true;
    river.angle = 0;
    return;
  }
  const cur = ANGLE_CYCLE.findIndex(a => a !== 'disabled' && Math.abs(a - river.angle) < 0.01);
  const next = (cur + 1) % ANGLE_CYCLE.length;
  if (ANGLE_CYCLE[next] === 'disabled') {
    river.enabled = false;
  } else {
    river.angle = ANGLE_CYCLE[next];
  }
}

export function stepOffscreenRivers() {
  const { offscreenRivers, GW, GH, water, fluxL, fluxR, fluxU, fluxD, isOceanCell } = state;
  if (!offscreenRivers || !water) return;

  // Mark cells receiving off-screen river water so edge drainage skips them
  const N = GW * GH;
  if (!state.riverEdgeCell || state.riverEdgeCell.length !== N) {
    state.riverEdgeCell = new Uint8Array(N);
  }
  state.riverEdgeCell.fill(0);

  for (const rv of offscreenRivers) {
    if (!rv.enabled) continue;

    // Advance phase
    rv.swayPhase = (rv.swayPhase + (Math.PI * 2) / rv.swayPeriod) % (Math.PI * 2);

    // Oscillate position along edge and angle independently (different phase offset)
    const posOsc = rv.swayAmp * Math.sin(rv.swayPhase);
    const angOsc = rv.swayAmp * (Math.PI / 3) * Math.sin(rv.swayPhase + 1.1);
    const curT   = Math.max(0.01, Math.min(0.99, rv.edgeT + posOsc));
    const curAng = rv.angle + angOsc;

    const cosA = Math.cos(curAng);
    const sinA = Math.sin(curAng);

    // For each edge: pick the along-edge dimension and fixed coordinate,
    // then inject with perpendicular + lateral flux bias.
    let edgeLen, getIdx, perpPos, perpNeg, latPos, latNeg;

    if (rv.edge === 'left') {
      edgeLen = GH;
      getIdx  = a => a * GW;                          // x=0
      perpPos = fluxR; perpNeg = fluxL;                // positive angle = rightward
      latPos  = fluxD; latNeg  = fluxU;                // sin>0 = downward
    } else if (rv.edge === 'right') {
      edgeLen = GH;
      getIdx  = a => a * GW + (GW - 1);               // x=GW-1
      perpPos = fluxL; perpNeg = fluxR;
      latPos  = fluxD; latNeg  = fluxU;
    } else if (rv.edge === 'top') {
      edgeLen = GW;
      getIdx  = a => a;                                // y=0
      perpPos = fluxD; perpNeg = fluxU;
      latPos  = fluxR; latNeg  = fluxL;
    } else {                                           // bottom
      edgeLen = GW;
      getIdx  = a => (GH - 1) * GW + a;              // y=GH-1
      perpPos = fluxU; perpNeg = fluxD;
      latPos  = fluxR; latNeg  = fluxL;
    }

    const center = Math.round(curT * (edgeLen - 1));
    const halfW  = Math.max(1, Math.round(rv.width * edgeLen * 0.5));

    // Inject water at the edge AND 1-2 rows inside so water gets past
    // the edge drainage zone (which removes 30%/step at boundary cells).
    // The inner rows get less water (decaying with depth from edge).
    const INJECT_DEPTH = 3; // how many rows inside the edge to seed

    for (let d = -halfW; d <= halfW; d++) {
      const along = center + d;
      if (along < 0 || along >= edgeLen) continue;
      const falloff = 1 - Math.abs(d) / (halfW + 1);

      for (let row = 0; row < INJECT_DEPTH; row++) {
        let i;
        if (rv.edge === 'left')        i = along * GW + row;
        else if (rv.edge === 'right')  i = along * GW + (GW - 1 - row);
        else if (rv.edge === 'top')    i = row * GW + along;
        else /* bottom */              i = (GH - 1 - row) * GW + along;

        if (i < 0 || i >= N) continue;
        if (isOceanCell && isOceanCell[i]) continue;

        const rowDecay = 1 - row * 0.3; // inner rows get less: 1.0, 0.7, 0.4
        const inj = rv.rate * falloff * rowDecay;
        water[i] += inj;
        state.riverEdgeCell[i] = 1; // mark: skip edge drainage

        // Flux bias only on the edge row (inner rows get water but not forced direction)
        if (row === 0) {
          if (cosA > 0) perpPos[i] += inj * cosA;
          else          perpNeg[i] -= inj * cosA;
          if (sinA > 0) latPos[i] += inj * sinA;
          else          latNeg[i] -= inj * sinA;
        }
      }
    }
  }
}
