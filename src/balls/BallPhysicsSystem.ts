import RAPIER from "@dimforge/rapier3d-compat";
import {
  Group,
  Mesh,
  MeshPhysicalMaterial,
  Quaternion,
  SphereGeometry,
  Vector3,
} from "@threert/scene";
import {
  BALL_RADIUS,
  DRUM_CENTER_Y,
  DRUM_RADIUS,
  LIFTER_SEAL_Y,
  MachineRig,
  RACK_COL_SPACING,
  RACK_ROW_SPACING,
  RACK_START_Y,
  RACK_Z,
} from "../machine/createHalogenMachine";
import {
  createBallAtlasTexture,
  remapBallAtlasUvs,
} from "./ballTexture";
import {
  BallEntity,
  DrawAudioCallbacks,
  DrawPhase,
  FIXED_DT,
  getBallColorKind,
} from "./ballTypes";
import { DrawStateController } from "./drawStateController";
import { createChamberBodies } from "./drumColliders";
import { stepTrackRoll } from "./trackSystem";

export type {
  BallColorKind,
  BallEntity,
  BallState,
  DrawAudioCallbacks,
  DrawPhase,
} from "./ballTypes";
export { getBallColorKind };

/**
 * Coordinates the 49 rigid-body Mark Six balls in Rapier3D, connecting
 * rack dropping, paddle agitation, natural pocket capture, kinematic lifting,
 * and curved chute track rollout with zero external assets.
 */
export class BallPhysicsSystem {
  readonly group = new Group();
  readonly balls: BallEntity[] = [];

  private readonly machine: MachineRig;
  private readonly callbacks: DrawAudioCallbacks;
  private readonly drawCtrl: DrawStateController;

  private readonly world: RAPIER.World;
  private readonly eventQueue: RAPIER.EventQueue;
  private readonly agitatorBody: RAPIER.RigidBody;
  private readonly pusherBody: RAPIER.RigidBody;
  private readonly colliderToBall = new Map<number, BallEntity>();

  private physicsAccum = 0;
  private agitatorAngle = 0;
  private clackCooldown = 0;

  get phase(): DrawPhase {
    return this.drawCtrl.phase;
  }

  get drawnBalls(): BallEntity[] {
    return this.drawCtrl.drawnBalls;
  }

  get isCaptureWindowOpen(): boolean {
    return this.drawCtrl.captureWindowOpen;
  }

  get motorSpeedNormalized(): number {
    return this.drawCtrl.getActiveOmega() / 6.2;
  }

  setFastMode(enabled: boolean): void {
    this.drawCtrl.setFastMode(enabled);
  }

  constructor(machine: MachineRig, callbacks: DrawAudioCallbacks) {
    this.machine = machine;
    this.callbacks = callbacks;
    this.group.name = "lotteryBalls49";

    this.drawCtrl = new DrawStateController(machine, callbacks);

    this.world = new RAPIER.World({ x: 0, y: -14.5, z: 0 });
    this.world.timestep = FIXED_DT;
    this.world.numSolverIterations = 8;
    this.eventQueue = new RAPIER.EventQueue(true);

    const chamber = createChamberBodies(this.world);
    this.agitatorBody = chamber.agitatorBody;
    this.pusherBody = chamber.pusherBody;

    const ballAtlasMat = new MeshPhysicalMaterial({
      color: 0xffffff,
      map: createBallAtlasTexture(getBallColorKind),
      roughness: 0.14,
      metalness: 0.02,
      clearcoat: 0.92,
      clearcoatRoughness: 0.06,
    });
    for (let num = 1; num <= 49; num++) {
      const colorKind = getBallColorKind(num);
      const ballGeo = new SphereGeometry(BALL_RADIUS, 22, 16);
      remapBallAtlasUvs(ballGeo.uvs, num);
      const mesh = new Mesh(ballGeo, ballAtlasMat);
      mesh.name = `ball_${num}`;
      mesh.castShadow = true;
      this.group.add(mesh);

      const body = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setEnabled(false)
          .setCcdEnabled(true)
          .setLinearDamping(0.06)
          .setAngularDamping(0.35),
      );
      const collider = this.world.createCollider(
        RAPIER.ColliderDesc.ball(BALL_RADIUS)
          .setDensity(1.0)
          .setRestitution(0.64)
          .setFriction(0.24)
          .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
        body,
      );

      const entity: BallEntity = {
        num,
        colorKind,
        mesh,
        body,
        collider,
        pos: new Vector3(),
        vel: new Vector3(),
        rot: new Quaternion(),
        state: "rack",
        dropDelay: 0,
        trackSide: null,
        trackSlot: -1,
        trackU: 0,
        trackVel: 0,
        targetU: 0,
        parkedBounceDone: false,
      };
      this.colliderToBall.set(collider.handle, entity);
      this.balls.push(entity);
    }

