import { useSyncExternalStore } from "react";
import { BuildPreview } from "./BuildPreview";
import { placementOccupancyAllowsAt, visibleBuildPreview } from "./buildPreviewData";
import { getBuildPreview, subscribeBuildPreview } from "./buildPreviewStore";
import { getStats, spendableCredits, subscribeStats } from "./economy";
import { cellIndex, isUnlocked, unlockedRect } from "./grid";
import { useFactoryModels } from "./models";
import { getPreviewPresence, subscribePreviewPresence } from "./presence";
import { getTerrain, subscribeResources } from "./store";
import { getSession, subscribeSession } from "../net/session";
import type { BuildPreview as BuildPreviewData, PlaceableKind, StateMessage } from "../net/types";
import { TOOLS } from "../toolbar/tools";
import { DANGER, playerColor } from "../ui";
import { placementTerrainAllows } from "./resources";

function previewIsValid(preview: BuildPreviewData, snap: StateMessage): boolean {
  const stats = getStats();
  const cost = TOOLS.find((tool) => tool.id === preview.kind)?.cost;
  if (cost === undefined || preview.placements.length * cost > spendableCredits()) return false;
  const region = unlockedRect(snap, stats.gridWidth, stats.gridHeight);
  return preview.placements.every((placement) => {
    const index = cellIndex(snap, placement.x, placement.y);
    return (
      index >= 0 &&
      isUnlocked(region, placement.x, placement.y) &&
      placementOccupancyAllowsAt(snap, preview.kind, placement.x, placement.y) &&
      placementTerrainAllows(snap, preview.kind, placement.x, placement.y)
    );
  });
}

function previewCostExists(kind: PlaceableKind): boolean {
  return TOOLS.some((tool) => tool.id === kind && tool.cost !== undefined);
}

// BuildPreviews combines the immediate local ghost with every other player's
// server-broadcast preview. Remote ghosts keep their owner's cursor colour.
export function BuildPreviews() {
  const local = useSyncExternalStore(subscribeBuildPreview, getBuildPreview);
  const players = useSyncExternalStore(subscribePreviewPresence, getPreviewPresence);
  const session = useSyncExternalStore(subscribeSession, getSession);
  const snap = useSyncExternalStore(subscribeResources, getTerrain);
  useSyncExternalStore(subscribeStats, getStats);
  const models = useFactoryModels();
  if (!snap) return null;

  const visibleLocal = local ? visibleBuildPreview(local, snap) : null;
  return (
    <>
      {local && visibleLocal && previewCostExists(local.kind) && (
        <BuildPreview
          preview={visibleLocal}
          color={previewIsValid(local, snap) ? "#ffffff" : DANGER}
          snap={snap}
          models={models}
          owner="local"
        />
      )}
      {players
        .filter((player) => player.slot !== session.slot)
        .map((player) => {
          const preview = player.preview;
          if (!preview || !previewCostExists(preview.kind)) return null;
          const visible = visibleBuildPreview(preview, snap);
          if (!visible) return null;
          return (
            <BuildPreview
              key={player.slot}
              preview={visible}
              color={playerColor(player)}
              snap={snap}
              models={models}
              owner={player.name}
            />
          );
        })}
    </>
  );
}
