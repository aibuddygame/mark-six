import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import {
  BufferGeometry as SceneBufferGeometry,
  DataTexture,
  MeshGeometry,
  Vector3,
} from "@threert/scene";

export interface MergeGeometryPart {
  geo: SceneBufferGeometry;
  pos?: readonly [number, number, number];
  rot?: readonly [number, number, number];
  scale?: readonly [number, number, number];
  lookAt?: readonly [number, number, number];
  preRotateX?: number;
}

/**
 * Merges multiple @threert/scene geometries with static transforms into one single MeshGeometry
 * to eliminate redundant draw calls. When `packSubUvs` is true, each sub-piece receives a disjoint
 * sub-rectangle in [0..1]^2 so offline GI lightmap baking assigns non-overlapping texels.
 */
export function mergeSceneGeometries(
  parts: readonly MergeGeometryPart[],
  packSubUvs = false,
): MeshGeometry {
  let totalVerts = 0;
  let totalIdx = 0;
  for (const p of parts) {
    totalVerts += p.geo.positions.length / 3;
    totalIdx += p.geo.triangleIndices().length;
  }

  const outPos = new Float32Array(totalVerts * 3);
  const outNorm = new Float32Array(totalVerts * 3);
  const outUv = new Float32Array(totalVerts * 2);
  const outIdx = new Uint32Array(totalIdx);

  const count = Math.max(1, parts.length);
  const cols = packSubUvs ? Math.ceil(Math.sqrt(count)) : 1;
  const rows = packSubUvs ? Math.ceil(count / cols) : 1;

  const mat4 = new THREE.Matrix4();
  const posV = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const euler = new THREE.Euler();
  const scaleV = new THREE.Vector3();
  const lookMat = new THREE.Matrix4();
  const preQuat = new THREE.Quaternion();
  const normMat = new THREE.Matrix3();
  const tmpV = new THREE.Vector3();
  const tmpN = new THREE.Vector3();

  let vOffset = 0;
  let iOffset = 0;

  for (let pi = 0; pi < parts.length; pi++) {
    const part = parts[pi];
    const g = part.geo;
    const pArr = g.positions;
    const nArr = g.normals;
    const uArr = g.uvs;
    const idxArr = g.triangleIndices();
    const vc = pArr.length / 3;

    posV.set(part.pos?.[0] ?? 0, part.pos?.[1] ?? 0, part.pos?.[2] ?? 0);
    if (part.lookAt) {
      lookMat.lookAt(
        new THREE.Vector3(part.lookAt[0], part.lookAt[1], part.lookAt[2]),
        posV,
        new THREE.Vector3(0, 1, 0),
      );
      quat.setFromRotationMatrix(lookMat);
      if (part.preRotateX) {
        preQuat.setFromAxisAngle(new THREE.Vector3(1, 0, 0), part.preRotateX);
        quat.multiply(preQuat);
      }
    } else {
      euler.set(part.rot?.[0] ?? 0, part.rot?.[1] ?? 0, part.rot?.[2] ?? 0);
      quat.setFromEuler(euler);
    }
    scaleV.set(part.scale?.[0] ?? 1, part.scale?.[1] ?? 1, part.scale?.[2] ?? 1);
    mat4.compose(posV, quat, scaleV);
    normMat.getNormalMatrix(mat4);

    const tileCol = pi % cols;
    const tileRow = Math.floor(pi / cols);
    const padU = packSubUvs ? 0.04 / cols : 0;
    const padV = packSubUvs ? 0.04 / rows : 0;
    const u0 = packSubUvs ? tileCol / cols + padU : 0;
    const uSpan = packSubUvs ? 1 / cols - padU * 2 : 1;
    const v0 = packSubUvs ? tileRow / rows + padV : 0;
    const vSpan = packSubUvs ? 1 / rows - padV * 2 : 1;

    for (let v = 0; v < vc; v++) {
      tmpV.set(pArr[v * 3], pArr[v * 3 + 1], pArr[v * 3 + 2]).applyMatrix4(mat4);
      tmpN
        .set(nArr[v * 3], nArr[v * 3 + 1], nArr[v * 3 + 2])
        .applyMatrix3(normMat)
        .normalize();

      const dv = vOffset + v;
      outPos[dv * 3] = tmpV.x;
      outPos[dv * 3 + 1] = tmpV.y;
      outPos[dv * 3 + 2] = tmpV.z;
      outNorm[dv * 3] = tmpN.x;
      outNorm[dv * 3 + 1] = tmpN.y;
      outNorm[dv * 3 + 2] = tmpN.z;

      const u = Math.max(0, Math.min(1, uArr[v * 2] ?? 0));
      const uvV = Math.max(0, Math.min(1, uArr[v * 2 + 1] ?? 0));
      outUv[dv * 2] = u0 + u * uSpan;
      outUv[dv * 2 + 1] = v0 + uvV * vSpan;
    }

    for (let k = 0; k < idxArr.length; k++) {
      outIdx[iOffset + k] = vOffset + idxArr[k];
    }

    vOffset += vc;
    iOffset += idxArr.length;
  }

  return new MeshGeometry(outPos, outIdx, outNorm, outUv);
}

