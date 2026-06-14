// =====================================================================
// ゲームデータ（マスタ + バランス定数）— スプレッドシート本データ反映版
// 価格・歩留まり・季節グレード・イベントはスプシ準拠。
// 人件費・固定費・投資額・借入額は実現キャッシュフローに合わせた調整値（要バランス調整）。
// =====================================================================

import type {
  Certification,
  Grade,
  Season,
  Species,
  StormLevel,
} from "./types.ts";

// ---- ゲーム進行の基本定数 ----
export const TOTAL_TURNS = 20;
export const PERIODS_PER_SEASON = 5;
export const SEASONS: Season[] = ["spring", "summer", "autumn", "winter"];
export const SEASON_LABEL: Record<Season, string> = {
  spring: "春",
  summer: "夏",
  autumn: "秋",
  winter: "冬",
};

export const INITIAL_CAPITAL = 10000;
export const INITIAL_SALES_STAFF = 1;
export const INITIAL_MFG_STAFF = 1;
export const INITIAL_INVENTORY_CAPACITY = 20; // kg

// 能力値（スプシ1枚目）
export const SALES_KG_PER_STAFF = 10; // 研修済みで20
export const SALES_KG_PER_STAFF_TRAINED = 20;
export const MFG_KG_PER_PRODUCT = 5; // 研修済みで10
export const MFG_KG_PER_PRODUCT_TRAINED = 10;

// コスト（調整値）
export const WAGE_PER_STAFF = 1000; // 1人あたり1決算の人件費
export const FIXED_COST_PER_PERIOD = 1000; // 固定費（毎期）

// ---- グレード（◎◯△）の基準漁獲量（kg） ----
export const GRADE_LABEL: Record<Grade, string> = { A: "◎", B: "◯", C: "△" };
export const GRADE_BASE_KG: Record<Grade, number> = { A: 30, B: 20, C: 10 };

// ---- シケ具合 × グレード の漁獲倍率（スプシの表） ----
export const STORM_LABEL: Record<StormLevel, string> = {
  calm: "無風",
  windy: "風強め",
  typhoon: "台風",
};
export const GRADE_STORM_MULT: Record<Grade, Record<StormLevel, number>> = {
  A: { calm: 1, windy: 0.5, typhoon: 0.25 },
  B: { calm: 0.5, windy: 0.25, typhoon: 0 },
  C: { calm: 0.25, windy: 0, typhoon: 0 },
};

// ---- 季節ごとのシケ発生確率（％） ----
export const STORM_PROB: Record<Season, Record<StormLevel, number>> = {
  spring: { calm: 20, windy: 50, typhoon: 30 },
  summer: { calm: 60, windy: 20, typhoon: 20 },
  autumn: { calm: 50, windy: 40, typhoon: 10 },
  winter: { calm: 40, windy: 50, typhoon: 10 },
};

// ---- 魚種マスタ ----
export const SPECIES: Species[] = [
  {
    id: "madai",
    name: "マダイ",
    seasonality: { spring: "A", summer: "B", autumn: "C", winter: null },
    buyMin: 500,
    buyMax: 1000,
    rawSellPrice: 750,
  },
  {
    id: "katsuo",
    name: "カツオ",
    seasonality: { spring: null, summer: "A", autumn: "B", winter: "C" },
    buyMin: 400,
    buyMax: 800,
    rawSellPrice: 600,
  },
  {
    id: "saba",
    name: "サバ",
    seasonality: { spring: "C", summer: null, autumn: "A", winter: "B" },
    buyMin: 250,
    buyMax: 500,
    rawSellPrice: 400,
  },
  {
    id: "tara",
    name: "タラ",
    seasonality: { spring: "B", summer: "C", autumn: null, winter: "A" },
    buyMin: 800,
    buyMax: 1600,
    rawSellPrice: 1200,
  },
];

// ---- 製品マスタ（スプシ準拠・販売はpc単位） ----
import type { Product } from "./types.ts";
export const PRODUCTS: Product[] = [
  { id: "madai_kirimi", speciesId: "madai", name: "マダイ切身", category: "weak", yieldPcPerKg: 5, priceMin: 750, priceMax: 1500, superCap: 30, ecCap: 30 },
  { id: "madai_chazuke", speciesId: "madai", name: "マダイ茶漬け", category: "strong", yieldPcPerKg: 5, priceMin: 1000, priceMax: 1800, superCap: 30, ecCap: 30 },
  { id: "katsuo_kirimi", speciesId: "katsuo", name: "カツオ切身", category: "weak", yieldPcPerKg: 5, priceMin: 600, priceMax: 1200, superCap: 30, ecCap: 30 },
  { id: "katsuo_tataki", speciesId: "katsuo", name: "カツオのたたき", category: "strong", yieldPcPerKg: 5, priceMin: 1000, priceMax: 2000, superCap: 30, ecCap: 30 },
  { id: "saba_kirimi", speciesId: "saba", name: "サバの切身", category: "weak", yieldPcPerKg: 5, priceMin: 400, priceMax: 800, superCap: 30, ecCap: 30 },
  { id: "saba_misoni", speciesId: "saba", name: "サバの味噌煮", category: "strong", yieldPcPerKg: 5, priceMin: 600, priceMax: 1400, superCap: 30, ecCap: 30 },
  { id: "tara_kirimi", speciesId: "tara", name: "タラの切身", category: "weak", yieldPcPerKg: 4, priceMin: 1200, priceMax: 1800, superCap: 30, ecCap: 30 },
  { id: "tara_shirako", speciesId: "tara", name: "白子", category: "strong", yieldPcPerKg: 4, priceMin: 1600, priceMax: 2400, superCap: 30, ecCap: 30 },
];

