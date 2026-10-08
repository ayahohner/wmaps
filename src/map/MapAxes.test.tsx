import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { MapAxes } from "./MapAxes";

it("labels each evolution stage with its alternatives and notches the divisions", async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement("div");
  document.body.append(host);
  await act(async () => createRoot(host).render(<MapAxes />));
  const notches = [...host.querySelectorAll<HTMLElement>(".axis-x-notch")];
  expect(notches.map((n) => n.style.left)).toEqual(["17.4%", "40%", "70%"]);
  const labels = [...host.querySelectorAll(".axis-x-label")];
  expect(labels.map((l) => l.firstChild!.textContent)).toEqual([
    "Genesis",
    "Custom",
    "Product",
    "Commodity",
  ]);
  expect(labels[0].querySelector('[role="tooltip"]')!.textContent).toBe(
    "ActivitiesGenesisPracticesNovelDataUnmodelledKnowledgeConcept",
  );
  expect(host.querySelector(".axis-y-label")!.textContent).toBe("Visibility");
});
