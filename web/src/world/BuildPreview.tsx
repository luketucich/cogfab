import * as THREE from "three";
import type { BufferGeometry } from "three";
import type { BuildPreview as BuildPreviewData, StateMessage } from "../net/types";
import { CHEVRON_ROT } from "./chevron";
import { cellOffsets, CURSOR_TILE, MACHINE_ROTATION } from "./grid";
import type { FactoryModels } from "./models";

const TILE_Y = 0.025;
const ARROW_Y = 0.09;
const TILE_OPACITY = 0.28;
const MODEL_OPACITY = 0.36;
const ARROW_OPACITY = 0.82;

type Props = {
  preview: BuildPreviewData;
  color: string;
  snap: StateMessage;
  models: FactoryModels;
  arrow: BufferGeometry;
  owner: string;
};

// BuildPreview renders one player's uncommitted intent. Belts keep the clear
// floor arrows; machines add a tinted copy of the model they would place.
export function BuildPreview({ preview, color, snap, models, arrow, owner }: Props) {
  const { offX, offZ } = cellOffsets(snap);
  const machine = preview.kind === "extractor" ? models.extractor : preview.kind === "seller" ? models.seller : null;

  return (
    <group name={`${owner} build preview`}>
      {preview.placements.map((placement) => (
        <group key={`${placement.x}:${placement.y}`} position={[placement.x - offX, 0, placement.y - offZ]}>
          <mesh
            rotation={[-Math.PI / 2, 0, 0]}
            position={[0, TILE_Y, 0]}
            scale={[CURSOR_TILE, CURSOR_TILE, 1]}
            raycast={() => null}
          >
            <planeGeometry args={[1, 1]} />
            <meshBasicMaterial color={color} transparent opacity={TILE_OPACITY} depthWrite={false} toneMapped={false} />
          </mesh>

          {machine?.geometry && (
            <mesh geometry={machine.geometry} rotation={[0, MACHINE_ROTATION[placement.dir], 0]} raycast={() => null}>
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

          <mesh geometry={arrow} position={[0, ARROW_Y, 0]} rotation={[0, CHEVRON_ROT[placement.dir], 0]} raycast={() => null}>
            <meshBasicMaterial
              color={color}
              transparent
              opacity={ARROW_OPACITY}
              depthWrite={false}
              side={THREE.DoubleSide}
              toneMapped={false}
            />
          </mesh>
        </group>
      ))}
    </group>
  );
}
