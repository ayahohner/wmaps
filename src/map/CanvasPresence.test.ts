import { afterEach, expect, it, vi } from "vitest";
import * as Y from "yjs";
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
} from "y-protocols/awareness";
import { initializeCanvasPresence } from "./CanvasPresence";
import { bindPresence, collaboration } from "../sync/presence";

const cleanups: (() => void)[] = [];
afterEach(() => {
  cleanups
    .reverse()
    .splice(0)
    .forEach((fn) => fn());
  document.body.replaceChildren();
  vi.useRealTimers();
});
function peer() {
  const doc = new Y.Doc();
  const awareness = new Awareness(doc);
  cleanups.push(() => {
    awareness.destroy();
    doc.destroy();
  });
  return awareness;
}

it("publishes canvas-relative pointers, cancels trailing movement on leave, and cleans up", () => {
  vi.useFakeTimers();
  const awareness = peer();
  const parent = document.createElement("div");
  const canvas = document.createElement("canvas");
  parent.append(canvas);
  document.body.append(parent);
  canvas.getBoundingClientRect = () =>
    ({ left: 100, top: 50, width: 400, height: 200 }) as DOMRect;
  const cleanup = initializeCanvasPresence(canvas, awareness);
  canvas.dispatchEvent(
    new PointerEvent("pointermove", {
      clientX: 300,
      clientY: 100,
      pointerType: "mouse",
    }),
  );
  expect(awareness.getLocalState()?.mapPointer).toEqual({ x: 50, y: 75 });
  canvas.dispatchEvent(
    new PointerEvent("pointermove", { clientX: 310, clientY: 100 }),
  );
  canvas.dispatchEvent(new PointerEvent("pointerleave"));
  vi.advanceTimersByTime(100);
  expect(awareness.getLocalState()?.mapPointer).toBeNull();
  canvas.dispatchEvent(
    new PointerEvent("pointermove", { clientX: 300, clientY: 100 }),
  );
  window.dispatchEvent(new Event("blur"));
  expect(awareness.getLocalState()?.mapPointer).toBeNull();
  cleanup();
  expect(parent.querySelector(".canvas-presence")).toBeNull();
});

it("renders remote presence safely, tracks users independently of pointers, and removes departed peers", () => {
  const a = peer(),
    b = peer();
  const canvas = document.createElement("canvas");
  document.body.append(canvas);
  cleanups.push(bindPresence(a), initializeCanvasPresence(canvas, a));
  const deliver = () =>
    applyAwarenessUpdate(a, encodeAwarenessUpdate(b, [b.clientID]), "test");
  b.setLocalState({
    user: { name: "<img src=x>", color: "#30bced" },
    mapPointer: { x: 85, y: 5 },
  });
  deliver();
  const pointer = document.querySelector<HTMLElement>(".remote-pointer")!;
  expect(pointer.style.left).toBe("85%");
  expect(pointer.style.top).toBe("95%");
  expect(pointer.textContent).toContain("<img src=x>");
  expect(pointer.querySelector("img")).toBeNull();
  expect(collaboration.users).toHaveLength(2);
  const users = collaboration.users;
  b.setLocalStateField("mapPointer", { x: -1, y: 500 });
  deliver();
  expect(document.querySelector(".remote-pointer")).toBeNull();
  expect(collaboration.users).toBe(users);
  b.setLocalState(null);
  deliver();
  expect(collaboration.users).toHaveLength(1);
});
