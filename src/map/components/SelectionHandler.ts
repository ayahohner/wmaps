import { Graphics } from "pixi.js";

import { state, subscribe } from "../../state/State";
import MapSingleton from "./MapSingleton";

export const SelectionHandler = () => {
  let component = new Graphics();

  let unsubscribe = subscribe(state.selectDrag, () => {
    if (
      state.selectDrag.isSelecting &&
      state.selectDrag.selectionStartPoint &&
      state.selectDrag.selectionCurrentPoint
    ) {
      component.clear();
      component.rect(
        0,
        0,
        state.selectDrag.selectionCurrentPoint.x -
          state.selectDrag.selectionStartPoint.x,
        state.selectDrag.selectionCurrentPoint.y -
          state.selectDrag.selectionStartPoint.y
      );
      component.fill({ color: 0x4597f7, alpha: 0.1 });
      component.stroke({ width: 1, color: 0x4597f7, alpha: 1 });
      component.x = state.selectDrag.selectionStartPoint.x;
      component.y = state.selectDrag.selectionStartPoint.y;
      component.visible = true;
      MapSingleton.dirty = true;
    }
    if (!state.selectDrag.isSelecting) {
      component.visible = false;
      MapSingleton.dirty = true;
    }
  });

  component.on("removed", () => {
    unsubscribe();
  });

  return component;
};
