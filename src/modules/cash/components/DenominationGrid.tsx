/**
 * Rejilla de denominaciones: la pieza central de toda la interfaz de caja.
 *
 * Es el mismo componente en cobrar, pagar, mover efectivo, arquear y cerrar,
 * porque en los cinco sitios la pregunta es idéntica: cuántas piezas de cada
 * valor. Tener uno solo evita que el contador de billetes de 50 € se comporte
 * distinto según la pantalla.
 *
 * Pensado para usarse de pie y con prisa, en tablet:
 *  · botones −/+ grandes (44 px, que es el mínimo cómodo con el dedo);
 *  · el campo acepta teclado numérico (`inputMode="numeric"`);
 *  · el total se ve siempre, sin tener que bajar;
 *  · cada fila enseña su subtotal —como se cuenta un cajón de verdad— salvo
 *    cuando hay que mostrar las existencias, porque las dos cifras no caben en
 *    la misma fila y al sacar dinero importa más cuántas piezas quedan.
 *
 * El estado se lleva en céntimos → cantidad. Nunca hay un euro en coma
 * flotante por el medio.
 */

import { Minus, Plus } from "lucide-react";
import type { Denominacion, LineaDenominacion } from "../types";
import { euros, totalLineas, totalPiezas } from "../utils/money";

export type CantidadesPorValor = Record<number, number>;

export function lineasDesde(cantidades: CantidadesPorValor): LineaDenominacion[] {
  return Object.entries(cantidades)
    .map(([valor, cantidad]) => ({ valor: Number(valor), cantidad }))
    .filter((l) => l.cantidad > 0)
    .sort((a, b) => b.valor - a.valor);
}

export function cantidadesDesde(lineas: readonly LineaDenominacion[]): CantidadesPorValor {
  const c: CantidadesPorValor = {};
  for (const l of lineas) c[l.valor] = (c[l.valor] ?? 0) + l.cantidad;
  return c;
}

type Props = {
  denominaciones: Denominacion[];
  cantidades: CantidadesPorValor;
  onChange: (cantidades: CantidadesPorValor) => void;
  /** Tope por denominación: el stock disponible. Sin esto no hay límite. */
  disponible?: Record<number, number>;
  /** Muestra la columna "disponible" — útil al sacar dinero, ruido al meterlo. */
  mostrarDisponible?: boolean;
  /** Columna extra para contar cartuchos (solo arqueo). */
  cartuchos?: CantidadesPorValor;
  onCartuchosChange?: (cartuchos: CantidadesPorValor) => void;
  /** Columna extra para contar bolsas; solo sale si el catálogo las tiene. */
  bolsas?: CantidadesPorValor;
  onBolsasChange?: (bolsas: CantidadesPorValor) => void;
  titulo?: string;
  /** Importe que deberían sumar las piezas; pinta el total en verde o rojo. */
  objetivoCentimos?: number | null;
  compacto?: boolean;
  deshabilitado?: boolean;
};

