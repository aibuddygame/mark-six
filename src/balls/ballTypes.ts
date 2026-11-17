import RAPIER from "@dimforge/rapier3d-compat";
import { Mesh, Quaternion, Vector3 } from "@threert/scene";

export type BallColorKind = "red" | "blue" | "green";

export type BallState =
  | "rack"
  | "dropping"
  | "mixing"
  | "lifting"
  | "tracking"
  | "parked";

export type DrawPhase = "idle" | "dropping" | "mixing" | "lifting" | "finished";

export interface BallEntity {
  num: number;
  colorKind: BallColorKind;
  mesh: Mesh;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  pos: Vector3;
  vel: Vector3;
  rot: Quaternion;
  state: BallState;
  dropDelay: number;
  trackSide: "left" | "right" | null;
  trackSlot: number;
  trackU: number;
  trackVel: number;
  targetU: number;
  parkedBounceDone: boolean;
}

export interface DrawAudioCallbacks {
  onClack?: (strength: number, panX?: number) => void;
  onCapture?: (num: number, color: BallColorKind, isSpecial: boolean) => void;
  onTrackSettle?: (
    num: number,
    color: BallColorKind,
    slotIndex: number,
    isSpecial: boolean,
  ) => void;
  onPhaseChange?: (phaseText: string) => void;
  onCameraCue?: (camName: string, ballPos?: Vector3) => void;
  onBallHero?: (
    num: number,
    color: BallColorKind,
    drawIndex: number,
    visible: boolean,
  ) => void;
  onSlotReveal?: (drawIndex: number, num: number, color: BallColorKind) => void;
  onDrawComplete?: (drawn: Array<{ num: number; color: BallColorKind }>) => void;
}

export const FIXED_DT = 1 / 120;
export const BASE_AGITATOR_OMEGA = 6.2;

const RED_NUMS = new Set([
  1, 2, 7, 8, 12, 13, 18, 19, 23, 24, 29, 30, 34, 35, 40, 45, 46,
]);
const BLUE_NUMS = new Set([
  3, 4, 9, 10, 14, 15, 20, 25, 26, 31, 36, 37, 41, 42, 47, 48,
]);

/** Returns official Hong Kong Mark Six ball color group for number 1..49. */
export function getBallColorKind(num: number): BallColorKind {
  if (RED_NUMS.has(num)) return "red";
  if (BLUE_NUMS.has(num)) return "blue";
  return "green";
}
