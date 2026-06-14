import { useEffect, useRef, useState } from "react";
import {
  aiActions,
  applyCommand,
  createGame,
  currentActorId,
  netWorth,
  SEASON_LABEL,
  STORM_LABEL,
  type Command,
  type GameState,
  type Phase,
  type Player,
} from "./engine/index.ts";
import { RulesModal } from "./ui/RulesModal.tsx";
import { PLAYER_COLORS } from "./ui/icons.tsx";
import { isMuted, setMuted, playGavel, playCoin, playSettle, playFanfare } from "./ui/sound.ts";
import { NetContext } from "./ui/net-context.ts";
import { HostController, GuestController } from "./net/controllers.ts";
import { createHostTransport, createGuestTransport } from "./net/peerTransport.ts";
import type { SeatInfo } from "./net/types.ts";

type NetCtrl = HostController | GuestController;

// ---- セーブ／ロード（localStorage） ----
const SAVE_KEY = "suisan-kako-save";
const SAVE_VERSION = 3; // 鮮度モデル（thawingInventory等）でPlayer形状が変わったため更新

function loadGame(): GameState | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (data?.version !== SAVE_VERSION || !data.state) return null;
    return data.state as GameState;
  } catch {
    return null;
  }
}
function saveGame(state: GameState): void {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({ version: SAVE_VERSION, state }));
  } catch {
    /* ignore */
  }
}
function clearGame(): void {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    /* ignore */
  }
}
import { speciesName, yen } from "./ui/format.ts";
import { Sidebar } from "./ui/Sidebar.tsx";
import { CompanyBoard } from "./ui/CompanyBoard.tsx";
import { PurchasePhase } from "./ui/PurchasePhase.tsx";
import { ActionPhase } from "./ui/ActionPhase.tsx";
import { InvestmentPhase } from "./ui/InvestmentPhase.tsx";

function PlayersRow({ state }: { state: GameState }) {
  const actor = currentActorId(state);
  return (
    <div className="players-row">
      {state.players.map((p) => (
        <CompanyBoard key={p.id} player={p} active={p.id === actor} />
      ))}
    </div>
  );
}

