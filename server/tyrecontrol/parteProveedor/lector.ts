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

export interface ParteLeido {
  pt_numero: string | null;
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

const ESQUEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    pt_numero: TXT,
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
    "pt_numero", "fecha", "matricula", "numero_unidad", "km", "cliente_nombre",
    "cliente_cif", "tecnico", "filas", "productos", "confianza", "aviso",
  ],
} as const;

const INSTRUCCIONES = `Transcribes un parte de trabajo de un taller de neumáticos. Es un papel escaneado.

Tu trabajo es COPIAR lo que pone, no interpretarlo. No decidas qué rueda del
vehículo es cada número, ni si un cambio está bien hecho: de eso se encarga
otro. Tú transcribes.

QUÉ HAY EN EL PAPEL

1. Una cabecera: número de PT, fecha, cliente con su CIF, matrícula, un número
   de unidad o de vehículo, y los kilómetros.

2. Un cuadro "EXAMEN DEL VEHÍCULO" con una fila por rueda, numeradas 1, 2, 3…
   Cada fila puede traer: presión (PRES.), profundidad interior (MM int),
   profundidad exterior (MM ext) y una operación (OP.), que suele ser algo como
   "NUEV". La mayoría de las filas están VACÍAS: el cuadro tiene 23 huecos y un
   camión tiene 6 o 10 ruedas.

3. Un bloque "PRODUCTOS Y SERVICIOS" con descripción, unidades y precios.

REGLAS

1. Devuelve SOLO las filas del cuadro que tengan algún dato. Una fila
   completamente vacía no se devuelve.
2. Los números, tal cual: la coma decimal española es un punto en el JSON
   ("14,9" es 14.9), y los miles del kilometraje no llevan separador
   ("1.018.417" es 1018417). No redondees.
3. La matrícula, tal cual, sin espacios ni guiones añadidos.
4. Si una casilla está vacía o no se lee, es null. NO ADIVINES: un número
   inventado en una profundidad entra en el histórico del neumático y descuadra
   lo que ha durado esa goma. El hueco se puede rellenar; el dato falso, no,
   porque nadie sabe que lo es.
5. Si dudas de una cifra (un 6 que puede ser un 8), transcríbela igualmente y
   baja la confianza por debajo de 0.5, diciendo en aviso cuál es.
6. En productos, copia la descripción ENTERA aunque parezca abreviada
   ("MONTAJE FIJACIÓN(QUIT.PONER)CM" se copia así). Las medidas de neumático
   también tal cual, aunque lleven X donde debería ir R.
7. Si el papel está cortado, borroso o falta la parte de abajo, dilo en aviso
   en una frase. Si se lee bien, aviso es null.
8. Si el documento NO es un parte de trabajo de neumáticos, devuelve todo a
   null, las listas vacías, y dilo en aviso.`;

export interface LectorParte {
  leer(fichero: { dataUri: string; nombre?: string }): Promise<ParteLeido>;
}

const VACIO: ParteLeido = {
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
      maxTokens: 4000,
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
    };
  }
}
