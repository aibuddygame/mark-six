import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

export type CameraPresetId =
  | "main"
  | "topVortex"
  | "liftClose"
  | "leftTrack"
  | "rightTrack";

interface CameraPreset {
  label: string;
  chipText: string;
  position: THREE.Vector3;
  target: THREE.Vector3;
  fov: number;
}

const PRESETS: Record<CameraPresetId, CameraPreset> = {
  main: {
    label: "正面全景",
    chipText: "CAM 1 · 正面全景",
    position: new THREE.Vector3(0, 3.55, 11.2),
    target: new THREE.Vector3(0, 3.00, 0),
    fov: 39,
  },
  topVortex: {
    label: "機頂俯瞰",
    chipText: "CAM 2 · 機頂俯瞰",
    position: new THREE.Vector3(0.45, 7.55, 5.05),
    target: new THREE.Vector3(0, 3.22, 0),
    fov: 42,
  },
  liftClose: {
    label: "中央導管特寫",
    chipText: "CAM 3 · 中央導管特寫",
    position: new THREE.Vector3(0.48, 2.55, 3.15),
    target: new THREE.Vector3(0, 2.40, 0),
    fov: 34,
  },
  leftTrack: {
    label: "左邊軌道",
    chipText: "CAM 4 · 左邊軌道",
    position: new THREE.Vector3(-2.55, 3.00, 2.75),
    target: new THREE.Vector3(-1.42, 2.95, 0.16),
    fov: 34,
  },
  rightTrack: {
    label: "右邊軌道",
    chipText: "CAM 5 · 右邊軌道",
    position: new THREE.Vector3(2.35, 2.55, 2.55),
    target: new THREE.Vector3(1.40, 2.40, 0.16),
    fov: 31,
  },
};

export class CameraDirector {
  readonly controls: OrbitControls;
  activePreset: CameraPresetId = "main";
  autoDirector = true;

  private readonly camera: THREE.PerspectiveCamera;
  private readonly desiredPos = PRESETS.main.position.clone();
  private readonly desiredTarget = PRESETS.main.target.clone();
  private desiredFov = PRESETS.main.fov;
  private userOrbiting = false;
  private liftFollowY: number | null = null;
  private onPresetChange?: (preset: CameraPresetId, chipText: string) => void;

  constructor(
    camera: THREE.PerspectiveCamera,
    domElement: HTMLElement,
    onPresetChange?: (preset: CameraPresetId, chipText: string) => void,
  ) {
    this.camera = camera;
    this.onPresetChange = onPresetChange;

    this.controls = new OrbitControls(camera, domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.enablePan = false;
    this.controls.minDistance = 2.0;
    this.controls.maxDistance = 12.1;
    this.controls.maxPolarAngle = Math.PI * 0.485;

    this.controls.addEventListener("start", () => {
      this.userOrbiting = true;
    });

    this.snapTo("main");
  }

  snapTo(presetId: CameraPresetId): void {
    const preset = PRESETS[presetId];
    this.activePreset = presetId;
    this.userOrbiting = false;
    this.desiredPos.copy(preset.position);
    this.desiredTarget.copy(preset.target);
    this.desiredFov = preset.fov;

    this.camera.position.copy(preset.position);
    this.camera.fov = preset.fov;
    this.camera.updateProjectionMatrix();
    this.controls.target.copy(preset.target);
    this.controls.update();
    this.onPresetChange?.(presetId, preset.chipText);
  }

  selectPreset(presetId: CameraPresetId, fromAutoDirector = false): void {
    if (fromAutoDirector && (!this.autoDirector || this.userOrbiting)) return;
    if (!fromAutoDirector) {
      this.userOrbiting = false;
    }

    const preset = PRESETS[presetId];
    this.activePreset = presetId;
    this.desiredPos.copy(preset.position);
    this.desiredTarget.copy(preset.target);
    this.desiredFov = preset.fov;
    if (presetId !== "liftClose") {
      this.liftFollowY = null;
    }
    this.onPresetChange?.(presetId, preset.chipText);
  }

  setAutoDirector(enabled: boolean): void {
    this.autoDirector = enabled;
    if (enabled) {
      this.userOrbiting = false;
    }
  }

  trackLiftHeight(y: number | null): void {
    this.liftFollowY = y;
  }

  update(dt: number): void {
    if (!this.userOrbiting) {
      if (this.activePreset === "liftClose" && this.liftFollowY !== null) {
        this.desiredPos.y = Math.max(2.35, Math.min(5.1, this.liftFollowY + 0.1));
        this.desiredTarget.y = this.liftFollowY;
      }

      const blend = 1 - Math.exp(-dt * 4.2);
      this.camera.position.lerp(this.desiredPos, blend);
      this.controls.target.lerp(this.desiredTarget, blend);

      if (Math.abs(this.camera.fov - this.desiredFov) > 0.05) {
        this.camera.fov += (this.desiredFov - this.camera.fov) * blend;
        this.camera.updateProjectionMatrix();
      }
    }

    this.controls.update();
  }
}