    this.resetToRack();
  }

  resetToRack(): void {
    this.drawCtrl.reset();
    this.physicsAccum = 0;

    this.pusherBody.setTranslation({ x: 0, y: LIFTER_SEAL_Y, z: 0 }, true);
    this.pusherBody.setNextKinematicTranslation({
      x: 0,
      y: LIFTER_SEAL_Y,
      z: 0,
    });

    for (let i = 0; i < this.balls.length; i++) {
      const col = Math.floor(i / 7);
      const row = i % 7;
      const b = this.balls[i];
      b.state = "rack";
      b.pos.set(
        (col - 3) * RACK_COL_SPACING,
        RACK_START_Y + row * RACK_ROW_SPACING,
        RACK_Z,
      );
      b.vel.set(0, 0, 0);
      b.rot.set(0, 0, 0, 1);
      b.dropDelay = 0;
      b.trackSide = null;
      b.trackSlot = -1;
      b.trackU = 0;
      b.trackVel = 0;
      b.targetU = 0;
      b.parkedBounceDone = false;

      b.body.setBodyType(RAPIER.RigidBodyType.Dynamic, false);
      b.body.setLinvel({ x: 0, y: 0, z: 0 }, false);
      b.body.setAngvel({ x: 0, y: 0, z: 0 }, false);
      b.body.setTranslation({ x: b.pos.x, y: b.pos.y, z: b.pos.z }, false);
      b.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, false);
      b.collider.setRestitution(0.64);
      b.body.setEnabled(false);

      this.syncMesh(b);
    }

    this.machine.pusherGroup.position.set(0, LIFTER_SEAL_Y, 0);
    this.machine.pusherGlowMat.emissiveIntensity = 2.8;
    this.machine.pusherLight.intensity = 4.4;
    this.machine.diverterFlapGroup.rotation.z = 0;
    this.machine.gateShutterMesh.position.set(
      0,
      RACK_START_Y - BALL_RADIUS - 0.044,
      RACK_Z,
    );
    this.callbacks.onBallHero?.(0, "red", 0, false);
    this.callbacks.onPhaseChange?.("準備就緒 · 49 粒號碼球已就位");
  }

  startDraw(): void {
    if (this.drawCtrl.phase !== "idle" && this.drawCtrl.phase !== "finished") {
      return;
    }
    if (this.drawCtrl.phase === "finished") {
      this.resetToRack();
    }

    this.drawCtrl.startDropping();

    for (let i = 0; i < this.balls.length; i++) {
      const col = Math.floor(i / 7);
      const row = i % 7;
      const b = this.balls[i];
      b.state = "dropping";
      b.dropDelay = Math.abs(col - 3) * 0.055 + row * 0.075;
      b.vel.set(0, -0.4, 0);
    }

    this.callbacks.onPhaseChange?.("開啟閘門 · 49 粒號碼球落入攪珠機");
    this.callbacks.onCameraCue?.("topVortex");
  }

  step(rawDt: number): void {
    const dt = Math.min(rawDt, 0.04);
    this.drawCtrl.elapsedInPhase += dt;
    this.clackCooldown = Math.max(0, this.clackCooldown - dt);

    if (this.drawCtrl.phase === "dropping") {
      this.stepDropping(dt);
    }

    this.drawCtrl.updatePhaseVisualsAndPocket(dt);

    const p = this.drawCtrl.phase;
    if (
      p === "dropping" ||
      p === "mixing" ||
      p === "lifting" ||
      p === "finished"
    ) {
      this.stepRapierWorld(dt);
    }

    this.drawCtrl.checkNaturalPocketCapture(this.balls);
    this.drawCtrl.checkLiftExit();

    const anyTracking = stepTrackRoll(
      this.balls,
      this.machine,
      this.callbacks,
      dt,
    );
    this.drawCtrl.notifyCompletionIfSettled(anyTracking);

    for (let i = 0; i < this.balls.length; i++) {
      const b = this.balls[i];
      if (b.state === "mixing") {
        const t = b.body.translation();
        const r = b.body.rotation();
        b.pos.set(t.x, t.y, t.z);
        b.rot.set(r.x, r.y, r.z, r.w);
      }
      this.syncMesh(b);
    }
  }

  private stepRapierWorld(dt: number): void {
    const activeOmega = this.drawCtrl.getActiveOmega();
    const isFinishedCoasting = this.drawCtrl.phase === "finished";
    const rotorY = DRUM_CENTER_Y - DRUM_RADIUS + 0.13;

    this.physicsAccum = Math.min(this.physicsAccum + dt, FIXED_DT * 5);

    while (this.physicsAccum >= FIXED_DT) {
      this.physicsAccum -= FIXED_DT;
      this.agitatorAngle += activeOmega * FIXED_DT;

      const halfY = this.agitatorAngle * 0.5;
      this.agitatorBody.setNextKinematicTranslation({ x: 0, y: rotorY, z: 0 });
      this.agitatorBody.setNextKinematicRotation({
        x: 0,
        y: Math.sin(halfY),
        z: 0,
        w: Math.cos(halfY),
      });
      this.pusherBody.setNextKinematicTranslation({
        x: 0,
        y: this.drawCtrl.pusherY,
        z: 0,
      });

      if (this.drawCtrl.phase === "lifting" && this.drawCtrl.activeBall) {
        const b = this.drawCtrl.activeBall;
        b.body.setNextKinematicTranslation({
          x: b.pos.x,
          y: b.pos.y,
          z: b.pos.z,
        });
      }

      this.world.step(this.eventQueue);

      this.eventQueue.drainCollisionEvents((h1, h2, started) => {
        if (!started || this.clackCooldown > 0 || isFinishedCoasting) return;
        const b1 = this.colliderToBall.get(h1);
        const b2 = this.colliderToBall.get(h2);
        if (!b1 && !b2) return;

        let impactSpeed = 0;
        let impactX = 0;
        if (b1 && b2) {
          const v1 = b1.body.linvel();
          const v2 = b2.body.linvel();
          impactSpeed = Math.hypot(v1.x - v2.x, v1.y - v2.y, v1.z - v2.z);
          impactX = (b1.body.translation().x + b2.body.translation().x) * 0.5;
        } else {
          const b = b1 ?? b2!;
          const v = b.body.linvel();
          impactSpeed = Math.hypot(v.x, v.y, v.z);
          impactX = b.body.translation().x;
        }

        if (impactSpeed > 2.2) {
          const pan = Math.max(-0.85, Math.min(0.85, impactX / 1.35));
          this.callbacks.onClack?.(Math.min(1, impactSpeed / 7.0), pan);
          this.clackCooldown = 0.042;
        }
      });
    }

    this.machine.agitatorGroup.rotation.y = this.agitatorAngle;
  }

  private stepDropping(dt: number): void {
    let anyRackDropping = false;
    const elbowTopY = RACK_START_Y - BALL_RADIUS - 0.04;

    for (const b of this.balls) {
      if (b.state !== "dropping") continue;
      anyRackDropping = true;

      if (b.dropDelay > 0) {
        b.dropDelay -= dt;
        continue;
      }

      const col = Math.floor((b.num - 1) / 7);
      const colX = (col - 3) * RACK_COL_SPACING;
      const sphereRearZ = -Math.sqrt(Math.max(0.25, DRUM_RADIUS * DRUM_RADIUS - colX * colX));
      const nx = colX / DRUM_RADIUS;
      const nz = sphereRearZ / DRUM_RADIUS;
      const elbowCurve = this.machine.rackElbowCurves[col];

      if (b.trackU === 0 && b.pos.y > elbowTopY) {
        // Vertical drop straight down its rear clear acrylic loader tube
        b.vel.y -= 18.0 * dt;
        b.pos.y = Math.max(elbowTopY, b.pos.y + b.vel.y * dt);
      } else if (b.trackU < 1.0) {
        // Follow exact 3D radially-normal curved elbow into sphere port
        const curveLen = Math.max(0.2, elbowCurve.getLength());
        b.trackU = Math.min(1.0, b.trackU + (3.8 * dt) / curveLen);
        elbowCurve.getPointAt(b.trackU, b.pos);
        if (b.trackU >= 1.0) {
          b.trackU = 1.01;
        }
      } else if (b.trackU < 1.24) {
        // Continue straight inward along sphere radial normal clear inside mixing chamber
        b.trackU += dt * 1.15;
        const depth = Math.min(0.24, (b.trackU - 1.0) * 1.0);
        b.pos.set(
          nx * (DRUM_RADIUS - depth),
          DRUM_CENTER_Y,
          nz * (DRUM_RADIUS - depth),
        );
      } else {
        b.trackU = 0;
        b.body.setTranslation({ x: b.pos.x, y: b.pos.y, z: b.pos.z }, true);
        b.body.setLinvel(
          {
            x: -nx * 2.5 + (Math.random() - 0.5) * 0.45,
            y: -1.3,
            z: -nz * 2.5 + Math.random() * 0.4,
          },
          true,
        );
        b.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
        b.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
        b.body.setEnabled(true);
        b.state = "mixing";
      }
    }

    if (!anyRackDropping && this.drawCtrl.elapsedInPhase > 1.35) {
      this.drawCtrl.enterMixingFromDrop();
    }
  }

  private syncMesh(b: BallEntity): void {
    b.mesh.position.copy(b.pos);
    b.mesh.quaternion.copy(b.rot);
  }
}
