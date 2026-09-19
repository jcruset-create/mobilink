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
  /** Cuentakilómetros al entrar. Lo que marca el vehículo, no una estimación. */
  kilometros?: number | null;
  /** Lo que leyó la IA del cuadro, sin tocar, y con cuánta confianza. */
  kilometrosOcr?: number | null;
  confianzaKilometrosOcr?: number | null;
  vehiculoId?: string | null;
  vehiculoOrigen?: OrigenVehiculo | null;
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

/** Confianza mínima para fiarse del OCR sin que el operario reescriba. */
export const CONFIANZA_OCR_MINIMA = 0.7;

/** Por debajo de 4 caracteres no se busca vehículo: traería media tabla. */
export const LARGO_MINIMO_MATRICULA = 4;

export type LecturaOcr = {
  matricula?: unknown;
  confianza?: unknown;
};

/**
 * ¿Sirve esta lectura para proponerla en el formulario?
 *
 * Devuelve la matrícula normalizada o `null`. `null` no es un error: significa
 * "que la escriba la persona". El OCR propone; nunca decide.
 */
export function matriculaPropuestaPorOcr(lectura: LecturaOcr | null | undefined): string | null {
  if (!lectura) return null;
  const confianza = Number(lectura.confianza);
  if (!Number.isFinite(confianza) || confianza < CONFIANZA_OCR_MINIMA) return null;
  const limpia = matriculaComparable(lectura.matricula);
  if (limpia.length < LARGO_MINIMO_MATRICULA) return null;
  return limpia;
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

export type LecturaKilometros = {
  kilometros?: unknown;
  confianza?: unknown;
};

/**
 * ¿Sirve esta lectura del cuadro para proponerla en el formulario?
 *
 * Mismo trato que la matrícula: devuelve el número o `null`, y `null` no es un
 * error, es «que lo escriba la persona». Lo que devuelve se le ENSEÑA al
 * operario en un campo editable; nunca se guarda sin que lo haya visto.
 *
 * Se aceptan los separadores de miles que trae cualquier cuadro («123.456»,
 * "123 456") porque la IA los devuelve tal cual los ve.
 */
export function kilometrosPropuestosPorOcr(
  lectura: LecturaKilometros | null | undefined
): number | null {
  if (!lectura) return null;
  const confianza = Number(lectura.confianza);
  if (!Number.isFinite(confianza) || confianza < CONFIANZA_OCR_MINIMA) return null;

  const crudo = String(lectura.kilometros ?? "").replace(/[^0-9]/g, "");
  if (crudo === "") return null;

  const km = Number(crudo);
  // El cero se descarta: un cuentakilómetros a cero es casi siempre una
  // lectura fallida, no un vehículo recién matriculado entrando al taller.
  if (!Number.isFinite(km) || km <= 0 || km > KILOMETROS_MAXIMOS) return null;
  return km;
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
    customerPhone: "",
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
