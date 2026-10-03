/**
 * Motor de autorización de accesos físicos (fase 3). PURO: recibe los HECHOS
 * (puerta, persona, contratos, bloqueos, permisos, dispositivo) y devuelve
 * `granted`/`denied` con un código de motivo. Lo cargan de la base los
 * servicios; aquí no hay SQL ni red.
 *
 * Es el ÚNICO sitio con estas reglas: lo usan la apertura desde la app, la
 * administrativa, el enlace temporal y el cálculo de los teléfonos que tiene
 * que tener cada RUT241. Ningún endpoint decide por su cuenta.
 *
 * Principio: derecho de acceso ≠ mecanismo físico. Aquí se decide el derecho;
 * el dispositivo sólo ejecuta lo decidido.
 *
 * Un permiso guardado NO es la fuente de verdad: además de que exista, en
 * cada intento se vuelve a comprobar que la puerta corresponde al contrato
 * (centro y zona), el estado del contrato, los bloqueos y el horario.
 */

import type { AccessMethod, AccessReason, BlockReason, ContractStatus, DoorType } from "../../../src/modules/self-storage/types/enums.ts";

// ── Horario ─────────────────────────────────────────────────────────────────

/** Días 1 (lunes) … 7 (domingo); horas «HH:MM». `to` < `from` cruza la medianoche. */
export type ReglaHorario = { days: number[]; from: string; to: string };
export type Horario = { timezone?: string; rules: ReglaHorario[] } | null;

const minutos = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

/** Día de la semana (1-7) y minuto del día en la zona horaria del centro. */
export function momentoLocal(at: Date, timezone: string): { dia: number; minuto: number } {
  const partes = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(at);
  const v = (t: string) => partes.find((p) => p.type === t)?.value ?? "";
  const dia = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(v("weekday")) + 1;
  return { dia, minuto: Number(v("hour")) * 60 + Number(v("minute")) };
}

/** ¿Está `at` dentro del horario? Sin horario (null o sin reglas) = 24 h. */
export function dentroDeHorario(horario: Horario, at: Date, timezoneCentro: string): boolean {
  if (!horario || !horario.rules?.length) return true;
  const { dia, minuto } = momentoLocal(at, horario.timezone || timezoneCentro);
  const ayer = dia === 1 ? 7 : dia - 1;
  return horario.rules.some((r) => {
    const desde = minutos(r.from);
    const hasta = minutos(r.to);
    if (desde === hasta) return r.days.includes(dia); // «00:00-00:00»: todo el día
    if (desde < hasta) return r.days.includes(dia) && minuto >= desde && minuto < hasta;
    // Cruza la medianoche: la parte de hoy desde `from` y la de ayer hasta `to`.
    return (r.days.includes(dia) && minuto >= desde) || (r.days.includes(ayer) && minuto < hasta);
  });
}

/** Valida la forma de un horario (lo usa el servidor antes de guardarlo). */
export function horarioValido(h: unknown): h is NonNullable<Horario> {
  if (!h || typeof h !== "object") return false;
  const reglas = (h as { rules?: unknown }).rules;
  if (!Array.isArray(reglas)) return false;
  return reglas.every(
    (r) =>
      r &&
      Array.isArray(r.days) &&
      r.days.length > 0 &&
      r.days.every((d: unknown) => Number.isInteger(d) && (d as number) >= 1 && (d as number) <= 7) &&
      typeof r.from === "string" &&
      typeof r.to === "string" &&
      /^([01]\d|2[0-3]):[0-5]\d$/.test(r.from) &&
      /^([01]\d|2[0-3]):[0-5]\d$/.test(r.to)
  );
}

// ── Qué puertas da un contrato ──────────────────────────────────────────────

export type PuertaBasica = { id: string; centerId: string; zoneId: string | null; doorType: DoorType; enabled: boolean };

/**
 * Puertas que corresponden a un contrato por sí mismo: las PRINCIPALES de su
 * centro y las de la ZONA de su trastero. No las de otras zonas, ni las
 * interiores u «otras» (ésas se dan a mano, como permiso `manual`).
 *
 *   contrato en Zona 2 → puerta principal + puerta Zona 2 (no Zona 1 ni 3).
 */
export function puertaCorrespondeAlContrato(p: PuertaBasica, contrato: { centerId: string; unitZoneId: string }): boolean {
  if (p.centerId !== contrato.centerId) return false;
  if (p.doorType === "main") return true;
  if (p.doorType === "zone") return p.zoneId === contrato.unitZoneId;
  return false;
}

export function puertasDelContrato(puertas: PuertaBasica[], contrato: { centerId: string; unitZoneId: string }): string[] {
  return puertas.filter((p) => p.enabled && puertaCorrespondeAlContrato(p, contrato)).map((p) => p.id);
}

/** Estados del contrato que conservan sus permisos (aunque estén bloqueados). */
export const ESTADOS_CON_PERMISOS: readonly ContractStatus[] = ["active", "suspended"];

// ── Hechos de una evaluación ────────────────────────────────────────────────

