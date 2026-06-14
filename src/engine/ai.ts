// =====================================================================
// CPU（AI）プレイヤーの意思決定（純粋関数・ヒューリスティック）
//   currentActorId(state) … いま操作すべきプレイヤー
//   aiActions(state) … そのプレイヤーがCPUのとき実行すべきCommand列
// =====================================================================

import { INVESTMENT_OPTIONS, PRODUCTS, type InvestmentKind } from "./data.ts";
import {
  canUseEc,
  inventoryLeft,
  inventoryUsed,
  mfgDailyKg,
  mfgKgPerProduct,
  productById,
  salesLeft,
  speciesById,
  superCapEff,
  type Command,
} from "./engine.ts";
import type { Channel, GameState, Player } from "./types.ts";

const sum = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0);

/** 現在操作すべきプレイヤーID（フェーズ別）。-1=該当なし。 */
export function currentActorId(state: GameState): number {
  switch (state.phase) {
    case "purchase":
      return state.players.find((p) => !state.bidsSubmitted.includes(p.id))?.id ?? -1;
    case "action":
      if (state.openSale)
        return state.players.find((p) => !state.openSale!.confirmed.includes(p.id))?.id ?? -1;
      return state.activePlayer;
    case "investment":
      return state.players.find((p) => !p.ready)?.id ?? -1;
    default:
      return -1;
  }
}

/** CPUの行動列を返す。呼び出し側は順に applyCommand する。 */
export function aiActions(state: GameState): Command[] {
  const pid = currentActorId(state);
  if (pid < 0) return [];
  const p = state.players[pid];
  switch (state.phase) {
    case "purchase":
      return planBids(state, p);
    case "action":
      return state.openSale ? planSale(state, p) : planTurn(state, p);
    case "investment":
      return planInvest(p);
    default:
      return [];
  }
}

// ---- セリ入札 ----
function planBids(state: GameState, p: Player): Command[] {
  const cmds: Command[] = [];
  // 性格づけ：プレイヤーごとに支払い意欲を少し変える
  const aggression = 0.55 + (p.id % 3) * 0.07;
  let budget = p.cash * 0.6;
  let space = inventoryLeft(p);
  // 利益が大きそうな魚種から
  const lots = [...state.market].sort(
    (a, b) => speciesById(b.speciesId).rawSellPrice - speciesById(a.speciesId).rawSellPrice,
  );
  for (const lot of lots) {
    if (space <= 0 || budget <= lot.minPrice) continue;
    const sp = speciesById(lot.speciesId);
    const maxPay = Math.max(lot.minPrice, Math.round(sp.rawSellPrice * aggression));
    const wantKg = Math.min(lot.kg, space);
    const affordable = Math.floor(budget / Math.max(1, wantKg));
    const bid = Math.min(maxPay, affordable);
    if (bid < lot.minPrice) continue;
    cmds.push({ type: "setBid", playerId: p.id, lotId: lot.id, pricePerKg: bid });
    budget -= bid * wantKg;
    space -= wantKg;
  }
  cmds.push({ type: "submitBids", playerId: p.id });
  return cmds;
}

// ---- 操業（製造 or 販売 or パス） ----
function hasRaw(p: Player): boolean {
  return sum(p.rawInventory) > 0;
}

/** いま実際に売れる量（kg）があるか。チャネル満杯や枠切れを考慮。 */
function sellableKgNow(state: GameState, p: Player): number {
  if (salesLeft(p) <= 0) return 0;
  let total = 0;
  const keep = mfgKgPerProduct(p);
  // 原魚は中央市場が無制限。1バッチは加工用に残す前提で余剰のみ
  for (const [, kg] of Object.entries(p.rawInventory)) total += Math.max(0, kg - keep);
  // 製品はチャネルの空きまで
  for (const [pid, kg] of Object.entries(p.productInventory)) {
    if (kg <= 0) continue;
    const product = productById(pid);
    const channel: Channel = canUseEc(p) ? "ec" : "super";
    const chCap = channel === "super" ? superCapEff(state, product) : product.ecCap;
    const sold = (channel === "super" ? state.superSold : state.ecSold)[pid] ?? 0;
    total += Math.min(kg, Math.floor(Math.max(0, chCap - sold) / product.yieldPcPerKg));
  }
  return Math.min(total, salesLeft(p));
}

