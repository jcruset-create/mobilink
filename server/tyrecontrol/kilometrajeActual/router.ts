/**
 * El cuentakilómetros de un vehículo, ahora, para la APK del técnico.
 *
 * ── Por qué pasa por aquí y no lo pide Flutter ──────────────────────────────
 *
 * Porque la credencial de Movertis vive en el gestor de secretos del Hub y NO
 * puede salir de él. Una APK se descompila; una clave dentro de una APK es una
 * clave pública. La tablet pregunta «¿cuántos km lleva el 1234ABC?» y recibe un
 * número con su fecha: ni el token, ni la URL del proveedor, ni el
 * identificador de la cuenta viajan al móvil.
 *
 * ── Por qué es una consulta y no una sincronización ─────────────────────────
 *
 * El técnico abre el parte y necesita el dato AHORA, no el que dejó el barrido
 * nocturno. Pero tampoco puede costar una petición cada vez que alguien roza
 * la pantalla: el cupo del proveedor es limitado y lo comparte con el barrido
 * de presencia en bases. Por eso el cliente decide cuándo pedir —al abrir, al
 * pulsar Actualizar y antes de cerrar SI la lectura ya no vale— y esa decisión
 * la toma `tocaRefrescar`, que es código puro y con pruebas.
 *
 * ── Qué NO hace ─────────────────────────────────────────────────────────────
 *
 * No escribe nada. No toca los km del vehículo ni crea revisiones: eso lo hace
 * quien confirma el parte, con el dato ya en la mano y con el técnico delante.
 * Una consulta que escribiera dejaría el kilometraje del vehículo a merced de
 * quien abriera una pantalla y se arrepintiera.
 *
 * La excepción es `/ficha/:id` (la cabecera de la ficha del panel): guarda la
 * lectura de la telemática si es reciente, coherente y MAYOR que la que había.
 * Ahí no hay nadie tecleando ni nada de qué arrepentirse. Ver su comentario.
 * Y `/en-fecha/:id` responde los km de un día pasado, sin escribir nada.
 */

import { Router, json, type Request, type Response } from "express";

import { supabase } from "../../supabase.ts";
import { puedeVerEmpresa } from "../empresaAcceso.ts";
import { clasificarLectura, frescuraDeConfig, avisoDeSalto, type LecturaOdometro } from "./frescura.ts";
import {
  descartarIncoherentes, kmEnFecha, lecturasDeMeses, mesesDepurados, odometroNoFiable, odometrosDeMeses, reconstruir,
  ultimoConocido, ODOMETRO_IMPOSIBLE_KM, type KmEnFecha, type LecturaKm, type MesTelematica,
} from "./kmEnFecha.ts";

/*
 * El Hub se importa DENTRO de la función, igual que en `kilometrajeRevision.ts`:
 * arrastra `db.ts`, que LANZA al importarse si no hay `DATABASE_URL`, y
 * TyreControl habla por Supabase y no siempre la tiene.
 */
async function servicioDelHub() {
  return import("../../integration-hub/application/services/VehicleOdometerService.ts");
}

async function usuarioDe(req: Request): Promise<{ userId: string; esSuperadmin: boolean } | null> {
  const cabecera = String(req.headers.authorization ?? "");
  const token = cabecera.startsWith("Bearer ") ? cabecera.slice(7) : "";
  if (!token) return null;
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return null;
  const { data: perfil } = await supabase
    .from("tc_usuarios").select("es_superadmin, activo").eq("id", data.user.id).maybeSingle();
  if (!perfil || (perfil as any).activo === false) return null;
  return { userId: data.user.id, esSuperadmin: (perfil as any).es_superadmin === true };
}

/** La respuesta, en el vocabulario de la pantalla y sin nada del proveedor. */
function aRespuesta(l: LecturaOdometro, aviso: string | null) {
  return {
    estado: l.estado,
    km: l.km,
    capturadoAt: l.capturadoAt?.toISOString() ?? null,
    consultadoAt: l.consultadoAt.toISOString(),
    antiguedadMin: l.antiguedadMin,
    proveedor: l.proveedor,
    externo: l.externo,
    origenOdometro: l.origenOdometro ?? null,
    texto: l.texto,
    aviso,
  };
}

