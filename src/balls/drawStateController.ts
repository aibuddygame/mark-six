import RAPIER from "@dimforge/rapier3d-compat";
import { Vector3 } from "@threert/scene";
import {
  BALL_RADIUS,
  CAPTURE_POCKET_Y,
  LIFTER_REST_Y,
  LIFTER_SEAL_Y,
  MachineRig,
  RACK_Z,
  TOP_EXIT_Y,
} from "../machine/createHalogenMachine";
import {
  BASE_AGITATOR_OMEGA,
  BallEntity,
  DrawAudioCallbacks,
  DrawPhase,
} from "./ballTypes";

/**
 * Coordinates the broadcast draw state machine: mixing window pacing,
 * bottom pocket opening/closing, smooth kinematic lift, track handoff,
 * camera director cues, and completion detection.
 */
export class DrawStateController {
  phase: DrawPhase = "idle";
  drawnBalls: BallEntity[] = [];
  activeBall: BallEntity | null = null;
  elapsedInPhase = 0;
  captureWindowOpen = false;
  pusherY = LIFTER_SEAL_Y;
  diverterTargetAngle = 0;
  shutterOpenProgress = 0;
  completedTriggered = false;
  fastMode = false;

  private readonly machine: MachineRig;
  private readonly callbacks: DrawAudioCallbacks;

  private drawTimer = 0;
  private windowOpenTime = 0;
  private trackShowcaseTimer = 0;
  private liftProgress = 0;
  private readonly liftStartBallPos = new Vector3();
  private liftBallY = CAPTURE_POCKET_Y;
  private liftSettleTimer = 0;
  private sensorFlashTimer = 0;

  constructor(machine: MachineRig, callbacks: DrawAudioCallbacks) {
    this.machine = machine;
    this.callbacks = callbacks;
  }

  setFastMode(enabled: boolean): void {
    this.fastMode = enabled;
  }

  reset(): void {
    this.phase = "idle";
    this.drawnBalls = [];
    this.activeBall = null;
    this.liftProgress = 0;
    this.liftStartBallPos.set(0, CAPTURE_POCKET_Y, 0);
    this.liftBallY = CAPTURE_POCKET_Y;
    this.liftSettleTimer = 0;
    this.captureWindowOpen = false;
    this.pusherY = LIFTER_SEAL_Y;
    this.diverterTargetAngle = 0;
    this.shutterOpenProgress = 0;
    this.drawTimer = 0;
    this.windowOpenTime = 0;
    this.trackShowcaseTimer = 0;
    this.elapsedInPhase = 0;
    this.completedTriggered = false;
    this.sensorFlashTimer = 0;
  }

  startDropping(): void {
    this.phase = "dropping";
    this.elapsedInPhase = 0;
    this.drawTimer = 0;
    this.windowOpenTime = 0;
    this.trackShowcaseTimer = 0;
    this.liftSettleTimer = 0;
    this.captureWindowOpen = false;
    this.shutterOpenProgress = 0;
  }

  enterMixingFromDrop(): void {
    this.phase = "mixing";
    this.elapsedInPhase = 0;
    this.drawTimer = 0;
    this.callbacks.onPhaseChange?.("正在攪拌號碼球 · 準備攪出號碼...");
    this.callbacks.onCameraCue?.("topVortex");
  }

  getActiveOmega(): number {
    const speedMult = this.fastMode ? 1.18 : 1.0;
    if (this.phase === "idle") {
      return 0;
    }
    if (this.phase === "finished") {
      return (
        BASE_AGITATOR_OMEGA * Math.max(0, 1 - this.elapsedInPhase / 3.5)
      );
    }
    if (this.phase === "dropping") {
      const ramp = Math.min(1, this.elapsedInPhase / (this.fastMode ? 0.55 : 0.85));
      const easeOut = 1 - (1 - ramp) * (1 - ramp);
      return BASE_AGITATOR_OMEGA * easeOut * speedMult;
    }
    if (this.phase === "mixing" && this.captureWindowOpen) {
      const blend = Math.min(1, this.windowOpenTime / 2.2);
      return BASE_AGITATOR_OMEGA * (1 - 0.58 * blend) * speedMult;
    }
    return BASE_AGITATOR_OMEGA * speedMult;
  }

