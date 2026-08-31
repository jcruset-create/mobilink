/**
 * Acuerdos comerciales con un partner: qué cubre, cuándo, por cuánto.
 *
 * ── Por qué no hay tabla nueva ──────────────────────────────────────────────
 *
 * `connect_provider_authorizations` ya era esto: relaciona un centro de control
 * con una empresa proveedora y guarda tipos de servicio, SLA y vigencia, con
 * sus tarifas colgando en `connect_tariff_lines`. Faltaban zonas, horarios,
 * límites económicos y condiciones, y eso es lo que se le añade. Crear una
 * segunda tabla de acuerdos habría dejado dos sitios donde mirar quién trabaja
 * con quién, que es exactamente el problema que se quería evitar.
 *
 * El partner tampoco duplica identidad: es la EMPRESA (`connect_provider_
 * companies`) más esta relación. La misma empresa puede ser proveedora de una
 * plataforma y cliente de otra sin tener dos fichas.
 *
 * ── Por qué esto es código puro ─────────────────────────────────────────────
 *
 * Decidir si un acuerdo cubre un servicio es una regla de negocio, no una
 * consulta: intervienen la zona, el horario, el tipo de servicio, el importe y
 * la vigencia a la vez, y el resultado tiene que poder explicarse («no cubre
 * Teruel», «fuera de horario»), no solo devolver sí o no. Escrito en SQL sería
 * imposible de probar y de contar; aquí se prueba sin base de datos y el motor
 * de enrutado lo reutiliza tal cual.
 *
 * Nada de esto vive en el frontend. La pantalla enseña el resultado y el
 * motivo; quien decide es el servidor.
 */

import { normalizarProvincia } from "../connect/regiones.ts";

/* ── Cobertura ───────────────────────────────────────────────────────────── */

export type Cobertura = {
  /** ISO-3166-1 alfa-2 en mayúsculas. Vacío = sin restricción de país. */
  paises: string[];
  /** Provincias normalizadas (sin acentos ni artículos). Vacío = todas. */
  provincias: string[];
  /**
   * Códigos postales. Admite prefijos (`08`, `433`) además del código
   * completo, porque así es como se pactan de verdad: «todo el 08 menos
   * Barcelona ciudad» se escribe con un prefijo y una exclusión.
   */
  codigosPostales: string[];
  /** Códigos postales excluidos: ganan siempre sobre los incluidos. */
  codigosPostalesExcluidos: string[];
  /** Radio desde la base, en km. Alternativa a las zonas administrativas. */
  radioKm: number | null;
};

export const COBERTURA_VACIA: Cobertura = {
  paises: [], provincias: [], codigosPostales: [], codigosPostalesExcluidos: [], radioKm: null,
};

function lista(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x ?? "").trim()).filter(Boolean);
}

export function leerCobertura(v: unknown): Cobertura {
  let o: any = v;
  if (typeof v === "string") { try { o = JSON.parse(v); } catch { o = {}; } }
  if (!o || typeof o !== "object") o = {};
  const radio = Number(o.radioKm ?? o.radiusKm);
  return {
    paises: lista(o.paises ?? o.countries).map((p) => p.toUpperCase()),
    provincias: lista(o.provincias ?? o.provinces).map(normalizarProvincia).filter(Boolean),
    codigosPostales: lista(o.codigosPostales ?? o.postalCodes),
    codigosPostalesExcluidos: lista(o.codigosPostalesExcluidos ?? o.postalCodesExcluded),
    radioKm: Number.isFinite(radio) && radio > 0 ? radio : null,
  };
}

/** Un código postal encaja si coincide entero o si empieza por uno pactado. */
function encajaCp(cp: string, patrones: string[]): boolean {
  const limpio = cp.replace(/\s/g, "");
  return patrones.some((p) => {
    const patron = p.replace(/[\s*]/g, "");
    return patron !== "" && limpio.startsWith(patron);
  });
}

/* ── Horarios ────────────────────────────────────────────────────────────── */

/**
 * Franja de un día de la semana, en minutos desde medianoche.
 *
 * `dia` sigue a `Date.getDay()`: 0 domingo … 6 sábado. Se admite `fin < inicio`
 * para las guardias que cruzan la medianoche (22:00–06:00), que es el caso
 * normal en asistencia en carretera y el que se olvida siempre.
 */
