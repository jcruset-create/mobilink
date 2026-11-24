import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, Loader2, MapPin, Palmtree, Save, Timer, Trash2 } from "lucide-react";
import AgendaConfigModal from "../../components/AgendaConfigModal";
import { DEFAULT_AGENDA_CONFIG, type AgendaConfig } from "../agendaConfig";
import { loadAgendaConfig } from "../agendaConfigApi";
import {
  AJUSTES_POR_DEFECTO,
  LIMITES,
  validarAjustes,
  type AjustesWorkplanner,
} from "../ajustesWorkplanner";
import { cargarAjustesWorkplanner, guardarAjustesWorkplanner } from "../ajustesWorkplannerApi";
import { apiFetch } from "../apiFetch";
import { getAdminHeaders } from "../adminHeaders";
import { API_BASE, loadTechsFromBackend } from "../workshopApi";
import { deleteKnownPlace, fetchKnownPlaces } from "../roadsideAssistanceApi";
import type { KnownPlace } from "../roadsideAssistanceTypes";
import { cargarConfigVacaciones, guardarConfigVacaciones } from "../vacacionesConfigApi";
import type { ConfigVacaciones, ModoVacaciones } from "../ausenciasTecnicos";
import { DEFAULT_WORKSHOP_ID, WORKSHOPS, normalizeWorkshopId } from "../workshops";
import type { Tech } from "../workshopTypes";

/**
 * Configuración de WorkPlanner: un sitio para lo que estaba repartido.
 *
 * Pestañas a la izquierda, ajustes a la derecha. Tres pestañas traen lo que
 * ya existía en otras pantallas (el ⚙ de la Agenda, el botón Taller de
 * Salidas y la configuración de Ausencias) sin cambiar cómo funciona; la de
 * Tiempos y radios es nueva (src/modules/ajustesWorkplanner.ts). Solo para
 * administradores: el menú ya no la enseña a nadie más.
 */

type Pestana = "tiempos" | "horario" | "talleres" | "vacaciones";

const PESTANAS: { key: Pestana; label: string; icon: typeof Timer; nueva?: boolean }[] = [
  { key: "tiempos", label: "Tiempos y radios", icon: Timer, nueva: true },
  { key: "horario", label: "Horario y festivos", icon: CalendarDays },
  { key: "talleres", label: "Talleres y lugares", icon: MapPin },
  { key: "vacaciones", label: "Vacaciones", icon: Palmtree },
];

const input =
  "rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:ring-2 focus:ring-sky-500";
const btnPrimario =
  "flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-sm font-bold text-white hover:bg-sky-500 disabled:opacity-50";

