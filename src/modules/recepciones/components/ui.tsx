/**
 * El kit de la pantalla. Reexporta el de Administración —que es el que usa
 * medio panel— y añade sólo lo propio de este módulo.
 */

import type { ReactNode } from "react";
import { Pill } from "../../administracion/components/ui";
import { useRecepciones } from "../contexts/RecepcionesContext";
import { COLOR_ESTADO_ALBARAN, COLOR_ESTADO_INCIDENCIA, COLOR_ESTADO_PEDIDO, ETIQUETA_ESTADO_INCIDENCIA } from "../types";

export {
  Field,
  TextField,
  SelectField,
  TextAreaField,
  Pill,
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
export { Aviso, BotonAccion, Cabecera } from "../../cash/components/ui";

const color = (mapa: Record<string, string>, valor: string) => mapa[valor] ?? "bg-slate-700 text-slate-400";

export function ChipEstadoPedido({ estado }: { estado: string }) {
  const { etiquetaEstadoPedido } = useRecepciones();
  return <Pill className={color(COLOR_ESTADO_PEDIDO, estado)}>{etiquetaEstadoPedido(estado)}</Pill>;
}

export function ChipEstadoAlbaran({ estado }: { estado: string }) {
  const { etiquetaEstadoAlbaran } = useRecepciones();
  return <Pill className={color(COLOR_ESTADO_ALBARAN, estado)}>{etiquetaEstadoAlbaran(estado)}</Pill>;
}

export function ChipEstadoIncidencia({ estado }: { estado: string }) {
  return <Pill className={color(COLOR_ESTADO_INCIDENCIA, estado)}>{ETIQUETA_ESTADO_INCIDENCIA[estado] ?? estado}</Pill>;
}

export function ChipResultado({ resultado }: { resultado: string }) {
  return (
    <Pill className={resultado === "OK" ? "bg-emerald-500/20 text-emerald-300" : "bg-amber-500/20 text-amber-200"}>
      {resultado === "OK" ? "OK" : "Con incidencia"}
    </Pill>
  );
}

/** Un dato con su rótulo. Devuelve nada si no hay valor: no se pintan huecos. */
export function Dato({ rotulo, valor }: { rotulo: string; valor: ReactNode }) {
  if (valor === null || valor === undefined || valor === "") return null;
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{rotulo}</div>
      <div className="text-[13px] text-slate-200">{valor}</div>
    </div>
  );
}

/** La marca de «sin mapear»: se ve, no bloquea. */
export function SinMapear() {
  return <span className="rounded bg-slate-700 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-300">Artículo sin mapear</span>;
}
