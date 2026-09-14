/**
 * El formato de un caso de calibración y su resultado esperado.
 *
 * Un CASO es un correo real de Therefore —anonimizado— con su PDF, y al lado
 * lo que el sistema tiene que sacar de él. Ese «lo que tiene que sacar» es el
 * **ground truth**, y su única propiedad importante es que lo escribe una
 * persona mirando el papel, nunca el parser.
 *
 * ── Por qué eso importa más de lo que parece ────────────────────────────────
 *
 * Si el esperado se generase ejecutando el parser, la prueba diría «el parser
 * hace lo que hace» y pasaría siempre, incluso el día que empiece a leer
 * 77,56 donde pone 77,50. Un ground truth derivado del código que verifica no
 * verifica nada. Por eso este fichero sólo define la FORMA; el contenido lo
 * rellena quien ha abierto el PDF.
 *
 * ── Dos orígenes, y no se mezclan ───────────────────────────────────────────
 *
 * · `real-anonimizado` — sale de un correo de verdad. Es lo único que sirve
 *   para CALIBRAR, porque es lo único que tiene la estructura que Therefore y
 *   los proveedores producen de verdad.
 * · `sintetico` — lo hemos fabricado nosotros. Sirve para probar MECÁNICA
 *   (que el separador separa, que los descuentos encadenados no se colapsan) y
 *   para la CI. No sirve para calibrar: un parser afinado contra ejemplos que
 *   nos hemos inventado acierta el 100 % y falla con el primer correo real.
 *
 * Los reales NO se versionan: este repositorio es público y un albarán lleva
 * el precio de compra y la escala de descuentos de un proveedor. Ver README.md.
 */

import type { TipoAccion } from "../domain/estados.ts";
import type { ResultadoMatch } from "../domain/albaran.ts";

/* ── El correo ───────────────────────────────────────────────────────────── */

export type CorreoDelCaso = {
  asunto: string;
  de: string;
  para: string;
  /** ISO 8601. */
  fecha: string;
  /** El cuerpo entero, en texto plano. Nunca se recorta. */
  texto: string;
  /**
   * El bloque «Información Adicional», aparte.
   *
   * Es donde está la petición concreta de la persona, y es la parte que no
   * tiene plantilla: el resto del correo lo genera Therefore siempre igual.
   * Se guarda separado porque es lo que hay que mirar cuando un caso falla.
   */
  informacionAdicional: string;
  /** Cabeceras que relacionan correo, hilo y adjuntos. */
  messageId: string;
  inReplyTo?: string | null;
};

export type AdjuntoDelCaso = {
  /** Nombre del fichero dentro de la carpeta del caso. */
  fichero: string;
  mimeType: string;
  /** Cómo venía llamado en el correo original, ya anonimizado. */
  nombreOriginal: string;
};

/* ── Lo que se espera del parser de correo ───────────────────────────────── */

export type ActuacionEsperada = {
  accion: TipoAccion;
  /** Tal y como lo escribe el correo. `null` si la acción no lleva albarán. */
  albaran: string | null;
  /** En céntimos y con signo. `null` si el correo no dice importe. */
  importeCentimos: number | null;
  /** Lo que venía pegado al albarán y no se interpreta: «T2». */
  indicador?: string | null;
};

export type CorreoEsperado = {
  categoria: "INCIDENCIA_ALBARAN" | "APROBACION_FACTURA" | "TAREA_VENCIDA" | "OTRO";
  empresaCodigo: string | null;
  proveedorCodigo: string | null;
  proveedorNombre: string | null;
  cuentaContable: string | null;
  facturaNumero: string | null;
  /** `aaaa-mm-dd`. */
  facturaFecha: string | null;
  importeCentimos: number | null;
  urgente: boolean;
  persona: string | null;
  actuaciones: ActuacionEsperada[];
  /**
   * Números que aparecen en el texto y que NO deben convertirse en actuación
   * porque no se sabe qué acción les corresponde. Es la lista que evita que un
   * parser «listo» se invente una acción para no dejar nada fuera.
   */
  albaranesAmbiguos?: string[];
};

/* ── Lo que se espera del análisis del documento ─────────────────────────── */

export type DescuentoEsperado = {
  orden: number;
  porcentaje: number;
  /** Tal y como está impreso: «60%». Se conserva sin normalizar. */
  raw: string;
};

export type LineaEsperada = {
  referencia: string | null;
  descripcion: string | null;
  /** Unidades. Puede llevar decimales. */
  cantidad: number | null;
  precioUnitarioCentimos: number | null;
  /** En orden. `60% + 10%` son DOS, nunca uno del 64 %. */
  descuentos: DescuentoEsperado[];
  importeCentimos: number | null;
};

export type AlbaranEsperado = {
  /** El que pide la incidencia. */
  albaranSolicitado: string;
  /** Cómo lo escribe el documento: «ENT-770199-0501234». `null` si no está. */
  numeroEnDocumento: string | null;
  resultadoMatch: ResultadoMatch;
  /** 1-indexadas. Un albarán puede empezar en una y acabar en la siguiente. */
  paginaInicio?: number | null;
  paginaFin?: number | null;

  lineas: LineaEsperada[];
  /** La SUMA de las líneas. Se escribe a mano para que el parser no se valide solo. */
  sumaLineasCentimos: number | null;
  /** suma − importe de la incidencia. Puede no ser cero, y eso no es un fallo. */
  diferenciaCentimos: number | null;

  matricula?: string | null;
  bastidor?: string | null;
  observaciones?: string | null;

  /**
   * Conceptos del documento que NO son artículos (portes, tasas, base, IVA).
   * Se listan para comprobar que no se cuelan como líneas ni se suman.
   */
  conceptosNoLinea?: string[];

  estadoAnalisis: "OK" | "REVISAR" | "ERROR";
  /**
   * Qué validaciones tienen que salir NO conformes, y por qué.
   *
   * Es la parte que impide que «REVISAR» valga como comodín: no basta con que
   * el caso salga en revisión, tiene que salir por el motivo correcto.
   */
  validacionesNoConformes?: { tipo: string; estado: "REVISAR" | "ERROR"; porque: string }[];
};

/* ── El caso entero ──────────────────────────────────────────────────────── */

export type CasoCalibracion = {
  /** Identificador y nombre de la carpeta: `caso-01-varios-albaranes`. */
  id: string;
  /** Qué prueba este caso y por qué está en el lote. */
  descripcion: string;
  origen: "real-anonimizado" | "sintetico";
  /** Quién escribió el esperado y cuándo. Un ground truth sin dueño no lo es. */
  verificadoPor?: string;
  verificadoEl?: string;

  correo: CorreoDelCaso;
  adjuntos: AdjuntoDelCaso[];

  esperado: {
    correo: CorreoEsperado;
    albaranes: AlbaranEsperado[];
  };
};
