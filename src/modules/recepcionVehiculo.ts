/**
 * Recepción rápida de vehículos: la lógica que no toca la base de datos.
 *
 * Una recepción es lo que el operario ve en el patio: una matrícula, quizá un
 * cliente, quizá una foto y una idea de qué hay que hacer. No es un trabajo.
 * Se convierte en trabajo cuando una persona lo valida en WorkPlanner.
 *
 * Todo lo de aquí es puro a propósito: se puede probar sin `DATABASE_URL`, que
 * es justo lo que `server/db.ts` exige nada más importarlo.
 */

import type { AreaKey, Job, QuickTemplate } from "./workshopTypes";
import type { WorkshopId } from "./workshops";

export type EstadoRecepcion = "pendiente" | "convertida" | "descartada";

export type OrigenVehiculo = "roadside" | "tyrecontrol";

export type FotoRecepcion = {
  url: string;
  nombre?: string | null;
  creadaAtMs?: number | null;
};

export type RecepcionVehiculo = {
  id: number;
  workshopId?: WorkshopId | string | null;
  /** Como la confirmó la persona, con guiones y todo si los escribió así. */
  matricula: string;
  /** Lo que leyó la IA, sin tocar. `null` si se escribió a mano. */
  matriculaOcr?: string | null;
  confianzaOcr?: number | null;
  clienteNombre?: string | null;
  clienteTelefono?: string | null;
  /** Cuentakilómetros al entrar. Lo que marca el vehículo, no una estimación. */
  kilometros?: number | null;
  /** Lo que leyó la IA del cuadro, sin tocar, y con cuánta confianza. */
  kilometrosOcr?: number | null;
  confianzaKilometrosOcr?: number | null;
  vehiculoId?: string | null;
  vehiculoOrigen?: OrigenVehiculo | null;
  /** Cita de la agenda de la que salió, si el operario la eligió en el patio. */
  scheduledJobId?: number | null;
  area?: AreaKey | null;
  plantillaKey?: string | null;
  operacionLabel?: string | null;
  notas?: string | null;
  urgente: boolean;
  fotos: FotoRecepcion[];
  estado: EstadoRecepcion;
  operarioNombre: string;
  creadaAtMs: number;
  resueltaAtMs?: number | null;
  resueltaPor?: string | null;
  motivoDescarte?: string | null;
  jobId?: number | null;
};

/**
 * La misma regla de matrícula que el servidor.
 *
 * El original vive en `server/tyrecontrol/matricula.ts` y no se importa desde
 * aquí porque el árbol del navegador y el del servidor se compilan por
 * separado. Para que no vuelvan a divergir —ya pasó: tres copias de esta
 * comparación acabaron encontrando un vehículo por una vía y no por otra—
 * hay un test que ejecuta las dos y comprueba que dan lo mismo.
 */
