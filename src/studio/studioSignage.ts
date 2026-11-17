import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { MeshGeometry } from "@threert/scene";
import { threeBufferGeometryToMeshGeometry } from "../utils/procedural";
import { CHOCOLATE_GLYPHS, GlyphCmd } from "./chocolateGlyphData";

function applyCommandsToPath(path: THREE.Path, cmds: GlyphCmd[]) {
  for (const c of cmds) {
    switch (c[0]) {
      case "M":
        path.moveTo(c[1], c[2]);
        break;
      case "L":
        path.lineTo(c[1], c[2]);
        break;
      case "Q":
        path.quadraticCurveTo(c[1], c[2], c[3], c[4]);
        break;
      case "C":
        path.bezierCurveTo(c[1], c[2], c[3], c[4], c[5], c[6]);
        break;
    }
  }
  path.closePath();
}

function buildChocolateGlyphShapes(ch: string): {
  shapes: THREE.Shape[];
  advance: number;
} {
  if (ch === " ") {
    return { shapes: [], advance: 0.42 };
  }
  const def = CHOCOLATE_GLYPHS[ch];
  if (!def) {
    return { shapes: [], advance: 0.5 };
  }

  const shapes: THREE.Shape[] = [];
  for (const entry of def.shapes) {
    const s = new THREE.Shape();
    applyCommandsToPath(s, entry.outer);
    for (const holeCmds of entry.holes) {
      const h = new THREE.Path();
      applyCommandsToPath(h, holeCmds);
      s.holes.push(h);
    }
    shapes.push(s);
  }
  return { shapes, advance: def.advance };
}

/**
 * Generates a curved 3D beveled signage MeshGeometry using authentic
 * Chocolate Classical Sans vector outlines, conformed seamlessly to the
 * concave cylindrical studio wall of radius `wallRadius` centered at `(0, 0, arcCenterZ)`.
 */
export function createCurvedWallSignageGeometry(
  text: string,
  letterHeight: number,
  letterSpacing: number,
  extrudeDepth: number,
  wallRadius: number,
  arcCenterZ: number,
  centerThetaRad: number,
  centerY: number,
): MeshGeometry {
  const glyphs: Array<{ shapes: THREE.Shape[]; xOffset: number }> = [];
  let cursor = 0;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const g = buildChocolateGlyphShapes(ch);
    if (g.shapes.length > 0) {
      glyphs.push({ shapes: g.shapes, xOffset: cursor });
    }
    cursor += g.advance * letterHeight;
    if (i < text.length - 1 && ch !== " " && text[i + 1] !== " ") {
      cursor += letterSpacing * letterHeight;
    }
  }

  const totalWidth = cursor;
  const parts: THREE.BufferGeometry[] = [];

  for (const g of glyphs) {
    for (const shape of g.shapes) {
      const raw = new THREE.ExtrudeGeometry(shape, {
        depth: extrudeDepth,
        bevelEnabled: true,
        bevelThickness: Math.min(0.009, extrudeDepth * 0.2),
        bevelSize: Math.min(0.007, letterHeight * 0.012),
        bevelSegments: 2,
        curveSegments: 5,
      });
      const nonIdx = raw.index ? raw.toNonIndexed() : raw;
      if (nonIdx !== raw) raw.dispose();

      nonIdx.scale(letterHeight, letterHeight, 1);
      nonIdx.translate(g.xOffset - totalWidth * 0.5, -letterHeight * 0.42, 0);
      parts.push(nonIdx);
    }
  }

  const merged = mergeGeometries(parts, false);
  parts.forEach((p) => p.dispose());

  // Wrap flat local (x, y, z) onto concave studio wall cylinder
  const posAttr = merged.getAttribute("position") as THREE.BufferAttribute;
  for (let i = 0; i < posAttr.count; i++) {
    const lx = posAttr.getX(i);
    const ly = posAttr.getY(i);
    const lz = posAttr.getZ(i);

    const theta = centerThetaRad + lx / wallRadius;
    const r = wallRadius - lz;
    const wx = r * Math.sin(theta);
    const wz = arcCenterZ - r * Math.cos(theta);
    const wy = centerY + ly;

    posAttr.setXYZ(i, wx, wy, wz);
  }
  posAttr.needsUpdate = true;
  merged.computeVertexNormals();

  // Compute non-overlapping cylindrical UV projection for baked drop shadows & bevel AO
  const vertCount = posAttr.count;
  const uvs = new Float32Array(vertCount * 2);
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < vertCount; i++) {
    const y = posAttr.getY(i);
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const spanY = Math.max(1e-4, maxY - minY);
  const halfAngle = Math.max(1e-4, (totalWidth * 0.55) / wallRadius);

  for (let i = 0; i < vertCount; i++) {
    const x = posAttr.getX(i);
    const y = posAttr.getY(i);
    const z = posAttr.getZ(i);
    const theta = Math.atan2(x, arcCenterZ - z);
    let dTheta = theta - centerThetaRad;
    while (dTheta > Math.PI) dTheta -= Math.PI * 2;
    while (dTheta < -Math.PI) dTheta += Math.PI * 2;
    const u = Math.max(0.02, Math.min(0.98, 0.5 + (dTheta / (halfAngle * 2)) * 0.94));
    const v = Math.max(0.02, Math.min(0.98, 0.03 + ((y - minY) / spanY) * 0.94));
    uvs[i * 2] = u;
    uvs[i * 2 + 1] = v;
  }
  merged.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));

  const meshGeo = threeBufferGeometryToMeshGeometry(merged, false);
  merged.dispose();
  return meshGeo;
}
