import { pedirIA } from "../../core/openaiService.ts";

/**
 * OCR de fichas técnicas de vehículo.
 *
 * El proveedor queda detrás de esta interfaz a propósito: hoy se resuelve con
 * el modelo de visión que ya usa el resto del servidor (el mismo que lee
 * matrículas), y mañana se puede cambiar sin tocar los endpoints ni el parser.
 */
export interface FichaTecnicaOcr {
  /** Extrae los campos de una ficha técnica a partir de sus páginas. */
  extraer(imagenes: string[]): Promise<ResultadoOcr>;
}

/** Un dato leído del documento, con su código original y su fiabilidad. */
export interface CampoDetectado {
  codigo_origen?: string | null;   // "E", "V.9", "F.1"…
  etiqueta_origen?: string | null; // "Número de identificación"
  clave?: string | null;           // clave normalizada interna
  valor: string;
  unidad?: string | null;
  confianza?: number | null;       // 0..1
  pagina?: number | null;
}

/** Un eje tal y como se ha podido leer del documento. */
export interface EjeDetectado {
  posicion: number;
  ruedas?: number | null;      // neumáticos montados en ese eje
  directriz?: boolean | null;
  motriz?: boolean | null;
  elevable?: boolean | null;
  medida?: string | null;      // "315/70R22.5"
  indice_carga?: string | null;
  codigo_velocidad?: string | null;
}

export interface ResultadoOcr {
  /** Campos con correspondencia conocida (matricula, vin, marca…). */
  campos: CampoDetectado[];
  /** Ejes leídos, ordenados de delante hacia atrás. */
  ejes: EjeDetectado[];
  /** Nomenclatura del fabricante tal cual aparece ("6x2"), sin interpretar. */
  config_convencional?: string | null;
  /** Texto de observaciones, íntegro. */
  observaciones?: string | null;
  /** Confianza global estimada (0..1). */
  confianza?: number | null;
  /** Respuesta cruda del proveedor, para depurar. */
  raw?: unknown;
}

const INSTRUCCIONES = `Eres un perito que digitaliza fichas técnicas de vehículos (España y UE).
Lee TODAS las páginas y devuelve EXCLUSIVAMENTE un JSON válido con esta forma:

{
  "campos": [ { "codigo_origen": "E", "etiqueta_origen": "Nº identificación", "clave": "vin", "valor": "WMA06XZZ6HM740099", "unidad": null, "confianza": 0.98, "pagina": 1 } ],
  "ejes": [ { "posicion": 1, "ruedas": 2, "directriz": true, "motriz": false, "elevable": false, "medida": "315/70R22.5", "indice_carga": "156", "codigo_velocidad": "L" } ],
  "config_convencional": "4x2",
  "observaciones": "texto íntegro del apartado de observaciones",
  "confianza": 0.93
}

Reglas estrictas:
- "codigo_origen" es SIEMPRE el código tal cual sale en la tarjeta (A.1, D.2, F.1.1, O.1.2, V.9…).
  Es lo que usamos para casar con nuestro catálogo, así que es el dato más importante de cada campo.
- Rellena además "clave" con la clave normalizada cuando la reconozcas:
  MATRICULA→matricula, CERTIFICADO→certificado_numero, FECHA EXPEDICIÓN→fecha_emision,
  A.1→fabricante, A.2→direccion_fabricante, A.3→representante_fabricante, B→fecha_primera_matriculacion,
  CL o C.L→clasificacion, C.I→codigo_complementario_ci, C.V→codigo_complementario_cv,
  D.1→marca, D.2→tipo/variante/version, D.3→denominacion_comercial, D.4→categoria_comercial,
  D.5→modelo, D.6→denominacion_interna, E→vin,
  F.1→mma, F.1.1→mma_por_eje, F.1.5→longitud, F.2→mma_autorizada, F.2.1→mma_autorizada_por_eje,
  F.3→masa_maxima_conjunto, F.3.1→masa_conjunto_autorizada, G→masa_orden_marcha,
  F.4→distancia_ejes, F.5→anchura, F.6→altura, F.7→longitud_util, F.7.1→longitud_carga, F.8→via,
  M.1→voladizo, M.2→distancia_ejes_m2, M.3→distancia_ruedas, M.4→anchura_vias,
  J→categoria, J.1→carroceria, J.2→codigo_carroceria, J.3→uso_clasificacion, K→num_homologacion,
  R→color, Z→observaciones_ficha,
  L→num_ejes, L.0→ejes_motrices, L.1→configuracion_ejes_ficha, L.2→num_ruedas,
  O.1→masa_remolcable, O.1.1→masa_remolcable_compl_1, O.1.2→carga_vertical_maxima,
  O.1.3→masa_remolcable_compl_3, O.1.4→masa_remolcable_compl_4, O.2→masa_remolcable_sin_freno,
  P.1→cilindrada, P.1.1→configuracion_motor, P.2→potencia, P.2.1→relacion_potencia_masa,
  P.3→combustible, P.4→potencia_fiscal, P.5→tipo_motor, P.5.1→fabricante_motor, Q→relacion_peso_potencia,
  S.1→num_plazas_sentadas, S.2→num_plazas_pie, T→velocidad_maxima,
  U.1→nivel_sonoro, U.2→regimen_motor_ensayo, V.1→emisiones_co, V.2→emisiones_hc, V.3→emisiones_nox,
  V.4→particulas, V.5→opacidad, V.6→norma_emisiones_homologacion, V.7→co2, V.8→consumo, V.9→norma_emisiones.
- Los códigos compuestos (F.1.1, F.2.1, M.1, M.2, M.3, M.4, L, L.0, L.1, L.2, P.1.1) se devuelven TAL CUAL
  aparecen ("8000 / 13000 / /", "6 / EN LINEA", "2 / 6"), sin partirlos ni interpretarlos.
- NO devuelvas un campo cuyo valor esté vacío, sean solo guiones ("---") o diga "N/A", "NO CONSTA" o
  "SIN DATOS": es una casilla sin rellenar, no un dato. Tampoco devuelvas un código que hayas leído
  sin encontrarle valor. El cero SÍ es un valor: "0" se devuelve.
- NO te inventes descripciones ni valores. Si algo no se lee, omítelo y baja la confianza global.
- Los datos del titular (C.1, C.1.1, C.1.2, C.2, C.3) NO se extraen: omítelos aunque aparezcan.
- Para cualquier otro dato del documento, deja "clave" a null pero CONSERVA "codigo_origen", "etiqueta_origen" y "valor". No descartes nada.
- "ruedas" es el número de NEUMÁTICOS de ese eje (2 rueda simple, 4 rueda gemela). Si el documento no lo dice con claridad, pon null: NO lo inventes.
- Los ejes van SIEMPRE ordenados de delante hacia atrás, empezando por posicion 1.
- Cualquier fecha (fecha_primera_matriculacion, fecha_emision...) se devuelve SIEMPRE en formato ISO "aaaa-mm-dd", aunque el documento la muestre como dd/mm/aaaa.
- "config_convencional" es la nomenclatura del fabricante tal cual (4x2, 6x2…). Si no aparece, null. No la calcules.
- "confianza" refleja lo legible que estaba el documento. Sé honesto: si algo no se lee bien, baja la confianza de ese campo.
- No añadas texto fuera del JSON.`;

