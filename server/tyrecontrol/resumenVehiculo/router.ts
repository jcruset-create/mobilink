/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Mobilink TyreControl — Resumen IA de la ficha de vehículo.
 *
 * Un endpoint, bajo demanda: nadie genera nada hasta que alguien pulsa el
 * botón. Lo que hace, en orden:
 *
 *   1. Comprueba la sesión y de qué empresa es el vehículo. El alcance lo
 *      calcula `resolverAlcance` del asistente — la MISMA función, no una
 *      copia: es la barrera de aislamiento entre clientes.
 *   2. Comprueba que la empresa tiene el resumen activado. Es opt-in: nadie
 *      se encuentra la funcionalidad encendida sin haberla pedido.
 *   3. Reúne la ficha y hace las cuentas en el servidor (`datos.ts`).
 *   4. Si no hay nada que resumir, NO llama al proveedor. Devuelve lo que
 *      consta y lo que falta.
 *   5. Mira la caché. Si hay entrada válida, vuelve a comprobar permisos
 *      (una caché no es un permiso) y la sirve.
 *   6. Si no, llama a la capa de IA, que es la que aplica el tope de consumo.
 *   7. Valida la salida contra las evidencias y guarda.
 *
 * ── Lo que NO hace ──────────────────────────────────────────────────────────
 *
 * No escribe en historial, montajes, stock ni intervenciones. Solo lee, y lo
 * único que guarda es su propia caché y su propia métrica de consumo.
 *
 * ⚠️ `supabase` es SERVICE ROLE: no aplica RLS. Cada consulta filtra
 * `empresa_id` explícitamente.
 */
import type { Express, RequestHandler } from "express";
import { createHash } from "node:crypto";
import { supabase } from "../../supabase.ts";
import { hayIA, pedirIA } from "../../core/openaiService.ts";
import { registrarCache, resumenVehiculoActivo } from "../../core/iaConsumo.ts";
import { resolverAlcance, type Alcance } from "../alcance.ts";
import { esperarResultado, soltar, tomar } from "./coordinacion.ts";
import { reunir, type Reunido } from "./datos.ts";
import { listaDeRefs } from "./evidencias.ts";
import { construirPrompt, ESQUEMA, VERSION, type SalidaModelo } from "./prompt.ts";
import { validar, type ResumenValidado } from "./validar.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const OPERACION = "resumen.vehiculo";

/** Plazo del intento individual al proveedor. */
const TIMEOUT_INTENTO_MS = Number(process.env.IA_RESUMEN_TIMEOUT_MS || 25_000);
/**
 * Plazo TOTAL, reintentos y respaldo incluidos. Si se agota, la persona recibe
 * un mensaje y la ficha sigue funcionando; la llamada que quedó en vuelo cierra
 * su propia métrica por su cuenta (ver openaiService).
 *
 * Se lee del entorno en cada petición para poder bajarlo sin desplegar (y para
 * que las pruebas no tengan que esperar cincuenta segundos).
 */
const plazoTotalMs = () => Number(process.env.IA_RESUMEN_PLAZO_MS || 50_000);

/** Vida máxima de una entrada de caché. */
const VIDA_CACHE_MS = 24 * 3_600_000;

// ── Deduplicación de peticiones simultáneas ─────────────────────────────────
// Dos personas pulsando el botón a la vez sobre la misma ficha comparten una
// sola llamada al proveedor. Es por proceso: con varias instancias puede
// haber una llamada por instancia, no una por pulsación.
const enVuelo = new Map<string, Promise<Generado>>();

interface Generado {
  resumen: ResumenValidado;
  generado_at: string;
  caduca_at: string;
  /** True si lo generó OTRA instancia y aquí solo se ha leído de la caché. */
  deCache?: boolean;
}

/** Cuánto se espera a que otra instancia termine antes de dar la cara. */
const ESPERA_AJENA_MS = 20_000;

/** Clave de caché: empresa, vehículo, alcance, datos de entrada y versión. */
function claveCache(r: Reunido, a: Alcance): string {
  return createHash("sha256")
    .update(r.huella).update("|")
    .update(VERSION).update("|")
    .update(a.esCliente ? "cliente" : "operador")
    .digest("hex");
}

