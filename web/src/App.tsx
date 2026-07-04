import { Scene } from "./Scene";
import { Vignette } from "./Vignette";
import { Hud } from "./Hud";
import { OreCounter } from "./OreCounter";
import { UpgradePanel } from "./UpgradePanel";
import { ResetView } from "./ResetView";
import { Controls } from "./Controls";
import { CursorOverlay } from "./CursorOverlay";
import { RoomFull } from "./RoomFull";
import { Toolbar } from "./toolbar/Toolbar";

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
      <OreCounter />
      <UpgradePanel />
      <Toolbar />
      <ResetView />
      <Controls />
      <CursorOverlay />
      <RoomFull />
    </div>
  );
}
