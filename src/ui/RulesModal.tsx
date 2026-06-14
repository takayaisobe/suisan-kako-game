import { SPECIES, PRODUCTS, SEASON_LABEL, type Season } from "../engine/index.ts";
import { SPECIES_COLOR, FishIcon } from "./icons.tsx";

const GRADE_MARK: Record<string, string> = { A: "◎", B: "◯", C: "△" };
const SEASON_ORDER: Season[] = ["spring", "summer", "autumn", "winter"];

/** 遊び方ヘルプ。 */
export function RulesModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="row spread">
          <h2>遊び方</h2>
          <button className="ghost" onClick={onClose}>
            閉じる ✕
          </button>
        </div>

        <p className="muted small">
          水産加工会社の経営者となり、<b>仕入れ→加工→販売</b>を繰り返して、全20ターン（4季節×5期）後の
          <b>純資産</b>で勝敗を競います。
        </p>

        <h3>1ターンの流れ</h3>
        <ol className="small">
          <li>
            <b>シケ・市場</b>：季節別の確率でシケ具合（無風/風強め/台風）が決定。漁獲量が変わります。
          </li>
          <li>
            <b>朝のセリ</b>：全社が封印入札。各魚種ロットの最高額入札者が落札します。
          </li>
          <li>
            <b>操業</b>：手番制で「製造（自分だけ）」か「販売（他社も相乗り可）」を宣言。任意で冷凍/解凍。全員が連続パスで終了。
          </li>
          <li>
            <b>決算（5期ごと）</b>：人件費・固定費・利息を精算。内部/外部の環境カードを引きます。
          </li>
          <li>
            <b>投資（5期ごと）</b>：在庫拡張・製造ライン・研修・採用・認証取得・借入。
          </li>
        </ol>

        <h3>販路（売り先）</h3>
        <ul className="small">
          <li>
            <b>中央市場</b>：原魚専用・無制限・固定価格（魚価イベントで変動）。
          </li>
          <li>
            <b>スーパー</b>：加工品。販路キャパ（pc）は全社共有で、<b>出荷するほど価格が下限へ下落</b>します。
          </li>
          <li>
            <b>EC・輸出</b>：加工品。HACCP認証で解禁、EU HACCPで売価+20%。
          </li>
        </ul>

        <h3>魚種と季節（◎=30 / ◯=20 / △=10kg 基準・シケで増減）</h3>
        <table className="small">
          <thead>
            <tr>
              <th>魚種</th>
              {SEASON_ORDER.map((s) => (
                <th key={s}>{SEASON_LABEL[s]}</th>
              ))}
              <th>仕入(円/kg)</th>
              <th>原魚売価</th>
            </tr>
          </thead>
          <tbody>
            {SPECIES.map((sp) => (
              <tr key={sp.id}>
                <td>
                  <span className="chip">
                    <FishIcon color={SPECIES_COLOR[sp.id]} size={16} /> {sp.name}
                  </span>
                </td>
                {SEASON_ORDER.map((s) => (
                  <td key={s} style={{ textAlign: "center" }}>
                    {sp.seasonality[s] ? GRADE_MARK[sp.seasonality[s]!] : "—"}
                  </td>
                ))}
                <td>
                  {sp.buyMin}〜{sp.buyMax}
                </td>
                <td>{sp.rawSellPrice}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h3>製品（加工品・スーパー単価/pc）</h3>
        <table className="small">
          <thead>
            <tr>
              <th>製品</th>
              <th>区分</th>
              <th>歩留(pc/kg)</th>
              <th>単価/pc</th>
            </tr>
          </thead>
          <tbody>
            {PRODUCTS.map((p) => (
              <tr key={p.id}>
                <td>{p.name}</td>
                <td>{p.category === "strong" ? "加工品強" : "加工品弱"}</td>
                <td>{p.yieldPcPerKg}</td>
                <td>
                  {p.priceMin}〜{p.priceMax}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <h3>勝ち筋</h3>
        <p className="small muted">
          <b>高付加価値型</b>＝加工品強＋認証でEC輸出し高単価で売る。
          <b>大量回転型</b>＝安く大量に仕入れ原魚を中央市場で回す。スーパーは値崩れするので相乗り販売の駆け引きが鍵。
        </p>
      </div>
    </div>
  );
}
