import { describe, expect, it } from "vitest";
import { Assembler, split } from "./chunks";

const bytes = (n: number) => Uint8Array.from({ length: n }, (_, i) => i % 251);

describe("chunks", () => {
  it("sends small messages whole", () => {
    const frames = split(bytes(10), 1);
    expect(frames).toHaveLength(1);
    expect(new Assembler().push(frames[0])).toEqual(bytes(10));
  });

  it("splits and reassembles large messages", () => {
    const message = bytes(50);
    const frames = split(message, 7, 16);
    expect(frames).toHaveLength(4);
    const assembler = new Assembler();
    expect(frames.slice(0, 3).map((f) => assembler.push(f))).toEqual([null, null, null]);
    expect(assembler.push(frames[3])).toEqual(message);
  });

  it("drops an unfinished message when a new one starts", () => {
    const assembler = new Assembler();
    assembler.push(split(bytes(40), 1, 16)[0]);
    const next = split(bytes(32), 2, 16);
    expect(assembler.push(next[0])).toBeNull();
    expect(assembler.push(next[1])).toEqual(bytes(32));
  });
});
