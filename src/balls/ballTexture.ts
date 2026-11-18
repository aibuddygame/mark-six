import { canvasToDataTexture } from "../utils/procedural";
import { BallColorKind } from "./ballTypes";

interface BallSphereLutEntry {
  pixelOffset: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  fx: number;
  fy: number;
  alpha: number;
}

const TEX_W = 512;
const TEX_H = 256;
const GLYPH_SIZE = 256;
const ATLAS_COLS = 8;
const ATLAS_ROWS = 8;

const cachedSphereLuts = new Map<string, BallSphereLutEntry[]>();
let sharedGlyphCanvas: HTMLCanvasElement | null = null;
let sharedOutCanvas: HTMLCanvasElement | null = null;

function getBallRgb(kind: BallColorKind): [number, number, number] {
  switch (kind) {
    case "red":
      // Balanced bright Mark Six crimson: vibrant under studio light without turning coral-orange
      return [202, 16, 28];
    case "blue":
      return [36, 102, 240];
    case "green":
      return [22, 166, 76];
  }
}

/**
 * Builds a one-time 3D lookup mapping equirectangular texels onto 12 regular
 * dodecahedron pentagonal windows (matching official Mark Six ball tessellation)
 * with zero polar stretching and crisp colored webbing between panels.
 */
function getBallSphereLut(
  texW = TEX_W,
  texH = TEX_H,
  glyphSize = GLYPH_SIZE,
): BallSphereLutEntry[] {
  const key = `${texW}x${texH}x${glyphSize}`;
  const cached = cachedSphereLuts.get(key);
  if (cached) return cached;

  const phi = (1 + Math.sqrt(5)) / 2;
  const rawCenters: [number, number, number][] = [
    [0, 1, phi],
    [0, -1, phi],
    [0, 1, -phi],
    [0, -1, -phi],
    [1, phi, 0],
    [-1, phi, 0],
    [1, -phi, 0],
    [-1, -phi, 0],
    [phi, 0, 1],
    [-phi, 0, 1],
    [phi, 0, -1],
    [-phi, 0, -1],
  ];

  const faces = rawCenters.map(([x, y, z]) => {
    const len = Math.hypot(x, y, z);
    const fx = x / len;
    const fy = y / len;
    const fz = z / len;
    // Reference up vector so every number panel reads upright
    const ux = 0;
    const uy = Math.abs(fy) < 0.9 ? 1 : 0;
    const uz = Math.abs(fy) < 0.9 ? 0 : -1;
    // rx = normalize(U x F)
    const rxRawX = uy * fz - uz * fy;
    const rxRawY = uz * fx - ux * fz;
    const rxRawZ = ux * fy - uy * fx;
    const rLen = Math.hypot(rxRawX, rxRawY, rxRawZ) || 1;
    const rx = rxRawX / rLen;
    const ry = rxRawY / rLen;
    const rz = rxRawZ / rLen;
    // dx = rx x F (points down on glyph canvas = +srcY)
    const dx = ry * fz - rz * fy;
    const dy = rz * fx - rx * fz;
    const dz = rx * fy - ry * fx;
    return { fx, fy, fz, rx, ry, rz, dx, dy, dz };
  });

  // ~58% colored rib frame + ~42% 12 compact rounded pentagonal white windows matching real Mark Six balls
  const panelMargin = 0.198;
  const aaWidth = 0.024;
  const capCos = 0.917;
  const capAa = 0.0055;
  const maxProj = 0.36;
  const entries: BallSphereLutEntry[] = [];

  for (let py = 0; py < texH; py++) {
    const theta = ((py + 0.5) / texH) * Math.PI;
    const sinT = Math.sin(theta);
    const cosT = Math.cos(theta);

    for (let px = 0; px < texW; px++) {
      const az = ((px + 0.5) / texW) * Math.PI * 2;
      const nx = -sinT * Math.cos(az);
      const ny = cosT;
      const nz = sinT * Math.sin(az);

      let bestFace = faces[0];
      let d1 = -2;
      let d2 = -2;
      for (let f = 0; f < 12; f++) {
        const face = faces[f];
        const d = nx * face.fx + ny * face.fy + nz * face.fz;
        if (d > d1) {
          d2 = d1;
          d1 = d;
          bestFace = face;
        } else if (d > d2) {
          d2 = d;
        }
      }

      const margin = d1 - d2;
      if (margin > panelMargin - aaWidth && d1 > capCos - capAa) {
        const edgeBlend = Math.max(
          0,
          Math.min(1, (margin - (panelMargin - aaWidth)) / (aaWidth * 1.5)),
        );
        const capBlend = Math.max(
          0,
          Math.min(1, (d1 - (capCos - capAa)) / (capAa * 1.5)),
        );
        const blend = edgeBlend * capBlend;
        const uCoord = nx * bestFace.rx + ny * bestFace.ry + nz * bestFace.rz;
        const vCoord = nx * bestFace.dx + ny * bestFace.dy + nz * bestFace.dz;
        const normU = 0.5 + (uCoord / maxProj) * 0.44;
        const normV = 0.5 + (vCoord / maxProj) * 0.44;
        const gx = Math.max(0, Math.min(glyphSize - 1, normU * (glyphSize - 1)));
        const gy = Math.max(0, Math.min(glyphSize - 1, normV * (glyphSize - 1)));
        const x0 = Math.floor(gx);
        const y0 = Math.floor(gy);
        const x1 = Math.min(glyphSize - 1, x0 + 1);
        const y1 = Math.min(glyphSize - 1, y0 + 1);

        entries.push({
          pixelOffset: (py * texW + px) * 4,
          x0,
          y0,
          x1,
          y1,
          fx: gx - x0,
          fy: gy - y0,
          alpha: Math.round(blend * 255),
        });
      }
    }
  }

  cachedSphereLuts.set(key, entries);
  return entries;
}

