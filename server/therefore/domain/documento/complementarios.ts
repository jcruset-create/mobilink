/**
 * Lo que trae el albarán además de las líneas.
 *
 * Matrícula, bastidor, fecha, pedido, centro, taller, kilómetros,
 * observaciones. No entran en ninguna columna y son la mitad de lo que hace
 * falta para grabar la entrada en el ERP: sin matrícula, un albarán de
 * neumáticos no se sabe a qué vehículo va.
 *
 * ── Nada se pierde por no tener sitio ───────────────────────────────────────
 *
 * Lo que viene etiquetado y no tiene columna propia se guarda igualmente en
 * `otros`, con su etiqueta tal y como está impresa (§28). El coste de guardarlo
 * es cero y el de no guardarlo es que alguien tenga que volver a abrir el PDF.
 *
 * ── Dónde se busca ──────────────────────────────────────────────────────────
 *
 * Dentro de la sección, y para la matrícula y el bastidor también en la banda
 * inmediatamente anterior a la primera línea de artículo: hay plantillas que
 * los imprimen encima de la cabecera de la tabla, a la altura de los datos del
 * cliente.
 *
 * ── El orden de los patrones importa ────────────────────────────────────────
 *
 * Un bastidor de 17 caracteres contiene dentro tiradas que parecen otras cosas,
 * así que se busca ANTES y su texto se retira antes de buscar lo demás. Es el
 * mismo cuidado que ya costó un fallo en el anonimizador.
 */

import { leerFecha } from "../correo/importes.ts";
import { normalizar } from "../correo/texto.ts";
import type { LineaTexto } from "./tipos.ts";

/** 17 caracteres sin I, O ni Q: el estándar del número de bastidor. */
const BASTIDOR = /\b[A-HJ-NPR-Z0-9]{17}\b/;

/** Matrícula española moderna: cuatro dígitos y tres consonantes. */
const MATRICULA_MODERNA = /\b\d{4}[ -]?[BCDFGHJKLMNPRSTVWXYZ]{3}\b/;

/** Remolque o semirremolque: R o S, cuatro dígitos y tres consonantes. */
const MATRICULA_REMOLQUE = /\b[RS][ -]?\d{4}[ -]?[BCDFGHJKLMNPRSTVWXYZ]{3}\b/;

/** Una fila con importes es un artículo; ahí no vive la matrícula salvo etiquetada. */
const CON_DECIMALES = /\d[.,]\d{2}/;
const ETIQUETA_MATRICULA = /^\s*MATR?[ÍI]?C?U?L?A?\s*[.:]/;

/** Las antiguas, con letra o letras de provincia delante. */
const MATRICULA_ANTIGUA = /\b[A-Z]{1,2}[ -]?\d{4}[ -]?[A-Z]{1,2}\b/;

/** Una fecha escrita de cualquiera de las formas que usan los albaranes. */
const FECHA = /\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b/;

/**
 * Etiquetas que se reconocen con nombre propio. El resto de lo etiquetado va a
 * `otros`, que es donde acaba lo que un proveedor decida imprimir mañana.
 */
const ETIQUETAS: { clave: string; sinonimos: string[] }[] = [
  { clave: "pedido", sinonimos: ["pedido", "nº pedido", "n. pedido", "su pedido"] },
  { clave: "centro", sinonimos: ["centro", "centro de coste"] },
  { clave: "delegacion", sinonimos: ["delegación", "delegacion"] },
  { clave: "taller", sinonimos: ["taller"] },
  { clave: "km", sinonimos: ["km", "kms", "kilómetros", "kilometros"] },
  { clave: "marcaModelo", sinonimos: ["marca/modelo", "marca y modelo", "vehículo", "vehiculo"] },
  { clave: "observaciones", sinonimos: ["observaciones", "obs.", "obs", "nota", "notas"] },
];

/** Cualquier «Etiqueta: valor», venga de donde venga. */
const ETIQUETADO = /^([A-Za-zÁÉÍÓÚÑáéíóúñ ./º]{2,30})\s*[:]\s*(.+)$/;

