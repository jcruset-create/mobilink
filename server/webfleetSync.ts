// ============================================================
// SEA TyreControl — Servicio de sincronización Webfleet (aislado).
//
// Consulta periódicamente la posición de los vehículos y calcula, POR
// POSICIÓN, en qué base están (comparando con las bases definidas en
// tc_bases_webfleet: centro+radio o polígono). Actualiza el estado
// Webfleet de cada vehículo. NO hace seguimiento GPS: solo sirve para
// saber qué vehículos están en base y aprovechar para revisarlos.
//
// Toda la lógica queda aquí, desacoplada del resto del backend.
// ============================================================
import { supabase } from "./supabase.ts";
import {
  buildWebfleetRequest,
  resolverCredencialesWebfleet,
  type WebfleetCreds,
} from "./tyrecontrol/webfleetCredenciales.ts";
import { agruparPorCuenta } from "./tyrecontrol/webfleetCuentas.ts";

type WfObject = Record<string, any>;
// La base es una DELEGACIÓN con geo-zona definida (base_lat/lng + radio).
// Las columnas se llamaban webfleet_* hasta que dejó de ser cosa solo de
// Webfleet: la misma geo-zona la lee ahora el barrido de telemática del Hub.
type Base = { id: string; empresa_id: string; nombre: string; base_lat: number | null; base_lng: number | null; base_radio_m: number | null; base_genera_avisos: boolean };
type EstadoPrevio = { estado: string; delegacion_id: string | null; entrada_base_at: string | null };

// ── Petición a Webfleet, con las credenciales de CADA cliente ────────────────
//
// Hasta aquí este servicio leía las variables globales de entorno y hacía UNA
// llamada para toda la instalación: una sola cuenta de Webfleet para todos los
// clientes. Con un cliente funcionaba; con dos, el segundo veía la flota del
// primero o no veía nada.
//
// Ahora las credenciales se resuelven por empresa con la misma función que ya
// usan el Hub y los endpoints —gestor de secretos → tabla → globales—, así que
// un cliente con su propio juego de credenciales consulta SU cuenta, y quien no
// tenga ninguno sigue cayendo a las de la casa exactamente como antes.
//
// Y se arregla de paso algo que no se veía: los `objectno` de Webfleet son
// únicos DENTRO de una cuenta, no entre cuentas. Con un único mapa global, dos
// clientes con el mismo número de objeto se leían la posición el uno al otro.
// Ahora cada empresa busca solo en los objetos de su cuenta.

async function fetchObjetos(creds: WebfleetCreds): Promise<WfObject[]> {
  const { url, headers } = buildWebfleetRequest("showObjectReportExtern", {}, creds);
  const r = await fetch(url, { headers });
  if (!r.ok) throw new Error(`Webfleet HTTP ${r.status}`);
  const data = await r.json();
  if (data?.errorCode) throw new Error(`Webfleet ${data.errorCode}: ${data.errorMsg}`);
  return Array.isArray(data) ? data : data?.data ?? [];
}

interface FlotaPorEmpresa {
  /** empresa → objetos de SU cuenta, por `objectno`. */
  porEmpresa: Map<string, Map<string, WfObject>>;
  /** Cuántas cuentas distintas se han consultado. */
  cuentas: number;
  /** Empresas que no se han podido consultar, y por qué. */
  fallos: Map<string, string>;
  /** Empresas sin credenciales por ninguna vía. */
  sinCredenciales: string[];
}

/**
 * Descarga la flota de cada empresa, una llamada por cuenta distinta.
 *
 * Una cuenta que falla no tumba a las demás: sus empresas se apartan con el
 * motivo y el resto del ciclo sigue. Es la misma regla que en el barrido de
 * presencia del Hub, y por el mismo motivo: si no se ha podido preguntar, lo
 * honesto es no tocar el último estado conocido de esa flota.
 */
async function flotaPorEmpresa(empresaIds: string[]): Promise<FlotaPorEmpresa> {
  const credsPorEmpresa = new Map<string, WebfleetCreds>();
  const sinCredenciales: string[] = [];

  for (const empresaId of empresaIds) {
    const { creds } = await resolverCredencialesWebfleet(empresaId);
    if (creds) credsPorEmpresa.set(empresaId, creds);
    else sinCredenciales.push(empresaId);
  }

  // Empresas agrupadas por la cuenta que les toca: una llamada por cuenta.
  const grupos = agruparPorCuenta(credsPorEmpresa);

  const porEmpresa = new Map<string, Map<string, WfObject>>();
  const fallos = new Map<string, string>();

  for (const g of grupos) {
    try {
      const objetos = await fetchObjetos(g.creds);
      const porObjectno = new Map<string, WfObject>();
      for (const o of objetos) porObjectno.set(String(o.objectno), o);
      for (const empresaId of g.empresas) porEmpresa.set(empresaId, porObjectno);
    } catch (e: any) {
      const motivo = e?.message || "Webfleet no contestó";
      for (const empresaId of g.empresas) fallos.set(empresaId, motivo);
    }
  }

  return { porEmpresa, cuentas: grupos.length, fallos, sinCredenciales };
}

