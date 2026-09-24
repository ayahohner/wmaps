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
import { ComponentT } from "./types";

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
   * contain the point.
   */
  private hitTest(p: Point): ComponentT | undefined {
    const children = [...this.graphContainer.children].sort(
      (a, b) => (b.zIndex ?? 0) - (a.zIndex ?? 0)
    );
    for (const child of children) {
      const component = child as ComponentT;
      if (component.nodeKey === undefined) continue;
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
  // Note: the renderer itself auto-resizes via the `resizeTo` init option,
  // so here we only need to rerender the graph.
  handleResize = throttle(() => {
    rerenderGraph();
  }, 32);

  wardleyToRendererCoords(x: number, y: number) {
    return [
      ((x / 100) * this.screen.width) / this.renderer.resolution,
      ((1 - y / 100) * this.screen.height) / this.renderer.resolution,
    ];
  }

  rendererToWardleyCoords(x: number, y: number) {
    return [
      ((1 / this.screen.width) * this.renderer.resolution * x * 100).toFixed(1),
      (
        100 -
        (1 / this.screen.height) * this.renderer.resolution * y * 100
      ).toFixed(1),
    ];
  }
}

export default new MapSingleton();
