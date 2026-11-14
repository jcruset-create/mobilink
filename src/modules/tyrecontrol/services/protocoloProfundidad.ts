/**
 * El protocolo contra los falsos desgastes: qué profundidad se da por buena.
 *
 * ── El problema ─────────────────────────────────────────────────────────────
 *
 * El arco mide bien casi siempre y de vez en cuando suelta un disparate. La
 * serie de una goma del 4310JYJ, día a día:
 *
 *     8,6 · 8,6 · 8,6 · 10,7 · 8,0 · 8,1 · 9,2 · 8,7 · 8,5 · 1,8
 *
 * Dos lecturas imposibles, y la última es una de ellas: quedándose con la
 * última, esa goma de 8,5 mm salía a 1,8 y con un «cambiar ya». Medido en toda
 * la flota desde junio: la mitad de las lecturas se mueve 0,3 mm o menos
 * respecto a la anterior, el 95 % menos de 1,2 mm, y un 2 % salta más de 2 mm.
 * De las 71 alertas que había, 19 estaban desmentidas por las lecturas
 * anteriores y otras 9 gomas gastadas de verdad NO salían, tapadas por un pico
 * hacia arriba.
 *
 * ── La regla (la «A» de las que se propusieron) ─────────────────────────────
 *
 * El valor de una goma es la MEDIANA DE SUS TRES ÚLTIMAS LECTURAS, no la
 * última. Una lectura suelta no puede moverlo: hacen falta dos que coincidan.
 * Con el arco pasando casi a diario, un cambio real se refleja en uno o dos
 * días.
 *
 * Con menos de tres lecturas la mediana no existe, y hay que decir qué se hace:
 *
 *   · dos que coinciden (≤ 2 mm) → vale la última, confirmada;
 *   · dos que no coinciden → se queda la anterior y la última queda PENDIENTE:
 *     una lectura sola no mueve el valor, y no se sabe cuál de las dos miente;
 *   · una sola → es lo que hay, sin confirmar.
 *
 * ── La medición a mano manda ────────────────────────────────────────────────
 *
 * Lo que mide un técnico con la sonda no espera confirmación: es el dato bueno
 * de ese día. Y lo anterior a esa medición deja de contar —ya se sabe cómo
 * estaba la goma entonces—, así que la ventana de tres empieza en ella.
 *
 * ── Los 2 mm ────────────────────────────────────────────────────────────────
 *
 * Salen del ruido medido: el 95 % de las lecturas consecutivas difiere menos
 * de 1,2 mm. Dos milímetros dejan pasar el ruido y paran los disparates.
 *
 * ── La «E»: lo pendiente se mide a mano ─────────────────────────────────────
 *
 * Una lectura baja que no está confirmada no enciende el rojo, pero tampoco se
 * calla: sale como «por confirmar» y va a la lista de ruedas para medir con
 * sonda. Si era verdad, la confirma el técnico o la siguiente pasada del arco;
 * si era un disparate, se cae sola.
 *
 * La misma regla está en `tc_informes_alertas_vehiculos`
 * (tyrecontrol_protocolo_falsos_desgastes.sql) y en la tablet
 * (`ultima_medicion.dart`). Las pruebas de aquí y de allí usan los mismos
 * casos: si cambia una, cambian las tres.
 */

/** Cuánto pueden diferir dos lecturas para darse la razón, en mm. */
export const TOLERANCIA_MM = 2;

export interface LecturaDeSerie {
  mm: number;
  /** La midió un técnico (sonda o a mano), no el arco. */
  manual: boolean;
  /** Cuándo. Se devuelve tal cual, para fechar el valor. */
  fecha: string | null;
}

export interface ValorDeLaGoma {
  /** La profundidad que se da por buena. */
  mm: number;
  fecha: string | null;
  /** Si hay otra lectura (o un técnico) que la respalde. */
  confirmada: boolean;
  /** La última lectura, cuando NO es la que se ha dado por buena. */
  pendiente: { mm: number; fecha: string | null } | null;
}

/**
 * El valor de una goma a partir de sus lecturas, de la MÁS RECIENTE a la más
 * antigua. Solo se miran las tres primeras.
 */
