import type { Channel } from "./PeerSync";

/**
 * Full mesh of RTCPeerConnections driven by the relay's signaling messages
 * (see relay/src/signaling.ts). Newcomers send the offers, so two peers never
 * offer to each other at once. Every connection carries one ordered data
 * channel, handed to `onChannel`.
 */

type SignalData = { sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit };

export type RelayMessage =
  | { type: "welcome"; id: string; peers: string[] }
  | { type: "peer-joined"; id: string }
  | { type: "peer-left"; id: string }
  | { type: "signal"; from: string; data: SignalData };

export interface PeerMeshOptions {
  iceServers: RTCIceServer[];
  /** Injected for tests and Node (e.g. werift). */
  RTCPeerConnection?: typeof RTCPeerConnection;
}

export class PeerMesh {
  selfId: string | null = null;
  private readonly pcs = new Map<string, RTCPeerConnection>();
  private readonly pending = new Map<string, RTCIceCandidateInit[]>();
  private readonly PC: typeof RTCPeerConnection;

  constructor(
    private readonly signal: (to: string, data: SignalData) => void,
    private readonly onChannel: (peerId: string, channel: Channel) => void,
    private readonly opts: PeerMeshOptions
  ) {
    this.PC = opts.RTCPeerConnection ?? globalThis.RTCPeerConnection;
  }

  get peerIds() {
    return [...this.pcs.keys()];
  }

  /** Returns a promise only so tests can await the negotiation step. */
  handle(message: RelayMessage): Promise<void> | void {
    if (message.type === "welcome") return this.welcome(message.id, message.peers);
    if (message.type === "peer-left") return this.drop(message.id);
    if (message.type === "signal") return this.receiveSignal(message.from, message.data);
  }

  destroy() {
    this.peerIds.forEach((id) => this.drop(id));
  }

  private async welcome(id: string, peers: string[]) {
    // A new id means the relay forgot us: start the mesh over.
    this.destroy();
    this.selfId = id;
    await Promise.all(peers.map((peer) => this.call(peer)));
  }

  private async call(peerId: string) {
    const pc = this.create(peerId);
    this.onChannel(peerId, pc.createDataChannel("yjs", { ordered: true }) as unknown as Channel);
    await pc.setLocalDescription(await pc.createOffer());
    this.signal(peerId, { sdp: pc.localDescription!.toJSON?.() ?? pc.localDescription! });
  }

  private async receiveSignal(from: string, data: SignalData) {
    if (data.sdp) await this.receiveDescription(from, data.sdp);
    else if (data.candidate) await this.receiveCandidate(from, data.candidate);
  }

  private async receiveDescription(from: string, sdp: RTCSessionDescriptionInit) {
    const isOffer = sdp.type === "offer";
    const pc = isOffer ? this.create(from) : this.pcs.get(from);
    if (!pc) return;
    await pc.setRemoteDescription(sdp);
    await this.flushCandidates(from, pc);
    if (!isOffer) return;
    await pc.setLocalDescription(await pc.createAnswer());
    this.signal(from, { sdp: pc.localDescription!.toJSON?.() ?? pc.localDescription! });
  }

  private async receiveCandidate(from: string, candidate: RTCIceCandidateInit) {
    const pc = this.pcs.get(from);
    if (pc?.remoteDescription) await pc.addIceCandidate(candidate);
    else this.pending.set(from, [...(this.pending.get(from) ?? []), candidate]);
  }

  private async flushCandidates(peerId: string, pc: RTCPeerConnection) {
    const candidates = this.pending.get(peerId) ?? [];
    this.pending.delete(peerId);
    for (const candidate of candidates) await pc.addIceCandidate(candidate);
  }

  private create(peerId: string): RTCPeerConnection {
    // Replace any old connection, but keep candidates that beat the offer here.
    this.pcs.get(peerId)?.close();
    const pc = new this.PC({ iceServers: this.opts.iceServers });
    pc.onicecandidate = (e) => this.sendCandidate(peerId, e.candidate);
    pc.ondatachannel = (e) => this.onChannel(peerId, e.channel as unknown as Channel);
    pc.onconnectionstatechange = () => this.watch(peerId, pc);
    this.pcs.set(peerId, pc);
    return pc;
  }

  private sendCandidate(peerId: string, candidate: RTCIceCandidate | null) {
    if (candidate) this.signal(peerId, { candidate: candidate.toJSON?.() ?? candidate });
  }

  private watch(peerId: string, pc: RTCPeerConnection) {
    const dead = pc.connectionState === "failed" || pc.connectionState === "closed";
    if (dead && this.pcs.get(peerId) === pc) this.drop(peerId);
  }

  private drop(peerId: string) {
    this.pcs.get(peerId)?.close();
    this.pcs.delete(peerId);
    this.pending.delete(peerId);
  }
}
