import { useSyncExternalStore } from "react";
import { PlacementEffect } from "./PlacementEffect";
import { useFactoryModels } from "./models";
import { getPlacementEffects, subscribePlacementEffects } from "./placementEffectStore";
import { getLatest, subscribe } from "./store";

// PlacementEffects renders the short-lived accepted buildings that Factory
// hides until their drop animation completes.
export function PlacementEffects() {
  const effects = useSyncExternalStore(subscribePlacementEffects, getPlacementEffects);
  const snap = useSyncExternalStore(subscribe, getLatest);
  const models = useFactoryModels();
  if (!snap) return null;

  return (
    <>
      {effects.map((effect) => (
        <PlacementEffect key={effect.id} effect={effect} snap={snap} models={models} />
      ))}
    </>
  );
}