// ── Geometría ────────────────────────────────────────────────────────────────
function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

function baseContiene(b: Base, lat: number, lng: number): boolean {
  if (b.base_lat == null || b.base_lng == null) return false;
  return haversineM(lat, lng, b.base_lat, b.base_lng) <= (b.base_radio_m ?? 300);
}

// Odómetro total en km: odometer_long en metros; odometer en hectómetros.
function odometroKm(o: WfObject): number | null {
  const long = Number(o?.odometer_long);
  if (Number.isFinite(long) && long > 0) return Math.round(long / 1000);
  const hm = Number(o?.odometer);
  if (Number.isFinite(hm) && hm > 0) return Math.round(hm / 10);
  return null;
}

// ── Un ciclo de sincronización ───────────────────────────────────────────────
export async function syncWebfleetOnce(): Promise<
  | {
      actualizados: number;
      /** Cuentas de Webfleet distintas consultadas en este ciclo. */
      cuentas?: number;
      /** Vehículos no tocados porque su cuenta falló o no tenía credenciales. */
      omitidos?: number;
    }
  | { error: string }
> {
  try {
    const [{ data: cfg }, { data: basesRaw }, { data: vehiculos }, { data: estadosRaw }, { data: opsRaw }] = await Promise.all([
      supabase.from("tc_webfleet_sync_config").select("*").eq("id", 1).maybeSingle(),
      // Bases = delegaciones con geo-zona definida.
      supabase.from("tc_delegaciones").select("id, empresa_id, nombre, base_lat, base_lng, base_radio_m, base_genera_avisos").not("base_lat", "is", null),
      supabase.from("tc_vehiculos").select("id, empresa_id, delegacion_id, matricula, km_actual, webfleet_vehicle_id").eq("activo", true),
      supabase.from("tc_vehiculo_webfleet_estado").select("vehiculo_id, estado, delegacion_id, entrada_base_at"),
      supabase.from("tc_operaciones_mantenimiento").select("id, nombre"),
    ]);

    const antiguedadMaxMs = (cfg?.antiguedad_max_pos_min ?? 30) * 60 * 1000;
    const alertasActivas = cfg?.alertas_activas ?? true;
    const bases = (basesRaw ?? []) as Base[];
    const basePorId = new Map<string, Base>(bases.map((b) => [b.id, b]));
    const previos = new Map<string, EstadoPrevio>();
    for (const e of estadosRaw ?? []) previos.set(e.vehiculo_id, e as EstadoPrevio);
    const opNombre = new Map<string, string>((opsRaw ?? []).map((o: any) => [o.id, o.nombre]));
    // Vehículos que acaban de entrar en su base (para decidir alertas después).
    const entradas: { vehiculo_id: string; empresa_id: string; delegacion_id: string; entrada: string | null; matricula: string; baseNom: string }[] = [];
    const kmUpdates: { id: string; km: number }[] = [];

    // Una llamada por CUENTA de Webfleet, no una por empresa ni una para todos.
    // Solo se pregunta por las empresas que tienen algún vehículo con equipo:
    // el resto no necesita credenciales para nada.
    const conEquipo = [
      ...new Set(
        (vehiculos ?? [])
          .filter((v: any) => String(v.webfleet_vehicle_id ?? "").trim())
          .map((v: any) => String(v.empresa_id)),
      ),
    ];
    const flota = await flotaPorEmpresa(conEquipo);

    // Sin una sola cuenta que conteste no hay nada que sincronizar, y decirlo
    // es mejor que escribir «sin conexión» en toda la flota.
    if (conEquipo.length > 0 && flota.porEmpresa.size === 0) {
      const motivo =
        flota.fallos.size > 0
          ? [...new Set(flota.fallos.values())].join("; ")
          : "Credenciales Webfleet no configuradas para ninguna empresa";
      return { error: motivo };
    }

    const ahora = Date.now();
    const filas: any[] = [];
    /** Vehículos no tocados porque su cuenta falló o no tiene credenciales. */
    let omitidos = 0;

    for (const v of vehiculos ?? []) {
      const base: any = { vehiculo_id: v.id, empresa_id: v.empresa_id, updated_at: new Date().toISOString() };
      const wfId = (v.webfleet_vehicle_id ?? "").trim();

      if (!wfId) {
        filas.push({ ...base, estado: "sin_dispositivo", delegacion_id: null, lat: null, lng: null, postext: null, velocidad_kmh: null, odometro_km: null, pos_time: null, entrada_base_at: null });
        continue;
      }

      // Los objetos de SU cuenta, no los de una flota común. Si su cuenta no se
      // ha podido consultar, este vehículo no se toca: lo último que se supo de
      // él sigue siendo más cierto que un «sin conexión» que en realidad
      // significa «no he podido preguntar».
      const porObjectno = flota.porEmpresa.get(String(v.empresa_id));
      if (!porObjectno) {
        omitidos += 1;
        continue;
      }

      const o = porObjectno.get(wfId);
      if (!o) {
        filas.push({ ...base, estado: "sin_conexion", delegacion_id: null, entrada_base_at: null });
        continue;
      }

      const lat = o.latitude_mdeg != null ? Number(o.latitude_mdeg) / 1e6 : (o.latitude != null ? Number(o.latitude) : null);
      const lng = o.longitude_mdeg != null ? Number(o.longitude_mdeg) / 1e6 : (o.longitude != null ? Number(o.longitude) : null);
      const posTime = o.pos_time ? new Date(o.pos_time) : null;
      const speed = Number(o.speed);
      const comun = {
        lat: Number.isFinite(lat as number) ? lat : null,
        lng: Number.isFinite(lng as number) ? lng : null,
        postext: o.postext ?? o.postext_short ?? null,
        velocidad_kmh: Number.isFinite(speed) ? speed : null,
        odometro_km: odometroKm(o),
        pos_time: posTime ? posTime.toISOString() : null,
      };

      // Sin posición utilizable → sin conexión.
      if (comun.lat == null || comun.lng == null) {
        filas.push({ ...base, ...comun, estado: "sin_conexion", delegacion_id: null, entrada_base_at: null });
        continue;
      }

      // Posición antigua: pasada la ventana ya no vale para "en ruta", pero si
      // la última conocida cae dentro de una base asumimos que sigue allí
      // (camión aparcado con el contacto quitado y el GPS dormido).
      const posAntigua = !posTime || ahora - posTime.getTime() > antiguedadMaxMs;

      // ¿En alguna base (delegación)? "en_base" = está en SU base asignada
      // (su delegación) o, si no tiene delegación, en una base de su empresa.
      const contenedoras = bases.filter((b) => baseContiene(b, comun.lat as number, comun.lng as number));
      const suBase = v.delegacion_id
        ? contenedoras.find((b) => b.id === v.delegacion_id)
        : contenedoras.find((b) => b.empresa_id === v.empresa_id);
      const baseDetectada = suBase ?? contenedoras[0] ?? null;

      // Posición antigua y fuera de toda base → sin conexión (como antes).
      if (posAntigua && !baseDetectada) {
        filas.push({ ...base, ...comun, estado: "sin_conexion", delegacion_id: null, entrada_base_at: null });
        continue;
      }

      let estado: string;
      let delegId: string | null = null;
      if (baseDetectada) {
        estado = suBase ? "en_base" : "otra_base";
        delegId = baseDetectada.id;
      } else {
        estado = "en_ruta";
      }

      // entrada_base_at: se conserva mientras siga en la MISMA base.
      let entrada: string | null = null;
      let esNuevaEntrada = false;
      if (delegId) {
        const prev = previos.get(v.id);
        const mismaEstancia = prev && prev.delegacion_id === delegId && (prev.estado === "en_base" || prev.estado === "otra_base");
        entrada = mismaEstancia ? prev!.entrada_base_at ?? comun.pos_time : comun.pos_time;
        // Con posición antigua no sabemos cuándo entró de verdad: no cuenta
        // como entrada nueva (evita alertas falsas cuando un GPS dormido
        // "reaparece" en base al desplegar este cambio o tras horas parado).
        esNuevaEntrada = !mismaEstancia && !posAntigua;
      }

      filas.push({ ...base, ...comun, estado, delegacion_id: delegId, entrada_base_at: entrada });

      // Km desde el odómetro Webfleet → se actualizará en el vehículo (planes por km).
      if (comun.odometro_km != null && comun.odometro_km !== Number(v.km_actual)) {
        kmUpdates.push({ id: v.id, km: comun.odometro_km });
      }
      // Entrada nueva en CUALQUIER base de su empresa (la asignada u otra) →
      // candidata a alerta: se puede revisar allí igualmente.
      if (esNuevaEntrada && (estado === "en_base" || estado === "otra_base") && delegId && alertasActivas && basePorId.get(delegId)?.base_genera_avisos) {
        entradas.push({ vehiculo_id: v.id, empresa_id: v.empresa_id, delegacion_id: delegId, entrada,
          matricula: v.matricula, baseNom: basePorId.get(delegId)?.nombre ?? "la base" });
      }
    }

    if (filas.length > 0) {
      const { error } = await supabase.from("tc_vehiculo_webfleet_estado").upsert(filas, { onConflict: "vehiculo_id" });
      if (error) return { error: error.message };
    }

    // Km desde Webfleet → tc_vehiculos (origen webfleet). Solo los que cambian.
    for (const u of kmUpdates) {
      await supabase.from("tc_vehiculos").update({ km_actual: u.km, origen_km: "webfleet" }).eq("id", u.id);
    }

    // Alertas: vehículo que acaba de entrar en su base con un plan atrasado/vence hoy.
    // Se calcula DESPUÉS de actualizar los km (para que los planes por km sean fieles).
    const alertas: any[] = [];
    if (entradas.length > 0) {
      const { data: planEst } = await supabase.rpc("tc_plan_estado");
      const pendPorVeh = new Map<string, { op: string; dias: number | null }[]>();
      for (const p of (planEst ?? []) as any[]) {
        if (p.estado === "atrasada" || p.estado === "vence_hoy") {
          const arr = pendPorVeh.get(p.vehiculo_id) ?? [];
          arr.push({ op: opNombre.get(p.operacion_id) ?? "Revisión", dias: p.dias_restantes });
          pendPorVeh.set(p.vehiculo_id, arr);
        }
      }
      for (const en of entradas) {
        const pend = pendPorVeh.get(en.vehiculo_id);
        if (!pend || pend.length === 0) continue;
        const peor = pend.slice().sort((a, b) => (a.dias ?? 0) - (b.dias ?? 0))[0];
        const detalle = peor.dias != null && peor.dias < 0 ? `${peor.op} (vencida hace ${Math.abs(peor.dias)} días)` : `${peor.op} (vence hoy)`;
        const extra = pend.length > 1 ? ` y ${pend.length - 1} más` : "";
        alertas.push({
          empresa_id: en.empresa_id, vehiculo_id: en.vehiculo_id, delegacion_id: en.delegacion_id, entrada_base_at: en.entrada,
          mensaje: `El vehículo ${en.matricula} acaba de entrar en la base de ${en.baseNom} con revisión pendiente: ${detalle}${extra}.`,
        });
      }
    }
    // No se repiten por estancia (índice único vehículo+base+entrada).
    if (alertas.length > 0) {
      await supabase.from("tc_webfleet_alertas").upsert(alertas, { onConflict: "vehiculo_id,delegacion_id,entrada_base_at", ignoreDuplicates: true });
    }
    return { actualizados: filas.length, cuentas: flota.cuentas, omitidos };
  } catch (e: any) {
    return { error: e?.message || "Error sync Webfleet" };
  }
}

