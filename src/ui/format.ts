import {
  PRODUCTS,
  SPECIES,
  speciesById,
  productById,
  type Player,
} from "../engine/index.ts";

export const speciesName = (id: string) => speciesById(id).name;
export const productName = (id: string) => {
  const p = productById(id);
  return `${speciesById(p.speciesId).name}・${p.name}`;
};

export const ALL_SPECIES = SPECIES;
export const ALL_PRODUCTS = PRODUCTS;

/** プレイヤーの原魚在庫を一覧（kg>0のみ）。 */
export function rawList(p: Player): { id: string; kg: number }[] {
  return invList(p.rawInventory);
}
export function frozenList(p: Player): { id: string; kg: number }[] {
  return invList(p.frozenInventory);
}
export function thawedList(p: Player): { id: string; kg: number }[] {
  return invList(p.thawedInventory);
}
export function thawingList(p: Player): { id: string; kg: number }[] {
  return invList(p.thawingInventory);
}
/** 在庫レコードを配列化（古いセーブで欠けていても安全）。 */
function invList(rec: Record<string, number> | undefined): { id: string; kg: number }[] {
  return Object.entries(rec ?? {})
    .filter(([, kg]) => kg > 0)
    .map(([id, kg]) => ({ id, kg }));
}
export function productList(p: Player): { id: string; kg: number }[] {
  return invList(p.productInventory);
}

export const yen = (n: number) => `¥${n.toLocaleString()}`;
