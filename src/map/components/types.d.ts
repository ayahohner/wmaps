import { Graphics, Ticker } from "pixi.js";

export type ExtendedGraphics = Graphics & {
  nodeKey: string;
};

export type ComponentT = ExtendedGraphics;

export type LineT = ExtendedGraphics & {
  ticker?: Ticker;
  updateLine: Function;
};