// ── Avisos automáticos por tiempo (30/15/7 días y vencidas) ─────────────────
// Recorre los planes y crea avisos internos "próxima"/"vencida" sin depender
// de que el vehículo entre en base. No se repiten (índice único por plan+tipo+
// fecha de vencimiento). Reutiliza el centro de alertas (campana).
export async function checkMantenimientoAvisos(): Promise<{ creados: number } | { error: string }> {
  try {
    const { data: cfg } = await supabase.from("tc_webfleet_sync_config").select("alertas_activas").eq("id", 1).maybeSingle();
    if (cfg && cfg.alertas_activas === false) return { creados: 0 };

    const [{ data: planEst }, { data: ops }, { data: vehs }] = await Promise.all([
      supabase.rpc("tc_plan_estado"),
      supabase.from("tc_operaciones_mantenimiento").select("id, nombre"),
      supabase.from("tc_vehiculos").select("id, matricula"),
    ]);
    const opNombre = new Map<string, string>((ops ?? []).map((o: any) => [o.id, o.nombre]));
    const matricula = new Map<string, string>((vehs ?? []).map((v: any) => [v.id, v.matricula]));

    const avisos: any[] = [];
    for (const p of (planEst ?? []) as any[]) {
      const op = opNombre.get(p.operacion_id) ?? "Revisión";
      const mat = matricula.get(p.vehiculo_id) ?? "vehículo";
      const dr: number | null = p.dias_restantes;
      if (p.estado === "atrasada") {
        avisos.push({ empresa_id: p.empresa_id, vehiculo_id: p.vehiculo_id, plan_id: p.plan_id, tipo: "vencida",
          entrada_base_at: p.proxima_fecha_efec, delegacion_id: null,
          mensaje: `${mat}: ${op} VENCIDA${dr != null && dr < 0 ? ` hace ${Math.abs(dr)} días` : ""}.` });
      } else if (p.estado === "proxima" || p.estado === "vence_hoy") {
        avisos.push({ empresa_id: p.empresa_id, vehiculo_id: p.vehiculo_id, plan_id: p.plan_id, tipo: "proxima",
          entrada_base_at: p.proxima_fecha_efec, delegacion_id: null,
          mensaje: `${mat}: ${op} próxima${dr != null ? (dr === 0 ? " (vence hoy)" : ` (en ${dr} días)`) : ""}.` });
      }
    }
    if (avisos.length > 0) {
      await supabase.from("tc_webfleet_alertas").upsert(avisos, { onConflict: "vehiculo_id,plan_id,tipo,entrada_base_at", ignoreDuplicates: true });
    }
    return { creados: avisos.length };
  } catch (e: any) {
    return { error: e?.message || "Error avisos mantenimiento" };
  }
}

