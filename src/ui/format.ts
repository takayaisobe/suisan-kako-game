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
  return Object.entries(p.rawInventory)
    .filter(([, kg]) => kg > 0)
    .map(([id, kg]) => ({ id, kg }));
}
export function frozenList(p: Player): { id: string; kg: number }[] {
  return Object.entries(p.frozenInventory)
    .filter(([, kg]) => kg > 0)
    .map(([id, kg]) => ({ id, kg }));
}
export function productList(p: Player): { id: string; kg: number }[] {
  return Object.entries(p.productInventory)
    .filter(([, kg]) => kg > 0)
    .map(([id, kg]) => ({ id, kg }));
}

export const yen = (n: number) => `¥${n.toLocaleString()}`;
