import { describe, expect, it } from "vitest";
import { createGame } from "../engine/index.ts";
import { HostController, GuestController } from "./controllers.ts";
import { MockHub } from "./mockTransport.ts";
import type { SeatInfo } from "./types.ts";

function seats2(): SeatInfo[] {
  return [
    { index: 0, name: "ホスト", kind: "host", connected: true },
    { index: 1, name: "空き", kind: "open", connected: false },
  ];
}

describe("オンライン同期（ホスト権威）", () => {
  it("ゲストが参加し座席を得て、開始stateが同期される", () => {
    const hub = new MockHub();
    const host = new HostController(hub.createHost(), seats2());
    const guest = new GuestController(hub.createGuest(), "ゲスト太郎");

    expect(guest.mySeat).toBe(1);
    expect(host.seats[1].connected).toBe(true);
    expect(host.seats[1].name).toBe("ゲスト太郎");

    host.startGame(createGame(["ホスト", "ゲスト太郎"], 7, [false, false]));
    expect(guest.state?.turn).toBe(host.state?.turn);
    expect(guest.state?.phase).toBe("weather");
  });

  it("ゲストのコマンドがホストに適用され、全員に配信される", () => {
    const hub = new MockHub();
    const host = new HostController(hub.createHost(), seats2());
    const guest = new GuestController(hub.createGuest(), "G");
    host.startGame(createGame(["H", "G"], 7, [false, false]));

    // 天候→セリ（neutralコマンドはゲストからでも可）
    guest.dispatch({ type: "proceedToPurchase" });
    expect(host.state?.phase).toBe("purchase");
    expect(guest.state?.phase).toBe("purchase");

    // 両者が入札提出 → セリ結果へ
    host.dispatch({ type: "submitBids", playerId: 0 });
    guest.dispatch({ type: "submitBids", playerId: 1 });
    expect(host.state?.phase).toBe("auctionResult");
    expect(guest.state?.phase).toBe("auctionResult");
  });

  it("他席のコマンドは拒否される", () => {
    const hub = new MockHub();
    const host = new HostController(hub.createHost(), seats2());
    const guest = new GuestController(hub.createGuest(), "G");
    host.startGame(createGame(["H", "G"], 7, [false, false]));
    host.dispatch({ type: "proceedToPurchase" });

    // ゲスト(席1)が席0のコマンドを送る → 無視される
    const before = host.state?.bidsSubmitted.length;
    guest.dispatch({ type: "submitBids", playerId: 0 });
    expect(host.state?.bidsSubmitted.length).toBe(before);
  });

  it("満席なら座席を得られない", () => {
    const hub = new MockHub();
    const host = new HostController(hub.createHost(), seats2());
    const g1 = new GuestController(hub.createGuest(), "G1"); // 席1へ
    const g2 = new GuestController(hub.createGuest(), "G2"); // 空き無し
    expect(g1.mySeat).toBe(1);
    expect(g2.mySeat).toBe(-1); // 満席で座席なし
    expect(host.seats.length).toBe(2); // 席は増えない
    expect(host.seats.filter((s) => s.kind === "open" && s.connected).length).toBe(1);
  });
});
