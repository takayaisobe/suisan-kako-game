import { useEffect, useState } from "react";
import {
  inventoryLeft,
  type Command,
  type GameState,
} from "../engine/index.ts";
import { frozenList, speciesName, yen } from "./format.ts";
import { HandOff } from "./HandOff.tsx";
import { useNet } from "./net-context.ts";

interface Props {
  state: GameState;
  dispatch: (c: Command) => void;
}

/** 朝のセリ（封印入札）。ローカルは順番制、オンラインは各自同時に入札。 */
export function PurchasePhase({ state, dispatch }: Props) {
  const { online, mySeat } = useNet();
  // オンライン：自席が未提出なら自分が入札者。ローカル：未提出の先頭。
  const bidder = online
    ? state.bidsSubmitted.includes(mySeat)
      ? undefined
      : state.players[mySeat]
    : state.players.find((p) => !state.bidsSubmitted.includes(p.id));
  const [revealed, setRevealed] = useState(false);
  const [bids, setBids] = useState<Record<string, { price: number; qty: number }>>({});

  useEffect(() => {
    setRevealed(false);
    setBids({});
  }, [bidder?.id]);

  if (!bidder) {
    if (online) {
      const remain = state.players.length - state.bidsSubmitted.length;
      return (
        <div className="card handoff">
          <h2>⏳ 入札を締め切り中…</h2>
          <p className="muted">あと {remain} 社の入札を待っています。</p>
          <div className="cpu-spinner" />
        </div>
      );
    }
    return null; // 全員入札済み（解決待ち）
  }

  if (!online && !revealed) {
    return (
      <HandOff
        name={bidder.name}
        note="朝のセリです。他社に見えないように入札しましょう。"
        onReveal={() => setRevealed(true)}
      />
    );
  }

  const submit = () => {
    for (const lot of state.market) {
      const b = bids[lot.id] ?? { price: 0, qty: 0 };
      dispatch({ type: "setBid", playerId: bidder.id, lotId: lot.id, pricePerKg: b.price, qtyKg: b.qty });
    }
    dispatch({ type: "submitBids", playerId: bidder.id });
  };

  const frozen = frozenList(bidder);
  return (
    <div className="card">
      <h2>朝のセリ — {bidder.name}</h2>

      {/* 朝の準備：仕入れ前に配置転換と解凍 */}
      <div className="prep">
        <h3 className="small">朝の準備（仕入れ前）</h3>
        <div className="row">
          <span className="muted small">人員 営業{bidder.staff.sales}／製造{bidder.staff.manufacturing}：</span>
          <button
            className="ghost small"
            disabled={bidder.staff.sales < 1}
            onClick={() => dispatch({ type: "reassign", playerId: bidder.id, dir: "toMfg" })}
          >
            営業→製造
          </button>
          <button
            className="ghost small"
            disabled={bidder.staff.manufacturing < 1}
            onClick={() => dispatch({ type: "reassign", playerId: bidder.id, dir: "toSales" })}
          >
            製造→営業
          </button>
        </div>
        <div className="row" style={{ marginTop: 4 }}>
          <span className="muted small">解凍（冷凍庫）：</span>
          {frozen.length === 0 ? (
            <span className="muted small">冷凍在庫なし</span>
          ) : (
            frozen.map((f) => (
              <button
                key={f.id}
                className="ghost small"
                onClick={() => dispatch({ type: "thaw", playerId: bidder.id, speciesId: f.id, kg: f.kg })}
              >
                {speciesName(f.id)}を解凍({f.kg}kg)
              </button>
            ))
          )}
          <span className="muted small">※解凍した魚は本日中に加工しないと腐ります</span>
        </div>
      </div>

      <p className="muted small">
        各ロットに「単価/kg」と「欲しい数量kg」を入れます。**高い単価から順に数量を割り当て**るので、1つの魚を複数社で分け合えます。在庫の空き：
        {inventoryLeft(bidder)}kg / 現金 {yen(bidder.cash)}
      </p>
      {state.market.length === 0 ? (
        <p className="neg">時化で水揚げがありません。</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>魚種</th>
              <th>水揚げ</th>
              <th>最低/kg</th>
              <th>相場上限/kg</th>
              <th>入札/kg</th>
              <th>欲しいkg</th>
              <th>支払見込</th>
            </tr>
          </thead>
          <tbody>
            {state.market.map((lot) => {
              const bid = bids[lot.id] ?? { price: 0, qty: 0 };
              const set = (patch: Partial<{ price: number; qty: number }>) =>
                setBids({ ...bids, [lot.id]: { ...bid, ...patch } });
              return (
                <tr key={lot.id}>
                  <td>{speciesName(lot.speciesId)}</td>
                  <td>{lot.kg}kg</td>
                  <td>{yen(lot.minPrice)}</td>
                  <td className="muted">{yen(lot.refMaxPrice)}</td>
                  <td>
                    <input
                      type="number"
                      min={0}
                      value={bid.price || ""}
                      placeholder="0"
                      onChange={(e) => set({ price: Number(e.target.value) })}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      min={0}
                      max={lot.kg}
                      value={bid.qty || ""}
                      placeholder="0"
                      onChange={(e) => set({ qty: Math.min(lot.kg, Number(e.target.value)) })}
                    />
                  </td>
                  <td className="muted">{bid.price > 0 && bid.qty > 0 ? yen(bid.price * bid.qty) : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <div className="row" style={{ marginTop: 12 }}>
        <button className="primary" onClick={submit}>
          入札を確定して次へ
        </button>
        <span className="muted small">
          ※ 単価か数量が0なら入札なし。落札しても在庫・資金が足りなければ入る分だけ。
        </span>
      </div>
    </div>
  );
}
