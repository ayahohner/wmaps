import { expect, it } from "vitest";
import { RenderIndicator } from "./RenderIndicator";

it("is off unless VITE_RENDER_INDICATOR is set", () => {
  expect(new RenderIndicator().enabled).toBe(false);
});

it("counts renders only when enabled", () => {
  const off = new RenderIndicator(false);
  off.onRender();
  expect(off.counter).toBe(0);

  const on = new RenderIndicator(true);
  on.onRender();
  on.onRender();
  expect(on.counter).toBe(2);
  expect(on.text.text).toBe("1");
  on.reset();
  expect(on.counter).toBe(0);
});
