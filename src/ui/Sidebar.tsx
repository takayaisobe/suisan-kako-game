import type { GameState } from "../engine/index.ts";

interface Props {
  state: GameState;
}

/** 右サイド：ログ。各社の状況は上部の会社盤で表示。 */
export function Sidebar({ state }: Props) {
  return (
    <div className="card">
      <h3>ログ</h3>
      <div className="log">
        {state.log.map((l, i) => (
          <div key={i}>{l}</div>
        ))}
      </div>
    </div>
  );
}