export function valorDeLaSerie(lecturas: LecturaDeSerie[]): ValorDeLaGoma | null {
  let ventana = lecturas.slice(0, 3);
  if (ventana.length === 0) return null;

  // La manual manda: lo anterior a la medición a mano más reciente no cuenta.
  const manual = ventana.findIndex((l) => l.manual);
  if (manual >= 0) ventana = ventana.slice(0, manual + 1);

  const [ultima, anterior] = ventana;

  if (ultima.manual) {
    return { mm: ultima.mm, fecha: ultima.fecha, confirmada: true, pendiente: null };
  }
  if (ventana.length === 1) {
    return { mm: ultima.mm, fecha: ultima.fecha, confirmada: false, pendiente: null };
  }
  if (ventana.length === 2) {
    if (Math.abs(ultima.mm - anterior.mm) <= TOLERANCIA_MM) {
      return { mm: ultima.mm, fecha: ultima.fecha, confirmada: true, pendiente: null };
    }
    return {
      mm: anterior.mm, fecha: anterior.fecha, confirmada: anterior.manual,
      pendiente: { mm: ultima.mm, fecha: ultima.fecha },
    };
  }

  // Tres: la de en medio. Se devuelve la LECTURA mediana —con su fecha—, no un
  // promedio: es un número que alguien midió de verdad.
  const enOrden = [...ventana].sort((a, b) => a.mm - b.mm);
  const mediana = enOrden[1];
  return {
    mm: mediana.mm,
    fecha: mediana.fecha,
    confirmada: true,
    pendiente: Math.abs(ultima.mm - mediana.mm) > TOLERANCIA_MM ? { mm: ultima.mm, fecha: ultima.fecha } : null,
  };
}

/** Lo que hay que decir de una goma frente a su mínimo. */
export type Veredicto = "cambiar" | "por_confirmar" | "ok";

/**
 * · `cambiar`: el valor dado por bueno está en el mínimo o por debajo, y está
 *   confirmado.
 * · `por_confirmar`: hay una lectura en el mínimo o por debajo que nadie ha
 *   respaldado todavía —sea el propio valor o la última pendiente—. No es rojo,
 *   pero hay que ir a medirla.
 * · `ok`: lo demás. Sin mínimo no se acusa a nadie.
 */
export function veredicto(valor: ValorDeLaGoma | null, minimo: number | null | undefined): Veredicto {
  if (!valor || minimo == null) return "ok";
  if (valor.mm <= minimo && valor.confirmada) return "cambiar";
  if (valor.mm <= minimo) return "por_confirmar";
  if (valor.pendiente && valor.pendiente.mm <= minimo) return "por_confirmar";
  return "ok";
}

/**
 * El veredicto en la FICHA, donde la profundidad que se enseña puede no venir
 * de una revisión: si el propio neumático tiene una más reciente tecleada a
 * mano (un reesculturado, un usado montado con su medida), manda ésa.
 *
 * `vigente` es lo que se enseña; `deRevision`, lo que dice el protocolo. Si
 * coinciden, decide el protocolo. Si no, la profundidad es del neumático: la
 * tecleó alguien, así que cuenta como confirmada.
 */
export function veredictoEnLaFicha(
  vigente: number | null | undefined,
  deRevision: { profundidad_mm: number | null; confirmada?: boolean; pendiente_mm?: number | null } | null | undefined,
  minimo: number | null | undefined,
): Veredicto {
  if (minimo == null) return "ok";
  if (deRevision && deRevision.profundidad_mm != null && vigente === deRevision.profundidad_mm) {
    return veredicto({
      mm: deRevision.profundidad_mm,
      fecha: null,
      // Un mapa antiguo, sin el campo, se trata como hasta ahora: confirmada.
      confirmada: deRevision.confirmada ?? true,
      pendiente: deRevision.pendiente_mm != null ? { mm: deRevision.pendiente_mm, fecha: null } : null,
    }, minimo);
  }
  if (vigente == null) return "ok";
  return vigente <= minimo ? "cambiar" : "ok";
}
