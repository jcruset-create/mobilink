import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Clock3,
  Home,
  LogOut,
  MapPin,
  Navigation,
  Phone,
  RefreshCw,
  ShieldCheck,
  Truck,
} from "lucide-react";

import {
  loadRoadsideOperatorAssistances,
  loadRoadsideOperatorTechs,
  loginRoadsideOperator,
  updateRoadsideOperatorAssistanceStatus,
  type RoadsideOperatorSession,
} from "../modules/roadsideOperatorApi";
import type {
  RoadsideAssistance,
  RoadsideAssistanceStatus,
} from "../modules/roadsideAssistanceTypes";
import {
  ROADSIDE_ASSISTANCE_STATUS_LABELS,
} from "../modules/roadsideAssistanceTypes";
import type { Tech } from "../modules/workshopTypes";

const SESSION_KEY = "sea-roadside-operator-session";

const STATUS_BADGES: Record<RoadsideAssistanceStatus, string> = {
  pendiente: "border-amber-200 bg-amber-50 text-amber-800",
  asignada: "border-sky-200 bg-sky-50 text-sky-800",
  en_camino: "border-blue-200 bg-blue-50 text-blue-800",
  en_punto: "border-violet-200 bg-violet-50 text-violet-800",
  finalizada: "border-emerald-200 bg-emerald-50 text-emerald-800",
  llegada_taller: "border-slate-200 bg-slate-100 text-slate-700",
  cancelada: "border-red-200 bg-red-50 text-red-800",
};

function loadStoredSession(): RoadsideOperatorSession | null {
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (!parsed?.techName || !parsed?.code) return null;

    return {
      techName: String(parsed.techName),
      code: String(parsed.code),
    };
  } catch {
    return null;
  }
}

function saveStoredSession(session: RoadsideOperatorSession) {
  window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

function clearStoredSession() {
  window.localStorage.removeItem(SESSION_KEY);
}

function formatTime(value?: number | null) {
  if (!value) return "-";

  return new Date(value).toLocaleTimeString("es-ES", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getMapUrl(assistance: RoadsideAssistance) {
  if (assistance.googleMapsUrl) return assistance.googleMapsUrl;

  if (assistance.latitude != null && assistance.longitude != null) {
    return `https://www.google.com/maps/search/?api=1&query=${assistance.latitude},${assistance.longitude}`;
  }

  if (assistance.address) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
      assistance.address
    )}`;
  }

  return "";
}

function getNextOperatorStatus(
  status: RoadsideAssistanceStatus
): RoadsideAssistanceStatus | null {
  if (status === "pendiente" || status === "asignada") return "en_camino";
  if (status === "en_camino") return "en_punto";
  if (status === "en_punto") return "finalizada";
  if (status === "finalizada") return "llegada_taller";
  return null;
}

function getNextOperatorLabel(status: RoadsideAssistanceStatus) {
  if (status === "pendiente" || status === "asignada") return "En camino";
  if (status === "en_camino") return "Llegue al punto";
  if (status === "en_punto") return "Finalizar";
  if (status === "finalizada") return "Llegue al taller";
  return "";
}

function getNextOperatorIcon(status: RoadsideAssistanceStatus) {
  if (status === "pendiente" || status === "asignada") return Navigation;
  if (status === "en_camino") return MapPin;
  if (status === "en_punto") return CheckCircle2;
  return Home;
}

function isClosed(status: RoadsideAssistanceStatus) {
  return status === "llegada_taller" || status === "cancelada";
}

export default function RoadsideOperatorPage() {
  const [session, setSession] = useState<RoadsideOperatorSession | null>(() =>
    loadStoredSession()
  );
  const [techs, setTechs] = useState<Tech[]>([]);
  const [techName, setTechName] = useState("");
  const [code, setCode] = useState("");
  const [assistances, setAssistances] = useState<RoadsideAssistance[]>([]);
  const [loading, setLoading] = useState(false);
  const [loginLoading, setLoginLoading] = useState(false);
  const [changingId, setChangingId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [lastLoadedAt, setLastLoadedAt] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadTechs() {
      try {
        const data = await loadRoadsideOperatorTechs();

        if (!cancelled) {
          setTechs(data);
          setTechName((current) => current || data[0]?.name || "");
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "No se pudieron cargar operarios."
          );
        }
      }
    }

    void loadTechs();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!session) return;

    void reloadAssistances(session);

    const timer = window.setInterval(() => {
      void reloadAssistances(session);
    }, 12000);

    return () => {
      window.clearInterval(timer);
    };
  }, [session]);

  const activeAssistances = useMemo(
    () => assistances.filter((assistance) => !isClosed(assistance.status)),
    [assistances]
  );

  const closedAssistances = useMemo(
    () => assistances.filter((assistance) => isClosed(assistance.status)),
    [assistances]
  );

  async function reloadAssistances(nextSession = session) {
    if (!nextSession) return;

    setLoading(true);
    setError("");

    try {
      const data = await loadRoadsideOperatorAssistances(nextSession, true);
      setAssistances(data);
      setLastLoadedAt(Date.now());
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "No se pudieron cargar asistencias."
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleLogin() {
    setError("");

    if (!techName || !code.trim()) {
      setError("Selecciona operario e introduce el codigo.");
      return;
    }

    setLoginLoading(true);

    try {
      await loginRoadsideOperator(techName, code.trim());
      const nextSession = {
        techName,
        code: code.trim(),
      };

      saveStoredSession(nextSession);
      setSession(nextSession);
      await reloadAssistances(nextSession);
    } catch (loginError) {
      setError(
        loginError instanceof Error
          ? loginError.message
          : "No se pudo iniciar sesion."
      );
    } finally {
      setLoginLoading(false);
    }
  }

  function handleLogout() {
    clearStoredSession();
    setSession(null);
    setAssistances([]);
    setCode("");
  }

  async function changeStatus(
    assistance: RoadsideAssistance,
    status: RoadsideAssistanceStatus
  ) {
    if (!session) return;

    setChangingId(assistance.id);
    setError("");

    try {
      const updated = await updateRoadsideOperatorAssistanceStatus(
        session,
        assistance.id,
        status
      );

      setAssistances((current) =>
        current.map((item) => (item.id === updated.id ? updated : item))
      );
    } catch (changeError) {
      setError(
        changeError instanceof Error
          ? changeError.message
          : "No se pudo cambiar el estado."
      );
    } finally {
      setChangingId(null);
    }
  }

  if (!session) {
    return (
      <div className="min-h-screen bg-slate-950 px-4 py-6 text-white">
        <main className="mx-auto flex min-h-[calc(100vh-48px)] max-w-md flex-col justify-center">
          <div className="rounded-xl border border-white/10 bg-white p-5 text-slate-900 shadow-2xl">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-slate-900">
                <ShieldCheck className="h-6 w-6 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-black">Operario asistencia</h1>
                <div className="text-sm font-semibold text-slate-500">
                  Acceso movil
                </div>
              </div>
            </div>

            <div className="mt-5 space-y-3">
              <label className="block">
                <span className="mb-1 block text-xs font-black uppercase text-slate-500">
                  Operario
                </span>
                <select
                  value={techName}
                  onChange={(event) => setTechName(event.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-3 text-sm font-bold outline-none focus:ring-2 focus:ring-slate-300"
                >
                  {techs.map((tech) => (
                    <option key={tech.name} value={tech.name}>
                      {tech.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="mb-1 block text-xs font-black uppercase text-slate-500">
                  Codigo
                </span>
                <input
                  value={code}
                  type="password"
                  onChange={(event) => setCode(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      void handleLogin();
                    }
                  }}
                  className="w-full rounded-lg border border-slate-200 px-3 py-3 text-sm font-bold outline-none focus:ring-2 focus:ring-slate-300"
                />
              </label>

              {error && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-bold text-red-700">
                  {error}
                </div>
              )}

              <button
                type="button"
                onClick={handleLogin}
                disabled={loginLoading}
                className="w-full rounded-lg bg-slate-900 px-4 py-3 text-sm font-black text-white hover:bg-slate-800 disabled:opacity-60"
              >
                {loginLoading ? "Entrando..." : "Entrar"}
              </button>
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white px-4 py-3 shadow-sm">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-lg font-black">
              {session.techName}
            </h1>
            <div className="text-xs font-bold text-slate-500">
              {activeAssistances.length} activas
              {lastLoadedAt ? ` · ${formatTime(lastLoadedAt)}` : ""}
            </div>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => reloadAssistances()}
              disabled={loading}
              className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              <RefreshCw className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={handleLogout}
              className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
            >
              <LogOut className="h-5 w-5" />
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-2xl space-y-3 px-3 py-4">
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-bold text-red-700">
            {error}
          </div>
        )}

        {loading && assistances.length === 0 && (
          <div className="flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-8 text-sm font-black text-slate-500">
            <Clock3 className="h-5 w-5" />
            Cargando asistencias
          </div>
        )}

        {activeAssistances.length === 0 && !loading && (
          <div className="rounded-lg border border-slate-200 bg-white px-4 py-8 text-center shadow-sm">
            <Truck className="mx-auto h-9 w-9 text-slate-300" />
            <div className="mt-3 text-sm font-black text-slate-500">
              No tienes asistencias activas.
            </div>
          </div>
        )}

        {activeAssistances.map((assistance) => {
          const mapUrl = getMapUrl(assistance);
          const nextStatus = getNextOperatorStatus(assistance.status);
          const nextLabel = getNextOperatorLabel(assistance.status);
          const NextIcon = getNextOperatorIcon(assistance.status);

          return (
            <article
              key={assistance.id}
              className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <span
                    className={`inline-flex rounded-full border px-2 py-1 text-[11px] font-black ${STATUS_BADGES[assistance.status]}`}
                  >
                    {ROADSIDE_ASSISTANCE_STATUS_LABELS[assistance.status]}
                  </span>
                  <h2 className="mt-3 truncate text-2xl font-black">
                    {assistance.plate || "Sin matricula"}
                  </h2>
                  <div className="mt-1 truncate text-sm font-bold text-slate-500">
                    {assistance.customerName || "Cliente sin nombre"}
                  </div>
                </div>

                {assistance.priority === "urgente" && (
                  <span className="rounded-full border border-red-200 bg-red-50 px-2 py-1 text-[11px] font-black text-red-700">
                    Urgente
                  </span>
                )}
              </div>

              <div className="mt-4 space-y-2 text-sm font-semibold text-slate-700">
                <div className="rounded-lg bg-slate-50 px-3 py-2">
                  {assistance.address || "Ubicacion recibida por enlace"}
                </div>

                {assistance.notes && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800">
                    {assistance.notes}
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2 text-xs font-bold text-slate-500">
                  <div>Salida: {formatTime(assistance.departedAtMs)}</div>
                  <div>Punto: {formatTime(assistance.arrivedAtPointMs)}</div>
                  <div>Fin: {formatTime(assistance.finishedAtMs)}</div>
                  <div>Taller: {formatTime(assistance.arrivedAtWorkshopMs)}</div>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-2">
                {assistance.customerPhone && (
                  <a
                    href={`tel:${assistance.customerPhone}`}
                    className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-3 text-sm font-black text-slate-800 hover:bg-slate-50"
                  >
                    <Phone className="h-5 w-5" />
                    Llamar
                  </a>
                )}

                {mapUrl && (
                  <a
                    href={mapUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center justify-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-3 text-sm font-black text-blue-800 hover:bg-blue-100"
                  >
                    <Navigation className="h-5 w-5" />
                    Navegar
                  </a>
                )}
              </div>

              {nextStatus && (
                <button
                  type="button"
                  onClick={() => changeStatus(assistance, nextStatus)}
                  disabled={changingId === assistance.id}
                  className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-4 text-base font-black text-white hover:bg-slate-800 disabled:opacity-60"
                >
                  <NextIcon className="h-5 w-5" />
                  {changingId === assistance.id ? "Guardando..." : nextLabel}
                </button>
              )}
            </article>
          );
        })}

        {closedAssistances.length > 0 && (
          <section className="rounded-lg border border-slate-200 bg-white p-3">
            <h2 className="mb-2 text-xs font-black uppercase text-slate-500">
              Ultimas cerradas
            </h2>
            <div className="space-y-2">
              {closedAssistances.slice(0, 5).map((assistance) => (
                <div
                  key={`closed-${assistance.id}`}
                  className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2 text-sm"
                >
                  <span className="truncate font-black">
                    {assistance.plate || assistance.customerName}
                  </span>
                  <span className="shrink-0 text-xs font-bold text-slate-500">
                    {ROADSIDE_ASSISTANCE_STATUS_LABELS[assistance.status]}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
