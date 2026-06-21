// These mirror the server's wire format (internal/wire/wire.go). If the Go side
// changes, change these to match.

export type TileView = {
  kind: "empty" | "belt" | "extractor";
  dir: "north" | "east" | "south" | "west";
  item: "none" | "ore";
};

export type StateMessage = {
  type: "state";
  tick: number;
  width: number;
  height: number;
  tiles: TileView[];
};
