import throttle from "lodash/throttle";
import { Application, Container, BitmapFont, Point } from "pixi.js";
import { appendText, renameComponent } from "../../editor/Editor";

import { graph, rerenderGraph } from "../../state/Graph";
import { FloatingTextInput, OnSubmitHandler } from "./FloatingTextInput";

import { RenderIndicator } from "../utilities/RenderIndicator";
import {
  clearSelection,
  replaceSelection,
  startPotentialSelect,
  startSelecting,
  state,
  stopSelecting,
  updateSelectionPoint,
  xorSelection,
  addUpdateSelectionPoint,
  startPotentialTranslation,
  stopTranslation,
  startTranslation,
  updateTranslationPoint,
} from "../../state/State";

import { SelectionHandler } from "./SelectionHandler";
import { ComponentT, LineT } from "./types";

class MapSingleton extends Application {
  static _instance: MapSingleton;
  static _parentElement: HTMLDivElement;

  /** Resolves once the Pixi application has been initialized. */
  readonly ready!: Promise<void>;

  renderIndicator = new RenderIndicator();

  graphContainer = new Container();
  dirty: boolean = false;

  constructor() {
    super();

    if (MapSingleton._instance) {
      return MapSingleton._instance;
    }

    MapSingleton._parentElement = document.getElementById(
      "map"
    ) as HTMLDivElement;

    MapSingleton._instance = this;

    this.ready = this.initialize();
  }

  private async initialize(): Promise<void> {
    await this.init({
      backgroundColor: 0xf0f0f0,
      antialias: true,
      autoDensity: true,
      // this may introduce coordinate bugs
      resolution: 2,
      resizeTo: MapSingleton._parentElement,
    });

    // Disable automatic rendering: we render manually in the ticker callback
    // below, only when something has changed. (This replaces the old
    // `Application.prototype.render = null` hack from Pixi v6.)
    this.ticker.remove(this.render, this);

    this.setup();
  }

  private setup(): void {
    //Set up custom renderer
    if (import.meta.env.VITE_DEBUG_ENABLED === "true") {
      this.ticker.add(() => {
        // Manually render when something has changed
        if (this.dirty) {
          this.renderIndicator.onRender();
          this.render();
          this.dirty = false;
        }
      });
    } else {
      this.ticker.add(() => {
        if (this.dirty) {
          this.render();
          this.dirty = false;
        }
      });
    }

    // Create a font for usage
    BitmapFont.install({
      name: "TitleFont",
      style: {
        fill: "#000000",
        // supersize font based on dpr
        fontSize: 16 * this.renderer.resolution,
        fontWeight: "normal",
      },
      chars:
        "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789~1234567890!@#$%^&?*-=_+()[]{}<>,./;':\"\\| ",
    });

    // A container to hold all components, lines, text
    this.stage.addChild(this.graphContainer);
    this.graphContainer.sortableChildren = true; // make zIndex work
    this.stage.addChild(SelectionHandler());

    // Render indicator
    if (import.meta.env.VITE_DEBUG_ENABLED === "true") {
      this.stage.addChild(this.renderIndicator.r);
    }

    this.canvas.addEventListener("mousedown", (e: MouseEvent) => {
      const cursorPosition = new Point(e.offsetX, e.offsetY);

      const element = this.hitTest(cursorPosition);

      if (e.detail % 1 === 0) {
        /* canvas */
        if (!element) {
          if (!e.shiftKey) {
            clearSelection();
          }

          startPotentialSelect(cursorPosition);
          this.canvas.addEventListener(
            "mousemove",
            this.handleSelectDrag,
            false
          );
          /* component */
        } else if (element.nodeKey) {
          if (!e.shiftKey) {
            if (!state.selection.selectionItems.has(element.nodeKey)) {
              replaceSelection([element.nodeKey]);
            }
            // start potential drag
            startPotentialTranslation(cursorPosition);
            this.canvas.addEventListener(
              "mousemove",
              this.handleSelectionTranslate,
              false
            );
          } else {
            xorSelection([element.nodeKey]);
          }
        }
      }

      if (e.detail % 2 === 0) {
        if (!element) {
          const mouseX = e.offsetX;
          const mouseY = e.offsetY;

          const handleInputSubmit: OnSubmitHandler = (e) => {
            const target = e.target as HTMLInputElement;
            if (!graph.hasNode(target.value)) {
              // <-Graph
              const coords = this.rendererToWardleyCoords(mouseX, mouseY);
              // TODO: This string should come from Parser
              appendText(`\n${target.value} [${coords[1]},${coords[0]}]`); // ->Editor
            } else {
              console.error(
                "ComponentRenameError: the new name for the component already exists in the map."
              );
            }
          };

          FloatingTextInput(
            MapSingleton._parentElement,
            mouseX,
            mouseY,
            handleInputSubmit
          ); // ->UI
        } else if (element && element.nodeKey) {
          const handleInputSubmit: OnSubmitHandler = (e) => {
            const target = e.target as HTMLInputElement;
            if (!graph.hasNode(target.value)) {
              // <-Graph
              renameComponent(element.nodeKey, target.value); // ->Editor
            }
          };

          FloatingTextInput(
            MapSingleton._parentElement as HTMLDivElement,
            cursorPosition.x,
            cursorPosition.y,
            handleInputSubmit,
            element.nodeKey
          ); // ->UI
        }
      }
    });
  }

