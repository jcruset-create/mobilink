/**
 * Leer un importe escrito por una persona, y una fecha escrita por la plantilla.
 *
 * ── Por qué esto es la pieza más peligrosa del parser ───────────────────────
 *
 * En el mismo correo conviven dos convenciones. La plantilla escribe el total
 * de la factura a la española —`3.217,66`, punto de millares y coma decimal— y
 * la persona escribe el importe del albarán a la inglesa —`1010.07€`, punto
 * decimal—. El mismo carácter significa dos cosas distintas según quién lo
 * teclee, y confundirlas multiplica o divide por mil una cifra contable.
 *
 * La regla que resuelve la mayoría de los casos sin adivinar nada: **cuando hay
 * los dos separadores, el ÚLTIMO es el decimal**. `3.217,66` y `1,234.56` se
 * leen bien los dos, y no hay que saber de qué país viene el número.
 *
 * Cuando sólo hay uno, el tamaño del grupo que le sigue decide: uno o dos
 * dígitos sólo pueden ser decimales, y cuatro o más tampoco pueden ser un grupo
 * de millares. Queda un caso genuinamente ambiguo —exactamente tres dígitos,
 * `1.234`— que puede ser mil doscientos treinta y cuatro o uno con doscientos
 * treinta y cuatro milésimas. Ahí se aplica la convención española y se BAJA LA
 * CONFIANZA, que es lo que hace que el expediente pida que alguien lo mire.
 * Elegir en silencio es como se cuela un error de tres ceros.
 *
 * ── Y por qué no se usa coma flotante ───────────────────────────────────────
 *
 * `1010.07 * 100` da `101006.99999999999`. Todo el cálculo va sobre las cadenas
 * de dígitos y termina en un entero de céntimos, que es como viaja el dinero en
 * el resto del módulo.
 */

export type ImporteLeido = {
  /** Céntimos con signo. `null` si no había nada que leer. */
  centimos: number | null;
  /** 0 a 1. Por debajo del umbral, el expediente pide revisión. */
  confianza: number;
  /** Tal y como estaba escrito, para poder enseñarlo. */
  raw: string;
  /** Por qué la confianza no es 1. */
  motivo?: string;
};

const NADA: ImporteLeido = { centimos: null, confianza: 0, raw: "" };

/**
 * Quita lo que rodea al número sin tocar el número.
 *
 * El `e` final es «euros» tal y como lo escribe quien manda el correo
 * (`114.44e`). Sólo se quita cuando va detrás de un dígito y cierra la cadena:
 * así no se toca nada que pudiera ser notación científica.
 */
function desnudar(raw: string): { cuerpo: string; negativo: boolean } {
  let v = raw.trim().replace(/\s+/g, "");
  v = v.replace(/€/g, "").replace(/EUR$/i, "");
  v = v.replace(/(?<=\d)[eE]$/, "");

  let negativo = false;
  if (v.startsWith("-") || v.startsWith("−")) {
    negativo = true;
    v = v.slice(1);
  } else if (v.startsWith("+")) {
    v = v.slice(1);
  }
  return { cuerpo: v.trim(), negativo };
}

/** Entero + decimales → céntimos, redondeando al alza a partir de la mitad. */
function aCentimos(entero: string, decimales: string, negativo: boolean): number {
  const enteroLimpio = entero.replace(/\D/g, "") || "0";
  const dos = (decimales + "00").slice(0, 2);
  let centimos = Number(enteroLimpio) * 100 + Number(dos);

  // Un tercer decimal se redondea en vez de perderse: 1,005 € son 101 céntimos.
  if (decimales.length > 2 && Number(decimales[2]) >= 5) centimos += 1;

  return negativo ? -centimos : centimos;
}

/**
 * Lee un importe. Nunca lanza: lo que no se entiende sale con confianza 0 y sin
 * valor, que es lo que el resto del módulo sabe tratar.
 */