export function createKilometrajeActualRouter(): Router {
  const router = Router();
  router.use(json({ limit: "8kb" }));

  /**
   * El odómetro de un vehículo ahora mismo.
   *
   * Nunca lanza hacia el técnico por culpa del proveedor: si la telemática
   * falla, se contesta `error` con una frase en cristiano. Un parte que no se
   * pudiera abrir porque Movertis está caído sería un fallo peor que el que
   * evita — el kilometraje es un dato valioso, no un requisito para cambiar
   * una rueda.
   */
  router.get("/vehiculo/:id", async (req, res) => {
    const consultadoAt = new Date();
    try {
      const usuario = await usuarioDe(req);
      if (!usuario) return res.status(401).json({ error: "Sin sesión" });

      const vehiculoId = String(req.params.id ?? "").trim();
      const { data: v } = await supabase
        .from("tc_vehiculos").select("id, empresa_id, km_actual").eq("id", vehiculoId).maybeSingle();
      if (!v) return res.status(404).json({ error: "Vehículo no encontrado" });
      const empresaId = String((v as any).empresa_id ?? "");
      const puede = await puedeVerEmpresa(
        { userId: usuario.userId, esSuperadmin: usuario.esSuperadmin }, empresaId);
      // Mismo cuerpo que «no existe»: no se confirma que el vehículo esté ahí.
      if (!puede) return res.status(404).json({ error: "Vehículo no encontrado" });

      const { lectura, aviso, frescuraMin } = await leerAhora(vehiculoId, empresaId, Number((v as any).km_actual), consultadoAt);
      const kmAnterior = Number((v as any).km_actual);

      res.json({ vehiculoId, kmAnterior: Number.isFinite(kmAnterior) ? kmAnterior : null,
                 frescuraMin, ...aRespuesta(lectura, aviso) });
    } catch (e) {
      console.error("[km-actual] error:", (e as any)?.message ?? e);
      // Ni siquiera un fallo nuestro puede impedir abrir un parte: se contesta
      // el estado de error y el técnico teclea los km.
      res.json({ estado: "error", km: null, capturadoAt: null,
                 consultadoAt: consultadoAt.toISOString(), antiguedadMin: null,
                 proveedor: null, externo: null, origenOdometro: null, aviso: null,
                 texto: "No se ha podido consultar la telemática." });
    }
  });

  /**
   * Los km de la CABECERA de la ficha del vehículo.
   *
   * `vivo=0` contesta al momento con el último km conocido —el mayor entre
   * revisiones, montajes, telemática mensual y el del propio vehículo—, con su
   * fecha y de dónde sale. `vivo=1` además pregunta al proveedor el de ahora.
   *
   * Abrir una ficha no puede costar una petición cada vez (el cupo del
   * proveedor es limitado y lo comparte con el barrido de presencia): la
   * lectura de ahora se recuerda `CACHE_FICHA_MIN` minutos por vehículo.
   *
   * Y esta lectura SÍ se guarda en el vehículo, a diferencia del endpoint de
   * arriba: no la teclea nadie, la da la telemática, y solo se escribe si es
   * reciente, no salta de forma absurda y es MAYOR que la que había. Lo que se
   * evita arriba —que el km quede a merced de quien abre una pantalla y se
   * arrepiente— aquí no puede pasar.
   */
  router.get("/ficha/:id", async (req, res) => {
    try {
      const usuario = await usuarioDe(req);
      if (!usuario) return res.status(401).json({ error: "Sin sesión" });
      const vehiculoId = String(req.params.id ?? "").trim();
      const v = await vehiculoVisible(usuario, vehiculoId);
      if (!v) return res.status(404).json({ error: "Vehículo no encontrado" });

      const { lecturas, meses } = await lecturasDelVehiculo(v.id, v.empresa_id, v);
      const hoy = new Date().toISOString().slice(0, 10);
      // Los odómetros mensuales de Movertis que no cuadran (o son imposibles)
      // fuera: la distancia de viajes se queda, que es lo que vale.
      const depurados = mesesDepurados(meses, lecturas, hoy);
      const ultimo = ultimoConocido([...lecturas, ...lecturasDeMeses(depurados)]);
      // Hoy, desde la última lectura real + viajes: lo que se enseña cuando la
      // telemática no da un odómetro fiable.
      const reconstruido = reconstruir(hoy, lecturas, meses, hoy);
      const odometrosMes = odometrosDeMeses(meses, lecturas, hoy);
      const base = { ultimo, reconstruido, odometrosMes };
      if (String(req.query.vivo ?? "") !== "1") return res.json({ ...base, lectura: null, guardado: false });

      const enCache = CACHE_FICHA.get(v.id);
      // Una lectura buena se recuerda un rato; un fallo, poco: si no, «reintentar»
      // devolvería el mismo fallo durante un cuarto de hora.
      const vida = (enCache?.lectura.km != null ? CACHE_FICHA_MIN : 2) * 60_000;
      if (enCache && Date.now() - enCache.at < vida) {
        return res.json({ ...base, lectura: enCache.lectura, guardado: false, deCache: true });
      }

      const consultadoAt = new Date();
      const { lectura, aviso } = await leerAhora(v.id, v.empresa_id, Number(v.km_actual), consultadoAt);
      // Un odómetro parado (equipo clavado en un número viejo que sigue
      // contestando con fecha de hoy) no se enseña como «ahora» ni se guarda.
      const noFiable = lectura.km === null ? null
        : lectura.km >= ODOMETRO_IMPOSIBLE_KM
          ? `La telemática marca ${Math.round(lectura.km).toLocaleString("es-ES")} km, que no es posible: seguramente viene en otra unidad.`
          : odometroNoFiable(lectura.km, hoy, lecturas, depurados)
            ?? (reconstruido && Math.abs(lectura.km - reconstruido.km) > Math.max(2_000, 0.05 * reconstruido.km)
              ? `La telemática marca ${Math.round(lectura.km).toLocaleString("es-ES")} km y desde el ${reconstruido.ancla.detalle} ` +
                `(${Math.round(reconstruido.ancla.km).toLocaleString("es-ES")} km) los viajes llevan a unos ${Math.round(reconstruido.km).toLocaleString("es-ES")}: no cuadra.`
              : null);
      if (noFiable) console.warn(`[km-ficha] ${v.id}: ${noFiable}`);
      const respuesta: RespuestaFicha = noFiable
        ? { ...aRespuesta(lectura, aviso), estado: "no_fiable", kmTelematica: lectura.km, km: null, texto: noFiable }
        : aRespuesta(lectura, aviso);
      CACHE_FICHA.set(v.id, { at: Date.now(), lectura: respuesta });

      let guardado = false;
      const km = lectura.km;
      if (km !== null && !noFiable && lectura.estado === "actualizado" && !aviso && km > (Number(v.km_actual) || 0)) {
        // Solo sube: el `lt` hace que dos lecturas a la vez no se pisen al revés.
        const { error, count } = await supabase.from("tc_vehiculos")
          .update({ km_actual: Math.round(km), origen_km: "telematica", updated_at: new Date().toISOString() }, { count: "exact" })
          .eq("id", v.id).lt("km_actual", Math.round(km));
        guardado = !error && (count ?? 0) > 0;
        if (error) console.error("[km-ficha] no se ha podido guardar el km:", error.message);
      }
      res.json({ ...base, lectura: respuesta, guardado });
    } catch (e) {
      console.error("[km-ficha] error:", (e as any)?.message ?? e);
      res.status(500).json({ error: "No se han podido leer los kilómetros." });
    }
  });

  /**
   * Los km que tenía un vehículo en una fecha, diciendo de dónde salen.
   *
   * Por orden: una lectura real de ese día (revisión o montaje); el odómetro
   * de la telemática al final de ese día, pedido al proveedor y contrastado
   * con las lecturas vecinas; entre dos lecturas cercanas; o estimado con los
   * km del mes. Pregunta al proveedor solo al pulsar, no al abrir la ficha.
   */
  router.get("/en-fecha/:id", async (req, res) => {
    try {
      const usuario = await usuarioDe(req);
      if (!usuario) return res.status(401).json({ error: "Sin sesión" });
      const fecha = String(req.query.fecha ?? "");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || Number.isNaN(Date.parse(fecha))) {
        return res.status(400).json({ error: "Fecha no válida" });
      }
      if (fecha > new Date().toISOString().slice(0, 10)) {
        return res.status(400).json({ error: "Esa fecha todavía no ha llegado." });
      }
      const vehiculoId = String(req.params.id ?? "").trim();
      const v = await vehiculoVisible(usuario, vehiculoId);
      if (!v) return res.status(404).json({ error: "Vehículo no encontrado" });

      const { lecturas, meses } = await lecturasDelVehiculo(v.id, v.empresa_id, v);
      const { descartadas } = descartarIncoherentes(lecturas);
      const fmt = (n: number) => Math.round(n).toLocaleString("es-ES");
      // Las lecturas apartadas de ese día se dicen: si no, quien tecleó mal el
      // montaje no se entera de por qué la ficha no le hace caso.
      const avisos = descartadas.filter((l) => l.fecha === fecha)
        .map((l) => `${l.detalle.charAt(0).toUpperCase()}${l.detalle.slice(1)} dice ${fmt(l.km)} km: no cuadra con las demás lecturas y no se ha usado.`);

      // 1. La telemática primero: es el odómetro del autobús, no un número
      //    tecleado. Se contrasta solo con lo que también es de la telemática.
      const hoy = new Date().toISOString().slice(0, 10);
      const tele = await telematicaEnFecha(v.id, v.empresa_id, fecha, lecturas, mesesDepurados(meses, lecturas, hoy));
      if (tele.resultado) return res.json({ ...tele.resultado, avisos });

      // 2. Lo demás, con las lecturas que cuadran entre sí: entre dos lecturas,
      //    reconstruido desde la real más cercana con los viajes, o estimado.
      const r = kmEnFecha(fecha, lecturas, meses, hoy);
      res.json({ ...r, avisos, telematica: tele.motivo });
    } catch (e) {
      console.error("[km-en-fecha] error:", (e as any)?.message ?? e);
      res.status(500).json({ error: "No se han podido calcular los kilómetros de esa fecha." });
    }
  });

  /**
   * El km actual de cada vehículo de una empresa, con su procedencia, para
   * «Km de la flota». No pregunta al proveedor: sale de las lecturas reales
   * (revisiones y montajes) y de la distancia de viajes ya sincronizada.
   *
   *   movertis      — se reconstruye y el odómetro de Movertis cuadra con ello.
   *   reconstruido  — lectura real + viajes; Movertis no cuadra o no da.
   *   ultimo        — hay lectura real pero no viajes con que avanzarla.
   *   sin_ancla     — hay viajes pero ninguna lectura real: hace falta UNA
   *                   revisión o montaje con el km del salpicadero.
   */
  router.get("/flota", async (req, res) => {
    try {
      const usuario = await usuarioDe(req);
      if (!usuario) return res.status(401).json({ error: "Sin sesión" });
      const empresaId = String(req.query.empresa ?? "").trim();
      if (!/^[0-9a-f-]{36}$/i.test(empresaId)) return res.status(400).json({ error: "Empresa no válida" });
      if (!(await puedeVerEmpresa({ userId: usuario.userId, esSuperadmin: usuario.esSuperadmin }, empresaId))) {
        return res.status(404).json({ error: "Empresa no encontrada" });
      }
      res.json(await kmActualDeFlota(empresaId));
    } catch (e) {
      console.error("[km-flota-actual] error:", (e as any)?.message ?? e);
      res.status(500).json({ error: "No se han podido calcular los km de la flota." });
    }
  });

  return router;
}

