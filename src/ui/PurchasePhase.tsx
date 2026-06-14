import { useEffect, useState } from "react";
import {
  inventoryLeft,
  type Command,
  type GameState,
} from "../engine/index.ts";
import { speciesName, yen } from "./format.ts";
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
  const [bids, setBids] = useState<Record<string, number>>({});

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
      const v = bids[lot.id] ?? 0;
      dispatch({ type: "setBid", playerId: bidder.id, lotId: lot.id, pricePerKg: v });
    }
    dispatch({ type: "submitBids", playerId: bidder.id });
  };

  return (
    <div className="card">
      <h2>朝のセリ — {bidder.name}</h2>
      <p className="muted small">
        各ロットに kgあたりの入札額を入れます（最低価格以上で最高額が落札）。在庫の空き：
        {inventoryLeft(bidder)}kg / 現金 {yen(bidder.cash)}
      </p>
      {state.market.length === 0 ? (
        <p className="neg">時化で水揚げがありません。</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>魚種</th>
              <th>数量</th>
              <th>最低/kg</th>
              <th>相場上限/kg</th>
              <th>入札/kg</th>
              <th>支払見込</th>
            </tr>
          </thead>
          <tbody>
            {state.market.map((lot) => {
              const bid = bids[lot.id] ?? 0;
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
                      value={bid || ""}
                      placeholder="0"
                      onChange={(e) =>
                        setBids({ ...bids, [lot.id]: Number(e.target.value) })
                      }
                    />
                  </td>
                  <td className="muted">{bid > 0 ? yen(bid * lot.kg) : "—"}</td>
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
          ※ 0のままなら入札なし。落札しても在庫が足りなければ入る分だけ。
        </span>
      </div>
    </div>
  );
}
