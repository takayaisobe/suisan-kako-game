// =====================================================================
// ゲームエンジン本体（純粋ロジック）— スプレッドシート本データ版
//   createGame() で初期状態、applyCommand(state, command) で次状態を返す。
// =====================================================================

import {
  ALL_SPECIES_IDS,
  CERTIFICATIONS,
  EC_REQUIRES_CERT,
  EU_EXPORT_BONUS,
  EXTERNAL_CARDS,
  FIXED_COST_PER_PERIOD,
  GRADE_BASE_KG,
  GRADE_STORM_MULT,
  INITIAL_CAPITAL,
  INITIAL_INVENTORY_CAPACITY,
  INITIAL_MFG_STAFF,
  INITIAL_SALES_STAFF,
  INTERNAL_CARDS,
  INVESTMENT_OPTIONS,
  LOAN_OPTIONS,
  MFG_KG_PER_PRODUCT,
  MFG_KG_PER_PRODUCT_TRAINED,
  PRODUCTS,
  SALES_KG_PER_STAFF,
  SALES_KG_PER_STAFF_TRAINED,
  SEASONS,
  SEASON_LABEL,
  SPECIES,
  STORM_LABEL,
  STORM_PROB,
  TOTAL_TURNS,
  WAGE_PER_STAFF,
  type InternalCard,
  type InvestmentKind,
} from "./data.ts";
import { nextInt, nextRandom } from "./random.ts";
import type {
  Channel,
  GameState,
  Player,
  Product,
  SaleItem,
  Season,
  Species,
  StormLevel,
} from "./types.ts";

// ---- マスタ参照 ----
const SPECIES_BY_ID = new Map<string, Species>(SPECIES.map((s) => [s.id, s]));
const PRODUCT_BY_ID = new Map<string, Product>(PRODUCTS.map((p) => [p.id, p]));

export function speciesById(id: string): Species {
  const s = SPECIES_BY_ID.get(id);
  if (!s) throw new Error(`unknown species: ${id}`);
  return s;
}
export function productById(id: string): Product {
  const p = PRODUCT_BY_ID.get(id);
  if (!p) throw new Error(`unknown product: ${id}`);
  return p;
}

// =====================================================================
// セレクタ
// =====================================================================

export function totalStaff(p: Player): number {
  return p.staff.sales + p.staff.manufacturing;
}
export function salesCapacity(p: Player): number {
  const per = p.staff.salesTrained ? SALES_KG_PER_STAFF_TRAINED : SALES_KG_PER_STAFF;
  return p.staff.sales * per;
}
export function salesLeft(p: Player): number {
  return Math.max(0, salesCapacity(p) - p.usedSalesKg);
}
export function mfgKgPerProduct(p: Player): number {
  return p.staff.manufacturingTrained ? MFG_KG_PER_PRODUCT_TRAINED : MFG_KG_PER_PRODUCT;
}
/** 1日に製造できる総kg（製造人員＋ライン × 1製品あたりkg）。1アクションでこの枠を使う。 */
export function mfgDailyKg(p: Player): number {
  return mfgKgPerProduct(p) * (p.staff.manufacturing + p.mfgLines);
}
/** この日まだ操業アクション（製造/販売）を行えるか。 */
export function canActToday(p: Player): boolean {
  return !p.turnDone;
}
export function inventoryUsed(p: Player): number {
  const sum = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0);
  return (
    sum(p.rawInventory) +
    sum(p.frozenInventory) +
    sum(p.thawingInventory) +
    sum(p.thawedInventory) +
    sum(p.productInventory)
  );
}
export function inventoryLeft(p: Player): number {
  return Math.max(0, p.inventoryCapacity - inventoryUsed(p));
}
export function netWorth(p: Player): number {
  const debt = p.loans.reduce((a, l) => a + l.principal, 0);
  return p.cash - debt;
}

/** EC・輸出販路を使えるか（HACCP以上が必要）。 */
export function canUseEc(p: Player): boolean {
  return p.certifications.includes(EC_REQUIRES_CERT);
}

