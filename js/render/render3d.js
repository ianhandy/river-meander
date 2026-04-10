// WebGL 3D terrain renderer — two-pass: terrain + transparent water surface

import state from '../data/state.js';
import { UI_H } from '../data/constants.js';
import { elevColor, mat4Perspective, mat4LookAt, mat4Multiply } from '../util/math.js';
import { getBeachiness } from '../util/helpers.js';

const TERRAIN_VERT = `
attribute vec3 aPos;
attribute vec3 aColor;
uniform mat4 uMVP;
uniform float uHeightScale;
varying vec3 vColor;
varying float vHeight;
void main() {
  vec3 pos = aPos;
  pos.y *= uHeightScale;
  vColor = aColor;
  vHeight = aPos.y;
  gl_Position = uMVP * vec4(pos, 1.0);
}`;

const TERRAIN_FRAG = `
precision mediump float;
varying vec3 vColor;
varying float vHeight;
void main() {
  vec3 dx = dFdx(vec3(gl_FragCoord.xy, vHeight * 50.0));
  vec3 dy = dFdy(vec3(gl_FragCoord.xy, vHeight * 50.0));
  vec3 normal = normalize(cross(dx, dy));
  vec3 lightDir = normalize(vec3(0.4, 0.7, 0.3));
  float diffuse = max(dot(normal, lightDir), 0.0);
  float lighting = 0.35 + 0.65 * diffuse;
  gl_FragColor = vec4(vColor * lighting, 1.0);
}`;

const WATER_VERT = `
attribute vec3 aPos;
attribute float aDepth;
uniform mat4 uMVP;
uniform float uHeightScale;
varying float vDepth;
varying float vHeight;
void main() {
  vec3 pos = aPos;
  pos.y *= uHeightScale;
  vDepth = aDepth;
  vHeight = aPos.y;
  gl_Position = uMVP * vec4(pos, 1.0);
}`;

const WATER_FRAG = `
precision mediump float;
varying float vDepth;
varying float vHeight;
void main() {
  if (vDepth < 0.005) discard; // skip dry cells and thin interpolated edges
  vec3 dx = dFdx(vec3(gl_FragCoord.xy, vHeight * 50.0));
  vec3 dy = dFdy(vec3(gl_FragCoord.xy, vHeight * 50.0));
  vec3 normal = normalize(cross(dx, dy));
  vec3 lightDir = normalize(vec3(0.4, 0.7, 0.3));
  float diffuse = max(dot(normal, lightDir), 0.0);
  vec3 viewDir = vec3(0.0, 1.0, 0.0);
  vec3 halfDir = normalize(lightDir + viewDir);
  float spec = pow(max(dot(normal, halfDir), 0.0), 32.0);
  float d = min(vDepth / 0.04, 1.0);
  vec3 shallow = vec3(0.15, 0.45, 0.75);
  vec3 deep = vec3(0.03, 0.12, 0.35);
  vec3 waterCol = mix(shallow, deep, d);
  waterCol += vec3(1.0, 1.0, 1.0) * spec * 0.3;
  float lighting = 0.5 + 0.5 * diffuse;
  waterCol *= lighting;
  float alpha = 0.4 + d * 0.5;
  gl_FragColor = vec4(waterCol, alpha);
}`;

function compileShader(gl, src, type) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(s));
  return s;
}

function linkProgram(gl, vSrc, fSrc) {
  const vs = compileShader(gl, vSrc, gl.VERTEX_SHADER);
  const fs = compileShader(gl, '#extension GL_OES_standard_derivatives : enable\n' + fSrc, gl.FRAGMENT_SHADER);
  const p = gl.createProgram();
  gl.attachShader(p, vs); gl.attachShader(p, fs);
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) console.error(gl.getProgramInfoLog(p));
  return p;
}

