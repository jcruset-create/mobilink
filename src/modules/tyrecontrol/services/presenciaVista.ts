/**
 * Cómo se ordena y agrupa lo que enseña «Vehículos en bases».
 *
 * Vive fuera del componente porque son decisiones con criterio —a quién se
 * enseña primero, qué cuenta como «dentro»— y eso merece pruebas, no un
 * `useMemo` que nadie puede comprobar.
 */

import type { PresenciaEnBase, RevisionEstado, VehiculoWebfleetEstado } from "../types";
import type { VehiculoPresencia } from "./presenciaBases";

/**
 * Prioridad de una revisión: cuanto menor, más arriba.
 *
 * Nunca revisado va antes que vencida, y vencida antes que próxima. El nunca
 * revisado primero no es un capricho: de ese no se sabe ni cómo está, y es el
 * que más se arriesga a irse de la base sin que nadie le haya mirado nada.
 */
export function prioridadRevision(estado: string | undefined): number {
  if (estado === "sin_revision") return 0;
  if (estado === "vencida") return 1;
  if (estado === "proxima") return 2;
  return 3;
}

/** ¿Tiene este vehículo algo pendiente que justifique cogerlo ahora? */
export function tieneRevisionPendiente(rev: RevisionEstado | undefined): boolean {
  return rev?.estado === "sin_revision" || rev?.estado === "vencida" || rev?.estado === "proxima";
}

/**
 * Los que están DENTRO de una base con posición reciente, por base.
 *
 * `STALE_POSITION` no entra, y es la decisión importante de este módulo: su
 * última posición cae dentro de la base y probablemente sigan ahí, pero
 * «probablemente» no es a quien se manda buscar al patio. Se cuentan aparte
 * con `dormidosPorBase`.
 */
export function agruparPorBase(
  vehiculos: VehiculoPresencia[],
  revisiones: Map<string, RevisionEstado>,
): Map<string, VehiculoPresencia[]> {
  const m = new Map<string, VehiculoPresencia[]>();
  for (const v of vehiculos) {
    if (v.estado !== "IN_BASE" || !v.delegacion_id) continue;
    const lista = m.get(v.delegacion_id) ?? [];
    lista.push(v);
    m.set(v.delegacion_id, lista);
  }
  for (const lista of m.values()) {
    lista.sort((a, b) => {
      const pa = prioridadRevision(revisiones.get(a.vehiculo_id)?.estado);
      const pb = prioridadRevision(revisiones.get(b.vehiculo_id)?.estado);
      if (pa !== pb) return pa - pb;
      // A igualdad, el que lleva más tiempo en la base: ese ya está aparcado,
      // no acabando de entrar.
      return (a.entrada_base_at ?? "") < (b.entrada_base_at ?? "") ? -1 : 1;
    });
  }
  return m;
}

/**
 * Cuántos, por base, están dentro AHORA y con revisión pendiente.
 *
 * Es el número que decide a qué patio bajar: «155 dentro» dice cuántos hay,
 * pero no cuántos hay algo que hacerles. Se cuenta sobre los mismos que
 * devuelve `agruparPorBase` —posición reciente, nada de «probablemente sigan
 * ahí»— para que el recuento de la tarjeta y la lista que se abre al pulsarla
 * hablen de los mismos vehículos.
 */
export function revisablesPorBase(
  vehiculos: VehiculoPresencia[],
  revisiones: Map<string, RevisionEstado>,
): Map<string, number> {
  const m = new Map<string, number>();
  for (const v of vehiculos) {
    if (v.estado !== "IN_BASE" || !v.delegacion_id) continue;
    if (!tieneRevisionPendiente(revisiones.get(v.vehiculo_id))) continue;
    m.set(v.delegacion_id, (m.get(v.delegacion_id) ?? 0) + 1);
  }
  return m;
}

/** Cuántos, por base, tienen la última posición dentro pero ya vieja. */
export function dormidosPorBase(vehiculos: VehiculoPresencia[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const v of vehiculos) {
    if (v.estado !== "STALE_POSITION" || !v.delegacion_id) continue;
    m.set(v.delegacion_id, (m.get(v.delegacion_id) ?? 0) + 1);
  }
  return m;
}