/** 原魚の中央市場売価（kg・魚価補正込み）。 */
export function rawMarketPrice(state: GameState, speciesId: string): number {
  return Math.round(speciesById(speciesId).rawSellPrice * (state.priceMod[speciesId] ?? 1));
}

/** 製品のスーパー実効キャパ（pc・外部カード補正込み）。 */
export function superCapEff(state: GameState, product: Product): number {
  return Math.round(product.superCap * (state.superCapMod[product.speciesId] ?? 1));
}

/** 製品の現在の販売単価（pc）。販路の埋まり具合で下限〜上限を変動。 */
export function productUnitPriceNow(
  state: GameState,
  player: Player,
  product: Product,
  channel: Channel,
): number {
  const cap = channel === "super" ? superCapEff(state, product) : product.ecCap;
  const sold = (channel === "super" ? state.superSold : state.ecSold)[product.id] ?? 0;
  const ratio = cap > 0 ? Math.min(1, Math.max(0, sold / cap)) : 1;
  let price = product.priceMax - ratio * (product.priceMax - product.priceMin);
  if (channel === "ec" && player.certifications.includes("eu_haccp")) {
    price *= 1 + EU_EXPORT_BONUS;
  }
  return Math.round(price);
}

// =====================================================================
// 初期化
// =====================================================================

function makePlayer(id: number, name: string, isCpu: boolean): Player {
  return {
    id,
    name,
    isCpu,
    cash: INITIAL_CAPITAL,
    rawInventory: {},
    frozenInventory: {},
    thawingInventory: {},
    thawedInventory: {},
    productInventory: {},
    staff: {
      sales: INITIAL_SALES_STAFF,
      manufacturing: INITIAL_MFG_STAFF,
      salesTrained: false,
      manufacturingTrained: false,
    },
    inventoryCapacity: INITIAL_INVENTORY_CAPACITY,
    mfgLines: 0,
    certifications: [],
    loans: [],
    usedSalesKg: 0,
    turnDone: false,
    periodRevenue: 0,
    ready: false,
    skipNextTurn: false,
  };
}

export function createGame(
  playerNames: string[],
  seed = 12345,
  cpuFlags: boolean[] = [],
): GameState {
  const base: GameState = {
    turn: 0,
    season: "spring",
    period: 0,
    phase: "weather",
    storm: "calm",
    players: playerNames.map((n, i) => makePlayer(i, n, cpuFlags[i] ?? false)),
    market: [],
    activePlayer: 0,
    rngState: seed >>> 0,
    log: ["ゲーム開始。各社 資本金 " + INITIAL_CAPITAL + " でスタート。"],
    purchaseBids: {},
    bidsSubmitted: [],
    openSale: null,
    passStreak: 0,
    superSold: {},
    ecSold: {},
    priceMod: {},
    catchMod: {},
    superCapMod: {},
    internalEvents: {},
    history: [{ label: "開始", values: playerNames.map(() => INITIAL_CAPITAL) }],
    auctionResults: [],
    lastSaleResult: null,
    saleResultSeq: 0,
  };
  return beginTurn(base);
}

// =====================================================================
// ターン開始（シケ・市場の生成）
// =====================================================================

function seasonOf(turn: number): { season: Season; period: number } {
  const idx = turn - 1;
  return { season: SEASONS[Math.floor(idx / 5)], period: (idx % 5) + 1 };
}

function rollStorm(state: GameState): void {
  const probs = STORM_PROB[state.season];
  const expanded: StormLevel[] = [];
  (Object.keys(probs) as StormLevel[]).forEach((lvl) => {
    for (let i = 0; i < probs[lvl]; i++) expanded.push(lvl);
  });
  const r = nextInt(state.rngState, 0, expanded.length - 1);
  state.rngState = r.state;
  state.storm = expanded[r.value];
}

