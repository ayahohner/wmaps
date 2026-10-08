import { afterEach, expect, it, vi } from "vitest";

vi.mock("../../state/Graph", () => ({}));
vi.mock("../../editor/Editor", () => ({}));
vi.mock("./MapSingleton", () => ({ default: { dirty: false } }));

import {
  startPotentialSelect,
  startSelecting,
  stopSelecting,
} from "../../state/State";
import MapSingleton from "./MapSingleton";
import { SelectionHandler } from "./SelectionHandler";

afterEach(async () => {
  stopSelecting();
  await Promise.resolve();
});

it.each([
  [10, 20, 110, 120],
  [110, 120, 10, 20],
  [10, 120, 110, 20],
  [110, 20, 10, 120],
])("draws selection from (%i, %i) to (%i, %i)", async (sx, sy, ex, ey) => {
  const rectangle = SelectionHandler();
  try {
    startPotentialSelect({ x: sx, y: sy });
    startSelecting({ x: ex, y: ey });
    MapSingleton.dirty = false;
    await Promise.resolve();

    expect(rectangle.visible).toBe(true);
    expect(rectangle.x).toBe(10);
    expect(rectangle.y).toBe(20);
    // Real Pixi geometry must cover the rectangle interior in every direction.
    expect(rectangle.containsPoint({ x: 50, y: 50 })).toBe(true);
    expect(rectangle.containsPoint({ x: 150, y: 150 })).toBe(false);
    expect(MapSingleton.dirty).toBe(true);

    stopSelecting();
    await Promise.resolve();
    expect(rectangle.visible).toBe(false);
  } finally {
    rectangle.emit("removed", rectangle);
    rectangle.destroy();
  }
});