/**
 * En base AHORA y con revisión pendiente: la lista que justifica la pantalla.
 *
 * Ordenados por prioridad y, dentro de ella, por lo vencido que esté: el que
 * lleva 40 días de retraso antes que el que lleva 3.
 */
export function revisablesEnBase(
  vehiculos: VehiculoPresencia[],
  revisiones: Map<string, RevisionEstado>,
): VehiculoPresencia[] {
  return vehiculos
    .filter((v) => v.estado === "IN_BASE" && tieneRevisionPendiente(revisiones.get(v.vehiculo_id)))
    .sort((a, b) => {
      const pa = prioridadRevision(revisiones.get(a.vehiculo_id)?.estado);
      const pb = prioridadRevision(revisiones.get(b.vehiculo_id)?.estado);
      if (pa !== pb) return pa - pb;
      const da = revisiones.get(a.vehiculo_id)?.dias_vencido ?? 0;
      const db = revisiones.get(b.vehiculo_id)?.dias_vencido ?? 0;
      return db - da;
    });
}

/** Cuánto lleva desde un instante, en palabras. `—` si no hay instante. */
export function desde(iso: string | null | undefined, ahora = Date.now()): string {
  if (!iso) return "—";
  const ms = ahora - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const min = Math.floor(ms / 60000);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return h < 24 ? `${h} h ${min % 60} min` : `${Math.floor(h / 24)} d ${h % 24} h`;
}

/** Una antigüedad en minutos, redondeada a la unidad que se lee mejor. */
export function minutosEnPalabras(min: number | null | undefined): string {
  if (min == null) return "—";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return h < 24 ? `${h} h` : `${Math.floor(h / 24)} d`;
}

/**
 * Una fecha de revisión, corta y en castellano. `—` si no hay ninguna.
 *
 * La ausencia se enseña como raya y no como «nunca»: el distintivo de al lado
 * ya dice «Sin revisión», y repetirlo con otras palabras en la misma línea no
 * añade nada.
 */
export function fechaCorta(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric" });
}

/**
 * Quién hizo la última revisión, para enseñarlo debajo de la fecha.
 *
 * Un nombre y una máquina no dicen lo mismo: «David» es alguien que miró la
 * rueda, y «CheckPoint» es el arco de la entrada, que mide al pasar y no
 * levanta el vehículo. Quien decide a cuál coger ahora que está en la base
 * quiere saber cuál de las dos fue.
 *
 * Una revisión de técnico sin nombre —porque los permisos no dejan ver ese
 * usuario— se queda en «Técnico» genérico, que es verdad, en vez de en una
 * raya que haría pensar que no la hizo nadie.
 */
export function quienRevisó(rev: RevisionEstado | undefined): string {
  if (!rev) return "—";
  if (rev.ultima_revision_origen === "checkpoint") return "CheckPoint";
  if (rev.ultima_revision_origen === "tecnico") return rev.ultima_revision_por || "Técnico";
  return "—";
}

/**
 * ¿Es este «Al día» un «al día» de verdad?
 *
 * El estado sale de comparar la última revisión con la periodicidad del
 * vehículo o de su tipo. Cuando no hay ninguna de las dos, no hay con qué
 * comparar y el cálculo se queda en «al día» por descarte: no porque la
 * revisión esté en plazo, sino porque nadie ha dicho cuál es el plazo.
 *
 * Pasa con los vehículos dados de alta desde la tablet, que nacen sin tipo:
 * en cuanto se les hace la primera revisión salen «Al día» para siempre y no
 * vuelven a aparecer como pendientes. Un «al día» que no significa nada es
 * peor que un hueco, porque nadie va a ir a mirarlo.
 */
export function sinPeriodicidad(rev: RevisionEstado | undefined): boolean {
  return !!rev && rev.estado === "al_dia" && rev.intervalo_dias == null;
}

/** Los que están en base ahora y arrastran ese «al día» que no dice nada. */
export function sinPeriodicidadEnBase(
  vehiculos: VehiculoPresencia[],
  revisiones: Map<string, RevisionEstado>,
): VehiculoPresencia[] {
  return vehiculos.filter(
    (v) => v.estado === "IN_BASE" && sinPeriodicidad(revisiones.get(v.vehiculo_id)),
  );
}

/** Dónde está un vehículo, dicho en una línea, o `null` si no se sabe. */
export interface EtiquetaBase {
  /** Nombre de la base. */
  base: string;
  /** `true` si la posición es reciente; `false` si es lo último que se supo. */
  ahora: boolean;
}

