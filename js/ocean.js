// Ocean connectivity, drain distance, hydraulic head

import state from './state.js';

// BFS flood fill: below-sea-level cells connected to map edge = ocean
export function computeOceanCells() {
  const { GW, GH, terrain, seaLevel } = state;
  const N = GW * GH;
  const isOceanCell = new Uint8Array(N);
  const queue = [];

  for (let y = 0; y < GH; y++) {
    for (let x = 0; x < GW; x++) {
      const i = y * GW + x;
      if ((x === 0 || x === GW-1 || y === 0 || y === GH-1) && terrain[i] < seaLevel) {
        isOceanCell[i] = 1;
        queue.push(i);
      }
    }
  }

  let head = 0;
  while (head < queue.length) {
    const i = queue[head++];
    const x = i % GW, y = (i / GW) | 0;
    for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || nx >= GW || ny < 0 || ny >= GH) continue;
      const ni = ny * GW + nx;
      if (!isOceanCell[ni] && terrain[ni] < seaLevel) {
        isOceanCell[ni] = 1;
        queue.push(ni);
      }
    }
  }

  state.isOceanCell = isOceanCell;
}

// BFS from ocean cells outward — distance to nearest drain
export function computeDrainDistance() {
  const { GW, GH, isOceanCell } = state;
  const N = GW * GH;
  const drainDist = new Float32Array(N);
  drainDist.fill(Infinity);
  const queue = [];

  for (let y = 0; y < GH; y++) {
    for (let x = 0; x < GW; x++) {
      const i = y * GW + x;
      if (isOceanCell[i]) {
        drainDist[i] = 0;
        queue.push(i);
      }
    }
  }

  let head = 0;
  while (head < queue.length) {
    const i = queue[head++];
    const d = drainDist[i] + 1;
    const x = i % GW, y = (i / GW) | 0;
    for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || nx >= GW || ny < 0 || ny >= GH) continue;
      const ni = ny * GW + nx;
      if (d < drainDist[ni]) {
        drainDist[ni] = d;
        queue.push(ni);
      }
    }
  }

  state.drainDist = drainDist;
}

// Propagate hydraulic head from ocean upstream via connected water
export function computeHydraulicHead() {
  const { GW, GH, terrain, water, isOceanCell, hydraulicHead,
          trappedPressure, seaLevel, SIM_GRAVITY } = state;
  const N = GW * GH;
  const WATER_CONNECT_THRESH = 0.0005;
  const SLOPE_PER_CELL = 0.0003;
  hydraulicHead.fill(Infinity);

  // Use typed array queue to avoid JS array length limits on large grids
  const queue = new Int32Array(N);
  let qHead = 0, qTail = 0;

  for (let y = 0; y < GH; y++) {
    for (let x = 0; x < GW; x++) {
      const i = y * GW + x;
      const isEdge = x === 0 || x === GW-1 || y === 0 || y === GH-1;
      if (isOceanCell[i] || (isEdge && water[i] > WATER_CONNECT_THRESH)) {
        hydraulicHead[i] = isOceanCell[i] ? seaLevel : terrain[i];
        if (qTail < N) queue[qTail++] = i;
      }
    }
  }

  while (qHead < qTail) {
    const i = queue[qHead++];
    const myHead = hydraulicHead[i];
    const x = i % GW, y = (i / GW) | 0;
    for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || nx >= GW || ny < 0 || ny >= GH) continue;
      const ni = ny * GW + nx;
      if (water[ni] < WATER_CONNECT_THRESH) continue;
      const proposedHead = Math.max(terrain[ni], myHead + SLOPE_PER_CELL);
      if (proposedHead < hydraulicHead[ni]) {
        hydraulicHead[ni] = proposedHead;
        if (qTail < N) queue[qTail++] = i;
      }
    }
  }

  for (let i = 0; i < N; i++) {
    if (hydraulicHead[i] === Infinity) {
      hydraulicHead[i] = terrain[i] + water[i];
      trappedPressure[i] = water[i] * SIM_GRAVITY;
    } else {
      trappedPressure[i] = 0;
    }
  }
}

export function getOceanLevel() {
  return state.seaLevel;
}
