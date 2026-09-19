import { pedirIA } from "../../core/openaiService.ts";

/**
 * Leer el número de serie de una goma NUEVA para etiquetarla.
 *
 * ── Por qué no vale el lector del flanco tal cual ───────────────────────────
 *
 * Porque no es el mismo encargo. Aquel lee un flanco entero —marca, medida,
 * índices, DOT— para buscar la rueda en el catálogo, y su instrucción dice que
 * el número de serie es el que va ESTAMPADO en el caucho, con una lista de
 * cosas que no lo son.
 *
 * En las gomas nuevas de verdad, el número suele venir impreso en una PEGATINA
 * blanca con código de barras pegada al flanco. Con la instrucción del flanco,
 * el modelo ve esa etiqueta y no la da por buena: devuelve null y el operario
 * acaba tecleando diez dígitos a mano de una foto que se lee perfectamente.
 *
 * Así que aquí se le pide UNA sola cosa —el número— y se le dice dónde puede
 * estar. El servicio de IA es el mismo (`pedirIA`), el endpoint es el mismo y
 * las fotos van al mismo bucket: lo único distinto es la pregunta.
 *
 * Y sigue siendo una PROPUESTA: no guarda nada, no crea neumáticos y lo
 * confirma una persona antes de imprimir.
 */

export interface LecturaEtiqueta {
  /** El número tal cual se lee. null si no se ve. */
  numero_serie: string | null;
  /** 0..1 cuando el modelo la da. */
  confianza: number | null;
  /** Por qué no se ha podido leer, cuando aplica. */
  aviso: string | null;
}

export interface LectorSerie {
  leer(imagenUrl: string): Promise<LecturaEtiqueta>;
}

const ESQUEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    numero_serie: { type: ["string", "null"] },
    confianza: { type: ["number", "null"] },
    aviso: { type: ["string", "null"] },
  },
  required: ["numero_serie", "confianza", "aviso"],
} as const;

const INSTRUCCIONES = `Lees el NÚMERO DE SERIE de un neumático nuevo en una fotografía de su flanco.

Es lo ÚNICO que se te pide. No hace falta la marca, ni la medida, ni el modelo.

DÓNDE ESTÁ EL NÚMERO. Puede aparecer de dos maneras, y las dos valen:

1. En una PEGATINA pegada al flanco, normalmente blanca, con un CÓDIGO DE
   BARRAS y una cifra impresa justo debajo o al lado. Ese número es el que
   quieres. Es el caso más frecuente en gomas nuevas.
2. Estampado en relieve en el propio caucho, junto a la marca o cerca del DOT.

Si ves las dos cosas, manda la pegatina: es la que se ha puesto para
identificar ESTA rueda.

QUÉ NO ES EL NÚMERO DE SERIE, por mucho que sea un número:

- la medida (315/80R22.5, 295/80 R 22.5);
- los índices de carga y la letra de velocidad (156/150 L);
- el DOT (cuatro cifras de semana y año, precedidas o no del código de
  fábrica);
- códigos de homologación o marcado: E4, ECE, DOT, TWI, M+S, 3PMSF, la presión
  máxima en kPa o PSI, el número de lonas.

REGLAS:

1. Cópialo TAL CUAL: mismos dígitos, mismas letras, mismos guiones. No lo
   "arregles" ni le quites ceros de delante.
2. NO ADIVINES. Si de verdad no se ve ningún número de serie, devuelve null;
   es un resultado válido y no un fallo.
3. Si lo lees pero dudas de alguna cifra (un 6 que puede ser un 8), DALO
   IGUALMENTE y baja la confianza por debajo de 0.5. Una persona lo va a
   comprobar contra la foto antes de imprimir nada; un hueco, en cambio, le
   obliga a teclearlo entero.
4. Si la foto no permite leer —borrosa, oscura, cortada, la etiqueta tapada o
   arrugada—, dilo en aviso en una frase. Si se lee bien, aviso es null.
5. Si en la foto hay más de una rueda o más de una etiqueta, lee la que esté
   en primer plano y dilo en aviso.`;

export class LectorSerieIA implements LectorSerie {
  async leer(imagenUrl: string): Promise<LecturaEtiqueta> {
    const r = await pedirIA<LecturaEtiqueta>({
      prompt: INSTRUCCIONES,
      imagenes: [{ url: imagenUrl }],
      proposito: "documento",
      esquema: { nombre: "numero_serie_etiqueta", schema: ESQUEMA as unknown as Record<string, unknown> },
      operacion: "tyrecontrol.etiquetas.leer",
      maxTokens: 400,
      timeoutMs: 45_000,
    });

    // Un fallo del servicio no rompe nada: la foto se queda sin número y se
    // escribe a mano o se reintenta. La IA ayuda; no es un requisito.
    if (!r.ok || !r.datos) {
      return {
        numero_serie: null,
        confianza: null,
        aviso: r.error || "El servicio de lectura no ha respondido",
      };
    }
    return {
      numero_serie: r.datos.numero_serie ?? null,
      confianza: r.datos.confianza ?? null,
      aviso: r.datos.aviso ?? null,
    };
  }
}