export default function DenominationGrid({
  denominaciones,
  cantidades,
  onChange,
  disponible,
  mostrarDisponible = false,
  cartuchos,
  onCartuchosChange,
  bolsas,
  onBolsasChange,
  titulo,
  objetivoCentimos = null,
  compacto = false,
  deshabilitado = false,
}: Props) {
  const lineas = lineasDesde(cantidades);
  const total = totalLineas(lineas) + valorEnvasado(cartuchos, "cartucho") + valorEnvasado(bolsas, "bolsa");
  const piezas = totalPiezas(lineas) + piezasEnvasadas(cartuchos, "cartucho") + piezasEnvasadas(bolsas, "bolsa");

  /** Piezas que hay dentro de un envase de esta denominación. */
  function porEnvase(d: Denominacion, envase: "cartucho" | "bolsa"): number | null {
    return envase === "cartucho" ? d.piezasPorCartucho : d.piezasPorBolsa;
  }

  function piezasEnvasadas(
    envases: CantidadesPorValor | undefined,
    envase: "cartucho" | "bolsa"
  ): number {
    if (!envases) return 0;
    return denominaciones.reduce((a, d) => {
      const n = porEnvase(d, envase);
      return a + (n ? (envases[d.valor] ?? 0) * n : 0);
    }, 0);
  }

  function valorEnvasado(
    envases: CantidadesPorValor | undefined,
    envase: "cartucho" | "bolsa"
  ): number {
    if (!envases) return 0;
    return denominaciones.reduce((a, d) => {
      const n = porEnvase(d, envase);
      return a + (n ? (envases[d.valor] ?? 0) * n * d.valor : 0);
    }, 0);
  }

  function fijar(valor: number, cantidad: number) {
    if (deshabilitado) return;
    const tope = disponible?.[valor];
    // El tope se aplica aquí y también en el servidor. Aquí es para que el
    // operador vea al momento que no puede sacar lo que no hay; la que manda es
    // la del servidor, con la jornada bloqueada.
    const limitada = Math.max(0, tope != null ? Math.min(cantidad, tope) : cantidad);
    onChange({ ...cantidades, [valor]: limitada });
  }

  function fijarCartuchos(valor: number, cantidad: number) {
    if (deshabilitado || !onCartuchosChange) return;
    onCartuchosChange({ ...(cartuchos ?? {}), [valor]: Math.max(0, cantidad) });
  }

  function fijarBolsas(valor: number, cantidad: number) {
    if (deshabilitado || !onBolsasChange) return;
    onBolsasChange({ ...(bolsas ?? {}), [valor]: Math.max(0, cantidad) });
  }

  const billetes = denominaciones.filter((d) => d.tipo === "BILLETE");
  const monedas = denominaciones.filter((d) => d.tipo === "MONEDA");

  const cuadra = objetivoCentimos == null ? null : total === objetivoCentimos;

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-800">
      {titulo && (
        <div className="border-b border-slate-700 px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-slate-400">
          {titulo}
        </div>
      )}

      <div className={`grid gap-4 p-3 ${compacto ? "" : "sm:grid-cols-2"}`}>
        <Grupo
          etiqueta="Billetes"
          denominaciones={billetes}
          cantidades={cantidades}
          disponible={disponible}
          mostrarDisponible={mostrarDisponible}
          fijar={fijar}
          deshabilitado={deshabilitado}
        />
        <Grupo
          etiqueta="Monedas"
          denominaciones={monedas}
          cantidades={cantidades}
          disponible={disponible}
          mostrarDisponible={mostrarDisponible}
          fijar={fijar}
          deshabilitado={deshabilitado}
          cartuchos={cartuchos}
          fijarCartuchos={onCartuchosChange ? fijarCartuchos : undefined}
          bolsas={bolsas}
          fijarBolsas={onBolsasChange ? fijarBolsas : undefined}
        />
      </div>

      <div
        className={`flex items-center justify-between gap-3 border-t px-3 py-2 ${
          cuadra === null
            ? "border-slate-700"
            : cuadra
              ? "border-emerald-600 bg-emerald-950/30"
              : "border-amber-600 bg-amber-950/20"
        }`}
      >
        <div className="text-[11px] uppercase tracking-wide text-slate-400">
          {piezas} {piezas === 1 ? "pieza" : "piezas"}
        </div>
        <div className="flex items-baseline gap-3">
          {objetivoCentimos != null && (
            <span className="text-[11px] text-slate-400">
              objetivo {euros(objetivoCentimos)}
            </span>
          )}
          <span
            className={`text-xl font-black tabular-nums ${
              cuadra === null ? "text-slate-100" : cuadra ? "text-emerald-400" : "text-amber-300"
            }`}
          >
            {euros(total)}
          </span>
        </div>
      </div>
    </div>
  );
}