function generateMarket(state: GameState): void {
  state.market = [];
  for (const sp of SPECIES) {
    const grade = sp.seasonality[state.season];
    if (!grade) continue;
    const base = GRADE_BASE_KG[grade];
    const mult = GRADE_STORM_MULT[grade][state.storm];
    const catchMod = state.catchMod[sp.id] ?? 1;
    const kg = Math.round(base * mult * catchMod);
    if (kg <= 0) continue;
    const priceMod = state.priceMod[sp.id] ?? 1;
    state.market.push({
      id: `${sp.id}-${state.turn}`,
      speciesId: sp.id,
      kg,
      minPrice: Math.round(sp.buyMin * priceMod),
      refMaxPrice: Math.round(sp.buyMax * priceMod),
    });
  }
}

function beginTurn(state: GameState): GameState {
  const turn = state.turn + 1;
  if (turn > TOTAL_TURNS) {
    state.phase = "gameover";
    state.log = [rankingLine(state), ...state.log].slice(0, 40);
    return state;
  }
  state.turn = turn;
  const { season, period } = seasonOf(turn);
  state.season = season;
  state.period = period;
  state.phase = "weather";
  state.activePlayer = 0;
  state.purchaseBids = {};
  state.bidsSubmitted = [];
  state.openSale = null;
  state.passStreak = 0;
  state.superSold = {};
  state.ecSold = {};
  for (const p of state.players) {
    // ① 解凍済みのまま使わなかったぶんは傷んで廃棄
    const rottedThawed = Object.values(p.thawedInventory).reduce((a, b) => a + b, 0);
    if (rottedThawed > 0) {
      pushLog(state, `${p.name}：解凍したまま使わなかった原魚 ${rottedThawed}kg が傷んで廃棄`);
    }
    p.thawedInventory = {};
    // ② 前日に解凍指示したぶんが本日使える状態に（解凍中→解凍済み）
    p.thawedInventory = { ...p.thawingInventory };
    p.thawingInventory = {};
    // ③ 生のまま加工/冷凍/販売しなかった原魚は傷んで廃棄
    const rottedRaw = Object.values(p.rawInventory).reduce((a, b) => a + b, 0);
    if (rottedRaw > 0) {
      pushLog(state, `${p.name}：生のまま使わなかった原魚 ${rottedRaw}kg が傷んで廃棄`);
      p.rawInventory = {};
    }
    p.usedSalesKg = 0;
    p.turnDone = false;
    p.ready = false;
  }
  rollStorm(state);
  generateMarket(state);
  pushLog(
    state,
    `── ${SEASON_LABEL[season]}・第${period}期（第${turn}ターン） シケ:${STORM_LABEL[state.storm]} ──`,
  );
  return state;
}

function rankingLine(state: GameState): string {
  const ranked = [...state.players].sort((a, b) => netWorth(b) - netWorth(a));
  return (
    "ゲーム終了！ " +
    ranked.map((p, i) => `${i + 1}位 ${p.name}(純資産${netWorth(p)})`).join(" / ")
  );
}

// =====================================================================
// コマンド
// =====================================================================

export type Command =
  | { type: "proceedToPurchase" }
  | { type: "proceedToAction" }
  | { type: "setBid"; playerId: number; lotId: string; pricePerKg: number; qtyKg: number }
  | { type: "submitBids"; playerId: number }
  | { type: "manufacture"; playerId: number; productId: string; kg: number }
  | { type: "freeze"; playerId: number; speciesId: string; kg: number }
  | { type: "thaw"; playerId: number; speciesId: string; kg: number }
  | { type: "reassign"; playerId: number; dir: "toMfg" | "toSales" }
  | { type: "declareSell"; playerId: number }
  | { type: "addSaleItem"; playerId: number; item: SaleItem }
  | { type: "removeSaleItem"; playerId: number; index: number }
  | { type: "confirmSale"; playerId: number }
  | { type: "pass"; playerId: number }
  | { type: "proceedToInvestment" }
  | { type: "invest"; playerId: number; kind: InvestmentKind }
  | { type: "takeLoan"; playerId: number; kind: "short" | "long" }
  | { type: "finishInvestment"; playerId: number };

