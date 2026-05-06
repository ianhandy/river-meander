/**
 * oxbow.js — Oxbow lake detection.
 *
 * Tracks connected water cells frame-to-frame. When a group of 20+
 * cells lose active channel status (river migrated away), they are
 * recorded as an oxbow lake with position and age.
 */

import state from '../data/state.js';
import { MIN_WATER } from '../data/constants.js';

export function detectOxbows() {
  const { GW, GH, water, isOceanCell, year, oxbows } = state;
  const threshold = 0.005;
  const channelCells = new Set();
  for (let i = 0; i < GW * GH; i++) {
    if (water[i] > threshold && !isOceanCell[i]) channelCells.add(i);
  }

  if (state.prevChannelCells) {
    const lostSet = new Set();
    for (const cell of state.prevChannelCells) {
      if (!channelCells.has(cell) && water[cell] > MIN_WATER * 0.5) lostSet.add(cell);
    }
    if (lostSet.size > 15) {
      const visited = new Set();
      for (const cell of lostSet) {
        if (visited.has(cell)) continue;
        const queue = [cell];
        const component = [];
        visited.add(cell);
        while (queue.length > 0) {
          const c = queue.shift();
          component.push(c);
          const cx = c % GW, cy = (c / GW) | 0;
          for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
            const nx = cx + dx, ny = cy + dy;
            if (nx < 0 || nx >= GW || ny < 0 || ny >= GH) continue;
            const ni = ny * GW + nx;
            if (!visited.has(ni) && lostSet.has(ni)) {
              visited.add(ni);
              queue.push(ni);
            }
          }
        }
        if (component.length > 20) {
          oxbows.push({
            cells: component,
            age: year,
            cx: component.reduce((s, c) => s + (c % GW), 0) / component.length,
            cy: component.reduce((s, c) => s + ((c / GW) | 0), 0) / component.length,
          });
        }
      }
    }
  }
  state.prevChannelCells = channelCells;
}
