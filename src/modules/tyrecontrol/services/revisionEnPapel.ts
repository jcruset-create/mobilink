/**
 * Las revisiones que se hacen en papel y se teclean después.
 *
 * Hay veces que la revisión se hace a mano, sobre el parte de papel del
 * taller, y se pasa al sistema días más tarde desde el escritorio. Hasta
 * ahora eso no se podía contar: ni `crearRevision` ni `tc_guardar_parte_guiado`
 * aceptaban fecha, así que la revisión del día 9 quedaba fechada el día 12.
 *
 * ── Por qué la fecha es lo que de verdad importa ───────────────────────────
 *
 * Porque es el dato del que vive TyreControl. El desgaste se mide en mm por
 * día, y los milímetros los trae el papel bien: lo que faltaba era el día.
 * Con tres días de error en una medición de dos meses, la proyección de
 * cuándo hay que cambiar la goma se va de semanas.
 *
 * Y no es solo la revisión: `tc_completar_revision` escribe la operación de
 * `revision_vehiculo` con `fecha_operacion = fecha_revision`, así que la fecha
 * correcta arrastra al histórico del neumático entero.
 *
 * ── Lo que NO se afirma de una revisión en papel ───────────────────────────
 *
 * Que se haya cronometrado. La APK guarda `inicio_at` al abrir la revisión y
 * `duracion_seg` al cerrarla; un papel no tiene ni lo uno ni lo otro. Por eso
 * una revisión tecleada va con `inicio_at` a null a propósito: dejar el
 * `default now()` pondría la hora de teclear en una revisión de hace cuatro
 * días, que es una contradicción dentro de la misma fila.
 */

/** Hoy en ISO corto, en la zona de quien mira, no en UTC. */
export function hoyISO(): string {
  return comoISO(new Date());
}