export function init3D(c3d) {
  if (state.glInited) return;
  const maxSize = Math.min(window.innerWidth, window.innerHeight - UI_H);
  c3d.width = Math.min(maxSize, 800);
  c3d.height = Math.min(maxSize, 800);
  c3d.style.width = maxSize + 'px';
  c3d.style.height = maxSize + 'px';
  const gl = c3d.getContext('webgl', { antialias: true, alpha: false });
  if (!gl) { alert('WebGL not supported'); return; }
  gl.getExtension('OES_standard_derivatives');
  gl.getExtension('OES_element_index_uint');
  const terrainProg = linkProgram(gl, TERRAIN_VERT, TERRAIN_FRAG);
  const waterProg = linkProgram(gl, WATER_VERT, WATER_FRAG);
  const { GW, GH } = state;
  const indices = [];
  for (let y = 0; y < GH - 1; y++) {
    for (let x = 0; x < GW - 1; x++) {
      const i = y * GW + x;
      indices.push(i, i + 1, i + GW);
      indices.push(i + 1, i + GW + 1, i + GW);
    }
  }
  const indexBuf = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuf);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(indices), gl.STATIC_DRAW);
  state.gl = gl;
  state.glProgram = terrainProg;
  state.glWaterProg = waterProg;
  state.glBuffers = {
    indexBuf,
    terrainPosBuf: gl.createBuffer(),
    terrainColBuf: gl.createBuffer(),
    waterPosBuf: gl.createBuffer(),
    waterDepthBuf: gl.createBuffer(),
    waterIndexBuf: gl.createBuffer(),  // separate index buffer for water
    indexCount: indices.length,
    waterIndexCount: 0,
  };
  c3d.addEventListener('mousedown', (e) => {
    state.orbitDragging = true;
    state.orbitLastX = e.clientX;
    state.orbitLastY = e.clientY;
    c3d.style.cursor = 'grabbing';
  });
  window.addEventListener('mousemove', (e) => {
    if (!state.orbitDragging) return;
    state.orbitTheta -= (e.clientX - state.orbitLastX) * 0.008;
    state.orbitPhi = Math.max(0.1, Math.min(Math.PI * 0.48, state.orbitPhi - (e.clientY - state.orbitLastY) * 0.008));
    state.orbitLastX = e.clientX;
    state.orbitLastY = e.clientY;
  });
  window.addEventListener('mouseup', () => {
    state.orbitDragging = false;
    c3d.style.cursor = 'grab';
  });
  c3d.addEventListener('wheel', (e) => {
    e.preventDefault();
    state.orbitDist *= e.deltaY > 0 ? 1.08 : 0.92;
    state.orbitDist = Math.max(0.5, Math.min(6, state.orbitDist));
  }, { passive: false });
  gl.enable(gl.DEPTH_TEST);
  gl.clearColor(0.05, 0.07, 0.09, 1);
  const vtxCount = GW * GH;
  state._pos3D = new Float32Array(vtxCount * 3);
  state._col3D = new Float32Array(vtxCount * 3);
  state._waterPos3D = new Float32Array(vtxCount * 3);
  state._waterDepth3D = new Float32Array(vtxCount);
  state.glInited = true;
}

