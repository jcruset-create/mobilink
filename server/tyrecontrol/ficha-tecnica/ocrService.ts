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
- Usa estas claves normalizadas cuando reconozcas el dato, casando por el CÓDIGO de la tarjeta:
  A→matricula, B→fecha_primera_matriculacion, CL→clasificacion, C.I→campo_ci, C.V→campo_cv,
  A.1→fabricante, A.2→direccion_fabricante, D.1→marca, D.2→tipo/variante/version (y modelo si aparece),
  D.3→denominacion_comercial, D.6→procedencia, E→vin, J→categoria, J.1→carroceria, J.2→campo_j2,
  J.3→campo_j3, R→color, K→num_homologacion, Z→observaciones_ficha, G→masa_orden_marcha, F.1→mma,
  F.1.1→mma_por_eje, F.1.5→longitud, F.2→mma_autorizada, F.2.1→mma_autorizada_por_eje,
  F.3→masa_maxima_conjunto, F.3.1→masa_remolcable, O.1→masa_remolque_con_freno, O.1.1→campo_o11,
  O.1.2→carga_vertical_maxima, O.1.3→campo_o13, O.1.4→campo_o14, F.4→distancia_ejes, F.5→anchura,
  F.6→altura, F.7→campo_f7, F.7.1→campo_f71, F.8→via, M.1→voladizo, M.4→anchura_vias, L→num_ejes,
  L.0→ejes_motrices, L.1→configuracion_ejes_ficha, L.2→num_ruedas, P.5.1→fabricante_motor,
  P.5→tipo_motor, P.3→combustible, P.1→cilindrada, P.1.1→alimentacion, P.2→potencia,
  P.2.1→relacion_potencia, S.1→num_plazas, S.2→plazas_pie, U.1→nivel_sonoro, U.2→regimen_motor,
  V.7→co2, V.9→norma_emisiones, I→fecha_emision. También: tara y num_cilindros si el documento los da aparte.
- Los códigos compuestos (F.1.1, F.2.1, M.1, M.4, L, L.0, L.1, L.2, P.1.1) se devuelven TAL CUAL aparecen
  ("8000 / 13000 / /", "6 / EN LINEA", "2 / 6"), sin partirlos ni interpretarlos.
- Si el valor de un código son solo guiones o está vacío, NO lo devuelvas: es un campo sin dato.
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
