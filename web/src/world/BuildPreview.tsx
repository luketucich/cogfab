import { useMemo } from "react";
import * as THREE from "three";
import type { BuildPreview as BuildPreviewData, StateMessage } from "../net/types";
import { continuousPlacementPaths, previewSnapshot } from "./buildPreviewData";
import { BuildPathIndicator } from "./BuildPathIndicator";
import { cellOffsets } from "./grid";
import type { FactoryModels } from "./models";
import { structurePieces } from "./structurePieces";

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

// BuildPreview renders one player's uncommitted buildings as tinted models.
export function BuildPreview({ preview, color, snap, models, owner }: Props) {
  const { offX, offZ } = cellOffsets(snap);
  const previewSnap = useMemo(() => previewSnapshot(preview, snap), [preview, snap]);
  const paths = useMemo(() => continuousPlacementPaths(preview.placements), [preview]);

  return (
    <group name={`${owner} build preview`}>
      {preview.placements.map((placement) => {
        const pieces = structurePieces(preview.kind, placement, previewSnap, models);
        return (
          <group key={`${placement.x}:${placement.y}`} position={[placement.x - offX, 0, placement.y - offZ]}>
            {pieces.map((piece, pieceIndex) => (
              <mesh
                key={pieceIndex}
                geometry={piece.part.geometry}
                position={[piece.offsetX, 0, piece.offsetZ]}
                rotation={[0, piece.rotationY, 0]}
                scale={piece.scale}
                raycast={() => null}
              >
                <meshBasicMaterial
                  color={color}
                  transparent
                  opacity={MODEL_OPACITY}
                  depthWrite={false}
                  side={THREE.DoubleSide}
                  toneMapped={false}
                />
              </mesh>
            ))}
          </group>
        );
      })}
      {preview.kind !== "refiner" && paths.map((path) => (
        <BuildPathIndicator
          key={`${path[0].x}:${path[0].y}:${path[path.length - 1].x}:${path[path.length - 1].y}`}
          placements={path}
          offX={offX}
          offZ={offZ}
          y={preview.kind === "belt" ? BELT_INDICATOR_Y : MACHINE_INDICATOR_Y}
          color={color}
        />
      ))}
    </group>
  );
}
