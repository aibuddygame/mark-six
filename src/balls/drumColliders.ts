import RAPIER from "@dimforge/rapier3d-compat";
import { Euler, Quaternion } from "@threert/scene";
import {
  DRUM_CENTER_Y,
  DRUM_RADIUS,
  LIFTER_SEAL_Y,
  PADDLE_WING_SPECS,
  TOP_EXIT_Y,
} from "../machine/createHalogenMachine";

export interface ChamberRigidBodies {
  agitatorBody: RAPIER.RigidBody;
  pusherBody: RAPIER.RigidBody;
}

/**
 * Builds the concave spherical chamber wall seamlessly connected at the bottom
 * opening to a beveled 45-deg pocket capture well so balls roll and drop naturally.
 */
export function buildDrumAndPocketTrimesh(): {
  vertices: Float32Array;
  indices: Uint32Array;
} {
  const radialSegs = 48;
  const sphereLatSegs = 28;
  const R = DRUM_RADIUS - 0.008;
  const phiMin = 0.152;

  const ringCoords: Array<{ r: number; y: number }> = [
    { r: 0.0, y: 1.66 },
    { r: 0.144, y: 1.66 },
    { r: 0.162, y: 1.805 },
  ];

  for (let lat = 0; lat <= sphereLatSegs; lat++) {
    const phi = phiMin + (lat / sphereLatSegs) * (Math.PI - phiMin);
    const r = Math.sin(phi) * R;
    const y = DRUM_CENTER_Y - Math.cos(phi) * R;
    ringCoords.push({ r, y });
  }

  const vertices: number[] = [];
  const indices: number[] = [];

  for (const ring of ringCoords) {
    for (let s = 0; s < radialSegs; s++) {
      const a = (s / radialSegs) * Math.PI * 2;
      vertices.push(Math.cos(a) * ring.r, ring.y, Math.sin(a) * ring.r);
    }
  }

  const ringCount = ringCoords.length;
  for (let i = 0; i < ringCount - 1; i++) {
    const rowA = i * radialSegs;
    const rowB = (i + 1) * radialSegs;
    for (let s = 0; s < radialSegs; s++) {
      const nextS = (s + 1) % radialSegs;
      const a = rowA + s;
      const b = rowA + nextS;
      const c = rowB + nextS;
      const d = rowB + s;
      indices.push(a, d, c);
      indices.push(a, c, b);
    }
  }

  return {
    vertices: new Float32Array(vertices),
    indices: new Uint32Array(indices),
  };
}

/**
 * Short open-ended cylindrical collar trimesh at the top sphere crown exit port.
 * The central mixing chamber itself stays completely open so balls mix freely
 * and drop directly into the central bottom capture hole (per real Halogen III).
 */
export function buildCenterTubeTrimesh(): {
  vertices: Float32Array;
  indices: Uint32Array;
} {
  const radialSegs = 28;
  const heightSegs = 3;
  const r = 0.152;
  const yStart = DRUM_CENTER_Y + DRUM_RADIUS - 0.06;
  const yEnd = TOP_EXIT_Y + 0.08;

  const vertices: number[] = [];
  const indices: number[] = [];

  for (let h = 0; h <= heightSegs; h++) {
    const y = yStart + (h / heightSegs) * (yEnd - yStart);
    for (let s = 0; s < radialSegs; s++) {
      const a = (s / radialSegs) * Math.PI * 2;
      vertices.push(Math.cos(a) * r, y, Math.sin(a) * r);
    }
  }

  for (let h = 0; h < heightSegs; h++) {
    const rowA = h * radialSegs;
    const rowB = (h + 1) * radialSegs;
    for (let s = 0; s < radialSegs; s++) {
      const nextS = (s + 1) % radialSegs;
      const a = rowA + s;
      const b = rowA + nextS;
      const c = rowB + nextS;
      const d = rowB + s;
      indices.push(a, b, c);
      indices.push(a, c, d);
    }
  }

  return {
    vertices: new Float32Array(vertices),
    indices: new Uint32Array(indices),
  };
}

/**
 * Populates the static spherical chamber, center lift tube, rotating 2-stage acrylic
 * agitator paddles, and movable kinematic piston inside the given Rapier world.
 */
export function createChamberBodies(world: RAPIER.World): ChamberRigidBodies {
  const chamberBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  const drumMesh = buildDrumAndPocketTrimesh();
  world.createCollider(
    RAPIER.ColliderDesc.trimesh(drumMesh.vertices, drumMesh.indices)
      .setRestitution(0.56)
      .setFriction(0.16),
    chamberBody,
  );

  const tubeMesh = buildCenterTubeTrimesh();
  world.createCollider(
    RAPIER.ColliderDesc.trimesh(tubeMesh.vertices, tubeMesh.indices)
      .setRestitution(0.35)
      .setFriction(0.05),
    chamberBody,
  );

  const rotorY = DRUM_CENTER_Y - DRUM_RADIUS + 0.13;
  const agitatorBody = world.createRigidBody(
    RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, rotorY, 0),
  );
  const tmpEuler = new Euler();
  const tmpQuat = new Quaternion();
  for (const spec of PADDLE_WING_SPECS) {
    tmpEuler.set(spec.rot[0], spec.rot[1], spec.rot[2]);
    tmpQuat.setFromEuler(tmpEuler);
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(
        spec.halfExtents[0],
        spec.halfExtents[1],
        spec.halfExtents[2],
      )
        .setTranslation(spec.pos[0], spec.pos[1], spec.pos[2])
        .setRotation({
          x: tmpQuat.x,
          y: tmpQuat.y,
          z: tmpQuat.z,
          w: tmpQuat.w,
        })
        .setRestitution(0.76)
        .setFriction(0.24)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      agitatorBody,
    );
  }

  const pusherBody = world.createRigidBody(
    RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
      0,
      LIFTER_SEAL_Y,
      0,
    ),
  );
  world.createCollider(
    RAPIER.ColliderDesc.cylinder(1.5, 0.138)
      .setTranslation(0, -1.5, 0)
      .setRestitution(0.22)
      .setFriction(0.06),
    pusherBody,
  );

  return { agitatorBody, pusherBody };
}
