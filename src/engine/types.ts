// =====================================================================
// 水産加工経営ゲーム — ドメイン型定義（スプレッドシート本データ版）
// すべて純粋なデータ型。UI / Reactには依存しない。
// =====================================================================

export type Season = "spring" | "summer" | "autumn" | "winter";

/** シケ具合。漁獲量に影響する。 */
export type StormLevel = "calm" | "windy" | "typhoon"; // 無風 / 風強め / 台風

/** 漁獲グレード。季節ごとの獲れやすさ。 */
export type Grade = "A" | "B" | "C"; // ◎ / ◯ / △

/** 販路。 */
export type Channel = "market" | "super" | "ec"; // 中央市場 / スーパー / EC・輸出

export type SpeciesId = string;
export type ProductId = string;
export type CertId = string;

/** ゲーム進行のフェーズ。 */
export type Phase =
  | "weather" // シケ・市場の公開（自動）
  | "purchase" // 朝のセリ（全員入札）
  | "auctionResult" // セリ結果の発表（一呼吸）
  | "action" // 製造 / 販売の宣言ラウンド
  | "settlement" // 決算（5期ごと）
  | "investment" // 投資・資金調達（5期ごと、決算後）
  | "gameover";

/** 魚種マスタ。 */
export interface Species {
  id: SpeciesId;
  name: string;
  /** 季節ごとの漁獲グレード（null=その季節は獲れない）。 */
  seasonality: Record<Season, Grade | null>;
  /** 仕入れ単価（セリ）の下限・上限（円/kg）。 */
  buyMin: number;
  buyMax: number;
  /** 原魚の中央市場での売価（円/kg）。魚価イベントで変動。 */
  rawSellPrice: number;
}

/** 製品マスタ（魚種ごとの加工段階）。販売はpc単位。 */
export interface Product {
  id: ProductId;
  speciesId: SpeciesId;
  name: string;
  /** 加工品弱 / 加工品強（原価率カテゴリ）。 */
  category: "weak" | "strong";
  /** 歩留まり（pc/kg）。原魚1kgから何pc取れるか。 */
  yieldPcPerKg: number;
  /** スーパー販売単価（円/pc）の下限・上限。混み具合で変動。 */
  priceMin: number;
  priceMax: number;
  /** スーパー販路キャパ（pc/ターン・全社共有）。外部カードで増減。 */
  superCap: number;
  /** EC・輸出 販路キャパ（pc/ターン・全社共有）。認証が必要。 */
  ecCap: number;
}

/** 認証マスタ。 */
export interface Certification {
  id: CertId;
  name: string;
  cost: number;
}

/** 市場に並ぶ1ロット（朝のセリ対象）。 */
export interface MarketLot {
  id: string;
  speciesId: SpeciesId;
  kg: number;
  /** 最低落札価格（kgあたり）＝仕入れ下限×魚価補正。 */
  minPrice: number;
  /** 相場上限（参考表示）＝仕入れ上限×魚価補正。 */
  refMaxPrice: number;
}

/** 販売に出す品目。 */
export interface SaleItem {
  /** raw=原魚（中央市場）, product=加工品。 */
  kind: "raw" | "product";
  /** kind=raw なら SpeciesId、product なら ProductId。 */
  id: string;
  /** 出荷量（kg）。 */
  kg: number;
  /** 加工品の販路（product時のみ）。 */
  channel?: Channel;
}

/** 販売の相乗りウィンドウ（actionフェーズ中の一時状態）。 */
export interface OpenSale {
  initiator: number;
  contributions: Record<number, SaleItem[]>;
  confirmed: number[];
}

/** プレイヤーの人員。 */
export interface Staff {
  sales: number;
  manufacturing: number;
  salesTrained: boolean;
  manufacturingTrained: boolean;
}

/** 借入。 */
export interface Loan {
  principal: number;
  rate: number;
  termRemaining: number;
  kind: "short" | "long";
}

/** プレイヤー状態。 */
export interface Player {
  id: number;
  name: string;
  /** CPU（AI）が操作するか。 */
  isCpu: boolean;
  cash: number;
  rawInventory: Record<SpeciesId, number>; // kg
  frozenInventory: Record<SpeciesId, number>; // kg
  /** 解凍した原魚（要加工）。その日に製造で使わないと翌朝腐る。 */
  thawedInventory: Record<SpeciesId, number>; // kg
  productInventory: Record<ProductId, number>; // kg（売却時にpc換算）
  staff: Staff;
  /** 在庫キャパ（kg）。 */
  inventoryCapacity: number;
  /** 製造ライン増設数（設備強化）。製造可能製品数 = 製造人員 + mfgLines。 */
  mfgLines: number;
  certifications: CertId[];
  loans: Loan[];
  usedSalesKg: number;
  /** この日の操業アクション（製造 or 販売）を使い切ったか。1日1アクション制。 */
  turnDone: boolean;
  periodRevenue: number;
  ready: boolean;
  /** ストライキ等で次の操業を1回休む。 */
  skipNextTurn: boolean;
}

/** ゲーム全体の状態。 */
export interface GameState {
  turn: number; // 1..20
  season: Season;
  period: number; // 1..5
  phase: Phase;
  storm: StormLevel;
  players: Player[];
  market: MarketLot[];
  activePlayer: number;
  rngState: number;
  log: string[];

  // ---- フェーズ別の一時状態 ----
  /** purchaseフェーズ：プレイヤーID → (ロットID → {単価, 希望数量kg})。 */
  purchaseBids: Record<number, Record<string, { price: number; qty: number }>>;
  bidsSubmitted: number[];
  openSale: OpenSale | null;
  passStreak: number;

  /** このターンに各製品がスーパー/ECへ出荷された累計pc（全社共有・価格下落に使用）。 */
  superSold: Record<ProductId, number>;
  ecSold: Record<ProductId, number>;

  // ---- 環境カードによる四半期の補正（季節=四半期ごとに更新） ----
  /** 魚価倍率（魚種ID→倍率）。中央市場の原魚売価と仕入れ価格に作用。 */
  priceMod: Record<SpeciesId, number>;
  /** 漁獲量倍率。 */
  catchMod: Record<SpeciesId, number>;
  /** スーパー販路キャパ倍率。 */
  superCapMod: Record<SpeciesId, number>;
  /** 直近に引いた外部カードの説明。 */
  event?: string;
  /** 各プレイヤーが直近に引いた内部カードのタイトル（決算時に更新）。 */
  internalEvents?: Record<number, string>;
  /** 純資産の推移（開始時＋各決算）。values は playerId 順。 */
  history: { label: string; values: number[] }[];
  /** セリ結果（auctionResultフェーズで発表）。1ロットを複数社で分け合える。 */
  auctionResults: {
    speciesId: SpeciesId;
    kg: number; // 出品量
    /** 落札の内訳（高単価順に割当）。空＝不成立。 */
    allocations: { playerId: number; kg: number; price: number }[];
  }[];
  /** 直近の販売成立（ポップアップ表示用）。 */
  lastSaleResult: { seq: number; sellers: { playerId: number; amount: number }[] } | null;
  /** 販売成立のシーケンス番号（ポップアップ検知用）。 */
  saleResultSeq: number;
}
