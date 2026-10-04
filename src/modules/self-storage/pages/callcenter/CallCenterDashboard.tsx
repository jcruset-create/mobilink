/**
 * Call Center → Dashboard: cuántas llamadas, de qué, cómo acaban y quién las
 * atiende (persona, IA o híbrido). Filtros arriba en una fila: fechas y centro.
 */

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import * as api from "../../services/api";
import type { DashboardCallCenter } from "../../types";
import { Cabecera, Cargando, ErrorBox, SelectField, TextField, btnPrimary } from "../../components/ui";
import { BarrasH, Columnas, Indicador, Reparto } from "../../components/Graficos";
import { SERIE } from "../../components/paleta";
import { useSelfStorage } from "../../contexts/SelfStorageContext";
import { SiCallCenterActivo } from "./comun";
import { duracion, etqIdioma, haceDias } from "./formato";

function Panel({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-700 bg-slate-800 p-3">
      <h2 className="mb-2 text-[12px] font-bold uppercase tracking-wide text-slate-400">{titulo}</h2>
      {children}
    </section>
  );
}

function Contenido() {
  const { centros, puede } = useSelfStorage();
  const [f, setF] = useState({ from: haceDias(29), to: haceDias(0), centerId: "" });
  const [d, setD] = useState<DashboardCallCenter | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    api.dashboardCallCenter({ from: f.from || undefined, to: f.to || undefined, centerId: f.centerId || null }).then(
      (x) => vivo && (setD(x), setError(null)),
      (e) => vivo && setError(e instanceof Error ? e.message : "Error")
    );
    return () => {
      vivo = false;
    };
  }, [f]);

  const k = d?.kpis;
  const dias = d?.series.porDia.map((x) => x.day) ?? [];
  return (
    <div className="space-y-3">
      <Cabecera titulo="Call Center" descripcion="Atención telefónica: el Call Center informa y ayuda; la web vende.">
        {puede("ss.callcenter.create") && (
          <Link to="/self-storage/call-center/llamada" className={btnPrimary}>
            Nueva llamada
          </Link>
        )}
      </Cabecera>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <TextField label="Desde" type="date" value={f.from} onChange={(v) => setF((x) => ({ ...x, from: v }))} />
        <TextField label="Hasta" type="date" value={f.to} onChange={(v) => setF((x) => ({ ...x, to: v }))} />
        <SelectField label="Centro" value={f.centerId} onChange={(v) => setF((x) => ({ ...x, centerId: v }))}>
          <option value="">Todos</option>
          {centros.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </SelectField>
      </div>
      {error && <ErrorBox>{error}</ErrorBox>}
      {!d || !k ? (
        !error && <Cargando />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <Indicador titulo="Hoy" valor={k.today} />
            <Indicador titulo="Esta semana" valor={k.week} />
            <Indicador titulo="Este mes" valor={k.month} />
            <Indicador titulo="En el periodo" valor={k.total} detalle={`${k.incoming} entrantes · ${k.outgoing} salientes`} />
            <Indicador titulo="Duración media" valor={duracion(k.avgDurationSeconds)} />
            <Indicador titulo="Seguimientos pendientes" valor={k.pendingFollowUps} />
            <Indicador titulo="Resueltas" valor={`${k.resolvedPct} %`} detalle={`${k.resolved} llamadas`} />
            <Indicador titulo="Escaladas" valor={`${k.escalatedPct} %`} detalle={`${k.escalated} llamadas`} />
            <Indicador titulo="Clientes existentes" valor={k.existingCustomers} />
            <Indicador titulo="Nuevos interesados" valor={k.newInterested} detalle="números distintos sin ficha" />
            <Indicador titulo="Solicitudes de visita" valor={k.visitRequests} />
            <Indicador titulo="Incidencias abiertas" valor={k.incidentsOpen} detalle={`${k.incidentsUrgent} urgentes · ${k.incidentsFromCalls} desde llamadas`} />
            <Indicador titulo="Consultas de precio" valor={k.priceQueries} />
            <Indicador titulo="Consultas de tamaño" valor={k.sizeQueries} />
            <Indicador titulo="Enviados a calculadora" valor={k.sentToCalculator} />
            <Indicador titulo="Enviados a contratación" valor={k.sentToContracting} />
          </div>

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <Panel titulo="Llamadas por día">
              <Columnas dias={dias} series={[{ nombre: "Llamadas", color: SERIE.azul, valores: d.series.porDia.map((x) => x.calls) }]} />
            </Panel>
            <Panel titulo="Resueltas y escaladas por día">
              <Columnas
                dias={dias}
                series={[
                  { nombre: "Resueltas", color: SERIE.azul, valores: d.series.porDia.map((x) => x.resolved) },
                  { nombre: "Escaladas", color: SERIE.naranja, valores: d.series.porDia.map((x) => x.escalated) },
                ]}
              />
            </Panel>
            <Panel titulo="Quién atiende">
              <Reparto
                partes={[
                  { label: "Humano", valor: k.human, color: SERIE.azul },
                  { label: "IA", valor: k.ai, color: SERIE.naranja },
                  { label: "Híbrido", valor: k.hybrid, color: SERIE.aqua },
                ]}
              />
            </Panel>
            <Panel titulo="Duración media por día">
              <Columnas dias={dias} series={[{ nombre: "Duración media", color: SERIE.azul, valores: d.series.porDia.map((x) => x.avgDurationSeconds ?? 0) }]} formato={duracion} />
            </Panel>
            <Panel titulo="Por motivo">
              <BarrasH datos={d.series.porMotivo.map((x) => ({ label: x.label, valor: x.calls }))} />
            </Panel>
            <Panel titulo="Por resultado">
              <BarrasH datos={d.series.porResultado.map((x) => ({ label: x.label, valor: x.calls }))} />
            </Panel>
            <Panel titulo="Por idioma">
              <BarrasH datos={d.series.porIdioma.map((x) => ({ label: x.code ? etqIdioma(x.code) : "Sin indicar", valor: x.calls }))} />
            </Panel>
            <Panel titulo="Por centro">
              <BarrasH datos={d.series.porCentro.map((x) => ({ label: x.label, valor: x.calls }))} />
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}

export default function CallCenterDashboard() {
  return <SiCallCenterActivo>{() => <Contenido />}</SiCallCenterActivo>;
}
