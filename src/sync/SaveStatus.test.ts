import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SaveStatus } from "./SaveStatus";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
function setup() {
  const send = vi.fn();
  const report = vi.fn();
  const status = new SaveStatus(send, report);
  status.loaded();
  return { status, send, report };
}

describe("save receipts", () => {
  it("stays saving until a matching durable receipt and ignores stale receipts", () => {
    const { status, send, report } = setup();
    vi.advanceTimersByTime(500);
    expect(send).toHaveBeenLastCalledWith({ type: "save", id: 1 });
    status.receive({ type: "saved", id: 99 });
    expect(report).toHaveBeenLastCalledWith("saving");
    status.changed();
    status.receive({ type: "saved", id: 1 });
    expect(report).not.toHaveBeenCalledWith("saved");
    vi.advanceTimersByTime(500);
    status.receive({ type: "saved", id: 2 });
    expect(report).toHaveBeenLastCalledWith("saved");
    status.destroy();
  });

  it("reports failed and timed-out saves and recovers on retry", () => {
    const { status, send, report } = setup();
    vi.advanceTimersByTime(500);
    status.receive({ type: "save-error", id: 1 });
    expect(report).toHaveBeenLastCalledWith("error");
    vi.advanceTimersByTime(5_000 + 15_000);
    expect(send).toHaveBeenCalledTimes(2);
    expect(report).toHaveBeenLastCalledWith("error");
    vi.advanceTimersByTime(5_000);
    status.receive({ type: "saved", id: 3 });
    expect(report).toHaveBeenLastCalledWith("saved");
    status.destroy();
  });

  it("cancels pending receipts on disconnect and rechecks after loading", () => {
    const { status, send, report } = setup();
    vi.advanceTimersByTime(500);
    status.disconnected();
    status.changed();
    status.receive({ type: "saved", id: 1 });
    vi.advanceTimersByTime(20_000);
    expect(send).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenLastCalledWith("disconnected");
    status.loaded();
    status.loaded();
    vi.advanceTimersByTime(500);
    status.receive({ type: "saved", id: 2 });
    expect(report).toHaveBeenLastCalledWith("saved");
    expect(status.receive({ type: "welcome" })).toBe(false);
    status.destroy();
  });
});
