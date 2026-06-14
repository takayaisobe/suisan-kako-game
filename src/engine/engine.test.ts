import { describe, expect, it } from "vitest";
import {
  aiActions,
  applyCommand,
  createGame,
  currentActorId,
  netWorth,
  salesCapacity,
  type Command,
  type GameState,
} from "./index.ts";

function run(state: GameState, cmds: Command[]): GameState {
  return cmds.reduce((s, c) => applyCommand(s, c), state);
}

describe("createGame", () => {
  it("初期状態が正しい", () => {
    const g = createGame(["A", "B", "C"]);
    expect(g.players).toHaveLength(3);
    expect(g.turn).toBe(1);
    expect(g.season).toBe("spring");
    expect(g.phase).toBe("weather");
    expect(g.players[0].cash).toBe(10000);
    expect(salesCapacity(g.players[0])).toBe(10);
  });

  it("春はマダイ（グレード◎）が必ず水揚げされる", () => {
    const g = createGame(["A", "B"], 1);
    const madai = g.market.find((l) => l.speciesId === "madai");
    expect(madai).toBeDefined();
    expect(madai!.kg).toBeGreaterThan(0);
    expect(madai!.minPrice).toBe(500); // buyMin 500 × 魚価補正1
    // 春にカツオ（その季節は獲れない）は並ばない
    expect(g.market.find((l) => l.speciesId === "katsuo")).toBeUndefined();
  });
});

describe("purchase auction（単価＋数量）", () => {
  it("高単価から数量を割当。数量指定が尊重され、残りは次点へ", () => {
    let g = createGame(["A", "B"], 7);
    g = applyCommand(g, { type: "proceedToPurchase" });
    const lot = g.market.find((l) => l.speciesId === "madai")!;
    g = run(g, [
      // A：高単価だが5kgだけ欲しい
      { type: "setBid", playerId: 0, lotId: lot.id, pricePerKg: lot.minPrice + 50, qtyKg: 5 },
      // B：最低価格で全量欲しい
      { type: "setBid", playerId: 1, lotId: lot.id, pricePerKg: lot.minPrice, qtyKg: lot.kg },
      { type: "submitBids", playerId: 0 },
      { type: "submitBids", playerId: 1 },
    ]);
    expect(g.phase).toBe("auctionResult");
    const res = g.auctionResults.find((r) => r.speciesId === "madai")!;
    const a0 = res.allocations.find((a) => a.playerId === 0);
    const a1 = res.allocations.find((a) => a.playerId === 1);
    expect(a0?.kg).toBe(5); // 数量指定どおり5kgだけ
    expect(a0?.price).toBe(lot.minPrice + 50);
    expect(g.players[0].rawInventory["madai"]).toBe(5);
    // 残り（lot.kg-5）はBが取得（在庫/資金の範囲）
    expect((a1?.kg ?? 0)).toBeGreaterThan(0);
    g = applyCommand(g, { type: "proceedToAction" });
    expect(g.phase).toBe("action");
  });
});

// 仕入れ済みの action フェーズまで進める（player0が madai を最低価格で確保）
function buyAndReachAction(seed: number): GameState {
  let g = createGame(["A", "B"], seed);
  g = applyCommand(g, { type: "proceedToPurchase" });
  const lot = g.market.find((l) => l.speciesId === "madai")!;
  g = run(g, [
    { type: "setBid", playerId: 0, lotId: lot.id, pricePerKg: lot.minPrice, qtyKg: lot.kg },
    { type: "submitBids", playerId: 0 },
    { type: "submitBids", playerId: 1 },
  ]);
  return applyCommand(g, { type: "proceedToAction" });
}

// 操業を終えて翌日の action フェーズへ（誰も買わない）
function nextDayAction(g: GameState): GameState {
  // 残りの手番を全員パスで終了
  let guard = 0;
  while (g.phase === "action" && guard++ < 10) {
    g = applyCommand(g, { type: "pass", playerId: g.activePlayer });
  }
  if (g.phase === "weather") g = applyCommand(g, { type: "proceedToPurchase" });
  if (g.phase === "purchase") {
    for (const p of g.players) g = applyCommand(g, { type: "submitBids", playerId: p.id });
  }
  if (g.phase === "auctionResult") g = applyCommand(g, { type: "proceedToAction" });
  return g;
}

describe("1日1アクション制", () => {
  it("製造したら同じ日は販売できない（手番終了）", () => {
    let g = buyAndReachAction(7);
    expect(g.phase).toBe("action");
    expect(g.activePlayer).toBe(0);
    g = applyCommand(g, { type: "manufacture", playerId: 0, productId: "madai_kirimi", kg: 5 });
    expect(g.players[0].productInventory["madai_kirimi"]).toBeGreaterThan(0);
    expect(g.players[0].turnDone).toBe(true);
    expect(g.activePlayer).toBe(1); // 手番が進む
    // 同じ日に販売を宣言しようとしても無効
    const before = g;
    g = applyCommand(g, { type: "declareSell", playerId: 0 });
    expect(g.openSale).toBeNull();
    expect(g).toBe(before); // 状態変化なし
  });

  it("翌日に製品を販売して現金が増える", () => {
    let g = buyAndReachAction(7);
    g = applyCommand(g, { type: "manufacture", playerId: 0, productId: "madai_kirimi", kg: 5 });
    const madeKg = g.players[0].productInventory["madai_kirimi"];
    // 翌日へ
    g = nextDayAction(g);
    expect(g.phase).toBe("action");
    const cashBefore = g.players[0].cash;
    g = applyCommand(g, { type: "declareSell", playerId: 0 });
    g = run(g, [
      { type: "addSaleItem", playerId: 0, item: { kind: "product", id: "madai_kirimi", kg: madeKg, channel: "super" } },
      { type: "confirmSale", playerId: 0 },
      { type: "confirmSale", playerId: 1 },
    ]);
    expect(g.players[0].cash).toBeGreaterThan(cashBefore);
  });

  it("原魚を中央市場へ売るのも1アクション", () => {
    let g = buyAndReachAction(7);
    const cashBefore = g.players[0].cash;
    const sid = "madai";
    const haveKg = g.players[0].rawInventory[sid] ?? 0;
    expect(haveKg).toBeGreaterThan(0);
    g = applyCommand(g, { type: "declareSell", playerId: 0 });
    g = run(g, [
      { type: "addSaleItem", playerId: 0, item: { kind: "raw", id: sid, kg: haveKg } },
      { type: "confirmSale", playerId: 0 },
      { type: "confirmSale", playerId: 1 },
    ]);
    expect(g.players[0].cash).toBeGreaterThan(cashBefore);
    expect(g.players[0].turnDone).toBe(true);
  });

  it("製造した日でも他社の販売に相乗りできる（相乗りはアクションを消費しない）", () => {
    let g = buyAndReachAction(7); // A がマダイを落札
    const sid = "madai";
    // A は製造（自分のアクション消費）。原魚が一部残る。
    g = applyCommand(g, { type: "manufacture", playerId: 0, productId: "madai_kirimi", kg: 5 });
    expect(g.players[0].turnDone).toBe(true);
    const rawLeft = g.players[0].rawInventory[sid] ?? 0;
    expect(rawLeft).toBeGreaterThan(0);
    // B が自分の手番で販売を宣言
    expect(g.activePlayer).toBe(1);
    g = applyCommand(g, { type: "declareSell", playerId: 1 });
    const cashBefore = g.players[0].cash;
    // 行動済みの A でも相乗りで原魚を売れる
    g = run(g, [
      { type: "addSaleItem", playerId: 0, item: { kind: "raw", id: sid, kg: rawLeft } },
      { type: "confirmSale", playerId: 0 },
      { type: "confirmSale", playerId: 1 },
    ]);
    // 製造で行動済みだった A が、相乗りで原魚を売って現金が増えた＝相乗りはアクション非消費
    expect(g.players[0].cash).toBeGreaterThan(cashBefore);
  });
});

describe("配置転換", () => {
  it("セリ前に営業↔製造を移せる／0未満にはできない", () => {
    let g = createGame(["A", "B"], 7);
    g = applyCommand(g, { type: "proceedToPurchase" });
    expect(g.players[0].staff.sales).toBe(1);
    expect(g.players[0].staff.manufacturing).toBe(1);
    g = applyCommand(g, { type: "reassign", playerId: 0, dir: "toMfg" });
    expect(g.players[0].staff.sales).toBe(0);
    expect(g.players[0].staff.manufacturing).toBe(2);
    // 営業0からはこれ以上 toMfg できない
    g = applyCommand(g, { type: "reassign", playerId: 0, dir: "toMfg" });
    expect(g.players[0].staff.sales).toBe(0);
  });
});

// A が冷凍マダイを持った状態で「翌日のセリ」まで進める
function day2PurchaseWithFrozenMadai(): { g: GameState; kg: number } {
  let g = buyAndReachAction(7);
  const kg = g.players[0].rawInventory["madai"] ?? 0;
  g = applyCommand(g, { type: "freeze", playerId: 0, speciesId: "madai", kg });
  g = applyCommand(g, { type: "pass", playerId: 0 });
  g = applyCommand(g, { type: "pass", playerId: 1 });
  g = applyCommand(g, { type: "proceedToPurchase" }); // 翌日のセリ
  return { g, kg };
}

// セリ前に解凍指示→1日経過→翌日のaction（解凍済みが使える状態）まで進める
function day3ActionWithThawed(): { g: GameState; kg: number } {
  const r = day2PurchaseWithFrozenMadai();
  let g = applyCommand(r.g, { type: "thaw", playerId: 0, speciesId: "madai", kg: r.kg });
  g = applyCommand(g, { type: "submitBids", playerId: 0 });
  g = applyCommand(g, { type: "submitBids", playerId: 1 });
  g = applyCommand(g, { type: "proceedToAction" }); // 解凍指示した日(day2)の操業
  g = applyCommand(g, { type: "pass", playerId: 0 });
  g = applyCommand(g, { type: "pass", playerId: 1 }); // → day3 朝に thawing→thawed
  g = applyCommand(g, { type: "proceedToPurchase" });
  g = applyCommand(g, { type: "submitBids", playerId: 0 });
  g = applyCommand(g, { type: "submitBids", playerId: 1 });
  g = applyCommand(g, { type: "proceedToAction" }); // day3 操業（解凍済みが使える）
  return { g, kg: r.kg };
}

describe("生の原魚の腐敗", () => {
  it("生のまま使わず冷凍もしないと翌朝腐る", () => {
    let g = buyAndReachAction(7);
    const kg = g.players[0].rawInventory["madai"] ?? 0;
    expect(kg).toBeGreaterThan(0);
    g = applyCommand(g, { type: "pass", playerId: 0 });
    g = applyCommand(g, { type: "pass", playerId: 1 });
    expect(g.players[0].rawInventory["madai"] ?? 0).toBe(0); // 腐った
  });

  it("冷凍すれば腐らずに保存できる", () => {
    let g = buyAndReachAction(7);
    const kg = g.players[0].rawInventory["madai"] ?? 0;
    g = applyCommand(g, { type: "freeze", playerId: 0, speciesId: "madai", kg });
    g = applyCommand(g, { type: "pass", playerId: 0 });
    g = applyCommand(g, { type: "pass", playerId: 1 });
    expect(g.players[0].frozenInventory["madai"]).toBe(kg);
    expect(g.players[0].rawInventory["madai"] ?? 0).toBe(0);
  });
});

describe("解凍と腐敗", () => {
  it("解凍指示は冷凍庫→解凍中（その日はまだ使えない）", () => {
    const { g: g0, kg } = day2PurchaseWithFrozenMadai();
    expect(kg).toBeGreaterThan(0);
    const g = applyCommand(g0, { type: "thaw", playerId: 0, speciesId: "madai", kg });
    expect(g.players[0].thawingInventory["madai"]).toBe(kg);
    expect(g.players[0].thawedInventory["madai"] ?? 0).toBe(0);
    expect(g.players[0].frozenInventory["madai"] ?? 0).toBe(0);
  });

  it("翌日に解凍済みになり、その日に使わないとさらに翌朝腐る", () => {
    const { g: g0, kg } = day3ActionWithThawed();
    // day3 操業：解凍済みが使える状態
    expect(g0.players[0].thawedInventory["madai"]).toBe(kg);
    expect(g0.players[0].thawingInventory["madai"] ?? 0).toBe(0);
    // 使わずに1日終了
    let g = applyCommand(g0, { type: "pass", playerId: 0 });
    g = applyCommand(g, { type: "pass", playerId: 1 });
    expect(g.players[0].thawedInventory["madai"] ?? 0).toBe(0); // 腐った
  });

  it("解凍済みは製造で優先的に消費される", () => {
    const { g: g0, kg } = day3ActionWithThawed();
    const useKg = Math.min(kg, 5);
    const g = applyCommand(g0, { type: "manufacture", playerId: 0, productId: "madai_kirimi", kg: useKg });
    expect(g.players[0].productInventory["madai_kirimi"]).toBe(useKg);
    expect(g.players[0].thawedInventory["madai"] ?? 0).toBe(kg - useKg);
  });
});

// 最初の投資フェーズ（第5期決算後）まで全パスで進める
function toFirstInvestment(): GameState {
  let g = createGame(["A", "B"], 42);
  let guard = 0;
  while (g.phase !== "investment" && guard++ < 300) {
    switch (g.phase) {
      case "weather":
        g = applyCommand(g, { type: "proceedToPurchase" });
        break;
      case "purchase":
        for (const p of g.players) g = applyCommand(g, { type: "submitBids", playerId: p.id });
        break;
      case "auctionResult":
        g = applyCommand(g, { type: "proceedToAction" });
        break;
      case "action":
        g = applyCommand(g, { type: "pass", playerId: g.activePlayer });
        break;
      case "settlement":
        g = applyCommand(g, { type: "proceedToInvestment" });
        break;
    }
  }
  return g;
}

describe("商品開発（加工品強の解禁）", () => {
  it("未開発の加工品強は作れない／加工品弱は作れる", () => {
    const g = buyAndReachAction(7); // A はマダイ原魚を保有
    // 加工品強（茶漬け）は未開発 → 作れない
    const g1 = applyCommand(g, { type: "manufacture", playerId: 0, productId: "madai_chazuke", kg: 5 });
    expect(g1.players[0].productInventory["madai_chazuke"] ?? 0).toBe(0);
    expect(g1.players[0].turnDone).toBe(false);
    // 加工品弱（切身）は作れる
    const g2 = applyCommand(g, { type: "manufacture", playerId: 0, productId: "madai_kirimi", kg: 5 });
    expect(g2.players[0].productInventory["madai_kirimi"]).toBe(5);
  });

  it("投資フェーズで3000払って開発すると作れるようになる", () => {
    let g = toFirstInvestment();
    expect(g.phase).toBe("investment");
    const cashBefore = g.players[0].cash;
    g = applyCommand(g, { type: "develop", playerId: 0, productId: "madai_chazuke" });
    expect(g.players[0].developedProducts).toContain("madai_chazuke");
    expect(g.players[0].cash).toBe(cashBefore - 3000);
    // 同じものは二重開発できない
    g = applyCommand(g, { type: "develop", playerId: 0, productId: "madai_chazuke" });
    expect(g.players[0].cash).toBe(cashBefore - 3000);
  });
});

describe("開業借入", () => {
  it("開始時に借入でき、現金が増えローンが計上される", () => {
    const g = createGame(["A", "B"], 7, [false, false], [20000, 0]);
    expect(g.players[0].cash).toBe(10000 + 20000);
    expect(g.players[0].loans).toHaveLength(1);
    expect(g.players[0].loans[0].principal).toBe(20000);
    expect(g.players[1].cash).toBe(10000); // 借入なし
    expect(g.players[1].loans).toHaveLength(0);
  });

  it("資本金の2倍を超える借入は上限に丸められる", () => {
    const g = createGame(["A"], 7, [false], [99999]);
    expect(g.players[0].loans[0].principal).toBe(20000);
    expect(g.players[0].cash).toBe(10000 + 20000);
  });
});

describe("EC輸出は認証が必要", () => {
  it("HACCPなしではEC販売できない", () => {
    let g = buyAndReachAction(7);
    g = applyCommand(g, { type: "manufacture", playerId: 0, productId: "madai_kirimi", kg: 5 });
    g = nextDayAction(g);
    g = applyCommand(g, { type: "declareSell", playerId: 0 });
    g = applyCommand(g, {
      type: "addSaleItem",
      playerId: 0,
      item: { kind: "product", id: "madai_kirimi", kg: 5, channel: "ec" },
    });
    // EC指定はHACCPなしなので出品が無効化される
    expect((g.openSale!.contributions[0] ?? []).length).toBe(0);
  });
});

describe("20ターン通し（全員パスで進行）", () => {
  it("全ターンを最後まで進めてgameoverに到達する", () => {
    let g = createGame(["A", "B", "C"], 42);
    let guard = 0;
    while (g.phase !== "gameover" && guard++ < 2000) {
      switch (g.phase) {
        case "weather":
          g = applyCommand(g, { type: "proceedToPurchase" });
          break;
        case "purchase":
          for (const p of g.players) g = applyCommand(g, { type: "submitBids", playerId: p.id });
          break;
        case "auctionResult":
          g = applyCommand(g, { type: "proceedToAction" });
          break;
        case "action":
          g = applyCommand(g, { type: "pass", playerId: g.activePlayer });
          break;
        case "settlement":
          g = applyCommand(g, { type: "proceedToInvestment" });
          break;
        case "investment":
          for (const p of g.players) g = applyCommand(g, { type: "finishInvestment", playerId: p.id });
          break;
      }
    }
    expect(g.phase).toBe("gameover");
    expect(g.turn).toBe(20);
    for (const p of g.players) expect(netWorth(p)).toBeLessThan(10000);
  });
});

describe("CPU（AI）", () => {
  it("全員CPUで最後まで自動進行し、停止しない", () => {
    let g = createGame(["甲", "乙", "丙"], 5, [true, true, true]);
    let guard = 0;
    while (g.phase !== "gameover" && guard++ < 5000) {
      if (g.phase === "weather") {
        g = applyCommand(g, { type: "proceedToPurchase" });
        continue;
      }
      if (g.phase === "settlement") {
        g = applyCommand(g, { type: "proceedToInvestment" });
        continue;
      }
      if (g.phase === "auctionResult") {
        g = applyCommand(g, { type: "proceedToAction" });
        continue;
      }
      const cmds = aiActions(g);
      expect(cmds.length).toBeGreaterThan(0); // 必ず終端コマンドを返す
      g = cmds.reduce((s, c) => applyCommand(s, c), g);
    }
    expect(g.phase).toBe("gameover");
    expect(g.turn).toBe(20);
  });

  it("CPUは仕入れ→製造→販売で稼ぐ（少なくとも1社は売上を計上）", () => {
    let g = createGame(["甲", "乙"], 11, [true, true]);
    let guard = 0;
    let sawRevenue = false;
    while (g.phase !== "gameover" && guard++ < 5000) {
      if (g.phase === "weather") g = applyCommand(g, { type: "proceedToPurchase" });
      else if (g.phase === "settlement") g = applyCommand(g, { type: "proceedToInvestment" });
      else if (g.phase === "auctionResult") g = applyCommand(g, { type: "proceedToAction" });
      else g = aiActions(g).reduce((s, c) => applyCommand(s, c), g);
      if (g.players.some((p) => p.periodRevenue > 0)) sawRevenue = true;
    }
    expect(sawRevenue).toBe(true);
  });

  it("currentActorId はフェーズに応じた操作者を返す", () => {
    const g = createGame(["A", "B"], 1);
    expect(currentActorId(g)).toBe(-1); // weather は操作者なし
  });
});