/** Todas las filas de una consulta, de mil en mil (el tope de Supabase). */
async function todas<T>(consulta: (desde: number, hasta: number) => PromiseLike<{ data: T[] | null; error: any }>): Promise<T[]> {
  const out: T[] = [];
  for (let desde = 0; desde < 200_000; desde += 1000) {
    const { data, error } = await consulta(desde, desde + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if ((data ?? []).length < 1000) break;
  }
  return out;
}

export interface KmActualVehiculo {
  vehiculoId: string;
  matricula: string;
  km: number | null;
  procedencia: "movertis" | "reconstruido" | "ultimo" | "sin_ancla";
  detalle: string;
  /** El último odómetro que dio Movertis, para compararlo (tachado si no cuadra). */
  odometroMovertis: number | null;
  movertisCuadra: boolean | null;
  /** Km de viajes sin ninguna lectura real (solo `sin_ancla`). */
  kmViajes: number | null;
}

async function kmActualDeFlota(empresaId: string): Promise<{ vehiculos: KmActualVehiculo[] }> {
  const fmt = (n: number) => Math.round(n).toLocaleString("es-ES");
  const fmtF = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(0, 4)}`;
  const hoy = new Date().toISOString().slice(0, 10);

  let filasMes: any[] = [];
  let mesCerrado: any = null, zona = "Europe/Madrid";
  try {
    const repo = await import("../../integration-hub/infrastructure/repositories.ts");
    const meses = await import("../../integration-hub/domain/meses.ts");
    filasMes = await repo.listMonthlyMileageByTenant({ tenantId: empresaId });
    mesCerrado = meses.mesCerrado; zona = meses.ZONA_HORARIA_POR_DEFECTO;
  } catch { /* sin base del Hub: sin viajes */ }
  const porVehiculoMes = new Map<string, any[]>();
  for (const f of filasMes) {
    const l = porVehiculoMes.get(f.mobilink_id) ?? [];
    l.push(f); porVehiculoMes.set(f.mobilink_id, l);
  }
  if (porVehiculoMes.size === 0) return { vehiculos: [] };

  const [vehiculos, revs, ops] = await Promise.all([
    todas<any>((a, b) => supabase.from("tc_vehiculos").select("id, matricula, activo")
      .eq("empresa_id", empresaId).eq("activo", true).order("matricula").range(a, b)),
    todas<any>((a, b) => supabase.from("revisiones_vehiculo").select("vehiculo_id, km_vehiculo, fecha_revision")
      .eq("empresa_id", empresaId).not("km_vehiculo", "is", null).neq("estado_revision", "anulada").order("id").range(a, b)),
    todas<any>((a, b) => supabase.from("operaciones_neumaticos").select("vehiculo_id, km_vehiculo, fecha_operacion, tipo_operacion, is_anulada")
      .eq("empresa_id", empresaId).not("km_vehiculo", "is", null).order("id").range(a, b)),
  ]);
  const lecturasDe = new Map<string, LecturaKm[]>();
  const meter = (id: string, l: LecturaKm) => { const x = lecturasDe.get(id) ?? []; x.push(l); lecturasDe.set(id, x); };
  for (const r of revs) {
    const f = String(r.fecha_revision).slice(0, 10);
    meter(r.vehiculo_id, { km: Number(r.km_vehiculo), fecha: f, fuente: "revision", detalle: `revisión del ${fmtF(f)}` });
  }
  for (const o of ops) {
    if (o.is_anulada === true) continue;
    const f = String(o.fecha_operacion).slice(0, 10);
    meter(o.vehiculo_id, { km: Number(o.km_vehiculo), fecha: f, fuente: "operacion", detalle: `${TIPO_OPERACION[String(o.tipo_operacion)] ?? "operación"} del ${fmtF(f)}` });
  }

  const out: KmActualVehiculo[] = [];
  for (const v of vehiculos) {
    const filas = porVehiculoMes.get(v.id);
    if (!filas) continue;   // sin telemática: no es de este cuadro
    const meses = mesCerrado ? aMeses(filas, new Date(), mesCerrado, zona) : [];
    const lecturas = lecturasDe.get(v.id) ?? [];
    const conOdo = meses.filter((m) => (m.final ?? m.inicial) != null)
      .sort((a, b) => (b.year - a.year) || (b.month - a.month))[0];
    const odometroMovertis = conOdo ? Number(conOdo.final ?? conOdo.inicial) : null;
    const rec = reconstruir(hoy, lecturas, meses, hoy);
    const ult = ultimoConocido(lecturas);
    let fila: KmActualVehiculo;
    if (rec) {
      const odos = odometrosDeMeses(meses, lecturas, hoy);
      const delMes = conOdo ? odos.find((o) => o.year === conOdo.year && o.month === conOdo.month) : null;
      const cuadra = delMes ? (delMes.fuenteCierre ?? delMes.fuenteInicio) === "movertis" : null;
      fila = {
        vehiculoId: v.id, matricula: v.matricula, km: rec.km,
        procedencia: cuadra ? "movertis" : "reconstruido",
        detalle: `${rec.ancla.detalle} ${rec.rodados >= 0 ? "+" : "−"} ${fmt(Math.abs(rec.rodados))} km de viajes`,
        odometroMovertis, movertisCuadra: cuadra, kmViajes: null,
      };
    } else if (ult) {
      fila = {
        vehiculoId: v.id, matricula: v.matricula, km: Math.round(ult.km), procedencia: "ultimo",
        detalle: `${ult.detalle}; sin viajes completos desde entonces para avanzarlo`,
        odometroMovertis, movertisCuadra: null, kmViajes: null,
      };
    } else {
      const kmViajes = meses.reduce((t, m) => t + (m.distancia ?? 0), 0);
      fila = {
        vehiculoId: v.id, matricula: v.matricula, km: null, procedencia: "sin_ancla",
        detalle: `${fmt(kmViajes)} km de viajes, sin ninguna revisión ni montaje con km`,
        odometroMovertis, movertisCuadra: null, kmViajes: Math.round(kmViajes),
      };
    }
    out.push(fila);
  }
  const orden = { sin_ancla: 0, ultimo: 1, reconstruido: 2, movertis: 3 };
  out.sort((a, b) => orden[a.procedencia] - orden[b.procedencia] || (b.kmViajes ?? 0) - (a.kmViajes ?? 0) || a.matricula.localeCompare(b.matricula));
  return { vehiculos: out };
}

/** Cuánto se recuerda la lectura de ahora de la ficha, por vehículo. */
export const CACHE_FICHA_MIN = 15;
type RespuestaFicha = Omit<ReturnType<typeof aRespuesta>, "estado"> & { estado: string; kmTelematica?: number | null };
const CACHE_FICHA = new Map<string, { at: number; lectura: RespuestaFicha }>();

interface VehiculoFicha { id: string; empresa_id: string; km_actual: number | null; origen_km: string | null; updated_at: string | null }

async function vehiculoVisible(usuario: { userId: string; esSuperadmin: boolean }, vehiculoId: string): Promise<VehiculoFicha | null> {
  if (!/^[0-9a-f-]{36}$/i.test(vehiculoId)) return null;
  const { data: v } = await supabase.from("tc_vehiculos")
    .select("id, empresa_id, km_actual, origen_km, updated_at").eq("id", vehiculoId).maybeSingle();
  if (!v) return null;
  const puede = await puedeVerEmpresa({ userId: usuario.userId, esSuperadmin: usuario.esSuperadmin }, String((v as any).empresa_id));
  return puede ? (v as VehiculoFicha) : null;
}

const TIPO_OPERACION: Record<string, string> = {
  montaje: "montaje", desmontaje: "desmontaje", sustitucion: "sustitución", rotacion: "rotación",
  reparacion: "reparación", revision_vehiculo: "revisión",
};

/** Todas las lecturas de km con fecha: revisiones, operaciones, el vehículo y la telemática mensual. */
async function lecturasDelVehiculo(vehiculoId: string, empresaId: string, v: VehiculoFicha | null): Promise<{ lecturas: LecturaKm[]; meses: MesTelematica[] }> {
  const fmt = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(0, 4)}`;
  const [{ data: revs }, { data: ops }] = await Promise.all([
    supabase.from("revisiones_vehiculo").select("km_vehiculo, fecha_revision")
      .eq("vehiculo_id", vehiculoId).not("km_vehiculo", "is", null).neq("estado_revision", "anulada")
      .order("fecha_revision", { ascending: false }).limit(500),
    supabase.from("operaciones_neumaticos").select("km_vehiculo, fecha_operacion, tipo_operacion, is_anulada")
      .eq("vehiculo_id", vehiculoId).not("km_vehiculo", "is", null)
      .order("fecha_operacion", { ascending: false }).limit(500),
  ]);
  const lecturas: LecturaKm[] = [];
  for (const r of (revs ?? []) as any[]) {
    const f = String(r.fecha_revision).slice(0, 10);
    lecturas.push({ km: Number(r.km_vehiculo), fecha: f, fuente: "revision", detalle: `revisión del ${fmt(f)}` });
  }
  for (const o of (ops ?? []) as any[]) {
    if (o.is_anulada === true) continue;
    const f = String(o.fecha_operacion).slice(0, 10);
    const t = TIPO_OPERACION[String(o.tipo_operacion)] ?? "operación";
    lecturas.push({ km: Number(o.km_vehiculo), fecha: f, fuente: "operacion", detalle: `${t} del ${fmt(f)}` });
  }
  // El km del propio vehículo solo cuenta si vino de la telemática: el de la
  // importación del Excel o uno tecleado sin fecha no es una lectura fechada.
  if (v && ["telematica", "webfleet"].includes(String(v.origen_km)) && v.updated_at) {
    const f = String(v.updated_at).slice(0, 10);
    lecturas.push({ km: Number(v.km_actual), fecha: f, fuente: "vehiculo", detalle: `telemática del ${fmt(f)}` });
  }

  let meses: MesTelematica[] = [];
  try {
    const { listMonthlyMileage } = await import("../../integration-hub/infrastructure/repositories.ts");
    const { mesCerrado, ZONA_HORARIA_POR_DEFECTO } = await import("../../integration-hub/domain/meses.ts");
    const filas = await listMonthlyMileage({ tenantId: empresaId, mobilinkId: vehiculoId });
    const ahora = new Date();
    meses = aMeses(filas, ahora, mesCerrado, ZONA_HORARIA_POR_DEFECTO);
  } catch { /* sin la base del Hub: sin telemática mensual, no un fallo */ }
  return { lecturas, meses };
}

