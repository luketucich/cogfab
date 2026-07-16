import { Scene } from "./Scene";
import { Vignette } from "./Vignette";
import { Hud } from "./Hud";
import { CreditsCounter } from "./CreditsCounter";
import { UpgradePanel } from "./UpgradePanel";
import { ResetView } from "./ResetView";
import { Settings } from "./Settings";
import { BackgroundMusic } from "./BackgroundMusic";
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
      <BackgroundMusic />
      <Vignette />
      <Hud />
      <CreditsCounter />
      <UpgradePanel />
      <Toolbar />
      <ResetView />
      <Settings />
      <CursorOverlay />
      <RoomFull />
    </div>
  );
}