/** Helper drawing extra-heavy black-sans Mark Six numeral + tight underline onto the white panel canvas. */
function drawBallNumeralGlyph(
  gCtx: CanvasRenderingContext2D,
  num: number,
  _kind: BallColorKind,
  glyphSize = GLYPH_SIZE,
): void {
  const label = String(num).padStart(2, "0");
  gCtx.fillStyle = "#ffffff";
  gCtx.fillRect(0, 0, glyphSize, glyphSize);

  const scale = glyphSize / GLYPH_SIZE;
  gCtx.save();
  gCtx.scale(scale, scale);

  const scaleX = 0.84;
  const strokeW = 5;
  gCtx.font = '900 122px "Arial Black", "Hiragino Sans", "PingFang HK", sans-serif';
  gCtx.textAlign = "center";
  gCtx.textBaseline = "middle";
  const m = gCtx.measureText(label);
  const ascent = m.actualBoundingBoxAscent || 45;
  const descent = m.actualBoundingBoxDescent || 45;
  const gap = 4;
  const barH = 14;
  const totalH = ascent + descent + strokeW + gap + barH;
  const cy = (GLYPH_SIZE - totalH) * 0.5 + ascent + strokeW * 0.5;

  gCtx.save();
  gCtx.translate(GLYPH_SIZE / 2, 0);
  gCtx.scale(scaleX, 1);
  gCtx.lineJoin = "round";
  gCtx.miterLimit = 2;
  gCtx.lineWidth = strokeW;
  gCtx.strokeStyle = "#0b0f19";
  gCtx.fillStyle = "#0b0f19";
  gCtx.strokeText(label, 0, cy);
  gCtx.fillText(label, 0, cy);
  gCtx.restore();

  const rawWidth =
    (m.actualBoundingBoxLeft || 60) + (m.actualBoundingBoxRight || 60) + strokeW;
  const digitWidth = rawWidth * scaleX;
  const barW = Math.min(150, Math.max(82, Math.round(digitWidth + 6)));
  const barY = Math.round(cy + descent + strokeW * 0.5 + gap);
  gCtx.fillStyle = "#0b0f19";
  gCtx.fillRect(Math.round((GLYPH_SIZE - barW) / 2), barY, barW, barH);
  gCtx.restore();
}

