import { useEffect } from "react";
import { startBackgroundMusic } from "./music";

export function BackgroundMusic() {
  useEffect(() => {
    const start = () => {
      window.removeEventListener("pointerdown", start);
      window.removeEventListener("keydown", start);
      startBackgroundMusic();
    };
    window.addEventListener("pointerdown", start);
    window.addEventListener("keydown", start);
    return () => {
      window.removeEventListener("pointerdown", start);
      window.removeEventListener("keydown", start);
    };
  }, []);

  return null;
}
