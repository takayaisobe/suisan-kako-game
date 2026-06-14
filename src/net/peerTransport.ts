// PeerJS による実P2Pトランスポート。
// ホストは部屋コード（peer id）を発行し、ゲストはそのコードで接続する。
// 署名サーバーはPeerJSの公開ブローカーを利用（アカウント不要）。

import Peer, { type DataConnection } from "peerjs";
import type { NetMsg, Transport } from "./types.ts";

type MsgCb = (from: string, msg: NetMsg) => void;
type PeerCb = (peerId: string) => void;

/** ホストを開始し、トランスポートと部屋コードを返す。 */
export function createHostTransport(): Promise<{ transport: Transport; code: string }> {
  return new Promise((resolve, reject) => {
    const peer = new Peer();
    const conns = new Map<string, DataConnection>();
    let msgCb: MsgCb | undefined;
    let joinCb: PeerCb | undefined;
    let leaveCb: PeerCb | undefined;
    let opened = false;

    peer.on("open", (id: string) => {
      opened = true;
      const transport: Transport = {
        selfId: id,
        isHost: true,
        send(msg) {
          for (const c of conns.values()) if (c.open) c.send(msg);
        },
        sendTo(peerId, msg) {
          const c = conns.get(peerId);
          if (c?.open) c.send(msg);
        },
        onMessage(cb) {
          msgCb = cb;
        },
        onJoin(cb) {
          joinCb = cb;
        },
        onLeave(cb) {
          leaveCb = cb;
        },
        close() {
          conns.forEach((c) => c.close());
          peer.destroy();
        },
      };
      resolve({ transport, code: id });
    });

    peer.on("connection", (conn: DataConnection) => {
      conn.on("open", () => {
        conns.set(conn.peer, conn);
        joinCb?.(conn.peer);
      });
      conn.on("data", (data) => msgCb?.(conn.peer, data as NetMsg));
      conn.on("close", () => {
        conns.delete(conn.peer);
        leaveCb?.(conn.peer);
      });
    });

    peer.on("error", (err: Error) => {
      if (!opened) reject(err);
      else console.warn("[peer host error]", err);
    });
  });
}

/** ゲストとして部屋コードへ接続する。 */
export function createGuestTransport(hostId: string): Promise<Transport> {
  return new Promise((resolve, reject) => {
    const peer = new Peer();
    let msgCb: MsgCb | undefined;
    let settled = false;

    peer.on("open", () => {
      const conn = peer.connect(hostId, { reliable: true });
      conn.on("open", () => {
        settled = true;
        const transport: Transport = {
          selfId: peer.id,
          isHost: false,
          send(msg) {
            if (conn.open) conn.send(msg);
          },
          sendTo() {
            /* guestは個別送信なし */
          },
          onMessage(cb) {
            msgCb = cb;
          },
          onJoin() {},
          onLeave() {},
          close() {
            conn.close();
            peer.destroy();
          },
        };
        resolve(transport);
      });
      conn.on("data", (data) => msgCb?.(hostId, data as NetMsg));
      conn.on("error", (err: Error) => {
        if (!settled) reject(err);
      });
    });

    peer.on("error", (err: Error) => {
      if (!settled) reject(err);
    });
    setTimeout(() => {
      if (!settled) reject(new Error("接続できませんでした（コードを確認してください）"));
    }, 15000);
  });
}
