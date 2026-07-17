import { useMemo } from "react";
import { useGLTF } from "@react-three/drei";
import { meshParts, type MeshParts } from "./models";

const ROCK_URLS = ["/models/deposit-rock-a.glb", "/models/deposit-rock-b.glb", "/models/deposit-rock-c.glb"] as const;
const PORT_URL = "/models/shipping-pad.glb";

export type ResourceModels = {
  rocks: [MeshParts, MeshParts, MeshParts];
  port: MeshParts;
};

export function useResourceModels(): ResourceModels {
  const rockA = useGLTF(ROCK_URLS[0]);
  const rockB = useGLTF(ROCK_URLS[1]);
  const rockC = useGLTF(ROCK_URLS[2]);
  const port = useGLTF(PORT_URL);
  const rockAModel = useMemo(() => meshParts(rockA.scene), [rockA.scene]);
  const rockBModel = useMemo(() => meshParts(rockB.scene), [rockB.scene]);
  const rockCModel = useMemo(() => meshParts(rockC.scene), [rockC.scene]);
  const portModel = useMemo(() => meshParts(port.scene), [port.scene]);
  return {
    rocks: [rockAModel, rockBModel, rockCModel],
    port: portModel,
  };
}

for (const url of ROCK_URLS) useGLTF.preload(url);
useGLTF.preload(PORT_URL);
