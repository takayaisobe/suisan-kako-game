import { useEffect, useState } from "react";
import {
  INVESTMENT_OPTIONS,
  LOAN_OPTIONS,
  PRODUCT_DEV_COST,
  PRODUCTS,
  type Command,
  type GameState,
} from "../engine/index.ts";
import { productName, yen } from "./format.ts";
import { HandOff } from "./HandOff.tsx";
import { useNet } from "./net-context.ts";
import { WaitingPanel } from "./WaitingPanel.tsx";

const STRONG_PRODUCTS = PRODUCTS.filter((p) => p.category === "strong");

interface Props {
  state: GameState;
  dispatch: (c: Command) => void;
}

/** 決算後の投資フェーズ。各社が順番に投資・借入を行う。 */
export function InvestmentPhase({ state, dispatch }: Props) {
  const { online, mySeat } = useNet();
  const investor = state.players.find((p) => !p.ready);
  const [revealed, setRevealed] = useState(false);
  useEffect(() => setRevealed(false), [investor?.id]);

  if (!investor) return null;
  if (online && investor.id !== mySeat) {
    return <WaitingPanel name={investor.name} note="相手が投資中です。" />;
  }
  if (!online && !revealed) {
    return (
      <HandOff
        name={investor.name}
        note="決算が締まりました。次期に向けて投資・資金調達を行いましょう。"
        onReveal={() => setRevealed(true)}
      />
    );
  }

  const isFinalQuarter = state.season === "winter";

  return (
    <div className="card">
      <h2>投資フェーズ — {investor.name}</h2>
      <p className="muted small">現金 {yen(investor.cash)}。買えるものは何度でも。</p>

      <h3>投資</h3>
      <table>
        <tbody>
          {INVESTMENT_OPTIONS.map((opt) => {
            const owned =
              (opt.kind === "trainSales" && investor.staff.salesTrained) ||
              (opt.kind === "trainMfg" && investor.staff.manufacturingTrained) ||
              (opt.kind === "certHaccp" && investor.certifications.includes("haccp")) ||
              (opt.kind === "certEuHaccp" && investor.certifications.includes("eu_haccp"));
            return (
              <tr key={opt.kind}>
                <td>
                  <strong>{opt.label}</strong>
                  <br />
                  <span className="muted small">{opt.description}</span>
                </td>
                <td>{yen(opt.cost)}</td>
                <td>
                  <button
                    disabled={investor.cash < opt.cost || owned}
                    onClick={() => dispatch({ type: "invest", playerId: investor.id, kind: opt.kind })}
                  >
                    {owned ? "取得済" : "投資"}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <h3 style={{ marginTop: 14 }}>商品開発（加工品強を解禁）</h3>
      <table>
        <tbody>
          {STRONG_PRODUCTS.map((pr) => {
            const done = investor.developedProducts.includes(pr.id);
            return (
              <tr key={pr.id}>
                <td>
                  <strong>{productName(pr.id)}</strong>
                  <br />
                  <span className="muted small">
                    開発すると製造可能（{yen(pr.priceMin)}〜{yen(pr.priceMax)}/pc）
                  </span>
                </td>
                <td>{yen(PRODUCT_DEV_COST)}</td>
                <td>
                  <button
                    disabled={done || investor.cash < PRODUCT_DEV_COST}
                    onClick={() => dispatch({ type: "develop", playerId: investor.id, productId: pr.id })}
                  >
                    {done ? "開発済" : "開発"}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <h3 style={{ marginTop: 14 }}>資金調達（借入）</h3>
      {!isFinalQuarter && (
        <p className="muted small">※ 長期借入は最終クォーター(冬)でのみ実行できます。</p>
      )}
      <div className="row">
        <button onClick={() => dispatch({ type: "takeLoan", playerId: investor.id, kind: "short" })}>
          {LOAN_OPTIONS.short.label}
        </button>
        <button
          disabled={!isFinalQuarter}
          onClick={() => dispatch({ type: "takeLoan", playerId: investor.id, kind: "long" })}
        >
          {LOAN_OPTIONS.long.label}
        </button>
      </div>

      <div className="row" style={{ marginTop: 16 }}>
        <button className="primary" onClick={() => dispatch({ type: "finishInvestment", playerId: investor.id })}>
          投資を終えて次へ
        </button>
      </div>
    </div>
  );
}
