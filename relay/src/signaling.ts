/**
 * WebRTC signaling for one map. Each socket gets a peer id; the server tells
 * newcomers who is already there (newcomers send the offers) and forwards
 * SDP and ICE candidates between peers. Runtime-free for unit tests.
 *
 * Server -> client: {type:"welcome", id, peers}, {type:"peer-joined", id},
 *                   {type:"peer-left", id}, {type:"signal", from, data}
 * Client -> server: {type:"signal", to, data}
 */

export interface SignalPeer {
  readonly id: string;
  sendText(text: string): void;
}

interface SignalIn {
  type: "signal";
  to: string;
  data: unknown;
}

export class Signaling {
  constructor(private readonly peers: () => SignalPeer[]) {}

  join(peer: SignalPeer) {
    const others = this.others(peer).map((p) => p.id);
    peer.sendText(JSON.stringify({ type: "welcome", id: peer.id, peers: others }));
    this.broadcast({ type: "peer-joined", id: peer.id }, peer);
  }

  receive(peer: SignalPeer, text: string) {
    const message = parseSignal(text);
    const target = message && this.others(peer).find((p) => p.id === message.to);
    target?.sendText(JSON.stringify({ type: "signal", from: peer.id, data: message!.data }));
  }

  leave(peer: SignalPeer) {
    this.broadcast({ type: "peer-left", id: peer.id }, peer);
  }

  private others(peer: SignalPeer) {
    return this.peers().filter((p) => p !== peer);
  }

  private broadcast(message: object, except: SignalPeer) {
    const text = JSON.stringify(message);
    this.others(except).forEach((p) => p.sendText(text));
  }
}

export function parseSignal(text: string): SignalIn | null {
  try {
    const message = JSON.parse(text);
    return message?.type === "signal" && typeof message.to === "string" ? message : null;
  } catch {
    return null;
  }
}
