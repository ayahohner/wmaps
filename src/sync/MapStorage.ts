import type * as Y from "yjs";
import * as syncProtocol from "y-protocols/sync";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";

export const MESSAGE_SYNC = 0;

/**
 * Loads and saves the map through the relay's Durable Object, using the Yjs
 * sync protocol over the relay socket's binary frames. Each client uploads
 * its own edits; edits that arrived from peers are theirs to upload.
 */
export class MapStorage {
  /** True once the saved copy has been applied. */
  loaded = false;

  constructor(
    readonly doc: Y.Doc,
    private readonly send: (data: Uint8Array) => void,
    private readonly isFromPeer: (origin: unknown) => boolean
  ) {
    doc.on("update", this.onUpdate);
  }

  /** Call when the relay socket opens: exchanges whatever either side lacks. */
  start() {
    this.send(this.encode((e) => syncProtocol.writeSyncStep1(e, this.doc)));
  }

  receive(data: Uint8Array) {
    const decoder = decoding.createDecoder(data);
    if (decoding.readVarUint(decoder) !== MESSAGE_SYNC) return;
    const reply = encoding.createEncoder();
    encoding.writeVarUint(reply, MESSAGE_SYNC);
    const kind = syncProtocol.readSyncMessage(decoder, reply, this.doc, this);
    if (kind === syncProtocol.messageYjsSyncStep2) this.loaded = true;
    if (encoding.length(reply) > 1) this.send(encoding.toUint8Array(reply));
  }

  destroy() {
    this.doc.off("update", this.onUpdate);
  }

  private onUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === this || this.isFromPeer(origin)) return;
    this.send(this.encode((e) => syncProtocol.writeUpdate(e, update)));
  };

  private encode(write: (e: encoding.Encoder) => void) {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    write(encoder);
    return encoding.toUint8Array(encoder);
  }
}