let avisosTimer: ReturnType<typeof setInterval> | null = null;
export function startMantenimientoAvisos(): void {
  if (avisosTimer) clearInterval(avisosTimer);
  // Primer chequeo a los 60s y luego cada 12h (idempotente por el índice único).
  setTimeout(() => { checkMantenimientoAvisos().then((r) => console.log("[mant-avisos]", "creados" in r ? `${r.creados} avisos` : r.error)); }, 60000);
  avisosTimer = setInterval(() => { checkMantenimientoAvisos(); }, 12 * 60 * 60 * 1000);
}

// ── Arranque del bucle periódico (intervalo configurable) ────────────────────
let timer: ReturnType<typeof setTimeout> | null = null;

/**
 * ¿Hay Webfleet configurado en esta instalación, por la vía que sea?
 *
 * Antes bastaba con mirar `WEBFLEET_ACCOUNT`, porque era la única forma de
 * tener credenciales. Ahora un cliente puede tener las suyas en el gestor de
 * secretos y no haber ninguna global: con la comprobación de antes, el
 * servicio no arrancaba y ese cliente se quedaba sin sincronizar sin que nada
 * lo dijera.
 *
 * No se resuelven credenciales aquí —eso es por empresa y hace falta la base—:
 * basta con saber si existe alguna variable de Webfleet. Si no hay ninguna, el
 * temporizador no se monta y no se consulta la base cada cinco minutos para
 * nada.
 */