export type HechosPuerta = {
  id: string;
  centerId: string;
  enabled: boolean;
  allowApp: boolean;
  allowPhone: boolean;
  schedule: Horario;
  timezone: string;
  /** null = la puerta no tiene salida asignada. */
  salida: null | { enabled: boolean; dispositivo: { enabled: boolean; status: "unknown" | "online" | "offline" } };
};

export type HechosContrato = {
  id: string;
  status: ContractStatus;
  /** La puerta es la principal del centro o la de la zona de su trastero (derivado, no guardado). */
  puertaDerivada: boolean;
  /** Permiso guardado y activo para esta puerta (de contrato o manual), con su ventana. */
  permiso: null | { validFrom: Date | null; validUntil: Date | null; source: "contract" | "manual" };
  /** Bloqueos ABIERTOS del contrato y los del cliente sin contrato. */
  bloqueos: BlockReason[];
};

export type Actor =
  | { tipo: "staff" }
  | { tipo: "customer"; customerStatus: string; contratos: HechosContrato[] }
  | { tipo: "member"; memberStatus: string; allowApp: boolean; allowPhone: boolean; customerStatus: string; contratos: HechosContrato[] }
  | {
      tipo: "temporary";
      status: string;
      startsAt: Date;
      endsAt: Date;
      maxUses: number | null;
      usesCount: number;
      doorIds: string[];
      /** Sólo si depende de un cliente/contrato. */
      customerStatus: string | null;
      contratos: HechosContrato[];
      dependeDeContrato: boolean;
    };

export type Evaluacion = { granted: boolean; reason: AccessReason; contractId: string | null };

const deniega = (reason: AccessReason, contractId: string | null = null): Evaluacion => ({ granted: false, reason, contractId });

/** Del bloqueo más grave al más leve: es el motivo que se enseña. */
const PRIORIDAD_BLOQUEO: [BlockReason, AccessReason][] = [
  ["security", "SECURITY_BLOCK"],
  ["terminated", "CONTRACT_TERMINATED"],
  ["manual", "MANUAL_BLOCK"],
  ["incident", "INCIDENT_BLOCK"],
  ["payment", "PAYMENT_BLOCK"],
];

/** Un contrato concreto frente a una puerta concreta, en `at`. */
function evaluarContrato(k: HechosContrato, at: Date): AccessReason {
  // 1. Bloqueos (todos cuentan; se informa del más grave).
  for (const [motivo, razon] of PRIORIDAD_BLOQUEO) if (k.bloqueos.includes(motivo)) return razon;
  // 2. Estado vivo del contrato (no lo que diga un permiso guardado).
  if (k.status === "terminated" || k.status === "cancelled") return "CONTRACT_TERMINATED";
  if (k.status !== "active") return "CONTRACT_NOT_ACTIVE";
  // 3. Permiso guardado Y vigente.
  if (!k.permiso) return "DOOR_NOT_ALLOWED";
  if ((k.permiso.validFrom && at < k.permiso.validFrom) || (k.permiso.validUntil && at >= k.permiso.validUntil)) return "PERMISSION_EXPIRED";
  // 4. La puerta tiene que seguir correspondiendo al contrato (salvo permiso manual).
  if (k.permiso.source === "contract" && !k.puertaDerivada) return "DOOR_NOT_ALLOWED";
  return "GRANTED";
}

/** Gravedad para elegir qué motivo enseñar cuando ningún contrato abre. */
const ORDEN_MOTIVO: AccessReason[] = [
  "SECURITY_BLOCK",
  "CONTRACT_TERMINATED",
  "MANUAL_BLOCK",
  "INCIDENT_BLOCK",
  "PAYMENT_BLOCK",
  "CONTRACT_NOT_ACTIVE",
  "PERMISSION_EXPIRED",
  "DOOR_NOT_ALLOWED",
];

/**
 * Entre los contratos de la persona, ¿alguno abre esta puerta? Sólo cuentan
 * los que tienen algo que ver con ella (derivada o con permiso): un contrato
 * de otro centro no hace ruido en el motivo.
 */
function evaluarContratos(contratos: HechosContrato[], at: Date): Evaluacion {
  const relevantes = contratos.filter((k) => k.puertaDerivada || k.permiso);
  if (!relevantes.length) return deniega(contratos.length ? "DOOR_NOT_ALLOWED" : "CONTRACT_NOT_ACTIVE");
  let peor: Evaluacion | null = null;
  for (const k of relevantes) {
    const r = evaluarContrato(k, at);
    if (r === "GRANTED") return { granted: true, reason: "GRANTED", contractId: k.id };
    if (!peor || ORDEN_MOTIVO.indexOf(r) < ORDEN_MOTIVO.indexOf(peor.reason)) peor = deniega(r, k.id);
  }
  return peor!;
}

export type OpcionesEvaluacion = {
  /**
   * Para calcular la lista de teléfonos de un dispositivo no se mira el estado
   * del propio dispositivo (si está caído, la lista se le aplicará al volver).
   */
  ignorarDispositivo?: boolean;
};

