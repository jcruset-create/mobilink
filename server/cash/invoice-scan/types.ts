/**
 * Los tipos que se pasan entre las piezas del escaneo.
 *
 * Hay dos formas del mismo dato y conviene no confundirlas nunca:
 *
 * - `ExtraccionCruda` es lo que dice el modelo: TEXTO, tal y como está impreso
 *   en el papel. Es evidencia. Se guarda entera para poder auditar.
 * - `ExtraccionNormalizada` es lo que entiende la caja: céntimos, fechas ISO,
 *   matrículas. Es el resultado de pasar la evidencia por `normalize.ts`.
 *
 * Nada de lo que viene del modelo entra en la aplicación sin pasar por la
 * segunda, y la segunda no la escribe el modelo.
 */

import type { Centimos } from "../domain/money.ts";
import type { PlantillaRecibo, PropuestaFormaCobro } from "./classifier.ts";
import type { CobroPrevio } from "../duplicates.ts";

/** Lo que devuelve el modelo. Todo texto, todo opcional, nada calculado. */
export type ExtraccionCruda = {
  es_factura: boolean;
  facturas_detectadas: number;
  factura: {
    numero: string | null;
    fecha: string | null;
  };
  cliente: {
    codigo: string | null;
    nombre: string | null;
    nif: string | null;
  };
  vehiculo: {
    marca: string | null;
    modelo: string | null;
    matricula: string | null;
  };
  concepto: string | null;
  totales: {
    base_imponible: string | null;
    iva_importe: string | null;
    iva_porcentaje: string | null;
    total: string | null;
    moneda: string | null;
  };
  recibo: {
    detectado: boolean;
    recibos_detectados: number;
    plantilla: PlantillaRecibo;
    importe: string | null;
    tipo_operacion: string | null;
    tarjeta: string | null;
    num_operacion: string | null;
    cod_autorizacion: string | null;
    comercio: string | null;
    terminal: string | null;
    red: string | null;
    adquirente: string | null;
    cuenta: string | null;
    fecha_hora: string | null;
    texto: string | null;
  };
  confianza: {
    numero_factura: number;
    cliente: number;
    total: number;
    concepto: number;
    recibo: number;
  };
};

/** Lo mismo, ya en los tipos de la caja. */
export type ExtraccionNormalizada = {
  esFactura: boolean;
  facturasDetectadas: number;
  numeroFactura: string | null;
  fecha: string | null;
  cliente: { codigo: string | null; nombre: string | null; nif: string | null };
  vehiculo: { marca: string | null; modelo: string | null; matricula: string | null };
  concepto: string | null;
  totales: {
    baseCentimos: Centimos | null;
    ivaCentimos: Centimos | null;
    ivaPorcentaje: string | null;
    totalCentimos: Centimos | null;
    moneda: string | null;
  };
  recibo: {
    detectado: boolean;
    recibosDetectados: number;
    plantilla: PlantillaRecibo;
    importeCentimos: Centimos | null;
    tipoOperacion: string | null;
    /** SOLO los cuatro últimos. El número entero no entra en la aplicación. */
    tarjetaUltimos4: string | null;
    numOperacion: string | null;
    codAutorizacion: string | null;
    comercio: string | null;
    terminal: string | null;
    red: string | null;
    adquirente: string | null;
    cuenta: string | null;
    fechaHora: string | null;
    texto: string | null;
  };
  confianza: {
    numeroFactura: number;
    cliente: number;
    total: number;
    concepto: number;
    recibo: number;
  };
};

/** Un campo del formulario, con lo que se sabe de él. */
export type CampoPropuesto<T> = {
  valor: T;
  confianza: number;
  /**
   * - `RELLENAR`: se pone en el formulario sin más.
   * - `REVISAR`: se pone, pero marcado para que alguien lo mire.
   * - `VACIO`: no se pone nada; o no se ha leído, o no merece la pena.
   */
  estado: "RELLENAR" | "REVISAR" | "VACIO";
};

export type CodigoAviso =
  | "NO_ES_FACTURA"
  | "VARIAS_FACTURAS"
  | "VARIOS_RECIBOS"
  | "SIN_NUMERO_FACTURA"
  | "SIN_TOTAL"
  | "SIN_EVIDENCIA_DE_PAGO"
  | "PAYMENT_AMOUNT_MISMATCH"
  | "TOTALES_NO_CUADRAN"
  | "POSIBLE_DUPLICADO";

export type Aviso = {
  codigo: CodigoAviso;
  /** Escrito para el mostrador, no para el log. */
  mensaje: string;
  /** Grave = hay que mirarlo antes de seguir. */
  grave: boolean;
};

/** Lo que se le devuelve a la pantalla: una PROPUESTA, nunca un cobro. */
export type PropuestaCobro = {
  referencia: CampoPropuesto<string | null>;
  importeCentimos: CampoPropuesto<Centimos | null>;
  cliente: CampoPropuesto<string | null>;
  concepto: CampoPropuesto<string | null>;
  formaCobro: PropuestaFormaCobro;
  /** null = no hay recibo con el que comparar. */
  importeCuadra: boolean | null;
  avisos: Aviso[];
  /**
   * El cobro que ya existe de esta misma factura, si lo hay.
   *
   * Va aparte del aviso a propósito: un texto sirve para leerlo, pero la
   * pantalla necesita DATOS para decidir qué botón enseña, y el servidor los
   * necesita para explicar de qué cobro estamos hablando. `null` = no consta
   * cobrada.
   */
  cobroPrevio: CobroPrevio | null;
  /** Para el histórico y la auditoría, no para la pantalla. */
  extra: ExtraccionNormalizada;
};
