import * as THREE from "three";
import {
  BoxGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  LatheGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PointLight,
  RingGeometry,
  SphereGeometry,
  TorusGeometry,
  Vector2,
  Vector3,
} from "@threert/scene";
import {
  CatmullRomCurve3,
  canvasToDataTexture,
  createRoundedBoxMeshGeometry,
  createTubeMeshGeometry,
  MergeGeometryPart,
  mergeSceneGeometries,
  threeBufferGeometryToMeshGeometry,
} from "../utils/procedural";

export const DRUM_CENTER_Y = 3.22;
export const DRUM_RADIUS = 1.40;
export const HORSESHOE_RADIUS = 1.86;
export const BALL_RADIUS = 0.122;
export const RACK_COL_SPACING = 0.258;
export const RACK_ROW_SPACING = BALL_RADIUS * 2.04;
export const RACK_START_Y = DRUM_CENTER_Y + 0.44;
export const RACK_Z = -1.72;
export const LIFTER_REST_Y = DRUM_CENTER_Y - DRUM_RADIUS - 0.02;
export const LIFTER_SEAL_Y = DRUM_CENTER_Y - DRUM_RADIUS + 0.16;
export const CAPTURE_POCKET_Y = DRUM_CENTER_Y - DRUM_RADIUS + 0.13;
export const TOP_EXIT_Y = DRUM_CENTER_Y + 1.545;

export interface PaddleWingSpec {
  dir: -1 | 1;
  halfExtents: [number, number, number];
  pos: [number, number, number];
  rot: [number, number, number];
}

// Contoured 2-stage transparent polycarbonate scoop arms hugging the spherical bowl floor & lower wall
export const PADDLE_WING_SPECS: PaddleWingSpec[] = [-1, 1].flatMap((d) => {
  const dir = d as -1 | 1;
  return [
    {
      dir,
      halfExtents: [0.24, 0.09, 0.015] as [number, number, number],
      pos: [dir * 0.48, 0.14, 0] as [number, number, number],
      rot: [dir * 0.46, 0, dir * 0.24] as [number, number, number],
    },
    {
      dir,
      halfExtents: [0.21, 0.10, 0.015] as [number, number, number],
      pos: [dir * 0.92, 0.41, 0] as [number, number, number],
      rot: [dir * 0.52, 0, dir * 0.78] as [number, number, number],
    },
  ];
});

export interface MachineRig {
  root: Group;
  agitatorGroup: Group;
  pusherGroup: Group;
  pusherLight: PointLight;
  pusherGlowMat: MeshStandardMaterial;
  diverterFlapGroup: Group;
  orangeRingMat: MeshStandardMaterial;
  horseshoeLedMat: MeshStandardMaterial;
  gateShutterMesh: Mesh;
  leftTrackCurve: CatmullRomCurve3;
  rightTrackCurve: CatmullRomCurve3;
  rackElbowCurves: CatmullRomCurve3[];
  leftStopUs: number[];
  rightStopUs: number[];
}

function createOrangeLedStripTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 32;
  const ctx = canvas.getContext("2d")!;

  ctx.fillStyle = "#280702";
  ctx.fillRect(0, 0, 512, 32);

  // 54 crisp high-contrast glowing amber-orange LED pips matching real Halogen III pedestal ring
  const count = 54;
  const step = 512 / count;
  for (let i = 0; i < count; i++) {
    const cx = (i + 0.5) * step;
    const cy = 16;
    const g = ctx.createRadialGradient(cx, cy, 0.3, cx, cy, 4.4);
    g.addColorStop(0.0, "#fffce8");
    g.addColorStop(0.32, "#ff9624");
    g.addColorStop(0.70, "#d43000");
    g.addColorStop(1.0, "rgba(40, 7, 2, 0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, 4.4, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = canvasToDataTexture(canvas, "srgb");
  tex.wrap = "repeat";
  return tex;
}

function createMachineSurfaceTextures() {
  // 1. Satin powder-coat fiberglass subtle micro-grain (white machine housing)
  const wSize = 256;
  const wColCanvas = document.createElement("canvas");
  wColCanvas.width = wSize;
  wColCanvas.height = wSize;
  const wc = wColCanvas.getContext("2d")!;
  wc.fillStyle = "#f4f6fa";
  wc.fillRect(0, 0, wSize, wSize);

  const wRoughCanvas = document.createElement("canvas");
  wRoughCanvas.width = wSize;
  wRoughCanvas.height = wSize;
  const wr = wRoughCanvas.getContext("2d")!;
  wr.fillStyle = "rgb(52, 52, 52)";
  wr.fillRect(0, 0, wSize, wSize);

  for (let i = 0; i < 650; i++) {
    const x = (i * 73) % wSize;
    const y = (i * 151) % wSize;
    const r = 1.5 + (i % 4);
    wc.fillStyle = i % 2 === 0 ? "rgba(255,255,255,0.03)" : "rgba(180,190,210,0.03)";
    wc.beginPath();
    wc.arc(x, y, r, 0, Math.PI * 2);
    wc.fill();

    const rv = 42 + (i % 24);
    wr.fillStyle = `rgba(${rv},${rv},${rv},0.32)`;
    wr.beginPath();
    wr.arc(x, y, r, 0, Math.PI * 2);
    wr.fill();
  }

  // 2. Anisotropic brushed aluminum grain (platter, brackets, rack framing)
  const sSize = 256;
  const sColCanvas = document.createElement("canvas");
  sColCanvas.width = sSize;
  sColCanvas.height = sSize;
  const sc = sColCanvas.getContext("2d")!;
  sc.fillStyle = "#d5dde8";
  sc.fillRect(0, 0, sSize, sSize);

  const sRoughCanvas = document.createElement("canvas");
  sRoughCanvas.width = sSize;
  sRoughCanvas.height = sSize;
  const sr = sRoughCanvas.getContext("2d")!;
  sr.fillStyle = "rgb(78, 78, 78)";
  sr.fillRect(0, 0, sSize, sSize);

  for (let y = 0; y < sSize; y++) {
    const streak = ((y * 53) % 23) - 11;
    sc.fillStyle = streak >= 0 ? `rgba(255,255,255,${streak * 0.008})` : `rgba(80,92,110,${-streak * 0.008})`;
    sc.fillRect(0, y, sSize, 1);

    const rv = Math.max(55, Math.min(115, 78 + streak * 2));
    sr.fillStyle = `rgb(${rv},${rv},${rv})`;
    sr.fillRect(0, y, sSize, 1);
  }

  const whiteMap = canvasToDataTexture(wColCanvas, "srgb");
  whiteMap.wrap = "repeat";
  whiteMap.repeat = [3, 3];
  const whiteRoughMap = canvasToDataTexture(wRoughCanvas, "linear");
  whiteRoughMap.wrap = "repeat";
  whiteRoughMap.repeat = [3, 3];

  const silverMap = canvasToDataTexture(sColCanvas, "srgb");
  silverMap.wrap = "repeat";
  silverMap.repeat = [2, 2];
  const silverRoughMap = canvasToDataTexture(sRoughCanvas, "linear");
  silverRoughMap.wrap = "repeat";
  silverRoughMap.repeat = [2, 2];

  return { whiteMap, whiteRoughMap, silverMap, silverRoughMap };
}

function createSideCradleWingGeometry(side: -1 | 1) {
  const shape = new THREE.Shape();
  if (side > 0) {
    shape.moveTo(0.56, 1.716);
    shape.lineTo(1.06, 1.716);
    shape.bezierCurveTo(1.48, 1.78, 1.82, 2.02, 1.95, 2.33);
    shape.lineTo(1.22, 2.33);
    shape.bezierCurveTo(1.06, 2.05, 0.84, 1.84, 0.56, 1.825);
    shape.lineTo(0.56, 1.716);
  } else {
    shape.moveTo(-0.56, 1.716);
    shape.lineTo(-0.56, 1.825);
    shape.bezierCurveTo(-0.84, 1.84, -1.06, 2.05, -1.22, 2.33);
    shape.lineTo(-1.95, 2.33);
    shape.bezierCurveTo(-1.82, 2.02, -1.48, 1.78, -1.06, 1.716);
    shape.lineTo(-0.56, 1.716);
  }

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 0.32,
    bevelEnabled: true,
    bevelThickness: 0.028,
    bevelSize: 0.024,
    bevelSegments: 4,
    curveSegments: 20,
  });
  // Span Z across [-0.128 .. +0.248] so both horseshoe arch & forward result tracks rest flush on shoulder
  geo.translate(0, 0, -0.10);
  const meshGeo = threeBufferGeometryToMeshGeometry(geo, true);
  geo.dispose();
  return meshGeo;
}

