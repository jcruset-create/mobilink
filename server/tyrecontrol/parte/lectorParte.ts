import { pedirIA } from "../../core/openaiService.ts";
import { prepararParte, type ParteLeido, type Parte } from "./parte.ts";

/**
 * Leer un parte de servicio de un puñado de fotografías.
 *
 * Todas las fotos son del MISMO parte: la matrícula, el cuentakilómetros, el
 * vehículo y los flancos de las gomas. Van juntas en una sola petición a
 * propósito — así el modelo puede cruzarlas, reconocer que dos fotos son de la
 * misma rueda y no repetirla.
 *
 * PROPONE. No guarda nada. Lo confirma el técnico.
 */
export interface LectorParte {
  leer(imagenes: string[]): Promise<Parte>;
}

const CAMPO = {
  type: "object", additionalProperties: false,
  properties: { valor: { type: ["string", "null"] }, confianza: { type: ["number", "null"] } },
  required: ["valor", "confianza"],
} as const;

const ESQUEMA = {
  type: "object", additionalProperties: false,
  properties: {
    plate: CAMPO, kilometers: CAMPO, vehicle: CAMPO, fleet: CAMPO, date: CAMPO,
    tires: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        properties: {
          brand: CAMPO, model: CAMPO, serial_number: CAMPO,
          dimension: CAMPO, position: CAMPO,
        },
        required: ["brand", "model", "serial_number", "dimension", "position"],
      },
    },
    warnings: { type: "array", items: { type: "string" } },
  },
  required: ["plate", "kilometers", "vehicle", "fleet", "date", "tires", "warnings"],
} as const;

const INSTRUCCIONES = `Eres un técnico de neumáticos rellenando un parte de servicio a partir de
fotografías. TODAS las fotos son del MISMO parte: el mismo vehículo y sus ruedas.

Devuelve, con su confianza de 0 a 1 en cada dato:

- plate: la matrícula, TAL COMO SE VE. Conserva letras, números, espacios y
  guiones: no los quites ni los añadas.
- kilometers: la lectura del cuentakilómetros, con TODAS sus cifras.
- vehicle: qué vehículo es, si se puede saber (marca, modelo o tipo).
- fleet: el nombre de la flota o del cliente, solo si aparece escrito.
- date: la fecha, solo si aparece.
- tires: un objeto POR CADA NEUMÁTICO DISTINTO que veas, con brand, model,
  serial_number (el número de serie o DOT grabado en la goma), dimension
  (315/80R22.5) y position (E1_IZQ, delantera derecha… si se puede saber).
- warnings: una frase por cada problema que impida leer algo (foto borrosa,
  oscura, sucia, demasiado lejos, la goma cortada por el encuadre…).

REGLAS QUE NO PUEDES SALTARTE:

1. NO ADIVINES. Lo que no se vea, a null. Un dato inventado con aspecto de
   bueno es peor que un hueco: lo confirmarán sin mirar.
2. Si dudas entre dos lecturas (un 6 que puede ser un 8), da la que creas y
   BAJA la confianza por debajo de 0.5.
3. NO CONFUNDAS LA DIMENSIÓN CON EL NÚMERO DE SERIE. "315/80R22.5" es la
   dimensión. El número de serie o DOT es otra cosa y va en su campo.
4. Presta atención especial a los números MOLDEADOS o GRABADOS en la goma: van
   en relieve, con poco contraste, y son los que más se leen mal. Si no se leen,
   deja serial_number vacío y dilo en warnings.
5. Si varias fotos son de la MISMA rueda, devuélvela UNA SOLA VEZ, juntando lo
   que hayas podido leer en cada una.
6. Ruedas distintas del mismo vehículo son entradas distintas AUNQUE sean
   idénticas: un camión lleva varias ruedas iguales.
7. No deduzcas la dimensión del aspecto de la rueda ni el modelo del dibujo de
   la banda de rodadura. Solo texto leído.`;

export class LectorParteIA implements LectorParte {
  async leer(imagenes: string[]): Promise<Parte> {
    if (!imagenes.length) {
      return { ...prepararParte(null), warnings: ["No se ha enviado ninguna fotografía"] };
    }
    const r = await pedirIA<ParteLeido>({
      prompt: INSTRUCCIONES,
      imagenes: imagenes.map((url) => ({ url })),
      proposito: "documento",
      esquema: { nombre: "parte_servicio", schema: ESQUEMA as unknown as Record<string, unknown> },
      operacion: "tyrecontrol.parte.leer",
      // Un parte con ocho ruedas y sus avisos no cabe en los 1.200 del flanco.
      maxTokens: 4000,
      // Varias fotos tardan más que una: el timeout del flanco se quedaría corto.
      timeoutMs: 120_000,
    });

    // Que falle el servicio no puede dejar al técnico tirado: se devuelve el
    // parte vacío con el motivo y él lo rellena a mano.
    if (!r.ok || !r.datos) {
      return {
        ...prepararParte(null),
        warnings: [r.error || "El servicio de lectura no ha respondido"],
      };
    }
    return prepararParte(r.datos);
  }
}
