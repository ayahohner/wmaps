import type { Awareness } from "y-protocols/awareness";
import throttle from "lodash/throttle";
import { readUser } from "../sync/presence";

export function validPointer(value: any): value is { x: number; y: number } {
  return (
    Number.isFinite(value?.x) &&
    Number.isFinite(value?.y) &&
    value.x >= 0 &&
    value.x <= 100 &&
    value.y >= 0 &&
    value.y <= 100
  );
}

/** Ephemeral map coordinates, separate from editor selection and the saved doc. */
export function initializeCanvasPresence(
  canvas: HTMLCanvasElement,
  awareness: Awareness,
) {
  const overlay = document.createElement("div");
  overlay.className = "canvas-presence";
  overlay.setAttribute("aria-hidden", "true");
  canvas.parentElement!.append(overlay);
  const pointers = new Map<number, HTMLDivElement>();

  const render = () => {
    const visible = new Set<number>();
    for (const [id, value] of awareness.getStates()) {
      if (id === awareness.clientID || !validPointer(value.mapPointer))
        continue;
      visible.add(id);
      let pointer = pointers.get(id);
      if (!pointer) {
        pointer = createPointer();
        overlay.append(pointer);
        pointers.set(id, pointer);
      }
      const user = readUser(id, value, awareness.clientID);
      pointer.style.left = `${value.mapPointer.x}%`;
      pointer.style.top = `${100 - value.mapPointer.y}%`;
      pointer.style.setProperty("--pointer-color", user.color);
      pointer.classList.toggle("near-right", value.mapPointer.x > 70);
      pointer.classList.toggle("near-bottom", value.mapPointer.y < 10);
      pointer.lastElementChild!.textContent = user.name;
    }
    for (const [id, pointer] of pointers) {
      if (!visible.has(id)) {
        pointer.remove();
        pointers.delete(id);
      }
    }
  };
  const publish = throttle((point: { x: number; y: number }) => {
    awareness.setLocalStateField("mapPointer", point);
  }, 50);
  const move = (event: PointerEvent) => {
    if (event.pointerType === "touch") return;
    const rect = canvas.getBoundingClientRect();
    const point = {
      x: (100 * (event.clientX - rect.left)) / rect.width,
      y: 100 * (1 - (event.clientY - rect.top) / rect.height),
    };
    if (validPointer(point)) publish(point);
    else leave();
  };
  const leave = () => {
    publish.cancel();
    awareness.setLocalStateField("mapPointer", null);
  };
  const visibility = () => {
    if (document.hidden) leave();
  };
  canvas.addEventListener("pointermove", move);
  canvas.addEventListener("pointerleave", leave);
  canvas.addEventListener("pointercancel", leave);
  window.addEventListener("blur", leave);
  document.addEventListener("visibilitychange", visibility);
  awareness.on("change", render);
  render();
  return () => {
    leave();
    awareness.off("change", render);
    canvas.removeEventListener("pointermove", move);
    canvas.removeEventListener("pointerleave", leave);
    canvas.removeEventListener("pointercancel", leave);
    window.removeEventListener("blur", leave);
    document.removeEventListener("visibilitychange", visibility);
    overlay.remove();
  };
}

function createPointer() {
  const pointer = document.createElement("div");
  pointer.className = "remote-pointer";
  const arrow = document.createElement("span");
  arrow.className = "remote-pointer-arrow";
  const label = document.createElement("span");
  label.className = "remote-pointer-label";
  pointer.append(arrow, label);
  return pointer;
}