/** Synthesizes a 12-panel dodecahedral procedural ball DataTexture for the given ball number. */
export function createBallTexture(num: number, kind: BallColorKind) {
  if (!sharedGlyphCanvas) {
    sharedGlyphCanvas = document.createElement("canvas");
    sharedGlyphCanvas.width = GLYPH_SIZE;
    sharedGlyphCanvas.height = GLYPH_SIZE;
  }
  const gCtx = sharedGlyphCanvas.getContext("2d")!;
  drawBallNumeralGlyph(gCtx, num, kind);

  const glyphData = gCtx.getImageData(0, 0, GLYPH_SIZE, GLYPH_SIZE).data;

  if (!sharedOutCanvas) {
    sharedOutCanvas = document.createElement("canvas");
    sharedOutCanvas.width = TEX_W;
    sharedOutCanvas.height = TEX_H;
  }
  const outCtx = sharedOutCanvas.getContext("2d")!;
  const outImg = outCtx.createImageData(TEX_W, TEX_H);
  const out = outImg.data;
  const [br, bg, bb] = getBallRgb(kind);

  for (let py = 0; py < TEX_H; py++) {
    const bandDist = Math.abs(py - TEX_H * 0.5) / (TEX_H * 0.25);
    const shade = bandDist < 1 ? 1 + (1 - bandDist) * 0.06 : 0.97;
    const r = Math.min(255, Math.round(br * shade));
    const g = Math.min(255, Math.round(bg * shade));
    const b = Math.min(255, Math.round(bb * shade));
    let idx = py * TEX_W * 4;
    for (let px = 0; px < TEX_W; px++) {
      out[idx] = r;
      out[idx + 1] = g;
      out[idx + 2] = b;
      out[idx + 3] = 255;
      idx += 4;
    }
  }

  const lut = getBallSphereLut();
  for (let i = 0; i < lut.length; i++) {
    const e = lut[i];
    const w00 = (1 - e.fx) * (1 - e.fy);
    const w10 = e.fx * (1 - e.fy);
    const w01 = (1 - e.fx) * e.fy;
    const w11 = e.fx * e.fy;
    const o00 = (e.y0 * GLYPH_SIZE + e.x0) * 4;
    const o10 = (e.y0 * GLYPH_SIZE + e.x1) * 4;
    const o01 = (e.y1 * GLYPH_SIZE + e.x0) * 4;
    const o11 = (e.y1 * GLYPH_SIZE + e.x1) * 4;
    const gr = glyphData[o00] * w00 + glyphData[o10] * w10 + glyphData[o01] * w01 + glyphData[o11] * w11;
    const gg = glyphData[o00 + 1] * w00 + glyphData[o10 + 1] * w10 + glyphData[o01 + 1] * w01 + glyphData[o11 + 1] * w11;
    const gb = glyphData[o00 + 2] * w00 + glyphData[o10 + 2] * w10 + glyphData[o01 + 2] * w01 + glyphData[o11 + 2] * w11;
    const a = e.alpha / 255;
    const invA = 1 - a;
    out[e.pixelOffset] = Math.round(out[e.pixelOffset] * invA + gr * a);
    out[e.pixelOffset + 1] = Math.round(out[e.pixelOffset + 1] * invA + gg * a);
    out[e.pixelOffset + 2] = Math.round(out[e.pixelOffset + 2] * invA + gb * a);
  }

  outCtx.putImageData(outImg, 0, 0);
  return canvasToDataTexture(sharedOutCanvas, "srgb");
}

/**
 * Packs all 49 Mark Six ball textures into a single 4096x2048 (8x8 cells of 512x256) DataTexture
 * with bilinear medallion filtering so every ball numeral is razor-sharp with zero aliasing.
 */
