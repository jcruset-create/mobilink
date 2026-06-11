import { useEffect, useRef, useState } from "react";
import { Briefcase, Coffee, LogOut } from "lucide-react";
import { API_BASE } from "../modules/workshopApi";

const SESSION_KEY = "workshop_operator_session";

type Session = { techName: string; pin: string };
type Tab = "trabajo" | "pausa";

type JobData = {
  id: number;
  plate: string;
  area: string;
  reason: string | null;
  status: string;
  workedAccumulatedMinutes: number | null;
  startedAtMs: number | null;
  quickEntryLabel: string | null;
};

type BreakRow = {
  id: number;
  breakType: string;
  startedAtMs: number;
  endedAtMs: number | null;
  jobId: number | null;
};

const AREA_BADGE: Record<string, string> = {
  camion: "bg-red-600 text-white",
  movil: "bg-amber-500 text-white",
  tacografo: "bg-orange-500 text-white",
  turismo: "bg-sky-500 text-white",
  mecanica: "bg-emerald-600 text-white",
  mantenimiento: "bg-violet-600 text-white",
};

const BREAK_TYPES: { key: string; emoji: string; label: string; cls: string }[] = [
  { key: "cigarro", emoji: "🚬", label: "Cigarro", cls: "bg-slate-700" },
  { key: "cafe", emoji: "☕", label: "Café", cls: "bg-amber-700" },
  { key: "descanso", emoji: "😴", label: "Descanso", cls: "bg-blue-700" },
  { key: "otro", emoji: "🕐", label: "Otro", cls: "bg-slate-600" },
];

function loadStoredSession(): Session | null {
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.techName || !parsed?.pin) return null;
    return { techName: String(parsed.techName), pin: String(parsed.pin) };
  } catch {
    return null;
  }
}

function saveStoredSession(s: Session) {
  window.localStorage.setItem(SESSION_KEY, JSON.stringify(s));
}

function clearStoredSession() {
  window.localStorage.removeItem(SESSION_KEY);
}

function workshopHeaders(session: Session) {
  return {
    "Content-Type": "application/json",
    "x-operator-name": session.techName,
    "x-operator-pin": session.pin,
  };
}

