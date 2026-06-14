// オンライン対戦の通信抽象とメッセージ型。
// Transport を差し替えれば PeerJS / Supabase / Mock など実装を交換できる。

import type { Command, GameState } from "../engine/index.ts";

/** 座席情報（プレイヤー枠）。 */
export interface SeatInfo {
  index: number;
  name: string;
  /** host=部屋主, remote=遠隔の人間, cpu=AI, open=参加待ちの空き枠。 */
  kind: "host" | "remote" | "cpu" | "open";
  connected: boolean;
  peerId?: string;
}

/** ネットワークで流すメッセージ。 */
export type NetMsg =
  | { t: "hello"; name: string } // guest -> host（接続時の自己紹介）
  | { t: "welcome"; seat: number; seats: SeatInfo[] } // host -> guest（座席通知）
  | { t: "lobby"; seats: SeatInfo[] } // host -> all（ロビー更新）
  | { t: "start"; state: GameState; seats: SeatInfo[] } // host -> all（開始）
  | { t: "command"; command: Command } // guest -> host
  | { t: "state"; state: GameState } // host -> all（権威state配信）
  | { t: "full"; reason: string }; // host -> guest（満席など）

/** 通信トランスポート抽象。 */
export interface Transport {
  selfId: string;
  isHost: boolean;
  /** guest: ホストへ送信 / host: 全guestへブロードキャスト。 */
  send(msg: NetMsg): void;
  /** host専用：特定peerへ送信。 */
  sendTo(peerId: string, msg: NetMsg): void;
  onMessage(cb: (from: string, msg: NetMsg) => void): void;
  onJoin(cb: (peerId: string) => void): void; // host
  onLeave(cb: (peerId: string) => void): void; // host
  close(): void;
}

/** Command に紐づく座席（playerId）。なければ neutral コマンド。 */
export function commandSeat(c: Command): number | undefined {
  return "playerId" in c ? c.playerId : undefined;
}