// 原価率（加工品弱/強）。!! 現状ゲームでは仕入れをセリで別途支払うため未適用（二重計上回避）。
// 加工コストとして使うか要検討。スプシ値: 弱 0.3〜0.6 / 強 0.2〜0.4。
export const COST_RATE = {
  weak: { min: 0.3, max: 0.6 },
  strong: { min: 0.2, max: 0.4 },
};

// ---- EC・輸出 ----
export const EC_REQUIRES_CERT = "haccp"; // EC販路はHACCP以上で解禁
export const EU_EXPORT_BONUS = 0.2; // EU HACCP保有でEC売価 +20%

// ---- 認証マスタ ----
export const CERTIFICATIONS: Certification[] = [
  { id: "haccp", name: "HACCP認証", cost: 1500 },
  { id: "eu_haccp", name: "EU HACCP認証", cost: 3000 },
];

// ---- 投資オプション ----
export type InvestmentKind =
  | "expandCapacity" // 在庫拡張 +20
  | "addMfgLine" // 製造ライン +1
  | "trainSales"
  | "trainMfg"
  | "hireSales"
  | "hireMfg"
  | "certHaccp"
  | "certEuHaccp";

export interface InvestmentOption {
  kind: InvestmentKind;
  label: string;
  cost: number;
  description: string;
}

export const INVESTMENT_OPTIONS: InvestmentOption[] = [
  { kind: "expandCapacity", label: "在庫設備の拡張", cost: 5000, description: "在庫キャパ +20kg" },
  { kind: "addMfgLine", label: "製造設備の拡張", cost: 6000, description: "製造ライン +1（1ターンに作れる製品数 +1）" },
  { kind: "trainSales", label: "営業研修", cost: 4000, description: "営業1人あたり販売量 10→20kg" },
  { kind: "trainMfg", label: "製造研修", cost: 4000, description: "製造1製品あたり 5→10kg" },
  { kind: "hireSales", label: "営業を採用", cost: 3000, description: "営業人員 +1（人件費増）" },
  { kind: "hireMfg", label: "製造を採用", cost: 3000, description: "製造人員 +1（人件費増）" },
  { kind: "certHaccp", label: "HACCP認証取得", cost: 1500, description: "EC・輸出 販路が解禁" },
  { kind: "certEuHaccp", label: "EU HACCP認証取得", cost: 3000, description: "EC・輸出 売価 +20%" },
];

// ---- 借入オプション（調整値） ----
export const LOAN_OPTIONS = {
  short: { amount: 5000, rate: 0.05, term: 2, label: "短期借入 +5000（利率5%/期・2期で返済）" },
  long: { amount: 15000, rate: 0.03, term: 4, label: "長期借入 +15000（利率3%/期・4期で返済）" },
};

// =====================================================================
// 環境カード
// =====================================================================

/** 外部環境カード（四半期=季節ごとに1枚引き、その季節の市場に作用）。 */
export interface ExternalCard {
  id: number;
  title: string;
  text: string;
  kind: "superCap" | "price" | "catch";
  /** 対象魚種ID（null=全魚種）。 */
  target: string | null;
  mult: number;
}

const ALL_SPECIES_IDS = ["madai", "katsuo", "saba", "tara"];