export function leerImporte(raw: unknown): ImporteLeido {
  if (typeof raw !== "string" || !raw.trim()) return NADA;
  const original = raw.trim();
  const { cuerpo, negativo } = desnudar(original);
  if (!/^[\d.,]+$/.test(cuerpo) || !/\d/.test(cuerpo)) {
    return { ...NADA, raw: original };
  }

  const puntos = (cuerpo.match(/\./g) ?? []).length;
  const comas = (cuerpo.match(/,/g) ?? []).length;

  // Sin separadores: euros enteros.
  if (puntos === 0 && comas === 0) {
    return { centimos: aCentimos(cuerpo, "", negativo), confianza: 1, raw: original };
  }

  // Con los dos, el último manda. No hace falta saber de qué país viene.
  if (puntos > 0 && comas > 0) {
    const decimal = cuerpo.lastIndexOf(",") > cuerpo.lastIndexOf(".") ? "," : ".";
    const corte = cuerpo.lastIndexOf(decimal);
    const entero = cuerpo.slice(0, corte);
    const decimales = cuerpo.slice(corte + 1).replace(/\D/g, "");
    return {
      centimos: aCentimos(entero, decimales, negativo),
      confianza: 1,
      raw: original,
    };
  }

  const separador = puntos > 0 ? "." : ",";
  const veces = puntos > 0 ? puntos : comas;
  const corte = cuerpo.lastIndexOf(separador);
  const cola = cuerpo.slice(corte + 1);

  // Varios separadores iguales sólo pueden ser millares: 1.234.567.
  if (veces > 1) {
    return {
      centimos: aCentimos(cuerpo.split(separador).join(""), "", negativo),
      confianza: 1,
      raw: original,
    };
  }

  // Uno o dos dígitos detrás: decimales, seguro.
  if (cola.length <= 2) {
    return {
      centimos: aCentimos(cuerpo.slice(0, corte), cola, negativo),
      confianza: 1,
      raw: original,
    };
  }

  // Cuatro o más: no es un grupo de millares, así que son decimales.
  if (cola.length >= 4) {
    return {
      centimos: aCentimos(cuerpo.slice(0, corte), cola, negativo),
      confianza: 0.9,
      raw: original,
      motivo: `«${original}» trae ${cola.length} decimales; se redondea a céntimos.`,
    };
  }

  /*
   * Exactamente tres. Aquí no hay forma de saberlo: `1.234` puede ser mil
   * doscientos treinta y cuatro o uno coma doscientos treinta y cuatro. Se
   * aplica la convención española —el punto agrupa millares, la coma separa
   * decimales— y se deja dicho, para que el expediente lo pida revisar en vez
   * de arrastrar un error de tres ceros sin que nadie lo vea.
   */
  const comoEspanol =
    separador === "."
      ? aCentimos(cuerpo.replace(".", ""), "", negativo)
      : aCentimos(cuerpo.slice(0, corte), cola, negativo);

  return {
    centimos: comoEspanol,
    confianza: 0.4,
    raw: original,
    motivo:
      `«${original}» es ambiguo: con tres dígitos detrás del separador no se ` +
      `puede saber si separa millares o decimales. Se ha leído a la española.`,
  };
}

/* ── Fechas ──────────────────────────────────────────────────────────────── */

/**
 * `31/08/2026` → `2026-08-31`.
 *
 * Se comprueba que la fecha EXISTA, no sólo que tenga la forma: un `31/02` que
 * pasara de largo acabaría en la base como 3 de marzo, y la antigüedad del
 * expediente —de la que sale la prioridad— se contaría desde un día que nadie
 * escribió. Devuelve `null` en vez de inventarse nada.
 */
export function leerFecha(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim();

  const iso = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const es = v.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);

  let anio: number, mes: number, dia: number;
  if (iso) {
    [anio, mes, dia] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  } else if (es) {
    dia = Number(es[1]);
    mes = Number(es[2]);
    anio = Number(es[3]);
    // Un año de dos cifras se completa en el siglo actual: la plantilla los
    // escribe de cuatro, así que esto es sólo por si alguien teclea a mano.
    if (anio < 100) anio += 2000;
  } else {
    return null;
  }

  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
  const d = new Date(Date.UTC(anio, mes - 1, dia));
  if (d.getUTCFullYear() !== anio || d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) {
    return null;
  }

  const dos = (n: number) => String(n).padStart(2, "0");
  return `${anio}-${dos(mes)}-${dos(dia)}`;
}
