import { Scene } from "./Scene";
import { Vignette } from "./Vignette";
import { Hud } from "./Hud";

export function App() {
  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        overflow: "hidden",
      }}
    >
      <Scene />
      <Vignette />
      <Hud />
    </div>
  );
}
