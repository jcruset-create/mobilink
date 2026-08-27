/**
 * De lo que dice el papel a lo que entiende la caja.
 *
 * El modelo devuelve EVIDENCIA: los textos tal y como están impresos en la
 * factura —«195,10 EUR», «27/08/2026», «************7394»—. Aquí se convierten
 * a los tipos con los que trabaja Mobilink Cash: céntimos enteros, fechas ISO,
 * matrículas normalizadas.
 *
 * La conversión vive AQUÍ y no en el prompt a propósito. Pedirle al modelo que
 * devuelva 19510 en vez de «195,10 €» es pedirle que haga aritmética, y una
 * aritmética equivocada no se ve: sale un número plausible. Un parser
 * equivocado, en cambio, se ve en un test. Es la misma línea que separa
 * extracción de decisión en todo este módulo.
 */

import type { Centimos } from "../domain/money.ts";
import { esCentimosValido } from "../domain/money.ts";
import type { EvidenciaCobro } from "./classifier.ts";
import type { ExtraccionCruda, ExtraccionNormalizada } from "./types.ts";

/**
 * Un importe TAL Y COMO SE IMPRIME en una factura española.
 *
 * No es el mismo trabajo que leer lo que teclea el operario, que es lo que
 * hace `aCentimos` en el dominio: aquí hay que aguantar el punto de los miles
 * —«1.234,56»—, el símbolo detrás —«22,93 EUR»— y los espacios que mete el
 * OCR.
 *
 * Se exigen DOS cifras cuando hay separador decimal, y los puntos de millar
 * cada tres. Eso descarta casi todo lo que no es un importe aunque lo parezca;
 * lo que de verdad evita confundir «Num.Operación : 179.307» con un importe es
 * que ese dato llega por un campo distinto del esquema, no por este.
 *
 * Y lo AMBIGUO se rechaza, aunque se pudiera adivinar. Dos casos reales:
 *
 * - «195 10», que es lo que deja un OCR que se ha comido la coma. Juntando los
 *   espacios saldría 19.510,00 €, cien veces el importe de verdad. Null es
 *   DESCONOCIDO y el operario lo teclea; un importe cien veces mayor pasa
 *   desapercibido hasta que no cuadra la caja.
 * - «19,500», que en una factura española no significa nada: ni 19,50 ni
 *   19.500. Sin decidir por el papel, se devuelve null.
 */
export function importeImpreso(texto: string | null | undefined): Centimos | null {
  if (texto == null) return null;

  // Se quitan el símbolo y el código de moneda, y los espacios de los extremos
  // —el OCR mete espacios finos y no separables donde le parece—.
  const limpio = texto
    .replace(/€|EUR(OS)?/gi, "")
    .replace(/^[\s\p{Zs}]+|[\s\p{Zs}]+$/gu, "");
  if (limpio === "") return null;

  // Un espacio ENTRE cifras es una coma perdida: ahí no se adivina.
  if (/\d[\s\p{Zs}]+\d/u.test(limpio)) return null;

  // Español —punto de millar, coma decimal—; detrás, la forma inglesa, que es
  // como sale de algunos escáneres; y por último, sin decimales, donde solo
  // vale el punto como millar: «1,234» a secas no se sabe qué es.
  const m =
    /^([+-]?)(\d{1,3}(?:\.\d{3})+|\d+),(\d{2})$/.exec(limpio) ??
    /^([+-]?)(\d{1,3}(?:,\d{3})+|\d+)\.(\d{2})$/.exec(limpio) ??
    /^([+-]?)(\d{1,3}(?:\.\d{3})+|\d+)()$/.exec(limpio);
  if (!m) return null;

  const signo = m[1] === "-" ? -1 : 1;
  const enteros = Number(m[2].replace(/[.,]/g, ""));
  const decimales = m[3] === "" ? 0 : Number(m[3]);
  const total = signo * (enteros * 100 + decimales);
  return esCentimosValido(total) ? total : null;
}

/**
 * Los huecos que el ERP rellena con un texto en vez de dejarlos vacíos.
 *
 * La factura B0020000579 trae, literalmente, «[Marca S/D] [Modelo S/D]». Sin
 * esto, el vehículo de esa factura sería un coche de la marca «S/D».
 */
const SIN_DATOS = /^(s\/d|n\/d|n\.d\.|sin datos|-+|\.+|null|undefined|\[.*s\/d.*\])$/i;

/** Texto de la factura, o null si está vacío o es un hueco sin rellenar. */
export function textoOpcional(valor: string | null | undefined): string | null {
  if (valor == null) return null;
  const limpio = valor.replace(/\s+/g, " ").trim();
  if (limpio === "" || SIN_DATOS.test(limpio)) return null;
  // Los corchetes de los huecos del ERP se quitan aunque traigan algo dentro:
  // «[Marca S/D]» ya se ha filtrado arriba, pero «[NISSAN]» tampoco se escribe
  // así en ninguna factura de verdad.
  return limpio.replace(/^\[|\]$/g, "").trim() || null;
}

