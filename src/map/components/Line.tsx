import { Graphics } from "pixi.js";

import { LineT } from "./types";

export const Line = (
  componentAx: number,
  componentAy: number,
  componentBx: number,
  componentBy: number,
  nodeKey: string
): LineT => {
  const g = new Graphics() as LineT;

  g.moveTo(componentAx, componentAy);
  g.lineTo(componentBx, componentBy);
  g.stroke({ width: 1, color: 0x000000, alpha: 1 });

  g.zIndex = -1;
  g.nodeKey = nodeKey;

  g.updateLine = (
    componentAx: number,
    componentAy: number,
    componentBx: number,
    componentBy: number
  ) => {
    g.clear();
    g.moveTo(componentAx, componentAy);
    g.lineTo(componentBx, componentBy);
    g.stroke({ width: 1, color: 0x000000, alpha: 1 });
  };

  g.on("removed", () => g.destroy());

  return g;
};