/**
 * evaluateAccess: ¿puede este actor abrir esta puerta, por este método, en
 * este momento?
 *
 * Orden de comprobación: puerta → método → persona → contrato(s) y bloqueos →
 * permiso → horario → dispositivo. El dispositivo va al final para que un
 * cliente bloqueado vea «bloqueado» aunque además la puerta esté sin conexión.
 */
export function evaluateAccess(puerta: HechosPuerta, actor: Actor, at: Date, metodo: AccessMethod, op: OpcionesEvaluacion = {}): Evaluacion {
  if (!puerta.enabled) return deniega("DOOR_DISABLED");
  if (metodo === "app" && !puerta.allowApp) return deniega("METHOD_NOT_ALLOWED");
  if (metodo === "phone" && !puerta.allowPhone) return deniega("METHOD_NOT_ALLOWED");
  if (metodo === "admin" && actor.tipo !== "staff") return deniega("METHOD_NOT_ALLOWED");

  let resultado: Evaluacion;
  switch (actor.tipo) {
    case "staff":
      // La apertura administrativa no pasa por contrato ni horario (por eso se audita).
      resultado = { granted: true, reason: "GRANTED", contractId: null };
      break;
    case "customer":
      if (actor.customerStatus === "blocked") return deniega("CUSTOMER_BLOCKED");
      if (actor.customerStatus !== "active") return deniega("CUSTOMER_NOT_ACTIVE");
      resultado = evaluarContratos(actor.contratos, at);
      break;
    case "member":
      if (actor.memberStatus !== "active") return deniega("MEMBER_NOT_ACTIVE");
      if (metodo === "app" && !actor.allowApp) return deniega("METHOD_NOT_ALLOWED");
      if (metodo === "phone" && !actor.allowPhone) return deniega("METHOD_NOT_ALLOWED");
      if (actor.customerStatus === "blocked") return deniega("CUSTOMER_BLOCKED");
      resultado = evaluarContratos(actor.contratos, at);
      break;
    case "temporary":
      if (actor.status !== "active") return deniega("TEMPORARY_ACCESS_REVOKED");
      if (at < actor.startsAt) return deniega("TEMPORARY_ACCESS_NOT_STARTED");
      if (at >= actor.endsAt) return deniega("TEMPORARY_ACCESS_EXPIRED");
      if (actor.maxUses != null && actor.usesCount >= actor.maxUses) return deniega("TEMPORARY_ACCESS_EXHAUSTED");
      if (!actor.doorIds.includes(puerta.id)) return deniega("DOOR_NOT_ALLOWED");
      if (actor.customerStatus === "blocked") return deniega("CUSTOMER_BLOCKED");
      // Dependiente de un contrato: si el contrato no abre esa puerta, el temporal tampoco.
      resultado = actor.dependeDeContrato ? evaluarContratos(actor.contratos, at) : { granted: true, reason: "GRANTED", contractId: null };
      break;
  }
  if (!resultado.granted) return resultado;

  if (actor.tipo !== "staff" && !dentroDeHorario(puerta.schedule, at, puerta.timezone)) return deniega("OUTSIDE_SCHEDULE", resultado.contractId);

  if (!op.ignorarDispositivo) {
    if (!puerta.salida) return deniega("DEVICE_NOT_CONFIGURED", resultado.contractId);
    if (!puerta.salida.enabled || !puerta.salida.dispositivo.enabled) return deniega("DEVICE_DISABLED", resultado.contractId);
    if (puerta.salida.dispositivo.status === "offline") return deniega("DEVICE_OFFLINE", resultado.contractId);
  }
  return resultado;
}

// ── Teléfonos que debe tener un dispositivo (estado deseado) ────────────────

/**
 * Una persona con teléfono que podría abrir por llamada. Sus hechos dependen
 * de la puerta (permiso, zona), así que puede dar un actor por puerta.
 */
export type CandidatoTelefono = { phone: string; origen: string; actor: Actor | ((puertaId: string) => Actor | null) };

/**
 * Lista DESEADA de teléfonos de un dispositivo: los de las personas que, con
 * el mismo motor, pueden abrir por llamada AHORA alguna de sus puertas.
 *
 * Es un cálculo de estado completo, no altas/bajas sueltas: un número que
 * comparten dos contratos sigue en la lista mientras cualquiera de los dos lo
 * justifique. Ordenada y sin repetidos (la huella sale de aquí).
 */
export function telefonosDeseados(puertasDelDispositivo: HechosPuerta[], candidatos: CandidatoTelefono[], at: Date): string[] {
  const conLlamada = puertasDelDispositivo.filter((p) => p.allowPhone);
  const si = new Set<string>();
  for (const c of candidatos) {
    if (si.has(c.phone)) continue;
    const abre = conLlamada.some((p) => {
      const actor = typeof c.actor === "function" ? c.actor(p.id) : c.actor;
      return actor ? evaluateAccess(p, actor, at, "phone", { ignorarDispositivo: true }).granted : false;
    });
    if (abre) si.add(c.phone);
  }
  return [...si].sort();
}