function Grupo({
  etiqueta,
  denominaciones,
  cantidades,
  disponible,
  mostrarDisponible,
  fijar,
  deshabilitado,
  cartuchos,
  fijarCartuchos,
  bolsas,
  fijarBolsas,
}: {
  etiqueta: string;
  denominaciones: Denominacion[];
  cantidades: CantidadesPorValor;
  disponible?: Record<number, number>;
  mostrarDisponible: boolean;
  fijar: (valor: number, cantidad: number) => void;
  deshabilitado: boolean;
  cartuchos?: CantidadesPorValor;
  fijarCartuchos?: (valor: number, cantidad: number) => void;
  bolsas?: CantidadesPorValor;
  fijarBolsas?: (valor: number, cantidad: number) => void;
}) {
  if (denominaciones.length === 0) return null;

  // Existencias y cartuchos ocupan el hueco del subtotal. Con cualquiera de los
  // dos la fila ya no da de sí, y antes que encoger un importe hasta cortarlo
  // se prescinde de él: el total de la rejilla sigue abajo, entero.
  const hayColumnaExtra = mostrarDisponible || Boolean(fijarCartuchos) || Boolean(fijarBolsas);

  return (
    <div>
      <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-slate-500">
        {etiqueta}
      </div>
      <div className="flex flex-col gap-1">
        {denominaciones.map((d) => {
          const cantidad = cantidades[d.valor] ?? 0;
          const tope = disponible?.[d.valor];
          const subtotal = cantidad * d.valor;
          const sinExistencias = mostrarDisponible && (tope ?? 0) === 0;

          return (
            <div
              key={d.valor}
              className={`flex items-center gap-1.5 overflow-hidden rounded-lg px-1.5 py-1 ${
                cantidad > 0 ? "bg-slate-900/70" : ""
              } ${sinExistencias ? "opacity-40" : ""}`}
            >
              <div className="w-14 shrink-0 text-sm font-bold tabular-nums text-slate-200">
                {d.etiqueta}
              </div>

              {mostrarDisponible && (
                <div className="w-10 shrink-0 text-right text-[10px] tabular-nums text-slate-500">
                  {tope ?? 0}
                </div>
              )}

              <button
                type="button"
                aria-label={`Quitar una pieza de ${d.etiqueta}`}
                onClick={() => fijar(d.valor, cantidad - 1)}
                disabled={deshabilitado || cantidad === 0}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-slate-700 text-slate-200 hover:bg-slate-600 disabled:opacity-30"
              >
                <Minus className="h-4 w-4" />
              </button>

              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                aria-label={`Cantidad de ${d.etiqueta}`}
                value={cantidad === 0 ? "" : String(cantidad)}
                placeholder="0"
                onChange={(e) => {
                  const n = e.target.value.replace(/\D/g, "");
                  fijar(d.valor, n === "" ? 0 : Number(n));
                }}
                onFocus={(e) => e.target.select()}
                disabled={deshabilitado}
                className="h-11 w-12 shrink-0 rounded-lg border border-slate-600 bg-slate-900 text-center text-sm font-bold tabular-nums text-slate-100 outline-none focus:ring-2 focus:ring-sky-500 disabled:opacity-50"
              />

              <button
                type="button"
                aria-label={`Añadir una pieza de ${d.etiqueta}`}
                onClick={() => fijar(d.valor, cantidad + 1)}
                disabled={deshabilitado || (tope != null && cantidad >= tope)}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-slate-700 text-slate-200 hover:bg-slate-600 disabled:opacity-30"
              >
                <Plus className="h-4 w-4" />
              </button>

              {fijarCartuchos && d.piezasPorCartucho != null && (
                <CampoEnvase
                  etiqueta={d.etiqueta}
                  nombre="Cartuchos"
                  abreviatura="cart."
                  piezas={d.piezasPorCartucho}
                  valor={cartuchos?.[d.valor] ?? 0}
                  onChange={(n) => fijarCartuchos(d.valor, n)}
                  deshabilitado={deshabilitado}
                />
              )}

              {fijarBolsas && d.piezasPorBolsa != null && (
                <CampoEnvase
                  etiqueta={d.etiqueta}
                  nombre="Bolsas"
                  abreviatura="bols."
                  piezas={d.piezasPorBolsa}
                  valor={bolsas?.[d.valor] ?? 0}
                  onChange={(n) => fijarBolsas(d.valor, n)}
                  deshabilitado={deshabilitado}
                />
              )}

              {/*
                El subtotal y la columna de existencias se disputan el mismo
                hueco: con las dos a la vez la fila no cabe y el importe se
                solapaba con la columna de al lado. Cuando se enseñan las
                existencias —sacar dinero— manda saber cuántas piezas hay; el
                importe de la línea se deduce y el total va abajo.
              */}
              {!hayColumnaExtra && (
                <div className="ml-auto whitespace-nowrap text-right text-xs tabular-nums text-slate-400">
                  {subtotal > 0 ? euros(subtotal) : ""}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Contador de envases precintados.
 *
 * Cartuchos y bolsas se cuentan igual —cuántos precintos, no cuántas monedas—
 * así que comparten campo: si mañana aparece un tercer formato, se añade aquí y
 * no en dos sitios que se van separando poco a poco.
 */
function CampoEnvase({
  etiqueta,
  nombre,
  abreviatura,
  piezas,
  valor,
  onChange,
  deshabilitado,
}: {
  etiqueta: string;
  nombre: string;
  abreviatura: string;
  piezas: number;
  valor: number;
  onChange: (n: number) => void;
  deshabilitado: boolean;
}) {
  return (
    <input
      type="text"
      inputMode="numeric"
      pattern="[0-9]*"
      aria-label={`${nombre} de ${etiqueta} (${piezas} piezas)`}
      title={`${nombre} de ${piezas} piezas`}
      value={valor === 0 ? "" : String(valor)}
      placeholder={abreviatura}
      onChange={(e) => {
        const n = e.target.value.replace(/\D/g, "");
        onChange(n === "" ? 0 : Number(n));
      }}
      onFocus={(e) => e.target.select()}
      disabled={deshabilitado}
      className="h-11 w-12 shrink-0 rounded-lg border border-slate-600 bg-slate-900 text-center text-xs tabular-nums text-slate-100 placeholder:text-slate-600 outline-none focus:ring-2 focus:ring-sky-500"
    />
  );
}
