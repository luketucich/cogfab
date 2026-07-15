import { useMemo, useSyncExternalStore } from "react";
import { BuildPreview } from "./BuildPreview";
import { getBuildPreview, subscribeBuildPreview } from "./buildPreviewStore";
import { chevronGeometry } from "./chevron";
import { getStats, spendableOre, subscribeStats } from "./economy";
import { cellIndex, isUnlocked, unlockedRect } from "./grid";
import { useFactoryModels } from "./models";
import { getPresence, subscribePresence } from "./presence";
import { getLatest, subscribe } from "./store";
import { getSession, subscribeSession } from "../net/session";
import type { BuildPreview as BuildPreviewData, PlaceableKind, StateMessage } from "../net/types";
import { TOOLS } from "../toolbar/tools";
import { DANGER, PLAYER_COLORS, playerColor } from "../ui";

function previewIsValid(preview: BuildPreviewData, snap: StateMessage): boolean {
  const stats = getStats();
  const cost = TOOLS.find((tool) => tool.id === preview.kind)?.cost;
  if (cost === undefined || preview.placements.length * cost > spendableOre()) return false;
  const region = unlockedRect(snap, stats.gridWidth, stats.gridHeight);
  return preview.placements.every((placement) => {
    const index = cellIndex(snap, placement.x, placement.y);
    return index >= 0 && isUnlocked(region, placement.x, placement.y) && snap.tiles[index].kind === "empty";
  });
}

function previewCostExists(kind: PlaceableKind): boolean {
  return TOOLS.some((tool) => tool.id === kind && tool.cost !== undefined);
}

// BuildPreviews combines the immediate local ghost with every other player's
// server-broadcast preview. Remote ghosts keep their owner's cursor colour.
export function BuildPreviews() {
  const local = useSyncExternalStore(subscribeBuildPreview, getBuildPreview);
  const players = useSyncExternalStore(subscribePresence, getPresence);
  const session = useSyncExternalStore(subscribeSession, getSession);
  const snap = useSyncExternalStore(subscribe, getLatest);
  useSyncExternalStore(subscribeStats, getStats);
  const models = useFactoryModels();
  const arrow = useMemo(() => chevronGeometry(), []);
  if (!snap) return null;

  const me = players.find((player) => player.slot === session.slot);
  const localColor = me ? playerColor(me) : PLAYER_COLORS[session.slot];
  return (
    <>
      {local && previewCostExists(local.kind) && (
        <BuildPreview
          preview={local}
          color={previewIsValid(local, snap) ? localColor : DANGER}
          snap={snap}
          models={models}
          arrow={arrow}
          owner="local"
        />
      )}
      {players
        .filter((player) => player.slot !== session.slot)
        .map((player) => {
          const preview = player.preview;
          if (!preview || !previewCostExists(preview.kind)) return null;
          return (
            <BuildPreview
              key={player.slot}
              preview={preview}
              color={playerColor(player)}
              snap={snap}
              models={models}
              arrow={arrow}
              owner={player.name}
            />
          );
        })}
    </>
  );
}
