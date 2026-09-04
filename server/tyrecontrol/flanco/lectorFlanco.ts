import { pedirIA } from "../../core/openaiService.ts";
import { prepararPropuesta, type LecturaFlanco, type PropuestaFlanco } from "./flanco.ts";

/**
 * Leer el flanco de un neumático de una fotografía.
 *
 * El proveedor queda detrás de esta interfaz igual que en el OCR de fichas
 * técnicas: hoy lo resuelve el mismo modelo de visión que ya usa el resto del
 * servidor, y mañana se puede cambiar sin tocar el endpoint.
 *
 * REGLA DE LA CASA, y no es negociable: esto PROPONE. No guarda nada, no crea
 * neumáticos y no toca el catálogo. Lo confirma una persona.
 */
export interface LectorFlanco {
  leer(imagenUrl: string): Promise<PropuestaFlanco>;
}

const CAMPO = {
  type: "object",
  additionalProperties: false,
  properties: {
    valor: { type: ["string", "null"] },
    confianza: { type: ["number", "null"] },
  },
  required: ["valor", "confianza"],
} as const;

const ESQUEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    marca: CAMPO, modelo: CAMPO, medida: CAMPO,
    indice_carga_simple: CAMPO, indice_carga_doble: CAMPO,
    codigo_velocidad: CAMPO, dot: CAMPO,
    otros_textos: { type: "array", items: { type: "string" } },
    aviso: { type: ["string", "null"] },
  },
  required: [
    "marca", "modelo", "medida", "indice_carga_simple", "indice_carga_doble",
    "codigo_velocidad", "dot", "otros_textos", "aviso",
  ],
} as const;

const INSTRUCCIONES = `Eres un técnico de neumáticos leyendo el FLANCO de una rueda en una fotografía.

Devuelve EXCLUSIVAMENTE lo que SE VE ESCRITO en el flanco. Para cada campo da
el valor y tu confianza de 0 a 1 en haberlo leído bien.

Campos:
- marca: el fabricante ("Michelin", "Bridgestone", "Hankook"…).
- modelo: el nombre del dibujo ("X Multi D", "R297", "KMAX S"…).
- medida: tal como aparece ("315/80R22.5", "295/80 R 22.5").
- indice_carga_simple y indice_carga_doble: los números de carga ("156", "150").
- codigo_velocidad: la letra final ("L", "M", "K").
- dot: los cuatro dígitos de semana y año ("2325"). Si ves el código de fábrica
  completo, devuelve la línea entera y ya se recortará.
- otros_textos: cualquier otro texto técnico legible del flanco.
- aviso: si la foto no permite leer (borrosa, oscura, sucia, cortada, se ven
  varias ruedas…), explícalo en una frase. Si se lee bien, null.

REGLAS QUE NO PUEDES SALTARTE:

1. NO ADIVINES. Si un dato no se ve, ponlo a null. Un dato inventado con
   aspecto de bueno es peor que un hueco: lo confirmarán sin mirar.
2. Si dudas entre dos lecturas (un 6 que puede ser un 8), da la que creas y
   BAJA la confianza por debajo de 0.5.
3. No deduzcas la medida del aspecto de la rueda ni el modelo del dibujo de la
   banda de rodadura. Solo texto leído.
4. Si en la foto hay más de un neumático, lee el que esté en primer plano y
   dilo en aviso.`;

export class LectorFlancoIA implements LectorFlanco {
  async leer(imagenUrl: string): Promise<PropuestaFlanco> {
    const r = await pedirIA<LecturaFlanco>({
      prompt: INSTRUCCIONES,
      imagenes: [{ url: imagenUrl }],
      proposito: "documento",
      esquema: { nombre: "lectura_flanco", schema: ESQUEMA as unknown as Record<string, unknown> },
      operacion: "tyrecontrol.flanco.leer",
      maxTokens: 1200,
      timeoutMs: 45_000,
    });

    // Un fallo del servicio no puede dejar al técnico tirado: se devuelve una
    // propuesta vacía con el motivo y él sigue a mano. La IA ayuda; no es un
    // requisito para terminar la revisión.
    if (!r.ok || !r.datos) {
      return { ...prepararPropuesta(null), aviso: r.error || "El servicio de identificación no ha respondido" };
    }
    return prepararPropuesta(r.datos);
  }
}
