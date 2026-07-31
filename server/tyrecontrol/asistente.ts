/**
 * Mobilink TyreControl — Asistente virtual para clientes (fase 1).
 *
 * Responde preguntas sobre la flota en lenguaje natural ("¿cuál es el estado
 * general de mi flota?") mediante *function calling*: la IA elige qué
 * herramienta llamar de un conjunto CERRADO de solo lectura, el servidor la
 * ejecuta y le devuelve solo agregados. El modelo redacta con esas cifras.
 *
 * Diseño en docs/PROMPT_asistente_virtual_ia.md. Reglas que no se negocian:
 *   · La IA nunca escribe SQL ni recibe acceso a la base de datos.
 *   · La IA nunca elige de qué empresa habla: el alcance lo calcula el
 *     servidor a partir de la sesión (ver resolverAlcance).
 *   · Solo lectura: ninguna herramienta escribe.
 *
 * ⚠️ El cliente `supabase` del servidor usa SERVICE ROLE, así que **NO aplica
 * RLS**. Por eso cada consulta filtra por empresa_id de forma explícita con el
 * alcance ya validado. No copiar consultas de aquí sin ese filtro.
 *
 * Se monta desde server/index.ts con una línea:
 *   import { mountAsistente } from "./tyrecontrol/asistente.ts";
 *   mountAsistente(app, authenticate, requireModule("tyrecontrol"));
 */
import type { Express, RequestHandler } from "express";
import { supabase } from "../supabase.ts";
import { getClienteIA, hayIA, MODELOS } from "../core/openaiService.ts";

const UMBRAL_LEGAL_MM = 1.6; // mínimo legal si la empresa no tiene umbral propio
const MAX_LLAMADAS_HERRAMIENTA = 3;
const MAX_FILAS = 50;

// ── Alcance: qué empresas puede consultar este usuario ──────────────────────
type Alcance = { empresaId: string; nombre: string; esCliente: boolean };

/**
 * Calcula la empresa sobre la que responde el asistente. Es la barrera de
 * aislamiento entre clientes: la IA no interviene aquí, y `empresaSolicitada`
 * solo se acepta si el usuario ya tenía acceso.
 */
async function resolverAlcance(userId: string, empresaSolicitada?: string): Promise<Alcance | null> {
  const { data: u } = await supabase
    .from("tc_usuarios")
    .select("rol, empresa_id, es_superadmin")
    .eq("id", userId)
    .maybeSingle();
  if (!u) return null;

  const esCliente = u.rol === "cliente" && !u.es_superadmin;

  // Un cliente responde SIEMPRE por su empresa: no puede pedir otra.
  let empresaId: string | null = esCliente ? (u.empresa_id as string) : null;

  if (!esCliente) {
    const permitidas = new Set<string>();
    if (u.empresa_id) permitidas.add(u.empresa_id as string);
    const { data: asignadas } = await supabase
      .from("tc_operador_empresas")
      .select("empresa_id")
      .eq("usuario_id", userId);
    for (const a of asignadas ?? []) permitidas.add(a.empresa_id as string);

    if (empresaSolicitada) {
      // Un superadmin puede consultar cualquiera; el resto, solo las suyas.
      if (!u.es_superadmin && !permitidas.has(empresaSolicitada)) return null;
      empresaId = empresaSolicitada;
    } else {
      empresaId = (u.empresa_id as string) ?? [...permitidas][0] ?? null;
    }
  }
  if (!empresaId) return null;

  const { data: e } = await supabase.from("tc_empresas").select("nombre").eq("id", empresaId).maybeSingle();
  return { empresaId, nombre: (e?.nombre as string) ?? "tu empresa", esCliente };
}

/** Umbral de profundidad de la empresa (mm). Cae al mínimo legal. */
async function umbralMinimo(empresaId: string): Promise<number> {
  const { data } = await supabase
    .from("tc_config_umbrales")
    .select("profundidad_minima_mm")
    .eq("empresa_id", empresaId)
    .maybeSingle();
  const v = Number(data?.profundidad_minima_mm);
  return Number.isFinite(v) && v > 0 ? v : UMBRAL_LEGAL_MM;
}

const ESTADOS_INCIDENCIA_ABIERTA = ["solucionada", "cancelada", "no_procede"];

// ── Herramientas ────────────────────────────────────────────────────────────
// Cada una recibe SOLO el alcance ya validado y devuelve agregados.

