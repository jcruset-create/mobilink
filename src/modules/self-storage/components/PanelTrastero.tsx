/**
 * Ficha rápida de un trastero en el plano del panel: número, medidas, m², m³,
 * precio, estado, zona y —si el rol puede ver clientes— cliente, contrato y
 * estado de cobros, con los accesos rápidos.
 *
 * Los accesos de fases posteriores se muestran deshabilitados con su fase:
 * mejor ver que existirán que buscarlos.
 */

import { Link } from "react-router-dom";
import type { ReactNode } from "react";
import type { Trastero } from "../types";
import { ChipCobros, ChipContrato, ChipUnidad, Dato, btnMini, decimal, euros, medidas } from "./ui";
import { useSelfStorage } from "../contexts/SelfStorageContext";

function Accion({ to, fase, titulo, children }: { to?: string; fase?: number; titulo?: string; children: ReactNode }) {
  if (to && !fase) {
    return (
      <Link to={to} className={btnMini}>
        {children}
      </Link>
    );
  }
  return (
    <span className={`${btnMini} cursor-not-allowed opacity-50`} title={titulo ?? (fase ? `Disponible en la fase ${fase}` : undefined)}>
      {children}
      {fase ? ` · F${fase}` : ""}
    </span>
  );
}

export default function PanelTrastero({ t, onCambiarEstado }: { t: Trastero; onCambiarEstado?: () => void }) {
  const { puede } = useSelfStorage();
  const verClientes = puede("ss.customers.view");
  const k = t.contract;
  return (
    <div className="space-y-3 rounded-xl border border-slate-700 bg-slate-800 p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-[10px] font-semibold uppercase text-slate-400">Trastero</div>
          <div className="text-2xl font-black">{t.code}</div>
          {t.name && <div className="text-[12px] text-slate-400">{t.name}</div>}
        </div>
        <ChipUnidad estado={t.status} />
      </div>
      {t.statusReason && <div className="rounded-lg bg-slate-900 px-2 py-1 text-[12px] text-slate-300">Motivo: {t.statusReason}</div>}

      <div className="grid grid-cols-2 gap-3">
        <Dato etiqueta="Zona">{t.zone.name}</Dato>
        <Dato etiqueta="Tipo">{t.unitType?.name ?? "—"}</Dato>
        <Dato etiqueta="Medidas (an × la × al)">{medidas(t.widthCm, t.lengthCm, t.heightCm)}</Dato>
        <Dato etiqueta="Superficie / volumen">
          {decimal(t.areaM2)} m² · {decimal(t.volumeM3)} m³
        </Dato>
        <Dato etiqueta="Precio mensual (PVP)">{euros(t.monthlyPriceGross)}</Dato>
        <Dato etiqueta="Base + IVA">
          {euros(t.monthlyPrice)} + {decimal(t.taxRate)} %
        </Dato>
      </div>

      {verClientes && (
        <div className="grid grid-cols-2 gap-3 border-t border-slate-700 pt-3">
          <Dato etiqueta="Cliente">
            {t.customer ? (
              <Link className="text-sky-300 hover:underline" to={`/self-storage/clientes/${t.customer.id}`}>
                {t.customer.name}
              </Link>
            ) : (
              "—"
            )}
          </Dato>
          <Dato etiqueta="Contrato">
            {k ? (
              <span className="flex flex-wrap items-center gap-1">
                <Link className="text-sky-300 hover:underline" to={`/self-storage/contratos/${k.id}`}>
                  {k.number}
                </Link>
                <ChipContrato estado={k.status} />
              </span>
            ) : (
              "—"
            )}
          </Dato>
          <Dato etiqueta="Precio contratado">
            {k?.monthlyPriceGross != null ? (
              <>
                {euros(k.monthlyPriceGross)}
                {k.monthlyPrice != null && k.monthlyPrice !== t.monthlyPrice && <span className="ml-1 text-[11px] text-amber-300">pactado</span>}
              </>
            ) : (
              "—"
            )}
          </Dato>
          <Dato etiqueta="Estado de pagos">{k ? <ChipCobros estado={t.paymentStatus} /> : "—"}</Dato>
        </div>
      )}

      {/* text-[11px] en el contenedor: el CSS global pone `font: inherit` a los botones. */}
      <div className="flex flex-wrap gap-1.5 border-t border-slate-700 pt-3 text-[11px]">
        {verClientes && <Accion to={t.customer ? `/self-storage/clientes/${t.customer.id}` : undefined}>Ver cliente</Accion>}
        {verClientes && k && <Accion to={`/self-storage/contratos/${k.id}`}>Ver contrato</Accion>}
        {verClientes && t.customer && puede("ss.billing.view") && <Accion to={`/self-storage/clientes/${t.customer.id}`}>Ver facturas</Accion>}
        {verClientes && !k && t.status === "available" && puede("ss.contracts.manage") && (
          <Accion to={`/self-storage/contratos?nuevo=1&unitId=${t.id}`}>Nuevo contrato</Accion>
        )}
        <Accion fase={3}>Ver accesos</Accion>
        {verClientes && k && <Accion titulo="Aún no hay cambio directo: finaliza este contrato y crea otro en el trastero nuevo.">Cambiar trastero</Accion>}
        {verClientes && k && puede("ss.contracts.admin") && <Accion to={`/self-storage/contratos/${k.id}`}>Finalizar contrato</Accion>}
        {puede("ss.units.status") && onCambiarEstado && (
          <button className={btnMini} onClick={onCambiarEstado}>
            Cambiar estado
          </button>
        )}
        <Accion to={`/self-storage/trasteros?editar=${t.id}`}>Abrir ficha</Accion>
      </div>
    </div>
  );
}
