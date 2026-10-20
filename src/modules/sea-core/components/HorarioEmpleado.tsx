import { useEffect, useMemo, useState } from "react";
import { Trash2 } from "lucide-react";
import { getTodayDateValue } from "../../techStatusScheduleHelpers";
import {
  TURNO_TALLER,
  asignacionVigente,
  lunesDe,
  sumarDias,
  turnoDeLaSemana,
  validarAsignacion,
  type AsignacionHorario,
  type Turno,
} from "../../horariosTurnos";
import { borrarAsignacion, cargarAsignaciones, cargarTurnos, claseDeTurno, guardarAsignacion } from "../../horariosApi";
import { useEsSuperadmin } from "../../esSuperadmin";

/**
 * Pestaña «Horario» de la ficha del empleado (solo superadministrador).
 *
 * Fijo: un turno. Rotativo: la secuencia de turnos, uno por semana en bucle,
 * y la semana en la que se empieza por el primero. Cada asignación vale desde
 * una fecha; la anterior sigue para las semanas de antes, así que cambiar el
 * horario no reescribe el pasado.
 */

type Props = { empleadoId: string; nombre: string };

const fechaCorta = (f: string) => (/^(\d{4})-(\d{2})-(\d{2})$/.test(f) ? `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(0, 4)}` : f);