function pushLog(state: GameState, msg: string): void {
  state.log = [msg, ...state.log].slice(0, 40);
}

function addRaw(p: Player, speciesId: string, kg: number): void {
  p.rawInventory[speciesId] = (p.rawInventory[speciesId] ?? 0) + kg;
  if (p.rawInventory[speciesId] <= 0) delete p.rawInventory[speciesId];
}
function addFrozen(p: Player, speciesId: string, kg: number): void {
  p.frozenInventory[speciesId] = (p.frozenInventory[speciesId] ?? 0) + kg;
  if (p.frozenInventory[speciesId] <= 0) delete p.frozenInventory[speciesId];
}
function addThawed(p: Player, speciesId: string, kg: number): void {
  p.thawedInventory[speciesId] = (p.thawedInventory[speciesId] ?? 0) + kg;
  if (p.thawedInventory[speciesId] <= 0) delete p.thawedInventory[speciesId];
}
function addThawing(p: Player, speciesId: string, kg: number): void {
  p.thawingInventory[speciesId] = (p.thawingInventory[speciesId] ?? 0) + kg;
  if (p.thawingInventory[speciesId] <= 0) delete p.thawingInventory[speciesId];
}
function addProduct(p: Player, productId: string, kg: number): void {
  p.productInventory[productId] = (p.productInventory[productId] ?? 0) + kg;
  if (p.productInventory[productId] <= 0) delete p.productInventory[productId];
}

