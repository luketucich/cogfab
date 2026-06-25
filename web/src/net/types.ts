// These mirror the server's wire format (internal/wire). If the Go side changes,
// change these to match.

export type TileView = {
  kind: "empty" | "belt" | "extractor";
  dir: "north" | "east" | "south" | "west";
};

export type StateMessage = {
  type: "state";
  width: number;
  height: number;
  tiles: TileView[];
};

// PlaceableKind is the tile kinds a player can place (everything but empty).
// Derived from TileView so the two stay in sync.
export type PlaceableKind = Exclude<TileView["kind"], "empty">;

// Commands the client sends to the server. Mirror of internal/wire/command.go.
export type PlaceCommand = {
  type: "place";
  x: number;
  y: number;
  kind: PlaceableKind;
};

export type DestroyCommand = {
  type: "destroy";
  x: number;
  y: number;
};

export type Command = PlaceCommand | DestroyCommand;
