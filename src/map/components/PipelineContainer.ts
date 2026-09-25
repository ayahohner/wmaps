import { Graphics } from "pixi.js";

export function PipelineContainer(width: number) {
  let rectangle = new Graphics();
  rectangle.rect(0, 2, width, 20);
  rectangle.fill({ color: 0xffffff, alpha: 0.1 });
  rectangle.stroke({ width: 1, color: 0x000000, alpha: 1, alignment: 1 });
  return rectangle;
}