async function leerCache(vehiculoId: string, clave: string, empresaId: string): Promise<Generado | null> {
  const { data } = await supabase
    .from("ia_resumen_vehiculo")
    .select("payload, generado_at, caduca_at")
    .eq("vehiculo_id", vehiculoId)
    .eq("empresa_id", empresaId)       // la caché tampoco cruza empresas
    .eq("huella", clave)
    .maybeSingle();
  const fila = (data ?? null) as Record<string, any> | null;
  if (!fila?.payload) return null;
  if (fila.caduca_at && new Date(fila.caduca_at).getTime() < Date.now()) return null;
  return {
    resumen: fila.payload as ResumenValidado,
    generado_at: String(fila.generado_at),
    caduca_at: String(fila.caduca_at ?? ""),
  };
}

async function guardarCache(
  vehiculoId: string, empresaId: string, clave: string, g: Generado, modelo: string,
): Promise<void> {
  try {
    await supabase.from("ia_resumen_vehiculo").upsert({
      empresa_id: empresaId,
      vehiculo_id: vehiculoId,
      huella: clave,
      version: VERSION,
      modelo,
      payload: g.resumen as unknown as Record<string, unknown>,
      generado_at: g.generado_at,
      caduca_at: g.caduca_at,
    }, { onConflict: "vehiculo_id,huella" });

    // Barrido de lo caducado de ESTE vehículo. La huella cambia cada pocas
    // horas por su cuenta (lleva días abiertos y antigüedades dentro), así
    // que sin esto la tabla crecería sin parar con resúmenes que ya no sirve
    // nadie. Va aquí, en la escritura, para no necesitar un proceso aparte.
    await supabase.from("ia_resumen_vehiculo")
      .delete()
      .eq("vehiculo_id", vehiculoId)
      .lt("caduca_at", new Date().toISOString());
  } catch (e: any) {
    // No poder guardar la caché no invalida el resumen ya generado.
    console.log(JSON.stringify({
      service: "mobilink-ai", operation: "resumen.cache", status: "degradado",
      error: String(e?.message ?? e).slice(0, 200),
    }));
  }
}

/** Mapa operación → intervención, para que las evidencias enlacen a su contexto. */
function intervencionDeOperacion(r: Reunido): Map<string, string | null> {
  const m = new Map<string, string | null>();
  for (const o of r.datos.operaciones as any[]) {
    const ref = r.refs.get(String(o.ref));
    if (ref) m.set(ref.id, o.intervencion_id ?? null);
  }
  return m;
}

/** La respuesta que ve el panel. Nunca lleva detalles del proveedor. */
function respuesta(g: Generado, r: Reunido, origen: "ia" | "cache"): Record<string, unknown> {
  return {
    ok: true,
    origen,
    generado_at: g.generado_at,
    caduca_at: g.caduca_at,
    ventana: r.datos.ventana,
    ...g.resumen,
  };
}

