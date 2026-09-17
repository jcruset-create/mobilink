/**
 * El kit de la pantalla. Reexporta el de Administración —que es el que usa
 * medio panel— y añade sólo lo propio de este módulo.
 */

import type { ReactNode } from "react";
import { Pill } from "../../administracion/components/ui";
import { useOrManuales } from "../contexts/OrManualesContext";
import {
  CASILLA_ESTADO_OR,
  COLOR_ESTADO_AVISO,
  COLOR_ESTADO_BLOC,
  COLOR_ESTADO_DOCUMENTO,
  COLOR_ESTADO_OR,
  COLOR_ESTADO_PROCESAMIENTO,
  tonoConfianza,
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
export { Aviso, BotonAccion, Cabecera } from "../../cash/components/ui";

const color = (mapa: Record<string, string>, valor: string) => mapa[valor] ?? "bg-slate-700 text-slate-400";

export function ChipEstadoBloc({ estado }: { estado: string }) {
  const { etiquetaEstadoBloc } = useOrManuales();
  return <Pill className={color(COLOR_ESTADO_BLOC, estado)}>{etiquetaEstadoBloc(estado)}</Pill>;
}

export function ChipEstadoOr({ estado }: { estado: string }) {
  const { etiquetaEstadoOr } = useOrManuales();
  return <Pill className={color(COLOR_ESTADO_OR, estado)}>{etiquetaEstadoOr(estado)}</Pill>;
}

export function ChipEstadoDocumento({ estado }: { estado: string }) {
  const { etiquetaEstadoDocumento } = useOrManuales();
  return <Pill className={color(COLOR_ESTADO_DOCUMENTO, estado)}>{etiquetaEstadoDocumento(estado)}</Pill>;
}

export function ChipEstadoProceso({ estado }: { estado: string }) {
  const { vocabulario } = useOrManuales();
  return (
    <Pill className={color(COLOR_ESTADO_PROCESAMIENTO, estado)}>
      {vocabulario?.etiquetas.estadoProcesamiento[estado] ?? estado}
    </Pill>
  );
}

export function ChipEstadoAviso({ estado }: { estado: string }) {
  const { vocabulario } = useOrManuales();
  return <Pill className={color(COLOR_ESTADO_AVISO, estado)}>{vocabulario?.etiquetas.estadoAviso[estado] ?? estado}</Pill>;
}

/**
 * La confianza del OCR con el color que le toca según los umbrales que haya
 * configurados. Si mañana se aprieta el listón, el color cambia solo.
 */
export function Confianza({ valor }: { valor: number | null }) {
  const { config } = useOrManuales();
  const umbrales = config?.umbrales ?? { automatico: 90, revision: 70 };
  if (valor === null) return <span className="text-slate-500">—</span>;
  return <span className={`font-bold tabular-nums ${tonoConfianza(valor, umbrales)}`}>{valor}%</span>;
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

/** La barra de «23 de 25». Con el número dentro, que es lo que se lee. */
export function Progreso({ archivadas, total }: { archivadas: number; total: number }) {
  const pct = total === 0 ? 0 : Math.round((archivadas / total) * 100);
  const tono = pct === 100 ? "bg-emerald-500" : pct >= 50 ? "bg-sky-500" : "bg-amber-500";
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-24 overflow-hidden rounded-full bg-slate-700">
        <div className={`h-full ${tono}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="whitespace-nowrap text-[12px] tabular-nums text-slate-300">
        {archivadas}/{total}
      </span>
    </div>
  );
}

/**
 * La rejilla de las 25 OR del bloc.
 *
 * Es la pantalla que más se mira del módulo: quien la abre quiere ver de un
 * golpe cuáles faltan, así que cada número es una casilla con su color y no
 * una fila de tabla que hay que leer.
 */
export function RejillaOrs({
  ors,
  onAbrir,
}: {
  ors: { id: string; numeroOr: number; estado: string; documentoPrincipalId: string | null }[];
  onAbrir?: (documentoId: string, numeroOr: number) => void;
}) {
  return (
    <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10">
      {ors.map((or) => {
        const clase = CASILLA_ESTADO_OR[or.estado] ?? "border-slate-600 bg-slate-800 text-slate-400";
        const abrible = Boolean(or.documentoPrincipalId && onAbrir);
        return (
          <button
            key={or.id}
            type="button"
            disabled={!abrible}
            onClick={() => or.documentoPrincipalId && onAbrir?.(or.documentoPrincipalId, or.numeroOr)}
            title={abrible ? `Ver la OR ${or.numeroOr}` : `OR ${or.numeroOr}`}
            className={`rounded-lg border px-1 py-2 text-center text-[12px] font-bold tabular-nums ${clase} ${
              abrible ? "cursor-pointer hover:brightness-125" : "cursor-default"
            }`}
          >
            {or.numeroOr}
            <span className="mt-0.5 block text-[11px] font-normal leading-none">{marca(or.estado)}</span>
          </button>
        );
      })}
    </div>
  );
}

/** El símbolo del encargo: ✓ escaneada, ✕ falta. */
function marca(estado: string): string {
  if (estado === "ESCANEADA") return "✓";
  if (estado === "PENDIENTE") return "✕";
  if (estado === "ERROR") return "!";
  return "?";
}

/** La leyenda de los colores. Sin ella, la rejilla es un mosaico. */
export function LeyendaOrs() {
  const { etiquetaEstadoOr } = useOrManuales();
  return (
    <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-400">
      {["ESCANEADA", "PENDIENTE", "REVISAR", "DUPLICADA", "ERROR"].map((e) => (
        <span key={e} className="flex items-center gap-1.5">
          <span className={`inline-block h-3 w-3 rounded border ${CASILLA_ESTADO_OR[e]}`} />
          {etiquetaEstadoOr(e)}
        </span>
      ))}
    </div>
  );
}