/**
 * Las filas mensuales del Hub → meses de la telemática, una por mes: si el
 * vehículo está en dos cuentas, la que trajo km.
 *
 * Un mes sin viajes («empty») NO se da por «rodó 0 km». El 8378NBC lo enseñó:
 * junio-agosto sin viajes en Movertis, pero entre la revisión de mayo (66.463)
 * y el montaje del 24/09 (92.748) rodó unos 20.000 km. Movertis no distingue
 * un autobús parado de un equipo que no registró, así que esos meses quedan
 * como desconocidos, igual que uno con error: la reconstrucción no los
 * atraviesa y se ancla a la lectura real del otro lado.
 */
function aMeses(filas: any[], ahora: Date, mesCerrado: any, zona: string): MesTelematica[] {
  const porMes = new Map<string, MesTelematica>();
  for (const f of filas) {
    if (f.sync_status !== "ok") continue;
    const m: MesTelematica = {
      year: f.year, month: f.month,
      inicial: f.initial_odometer_km,
      final: f.final_odometer_km,
      distancia: f.distance_km,
      cerrado: mesCerrado({ year: f.year, month: f.month }, zona, ahora),
    };
    const k = `${f.year}-${f.month}`;
    const ya = porMes.get(k);
    if (!ya || (m.distancia ?? 0) > (ya.distancia ?? 0)) porMes.set(k, m);
  }
  return [...porMes.values()];
}

