import { PiCubeFocusFill } from "react-icons/pi";
import { resetCamera } from "./camera";
import { tile } from "./ui";

// ResetView recentres the camera to the default isometric view.
export function ResetView() {
  return (
    <button
      className="hud-reset hud-corner-button"
      onClick={resetCamera}
      title="Reset view"
      aria-label="Reset view"
      style={{ ...tile, position: "absolute" }}
    >
      <PiCubeFocusFill size={26} />
    </button>
  );
}
