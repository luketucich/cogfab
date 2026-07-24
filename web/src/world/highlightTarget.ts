import type { BuildPreview, PresencePlayer, StateMessage } from "../net/types";
import { playerColor } from "../ui";
import type { Cell } from "./grid";
import { cellIndex, isUnlocked, type Rect } from "./grid";

export const LOCAL_HIGHLIGHT_COLOR = "#ffffff";

export type HighlightTarget = Cell & { color: string };

type HighlightTargetArgs = {
  snap: StateMessage;
  unlocked: Rect;
  slot: number;
  localSlot: number;
  localHover: Cell | null;
  localPreview: BuildPreview | null;
  players: readonly PresencePlayer[];
  previewPlayers: readonly PresencePlayer[];
};

// highlightTarget resolves the one cell a player is pointing at. Local intent
// is white; the identical remote intent uses that player's chosen colour.
// Active build ghosts already communicate intent, so they suppress the hover
// copy instead of stacking two effects on the same cell.
export function highlightTarget({
  snap,
  unlocked,
  slot,
  localSlot,
  localHover,
  localPreview,
  players,
  previewPlayers,
}: HighlightTargetArgs): HighlightTarget | null {
  let target: HighlightTarget | null = null;
  if (slot === localSlot) {
    if (localHover && !localPreview) {
      target = { ...localHover, color: LOCAL_HIGHLIGHT_COLOR };
    }
  } else {
    const preview = previewPlayers.find((player) => player.slot === slot)?.preview;
    const player = players.find((candidate) => candidate.slot === slot);
    if (player?.on && player.hovering && !preview && Number.isFinite(player.x) && Number.isFinite(player.y)) {
      target = { x: Math.round(player.x), y: Math.round(player.y), color: playerColor(player) };
    }
  }

  if (!target || cellIndex(snap, target.x, target.y) < 0 || !isUnlocked(unlocked, target.x, target.y)) {
    return null;
  }
  return target;
}
