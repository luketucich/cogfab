import type { DepositView, PlaceableKind, ResourceKind, StateMessage } from "../net/types";

export type ResourceStyle = {
  label: string;
  color: string;
  baseCredits: number;
};

// Resource colors are shared by deposits, moving material, and hover labels.
// Shape still distinguishes raw rocks from later processed items.
export const RESOURCE_PALETTE: Record<ResourceKind, ResourceStyle> = {
  iron: { label: "Iron", color: "#8f969f", baseCredits: 1 },
  copper: { label: "Copper", color: "#d88458", baseCredits: 3 },
  quartz: { label: "Quartz", color: "#d6c9f2", baseCredits: 8 },
  gold: { label: "Gold", color: "#e7bb52", baseCredits: 20 },
  ironBar: { label: "Iron bar", color: "#c0c6ce", baseCredits: 3 },
  copperSheet: { label: "Copper sheet", color: "#f0a06e", baseCredits: 9 },
  quartzCrystal: { label: "Quartz crystal", color: "#efe6ff", baseCredits: 24 },
  goldIngot: { label: "Gold ingot", color: "#ffd76a", baseCredits: 60 },
};

export const RAW_RESOURCES: ResourceKind[] = ["iron", "copper", "quartz", "gold"];

export function isRawResource(kind: ResourceKind): boolean {
  return RAW_RESOURCES.includes(kind);
}

export function refineResource(kind: ResourceKind): ResourceKind {
  switch (kind) {
    case "iron":
      return "ironBar";
    case "copper":
      return "copperSheet";
    case "quartz":
      return "quartzCrystal";
    case "gold":
      return "goldIngot";
    default:
      return kind;
  }
}

let cachedDeposits: StateMessage["deposits"] | null = null;
let cachedDepositWidth = 0;
let depositIndex = new Map<number, DepositView>();
let cachedPorts: StateMessage["ports"] | null = null;
let cachedPortWidth = 0;
let portIndex = new Set<number>();

const cellKey = (snap: Pick<StateMessage, "width">, x: number, y: number): number => y * snap.width + x;

function depositsFor(snap: StateMessage): Map<number, DepositView> {
  if (cachedDeposits !== snap.deposits || cachedDepositWidth !== snap.width) {
    cachedDeposits = snap.deposits;
    cachedDepositWidth = snap.width;
    depositIndex = new Map(snap.deposits.map((deposit) => [cellKey(snap, deposit.x, deposit.y), deposit]));
  }
  return depositIndex;
}

function portsFor(snap: StateMessage): Set<number> {
  if (cachedPorts !== snap.ports || cachedPortWidth !== snap.width) {
    cachedPorts = snap.ports;
    cachedPortWidth = snap.width;
    portIndex = new Set(snap.ports.map((port) => cellKey(snap, port.x, port.y)));
  }
  return portIndex;
}

export function depositAt(snap: StateMessage, x: number, y: number): DepositView | undefined {
  return depositsFor(snap).get(cellKey(snap, x, y));
}

export function hasPortAt(snap: StateMessage, x: number, y: number): boolean {
  return portsFor(snap).has(cellKey(snap, x, y));
}

export function placementTerrainAllows(snap: StateMessage, kind: PlaceableKind, x: number, y: number): boolean {
  const deposit = depositAt(snap, x, y);
  const isPort = hasPortAt(snap, x, y);
  if (kind === "extractor") return !!deposit && deposit.remaining > 0 && !isPort;
  if (kind === "seller") return isPort && !deposit;
  return !isPort && (!deposit || deposit.remaining === 0);
}
