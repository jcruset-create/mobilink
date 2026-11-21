/**
 * Buscar modelos de neumático de verdad, en Internet, desde el servidor.
 *
 * ── Por qué esto vive aquí y no en el navegador ─────────────────────────────
 *
 * Porque hace falta la clave de OpenAI, y una clave en el navegador es una
 * clave pública. La pantalla manda la frase y recibe candidatos; nada más.
 *
 * ── Qué hace la IA y qué NO hace ────────────────────────────────────────────
 *
 * La IA BUSCA y TRANSCRIBE: usa la herramienta de búsqueda web de la Responses
 * API, lee las fichas que encuentra y las devuelve en un esquema estricto. No
 * decide nada. Quien decide si un candidato vale es `catalogoIA.ts`, que es
 * puro, está en src/ y tiene sus pruebas: comprueba que la marca es la que se
 * pidió, que la medida es la que se pidió y que hay una fuente que abrir.
 *
 * Es la misma regla del informe de intervención y del aviso de presión: la IA
 * redacta y recopila, nunca decide los hechos. Aquí el hecho es «este
 * neumático existe en esta medida», y un modelo que se lo invente mete en el
 * catálogo una ficha verosímil por la que alguien acabará comprando.
 *
 * ── La prueba de que buscó ──────────────────────────────────────────────────
 *
 * Un modelo al que se le da una herramienta puede no usarla y contestar de
 * memoria, con una seguridad idéntica. Por eso no se mira lo que dice que hizo
 * sino lo que trae: si en la salida no hay ni una llamada a la búsqueda, no se
 * ofrece nada.
 *
 * La prueba son los `web_search_call` de la salida, NO las citas del texto.
 * Costó un intento real descubrirlo: con esquema JSON estricto la respuesta
 * final es un objeto, no prosa, así que no lleva anotaciones de cita aunque el
 * modelo haya leído diez páginas. Mirando solo las anotaciones, una búsqueda
 * buena se descartaba como inventada.
 */

import { hayIA, pedirIA } from "../../core/openaiService.ts";
import type { CandidatoCrudo, ConsultaCatalogo } from "../../../src/modules/tyrecontrol/services/catalogoIA.ts";

/** Lo que la búsqueda devuelve, antes de clasificar. */
export interface ResultadoBusqueda {
  ok: boolean;
  candidatos: CandidatoCrudo[];
  /** Todas las URLs que la respuesta citó. Sirve de recibo de la búsqueda. */
  citas: string[];
  /** Qué contar cuando algo no ha ido bien. Vacío si todo fue normal. */
  aviso: string;
}

/** Tope de modelos por búsqueda: una tabla más larga no se revisa, se acepta. */
const MAX_MODELOS = 15;

const ESQUEMA = {
  nombre: "modelos_neumatico",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["modelos", "sin_resultados_fiables"],
    properties: {
      /**
       * Que el modelo pueda decir «no he encontrado nada fiable» es la salida
       * que evita que rellene la tabla por compromiso.
       */
      sin_resultados_fiables: { type: "boolean" },
      modelos: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "fabricante", "modelo", "medida", "indiceCargaSimple", "indiceCargaDoble",
            "codigoVelocidad", "ply", "tipoVehiculo", "posicion", "utilizacion",
            "ms", "tresPmsf", "eficienciaEnergetica", "adherenciaMojado", "ruidoDb",
            "ean", "imagenUrl", "fichaUrl", "fuentes",
          ],
          properties: {
            fabricante: { type: "string" },
            modelo: { type: "string" },
            medida: { type: "string" },
            indiceCargaSimple: { type: ["string", "null"] },
            indiceCargaDoble: { type: ["string", "null"] },
            codigoVelocidad: { type: ["string", "null"] },
            ply: { type: ["string", "null"] },
            tipoVehiculo: { type: ["string", "null"] },
            posicion: { type: ["string", "null"], description: "direccion | traccion | remolque | mixto" },
            utilizacion: { type: ["string", "null"], description: "carretera | regional | mixto | obra | urbano" },
            ms: { type: ["boolean", "null"] },
            tresPmsf: { type: ["boolean", "null"] },
            eficienciaEnergetica: { type: ["string", "null"] },
            adherenciaMojado: { type: ["string", "null"] },
            ruidoDb: { type: ["number", "null"] },
            ean: { type: ["string", "null"] },
            imagenUrl: { type: ["string", "null"] },
            fichaUrl: { type: ["string", "null"] },
            fuentes: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["url", "titulo"],
                properties: { url: { type: "string" }, titulo: { type: ["string", "null"] } },
              },
            },
          },
        },
      },
    },
  },
} as const;

