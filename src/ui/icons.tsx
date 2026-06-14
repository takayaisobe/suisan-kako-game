// ボードゲーム風のSVGアイコン群（魚・人の駒・ゾーン）。

export const PLAYER_COLORS = [
  "#38bdf8",
  "#f59e0b",
  "#34d399",
  "#f472b6",
  "#a78bfa",
  "#fb7185",
];

export const SPECIES_COLOR: Record<string, string> = {
  madai: "#ef6f8e", // マダイ（赤）
  katsuo: "#3a78ad", // カツオ（青）
  saba: "#6fae9b", // サバ（青緑）
  tara: "#cbd5e1", // タラ（白）
};

/** 魚の駒（左向き）。 */
export function FishIcon({ color, size = 22 }: { color: string; size?: number }) {
  return (
    <svg width={size} height={(size * 20) / 32} viewBox="0 0 32 20" aria-hidden="true">
      <ellipse cx="13" cy="10" rx="11" ry="7" fill={color} />
      <polygon points="21,10 31,3 31,17" fill={color} />
      <circle cx="7" cy="8" r="1.4" fill="#0b1117" />
    </svg>
  );
}

/** 人の駒（meeple風）。kind=sales/mfg で色分け、trainedで★。 */
export function StaffPiece({
  kind,
  trained,
  size = 24,
}: {
  kind: "sales" | "mfg";
  trained?: boolean;
  size?: number;
}) {
  const color = kind === "sales" ? "#38bdf8" : "#f59e0b";
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="6.5" r="3.6" fill={color} />
      <path d="M4.5 22c0-4.7 3.4-8.5 7.5-8.5s7.5 3.8 7.5 8.5z" fill={color} />
      {trained && (
        <g transform="translate(16 2)">
          <circle cx="3" cy="3" r="4" fill="#fbbf24" />
          <text x="3" y="5.6" fontSize="6" textAnchor="middle" fill="#3a2a00" fontWeight="700">
            ★
          </text>
        </g>
      )}
    </svg>
  );
}

const zoneProps = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export function FactoryIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...zoneProps}>
      <path d="M2 21h20" />
      <path d="M3 21V12l5 3v-3l5 3V8l6 3v10" />
      <path d="M17 8V4h2v4" />
    </svg>
  );
}

export function FreezerIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...zoneProps}>
      <path d="M12 2v20M2 12h20M5 5l14 14M19 5L5 19" />
    </svg>
  );
}

export function SalesOfficeIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...zoneProps}>
      <path d="M3 9l1.6-4h14.8L21 9" />
      <path d="M4.5 9v11h15V9" />
      <path d="M10 20v-6h4v6" />
    </svg>
  );
}

export function WarehouseIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...zoneProps}>
      <path d="M3 21V8l9-5 9 5v13" />
      <path d="M3 21h18M7 21v-7h10v7" />
    </svg>
  );
}

/** 認証バッジ。 */
export function CertBadge({ cert }: { cert: string }) {
  const label = cert === "eu_haccp" ? "EU" : "HACCP";
  const bg = cert === "eu_haccp" ? "#a78bfa" : "#34d399";
  return (
    <span className="cert-badge" style={{ background: bg }} title={label}>
      {label}
    </span>
  );
}