export function App() {
  const [game, setGame] = useState<GameState | null>(() => loadGame());
  const [showRules, setShowRules] = useState(false);
  const [saleToast, setSaleToast] = useState<GameState["lastSaleResult"]>(null);
  const [muted, setMutedState] = useState(isMuted());
  const [screen, setScreen] = useState<"menu" | "offline" | "host" | "guest">("menu");
  const [net, setNet] = useState<NetCtrl | null>(null);
  const [seats, setSeats] = useState<SeatInfo[]>([]);
  const [mySeat, setMySeat] = useState(-1);
  const [roomCode, setRoomCode] = useState("");
  const seenSaleSeq = useRef(game?.lastSaleResult?.seq ?? 0);
  const prevPhase = useRef(game?.phase);

  // オフライン時のみオートセーブ（オンラインはホスト権威stateを採用）
  useEffect(() => {
    if (game && !net) saveGame(game);
  }, [game, net]);

  // 販売成立ポップアップ＋効果音
  useEffect(() => {
    const r = game?.lastSaleResult;
    if (!r || r.seq === seenSaleSeq.current) return;
    seenSaleSeq.current = r.seq;
    setSaleToast(r);
    playCoin();
    const t = setTimeout(() => setSaleToast((cur) => (cur?.seq === r.seq ? null : cur)), 2000);
    return () => clearTimeout(t);
  }, [game?.lastSaleResult?.seq]);

  // フェーズ遷移の効果音
  useEffect(() => {
    if (!game) return;
    if (game.phase !== prevPhase.current) {
      if (game.phase === "auctionResult") playGavel();
      else if (game.phase === "settlement") playSettle();
      else if (game.phase === "gameover") playFanfare();
      prevPhase.current = game.phase;
    }
  }, [game?.phase]);

  const toggleMute = () => {
    const m = !muted;
    setMuted(m);
    setMutedState(m);
  };

  // CPUの自動進行（ホスト権威＝オフライン or ホストのみ実行）
  useEffect(() => {
    if (!game || game.phase === "gameover") return;
    if (net && !net.isHost) return; // ゲストはAI/自動進行を回さない
    const actor = currentActorId(game);
    const cpuActing =
      actor >= 0 &&
      game.players[actor]?.isCpu &&
      (game.phase === "purchase" || game.phase === "action" || game.phase === "investment");
    const allCpu = game.players.every((p) => p.isCpu);
    const autoProceed =
      allCpu &&
      (game.phase === "weather" || game.phase === "settlement" || game.phase === "auctionResult");
    if (!cpuActing && !autoProceed) return;
    const delay = game.phase === "auctionResult" ? 1100 : 650; // 結果発表は少し長めに
    const t = setTimeout(() => {
      const g = game;
      let cmds: Command[];
      if (g.phase === "weather") cmds = [{ type: "proceedToPurchase" }];
      else if (g.phase === "settlement") cmds = [{ type: "proceedToInvestment" }];
      else if (g.phase === "auctionResult") cmds = [{ type: "proceedToAction" }];
      else cmds = aiActions(g);
      if (net) cmds.forEach((c) => (net as HostController).dispatch(c));
      else setGame((s) => (s ? cmds.reduce(applyCommand, s) : s));
    }, delay);
    return () => clearTimeout(t);
  }, [game, net]);

  const dispatch = (c: Command) => {
    if (net) net.dispatch(c);
    else setGame((g) => (g ? applyCommand(g, c) : g));
  };
  const leaveNet = () => {
    net?.close();
    setNet(null);
    setSeats([]);
    setMySeat(-1);
    setRoomCode("");
  };
  const reset = () => {
    leaveNet();
    clearGame();
    setGame(null);
    setScreen("menu");
  };

  // ホスト：部屋を作成（PeerJSで部屋コード発行）
  async function createRoom(cfg: { names: string[]; cpu: boolean[] }): Promise<void> {
    const built: SeatInfo[] = cfg.names.map((n, i) => ({
      index: i,
      name: n,
      kind: i === 0 ? "host" : cfg.cpu[i] ? "cpu" : "open",
      connected: i === 0,
    }));
    const { transport, code } = await createHostTransport();
    const ctrl = new HostController(transport, built);
    ctrl.onChange = (state, sts) => {
      setSeats([...sts]);
      if (state) setGame(state);
    };
    setNet(ctrl);
    setSeats(built);
    setMySeat(0);
    setRoomCode(code);
  }
  function startHosted(seed: number, hostLoan: number): void {
    if (!net || !net.isHost) return;
    const host = net as HostController;
    host.seats = host.seats.map((s) =>
      s.kind === "open" && !s.connected ? { ...s, kind: "cpu", connected: true } : s,
    );
    const names = host.seats.map((s) => s.name);
    const cpu = host.seats.map((s) => s.kind === "cpu");
    const loans = host.seats.map((_, i) => (i === 0 ? hostLoan : 0)); // 開業借入はホスト席のみ
    host.startGame(createGame(names, seed, cpu, loans));
    setSeats([...host.seats]);
  }
  // ゲスト：部屋に参加
  async function joinRoom(name: string, code: string): Promise<void> {
    const transport = await createGuestTransport(code.trim());
    const ctrl = new GuestController(transport, name);
    ctrl.onChange = (state, sts, seat) => {
      setSeats([...sts]);
      setMySeat(seat);
      if (state) setGame(state);
    };
    ctrl.onFull = () => {
      alert("満席で参加できませんでした。");
      leaveNet();
    };
    setNet(ctrl);
  }

  // ===== 描画 =====
  if (game) {
    const online = !!net;
    const effSeat = net ? (net.isHost ? 0 : mySeat) : -1;
    return (
      <NetContext.Provider value={{ online, mySeat: effSeat }}>
        <div className="app" data-season={game.season}>
          <TopBar
            state={game}
            onReset={reset}
            onShowRules={() => setShowRules(true)}
            muted={muted}
            onToggleMute={toggleMute}
            online={online}
          />
          <PhaseStepper phase={game.phase} />
          <PlayersRow state={game} />
          <div className="grid">
            <div>
              <PhaseView state={game} dispatch={dispatch} />
            </div>
            <Sidebar state={game} />
          </div>
          {showRules && <RulesModal onClose={() => setShowRules(false)} />}
          {saleToast && <SaleToast players={game.players} result={saleToast} />}
        </div>
      </NetContext.Provider>
    );
  }

  if (screen === "offline")
    return (
      <Setup
        onStart={(names, seed, cpu, loans) => setGame(createGame(names, seed, cpu, loans))}
        onShowRules={() => setShowRules(true)}
        rulesOpen={showRules}
        onCloseRules={() => setShowRules(false)}
        onBack={() => setScreen("menu")}
      />
    );
  if (screen === "host")
    return (
      <HostLobby
        net={net as HostController | null}
        seats={seats}
        roomCode={roomCode}
        onCreate={createRoom}
        onStart={startHosted}
        onBack={reset}
      />
    );
  if (screen === "guest")
    return (
      <GuestLobby net={net as GuestController | null} seats={seats} mySeat={mySeat} onJoin={joinRoom} onBack={reset} />
    );
  return (
    <MainMenu
      onOffline={() => setScreen("offline")}
      onHost={() => setScreen("host")}
      onGuest={() => setScreen("guest")}
      onShowRules={() => setShowRules(true)}
      rulesOpen={showRules}
      onCloseRules={() => setShowRules(false)}
    />
  );
}