/**
 * El odómetro al final de ese día según la telemática, si el proveedor lo da
 * y cuadra con las lecturas de antes y de después (un número que se sale de
 * ellas es una de las respuestas malas que documenta HistoricOdometerService).
 */
async function telematicaEnFecha(
  vehiculoId: string, empresaId: string, fecha: string, lecturas: LecturaKm[], meses: MesTelematica[],
): Promise<{ resultado: KmEnFecha | null; motivo: string }> {
  const deTelematica = [...lecturas, ...lecturasDeMeses(meses)].filter((l) => l.fuente === "telematica_mes" || l.fuente === "vehiculo");
  try {
    const { odometroEnInstante } = await import("../../integration-hub/application/services/HistoricOdometerService.ts");
    const { ZONA_HORARIA_POR_DEFECTO } = await import("../../integration-hub/domain/meses.ts");
    // 22:00 UTC: medianoche en verano y las 23:00 en invierno en Madrid. Es el
    // «al acabar el día» que se pide, sin meterse en el día siguiente.
    const instante = new Date(`${fecha}T22:00:00Z`);
    const r: any = await odometroEnInstante(
      { tenantId: empresaId, correlationId: `km-en-fecha:${vehiculoId}:${fecha}` },
      vehiculoId, instante, { zonaHoraria: ZONA_HORARIA_POR_DEFECTO },
    );
    if (r?.estado !== "encontrado") {
      const motivo: Record<string, string> = {
        sin_telematica: "El vehículo no está enlazado con ninguna cuenta de telemática.",
        sin_lectura: "La telemática no tiene odómetro de ese día.",
        dia_abierto: "Ese día todavía no ha cerrado: la telemática no da aún un odómetro estable.",
        discrepancia: "La telemática ha dado dos odómetros distintos para ese día y no se ha usado ninguno.",
        no_disponible: "No se ha podido consultar la telemática.",
      };
      console.warn(`[km-en-fecha] ${vehiculoId} ${fecha}: ${r?.estado} ${r?.motivo ?? ""}`);
      return { resultado: null, motivo: motivo[String(r?.estado)] ?? "La telemática no ha dado odómetro de ese día." };
    }
    const km = Number(r.odometro.odometerKm);
    if (km >= ODOMETRO_IMPOSIBLE_KM) {
      return { resultado: null, motivo: `La telemática ha dado ${Math.round(km).toLocaleString("es-ES")} km, que no es posible: seguramente viene en otra unidad.` };
    }
    // Contraste solo con lo que también es de la telemática: un km tecleado mal
    // en un montaje no puede tumbar el odómetro del autobús (pasó: 92.748
    // tecleados frente a 150.000 reales).
    const antes = deTelematica.filter((l) => l.fecha < fecha).reduce((m, l) => Math.max(m, l.km), 0);
    const despues = deTelematica.filter((l) => l.fecha > fecha).reduce((m, l) => Math.min(m, l.km), Infinity);
    if (!(km > 0) || km + 5 < antes || km - 5 > despues) {
      return { resultado: null, motivo: `La telemática ha dado ${Math.round(km)} km, que no cuadra con sus propios odómetros mensuales; no se ha usado.` };
    }
    // Y que no sea un odómetro parado: comparado con todas las lecturas buenas
    // y con los km de los viajes, que el proveedor sigue dando aunque el
    // contador del equipo se quede clavado.
    const parado = odometroNoFiable(km, fecha, lecturas, meses);
    if (parado) return { resultado: null, motivo: parado };
    const proveedor = String(r.odometro.provider ?? "");
    const nombre = proveedor ? proveedor.charAt(0).toUpperCase() + proveedor.slice(1) : "la telemática";
    return {
      resultado: {
        tipo: "telematica", km: Math.round(km), fecha,
        detalle: `odómetro de ${nombre} al final del día` +
          (r.odometro.corroboracion === "dos_ventanas" ? "" : " (una sola consulta, sin contrastar)"),
      },
      motivo: "",
    };
  } catch (e) {
    console.error("[km-en-fecha] telemática no disponible:", (e as any)?.message ?? e);
    return { resultado: null, motivo: "No se ha podido consultar la telemática." };
  }
}