export type Complementarios = {
  matricula: string | null;
  bastidor: string | null;
  /** `aaaa-mm-dd`. La del albarán, no la de la factura. */
  fecha: string | null;
  observaciones: string | null;
  /** Todo lo etiquetado, con su etiqueta impresa como clave. */
  otros: Record<string, string>;
};

const VACIO = (): Complementarios => ({
  matricula: null,
  bastidor: null,
  fecha: null,
  observaciones: null,
  otros: {},
});

function normalizaEtiqueta(v: string): string {
  return normalizar(v).toLowerCase().replace(/[.:]/g, "").replace(/\s+/g, " ").trim();
}

function claveConocida(etiqueta: string): string | null {
  const e = normalizaEtiqueta(etiqueta);
  for (const { clave, sinonimos } of ETIQUETAS) {
    if (sinonimos.some((s) => normalizaEtiqueta(s) === e)) return clave;
  }
  return null;
}

/**
 * Lee los datos complementarios de una sección.
 *
 * `bandaPrevia` son las filas de justo antes: ahí viven la matrícula y el
 * bastidor en las plantillas que los ponen con los datos del cliente.
 */
export function extraerComplementarios(
  seccion: LineaTexto[],
  bandaPrevia: LineaTexto[] = []
): Complementarios {
  const salida = VACIO();

  /*
   * Se busca sobre el texto en mayúsculas y NO sobre el normalizado: matrículas
   * y bastidores no llevan acentos, así que `toUpperCase()` basta y —a
   * diferencia de `normalizar`— no cambia la longitud de la cadena, que es lo
   * que permite devolver el valor tal y como está impreso.
   */
  const buscarVehiculo = (filas: LineaTexto[]) => {
    for (const f of filas) {
      let t = f.texto.toUpperCase();
      if (!salida.bastidor) {
        const b = t.match(BASTIDOR);
        // Una tirada de 17 dígitos puros no es un bastidor: es un número de
        // cuenta o una referencia larga.
        if (b && /[A-Z]/.test(b[0])) {
          salida.bastidor = b[0];
          t = t.replace(b[0], " ");
        }
      }
      // «CF1100 A/T» en la descripción de un neumático tiene la forma de una
      // matrícula antigua y no lo es. En una fila de artículo sólo se lee la
      // matrícula si va etiquetada.
      if (!salida.matricula && (!CON_DECIMALES.test(t) || ETIQUETA_MATRICULA.test(t))) {
        const m = t.match(MATRICULA_REMOLQUE) ?? t.match(MATRICULA_MODERNA) ?? t.match(MATRICULA_ANTIGUA);
        if (m) salida.matricula = m[0].replace(/[ -]/g, "");
      }
      if (salida.bastidor && salida.matricula) return;
    }
  };

  buscarVehiculo(seccion);
  buscarVehiculo(bandaPrevia);

  for (const f of seccion) {
    // El valor de una etiqueta se guarda TAL CUAL: es texto que va a acabar en
    // pantalla y en el ERP, no una clave para comparar.
    const t = f.texto.trim();
    if (!t) continue;

    if (!salida.fecha) {
      const fecha = t.match(FECHA);
      if (fecha) salida.fecha = leerFecha(fecha[0]);
    }

    const m = t.match(ETIQUETADO);
    if (!m) continue;
    const etiqueta = m[1].trim();
    const valor = m[2].trim();
    if (!valor) continue;

    const clave = claveConocida(etiqueta);
    if (clave === "observaciones") {
      salida.observaciones = salida.observaciones ? `${salida.observaciones} ${valor}` : valor;
      continue;
    }
    // Las etiquetas conocidas van con su clave estable; las demás, con la
    // etiqueta tal y como está impresa, que es lo que alguien reconocerá.
    salida.otros[clave ?? etiqueta] = valor;
  }

  return salida;
}
