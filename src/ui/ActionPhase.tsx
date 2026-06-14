import { useEffect, useState } from "react";
import {
  canUseEc,
  inventoryUsed,
  mfgDailyKg,
  productById,
  productUnitPriceNow,
  rawMarketPrice,
  salesCapacity,
  salesLeft,
  superCapEff,
  type Channel,
  type Command,
  type GameState,
  type Player,
} from "../engine/index.ts";
import {
  ALL_PRODUCTS,
  frozenList,
  productList,
  productName,
  rawList,
  speciesName,
  thawedList,
  thawingList,
  yen,
} from "./format.ts";
import { HandOff } from "./HandOff.tsx";
import { useNet } from "./net-context.ts";
import { WaitingPanel } from "./WaitingPanel.tsx";

interface Props {
  state: GameState;
  dispatch: (c: Command) => void;
}

export function ActionPhase({ state, dispatch }: Props) {
  const { online, mySeat } = useNet();
  const inSale = !!state.openSale;
  const actor: Player | undefined = inSale
    ? state.players.find((p) => !state.openSale!.confirmed.includes(p.id))
    : state.players[state.activePlayer];

  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    setRevealed(false);
  }, [actor?.id, inSale]);

  if (!actor) return null;

  const panel = inSale ? (
    <SalePanel state={state} dispatch={dispatch} actor={actor} />
  ) : (
    <TurnPanel state={state} dispatch={dispatch} actor={actor} />
  );

  if (online) {
    if (actor.id !== mySeat) {
      return (
        <WaitingPanel
          name={actor.name}
          note={inSale ? "販売タイム：相手が出品しています。" : "相手の手番です。"}
        />
      );
    }
    return panel; // 自席はそのまま操作（目隠し不要）
  }

  if (!revealed) {
    return (
      <HandOff
        name={actor.name}
        note={inSale ? "販売の相乗りタイムです。参加するか決めましょう。" : undefined}
        onReveal={() => setRevealed(true)}
      />
    );
  }

  return panel;
}

// ---- 通常の手番 ----
function TurnPanel({ dispatch, actor }: Props & { actor: Player }) {
  const eligible = ALL_PRODUCTS.filter((pr) => (actor.rawInventory[pr.speciesId] ?? 0) > 0);
  const [prodId, setProdId] = useState(eligible[0]?.id ?? "");
  const selected = prodId ? productById(prodId) : undefined;
  const maxMfgKg = selected
    ? Math.min(mfgDailyKg(actor), actor.rawInventory[selected.speciesId] ?? 0)
    : 0;
  const [mfgKg, setMfgKg] = useState(maxMfgKg);
  useEffect(() => setMfgKg(maxMfgKg), [maxMfgKg]);

  const canMfg = eligible.length > 0 && maxMfgKg > 0;

  return (
    <div className="card">
      <h2>
        {actor.name} の手番{" "}
        <span className="muted small">
          （その日の製造枠 {mfgDailyKg(actor)}kg / 販売枠 {salesLeft(actor)}kg）
        </span>
      </h2>
      <p className="pill">自分の手番は「製造」か「販売」どちらか一方（選ぶと手番終了）。他社の販売には相乗り可・製造した日でもOK</p>

      <InventoryView actor={actor} />

      <h3 style={{ marginTop: 14 }}>製造する（自分だけ・他社は割り込めない）</h3>
      {eligible.length === 0 ? (
        <p className="muted small">原魚がありません。先にセリで仕入れましょう。</p>
      ) : (
        <div className="row">
          <select value={prodId} onChange={(e) => setProdId(e.target.value)}>
            {eligible.map((pr) => (
              <option key={pr.id} value={pr.id}>
                {productName(pr.id)}（歩留{pr.yieldPcPerKg}pc/kg・{yen(pr.priceMin)}〜{yen(pr.priceMax)}/pc）
              </option>
            ))}
          </select>
          <input
            type="number"
            min={1}
            max={maxMfgKg}
            value={mfgKg}
            onChange={(e) => setMfgKg(Number(e.target.value))}
          />
          <span className="muted small">kg（上限 {maxMfgKg}）</span>
          <button
            disabled={!canMfg}
            onClick={() => dispatch({ type: "manufacture", playerId: actor.id, productId: prodId, kg: mfgKg })}
          >
            製造する
          </button>
        </div>
      )}

      <h3 style={{ marginTop: 14 }}>販売する（他社も相乗り参加できる）</h3>
      <div className="row">
        <button
          className="primary"
          disabled={salesLeft(actor) <= 0}
          onClick={() => dispatch({ type: "declareSell", playerId: actor.id })}
        >
          販売を宣言する
        </button>
        <span className="muted small">宣言すると全社が同じタイミングで販売に参加できます。</span>
      </div>

      <FreezeThaw actor={actor} dispatch={dispatch} />

      <div className="row spread" style={{ marginTop: 16 }}>
        <button className="ghost" onClick={() => dispatch({ type: "pass", playerId: actor.id })}>
          パス（何もしない）
        </button>
        <span className="muted small">全員が連続でパスするとこの日のアクション終了。</span>
      </div>
    </div>
  );
}