export type Franja = { dia: number; inicio: number; fin: number };

export type Horario = {
  /** Si es 24 h, no se miran las franjas. */
  veinticuatroHoras: boolean;
  franjas: Franja[];
};

export const HORARIO_24H: Horario = { veinticuatroHoras: true, franjas: [] };

function minutos(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  const s = String(v ?? "").trim();
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (!m) return null;
  const h = Number(m[1]); const min = Number(m[2]);
  if (h > 24 || min > 59) return null;
  return h * 60 + min;
}

export function leerHorario(v: unknown): Horario {
  let o: any = v;
  if (typeof v === "string") { try { o = JSON.parse(v); } catch { o = {}; } }
  if (!o || typeof o !== "object") o = {};
  if (o.veinticuatroHoras === true || o.always === true) return HORARIO_24H;

  const franjas: Franja[] = [];
  for (const f of Array.isArray(o.franjas ?? o.windows) ? (o.franjas ?? o.windows) : []) {
    const dia = Number((f as any)?.dia ?? (f as any)?.day);
    const inicio = minutos((f as any)?.inicio ?? (f as any)?.from);
    const fin = minutos((f as any)?.fin ?? (f as any)?.to);
    if (!Number.isInteger(dia) || dia < 0 || dia > 6) continue;
    if (inicio == null || fin == null || inicio === fin) continue;
    franjas.push({ dia, inicio, fin });
  }
  // Sin franjas y sin marca de 24 h se entiende 24 h: un acuerdo recién creado
  // no puede quedar cerrado a todas horas sin que nadie lo haya dicho.
  return franjas.length === 0 ? HORARIO_24H : { veinticuatroHoras: false, franjas };
}

export function abiertoEn(h: Horario, cuando: Date): boolean {
  if (h.veinticuatroHoras) return true;
  const dia = cuando.getDay();
  const m = cuando.getHours() * 60 + cuando.getMinutes();
  return h.franjas.some((f) => {
    if (f.fin > f.inicio) return f.dia === dia && m >= f.inicio && m < f.fin;
    /*
     * Franja que cruza medianoche: vale si hoy es su día y ya pasó la hora de
     * inicio, o si es la madrugada del día siguiente y aún no llegó el fin.
     */
    const diaSiguiente = (f.dia + 1) % 7;
    return (f.dia === dia && m >= f.inicio) || (diaSiguiente === dia && m < f.fin);
  });
}

/* ── Condiciones económicas y documentales ───────────────────────────────── */

export type Economico = {
  moneda: string;
  /** Por encima de esto hay que pedir presupuesto antes de encargar. */
  limiteSinPresupuesto: number | null;
  /** Tope duro del acuerdo: por encima no se encarga, se renegocia. */
  limiteMaximo: number | null;
  /** El partner exige presupuesto SIEMPRE, aunque haya tarifa pactada. */
  presupuestoObligatorio: boolean;
};

export type Condiciones = {
  /** Documentos que el partner tiene que devolver para poder facturar. */
  documentacionExigida: string[];
  /** Minutos antes de la llegada en que cancelar aún no cuesta. */
  cancelacionSinCosteMin: number | null;
  /** Importe o porcentaje pactado si se cancela fuera de plazo. */
  cancelacionCoste: number | null;
  cancelacionEnPorcentaje: boolean;
};

/* ── El acuerdo ──────────────────────────────────────────────────────────── */

export type Acuerdo = {
  id: number;
  controlCenterId: number;
  providerCompanyId: number;
  status: string;
  serviciosCubiertos: string[];      // [] = todos
  cobertura: Cobertura;
  horario: Horario;
  economico: Economico;
  condiciones: Condiciones;
  slaAcceptMin: number | null;
  slaArrivalMin: number | null;
  maxConcurrent: number | null;
  preferred: boolean;
  excluded: boolean;
  validFromMs: number | null;
  validToMs: number | null;
};

export type Peticion = {
  servicio?: string | null;
  pais?: string | null;
  provincia?: string | null;
  codigoPostal?: string | null;
  /** Distancia desde la base del partner, si se ha podido calcular. */
  distanciaKm?: number | null;
  importeEstimado?: number | null;
  cuando?: Date;
};

