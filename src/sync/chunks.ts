import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";

/**
 * Splits messages for RTCDataChannel, which can't send large messages
 * reliably everywhere. Frame: 0 + message, or 1 + id + index + count + part.
 * Channels are ordered, so parts arrive in sequence.
 */

export const CHUNK_BYTES = 16 * 1024;
const WHOLE = 0;
const PART = 1;

export function split(message: Uint8Array, id: number, size = CHUNK_BYTES): Uint8Array[] {
  if (message.length < size) return [frame(WHOLE, (e) => encoding.writeUint8Array(e, message))];
  const count = Math.ceil(message.length / size);
  return Array.from({ length: count }, (_, index) =>
    frame(PART, (e) => {
      encoding.writeVarUint(e, id);
      encoding.writeVarUint(e, index);
      encoding.writeVarUint(e, count);
      encoding.writeUint8Array(e, message.subarray(index * size, (index + 1) * size));
    })
  );
}

function frame(kind: number, write: (e: encoding.Encoder) => void) {
  const encoder = encoding.createEncoder();
  encoding.writeUint8(encoder, kind);
  write(encoder);
  return encoding.toUint8Array(encoder);
}

/** Reassembles one sender's frames; returns a message once it is complete. */
export class Assembler {
  private parts: Uint8Array[] = [];
  private id = -1;

  push(data: Uint8Array): Uint8Array | null {
    const decoder = decoding.createDecoder(data);
    if (decoding.readUint8(decoder) === WHOLE) return decoding.readTailAsUint8Array(decoder);
    return this.pushPart(decoder);
  }

  private pushPart(decoder: decoding.Decoder) {
    const id = decoding.readVarUint(decoder);
    const index = decoding.readVarUint(decoder);
    const count = decoding.readVarUint(decoder);
    if (index === 0 || id !== this.id) this.parts = [];
    this.id = id;
    this.parts[index] = decoding.readTailAsUint8Array(decoder);
    if (this.parts.filter(Boolean).length < count) return null;
    const message = concat(this.parts);
    this.parts = [];
    return message;
  }
}

function concat(parts: Uint8Array[]) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  parts.reduce((offset, p) => (out.set(p, offset), offset + p.length), 0);
  return out;
}
