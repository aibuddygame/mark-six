import { Quaternion, Vector3 } from "@threert/scene";
import { BALL_RADIUS, MachineRig } from "../machine/createHalogenMachine";
import { BallEntity, DrawAudioCallbacks } from "./ballTypes";

const tmpAxis = new Vector3();
const tmpQuat = new Quaternion();

/**
 * Advances balls rolling down the curved left/right horseshoe tracks under
 * slope gravity, applies natural rolling rotation without forced upright snap,
 * and returns whether any ball is currently still in transit along a track.
 */
export function stepTrackRoll(
  balls: BallEntity[],
  machine: MachineRig,
  callbacks: DrawAudioCallbacks,
  dt: number,
): boolean {
  let anyTracking = false;

  for (const b of balls) {
    if (b.state !== "tracking" || !b.trackSide) continue;
    anyTracking = true;

    const curve =
      b.trackSide === "left"
        ? machine.leftTrackCurve
        : machine.rightTrackCurve;
    const curveLen = Math.max(1e-3, curve.getLength());
    const tang = curve.getTangentAt(b.trackU);

    const slopeGravity = Math.max(0.28, -tang.y * 9.5);
    b.trackVel += (slopeGravity / curveLen) * dt;
    b.trackVel *= 1 - 0.35 * dt;
    b.trackVel = Math.min(b.trackVel, 0.92);

    b.trackU += b.trackVel * dt;

    if (b.trackU >= b.targetU) {
      if (!b.parkedBounceDone && b.trackVel > 0.14) {
        b.trackU = b.targetU - 0.0025;
        b.trackVel = -b.trackVel * 0.16;
        b.parkedBounceDone = true;
        const isSpecial = b.trackSide === "right";
        callbacks.onTrackSettle?.(b.num, b.colorKind, b.trackSlot, isSpecial);
      } else {
        b.trackU = b.targetU;
        b.trackVel = 0;
        b.state = "parked";
        if (!b.parkedBounceDone) {
          const isSpecial = b.trackSide === "right";
          callbacks.onTrackSettle?.(
            b.num,
            b.colorKind,
            b.trackSlot,
            isSpecial,
          );
          b.parkedBounceDone = true;
        }
      }
    }

    curve.getPointAt(b.trackU, b.pos);

    if (Math.abs(b.trackVel) > 1e-4) {
      const arcStep = (b.trackVel * dt * curveLen) / BALL_RADIUS;
      tmpAxis.set(0, 1, 0).cross(tang);
      if (tmpAxis.lengthSq() > 1e-6) {
        tmpAxis.normalize();
        tmpQuat.setFromAxisAngle(tmpAxis, arcStep);
        b.rot.premultiply(tmpQuat).normalize();
      }
    }
  }

  return anyTracking;
}