function planTurn(state: GameState, p: Player): Command[] {
  // 1日1アクション制：製造 か 販売 のどちらか一方を選ぶ。
  const productKg = sum(p.productInventory);
  const canSell = sellableKgNow(state, p) > 0;
  // 製品がそこそこ溜まっていて売れるなら、まず利益を確定（販売）
  if (canSell && productKg >= Math.min(5, Math.max(1, salesLeft(p)))) {
    return [{ type: "declareSell", playerId: p.id }];
  }
  // 原魚があれば、その日の製造枠ぶん加工する
  if (hasRaw(p)) {
    const candidates = PRODUCTS.filter((pr) => (p.rawInventory[pr.speciesId] ?? 0) > 0);
    if (candidates.length) {
      candidates.sort((a, b) => b.priceMax - a.priceMax);
      const pr = candidates[0];
      const kg = Math.min(mfgDailyKg(p), p.rawInventory[pr.speciesId] ?? 0);
      if (kg > 0) return [{ type: "manufacture", playerId: p.id, productId: pr.id, kg }];
    }
  }
  // 加工する原魚がなくても、売れるものがあれば売る
  if (canSell) {
    return [{ type: "declareSell", playerId: p.id }];
  }
  return [{ type: "pass", playerId: p.id }];
}

// ---- 販売（自分の番／相乗り） ----
function planSale(state: GameState, p: Player): Command[] {
  const cmds: Command[] = [];
  let cap = salesLeft(p);

  // 製品を高値の販路から（EC可ならEC、なければスーパー）
  const useEc = canUseEc(p);
  const productEntries = Object.entries(p.productInventory).filter(([, kg]) => kg > 0);
  // 価格が高い製品から売る
  productEntries.sort((a, b) => productById(b[0]).priceMax - productById(a[0]).priceMax);
  for (const [pid, kg] of productEntries) {
    if (cap <= 0) break;
    const product = productById(pid);
    const channel: Channel = useEc ? "ec" : "super";
    const chCap = channel === "super" ? superCapEff(state, product) : product.ecCap;
    const sold = (channel === "super" ? state.superSold : state.ecSold)[pid] ?? 0;
    const capLeftKg = Math.floor(Math.max(0, chCap - sold) / product.yieldPcPerKg);
    const sellKg = Math.min(kg, cap, capLeftKg);
    if (sellKg > 0) {
      cmds.push({ type: "addSaleItem", playerId: p.id, item: { kind: "product", id: pid, kg: sellKg, channel } });
      cap -= sellKg;
    }
  }

  // 余った原魚は中央市場へ（1バッチ分は加工用に残す）
  const keep = mfgKgPerProduct(p);
  for (const [sid, kg] of Object.entries(p.rawInventory)) {
    if (cap <= 0) break;
    const sell = Math.min(Math.max(0, kg - keep), cap);
    if (sell > 0) {
      cmds.push({ type: "addSaleItem", playerId: p.id, item: { kind: "raw", id: sid, kg: sell } });
      cap -= sell;
    }
  }

  cmds.push({ type: "confirmSale", playerId: p.id });
  return cmds;
}

// ---- 投資 ----
function planInvest(p: Player): Command[] {
  const cmds: Command[] = [];
  let cash = p.cash;
  const buffer = 3000; // 手元に残す現金
  const wish: InvestmentKind[] = [];
  if (!p.staff.manufacturingTrained) wish.push("trainMfg");
  if (p.staff.manufacturing < 2) wish.push("hireMfg");
  if (p.inventoryCapacity < 40) wish.push("expandCapacity");
  if (!p.staff.salesTrained) wish.push("trainSales");
  if (p.staff.sales < 2) wish.push("hireSales");
  if (p.mfgLines < 1) wish.push("addMfgLine");
  if (!p.certifications.includes("haccp") && inventoryUsed(p) >= 0) wish.push("certHaccp");

  for (const kind of wish) {
    const opt = INVESTMENT_OPTIONS.find((o) => o.kind === kind);
    if (opt && cash - opt.cost >= buffer) {
      cmds.push({ type: "invest", playerId: p.id, kind });
      cash -= opt.cost;
    }
  }
  cmds.push({ type: "finishInvestment", playerId: p.id });
  return cmds;
}
