import type { Awareness } from "y-protocols/awareness";
import { proxy } from "valtio/vanilla";
import type { SyncStatus } from "./SaveStatus";

export interface ConnectedUser {
  id: number;
  name: string;
  color: string;
  self: boolean;
}

export const collaboration = proxy<{
  status: SyncStatus;
  users: ConnectedUser[];
}>({
  status: "connecting",
  users: [],
});

export function readUser(
  id: number,
  value: any,
  localId: number,
): ConnectedUser {
  return {
    id,
    name:
      typeof value?.user?.name === "string"
        ? value.user.name.slice(0, 80)
        : "Anonymous",
    color: /^#[0-9a-f]{6}$/i.test(value?.user?.color)
      ? value.user.color
      : "#666666",
    self: id === localId,
  };
}

export function bindPresence(awareness: Awareness) {
  const update = () => {
    const users = [...awareness.getStates()].map(([id, value]) =>
      readUser(id, value, awareness.clientID),
    );
    users.sort((a, b) => Number(b.self) - Number(a.self) || a.id - b.id);
    // Pointer movement must not rerender the menu.
    if (JSON.stringify(users) !== JSON.stringify(collaboration.users))
      collaboration.users = users;
  };
  awareness.on("change", update);
  update();
  return () => awareness.off("change", update);
}