/**
 * En qué base está un vehículo, mirando las dos fuentes que hay.
 *
 * Son dos porque son dos: el barrido del Hub —que vale para cualquier
 * proveedor— y la sincronización Webfleet de siempre, que solo sabe de los
 * suyos. Manda la del Hub cuando dice algo, porque es la que se calcula con
 * las geo-zonas actuales; la de Webfleet es el respaldo para los clientes que
 * todavía no tienen cuenta en el Hub.
 *
 * `ahora: false` es «aquí se le vio por última vez», no «está aquí»: una
 * posición vieja dentro de una base es un indicio bueno —el equipo se duerme
 * al aparcar— pero no una certeza, y quien lea la etiqueta tiene que poder
 * distinguirlo antes de bajar al patio a buscarlo.
 */
export function etiquetaBase(
  presencia: PresenciaEnBase | undefined,
  webfleet: VehiculoWebfleetEstado | undefined,
): EtiquetaBase | null {
  const nombreHub = presencia?.delegacion?.nombre;
  if (nombreHub && presencia?.estado === "IN_BASE") return { base: nombreHub, ahora: true };
  if (nombreHub && presencia?.estado === "STALE_POSITION") return { base: nombreHub, ahora: false };

  const nombreWf = webfleet?.delegacion?.nombre;
  if (nombreWf && (webfleet?.estado === "en_base" || webfleet?.estado === "otra_base")) {
    return { base: nombreWf, ahora: true };
  }
  return null;
}

/** Dónde está un vehículo, para la chapa de su ficha. */
export interface Ubicacion {
  /** Lo que se lee de un vistazo: «En base · Reus», «En ruta»… */
  texto: string;
  /** La letra pequeña: de cuándo es la posición, o por qué no la hay. */
  detalle?: string;
  /**
   * Cómo pintarlo. `base` es el único que afirma que el vehículo está ahí;
   * `viejo` es «esto es lo último que se supo» y `desconocido` es no saber.
   */
  tono: "base" | "ruta" | "viejo" | "desconocido";
}

/**
 * En qué base está un vehículo, o si anda por ahí, para la ficha.
 *
 * Es el hermano largo de `etiquetaBase`: aquella resuelve una chapa de una
 * línea en una lista, y esta tiene sitio para decir además de cuándo es la
 * posición y por qué falta cuando falta.
 *
 * Las dos fuentes y su orden son los mismos —el barrido del Hub manda sobre la
 * sincronización Webfleet— por la razón de siempre: el Hub vale para cualquier
 * proveedor y calcula con las geo-zonas actuales.
 *
 * La distinción que no se puede perder es entre «está» y «se le vio»: una
 * posición vieja dentro de una base es un indicio bueno, no un hecho, y quien
 * baje al patio a buscar el camión tiene derecho a saber cuál de las dos cosas
 * le están diciendo.
 */
export function ubicacionDeVehiculo(params: {
  presencia?: PresenciaEnBase;
  webfleet?: VehiculoWebfleetEstado;
  ahora?: number;
}): Ubicacion {
  const { presencia, webfleet } = params;
  const ahora = params.ahora ?? Date.now();
  const cuando = (iso: string | null | undefined) =>
    iso ? `posición de hace ${desde(iso, ahora)}` : undefined;

  if (presencia) {
    const base = presencia.delegacion?.nombre;
    if (presencia.estado === "IN_BASE") {
      return {
        texto: base ? `En base · ${base}` : "En base",
        detalle: cuando(presencia.posicion_at),
        tono: "base",
      };
    }
    if (presencia.estado === "OUTSIDE_BASES") {
      return { texto: "En ruta", detalle: cuando(presencia.posicion_at), tono: "ruta" };
    }
    if (presencia.estado === "STALE_POSITION") {
      return {
        texto: base ? `Última vez en ${base}` : "Última vez fuera de las bases",
        detalle: cuando(presencia.posicion_at) ?? "sin fecha de posición",
        tono: "viejo",
      };
    }
    if (presencia.estado === "INVALID_POSITION") {
      return { texto: "Posición no válida", detalle: "el equipo no tenía fijación GPS", tono: "desconocido" };
    }
    // NO_POSITION: puede ser que falte vincularlo o que el proveedor calle. No
    // se sabe desde aquí, así que no se afirma ninguna de las dos.
  }

  if (webfleet) {
    const base = webfleet.delegacion?.nombre;
    if (webfleet.estado === "en_base" || webfleet.estado === "otra_base") {
      return {
        texto: base ? `En base · ${base}` : "En base",
        detalle: cuando(webfleet.pos_time),
        tono: "base",
      };
    }
    if (webfleet.estado === "en_ruta") {
      return { texto: "En ruta", detalle: cuando(webfleet.pos_time), tono: "ruta" };
    }
    if (webfleet.estado === "sin_conexion") {
      return { texto: "Sin conexión", detalle: cuando(webfleet.pos_time), tono: "desconocido" };
    }
  }

  return {
    texto: "Sin posición",
    detalle: "no está vinculado con la telemática, o su proveedor no dice nada de él",
    tono: "desconocido",
  };
}

