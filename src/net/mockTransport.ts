// テスト用のインメモリ通信（実ネットワーク不要）。
// 1プロセス内で host と複数 guest をつないで同期ロジックを検証する。

import type { NetMsg, Transport } from "./types.ts";

type MsgCb = (from: string, msg: NetMsg) => void;
type PeerCb = (peerId: string) => void;

export class MockHub {
  private hostId = "host";
  private hostMsg: MsgCb | null = null;
  private joinCbs: PeerCb[] = [];
  private leaveCbs: PeerCb[] = [];
  private guests = new Map<string, MsgCb | null>();
  private counter = 0;

  createHost(): Transport {
    const hub = this;
    return {
      selfId: hub.hostId,
      isHost: true,
      send(msg) {
        for (const cb of hub.guests.values()) cb?.(hub.hostId, msg);
      },
      sendTo(peerId, msg) {
        hub.guests.get(peerId)?.(hub.hostId, msg);
      },
      onMessage(cb) {
        hub.hostMsg = cb;
      },
      onJoin(cb) {
        hub.joinCbs.push(cb);
      },
      onLeave(cb) {
        hub.leaveCbs.push(cb);
      },
      close() {
        hub.guests.clear();
      },
    };
  }

  createGuest(): Transport {
    const hub = this;
    const id = `guest${++hub.counter}`;
    hub.guests.set(id, null);
    // ホストへ参加通知
    for (const cb of hub.joinCbs) cb(id);
    return {
      selfId: id,
      isHost: false,
      send(msg) {
        hub.hostMsg?.(id, msg);
      },
      sendTo() {
        /* guestは個別送信しない */
      },
      onMessage(cb) {
        hub.guests.set(id, cb);
      },
      onJoin() {},
      onLeave() {},
      close() {
        hub.guests.delete(id);
        for (const cb of hub.leaveCbs) cb(id);
      },
    };
  }
}