export function applyCommand(prev: GameState, command: Command): GameState {
  const state: GameState = structuredClone(prev);

  switch (command.type) {
    case "proceedToPurchase": {
      if (state.phase !== "weather") return prev;
      state.phase = "purchase";
      return state;
    }

    case "proceedToAction": {
      if (state.phase !== "auctionResult") return prev;
      startActionPhase(state);
      return state;
    }

    case "setBid": {
      if (state.phase !== "purchase") return prev;
      const bids = (state.purchaseBids[command.playerId] ??= {});
      if (command.pricePerKg <= 0 || command.qtyKg <= 0) delete bids[command.lotId];
      else bids[command.lotId] = { price: command.pricePerKg, qty: command.qtyKg };
      return state;
    }

    case "submitBids": {
      if (state.phase !== "purchase") return prev;
      if (!state.bidsSubmitted.includes(command.playerId)) {
        state.bidsSubmitted.push(command.playerId);
      }
      if (state.bidsSubmitted.length >= state.players.length) resolvePurchase(state);
      return state;
    }

    case "manufacture": {
      if (state.phase !== "action") return prev;
      doManufacture(state, command.playerId, command.productId, command.kg);
      return state;
    }

    case "freeze": {
      if (state.phase !== "action") return prev;
      const p = state.players[command.playerId];
      const kg = Math.min(command.kg, p.rawInventory[command.speciesId] ?? 0);
      if (kg <= 0) return prev;
      addRaw(p, command.speciesId, -kg);
      addFrozen(p, command.speciesId, kg);
      pushLog(state, `${p.name}：${speciesById(command.speciesId).name} ${kg}kgを冷凍`);
      return state;
    }

    case "thaw": {
      // 解凍は前日（朝の準備）に指示。翌朝に「解凍済み」となり、その日に加工/販売しないと腐る。
      if (state.phase !== "purchase") return prev;
      const p = state.players[command.playerId];
      const kg = Math.min(command.kg, p.frozenInventory[command.speciesId] ?? 0);
      if (kg <= 0) return prev;
      addFrozen(p, command.speciesId, -kg);
      addThawing(p, command.speciesId, kg);
      pushLog(state, `${p.name}：${speciesById(command.speciesId).name} ${kg}kgを解凍開始（翌日使える）`);
      return state;
    }

    case "reassign": {
      // 配置転換も朝（セリ前）。営業↔製造を1人移動。
      if (state.phase !== "purchase") return prev;
      const p = state.players[command.playerId];
      if (command.dir === "toMfg") {
        if (p.staff.sales < 1) return prev;
        p.staff.sales -= 1;
        p.staff.manufacturing += 1;
      } else {
        if (p.staff.manufacturing < 1) return prev;
        p.staff.manufacturing -= 1;
        p.staff.sales += 1;
      }
      pushLog(state, `${p.name}：配置転換（${command.dir === "toMfg" ? "営業→製造" : "製造→営業"}）`);
      return state;
    }

    case "declareSell": {
      if (state.phase !== "action" || state.openSale) return prev;
      if (command.playerId !== state.activePlayer) return prev;
      if (state.players[command.playerId].turnDone) return prev;
      // 相乗りは自分のアクションを消費しない＝本日行動済みの社も含め全社が参加可能
      state.openSale = { initiator: command.playerId, contributions: {}, confirmed: [] };
      pushLog(state, `${state.players[command.playerId].name} が販売を宣言（相乗り可）`);
      return state;
    }

    case "addSaleItem": {
      if (!state.openSale) return prev;
      addSaleItem(state, command.playerId, command.item);
      return state;
    }

    case "removeSaleItem": {
      if (!state.openSale) return prev;
      const list = state.openSale.contributions[command.playerId];
      if (list) list.splice(command.index, 1);
      return state;
    }

    case "confirmSale": {
      if (!state.openSale) return prev;
      if (!state.openSale.confirmed.includes(command.playerId)) {
        state.openSale.confirmed.push(command.playerId);
      }
      if (state.openSale.confirmed.length >= state.players.length) resolveSale(state);
      return state;
    }

    case "pass": {
      if (state.phase !== "action" || state.openSale) return prev;
      if (command.playerId !== state.activePlayer) return prev;
      state.players[command.playerId].turnDone = true;
      advanceActionPlayer(state);
      return state;
    }

    case "proceedToInvestment": {
      if (state.phase !== "settlement") return prev;
      state.phase = "investment";
      state.activePlayer = 0;
      for (const p of state.players) p.ready = false;
      return state;
    }

    case "invest": {
      if (state.phase !== "investment") return prev;
      doInvest(state, command.playerId, command.kind);
      return state;
    }

    case "takeLoan": {
      if (state.phase !== "investment") return prev;
      const p = state.players[command.playerId];
      const opt = LOAN_OPTIONS[command.kind];
      p.loans.push({ principal: opt.amount, rate: opt.rate, termRemaining: opt.term, kind: command.kind });
      p.cash += opt.amount;
      pushLog(state, `${p.name}：${command.kind === "short" ? "短期" : "長期"}借入 +${opt.amount}`);
      return state;
    }

    case "finishInvestment": {
      if (state.phase !== "investment") return prev;
      state.players[command.playerId].ready = true;
      if (state.players.every((p) => p.ready)) return beginTurn(state);
      return state;
    }

    default:
      return prev;
  }
}

// ---- セリの解決（単価＋数量。高単価から順に割当、1ロットを分け合える） ----
function resolvePurchase(state: GameState): void {
  const results: GameState["auctionResults"] = [];
  for (const lot of state.market) {
    // 有効な入札（最低価格以上・数量>0）を集め、ランダムなタイブレーク値を付与
    const bids: { playerId: number; price: number; qty: number; rnd: number }[] = [];
    for (const p of state.players) {
      const b = state.purchaseBids[p.id]?.[lot.id];
      if (b && b.price >= lot.minPrice && b.qty > 0) {
        const r = nextInt(state.rngState, 0, 1_000_000);
        state.rngState = r.state;
        bids.push({ playerId: p.id, price: b.price, qty: b.qty, rnd: r.value });
      }
    }
    // 高単価優先、同値はランダム
    bids.sort((a, b) => b.price - a.price || a.rnd - b.rnd);

    let remaining = lot.kg;
    const allocations: { playerId: number; kg: number; price: number }[] = [];
    for (const bid of bids) {
      if (remaining <= 0) break;
      const p = state.players[bid.playerId];
      const give = Math.min(remaining, bid.qty, inventoryLeft(p), Math.floor(p.cash / bid.price));
      if (give <= 0) continue;
      const cost = bid.price * give;
      p.cash -= cost;
      addRaw(p, lot.speciesId, give);
      remaining -= give;
      allocations.push({ playerId: bid.playerId, kg: give, price: bid.price });
      pushLog(state, `${p.name}：${speciesById(lot.speciesId).name} ${give}kgを@${bid.price}で落札（-${cost}）`);
    }
    results.push({ speciesId: lot.speciesId, kg: lot.kg, allocations });
  }
  state.auctionResults = results;
  state.market = [];
  // セリ結果を発表（一呼吸）してから操業へ
  state.phase = "auctionResult";
}

