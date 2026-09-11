/**
 * Convertir lo que el modelo dice haber leído en líneas con las que se puede
 * trabajar — o decir claramente que no se puede.
 *
 * El modelo lee una captura de pantalla y devuelve JSON. Este módulo es la
 * aduana: lo que pase de aquí va a compararse con dinero de verdad, así que
 * nada entra sin comprobar y **lo dudoso no se adivina, se declara**.
 *
 * Dominio puro: entra texto, salen líneas y avisos. Sin red, sin modelo, sin
 * base de datos. Que un modelo dé respuestas distintas para la misma imagen es
 * precisamente la razón de que esta parte tenga que ser determinista.
 *
 * ## La comprobación que lo sostiene todo: el total impreso
 *
 * La pantalla del ERP enseña su propia suma —«Sum = 887,40»—. Se le pide al
 * modelo que la lea TAMBIÉN, y aquí se compara con la suma de las líneas que
 * dice haber leído.
 *
 * Si no cuadran, la lectura no vale: o se ha saltado una línea, o ha leído mal
 * un importe. No se sabe cuál, y no hace falta saberlo — lo que hace falta es
 * no seguir. Es la diferencia entre «el cotejo dice que falta un cobro» y «el
 * cotejo dice que falta un cobro porque no supo leer el que sí estaba».
 *
 * Es barato, es determinista, y es lo único que convierte una lectura por
 * modelo en algo con lo que se puede contar.
 *
 * ## Los importes NO se adivinan
 *
 * `377,24` es setenta y siete con veinticuatro. `377.24` puede ser lo mismo
 * —si el modelo tradujo al formato inglés— o trescientos setenta y siete mil
 * doscientos cuarenta, si el punto es el separador de miles. Las dos lecturas
 * son plausibles y se diferencian en tres órdenes de magnitud.
 *
 * Así que se exige el formato en el que el ERP lo imprime: coma decimal y dos
 * cifras. Lo que no venga así es un aviso, no una suposición. Preferir un
 * hueco declarado a un número inventado es la misma regla que en `cotejo.ts`,
 * y aquí importa más, porque un importe mal leído no falla: cuadra mal.
 */

import type { Centimos } from "./money.ts";
import type { LineaErp } from "./cotejo.ts";

/**
 * Lo que se le pide al modelo, y lo que este fichero sabe leer.
 *
 * Vive aquí, al lado del que interpreta la respuesta, porque los dos tienen que
 * hablar del mismo contrato: si alguien cambia el prompt en otro sitio y aquí
 * no, la lectura empieza a fallar de formas que no se parecen a su causa.
 */
export const PROMPT_LECTURA = `Eres un lector de tablas. Te doy la captura de pantalla del cierre de caja de
un ERP. Devuelve SOLO un objeto JSON, sin texto alrededor y sin markdown.

{
  "lineas": [
    {
      "justificante": "20765",
      "referencia": "B2_26/611",
      "forma": "Datáfono Clearone ta...",
      "importe": "29,69",
      "tipo": "COBRO",
      "concepto": "JAVIER AMILCAR GAUNA"
    }
  ],
  "totalCobros": "887,40",
  "totalPagos": "0"
}

Reglas, y son estrictas:

- Copia los importes EXACTAMENTE como aparecen en pantalla, con su coma
  decimal. No los conviertas, no los redondees, no les quites el separador de
  miles si lo tienen. "1.234,56" se copia "1.234,56".
- "tipo" es COBRO si el importe está en la columna de cobros y PAGO si está en
  la de pagos. Nunca lo deduzcas del concepto.
- "referencia" es el número de factura o documento si lo hay (por ejemplo
  "B2_26/611"). Si la línea no lo enseña, pon null. NO lo inventes ni lo
  saques del concepto.
- "forma" es la etiqueta de forma de pago TAL CUAL está escrita, aunque esté
  cortada con puntos suspensivos.
- "totalCobros" y "totalPagos" son los totales que la propia pantalla imprime
  abajo. Si no los ves, pon null. NO los calcules tú.
- Una fila por línea de la tabla. Si una fila está cortada o no se lee, NO la
  inventes: ponla con "importe": null.`;

