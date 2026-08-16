/**
 * Invariantes de una operación de caja.
 *
 * Este fichero es el único sitio donde se decide si una operación es válida.
 * Da igual que venga de una factura de la ERP o de un alta manual en el
 * mostrador: para cuando llega aquí ya es una `OperacionNormalizada` y se
 * comprueba exactamente igual. Ese es el punto de "un solo motor": la ERP
 * decide QUÉ hay que cobrar, Mobilink Cash decide y registra CÓMO se ha
 * cobrado, y el cómo se valida en un único lugar.
 *
 * La regla que lo gobierna todo: no existe movimiento de efectivo sin su
 * detalle de piezas. Un `+187 €` suelto no se puede representar en este modelo.
 */

import { type Centimos, sumar } from "./money.ts";
import {
  type Inventario,
  type LineaDenominacion,
  faltantes,
  inventarioDesdeLineas,
  totalInventario,
} from "./inventory.ts";

// ── Vocabulario ────────────────────────────────────────────────────────────

/** Qué se está haciendo. Decide el signo del efectivo y quién puede hacerlo. */
export type TipoOperacion =
  | "COLLECTION" // cobro a un cliente
  | "PAYMENT" // pago a un proveedor
  | "MANUAL_IN" // ingreso manual de efectivo
  | "MANUAL_OUT" // salida manual de efectivo
  | "CASH_DELIVERY" // entrega/retirada intermedia
  | "BANK_DEPOSIT" // ingreso en el banco
  | "ADJUSTMENT" // ajuste auditado
  | "OPENING_FLOAT" // fondo inicial de la jornada
  | "CLOSING_FLOAT"; // cambio que se deja para el día siguiente

/** De dónde salió la operación. El motor se comporta igual con todos. */
export type OrigenOperacion = "MANUAL" | "ERP" | "API" | "IMPORT" | "POS" | "OTHER";

/**
 * Forma de pago: el CÓDIGO de una fila del catálogo (`cash_payment_methods`),
 * que cada empresa administra desde Configuración. Es texto libre y no una
 * unión cerrada porque el catálogo se amplía sin tocar el código.
 *
 * Lo único que el motor necesita saber de una forma de pago es si mueve el
 * cajón físico, y eso no se deduce del código: se consulta al catálogo. De ahí
 * que las funciones de aquí reciban el conjunto de códigos que son efectivo en
 * vez de compararlo con la constante `CASH`.
 */
export type FormaPago = string;

/** Código reservado del efectivo. Es la única forma que mueve piezas. */
export const CODIGO_EFECTIVO = "CASH";

export const CODIGOS_EFECTIVO_POR_DEFECTO: ReadonlySet<string> = new Set([CODIGO_EFECTIVO]);

export type FormaPagoSemilla = {
  codigo: string;
  nombre: string;
  afectaEfectivo: boolean;
  /** Sin referencia no se puede cobrar: el número de autorización del TPV. */
  pideReferencia: boolean;
  orden: number;
};

/**
 * Catálogo de partida. Son los códigos que ya viven en
 * `cash_operation_payments.forma_pago`, así que el histórico conserva su
 * etiqueta. El efectivo no pide referencia; las demás sí, que es de lo que
 * luego se tira para cuadrar con el banco.
 */
export const FORMAS_PAGO_SEMILLA: readonly FormaPagoSemilla[] = [
  { codigo: "CASH", nombre: "Efectivo", afectaEfectivo: true, pideReferencia: false, orden: 10 },
  { codigo: "BBVA_CARD", nombre: "TPV BBVA", afectaEfectivo: false, pideReferencia: true, orden: 20 },
  { codigo: "CAIXABANK_CARD", nombre: "TPV CaixaBank", afectaEfectivo: false, pideReferencia: true, orden: 30 },
  { codigo: "AMEX", nombre: "American Express", afectaEfectivo: false, pideReferencia: true, orden: 40 },
  { codigo: "BANK_TRANSFER", nombre: "Transferencia", afectaEfectivo: false, pideReferencia: true, orden: 50 },
  { codigo: "BIZUM", nombre: "Bizum", afectaEfectivo: false, pideReferencia: true, orden: 60 },
  { codigo: "OTHER", nombre: "Otra", afectaEfectivo: false, pideReferencia: true, orden: 70 },
];

export function afectaAlEfectivo(
  forma: FormaPago,
  codigosEfectivo: ReadonlySet<string> = CODIGOS_EFECTIVO_POR_DEFECTO
): boolean {
  return codigosEfectivo.has(forma);
}