export function matriculaComparable(valor: unknown): string {
  return String(valor ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Por debajo de 4 caracteres no se busca vehículo: traería media tabla. */
export const LARGO_MINIMO_MATRICULA = 4;

/**
 * La matrícula que ha dicho la IA, cuando responde EN TEXTO PLANO.
 *
 * Es la vía por la que lee Mobilink Assist (`detectPlateFromImage`), y lleva
 * años leyendo matrículas en el arcén. La recepción pedía un JSON
 * —`{"matricula": ..., "confianza": ...}`— y eso añade un modo de fallo que
 * Assist no tiene: si el modelo contesta bien pero envuelve el JSON en una
 * frase, o se queda sin tokens antes de cerrar la llave, la respuesta entera
 * se cae y al operario le sale «en esa foto no se ve ninguna matrícula»
 * cuando la matrícula se veía perfectamente.
 *
 * Aquí no hay nada que cerrar: lo que vuelve es la matrícula o la palabra
 * NONE. Se acepta que el modelo la adorne («La matrícula es 4610 CCV.»)
 * porque normalizar se lo come, y se exige un largo mínimo para no dar por
 * buena una sílaba suelta.
 */
export function matriculaDeTextoIA(respuesta: unknown): string | null {
  const crudo = String(respuesta ?? "").toUpperCase();
  if (crudo.trim() === "") return null;
  // «NONE», y también «No se lee ninguna matrícula»: si ha dicho que no, se
  // respeta aunque lo haya dicho con prosa.
  if (/^\s*NO(NE|\b)/.test(crudo)) return null;

  /*
   * Se busca la matrícula DENTRO del texto en vez de aplastarlo entero.
   *
   * Aplastarlo era lo primero que hice y el test lo cazó: «La matrícula es
   * 4610 CCV» se convertía en LAMATRICULAES4610CCV y eso acababa escrito en
   * el campo del operario. Una lectura falsa es peor que ninguna, porque la
   * ninguna se teclea y la falsa se envía.
   */
  const texto = crudo.replace(/[^A-Z0-9]+/g, " ").trim();
  const patrones = [
    /\b(\d{4}) ?([A-Z]{3})\b/,            // moderna: 4610 CCV
    /\b([A-Z]{1,2}) ?(\d{4}) ?([A-Z]{1,2})\b/, // antigua: T 1234 AB
  ];
  for (const patron of patrones) {
    const encontrado = texto.match(patron);
    if (encontrado) return encontrado.slice(1).join("");
  }

  /*
   * Sin patrón reconocible solo se acepta la respuesta si el modelo contestó
   * lo que se le pidió: la matrícula y nada más. Es lo que deja pasar las
   * placas extranjeras, que no tienen por qué seguir ningún formato nuestro.
   */
  if (texto.includes(" ")) return null;
  const limpia = matriculaComparable(texto);
  return limpia.length >= LARGO_MINIMO_MATRICULA ? limpia : null;
}

/**
 * Kilómetro máximo que se acepta de una lectura automática.
 *
 * Un camión pasa del millón sin despeinarse, así que el tope no puede ser
 * bajo. Pero una lectura de OCR se come un dígito o se inventa otro con toda
 * naturalidad, y un kilometraje absurdo metido sin mirar contamina el
 * histórico del vehículo. Tres millones deja pasar cualquier flota real y
 * corta las lecturas de siete y ocho cifras que no lo son.
 */
export const KILOMETROS_MAXIMOS = 3_000_000;

/**
 * Los kilómetros que ha dicho la IA, cuando responde EN TEXTO PLANO.
 *
 * Mismo cambio y mismo motivo que `matriculaDeTextoIA`. Se queda con el
 * número MÁS LARGO de la respuesta: si el modelo escribe «123456 km (el
 * parcial marca 321)», el odómetro es el de seis cifras, no el de tres.
 */
export function kilometrosDeTextoIA(respuesta: unknown): number | null {
  const texto = String(respuesta ?? "");
  if (/^\s*NONE/i.test(texto.trim())) return null;

  // Los separadores de miles se quitan ANTES de buscar números, o «123.456»
  // se leería como dos cifras sueltas y ganaría la equivocada.
  const numeros = texto.replace(/[.,\s](?=\d{3}\b)/g, "").match(/\d+/g);
  if (!numeros) return null;

  const mayor = numeros.reduce((a, b) => (b.length >= a.length ? b : a));
  return kilometrosEscritos(mayor);
}

/** Lo que el operario teclea, validado igual que lo que lee la IA. */
export function kilometrosEscritos(valor: unknown): number | null {
  const crudo = String(valor ?? "").replace(/[^0-9]/g, "");
  if (crudo === "") return null;
  const km = Number(crudo);
  if (!Number.isFinite(km) || km <= 0 || km > KILOMETROS_MAXIMOS) return null;
  return km;
}

/**
 * De las filas candidatas que devolvió la base, ¿cuál es de verdad?
 *
 * El patrón de búsqueda del servidor intercala comodines, así que también
 * admite matrículas que no son. La coincidencia exacta se confirma aquí.
 * Si una misma matrícula está en los dos sitios gana `roadside`: es la flota
 * propia, y es la que tiene el cliente bien puesto.
 */
export type CandidatoVehiculo = {
  id: string;
  matricula: unknown;
  clienteNombre?: string | null;
  origen: OrigenVehiculo;
};

export function eligeVehiculo(
  candidatos: CandidatoVehiculo[],
  buscada: string
): CandidatoVehiculo | null {
  const objetivo = matriculaComparable(buscada);
  if (objetivo === "") return null;
  const coinciden = candidatos.filter(
    (c) => matriculaComparable(c.matricula) === objetivo
  );
  if (coinciden.length === 0) return null;
  return coinciden.find((c) => c.origen === "roadside") ?? coinciden[0];
}

/** ¿Hay ya una recepción de esta matrícula hoy, todavía sin resolver? */
export function posibleDuplicado(
  recepciones: RecepcionVehiculo[],
  matricula: string,
  ahoraMs: number,
  ventanaMs = 24 * 60 * 60 * 1000
): RecepcionVehiculo | null {
  const objetivo = matriculaComparable(matricula);
  if (objetivo === "") return null;
  return (
    recepciones.find(
      (r) =>
        r.estado === "pendiente" &&
        matriculaComparable(r.matricula) === objetivo &&
        ahoraMs - r.creadaAtMs < ventanaMs
    ) ?? null
  );
}

/** ¿Se puede convertir ya, o falta algo que tiene que decidir una persona? */
export function loQueFaltaParaConvertir(recepcion: RecepcionVehiculo): string[] {
  const falta: string[] = [];
  if (matriculaComparable(recepcion.matricula) === "") falta.push("la matrícula");
  if (!recepcion.area) falta.push("el área");
  if (!recepcion.plantillaKey && !recepcion.operacionLabel) falta.push("la operación");
  return falta;
}

/**
 * El esqueleto del trabajo que saldría de esta recepción.
 *
 * Nace en `validacion`, nunca en `activo` ni en `espera`: es una propuesta, y
 * una propuesta la autoriza alguien. Quien llame a esto le pasa el resultado
 * a `allocateJobPure` para que proponga técnico, igual que hace la pantalla
 * de partes de trabajo.
 */
export function jobDesdeRecepcion(
  recepcion: RecepcionVehiculo,
  id: number,
  plantilla: QuickTemplate | null,
  ahoraMs: number
): Job {
  const etiqueta =
    recepcion.operacionLabel?.trim() || plantilla?.label || "Recepción en taller";

  const motivo = [
    `Recepción en patio (${recepcion.operarioNombre}).`,
    // El kilometraje va en el motivo porque es el dato que el técnico mira
    // antes de tocar nada, y así viaja con el trabajo sin depender de que
    // alguien abra la ficha de la recepción.
    recepcion.kilometros ? `${recepcion.kilometros.toLocaleString("es-ES")} km.` : "",
    recepcion.notas?.trim() || "",
  ]
    .filter(Boolean)
    .join(" ");

  return {
    id,
    workshopId: recepcion.workshopId ?? null,
    area: (recepcion.area ?? plantilla?.area ?? "mecanica") as AreaKey,
    plate: recepcion.matricula.trim().toUpperCase(),
    urgent: !!recepcion.urgente,
    status: "validacion",
    assignedNames: [],
    reason: motivo,
    customerName: recepcion.clienteNombre?.trim() || "",
    customerPhone: recepcion.clienteTelefono?.trim() || "",
    createdAtMs: ahoraMs,
    startedAtMs: null,
    template: null,
    quickEntryLabel: etiqueta,
    quickEntryMode: plantilla?.mode ?? "team",
    quantity: 1,
    unitMinutes: plantilla?.unitMinutes ?? plantilla?.standardMinutes ?? null,
    standardMinutes: plantilla?.standardMinutes ?? null,
    // La hora en que el vehículo entró en el patio, no la de convertirlo.
    ptEntradaMs: recepcion.creadaAtMs,
  };
}

/**
 * Una cita de la agenda, vista desde el patio.
 *
 * Es un subconjunto de lo que guarda `scheduled_jobs`, que es un JSONB sin
 * esquema. Solo lo que el operario necesita para reconocer el vehículo que
 * tiene delante.
 */
export type CitaParaRecibir = {
  id: number;
  plate?: string | null;
  startTime?: string | null;
  date?: string | null;
  customerName?: string | null;
  templateLabel?: string | null;
  templateKey?: string | null;
  area?: string | null;
  workshopId?: string | null;
  status?: string | null;
  jobId?: number | null;
};

/**
 * Las citas que un operario puede recibir hoy en el patio.
 *
 * Se dejan fuera:
 *  · las que no están «programado» —canceladas, realizadas—;
 *  · las que YA tienen trabajo creado (`jobId`), porque entonces el vehículo
 *    ya entró por la otra puerta y recibirlo otra vez duplicaría el trabajo;
 *  · las de otro taller y las de otro día.
 *
 * Se ordenan por hora, que es como están en la agenda y como las busca quien
 * tiene el vehículo delante.
 */
export function idsDeCitasYaRecibidas(
  recepciones: { estado: string; scheduledJobId?: number | null }[]
): Set<number> {
  const ids = new Set<number>();
  for (const r of recepciones) {
    if (r.estado !== "pendiente") continue;
    if (r.scheduledJobId == null) continue;
    ids.add(Number(r.scheduledJobId));
  }
  return ids;
}

export function citasParaRecibir(
  citas: CitaParaRecibir[],
  diaKey: string,
  workshopId?: string | null,
  yaRecibidas?: Set<number>
): CitaParaRecibir[] {
  return citas
    .filter((c) => {
      if (String(c.status ?? "") !== "programado") return false;
      if (c.jobId != null) return false;
      /*
       * Recibida pero todavía sin validar.
       *
       * La cita no se cierra hasta que la oficina convierte la recepción, y
       * entre el patio y la oficina pueden pasar horas. En esa ventana la
       * cita seguía saliendo en la APK —otro operario podía recibirla otra
       * vez— y conservaba su botón «Llegó» en Operativo 2, que habría creado
       * un trabajo en paralelo al que saldrá de la recepción.
       *
       * Mientras hay una recepción pendiente, la cita ya no está «por
       * recibir»: está recibida y esperando validación, que es donde se la
       * ve ahora.
       */
      if (yaRecibidas?.has(Number(c.id))) return false;
      if (String(c.date ?? "") !== diaKey) return false;
      if (workshopId && c.workshopId && String(c.workshopId) !== String(workshopId)) {
        return false;
      }
      return true;
    })
    .sort((a, b) => String(a.startTime ?? "").localeCompare(String(b.startTime ?? "")));
}

/** `1700000000000` → `"09:30"`, en la hora local del taller. */
export function horaDeRecepcion(creadaAtMs: number): string {
  const d = new Date(creadaAtMs);
  const dos = (n: number) => String(n).padStart(2, "0");
  return `${dos(d.getHours())}:${dos(d.getMinutes())}`;
}

/** `1700000000000` → `"2026-09-19"`, para casar con el día de la agenda. */
export function diaDeRecepcion(creadaAtMs: number): string {
  const d = new Date(creadaAtMs);
  const dos = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
}

/**
 * Las recepciones que caen en el día que la agenda está pintando.
 *
 * La comparación va por la fecha local y no por el milisegundo: una recepción
 * de las 23:57 pertenece a ese día aunque en UTC ya sea el siguiente, que es
 * exactamente el caso con el que se probó esto.
 */
export function recepcionesDelDia<T extends { creadaAtMs: number }>(
  recepciones: T[],
  diaKey: string
): T[] {
  return recepciones.filter((r) => diaDeRecepcion(r.creadaAtMs) === diaKey);
}

/**
 * De las filas crudas de `quick_templates` a lo que ve el operario.
 *
 * ── Por qué recibe filas crudas y no una consulta a medida ──────────────────
 *
 * Porque el esquema de esa tabla NO es el que parece. `db.ts` la crea con
 * ocho columnas, y el resto del código escribe y lee otras tres
 * —`usesQuantity`, `unitMinutes`, `unitPrice`— que ninguna migración añade,
 * más un `workshopId` que tampoco existe en el CREATE. En Postgres, nombrar
 * una columna que no está no devuelve null: tumba la consulta ENTERA con
 * «column does not exist».
 *
 * Eso dejó el desplegable de operaciones vacío en el patio dos veces
 * seguidas: la primera por `usesQuantity`, y la segunda por `workshopId`, que
 * seguía en el mismo WHERE después de quitar la primera.
 *
 * El endpoint de plantillas que lleva años funcionando hace `SELECT *` y da
 * forma en JavaScript, y por eso nunca se rompió. Aquí se hace lo mismo: la
 * consulta no nombra ni una columna, y la decisión de qué sale vive aquí,
 * donde se puede probar sin base de datos.
 */
export function plantillasParaElPatio(
  filas: Record<string, unknown>[],
  workshopId?: string | null
): PlantillaParaOperario[] {
  return filas
    .filter((f) => {
      // Si la columna no existe, `undefined`; si existe y está vacía, la
      // plantilla es de todos los talleres. En los dos casos, se ofrece.
      const suyo = (f.workshopId ?? (f as any).workshopid ?? null) as string | null;
      if (!workshopId || !suyo) return true;
      return String(suyo) === String(workshopId);
    })
    .map((f) => ({
      key: String(f.key ?? ""),
      label: String(f.label ?? ""),
      area: String(f.area ?? "") as AreaKey,
    }))
    .filter((p) => p.key !== "" && p.label !== "");
}

/**
 * Lo que se le manda a la APK del técnico.
 *
 * `QuickTemplate` trae `unitPrice`. En la pantalla del técnico no se enseñan
 * precios, ni tarifas, ni importes: se quita aquí, en el único sitio por el
 * que pasa el catálogo, y hay un test que lo fija. Un `...plantilla` suelto en
 * cualquier endpoint futuro se lo llevaría por delante sin que nadie lo note.
 */
export type PlantillaParaOperario = {
  key: string;
  label: string;
  area: AreaKey;
};

export function plantillaParaOperario(plantilla: QuickTemplate): PlantillaParaOperario {
  return {
    key: plantilla.key,
    label: plantilla.label,
    area: plantilla.area,
  };
}
