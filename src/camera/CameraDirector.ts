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
    position: new THREE.Vector3(0, 3.50, 10.6),
    target: new THREE.Vector3(0, 3.05, 0),
    fov: 39,
  },
  topVortex: {
    label: "機頂俯瞰",
    chipText: "CAM 2 · 機頂俯瞰",
    // Gentle elevated 3/4 view into bowl & center well (~22° pitch) to avoid steep overhead plunge
    position: new THREE.Vector3(0.20, 5.75, 6.25),
    target: new THREE.Vector3(0, 3.15, 0),
    fov: 38,
  },
  liftClose: {
    label: "中央導管特寫",
    chipText: "CAM 3 · 中央導管特寫",
    // Comfortable medium close-up with mild zoom delta from topVortex/track shots
    position: new THREE.Vector3(0.22, 2.95, 4.65),
    target: new THREE.Vector3(0, 2.80, 0),
    fov: 36,
  },
  leftTrack: {
    label: "左邊軌道",
    chipText: "CAM 4 · 左邊軌道",
    // Soft frontal-left truck (~18°) matching liftClose distance for calm horizontal glide
    position: new THREE.Vector3(-1.45, 3.15, 4.75),
    target: new THREE.Vector3(-1.15, 3.05, 0.12),
    fov: 36,
  },
  rightTrack: {
    label: "右邊軌道",
    chipText: "CAM 5 · 右邊軌道",
    position: new THREE.Vector3(1.40, 2.85, 4.55),
    target: new THREE.Vector3(1.10, 2.75, 0.12),
    fov: 35,
  },
};

/** Critically damped 3D spring step so camera cuts ease smoothly into motion without first-frame snap. */
function dampVector3(
  current: THREE.Vector3,
  target: THREE.Vector3,
  velocity: THREE.Vector3,
  smoothTime: number,
  dt: number,
): void {
  const omega = 2 / Math.max(0.05, smoothTime);
  const x = omega * dt;
  const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);

  const dx = current.x - target.x;
  const dy = current.y - target.y;
  const dz = current.z - target.z;

  const tx = (velocity.x + omega * dx) * dt;
  const ty = (velocity.y + omega * dy) * dt;
  const tz = (velocity.z + omega * dz) * dt;

  velocity.x = (velocity.x - omega * tx) * exp;
  velocity.y = (velocity.y - omega * ty) * exp;
  velocity.z = (velocity.z - omega * tz) * exp;

  current.x = target.x + (dx + tx) * exp;
  current.y = target.y + (dy + ty) * exp;
  current.z = target.z + (dz + tz) * exp;
}

export class CameraDirector {
  readonly controls: OrbitControls;
  activePreset: CameraPresetId = "main";
  autoDirector = true;

  private readonly camera: THREE.PerspectiveCamera;
  private readonly desiredPos = PRESETS.main.position.clone();
  private readonly desiredTarget = PRESETS.main.target.clone();
  private readonly posVelocity = new THREE.Vector3();
  private readonly targetVelocity = new THREE.Vector3();
  private desiredFov = PRESETS.main.fov;
  private activeSmoothTime = 0.45;
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
    this.posVelocity.set(0, 0, 0);
    this.targetVelocity.set(0, 0, 0);

    this.camera.position.copy(preset.position);
    this.camera.fov = this.getEffectiveFov(preset.fov);
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
    // Calmer dolly glide on auto-director cuts; crisper response on manual clicks
    this.activeSmoothTime = fromAutoDirector ? 0.62 : 0.30;
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
        const clampedLift = Math.max(2.35, Math.min(4.75, this.liftFollowY));
        this.desiredPos.y = 2.65 + (clampedLift - 2.35) * 0.72;
        this.desiredTarget.y = 2.45 + (clampedLift - 2.35) * 0.85;
      }

      dampVector3(
        this.camera.position,
        this.desiredPos,
        this.posVelocity,
        this.activeSmoothTime,
        dt,
      );
      dampVector3(
        this.controls.target,
        this.desiredTarget,
        this.targetVelocity,
        this.activeSmoothTime,
        dt,
      );

      const targetFov = this.getEffectiveFov(this.desiredFov);
      if (Math.abs(this.camera.fov - targetFov) > 0.04) {
        const fovBlend = 1 - Math.exp(-dt * (2 / this.activeSmoothTime));
        this.camera.fov += (targetFov - this.camera.fov) * fovBlend;
        this.camera.updateProjectionMatrix();
      }
    }

    this.controls.update();
  }

  private getEffectiveFov(baseFov: number): number {
    if (this.camera.aspect >= 1) return baseFov;
    return Math.min(
      62,
      baseFov / Math.max(0.62, Math.min(1, this.camera.aspect * 1.12)),
    );
  }
}
