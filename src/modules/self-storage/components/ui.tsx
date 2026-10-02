/**
 * Kit de pantalla de Self Storage. Reexporta el de Administración (el que usa
 * medio panel) y añade lo propio: chips de estado, importes y medidas.
 */

import type { ReactNode } from "react";
import { Pill } from "../../administracion/components/ui";
import { useSelfStorage } from "../contexts/SelfStorageContext";
import { COLOR_PLANO, type CustomerStatus, type UnitStatus } from "../types";

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
