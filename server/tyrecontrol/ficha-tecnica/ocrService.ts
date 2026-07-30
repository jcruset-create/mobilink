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
- Usa estas claves normalizadas cuando reconozcas el dato: matricula, vin, marca, modelo, tipo, variante, version, denominacion_comercial, fabricante, categoria, clasificacion, carroceria, num_ejes, num_ruedas, ejes_motrices, mma, masa_maxima_conjunto, masa_orden_marcha, tara, masa_remolcable, longitud, anchura, altura, distancia_ejes, via, combustible, cilindrada, potencia, num_cilindros, norma_emisiones, nivel_sonoro, fecha_emision, fecha_primera_matriculacion, num_homologacion.
- Para cualquier otro dato del documento, deja "clave" a null pero CONSERVA "codigo_origen", "etiqueta_origen" y "valor". No descartes nada.
- "ruedas" es el número de NEUMÁTICOS de ese eje (2 rueda simple, 4 rueda gemela). Si el documento no lo dice con claridad, pon null: NO lo inventes.
- Los ejes van SIEMPRE ordenados de delante hacia atrás, empezando por posicion 1.
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
      maxTokens: 8000,
      esquema: { nombre: "ficha_tecnica", schema: ESQUEMA_FICHA },
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