// ---- メインメニュー ----
function MainMenu({
  onOffline,
  onHost,
  onGuest,
  onShowRules,
  rulesOpen,
  onCloseRules,
}: {
  onOffline: () => void;
  onHost: () => void;
  onGuest: () => void;
  onShowRules: () => void;
  rulesOpen: boolean;
  onCloseRules: () => void;
}) {
  return (
    <div className="app">
      <div className="row spread">
        <h1>🐟 水産加工経営ゲーム</h1>
        <button className="ghost" onClick={onShowRules}>
          遊び方
        </button>
      </div>
      <p className="muted">魚を仕入れ、加工し、できるだけ高く売る。戦略MGベースの経営ボードゲーム。</p>
      <div className="card" style={{ maxWidth: 560 }}>
        <h3>遊び方を選ぶ</h3>
        <div className="menu-grid">
          <button className="menu-card" onClick={onOffline}>
            <div className="menu-emoji">🎲</div>
            <b>ローカル対戦</b>
            <span className="muted small">1台を回して2〜6人＋CPU</span>
          </button>
          <button className="menu-card" onClick={onHost}>
            <div className="menu-emoji">🌐</div>
            <b>オンライン部屋を作る</b>
            <span className="muted small">部屋コードを発行して招待</span>
          </button>
          <button className="menu-card" onClick={onGuest}>
            <div className="menu-emoji">🔑</div>
            <b>部屋に参加</b>
            <span className="muted small">コードを入力して参加</span>
          </button>
        </div>
      </div>
      {rulesOpen && <RulesModal onClose={onCloseRules} />}
    </div>
  );
}

function SeatList({ seats, mySeat }: { seats: SeatInfo[]; mySeat?: number }) {
  const label: Record<string, string> = { host: "部屋主", remote: "参加者", cpu: "CPU", open: "空き枠" };
  return (
    <div className="chips" style={{ flexDirection: "column", alignItems: "stretch", gap: 6 }}>
      {seats.map((s) => (
        <div className="chip" key={s.index} style={{ justifyContent: "flex-start" }}>
          <span className="dot" style={{ background: PLAYER_COLORS[s.index % PLAYER_COLORS.length] }} />
          <b>{s.name || `席${s.index + 1}`}</b>
          <span className="muted small" style={{ marginLeft: 6 }}>
            {label[s.kind]}
            {s.kind === "open" && (s.connected ? "（参加済み）" : "（待機中…開始時CPU）")}
            {mySeat === s.index ? "・あなた" : ""}
          </span>
        </div>
      ))}
    </div>
  );
}

