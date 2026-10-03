/**
 * Kit de pantalla de Self Storage. Reexporta el de Administración (el que usa
 * medio panel) y añade lo propio: chips de estado, importes y medidas.
 */

import type { ReactNode } from "react";
import { Pill } from "../../administracion/components/ui";
import { useSelfStorage } from "../contexts/SelfStorageContext";
import { COLOR_PLANO, type ContractStatus, type CustomerStatus, type EstadoCobros, type InvoiceStatus, type PaymentStatus, type UnitStatus } from "../types";

export {
  Field,
  TextField,
  SelectField,
  TextAreaField,
  CheckField,
  Pill,
  Card,
  Modal,
  TableWrap,
  EmptyRow,
  ErrorBox,
  thCls,
  tdCls,
  inputCls,
  btnPrimary,
  btnSecondary,
  btnDanger,
  btnMini,
} from "../../administracion/components/ui";
export { Aviso, Cabecera } from "../../cash/components/ui";

const eur = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" });
const dec = new Intl.NumberFormat("es-ES", { maximumFractionDigits: 2 });

export const euros = (v: number | null | undefined) => (v == null ? "—" : eur.format(v));
export const decimal = (v: number | null | undefined) => (v == null ? "—" : dec.format(v));
export const pct = (v: number | null | undefined) => (v == null ? "—" : `${dec.format(v)} %`);
/** 150 × 200 × 250 cm → «1,5 × 2 × 2,5 m». */
export const medidas = (a: number, l: number, h: number) => `${dec.format(a / 100)} × ${dec.format(l / 100)} × ${dec.format(h / 100)} m`;

export function ChipUnidad({ estado }: { estado: UnitStatus }) {
  const { etqUnidad } = useSelfStorage();
  const c = COLOR_PLANO[estado];
  return (
    <span
      className="inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-bold"
      style={{ backgroundColor: `${c.fill}33`, color: c.fill, border: `1px solid ${c.fill}66` }}
    >
      {etqUnidad(estado)}
    </span>
  );
}

const COLOR_CLIENTE: Record<CustomerStatus, string> = {
  active: "bg-emerald-500/20 text-emerald-300",
  blocked: "bg-rose-500/20 text-rose-300",
  inactive: "bg-slate-600/40 text-slate-300",
};

export function ChipCliente({ estado }: { estado: CustomerStatus }) {
  const { etqCliente } = useSelfStorage();
  return <Pill className={COLOR_CLIENTE[estado]}>{etqCliente(estado)}</Pill>;
}

export function Dato({ etiqueta, children }: { etiqueta: string; children: ReactNode }) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase text-slate-400">{etiqueta}</div>
      <div className="text-sm text-slate-100">{children}</div>
    </div>
  );
}

export function Cargando({ texto = "Cargando…" }: { texto?: string }) {
  return <div className="py-10 text-center text-sm text-slate-400">{texto}</div>;
}

/** Leyenda de colores del plano, sacada del mismo mapa que pinta las formas. */
export function LeyendaPlano() {
  const { etqUnidad } = useSelfStorage();
  const estados: UnitStatus[] = ["available", "occupied", "reserved", "maintenance", "blocked"];
  return (
    <div className="flex flex-wrap gap-3 text-[11px] text-slate-300">
      {estados.map((e) => (
        <span key={e} className="flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: COLOR_PLANO[e].fill }} />
          {etqUnidad(e)}
        </span>
      ))}
    </div>
  );
}

const COLOR_CONTRATO: Record<ContractStatus, string> = {
  draft: "bg-slate-600/40 text-slate-300",
  pending_signature: "bg-sky-500/20 text-sky-300",
  pending_payment: "bg-amber-500/20 text-amber-300",
  active: "bg-emerald-500/20 text-emerald-300",
  suspended: "bg-rose-500/20 text-rose-300",
  terminated: "bg-slate-700/60 text-slate-400",
  cancelled: "bg-slate-700/60 text-slate-500",
};

export function ChipContrato({ estado }: { estado: ContractStatus }) {
  const { etqContrato } = useSelfStorage();
  return <Pill className={COLOR_CONTRATO[estado]}>{etqContrato(estado)}</Pill>;
}

const COLOR_FACTURA: Record<InvoiceStatus, string> = {
  draft: "bg-slate-600/40 text-slate-300",
  pending: "bg-amber-500/20 text-amber-300",
  paid: "bg-emerald-500/20 text-emerald-300",
  overdue: "bg-rose-500/20 text-rose-300",
  cancelled: "bg-slate-700/60 text-slate-500",
  refunded: "bg-violet-500/20 text-violet-300",
};

export function ChipFactura({ estado }: { estado: InvoiceStatus }) {
  const { etqFactura } = useSelfStorage();
  return <Pill className={COLOR_FACTURA[estado]}>{etqFactura(estado)}</Pill>;
}

const COLOR_PAGO: Record<PaymentStatus, string> = {
  pending: "bg-slate-600/40 text-slate-300",
  processing: "bg-sky-500/20 text-sky-300",
  succeeded: "bg-emerald-500/20 text-emerald-300",
  failed: "bg-rose-500/20 text-rose-300",
  refunded: "bg-violet-500/20 text-violet-300",
};

export function ChipPago({ estado }: { estado: PaymentStatus }) {
  const { etqPago } = useSelfStorage();
  return <Pill className={COLOR_PAGO[estado]}>{etqPago(estado)}</Pill>;
}

const COBROS: Record<EstadoCobros, [string, string]> = {
  up_to_date: ["Al día", "bg-emerald-500/20 text-emerald-300"],
  pending: ["Pendiente de cobro", "bg-amber-500/20 text-amber-300"],
  overdue: ["Impagado", "bg-rose-500/20 text-rose-300"],
};

export function ChipCobros({ estado }: { estado: EstadoCobros | null }) {
  if (!estado) return <span className="text-slate-500">—</span>;
  const [txt, cls] = COBROS[estado];
  return <Pill className={cls}>{txt}</Pill>;
}

/** «2026-10-03T08:12:00Z» → «03/10/2026 10:12» en hora de Madrid. */
export const fechaHora = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("es-ES", { timeZone: "Europe/Madrid", dateStyle: "short", timeStyle: "short" }) : "—";
/** «2026-10-03» → «03/10/2026» (sin pasar por Date: es una fecha, no un instante). */
export const fecha = (d: string | null | undefined) => (d ? d.split("-").reverse().join("/") : "—");

/** Mensaje de un error para enseñarlo tal cual. */
export const msgError = (e: unknown, defecto = "Error") => (e instanceof Error ? e.message : defecto);