function hayWebfleetConfigurado(): boolean {
  if (process.env.WEBFLEET_ACCOUNT) return true;
  return Object.keys(process.env).some((k) => /^IH_SECRET__.*__WEBFLEET__/.test(k));
}

export async function startWebfleetSync(): Promise<void> {
  if (!hayWebfleetConfigurado()) {
    console.log("[webfleet-sync] sin credenciales Webfleet: servicio no iniciado");
    return;
  }
  const tick = async () => {
    const { data: cfg } = await supabase.from("tc_webfleet_sync_config").select("intervalo_min").eq("id", 1).maybeSingle();
    const res = await syncWebfleetOnce();
    if ("error" in res) console.warn("[webfleet-sync]", res.error);
    else {
      const extra = res.omitidos ? `, ${res.omitidos} sin consultar` : "";
      console.log(
        `[webfleet-sync] ${res.actualizados} vehículos actualizados` +
          `${res.cuentas != null ? ` (${res.cuentas} cuenta(s))` : ""}${extra}`,
      );
    }
    const min = Math.max(1, cfg?.intervalo_min ?? 5);
    timer = setTimeout(tick, min * 60 * 1000);
  };
  // Primer ciclo a los 15s del arranque (deja que el server termine de subir).
  timer = setTimeout(tick, 15000);
}

export function stopWebfleetSync(): void {
  if (timer) clearTimeout(timer);
  timer = null;
}
