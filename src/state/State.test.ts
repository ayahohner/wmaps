import { Container } from "pixi.js";
import { it, expect, describe, vi } from "vitest";

// State.ts pulls in Graph.ts -> MapSingleton.tsx (constructs a Pixi
// Application at module level) and Editor.ts (touches window.heap and opens
// a y-webrtc provider at module level). None of that is needed here.
vi.mock("./Graph", () => ({}));
vi.mock("../editor/Editor", () => ({}));

import {
  state,
  setInitialLinkTarget,
  startPotentialSelect,
} from "./State";

/**
 * Regression test for the Command-link freeze (2026-09-26):
 * the app used to store a live Pixi Container in valtio state
 * (state.linking.initialLinkTarget). Valtio's proxy() initialization
 * recursively walks a stored object's own properties and replaces object
 * values with Proxies ON THE REAL OBJECT, so the live scene graph got
 * corrupted (container.parent / children became Proxies) and every native
 * call through them (canvas.addEventListener, WebGPU commands, …) threw
 * "TypeError: Illegal invocation" — freezing the map.
 * State must only ever hold plain data (node keys, {x,y} pairs), never
 * Pixi class instances.
 */
describe("valtio state holds plain data, not Pixi objects", () => {
  it("setInitialLinkTarget stores the node key as a plain string", () => {
    const component = new Container();
    (component as { nodeKey?: string }).nodeKey = "MyComponent";
    const childrenBefore = component.children;

    setInitialLinkTarget("MyComponent");

    expect(state.linking.initialLinkTarget).toBe("MyComponent");
    expect(typeof state.linking.initialLinkTarget).toBe("string");
    // The live container is never handed to valtio, so it stays intact.
    expect(component.children).toBe(childrenBefore);

    setInitialLinkTarget(undefined);
    expect(state.linking.initialLinkTarget).toBeUndefined();
  });

  it("setInitialLinkTarget rejects Pixi containers at the type level", () => {
    const component = new Container();
    // @ts-expect-error - live Pixi objects must never enter valtio state
    setInitialLinkTarget(component);
    // Runtime cleanup in case a future signature change lets this through.
    setInitialLinkTarget(undefined);
  });

  it("drag points are stored as plain objects", () => {
    startPotentialSelect({ x: 10, y: 20 });
    const p = state.selectDrag.selectionStartPoint;
    expect(p).toEqual({ x: 10, y: 20 });
    expect(Object.getPrototypeOf(p)).toBe(Object.prototype);
  });
});