/**
 * «27/08/2026» → «2026-08-27».
 *
 * Se admite el año de dos cifras porque los tickets de TPV lo imprimen así, y
 * se rechaza cualquier cosa que no sea una fecha posible: una fecha inventada
 * acabaría en el histórico y nadie la volvería a mirar.
 */
export function fechaImpresa(texto: string | null | undefined): string | null {
  const limpio = textoOpcional(texto);
  if (!limpio) return null;

  // Ya viene en ISO: se acepta tal cual si es un día real.
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(limpio);
  if (iso) return diaValido(+iso[1], +iso[2], +iso[3]);

  const es = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/.exec(limpio);
  if (!es) return null;
  const anio = es[3].length === 2 ? 2000 + Number(es[3]) : Number(es[3]);
  return diaValido(anio, Number(es[2]), Number(es[1]));
}

function diaValido(anio: number, mes: number, dia: number): string | null {
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31 || anio < 2000 || anio > 2100) return null;
  const d = new Date(Date.UTC(anio, mes - 1, dia));
  if (d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) return null;
  return `${anio}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

/**
 * Matrícula española, sin espacios ni guiones y en mayúsculas.
 *
 * Se admiten las dos que circulan: la actual —4 cifras y 3 letras— y la
 * provincial anterior a 2000. Lo que no cuadre con ninguna se devuelve tal
 * cual en mayúsculas: puede ser una matrícula extranjera o de obra, y borrarla
 * sería perder el dato que más identifica al vehículo en el concepto.
 */
export function matricula(texto: string | null | undefined): string | null {
  const limpio = textoOpcional(texto);
  if (!limpio) return null;
  const junto = limpio.replace(/[\s.-]/g, "").toUpperCase();
  if (/^\d{4}[BCDFGHJKLMNPRSTVWXYZ]{3}$/.test(junto)) return junto;
  if (/^[A-Z]{1,3}\d{4}[A-Z]{0,2}$/.test(junto)) return junto;
  return junto.slice(0, 20);
}

/**
 * Los cuatro últimos de la tarjeta, y NADA MÁS.
 *
 * Del recibo llega «************7394». Guardar el número entero sería guardar
 * un dato de tarjeta, así que aquí se corta: esta función es el único sitio
 * por el que ese dato entra en la aplicación, y no sabe devolver otra cosa.
 */
export function ultimosCuatro(texto: string | null | undefined): string | null {
  const limpio = textoOpcional(texto);
  if (!limpio) return null;
  const digitos = limpio.replace(/\D/g, "");
  if (digitos.length < 4) return null;
  return digitos.slice(-4);
}

/**
 * Enmascara cualquier cosa que parezca un número de tarjeta entero.
 *
 * Los datáfonos imprimen la tarjeta enmascarada, pero eso depende de cómo esté
 * configurado cada uno, y un OCR puede leer los asteriscos como ceros. Lo que
 * no puede pasar es que ese número quede guardado: no lo arregla nadie
 * después.
 *
 * Doce dígitos seguidos o más, con o sin separadores. Un número de comercio o
 * una autorización son mucho más cortos y no se tocan, que son justo los que
 * hacen falta para conciliar.
 */
export function enmascararTarjetas(texto: string | null): string | null {
  if (!texto) return texto;
  return texto.replace(/(?:\d[ -]?){11,}\d/g, (trozo) => `···${trozo.replace(/\D/g, "").slice(-4)}`);
}

/**
 * Un identificador del recibo —comercio, terminal, autorización—.
 *
 * Se quitan los separadores de millar que mete la impresora del TPV
 * («Num.Operación : 179.307») porque el mismo número se imprime sin ellos en
 * el extracto del banco, y si no coinciden no sirven para conciliar.
 */
export function identificador(texto: string | null | undefined): string | null {
  const limpio = textoOpcional(texto);
  if (!limpio) return null;
  const sinMiles = /^\d{1,3}(\.\d{3})+$/.test(limpio) ? limpio.replace(/\./g, "") : limpio;
  return sinMiles.slice(0, 60);
}

/**
 * La confianza que declara el modelo, encajada entre 0 y 1.
 *
 * Un modelo puede devolver 1.2 o -0, y esos valores pasarían por encima de
 * cualquier umbral sin que nadie lo notara. Lo que no sea un número se trata
 * como CERO, no como uno: sin confianza declarada, no hay confianza.
 */
export function confianza(valor: unknown): number {
  const n = typeof valor === "number" ? valor : Number(valor);
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/**
 * La extracción entera, de evidencia a datos de la caja.
 *
 * Un solo sitio por el que pasa TODO lo que dice el modelo. Si mañana aparece
 * un campo nuevo, entra por aquí o no entra.
 */
export function normalizar(cruda: ExtraccionCruda): ExtraccionNormalizada {
  const r = cruda.recibo;
  return {
    esFactura: cruda.es_factura === true,
    facturasDetectadas: Math.max(1, Math.round(Number(cruda.facturas_detectadas) || 1)),
    numeroFactura: textoOpcional(cruda.factura?.numero),
    fecha: fechaImpresa(cruda.factura?.fecha),
    cliente: {
      codigo: textoOpcional(cruda.cliente?.codigo),
      nombre: textoOpcional(cruda.cliente?.nombre),
      nif: textoOpcional(cruda.cliente?.nif),
    },
    vehiculo: {
      marca: textoOpcional(cruda.vehiculo?.marca),
      modelo: textoOpcional(cruda.vehiculo?.modelo),
      matricula: matricula(cruda.vehiculo?.matricula),
    },
    concepto: textoOpcional(cruda.concepto),
    totales: {
      baseCentimos: importeImpreso(cruda.totales?.base_imponible),
      ivaCentimos: importeImpreso(cruda.totales?.iva_importe),
      ivaPorcentaje: textoOpcional(cruda.totales?.iva_porcentaje),
      totalCentimos: importeImpreso(cruda.totales?.total),
      moneda: textoOpcional(cruda.totales?.moneda),
    },
    recibo: {
      detectado: r?.detectado === true,
      recibosDetectados: Math.max(0, Math.round(Number(r?.recibos_detectados) || 0)),
      plantilla: r?.plantilla === "INTEGRADO_ERP" || r?.plantilla === "TICKET_BANCO"
        ? r.plantilla
        : "DESCONOCIDA",
      importeCentimos: importeImpreso(r?.importe),
      tipoOperacion: textoOpcional(r?.tipo_operacion),
      // Por aquí es por donde NO entra el número de tarjeta completo.
      tarjetaUltimos4: ultimosCuatro(r?.tarjeta),
      numOperacion: identificador(r?.num_operacion),
      codAutorizacion: identificador(r?.cod_autorizacion),
      comercio: identificador(r?.comercio),
      terminal: identificador(r?.terminal),
      red: textoOpcional(r?.red),
      adquirente: textoOpcional(r?.adquirente),
      cuenta: textoOpcional(r?.cuenta),
      fechaHora: textoOpcional(r?.fecha_hora),
      texto: enmascararTarjetas(textoOpcional(r?.texto)),
    },
    confianza: {
      numeroFactura: confianza(cruda.confianza?.numero_factura),
      cliente: confianza(cruda.confianza?.cliente),
      total: confianza(cruda.confianza?.total),
      concepto: confianza(cruda.confianza?.concepto),
      recibo: confianza(cruda.confianza?.recibo),
    },
  };
}

/**
 * La evidencia que le llega al clasificador.
 *
 * Es un recorte de la extracción: solo lo que sirve para decidir la forma de
 * cobro. Se pasa así, y no la extracción entera, para que el clasificador no
 * pueda mirar el importe de la factura ni el nombre del cliente ni nada que no
 * sea evidencia de cómo se pagó.
 */
export function evidenciaDeCobro(n: ExtraccionNormalizada): EvidenciaCobro {
  return {
    reciboDetectado: n.recibo.detectado,
    importeReciboCentimos: n.recibo.importeCentimos,
    adquirente: n.recibo.adquirente,
    comercio: n.recibo.comercio,
    terminal: n.recibo.terminal,
    red: n.recibo.red,
    cuenta: n.recibo.cuenta,
    plantilla: n.recibo.plantilla,
    textoRecibo: n.recibo.texto,
    confianzaRecibo: n.confianza.recibo,
  };
}

/**
 * La extracción cruda, sin números de tarjeta.
 *
 * La cruda se guarda tal y como la devuelve el modelo, para poder auditarla.
 * «Tal cual» tiene un límite: los recibos imprimen la tarjeta enmascarada
 * —«************7394»— pero eso depende del datáfono, y un recibo mal
 * configurado, o un OCR que se invente ceros, podría dejar ahí una tirada de
 * dígitos que parezca un número de tarjeta entero.
 *
 * Guardar eso no lo arregla nadie después: se recorta ANTES de escribirlo, y
 * no se pierde nada, porque lo que sirve para conciliar son los cuatro
 * últimos, que se guardan aparte en la normalizada.
 */
export function sinDatosDeTarjeta(cruda: ExtraccionCruda): ExtraccionCruda {
  return {
    ...cruda,
    recibo: {
      ...cruda.recibo,
      tarjeta: cruda.recibo?.tarjeta ? `···${ultimosCuatro(cruda.recibo.tarjeta) ?? ""}` : null,
      texto: enmascararTarjetas(cruda.recibo?.texto ?? null),
    },
  };
}
