import { PiCubeFocusFill } from "react-icons/pi";
import { resetCamera } from "./camera";
import { tile } from "./ui";

// ResetView recentres the camera to the default isometric view. Same tile look as
// the toolbar, but on its own in the bottom-right since it is not a build tool.
export function ResetView() {
  return (
    <button onClick={resetCamera} title="Reset view" style={{ ...tile, position: "absolute", bottom: 20, right: 20 }}>
      <PiCubeFocusFill size={26} />
      <span>Reset view</span>
    </button>
  );
}