async function estadoFlota(a: Alcance) {
  const minimo = await umbralMinimo(a.empresaId);
  const desde90 = new Date(Date.now() - 90 * 86400_000).toISOString().slice(0, 10);

  const [vehiculos, revisiones, incidencias, neumaticos] = await Promise.all([
    supabase.from("tc_vehiculos").select("id", { count: "exact", head: true })
      .eq("empresa_id", a.empresaId).eq("activo", true),
    supabase.from("revisiones_vehiculo").select("vehiculo_id")
      .eq("empresa_id", a.empresaId).gte("fecha_revision", desde90)
      .in("estado_revision", ["completada", "completada_con_incidencias", "completada_incidencia_pendiente", "enviada"]),
    supabase.from("tc_incidencias").select("gravedad")
      .eq("empresa_id", a.empresaId).not("estado", "in", `(${ESTADOS_INCIDENCIA_ABIERTA.join(",")})`),
    supabase.from("tc_neumaticos").select("profundidad_actual_mm")
      .eq("empresa_id", a.empresaId).eq("estado", "montado").eq("activo", true),
  ]);

  const revisados = new Set((revisiones.data ?? []).map((r: any) => r.vehiculo_id)).size;
  const total = vehiculos.count ?? 0;
  const porGravedad: Record<string, number> = {};
  for (const i of incidencias.data ?? []) {
    const g = (i as any).gravedad ?? "sin_clasificar";
    porGravedad[g] = (porGravedad[g] ?? 0) + 1;
  }
  const montados = (neumaticos.data ?? []).map((n: any) => Number(n.profundidad_actual_mm)).filter(Number.isFinite);
  const bajoMinimo = montados.filter((mm) => mm <= minimo).length;

  return {
    empresa: a.nombre,
    vehiculos_activos: total,
    revisados_ultimos_90_dias: revisados,
    sin_revisar_ultimos_90_dias: Math.max(0, total - revisados),
    incidencias_abiertas: (incidencias.data ?? []).length,
    incidencias_por_gravedad: porGravedad,
    neumaticos_montados_con_medida: montados.length,
    neumaticos_bajo_minimo: bajoMinimo,
    umbral_minimo_mm: minimo,
    // Se dice explícitamente para que el modelo no lo presente como cobertura total.
    nota: montados.length === 0
      ? "Ningún neumático montado tiene profundidad registrada todavía."
      : undefined,
  };
}

async function vehiculosPendientes(a: Alcance, dias = 90) {
  const corte = new Date(Date.now() - dias * 86400_000).toISOString().slice(0, 10);
  const [{ data: vehiculos }, { data: revisiones }] = await Promise.all([
    supabase.from("tc_vehiculos").select("id, matricula")
      .eq("empresa_id", a.empresaId).eq("activo", true).order("matricula"),
    supabase.from("revisiones_vehiculo").select("vehiculo_id, fecha_revision")
      .eq("empresa_id", a.empresaId)
      .in("estado_revision", ["completada", "completada_con_incidencias", "completada_incidencia_pendiente", "enviada"]),
  ]);

  const ultima = new Map<string, string>();
  for (const r of revisiones ?? []) {
    const id = (r as any).vehiculo_id as string;
    const f = (r as any).fecha_revision as string;
    if (!ultima.has(id) || f > ultima.get(id)!) ultima.set(id, f);
  }

  const pendientes = (vehiculos ?? [])
    .map((v: any) => ({ matricula: v.matricula, ultima_revision: ultima.get(v.id) ?? null }))
    .filter((v) => v.ultima_revision === null || v.ultima_revision < corte)
    .slice(0, MAX_FILAS);

  return {
    criterio: `Sin revisión completada en los últimos ${dias} días`,
    total: pendientes.length,
    nunca_revisados: pendientes.filter((v) => v.ultima_revision === null).length,
    vehiculos: pendientes,
  };
}

async function alertasActivas(a: Alcance) {
  const { data } = await supabase
    .from("tc_incidencias")
    .select("gravedad, estado, detectada_at, vehiculo:tc_vehiculos(matricula), posicion:tc_posiciones_vehiculo(codigo_posicion)")
    .eq("empresa_id", a.empresaId)
    .not("estado", "in", `(${ESTADOS_INCIDENCIA_ABIERTA.join(",")})`)
    .order("detectada_at", { ascending: false })
    .limit(MAX_FILAS);

  const filas = (data ?? []).map((i: any) => ({
    matricula: i.vehiculo?.matricula ?? null,
    posicion: i.posicion?.codigo_posicion ?? null,
    gravedad: i.gravedad,
    estado: i.estado,
    detectada: i.detectada_at ? String(i.detectada_at).slice(0, 10) : null,
  }));
  const criticas = filas.filter((f) => f.gravedad === "critica").length;
  return { total: filas.length, criticas, incidencias: filas };
}