/** セリ結果の発表を終えて操業フェーズへ。 */
function startActionPhase(state: GameState): void {
  state.phase = "action";
  state.activePlayer = state.players.length - 1; // 先頭の行動可能プレイヤーから
  advanceActionPlayer(state);
}

// ---- 製造（1日1アクション・その日の製造枠ぶん） ----
function doManufacture(state: GameState, playerId: number, productId: string, kg: number): void {
  const p = state.players[playerId];
  if (playerId !== state.activePlayer || p.turnDone) return;
  const product = productById(productId);
  const sp = product.speciesId;
  const avail = (p.thawedInventory[sp] ?? 0) + (p.rawInventory[sp] ?? 0);
  const useKg = Math.min(kg, mfgDailyKg(p), avail);
  if (useKg <= 0) return;
  // 解凍した原魚から先に消費（使わないと腐るため）
  const fromThawed = Math.min(useKg, p.thawedInventory[sp] ?? 0);
  if (fromThawed > 0) addThawed(p, sp, -fromThawed);
  if (useKg - fromThawed > 0) addRaw(p, sp, -(useKg - fromThawed));
  addProduct(p, productId, useKg);
  p.turnDone = true;
  pushLog(state, `${p.name}：${speciesById(product.speciesId).name}→${product.name} ${useKg}kgを製造（本日の操業終了）`);
  advanceActionPlayer(state);
}

// ---- 販売（相乗り・3販路） ----
function ownedKg(p: Player, item: SaleItem): number {
  // 原魚は「解凍済み＋生」の合計（どちらも中央市場で売れる）
  if (item.kind === "raw") return (p.thawedInventory[item.id] ?? 0) + (p.rawInventory[item.id] ?? 0);
  return p.productInventory[item.id] ?? 0;
}

function addSaleItem(state: GameState, playerId: number, item: SaleItem): void {
  const sale = state.openSale!;
  const p = state.players[playerId];
  // 相乗りは行動済みでも可（営業キャパの範囲で売れる）
  // 製品はEC指定ならHACCP必須
  if (item.kind === "product" && item.channel === "ec" && !canUseEc(p)) return;
  const list = (sale.contributions[playerId] ??= []);
  const alreadyKg = list.reduce((a, i) => a + i.kg, 0);
  const sameStock = list
    .filter((i) => i.kind === item.kind && i.id === item.id)
    .reduce((a, i) => a + i.kg, 0);
  const capLeft = salesLeft(p) - alreadyKg;
  const ownLeft = ownedKg(p, item) - sameStock;
  const kg = Math.min(item.kg, capLeft, ownLeft);
  if (kg <= 0) return;
  const channel: Channel = item.kind === "raw" ? "market" : item.channel ?? "super";
  list.push({ ...item, kg, channel });
}