function formatWorkedTime(minutes: number | null): string {
  if (!minutes) return "0:00";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}:${String(m).padStart(2, "0")}`;
}

function formatElapsed(startedAtMs: number): string {
  const elapsed = Math.floor((Date.now() - startedAtMs) / 1000);
  const m = Math.floor(elapsed / 60);
  const s = elapsed % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatBreakDuration(b: BreakRow): string {
  if (b.endedAtMs == null) return "En curso";
  const min = Math.round((b.endedAtMs - b.startedAtMs) / 60000);
  return `${min} min`;
}

function getBreakInfo(key: string) {
  return BREAK_TYPES.find((t) => t.key === key) ?? { emoji: "⏸", label: key, cls: "bg-slate-700" };
}

// ── Login ────────────────────────────────────────────────────────────────────

function LoginScreen({ onLogin }: { onLogin: (s: Session) => void }) {
  const [techs, setTechs] = useState<string[]>([]);
  const [techName, setTechName] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [shake, setShake] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch(`${API_BASE}/api/workshop-operator/techs-list`)
      .then((r) => r.json())
      .then((data: { name: string }[]) => {
        const names = data.map((d) => d.name);
        setTechs(names);
        if (names.length > 0) setTechName(names[0]);
      })
      .catch(() => setError("No se pudo cargar la lista de operarios"));
  }, []);

  async function tryLogin(p: string) {
    if (loading) return;
    setLoading(true);
    setError("");
    try {
      const resp = await fetch(`${API_BASE}/api/workshop-operator/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: techName, pin: p }),
      });
      const data = await resp.json();
      if (!resp.ok || !data.ok) {
        setError(data.error ?? "PIN incorrecto");
        setPin("");
        setShake(true);
        setTimeout(() => setShake(false), 600);
      } else {
        const session: Session = { techName, pin: p };
        saveStoredSession(session);
        onLogin(session);
      }
    } catch {
      setError("Error de conexión");
      setPin("");
    } finally {
      setLoading(false);
    }
  }

  function handleKey(k: string) {
    if (k === "backspace") {
      setPin((prev) => prev.slice(0, -1));
      setError("");
      return;
    }
    if (k === "*") return;
    const next = pin + k;
    if (next.length <= 4) {
      setPin(next);
      if (next.length === 4) {
        void tryLogin(next);
      }
    }
  }

  const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "backspace"];

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center px-6 text-white">
      <div className="w-full max-w-sm">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-white/10 mb-3">
            <span className="text-3xl">🔧</span>
          </div>
          <h1 className="text-2xl font-black">SEA Tarragona</h1>
          <p className="text-slate-400 text-sm mt-1">Portal operarios taller</p>
        </div>

        {/* Tech selector */}
        <div className="mb-6">
          <label className="block text-xs font-black uppercase text-slate-400 mb-1">
            Operario
          </label>
          <select
            value={techName}
            onChange={(e) => { setTechName(e.target.value); setPin(""); setError(""); }}
            className="w-full rounded-xl bg-slate-800 border border-slate-700 px-4 py-3 text-white text-sm font-bold outline-none focus:ring-2 focus:ring-slate-500"
          >
            {techs.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>

        {/* PIN dots */}
        <div className="flex justify-center gap-4 mb-4">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className={`h-4 w-4 rounded-full border-2 transition-all ${
                i < pin.length
                  ? "bg-white border-white"
                  : "bg-transparent border-slate-500"
              }`}
            />
          ))}
        </div>

        {/* Error */}
        {error && (
          <div
            className={`text-center text-sm font-bold text-red-400 mb-3 ${shake ? "animate-[shake_0.5s_ease-in-out]" : ""}`}
            style={
              shake
                ? {
                    animation: "shake 0.5s ease-in-out",
                  }
                : {}
            }
          >
            {error}
          </div>
        )}

        {/* Keypad */}
        <div className="grid grid-cols-3 gap-3 mt-2">
          {KEYS.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => handleKey(k)}
              disabled={loading}
              className={`h-16 rounded-2xl text-xl font-black transition active:scale-95 disabled:opacity-40 ${
                k === "*"
                  ? "bg-transparent text-transparent cursor-default"
                  : k === "backspace"
                  ? "bg-slate-700 hover:bg-slate-600 text-white text-base"
                  : "bg-slate-700 hover:bg-slate-600 text-white"
              }`}
            >
              {k === "backspace" ? "⌫" : k === "*" ? "" : k}
            </button>
          ))}
        </div>
      </div>

      <style>{`
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          20% { transform: translateX(-8px); }
          40% { transform: translateX(8px); }
          60% { transform: translateX(-6px); }
          80% { transform: translateX(6px); }
        }
      `}</style>
    </div>
  );
}

// ── Tab Trabajo ─────────────────────────────────────────────────────────────

