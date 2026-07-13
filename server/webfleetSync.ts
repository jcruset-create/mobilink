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

type WfObject = Record<string, any>;
// La base es una DELEGACIÓN con geo-zona definida (webfleet_lat/lng + radio).
type Base = { id: string; empresa_id: string; nombre: string; webfleet_lat: number | null; webfleet_lng: number | null; webfleet_radio_m: number | null; webfleet_genera_avisos: boolean };
type EstadoPrevio = { estado: string; delegacion_id: string | null; entrada_base_at: string | null };

// ── Petición a Webfleet (cuenta global por env; los vehículos viven ahí) ─────
function buildReq(action: string, extra: Record<string, string> = {}): { url: string; headers: Record<string, string> } {
  const account = process.env.WEBFLEET_ACCOUNT;
  const username = process.env.WEBFLEET_USERNAME;
  const password = process.env.WEBFLEET_PASSWORD;
  const apiKey = process.env.WEBFLEET_API_KEY;
  const baseUrl = process.env.WEBFLEET_BASE_URL || "https://csv.webfleet.com/extern";
  if (!account || !username || !password) throw new Error("Credenciales Webfleet no configuradas");
  const params = new URLSearchParams({ account, action, lang: "en", outputformat: "json", useISO8601: "true", ...extra });
  if (apiKey) params.set("apikey", apiKey);
  const credentials = Buffer.from(`${username}:${password}`).toString("base64");
  return { url: `${baseUrl}?${params.toString()}`, headers: { Authorization: `Basic ${credentials}` } };
}