function resolveSale(state: GameState): void {
  const sale = state.openSale!;
  const sellers: { playerId: number; amount: number }[] = [];
  // 出品を「販路ごと」に集約して、混み具合に応じた価格で処理
  for (const [pidStr, items] of Object.entries(sale.contributions)) {
    const pid = Number(pidStr);
    const p = state.players[pid];
    let revenue = 0;
    for (const item of items) {
      const have = ownedKg(p, item);
      const kg = Math.min(item.kg, have);
      if (kg <= 0) continue;

      if (item.kind === "raw") {
        // 中央市場（無制限）。解凍済みから先に出す（再冷凍できず腐るため）。
        revenue += rawMarketPrice(state, item.id) * kg;
        const fromThawed = Math.min(kg, p.thawedInventory[item.id] ?? 0);
        if (fromThawed > 0) addThawed(p, item.id, -fromThawed);
        if (kg - fromThawed > 0) addRaw(p, item.id, -(kg - fromThawed));
        p.usedSalesKg += kg;
        continue;
      }

      // 加工品：スーパー or EC（共有キャパ・価格逓減）
      const product = productById(item.id);
      const channel: Channel = item.channel ?? "super";
      if (channel === "ec" && !canUseEc(p)) continue;
      const cap = channel === "super" ? superCapEff(state, product) : product.ecCap;
      const soldMap = channel === "super" ? state.superSold : state.ecSold;
      const soldBefore = soldMap[product.id] ?? 0;
      const capLeftPc = Math.max(0, cap - soldBefore);
      const sellKg = Math.min(kg, Math.floor(capLeftPc / product.yieldPcPerKg));
      if (sellKg <= 0) continue;
      const pc = sellKg * product.yieldPcPerKg;
      // 逓減価格：販路の埋まり度(中点)で線形補間
      const ratio = cap > 0 ? Math.min(1, (soldBefore + pc / 2) / cap) : 1;
      let unit = product.priceMax - ratio * (product.priceMax - product.priceMin);
      if (channel === "ec" && p.certifications.includes("eu_haccp")) unit *= 1 + EU_EXPORT_BONUS;
      revenue += Math.round(unit) * pc;
      soldMap[product.id] = soldBefore + pc;
      addProduct(p, product.id, -sellKg);
      p.usedSalesKg += sellKg;
    }
    if (revenue > 0) {
      p.cash += revenue;
      p.periodRevenue += revenue;
      sellers.push({ playerId: pid, amount: revenue });
      pushLog(state, `${p.name}：販売で +${revenue}`);
    }
  }
  // 販売成立のポップアップ用に記録
  if (sellers.length > 0) {
    state.saleResultSeq += 1;
    state.lastSaleResult = { seq: state.saleResultSeq, sellers };
  }
  // 自分のアクションを消費するのは「販売を宣言した社」だけ。
  // 相乗り（他社の宣言に乗った社）はアクションを消費しない＝同じ日に製造も可能。
  state.players[sale.initiator].turnDone = true;
  state.openSale = null;
  advanceActionPlayer(state);
}

// ---- action フェーズ進行（1日1アクション制） ----
// 次の「本日まだ行動していない」プレイヤーへ。ストライキ社は自動で行動消費。
function advanceActionPlayer(state: GameState): void {
  const n = state.players.length;
  for (let step = 1; step <= n; step++) {
    const idx = (state.activePlayer + step) % n;
    const p = state.players[idx];
    if (p.turnDone) continue;
    if (p.skipNextTurn) {
      p.skipNextTurn = false;
      p.turnDone = true;
      pushLog(state, `${p.name}：ストライキで操業を休み`);
      continue;
    }
    state.activePlayer = idx;
    return;
  }
  endActionPhase(state);
}

function endActionPhase(state: GameState): void {
  if (state.period === 5) runSettlement(state);
  else beginTurn(state);
}

// ---- 決算 ----
function applyInternalCard(state: GameState, p: Player, card: InternalCard): void {
  switch (card.effect) {
    case "hire":
      p.staff.manufacturing += 1;
      break;
    case "quit":
      if (p.staff.manufacturing > 0) p.staff.manufacturing -= 1;
      else if (p.staff.sales > 1) p.staff.sales -= 1;
      break;
    case "freeTrain":
      if (!p.staff.manufacturingTrained) p.staff.manufacturingTrained = true;
      else p.staff.salesTrained = true;
      break;
    case "demotivate":
      if (p.staff.manufacturingTrained) p.staff.manufacturingTrained = false;
      else if (p.staff.salesTrained) p.staff.salesTrained = false;
      break;
    case "freeExpand":
      p.inventoryCapacity += 20;
      break;
    case "mfgBreak":
      if (p.mfgLines > 0) p.mfgLines -= 1;
      break;
    case "storageBreak":
      if (p.inventoryCapacity > INITIAL_INVENTORY_CAPACITY) p.inventoryCapacity -= 20;
      break;
    case "strike":
      p.skipNextTurn = true;
      break;
  }
  pushLog(state, `${p.name}【内部カード】${card.title}：${card.text}`);
}

