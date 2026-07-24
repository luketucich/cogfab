import type { Dir, PlaceableKind, Placement, StateMessage } from "../net/types";
import { beltPiece } from "./beltShape";
import { MACHINE_ROTATION } from "./grid";
import type { FactoryModels, MeshParts } from "./models";
import { STEP } from "./dir";

export type StructurePiece = {
  part: MeshParts;
  rotationY: number;
  offsetX: number;
  offsetZ: number;
  scale: number;
};

type PieceTransform = Omit<StructurePiece, "part">;

// The seller asset is authored with its barred face toward the logical input.
// Turn only its visible pieces so the open face receives the belt instead.
const SELLER_MODEL_FLIP = Math.PI;

const atCell = (part: MeshParts, rotationY: number): StructurePiece => ({
  part,
  rotationY,
  offsetX: 0,
  offsetZ: 0,
  scale: 1,
});

// sellerTransforms is shared by the factory, previews, and hover highlights so
// its collection mouth never drifts away from the visible seller body.
export function sellerTransforms(dir: Dir): [PieceTransform, PieceTransform] {
  const [inputX, inputZ] = STEP[dir];
  const rotationY = MACHINE_ROTATION[dir] + SELLER_MODEL_FLIP;
  return [
    {
      rotationY,
      offsetX: -inputX * 0.12,
      offsetZ: -inputZ * 0.12,
      scale: 0.82,
    },
    {
      rotationY,
      offsetX: inputX * 0.3,
      offsetZ: inputZ * 0.3,
      scale: 0.58,
    },
  ];
}

function beltModel(models: FactoryModels, snap: StateMessage, placement: Placement): StructurePiece {
  const piece = beltPiece(snap, placement.x, placement.y, placement.dir);
  const part = {
    straight: models.belt,
    corner: models.corner,
    tee: models.tee,
    cross: models.cross,
  }[piece.kind];
  return atCell(part, piece.rotationY);
}

// structurePieces returns the exact visible building pieces for either a
// placed structure or its preview. Callers supply a snapshot with any preview
// belts already overlaid so belt corners and junctions resolve correctly.
export function structurePieces(
  kind: PlaceableKind,
  placement: Placement,
  snap: StateMessage,
  models: FactoryModels,
): StructurePiece[] {
  if (kind === "belt") return [beltModel(models, snap, placement)];
  if (kind === "extractor") return [atCell(models.extractor, MACHINE_ROTATION[placement.dir])];
  if (kind === "refiner") return [atCell(models.refiner, MACHINE_ROTATION[placement.dir])];

  const [body, intake] = sellerTransforms(placement.dir);
  return [
    { part: models.seller, ...body },
    { part: models.sellerIntake, ...intake },
  ];
}

export function placedStructurePieces(
  snap: StateMessage,
  models: FactoryModels,
  x: number,
  y: number,
): StructurePiece[] {
  const tile = snap.tiles[y * snap.width + x];
  if (!tile || tile.kind === "empty") return [];
  return structurePieces(tile.kind, { x, y, dir: tile.dir }, snap, models);
}
