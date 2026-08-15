/**
 * Connect Pro — liquidación del periodo a partir de las líneas del motor.
 *
 * La pantalla de facturación de siempre liquida sobre un número suelto por
 * asistencia, sin desglose y sin distinguir lo que se cobra de lo que se paga.
 * Esto liquida sobre las LÍNEAS del motor: concepto a concepto, y por los dos
 * lados, que son dos documentos a dos empresas distintas.
 *
 * Lo importante de esta pantalla no son los documentos que salen, sino los que
 * no salen:
 *
 *  - **Pendientes de cierre**: servicios prestados sin tarifa de cierre. No se
 *    van a facturar mientras sigan ahí, y por eso van arriba y en ámbar. Un
 *    listado que solo enseña lo que cuadra es un listado que factura de menos
 *    sin que nadie se entere.
 *  - **Documentos bloqueados**: los que tienen alguna línea sin importe o
 *    ninguna contraparte a la que emitir. No se exportan, y se ve el motivo.
 */

import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { boFetch, boDownload } from "../services/api";
import { Card, Th, Td, Badge, Button, ErrorBanner, KpiCard } from "./ui";
import { fmtDateTime } from "../types";

type Lado = "sale" | "purchase";

type LineaFactura = {
  assistanceId: number; expedientNumber: string | null; externalReference: string | null;
  serviceType: string; plate: string | null; fecha: number | null;
  lineNumber: number; kind: string; conceptCode: string | null; description: string;
  quantity: number; unit: string | null;
  unitPrice: string | null; total: string | null;
};

type Documento = {
  lado: Lado; counterpartyId: number | null; counterpartyName: string; currency: string;
  lineas: LineaFactura[]; asistencias: number; baseImponible: string;
  bloqueado: boolean; motivos: string[];
};

type Pendiente = {
  id: number; expedientNumber: string | null; status: string; serviceType: string;
  clientName: string | null; providerName: string | null; fechaMs: number; tieneBloqueada: boolean;
};

type Respuesta = {
  from: number; to: number; side: Lado;
  resumen: {
    documentos: number; emitibles: number; bloqueados: number; asistencias: number;
    baseImponible: string; baseImponibleEmitible: string;
  };
  documentos: Documento[];
  pendientesDeCierre: Pendiente[];
};

const TIPOS_LINEA: Record<string, string> = {
  FORFAIT: "Forfait", EXTRA_KM: "Km de más", EXTRA_TIME: "Tiempo de más",
  TIRE: "Neumático", ADDITIONAL_TIRE: "Neumático adicional", MATERIAL: "Material",
  CANCELLATION: "Anulación", ADMIN_FEE: "Gestión", TOLL: "Peajes", OTHER: "Otros",
};

