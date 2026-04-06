// WebGL 3D terrain renderer

import state from './state.js';
import { UI_H } from './constants.js';
import { elevColor, mat4Perspective, mat4LookAt, mat4Multiply } from './math.js';

const VERT_SRC = `
attribute vec3 aPos;
attribute vec3 aColor;
attribute float aWater;
uniform mat4 uMVP;
uniform float uHeightScale;
uniform float uSeaLevel;
varying vec3 vColor;
varying vec3 vNormal;
varying float vWater;
varying float vHeight;
void main() {
  vec3 pos = aPos;
  pos.y *= uHeightScale;
  vColor = aColor;
  vWater = aWater;
  vHeight = aPos.y;
  vNormal = vec3(0, 1, 0);
  gl_Position = uMVP * vec4(pos, 1.0);
}`;

const FRAG_SRC = `
precision mediump float;
varying vec3 vColor;
varying vec3 vNormal;
varying float vWater;
varying float vHeight;
void main() {
  vec3 dx = dFdx(vec3(gl_FragCoord.xy, vHeight * 50.0));
  vec3 dy = dFdy(vec3(gl_FragCoord.xy, vHeight * 50.0));
  vec3 normal = normalize(cross(dx, dy));
  vec3 lightDir = normalize(vec3(0.4, 0.7, 0.3));
  float diffuse = max(dot(normal, lightDir), 0.0);
  float lighting = 0.35 + 0.65 * diffuse;
  vec3 terrainCol = vColor * lighting;
  if (vWater > 0.002) {
    float depth = min(vWater / 0.04, 1.0);
    float alpha = 0.4 + depth * 0.5;
    vec3 waterCol = mix(vec3(0.08, 0.32, 0.75), vec3(0.05, 0.18, 0.55), depth);
    waterCol *= lighting;
    terrainCol = mix(terrainCol, waterCol, alpha);
  }
  gl_FragColor = vec4(terrainCol, 1.0);
}`;

export function init3D(c3d) {
  if (state.glInited) return;

  const maxSize = Math.min(window.innerWidth, window.innerHeight - UI_H);
  c3d.width = maxSize;
  c3d.height = maxSize;

  const gl = c3d.getContext('webgl', { antialias: true });
  if (!gl) { alert('WebGL not supported'); return; }

  gl.getExtension('OES_standard_derivatives');

  const vs = gl.createShader(gl.VERTEX_SHADER);
  gl.shaderSource(vs, VERT_SRC);
  gl.compileShader(vs);
  if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) console.error('Vertex shader:', gl.getShaderInfoLog(vs));

  const fs = gl.createShader(gl.FRAGMENT_SHADER);
  gl.shaderSource(fs, '#extension GL_OES_standard_derivatives : enable\n' + FRAG_SRC);
  gl.compileShader(fs);
  if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) console.error('Fragment shader:', gl.getShaderInfoLog(fs));

  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error('Shader link error:', gl.getProgramInfoLog(program));
    return;
  }

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
  gl.getExtension('OES_element_index_uint');

  const posBuf = gl.createBuffer();
  const colorBuf = gl.createBuffer();
  const waterBuf = gl.createBuffer();

  state.gl = gl;
  state.glProgram = program;
  state.glBuffers = { indexBuf, posBuf, colorBuf, waterBuf, indexCount: indices.length };

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

  // Pre-allocate vertex arrays (reused every frame)
  const vtxCount = GW * GH;
  state._pos3D = new Float32Array(vtxCount * 3);
  state._col3D = new Float32Array(vtxCount * 3);
  state._wat3D = new Float32Array(vtxCount);

  state.glInited = true;
}

export function render3D(c3d) {
  const { gl, glBuffers, glProgram, terrain, water, waterSmooth,
          GW, GH, seaLevel, SIM_HEIGHT_SCALE,
          orbitTheta, orbitPhi, orbitDist } = state;
  if (!gl || !glBuffers || !terrain) return;

  const N = GW * GH;
  // Re-allocate if grid size changed since init
  if (!state._pos3D || state._pos3D.length !== N * 3) {
    state._pos3D = new Float32Array(N * 3);
    state._col3D = new Float32Array(N * 3);
    state._wat3D = new Float32Array(N);
  }
  const positions = state._pos3D;
  const colors = state._col3D;
  const waters = state._wat3D;

  for (let y = 0; y < GH; y++) {
    for (let x = 0; x < GW; x++) {
      const i = y * GW + x;
      const fx = x / GW - 0.5;
      const fz = y / GH - 0.5;
      const h = terrain[i];

      positions[i * 3]     = fx;
      positions[i * 3 + 1] = h;
      positions[i * 3 + 2] = fz;

      const c = elevColor(h);
      colors[i * 3]     = c[0] / 255;
      colors[i * 3 + 1] = c[1] / 255;
      colors[i * 3 + 2] = c[2] / 255;

      waters[i] = waterSmooth ? waterSmooth[i] : water[i];
    }
  }

  gl.bindBuffer(gl.ARRAY_BUFFER, glBuffers.posBuf);
  gl.bufferData(gl.ARRAY_BUFFER, positions, gl.DYNAMIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, glBuffers.colorBuf);
  gl.bufferData(gl.ARRAY_BUFFER, colors, gl.DYNAMIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, glBuffers.waterBuf);
  gl.bufferData(gl.ARRAY_BUFFER, waters, gl.DYNAMIC_DRAW);

  gl.useProgram(glProgram);

  const aPos = gl.getAttribLocation(glProgram, 'aPos');
  gl.bindBuffer(gl.ARRAY_BUFFER, glBuffers.posBuf);
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 0, 0);

  const aColor = gl.getAttribLocation(glProgram, 'aColor');
  gl.bindBuffer(gl.ARRAY_BUFFER, glBuffers.colorBuf);
  gl.enableVertexAttribArray(aColor);
  gl.vertexAttribPointer(aColor, 3, gl.FLOAT, false, 0, 0);

  const aWater = gl.getAttribLocation(glProgram, 'aWater');
  gl.bindBuffer(gl.ARRAY_BUFFER, glBuffers.waterBuf);
  gl.enableVertexAttribArray(aWater);
  gl.vertexAttribPointer(aWater, 1, gl.FLOAT, false, 0, 0);

  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, glBuffers.indexBuf);

  const cx = Math.sin(orbitPhi) * Math.sin(orbitTheta) * orbitDist;
  const cy = Math.cos(orbitPhi) * orbitDist;
  const cz = Math.sin(orbitPhi) * Math.cos(orbitTheta) * orbitDist;

  const mvp = mat4Multiply(
    mat4Perspective(45, c3d.width / c3d.height, 0.01, 10),
    mat4LookAt(cx, cy, cz, 0, 0.3, 0, 0, 1, 0)
  );

  gl.uniformMatrix4fv(gl.getUniformLocation(glProgram, 'uMVP'), false, mvp);
  gl.uniform1f(gl.getUniformLocation(glProgram, 'uHeightScale'), SIM_HEIGHT_SCALE);
  gl.uniform1f(gl.getUniformLocation(glProgram, 'uSeaLevel'), seaLevel);

  gl.viewport(0, 0, c3d.width, c3d.height);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.drawElements(gl.TRIANGLES, glBuffers.indexCount, gl.UNSIGNED_INT, 0);
}
