import { Graphics } from "pixi.js";

export function Rectangle(x: number, y: number, width: number, height: number) {
  let rectangle = new Graphics();
  rectangle.rect(0, 0, width, height);
  rectangle.fill({ color: 0xf0f0f0, alpha: 1 });
  rectangle.x = x;
  rectangle.y = y;
  return rectangle;
}