function TrabajoTab({ session }: { session: Session }) {
  const [job, setJob] = useState<JobData | null>(null);
  const [loading, setLoading] = useState(true);

  async function loadStatus() {
    try {
      const resp = await fetch(`${API_BASE}/api/workshop-operator/status`, {
        headers: workshopHeaders(session),
      });
      if (resp.ok) {
        const data = await resp.json();
        setJob(data.job ?? null);
      }
    } catch {
      // silencioso
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadStatus();
    const t = window.setInterval(() => void loadStatus(), 10000);
    return () => window.clearInterval(t);
  }, [session]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48 text-slate-400 text-sm font-bold">
        Cargando...
      </div>
    );
  }

  if (!job) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-center px-4">
        <span className="text-5xl mb-4">🔧</span>
        <div className="text-lg font-black text-white mb-2">Sin trabajo asignado</div>
        <div className="text-sm text-slate-400">Espera a que el supervisor te asigne un trabajo</div>
      </div>
    );
  }

  const areaCls = AREA_BADGE[job.area] ?? "bg-slate-600 text-white";
  const isActive = job.status === "activo";

  return (
    <div className="p-4">
      <div className="rounded-2xl bg-slate-800 border border-slate-700 p-5 space-y-4">
        <div className="flex items-center gap-2">
          <span className={`rounded-full px-3 py-1 text-xs font-black uppercase ${areaCls}`}>
            {job.area}
          </span>
          <span className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-black ${isActive ? "bg-emerald-900 text-emerald-300" : "bg-amber-900 text-amber-300"}`}>
            {isActive && (
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse inline-block" />
            )}
            {isActive ? "Activo" : "Parado"}
          </span>
        </div>

        <div>
          <div className="text-3xl font-black text-white tracking-widest">{job.plate}</div>
          <div className="text-slate-300 text-sm mt-1">{job.quickEntryLabel ?? job.reason ?? "-"}</div>
        </div>

        <div className="flex items-center gap-2 text-slate-400 text-sm">
          <span>⏱</span>
          <span className="font-bold">{formatWorkedTime(job.workedAccumulatedMinutes)}</span>
          <span>trabajado</span>
        </div>
      </div>
    </div>
  );
}

// ── Tab Pausa ───────────────────────────────────────────────────────────────

function PausaTab({ session }: { session: Session }) {
  const [breaks, setBreaks] = useState<BreakRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [, setTick] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const activeBreak = breaks.find((b) => b.endedAtMs == null) ?? null;

  useEffect(() => {
    void loadBreaks();
  }, []);

  useEffect(() => {
    if (activeBreak) {
      timerRef.current = setInterval(() => setTick((t) => t + 1), 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [activeBreak?.id]);

  async function loadBreaks() {
    try {
      const resp = await fetch(`${API_BASE}/api/workshop-operator/breaks/today`, {
        headers: workshopHeaders(session),
      });
      if (resp.ok) {
        const data: BreakRow[] = await resp.json();
        setBreaks(data);
      }
    } catch {
      // silencioso
    } finally {
      setLoading(false);
    }
  }

  async function startBreak(breakType: string) {
    setActing(true);
    try {
      await fetch(`${API_BASE}/api/workshop-operator/break/start`, {
        method: "POST",
        headers: workshopHeaders(session),
        body: JSON.stringify({ breakType }),
      });
      await loadBreaks();
    } catch {
      // silencioso
    } finally {
      setActing(false);
    }
  }

  async function endBreak() {
    setActing(true);
    try {
      await fetch(`${API_BASE}/api/workshop-operator/break/end`, {
        method: "POST",
        headers: workshopHeaders(session),
      });
      await loadBreaks();
    } catch {
      // silencioso
    } finally {
      setActing(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48 text-slate-400 text-sm font-bold">
        Cargando...
      </div>
    );
  }

  return (
    <div className="p-4 space-y-5">
      {/* Active break */}
      {activeBreak ? (
        <div className="rounded-2xl bg-slate-800 border border-slate-700 p-6 flex flex-col items-center text-center gap-4">
          <div className="text-5xl">{getBreakInfo(activeBreak.breakType).emoji}</div>
          <div className="text-xl font-black text-white">{getBreakInfo(activeBreak.breakType).label}</div>
          <div className="font-mono text-3xl font-black text-emerald-400">
            {formatElapsed(activeBreak.startedAtMs)}
          </div>
          <button
            type="button"
            onClick={endBreak}
            disabled={acting}
            className="w-full rounded-2xl bg-red-600 hover:bg-red-700 py-4 text-lg font-black text-white disabled:opacity-60 transition"
          >
            {acting ? "Guardando..." : "Finalizar pausa"}
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="text-sm font-black uppercase text-slate-400">¿Qué tipo de pausa?</div>
          <div className="grid grid-cols-2 gap-3">
            {BREAK_TYPES.map((bt) => (
              <button
                key={bt.key}
                type="button"
                onClick={() => startBreak(bt.key)}
                disabled={acting}
                className={`rounded-2xl ${bt.cls} py-6 flex flex-col items-center gap-2 text-white font-black text-base transition active:scale-95 disabled:opacity-60`}
              >
                <span className="text-3xl">{bt.emoji}</span>
                {bt.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Today's breaks */}
      {breaks.length > 0 && (
        <div>
          <div className="text-sm font-black uppercase text-slate-400 mb-2">Hoy</div>
          <div className="space-y-2">
            {breaks.map((b) => {
              const info = getBreakInfo(b.breakType);
              return (
                <div
                  key={b.id}
                  className="flex items-center justify-between rounded-xl bg-slate-800 border border-slate-700 px-4 py-3"
                >
                  <div className="flex items-center gap-2 text-sm font-bold text-white">
                    <span>{info.emoji}</span>
                    <span>{info.label}</span>
                  </div>
                  <span className={`text-xs font-bold ${b.endedAtMs == null ? "text-emerald-400" : "text-slate-400"}`}>
                    {formatBreakDuration(b)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main ─────────────────────────────────────────────────────────────────────

export default function WorkshopOperatorPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [tab, setTab] = useState<Tab>("trabajo");
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const stored = loadStoredSession();
    if (!stored) {
      setChecking(false);
      return;
    }
    // Validate session
    fetch(`${API_BASE}/api/workshop-operator/status`, {
      headers: workshopHeaders(stored),
    })
      .then((r) => {
        if (r.ok) {
          setSession(stored);
        }
      })
      .catch(() => {})
      .finally(() => setChecking(false));
  }, []);

  function handleLogin(s: Session) {
    setSession(s);
  }

  function handleLogout() {
    clearStoredSession();
    setSession(null);
  }

  if (checking) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center text-slate-400 text-sm font-bold">
        Cargando...
      </div>
    );
  }

  if (!session) {
    return <LoginScreen onLogin={handleLogin} />;
  }

  return (
    <div className="min-h-screen bg-slate-900 text-white flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-30 bg-slate-900 border-b border-slate-700 px-4 py-3 flex items-center justify-between">
        <div>
          <div className="text-base font-black">{session.techName}</div>
          <div className="text-xs text-slate-400">Operario taller</div>
        </div>
        <button
          type="button"
          onClick={handleLogout}
          className="h-10 w-10 flex items-center justify-center rounded-xl bg-slate-800 border border-slate-700 text-slate-300 hover:bg-slate-700"
        >
          <LogOut className="h-5 w-5" />
        </button>
      </header>

      {/* Content */}
      <main className="flex-1 overflow-y-auto">
        {tab === "trabajo" ? (
          <TrabajoTab session={session} />
        ) : (
          <PausaTab session={session} />
        )}
      </main>

      {/* Bottom Tab Bar */}
      <nav className="sticky bottom-0 z-30 bg-slate-900 border-t border-slate-700 grid grid-cols-2">
        <button
          type="button"
          onClick={() => setTab("trabajo")}
          className={`flex flex-col items-center py-3 gap-1 text-xs font-black transition ${
            tab === "trabajo" ? "text-white" : "text-slate-500"
          }`}
        >
          <Briefcase className="h-6 w-6" />
          Trabajo
        </button>
        <button
          type="button"
          onClick={() => setTab("pausa")}
          className={`flex flex-col items-center py-3 gap-1 text-xs font-black transition ${
            tab === "pausa" ? "text-white" : "text-slate-500"
          }`}
        >
          <Coffee className="h-6 w-6" />
          Pausa
        </button>
      </nav>
    </div>
  );
}
