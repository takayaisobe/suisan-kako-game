import {
  canUseEc,
  inventoryUsed,
  mfgDailyKg,
  netWorth,
  productById,
  salesCapacity,
  salesLeft,
  type Player,
} from "../engine/index.ts";
import {
  frozenList,
  productList,
  productName,
  rawList,
  speciesName,
  thawedList,
  yen,
} from "./format.ts";
import {
  CertBadge,
  FactoryIcon,
  FishIcon,
  FreezerIcon,
  PLAYER_COLORS,
  SalesOfficeIcon,
  SPECIES_COLOR,
  StaffPiece,
  WarehouseIcon,
} from "./icons.tsx";

interface Props {
  player: Player;
  active?: boolean;
}

/** 会社盤（プレイヤーマット）。工場・冷凍庫・営業所・在庫を盤面風に表示。 */
export function CompanyBoard({ player, active }: Props) {
  const color = PLAYER_COLORS[player.id % PLAYER_COLORS.length];
  const raws = rawList(player);
  const frozen = frozenList(player);
  const thawed = thawedList(player);
  const products = productList(player);
  const used = inventoryUsed(player);

  const rawKg = raws.reduce((a, r) => a + r.kg, 0);
  const frozenKg = frozen.reduce((a, r) => a + r.kg, 0);
  const productKg = products.reduce((a, r) => a + r.kg, 0);
  const cap = player.inventoryCapacity;

  return (
    <div className={"mat" + (active ? " mat-active" : "")} style={{ borderTopColor: color }}>
      <div className="mat-head">
        <span className="dot" style={{ background: color }} />
        <strong>{player.name}</strong>
        {player.isCpu && <span className="chip cpu-chip">🤖CPU</span>}
        {player.turnDone && <span className="chip done-chip">✓本日行動済</span>}
        {player.skipNextTurn && <span className="chip warn-chip">ストライキ</span>}
        {active && <span className="chip active-chip">手番</span>}
        <span className="mat-cash">{yen(player.cash)}</span>
      </div>
      <div className="mat-sub">
        純資産 <span className={netWorth(player) < 0 ? "neg" : "pos"}>{yen(netWorth(player))}</span>
        {player.loans.length > 0 && (
          <span className="muted"> ・借入{player.loans.reduce((a, l) => a + l.principal, 0)}</span>
        )}
        <span className="certs">
          {player.certifications.map((c) => (
            <CertBadge key={c} cert={c} />
          ))}
        </span>
      </div>

      <div className="zones">
        {/* 工場 */}
        <div className="zone">
          <div className="zone-title">
            <FactoryIcon /> 工場
          </div>
          <div className="pieces">
            {Array.from({ length: player.staff.manufacturing }).map((_, i) => (
              <StaffPiece key={i} kind="mfg" trained={player.staff.manufacturingTrained} />
            ))}
            {player.mfgLines > 0 &&
              Array.from({ length: player.mfgLines }).map((_, i) => (
                <span key={"l" + i} className="line-chip" title="製造ライン">
                  ⚙
                </span>
              ))}
          </div>
          <div className="zone-foot muted">製造枠 {mfgDailyKg(player)}kg/日</div>
        </div>

        {/* 冷凍庫 */}
        <div className="zone">
          <div className="zone-title">
            <FreezerIcon /> 冷凍庫
          </div>
          <div className="chips">
            {frozen.length === 0 ? (
              <span className="muted small">空</span>
            ) : (
              frozen.map((r) => (
                <span className="chip" key={r.id}>
                  <FishIcon color={SPECIES_COLOR[r.id]} size={16} /> {r.kg}
                </span>
              ))
            )}
          </div>
        </div>

        {/* 営業所 */}
        <div className="zone">
          <div className="zone-title">
            <SalesOfficeIcon /> 営業所
          </div>
          <div className="pieces">
            {Array.from({ length: player.staff.sales }).map((_, i) => (
              <StaffPiece key={i} kind="sales" trained={player.staff.salesTrained} />
            ))}
          </div>
          <div className="zone-foot muted">
            販売枠 {salesLeft(player)}/{salesCapacity(player)}kg
          </div>
          <div className="chans">
            <span className="chan">中央市場</span>
            <span className="chan">スーパー</span>
            <span className={"chan" + (canUseEc(player) ? "" : " off")}>EC輸出</span>
          </div>
        </div>
      </div>

      {/* 在庫ゲージ */}
      <div className="warehouse">
        <div className="zone-title small">
          <WarehouseIcon size={16} /> 在庫 {used}/{cap}kg
        </div>
        <div className="gauge">
          <div className="gauge-seg" style={{ width: pct(rawKg, cap), background: "#34d399" }} title={`原魚${rawKg}kg`} />
          <div className="gauge-seg" style={{ width: pct(frozenKg, cap), background: "#38bdf8" }} title={`冷凍${frozenKg}kg`} />
          <div className="gauge-seg" style={{ width: pct(productKg, cap), background: "#f59e0b" }} title={`製品${productKg}kg`} />
        </div>
        <div className="chips">
          {raws.map((r) => (
            <span className="chip" key={"r" + r.id}>
              <FishIcon color={SPECIES_COLOR[r.id]} size={16} /> {speciesName(r.id)} {r.kg}
            </span>
          ))}
          {products.map((p) => (
            <span
              className="chip prod"
              key={"p" + p.id}
              style={{ borderColor: SPECIES_COLOR[productById(p.id).speciesId] }}
            >
              {productName(p.id)} {p.kg}
            </span>
          ))}
          {thawed.map((t) => (
            <span className="chip warn-chip" key={"t" + t.id} title="本日中に加工しないと腐る">
              解凍{speciesName(t.id)} {t.kg}
            </span>
          ))}
          {raws.length === 0 && products.length === 0 && thawed.length === 0 && (
            <span className="muted small">在庫なし</span>
          )}
        </div>
      </div>
    </div>
  );
}

function pct(v: number, cap: number): string {
  return `${cap > 0 ? Math.min(100, (v / cap) * 100) : 0}%`;
}
