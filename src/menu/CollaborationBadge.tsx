import { useEffect, useId, useRef, useState } from "react";
import { useSnapshot } from "valtio";
import { collaboration } from "../sync/presence";

const labels = {
  connecting: "Connecting…",
  saving: "Saving changes…",
  saved: "Saved",
  disconnected: "Disconnected — waiting to reconnect",
  error: "Save or connection error — retrying",
};

export function CollaborationBadge() {
  const { users, status } = useSnapshot(collaboration);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, []);
  return (
    <div
      ref={root}
      className="collaboration-badge"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") setOpen(false);
      }}
    >
      <button
        type="button"
        className="collaboration-trigger"
        aria-expanded={open}
        aria-controls={id}
        aria-label="People"
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
      >
        <span
          className={`sync-light sync-${status}`}
          role="img"
          aria-label={labels[status]}
        />
        <span>{users.length}</span>
      </button>
      {open && <PeopleList id={id} users={users} />}
    </div>
  );
}

function PeopleList({
  id,
  users,
}: {
  id: string;
  users: readonly { id: number; name: string }[];
}) {
  return (
    <div id={id} className="collaboration-popover">
      <ul>
        {users.map((user) => (
          <li key={user.id}>{user.name}</li>
        ))}
      </ul>
    </div>
  );
}
