import * as Y from "yjs";
import * as syncProtocol from "y-protocols/sync";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";

/**
 * One map's shared document, independent of the Workers runtime so it can be
 * unit tested. Speaks the y-protocols wire format used by
 * src/sync/SyncProvider.ts: a varUint message type, then the payload.
 */

export const MESSAGE_SYNC = 0;
export const MESSAGE_AWARENESS = 1;
export const MESSAGE_QUERY_AWARENESS = 3;

/** A client connection. Must be the same object for the same socket. */
export interface Conn {
  send(data: Uint8Array): void;
  /** Awareness clientID -> last clock seen on this connection. */
  clients(): Record<number, number>;
  setClients(clients: Record<number, number>): void;
}

const LOAD = Symbol("load");

export class YRoom {
  readonly doc = new Y.Doc();

  constructor(
    private readonly conns: () => Conn[],
    private readonly onChange: () => void = () => {}
  ) {
    this.doc.on("update", (update: Uint8Array, origin: unknown) => {
      if (origin === LOAD) return;
      this.broadcast(encode(MESSAGE_SYNC, (e) => syncProtocol.writeUpdate(e, update)), origin);
      this.onChange();
    });
  }

  load(snapshot: Uint8Array | undefined) {
    if (snapshot) Y.applyUpdate(this.doc, snapshot, LOAD);
  }

  snapshot(): Uint8Array {
    return Y.encodeStateAsUpdate(this.doc);
  }

  join(conn: Conn) {
    conn.send(encode(MESSAGE_SYNC, (e) => syncProtocol.writeSyncStep1(e, this.doc)));
    // Ask everyone else to re-announce, so the newcomer sees their cursors.
    this.broadcast(encode(MESSAGE_QUERY_AWARENESS, () => {}), conn);
  }

  receive(conn: Conn, data: Uint8Array) {
    const decoder = decoding.createDecoder(data);
    const type = decoding.readVarUint(decoder);
    if (type === MESSAGE_SYNC) this.receiveSync(conn, decoder);
    else if (type === MESSAGE_AWARENESS) this.receiveAwareness(conn, data, decoder);
  }

  /** Tells the others that this connection's users are gone. */
  leave(conn: Conn) {
    const entries = Object.entries(conn.clients());
    conn.setClients({});
    if (entries.length === 0) return;
    const update = encoding.createEncoder();
    encoding.writeVarUint(update, entries.length);
    for (const [id, clock] of entries) {
      encoding.writeVarUint(update, Number(id));
      encoding.writeVarUint(update, clock + 1);
      encoding.writeVarString(update, "null");
    }
    const payload = encoding.toUint8Array(update);
    this.broadcast(encode(MESSAGE_AWARENESS, (e) => encoding.writeVarUint8Array(e, payload)), conn);
  }

  private receiveSync(conn: Conn, decoder: decoding.Decoder) {
    const reply = encoding.createEncoder();
    encoding.writeVarUint(reply, MESSAGE_SYNC);
    syncProtocol.readSyncMessage(decoder, reply, this.doc, conn);
    if (encoding.length(reply) > 1) conn.send(encoding.toUint8Array(reply));
  }

  private receiveAwareness(conn: Conn, data: Uint8Array, decoder: decoding.Decoder) {
    conn.setClients(trackClients(conn.clients(), decoding.readVarUint8Array(decoder)));
    this.broadcast(data, conn);
  }

  private broadcast(message: Uint8Array, except: unknown) {
    for (const conn of this.conns()) {
      if (conn !== except) conn.send(message);
    }
  }
}

/** Reads an awareness update and returns the clients still present. */
export function trackClients(
  known: Record<number, number>,
  update: Uint8Array
): Record<number, number> {
  const clients = { ...known };
  const decoder = decoding.createDecoder(update);
  const count = decoding.readVarUint(decoder);
  for (let i = 0; i < count; i++) {
    const id = decoding.readVarUint(decoder);
    const clock = decoding.readVarUint(decoder);
    const removed = decoding.readVarString(decoder) === "null";
    if (removed) delete clients[id];
    else clients[id] = clock;
  }
  return clients;
}

function encode(type: number, write: (e: encoding.Encoder) => void): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, type);
  write(encoder);
  return encoding.toUint8Array(encoder);
}
