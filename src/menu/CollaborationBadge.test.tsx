import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { collaboration } from "../sync/presence";
import { CollaborationBadge } from "./CollaborationBadge";

it("shows only names in the hover panel and provides accessible save status", async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  collaboration.status = "saved";
  collaboration.users = [
    { id: 123, name: "Quiet Otter", color: "#30bced", self: true },
    { id: 456, name: "Calm Finch", color: "#ee6352", self: false },
  ];
  await act(async () => root.render(<CollaborationBadge />));
  const button = host.querySelector("button")!;
  expect(button.textContent).toBe("2");
  expect(button.getAttribute("aria-label")).toBe("People");
  expect(host.querySelector(".sync-light")?.getAttribute("aria-label")).toBe(
    "Saved",
  );
  await act(async () => button.focus());
  const panel = host.querySelector(".collaboration-popover")!;
  expect(panel.textContent).toBe("Quiet OtterCalm Finch");
  await act(async () =>
    button.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    ),
  );
  expect(host.querySelector(".collaboration-popover")).toBeNull();
  await act(async () => button.click());
  expect(host.querySelector(".collaboration-popover")).not.toBeNull();
  await act(async () =>
    document.body.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true }),
    ),
  );
  expect(host.querySelector(".collaboration-popover")).toBeNull();
  await act(async () => root.unmount());
  host.remove();
});

it("keeps the badge in the project menu alongside navigation and sharing", async () => {
  const { ProjectMenu } = await import("./index");
  localStorage.setItem("shouldShowHelp", "false");
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<ProjectMenu />));
  expect(host.querySelector('[aria-label="People"]')).not.toBeNull();
  expect(host.textContent).toContain("Share");
  expect(host.querySelector('[aria-current="page"]')?.textContent).toBe("Map");
  await act(async () => root.unmount());
  host.remove();
});

it("keeps the menu mounted on a first visit and after dismissing welcome help", async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const { ProjectMenu } = await import("./index");
  localStorage.removeItem("shouldShowHelp");
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<ProjectMenu />));
    expect(host.querySelector("nav")).not.toBeNull();
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain("Welcome to MapTogether Alpha");
    const getStarted = dialog!.querySelector("button")!;
    await act(async () => getStarted.click());
    expect(localStorage.getItem("shouldShowHelp")).toBe("false");
    expect(host.querySelector('[aria-label="New map"]')).not.toBeNull();
    expect(host.textContent).toContain("Share");
  } finally {
    await act(async () => root.unmount());
    host.remove();
    localStorage.removeItem("shouldShowHelp");
  }
});
