# Refiner

Optional mid-line processing that turns raw ore into higher-value products.

## Loop

Players still ship raw ore extractor → belts → seller for base credits. Routing
through a refiner instead:

```
extractor → belts → refiner → belts → seller
```

pays **3×** the raw sale value after a short processing delay. Refining is never
required, so a first iron line stays simple; the reward is choosing when to spend
space and credits on a refining spine.

## Facing

Like a seller, the refiner’s facing points at its **input** belt. Material exits
from the opposite side. One facing locks a clear flow-through orientation.

## Recipes

| Raw    | Product         | Base credits |
| ------ | --------------- | ------------ |
| Iron   | Iron bar        | 1 → 3        |
| Copper | Copper sheet    | 3 → 9        |
| Quartz | Quartz crystal  | 8 → 24       |
| Gold   | Gold ingot      | 20 → 60      |

Sale Value still multiplies the final product.

## Processing

A refiner handles **one job at a time**. Incoming ore waits on the input mouth
until the machine is free, then spends `2 / (1 + 0.5 × level)` seconds refining
before the product rides the output belts. The wait is the interesting bottleneck:
fast extractors without Refiner Speed (or more refiners in parallel lines) back up.

## Upgrade: Refiner Speed

| Level | Process time |
| ----- | ------------ |
| 0     | 2.00 s       |
| 1     | 1.33 s       |
| 2     | 1.00 s       |
| 5     | 0.50 s       |

Price starts at **250** credits and doubles each level, matching the other
production upgrades. Buying it still requires a live income line and leaves the
next land unlock reserved.

## Build cost

**150** credits. Placeable on open land (no live deposit, no shipping port), same
terrain rule as belts.

## Why it’s fun

- Early game: ship raw, expand.
- Mid game: one refined copper/quartz line feels like a breakthrough.
- Co-op: one player opens deposits, another lays the refining spine, a third
  keeps sellers and upgrades fed.
- Parallel refiners beat a single over-upgraded machine once belts are saturated.

## Art

Kenney Factory Kit `machine-fortified.glb`, committed as
`web/public/models/refiner.glb`.