/** Motivo del movimiento de piezas: por qué entró o salió este billete. */
export type MotivoMovimiento =
  | "OPENING_FLOAT"
  | "CUSTOMER_PAYMENT"
  | "CHANGE_GIVEN"
  | "SUPPLIER_PAYMENT"
  | "MANUAL_IN"
  | "MANUAL_OUT"
  | "CASH_DELIVERY"
  | "BANK_DEPOSIT"
  | "ADJUSTMENT"
  | "CLOSING_FLOAT"
  /** Apertura de un cartucho: sale el tubo y entran sus monedas sueltas. */
  | "CARTRIDGE_OPENED";

export type Direccion = "IN" | "OUT";

/**
 * Línea de un asiento. `cantidad` son SIEMPRE piezas; `cartuchos` dice cuántos
 * tubos precintados representan esas piezas (0 = monedas sueltas).
 */
export type LineaMovimiento = LineaDenominacion & { cartuchos?: number };

/** Movimiento de piezas ya resuelto, listo para escribir en el libro mayor. */
export type MovimientoDenominacion = {
  direccion: Direccion;
  motivo: MotivoMovimiento;
  lineas: LineaMovimiento[];
};

// ── Entrada normalizada ────────────────────────────────────────────────────

export type LineaFormaPago = {
  forma: FormaPago;
  importe: Centimos;
  referencia?: string | null;
};

/**
 * Lo que el motor recibe, venga de donde venga.
 *
 * `efectivoRecibido` y `cambioEntregado` solo tienen sentido en cobros; en los
 * pagos y salidas se usa `efectivoEntregado`. Se mantienen separados en lugar
 * de un único campo con signo porque en un cobro entran y salen piezas a la vez
 * y hay que registrar las dos cosas.
 */
export type OperacionNormalizada = {
  tipo: TipoOperacion;
  origen: OrigenOperacion;
  /** Importe total del documento u operación. */
  importe: Centimos;
  /** Desglose por forma de pago. En una operación mixta hay más de una línea. */
  formasPago: LineaFormaPago[];
  /**
   * Piezas que entrega el cliente (cobros) o que entran en caja.
   *
   * Una línea puede venir marcada como cartucho (`cartuchos > 0`), y entonces
   * `cantidad` son las monedas que trae el tubo. El invariante de importe se
   * comprueba igual —las monedas son monedas— y la marca viaja intacta hasta el
   * asiento, que es lo que permite que un tubo entre y salga precintado.
   */
  efectivoRecibido?: readonly LineaMovimiento[];
  /** Piezas que salen de caja: cambio de un cobro, o el pago entero. */
  efectivoEntregado?: readonly LineaMovimiento[];
  /**
   * El efectivo de esta operación YA salió con una entrega de dinero a una
   * persona, y esto es la factura que la liquida.
   *
   * Es la única excepción a "todo efectivo lleva su detalle de piezas", y no la
   * rompe: las piezas existen y están asentadas, solo que en la entrega. Sin
   * esto, registrar el pago de 40 € de la compra sacaría de la caja unas piezas
   * que ya salieron cuando se le dieron 50 € al empleado, y el cajón acabaría
   * con 90 € de menos habiendo salido 50.
   */
  liquidaEntregaId?: number;
};

export type ResultadoValidacion =
  | { ok: true; movimientos: MovimientoDenominacion[]; efectivoNeto: Centimos }
  | { ok: false; codigo: CodigoErrorOperacion; mensaje: string };

export type CodigoErrorOperacion =
  | "IMPORTE_NO_VALIDO"
  | "FORMAS_PAGO_NO_CUADRAN"
  | "EFECTIVO_NO_CUADRA"
  | "CAMBIO_SUPERA_ENTREGADO"
  | "STOCK_INSUFICIENTE"
  | "FALTA_DETALLE_DENOMINACIONES"
  | "TIPO_NO_SOPORTADO";

// ── Validación ─────────────────────────────────────────────────────────────

/** Tipos cuyo efectivo entra en la caja. */
const ENTRAN: ReadonlySet<TipoOperacion> = new Set<TipoOperacion>([
  "COLLECTION",
  "MANUAL_IN",
  "OPENING_FLOAT",
]);

/** Tipos cuyo efectivo sale de la caja. */
const SALEN: ReadonlySet<TipoOperacion> = new Set<TipoOperacion>([
  "PAYMENT",
  "MANUAL_OUT",
  "CASH_DELIVERY",
  "BANK_DEPOSIT",
  "CLOSING_FLOAT",
]);

const MOTIVO_ENTRADA: Record<string, MotivoMovimiento> = {
  COLLECTION: "CUSTOMER_PAYMENT",
  MANUAL_IN: "MANUAL_IN",
  OPENING_FLOAT: "OPENING_FLOAT",
  ADJUSTMENT: "ADJUSTMENT",
};

