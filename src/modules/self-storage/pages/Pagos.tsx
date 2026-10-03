/**
 * Pagos: todo lo cobrado, lo que está en proceso (SEPA tarda días) y lo que
 * ha fallado. Sólo lectura: los de Stripe los escribe el webhook y los
 * manuales se registran desde la factura.
 */

import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import * as api from "../services/api";
import { PAYMENT_STATUSES, type Pago } from "../types";
import { FichaFactura } from "./Facturas";
import { Cabecera, ChipPago, EmptyRow, ErrorBox, SelectField, TableWrap, euros, fechaHora, msgError, tdCls, thCls } from "../components/ui";
import { useSelfStorage } from "../contexts/SelfStorageContext";

export function TablaPagos({ items, onFactura, sinCliente }: { items: Pago[] | null; onFactura: (id: string) => void; sinCliente?: boolean }) {
  const { etqMetodo } = useSelfStorage();
  const cols = sinCliente ? 5 : 6;
  return (
    <TableWrap>
      <thead>
        <tr>
          <th className={thCls}>Fecha</th>
          {!sinCliente && <th className={thCls}>Cliente</th>}
          <th className={thCls}>Factura</th>
          <th className={thCls}>Forma</th>
          <th className={thCls}>Importe</th>
          <th className={thCls}>Estado</th>
        </tr>
      </thead>
      <tbody>
        {!items && <EmptyRow cols={cols} text="Cargando…" />}
        {items?.length === 0 && <EmptyRow cols={cols} text="Sin pagos." />}
        {items?.map((p) => (
          <tr key={p.id} className="border-t border-slate-700">
            <td className={tdCls}>{fechaHora(p.paidAt ?? p.createdAt)}</td>
            {!sinCliente && (
              <td className={tdCls}>
                <Link className="text-sky-300 hover:underline" to={`/self-storage/clientes/${p.customerId}`}>
                  {p.customerName}
                </Link>
              </td>
            )}
            <td className={tdCls}>
              {p.invoiceId ? (
                <button className="text-sky-300 hover:underline" onClick={() => onFactura(p.invoiceId!)}>
                  {p.invoiceNumber ?? "—"}
                </button>
              ) : (
                "—"
              )}
            </td>
            <td className={tdCls}>{etqMetodo(p.paymentMethod)}</td>
            <td className={tdCls}>
              {euros(p.amount)}
              {p.refundedAmount > 0 && <span className="ml-1 text-[11px] text-violet-300">(−{euros(p.refundedAmount)})</span>}
            </td>
            <td className={tdCls}>
              <ChipPago estado={p.status} />
              {p.failureReason && <span className="block text-[11px] text-rose-300">{p.failureReason}</span>}
            </td>
          </tr>
        ))}
      </tbody>
    </TableWrap>
  );
}

export default function Pagos() {
  const { etqPago } = useSelfStorage();
  const [lista, setLista] = useState<Pago[] | null>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [params, setParams] = useSearchParams();
  const factura = params.get("f");

  const cargar = useCallback(async () => {
    try {
      setLista(await api.pagos({ status: status || undefined }));
      setError(null);
    } catch (e) {
      setError(msgError(e));
    }
  }, [status]);
  useEffect(() => {
    void cargar();
  }, [cargar]);

  return (
    <div className="space-y-3">
      <Cabecera titulo="Pagos" descripcion="Tarjeta y SEPA los confirma Stripe; transferencia y efectivo se registran en la factura." />
      <div className="max-w-xs">
        <SelectField label="Estado" value={status} onChange={setStatus}>
          <option value="">Todos</option>
          {PAYMENT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {etqPago(s)}
            </option>
          ))}
        </SelectField>
      </div>
      {error && <ErrorBox>{error}</ErrorBox>}
      <TablaPagos items={lista} onFactura={(id) => setParams({ f: id })} />
      {factura && <FichaFactura id={factura} onCerrar={() => setParams({})} onCambio={() => void cargar()} />}
    </div>
  );
}
