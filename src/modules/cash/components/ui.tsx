/**
 * Piezas de interfaz de Mobilink Cash.
 *
 * El lenguaje visual es el de Administración y TyreControl (fondo slate-900,
 * paneles slate-800, acento sky), así que lo común —`Card`, `Modal`,
 * `TableWrap`, `Pill`, `inputCls`…— se REUTILIZA de
 * `administracion/components/ui.tsx` en vez de copiarse. Aquí solo vive lo que
 * es propio de caja y no existía.
 */

import type { ReactNode } from "react";
import { euros } from "../utils/money";

export {
  inputCls,
  btnPrimary,
  btnSecondary,
  btnDanger,
  btnMini,
  Field,
  TextField,
  SelectField,
  TextAreaField,
  CheckField,
  Pill,
  Card,
  Modal,
  TableWrap,
  thCls,
  tdCls,
  EmptyRow,
  ErrorBox,
} from "../../administracion/components/ui";

/**
 * Botón de acción grande para el mostrador. Los botones normales del panel son
 * de 32 px de alto, que va bien con ratón y mal con el dedo: éstos son de 56 y
 * se usan en los accesos rápidos de la jornada.
 */
export function BotonAccion({
  icono,
  children,
  onClick,
  tono = "neutro",
  disabled,
}: {
  icono?: ReactNode;
  children: ReactNode;
  onClick: () => void;
  tono?: "neutro" | "cobro" | "pago" | "cierre";
  disabled?: boolean;
}) {
  const tonos = {
    neutro: "bg-slate-700 hover:bg-slate-600 text-slate-100",
    cobro: "bg-emerald-600 hover:bg-emerald-500 text-white",
    pago: "bg-amber-600 hover:bg-amber-500 text-white",
    cierre: "bg-sky-600 hover:bg-sky-500 text-white",
  };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex h-14 min-w-[140px] flex-1 items-center justify-center gap-2 rounded-xl px-4 text-sm font-bold disabled:opacity-40 ${tonos[tono]}`}
    >
      {icono}
      {children}
    </button>
  );
}

/** Importe grande, tabular, para los totales que hay que leer de un vistazo. */
export function Importe({
  centimos,
  tono = "neutro",
  tamano = "normal",
}: {
  centimos: number;
  tono?: "neutro" | "bien" | "mal" | "aviso";
  tamano?: "normal" | "grande";
}) {
  const tonos = {
    neutro: "text-slate-100",
    bien: "text-emerald-400",
    mal: "text-rose-400",
    aviso: "text-amber-300",
  };
  return (
    <span
      className={`font-black tabular-nums ${tonos[tono]} ${
        tamano === "grande" ? "text-3xl" : "text-lg"
      }`}
    >
      {euros(centimos)}
    </span>
  );
}

/**
 * Distintivo del origen de una operación.
 *
 * En el histórico tiene que verse de un golpe si un cobro vino de la ERP o lo
 * dio de alta alguien a mano: son dos cosas con responsabilidades distintas.
 */
export function OrigenBadge({ origen }: { origen: string }) {
  const esErp = origen === "ERP";
  return (
    <span
      className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-bold ${
        esErp ? "bg-sky-500/20 text-sky-300" : "bg-slate-600/40 text-slate-300"
      }`}
    >
      {esErp ? "ERP" : "Manual"}
    </span>
  );
}

/** Estado de sincronización con la ERP. */
export function SyncBadge({ estado }: { estado: string }) {
  if (estado === "NOT_APPLICABLE") return null;
  const estilos: Record<string, string> = {
    PENDING: "bg-amber-500/20 text-amber-300",
    SYNCING: "bg-sky-500/20 text-sky-300",
    RETRY_PENDING: "bg-amber-500/20 text-amber-300",
    SYNCED: "bg-emerald-500/20 text-emerald-300",
    ERROR: "bg-rose-500/20 text-rose-300",
    CANCELLED: "bg-slate-600/40 text-slate-400",
  };
  const textos: Record<string, string> = {
    PENDING: "ERP pendiente",
    SYNCING: "Enviando a ERP",
    RETRY_PENDING: "ERP: reintentando",
    SYNCED: "ERP sincronizado",
    ERROR: "ERP con error",
    CANCELLED: "ERP cancelado",
  };
  return (
    <span
      className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-bold ${
        estilos[estado] ?? "bg-slate-600/40 text-slate-300"
      }`}
    >
      {textos[estado] ?? estado}
    </span>
  );
}

/** Aviso destacado. Se usa para lo que el operador NO puede pasar por alto. */
export function Aviso({
  tono = "info",
  children,
}: {
  tono?: "info" | "bien" | "mal" | "aviso";
  children: ReactNode;
}) {
  const tonos = {
    info: "border-sky-500/40 bg-sky-500/10 text-sky-200",
    bien: "border-emerald-500/40 bg-emerald-500/10 text-emerald-200",
    mal: "border-rose-500/40 bg-rose-500/10 text-rose-200",
    aviso: "border-amber-500/40 bg-amber-500/10 text-amber-200",
  };
  return (
    <div className={`rounded-xl border px-3 py-2 text-sm ${tonos[tono]}`}>{children}</div>
  );
}

/** Cabecera de pantalla con título, descripción y acciones a la derecha. */
export function Cabecera({
  titulo,
  descripcion,
  children,
}: {
  titulo: string;
  descripcion?: string;
  children?: ReactNode;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
      <div>
        <h1 className="text-xl font-black text-slate-100">{titulo}</h1>
        {descripcion && <p className="text-[12px] text-slate-400">{descripcion}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

/**
 * Aviso de que hay que romper el precinto de un cartucho o de una bolsa.
 *
 * Sin esto la pantalla pide "1 € × 4" y el operador ve una sola moneda suelta
 * en el cajón, sin saber que las otras tres están dentro de un tubo. Y romper
 * un precinto no tiene vuelta atrás, así que conviene decirlo antes.
 */
export function AvisoCartuchos({
  aperturas,
}: {
  aperturas: { valor: number; cartuchos: number; bolsas?: number; piezas: number }[];
}) {
  if (aperturas.length === 0) return null;

  /** «2 cartuchos y 1 bolsa de 1 € (525 monedas)». */
  const describir = (a: { valor: number; cartuchos: number; bolsas?: number; piezas: number }) => {
    const partes = [
      a.cartuchos > 0 ? `${a.cartuchos} ${a.cartuchos === 1 ? "cartucho" : "cartuchos"}` : null,
      a.bolsas ? `${a.bolsas} ${a.bolsas === 1 ? "bolsa" : "bolsas"}` : null,
    ].filter(Boolean);
    return `${partes.join(" y ")} de ${euros(a.valor)} (${a.piezas} monedas)`;
  };

  return (
    <Aviso tono="aviso">
      <strong>Hay que abrir {aperturas.length === 1 ? "un precinto" : "precintos"}:</strong>{" "}
      {aperturas.map(describir).join(", ")}. Un envase abierto no se vuelve a cerrar.
    </Aviso>
  );
}
