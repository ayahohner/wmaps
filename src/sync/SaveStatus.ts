export type SyncStatus =
  | "connecting"
  | "saving"
  | "saved"
  | "disconnected"
  | "error";

/** A receipt confirms only edits sent before its checkpoint, including deletions. */
export class SaveStatus {
  private revision = 0;
  private nextId = 0;
  private pending?: { id: number; revision: number };
  private timer?: ReturnType<typeof setTimeout>;
  private ready = false;

  constructor(
    private readonly send: (message: { type: "save"; id: number }) => void,
    private readonly report: (status: SyncStatus) => void,
  ) {}

  loaded() {
    if (this.ready) return;
    this.ready = true;
    this.changed();
  }

  changed() {
    this.revision++;
    if (!this.ready) return;
    this.report("saving");
    this.schedule();
  }

  receive(message: { type?: string; id?: number }) {
    if (message.type !== "saved" && message.type !== "save-error") return false;
    if (!this.pending || message.id !== this.pending.id) return true;
    const revision = this.pending.revision;
    this.clear();
    if (message.type === "save-error") this.failed();
    else if (revision === this.revision) this.report("saved");
    else this.schedule();
    return true;
  }

  disconnected() {
    this.ready = false;
    this.clear();
    this.report("disconnected");
  }

  destroy() {
    this.ready = false;
    this.clear();
  }

  private schedule(delay = 500) {
    if (this.timer || this.pending || !this.ready) return;
    this.timer = setTimeout(() => {
      this.pending = { id: ++this.nextId, revision: this.revision };
      this.timer = setTimeout(() => {
        this.clear();
        this.failed();
      }, 15_000);
      this.send({ type: "save", id: this.pending.id });
    }, delay);
  }

  private failed() {
    this.report("error");
    this.schedule(5_000);
  }

  private clear() {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.pending = undefined;
  }
}