// Definición para el modelo. Descripciones en español: el modelo elige mejor.
const HERRAMIENTAS = [
  {
    type: "function" as const,
    function: {
      name: "estado_flota",
      description:
        "Resumen general de la flota del cliente: nº de vehículos, cuántos se han revisado en los últimos 90 días, incidencias abiertas por gravedad y neumáticos montados por debajo del mínimo. Úsala para '¿cómo está mi flota?'.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "vehiculos_pendientes",
      description:
        "Lista de vehículos sin revisión completada en los últimos N días (por defecto 90). Úsala para '¿qué vehículos tengo que revisar?'.",
      parameters: {
        type: "object",
        properties: { dias: { type: "integer", description: "Días sin revisión, por defecto 90", minimum: 1, maximum: 365 } },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "alertas_activas",
      description:
        "Incidencias abiertas de la flota, con matrícula, posición y gravedad. Úsala para '¿tengo alertas urgentes?'.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
];

async function ejecutarHerramienta(nombre: string, args: any, a: Alcance): Promise<unknown> {
  switch (nombre) {
    case "estado_flota": return await estadoFlota(a);
    case "vehiculos_pendientes": return await vehiculosPendientes(a, Number(args?.dias) || 90);
    case "alertas_activas": return await alertasActivas(a);
    default: return { error: `Herramienta desconocida: ${nombre}` };
  }
}

const SYSTEM = (a: Alcance) => `
Eres el asistente de Mobilink TyreControl. Respondes en español, claro y breve
(2-5 frases), sobre la flota de "${a.nombre}" y NADA MÁS.

REGLAS:
- Usa SIEMPRE las herramientas para obtener datos. NUNCA inventes cifras ni
  estimes: si una herramienta no da el dato, dilo abiertamente.
- Destaca las cifras importantes en **negrita**.
- Un neumático por debajo del mínimo legal se SUSTITUYE. No des matices ni
  alternativas sobre eso.
- No hables de otros clientes, ni de precios, ni prometas plazos.
- Si la pregunta no es sobre la flota, dilo con educación y ofrece lo que sí
  puedes responder.
- Termina con la acción concreta más útil, si la hay.
`.trim();

// ── Endpoint ────────────────────────────────────────────────────────────────
export function mountAsistente(app: Express, ...guards: RequestHandler[]): void {
  // ¿Se puede usar el asistente? Lo consulta el panel para no mostrar el botón
  // si el servidor no tiene IA configurada.
  app.get("/api/tyrecontrol/asistente/estado", ...guards, (_req, res) => {
    res.json({ disponible: hayIA() });
  });

  app.post("/api/tyrecontrol/asistente/preguntar", ...guards, async (req, res) => {
    try {
      if (!hayIA()) return res.status(503).json({ error: "Asistente no disponible (falta OPENAI_API_KEY)" });
      const pregunta = String(req.body?.pregunta ?? "").trim();
      if (!pregunta) return res.status(400).json({ error: "Falta la pregunta" });
      if (pregunta.length > 500) return res.status(400).json({ error: "Pregunta demasiado larga" });

      const userId = (req as any).authCtx?.userId as string | undefined;
      if (!userId) return res.status(401).json({ error: "Sesión no válida" });

      const alcance = await resolverAlcance(userId, req.body?.empresa ? String(req.body.empresa) : undefined);
      if (!alcance) return res.status(403).json({ error: "Sin acceso a los datos de esa empresa" });

      const cliente = getClienteIA();
      const mensajes: any[] = [
        { role: "system", content: SYSTEM(alcance) },
        { role: "user", content: pregunta },
      ];
      const usadas: { herramienta: string; args: any }[] = [];
      const datos: Record<string, unknown> = {};

      // Bucle de function calling, acotado: el modelo pide herramientas, se le
      // devuelven los agregados y al final redacta.
      for (let vuelta = 0; vuelta <= MAX_LLAMADAS_HERRAMIENTA; vuelta++) {
        const r = await cliente.chat.completions.create({
          model: MODELOS.asistente,
          messages: mensajes,
          tools: HERRAMIENTAS,
          // En la última vuelta se le impide pedir más y se le obliga a responder.
          tool_choice: vuelta === MAX_LLAMADAS_HERRAMIENTA ? "none" : "auto",
        });
        const msg = r.choices[0]?.message;
        if (!msg) break;
        mensajes.push(msg);

        const llamadas = msg.tool_calls ?? [];
        if (llamadas.length === 0) {
          return res.json({
            respuesta: msg.content ?? "",
            herramientas_usadas: usadas.map((u) => u.herramienta),
            datos,
            fecha_datos: new Date().toISOString(),
          });
        }

        for (const c of llamadas) {
          const nombre = (c as any).function?.name as string;
          let args: any = {};
          try { args = JSON.parse((c as any).function?.arguments || "{}"); } catch {/* args vacíos */}
          const resultado = await ejecutarHerramienta(nombre, args, alcance);
          usadas.push({ herramienta: nombre, args });
          datos[nombre] = resultado;
          mensajes.push({ role: "tool", tool_call_id: (c as any).id, content: JSON.stringify(resultado) });
        }
      }

      res.json({
        respuesta: "No he podido completar la consulta. Inténtalo de nuevo.",
        herramientas_usadas: usadas.map((u) => u.herramienta),
        datos,
        fecha_datos: new Date().toISOString(),
      });
    } catch (e: any) {
      console.error("asistente error:", e);
      res.status(500).json({ error: e?.message || "Error del asistente" });
    }
  });
}