const MOTIVO_SALIDA: Record<string, MotivoMovimiento> = {
  COLLECTION: "CHANGE_GIVEN",
  PAYMENT: "SUPPLIER_PAYMENT",
  MANUAL_OUT: "MANUAL_OUT",
  CASH_DELIVERY: "CASH_DELIVERY",
  BANK_DEPOSIT: "BANK_DEPOSIT",
  CLOSING_FLOAT: "CLOSING_FLOAT",
  ADJUSTMENT: "ADJUSTMENT",
};

/** Importe de la operación que se paga en efectivo. */
export function importeEnEfectivo(
  formasPago: readonly LineaFormaPago[],
  codigosEfectivo: ReadonlySet<string> = CODIGOS_EFECTIVO_POR_DEFECTO
): Centimos {
  return sumar(
    ...formasPago.filter((f) => afectaAlEfectivo(f.forma, codigosEfectivo)).map((f) => f.importe)
  );
}

/**
 * Comprueba una operación completa contra el stock actual y devuelve los
 * movimientos de piezas que hay que asentar.
 *
 * No escribe nada: decide. Quien persiste es el servicio, y lo hace dentro de
 * una transacción que vuelve a validar contra el stock bloqueado — esto de aquí
 * es la regla de negocio, no la última palabra sobre concurrencia.
 *
 * `codigosEfectivo` viene del catálogo de la empresa. Sin él se asume el código
 * reservado `CASH`, que es lo que sembramos: así los tests del motor siguen
 * siendo puros y quien llama de verdad —el servicio— pasa el catálogo real.
 */