export function render3D(c3d) {
  const { gl, glBuffers, glProgram, glWaterProg, terrain, water, waterSmooth,
          GW, GH, seaLevel, heightScale,
          orbitTheta, orbitPhi, orbitDist } = state;
  if (!gl || !glBuffers || !terrain) return;
  const N = GW * GH;
  if (!state._pos3D || state._pos3D.length !== N * 3) {
    state._pos3D = new Float32Array(N * 3);
    state._col3D = new Float32Array(N * 3);
    state._waterPos3D = new Float32Array(N * 3);
    state._waterDepth3D = new Float32Array(N);
  }
  const tPos = state._pos3D;
  const tCol = state._col3D;
  const wPos = state._waterPos3D;
  const wDepth = state._waterDepth3D;

  const w_arr = waterSmooth || water;
  const REF_DEPTH_3D = 0.04; // reference depth for full blue saturation

  // ── Build terrain + water-tinted vertex data ────────────────────────────
  // No separate water mesh. Terrain vertices are tinted blue based on
  // water depth: light blue for shallow, deep blue for deep. No spikes
  // possible because there's only one mesh at terrain height.
  for (let y = 0; y < GH; y++) {
    for (let x = 0; x < GW; x++) {
      const i = y * GW + x;
      const h = terrain[i];
      const w = w_arr[i];
      tPos[i * 3]     = x / GW - 0.5;
      tPos[i * 3 + 1] = h;
      tPos[i * 3 + 2] = y / GH - 0.5;

      // Base terrain color
      const c = elevColor(h);
      let cr = c[0] / 255, cg = c[1] / 255, cb = c[2] / 255;

      // Beach tint
      const beach = getBeachiness(i);
      if (beach > 0.1) {
        const b = beach * 0.7;
        cr = cr * (1 - b) + 0.86 * b;
        cg = cg * (1 - b) + 0.78 * b;
        cb = cb * (1 - b) + 0.59 * b;
      }

      // Water tint: blend terrain color toward blue based on depth
      if (w > (state.waterThresh || 0.0001)) {
        const depth = Math.min(1, w / REF_DEPTH_3D);
        // Shallow = light blue (0.15, 0.45, 0.75)
        // Deep = dark blue (0.03, 0.12, 0.35)
        const wr = 0.15 * (1 - depth) + 0.03 * depth;
        const wg = 0.45 * (1 - depth) + 0.12 * depth;
        const wb = 0.75 * (1 - depth) + 0.35 * depth;
        // Blend strength: ramps quickly then levels off
        const blend = Math.min(0.9, Math.pow(depth, 0.5) * 0.7 + 0.2);
        cr = cr * (1 - blend) + wr * blend;
        cg = cg * (1 - blend) + wg * blend;
        cb = cb * (1 - blend) + wb * blend;
      }

      tCol[i * 3]     = cr;
      tCol[i * 3 + 1] = cg;
      tCol[i * 3 + 2] = cb;
    }
  }

  const cx = Math.sin(orbitPhi) * Math.sin(orbitTheta) * orbitDist;
  const cy = Math.cos(orbitPhi) * orbitDist;
  const cz = Math.sin(orbitPhi) * Math.cos(orbitTheta) * orbitDist;
  const mvp = mat4Multiply(
    mat4Perspective(45, c3d.width / c3d.height, 0.01, 10),
    mat4LookAt(cx, cy, cz, 0, 0.3, 0, 0, 1, 0)
  );

  gl.viewport(0, 0, c3d.width, c3d.height);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

  // Pass 1: Terrain (opaque)
  gl.useProgram(glProgram);
  gl.disable(gl.BLEND);
  gl.bindBuffer(gl.ARRAY_BUFFER, glBuffers.terrainPosBuf);
  gl.bufferData(gl.ARRAY_BUFFER, tPos, gl.DYNAMIC_DRAW);
  const taPosLoc = gl.getAttribLocation(glProgram, 'aPos');
  gl.enableVertexAttribArray(taPosLoc);
  gl.vertexAttribPointer(taPosLoc, 3, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, glBuffers.terrainColBuf);
  gl.bufferData(gl.ARRAY_BUFFER, tCol, gl.DYNAMIC_DRAW);
  const taColLoc = gl.getAttribLocation(glProgram, 'aColor');
  gl.enableVertexAttribArray(taColLoc);
  gl.vertexAttribPointer(taColLoc, 3, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, glBuffers.indexBuf);
  gl.uniformMatrix4fv(gl.getUniformLocation(glProgram, 'uMVP'), false, mvp);
  gl.uniform1f(gl.getUniformLocation(glProgram, 'uHeightScale'), heightScale);
  gl.drawElements(gl.TRIANGLES, glBuffers.indexCount, gl.UNSIGNED_INT, 0);

  // No Pass 2 — water is rendered as a blue tint on the terrain mesh.
  // No separate water mesh = no spikes, no hanging curtains.
}