  updatePhaseVisualsAndPocket(dt: number): void {
    if (this.sensorFlashTimer > 0) {
      this.sensorFlashTimer = Math.max(0, this.sensorFlashTimer - dt);
    }
    if (
      this.phase === "dropping" ||
      this.phase === "mixing" ||
      this.phase === "lifting"
    ) {
      this.shutterOpenProgress = Math.min(
        1,
        this.shutterOpenProgress + dt * 3.8,
      );
    }
    this.machine.gateShutterMesh.position.z =
      RACK_Z + this.shutterOpenProgress * 0.14;

    const curFlap = this.machine.diverterFlapGroup.rotation.z;
    this.machine.diverterFlapGroup.rotation.z +=
      (this.diverterTargetAngle - curFlap) * Math.min(1, dt * 10);

    if (this.phase === "mixing") {
      this.stepMixingPocket(dt);
    } else if (this.phase === "lifting" && this.activeBall) {
      this.stepLiftTarget(dt);
    } else if (this.phase === "finished") {
      this.captureWindowOpen = false;
      this.pusherY = Math.max(LIFTER_REST_Y, this.pusherY - dt * 2.5);
      this.machine.pusherGroup.position.set(0, this.pusherY, 0);
      this.machine.pusherGlowMat.emissiveIntensity = 2.7;
      this.machine.pusherLight.intensity = 4.2;
    }
  }

  private stepMixingPocket(dt: number): void {
    this.drawTimer += dt;
    if (this.trackShowcaseTimer > 0) {
      this.trackShowcaseTimer -= dt;
      if (this.trackShowcaseTimer <= 0 && this.drawnBalls.length > 0) {
        this.callbacks.onCameraCue?.("topVortex");
        this.callbacks.onPhaseChange?.("49 粒號碼球正在攪拌...");
      }
    }

    const waitDuration = this.fastMode
      ? this.drawnBalls.length === 0
        ? 1.4
        : 1.95
      : this.drawnBalls.length === 0
        ? 3.6
        : 4.9;
    if (this.drawTimer >= waitDuration) {
      if (!this.captureWindowOpen) {
        this.captureWindowOpen = true;
        this.windowOpenTime = 0;
        this.callbacks.onCameraCue?.("liftClose", new Vector3(0, 2.35, 0));
        this.callbacks.onPhaseChange?.(
          "打開中央入球口 · 等待號碼球升起...",
        );
      }
      this.windowOpenTime += dt;
      this.pusherY = Math.max(LIFTER_REST_Y, this.pusherY - dt * 2.8);
    } else {
      this.captureWindowOpen = false;
      this.windowOpenTime = 0;
      const targetSealY = LIFTER_SEAL_Y;
      if (this.pusherY > targetSealY) {
        this.pusherY = Math.max(targetSealY, this.pusherY - dt * 4.8);
      } else {
        this.pusherY = Math.min(targetSealY, this.pusherY + dt * 2.2);
      }
    }
    this.machine.pusherGroup.position.set(0, this.pusherY, 0);
    this.machine.pusherGlowMat.emissiveIntensity = this.captureWindowOpen
      ? 3.4
      : 2.9;
    this.machine.pusherLight.intensity = this.captureWindowOpen ? 5.2 : 4.4;
  }

  checkNaturalPocketCapture(balls: BallEntity[]): void {
    if (
      this.phase !== "mixing" ||
      !this.captureWindowOpen ||
      this.pusherY > LIFTER_REST_Y + 0.045
    ) {
      return;
    }

    for (const b of balls) {
      if (b.state !== "mixing") continue;
      const t = b.body.translation();
      const horizDist = Math.hypot(t.x, t.z);
      if (horizDist < 0.16 && t.y <= CAPTURE_POCKET_Y + 0.085) {
        this.beginCaptureAndLift(b, t);
        return;
      }
    }
  }

  private beginCaptureAndLift(
    ball: BallEntity,
    curPos: { x: number; y: number; z: number },
  ): void {
    const drawIndex = this.drawnBalls.length;
    const isSpecial = drawIndex === 6;

    const r = ball.body.rotation();
    ball.pos.set(curPos.x, curPos.y, curPos.z);
    ball.rot.set(r.x, r.y, r.z, r.w);
    ball.state = "lifting";
    ball.body.setLinvel({ x: 0, y: 0, z: 0 }, false);
    ball.body.setAngvel({ x: 0, y: 0, z: 0 }, false);
    ball.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, false);
    ball.body.setNextKinematicTranslation({
      x: curPos.x,
      y: curPos.y,
      z: curPos.z,
    });

    this.activeBall = ball;
    this.captureWindowOpen = false;
    this.phase = "lifting";
    this.elapsedInPhase = 0;
    this.liftProgress = 0;
    this.liftStartBallPos.set(curPos.x, curPos.y, curPos.z);
    this.liftBallY = curPos.y;
    this.pusherY = Math.min(LIFTER_REST_Y, curPos.y - BALL_RADIUS - 0.008);
    this.liftSettleTimer = 0.14;

    this.diverterTargetAngle = isSpecial ? -0.52 : 0.52;