/**
 * Pregunta el odómetro de ahora al Hub y lo clasifica. Nunca lanza por culpa
 * del proveedor: devuelve el estado (`error`, `no_disponible`…) y su texto.
 */
async function leerAhora(vehiculoId: string, empresaId: string, kmActual: number, consultadoAt: Date) {
  let resultado: any;
  try {
    // `kilometrajeAhora` y no `kilometrajeEnOperacion`: esto es «¿cuántos
    // km lleva AHORA?», y para eso se pregunta el estado actual del
    // vehículo. El histórico de Movertis no trae odómetro, así que por el
    // otro camino esta pantalla salía siempre sin kilómetros en su flota.
    const { kilometrajeAhora } = await servicioDelHub();
    resultado = await kilometrajeAhora(
      { tenantId: empresaId, correlationId: `km-actual:${vehiculoId}:${consultadoAt.getTime()}` },
      vehiculoId,
      consultadoAt,
    );
  } catch (e) {
    // El motivo va al registro, no a la tablet, y sin token ni matrícula.
    console.error("[km-actual] telemática no disponible:", (e as any)?.message ?? e);
    resultado = { estado: "no_disponible" };
  }

  const frescuraMin = await frescuraDeEmpresa(empresaId);
  const lectura = clasificarLectura({
    ahora: consultadoAt,
    frescuraMin,
    resultado: resultado.estado === "encontrado"
      ? {
          estado: "encontrado",
          km: resultado.kilometraje.odometerKm,
          capturadoAt: resultado.kilometraje.capturedAt,
          proveedor: resultado.kilometraje.provider,
          externo: resultado.kilometraje.providerVehicleId,
          origenOdometro: resultado.kilometraje.odometerSource,
        }
      : { estado: resultado.estado },
  });

  const kmAnterior = kmActual;
  const aviso = lectura.km === null
    ? null
    : avisoDeSalto({ km: lectura.km, kmAnterior: Number.isFinite(kmAnterior) ? kmAnterior : null });
  return { lectura, aviso, frescuraMin };
}

/** El umbral de frescura de la empresa, de su cuenta de telemática. */
async function frescuraDeEmpresa(empresaId: string): Promise<number> {
  try {
    const { listConnectorConfigs } = await import("../../integration-hub/infrastructure/repositories.ts");
    const configs = await listConnectorConfigs(empresaId);
    const activa = configs.find((c: any) => c.enabled);
    return frescuraDeConfig(activa?.config);
  } catch {
    return frescuraDeConfig(undefined);
  }
}
