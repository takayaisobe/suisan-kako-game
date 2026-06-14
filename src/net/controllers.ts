// ホスト権威の同期コントローラ。
//   HostController … GameStateを保持し、コマンドを適用して全員へ配信。
//   GuestController … 受信したstateを描画し、自席のコマンドを送るだけ。

import { applyCommand, type Command, type GameState } from "../engine/index.ts";
import { commandSeat, type NetMsg, type SeatInfo, type Transport } from "./types.ts";

export class HostController {
  readonly isHost = true;
  readonly mySeat = 0; // ホストは常に座席0
  state: GameState | null = null;
  seats: SeatInfo[];
  started = false;
  private peerSeat = new Map<string, number>();
  onChange: ((s: GameState | null, seats: SeatInfo[]) => void) | null = null;

  constructor(
    private tr: Transport,
    seats: SeatInfo[],
  ) {
    this.seats = seats;
    tr.onMessage((from, msg) => this.handle(from, msg));
    tr.onJoin((peer) => this.assignSeat(peer));
    tr.onLeave((peer) => this.releaseSeat(peer));
  }

  private assignSeat(peer: string): void {
    const open = this.seats.find((s) => s.kind === "open" && !s.connected);
    if (!open) return; // 空き無し。helloに対して満席応答する。
    open.connected = true;
    open.peerId = peer;
    this.peerSeat.set(peer, open.index);
    this.broadcastLobby();
  }

  private releaseSeat(peer: string): void {
    const idx = this.peerSeat.get(peer);
    if (idx == null) return;
    this.seats[idx].connected = false;
    this.seats[idx].peerId = undefined;
    this.peerSeat.delete(peer);
    this.broadcastLobby();
  }

  private broadcastLobby(): void {
    this.tr.send({ t: "lobby", seats: this.seats });
    this.onChange?.(this.state, this.seats);
  }

  private handle(from: string, msg: NetMsg): void {
    if (msg.t === "hello") {
      const idx = this.peerSeat.get(from);
      if (idx == null) {
        this.tr.sendTo(from, { t: "full", reason: "満席です" });
        return;
      }
      if (msg.name) this.seats[idx].name = msg.name;
      this.tr.sendTo(from, { t: "welcome", seat: idx, seats: this.seats });
      if (this.started && this.state) this.tr.sendTo(from, { t: "start", state: this.state, seats: this.seats });
      this.broadcastLobby();
    } else if (msg.t === "command") {
      const seat = this.peerSeat.get(from);
      const cs = commandSeat(msg.command);
      if (cs !== undefined && cs !== seat) return; // 自席以外のコマンドは拒否
      this.applyAndBroadcast(msg.command);
    }
  }

  /** ゲーム開始（全員へ配信）。 */
  startGame(state: GameState): void {
    this.state = state;
    this.started = true;
    this.tr.send({ t: "start", state, seats: this.seats });
    this.onChange?.(state, this.seats);
  }

  /** ホストローカル（信頼）またはguestコマンドの適用＋配信。 */
  dispatch(c: Command): void {
    this.applyAndBroadcast(c);
  }

  private applyAndBroadcast(c: Command): void {
    if (!this.state) return;
    this.state = applyCommand(this.state, c);
    this.tr.send({ t: "state", state: this.state });
    this.onChange?.(this.state, this.seats);
  }

  close(): void {
    this.tr.close();
  }
}

export class GuestController {
  readonly isHost = false;
  state: GameState | null = null;
  seats: SeatInfo[] = [];
  mySeat = -1;
  onChange: ((s: GameState | null, seats: SeatInfo[], mySeat: number) => void) | null = null;
  onFull: ((reason: string) => void) | null = null;

  constructor(
    private tr: Transport,
    name: string,
  ) {
    tr.onMessage((_from, msg) => this.handle(msg));
    tr.send({ t: "hello", name });
  }

  private handle(msg: NetMsg): void {
    switch (msg.t) {
      case "welcome":
        this.mySeat = msg.seat;
        this.seats = msg.seats;
        break;
      case "lobby":
        this.seats = msg.seats;
        break;
      case "start":
      case "state":
        this.state = msg.state;
        if (msg.t === "start") this.seats = msg.seats;
        break;
      case "full":
        this.onFull?.(msg.reason);
        return;
      default:
        return;
    }
    this.onChange?.(this.state, this.seats, this.mySeat);
  }

  dispatch(c: Command): void {
    this.tr.send({ t: "command", command: c });
  }

  close(): void {
    this.tr.close();
  }
}