/* ── Llevar el vehículo al mapa ──────────────────────────────────────────── */

/** Una posición que se puede abrir en un mapa. */
export interface PosicionMapa {
  lat: number;
  lng: number;
  /** Instante de la posición según el proveedor, si lo dice. */
  cuando?: string | null;
  /** De dónde salió, para poder explicarlo en la ficha. */
  fuente: "hub" | "webfleet";
}

/**
 * ¿Es una coordenada de verdad?
 *
 * El 0,0 se descarta a propósito: es lo que devuelven varios equipos cuando
 * NO tienen fijación GPS, y llevaría al vehículo al golfo de Guinea con toda
 * la seguridad del mundo. Mejor no ofrecer el mapa que señalar un sitio falso.
 */
function coordenadaValida(lat: unknown, lng: unknown): boolean {
  const la = Number(lat), lo = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(lo)) return false;
  if (Math.abs(la) > 90 || Math.abs(lo) > 180) return false;
  return !(la === 0 && lo === 0);
}

/**
 * La posición del vehículo para enseñarla en un mapa, de las dos fuentes que
 * hay: el barrido del Hub (vale para cualquier proveedor) y la sincronización
 * Webfleet (solo para los suyos).
 *
 * Manda la MÁS RECIENTE, no una fuente fija: las dos se actualizan por su
 * cuenta y a distinto ritmo, así que cuál va por delante cambia con la hora
 * del día. Si ninguna dice de cuándo es su posición, manda el Hub, que es la
 * que cubre a toda la flota.
 */
export function coordenadasDeVehiculo(params: {
  presencia?: PresenciaEnBase;
  webfleet?: VehiculoWebfleetEstado;
}): PosicionMapa | null {
  const candidatas: PosicionMapa[] = [];
  const { presencia, webfleet } = params;

  if (presencia && coordenadaValida(presencia.lat, presencia.lng)) {
    candidatas.push({
      lat: Number(presencia.lat), lng: Number(presencia.lng),
      cuando: presencia.posicion_at ?? null, fuente: "hub",
    });
  }
  if (webfleet && coordenadaValida(webfleet.lat, webfleet.lng)) {
    candidatas.push({
      lat: Number(webfleet.lat), lng: Number(webfleet.lng),
      cuando: webfleet.pos_time ?? null, fuente: "webfleet",
    });
  }
  if (candidatas.length === 0) return null;

  const instante = (p: PosicionMapa) => {
    const t = p.cuando ? new Date(p.cuando).getTime() : NaN;
    return Number.isFinite(t) ? t : -Infinity;
  };
  // Empate (las dos sin fecha, o con la misma): se queda la primera, que es
  // la del Hub por el orden en que se han metido.
  return candidatas.reduce((mejor, p) => (instante(p) > instante(mejor) ? p : mejor));
}

/**
 * El enlace al mapa. Google Maps con la coordenada y nada más: no se manda ni
 * la matrícula ni el cliente, y no hace falta ninguna clave de API —así no hay
 * ninguna que exponer en el panel—.
 *
 * Misma forma que usa ConnectPro para sus unidades y sus asistencias
 * (`maps?q=lat,lng`): un solo modo de abrir un mapa en todo Mobilink.
 */
export function enlaceDeMapa(pos: PosicionMapa): string {
  return `https://www.google.com/maps?q=${pos.lat.toFixed(6)},${pos.lng.toFixed(6)}`;
}
