import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useInformesFiltros } from "./InformesLayout";
import { listarAlertas } from "../../services/informes";
import type { Alerta } from "../../types/informes";
import { KpiCard } from "../../components/informes/KpiCard";
import { descargarCSV } from "../../utils/exportar";

const TIPO_LABEL: Record<string, string> = {
  // «Cambiar ya» y no «Bajo mínimo legal»: desde
  // `tyrecontrol_profundidad_minima_por_llanta.sql` el umbral es el de la
  // política de la casa —4 mm en una llanta de 22.5— y no el mínimo legal de
  // 1,6. Llamarlo legal haría pensar que una goma a 3 mm está fuera de la ley.
  bajo_minimo: "Cambiar ya",
  // Ya no lo devuelve el informe: se quitó el nivel de aviso de profundidad
  // al poner el mínimo por llanta. Se deja el nombre por si vuelve.
  proximo_sustitucion: "Próximo a sustitución",
  vehiculo_sin_revisar: "Vehículo sin revisar",
  // Los dos de Goodyear. Entran por `tc_informes_alertas` igual que los otros
  // tres, así que aquí solo hace falta ponerles nombre.
  presion_baja: "Presión baja",
  desinflado: "Neumático desinflado",
};

/** Las que vienen del sensor y no de una revisión. */
const DE_PRESION = ["presion_baja", "desinflado"];

const SEV_ESTILO: Record<string, { punto: string; texto: string }> = {
  alta: { punto: "#ef4444", texto: "text-rose-300" },
  media: { punto: "#f59e0b", texto: "text-amber-300" },
  baja: { punto: "#22c55e", texto: "text-emerald-300" },
};

export default function InformeAlertas() {
  const { filtros } = useInformesFiltros();
  const [alertas, setAlertas] = useState<Alerta[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let vivo = true;
    setCargando(true); setError("");
    listarAlertas(filtros)
      .then((a) => { if (vivo) setAlertas(a); })
      .catch((e) => { if (vivo) setError(e?.message || "Error al cargar las alertas"); })
      .finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
  }, [filtros]);

  if (cargando && alertas.length === 0) return <div className="text-slate-400">Cargando alertas…</div>;
  if (error) return <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-200">{error}</div>;

  const nAlta = alertas.filter((a) => a.severidad === "alta").length;
  const nMedia = alertas.filter((a) => a.severidad === "media").length;
  const porTipo = (t: string) => alertas.filter((a) => a.tipo === t).length;
  const nPresion = alertas.filter((a) => DE_PRESION.includes(a.tipo)).length;

  return (
    <div>
      <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <KpiCard title="Alertas críticas" value={nAlta} tono={nAlta > 0 ? "danger" : "ok"} />
        <KpiCard title="Alertas medias" value={nMedia} tono={nMedia > 0 ? "warn" : "ok"} />
        {/*
          El umbral ya no es uno solo, así que la pista dice la regla en vez de
          un número que sería falso para dos tercios de la flota.
        */}
        <KpiCard title="Cambiar ya" value={porTipo("bajo_minimo")} tono={porTipo("bajo_minimo") > 0 ? "danger" : "ok"}
                 hint="22.5 ≤ 4 mm · 19.5/17.5 ≤ 3 · 16 o menos ≤ 2" />
        <KpiCard title="Presión" value={nPresion} tono={nPresion > 0 ? "danger" : "ok"} hint="Sensor Goodyear" />
        <KpiCard title="Sin revisar" value={porTipo("vehiculo_sin_revisar")} />
      </div>

      <div className="rounded-lg bg-slate-800 p-3">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-[11px] font-bold uppercase text-slate-400">Alertas activas ({alertas.length})</div>
          <button
            onClick={() => descargarCSV("alertas", ["Severidad", "Tipo", "Matrícula", "Posición", "Neumático", "Detalle"],
              alertas.map((a) => [a.severidad, TIPO_LABEL[a.tipo] ?? a.tipo, a.matricula, a.posicion, a.codigo, a.detalle]))}
            className="rounded border border-slate-600 px-2 py-1 text-[11px] text-slate-200 hover:bg-slate-700"
          >Exportar CSV</button>
        </div>

        {alertas.length === 0 ? (
          <div className="p-4 text-sm text-emerald-300">✔ Sin alertas. Toda la flota dentro de parámetros.</div>
        ) : (
          <div className="flex flex-col divide-y divide-slate-700/60">
            {alertas.map((a, i) => {
              const sev = SEV_ESTILO[a.severidad] ?? SEV_ESTILO.media;
              return (
                <div key={i} className="flex items-center gap-3 py-2">
                  <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: sev.punto }} />
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-semibold text-slate-100">
                      <span className={sev.texto}>{TIPO_LABEL[a.tipo] ?? a.tipo}</span>
                      {a.matricula && <span className="text-slate-300"> · {a.matricula}</span>}
                      {a.posicion && <span className="text-slate-400"> · {a.posicion}</span>}
                    </div>
                    <div className="truncate text-[12px] text-slate-400">{a.detalle}{a.codigo ? ` · ${a.codigo}` : ""}</div>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    {a.neumatico_id && <Link to={`/tyrecontrol/neumaticos/${a.neumatico_id}`} className="text-[12px] text-sky-300 hover:underline">Neumático</Link>}
                    {a.vehiculo_id && <Link to={`/tyrecontrol/vehiculos/${a.vehiculo_id}`} className="text-[12px] text-sky-300 hover:underline">Vehículo</Link>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="mt-3 text-[11px] text-slate-500">
        Reglas: bajo mínimo ≤ 1,6 mm · próximo a sustitución ≤ 3,0 mm (sobre la última medición de cada neumático montado) ·
        vehículos activos sin ninguna revisión. Umbrales configurables por empresa y por medida en la ficha de la empresa (Empresas → ficha → Umbrales de profundidad).
        {" "}Las de <b>presión</b> no salen de una revisión: las manda el sensor de Goodyear por correo, y siguen abiertas hasta que
        alguien las cierra o hasta que una revisión posterior mida bien esa rueda. Cuando una misma rueda avisa varios días seguidos
        se dice en el detalle, porque eso ya no es poca presión: es una fuga.
      </div>
    </div>
  );
}