/** Una fecha a `YYYY-MM-DD`, por sus campos locales. */
function comoISO(d: Date): string {
  const dd = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${dd(d.getMonth() + 1)}-${dd(d.getDate())}`;
}

/** ¿Es un `YYYY-MM-DD` que existe de verdad? El 2026-02-31 no lo es. */
function fechaValida(iso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const [a, m, d] = iso.split("-").map(Number);
  const prueba = new Date(a, m - 1, d);
  // Si el día no existe, `Date` rueda al mes siguiente y deja de cuadrar.
  return prueba.getFullYear() === a && prueba.getMonth() === m - 1 && prueba.getDate() === d;
}

/**
 * Cuántos días hace. `null` si alguna de las dos fechas no se entiende.
 *
 * Se cuenta por días de calendario y no por milisegundos: entre dos fechas
 * puede haber un cambio de hora, y «hace 4 días» no debe convertirse en 3 por
 * una hora de diferencia.
 */
export function diasAtras(fecha: string, hoy: string): number | null {
  if (!fechaValida(fecha) || !fechaValida(hoy)) return null;
  const aDia = (iso: string) => {
    const [a, m, d] = iso.split("-").map(Number);
    return Date.UTC(a, m - 1, d) / 86_400_000;
  };
  return aDia(hoy) - aDia(fecha);
}

/** Lo que hay que decirle a quien teclea la fecha. */
export interface JuicioFecha {
  /** Si está informado, NO se puede guardar. */
  error: string | null;
  /** Se puede guardar, pero conviene mirarlo dos veces. */
  aviso: string | null;
}

/** Más allá de esto, la fecha deja de parecer «hace unos días». */
const DIAS_PARA_AVISAR = 30;

/** Y más allá de esto, lo más probable es que el año esté mal tecleado. */
const DIAS_PARA_RECHAZAR = 365;

/**
 * ¿Se puede guardar una revisión con esta fecha?
 *
 * Tres reglas, y cada una por un motivo distinto:
 *
 *   · Una fecha FUTURA se rechaza. No es un error de dedo que se pueda dejar
 *     pasar: sería afirmar que alguien midió un vehículo un día que todavía no
 *     ha llegado, y esa fila contaminaría cualquier cálculo de desgaste por
 *     día que la pillara en medio.
 *
 *   · Más de un año atrás se rechaza también, pero por otra razón: a esa
 *     distancia lo normal no es que la revisión sea de 2025, es que el año
 *     esté mal tecleado. Rechazarlo obliga a mirarlo; aceptarlo metería una
 *     medición falsa en el histórico sin que nadie se entere.
 *
 *   · Entre un mes y un año se AVISA pero se deja guardar. Los partes viejos
 *     que aparecen en un cajón existen, y perderlos sería peor que tenerlos
 *     con un aviso. La decisión es de quien tiene el papel delante.
 */
export function juzgarFecha(fecha: string, hoy: string = hoyISO()): JuicioFecha {
  if (!fecha.trim()) {
    return { error: "Falta la fecha de la revisión", aviso: null };
  }
  if (!fechaValida(fecha)) {
    return { error: "La fecha no se entiende", aviso: null };
  }
  const dias = diasAtras(fecha, hoy);
  if (dias == null) return { error: "La fecha no se entiende", aviso: null };

  if (dias < 0) {
    return {
      error: "La revisión no puede ser de un día que todavía no ha llegado",
      aviso: null,
    };
  }
  if (dias > DIAS_PARA_RECHAZAR) {
    return {
      error: `Esa fecha es de hace ${dias} días. Comprueba el año antes de guardarla.`,
      aviso: null,
    };
  }
  if (dias > DIAS_PARA_AVISAR) {
    return {
      error: null,
      aviso: `La revisión es de hace ${dias} días. Compruébalo antes de finalizarla.`,
    };
  }
  return { error: null, aviso: null };
}

/** Lo que hace falta saber de una revisión para decir si se tecleó después. */
export interface RevisionFechada {
  fecha_revision?: string | null;
  created_at?: string | null;
}

/**
 * ¿Esta revisión se hizo en papel y se tecleó después?
 *
 * Se DEDUCE, no se guarda en una columna nueva: una revisión cuya fecha es
 * anterior al día en que se creó la fila es, literalmente, una revisión que se
 * pasó más tarde. No hace falta inventarse un campo para algo que los datos
 * que ya hay dicen solos.
 *
 * Una tecleada el mismo día no sale marcada, y está bien que sea así: ese día
 * la fila no afirma nada distinto de una hecha con la tablet, así que no hay
 * nada que advertir.
 */
export function esEnPapel(r: RevisionFechada): boolean {
  return diasDeRetraso(r) != null;
}

/**
 * Cuántos días se tardó en teclearla. `null` si no se tecleó más tarde.
 *
 * `created_at` llega con hora y zona y `fecha_revision` es solo un día, así
 * que se compara contra el día LOCAL de la creación: en UTC, una revisión
 * creada a las 00:30 contaría como del día anterior y saldría marcada sin
 * serlo.
 */
export function diasDeRetraso(r: RevisionFechada): number | null {
  if (!r.fecha_revision || !r.created_at) return null;
  const creada = new Date(r.created_at);
  if (Number.isNaN(creada.getTime())) return null;
  const dias = diasAtras(r.fecha_revision, comoISO(creada));
  return dias != null && dias > 0 ? dias : null;
}

/**
 * «Hecha en papel · tecleada 4 días después», o `null` si no procede.
 *
 * Va donde se consulta la revisión, para que nadie tenga que deducir por qué
 * una revisión de hace cuatro días no tiene cronómetro ni coordenadas.
 */
export function textoEnPapel(r: RevisionFechada): string | null {
  const dias = diasDeRetraso(r);
  if (dias == null) return null;
  return dias === 1
    ? "Hecha en papel · tecleada al día siguiente"
    : `Hecha en papel · tecleada ${dias} días después`;
}
