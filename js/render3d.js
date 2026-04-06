// WebGL 3D terrain renderer — two-pass: terrain + transparent water surface

import state from './state.js';
import { UI_H } from './constants.js';
import { elevColor, mat4Perspective, mat4LookAt, mat4Multiply } from './math.js';
import { getBeachiness } from './helpers.js';

// ── Terrain shaders ──
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

// ── Water surface shaders ──
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
  if (vDepth < 0.001) discard; // skip dry cells

  vec3 dx = dFdx(vec3(gl_FragCoord.xy, vHeight * 50.0));
  vec3 dy = dFdy(vec3(gl_FragCoord.xy, vHeight * 50.0));
  vec3 normal = normalize(cross(dx, dy));
  vec3 lightDir = normalize(vec3(0.4, 0.7, 0.3));
  float diffuse = max(dot(normal, lightDir), 0.0);

  // Specular highlight
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
    indexCount: indices.length,
  };

  // Camera controls
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
          GW, GH, seaLevel, SIM_HEIGHT_SCALE,
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

  // Build terrain + water vertex data
  for (let y = 0; y < GH; y++) {
    for (let x = 0; x < GW; x++) {
      const i = y * GW + x;
      const fx = x / GW - 0.5;
      const fz = y / GH - 0.5;
      const h = terrain[i];
      const w = waterSmooth ? waterSmooth[i] : water[i];

      // Terrain mesh at ground level
      tPos[i * 3]     = fx;
      tPos[i * 3 + 1] = h;
      tPos[i * 3 + 2] = fz;

      const c = elevColor(h);
      // Beach tint
      let cr = c[0] / 255, cg = c[1] / 255, cb = c[2] / 255;
      const beach = getBeachiness(i);
      if (beach > 0.1) {
        const b = beach * 0.7;
        cr = cr * (1 - b) + 0.86 * b;
        cg = cg * (1 - b) + 0.78 * b;
        cb = cb * (1 - b) + 0.59 * b;
      }
      tCol[i * 3]     = cr;
      tCol[i * 3 + 1] = cg;
      tCol[i * 3 + 2] = cb;

      // Water surface mesh at terrain + water level
      wPos[i * 3]     = fx;
      wPos[i * 3 + 1] = w > 0.001 ? h + w : -1; // dry cells hidden below terrain
      wPos[i * 3 + 2] = fz;
      wDepth[i] = w;
    }
  }

  // Camera
  const cx = Math.sin(orbitPhi) * Math.sin(orbitTheta) * orbitDist;
  const cy = Math.cos(orbitPhi) * orbitDist;
  const cz = Math.sin(orbitPhi) * Math.cos(orbitTheta) * orbitDist;
  const mvp = mat4Multiply(
    mat4Perspective(45, c3d.width / c3d.height, 0.01, 10),
    mat4LookAt(cx, cy, cz, 0, 0.3, 0, 0, 1, 0)
  );

  gl.viewport(0, 0, c3d.width, c3d.height);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

  // ── Pass 1: Terrain (opaque) ──
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
  gl.uniform1f(gl.getUniformLocation(glProgram, 'uHeightScale'), SIM_HEIGHT_SCALE);

  gl.drawElements(gl.TRIANGLES, glBuffers.indexCount, gl.UNSIGNED_INT, 0);

  // ── Pass 2: Water surface (transparent) ──
  gl.useProgram(glWaterProg);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.depthMask(false); // don't write to depth buffer (transparent)

  gl.bindBuffer(gl.ARRAY_BUFFER, glBuffers.waterPosBuf);
  gl.bufferData(gl.ARRAY_BUFFER, wPos, gl.DYNAMIC_DRAW);
  const waPosLoc = gl.getAttribLocation(glWaterProg, 'aPos');
  gl.enableVertexAttribArray(waPosLoc);
  gl.vertexAttribPointer(waPosLoc, 3, gl.FLOAT, false, 0, 0);

  gl.bindBuffer(gl.ARRAY_BUFFER, glBuffers.waterDepthBuf);
  gl.bufferData(gl.ARRAY_BUFFER, wDepth, gl.DYNAMIC_DRAW);
  const waDepthLoc = gl.getAttribLocation(glWaterProg, 'aDepth');
  gl.enableVertexAttribArray(waDepthLoc);
  gl.vertexAttribPointer(waDepthLoc, 1, gl.FLOAT, false, 0, 0);

  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, glBuffers.indexBuf);
  gl.uniformMatrix4fv(gl.getUniformLocation(glWaterProg, 'uMVP'), false, mvp);
  gl.uniform1f(gl.getUniformLocation(glWaterProg, 'uHeightScale'), SIM_HEIGHT_SCALE);

  gl.drawElements(gl.TRIANGLES, glBuffers.indexCount, gl.UNSIGNED_INT, 0);

  gl.depthMask(true);
  gl.disable(gl.BLEND);
}
