/**
 * El kit de la pantalla.
 *
 * Reexporta el de Administración —que es el que usa medio panel, incluido
 * Mobilink Cash— y añade sólo lo propio de este módulo. Escribir aquí otro
 * `Pill` o otra `TableWrap` sería empezar un tercer sistema de componentes que
 * se parecería al de al lado sin ser igual.
 */

import type { ReactNode } from "react";
import { Pill } from "../../administracion/components/ui";
import {
  COLOR_ESTADO,
  COLOR_ESTADO_ACTUACION,
  COLOR_PRIORIDAD,
  ETIQUETA_ESTADO,
  ETIQUETA_ESTADO_ACTUACION,
  ETIQUETA_PRIORIDAD,
  PUNTO_PRIORIDAD,
} from "../types";

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

/**
 * Una etiqueta desconocida se enseña tal cual en vez de quedarse en blanco.
 *
 * El vocabulario lo manda el servidor, así que el panel puede encontrarse un
 * estado que todavía no tiene traducción. Enseñar el nombre técnico es feo;
 * enseñar un hueco hace creer que el expediente no tiene estado.
 */
const etiqueta = (mapa: Record<string, string>, valor: string) => mapa[valor] ?? valor;
const color = (mapa: Record<string, string>, valor: string) =>
  mapa[valor] ?? "bg-slate-700 text-slate-400";

export function ChipEstado({ estado }: { estado: string }) {
  return <Pill className={color(COLOR_ESTADO, estado)}>{etiqueta(ETIQUETA_ESTADO, estado)}</Pill>;
}

export function ChipEstadoActuacion({ estado }: { estado: string }) {
  return (
    <Pill className={color(COLOR_ESTADO_ACTUACION, estado)}>
      {etiqueta(ETIQUETA_ESTADO_ACTUACION, estado)}
    </Pill>
  );
}

export function ChipPrioridad({ prioridad, manual }: { prioridad: string; manual?: boolean }) {
  return (
    <Pill className={color(COLOR_PRIORIDAD, prioridad)}>
      {etiqueta(ETIQUETA_PRIORIDAD, prioridad)}
      {/* Se dice que la puso una persona: si no, parece que el sistema opina eso. */}
      {manual ? " ·  a mano" : ""}
    </Pill>
  );
}

/** El punto de color de la primera columna de la bandeja. */
export function PuntoPrioridad({ prioridad }: { prioridad: string }) {
  return (
    <span
      className={`inline-block h-2.5 w-2.5 rounded-full ${PUNTO_PRIORIDAD[prioridad] ?? "bg-slate-500"}`}
      title={etiqueta(ETIQUETA_PRIORIDAD, prioridad)}
      aria-label={etiqueta(ETIQUETA_PRIORIDAD, prioridad)}
    />
  );
}

/** Aviso en línea. No hay sistema de toasts en el proyecto, y no se estrena. */
export function Aviso({
  tono = "info",
  children,
}: {
  tono?: "info" | "bien" | "mal" | "aviso";
  children: ReactNode;
}) {
  const clases = {
    info: "border-sky-500/40 bg-sky-500/10 text-sky-200",
    bien: "border-emerald-500/40 bg-emerald-500/10 text-emerald-200",
    mal: "border-rose-500/40 bg-rose-500/10 text-rose-200",
    aviso: "border-amber-500/40 bg-amber-500/10 text-amber-200",
  }[tono];
  return <div className={`rounded-xl border px-3 py-2 text-[13px] ${clases}`}>{children}</div>;
}

/** Un dato con su rótulo. Devuelve nada si no hay valor: no se pintan huecos. */
export function Dato({ rotulo, valor }: { rotulo: string; valor: ReactNode }) {
  if (valor === null || valor === undefined || valor === "") return null;
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
        {rotulo}
      </div>
      <div className="text-[13px] text-slate-200">{valor}</div>
    </div>
  );
}
