/**
 * Connect Pro — auditoría económica: qué importes se han movido a mano.
 *
 * La auditoría general registra acciones ("alguien tocó esta asistencia").
 * Esta responde la pregunta que hace un director: **cuánto dinero se ha
 * apartado de lo que dice la tarifa, quién lo ha apartado y con qué motivo**.
 *
 * Por eso la columna que manda es la DIFERENCIA y no el importe final. Un
 * ajuste de 331 a 330 mueve un euro, no trescientos treinta, y una lista
 * ordenada por importe final pondría arriba los servicios caros en vez de los
 * ajustes grandes.
 */

import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { boFetch } from "../services/api";
import { Card, Th, Td, Input, ErrorBanner, KpiCard, EmptyState } from "./ui";
import { fmtDateTime } from "../types";

type Ajuste = {
  id: number; assistanceId: number; expedientNumber: string | null;
  field: string; originalValue: string | null; newValue: string; diferencia: string;
  reason: string; authorizedByName: string | null; authorizedAtMs: number;
  lineNumber: number | null; description: string | null;
};

type Respuesta = {
  ajustes: Ajuste[];
  porUsuario: { usuario: string; ajustes: number; desviacion: string }[];
  totales: { ajustes: number; asistencias: number; desviacionVenta: string; desviacionCompra: string };
};

const CAMPOS: Record<string, string> = {
  saleTotal: "Venta (total)", purchaseTotal: "Compra (total)",
  saleUnitPrice: "Venta (unitario)", purchaseUnitPrice: "Compra (unitario)",
};

function mesActual(): string {
  const d = new Date(); d.setDate(1);
  return d.toISOString().slice(0, 10);
}

/** Verde si sube, rojo si baja: el signo es lo primero que se mira. */
function Diferencia({ v }: { v: string }) {
  const n = Number(v);
  const clase = n > 0 ? "text-emerald-300" : n < 0 ? "text-rose-300" : "text-slate-400";
  return <span className={`tabular-nums font-semibold ${clase}`}>{n > 0 ? "+" : ""}{v}</span>;
}

export default function AuditoriaEconomica() {
  const [from, setFrom] = useState(mesActual());
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const [r, setR] = useState<Respuesta | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(() => {
    const f = new Date(`${from}T00:00:00`).getTime();
    const t = new Date(`${to}T23:59:59`).getTime();
    boFetch<Respuesta>(`/pricing/audit?from=${f}&to=${t}`).then(setR).catch((e) => setError(e.message));
  }, [from, to]);
  useEffect(cargar, [cargar]);

  return (
    <div className="flex flex-col gap-4">
      {error && <ErrorBanner message={error} onClose={() => setError(null)} />}

      <div className="flex flex-wrap items-center gap-2">
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <span className="text-slate-500">→</span>
        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
      </div>

      {r && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiCard label="Ajustes manuales" value={r.totales.ajustes} />
            <KpiCard label="Asistencias afectadas" value={r.totales.asistencias} />
            <KpiCard label="Desviación en venta"
                     value={`${r.totales.desviacionVenta} €`}
                     tone={Number(r.totales.desviacionVenta) < 0 ? "warn" : "default"} />
            <KpiCard label="Desviación en compra"
                     value={`${r.totales.desviacionCompra} €`}
                     tone={Number(r.totales.desviacionCompra) > 0 ? "warn" : "default"} />
          </div>

          <p className="text-[12px] text-slate-500">
            La desviación es la diferencia contra lo que dijo la tarifa, no el
            importe facturado. En venta, negativo es dinero que se ha dejado de
            cobrar; en compra, positivo es dinero que se ha pagado de más.
          </p>

          {r.porUsuario.length > 0 && (
            <Card className="overflow-x-auto">
              <h2 className="border-b border-slate-700 px-4 py-3 text-sm font-semibold text-slate-300">
                Por quién lo autorizó
              </h2>
              <table className="w-full">
                <thead><tr className="border-b border-slate-700">
                  <Th>Usuario</Th><Th>Ajustes</Th><Th>Importe movido</Th>
                </tr></thead>
                <tbody>
                  {r.porUsuario.map((u) => (
                    <tr key={u.usuario} className="border-b border-slate-700/50">
                      <Td className="font-semibold text-slate-100">{u.usuario}</Td>
                      <Td>{u.ajustes}</Td>
                      <Td className="tabular-nums">{u.desviacion} €</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}

          {r.ajustes.length === 0 ? (
            <EmptyState message="Nadie ha ajustado ningún importe a mano en el periodo." />
          ) : (
            <Card className="overflow-x-auto">
              <h2 className="border-b border-slate-700 px-4 py-3 text-sm font-semibold text-slate-300">
                Ajustes ({r.ajustes.length})
              </h2>
              <table className="w-full">
                <thead><tr className="border-b border-slate-700">
                  <Th>Fecha</Th><Th>Asistencia</Th><Th>Concepto</Th><Th>Campo</Th>
                  <Th>Antes</Th><Th>Después</Th><Th>Diferencia</Th><Th>Motivo</Th><Th>Autorizado por</Th>
                </tr></thead>
                <tbody>
                  {r.ajustes.map((a) => (
                    <tr key={a.id} className="border-b border-slate-700/50">
                      <Td className="whitespace-nowrap">{fmtDateTime(a.authorizedAtMs)}</Td>
                      <Td>
                        <Link className="text-cyan-300 hover:underline" to={`/connect/asistencias/${a.assistanceId}`}>
                          #{a.assistanceId}{a.expedientNumber ? ` · ${a.expedientNumber}` : ""}
                        </Link>
                      </Td>
                      <Td>{a.description ?? "—"}</Td>
                      <Td>{CAMPOS[a.field] ?? a.field}</Td>
                      <Td className="tabular-nums text-slate-400">{a.originalValue ?? "—"}</Td>
                      <Td className="tabular-nums text-slate-100">{a.newValue}</Td>
                      <Td><Diferencia v={a.diferencia} /></Td>
                      <Td className="max-w-[280px]">{a.reason}</Td>
                      <Td>{a.authorizedByName ?? "—"}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