function runSettlement(state: GameState): void {
  // 各社の損益（人件費・固定費・利息・借入返済）
  for (const p of state.players) {
    const wages = totalStaff(p) * WAGE_PER_STAFF;
    let interest = 0;
    const remaining = [];
    for (const loan of p.loans) {
      interest += Math.round(loan.principal * loan.rate);
      loan.termRemaining -= 1;
      if (loan.termRemaining <= 0) {
        p.cash -= loan.principal;
        pushLog(state, `${p.name}：借入 ${loan.principal} を返済`);
      } else remaining.push(loan);
    }
    p.loans = remaining;
    p.cash -= wages + FIXED_COST_PER_PERIOD + interest;
    pushLog(
      state,
      `${p.name} 決算：売上${p.periodRevenue} / 人件費-${wages} 固定費-${FIXED_COST_PER_PERIOD} 利息-${interest} → 現金${p.cash}`,
    );
    p.periodRevenue = 0;
  }

  // 純資産の推移を記録
  state.history.push({ label: `${SEASON_LABEL[state.season]}末`, values: state.players.map(netWorth) });

  // 内部環境カード（各社が1枚ずつ）
  state.internalEvents = {};
  for (const p of state.players) {
    const r = nextInt(state.rngState, 0, INTERNAL_CARDS.length - 1);
    state.rngState = r.state;
    const card = INTERNAL_CARDS[r.value];
    state.internalEvents[p.id] = card.title;
    applyInternalCard(state, p, card);
  }

  // 外部環境カード（次の四半期へ作用）：補正をリセットして1枚適用
  state.priceMod = {};
  state.catchMod = {};
  state.superCapMod = {};
  const er = nextInt(state.rngState, 0, EXTERNAL_CARDS.length - 1);
  state.rngState = er.state;
  const ext = EXTERNAL_CARDS[er.value];
  const targets = ext.target ? [ext.target] : ALL_SPECIES_IDS;
  const map =
    ext.kind === "price" ? state.priceMod : ext.kind === "catch" ? state.catchMod : state.superCapMod;
  for (const t of targets) map[t] = ext.mult;
  state.event = ext.text;
  pushLog(state, `【外部カード】${ext.title}：${ext.text}`);

  state.phase = "settlement";
}

// ---- 投資 ----
function doInvest(state: GameState, playerId: number, kind: InvestmentKind): void {
  const p = state.players[playerId];
  const opt = INVESTMENT_OPTIONS.find((o) => o.kind === kind);
  if (!opt || p.cash < opt.cost) return;
  switch (kind) {
    case "expandCapacity":
      p.inventoryCapacity += 20;
      break;
    case "addMfgLine":
      p.mfgLines += 1;
      break;
    case "trainSales":
      if (p.staff.salesTrained) return;
      p.staff.salesTrained = true;
      break;
    case "trainMfg":
      if (p.staff.manufacturingTrained) return;
      p.staff.manufacturingTrained = true;
      break;
    case "hireSales":
      p.staff.sales += 1;
      break;
    case "hireMfg":
      p.staff.manufacturing += 1;
      break;
    case "certHaccp":
      if (p.certifications.includes("haccp")) return;
      p.certifications.push("haccp");
      break;
    case "certEuHaccp":
      if (p.certifications.includes("eu_haccp")) return;
      p.certifications.push("eu_haccp");
      break;
  }
  p.cash -= opt.cost;
  pushLog(state, `${p.name}：${opt.label}（-${opt.cost}）`);
}

// マスタの存在チェック（将来用）
export const _certNames = CERTIFICATIONS.map((c) => c.name);
export { nextRandom };