/**
 * Implementación sobre la capa central de IA (Responses API + Structured
 * Outputs). El modelo NO se escribe aquí: lo decide OPENAI_DOCUMENT_MODEL.
 */
export class OpenAiFichaTecnicaOcr implements FichaTecnicaOcr {
  async extraer(imagenes: string[]): Promise<ResultadoOcr> {
    if (!imagenes.length) throw new Error("No hay páginas que procesar");

    const r = await pedirIA<any>({
      operacion: "tyrecontrol.ficha-tecnica.ocr",
      proposito: "documento",
      prompt: INSTRUCCIONES,
      imagenes: imagenes.map((url) => ({ url })),
      maxTokens: 16000,
      esquema: { nombre: "ficha_tecnica", schema: ESQUEMA_FICHA },
      // Imagen + esquema estructurado grande tarda bastante más que un texto
      // suelto; con el timeout por defecto (60 s) el proveedor no siempre
      // llega a tiempo y se agotan los 3 intentos sin motivo real.
      timeoutMs: 120_000,
    });
    if (!r.ok) throw new Error(r.error || "El OCR no devolvió resultado");

    const json = r.datos ?? {};
    return {
      campos: Array.isArray(json.campos) ? json.campos : [],
      ejes: Array.isArray(json.ejes) ? json.ejes : [],
      config_convencional: json.config_convencional ?? null,
      observaciones: json.observaciones ?? null,
      confianza: typeof json.confianza === "number" ? json.confianza : null,
      raw: json,
    };
  }
}

/**
 * Esquema estricto: el modelo no puede devolver campos de más ni omitir los
 * obligatorios, así que lo que llega a la revisión siempre tiene la forma
 * esperada. Los valores que el documento no aclare vienen a null.
 */
const ESQUEMA_FICHA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["campos", "ejes", "config_convencional", "observaciones", "confianza"],
  properties: {
    campos: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["codigo_origen", "etiqueta_origen", "clave", "valor", "unidad", "confianza", "pagina"],
        properties: {
          codigo_origen: { type: ["string", "null"] },
          etiqueta_origen: { type: ["string", "null"] },
          clave: { type: ["string", "null"] },
          valor: { type: "string" },
          unidad: { type: ["string", "null"] },
          confianza: { type: ["number", "null"] },
          pagina: { type: ["integer", "null"] },
        },
      },
    },
    ejes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["posicion", "ruedas", "directriz", "motriz", "elevable", "medida", "indice_carga", "codigo_velocidad"],
        properties: {
          posicion: { type: "integer" },
          ruedas: { type: ["integer", "null"] },
          directriz: { type: ["boolean", "null"] },
          motriz: { type: ["boolean", "null"] },
          elevable: { type: ["boolean", "null"] },
          medida: { type: ["string", "null"] },
          indice_carga: { type: ["string", "null"] },
          codigo_velocidad: { type: ["string", "null"] },
        },
      },
    },
    config_convencional: { type: ["string", "null"] },
    observaciones: { type: ["string", "null"] },
    confianza: { type: ["number", "null"] },
  },
};