export default function ConfiguracionPage() {
  const [pestana, setPestana] = useState<Pestana>("tiempos");

  return (
    <div className="min-h-full bg-slate-900 p-4 text-slate-100">
      <div className="mx-auto max-w-6xl">
        <div className="mb-4">
          <h1 className="text-xl font-bold">Configuración</h1>
          <p className="text-xs text-slate-400">
            Los ajustes del taller en un solo sitio. Lo que cambias aquí vale para todas las pantallas.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-[230px_minmax(0,1fr)]">
          <nav className="rounded-2xl border border-slate-700 bg-slate-800 p-2">
            {PESTANAS.map((p) => {
              const Icono = p.icon;
              const activa = p.key === pestana;
              return (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => setPestana(p.key)}
                  className={`flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-semibold ${
                    activa ? "bg-sky-600 text-white" : "text-slate-200 hover:bg-slate-700"
                  }`}
                >
                  <Icono className="h-4 w-4" />
                  <span className="flex-1">{p.label}</span>
                  {p.nueva && (
                    <span className={`text-[10px] font-bold ${activa ? "text-sky-100" : "text-amber-400"}`}>nuevo</span>
                  )}
                </button>
              );
            })}
          </nav>

          <div className="min-w-0">
            {pestana === "tiempos" && <TiemposYRadios />}
            {pestana === "horario" && <HorarioYFestivos />}
            {pestana === "talleres" && <TalleresYLugares />}
            {pestana === "vacaciones" && <Vacaciones />}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Tiempos y radios ─────────────────────────────────────────────────── */

type Tecleado = Record<keyof AjustesWorkplanner, string>;

function aTecleado(a: AjustesWorkplanner): Tecleado {
  return {
    duracionCitaMin: String(a.duracionCitaMin),
    bloqueoTabletMin: String(a.bloqueoTabletMin),
    radioLlegadaM: String(a.radioLlegadaM),
    radioSalidaTallerM: String(a.radioSalidaTallerM),
  };
}

function TiemposYRadios() {
  const [guardado, setGuardado] = useState<AjustesWorkplanner>(AJUSTES_POR_DEFECTO);
  const [form, setForm] = useState<Tecleado>(aTecleado(AJUSTES_POR_DEFECTO));
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");

  useEffect(() => {
    let vivo = true;
    void cargarAjustesWorkplanner().then((a) => {
      if (!vivo) return;
      setGuardado(a);
      setForm(aTecleado(a));
      setCargando(false);
    });
    return () => {
      vivo = false;
    };
  }, []);

  const errores = useMemo(() => validarAjustes(form), [form]);
  const cambiado = useMemo(() => JSON.stringify(form) !== JSON.stringify(aTecleado(guardado)), [form, guardado]);

  async function guardar() {
    setError("");
    setAviso("");
    if (errores.length) {
      setError(errores.join(" "));
      return;
    }
    setGuardando(true);
    try {
      const a = await guardarAjustesWorkplanner({
        duracionCitaMin: Number(form.duracionCitaMin),
        bloqueoTabletMin: Number(form.bloqueoTabletMin),
        radioLlegadaM: Number(form.radioLlegadaM),
        radioSalidaTallerM: Number(form.radioSalidaTallerM),
      });
      setGuardado(a);
      setForm(aTecleado(a));
      setAviso("Guardado. La agenda y el servidor ya usan estos valores; la tablet los coge al volver a entrar.");
    } catch (e: any) {
      setError(e?.message || "No se pudieron guardar los ajustes.");
    } finally {
      setGuardando(false);
    }
  }

  const campo = (k: keyof AjustesWorkplanner, unidad: string) => (
    <div className="flex items-center justify-end gap-2">
      <input
        id={`ajuste-${k}`}
        type="number"
        min={LIMITES[k][0]}
        max={LIMITES[k][1]}
        value={form[k]}
        onChange={(e) => setForm((prev) => ({ ...prev, [k]: e.target.value }))}
        className={`w-24 text-right tabular-nums ${input}`}
      />
      <span className="w-8 text-sm text-slate-400">{unidad}</span>
    </div>
  );

  return (
    <div className="space-y-3">
      <Cabecera
        titulo="Tiempos y radios"
        texto="Valores que antes estaban fijos en el programa. Cambian para todos los talleres."
      />

      {cargando ? (
        <p className="text-sm text-slate-400">Cargando…</p>
      ) : (
        <>
          <Tarjeta titulo="Citas">
            <Fila
              nombre="Duración por defecto de una cita"
              ayuda="Cuando ni la persona ni la entrada rápida dicen los minutos. Sale propuesta en el formulario de la Agenda."
            >
              {campo("duracionCitaMin", "min")}
            </Fila>
          </Tarjeta>

          <Tarjeta titulo="Tablet y APK del taller">
            <Fila
              nombre="Bloqueo por inactividad"
              ayuda="Minutos sin tocar la pantalla hasta que pide el PIN o Face ID. La app lo lee al entrar."
            >
              {campo("bloqueoTabletMin", "min")}
            </Fila>
          </Tarjeta>

          <Tarjeta titulo="GPS de las furgonetas">
            <Fila
              nombre="Radio de llegada a un lugar"
              ayuda="Asistencias, salidas y OTF: a menos de esta distancia del punto, «En punto»."
            >
              {campo("radioLlegadaM", "m")}
            </Fila>
            <Fila
              nombre="Radio de salida del taller"
              ayuda="A más de esta distancia del taller, «En camino». Tiene que ser mayor que el radio de llegada."
            >
              {campo("radioSalidaTallerM", "m")}
            </Fila>
          </Tarjeta>

          {error && <Fallo texto={error} />}
          {!error && errores.length > 0 && cambiado && <Fallo texto={errores.join(" ")} />}
          {aviso && <Aviso texto={aviso} />}

          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setForm(aTecleado(guardado))}
              disabled={!cambiado || guardando}
              className="rounded-lg border border-slate-600 bg-slate-800 px-4 py-2 text-sm font-semibold hover:bg-slate-700 disabled:opacity-50"
            >
              Deshacer
            </button>
            <button type="button" onClick={() => void guardar()} disabled={!cambiado || guardando || errores.length > 0} className={btnPrimario}>
              {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Guardar
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/* ── Horario y festivos (lo mismo que el ⚙ de la Agenda) ──────────────── */

function HorarioYFestivos() {
  const [config, setConfig] = useState<AgendaConfig | null>(null);
  const [version, setVersion] = useState(0);

  const cargar = useCallback(async () => {
    const c = await loadAgendaConfig().catch(() => DEFAULT_AGENDA_CONFIG);
    setConfig(c);
    setVersion((v) => v + 1);
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  return (
    <div className="space-y-3">
      <Cabecera
        titulo="Horario y festivos"
        texto="Lo mismo que abre el botón ⚙ Configuración de la Agenda: horario semanal, festivos, jornadas especiales y bloqueos por área."
      />
      {config === null ? (
        <p className="text-sm text-slate-400">Cargando…</p>
      ) : (
        <AgendaConfigModal
          key={version}
          open
          inline
          dark
          config={config}
          onClose={() => void cargar()}
          onSaved={(c) => setConfig(c)}
        />
      )}
    </div>
  );
}

/* ── Talleres y lugares (lo de Salidas → Taller, y los lugares conocidos) ─ */

function TalleresYLugares() {
  const [workshopId, setWorkshopId] = useState<string>(() =>
    String(normalizeWorkshopId(window.localStorage.getItem("sea-selected-workshop") || DEFAULT_WORKSHOP_ID))
  );
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [direccion, setDireccion] = useState("");
  const [radio, setRadio] = useState("300");
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [lugares, setLugares] = useState<KnownPlace[]>([]);

  useEffect(() => {
    let vivo = true;
    setMsg("");
    (async () => {
      try {
        const res = await apiFetch(`${API_BASE}/api/workshop-config?workshopId=${encodeURIComponent(workshopId)}`, {
          headers: getAdminHeaders(),
        });
        const c = await res.json();
        if (!vivo) return;
        setLat(String(c?.taller_lat ?? ""));
        setLng(String(c?.taller_lng ?? ""));
        setDireccion(String(c?.taller_direccion ?? ""));
        setRadio(String(c?.taller_radio_m ?? "300"));
      } catch {
        /* sin permisos no se abre nada */
      }
    })();
    return () => {
      vivo = false;
    };
  }, [workshopId]);

  const cargarLugares = useCallback(async () => {
    try {
      setLugares(await fetchKnownPlaces());
    } catch {
      setLugares([]);
    }
  }, []);

  useEffect(() => {
    void cargarLugares();
  }, [cargarLugares]);

  async function guardar() {
    setMsg("");
    setError("");
    try {
      const res = await apiFetch(`${API_BASE}/api/workshop-config`, {
        method: "POST",
        headers: getAdminHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ workshopId, taller_lat: lat, taller_lng: lng, taller_direccion: direccion, taller_radio_m: radio }),
      });
      if (!res.ok) throw new Error("Solo un administrador puede guardarlas.");
      setMsg("Guardadas.");
    } catch (e: any) {
      setError(e?.message || "No se pudieron guardar.");
    }
  }

  async function borrarLugar(p: KnownPlace) {
    if (!window.confirm(`¿Borrar el lugar «${p.nombre}»? Las asistencias y salidas que ya lo usaron no cambian.`)) return;
    try {
      await deleteKnownPlace(p.id);
      await cargarLugares();
    } catch (e: any) {
      setError(e?.message || "No se pudo borrar el lugar.");
    }
  }

  const taller = WORKSHOPS.find((w) => w.id === workshopId);

  return (
    <div className="space-y-3">
      <Cabecera
        titulo="Talleres y lugares"
        texto="Las coordenadas de cada taller, con las que el servidor detecta la salida y la llegada de las furgonetas, y los lugares conocidos que comparten Assist y Salidas."
      />

      <Tarjeta titulo="Coordenadas del taller">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <label className="text-xs text-slate-400">Taller</label>
          <select value={workshopId} onChange={(e) => setWorkshopId(e.target.value)} className={input}>
            {WORKSHOPS.map((w) => (
              <option key={w.id} value={w.id}>{w.shortName}</option>
            ))}
          </select>
          <span className="text-xs text-slate-500">En blanco, se usan las generales.</span>
        </div>
        <div className="grid gap-2 md:grid-cols-2">
          <label className="text-xs text-slate-300">
            Latitud
            <input id="taller-lat" value={lat} onChange={(e) => setLat(e.target.value)} className={`mt-1 w-full ${input}`} />
          </label>
          <label className="text-xs text-slate-300">
            Longitud
            <input id="taller-lng" value={lng} onChange={(e) => setLng(e.target.value)} className={`mt-1 w-full ${input}`} />
          </label>
        </div>
        <label className="mt-2 block text-xs text-slate-300">
          Dirección
          <input id="taller-dir" value={direccion} onChange={(e) => setDireccion(e.target.value)} className={`mt-1 w-full ${input}`} />
        </label>
        <label className="mt-2 block text-xs text-slate-300">
          Radio del taller (m)
          <input id="taller-radio" value={radio} onChange={(e) => setRadio(e.target.value)} className={`mt-1 w-32 ${input}`} />
        </label>
        <div className="mt-3 flex items-center justify-end gap-3">
          {msg && <span className="text-xs text-emerald-300">{msg}</span>}
          <button type="button" onClick={() => void guardar()} className={btnPrimario}>
            <Save className="h-4 w-4" /> Guardar {taller?.shortName ?? ""}
          </button>
        </div>
      </Tarjeta>

      <Tarjeta titulo={`Lugares conocidos (${lugares.length})`}>
        {lugares.length === 0 ? (
          <p className="text-xs text-slate-500">No hay lugares conocidos. Se crean desde Salidas o desde Assist.</p>
        ) : (
          <ul className="divide-y divide-slate-700">
            {lugares.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                <span className="font-semibold">{p.nombre}</span>
                <span className="flex-1 truncate text-xs text-slate-400">
                  {[p.tipo, p.clientName, p.direccion].filter(Boolean).join(" · ")}
                </span>
                <button
                  type="button"
                  onClick={() => void borrarLugar(p)}
                  className="rounded border border-rose-800 px-2 py-1 text-xs text-rose-300 hover:bg-rose-950"
                  title="Borrar lugar"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-slate-500">Para crear uno nuevo: Salidas → Nueva salida → «+ Nuevo lugar», o desde Assist.</p>
      </Tarjeta>

      {error && <Fallo texto={error} />}
    </div>
  );
}

/* ── Vacaciones (lo de Ausencias → Configuración) ─────────────────────── */

const MODOS: { valor: ModoVacaciones; etiqueta: string; ayuda: string }[] = [
  { valor: "naturales", etiqueta: "30 días naturales", ayuda: "Cuentan todos los días del rango, fines de semana y festivos incluidos." },
  { valor: "laborables", etiqueta: "22 días laborables (L-V)", ayuda: "Solo de lunes a viernes, descontando los festivos del taller." },
];

function Vacaciones() {
  const [workshopId, setWorkshopId] = useState<string>(() =>
    String(normalizeWorkshopId(window.localStorage.getItem("sea-selected-workshop") || DEFAULT_WORKSHOP_ID))
  );
  const [anio, setAnio] = useState(() => new Date().getFullYear());
  const [config, setConfig] = useState<ConfigVacaciones>({ modo: "naturales", diasPorDefecto: 30, diasPorTecnico: {} });
  const [techs, setTechs] = useState<Tech[]>([]);
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let vivo = true;
    setMsg("");
    (async () => {
      const [v, t] = await Promise.all([cargarConfigVacaciones(anio, workshopId), loadTechsFromBackend().catch(() => [])]);
      if (!vivo) return;
      setConfig({ modo: v.modo, diasPorDefecto: v.diasPorDefecto, diasPorTecnico: v.diasPorTecnico ?? {} });
      setTechs((t as Tech[]).filter((x) => x?.name));
    })();
    return () => {
      vivo = false;
    };
  }, [anio, workshopId]);

  async function guardar() {
    setGuardando(true);
    setMsg("");
    setError("");
    try {
      await guardarConfigVacaciones({ ...config, anio, workshopId });
      setMsg("Guardado.");
    } catch (e: any) {
      setError(e?.message || "No se pudo guardar la configuración.");
    } finally {
      setGuardando(false);
    }
  }

  const anios = [anio - 1, anio, anio + 1];

  return (
    <div className="space-y-3">
      <Cabecera
        titulo="Vacaciones"
        texto="Lo mismo que Ausencias → Configuración: cómo se cuentan las vacaciones y el cupo de cada técnico. Las ausencias se programan en la Agenda."
      />

      <Tarjeta titulo="Cómputo de vacaciones">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <select value={workshopId} onChange={(e) => setWorkshopId(e.target.value)} className={input}>
            {WORKSHOPS.map((w) => (
              <option key={w.id} value={w.id}>{w.shortName}</option>
            ))}
          </select>
          <select value={anio} onChange={(e) => setAnio(Number(e.target.value))} className={input}>
            {anios.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
          <span className="text-xs text-slate-500">El modo afecta solo a las vacaciones; baja, permiso y el resto van en días naturales.</span>
        </div>

        <div className="grid gap-2 md:grid-cols-2">
          {MODOS.map((m) => (
            <button
              key={m.valor}
              type="button"
              onClick={() => setConfig((prev) => ({ ...prev, modo: m.valor, diasPorDefecto: m.valor === "laborables" ? 22 : 30 }))}
              className={`rounded-2xl border px-3 py-3 text-left text-sm ${
                config.modo === m.valor ? "border-emerald-500 bg-emerald-500/10 text-emerald-200" : "border-slate-600 bg-slate-900 text-slate-300"
              }`}
            >
              <span className="block font-black">{m.etiqueta}</span>
              <span className="mt-0.5 block text-xs opacity-80">{m.ayuda}</span>
            </button>
          ))}
        </div>

        <div className="mt-3">
          <label className="mb-1 block text-xs text-slate-400">Días por defecto</label>
          <input
            type="number"
            min={0}
            max={366}
            value={config.diasPorDefecto}
            onChange={(e) => setConfig((prev) => ({ ...prev, diasPorDefecto: Number(e.target.value) }))}
            className={`w-28 ${input}`}
          />
        </div>

        <div className="mt-4">
          <p className="mb-2 text-xs text-slate-400">Cupo propio por técnico (vacío = hereda los {config.diasPorDefecto} días generales).</p>
          <div className="grid gap-2 md:grid-cols-3">
            {techs.map((t) => (
              <label key={t.name} className="flex items-center gap-2 text-sm">
                <span className="flex-1 truncate">{t.name}</span>
                <input
                  type="number"
                  min={0}
                  max={366}
                  placeholder={String(config.diasPorDefecto)}
                  value={config.diasPorTecnico?.[t.name] ?? ""}
                  onChange={(e) => {
                    const valor = e.target.value;
                    setConfig((prev) => {
                      const siguiente = { ...(prev.diasPorTecnico ?? {}) };
                      if (valor === "") delete siguiente[t.name];
                      else siguiente[t.name] = Number(valor);
                      return { ...prev, diasPorTecnico: siguiente };
                    });
                  }}
                  className={`w-20 ${input}`}
                />
              </label>
            ))}
          </div>
        </div>

        <div className="mt-3 flex items-center justify-end gap-3">
          {msg && <span className="text-xs text-emerald-300">{msg}</span>}
          <button type="button" onClick={() => void guardar()} disabled={guardando} className={btnPrimario}>
            {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Guardar
          </button>
        </div>
      </Tarjeta>

      {error && <Fallo texto={error} />}
    </div>
  );
}

/* ── Piezas comunes ───────────────────────────────────────────────────── */

function Cabecera({ titulo, texto }: { titulo: string; texto: string }) {
  return (
    <div>
      <h2 className="text-lg font-bold">{titulo}</h2>
      <p className="text-xs text-slate-400">{texto}</p>
    </div>
  );
}

function Tarjeta({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-700 bg-slate-800 p-4">
      <h3 className="mb-2 text-xs font-black uppercase tracking-wide text-slate-400">{titulo}</h3>
      {children}
    </div>
  );
}

function Fila({ nombre, ayuda, children }: { nombre: string; ayuda: string; children: React.ReactNode }) {
  return (
    <div className="grid items-center gap-2 border-t border-slate-700 py-2 first:border-t-0 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
      <div>
        <div className="text-sm font-semibold">{nombre}</div>
        <div className="text-xs text-slate-400">{ayuda}</div>
      </div>
      {children}
    </div>
  );
}

function Fallo({ texto }: { texto: string }) {
  return <div className="rounded-lg border border-rose-800 bg-rose-950/40 px-4 py-2 text-sm text-rose-300">{texto}</div>;
}

function Aviso({ texto }: { texto: string }) {
  return <div className="rounded-lg border border-emerald-800 bg-emerald-950/40 px-4 py-2 text-sm text-emerald-300">{texto}</div>;
}
