import { Container, Graphics, BitmapText } from "pixi.js";

export class RenderIndicator {
  /** Root container — Graphics no longer allows children in Pixi v8. */
  r = new Container();
  private background = new Graphics();
  filled = true;
  counter = 0;
  text: BitmapText;

  constructor() {
    this.drawBackground();

    // Note: the "TitleFont" bitmap font is installed by MapSingleton during
    // setup; BitmapText resolves the font at render time.
    this.text = new BitmapText({
      text: this.counter.toString(),
      style: {
        fontFamily: "TitleFont",
        fontSize: 16,
      },
    });
    this.r.addChild(this.background, this.text);
  }

  private drawBackground() {
    this.background.clear();
    this.background.rect(0, 0, 20, 20);
    this.background.fill({ color: this.filled ? 0xff0000 : 0xffffff, alpha: 1 });
  }

  reset() {
    this.counter = 0;
  }

  onRender() {
    this.drawBackground();
    this.text.text = this.counter.toString();
    this.filled = !this.filled;
    this.counter++;
  }
}
