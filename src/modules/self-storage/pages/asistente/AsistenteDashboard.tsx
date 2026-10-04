/**
 * Asistente IA → Dashboard: sesiones, resolución, escalados, errores, tiempo
 * medio, herramientas más usadas, consultas no resueltas, idioma, proveedor y
 * modelo, coste estimado (si hay precios configurados) y calidad.
 */

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import * as api from "../../services/api";
import type { DashboardIA } from "../../types";
import { Cabecera, Cargando, ErrorBox, TableWrap, TextField, btnPrimary, msgError, tdCls, thCls } from "../../components/ui";
import { BarrasH, Indicador, Reparto } from "../../components/Graficos";
import { ESTADO } from "../../components/paleta";
import { duracion, etqIdioma, haceDias } from "../callcenter/formato";
import { ConEstadoAsistente } from "./comun";

function Contenido() {
  const [f, setF] = useState({ from: haceDias(29), to: "" });
  const [d, setD] = useState<DashboardIA | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.dashboardIA({ from: f.from || undefined, to: f.to || undefined }).then(
      (x) => (setD(x), setError(null)),
      (e) => setError(msgError(e))
    );
  }, [f]);
  const k = d?.kpis;
  return (
    <div className="space-y-3">
      <Cabecera titulo="Asistente IA" descripcion="Capa opcional sobre el Call Center. Informa y ayuda; la web vende.">
        <Link className={btnPrimary} to="/self-storage/asistente/sesiones?nueva=1">
          Probar en la consola
        </Link>
      </Cabecera>
      <div className="grid grid-cols-2 gap-2 sm:w-96">
        <TextField label="Desde" type="date" value={f.from} onChange={(v) => setF((x) => ({ ...x, from: v }))} />
        <TextField label="Hasta" type="date" value={f.to} onChange={(v) => setF((x) => ({ ...x, to: v }))} />
      </div>
      {error && <ErrorBox>{error}</ErrorBox>}
      {!d || !k ? (
        !error && <Cargando />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <Indicador titulo="Sesiones" valor={k.sessions} detalle={`${k.active} en curso`} />
            <Indicador titulo="Resueltas por la IA" valor={`${k.resolutionPct} %`} detalle={`${k.finished} terminadas sin escalar`} />
            <Indicador titulo="Escaladas" valor={k.escalated} />
            <Indicador titulo="Errores" valor={k.errors} />
            <Indicador titulo="Duración media" valor={duracion(k.avgDurationSeconds)} />
            <Indicador titulo="Consultas no resueltas" valor={k.unresolvedQueries} detalle="sin respuesta en el conocimiento" />
            <Indicador titulo="Para revisar" valor={k.pendingReview} detalle={`${k.flagged} marcadas en total`} />
            <Indicador titulo="Tokens" valor={(k.inputTokens + k.outputTokens).toLocaleString("es-ES")} detalle={`${k.inputTokens.toLocaleString("es-ES")} entrada · ${k.outputTokens.toLocaleString("es-ES")} salida`} />
            <Indicador titulo="Coste estimado" valor={k.costEstimate == null ? "—" : `${k.costEstimate.toLocaleString("es-ES", { maximumFractionDigits: 4 })} €`} detalle={k.costEstimate == null ? "sin precios configurados" : "según los precios del servidor"} />
          </div>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <section className="rounded-xl border border-slate-700 bg-slate-800 p-3">
              <h2 className="mb-2 text-[12px] font-bold uppercase tracking-wide text-slate-400">Revisión de calidad</h2>
              <Reparto
                partes={[
                  // Estado (no categoría): colores de estado, siempre con símbolo y etiqueta.
                  { label: "✓ Correctas", valor: k.reviewCorrect, color: ESTADO.bien },
                  { label: "~ Parciales", valor: k.reviewPartial, color: ESTADO.aviso },
                  { label: "✗ Incorrectas", valor: k.reviewIncorrect, color: ESTADO.mal },
                ]}
              />
            </section>
            <section className="rounded-xl border border-slate-700 bg-slate-800 p-3">
              <h2 className="mb-2 text-[12px] font-bold uppercase tracking-wide text-slate-400">Por idioma</h2>
              <BarrasH datos={d.porIdioma.map((x) => ({ label: x.code ? etqIdioma(x.code) : "Sin indicar", valor: x.sessions }))} />
            </section>
            <section className="rounded-xl border border-slate-700 bg-slate-800 p-3">
              <h2 className="mb-2 text-[12px] font-bold uppercase tracking-wide text-slate-400">Herramientas más usadas</h2>
              <TableWrap>
                <thead>
                  <tr>
                    <th className={thCls}>Herramienta</th>
                    <th className={thCls}>Usos</th>
                    <th className={thCls}>Bien</th>
                    <th className={thCls}>Error</th>
                    <th className={thCls}>Bloqueada</th>
                  </tr>
                </thead>
                <tbody>
                  {d.herramientas.map((h) => (
                    <tr key={h.tool} className="border-t border-slate-700">
                      <td className={`${tdCls} font-mono text-[12px]`}>{h.tool}</td>
                      <td className={tdCls}>{h.calls}</td>
                      <td className={tdCls}>{h.success}</td>
                      <td className={tdCls}>{h.errors}</td>
                      <td className={tdCls}>{h.blocked}</td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            </section>
            <section className="rounded-xl border border-slate-700 bg-slate-800 p-3">
              <h2 className="mb-2 text-[12px] font-bold uppercase tracking-wide text-slate-400">Proveedor y modelo</h2>
              <BarrasH datos={d.porProveedor.map((x) => ({ label: `${x.provider}${x.model ? ` · ${x.model}` : ""}`, valor: x.sessions }))} />
            </section>
          </div>
        </>
      )}
    </div>
  );
}

export default function AsistenteDashboard() {
  return <ConEstadoAsistente>{() => <Contenido />}</ConEstadoAsistente>;
}