// ---- ホスト：部屋ロビー ----
function HostLobby({
  net,
  seats,
  roomCode,
  onCreate,
  onStart,
  onBack,
}: {
  net: HostController | null;
  seats: SeatInfo[];
  roomCode: string;
  onCreate: (cfg: { names: string[]; cpu: boolean[] }) => Promise<void>;
  onStart: (seed: number, hostLoan: number) => void;
  onBack: () => void;
}) {
  const [count, setCount] = useState(2);
  const [names, setNames] = useState<string[]>(["フィッシャー水産", "うみの株式会社", "浜辺フーズ", "大洋商会", "潮田水産", "港工房"]);
  const [cpu, setCpu] = useState<boolean[]>([false, false, false, false, false, false]);
  const [hostLoan, setHostLoan] = useState(0);
  const [seed] = useState(() => Math.floor(Math.random() * 1000000));
  const [status, setStatus] = useState<"idle" | "creating" | "error">("idle");
  const [err, setErr] = useState("");

  async function create() {
    setStatus("creating");
    setErr("");
    try {
      await onCreate({ names: names.slice(0, count), cpu: cpu.slice(0, count) });
      setStatus("idle");
    } catch (e) {
      setStatus("error");
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  if (!net) {
    return (
      <div className="app">
        <div className="row spread">
          <h1>🌐 オンライン部屋を作る</h1>
          <button className="ghost" onClick={onBack}>
            ← 戻る
          </button>
        </div>
        <div className="card" style={{ maxWidth: 520 }}>
          <h3>プレイ人数</h3>
          <div className="row">
            {[2, 3, 4, 5, 6].map((n) => (
              <button key={n} className={count === n ? "primary" : ""} onClick={() => setCount(n)}>
                {n}人
              </button>
            ))}
          </div>
          <h3 style={{ marginTop: 14 }}>座席</h3>
          {Array.from({ length: count }).map((_, i) => (
            <div className="row" key={i} style={{ marginBottom: 6 }}>
              <span className="muted" style={{ width: 50 }}>
                {i + 1}社目
              </span>
              <input
                value={names[i]}
                onChange={(e) => {
                  const nx = [...names];
                  nx[i] = e.target.value;
                  setNames(nx);
                }}
                style={{ width: 190 }}
              />
              {i === 0 ? (
                <span className="pill">あなた（部屋主）</span>
              ) : (
                <button
                  className={cpu[i] ? "" : "primary"}
                  style={{ width: 130 }}
                  onClick={() => {
                    const nx = [...cpu];
                    nx[i] = !nx[i];
                    setCpu(nx);
                  }}
                >
                  {cpu[i] ? "🤖 CPU" : "🌐 オンライン枠"}
                </button>
              )}
            </div>
          ))}
          <p className="muted small">「オンライン枠」は他の人がコードで参加します（開始時に空席ならCPUに）。</p>
          <h3 style={{ marginTop: 14 }}>あなたの開業借入</h3>
          <select value={hostLoan} onChange={(e) => setHostLoan(Number(e.target.value))}>
            <option value={0}>借入なし</option>
            <option value={10000}>+1万（利率3%/期）</option>
            <option value={20000}>+2万（利率3%/期）</option>
          </select>
          <div style={{ marginTop: 14 }}>
            <button className="primary" onClick={create} disabled={status === "creating"}>
              {status === "creating" ? "部屋を作成中…" : "部屋を作る"}
            </button>
          </div>
          {status === "error" && <p className="neg small">作成に失敗：{err}</p>}
        </div>
      </div>
    );
  }

  const openSeats = seats.filter((s) => s.kind === "open");
  const waiting = openSeats.filter((s) => !s.connected).length;
  return (
    <div className="app">
      <div className="row spread">
        <h1>🌐 部屋ができました</h1>
        <button className="ghost" onClick={onBack}>
          退出
        </button>
      </div>
      <div className="card" style={{ maxWidth: 520 }}>
        <h3>部屋コード</h3>
        <div className="row">
          <code className="room-code">{roomCode}</code>
          <button className="ghost small" onClick={() => navigator.clipboard?.writeText(roomCode)}>
            コピー
          </button>
        </div>
        <p className="muted small">このコードを相手に伝えて「部屋に参加」から入ってもらってください。</p>
        <h3 style={{ marginTop: 14 }}>参加状況</h3>
        <SeatList seats={seats} mySeat={0} />
        <div style={{ marginTop: 14 }}>
          <button className="primary" onClick={() => onStart(seed, hostLoan)}>
            ゲーム開始{waiting > 0 ? `（空席${waiting}はCPU）` : ""}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- ゲスト：参加ロビー ----
function GuestLobby({
  net,
  seats,
  mySeat,
  onJoin,
  onBack,
}: {
  net: GuestController | null;
  seats: SeatInfo[];
  mySeat: number;
  onJoin: (name: string, code: string) => Promise<void>;
  onBack: () => void;
}) {
  const [name, setName] = useState("ゲスト");
  const [code, setCode] = useState("");
  const [status, setStatus] = useState<"idle" | "connecting" | "error">("idle");
  const [err, setErr] = useState("");

  async function join() {
    setStatus("connecting");
    setErr("");
    try {
      await onJoin(name, code);
      setStatus("idle");
    } catch (e) {
      setStatus("error");
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  if (!net) {
    return (
      <div className="app">
        <div className="row spread">
          <h1>🔑 部屋に参加</h1>
          <button className="ghost" onClick={onBack}>
            ← 戻る
          </button>
        </div>
        <div className="card" style={{ maxWidth: 460 }}>
          <h3>あなたの会社名</h3>
          <input value={name} onChange={(e) => setName(e.target.value)} style={{ width: 240 }} />
          <h3 style={{ marginTop: 14 }}>部屋コード</h3>
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="ホストから受け取ったコード" style={{ width: 320 }} />
          <div style={{ marginTop: 14 }}>
            <button className="primary" onClick={join} disabled={status === "connecting" || !code.trim()}>
              {status === "connecting" ? "接続中…" : "参加する"}
            </button>
          </div>
          {status === "error" && <p className="neg small">{err}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <div className="row spread">
        <h1>🔑 接続しました</h1>
        <button className="ghost" onClick={onBack}>
          退出
        </button>
      </div>
      <div className="card" style={{ maxWidth: 460 }}>
        <p>
          {mySeat >= 0 ? `あなたは ${mySeat + 1}番席です。` : "座席を確認中…"}ホストの開始を待っています…
        </p>
        <div className="cpu-spinner" />
        <h3 style={{ marginTop: 14 }}>参加状況</h3>
        <SeatList seats={seats} mySeat={mySeat} />
      </div>
    </div>
  );
}

// ---- 販売成立ポップアップ ----
function SaleToast({
  players,
  result,
}: {
  players: Player[];
  result: NonNullable<GameState["lastSaleResult"]>;
}) {
  const total = result.sellers.reduce((a, s) => a + s.amount, 0);
  return (
    <div className="sale-toast" key={result.seq}>
      <div className="sale-toast-head">💰 販売成立！</div>
      {result.sellers.map((s) => (
        <div className="sale-toast-row" key={s.playerId}>
          <span className="dot" style={{ background: PLAYER_COLORS[s.playerId % PLAYER_COLORS.length] }} />
          {players[s.playerId].name}
          <span className="sale-toast-amt">+{yen(s.amount)}</span>
        </div>
      ))}
      {result.sellers.length > 1 && <div className="sale-toast-total">合計 +{yen(total)}</div>}
    </div>
  );
}

// ---- フェーズ進行ステッパー ----
const PHASE_STEPS: { key: Phase; label: string }[] = [
  { key: "weather", label: "シケ・市場" },
  { key: "purchase", label: "朝のセリ" },
  { key: "action", label: "操業" },
  { key: "settlement", label: "決算" },
  { key: "investment", label: "投資" },
];

function PhaseStepper({ phase }: { phase: Phase }) {
  if (phase === "gameover") return null;
  // セリ結果発表は「朝のセリ」ステップの一部として表示
  const effective = phase === "auctionResult" ? "purchase" : phase;
  const activeIdx = PHASE_STEPS.findIndex((s) => s.key === effective);
  return (
    <div className="stepper">
      {PHASE_STEPS.map((s, i) => (
        <div key={s.key} className={"step" + (i === activeIdx ? " on" : i < activeIdx ? " done" : "")}>
          <span className="step-num">{i + 1}</span>
          {s.label}
        </div>
      ))}
    </div>
  );
}

// ---- セットアップ ----
function Setup({
  onStart,
  onShowRules,
  rulesOpen,
  onCloseRules,
  onBack,
}: {
  onStart: (names: string[], seed: number, cpu: boolean[], loans: number[]) => void;
  onShowRules: () => void;
  rulesOpen: boolean;
  onCloseRules: () => void;
  onBack?: () => void;
}) {
  const [count, setCount] = useState(3);
  const [names, setNames] = useState<string[]>(["フィッシャー水産", "うみの株式会社", "浜辺フーズ", "大洋商会", "潮田水産", "港工房"]);
  const [cpu, setCpu] = useState<boolean[]>([false, true, true, true, true, true]);
  const [loans, setLoans] = useState<number[]>([0, 0, 0, 0, 0, 0]);
  // 毎回ちがう展開になるよう、初期シードはランダム（手入力で固定も可）
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 1000000));

  return (
    <div className="app">
      <div className="row spread">
        <h1>🐟 水産加工経営ゲーム（ローカル対戦）</h1>
        <span className="row" style={{ gap: 6 }}>
          {onBack && (
            <button className="ghost" onClick={onBack}>
              ← 戻る
            </button>
          )}
          <button className="ghost" onClick={onShowRules}>
            遊び方
          </button>
        </span>
      </div>
      <p className="muted">
        魚を仕入れ、加工し、できるだけ高く売る。戦略MGベースの経営ボードゲーム（pass-and-play版）。
      </p>
      <div className="card" style={{ maxWidth: 520 }}>
        <h3>プレイ人数</h3>
        <div className="row">
          {[2, 3, 4, 5, 6].map((n) => (
            <button key={n} className={count === n ? "primary" : ""} onClick={() => setCount(n)}>
              {n}人
            </button>
          ))}
        </div>
        <h3 style={{ marginTop: 14 }}>会社名・操作</h3>
        {Array.from({ length: count }).map((_, i) => (
          <div className="row" key={i} style={{ marginBottom: 6 }}>
            <span className="muted" style={{ width: 50 }}>
              {i + 1}社目
            </span>
            <input
              value={names[i]}
              onChange={(e) => {
                const next = [...names];
                next[i] = e.target.value;
                setNames(next);
              }}
              style={{ width: 200 }}
            />
            <button
              className={cpu[i] ? "" : "primary"}
              onClick={() => {
                const next = [...cpu];
                next[i] = !next[i];
                setCpu(next);
              }}
              style={{ width: 96 }}
            >
              {cpu[i] ? "🤖 CPU" : "🙂 人間"}
            </button>
            <select
              value={loans[i]}
              title="開業借入（最大2万・利率3%/期・4決算で返済）"
              onChange={(e) => {
                const next = [...loans];
                next[i] = Number(e.target.value);
                setLoans(next);
              }}
            >
              <option value={0}>借入なし</option>
              <option value={10000}>開業借入 +1万</option>
              <option value={20000}>開業借入 +2万</option>
            </select>
          </div>
        ))}
        <p className="muted small">
          「人間」ボタンでCPU↔人間を切替。開業借入は資本金の最大2倍まで（利率3%/期・4決算で一括返済）。
        </p>
        <h3 style={{ marginTop: 14 }}>シード（天候・市場・カードの乱数）</h3>
        <div className="row">
          <input type="number" value={seed} onChange={(e) => setSeed(Number(e.target.value))} />
          <button className="ghost" onClick={() => setSeed(Math.floor(Math.random() * 1000000))}>
            🎲 ランダム
          </button>
        </div>
        <p className="muted small">
          毎回ランダムに変わります。同じ値を入れれば同じ展開を再現できます（対戦・検証用）。
        </p>
        <div style={{ marginTop: 16 }}>
          <button
            className="primary"
            onClick={() => onStart(names.slice(0, count), seed, cpu.slice(0, count), loans.slice(0, count))}
          >
            ゲーム開始
          </button>
        </div>
      </div>
      {rulesOpen && <RulesModal onClose={onCloseRules} />}
    </div>
  );
}

// ---- トップバー ----
function TopBar({
  state,
  onReset,
  onShowRules,
  muted,
  onToggleMute,
  online,
}: {
  state: GameState;
  onReset: () => void;
  onShowRules: () => void;
  muted: boolean;
  onToggleMute: () => void;
  online?: boolean;
}) {
  const wLabel = STORM_LABEL[state.storm];
  const phaseLabel: Record<string, string> = {
    weather: "シケ・市場",
    purchase: "朝のセリ",
    auctionResult: "セリ結果発表",
    action: "操業（製造・販売）",
    settlement: "決算",
    investment: "投資",
    gameover: "終了",
  };
  return (
    <div className="topbar">
      <strong>🐟 水産加工経営ゲーム</strong>
      <span className="badge">
        {SEASON_LABEL[state.season]}・第{state.period}期
      </span>
      <span className="badge">第{state.turn} / 20 ターン</span>
      <span className="badge weather">シケ:{wLabel}</span>
      <span className="badge">{phaseLabel[state.phase]}</span>
      {online ? (
        <span className="badge" style={{ color: "#a78bfa" }}>🌐 オンライン</span>
      ) : (
        <span className="badge save-badge" title="自動保存されています">💾 自動保存</span>
      )}
      <span style={{ marginLeft: "auto", display: "inline-flex", gap: 6 }}>
        <button className="ghost small" onClick={onToggleMute} title={muted ? "音オン" : "音オフ"}>
          {muted ? "🔇" : "🔊"}
        </button>
        <button className="ghost small" onClick={onShowRules}>
          遊び方
        </button>
        <button className="ghost small" onClick={onReset}>
          {online ? "退出" : "最初から"}
        </button>
      </span>
    </div>
  );
}

function CpuThinking({ player }: { player: Player }) {
  const color = PLAYER_COLORS[player.id % PLAYER_COLORS.length];
  return (
    <div className="card handoff">
      <h2>
        🤖 <span style={{ color }}>{player.name}</span>（CPU）が考えています…
      </h2>
      <p className="muted">自動で進行します。</p>
      <div className="cpu-spinner" />
    </div>
  );
}

// ---- フェーズ振り分け ----
function PhaseView({ state, dispatch }: { state: GameState; dispatch: (c: Command) => void }) {
  const actor = currentActorId(state);
  if (
    actor >= 0 &&
    state.players[actor]?.isCpu &&
    (state.phase === "purchase" || state.phase === "action" || state.phase === "investment")
  ) {
    return <CpuThinking player={state.players[actor]} />;
  }
  switch (state.phase) {
    case "weather":
      return <WeatherView state={state} dispatch={dispatch} />;
    case "purchase":
      return <PurchasePhase state={state} dispatch={dispatch} />;
    case "auctionResult":
      return <AuctionResultView state={state} dispatch={dispatch} />;
    case "action":
      return <ActionPhase state={state} dispatch={dispatch} />;
    case "settlement":
      return <SettlementView state={state} dispatch={dispatch} />;
    case "investment":
      return <InvestmentPhase state={state} dispatch={dispatch} />;
    case "gameover":
      return <GameOver state={state} />;
  }
}

function WeatherView({ state, dispatch }: { state: GameState; dispatch: (c: Command) => void }) {
  const wLabel = STORM_LABEL[state.storm];
  return (
    <div className="card">
      <h2>
        {SEASON_LABEL[state.season]}・第{state.period}期　シケ具合：{wLabel}
      </h2>
      <EventBanner text={state.event} note="今期の外部環境（季節中ずっと有効）" />
      <h3 style={{ marginTop: 10 }}>本日の市場（セリ対象）</h3>
      {state.market.length === 0 ? (
        <p className="neg">シケ・季節要因で水揚げがありません。今日は仕入れできません。</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>魚種</th>
              <th>水揚げ量</th>
              <th>最低価格/kg</th>
              <th>相場上限/kg</th>
            </tr>
          </thead>
          <tbody>
            {state.market.map((lot) => (
              <tr key={lot.id}>
                <td>{speciesName(lot.speciesId)}</td>
                <td>{lot.kg}kg</td>
                <td>{yen(lot.minPrice)}</td>
                <td className="muted">{yen(lot.refMaxPrice)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div style={{ marginTop: 14 }}>
        <button className="primary" onClick={() => dispatch({ type: "proceedToPurchase" })}>
          朝のセリへ進む
        </button>
      </div>
    </div>
  );
}

function AuctionResultView({ state, dispatch }: { state: GameState; dispatch: (c: Command) => void }) {
  const results = state.auctionResults;
  const dealCount = results.reduce((a, r) => a + r.allocations.length, 0);
  return (
    <div className="card auction-reveal">
      <h2>🔨 セリ結果発表</h2>
      <p className="muted small">本日の落札結果です（高単価から数量を割当）。</p>
      {results.length === 0 ? (
        <p className="neg">本日は水揚げがありませんでした。</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>魚種</th>
              <th>水揚げ</th>
              <th>落札内訳（社・数量・単価）</th>
            </tr>
          </thead>
          <tbody>
            {results.map((r, i) => {
              const soldKg = r.allocations.reduce((a, x) => a + x.kg, 0);
              return (
                <tr key={i} className="reveal-row" style={{ animationDelay: `${i * 0.12}s` }}>
                  <td>{speciesName(r.speciesId)}</td>
                  <td>
                    {r.kg}kg
                    {soldKg < r.kg && <span className="muted small">（{r.kg - soldKg}売れ残り）</span>}
                  </td>
                  <td>
                    {r.allocations.length === 0 ? (
                      <span className="muted">不成立（入札なし）</span>
                    ) : (
                      <div className="row" style={{ gap: 10 }}>
                        {r.allocations.map((a, j) => (
                          <span key={j}>
                            <span className="dot" style={{ background: PLAYER_COLORS[a.playerId % PLAYER_COLORS.length] }} />
                            {state.players[a.playerId].name} <b>{a.kg}kg</b> @{yen(a.price)}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <div style={{ marginTop: 14 }}>
        <button className="primary" onClick={() => dispatch({ type: "proceedToAction" })}>
          操業へ進む（{dealCount}件 落札）
        </button>
      </div>
    </div>
  );
}

function EventBanner({ text, note }: { text?: string; note?: string }) {
  if (!text) return null;
  return (
    <div className="event-banner">
      <span className="event-icon">📣</span>
      <div>
        <div className="muted small">{note ?? "外部環境カード"}</div>
        <strong>{text}</strong>
      </div>
    </div>
  );
}

function SettlementView({ state, dispatch }: { state: GameState; dispatch: (c: Command) => void }) {
  const h = state.history;
  const cur = h[h.length - 1]?.values;
  const prev = h[h.length - 2]?.values;
  const ranked = state.players
    .map((p) => ({
      p,
      now: cur?.[p.id] ?? netWorth(p),
      delta: (cur?.[p.id] ?? 0) - (prev?.[p.id] ?? 0),
    }))
    .sort((a, b) => b.delta - a.delta);

  return (
    <div className="card">
      <h2>📊 決算発表（{SEASON_LABEL[state.season]}終わり）</h2>
      <p className="muted small">人件費・固定費・利息を精算しました。次の四半期に向けて環境カードを引きます。</p>

      <h3 style={{ marginTop: 8 }}>今季の成績（純資産の増減）</h3>
      <div className="result-list">
        {ranked.map((r, i) => (
          <div className="result-row reveal-row" key={r.p.id} style={{ animationDelay: `${i * 0.15}s` }}>
            <span className="result-rank">{i + 1}</span>
            <span className="dot" style={{ background: PLAYER_COLORS[r.p.id % PLAYER_COLORS.length] }} />
            <span className="result-name">{r.p.name}</span>
            <span className={"result-delta " + (r.delta >= 0 ? "pos" : "neg")}>
              {r.delta >= 0 ? "▲ +" : "▼ "}
              {yen(Math.abs(r.delta))}
            </span>
            <span className="result-now muted">純資産 {yen(r.now)}</span>
          </div>
        ))}
      </div>

      <EventBanner text={state.event} note="外部環境カード（次の季節に有効）" />

      {state.internalEvents && Object.keys(state.internalEvents).length > 0 && (
        <>
          <h3 style={{ marginTop: 12 }}>内部環境カード（各社）</h3>
          <div className="chips">
            {state.players.map((p) => (
              <span className="chip" key={p.id}>
                <span className="dot" style={{ background: PLAYER_COLORS[p.id % PLAYER_COLORS.length] }} />
                {p.name}：<b>{state.internalEvents![p.id] ?? "—"}</b>
              </span>
            ))}
          </div>
        </>
      )}

      <h3 style={{ marginTop: 12 }}>決算結果</h3>
      <table>
        <thead>
          <tr>
            <th>会社</th>
            <th>現金</th>
            <th>純資産</th>
          </tr>
        </thead>
        <tbody>
          {state.players.map((p) => (
            <tr key={p.id}>
              <td>{p.name}</td>
              <td className={p.cash < 0 ? "neg" : ""}>{yen(p.cash)}</td>
              <td className={netWorth(p) < 0 ? "neg" : "pos"}>{yen(netWorth(p))}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ marginTop: 14 }}>
        <button className="primary" onClick={() => dispatch({ type: "proceedToInvestment" })}>
          投資フェーズへ
        </button>
      </div>
    </div>
  );
}

function GameOver({ state }: { state: GameState }) {
  const ranked = [...state.players].sort((a, b) => netWorth(b) - netWorth(a));
  const winner = ranked[0];
  const winColor = PLAYER_COLORS[winner.id % PLAYER_COLORS.length];
  return (
    <div className="card">
      <h2>🏆 ゲーム終了</h2>
      <div className="winner-spotlight" style={{ borderColor: winColor }}>
        <div className="winner-crown">👑</div>
        <div className="winner-label muted">優勝</div>
        <div className="winner-name" style={{ color: winColor }}>
          {winner.name}
        </div>
        <div className="winner-net">純資産 {yen(netWorth(winner))}</div>
        <div className="confetti">
          {Array.from({ length: 14 }).map((_, i) => (
            <span
              key={i}
              style={{
                left: `${(i / 14) * 100}%`,
                background: PLAYER_COLORS[i % PLAYER_COLORS.length],
                animationDelay: `${(i % 7) * 0.18}s`,
              }}
            />
          ))}
        </div>
      </div>
      <table>
        <thead>
          <tr>
            <th>順位</th>
            <th>会社</th>
            <th>純資産</th>
            <th>現金</th>
          </tr>
        </thead>
        <tbody>
          {ranked.map((p, i) => (
            <tr key={p.id}>
              <td>
                {i + 1}位{i === 0 ? " 👑" : ""}
              </td>
              <td>
                <span className="dot" style={{ background: PLAYER_COLORS[p.id % PLAYER_COLORS.length] }} /> {p.name}
              </td>
              <td className={netWorth(p) < 0 ? "neg" : "pos"}>{yen(netWorth(p))}</td>
              <td>{yen(p.cash)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3 style={{ marginTop: 16 }}>純資産の推移</h3>
      <HistoryChart state={state} />
    </div>
  );
}

function HistoryChart({ state }: { state: GameState }) {
  const snaps = state.history;
  if (snaps.length < 2) return null;
  const W = 320;
  const H = 150;
  const pad = 8;
  const all = snaps.flatMap((s) => s.values);
  const max = Math.max(...all, 1);
  const min = Math.min(...all, 0);
  const span = max - min || 1;
  const x = (i: number) => pad + (i / (snaps.length - 1)) * (W - pad * 2);
  const y = (v: number) => H - pad - ((v - min) / span) * (H - pad * 2);
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="history-chart" preserveAspectRatio="none">
        {/* ゼロライン */}
        {min < 0 && max > 0 && (
          <line x1={pad} x2={W - pad} y1={y(0)} y2={y(0)} stroke="#3a4a5c" strokeDasharray="3 3" />
        )}
        {state.players.map((p) => {
          const color = PLAYER_COLORS[p.id % PLAYER_COLORS.length];
          const pts = snaps.map((s, i) => `${x(i)},${y(s.values[p.id])}`).join(" ");
          return (
            <g key={p.id}>
              <polyline points={pts} fill="none" stroke={color} strokeWidth={2} />
              {snaps.map((s, i) => (
                <circle key={i} cx={x(i)} cy={y(s.values[p.id])} r={2.5} fill={color} />
              ))}
            </g>
          );
        })}
      </svg>
      <div className="chart-x small muted">
        {snaps.map((s, i) => (
          <span key={i}>{s.label}</span>
        ))}
      </div>
    </div>
  );
}