export function validarOperacion(
  op: OperacionNormalizada,
  stock: Inventario,
  codigosEfectivo: ReadonlySet<string> = CODIGOS_EFECTIVO_POR_DEFECTO
): ResultadoValidacion {
  if (!Number.isSafeInteger(op.importe) || op.importe <= 0) {
    return { ok: false, codigo: "IMPORTE_NO_VALIDO", mensaje: "El importe de la operación debe ser un número entero de céntimos mayor que cero." };
  }

  if (!ENTRAN.has(op.tipo) && !SALEN.has(op.tipo) && op.tipo !== "ADJUSTMENT") {
    return { ok: false, codigo: "TIPO_NO_SOPORTADO", mensaje: `Tipo de operación no soportado: ${op.tipo}.` };
  }

  // 1. Las formas de pago tienen que sumar el importe del documento. Es lo que
  //    permite el cobro mixto (100 € en efectivo + 200 € con tarjeta = 300 €).
  const totalFormas = sumar(...op.formasPago.map((f) => f.importe));
  if (op.formasPago.some((f) => !Number.isSafeInteger(f.importe) || f.importe <= 0)) {
    return { ok: false, codigo: "IMPORTE_NO_VALIDO", mensaje: "Cada forma de pago debe llevar un importe entero mayor que cero." };
  }
  if (totalFormas !== op.importe) {
    return {
      ok: false,
      codigo: "FORMAS_PAGO_NO_CUADRAN",
      mensaje: `Las formas de pago suman ${totalFormas} céntimos y el importe de la operación es ${op.importe}.`,
    };
  }

  const efectivo = importeEnEfectivo(op.formasPago, codigosEfectivo);
  const recibido = inventarioDesdeLineas(op.efectivoRecibido ?? []);
  const entregado = inventarioDesdeLineas(op.efectivoEntregado ?? []);
  const totalRecibido = totalInventario(recibido);
  const totalEntregado = totalInventario(entregado);

  // 2. Si no hay parte en efectivo, no puede haber piezas. Una operación con
  //    tarjeta que mueva billetes es un error de quien la construyó.
  if (efectivo === 0) {
    if (totalRecibido !== 0 || totalEntregado !== 0) {
      return {
        ok: false,
        codigo: "EFECTIVO_NO_CUADRA",
        mensaje: "La operación no tiene parte en efectivo, así que no puede mover monedas ni billetes.",
      };
    }
    return { ok: true, movimientos: [], efectivoNeto: 0 };
  }

  // 3. Con parte en efectivo tiene que haber detalle de piezas. Ésta es la
  //    regla que impide que se cuele un "+187 €" sin composición.
  const entraEfectivo = ENTRAN.has(op.tipo);

  /*
   * Salvo que sea la liquidación de una entrega: ahí las piezas salieron
   * cuando se le dio el dinero a la persona, y este documento solo pone la
   * factura. Asentar piezas otra vez descuadraría la caja por el importe
   * entregado.
   */
  if (op.liquidaEntregaId != null) {
    if (totalRecibido !== 0 || totalEntregado !== 0) {
      return {
        ok: false,
        codigo: "EFECTIVO_NO_CUADRA",
        mensaje:
          "La liquidación de una entrega no mueve piezas: ya salieron al entregar el dinero.",
      };
    }
    return { ok: true, movimientos: [], efectivoNeto: 0 };
  }

  if (entraEfectivo && totalRecibido === 0) {
    return {
      ok: false,
      codigo: "FALTA_DETALLE_DENOMINACIONES",
      mensaje: "Hay que indicar exactamente qué monedas y billetes se reciben.",
    };
  }
  if (!entraEfectivo && totalEntregado === 0) {
    return {
      ok: false,
      codigo: "FALTA_DETALLE_DENOMINACIONES",
      mensaje: "Hay que indicar exactamente qué monedas y billetes salen de la caja.",
    };
  }

  // 4. El cuadre del efectivo: recibido − entregado = parte en efectivo.
  //    En un cobro de 187 € con 205 € entregados y 18 € de cambio: 205−18=187.
  //    En un pago no entra nada, así que 0−127 = −127 y el efectivo esperado es
  //    también negativo desde el punto de vista de la caja.
  const neto = totalRecibido - totalEntregado;
  const netoEsperado = entraEfectivo ? efectivo : -efectivo;

  if (entraEfectivo && totalEntregado > totalRecibido) {
    return {
      ok: false,
      codigo: "CAMBIO_SUPERA_ENTREGADO",
      mensaje: "El cambio no puede ser mayor que el efectivo recibido.",
    };
  }

  if (neto !== netoEsperado) {
    return {
      ok: false,
      codigo: "EFECTIVO_NO_CUADRA",
      mensaje: entraEfectivo
        ? `Recibido ${totalRecibido} − cambio ${totalEntregado} = ${neto} céntimos, y la parte en efectivo de la operación es ${efectivo}.`
        : `Las piezas que salen suman ${totalEntregado} céntimos y el pago en efectivo es de ${efectivo}.`,
    };
  }

  // 5. Disponibilidad. En un cobro el cambio puede salir de lo que el cliente
  //    acaba de entregar, así que se valida contra el stock MÁS lo recibido:
  //    devolver un billete de 100 € que el cliente acaba de dar es legítimo.
  const disponible = entraEfectivo ? sumarStock(stock, recibido) : stock;
  const falta = faltantes(disponible, entregado);
  if (falta.length > 0) {
    const p = falta[0];
    return {
      ok: false,
      codigo: "STOCK_INSUFICIENTE",
      mensaje: `No hay suficientes piezas de ${p.valor} céntimos: se necesitan ${p.pedido} y hay ${p.disponible}.`,
    };
  }

  // 6. Movimientos a asentar. Se guardan por separado la entrada y la salida:
  //    el libro mayor tiene que reflejar que entraron dos billetes de 100 € y
  //    salieron cuatro piezas de cambio, no un neto de 187 €.
  const movimientos: MovimientoDenominacion[] = [];
  if (totalRecibido > 0) {
    movimientos.push({
      direccion: "IN",
      motivo: MOTIVO_ENTRADA[op.tipo] ?? "MANUAL_IN",
      lineas: ordenar(op.efectivoRecibido ?? []),
    });
  }
  if (totalEntregado > 0) {
    movimientos.push({
      direccion: "OUT",
      motivo: MOTIVO_SALIDA[op.tipo] ?? "MANUAL_OUT",
      lineas: ordenar(op.efectivoEntregado ?? []),
    });
  }

  return { ok: true, movimientos, efectivoNeto: neto };
}

function sumarStock(a: Inventario, b: Inventario): Inventario {
  const m = new Map(a);
  for (const [valor, cantidad] of b) m.set(valor, (m.get(valor) ?? 0) + cantidad);
  return m;
}

/**
 * Ordena de mayor a menor SIN fusionar líneas: una de monedas sueltas y otra de
 * un cartucho del mismo valor son dos asientos distintos, y juntarlas perdería
 * el formato.
 */
function ordenar(lineas: readonly LineaMovimiento[]): LineaMovimiento[] {
  return [...lineas].filter((l) => l.cantidad > 0).sort((a, b) => b.valor - a.valor);
}

/**
 * Aplica movimientos ya validados a un inventario. Es la función con la que se
 * reconstruye el stock teórico a partir del libro mayor.
 */
export function aplicarMovimientos(
  inicial: Inventario,
  movimientos: readonly MovimientoDenominacion[]
): Inventario {
  const m = new Map(inicial);
  for (const mov of movimientos) {
    const signo = mov.direccion === "IN" ? 1 : -1;
    for (const l of mov.lineas) {
      const total = (m.get(l.valor) ?? 0) + signo * l.cantidad;
      if (total === 0) m.delete(l.valor);
      else m.set(l.valor, total);
    }
  }
  return m;
}