/**
 * Converts any Three.js BufferGeometry (such as RoundedBoxGeometry or beveled ExtrudeGeometry)
 * into a @threert/scene MeshGeometry with normalized non-overlapping [0..1] UVs suitable for PBR & GI baking.
 */
export function threeBufferGeometryToMeshGeometry(
  src: THREE.BufferGeometry,
  splitFrontBackSides = false,
): MeshGeometry {
  const geo = src.index ? src.toNonIndexed() : src;
  geo.computeVertexNormals();

  const posAttr = geo.getAttribute("position") as THREE.BufferAttribute;
  const normAttr = geo.getAttribute("normal") as THREE.BufferAttribute;
  const vertCount = posAttr.count;

  const positions = new Float32Array(posAttr.array as ArrayLike<number>);
  const normals = new Float32Array(normAttr.array as ArrayLike<number>);
  const indices = new Uint32Array(vertCount);
  for (let i = 0; i < vertCount; i++) {
    indices[i] = i;
  }

  geo.computeBoundingBox();
  const bb = geo.boundingBox!;
  const dx = Math.max(1e-5, bb.max.x - bb.min.x);
  const dy = Math.max(1e-5, bb.max.y - bb.min.y);
  const dz = Math.max(1e-5, bb.max.z - bb.min.z);

  const uvs = new Float32Array(vertCount * 2);
  if (splitFrontBackSides) {
    // Disjoint UV regions for extruded shapes: front(+Z), back(-Z), and bevel/side walls
    for (let t = 0; t < vertCount; t += 3) {
      const nzAvg = (normals[t * 3 + 2] + normals[(t + 1) * 3 + 2] + normals[(t + 2) * 3 + 2]) / 3;
      for (let k = 0; k < 3; k++) {
        const vi = t + k;
        const x = (positions[vi * 3] - bb.min.x) / dx;
        const y = (positions[vi * 3 + 1] - bb.min.y) / dy;
        const z = (positions[vi * 3 + 2] - bb.min.z) / dz;
        if (nzAvg > 0.55) {
          uvs[vi * 2] = 0.02 + x * 0.45;
          uvs[vi * 2 + 1] = 0.52 + y * 0.45;
        } else if (nzAvg < -0.55) {
          uvs[vi * 2] = 0.52 + x * 0.45;
          uvs[vi * 2 + 1] = 0.52 + y * 0.45;
        } else {
          uvs[vi * 2] = 0.02 + ((x + y) * 0.5) * 0.96;
          uvs[vi * 2 + 1] = 0.02 + z * 0.44;
        }
      }
    }
  } else {
    const uvAttr = geo.getAttribute("uv") as THREE.BufferAttribute | undefined;
    if (uvAttr) {
      let minU = Infinity;
      let maxU = -Infinity;
      let minV = Infinity;
      let maxV = -Infinity;
      for (let i = 0; i < vertCount; i++) {
        const u = uvAttr.getX(i);
        const v = uvAttr.getY(i);
        if (u < minU) minU = u;
        if (u > maxU) maxU = u;
        if (v < minV) minV = v;
        if (v > maxV) maxV = v;
      }
      const spanU = Math.max(1e-5, maxU - minU);
      const spanV = Math.max(1e-5, maxV - minV);
      for (let i = 0; i < vertCount; i++) {
        uvs[i * 2] = (uvAttr.getX(i) - minU) / spanU;
        uvs[i * 2 + 1] = (uvAttr.getY(i) - minV) / spanV;
      }
    }
  }

  if (geo !== src) geo.dispose();
  return new MeshGeometry(positions, indices, normals, uvs);
}