export default function LiquidacionMotor({ from, to }: { from: string; to: string }) {
  const [lado, setLado] = useState<Lado>("sale");
  const [r, setR] = useState<Respuesta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [abierto, setAbierto] = useState<string | null>(null);

  const rango = useCallback(() => {
    const f = new Date(`${from}T00:00:00`).getTime();
    const t = new Date(`${to}T23:59:59`).getTime();
    return `from=${f}&to=${t}&side=${lado}`;
  }, [from, to, lado]);

  const cargar = useCallback(() => {
    boFetch<Respuesta>(`/billing/documents?${rango()}`).then(setR).catch((e) => setError(e.message));
  }, [rango]);
  useEffect(cargar, [cargar]);

  const exportar = async () => {
    setBusy(true); setError(null);
    try {
      await boDownload(`/billing/export.csv?${rango()}`, `facturacion-${from}.csv`);
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  const marcarExportadas = async () => {
    if (!r) return;
    const n = r.resumen.emitibles;
    if (n === 0) return;
    const referencia = window.prompt(
      `Marcar ${n} documento(s) como exportados. A partir de ahora esos servicios no ` +
      `vuelven a salir en el listado.\n\nReferencia del lote o de la factura (opcional):`, "");
    if (referencia == null) return;

    setBusy(true); setError(null);
    try {
      const f = new Date(`${from}T00:00:00`).getTime();
      const t = new Date(`${to}T23:59:59`).getTime();
      await boFetch("/billing/mark-exported", {
        method: "POST", body: { from: f, to: t, side: lado, referencia: referencia || null },
      });
      cargar();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  if (!r) return <p className="text-sm text-slate-500">Cargando liquidación…</p>;

  const moneda = r.documentos[0]?.currency ?? "EUR";

  return (
    <div className="flex flex-col gap-4">
      {error && <ErrorBanner message={error} onClose={() => setError(null)} />}

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-slate-600 p-0.5">
          {([["sale", "Venta a clientes"], ["purchase", "Compra a talleres"]] as const).map(([v, t]) => (
            <button
              key={v}
              type="button"
              onClick={() => setLado(v)}
              className={`rounded-md px-3 py-1.5 text-[13px] font-medium ${
                lado === v ? "bg-cyan-600/20 text-cyan-300" : "text-slate-400 hover:bg-slate-800"}`}
            >
              {t}
            </button>
          ))}
        </div>
        <Button variant="ghost" onClick={exportar} disabled={busy || r.resumen.emitibles === 0}>
          Exportar CSV para el ERP
        </Button>
        <Button onClick={marcarExportadas} disabled={busy || r.resumen.emitibles === 0}>
          Marcar como exportados
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Servicios" value={r.resumen.asistencias} />
        <KpiCard label="Base imponible emitible" value={`${r.resumen.baseImponibleEmitible} ${moneda}`} tone="ok" />
        <KpiCard label="Documentos bloqueados" value={r.resumen.bloqueados}
                 tone={r.resumen.bloqueados > 0 ? "bad" : "default"} />
        <KpiCard label="Sin tarifa de cierre" value={r.pendientesDeCierre.length}
                 tone={r.pendientesDeCierre.length > 0 ? "warn" : "default"} />
      </div>

      <p className="text-[12px] text-slate-500">
        Los importes son la base imponible: el tarifario no incluye IVA y aquí no
        se aplica ningún tipo. El impuesto lo pone el ERP, que es quien conoce el
        régimen de cada contraparte.
      </p>

      {r.pendientesDeCierre.length > 0 && (
        <Card className="overflow-x-auto border-amber-500/40">
          <h2 className="border-b border-slate-700 px-4 py-3 text-sm font-semibold text-amber-300">
            Servicios prestados sin tarifa de cierre ({r.pendientesDeCierre.length})
          </h2>
          <p className="px-4 pt-2 text-[12px] text-slate-400">
            No se van a facturar mientras sigan aquí. Hay que cerrar la tarifa desde
            la ficha de cada uno.
          </p>
          <table className="w-full">
            <thead><tr className="border-b border-slate-700">
              <Th>Asistencia</Th><Th>Fecha</Th><Th>Estado</Th><Th>Cliente</Th><Th>Taller</Th><Th>Forfait</Th>
            </tr></thead>
            <tbody>
              {r.pendientesDeCierre.map((p) => (
                <tr key={p.id} className="border-b border-slate-700/50">
                  <Td>
                    <Link className="text-cyan-300 hover:underline" to={`/connect/asistencias/${p.id}`}>
                      #{p.id}{p.expedientNumber ? ` · ${p.expedientNumber}` : ""}
                    </Link>
                  </Td>
                  <Td className="whitespace-nowrap">{fmtDateTime(p.fechaMs)}</Td>
                  <Td>{p.status === "cancelled" ? "Anulada" : "Finalizada"}</Td>
                  <Td>{p.clientName ?? "—"}</Td>
                  <Td>{p.providerName ?? "—"}</Td>
                  <Td>
                    {p.tieneBloqueada
                      ? <Badge className="border-slate-600 text-slate-400">Comprometido</Badge>
                      : <Badge className="border-rose-500/40 text-rose-300">Sin tarifa</Badge>}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {r.documentos.length === 0 ? (
        <p className="text-sm text-slate-500">
          No hay nada que liquidar en el periodo por este lado.
        </p>
      ) : r.documentos.map((d) => {
        const clave = `${d.lado}-${d.counterpartyId ?? d.counterpartyName}`;
        return (
          <Card key={clave} className={d.bloqueado ? "border-rose-500/40" : ""}>
            <div className="flex flex-wrap items-center gap-2 border-b border-slate-700 px-4 py-3">
              <span className="text-sm font-semibold text-slate-100">{d.counterpartyName}</span>
              <span className="text-[12px] text-slate-500">
                {d.asistencias} servicio(s) · {d.lineas.length} línea(s)
              </span>
              {d.bloqueado && <Badge className="border-rose-500/40 text-rose-300">No se exporta</Badge>}
              <span className="ml-auto text-[15px] font-semibold tabular-nums text-slate-100">
                {d.baseImponible} {d.currency}
              </span>
            </div>

            {d.motivos.length > 0 && (
              <ul className="border-b border-slate-700 px-4 py-2 text-[12px] text-rose-300">
                {d.motivos.map((m, i) => <li key={i}>{m}</li>)}
              </ul>
            )}

            <div className="px-4 py-2">
              <button
                type="button"
                onClick={() => setAbierto(abierto === clave ? null : clave)}
                className="text-[12px] text-cyan-300 hover:underline"
              >
                {abierto === clave ? "Ocultar el detalle" : "Ver el detalle"}
              </button>
            </div>

            {abierto === clave && (
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead><tr className="border-b border-slate-700">
                    <Th>Asistencia</Th><Th>Fecha</Th><Th>Matrícula</Th><Th>Concepto</Th>
                    <Th>Cant.</Th><Th>Precio ud.</Th><Th>Importe</Th>
                  </tr></thead>
                  <tbody>
                    {d.lineas.map((l) => (
                      <tr key={`${l.assistanceId}-${l.lineNumber}`} className="border-b border-slate-700/40">
                        <Td>
                          <Link className="text-cyan-300 hover:underline" to={`/connect/asistencias/${l.assistanceId}`}>
                            #{l.assistanceId}
                          </Link>
                        </Td>
                        <Td className="whitespace-nowrap">{l.fecha ? fmtDateTime(l.fecha) : "—"}</Td>
                        <Td>{l.plate ?? "—"}</Td>
                        <Td>
                          <span className="text-slate-200">{l.description}</span>
                          <span className="ml-2 text-[11px] text-slate-500">{TIPOS_LINEA[l.kind] ?? l.kind}</span>
                        </Td>
                        <Td>{l.quantity}{l.unit ? ` ${l.unit}` : ""}</Td>
                        <Td>{l.unitPrice ?? <span className="text-slate-600">—</span>}</Td>
                        <Td className={l.total == null ? "text-rose-300" : "tabular-nums"}>
                          {l.total ?? "sin importe"}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}