export default function HorarioEmpleado({ empleadoId, nombre }: Props) {
  const esSuperadmin = useEsSuperadmin();
  const hoy = getTodayDateValue();
  const [turnos, setTurnos] = useState<Turno[]>([]);
  const [asignaciones, setAsignaciones] = useState<AsignacionHorario[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [errores, setErrores] = useState<string[]>([]);
  const [guardando, setGuardando] = useState(false);
  const [aviso, setAviso] = useState("");

  const [tipo, setTipo] = useState<"fijo" | "rotativo">("fijo");
  const [secuencia, setSecuencia] = useState<string[]>([TURNO_TALLER]);
  const [semanaInicio, setSemanaInicio] = useState(() => lunesDe(hoy) ?? hoy);
  const [vigenteDesde, setVigenteDesde] = useState(() => lunesDe(hoy) ?? hoy);

  async function cargar() {
    setCargando(true);
    setError("");
    try {
      const [t, a] = await Promise.all([cargarTurnos(), cargarAsignaciones(empleadoId)]);
      setTurnos(t);
      setAsignaciones(a);
      const vigente = asignacionVigente(a, hoy);
      if (vigente) {
        setTipo(vigente.tipo);
        setSecuencia(vigente.turnoIds);
        setSemanaInicio(vigente.semanaInicio || vigente.vigenteDesde);
      }
    } catch (e: any) {
      setError(e?.message || "No se pudo cargar el horario.");
    } finally {
      setCargando(false);
    }
  }

  useEffect(() => {
    if (esSuperadmin) void cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [esSuperadmin, empleadoId]);

  const opciones = useMemo(
    () => [{ id: TURNO_TALLER, nombre: "Horario del taller" }, ...turnos.filter((t) => t.activo)],
    [turnos]
  );
  const nombreDe = (id: string) => (id === TURNO_TALLER ? "Taller" : turnos.find((t) => t.id === id)?.nombre ?? "?");

  const borrador: AsignacionHorario = {
    employeeId: empleadoId,
    tipo,
    turnoIds: tipo === "fijo" ? secuencia.slice(0, 1) : secuencia,
    semanaInicio: lunesDe(semanaInicio) ?? semanaInicio,
    vigenteDesde,
  };

  // Vista previa: qué turno toca esta semana y las dos siguientes.
  const previa = useMemo(() => {
    const base = lunesDe(hoy) ?? hoy;
    return [0, 7, 14].map((d) => {
      const f = sumarDias(base, d) ?? base;
      return { semana: f, turno: f < vigenteDesde ? null : turnoDeLaSemana(borrador, f) };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tipo, secuencia, semanaInicio, vigenteDesde, hoy]);

  async function guardar() {
    const errs = validarAsignacion(borrador);
    setErrores(errs);
    setAviso("");
    if (errs.length) return;
    setGuardando(true);
    try {
      await guardarAsignacion(borrador);
      setAviso(`Horario guardado. Vale desde el ${fechaCorta(vigenteDesde)}.`);
      await cargar();
    } catch (e: any) {
      setErrores([e?.message || "No se pudo guardar el horario."]);
    } finally {
      setGuardando(false);
    }
  }

  async function borrar(a: AsignacionHorario) {
    if (!a.id) return;
    try {
      await borrarAsignacion(a.id);
      await cargar();
    } catch (e: any) {
      setError(e?.message || "No se pudo borrar.");
    }
  }

  if (esSuperadmin === false) {
    return <div className="rounded-xl border border-slate-700 bg-slate-800 p-4 text-sm text-slate-300">El horario lo gestiona el superadministrador.</div>;
  }

  const input = "rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:ring-2 focus:ring-sky-500";
  const vigente = asignacionVigente(asignaciones, hoy);

  return (
    <div className="rounded-2xl border border-slate-700 bg-slate-800 p-4">
      <h2 className="text-base font-bold">Horario de {nombre}</h2>
      <p className="text-xs text-slate-400">
        {vigente
          ? `Ahora: ${vigente.tipo === "fijo" ? "fijo" : "rotativo"} · ${vigente.turnoIds.map(nombreDe).join(" → ")} · desde el ${fechaCorta(vigente.vigenteDesde)}.`
          : "Sin horario asignado: sale como «sin horario» en la semana de control."}
      </p>

      {error && <div className="mt-3 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{error}</div>}
      {aviso && <div className="mt-3 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">{aviso}</div>}
      {errores.length > 0 && (
        <ul className="mt-3 list-disc rounded-lg border border-rose-500/40 bg-rose-500/10 px-6 py-2 text-xs text-rose-300">
          {errores.map((e) => <li key={e}>{e}</li>)}
        </ul>
      )}

      {cargando ? (
        <div className="mt-4 text-sm text-slate-400">Cargando…</div>
      ) : (
        <div className="mt-4 grid max-w-2xl gap-4">
          <div>
            <div className="text-xs font-medium text-slate-300">Tipo de horario</div>
            <div className="mt-1 inline-flex overflow-hidden rounded-lg border border-slate-600 text-sm">
              {(["fijo", "rotativo"] as const).map((t) => (
                <button key={t} type="button" onClick={() => { setTipo(t); if (t === "rotativo" && secuencia.length < 2) setSecuencia([...secuencia, ""]); }}
                  className={`px-3 py-1.5 font-semibold ${tipo === t ? "bg-sky-600 text-white" : "text-slate-300 hover:bg-slate-700"}`}>
                  {t === "fijo" ? "Fijo" : "Rotativo por semanas"}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="text-xs font-medium text-slate-300">{tipo === "fijo" ? "Turno" : "Secuencia de turnos (se repite en bucle, una semana cada uno)"}</div>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              {(tipo === "fijo" ? secuencia.slice(0, 1) : secuencia).map((id, i) => (
                <div key={i} className="flex items-center gap-1">
                  {tipo === "rotativo" && <span className="font-mono text-[11px] text-slate-400">{i + 1}</span>}
                  <select id={`horario-turno-${i}`} value={id} onChange={(e) => { const s = [...secuencia]; s[i] = e.target.value; setSecuencia(s); }} className={`${input} ${id ? claseDeTurno(id, turnos).split(" ")[0] : ""}`}>
                    <option value="">— elige —</option>
                    {opciones.map((o) => <option key={o.id} value={o.id}>{o.nombre}</option>)}
                  </select>
                  {tipo === "rotativo" && secuencia.length > 2 && (
                    <button type="button" title="Quitar" onClick={() => setSecuencia(secuencia.filter((_, j) => j !== i))} className="rounded-md border border-slate-600 px-1.5 py-1 text-xs text-slate-400 hover:bg-slate-700">×</button>
                  )}
                </div>
              ))}
              {tipo === "rotativo" && (
                <button type="button" onClick={() => setSecuencia([...secuencia, ""])} className="rounded-md border border-dashed border-slate-600 px-2 py-1.5 text-xs text-slate-400 hover:bg-slate-700">+ añadir semana</button>
              )}
            </div>
            {opciones.length === 1 && <p className="mt-1 text-[11px] text-slate-400">Solo existe el horario del taller. Los turnos se crean en Core → Horarios → Turnos.</p>}
          </div>

          {tipo === "rotativo" && (
            <label className="block text-xs font-medium text-slate-300">Semana en la que empieza por el turno 1
              <input id="horario-semana-inicio" type="date" value={semanaInicio} onChange={(e) => setSemanaInicio(e.target.value)} className={`mt-1 block ${input}`} />
              <span className="mt-1 block text-[11px] text-slate-400">Se toma el lunes de esa semana.</span>
            </label>
          )}

          <label className="block text-xs font-medium text-slate-300">Desde cuándo vale este horario
            <input id="horario-vigente-desde" type="date" value={vigenteDesde} onChange={(e) => setVigenteDesde(e.target.value)} className={`mt-1 block ${input}`} />
            <span className="mt-1 block text-[11px] text-slate-400">El horario anterior se conserva para las semanas de antes.</span>
          </label>

          <div className="rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm">
            {previa.map((p, i) => (
              <span key={p.semana} className="mr-3 inline-block">
                <span className="text-slate-400">{i === 0 ? "Esta semana" : i === 1 ? "Siguiente" : "Después"} ({fechaCorta(p.semana).slice(0, 5)}):</span>{" "}
                <b className="font-mono">{p.turno ? nombreDe(p.turno) : "—"}</b>
              </span>
            ))}
          </div>

          <div className="flex gap-2">
            <button type="button" disabled={guardando} onClick={() => void guardar()} className="rounded-xl bg-sky-600 px-4 py-2 text-sm font-bold text-white hover:bg-sky-500 disabled:opacity-50">{guardando ? "Guardando…" : "Guardar horario"}</button>
          </div>

          {asignaciones.length > 0 && (
            <div>
              <div className="text-xs font-medium text-slate-300">Historial</div>
              <ul className="mt-1 divide-y divide-slate-700 rounded-lg border border-slate-700 text-sm">
                {asignaciones.map((a) => (
                  <li key={a.id ?? a.vigenteDesde} className="flex items-center justify-between gap-2 px-3 py-1.5">
                    <span>
                      <span className="font-mono text-xs text-slate-400">desde {fechaCorta(a.vigenteDesde)}</span> · {a.tipo} · {a.turnoIds.map(nombreDe).join(" → ")}
                      {a === vigente && <span className="ml-2 rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-bold text-emerald-300">VIGENTE</span>}
                    </span>
                    <button type="button" title="Borrar" onClick={() => void borrar(a)} className="rounded-md border border-slate-600 p-1 text-slate-400 hover:bg-slate-700 hover:text-rose-300"><Trash2 className="h-3.5 w-3.5" /></button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
