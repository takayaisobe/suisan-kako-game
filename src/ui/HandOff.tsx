interface Props {
  name: string;
  note?: string;
  onReveal: () => void;
}

/** pass-and-play 用の目隠し画面。次のプレイヤーに端末を渡すために挟む。 */
export function HandOff({ name, note, onReveal }: Props) {
  return (
    <div className="card handoff">
      <h2>{name} さんの番です</h2>
      <p className="muted">{note ?? "他の人に画面が見えないようにして、準備ができたら開きましょう。"}</p>
      <button className="primary" onClick={onReveal}>
        画面を開く
      </button>
    </div>
  );
}
