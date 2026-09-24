import { createRoot } from "react-dom/client";

import MapSingleton from "../map/components/MapSingleton";

import { editorView } from "../editor/Editor";
import { ProjectMenu } from "../menu";

import { setEditorText } from "../state/State";

import { initializeHistoryMonkeypatch } from "./utilities/HistoryMonkeypatch";
import { initializePanelResizer } from "./components/PanelResizer";
import { initializeUserEvents } from "./UserEvents";

import "./index.css";

/**
 * Principles,
 * 1. One way state binding
 * mark each place in app with a state change
 * Make it update data structure
 * Make data structure attatch component to app on creation
 * make data structure rerender on change
 *
 *
 * Order of initialization:
 * 1. Graph
 * 2. State
 * 3. Editor
 * 4. App
 */

initializeHistoryMonkeypatch();

initializeUserEvents();

const run = async (elementId: string) => {
  // Pixi v8 initializes asynchronously; wait for it before touching the
  // renderer or appending the canvas.
  await MapSingleton.ready;

  initializePanelResizer(document.getElementById("editorContainer"));

  setEditorText(editorView.state.doc.toString());

  // Bind app view to root html element
  document.getElementById(elementId)?.appendChild(MapSingleton.canvas);

  MapSingleton.handleResize();

  // Render once even if graph is empty
  MapSingleton.dirty = true;

  createRoot(document.getElementById("projectMenu")!).render(<ProjectMenu />);
};

run("map");
