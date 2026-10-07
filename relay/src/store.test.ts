import * as Y from "yjs";
import * as syncProtocol from "y-protocols/sync";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import { describe, expect, it } from "vitest";
import { MESSAGE_SYNC, MapStore } from "./store";

const conn = () => {
  const sent: Uint8Array[] = [];
  return { sent, send: (d: Uint8Array) => void sent.push(d) };
};
const frame = (type: number, write: (e: encoding.Encoder) => void) => {
  const e = encoding.createEncoder();
  encoding.writeVarUint(e, type);
  write(e);
  return encoding.toUint8Array(e);
};

describe("MapStore", () => {
  it("starts a sync with each client", () => {
    const c = conn();
    new MapStore().join(c);
    const d = decoding.createDecoder(c.sent[0]);
    expect(decoding.readVarUint(d)).toBe(MESSAGE_SYNC);
    expect(decoding.readVarUint(d)).toBe(syncProtocol.messageYjsSyncStep1);
  });

  it("saves client edits without echoing them, and reports changes", () => {
    let changes = 0;
    const store = new MapStore(() => changes++);
    const client = new Y.Doc();
    client.getText("t").insert(0, "hi");
    const c = conn();
    store.receive(c, frame(MESSAGE_SYNC, (e) => syncProtocol.writeUpdate(e, Y.encodeStateAsUpdate(client))));
    expect(store.doc.getText("t").toString()).toBe("hi");
    expect(c.sent).toHaveLength(0);
    expect(changes).toBe(1);
  });

  it("answers sync step 1 and ignores other message types", () => {
    const store = new MapStore();
    const c = conn();
    store.receive(c, frame(MESSAGE_SYNC, (e) => syncProtocol.writeSyncStep1(e, new Y.Doc())));
    store.receive(c, frame(1, () => {}));
    expect(c.sent).toHaveLength(1);
  });

  it("round-trips a snapshot without reporting the load", () => {
    const first = new MapStore();
    first.doc.getText("t").insert(0, "saved");
    let changes = 0;
    const second = new MapStore(() => changes++);
    second.load(first.snapshot());
    second.load(undefined);
    expect(second.doc.getText("t").toString()).toBe("saved");
    expect(changes).toBe(0);
  });
});
