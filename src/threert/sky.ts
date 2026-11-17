import * as THREE from "three";

/**
 * Generates an interactive studio softbox PMREM environment texture procedurally
 * using an internal studio rig scene rendered through PMREMGenerator.
 * Produces authentic curved overhead and side softbox highlights on the
 * Halogen III spherical mixing drum, chrome rings, and clearcoated balls.
 */
export function createReflectiveStudioEnv(
  renderer: THREE.WebGLRenderer,
): THREE.Texture {
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();

  const envScene = new THREE.Scene();
  envScene.background = new THREE.Color(0x04060d);

  const addPanel = (
    w: number,
    h: number,
    pos: [number, number, number],
    rot: [number, number, number],
    hex: number,
    intensity: number,
  ) => {
    const geo = new THREE.PlaneGeometry(w, h);
    const mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(hex).multiplyScalar(intensity),
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(...pos);
    mesh.rotation.set(...rot);
    envScene.add(mesh);
  };

  // Realistic balanced overhead studio softboxes (high above globe to frame crown without blocking center)
  addPanel(4.2, 2.0, [-3.4, 8.8, 0.5], [Math.PI / 2, 0, 0], 0xffffff, 1.55);
  addPanel(4.2, 2.0, [3.4, 8.8, 0.5], [Math.PI / 2, 0, 0], 0xf0f6ff, 1.45);
  addPanel(5.4, 0.45, [0, 8.6, -1.2], [Math.PI / 2.2, 0, 0], 0xfff8eb, 1.8);

  // Subtle lateral vertical studio strip reflections hugging the sphere flanks (keep center view crystal clear!)
  addPanel(1.3, 6.4, [-8.2, 4.2, 1.6], [0, Math.PI / 2.2, 0], 0xffffff, 1.75);
  addPanel(1.3, 6.2, [8.2, 4.1, 1.6], [0, -Math.PI / 2.2, 0], 0xe0f2fe, 1.60);
  addPanel(0.28, 6.2, [-6.4, 4.4, 3.6], [0.05, Math.PI / 3.0, 0], 0xffffff, 2.1);
  addPanel(0.28, 6.0, [6.4, 4.3, 3.6], [0.05, -Math.PI / 3.0, 0], 0xf0f9ff, 1.95);
  // Subtle warm amber lateral accents
  addPanel(0.22, 4.4, [-6.8, 3.3, -0.4], [0, Math.PI / 2.0, 0], 0xffd28a, 1.4);
  addPanel(0.22, 4.4, [6.8, 3.3, -0.4], [0, -Math.PI / 2.0, 0], 0xffd28a, 1.3);

  // Subtle rear studio perimeter light & periwinkle horizon bounce
  addPanel(0.40, 5.4, [-5.2, 4.2, -5.8], [0, -Math.PI * 0.75, 0], 0xfff7ed, 1.35);
  addPanel(0.40, 5.4, [5.2, 4.2, -5.8], [0, Math.PI * 0.75, 0], 0xe0e7ff, 1.35);
  addPanel(18, 3.8, [0, 1.2, -9.2], [0, 0, 0], 0x5b67f1, 0.72);

  // Subtle warm orange platter rim reflection below
  addPanel(5.5, 0.28, [0, -1.2, 4.2], [-Math.PI / 3.0, 0, 0], 0xff7a26, 0.85);

  const renderTarget = pmrem.fromScene(envScene, 0.008);

  // Dispose temporary geometries/materials in envScene
  envScene.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.geometry.dispose();
      if (Array.isArray(obj.material)) {
        obj.material.forEach((m) => m.dispose());
      } else {
        obj.material.dispose();
      }
    }
  });
  pmrem.dispose();

  return renderTarget.texture;
}

/**
 * Computes normalized directional vector from azimuth & elevation in degrees.
 */
export function sunDirectionFromAngles(
  azimuthDeg: number,
  elevationDeg: number,
): THREE.Vector3 {
  const az = THREE.MathUtils.degToRad(azimuthDeg);
  const el = THREE.MathUtils.degToRad(elevationDeg);
  const cosEl = Math.cos(el);
  return new THREE.Vector3(
    cosEl * Math.sin(az),
    Math.sin(el),
    cosEl * Math.cos(az),
  ).normalize();
}
