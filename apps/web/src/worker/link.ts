import type { SerialLink } from '@reactboy/core';

/** Whether the cable is plugged in, and whether another window is on the other end. */
export type LinkStatus = 'off' | 'waiting' | 'connected';

/** What crosses the cable. `to` addresses one window; hellos go to all. */
type Wire =
  | { kind: 'hello'; from: string }
  | { kind: 'welcome' | 'ping' | 'bye'; from: string; to: string }
  | { kind: 'byte' | 'reply'; from: string; to: string; value: number };

/** The part of BroadcastChannel the cable uses, so tests can swap in their own. */
export interface Channel {
  postMessage(message: Wire): void;
  onmessage: ((event: MessageEvent<Wire>) => void) | null;
  close(): void;
}

/** The serial port end of a game, as the cable needs it. */
export interface Port {
  link: SerialLink | null;
  receive(byte: number): void;
  receiveReply(byte: number): void;
}

const CHANNEL = 'reactboy-link';
/** How often to look for a partner, and to tell the partner this window is still here. */
const HEARTBEAT_MS = 1000;
/** Silence after which the partner is taken to be gone (closed without saying bye). */
const PARTNER_TIMEOUT_MS = 3500;

const randomId = () =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;

/**
 * A link cable between two ReactBoy windows on this device. Each window pairs with the first
 * other window that plugs in; a third waits until one of them leaves. Bytes travel whole
 * (see SerialLink), so games link up as on hardware, only with slower transfers.
 */
export class LinkCable {
  private channel: Channel | null = null;
  private port: Port | null = null;
  private partner: string | null = null;
  private lastHeard = 0;
  private heartbeat: ReturnType<typeof setInterval> | undefined;
  private readonly id = randomId();

  constructor(
    private readonly onStatus: (status: LinkStatus) => void,
    private readonly open: () => Channel = () => new BroadcastChannel(CHANNEL) as Channel,
    private readonly now: () => number = () => performance.now(),
  ) {}

  get status(): LinkStatus {
    return !this.channel ? 'off' : this.partner ? 'connected' : 'waiting';
  }

  /** Plugs the cable in or pulls it out. */
  setEnabled(enabled: boolean): void {
    if (enabled === (this.channel !== null)) return;
    if (enabled) {
      const channel = this.open();
      channel.onmessage = (event) => this.receive(event.data);
      this.channel = channel;
      this.heartbeat = setInterval(() => this.beat(), HEARTBEAT_MS);
      this.post({ kind: 'hello', from: this.id });
    } else {
      if (this.partner) this.post({ kind: 'bye', from: this.id, to: this.partner });
      clearInterval(this.heartbeat);
      this.channel?.close();
      this.channel = null;
      this.partner = null;
      this.connectPort();
    }
    this.onStatus(this.status);
  }

  /** The game's serial port; changes whenever a game (re)boots. */
  plug(port: Port | null): void {
    if (this.port) this.port.link = null;
    this.port = port;
    this.connectPort();
  }

  private connectPort(): void {
    if (!this.port) return;
    const to = this.partner;
    this.port.link = to
      ? {
          send: (value) => this.post({ kind: 'byte', from: this.id, to, value }),
          reply: (value) => this.post({ kind: 'reply', from: this.id, to, value }),
        }
      : null;
  }

  private post(message: Wire): void {
    this.channel?.postMessage(message);
  }

  private pairWith(partner: string | null): void {
    this.partner = partner;
    this.lastHeard = this.now();
    this.connectPort();
    this.onStatus(this.status);
  }

  private receive(message: Wire): void {
    if (message.kind === 'hello') {
      // A window that restarted says hello again; welcome it back as well as newcomers.
      if (this.partner === null || this.partner === message.from) {
        if (this.partner === null) this.pairWith(message.from);
        this.post({ kind: 'welcome', from: this.id, to: message.from });
      }
      return;
    }
    if (message.to !== this.id) return;
    if (message.kind === 'welcome' && this.partner === null) this.pairWith(message.from);
    if (message.from !== this.partner) return;
    this.lastHeard = this.now();
    switch (message.kind) {
      case 'bye':
        this.pairWith(null);
        break;
      case 'byte':
        this.port?.receive(message.value);
        break;
      case 'reply':
        this.port?.receiveReply(message.value);
        break;
    }
  }

  private beat(): void {
    if (this.partner && this.now() - this.lastHeard > PARTNER_TIMEOUT_MS) this.pairWith(null);
    if (this.partner) this.post({ kind: 'ping', from: this.id, to: this.partner });
    else this.post({ kind: 'hello', from: this.id });
  }
}
