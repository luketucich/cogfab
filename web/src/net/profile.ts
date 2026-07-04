import { connection } from "./connection";
import { subscribeSession } from "./session";

// Who this player wants to be: a name and a colour, picked in the lobby panel,
// remembered in localStorage so they survive a reload, and shared with the room
// whenever they change or a fresh connection needs telling.

const STORAGE_KEY = "cogfab-profile";
export const NAME_LIMIT = 16; // mirror of maxNameLength in internal/server/presence.go

type Profile = { name: string; color: string }; // both "" until the player picks

let profile: Profile = load();

function load(): Profile {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as Profile;
  } catch {
    // a corrupt or blocked localStorage just means starting fresh
  }
  return { name: "", color: "" };
}

function share(): void {
  if (profile.name || profile.color) {
    connection.send({ type: "profile", name: profile.name, color: profile.color });
  }
}

// setProfile records a new name and colour, persists them, and tells the room.
export function setProfile(name: string, color: string): void {
  profile = { name: name.trim().slice(0, NAME_LIMIT), color };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
  } catch {
    // not being able to persist is no reason not to play
  }
  share();
}

// A fresh welcome means a fresh connection, which starts with the default
// name; re-introduce ourselves.
subscribeSession(share);
