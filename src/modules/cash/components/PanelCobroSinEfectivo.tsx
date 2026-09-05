/**
 * El lateral de un cobro que NO mueve el cajón.
 *
 * Cuando se cobra con tarjeta o por transferencia no hay billetes que contar
 * ni cambio que dar, y el panel de monedas ahí no solo sobra: confunde. Lo
 * que hace falta ver es lo que permitirá conciliar después con el banco —el
 * proveedor, los cuatro últimos de la tarjeta, el número de operación— y si
 * el justificante cuadra con la factura.
 *
 * Es UNO para todas las formas y no uno por banco. Lo único que cambia entre
 * ClearOne, CaixaBank o BBVA es el nombre y el logotipo, que ya vienen del
 * catálogo de la empresa; hacer un componente por cada uno sería copiar el
 * mismo fichero cinco veces y tener que tocarlos los cinco cada vez.
 */

import { euros } from "../utils/money";
import type { FormaPagoConfig, PropuestaEscaneo } from "../types";

/** Un dato del justificante, con su rótulo. Se calla si no hay valor. */
function Dato({ etiqueta, valor }: { etiqueta: string; valor: string | null | undefined }) {
  if (!valor) return null;
  return (
    <div className="flex items-baseline justify-between gap-3 text-[12px]">
      <span className="text-slate-400">{etiqueta}</span>
      <span className="font-bold tabular-nums text-slate-200">{valor}</span>
    </div>
  );
}

export default function PanelCobroSinEfectivo({
  forma,
  importeCentimos,
  referencia,
  escaneo,
  elegidaPorElEscaner,
}: {
  forma: FormaPagoConfig;
  importeCentimos: number;
  /** La referencia que se va a guardar con el cobro. */
  referencia: string;
  /** El análisis de la factura, si se escaneó una. */
  escaneo: PropuestaEscaneo | null;
  /** true = la marcó el escáner y nadie la ha corregido. */
  elegidaPorElEscaner: boolean;
}) {
  const recibo = escaneo?.extra.recibo;
  /*
   * Los datos del justificante solo se enseñan si el justificante es de ESTA
   * forma de cobro. Si alguien corrigió la propuesta —el escáner decía
   * CaixaBank y era BBVA—, pintar debajo la tarjeta y la operación del recibo
   * de CaixaBank sería dar por buena la lectura que se acaba de descartar.
   */
  const delMismoCobro = elegidaPorElEscaner && recibo?.detectado;

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-800/60 p-4">
      <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
        Cobro sin efectivo
      </div>

      <div className="mt-2 flex items-center gap-3">
        {forma.imagenUrl && (
          <img src={forma.imagenUrl} alt="" className="h-8 w-12 shrink-0 object-contain" />
        )}
        <span className="text-lg font-black text-slate-100">{forma.nombre}</span>
      </div>

      <div className="mt-3 flex items-baseline justify-between gap-3">
        <span className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
          Importe
        </span>
        <span className="text-2xl font-black tabular-nums text-slate-100">
          {euros(importeCentimos)}
        </span>
      </div>

      {delMismoCobro && (
        <div className="mt-3 space-y-1 border-t border-slate-700 pt-2">
          <Dato
            etiqueta="Tarjeta"
            valor={recibo.tarjetaUltimos4 ? `···· ${recibo.tarjetaUltimos4}` : null}
          />
          <Dato etiqueta="Operación" valor={recibo.numOperacion} />
          <Dato etiqueta="Autorización" valor={recibo.codAutorizacion} />
          <Dato etiqueta="Comercio" valor={recibo.comercio} />
          <Dato etiqueta="Fecha del justificante" valor={recibo.fechaHora} />
        </div>
      )}

      {referencia.trim() !== "" && (
        <div className="mt-1">
          <Dato etiqueta="Referencia" valor={referencia.trim()} />
        </div>
      )}

      {/*
        Si el importe del justificante cuadra con el de la factura. Es la
        comprobación que evita el error más caro de este flujo: cobrar 209,22 €
        con un resguardo de 22,93 € porque se escaneó la factura de al lado.
      */}
      {escaneo?.importeCuadra === true && (
        <p className="mt-2 text-[12px] font-bold text-emerald-300">
          ✓ El importe del justificante coincide con la factura
        </p>
      )}
      {escaneo?.importeCuadra === false && (
        <p className="mt-2 text-[12px] font-bold text-amber-300">
          El importe del justificante NO coincide con el de la factura. Mira cuál de los dos es el
          bueno antes de confirmar.
        </p>
      )}

      <p className="mt-2 text-[11px] text-slate-500">
        {elegidaPorElEscaner
          ? "Forma de cobro detectada en la factura. Si no es la correcta, elige otra a la izquierda."
          : "Forma de cobro elegida a mano."}
      </p>
    </div>
  );
}