function createGlowRibbonTexture(rgb: string) {
  const canvas = document.createElement("canvas");
  canvas.width = 32;
  canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createLinearGradient(0, 0, 0, 128);
  g.addColorStop(0.0, `rgba(${rgb}, 0)`);
  g.addColorStop(0.5, `rgba(${rgb}, 0.85)`);
  g.addColorStop(1.0, `rgba(${rgb}, 0)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 32, 128);
  return canvasToDataTexture(canvas, "srgb");
}

/**
 * Computes exact normalized spline U coordinates along `curve` so N parked balls
 * touch each other cleanly with zero air gap starting from `endStopU`.
 */
function computeZeroGapStopUs(
  curve: CatmullRomCurve3,
  count: number,
  endStopU: number,
): number[] {
  const stops: number[] = [];
  const targetChord = BALL_RADIUS * 2.002;
  const step = 0.00035;

  stops.push(endStopU);
  let anchorPos = curve.getPointAt(endStopU);
  let scanU = endStopU;

  for (let i = 1; i < count; i++) {
    while (scanU > 0.01) {
      scanU = Math.max(0, scanU - step);
      const p = curve.getPointAt(scanU);
      if (p.distanceTo(anchorPos) >= targetChord) {
        stops.push(scanU);
        anchorPos = p;
        break;
      }
    }
  }
  return stops;
}

export function createHalogenMachine(isMobile = false): MachineRig {
  const root = new Group();
  root.name = "halogenIII";

  const { whiteMap, whiteRoughMap, silverMap, silverRoughMap } =
    createMachineSurfaceTextures();

  const glossWhiteMat = new MeshPhysicalMaterial({
    color: 0xffffff,
    map: whiteMap,
    roughnessMap: whiteRoughMap,
    roughness: 0.34,
    metalness: 0.04,
    clearcoat: 0.88,
    clearcoatRoughness: 0.08,
  });

  const satinSilverMat = new MeshStandardMaterial({
    color: 0xffffff,
    map: silverMap,
    roughnessMap: silverRoughMap,
    roughness: 0.42,
    metalness: 0.82,
  });

  const chromeMat = new MeshPhysicalMaterial({
    color: 0xf1f5f9,
    roughness: 0.08,
    metalness: 0.95,
    clearcoat: 0.4,
  });

  const darkTrimMat = new MeshStandardMaterial({
    color: 0x161c29,
    roughness: 0.34,
    metalness: 0.55,
  });

  // =========================================================================
  // 1. Streamlined White Conical Base (流線型白色圓錐底座)
  // Smooth continuous upward-tapering truncated cone matching real Halogen III
  // =========================================================================
  const coneProfile = [
    new Vector2(0.0, 0.02),
    new Vector2(1.12, 0.02),
    new Vector2(1.11, 0.14),
    new Vector2(1.07, 0.50),
    new Vector2(1.03, 0.95),
    new Vector2(0.99, 1.38),
    new Vector2(0.97, 1.62),
    new Vector2(0.0, 1.62),
  ];
  const conicalBase = new Mesh(new LatheGeometry(coneProfile, 56), glossWhiteMat);
  conicalBase.name = "static:conical_base";
  conicalBase.receiveShadow = true;
  root.add(conicalBase);

  const baseChromeRing = new Mesh(new TorusGeometry(1.11, 0.024, 12, 56), chromeMat);
  baseChromeRing.name = "static:base_chrome_ring";
  baseChromeRing.rotation.x = Math.PI / 2;
  baseChromeRing.position.set(0, 0.04, 0);
  root.add(baseChromeRing);

  // Subtle recessed dark neck reveal beneath solid silver pedestal platter
  const neckShadowCollar = new Mesh(
    new CylinderGeometry(0.98, 0.98, 0.03, 48),
    darkTrimMat,
  );
  neckShadowCollar.name = "static:neck_shadow_collar";
  neckShadowCollar.position.set(0, 1.625, 0);
  root.add(neckShadowCollar);

  // =========================================================================
  // 2. Opaque Brushed-Silver Platter + Inset Amber-Orange Dotted LED Trim
  // (Mounted flush atop the white pedestal; both white side pillars connect directly onto it)
  // =========================================================================
  const platterRadius = 1.15;

  // Lower metallic silver rim bezel
  const platterLowerRim = new Mesh(
    new CylinderGeometry(platterRadius, platterRadius - 0.02, 0.022, 64),
    satinSilverMat,
  );
  platterLowerRim.name = "static:platter_lower_rim";
  platterLowerRim.position.set(0, 1.64, 0);
  platterLowerRim.receiveShadow = true;
  root.add(platterLowerRim);

  // Recessed amber-orange dotted LED strip (single textured band = 1 draw call)
  const orangeLedTex = createOrangeLedStripTexture();
  const orangeRingMat = new MeshStandardMaterial({
    color: 0xff6a00,
    map: orangeLedTex,
    emissive: 0xff5a00,
    emissiveMap: orangeLedTex,
    emissiveIntensity: 2.15,
    roughness: 0.22,
    metalness: 0.08,
  });
  orangeRingMat.name = "emitter:orangeLed";
  const orangeLedChannel = new Mesh(
    new CylinderGeometry(platterRadius - 0.008, platterRadius - 0.008, 0.052, 64, 1, true),
    orangeRingMat,
  );
  orangeLedChannel.position.set(0, 1.674, 0);
  root.add(orangeLedChannel);

  // Soft subtle additive rim glow halo around orange LED channel (center-bright directional gradient)
  const orangeHaloTex = createGlowRibbonTexture("255, 118, 28");
  const orangeHaloMat = new MeshStandardMaterial({
    color: 0x000000,
    emissive: 0xff6d1a,
    emissiveMap: orangeHaloTex,
    emissiveIntensity: 1.45,
    transparent: true,
    opacity: 0.44,
    side: DoubleSide,
  });
  orangeHaloMat.name = "additive:orangeRimHalo";
  const orangeHaloBand = new Mesh(
    new CylinderGeometry(platterRadius + 0.015, platterRadius + 0.015, 0.095, 56, 1, true),
    orangeHaloMat,
  );
  orangeHaloBand.position.set(0, 1.674, 0);
  root.add(orangeHaloBand);

  // Upper solid opaque brushed-silver platter lid
  const platterTopDeck = new Mesh(
    new CylinderGeometry(platterRadius - 0.015, platterRadius, 0.028, 64),
    satinSilverMat,
  );
  platterTopDeck.name = "static:platter_top_deck";
  platterTopDeck.position.set(0, 1.712, 0);
  platterTopDeck.receiveShadow = true;
  root.add(platterTopDeck);

  // Unified white bowl collar directly below the drum with open central bore uniting cleanly into both white side cradle arms
  const bevelProfile = [
    new Vector2(0.185, 1.716),
    new Vector2(0.185, 1.838),
    new Vector2(0.62, 1.842),
    new Vector2(0.84, 1.808),
    new Vector2(0.94, 1.745),
    new Vector2(0.96, 1.716),
    new Vector2(0.185, 1.716),
  ];
  const platterInnerBevel = new Mesh(new LatheGeometry(bevelProfile, 56), glossWhiteMat);
  platterInnerBevel.name = "static:platter_inner_bevel";
  platterInnerBevel.receiveShadow = true;
  root.add(platterInnerBevel);

  // =========================================================================
  // 3. Left/Right Sculpted Beveled White Cradle Cheeks + Horseshoe Joining Top Rack Collar
  // (Merged into minimal draw calls while preserving exact sub-UVs for static GI baking)
  // =========================================================================
  const horseshoeLedMat = new MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0xf4f9ff,
    emissiveIntensity: 2.35,
    roughness: 0.12,
  });
  horseshoeLedMat.name = "emitter:horseshoeLed";
  const horseshoeHaloMat = new MeshBasicMaterial({
    color: 0xe0efff,
    transparent: true,
    opacity: 0.24,
  });
  horseshoeHaloMat.name = "additive:horseshoeHalo";

  const legStartY = 2.31;
  const legHeight = DRUM_CENTER_Y - legStartY;

  const whiteArchParts: MergeGeometryPart[] = [
    { geo: createSideCradleWingGeometry(-1) },
    { geo: createSideCradleWingGeometry(1) },
    {
      geo: new CylinderGeometry(0.085, 0.085, legHeight, 24),
      pos: [-HORSESHOE_RADIUS, legStartY + legHeight * 0.5, -0.02],
    },
    {
      geo: new CylinderGeometry(0.085, 0.085, legHeight, 24),
      pos: [HORSESHOE_RADIUS, legStartY + legHeight * 0.5, -0.02],
    },
    {
      geo: new TorusGeometry(HORSESHOE_RADIUS, 0.085, 20, 72, Math.PI),
      pos: [0, DRUM_CENTER_Y, -0.02],
    },
  ];
  const whiteArchAll = new Mesh(mergeSceneGeometries(whiteArchParts, true), glossWhiteMat);
  whiteArchAll.name = "static:white_arch_all";
  whiteArchAll.receiveShadow = true;
  root.add(whiteArchAll);

  const horseshoeLedParts: MergeGeometryPart[] = [
    {
      geo: new CylinderGeometry(0.058, 0.058, legHeight, 20),
      pos: [-HORSESHOE_RADIUS, legStartY + legHeight * 0.5, 0.045],
    },
    {
      geo: new CylinderGeometry(0.058, 0.058, legHeight, 20),
      pos: [HORSESHOE_RADIUS, legStartY + legHeight * 0.5, 0.045],
    },
    {
      geo: new TorusGeometry(HORSESHOE_RADIUS, 0.056, 16, 72, Math.PI),
      pos: [0, DRUM_CENTER_Y, 0.045],
    },
  ];
  root.add(new Mesh(mergeSceneGeometries(horseshoeLedParts), horseshoeLedMat));

  const horseshoeHaloParts: MergeGeometryPart[] = [
    {
      geo: new CylinderGeometry(0.092, 0.092, legHeight, 16, 1, true),
      pos: [-HORSESHOE_RADIUS, legStartY + legHeight * 0.5, 0.045],
    },
    {
      geo: new CylinderGeometry(0.092, 0.092, legHeight, 16, 1, true),
      pos: [HORSESHOE_RADIUS, legStartY + legHeight * 0.5, 0.045],
    },
    {
      geo: new TorusGeometry(HORSESHOE_RADIUS, 0.090, 12, 64, Math.PI),
      pos: [0, DRUM_CENTER_Y, 0.045],
    },
  ];
  root.add(new Mesh(mergeSceneGeometries(horseshoeHaloParts), horseshoeHaloMat));

  // =========================================================================
  // 4. Open Central Capture Well + Short Crown Exit Sleeve + Lifting Illuminated Piston
  // (No enclosing protective cylinder in the chamber — balls fall straight into the center well!)
  // =========================================================================
  const innerGlassMat = new MeshPhysicalMaterial({
    color: 0x051018,
    roughness: 0.008,
    metalness: 0.0,
    opacity: 0.04,
    transparent: true,
    clearcoat: 1.0,
    clearcoatRoughness: 0.005,
    ior: 1.49,
    specularIntensity: 1.0,
    side: DoubleSide,
  });
  innerGlassMat.name = "centerGlassTube";

  // Short top crown acrylic neck tube uniting the sphere top port cleanly with the T-junction
  const crownTubeStartY = DRUM_CENTER_Y + DRUM_RADIUS - 0.06;
  const crownTubeLength = TOP_EXIT_Y + 0.04 - crownTubeStartY;
  const centerGuideTube = new Mesh(
    new CylinderGeometry(0.152, 0.152, crownTubeLength, 28, 1, true),
    innerGlassMat,
  );
  centerGuideTube.position.set(0, crownTubeStartY + crownTubeLength * 0.5, 0);
  root.add(centerGuideTube);

  // Bottom open circular pocket capture hole (recessed stainless collar + beveled intake ring)
  const pocketFunnel = new Mesh(
    new CylinderGeometry(0.175, 0.152, 0.12, 32, 1, true),
    chromeMat,
  );
  pocketFunnel.name = "static:pocket_funnel";
  pocketFunnel.position.set(0, DRUM_CENTER_Y - DRUM_RADIUS + 0.03, 0);
  root.add(pocketFunnel);

  const pocketRim = new Mesh(new TorusGeometry(0.185, 0.016, 12, 36), chromeMat);
  pocketRim.name = "static:pocket_rim";
  pocketRim.rotation.x = Math.PI / 2;
  pocketRim.position.set(0, DRUM_CENTER_Y - DRUM_RADIUS + 0.09, 0);
  root.add(pocketRim);

  // Dynamic Lifting Illuminated Pusher Light Column Assembly (bright halogen core + volumetric aura)
  const pusherGroup = new Group();
  pusherGroup.name = "liftingPusherRod";
  pusherGroup.position.set(0, LIFTER_REST_Y, 0);
  root.add(pusherGroup);

  const pusherGlowMat = new MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0xfff3d8,
    emissiveIntensity: 3.1,
    roughness: 0.14,
  });
  pusherGlowMat.name = "emitter:pusherLed";

  const pusherCore = new Mesh(new CylinderGeometry(0.068, 0.068, 3.25, 24), pusherGlowMat);
  pusherCore.position.set(0, -1.70, 0);
  pusherGroup.add(pusherCore);

  const pusherHaloMat = new MeshBasicMaterial({
    color: 0xfff0cc,
    transparent: true,
    opacity: 0.36,
    side: DoubleSide,
  });
  pusherHaloMat.name = "additive:pusherGlow";
  const pusherHalo = new Mesh(
    new CylinderGeometry(0.112, 0.112, 3.22, 20, 1, true),
    pusherHaloMat,
  );
  pusherHalo.position.set(0, -1.70, 0);
  pusherGroup.add(pusherHalo);

  const pusherHeadCollar = new Mesh(new CylinderGeometry(0.106, 0.078, 0.11, 24), chromeMat);
  pusherHeadCollar.position.set(0, -0.065, 0);
  pusherGroup.add(pusherHeadCollar);

  const pusherCupRing = new Mesh(new TorusGeometry(0.098, 0.020, 12, 28), pusherGlowMat);
  pusherCupRing.rotation.x = Math.PI / 2;
  pusherCupRing.position.set(0, -0.012, 0);
  pusherGroup.add(pusherCupRing);

  const pusherLight = new PointLight(0xf8fafc, 5.2, 4.6);
  // Placed below the collar so it illuminates the shaft/chamber cleanly without blowing out the front ball number
  pusherLight.position.set(0, -0.22, 0.04);
  pusherLight.castShadow = false;
  pusherGroup.add(pusherLight);

  // Overhead horseshoe arch bounce light illuminating the mixing drum interior and balls cleanly
  const archChamberLight = new PointLight(0xf4f8ff, 11.5, 6.4);
  archChamberLight.position.set(0, 4.30, 0.55);
  archChamberLight.castShadow = false;
  root.add(archChamberLight);

  // Illuminated cool-white chamber floor diffuser RING surrounding the open center capture hole
  const chamberFloorMat = new MeshStandardMaterial({
    color: 0xf8fbff,
    emissive: 0xeaf4ff,
    emissiveIntensity: 2.5,
    roughness: 0.25,
    side: DoubleSide,
  });
  chamberFloorMat.name = "emitter:chamberFloor";
  const chamberFloorRing = new Mesh(
    new RingGeometry(0.185, 0.58, 40),
    chamberFloorMat,
  );
  chamberFloorRing.rotation.x = -Math.PI / 2;
  chamberFloorRing.position.set(0, DRUM_CENTER_Y - DRUM_RADIUS + 0.085, 0);
  root.add(chamberFloorRing);

  // =========================================================================
  // 5. Rotating Bottom Transparent Acrylic Agitator Paddles (透明亞加力旋轉撥臂)
  // =========================================================================
  const agitatorAcrylicMat = new MeshPhysicalMaterial({
    color: 0x051018,
    roughness: 0.012,
    metalness: 0.0,
    opacity: 0.04,
    transparent: true,
    clearcoat: 1.0,
    clearcoatRoughness: 0.006,
    ior: 1.49,
    specularIntensity: 1.0,
  });
  agitatorAcrylicMat.name = "agitatorTransparentAcrylic";

  const agitatorGroup = new Group();
  agitatorGroup.name = "agitatorRotor";
  agitatorGroup.position.set(0, DRUM_CENTER_Y - DRUM_RADIUS + 0.13, 0);
  root.add(agitatorGroup);

  const paddleParts: MergeGeometryPart[] = PADDLE_WING_SPECS.map((spec) => ({
    geo: new BoxGeometry(
      spec.halfExtents[0] * 2,
      spec.halfExtents[1] * 2,
      spec.halfExtents[2] * 2,
    ),
    pos: spec.pos,
    rot: spec.rot,
  }));
  agitatorGroup.add(new Mesh(mergeSceneGeometries(paddleParts), agitatorAcrylicMat));

  // =========================================================================
  // 6. Crystal-Clear Acrylic T-Junction + Zero-Overlap Side-Arch Diverter Tracks (R_track = 1.585)
  // Connects central guide tube directly via acrylic T-hub into left/right horseshoe tracks (zero metal/dots)
  // =========================================================================
  const diverterFlapGroup = new Group();
  diverterFlapGroup.name = "diverterGate";
  diverterFlapGroup.position.set(0, TOP_EXIT_Y + 0.09, 0.0);
  root.add(diverterFlapGroup);

  const diverterPaddle = new Mesh(new BoxGeometry(0.016, 0.09, 0.06), innerGlassMat);
  diverterPaddle.position.set(0, -0.04, 0);
  diverterFlapGroup.add(diverterPaddle);

  // Track centerlines strictly orbit (0, DRUM_CENTER_Y, 0) at R = 1.585 (zero overlap with sphere or horseshoe)
  const leftTrackCurve = new CatmullRomCurve3([
    new Vector3(0.0, TOP_EXIT_Y + 0.04, 0.0),
    new Vector3(-0.38, 4.76, 0.04),
    new Vector3(-0.89, 4.53, 0.09),
    new Vector3(-1.34, 4.06, 0.13),
    new Vector3(-1.57, 3.44, 0.15),
    new Vector3(-1.54, 2.84, 0.15),
    new Vector3(-1.35, 2.345, 0.14),
  ]);

  const rightTrackCurve = new CatmullRomCurve3([
    new Vector3(0.0, TOP_EXIT_Y + 0.04, 0.0),
    new Vector3(0.38, 4.76, 0.04),
    new Vector3(0.89, 4.53, 0.09),
    new Vector3(1.34, 4.06, 0.13),
    new Vector3(1.57, 3.44, 0.15),
    new Vector3(1.54, 2.84, 0.15),
    new Vector3(1.35, 2.345, 0.14),
  ]);

  const trackGlassMat = new MeshPhysicalMaterial({
    color: 0x051018,
    roughness: 0.008,
    metalness: 0.0,
    opacity: 0.04,
    transparent: true,
    clearcoat: 1.0,
    clearcoatRoughness: 0.005,
    ior: 1.50,
    specularIntensity: 1.0,
    side: DoubleSide,
  });
  trackGlassMat.name = "acrylicTracks";

  const trackTubeRadius = BALL_RADIUS + 0.018;
  // Visible track tubes begin cleanly at the outer arms of the T-junction (no center double-overlap)
  const buildVisibleTrackSubCurve = (fullCurve: CatmullRomCurve3) => {
    const pts: Vector3[] = [];
    for (let i = 0; i <= 12; i++) {
      const u = 0.055 + (i / 12) * 0.945;
      pts.push(fullCurve.getPointAt(u));
    }
    return new CatmullRomCurve3(pts);
  };
  const trackTubularSegs = isMobile ? 64 : 112;
  const trackRadialSegs = isMobile ? 16 : 24;
  const leftTrackMesh = new Mesh(
    createTubeMeshGeometry(
      buildVisibleTrackSubCurve(leftTrackCurve),
      trackTubularSegs,
      trackTubeRadius,
      trackRadialSegs,
    ),
    trackGlassMat,
  );
  root.add(leftTrackMesh);

  const rightTrackMesh = new Mesh(
    createTubeMeshGeometry(
      buildVisibleTrackSubCurve(rightTrackCurve),
      trackTubularSegs,
      trackTubeRadius,
      trackRadialSegs,
    ),
    trackGlassMat,
  );
  root.add(rightTrackMesh);

  // Seamless transparent acrylic T-junction bridge uniting top vertical tube with left/right curved tracks
  const tStartLeft = leftTrackCurve.getPointAt(0.055);
  const tStartRight = rightTrackCurve.getPointAt(0.055);
  const tBridgeSpan = tStartRight.x - tStartLeft.x + 0.02;
  const tJunctionParts: MergeGeometryPart[] = [
    {
      geo: new CylinderGeometry(trackTubeRadius + 0.004, trackTubeRadius + 0.004, tBridgeSpan, 24, 1, true),
      pos: [0, TOP_EXIT_Y + 0.036, 0.008],
      rot: [0, 0, Math.PI / 2],
    },
    {
      geo: new TorusGeometry(trackTubeRadius + 0.005, 0.010, 10, 24),
      pos: [tStartLeft.x, tStartLeft.y, tStartLeft.z],
      lookAt: [tStartLeft.x - 1, tStartLeft.y - 0.15, tStartLeft.z + 0.1],
    },
    {
      geo: new TorusGeometry(trackTubeRadius + 0.005, 0.010, 10, 24),
      pos: [tStartRight.x, tStartRight.y, tStartRight.z],
      lookAt: [tStartRight.x + 1, tStartRight.y - 0.15, tStartRight.z + 0.1],
    },
    {
      geo: new CylinderGeometry(0.156, 0.156, 0.022, 28),
      pos: [0, TOP_EXIT_Y + 0.04 + trackTubeRadius + 0.006, 0],
    },
  ];
  root.add(new Mesh(mergeSceneGeometries(tJunctionParts), trackGlassMat));

  // Clear polycarbonate clamp tabs tying upper tracks subtly to horseshoe inner rail; diverter & horseshoe bases sit directly onto the white cradle pillars with zero metal hardware
  const trackBracketAcrylicMat = new MeshPhysicalMaterial({
    color: 0xe6effa,
    roughness: 0.06,
    metalness: 0.0,
    opacity: 0.20,
    transparent: true,
    clearcoat: 0.85,
    clearcoatRoughness: 0.04,
    ior: 1.49,
    specularIntensity: 0.65,
  });
  trackBracketAcrylicMat.name = "trackBracketAcrylic";

  const trackRingParts: MergeGeometryPart[] = [];
  const trackClampParts: MergeGeometryPart[] = [];
  for (const [curve] of [[leftTrackCurve] as const, [rightTrackCurve] as const]) {
    [0.25, 0.52, 0.78].forEach((u) => {
      const p = curve.getPointAt(u);
      const t = curve.getTangentAt(u);
      trackRingParts.push({
        geo: new TorusGeometry(trackTubeRadius + 0.005, 0.009, 10, 22),
        pos: [p.x, p.y, p.z],
        lookAt: [p.x + t.x, p.y + t.y, p.z + t.z],
      });

      const dy = p.y - DRUM_CENTER_Y;
      const rCur = Math.hypot(p.x, dy);
      const innerArchR = HORSESHOE_RADIUS - 0.082;
      const outerTrackR = rCur + trackTubeRadius + 0.006;
      const gap = Math.max(0.04, innerArchR - outerTrackR);
      const ux = p.x / (rCur || 1);
      const uy = dy / (rCur || 1);
      const midR = outerTrackR + gap * 0.5;
      trackClampParts.push({
        geo: createRoundedBoxMeshGeometry(gap + 0.02, 0.024, 0.030, 2, 0.006),
        pos: [ux * midR, DRUM_CENTER_Y + uy * midR, (p.z - 0.02) * 0.5],
        rot: [0, 0, Math.atan2(uy, ux)],
      });
    });
  }
  const trackRingsAll = new Mesh(mergeSceneGeometries(trackRingParts), trackBracketAcrylicMat);
  trackRingsAll.name = "track_acrylic_rings";
  root.add(trackRingsAll);

  const trackClampsAll = new Mesh(mergeSceneGeometries(trackClampParts), trackBracketAcrylicMat);
  trackClampsAll.name = "track_acrylic_tabs";
  root.add(trackClampsAll);

  const leftEndBallCenterU = 1.0 - (BALL_RADIUS + 0.03) / leftTrackCurve.getLength();
  const rightEndBallCenterU = 1.0 - (BALL_RADIUS + 0.03) / rightTrackCurve.getLength();
  const leftStopUs = computeZeroGapStopUs(leftTrackCurve, 6, leftEndBallCenterU);
  const rightStopUs = computeZeroGapStopUs(rightTrackCurve, 1, rightEndBallCenterU);

  // =========================================================================
  // 7. Rear-Middle Low-Glare Transparent Acrylic 7x7 Loader + 7 Feed Port Holes
  // (Softened specular highlights keep front globe view & rising ball clear)
  // =========================================================================
  const rackAcrylicMat = new MeshPhysicalMaterial({
    color: 0x0b1624,
    roughness: 0.14,
    metalness: 0.0,
    opacity: 0.024,
    transparent: true,
    clearcoat: 0.22,
    clearcoatRoughness: 0.12,
    ior: 1.49,
    specularIntensity: 0.28,
  });
  rackAcrylicMat.name = "acrylicRack7x7";

  const rackSolidAcrylicMat = new MeshPhysicalMaterial({
    color: 0x0b1624,
    roughness: 0.10,
    metalness: 0.0,
    opacity: 0.034,
    transparent: true,
    clearcoat: 0.35,
    clearcoatRoughness: 0.10,
    ior: 1.49,
    specularIntensity: 0.42,
  });
  rackSolidAcrylicMat.name = "acrylicRack7x7Solid";

  const rackGroup = new Group();
  rackGroup.name = "rack7x7";
  root.add(rackGroup);

  const rackCols = 7;
  const rackWidth = (rackCols - 1) * RACK_COL_SPACING + 0.34;
  const rackBottomY = RACK_START_Y - BALL_RADIUS - 0.04;
  const rackHeight = 6 * RACK_ROW_SPACING + BALL_RADIUS * 2 + 0.14;
  const rackTopY = rackBottomY + rackHeight;

  // Merged transparent acrylic sub-assemblies (reduces 33 draw calls -> 4 draw calls)
  const rackSolidParts: MergeGeometryPart[] = [
    {
      geo: createRoundedBoxMeshGeometry(rackWidth + 0.04, 0.045, 0.28, 2, 0.010),
      pos: [0, rackTopY + 0.022, RACK_Z],
    },
    {
      geo: createRoundedBoxMeshGeometry(rackWidth + 0.04, 0.055, 0.30, 2, 0.012),
      pos: [0, rackBottomY - 0.028, RACK_Z],
    },
    ...([-1, 1] as const).map((side) => ({
      geo: createRoundedBoxMeshGeometry(0.028, rackHeight + 0.04, 0.28, 2, 0.006),
      pos: [side * (rackWidth * 0.5 - 0.014), rackBottomY + rackHeight * 0.5, RACK_Z] as [number, number, number],
    })),
  ];

  // Sliding transparent acrylic release gate tucked inside manifold (slides +Z cleanly toward globe)
  const gateShutterMesh = new Mesh(
    createRoundedBoxMeshGeometry(rackWidth - 0.06, 0.020, 0.20, 2, 0.005),
    rackSolidAcrylicMat,
  );
  gateShutterMesh.position.set(0, rackBottomY - 0.004, RACK_Z);
  rackGroup.add(gateShutterMesh);

  const rackTubeParts: MergeGeometryPart[] = [];
  const rackElbowParts: MergeGeometryPart[] = [];
  const rackElbowCurves: CatmullRomCurve3[] = [];
  const colTubeRadius = BALL_RADIUS + 0.015;
  for (let c = 0; c < rackCols; c++) {
    const colX = (c - 3) * RACK_COL_SPACING;
    rackTubeParts.push({
      geo: new CylinderGeometry(colTubeRadius, colTubeRadius, rackHeight, 20, 1, true),
      pos: [colX, rackBottomY + rackHeight * 0.5, RACK_Z],
    });

    rackSolidParts.push({
      geo: new TorusGeometry(colTubeRadius + 0.003, 0.009, 10, 20),
      pos: [colX, rackBottomY, RACK_Z],
      rot: [Math.PI * 0.5, 0, 0],
    });

    // Radially-normal curved elbow: exits vertically from loader tube and meets sphere surface at 90 degrees
    const sphereRearZ = -Math.sqrt(Math.max(0.25, DRUM_RADIUS * DRUM_RADIUS - colX * colX));
    const nx = colX / DRUM_RADIUS;
    const nz = sphereRearZ / DRUM_RADIUS;
    const yEntry = DRUM_CENTER_Y;
    const p0 = new Vector3(colX, rackBottomY + 0.02, RACK_Z);
    const p1 = new Vector3(colX, rackBottomY - 0.16, RACK_Z);
    const p2 = new Vector3(nx * (DRUM_RADIUS + 0.22), yEntry, nz * (DRUM_RADIUS + 0.22));
    const p3 = new Vector3(nx * (DRUM_RADIUS - 0.004), yEntry, nz * (DRUM_RADIUS - 0.004));
    const bezPts: Vector3[] = [];
    for (let k = 0; k <= 6; k++) {
      const t = k / 6;
      const omt = 1 - t;
      const w0 = omt * omt * omt;
      const w1 = 3 * omt * omt * t;
      const w2 = 3 * omt * t * t;
      const w3 = t * t * t;
      bezPts.push(
        new Vector3(
          p0.x * w0 + p1.x * w1 + p2.x * w2 + p3.x * w3,
          p0.y * w0 + p1.y * w1 + p2.y * w2 + p3.y * w3,
          p0.z * w0 + p1.z * w1 + p2.z * w2 + p3.z * w3,
        ),
      );
    }
    const portCurve = new CatmullRomCurve3(bezPts);
    rackElbowCurves.push(portCurve);
    rackElbowParts.push({
      geo: createTubeMeshGeometry(portCurve, 22, colTubeRadius, 20),
    });

    // Flange seated strictly tangent onto the curved spherical drum skin
    rackSolidParts.push({
      geo: new TorusGeometry(colTubeRadius + 0.004, 0.011, 10, 22),
      pos: [nx * DRUM_RADIUS, yEntry, nz * DRUM_RADIUS],
      lookAt: [0, yEntry, 0],
    });
  }

  rackGroup.add(new Mesh(mergeSceneGeometries(rackSolidParts), rackSolidAcrylicMat));
  rackGroup.add(new Mesh(mergeSceneGeometries(rackTubeParts), innerGlassMat));
  rackGroup.add(new Mesh(mergeSceneGeometries(rackElbowParts), rackAcrylicMat));

  // =========================================================================
  // 8. Thick Molded Polycarbonate Spherical Mixing Drum (Pure PBR PMREM + Dual-Wall Fresnel)
  // (No fake sticker ovals; no horizontal metal equator hoop)
  // =========================================================================
  const drumWidthSegs = isMobile ? 32 : 48;
  const drumHeightSegs = isMobile ? 24 : 36;
  if (!isMobile) {
    const drumInnerMat = new MeshPhysicalMaterial({
      color: 0xdbeafe,
      roughness: 0.03,
      opacity: 0.14,
      transparent: true,
    });
    drumInnerMat.name = "drumInnerAcrylicWall";
    const drumInnerSphere = new Mesh(
      new SphereGeometry(DRUM_RADIUS - 0.038, drumWidthSegs, drumHeightSegs),
      drumInnerMat,
    );
    drumInnerSphere.position.set(0, DRUM_CENTER_Y, 0);
    root.add(drumInnerSphere);
  }

  // Pure Fresnel-weighted glossy specular studio reflection shell (rendered via AdditiveBlending in ThreeEngine
  // with zero diffuse haze so PMREM softbox + clearcoat reflections shine at 100% strength)
  const drumGlassMat = new MeshPhysicalMaterial({
    color: 0x000000,
    roughness: 0.024,
    metalness: 0.0,
    opacity: 1.0,
    transparent: true,
    clearcoat: 1.0,
    clearcoatRoughness: 0.016,
    ior: 1.52,
    specularIntensity: 0.95,
  });
  drumGlassMat.name = "drumOuterGlass";

  const drumSphere = new Mesh(
    new SphereGeometry(DRUM_RADIUS, drumWidthSegs, drumHeightSegs),
    drumGlassMat,
  );
  drumSphere.position.set(0, DRUM_CENTER_Y, 0);
  root.add(drumSphere);

  const drumFresnelMat = new MeshPhysicalMaterial({
    color: 0xe0f2fe,
    roughness: 0.04,
    opacity: 0.4,
    transparent: true,
  });
  drumFresnelMat.name = "drumFresnelRim";
  const drumFresnelSphere = new Mesh(
    new SphereGeometry(DRUM_RADIUS + 0.002, drumWidthSegs, drumHeightSegs),
    drumFresnelMat,
  );
  drumFresnelSphere.position.set(0, DRUM_CENTER_Y, 0);
  root.add(drumFresnelSphere);

  // Tight acrylic sphere-crown collar where the central vertical tube joins the sphere apex
  const upperNeckCollar = new Mesh(
    new TorusGeometry(0.156, 0.014, 10, 28),
    innerGlassMat,
  );
  upperNeckCollar.rotation.x = Math.PI / 2;
  upperNeckCollar.position.set(0, DRUM_CENTER_Y + DRUM_RADIUS, 0);
  root.add(upperNeckCollar);

  const lowerConeGasket = new Mesh(
    new TorusGeometry(0.56, 0.022, 10, 48),
    innerGlassMat,
  );
  lowerConeGasket.rotation.x = Math.PI / 2;
  lowerConeGasket.position.set(0, DRUM_CENTER_Y - DRUM_RADIUS + 0.14, 0);
  root.add(lowerConeGasket);

  return {
    root,
    agitatorGroup,
    pusherGroup,
    pusherLight,
    pusherGlowMat,
    diverterFlapGroup,
    orangeRingMat,
    horseshoeLedMat,
    gateShutterMesh,
    leftTrackCurve,
    rightTrackCurve,
    rackElbowCurves,
    leftStopUs,
    rightStopUs,
  };
}
