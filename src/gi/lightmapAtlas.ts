export type UvUnpackMode = "single" | "box" | "cylinder";

export interface StaticChartEntry {
  vertexCount: number;
  rect: [number, number, number, number]; // [u0, v0, u1, v1] normalized [0..1]
  unpackMode: UvUnpackMode;
}

export interface StaticGiLayout {
  atlasSize: number;
  neutralUv: [number, number];
  charts: Record<string, StaticChartEntry>;
}

/**
 * Infers non-overlapping UV1 unpack strategy for procedural @threert/scene geometries.
 * - BoxGeometry emits 6 groups (one per face), packed 3x2.
 * - CylinderGeometry packs side, top cap, and bottom cap into disjoint sub-rects.
 * - Lathe, Torus, Cyclorama, and StepArc already have unique [0..1]^2 UVs.
 */
export function inferUnpackMode(
  normals: Float32Array,
  indices: Uint32Array,
  groups?: Uint32Array | null,
): UvUnpackMode {
  if (groups && groups.length === 18) {
    return "box";
  }

  // Detect closed CylinderGeometry (has distinct flat +Y top cap & -Y bottom cap)
  let hasTopCap = false;
  let hasBottomCap = false;
  let hasSideWall = false;
  for (let i = 0; i < indices.length; i += 3) {
    const i0 = indices[i];
    const i1 = indices[i + 1];
    const i2 = indices[i + 2];
    const ny0 = normals[i0 * 3 + 1];
    const ny1 = normals[i1 * 3 + 1];
    const ny2 = normals[i2 * 3 + 1];
    if (ny0 > 0.999 && ny1 > 0.999 && ny2 > 0.999) {
      hasTopCap = true;
    } else if (ny0 < -0.999 && ny1 < -0.999 && ny2 < -0.999) {
      hasBottomCap = true;
    } else {
      hasSideWall = true;
    }
  }
  if (hasSideWall && (hasTopCap || hasBottomCap)) {
    return "cylinder";
  }
  return "single";
}

/**
 * Generates non-overlapping UV1 lightmap coordinates inside `rect` = [u0, v0, u1, v1].
 */
export function buildStaticChartUv1(
  normals: Float32Array,
  uvs: Float32Array,
  indices: Uint32Array,
  rect: readonly [number, number, number, number],
  unpackMode: UvUnpackMode,
  groups?: Uint32Array | null,
): Float32Array {
  const vertCount = normals.length / 3;
  const out = new Float32Array(vertCount * 2);
  const [ru0, rv0, ru1, rv1] = rect;
  const rw = ru1 - ru0;
  const rh = rv1 - rv0;

  if (unpackMode === "box" && groups && groups.length === 18) {
    const pad = 0.04;
    for (let g = 0; g < 6; g++) {
      const start = groups[g * 3];
      const count = groups[g * 3 + 1];
      const col = g % 3;
      const row = Math.floor(g / 3);
      const tileU0 = ru0 + ((col + pad) / 3) * rw;
      const tileU1 = ru0 + ((col + 1 - pad) / 3) * rw;
      const tileV0 = rv0 + ((row + pad) / 2) * rh;
      const tileV1 = rv0 + ((row + 1 - pad) / 2) * rh;
      for (let k = start; k < start + count; k++) {
        const vi = indices[k];
        const u = Math.max(0, Math.min(1, uvs[vi * 2] ?? 0));
        const v = Math.max(0, Math.min(1, uvs[vi * 2 + 1] ?? 0));
        out[vi * 2] = tileU0 + u * (tileU1 - tileU0);
        out[vi * 2 + 1] = tileV0 + v * (tileV1 - tileV0);
      }
    }
    return out;
  }

  if (unpackMode === "cylinder") {
    // Disjoint sub-regions: top cap [0.02..0.72, 0.02..0.98] for max floor shadow res,
    // side [0.75..0.98, 0.02..0.48], bottom [0.75..0.98, 0.52..0.98]
    for (let t = 0; t < indices.length; t += 3) {
      const a = indices[t];
      const b = indices[t + 1];
      const c = indices[t + 2];
      const nyA = normals[a * 3 + 1];
      const nyB = normals[b * 3 + 1];
      const nyC = normals[c * 3 + 1];

      let subU0 = 0.75;
      let subU1 = 0.98;
      let subV0 = 0.02;
      let subV1 = 0.48;
      if (nyA > 0.999 && nyB > 0.999 && nyC > 0.999) {
        subU0 = 0.02;
        subU1 = 0.72;
        subV0 = 0.02;
        subV1 = 0.98;
      } else if (nyA < -0.999 && nyB < -0.999 && nyC < -0.999) {
        subU0 = 0.75;
        subU1 = 0.98;
        subV0 = 0.52;
        subV1 = 0.98;
      }

      for (const vi of [a, b, c]) {
        const u = Math.max(0, Math.min(1, uvs[vi * 2] ?? 0));
        const v = Math.max(0, Math.min(1, uvs[vi * 2 + 1] ?? 0));
        const nu = subU0 + u * (subU1 - subU0);
        const nv = subV0 + v * (subV1 - subV0);
        out[vi * 2] = ru0 + nu * rw;
        out[vi * 2 + 1] = rv0 + nv * rh;
      }
    }
    return out;
  }

  // "single" chart (Lathe, Torus, Cyclorama, StepArc)
  for (let i = 0; i < vertCount; i++) {
    const u = Math.max(0, Math.min(1, uvs[i * 2] ?? 0));
    const v = Math.max(0, Math.min(1, uvs[i * 2 + 1] ?? 0));
    out[i * 2] = ru0 + u * rw;
    out[i * 2 + 1] = rv0 + v * rh;
  }
  return out;
}

/**
 * Safe neutral UV1 for dynamic / unbaked meshes sharing materials with static baked geometry.
 * Maps to bottom-left neutral pixel (AO = 1.0, lightMap = 0.0).
 */
export function buildNeutralUv1(
  vertexCount: number,
  neutralUv: readonly [number, number] = [0.002, 0.002],
): Float32Array {
  const out = new Float32Array(vertexCount * 2);
  for (let i = 0; i < vertexCount; i++) {
    out[i * 2] = neutralUv[0];
    out[i * 2 + 1] = neutralUv[1];
  }
  return out;
}
