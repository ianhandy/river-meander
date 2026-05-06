// Shared math utilities used by rendering, terrain, and simulation

import state from '../data/state.js';
import { ELEV_STOPS } from '../data/constants.js';

export function lerp(a, b, t) { return a + (b - a) * t; }

export function smoothstep(e0, e1, x) {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

export function catmullRom(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * ((2*p1) + (-p0+p2)*t + (2*p0-5*p1+4*p2-p3)*t2 + (-p0+3*p1-3*p2+p3)*t3);
}

// Bicubic (Catmull-Rom) grid sampling — smooth terrain rendering
export function sampleGrid(grid, gxf, gyf) {
  const { GW, GH } = state;
  const gx = Math.floor(gxf);
  const gy = Math.floor(gyf);
  const tx = gxf - gx;
  const ty = gyf - gy;
  const cols = new Float64Array(4);
  for (let j = -1; j <= 2; j++) {
    const cy = Math.max(0, Math.min(GH - 1, gy + j));
    const r0 = grid[cy * GW + Math.max(0, Math.min(GW-1, gx-1))];
    const r1 = grid[cy * GW + Math.max(0, Math.min(GW-1, gx))];
    const r2 = grid[cy * GW + Math.max(0, Math.min(GW-1, gx+1))];
    const r3 = grid[cy * GW + Math.max(0, Math.min(GW-1, gx+2))];
    cols[j + 1] = catmullRom(r0, r1, r2, r3, tx);
  }
  return catmullRom(cols[0], cols[1], cols[2], cols[3], ty);
}

// Bilinear grid sampling — fast, used for water
export function sampleGridFast(grid, gxf, gyf) {
  const { GW, GH } = state;
  const gx0 = Math.max(0, Math.min(GW - 2, gxf | 0));
  const gy0 = Math.max(0, Math.min(GH - 2, gyf | 0));
  const tx = gxf - gx0;
  const ty = gyf - gy0;
  const i00 = gy0 * GW + gx0;
  return grid[i00] * (1-tx) * (1-ty)
       + grid[i00 + 1] * tx * (1-ty)
       + grid[i00 + GW] * (1-tx) * ty
       + grid[i00 + GW + 1] * tx * ty;
}

// Pre-built 256-entry elevation color LUT — avoids per-pixel branching
const ELEV_LUT_SIZE = 256;
const ELEV_LUT_R = new Uint8Array(ELEV_LUT_SIZE);
const ELEV_LUT_G = new Uint8Array(ELEV_LUT_SIZE);
const ELEV_LUT_B = new Uint8Array(ELEV_LUT_SIZE);
(function buildElevLUT() {
  for (let i = 0; i < ELEV_LUT_SIZE; i++) {
    const e = i / (ELEV_LUT_SIZE - 1);
    let r, g, b;
    let found = false;
    for (let j = 1; j < ELEV_STOPS.length; j++) {
      if (e <= ELEV_STOPS[j][0]) {
        const s0 = ELEV_STOPS[j-1], s1 = ELEV_STOPS[j];
        const t = (e - s0[0]) / (s1[0] - s0[0]);
        r = lerp(s0[1], s1[1], t) | 0;
        g = lerp(s0[2], s1[2], t) | 0;
        b = lerp(s0[3], s1[3], t) | 0;
        found = true;
        break;
      }
    }
    if (!found) {
      const last = ELEV_STOPS[ELEV_STOPS.length - 1];
      r = last[1]; g = last[2]; b = last[3];
    }
    ELEV_LUT_R[i] = r;
    ELEV_LUT_G[i] = g;
    ELEV_LUT_B[i] = b;
  }
})();

// Elevation → color via LUT (O(1) instead of linear scan)
export function elevColor(e) {
  const idx = Math.max(0, Math.min(ELEV_LUT_SIZE - 1, (e * (ELEV_LUT_SIZE - 1)) | 0));
  return [ELEV_LUT_R[idx], ELEV_LUT_G[idx], ELEV_LUT_B[idx]];
}

// Minimal 4x4 matrix math for WebGL (no library)
export function mat4Perspective(fovDeg, aspect, near, far) {
  const f = 1 / Math.tan(fovDeg * Math.PI / 360);
  const nf = 1 / (near - far);
  return new Float32Array([
    f/aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far+near)*nf, -1,
    0, 0, 2*far*near*nf, 0
  ]);
}

export function mat4LookAt(ex,ey,ez, tx,ty,tz, ux,uy,uz) {
  let zx=ex-tx, zy=ey-ty, zz=ez-tz;
  let zl=Math.sqrt(zx*zx+zy*zy+zz*zz); zx/=zl; zy/=zl; zz/=zl;
  let xx=uy*zz-uz*zy, xy=uz*zx-ux*zz, xz=ux*zy-uy*zx;
  let xl=Math.sqrt(xx*xx+xy*xy+xz*xz); xx/=xl; xy/=xl; xz/=xl;
  let yx=zy*xz-zz*xy, yy=zz*xx-zx*xz, yz=zx*xy-zy*xx;
  return new Float32Array([
    xx, yx, zx, 0,
    xy, yy, zy, 0,
    xz, yz, zz, 0,
    -(xx*ex+xy*ey+xz*ez), -(yx*ex+yy*ey+yz*ez), -(zx*ex+zy*ey+zz*ez), 1
  ]);
}

export function mat4Multiply(a, b) {
  const o = new Float32Array(16);
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 4; j++)
      o[j*4+i] = a[i]*b[j*4]+a[i+4]*b[j*4+1]+a[i+8]*b[j*4+2]+a[i+12]*b[j*4+3];
  return o;
}
