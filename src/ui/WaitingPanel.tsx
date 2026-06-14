/** オンライン時、自分の番でないときの待機表示。 */
export function WaitingPanel({ name, note }: { name: string; note?: string }) {
  return (
    <div className="card handoff">
      <h2>⏳ {name} の操作を待っています…</h2>
      <p className="muted">{note ?? "オンライン対戦中。相手の手番です。"}</p>
      <div className="cpu-spinner" />
    </div>
  );
}