export type LecturaErp = {
  lineas: LineaErp[];
  /** El total que IMPRIME la pantalla, no el que sumamos nosotros. */
  totalCobrosDeclarado: Centimos | null;
  totalPagosDeclarado: Centimos | null;
  /** En castellano, para enseñar. Vacío = lectura limpia. */
  avisos: string[];
  /**
   * Lectura limpia: ni un aviso. Es el caso normal y el único sin matices.
   */
  fiable: boolean;
  /**
   * Hay algo que SABEMOS que está mal, y con esto no se coteja.
   *
   * La distinción con `fiable` costó pensarla y es la que decide si la pantalla
   * sirve o estorba. No es lo mismo:
   *
   * · **Sé que está mal** — una línea que no se pudo leer, o el total impreso
   *   que contradice la suma. Aquí seguir es peligroso: el cotejo diría «falta
   *   este cobro» por una línea que el modelo no supo leer, y alguien acabaría
   *   metiéndola dos veces. Se bloquea y se pide otra captura.
   *
   * · **No he podido comprobarlo** — la captura viene recortada y no enseña el
   *   total. La lectura puede estar perfecta; simplemente no hay con qué
   *   contrastarla. Bloquear aquí sería inventarse un problema y dejar inútil
   *   un recorte que vale.
   *
   * Así que lo segundo avisa y deja pasar, y lo primero para.
   */
  bloqueante: boolean;
};

/**
 * «1.234,56» → 123456. Solo el formato que imprime el ERP.
 *
 * Devuelve `null` cuando no está seguro, y eso incluye casos que otros
 * analizadores aceptarían encantados. Es deliberado: el que se equivoca aquí
 * no revienta, cuadra mal.
 */
export function importeAEnteros(texto: string): Centimos | null {
  const t = texto.trim().replace(/\s|€|EUR/gi, "");
  if (!t) return null;

  const negativo = t.startsWith("-");
  const cuerpo = negativo ? t.slice(1) : t;

  /*
   * Con coma: los puntos son separadores de miles y la coma es la decimal.
   * Es lo que imprime el ERP y lo único que se acepta sin rechistar.
   */
  if (cuerpo.includes(",")) {
    if (!/^\d{1,3}(\.\d{3})*,\d{1,2}$|^\d+,\d{1,2}$/.test(cuerpo)) return null;
    const [enteros, decimales] = cuerpo.split(",") as [string, string];
    const c = Number(enteros.replace(/\./g, "")) * 100 + Number(decimales.padEnd(2, "0"));
    return negativo ? -c : c;
  }

  /*
   * Sin coma y con punto: AMBIGUO, y por eso se rechaza. «377.24» son 377,24 si
   * el modelo tradujo al formato inglés y 377.240 si el punto es de miles. Las
   * dos lecturas son plausibles y se llevan tres órdenes de magnitud.
   */
  if (cuerpo.includes(".")) return null;

  /* Sin coma ni punto: entero de euros. «0» en la columna de pagos es esto. */
  if (!/^\d+$/.test(cuerpo)) return null;
  const c = Number(cuerpo) * 100;
  return negativo ? -c : c;
}