function instrucciones(consulta: ConsultaCatalogo): string {
  return [
    "Eres el documentalista técnico de un taller de neumáticos de camión y autobús.",
    "",
    `Busca en Internet qué modelos de ${consulta.fabricante ?? "el fabricante indicado"} ` +
      `se comercializan en la medida ${consulta.medida ?? "indicada"}.`,
    "",
    "Reglas, por este orden:",
    "",
    "1. USA LA BÚSQUEDA WEB. No contestes de memoria: lo que no hayas leído en una",
    "   página concreta, no lo pongas.",
    "2. Prioriza el catálogo oficial del fabricante. Después, distribuidores",
    "   europeos serios y bases de datos de etiquetado de la UE.",
    "3. Incluye un modelo SOLO si has visto esa medida exacta en su ficha. Un",
    "   modelo que existe en otras medidas pero no en ésta NO se incluye.",
    "4. Cada modelo tiene que llevar al menos una URL en `fuentes`, y esa URL",
    "   tiene que ser una página que hayas abierto. Sin fuente, fuera.",
    "5. Los campos que no encuentres se dejan a null. NO los deduzcas, NO los",
    "   calcules por parecido con otro modelo y NO los rellenes con lo típico de",
    "   la medida. Un hueco vacío se completa luego a mano; un dato inventado no",
    "   se detecta nunca.",
    "6. Si no encuentras nada fiable, devuelve `sin_resultados_fiables: true` y la",
    "   lista vacía. Es una respuesta perfectamente buena.",
    `7. Como mucho ${MAX_MODELOS} modelos, los más claros primero.`,
    "",
    "El `fabricante` de cada ficha tiene que ser exactamente el que se te ha",
    "pedido, y la `medida` la que se te ha pedido: lo que no cumpla eso se",
    "descarta después, así que no gastes sitio en ello.",
    "",
    `Consulta literal de la persona: «${consulta.texto}»`,
  ].join("\n");
}

/**
 * Busca modelos. Nunca lanza: devuelve el motivo.
 *
 * Lo llama una pantalla, y que una pantalla de catálogo se caiga porque el
 * proveedor de IA conteste un 502 sería cambiar «no he encontrado nada» por
 * «no abre».
 */
export async function buscarModelos(consulta: ConsultaCatalogo): Promise<ResultadoBusqueda> {
  const vacio = (aviso: string): ResultadoBusqueda => ({ ok: false, candidatos: [], citas: [], aviso });

  if (!hayIA()) {
    return vacio(
      "La búsqueda con IA está apagada: falta OPENAI_API_KEY en el servidor. " +
      "Los modelos se pueden seguir dando de alta a mano desde «Nueva referencia».",
    );
  }
  if (!consulta.fabricante || !consulta.medida) {
    return vacio(
      "Hace falta decir la marca y la medida. Por ejemplo: " +
      "«Busca modelos de neumáticos CEAT en 295/80R22.5».",
    );
  }

  const r = await pedirIA<{ modelos: CandidatoCrudo[]; sin_resultados_fiables: boolean }>({
    operacion: "tyrecontrol.catalogoIA.buscar",
    proposito: "documento",
    prompt: instrucciones(consulta),
    esquema: ESQUEMA as any,
    herramientas: [{ type: "web_search" }],
    maxTokens: 6000,
    // Buscar en varias páginas y transcribirlas lleva su tiempo; el minuto por
    // defecto se queda corto y cortarlo a mitad devuelve una lista a medias.
    timeoutMs: 180_000,
  });

  if (!r.ok) {
    // El error del proveedor se cuenta tal cual: «no hay resultados» y «no he
    // podido buscar» son cosas distintas y la pantalla tiene que decir cuál.
    return vacio(`No se ha podido buscar: ${r.error ?? "el proveedor de IA no ha contestado"}.`);
  }

  const citas = r.citas ?? [];
  const datos = r.datos;

  // Ni una llamada a la herramienta = contestó de memoria. En un catálogo eso
  // no vale: se devuelve vacío y se explica.
  if (r.buscoEnWeb === false) {
    return {
      ok: false, candidatos: [], citas: [],
      aviso:
        "La IA ha contestado sin usar la búsqueda web, así que no hay nada verificado " +
        "que ofrecer. Suele pasar si esa herramienta no está habilitada en la cuenta de " +
        "OpenAI. Vuelve a intentarlo; si se repite, hay que mirar la configuración.",
    };
  }

  if (!datos || datos.sin_resultados_fiables || !Array.isArray(datos.modelos) || !datos.modelos.length) {
    return {
      ok: true, candidatos: [], citas,
      aviso: `No se han encontrado modelos de ${consulta.fabricante} en ${consulta.medida} con una fuente que lo respalde.`,
    };
  }

  return { ok: true, candidatos: datos.modelos.slice(0, MAX_MODELOS), citas, aviso: "" };
}