export const EXTERNAL_CARDS: ExternalCard[] = [
  { id: 1, title: "マダイブーム到来", text: "マダイのスーパー販売キャパが2倍", kind: "superCap", target: "madai", mult: 2 },
  { id: 2, title: "カツオブーム到来", text: "カツオのスーパー販売キャパが2倍", kind: "superCap", target: "katsuo", mult: 2 },
  { id: 3, title: "サバブーム到来", text: "サバのスーパー販売キャパが2倍", kind: "superCap", target: "saba", mult: 2 },
  { id: 4, title: "タラブーム到来", text: "タラのスーパー販売キャパが2倍", kind: "superCap", target: "tara", mult: 2 },
  { id: 5, title: "マダイ人気減少", text: "マダイのスーパー販売キャパが1/2倍", kind: "superCap", target: "madai", mult: 0.5 },
  { id: 6, title: "カツオ人気減少", text: "カツオのスーパー販売キャパが1/2倍", kind: "superCap", target: "katsuo", mult: 0.5 },
  { id: 7, title: "サバ人気減少", text: "サバのスーパー販売キャパが1/2倍", kind: "superCap", target: "saba", mult: 0.5 },
  { id: 8, title: "タラ人気減少", text: "タラのスーパー販売キャパが1/2倍", kind: "superCap", target: "tara", mult: 0.5 },
  { id: 9, title: "魚ブーム到来", text: "全魚種のスーパー販売キャパが2倍", kind: "superCap", target: null, mult: 2 },
  { id: 10, title: "魚離れ加速", text: "全魚種のスーパー販売キャパが1/2倍", kind: "superCap", target: null, mult: 0.5 },
  { id: 11, title: "マダイブランド確立", text: "マダイの魚価が2倍", kind: "price", target: "madai", mult: 2 },
  { id: 12, title: "カツオブランド確立", text: "カツオの魚価が2倍", kind: "price", target: "katsuo", mult: 2 },
  { id: 13, title: "サバブランド確立", text: "サバの魚価が2倍", kind: "price", target: "saba", mult: 2 },
  { id: 14, title: "タラブランド確立", text: "タラの魚価が2倍", kind: "price", target: "tara", mult: 2 },
  { id: 15, title: "マダイブランド崩壊", text: "マダイの魚価が1/2倍", kind: "price", target: "madai", mult: 0.5 },
  { id: 16, title: "カツオブランド崩壊", text: "カツオの魚価が1/2倍", kind: "price", target: "katsuo", mult: 0.5 },
  { id: 17, title: "サバブランド崩壊", text: "サバの魚価が1/2倍", kind: "price", target: "saba", mult: 0.5 },
  { id: 18, title: "タラブランド崩壊", text: "タラの魚価が1/2倍", kind: "price", target: "tara", mult: 0.5 },
  { id: 19, title: "日本ブランド確立", text: "全魚種の魚価が2倍", kind: "price", target: null, mult: 2 },
  { id: 20, title: "日本ブランド崩壊", text: "全魚種の魚価が1/2倍", kind: "price", target: null, mult: 0.5 },
  { id: 21, title: "マダイ大漁", text: "マダイの漁獲量が2倍", kind: "catch", target: "madai", mult: 2 },
  { id: 22, title: "カツオ大漁", text: "カツオの漁獲量が2倍", kind: "catch", target: "katsuo", mult: 2 },
  { id: 23, title: "サバ大漁", text: "サバの漁獲量が2倍", kind: "catch", target: "saba", mult: 2 },
  { id: 24, title: "タラ大漁", text: "タラの漁獲量が2倍", kind: "catch", target: "tara", mult: 2 },
  { id: 25, title: "マダイ不漁", text: "マダイの漁獲量が1/2倍", kind: "catch", target: "madai", mult: 0.5 },
  { id: 26, title: "カツオ不漁", text: "カツオの漁獲量が1/2倍", kind: "catch", target: "katsuo", mult: 0.5 },
  { id: 27, title: "サバ不漁", text: "サバの漁獲量が1/2倍", kind: "catch", target: "saba", mult: 0.5 },
  { id: 28, title: "タラ不漁", text: "タラの漁獲量が1/2倍", kind: "catch", target: "tara", mult: 0.5 },
  { id: 29, title: "大漁万歳", text: "全魚種の漁獲量が2倍", kind: "catch", target: null, mult: 2 },
  { id: 30, title: "記録的不漁", text: "全魚種の漁獲量が1/2倍", kind: "catch", target: null, mult: 0.5 },
];

export { ALL_SPECIES_IDS };

/** 内部環境カード（決算時に各社が1枚引き、自社に作用）。 */
export type InternalEffect =
  | "hire"
  | "quit"
  | "freeTrain"
  | "demotivate"
  | "freeExpand"
  | "mfgBreak"
  | "storageBreak"
  | "strike";

export interface InternalCard {
  id: number;
  title: string;
  text: string;
  effect: InternalEffect;
}

export const INTERNAL_CARDS: InternalCard[] = [
  { id: 1, title: "縁故採用", text: "1人採用", effect: "hire" },
  { id: 2, title: "社員退職", text: "1人退職", effect: "quit" },
  { id: 3, title: "社員覚醒", text: "無料で1人教育できる", effect: "freeTrain" },
  { id: 4, title: "社員モチベーション低下", text: "1人分の教育が無効になる", effect: "demotivate" },
  { id: 5, title: "補助金獲得", text: "無料で設備拡張できる", effect: "freeExpand" },
  { id: 6, title: "製造設備故障", text: "製造設備拡張が1つ無効になる", effect: "mfgBreak" },
  { id: 7, title: "在庫故障", text: "在庫設備拡張が1つ無効になる", effect: "storageBreak" },
  { id: 8, title: "ストライキ発生", text: "1ターン休み", effect: "strike" },
];