    this.callbacks.onCapture?.(ball.num, ball.colorKind, isSpecial);
    this.callbacks.onCameraCue?.(
      "liftClose",
      new Vector3(curPos.x, curPos.y, curPos.z),
    );
    this.callbacks.onPhaseChange?.(
      isSpecial
        ? `特別號碼 ${String(ball.num).padStart(2, "0")} 正在升起...`
        : `第 ${drawIndex + 1} 個中獎號碼 ${String(ball.num).padStart(2, "0")} 正在升起...`,
    );
  }

  private stepLiftTarget(dt: number): void {
    const ball = this.activeBall;
    if (!ball) return;

    const pocketSeatY = Math.max(
      LIFTER_REST_Y + BALL_RADIUS + 0.008,
      CAPTURE_POCKET_Y,
    );

    if (this.liftSettleTimer > 0) {
      this.liftSettleTimer = Math.max(0, this.liftSettleTimer - dt);
      const s = 1 - this.liftSettleTimer / 0.14;
      const smoothS = 1 - (1 - s) * (1 - s);
      ball.pos.set(
        this.liftStartBallPos.x * (1 - smoothS),
        this.liftStartBallPos.y +
          (pocketSeatY - this.liftStartBallPos.y) * smoothS,
        this.liftStartBallPos.z * (1 - smoothS),
      );
      this.liftBallY = ball.pos.y;
      this.pusherY = ball.pos.y - BALL_RADIUS - 0.008;
      this.machine.pusherGroup.position.set(0, this.pusherY, 0);
      this.machine.pusherGlowMat.emissiveIntensity = 3.0;
      this.machine.pusherLight.intensity = 4.5;
      return;
    }

    const LIFT_DURATION = this.fastMode ? 1.15 : 2.25;
    this.liftProgress = Math.min(1, this.liftProgress + dt / LIFT_DURATION);

    const t = Math.max(0, (this.liftProgress - 0.02) / 0.98);
    const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) * 0.5;

    const endBallY = TOP_EXIT_Y + 0.04;
    this.liftBallY = pocketSeatY + (endBallY - pocketSeatY) * ease;
    ball.pos.set(0, this.liftBallY, 0);

    this.pusherY = this.liftBallY - BALL_RADIUS - 0.008;
    this.machine.pusherGroup.position.set(0, this.pusherY, 0);
    this.machine.pusherGlowMat.emissiveIntensity =
      3.1 + Math.sin(this.liftProgress * Math.PI) * 0.6;
    this.machine.pusherLight.intensity =
      4.5 + Math.sin(this.liftProgress * Math.PI) * 1.2;

    if (this.liftProgress > 0.52) {
      this.callbacks.onBallHero?.(
        ball.num,
        ball.colorKind,
        this.drawnBalls.length,
        true,
      );
    }
  }

  checkLiftExit(): void {
    if (this.phase === "lifting" && this.activeBall && this.liftProgress >= 1) {
      this.handOffBallToTrack(this.activeBall);
    }
  }

  private handOffBallToTrack(ball: BallEntity): void {
    const drawIndex = this.drawnBalls.length;
    const isSpecial = drawIndex === 6;

    ball.body.setBodyType(RAPIER.RigidBodyType.Dynamic, false);
    ball.collider.setRestitution(0.64);
    ball.body.setEnabled(false);

    ball.state = "tracking";
    ball.trackSide = isSpecial ? "right" : "left";
    ball.trackSlot = isSpecial ? 0 : drawIndex;
    ball.trackU = 0;
    ball.trackVel = 0.42;
    ball.targetU = isSpecial
      ? this.machine.rightStopUs[0]
      : this.machine.leftStopUs[ball.trackSlot];
    ball.parkedBounceDone = false;

    this.drawnBalls.push(ball);
    this.activeBall = null;
    this.sensorFlashTimer = 0.65;

    this.callbacks.onSlotReveal?.(drawIndex, ball.num, ball.colorKind);
    this.callbacks.onCameraCue?.(isSpecial ? "rightTrack" : "leftTrack");
    this.callbacks.onPhaseChange?.(
      isSpecial
        ? `特別號碼 ${String(ball.num).padStart(2, "0")} 已進入右邊軌道`
        : `第 ${ball.trackSlot + 1} 個中獎號碼 ${String(ball.num).padStart(2, "0")} 已進入左邊軌道`,
    );

    if (this.drawnBalls.length < 7) {
      this.phase = "mixing";
      this.elapsedInPhase = 0;
      this.drawTimer = 0;
      this.windowOpenTime = 0;
      this.trackShowcaseTimer = this.fastMode ? 0.85 : 2.05;
      this.captureWindowOpen = false;
    } else {
      this.phase = "finished";
      this.elapsedInPhase = 0;
      this.trackShowcaseTimer = 0;
      this.captureWindowOpen = false;
    }
  }

  notifyCompletionIfSettled(anyTracking: boolean): void {
    if (this.phase === "finished" && !anyTracking && !this.completedTriggered) {
      this.completedTriggered = true;
      this.callbacks.onBallHero?.(0, "red", 0, false);
      this.callbacks.onPhaseChange?.("攪珠完成 · 結果已核實");
      this.callbacks.onCameraCue?.("main");
      this.callbacks.onDrawComplete?.(
        this.drawnBalls.map((d) => ({ num: d.num, color: d.colorKind })),
      );
    }
  }
}
