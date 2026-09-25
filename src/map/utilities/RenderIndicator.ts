import { Graphics, BitmapText } from "pixi.js";

export class RenderIndicator {
  r = new Graphics();
  filled = true;
  counter = 0;
  text: BitmapText;

  constructor() {
    this.r.rect(0, 0, 20, 20);
    this.r.fill({ color: 0xff0000, alpha: 1 });

    // Note: the "TitleFont" bitmap font is installed by MapSingleton during
    // setup; BitmapText resolves the font at render time.
    this.text = new BitmapText({
      text: this.counter.toString(),
      style: {
        fontFamily: "TitleFont",
        fontSize: 16,
      },
    });
    this.r.addChild(this.text);
  }

  reset() {
    this.counter = 0;
  }

  onRender() {
    this.r.clear();
    this.r.rect(0, 0, 20, 20);
    this.r.fill({ color: this.filled ? 0xff0000 : 0xffffff, alpha: 1 });
    this.text.text = this.counter.toString();
    this.filled = !this.filled;
    this.counter++;
  }
}
