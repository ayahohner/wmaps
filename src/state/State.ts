import { proxy, subscribe } from "valtio/vanilla";
import { proxySet } from "valtio/utils";

import { ComponentT } from "../map/components/types";
import { graph, NodeAttributes, updateComponentPositionOffset } from "./Graph";

import { replaceCoordinates } from "../editor/Editor";

/** Plain coordinate pair. Kept as a plain object (not a Pixi Point) so it is
 *  safe to store in valtio state — valtio deep-proxies class instances and
 *  mutates the originals, which corrupts live Pixi objects. */
export interface PointLike {
  x: number;
  y: number;
}

export interface StateT {
  editor: { editorText: string };
  linking: {
    isLinkModeEnabled: boolean;
    /** Node key of the link source. Stored as a string key — never store a
     *  live Pixi component here (see note on PointLike). */
    initialLinkTarget: ComponentT["nodeKey"] | undefined;
  };
  selection: {
    selectionItems: Set<ComponentT["nodeKey"]>;
  };
  selectDrag: {
    isSelecting: boolean;
    selectionStartPoint: PointLike | undefined;
    selectionCurrentPoint: PointLike | undefined;
  };
  translateDrag: {
    isTranslating: boolean;
    translationStartPoint: PointLike | undefined;
    translationLastPoint: PointLike | undefined;
    translationCurrentPoint: PointLike | undefined;
  };
}

// STORE
export const state = proxy<StateT>({
  editor: { editorText: "" },
  linking: {
    initialLinkTarget: undefined,
    isLinkModeEnabled: false,
  },
  selection: { selectionItems: proxySet() },
  selectDrag: {
    isSelecting: false,
    selectionStartPoint: undefined,
    selectionCurrentPoint: undefined,
  },
  translateDrag: {
    isTranslating: false,
    translationStartPoint: undefined,
    translationLastPoint: undefined,
    translationCurrentPoint: undefined,
  },
});

// ACTIONS
export const setEditorText = (text: string) => {
  state.editor.editorText = text;
};

export const setInitialLinkTarget = (
  nodeKey: ComponentT["nodeKey"] | undefined
) => {
  state.linking.initialLinkTarget = nodeKey;
};

export const setIsLinkModeEnabled = (enabled: boolean) => {
  state.linking.isLinkModeEnabled = enabled;
};

export const startPotentialSelect = (location: PointLike) => {
  state.selectDrag.selectionStartPoint = location;
};

export const startSelecting = (location: PointLike) => {
  state.selectDrag.isSelecting = true;
  state.selectDrag.selectionCurrentPoint = location;
};

export const stopSelecting = () => {
  state.selectDrag.isSelecting = false;
  state.selectDrag.selectionStartPoint = undefined;
  state.selectDrag.selectionCurrentPoint = undefined;
};

export const nodeInSelection = (
  nodeKey: string,
  nodeAttributes: NodeAttributes
) => {
  let startX = state.selectDrag.selectionStartPoint!.x;
  let startY = state.selectDrag.selectionStartPoint!.y;
  let curX = state.selectDrag.selectionCurrentPoint!.x;
  let curY = state.selectDrag.selectionCurrentPoint!.y;
  let [left, right] = startX <= curX ? [startX, curX] : [curX, startX];
  let [bottom, top] = startY <= curY ? [startY, curY] : [curY, startY];

  let nodeX = nodeAttributes.coordinates.x;
  let nodeY = nodeAttributes.coordinates.y;
  return nodeX >= left && nodeX <= right && nodeY >= bottom && nodeY <= top;
};

export const updateSelectionPoint = (location: PointLike) => {
  state.selectDrag.selectionCurrentPoint = location;
  replaceSelection(graph.filterNodes(nodeInSelection));
};

export const addUpdateSelectionPoint = (location: PointLike) => {
  state.selectDrag.selectionCurrentPoint = location;
  addToSelection(graph.filterNodes(nodeInSelection));
};

export const clearSelection = () => {
  state.selection.selectionItems.clear();
};

export const removeFromSelection = (item: ComponentT["nodeKey"]) =>
  state.selection.selectionItems.delete(item);

export const addToSelection = (items: ComponentT["nodeKey"][]) => {
  items.forEach((item) => {
    state.selection.selectionItems.add(item);
  });
};

export const replaceSelection = (newSelection: ComponentT["nodeKey"][]) => {
  state.selection.selectionItems.clear();
  newSelection.forEach((item) => state.selection.selectionItems.add(item));
};

export const xorSelection = (inputSelection: ComponentT["nodeKey"][]) => {
  inputSelection.forEach((item) => {
    if (state.selection.selectionItems.has(item)) {
      state.selection.selectionItems.delete(item);
    } else {
      state.selection.selectionItems.add(item);
    }
  });
};

export const startPotentialTranslation = (location: PointLike) => {
  state.translateDrag.translationStartPoint = location;
};

export const startTranslation = (location: PointLike) => {
  state.translateDrag.isTranslating = true;
  state.translateDrag.translationLastPoint = location;
  state.translateDrag.translationCurrentPoint = location;
};

export const stopTranslation = () => {
  if (state.translateDrag.translationCurrentPoint) {
    state.selection.selectionItems.forEach((item) => {
      const coords = graph.getNodeAttribute(item, "coordinates");
      replaceCoordinates(item, coords.x, coords.y); //->Editor
    });
  }

  state.translateDrag.isTranslating = false;
  state.translateDrag.translationStartPoint = undefined;
  state.translateDrag.translationLastPoint = undefined;
  state.translateDrag.translationCurrentPoint = undefined;
};

export const updateTranslationPoint = (location: PointLike) => {
  state.translateDrag.translationCurrentPoint = location;

  state.selection.selectionItems.forEach((item) => {
    updateComponentPositionOffset(
      item,
      state.translateDrag.translationCurrentPoint!.x -
        state.translateDrag.translationLastPoint!.x,
      state.translateDrag.translationCurrentPoint!.y -
        state.translateDrag.translationLastPoint!.y
    );
  });
  state.translateDrag.translationLastPoint =
    state.translateDrag.translationCurrentPoint;
};

export { subscribe };
