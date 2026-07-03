// These mirror the server's wire format (internal/wire). If the Go side changes,
// change these to match.

export type TileView = {
  kind: "empty" | "belt" | "extractor" | "seller";
  dir: "north" | "east" | "south" | "west";
};

export type StateMessage = {
  type: "state";
  width: number;
  height: number;
  tiles: TileView[];
};

// StatsMessage is the economy update: the iron-ore total, production rate, and
// where the upgrades stand. A cost of 0 means that upgrade is maxed out.
// Mirror of wire.StatsMessage in Go.
export type StatsMessage = {
  type: "stats";
  ironOre: number;
  ratePerSec: number;
  extractorLevel: number;
  extractorCost: number;
  beltLevel: number;
  beltCost: number;
  valueLevel: number;
  valueCost: number;
  gridWidth: number; // unlocked region, centred in the world
  gridHeight: number;
  gridCost: number;
  nextGridWidth: number; // the tier Grid Size buys next, 0 when maxed
  nextGridHeight: number;
};

// WelcomeMessage is the first thing we hear after joining: our room's code (the
// address bar gets rewritten to it, making the URL the invite link) and our
// player slot, which doubles as our colour. Mirror of wire.WelcomeMessage.
export type WelcomeMessage = {
  type: "welcome";
  room: string;
  slot: number;
};

// PresencePlayer is one connected player: its slot and the cell it is hovering,
// if any. Mirror of wire.PresencePlayer.
export type PresencePlayer = {
  slot: number;
  hovering: boolean;
  x: number;
  y: number;
};

// PresenceMessage is the room's full roster, sent whenever a player joins,
// leaves, or moves their hover. Mirror of wire.PresenceMessage.
export type PresenceMessage = {
  type: "presence";
  players: PresencePlayer[];
};

// RoomFullMessage means the room already holds its four players; the server
// closes right after, and we must not reconnect to this room. Mirror of
// wire.RoomFullMessage.
export type RoomFullMessage = {
  type: "roomFull";
};

// PongMessage answers a ping with the timestamp we sent, so we can measure the
// round-trip time. Mirror of wire.PongMessage in Go.
export type PongMessage = {
  type: "pong";
  t: number;
};

export type ServerMessage = StateMessage | StatsMessage | WelcomeMessage | PresenceMessage | RoomFullMessage | PongMessage;

// PlaceableKind is the tile kinds a player can place (everything but empty).
// Derived from TileView so the two stay in sync.
export type PlaceableKind = Exclude<TileView["kind"], "empty">;

// Dir is a facing direction, shared by tiles and place commands.
export type Dir = TileView["dir"];

// Commands the client sends to the server. Mirror of internal/wire/command.go.
export type PlaceCommand = {
  type: "place";
  x: number;
  y: number;
  kind: PlaceableKind;
  dir: Dir;
};

export type DestroyCommand = {
  type: "destroy";
  x: number;
  y: number;
};

export type RotateCommand = {
  type: "rotate"; // turn the structure at (x, y) a quarter clockwise
  x: number;
  y: number;
};

export type BuyCommand = {
  type: "buy";
  upgrade: "extractorRate" | "beltSpeed" | "oreValue" | "gridSize";
};

export type HoverCommand = {
  type: "hover"; // where this player is pointing, for the other players
  hovering: boolean;
  x: number;
  y: number;
};

// Ping is deliberately not in this union: connection.ts sends it raw and the
// server answers it in the transport layer, before commands reach the game.
export type Command = PlaceCommand | DestroyCommand | RotateCommand | BuyCommand | HoverCommand;
