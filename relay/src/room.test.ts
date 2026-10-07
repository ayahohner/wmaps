import * as Y from "yjs";
import * as syncProtocol from "y-protocols/sync";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import { describe, expect, it } from "vitest";
import { MESSAGE_AWARENESS, MESSAGE_QUERY_AWARENESS, MESSAGE_SYNC, YRoom, trackClients, type Conn } from "./room";

function fakeConn() {
  const sent: Uint8Array[] = [];
  let clients: Record<number, number> = {};
  const conn: Conn = {
    send: (d) => sent.push(d),
    clients: () => clients,
    setClients: (c) => (clients = c),
  };
  return { conn, sent, types: () => sent.map((m) => m[0]) };
}

function frame(type: number, write: (e: encoding.Encoder) => void) {
  const e = encoding.createEncoder();
  encoding.writeVarUint(e, type);
  write(e);
  return encoding.toUint8Array(e);
}

function awarenessUpdate(entries: [number, number, string][]) {
  const e = encoding.createEncoder();
  encoding.writeVarUint(e, entries.length);
  for (const [id, clock, state] of entries) {
    encoding.writeVarUint(e, id);
    encoding.writeVarUint(e, clock);
    encoding.writeVarString(e, state);
  }
  return encoding.toUint8Array(e);
}

describe("YRoom", () => {
  it("greets a newcomer with sync step 1 and asks others for cursors", () => {
    const a = fakeConn();
    const b = fakeConn();
    const room = new YRoom(() => [a.conn, b.conn]);
    room.join(b.conn);
    expect(b.types()).toEqual([MESSAGE_SYNC]);
    expect(a.types()).toEqual([MESSAGE_QUERY_AWARENESS]);
  });

  it("applies edits, relays them to others, and reports changes", () => {
    const a = fakeConn();
    const b = fakeConn();
    let changes = 0;
    const room = new YRoom(() => [a.conn, b.conn], () => changes++);
    const client = new Y.Doc();
    client.getText("t").insert(0, "hi");
    const update = Y.encodeStateAsUpdate(client);
    room.receive(a.conn, frame(MESSAGE_SYNC, (e) => syncProtocol.writeUpdate(e, update)));
    expect(room.doc.getText("t").toString()).toBe("hi");
    expect(a.sent).toHaveLength(0);
    expect(b.types()).toEqual([MESSAGE_SYNC]);
    expect(changes).toBe(1);
  });

  it("answers sync step 1 with step 2", () => {
    const a = fakeConn();
    const room = new YRoom(() => [a.conn]);
    room.receive(a.conn, frame(MESSAGE_SYNC, (e) => syncProtocol.writeSyncStep1(e, new Y.Doc())));
    const d = decoding.createDecoder(a.sent[0]);
    expect(decoding.readVarUint(d)).toBe(MESSAGE_SYNC);
    expect(decoding.readVarUint(d)).toBe(syncProtocol.messageYjsSyncStep2);
  });

  it("round-trips a snapshot without broadcasting the load", () => {
    const a = fakeConn();
    const first = new YRoom(() => []);
    first.doc.getText("t").insert(0, "saved");
    const second = new YRoom(() => [a.conn]);
    second.load(first.snapshot());
    second.load(undefined);
    expect(second.doc.getText("t").toString()).toBe("saved");
    expect(a.sent).toHaveLength(0);
  });

  it("relays cursors and clears them when their connection leaves", () => {
    const a = fakeConn();
    const b = fakeConn();
    const room = new YRoom(() => [a.conn, b.conn]);
    const update = awarenessUpdate([[7, 3, '{"user":"x"}']]);
    room.receive(a.conn, frame(MESSAGE_AWARENESS, (e) => encoding.writeVarUint8Array(e, update)));
    expect(b.types()).toEqual([MESSAGE_AWARENESS]);
    expect(a.conn.clients()).toEqual({ 7: 3 });

    room.leave(a.conn);
    const d = decoding.createDecoder(b.sent[1]);
    expect(decoding.readVarUint(d)).toBe(MESSAGE_AWARENESS);
    expect(trackClients({ 7: 3 }, decoding.readVarUint8Array(d))).toEqual({});
    room.leave(a.conn);
    expect(b.sent).toHaveLength(2);
  });

  it("ignores unknown message types", () => {
    const a = fakeConn();
    const room = new YRoom(() => [a.conn]);
    room.receive(a.conn, frame(42, () => {}));
    expect(a.sent).toHaveLength(0);
  });
});

describe("trackClients", () => {
  it("adds, updates and removes clients", () => {
    const update = awarenessUpdate([[1, 5, "{}"], [2, 9, "null"]]);
    expect(trackClients({ 1: 4, 2: 8 }, update)).toEqual({ 1: 5 });
  });
});
