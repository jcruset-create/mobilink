/**
 * Impagos: un caso por factura fallida o vencida, con los avisos enviados y
 * la suspensión. Se cierra solo al cobrar (o al anular la factura). Los
 * plazos se configuran en Configuración.
 */

import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import * as api from "../services/api";
import { DUNNING_STATUSES, type CasoImpago, type DunningStatus } from "../types";
import { FichaFactura } from "./Facturas";
import { Aviso, Cabecera, ChipContrato, ChipFactura, EmptyRow, ErrorBox, SelectField, TableWrap, btnSecondary, euros, fechaHora, msgError, tdCls, thCls } from "../components/ui";
import { useSelfStorage } from "../contexts/SelfStorageContext";

const ETIQUETA: Record<DunningStatus, string> = { open: "Abiertos", resolved: "Resueltos", cancelled: "Cancelados" };

export default function Impagos() {
  const { puede } = useSelfStorage();
  const [estado, setEstado] = useState<DunningStatus | "">("open");
  const [lista, setLista] = useState<CasoImpago[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [params, setParams] = useSearchParams();
  const factura = params.get("f");

  const cargar = useCallback(async () => {
    try {
      setLista(await api.impagos(estado || undefined));
      setError(null);
    } catch (e) {
      setError(msgError(e));
    }
  }, [estado]);
  useEffect(() => {
    void cargar();
  }, [cargar]);

  const ejecutar = async () => {
    try {
      await api.ejecutarTrabajo("vencimientos");
      const r = await api.ejecutarTrabajo("impagos");
      setAviso(`Motor de impagos ejecutado: ${JSON.stringify(r)}`);
      await cargar();
    } catch (e) {
      setError(msgError(e));
    }
  };

  const total = lista?.filter((c) => c.status === "open").reduce((s, c) => s + c.total, 0) ?? 0;

  return (
    <div className="space-y-3">
      <Cabecera titulo="Impagos" descripcion="Cobro fallido → aviso 1 → aviso 2 → suspensión del acceso. Cobrar levanta sólo el bloqueo por impago.">
        {puede("ss.settings.manage") && (
          <button className={btnSecondary} onClick={() => void ejecutar()}>
            Ejecutar ahora
          </button>
        )}
      </Cabecera>
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-48">
          <SelectField label="Casos" value={estado} onChange={(v) => setEstado(v as DunningStatus | "")}>
            <option value="">Todos</option>
            {DUNNING_STATUSES.map((s) => (
              <option key={s} value={s}>
                {ETIQUETA[s]}
              </option>
            ))}
          </SelectField>
        </div>
        {estado === "open" && lista && <span className="pb-2 text-sm text-rose-300">Deuda en impago: {euros(total)}</span>}
      </div>
      {aviso && <Aviso tono="info">{aviso}</Aviso>}
      {error && <ErrorBox>{error}</ErrorBox>}
      <TableWrap>
        <thead>
          <tr>
            <th className={thCls}>Abierto</th>
            <th className={thCls}>Cliente</th>
            <th className={thCls}>Factura</th>
            <th className={thCls}>Importe</th>
            <th className={thCls}>Motivo</th>
            <th className={thCls}>Avisos</th>
            <th className={thCls}>Suspensión</th>
            <th className={thCls}>Contrato</th>
          </tr>
        </thead>
        <tbody>
          {!lista && <EmptyRow cols={8} text="Cargando…" />}
          {lista?.length === 0 && <EmptyRow cols={8} text="Sin casos." />}
          {lista?.map((c) => (
            <tr key={c.id} className="border-t border-slate-700 align-top">
              <td className={tdCls}>{fechaHora(c.openedAt)}</td>
              <td className={tdCls}>
                <Link className="text-sky-300 hover:underline" to={`/self-storage/clientes/${c.customerId}`}>
                  {c.customerName ?? "—"}
                </Link>
              </td>
              <td className={tdCls}>
                <button className="text-sky-300 hover:underline" onClick={() => setParams({ f: c.invoiceId })}>
                  {c.invoiceNumber}
                </button>
                <div className="mt-0.5">
                  <ChipFactura estado={c.invoiceStatus} />
                </div>
              </td>
              <td className={tdCls}>{euros(c.total)}</td>
              <td className={`${tdCls} max-w-[16rem]`}>{c.failureReason ?? "—"}</td>
              <td className={tdCls}>
                <div>1º {fechaHora(c.firstNoticeAt)}</div>
                <div>2º {fechaHora(c.secondNoticeAt)}</div>
              </td>
              <td className={tdCls}>{fechaHora(c.suspendedAt)}</td>
              <td className={tdCls}>
                {c.contractId ? (
                  <>
                    <Link className="text-sky-300 hover:underline" to={`/self-storage/contratos/${c.contractId}`}>
                      {c.contractNumber}
                    </Link>
                    {c.contractStatus && (
                      <div className="mt-0.5">
                        <ChipContrato estado={c.contractStatus} />
                      </div>
                    )}
                  </>
                ) : (
                  "—"
                )}
                {c.resolvedAt && <div className="text-[11px] text-emerald-300">Resuelto {fechaHora(c.resolvedAt)} · {c.resolution}</div>}
              </td>
            </tr>
          ))}
        </tbody>
      </TableWrap>
      {factura && <FichaFactura id={factura} onCerrar={() => setParams({})} onCambio={() => void cargar()} />}
    </div>
  );
}
