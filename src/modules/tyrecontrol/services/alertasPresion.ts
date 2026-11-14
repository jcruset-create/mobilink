/**
 * Cómo se dice un aviso de presión en la pantalla.
 *
 * Vive aparte del componente porque las tres reglas que tiene no son de
 * pintar, son de no mentir, y se pueden comprobar sin montar React:
 *
 *   · un aviso de «desinflado» NO trae lectura, y eso no es un cero;
 *   · el porcentaje es el que dice el correo, nunca uno calculado;
 *   · que una rueda lleve días avisando es el dato que de verdad vale.
 */

/** Lo que hace falta saber de un aviso para decirlo. */
export interface AvisoParaTexto {
  tipo: "presion_baja" | "desinflado";
  presion_bar?: number | null;
  presion_recomendada_bar?: number | null;
  desviacion_pct?: number | null;
  avisos?: number | null;
  primer_aviso_at?: string | null;
}

/**
 * «4 bar de 8 recomendados (-49.65 %)».
 *
 * Sin lectura se dice que no la hay. Poner «0 bar» afirmaría que se midió
 * cero, que es distinto de que el sensor no dé un número fiable —y es
 * exactamente lo que pasa en los avisos de «neumático desinflado», donde el
 * correo pone `!!!`—.
 *
 * El porcentaje NO se calcula desde los bares: vienen redondeados a un decimal
 * y dividir da otro número (4,0 sobre 8,0 daría −50 % y el correo dice
 * −49,65 %). Si falta, no se inventa.
 */
export function textoDePresion(a: AvisoParaTexto): string {
  const partes: string[] = [
    a.presion_bar == null ? "Sin lectura del sensor" : `${a.presion_bar} bar`,
  ];
  if (a.presion_recomendada_bar != null) {
    partes.push(`de ${a.presion_recomendada_bar} recomendados`);
  }
  const txt = partes.join(" ");
  return a.desviacion_pct != null ? `${txt} (${a.desviacion_pct} %)` : txt;
}

/**
 * «3 avisos desde el 08/11», o `null` cuando solo ha avisado una vez.
 *
 * Es el dato que distingue una presión baja de una fuga: una rueda que avisa
 * tres días seguidos no se ha quedado baja, se está vaciando. Con un solo
 * aviso no hay nada que destacar y decir «1 aviso» sería ruido en todas las
 * líneas.
 */
export function textoDeRepeticion(a: AvisoParaTexto): string | null {
  const n = a.avisos ?? 1;
  if (n <= 1) return null;
  const desde = fechaCorta(a.primer_aviso_at);
  return desde ? `${n} avisos desde el ${desde}` : `${n} avisos`;
}

const dd = (n: number) => String(n).padStart(2, "0");

/**
 * «08/11». `null` si la fecha no se entiende, para no pintar «Invalid Date».
 *
 * Se formatea a mano y no con `toLocaleDateString`: con `2-digit` esa función
 * devuelve «08/11» en el navegador y «8/11» en el Node de las pruebas, según
 * el ICU que tenga cada uno. Un formato que cambia de sitio en sitio no es un
 * formato.
 */
export function fechaCorta(iso: string | null | undefined): string | null {
  const d = fecha(iso);
  return d ? `${dd(d.getDate())}/${dd(d.getMonth() + 1)}` : null;
}

/** «08/11 22:30». `null` si no se entiende. */
export function fechaYHoraCorta(iso: string | null | undefined): string | null {
  const d = fecha(iso);
  return d ? `${dd(d.getDate())}/${dd(d.getMonth() + 1)} ${dd(d.getHours())}:${dd(d.getMinutes())}` : null;
}

function fecha(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** El nombre del tipo, tal como se enseña. */
export function nombreDelTipo(tipo: AvisoParaTexto["tipo"]): string {
  return tipo === "desinflado" ? "Neumático desinflado" : "Presión baja";
}