/**
 * Creates a smooth filleted box geometry via Three.js RoundedBoxGeometry.
 */
export function createRoundedBoxMeshGeometry(
  width: number,
  height: number,
  depth: number,
  segments = 3,
  radius = 0.02,
): MeshGeometry {
  const rb = new RoundedBoxGeometry(width, height, depth, segments, radius);
  const posAttr = rb.getAttribute("position") as THREE.BufferAttribute;
  const normAttr = rb.getAttribute("normal") as THREE.BufferAttribute;
  const uvAttr = rb.getAttribute("uv") as THREE.BufferAttribute;
  const idxAttr = rb.getIndex();

  const positions = new Float32Array(posAttr.array as ArrayLike<number>);
  const normals = new Float32Array(normAttr.array as ArrayLike<number>);
  const uvs = new Float32Array(uvAttr.array as ArrayLike<number>);
  const indices = idxAttr
    ? new Uint32Array(idxAttr.array as ArrayLike<number>)
    : Uint32Array.from({ length: posAttr.count }, (_, i) => i);

  // Give RoundedBox non-overlapping box-like 6-sector UVs by dominant normal direction
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i];
    const b = indices[i + 1];
    const c = indices[i + 2];
    const nx = (normals[a * 3] + normals[b * 3] + normals[c * 3]) / 3;
    const ny = (normals[a * 3 + 1] + normals[b * 3 + 1] + normals[c * 3 + 1]) / 3;
    const nz = (normals[a * 3 + 2] + normals[b * 3 + 2] + normals[c * 3 + 2]) / 3;
    const ax = Math.abs(nx);
    const ay = Math.abs(ny);
    const az = Math.abs(nz);
    let sector = 0;
    if (ax >= ay && ax >= az) sector = nx >= 0 ? 0 : 1;
    else if (ay >= ax && ay >= az) sector = ny >= 0 ? 2 : 3;
    else sector = nz >= 0 ? 4 : 5;

    const col = sector % 3;
    const row = Math.floor(sector / 3);
    for (const vi of [a, b, c]) {
      const u = Math.max(0, Math.min(1, uvs[vi * 2]));
      const v = Math.max(0, Math.min(1, uvs[vi * 2 + 1]));
      uvs[vi * 2] = (col + 0.04 + u * 0.92) / 3;
      uvs[vi * 2 + 1] = (row + 0.04 + v * 0.92) / 2;
    }
  }

  rb.dispose();
  return new MeshGeometry(positions, indices, normals, uvs);
}

/**
 * Converts an HTMLCanvasElement's RGBA pixels into a @threert/scene DataTexture.
 */
export function canvasToDataTexture(
  canvas: HTMLCanvasElement,
  colorSpace: "srgb" | "linear" = "srgb",
): DataTexture {
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Failed to obtain 2D context for procedural DataTexture");
  }
  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const bytes = new Uint8Array(imgData.data.buffer.slice(0));
  const tex = new DataTexture(canvas.width, canvas.height, bytes, colorSpace);
  tex.wrap = "clamp";
  tex.needsUpdate = true;
  return tex;
}

function catmullRomValue(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const v0 = (p2 - p0) * 0.5;
  const v1 = (p3 - p1) * 0.5;
  const t2 = t * t;
  const t3 = t * t2;
  return (
    (2 * p1 - 2 * p2 + v0 + v1) * t3 +
    (-3 * p1 + 3 * p2 - 2 * v0 - v1) * t2 +
    v0 * t +
    p1
  );
}

/**
 * Procedural Catmull-Rom 3D spline curve with uniform arc-length lookup table,
 * compatible with @threert/scene Vector3 (since @threert/scene omits TubeGeometry/CatmullRomCurve3).
 */
export class CatmullRomCurve3 {
  readonly points: Vector3[];
  private readonly arcLengths: number[] = [];
  private readonly arcSamples = 240;

  constructor(points: Vector3[]) {
    if (points.length < 2) {
      throw new Error("CatmullRomCurve3 requires at least 2 control points");
    }
    this.points = points.map((p) => p.clone());
    this.computeArcLengths();
  }

  private computeArcLengths(): void {
    this.arcLengths.length = 0;
    let total = 0;
    let prev = this.getPoint(0);
    this.arcLengths.push(0);
    for (let i = 1; i <= this.arcSamples; i++) {
      const t = i / this.arcSamples;
      const cur = this.getPoint(t);
      total += cur.distanceTo(prev);
      this.arcLengths.push(total);
      prev = cur;
    }
  }

  getLength(): number {
    return this.arcLengths[this.arcLengths.length - 1] ?? 0;
  }

  getUtoTmapping(u: number): number {
    const clampedU = Math.max(0, Math.min(1, u));
    const total = this.getLength();
    if (total <= 1e-6) return clampedU;
    const targetArc = clampedU * total;

    let low = 0;
    let high = this.arcSamples;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (this.arcLengths[mid] < targetArc) {
        low = mid + 1;
      } else {
        high = mid;
      }
    }
    const i = Math.max(0, low - 1);
    const l0 = this.arcLengths[i];
    const l1 = this.arcLengths[i + 1] ?? l0;
    const segLen = l1 - l0;
    const frac = segLen > 1e-7 ? (targetArc - l0) / segLen : 0;
    return (i + frac) / this.arcSamples;
  }

  getPoint(t: number, target = new Vector3()): Vector3 {
    const pts = this.points;
    const l = pts.length;
    const clamped = Math.max(0, Math.min(1, t));
    const p = (l - 1) * clamped;
    const intPoint = Math.floor(p);
    const weight = p - intPoint;

    const p0 = pts[intPoint === 0 ? 0 : intPoint - 1];
    const p1 = pts[intPoint];
    const p2 = pts[intPoint > l - 2 ? l - 1 : intPoint + 1];
    const p3 = pts[intPoint > l - 3 ? l - 1 : intPoint + 2];

    target.set(
      catmullRomValue(p0.x, p1.x, p2.x, p3.x, weight),
      catmullRomValue(p0.y, p1.y, p2.y, p3.y, weight),
      catmullRomValue(p0.z, p1.z, p2.z, p3.z, weight),
    );
    return target;
  }

  getPointAt(u: number, target = new Vector3()): Vector3 {
    return this.getPoint(this.getUtoTmapping(u), target);
  }

  getTangent(t: number, target = new Vector3()): Vector3 {
    const delta = 0.0005;
    const t1 = Math.max(0, t - delta);
    const t2 = Math.min(1, t + delta);
    const p1 = this.getPoint(t1);
    const p2 = this.getPoint(t2);
    return target.copy(p2).sub(p1).normalize();
  }

  getTangentAt(u: number, target = new Vector3()): Vector3 {
    return this.getTangent(this.getUtoTmapping(u), target);
  }
}

/**
 * Procedurally builds a smooth tubular MeshGeometry using Parallel Transport (Bishop) frames
 * so curved acrylic diverter tracks maintain clean circular cross-sections without twisting.
 */
export function createTubeMeshGeometry(
  curve: CatmullRomCurve3,
  tubularSegments: number,
  radius: number,
  radialSegments: number,
  closed = false,
): MeshGeometry {
  const tangents: Vector3[] = [];
  const normals: Vector3[] = [];
  const binormals: Vector3[] = [];

  for (let i = 0; i <= tubularSegments; i++) {
    const u = i / tubularSegments;
    tangents.push(curve.getTangentAt(u));
  }

  // Initial normal perpendicular to tangent[0]
  const t0 = tangents[0];
  const ref = Math.abs(t0.y) < 0.9 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0);
  const n0 = new Vector3().crossVectors(t0, ref).normalize();
  const b0 = new Vector3().crossVectors(t0, n0).normalize();
  normals.push(n0);
  binormals.push(b0);

  // Propagate Bishop parallel-transport frame
  for (let i = 1; i <= tubularSegments; i++) {
    const prevT = tangents[i - 1];
    const curT = tangents[i];
    const axis = new Vector3().crossVectors(prevT, curT);
    const prevN = normals[i - 1].clone();

    if (axis.lengthSq() > 1e-10) {
      axis.normalize();
      const cosTheta = Math.max(-1, Math.min(1, prevT.dot(curT)));
      const angle = Math.acos(cosTheta);
      const c = Math.cos(angle);
      const s = Math.sin(angle);
      const cross = new Vector3().crossVectors(axis, prevN);
      const dot = axis.dot(prevN);
      prevN.set(
        prevN.x * c + cross.x * s + axis.x * dot * (1 - c),
        prevN.y * c + cross.y * s + axis.y * dot * (1 - c),
        prevN.z * c + cross.z * s + axis.z * dot * (1 - c),
      );
    }

    // Re-orthonormalize
    const curN = prevN.sub(curT.clone().multiplyScalar(prevN.dot(curT))).normalize();
    const curB = new Vector3().crossVectors(curT, curN).normalize();
    normals.push(curN);
    binormals.push(curB);
  }

  const ringCount = tubularSegments + 1;
  const cols = radialSegments + 1;
  const vertCount = ringCount * cols;

  const positions = new Float32Array(vertCount * 3);
  const vertexNormals = new Float32Array(vertCount * 3);
  const uvs = new Float32Array(vertCount * 2);
  const indices: number[] = [];

  const P = new Vector3();
  const N = new Vector3();
  const vertex = new Vector3();

  for (let i = 0; i <= tubularSegments; i++) {
    const u = closed && i === tubularSegments ? 0 : i / tubularSegments;
    curve.getPointAt(u, P);
    const nVec = normals[i];
    const bVec = binormals[i];

    for (let j = 0; j <= radialSegments; j++) {
      const v = j / radialSegments;
      const theta = v * Math.PI * 2;
      const sin = Math.sin(theta);
      const cos = -Math.cos(theta);

      N.set(
        cos * nVec.x + sin * bVec.x,
        cos * nVec.y + sin * bVec.y,
        cos * nVec.z + sin * bVec.z,
      ).normalize();

      vertex.set(
        P.x + radius * N.x,
        P.y + radius * N.y,
        P.z + radius * N.z,
      );

      const idx = i * cols + j;
      positions[idx * 3] = vertex.x;
      positions[idx * 3 + 1] = vertex.y;
      positions[idx * 3 + 2] = vertex.z;

      vertexNormals[idx * 3] = N.x;
      vertexNormals[idx * 3 + 1] = N.y;
      vertexNormals[idx * 3 + 2] = N.z;

      uvs[idx * 2] = u;
      uvs[idx * 2 + 1] = v;
    }
  }

  for (let i = 0; i < tubularSegments; i++) {
    for (let j = 0; j < radialSegments; j++) {
      const a = i * cols + j;
      const b = (i + 1) * cols + j;
      const c = (i + 1) * cols + (j + 1);
      const d = i * cols + (j + 1);

      indices.push(a, b, d);
      indices.push(b, c, d);
    }
  }

  return new MeshGeometry(positions, new Uint32Array(indices), vertexNormals, uvs);
}

/**
 * Generates an open concave cylindrical studio cyclorama wall centered at (0, 0, centerZ),
 * sweeping symmetrically across `arcAngle` with inward-facing normals and left-to-right UVs
 * so backdrop typography renders cleanly without horizontal mirroring.
 */
export function createCurvedCycloramaGeometry(
  radius: number,
  height: number,
  arcAngle: number,
  centerZ: number,
  radialSegs = 72,
): MeshGeometry {
  const cols = radialSegs + 1;
  const rows = 2;
  const vertCount = cols * rows;

  const positions = new Float32Array(vertCount * 3);
  const normals = new Float32Array(vertCount * 3);
  const uvs = new Float32Array(vertCount * 2);
  const indices: number[] = [];

  for (let r = 0; r < rows; r++) {
    const v = r; // 0 = bottom, 1 = top
    const y = v * height;
    for (let i = 0; i <= radialSegs; i++) {
      const u = i / radialSegs;
      const theta = (u - 0.5) * arcAngle; // -arc/2 (left) -> +arc/2 (right)
      const sinT = Math.sin(theta);
      const cosT = Math.cos(theta);

      const x = radius * sinT;
      const z = centerZ - radius * cosT;

      const idx = r * cols + i;
      positions[idx * 3] = x;
      positions[idx * 3 + 1] = y;
      positions[idx * 3 + 2] = z;

      normals[idx * 3] = -sinT;
      normals[idx * 3 + 1] = 0;
      normals[idx * 3 + 2] = cosT;

      uvs[idx * 2] = u;
      uvs[idx * 2 + 1] = v;
    }
  }

  for (let i = 0; i < radialSegs; i++) {
    const bl = i;
    const br = i + 1;
    const tl = cols + i;
    const tr = cols + i + 1;
    indices.push(bl, br, tl);
    indices.push(br, tr, tl);
  }

  return new MeshGeometry(positions, new Uint32Array(indices), normals, uvs);
}

/**
 * Generates a curved solid architectural step/riser arc block spanning `innerRadius..outerRadius`
 * around `(0, 0, centerZ)` for concentric black-and-white studio bleachers.
 */
export function createCurvedStepArcGeometry(
  innerRadius: number,
  outerRadius: number,
  height: number,
  arcAngle: number,
  centerZ: number,
  radialSegs = 64,
): MeshGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const pushQuad = (
    p0: [number, number, number],
    p1: [number, number, number],
    p2: [number, number, number],
    p3: [number, number, number],
    n: [number, number, number],
    u0: number,
    u1: number,
    v0: number,
    v1: number,
  ) => {
    const base = positions.length / 3;
    positions.push(...p0, ...p1, ...p2, ...p3);
    normals.push(...n, ...n, ...n, ...n);
    uvs.push(u0, v0, u1, v0, u1, v1, u0, v1);
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };

  for (let i = 0; i < radialSegs; i++) {
    const u0 = i / radialSegs;
    const u1 = (i + 1) / radialSegs;
    const t0 = (u0 - 0.5) * arcAngle;
    const t1 = (u1 - 0.5) * arcAngle;

    const s0 = Math.sin(t0);
    const c0 = Math.cos(t0);
    const s1 = Math.sin(t1);
    const c1 = Math.cos(t1);

    const xi0 = innerRadius * s0;
    const zi0 = centerZ - innerRadius * c0;
    const xi1 = innerRadius * s1;
    const zi1 = centerZ - innerRadius * c1;

    const xo0 = outerRadius * s0;
    const zo0 = centerZ - outerRadius * c0;
    const xo1 = outerRadius * s1;
    const zo1 = centerZ - outerRadius * c1;

    const midT = (t0 + t1) * 0.5;
    const nIn: [number, number, number] = [-Math.sin(midT), 0, Math.cos(midT)];

    // Front-facing inner arc fascia (faces camera, lower V half [0.02..0.46])
    pushQuad([xi0, 0, zi0], [xi1, 0, zi1], [xi1, height, zi1], [xi0, height, zi0], nIn, u0, u1, 0.02, 0.46);

    // Top deck face (upper V half [0.54..0.98])
    pushQuad(
      [xi0, height, zi0],
      [xi1, height, zi1],
      [xo1, height, zo1],
      [xo0, height, zo0],
      [0, 1, 0],
      u0,
      u1,
      0.54,
      0.98,
    );
  }

  return new MeshGeometry(
    new Float32Array(positions),
    new Uint32Array(indices),
    new Float32Array(normals),
    new Float32Array(uvs),
  );
}
