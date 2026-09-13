/**
 * Vehículos en bases.
 *
 * Contesta la pregunta del taller: «¿a quién puedo revisar ahora sin sacarlo de
 * servicio?». Lo calcula el barrido de telemática del backend cada diez minutos
 * —una llamada al proveedor para toda la flota— y aquí solo se enseña.
 *
 * ── Lo que la pantalla NO hace, a propósito ─────────────────────────────────
 *
 * No es un mapa ni un seguimiento. La posición se compara con las geo-zonas de
 * las delegaciones y lo que se guarda es «dentro de la base X» o «fuera»; sirve
 * para organizar revisiones, no para saber por dónde va un conductor.
 *
 * ── Por qué se enseña siempre cuándo se barrió ──────────────────────────────
 *
 * Porque un estado de hace veinte minutos es útil y ese mismo estado
 * presentado como «ahora» es engañoso. Y por lo mismo, los de posición antigua
 * van en su propio apartado: en esta flota una quinta parte de los equipos
 * lleva más de un día sin emitir, y decir que esos autobuses no están en la
 * base sería afirmar algo que nadie ha comprobado.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { MapPin, RefreshCw, Truck } from "lucide-react";

import { listarEmpresas, listarRevisionEstado } from "../services/data";
import {
  ETIQUETA_PRESENCIA,
  barrerBases,
  listarPresenciaBases,
  type EstadoPresencia,
  type PresenciaBases,
  type VehiculoPresencia,
} from "../services/presenciaBases";
import {
  agruparPorBase,
  desde,
  fechaCorta,
  dormidosPorBase,
  minutosEnPalabras,
  revisablesEnBase,
  tieneRevisionPendiente,
} from "../services/presenciaVista";
import type { Empresa, RevisionEstado } from "../types";
import { ESTADO_PERIODICIDAD_LABELS } from "../types";

const TONO: Record<EstadoPresencia, string> = {
  IN_BASE: "text-emerald-300",
  STALE_POSITION: "text-amber-300",
  OUTSIDE_BASES: "text-slate-300",
  NO_POSITION: "text-slate-400",
  INVALID_POSITION: "text-rose-300",
};

export default function VehiculosEnBases() {
  const navigate = useNavigate();
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [empresaId, setEmpresaId] = useState("");
  const [datos, setDatos] = useState<PresenciaBases | null>(null);
  const [revisiones, setRevisiones] = useState<Map<string, RevisionEstado>>(new Map());
  const [baseSel, setBaseSel] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const [barriendo, setBarriendo] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  // Un administrador ve la suya; un super-admin puede cambiar de cliente.
  useEffect(() => {
    listarEmpresas()
      .then((e) => {
        setEmpresas(e);
        if (e.length) setEmpresaId((actual) => actual || e[0].id);
      })
      .catch((e) => setError(e.message));
  }, []);

  const cargar = useCallback(async () => {
    if (!empresaId) return;
    setCargando(true);
    setError("");
    try {
      const [p, rev] = await Promise.all([listarPresenciaBases(empresaId), listarRevisionEstado()]);
      setDatos(p);
      setRevisiones(new Map(rev.map((r) => [r.vehiculo_id, r])));
    } catch (e: any) {
      setError(e.message);
      setDatos(null);
    } finally {
      setCargando(false);
    }
  }, [empresaId]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function barrer() {
    setBarriendo(true);
    setMsg("");
    setError("");
    try {
      const r = await barrerBases(empresaId);
      if (!r.ok) setError(r.nota);
      else setMsg(r.nota);
      await cargar();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBarriendo(false);
    }
  }

  const nombreBase = useMemo(() => {
    const m = new Map<string, string>();
    for (const b of datos?.bases ?? []) m.set(b.id, b.nombre);
    return m;
  }, [datos]);

  const enBase = useMemo(
    () => agruparPorBase(datos?.vehiculos ?? [], revisiones),
    [datos, revisiones],
  );
  const dormidos = useMemo(() => dormidosPorBase(datos?.vehiculos ?? []), [datos]);
  const revisables = useMemo(
    () => revisablesEnBase(datos?.vehiculos ?? [], revisiones),
    [datos, revisiones],
  );

  const sinEnlace = (datos?.vehiculos ?? []).filter((v) => v.motivo === "sin_enlace").length;
  const lista = baseSel ? (enBase.get(baseSel) ?? []) : revisables;

  function Ficha({ v }: { v: VehiculoPresencia }) {
    const rev = revisiones.get(v.vehiculo_id);
    const pendiente = tieneRevisionPendiente(rev);
    const chip =
      rev?.estado === "proxima"
        ? "bg-amber-500/15 text-amber-300"
        : pendiente
          ? "bg-rose-500/15 text-rose-300"
          : "bg-slate-700/60 text-slate-300";
    return (
      <div className="flex flex-col rounded-2xl border border-slate-700 bg-slate-800 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-base font-black text-slate-100">
              {v.vehiculo?.matricula ?? "—"}
            </div>
            <div className="truncate text-[12px] text-slate-400">
              {v.delegacion?.nombre ?? nombreBase.get(v.delegacion_id ?? "") ?? "—"}
              {v.es_su_base === false && " · de paso"}
            </div>
          </div>
          {rev && (
            <div className="flex shrink-0 items-center gap-2">
              {/*
                La fecha de la última revisión, al lado del distintivo.
                «Vencida» o «Próxima» dicen en qué situación está; esto dice
                desde cuándo, que es lo que se mira para decidir si merece la
                pena cogerlo ahora que está en la base.
              */}
              <span className="text-right text-[11px] leading-tight text-slate-400">
                <span className="block text-[9px] uppercase text-slate-500">Últ. revisión</span>
                {fechaCorta(rev.ultima_revision)}
              </span>
              <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${chip}`}>
                {ESTADO_PERIODICIDAD_LABELS[rev.estado]}
                {rev.estado === "vencida" && (rev.dias_vencido ?? 0) > 0 ? ` · ${rev.dias_vencido} d` : ""}
              </span>
            </div>
          )}
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2 text-[12px]">
          {[
            ["Lleva en la base", desde(v.entrada_base_at)],
            ["Posición de hace", minutosEnPalabras(v.antiguedad_min)],
            ["Estado", ETIQUETA_PRESENCIA[v.estado]],
            ["Distancia al centro", v.distancia_m == null ? "—" : `${v.distancia_m} m`],
          ].map(([l, val]) => (
            <div key={l} className="rounded-lg bg-slate-900/60 p-2">
              <div className="text-[10px] uppercase text-slate-500">{l}</div>
              <div className="truncate text-slate-200">{val}</div>
            </div>
          ))}
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            onClick={() => navigate(`/tyrecontrol/revision-vehiculo?vehiculo=${v.vehiculo_id}&empresa=${empresaId}`)}
            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-[12px] font-bold text-white hover:bg-emerald-500"
          >
            Iniciar revisión
          </button>
          <button
            onClick={() => navigate(`/tyrecontrol/vehiculos/${v.vehiculo_id}`)}
            className="rounded-lg border border-slate-600 px-3 py-1.5 text-[12px] text-slate-200 hover:bg-slate-700"
          >
            Ver ficha
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-lg font-black">Vehículos en bases</h1>
          <p className="text-xs text-slate-500">
            {datos?.calculadoAt
              ? `Último barrido hace ${desde(datos.calculadoAt)}`
              : "Todavía no se ha barrido ninguna vez"}
            {datos ? ` · ${datos.bases.length} base(s) con geo-zona` : ""}
          </p>
        </div>
        <div className="flex items-end gap-2">
          {empresas.length > 1 && (
            <select
              value={empresaId}
              onChange={(e) => {
                setEmpresaId(e.target.value);
                setBaseSel(null);
              }}
              className="rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-200"
            >
              {empresas.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.nombre}
                </option>
              ))}
            </select>
          )}
          <button
            onClick={barrer}
            disabled={barriendo || !empresaId}
            className="flex items-center gap-2 rounded-lg border border-sky-600 px-3 py-2 text-sm font-bold text-sky-300 hover:bg-sky-500/10 disabled:opacity-50"
          >
            <RefreshCw size={14} className={barriendo ? "animate-spin" : ""} />
            {barriendo ? "Barriendo…" : "Barrer ahora"}
          </button>
        </div>
      </div>

      {error && <div className="mb-3 rounded-lg bg-rose-500/10 p-3 text-sm text-rose-300">{error}</div>}
      {msg && <div className="mb-3 rounded-lg bg-emerald-500/10 p-3 text-sm text-emerald-300">{msg}</div>}

      {cargando && !datos ? (
        <div className="text-slate-500">Cargando…</div>
      ) : !datos ? null : datos.bases.length === 0 ? (
        <div className="rounded-2xl border border-slate-700 bg-slate-800 p-8 text-center text-slate-400">
          Esta empresa no tiene ninguna base con posición configurada. Ponle el centro y el
          radio a la delegación en <b>Delegaciones</b> y vuelve a barrer.
        </div>
      ) : (
        <>
          {/* Contadores por estado. Los cinco, sin esconder los incómodos. */}
          <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {(
              ["IN_BASE", "STALE_POSITION", "OUTSIDE_BASES", "NO_POSITION"] as EstadoPresencia[]
            ).map((e) => (
              <div key={e} className="rounded-2xl border border-slate-700 bg-slate-800 p-3">
                <div className="text-[10px] uppercase text-slate-500">{ETIQUETA_PRESENCIA[e]}</div>
                <div className={`text-2xl font-black ${TONO[e]}`}>{datos.porEstado[e] ?? 0}</div>
              </div>
            ))}
          </div>

          {sinEnlace > 0 && (
            <div className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-[13px] text-amber-200">
              {sinEnlace} vehículo(s) no están vinculados con ninguna cuenta de telemática, así
              que de esos no se puede saber dónde están.{" "}
              <button
                onClick={() => navigate("/tyrecontrol/conciliacion-telematica")}
                className="font-bold underline"
              >
                Ir a la conciliación
              </button>
            </div>
          )}

          {/* Las bases, como filtro. */}
          <div className="mb-4 flex flex-wrap gap-2">
            <button
              onClick={() => setBaseSel(null)}
              className={`rounded-xl border px-3 py-2 text-left text-[12px] ${
                baseSel === null
                  ? "border-emerald-500 bg-emerald-500/10 text-emerald-200"
                  : "border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700"
              }`}
            >
              <div className="font-bold">Con revisión pendiente</div>
              <div className="text-slate-400">{revisables.length} en base ahora</div>
            </button>
            {datos.bases.map((b) => {
              const dentro = enBase.get(b.id)?.length ?? 0;
              const conPosicionVieja = dormidos.get(b.id) ?? 0;
              return (
                <button
                  key={b.id}
                  onClick={() => setBaseSel(b.id)}
                  className={`rounded-xl border px-3 py-2 text-left text-[12px] ${
                    baseSel === b.id
                      ? "border-emerald-500 bg-emerald-500/10 text-emerald-200"
                      : "border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700"
                  }`}
                >
                  <div className="flex items-center gap-1.5 font-bold">
                    <MapPin size={12} /> {b.nombre}
                  </div>
                  <div className="text-slate-400">
                    {dentro} dentro
                    {conPosicionVieja > 0 && ` · ${conPosicionVieja} con posición antigua`}
                  </div>
                </button>
              );
            })}
          </div>

          <div className="mb-2 flex items-center gap-2 text-[13px] text-slate-400">
            <Truck size={14} />
            {baseSel
              ? `${lista.length} vehículo(s) en ${nombreBase.get(baseSel) ?? "la base"}`
              : `${lista.length} vehículo(s) en base y con revisión pendiente`}
          </div>

          {lista.length === 0 ? (
            <div className="rounded-2xl border border-slate-700 bg-slate-800 p-8 text-center text-slate-400">
              {baseSel
                ? "Ahora mismo no hay ningún vehículo con posición reciente dentro de esta base."
                : "Ningún vehículo en base tiene revisión pendiente ahora mismo."}
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {lista.map((v) => (
                <Ficha key={v.vehiculo_id} v={v} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