async function generar(r: Reunido, alcance: Alcance, vehiculoId: string, clave: string): Promise<Generado> {
  const ctxEvidencias = { vehiculoId, intervencionDeOperacion: intervencionDeOperacion(r) };

  /*
   * El plazo total CANCELA. Antes se corría una carrera contra un temporizador
   * y la llamada seguía viva por detrás: la persona recibía el aviso y el
   * servidor seguía reintentando y cayendo al respaldo, pagando por una
   * respuesta que ya no iba a ver nadie. Con el AbortSignal, al vencer el
   * plazo se corta el intento en vuelo y no se empieza ninguno más.
   */
  const corte = new AbortController();
  let vencido: NodeJS.Timeout | undefined;
  const plazo = new Promise<null>((resolve) => {
    vencido = setTimeout(() => { corte.abort(); resolve(null); }, plazoTotalMs());
  });

  const peticion = pedirIA<SalidaModelo>({
    prompt: construirPrompt(r.datos, listaDeRefs(r.refs)),
    proposito: "informe",
    esquema: ESQUEMA,
    operacion: OPERACION,
    empresaId: alcance.empresaId,
    maxTokens: 1600,
    timeoutMs: TIMEOUT_INTENTO_MS,
    // Funcionalidad nueva: si no se puede comprobar la cuota, no se llama.
    exigirContador: true,
    signal: corte.signal,
  });

  const res = await Promise.race([peticion, plazo]).finally(() => clearTimeout(vencido));

  if (!res) throw new ErrorAmable(504, "El resumen ha tardado demasiado. Vuelve a intentarlo en un momento.");
  if (!res.ok || !res.datos) {
    // El motivo real queda en la métrica de consumo y en el log del servicio;
    // a la persona no se le enseña el error del proveedor.
    if (res.error?.includes("límite diario")) {
      throw new ErrorAmable(429, "Se ha alcanzado el límite diario de uso de IA de esta empresa.");
    }
    if (res.error?.includes("desactivada")) {
      throw new ErrorAmable(403, "La IA está desactivada para esta empresa.");
    }
    if (res.error?.includes("comprobar el consumo")) {
      // Falla CERRADO a propósito, al contrario que los lectores: ver
      // iaConsumo.ts y el campo `exigirContador` de openaiService.
      throw new ErrorAmable(503,
        "No se puede generar el resumen ahora mismo porque no se puede comprobar el consumo de IA.");
    }
    throw new ErrorAmable(503,
      "No se ha podido generar el resumen ahora mismo. La ficha sigue disponible.");
  }

  const resumen = validar(res.datos, r.datos, r.refs, ctxEvidencias);
  const ahora = new Date();
  const g: Generado = {
    resumen,
    generado_at: ahora.toISOString(),
    caduca_at: new Date(ahora.getTime() + VIDA_CACHE_MS).toISOString(),
  };
  await guardarCache(vehiculoId, alcance.empresaId, clave, g, res.modelo);
  return g;
}

/**
 * Genera, coordinándose con las demás instancias.
 *
 * Si otra lo está generando, aquí NO se llama al proveedor: se espera a que
 * aparezca en la caché. Si no aparece a tiempo se devuelve un mensaje
 * entendible en vez de pagar una segunda llamada por lo mismo.
 */
async function generarCoordinado(
  r: Reunido, alcance: Alcance, vehiculoId: string, clave: string,
): Promise<Generado> {
  // El arrendamiento dura algo más que el plazo total: si la instancia muere,
  // caduca y otra puede tomarlo, pero mientras viva nadie le pisa la llamada.
  const arrendamiento = await tomar(clave, alcance.empresaId, vehiculoId, plazoTotalMs() + 10_000);

  if (arrendamiento === "ajeno") {
    const guardado = await esperarResultado(
      () => leerCache(vehiculoId, clave, alcance.empresaId), ESPERA_AJENA_MS);
    if (guardado) return { ...guardado, deCache: true };
    throw new ErrorAmable(503,
      "Se está generando el resumen de este vehículo. Inténtalo de nuevo en unos segundos.");
  }

  // "sin_coordinacion" (la base no contestó) sigue adelante: el que de verdad
  // para la llamada en ese caso es el contador, que falla cerrado para esta
  // funcionalidad. Duplicar aquí la negativa solo escondería el motivo real.
  try {
    return await generar(r, alcance, vehiculoId, clave);
  } finally {
    if (arrendamiento === "mio") await soltar(clave);
  }
}

class ErrorAmable extends Error {
  constructor(public estado: number, mensaje: string) { super(mensaje); }
}

