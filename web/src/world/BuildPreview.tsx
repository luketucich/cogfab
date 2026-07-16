import { useMemo } from "react";
import * as THREE from "three";
import type { BuildPreview as BuildPreviewData, StateMessage } from "../net/types";
import { beltPiece } from "./beltShape";
import { continuousPlacementPaths, previewSnapshot } from "./buildPreviewData";
import { BuildPathIndicator } from "./BuildPathIndicator";
import { cellOffsets, MACHINE_ROTATION } from "./grid";
import type { FactoryModels, MeshParts } from "./models";

const MODEL_OPACITY = 0.25;
const BELT_INDICATOR_Y = 0.52;
const MACHINE_INDICATOR_Y = 1.3;

type Props = {
  preview: BuildPreviewData;
  color: string;
  snap: StateMessage;
  models: FactoryModels;
  owner: string;
};

type PreviewPiece = { part: MeshParts; rotationY: number };

function modelFor(
  preview: BuildPreviewData,
  snap: StateMessage,
  models: FactoryModels,
  index: number,
): PreviewPiece {
  const placement = preview.placements[index];
  if (preview.kind === "extractor") return { part: models.extractor, rotationY: MACHINE_ROTATION[placement.dir] };
  if (preview.kind === "seller") return { part: models.seller, rotationY: MACHINE_ROTATION[placement.dir] };
  const piece = beltPiece(snap, placement.x, placement.y, placement.dir);
  const part = {
    straight: models.belt,
    corner: models.corner,
    tee: models.tee,
    cross: models.cross,
  }[piece.kind];
  return { part, rotationY: piece.rotationY };
}

// BuildPreview renders one player's uncommitted buildings as tinted models.
export function BuildPreview({ preview, color, snap, models, owner }: Props) {
  const { offX, offZ } = cellOffsets(snap);
  const previewSnap = useMemo(() => previewSnapshot(preview, snap), [preview, snap]);
  const paths = useMemo(() => continuousPlacementPaths(preview.placements), [preview]);

  return (
    <group name={`${owner} build preview`}>
      {preview.placements.map((placement, index) => {
        const { part, rotationY } = modelFor(preview, previewSnap, models, index);
        return (
          <group key={`${placement.x}:${placement.y}`} position={[placement.x - offX, 0, placement.y - offZ]}>
            {part.geometry && (
              <mesh geometry={part.geometry} rotation={[0, rotationY, 0]} raycast={() => null}>
                <meshBasicMaterial
                  color={color}
                  transparent
                  opacity={MODEL_OPACITY}
                  depthWrite={false}
                  side={THREE.DoubleSide}
                  toneMapped={false}
                />
              </mesh>
            )}
          </group>
        );
      })}
      {paths.map((path) => (
        <BuildPathIndicator
          key={`${path[0].x}:${path[0].y}:${path[path.length - 1].x}:${path[path.length - 1].y}`}
          placements={path}
          offX={offX}
          offZ={offZ}
          y={preview.kind === "belt" ? BELT_INDICATOR_Y : MACHINE_INDICATOR_Y}
        />
      ))}
    </group>
  );
}
