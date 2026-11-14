/**
 * Leer UNA hoja del parte «PROGRAMA MANTENIMIENTO INTEGRAL FLOTAS».
 *
 * Es el impreso de Truck Service Confort Auto / Grupo Soledad con el que Plana
 * hace las revisiones a mano. Llega escaneado: un PDF que por dentro es una
 * foto de un papel, sin una letra de texto seleccionable.
 *
 * Vive en el servidor porque la clave de OpenAI no sale de aquí, y como el
 * lector del otro impreso devuelve una PROPUESTA: no escribe nada, no crea
 * revisiones y no monta gomas. Eso lo hace el panel cuando una persona ha
 * confirmado lo que ve.
 *
 * ── Se le pide TRANSCRIBIR, no interpretar ─────────────────────────────────
 *
 * Qué rueda del vehículo es la fila 4, si las comillas significan «lo mismo
 * que arriba» y qué configuración de ejes tiene el camión lo decide
 * `src/modules/tyrecontrol/services/parteFlotas.ts`, que es código puro y con
 * pruebas. Un modelo que además interpreta es un modelo al que no se le puede
 * revisar el trabajo.
 *
 * Las comillas son el ejemplo claro: aquí se pide que se copien tal cual, y
 * se rellenan hacia abajo después. Pedirle al modelo que las resuelva es
 * pedirle que razone sobre filas que todavía no ha terminado de leer.
 *
 * ── ESTE LECTOR NO ESTÁ VALIDADO ───────────────────────────────────────────
 *
 * Se ha escrito mirando 14 partes reales, pero NO se ha ejecutado ni una vez
 * contra ellos: en el entorno donde se programó no había clave de OpenAI. Las
 * instrucciones son una hipótesis informada, no una medición.
 *
 * Lo que hay que comprobar en la primera pasada, en este orden:
 *
 *   1. Las profundidades. Son el dato que se viene a buscar y el que acaba en
 *      el histórico del neumático. 14 hojas × 6-8 ruedas ≈ 90 números.
 *   2. El número de unidad, que es por donde casa el vehículo.
 *   3. El croquis marcado, que es lo único que dice la configuración de ejes.
 *   4. Las dos hojas escaneadas del revés.
 */

import { pedirIA } from "../../core/openaiService.ts";

/** Una fila de la tabla, tal cual está escrita. */
export interface FilaHojaFlotas {
  pos: number | null;
  medida: string | null;
  marca: string | null;
  modelo: string | null;
  numero_serie: string | null;
  fecha_dot: string | null;
  profundidad_mm: number | null;
  recauchutado: string | null;
  reestriado: string | null;
  llanta_ha: string | null;
  llanta_cd: string | null;
  llanta_gp: string | null;
}

export interface HojaFlotas {
  fecha: string | null;
  base: string | null;
  cliente: string | null;
  taller: string | null;
  matricula: string | null;
  /** Lo escrito en la casilla rotulada «Km.», que NO son kilómetros. */
  numero_unidad: string | null;
  /** El croquis marcado con una X, p. ej. `C2-4`. */
  croquis: string | null;
  filas: FilaHojaFlotas[];
  /** 0 a 1. Lo flojo que viene el escaneo, en conjunto. */
  confianza: number | null;
  /** Lo que el modelo quiera avisar: una hoja torcida, una celda ilegible. */
  aviso: string | null;
}

const TXT = { type: ["string", "null"] } as const;
const NUM = { type: ["number", "null"] } as const;

const ESQUEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    fecha: TXT, base: TXT, cliente: TXT, taller: TXT,
    matricula: TXT, numero_unidad: TXT, croquis: TXT,
    filas: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          pos: NUM, medida: TXT, marca: TXT, modelo: TXT,
          numero_serie: TXT, fecha_dot: TXT, profundidad_mm: NUM,
          recauchutado: TXT, reestriado: TXT,
          llanta_ha: TXT, llanta_cd: TXT, llanta_gp: TXT,
        },
        required: [
          "pos", "medida", "marca", "modelo", "numero_serie", "fecha_dot",
          "profundidad_mm", "recauchutado", "reestriado",
          "llanta_ha", "llanta_cd", "llanta_gp",
        ],
      },
    },
    confianza: NUM,
    aviso: TXT,
  },
  required: [
    "fecha", "base", "cliente", "taller", "matricula", "numero_unidad",
    "croquis", "filas", "confianza", "aviso",
  ],
} as const;

const INSTRUCCIONES = `Transcribes UNA hoja del parte de revisión de neumáticos «PROGRAMA
MANTENIMIENTO INTEGRAL FLOTAS», de Truck Service Confort Auto / Grupo Soledad.
Es un papel preimpreso rellenado A MANO, en bolígrafo azul, y escaneado.

COPIAS lo que pone. No interpretas: no decidas qué rueda del vehículo es cada
número ni resuelvas las comillas de «ídem». De eso se encarga otro.

ALGUNAS HOJAS VIENEN ESCANEADAS DEL REVÉS (giradas 180°). Si la ves así,
léela girada. No es un error del papel.

CABECERA
- fecha: la casilla FECHA, tal como está escrita (p. ej. "09-11-2026").
- base: la casilla BASE (suele ser una sola letra).
- cliente: la casilla CLIENTE.
- taller: la casilla TALLER (casi siempre vacía).
- matricula: la casilla MATRÍCULA. Cópiala TAL COMO SE VE, sin quitar ni
  añadir espacios ni guiones.
- numero_unidad: lo escrito en la casilla de al lado, rotulada «Km.». OJO: a
  pesar del rótulo NO son kilómetros, es el número de unidad del vehículo, de
  tres o cuatro cifras. Cópialo igual. Si de verdad hubiera un kilometraje de
  seis cifras, cópialo también aquí.

LA TABLA
Hay DOS tablas iguales, una debajo de otra, con filas POS 1..8 y R. Transcribe
SOLO LA PRIMERA. La segunda va siempre vacía; si tuviera algo, dilo en "aviso".

Sus columnas, en este orden:
POS | MEDIDA | MARCA | MODELO | Nº DE SERIE | FECHA DOT | PROFUNDIDAD |
RECAUCHUTADO | REESTRIADO | LLANTA (H/A, C/D, G/P)

- Devuelve una entrada en "filas" POR CADA FILA CON ALGO ESCRITO. Las vacías
  no se devuelven: casi nunca van las ocho.
- pos: el número impreso de la fila (1..8). La fila "R" es la de recambio:
  devuélvela con pos = null y dilo en "aviso".
- profundidad_mm: el número de la columna PROFUNDIDAD, en milímetros. Suele
  ser un entero de una o dos cifras. Es EL DATO MÁS IMPORTANTE DE LA HOJA: si
  una cifra no se lee con seguridad, deja null y dilo en "aviso" en vez de
  arriesgar. Un 6 y un 8 manuscritos se parecen.
- LAS COMILLAS DE «ÍDEM»: en MEDIDA, MARCA y MODELO es normal que una fila
  lleve comillas queriendo decir «lo mismo que la de arriba». NO las resuelvas.
  Transcríbelas SIEMPRE como una comilla doble: "
  Da igual cómo estén escritas en el papel.
- numero_serie y fecha_dot van casi siempre vacíos. Si en la casilla del Nº DE
  SERIE hay una FRASE en vez de un código (por ejemplo «Cambio y alinear»),
  cópiala igual: es una nota que alguien quiso dejar.
- recauchutado, reestriado y las tres de LLANTA (H/A, C/D, G/P) suelen ir
  vacías. Si llevan una marca, devuelve "X".

EL CROQUIS
Al pie hay seis dibujos de configuración de ejes, cada uno con su casilla y su
nombre: C2-4, C2-2-4, C2-4-2, R2-2-2, R2-2, R4-4.
- croquis: el nombre del que esté MARCADO con una X o un aspa.
- La marca ESTÁ MUCHAS VECES FUERA de su casilla: encima del dibujo, entre dos
  dibujos o al margen. Devuelve el que quede más cerca.
- Si hay duda entre dos, o no hay ninguna marca, devuelve null y dilo en
  "aviso". Es preferible a acertar por casualidad.

CONFIANZA Y AVISOS
- confianza: de 0 a 1, lo legible que viene la hoja EN CONJUNTO. Algunos
  escaneos salen tan flojos que la rejilla impresa casi no se ve.
- aviso: en una frase, lo que haya que mirar a mano. Vacío si todo está claro.

Si la hoja no es de este impreso, devuelve filas vacío y dilo en "aviso".`;

export interface LectorHojaFlotas {
  leer(hoja: { dataUri: string; nombre?: string }): Promise<HojaFlotas>;
}

const VACIA: HojaFlotas = {
  fecha: null, base: null, cliente: null, taller: null,
  matricula: null, numero_unidad: null, croquis: null,
  filas: [], confianza: null, aviso: null,
};

export class LectorHojaFlotasIA implements LectorHojaFlotas {
  async leer(hoja: { dataUri: string; nombre?: string }): Promise<HojaFlotas> {
    const esPdf = /^data:application\/pdf/i.test(hoja.dataUri);
    const r = await pedirIA<HojaFlotas>({
      prompt: INSTRUCCIONES,
      // Un PDF va como archivo y una foto como imagen: la Responses API las
      // trata distinto y mandar un PDF como imagen no lee nada.
      ...(esPdf
        ? { archivos: [{ nombre: hoja.nombre ?? "hoja.pdf", dataUri: hoja.dataUri }] }
        : { imagenes: [{ url: hoja.dataUri }] }),
      proposito: "documento",
      esquema: { nombre: "hoja_mantenimiento_flotas", schema: ESQUEMA as unknown as Record<string, unknown> },
      operacion: "tyrecontrol.parteFlotas.leer",
      // Una sola hoja: ocho filas de doce campos. Con 3000 sobra y no se corta
      // a media tabla, que es como falla esto cuando se queda corto.
      maxTokens: 3000,
      timeoutMs: 90_000,
    });

    if (!r.ok || !r.datos) {
      return { ...VACIA, aviso: r.error || "El servicio de lectura no ha respondido" };
    }
    // `filas` puede faltar aunque el esquema la pida: se normaliza aquí para
    // que quien lo use no tenga que defenderse de eso.
    return {
      ...VACIA,
      ...r.datos,
      filas: Array.isArray(r.datos.filas) ? r.datos.filas : [],
    };
  }
}