export function mountResumenVehiculo(app: Express, ...guards: RequestHandler[]): void {
  /**
   * ¿Se puede pedir resumen? Lo consulta el panel para no mostrar un botón que
   * va a dar error.
   */
  app.get("/api/tyrecontrol/resumen-vehiculo/estado", ...guards, async (req, res) => {
    try {
      const userId = (req as any).authCtx?.userId as string | undefined;
      if (!userId) return res.status(401).json({ disponible: false });
      const alcance = await resolverAlcance(userId);
      if (!alcance) return res.json({ disponible: false });
      const activa = await resumenVehiculoActivo(alcance.empresaId);
      res.json({ disponible: hayIA() && activa });
    } catch {
      res.json({ disponible: false });
    }
  });

  app.post("/api/tyrecontrol/vehiculos/:id/resumen", ...guards, async (req, res) => {
    try {
      const userId = (req as any).authCtx?.userId as string | undefined;
      if (!userId) return res.status(401).json({ error: "Sesión no válida" });

      const vehiculoId = String(req.params.id ?? "");
      if (!UUID.test(vehiculoId)) return res.status(400).json({ error: "Vehículo no válido" });

      // De qué empresa es el vehículo. Se resuelve antes de cualquier otra
      // cosa y el alcance se valida contra ÉL, no contra lo que pida el
      // cliente.
      const { data: fila } = await supabase
        .from("tc_vehiculos").select("empresa_id").eq("id", vehiculoId).maybeSingle();
      const empresaDelVehiculo = (fila as any)?.empresa_id as string | undefined;
      // Un vehículo de otro cliente responde igual que uno que no existe: no
      // se confirma su existencia.
      if (!empresaDelVehiculo) return res.status(404).json({ error: "Vehículo no encontrado" });

      const alcance = await resolverAlcance(userId, empresaDelVehiculo);
      if (!alcance || alcance.empresaId !== empresaDelVehiculo) {
        return res.status(404).json({ error: "Vehículo no encontrado" });
      }

      if (!(await resumenVehiculoActivo(alcance.empresaId))) {
        return res.status(403).json({ error: "El resumen con IA no está activado para esta empresa" });
      }
      if (!hayIA()) {
        return res.status(503).json({ error: "El resumen con IA no está disponible ahora mismo" });
      }

      const reunido = await reunir(vehiculoId, alcance.empresaId);
      if (!reunido) return res.status(404).json({ error: "Vehículo no encontrado" });

      // Nada que contar: no se gasta una llamada en decir que no hay nada.
      if (!reunido.hayAlgoQueResumir) {
        return res.json({
          ok: true,
          origen: "sin_datos",
          generado_at: new Date().toISOString(),
          ventana: reunido.datos.ventana,
          titular: "No hay actividad registrada de este vehículo para resumir.",
          ultimas_actuaciones: [],
          incidencias_abiertas: [],
          trabajos_pendientes: [],
          datos_que_faltan: reunido.datos.datos_que_faltan,
          avisos: [...reunido.datos.contradicciones, ...reunido.datos.recortes],
        });
      }

      const clave = claveCache(reunido, alcance);
      const refrescar = req.body?.refrescar === true;

      if (!refrescar) {
        const guardado = await leerCache(vehiculoId, clave, alcance.empresaId);
        if (guardado) {
          // Se apunta como servido desde caché: cuenta como petición, no como
          // intento al proveedor.
          await registrarCache(
            { empresaId: alcance.empresaId, operacion: OPERACION, modeloPedido: "cache" }, 0);
          return res.json(respuesta(guardado, reunido, "cache"));
        }
      }

      /*
       * Dos niveles de deduplicación, porque hacen falta los dos:
       *
       *  1. En este proceso, un Map de promesas: dos pulsaciones a la vez
       *     comparten la misma llamada y la misma respuesta.
       *  2. Entre procesos, un arrendamiento en la base (coordinacion.ts):
       *     el segundo proceso no llama al proveedor, espera a que el primero
       *     guarde el resumen y lo sirve de la caché.
       */
      let tarea = enVuelo.get(clave);
      if (!tarea) {
        tarea = generarCoordinado(reunido, alcance, vehiculoId, clave)
          .finally(() => enVuelo.delete(clave));
        enVuelo.set(clave, tarea);
      }
      const g = await tarea;
      res.json(respuesta(g, reunido, g.deCache ? "cache" : "ia"));
    } catch (e: any) {
      if (e instanceof ErrorAmable) return res.status(e.estado).json({ error: e.message });
      console.error("resumen vehiculo error:", e?.message ?? e);
      res.status(500).json({ error: "No se ha podido generar el resumen" });
    }
  });
}