  /**
   * Manual hit test: Pixi v8 removed `renderer.plugins.interaction.hitTest`,
   * so find the topmost component (by zIndex, then child order) whose bounds
   * contain the point. Connection lines are excluded: their nodeKey is an
   * edge key (e.g. "A->B"), not a node, and their rectangular bounds would
   * otherwise swallow clicks on empty space.
   */
  private hitTest(p: Point): ComponentT | undefined {
    // Highest zIndex first; on ties prefer later siblings, matching Pixi's
    // paint order (later siblings render on top).
    const ranked = this.graphContainer.children
      .map((child, index) => ({ child, index }))
      .sort(
        (a, b) =>
          (b.child.zIndex ?? 0) - (a.child.zIndex ?? 0) || b.index - a.index
      );
    for (const { child } of ranked) {
      const component = child as ComponentT;
      if (component.nodeKey === undefined) continue;
      if ((component as unknown as LineT).updateLine !== undefined) continue;
      const bounds = component.getBounds();
      if (
        p.x >= bounds.x &&
        p.x <= bounds.x + bounds.width &&
        p.y >= bounds.y &&
        p.y <= bounds.y + bounds.height
      ) {
        return component;
      }
    }
    return undefined;
  }

  handleSelectionTranslate = (e: MouseEvent) => {
    let currentPosition = new Point(e.offsetX, e.offsetY);
    if (state.translateDrag.translationStartPoint) {
      if (
        !state.translateDrag.translationCurrentPoint &&
        Math.abs(
          currentPosition.x - state.translateDrag.translationStartPoint.x
        ) +
          Math.abs(
            currentPosition.y - state.translateDrag.translationStartPoint.y
          ) >=
          3
      ) {
        startTranslation(currentPosition);
      } else if (state.translateDrag.isTranslating) {
        updateTranslationPoint(currentPosition);
      }
    }
  };

  handleSelectDrag = (e: MouseEvent) => {
    let currentPosition = new Point(e.offsetX, e.offsetY);
    if (state.selectDrag.selectionStartPoint) {
      if (
        !state.selectDrag.selectionCurrentPoint &&
        Math.abs(currentPosition.x - state.selectDrag.selectionStartPoint.x) +
          Math.abs(
            currentPosition.y - state.selectDrag.selectionStartPoint.y
          ) >=
          3
      ) {
        startSelecting(currentPosition);
      } else if (state.selectDrag.selectionCurrentPoint) {
        if (e.shiftKey) {
          addUpdateSelectionPoint(currentPosition);
        } else {
          updateSelectionPoint(currentPosition);
        }
      }
    }
  };

  // using window because we want to be able to stop clicking even outside of the canvas.
  handleMouseUp = (e: MouseEvent) => {
    stopSelecting();
    stopTranslation();
    this.canvas.removeEventListener("mousemove", this.handleSelectDrag, false);
    this.canvas.removeEventListener(
      "mousemove",
      this.handleSelectionTranslate,
      false
    );
  };

  // Resize container on window resize
  // (manually place throughout app because ResizerObserver makes flashes)
  handleResize = throttle(() => {
    // The renderer's `resizeTo` only reacts to window resize events, but the
    // panel resizer changes the container's CSS size directly, so resize the
    // renderer explicitly here before rerendering against the new bounds.
    // (This is what the old `this.resize()` call did; in Pixi v8 `resize`
    // is assigned dynamically by the ResizePlugin and isn't in the types,
    // so call `renderer.resize` directly.)
    const parent = MapSingleton._parentElement;
    this.renderer.resize(parent.clientWidth, parent.clientHeight);
    rerenderGraph();
  }, 32);

  wardleyToRendererCoords(x: number, y: number) {
    // `screen` is already in logical (CSS) pixels even with resolution > 1,
    // so no density adjustment is needed (unlike the old `renderer.width`,
    // which was in physical pixels).
    return [(x / 100) * this.screen.width, (1 - y / 100) * this.screen.height];
  }

  rendererToWardleyCoords(x: number, y: number) {
    return [
      ((x / this.screen.width) * 100).toFixed(1),
      (100 - (y / this.screen.height) * 100).toFixed(1),
    ];
  }
}

export default new MapSingleton();
