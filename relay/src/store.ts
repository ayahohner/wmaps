import * as Y from "yjs";
import * as syncProtocol from "y-protocols/sync";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";

/**
 * A map's saved copy. Clients run the Yjs sync protocol against it to load
 * the map and to save their edits; it never forwards edits (peers exchange
 * those over WebRTC). Runtime-free so it can be unit tested.
 */

export const MESSAGE_SYNC = 0;

export interface StoreConn {
  send(data: Uint8Array): void;
}

const LOAD = Symbol("load");

export class MapStore {
  readonly doc = new Y.Doc();

  constructor(private readonly onChange: () => void = () => {}) {
    this.doc.on("update", (_update: Uint8Array, origin: unknown) => {
      if (origin !== LOAD) this.onChange();
    });
  }

  load(snapshot: Uint8Array | undefined) {
    if (snapshot) Y.applyUpdate(this.doc, snapshot, LOAD);
  }

  snapshot(): Uint8Array {
    return Y.encodeStateAsUpdate(this.doc);
  }

  /** Starts a sync so the client sends anything the store lacks. */
  join(conn: StoreConn) {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(encoder, this.doc);
    conn.send(encoding.toUint8Array(encoder));
  }

  receive(conn: StoreConn, data: Uint8Array) {
    const decoder = decoding.createDecoder(data);
    if (decoding.readVarUint(decoder) !== MESSAGE_SYNC) return;
    const reply = encoding.createEncoder();
    encoding.writeVarUint(reply, MESSAGE_SYNC);
    syncProtocol.readSyncMessage(decoder, reply, this.doc, conn);
    if (encoding.length(reply) > 1) conn.send(encoding.toUint8Array(reply));
  }
}