/** Un acuerdo está vigente si está activo y la fecha cae dentro. */
export function vigente(a: Acuerdo, cuandoMs = Date.now()): boolean {
  if (a.status !== "active" || a.excluded) return false;
  if (a.validFromMs != null && cuandoMs < a.validFromMs) return false;
  if (a.validToMs != null && cuandoMs > a.validToMs) return false;
  return true;
}

export type Evaluacion = {
  apto: boolean;
  motivos: string[];
  /** Hay que pedir presupuesto antes de encargar. */
  requierePresupuesto: boolean;
};

/**
 * ¿Puede este acuerdo hacerse cargo de esta petición?
 *
 * Devuelve TODOS los motivos por los que no, no solo el primero. Quien mira
 * por qué no sale ningún partner necesita la lista entera: arreglar la zona
 * para descubrir después que tampoco es el horario es perder dos viajes.
 */
export function evaluar(a: Acuerdo, p: Peticion): Evaluacion {
  const motivos: string[] = [];
  const cuando = p.cuando ?? new Date();

  if (!vigente(a, cuando.getTime())) {
    motivos.push(a.excluded ? "Partner excluido" : "Acuerdo no vigente");
  }

  if (p.servicio && a.serviciosCubiertos.length > 0
      && !a.serviciosCubiertos.includes(String(p.servicio))) {
    motivos.push(`No cubre el servicio ${p.servicio}`);
  }

  motivos.push(...motivosDeCobertura(a.cobertura, p));

  if (!abiertoEn(a.horario, cuando)) motivos.push("Fuera del horario pactado");

  const importe = p.importeEstimado;
  if (importe != null && Number.isFinite(importe)) {
    if (a.economico.limiteMaximo != null && importe > a.economico.limiteMaximo) {
      motivos.push(`Supera el tope del acuerdo (${a.economico.limiteMaximo} ${a.economico.moneda})`);
    }
  }

  /*
   * El presupuesto NO es un motivo para descartar: es un paso más antes de
   * encargar. Confundirlo con una incompatibilidad dejaría fuera justo a los
   * partners con los que aún no hay tarifa cerrada.
   */
  const requierePresupuesto = a.economico.presupuestoObligatorio
    || (a.economico.limiteSinPresupuesto != null && importe != null
        && Number.isFinite(importe) && importe > a.economico.limiteSinPresupuesto);

  return { apto: motivos.length === 0, motivos, requierePresupuesto };
}

function motivosDeCobertura(c: Cobertura, p: Peticion): string[] {
  const motivos: string[] = [];

  if (c.paises.length > 0 && p.pais) {
    if (!c.paises.includes(String(p.pais).toUpperCase())) motivos.push(`No cubre el país ${p.pais}`);
  }

  const cp = p.codigoPostal ? String(p.codigoPostal).replace(/\s/g, "") : "";

  // La exclusión manda: se pacta justo para recortar una zona ya incluida.
  if (cp && c.codigosPostalesExcluidos.length > 0 && encajaCp(cp, c.codigosPostalesExcluidos)) {
    motivos.push(`Código postal ${cp} excluido del acuerdo`);
    return motivos;
  }

  /*
   * Provincia y código postal se miran como alternativas, no como requisitos
   * acumulativos: quien pacta «Tarragona» y quien pacta «43» está diciendo lo
   * mismo, y exigir las dos cosas dejaría fuera al que solo rellenó una.
   */
  const hayZonas = c.provincias.length > 0 || c.codigosPostales.length > 0;
  if (hayZonas) {
    const porProvincia = c.provincias.length > 0 && p.provincia
      && c.provincias.includes(normalizarProvincia(p.provincia));
    const porCp = c.codigosPostales.length > 0 && cp !== "" && encajaCp(cp, c.codigosPostales);
    if (!porProvincia && !porCp) {
      motivos.push(p.provincia || cp
        ? `Fuera de la zona pactada (${p.provincia || cp})`
        : "Sin zona en la petición y el acuerdo la exige");
    }
  }

  if (c.radioKm != null && p.distanciaKm != null && Number.isFinite(p.distanciaKm)
      && p.distanciaKm > c.radioKm) {
    motivos.push(`A ${Math.round(p.distanciaKm)} km, fuera del radio de ${c.radioKm} km`);
  }

  return motivos;
}