export function createBallAtlasTexture(
  getKind: (num: number) => BallColorKind,
  isMobile = false,
) {
  const texW = isMobile ? 256 : TEX_W;
  const texH = isMobile ? 128 : TEX_H;
  const glyphSize = isMobile ? 128 : GLYPH_SIZE;
  const atlasW = texW * ATLAS_COLS;
  const atlasH = texH * ATLAS_ROWS;

  if (!sharedGlyphCanvas) {
    sharedGlyphCanvas = document.createElement("canvas");
  }
  sharedGlyphCanvas.width = glyphSize;
  sharedGlyphCanvas.height = glyphSize;
  const gCtx = sharedGlyphCanvas.getContext("2d")!;

  const atlasCanvas = document.createElement("canvas");
  atlasCanvas.width = atlasW;
  atlasCanvas.height = atlasH;
  const atlasCtx = atlasCanvas.getContext("2d")!;
  const atlasImg = atlasCtx.createImageData(atlasW, atlasH);
  const atlas = atlasImg.data;
  const lut = getBallSphereLut(texW, texH, glyphSize);

  for (let num = 1; num <= 49; num++) {
    const kind = getKind(num);
    drawBallNumeralGlyph(gCtx, num, kind, glyphSize);
    const glyphData = gCtx.getImageData(0, 0, glyphSize, glyphSize).data;

    const cellCol = (num - 1) % ATLAS_COLS;
    const cellRow = Math.floor((num - 1) / ATLAS_COLS);
    const baseX = cellCol * texW;
    const baseY = cellRow * texH;
    const [br, bg, bb] = getBallRgb(kind);

    for (let py = 0; py < texH; py++) {
      const bandDist = Math.abs(py - texH * 0.5) / (texH * 0.25);
      const shade = bandDist < 1 ? 1 + (1 - bandDist) * 0.06 : 0.97;
      const r = Math.min(255, Math.round(br * shade));
      const g = Math.min(255, Math.round(bg * shade));
      const b = Math.min(255, Math.round(bb * shade));
      let idx = ((baseY + py) * atlasW + baseX) * 4;
      for (let px = 0; px < texW; px++) {
        atlas[idx] = r;
        atlas[idx + 1] = g;
        atlas[idx + 2] = b;
        atlas[idx + 3] = 255;
        idx += 4;
      }
    }

    for (let i = 0; i < lut.length; i++) {
      const e = lut[i];
      const cellPx = Math.floor(e.pixelOffset / 4);
      const lx = cellPx % texW;
      const ly = Math.floor(cellPx / texW);
      const aOff = ((baseY + ly) * atlasW + (baseX + lx)) * 4;
      const w00 = (1 - e.fx) * (1 - e.fy);
      const w10 = e.fx * (1 - e.fy);
      const w01 = (1 - e.fx) * e.fy;
      const w11 = e.fx * e.fy;
      const o00 = (e.y0 * glyphSize + e.x0) * 4;
      const o10 = (e.y0 * glyphSize + e.x1) * 4;
      const o01 = (e.y1 * glyphSize + e.x0) * 4;
      const o11 = (e.y1 * glyphSize + e.x1) * 4;
      const gr = glyphData[o00] * w00 + glyphData[o10] * w10 + glyphData[o01] * w01 + glyphData[o11] * w11;
      const gg = glyphData[o00 + 1] * w00 + glyphData[o10 + 1] * w10 + glyphData[o01 + 1] * w01 + glyphData[o11 + 1] * w11;
      const gb = glyphData[o00 + 2] * w00 + glyphData[o10 + 2] * w10 + glyphData[o01 + 2] * w01 + glyphData[o11 + 2] * w11;
      const a = e.alpha / 255;
      const invA = 1 - a;
      atlas[aOff] = Math.round(atlas[aOff] * invA + gr * a);
      atlas[aOff + 1] = Math.round(atlas[aOff + 1] * invA + gg * a);
      atlas[aOff + 2] = Math.round(atlas[aOff + 2] * invA + gb * a);
    }
  }

  atlasCtx.putImageData(atlasImg, 0, 0);
  const tex = canvasToDataTexture(atlasCanvas, "srgb");
  tex.wrap = "clamp";
  return tex;
}

/** Remaps normalized [0..1]^2 sphere UVs into ball `num` (1..49)'s atlas cell with safe 1px inset. */
export function remapBallAtlasUvs(
  uvs: Float32Array,
  num: number,
  isMobile = false,
): void {
  const texW = isMobile ? 256 : TEX_W;
  const texH = isMobile ? 128 : TEX_H;
  const col = (num - 1) % ATLAS_COLS;
  const row = Math.floor((num - 1) / ATLAS_COLS);
  const padU = 1 / texW;
  const padV = 1 / texH;
  const u0 = (col + padU) / ATLAS_COLS;
  const uSpan = (1 - padU * 2) / ATLAS_COLS;
  const v0 = (ATLAS_ROWS - 1 - row + padV) / ATLAS_ROWS;
  const vSpan = (1 - padV * 2) / ATLAS_ROWS;
  for (let i = 0; i < uvs.length; i += 2) {
    uvs[i] = u0 + uvs[i] * uSpan;
    uvs[i + 1] = v0 + uvs[i + 1] * vSpan;
  }
}