async function fetchObjetos(): Promise<WfObject[]> {
  const { url, headers } = buildReq("showObjectReportExtern");
  const r = await fetch(url, { headers });
  if (!r.ok) throw new Error(`Webfleet HTTP ${r.status}`);
  const data = await r.json();
  if (data?.errorCode) throw new Error(`Webfleet ${data.errorCode}: ${data.errorMsg}`);
  return Array.isArray(data) ? data : data?.data ?? [];
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
  if (b.webfleet_lat == null || b.webfleet_lng == null) return false;
  return haversineM(lat, lng, b.webfleet_lat, b.webfleet_lng) <= (b.webfleet_radio_m ?? 300);
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
export async function syncWebfleetOnce(): Promise<{ actualizados: number } | { error: string }> {
  try {
    const [{ data: cfg }, { data: basesRaw }, { data: vehiculos }, { data: estadosRaw }, { data: revRaw }] = await Promise.all([
      supabase.from("tc_webfleet_sync_config").select("*").eq("id", 1).maybeSingle(),
      // Bases = delegaciones con geo-zona definida.
      supabase.from("tc_delegaciones").select("id, empresa_id, nombre, webfleet_lat, webfleet_lng, webfleet_radio_m, webfleet_genera_avisos").not("webfleet_lat", "is", null),
      supabase.from("tc_vehiculos").select("id, empresa_id, delegacion_id, matricula, webfleet_vehicle_id").eq("activo", true),
      supabase.from("tc_vehiculo_webfleet_estado").select("vehiculo_id, estado, delegacion_id, entrada_base_at"),
      supabase.rpc("tc_revision_estado"),
    ]);

    const antiguedadMaxMs = (cfg?.antiguedad_max_pos_min ?? 30) * 60 * 1000;
    const alertasActivas = cfg?.alertas_activas ?? true;
    const bases = (basesRaw ?? []) as Base[];
    const basePorId = new Map<string, Base>(bases.map((b) => [b.id, b]));
    const previos = new Map<string, EstadoPrevio>();
    for (const e of estadosRaw ?? []) previos.set(e.vehiculo_id, e as EstadoPrevio);
    // Estado de revisión por vehículo (para las alertas de "entra con revisión pendiente").
    const revPorVeh = new Map<string, { estado: string; dias_vencido: number | null }>();
    for (const r of (revRaw ?? []) as any[]) revPorVeh.set(r.vehiculo_id, { estado: r.estado, dias_vencido: r.dias_vencido });
    const alertas: any[] = [];

    const objetos = await fetchObjetos();
    const porObjectno = new Map<string, WfObject>();
    for (const o of objetos) porObjectno.set(String(o.objectno), o);

    const ahora = Date.now();
    const filas: any[] = [];

    for (const v of vehiculos ?? []) {
      const base: any = { vehiculo_id: v.id, empresa_id: v.empresa_id, updated_at: new Date().toISOString() };
      const wfId = (v.webfleet_vehicle_id ?? "").trim();

      if (!wfId) {
        filas.push({ ...base, estado: "sin_dispositivo", delegacion_id: null, lat: null, lng: null, postext: null, velocidad_kmh: null, odometro_km: null, pos_time: null, entrada_base_at: null });
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

      // Posición demasiado antigua → sin conexión.
      if (!posTime || ahora - posTime.getTime() > antiguedadMaxMs || comun.lat == null || comun.lng == null) {
        filas.push({ ...base, ...comun, estado: "sin_conexion", delegacion_id: null, entrada_base_at: null });
        continue;
      }

      // ¿En alguna base (delegación)? "en_base" = está en SU base asignada
      // (su delegación) o, si no tiene delegación, en una base de su empresa.
      const contenedoras = bases.filter((b) => baseContiene(b, comun.lat as number, comun.lng as number));
      const suBase = v.delegacion_id
        ? contenedoras.find((b) => b.id === v.delegacion_id)
        : contenedoras.find((b) => b.empresa_id === v.empresa_id);
      const baseDetectada = suBase ?? contenedoras[0] ?? null;

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
        esNuevaEntrada = !mismaEstancia; // acaba de entrar en esta base
      }

      filas.push({ ...base, ...comun, estado, delegacion_id: delegId, entrada_base_at: entrada });

      // Alerta: acaba de entrar en SU base y tiene revisión pendiente/vencida.
      if (esNuevaEntrada && estado === "en_base" && delegId && alertasActivas && basePorId.get(delegId)?.webfleet_genera_avisos) {
        const rev = revPorVeh.get(v.id);
        if (rev && (rev.estado === "vencida" || rev.estado === "sin_revision")) {
          const baseNom = basePorId.get(delegId)?.nombre ?? "la base";
          const detalle = rev.estado === "sin_revision"
            ? "y nunca se ha revisado"
            : `y tiene una revisión vencida desde hace ${rev.dias_vencido ?? 0} días`;
          alertas.push({
            empresa_id: v.empresa_id, vehiculo_id: v.id, delegacion_id: delegId, entrada_base_at: entrada,
            mensaje: `El vehículo ${v.matricula} acaba de entrar en la base de ${baseNom} ${detalle}.`,
          });
        }
      }
    }

    if (filas.length > 0) {
      const { error } = await supabase.from("tc_vehiculo_webfleet_estado").upsert(filas, { onConflict: "vehiculo_id" });
      if (error) return { error: error.message };
    }
    // Alertas nuevas: no se repiten por estancia (índice único vehículo+base+entrada).
    if (alertas.length > 0) {
      await supabase.from("tc_webfleet_alertas").upsert(alertas, { onConflict: "vehiculo_id,delegacion_id,entrada_base_at", ignoreDuplicates: true });
    }
    return { actualizados: filas.length };
  } catch (e: any) {
    return { error: e?.message || "Error sync Webfleet" };
  }
}

// ── Arranque del bucle periódico (intervalo configurable) ────────────────────
let timer: ReturnType<typeof setTimeout> | null = null;

export async function startWebfleetSync(): Promise<void> {
  if (!process.env.WEBFLEET_ACCOUNT) {
    console.log("[webfleet-sync] sin credenciales Webfleet: servicio no iniciado");
    return;
  }
  const tick = async () => {
    const { data: cfg } = await supabase.from("tc_webfleet_sync_config").select("intervalo_min").eq("id", 1).maybeSingle();
    const res = await syncWebfleetOnce();
    if ("error" in res) console.warn("[webfleet-sync]", res.error);
    else console.log(`[webfleet-sync] ${res.actualizados} vehículos actualizados`);
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