function FreezeThaw({ actor, dispatch }: { actor: Player; dispatch: (c: Command) => void }) {
  const raws = rawList(actor);
  if (raws.length === 0) return null;
  return (
    <div style={{ marginTop: 12 }}>
      <h3 className="small">冷凍（任意・原魚を保存）</h3>
      <div className="row">
        {raws.map((r) => (
          <button key={"f" + r.id} className="ghost small" onClick={() => dispatch({ type: "freeze", playerId: actor.id, speciesId: r.id, kg: r.kg })}>
            {speciesName(r.id)}を冷凍({r.kg}kg)
          </button>
        ))}
        <span className="muted small">※解凍は翌朝の「朝の準備」で行います</span>
      </div>
    </div>
  );
}

// ---- 販売の相乗りパネル（3販路） ----
interface Stock {
  kind: "raw" | "product";
  id: string;
  kg: number;
  label: string;
}

function SalePanel({ state, dispatch, actor }: Props & { actor: Player }) {
  const sale = state.openSale!;
  const initiator = state.players[sale.initiator];
  const myItems = sale.contributions[actor.id] ?? [];
  const committed = myItems.reduce((a, i) => a + i.kg, 0);

  const stocks: Stock[] = [
    ...rawList(actor).map((r) => ({ kind: "raw" as const, id: r.id, kg: r.kg, label: `${speciesName(r.id)}（原魚）在庫${r.kg}kg` })),
    ...productList(actor).map((pr) => ({ kind: "product" as const, id: pr.id, kg: pr.kg, label: `${productName(pr.id)} 在庫${pr.kg}kg` })),
  ];

  const [sel, setSel] = useState(0);
  const [channel, setChannel] = useState<Channel>("super");
  const [kg, setKg] = useState(1);
  const stock = stocks[sel];
  const isProd = stock?.kind === "product";
  const product = isProd ? productById(stock!.id) : undefined;
  const ch: Channel = channel === "ec" && product && !canUseEc(actor) ? "super" : channel;

  // 価格プレビュー
  let priceInfo = "";
  let meter: { cap: number; sold: number; projPc: number; unit: number } | null = null;
  if (stock && !isProd) {
    priceInfo = `中央市場 ${yen(rawMarketPrice(state, stock.id))}/kg（無制限・魚価で変動）`;
  } else if (product) {
    const unit = productUnitPriceNow(state, actor, product, ch);
    const cap = ch === "super" ? superCapEff(state, product) : product.ecCap;
    const sold = (ch === "super" ? state.superSold : state.ecSold)[product.id] ?? 0;
    priceInfo = `${ch === "super" ? "スーパー" : "EC輸出"} 現在 ${yen(unit)}/pc（歩留${product.yieldPcPerKg}pc/kg・枠 ${sold}/${cap}pc）`;
    meter = { cap, sold, projPc: Math.max(0, kg) * product.yieldPcPerKg, unit };
  }

  return (
    <div className="card">
      <h2>販売タイム — {actor.name}</h2>
      <p className="muted small">
        {initiator.name} の販売に相乗りできます。あなたの販売枠 残り {salesLeft(actor) - committed}kg。
      </p>

      {stocks.length === 0 ? (
        <p className="muted">売れる在庫がありません。</p>
      ) : (
        <>
          <div className="row">
            <select value={sel} onChange={(e) => { setSel(Number(e.target.value)); }}>
              {stocks.map((s, i) => (
                <option key={i} value={i}>{s.label}</option>
              ))}
            </select>
            {stock?.kind === "product" && (
              <select value={channel} onChange={(e) => setChannel(e.target.value as Channel)}>
                <option value="super">スーパー</option>
                <option value="ec" disabled={!canUseEc(actor)}>
                  EC輸出{canUseEc(actor) ? "" : "（HACCP必要）"}
                </option>
              </select>
            )}
            <input type="number" min={1} value={kg} onChange={(e) => setKg(Number(e.target.value))} />
            <button
              onClick={() =>
                dispatch({
                  type: "addSaleItem",
                  playerId: actor.id,
                  item: {
                    kind: stock.kind,
                    id: stock.id,
                    kg,
                    channel: stock.kind === "product" ? channel : "market",
                  },
                })
              }
            >
              販売に追加
            </button>
          </div>
          <p className="muted small" style={{ marginTop: 6 }}>{priceInfo}</p>
          {meter && product && (
            <PriceMeter
              cap={meter.cap}
              sold={meter.sold}
              projPc={meter.projPc}
              priceMin={product.priceMin}
              priceMax={product.priceMax}
              unit={meter.unit}
            />
          )}
        </>
      )}

      {myItems.length > 0 && (
        <table style={{ marginTop: 10 }}>
          <tbody>
            {myItems.map((it, i) => (
              <tr key={i}>
                <td>{it.kind === "raw" ? speciesName(it.id) + "（原魚）" : productName(it.id)}</td>
                <td className="muted small">{it.kind === "raw" ? "中央市場" : it.channel === "ec" ? "EC輸出" : "スーパー"}</td>
                <td>{it.kg}kg</td>
                <td>
                  <button className="ghost small" onClick={() => dispatch({ type: "removeSaleItem", playerId: actor.id, index: i })}>取消</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="row" style={{ marginTop: 14 }}>
        <button className="primary" onClick={() => dispatch({ type: "confirmSale", playerId: actor.id })}>
          {myItems.length > 0 ? "この内容で販売を確定" : "販売に参加しない"}
        </button>
      </div>
    </div>
  );
}

/** スーパー/ECの値崩れメーター。充填するほど価格が下限へ。 */
function PriceMeter({
  cap,
  sold,
  projPc,
  priceMin,
  priceMax,
  unit,
}: {
  cap: number;
  sold: number;
  projPc: number;
  priceMin: number;
  priceMax: number;
  unit: number;
}) {
  const soldPct = cap > 0 ? Math.min(100, (sold / cap) * 100) : 100;
  const projPct = cap > 0 ? Math.min(100, ((sold + projPc) / cap) * 100) : 100;
  return (
    <div className="meter">
      <div className="meter-track">
        <div className="meter-fill" style={{ width: `${soldPct}%` }} />
        <div className="meter-proj" style={{ left: `${soldPct}%`, width: `${Math.max(0, projPct - soldPct)}%` }} />
      </div>
      <div className="meter-labels small">
        <span className="muted">空き＝高値 {yen(priceMax)}</span>
        <span className="meter-now">今回 {yen(unit)}/pc</span>
        <span className="muted">満杯＝安値 {yen(priceMin)}</span>
      </div>
    </div>
  );
}

function InventoryView({ actor }: { actor: Player }) {
  const raws = rawList(actor);
  const frozen = frozenList(actor);
  const thawing = thawingList(actor);
  const thawed = thawedList(actor);
  const products = productList(actor);
  return (
    <div className="small muted">
      在庫 {inventoryUsed(actor)}/{actor.inventoryCapacity}kg・販売枠{salesCapacity(actor)}kg／
      原魚(生・本日中):{raws.map((r) => `${speciesName(r.id)}${r.kg}`).join(" ") || "なし"}／ 冷凍:
      {frozen.map((r) => `${speciesName(r.id)}${r.kg}`).join(" ") || "なし"}
      {thawed.length > 0 && (
        <span className="neg">
          {" "}／ 解凍済(本日使用):{thawed.map((r) => `${speciesName(r.id)}${r.kg}`).join(" ")}
        </span>
      )}
      {thawing.length > 0 && (
        <span> ／ 解凍中(明日):{thawing.map((r) => `${speciesName(r.id)}${r.kg}`).join(" ")}</span>
      )}
      ／ 製品:{products.map((r) => `${productName(r.id)}${r.kg}`).join(" ") || "なし"}
    </div>
  );
}