/** Quita el ```json con el que algunos modelos envuelven la respuesta. */
function desenvolver(texto: string): string {
  const t = texto.trim();
  const cercado = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return (cercado?.[1] ?? t).trim();
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export function interpretarLecturaErp(textoDelModelo: string): LecturaErp {
  const avisos: string[] = [];
  /** Avisos de los que paran: algo que sabemos mal, no algo sin comprobar. */
  let duro = false;
  const problema = (m: string) => {
    duro = true;
    avisos.push(m);
  };

  const vacia: LecturaErp = {
    lineas: [],
    totalCobrosDeclarado: null,
    totalPagosDeclarado: null,
    avisos,
    fiable: false,
    bloqueante: true,
  };

  let crudo: any;
  try {
    crudo = JSON.parse(desenvolver(textoDelModelo));
  } catch {
    problema("La respuesta no se ha podido leer como JSON. Vuelve a intentarlo.");
    return vacia;
  }

  if (!crudo || !Array.isArray(crudo.lineas)) {
    problema("La respuesta no trae ninguna lista de líneas.");
    return vacia;
  }

  const lineas: LineaErp[] = [];
  crudo.lineas.forEach((l: any, i: number) => {
    const nº = i + 1;

    const tipo = String(l?.tipo ?? "").trim().toUpperCase();
    if (tipo !== "COBRO" && tipo !== "PAGO") {
      problema(`Línea ${nº}: no se sabe si es un cobro o un pago.`);
      return;
    }

    const forma = typeof l?.forma === "string" ? l.forma.trim() : "";
    if (!forma) {
      problema(`Línea ${nº}: sin forma de pago.`);
      return;
    }

    if (l?.importe === null || l?.importe === undefined || l.importe === "") {
      /* El prompt pide que una fila ilegible venga con importe null en vez de
         inventada. Que llegue así es el sistema funcionando, no fallando. */
      problema(`Línea ${nº}: el importe no se ha podido leer en la captura.`);
      return;
    }

    const importe = importeAEnteros(String(l.importe));
    if (importe === null) {
      problema(
        `Línea ${nº}: «${String(l.importe)}» no es un importe que se pueda leer sin dudas.`
      );
      return;
    }
    if (importe < 0) {
      problema(`Línea ${nº}: importe negativo (${String(l.importe)}).`);
      return;
    }

    lineas.push({
      justificante: typeof l?.justificante === "string" ? l.justificante.trim() || null : null,
      referencia: typeof l?.referencia === "string" ? l.referencia.trim() || null : null,
      formaErp: forma,
      importeCentimos: importe,
      tipo,
      concepto: typeof l?.concepto === "string" ? l.concepto.trim() || null : null,
    });
  });

  const leerTotal = (v: unknown, nombre: string): Centimos | null => {
    if (v === null || v === undefined || v === "") return null;
    const t = importeAEnteros(String(v));
    if (t === null) problema(`El total de ${nombre} de la pantalla no se ha podido leer.`);
    return t;
  };
  const totalCobrosDeclarado = leerTotal(crudo.totalCobros, "cobros");
  const totalPagosDeclarado = leerTotal(crudo.totalPagos, "pagos");

  // ── La comprobación que decide si esto vale ───────────────────────────────
  const suma = (t: string) =>
    lineas.filter((l) => l.tipo === t).reduce((a, l) => a + l.importeCentimos, 0);

  /*
   * Con coma, que es como se escribe aquí el dinero.
   *
   * `toFixed` da «510.16», y en un aviso castellano eso ya chirría; en ESTE
   * módulo además es una incoherencia: la mitad de su trabajo es negarse a
   * interpretar un punto decimal, así que no puede imprimirlo él.
   */
  const enEuros = (c: Centimos) => (c / 100).toFixed(2).replace(".", ",");

  const comprobar = (declarado: Centimos | null, sumado: Centimos, nombre: string) => {
    if (declarado === null) {
      /*
       * Sin el total impreso no hay con qué contrastar. No se bloquea —una
       * captura recortada sigue sirviendo— pero se dice, porque el cotejo que
       * salga de ahí vale menos y quien lo mire tiene que saberlo.
       */
      avisos.push(
        `La captura no enseña el total de ${nombre}, así que no se ha podido comprobar la lectura.`
      );
      return;
    }
    if (declarado !== sumado) {
      problema(
        `Las líneas de ${nombre} suman ${enEuros(sumado)} € y la pantalla dice ` +
          `${enEuros(declarado)} €. La lectura no es de fiar: falta alguna línea o ` +
          `hay un importe mal leído.`
      );
    }
  };
  comprobar(totalCobrosDeclarado, suma("COBRO"), "cobros");
  comprobar(totalPagosDeclarado, suma("PAGO"), "pagos");

  /*
   * Sin una sola línea utilizable no hay nada que cotejar, y eso PARA siempre
   * — sin importar qué otros avisos haya.
   *
   * Antes esto solo saltaba si no había ningún otro aviso, para no amontonar
   * mensajes. El efecto era que una captura de la que no se leía nada y que
   * además venía sin totales se declaraba no bloqueante: dos avisos blandos
   * tapaban el que de verdad importaba, y la pantalla habría enseñado un cotejo
   * con cero líneas diciendo que en el ERP no hay nada.
   */
  if (lineas.length === 0) {
    problema(
      avisos.length > 0
        ? "No ha quedado ninguna línea utilizable en la captura."
        : "No se ha leído ninguna línea en la captura."
    );
  }

  return {
    lineas,
    totalCobrosDeclarado,
    totalPagosDeclarado,
    avisos,
    fiable: avisos.length === 0,
    bloqueante: duro,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */
