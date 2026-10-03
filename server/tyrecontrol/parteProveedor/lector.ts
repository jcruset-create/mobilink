/**
 * Leer el parte de trabajo que manda el taller.
 *
 * Llega escaneado: un PDF que por dentro es una foto de un papel, sin una
 * letra de texto seleccionable. Dentro está lo que de verdad le pasó al
 * vehículo —las presiones y profundidades rueda a rueda, cuáles se cambiaron,
 * qué gomas se pusieron y qué se facturó— y hoy eso se teclea a mano, ocho
 * filas por parte. Por eso casi nunca se teclea.
 *
 * Esto vive en el servidor por la misma razón que el lector de etiquetas: la
 * clave de OpenAI no sale de aquí. Y, como aquél, devuelve una PROPUESTA: no
 * escribe nada, no crea neumáticos y lo confirma una persona.
 *
 * ── Lo que se le pide al modelo, y lo que no ────────────────────────────────
 *
 * Se le pide TRANSCRIBIR, no interpretar. Qué rueda es la número 4 de este
 * vehículo, si «NUEV» significa montaje o sustitución y si la cubierta
 * facturada cuadra con las ruedas marcadas lo decide `parteProveedor.ts`, que
 * es código puro y con pruebas. Un modelo que además interpreta es un modelo
 * al que no se le puede revisar el trabajo.
 */

import { pedirIA } from "../../core/openaiService.ts";

/** Una fila del cuadro de examen, tal cual está escrita en el papel. */
export interface FilaLeida {
  posicion: number | null;
  presion_bar: number | null;
  mm_int: number | null;
  mm_ext: number | null;
  operacion: string | null;
  montadas: string | null;
  quitadas: string | null;
}

export interface ProductoLeido {
  descripcion: string;
  unidades: number | null;
  precio_unitario: number | null;
  precio_total: number | null;
}

/** Una goma de las tablas de desmontadas o montadas de la O.R. */
export interface GomaLeida {
  posicion: number | null;
  marca: string | null;
  medida: string | null;
  modelo: string | null;
  numero_serie: string | null;
  dot: string | null;
  mm: number | null;
  destino: string | null;
}

export interface ParteLeido {
  formato: "examen" | "orden_reparacion" | null;
  pt_numero: string | null;
  or_numero: string | null;
  albaran_numero: string | null;
  croquis: string | null;
  desmontados: GomaLeida[];
  montados: GomaLeida[];
  fecha: string | null;
  matricula: string | null;
  numero_unidad: string | null;
  km: number | null;
  cliente_nombre: string | null;
  cliente_cif: string | null;
  tecnico: string | null;
  filas: FilaLeida[];
  productos: ProductoLeido[];
  confianza: number | null;
  aviso: string | null;
}

const NUM = { type: ["number", "null"] } as const;
const TXT = { type: ["string", "null"] } as const;

const GOMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    posicion: NUM, marca: TXT, medida: TXT, modelo: TXT,
    numero_serie: TXT, dot: TXT, mm: NUM, destino: TXT,
  },
  required: ["posicion", "marca", "medida", "modelo", "numero_serie", "dot", "mm", "destino"],
} as const;

const ESQUEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    formato: { type: ["string", "null"], enum: ["examen", "orden_reparacion", null] },
    pt_numero: TXT,
    or_numero: TXT,
    albaran_numero: TXT,
    croquis: TXT,
    desmontados: { type: "array", items: GOMA },
    montados: { type: "array", items: GOMA },
    fecha: TXT,
    matricula: TXT,
    numero_unidad: TXT,
    km: NUM,
    cliente_nombre: TXT,
    cliente_cif: TXT,
    tecnico: TXT,
    filas: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          posicion: NUM, presion_bar: NUM, mm_int: NUM, mm_ext: NUM,
          operacion: TXT, montadas: TXT, quitadas: TXT,
        },
        required: ["posicion", "presion_bar", "mm_int", "mm_ext", "operacion", "montadas", "quitadas"],
      },
    },
    productos: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          descripcion: { type: "string" }, unidades: NUM,
          precio_unitario: NUM, precio_total: NUM,
        },
        required: ["descripcion", "unidades", "precio_unitario", "precio_total"],
      },
    },
    confianza: NUM,
    aviso: TXT,
  },
  required: [
    "formato", "pt_numero", "or_numero", "albaran_numero", "croquis", "desmontados", "montados",
    "fecha", "matricula", "numero_unidad", "km", "cliente_nombre",
    "cliente_cif", "tecnico", "filas", "productos", "confianza", "aviso",
  ],
} as const;

const INSTRUCCIONES = `Transcribes partes de trabajo de un taller de neumáticos. Son papeles escaneados,
a veces rellenados A MANO, y un mismo PDF puede traer varias hojas del mismo
trabajo (por ejemplo, el albarán y la hoja de la orden de reparación).

Tu trabajo es COPIAR lo que pone, no interpretarlo. No decidas qué rueda del
vehículo es cada número ni si el cambio está bien hecho: de eso se encarga
otro. Tú transcribes.

HAY DOS IMPRESOS. Di cuál es en "formato":

A) "examen": tiene un cuadro "EXAMEN DEL VEHÍCULO" con una fila por rueda
   (1, 2, 3…) y columnas PRES., MM int, MM ext y OP. (que suele decir "NUEV").
   Lleva un número de PT. Rellena "filas" con las filas que tengan algún dato
   (el cuadro tiene 23 huecos y casi todos van vacíos) y deja "desmontados" y
   "montados" vacíos.

B) "orden_reparacion": hoja con "Nº O.R.", casillas de croquis (C2-4, C2-2-4,
   C2-4-2, R2-2-2, R2-2, R4-4…) y dos tablas: "NEUMÁTICOS DESMONTADOS/PERMUTADOS"
   y "NEUMÁTICOS MONTADOS/PERMUTADOS", con posición, marca, medida, modelo,
   Nº de serie, DOT y mm. Suele venir con su ALBARÁN (a máquina, con
   "Albarán: B2_…", "Trabajos realizados", cantidades y precios).
   - "croquis": el que esté MARCADO con una X (p. ej. "C2-4"). Si no hay
     ninguno marcado, null.
   - "desmontados": una entrada por fila de la tabla de desmontadas.
   - "montados": una entrada por fila de la tabla de montadas.
   - En la columna mm de las montadas suele haber una "N" (nueva): eso NO es
     una profundidad; deja mm a null.
   - Las comillas (") o "id." debajo de una marca, medida o modelo significan
     "lo mismo que la fila de arriba": copia el valor de arriba.
   - Si en el Nº de serie pone "BORRADO" o similar, cópialo tal cual: es un
     dato, no un hueco.
   - "destino": la letra de la columna Destino (D, R, AT, AF, RE, MV) o null.
   - "or_numero" y "albaran_numero": los dos, si están.
   Deja "filas" vacío.

EN LOS DOS

- "productos": las líneas facturadas (del albarán o del bloque de productos)
  Y los servicios marcados en la hoja ("Desmontar/Montar cubierta: Camión 4"
  es la descripción "Desmontar/Montar cubierta camión" con unidades 4). Copia
  la descripción ENTERA aunque parezca abreviada ("MONTAJE FIJACIÓN(QUIT.PONER)CM"
  se copia así). Si un mismo servicio sale en el albarán y en la hoja, ponlo
  UNA vez, con los datos del albarán.
- Cabecera: matrícula (sin espacios ni guiones añadidos), kilómetros, fecha,
  cliente con su CIF/NIF, número de unidad o de vehículo, técnico.

REGLAS

1. Los números, tal cual: la coma decimal española es un punto en el JSON
   ("14,9" es 14.9) y los miles del kilometraje no llevan separador
   ("391.038" es 391038). No redondees.
2. Si una casilla está vacía o no se lee, es null. NO ADIVINES: un número de
   serie o una profundidad inventados entran en el histórico del neumático y
   nadie sabe que son falsos. El hueco se rellena; el dato falso, no.
3. Lo escrito a mano es lo más difícil. Si dudas de una cifra (un 7 que puede
   ser un 1, un 2 que puede ser un 7), transcríbela igualmente, baja la
   confianza por debajo de 0.5 y di en aviso qué cifra y de qué campo.
4. Las medidas de neumático, tal cual, aunque lleven X o barras donde debería
   ir R ("295/80/225", "295/80X22.5").
5. Si el papel está cortado, borroso o falta una parte, dilo en aviso en una
   frase. Si se lee bien, aviso es null.
6. Si el documento NO es un parte de trabajo de neumáticos, formato es null,
   todo lo demás a null, las listas vacías, y dilo en aviso.`;

export interface LectorParte {
  leer(fichero: { dataUri: string; nombre?: string }): Promise<ParteLeido>;
}

const VACIO: ParteLeido = {
  formato: null, or_numero: null, albaran_numero: null, croquis: null,
  desmontados: [], montados: [],
  pt_numero: null, fecha: null, matricula: null, numero_unidad: null, km: null,
  cliente_nombre: null, cliente_cif: null, tecnico: null,
  filas: [], productos: [], confianza: null, aviso: null,
};

export class LectorParteIA implements LectorParte {
  async leer(fichero: { dataUri: string; nombre?: string }): Promise<ParteLeido> {
    const esPdf = /^data:application\/pdf/i.test(fichero.dataUri);
    const r = await pedirIA<ParteLeido>({
      prompt: INSTRUCCIONES,
      // Un PDF va como archivo y una foto como imagen: la Responses API las
      // trata distinto y mandar un PDF como imagen no lee nada.
      ...(esPdf
        ? { archivos: [{ nombre: fichero.nombre ?? "parte.pdf", dataUri: fichero.dataUri }] }
        : { imagenes: [{ url: fichero.dataUri }] }),
      proposito: "documento",
      esquema: { nombre: "parte_trabajo_proveedor", schema: ESQUEMA as unknown as Record<string, unknown> },
      operacion: "tyrecontrol.parteProveedor.leer",
      // Un parte con 10 ruedas y 12 líneas de producto no cabe en 400.
      // Dos hojas, ocho gomas con serie y DOT y una docena de líneas: con 4000
      // el modelo se quedaba corto a media tabla y devolvía un JSON cortado.
      maxTokens: 8000,
      timeoutMs: 120_000,
    });

    if (!r.ok || !r.datos) {
      return { ...VACIO, aviso: r.error || "El servicio de lectura no ha respondido" };
    }
    // Las listas pueden faltar aunque el esquema las pida: se normalizan aquí
    // para que quien lo use no tenga que defenderse de eso.
    return {
      ...VACIO,
      ...r.datos,
      filas: Array.isArray(r.datos.filas) ? r.datos.filas : [],
      productos: Array.isArray(r.datos.productos) ? r.datos.productos : [],
      desmontados: Array.isArray(r.datos.desmontados) ? r.datos.desmontados : [],
      montados: Array.isArray(r.datos.montados) ? r.datos.montados : [],
    };
  }
}
