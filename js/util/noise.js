// Simplex noise 2D + derived noise functions

const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;
const grad2 = [[1,1],[-1,1],[1,-1],[-1,-1],[1,0],[-1,0],[0,1],[0,-1]];
const perm = new Uint8Array(512);

export function seedNoise(seed) {
  const p = new Uint8Array(256);
  let s = seed | 0;
  for (let i = 0; i < 256; i++) {
    s = (s * 1664525 + 1013904223) & 0xFFFFFFFF;
    p[i] = (s >>> 24) & 255;
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
}

export function simplex2D(x, y) {
  const s = (x + y) * F2;
  const i = Math.floor(x + s), j = Math.floor(y + s);
  const t = (i + j) * G2;
  const x0 = x - (i - t), y0 = y - (j - t);
  const i1 = x0 > y0 ? 1 : 0, j1 = x0 > y0 ? 0 : 1;
  const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2;
  const x2 = x0 - 1 + 2*G2, y2 = y0 - 1 + 2*G2;
  const ii = i & 255, jj = j & 255;
  const gi0 = perm[ii + perm[jj]] & 7;
  const gi1 = perm[ii + i1 + perm[jj + j1]] & 7;
  const gi2 = perm[ii + 1 + perm[jj + 1]] & 7;
  let n0=0, n1=0, n2=0;
  let t0 = 0.5 - x0*x0 - y0*y0;
  if (t0 > 0) { t0 *= t0; n0 = t0*t0 * (grad2[gi0][0]*x0 + grad2[gi0][1]*y0); }
  let t1 = 0.5 - x1*x1 - y1*y1;
  if (t1 > 0) { t1 *= t1; n1 = t1*t1 * (grad2[gi1][0]*x1 + grad2[gi1][1]*y1); }
  let t2 = 0.5 - x2*x2 - y2*y2;
  if (t2 > 0) { t2 *= t2; n2 = t2*t2 * (grad2[gi2][0]*x2 + grad2[gi2][1]*y2); }
  return 70 * (n0 + n1 + n2);
}

export function fbmSimplex(x, y, octaves, lacunarity, gain) {
  let sum = 0, amp = 1, freq = 1, max = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * simplex2D(x * freq, y * freq);
    max += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / max;
}

export function ridgedNoise(x, y, octaves, lacunarity, gain) {
  let sum = 0, amp = 1, freq = 1, max = 0, prev = 1;
  for (let i = 0; i < octaves; i++) {
    let n = 1 - Math.abs(simplex2D(x * freq, y * freq));
    n = n * n * prev;
    prev = n;
    sum += n * amp;
    max += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / max;
}

export function warpedRidged(x, y, octaves, lac, gain, warpAmt) {
  const wx = simplex2D(x + 5.2, y + 1.3) * warpAmt;
  const wy = simplex2D(x + 9.7, y + 6.1) * warpAmt;
  return ridgedNoise(x + wx, y + wy, octaves, lac, gain);
}
