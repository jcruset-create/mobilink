/**
 * Herramientas del Asistente IA: la ÚNICA forma que tiene la IA de leer o
 * tocar Mobilink. Nunca acceso directo a la base desde el proveedor: cada
 * herramienta llama a los servicios de Self Storage, con sus mismas reglas.
 *
 *   READ_ONLY   se ejecutan solas (activas por defecto).
 *   WRITE_SAFE  sólo si la empresa las ha ACTIVADO expresamente y los
 *               parámetros pasan la validación (desactivadas por defecto).
 *   SENSITIVE   bloqueadas siempre en esta versión (se registran los intentos).
 *
 * Además: el permiso de Self Storage que exige cada una (el de quien abre la
 * sesión) y la confirmación humana (si está marcada, en esta versión se
 * bloquea y se escala: no hay confirmación automática).
 *
 * TODA ejecución —bien, mal o bloqueada— queda en `self_storage_ai_tool_calls`
 * con los parámetros saneados.
 */

import { z } from "zod";
import { pool } from "../../shared/db.ts";
import { leerAjuste } from "../../shared/settings.ts";
import type { Actor } from "../../shared/audit.ts";
import type { Permiso } from "../../auth/permissions.ts";
import { sanear } from "../../domain/asistente.ts";
import { INCIDENT_TYPES } from "../../../../src/modules/self-storage/types/enums.ts";
import { clientesPorTelefono, fichaMinima, telefonoONulo } from "../callcenter/identificacion.ts";
import { disponibilidad, infoCentro } from "../callcenter/informes.ts";
import * as llamadas from "../callcenter/service.ts";
import { crearIncidencia } from "../incidencias/service.ts";
import { buscar } from "./conocimiento.ts";

export type Riesgo = "READ_ONLY" | "WRITE_SAFE" | "SENSITIVE";

/** Contexto de ejecución: de qué sesión, en qué llamada y con qué permisos. */
export type ContextoHerramienta = {
  empresaId: string;
  sessionId: string;
  callId: string | null;
  centerId: string | null;
  idioma: string;
  /** Quien queda en la auditoría (el asistente, con el proveedor en el nombre). */
  actorIA: Actor;
  /** Persona que abrió la sesión (consola) o null si la abrió el sistema (telefonía). */
  staffUserId: string | null;
  /** Permisos con los que se ejecuta: los de la persona, o los del sistema. */
  permisos: readonly string[];
  /** Al crear una llamada desde una herramienta, la sesión la adopta. */
  adoptarLlamada: (callId: string) => Promise<void>;
};

type Definicion<P extends z.ZodType = z.ZodType> = {
  nombre: string;
  descripcion: string;
  riesgo: Riesgo;
  permiso: Permiso | null;
  /** Lo que se le explica al modelo sobre los parámetros. */
  parametrosTexto: string;
  parametros: P;
  requiereConfirmacion?: boolean;
  ejecutar?: (ctx: ContextoHerramienta, p: z.infer<P>) => Promise<unknown>;
};

const sinLlamada = () => new Error("La sesión no tiene llamada: usa registrar_llamada antes.");
const vacio = z.object({}).strict();

const def = <P extends z.ZodType>(d: Definicion<P>) => d as unknown as Definicion;

export const CATALOGO: readonly Definicion[] = [
  // ── READ_ONLY ──
  def({
    nombre: "buscar_cliente_por_telefono",
    descripcion: "¿El número es de un cliente? Devuelve sólo si es cliente, su nombre de pila, cuántos contratos activos tiene y si su acceso está bloqueado.",
    riesgo: "READ_ONLY",
    permiso: "ss.callcenter.view",
    parametrosTexto: '{"telefono": "opcional; por defecto, el de la llamada"}',
    parametros: z.object({ telefono: z.string().trim().max(30).optional() }).strict(),
    ejecutar: async (ctx, p) => {
      let tel = p.telefono ?? null;
      if (!tel && ctx.callId) tel = (await pool.query(`SELECT phone_e164 FROM self_storage_calls WHERE id = $1`, [ctx.callId])).rows[0]?.phone_e164 ?? null;
      const e164 = telefonoONulo(tel);
      if (!e164) return { esCliente: false, motivo: "número desconocido u oculto" };
      const encontrados = await clientesPorTelefono(ctx.empresaId, e164);
      if (!encontrados.length) return { esCliente: false };
      const f = await fichaMinima(ctx.empresaId, encontrados[0].customerId);
      return {
        esCliente: true,
        variosClientes: encontrados.length > 1,
        nombre: f?.name.split(/\s+/)[0] ?? null,
        contratosActivos: f?.contracts.filter((k) => k.status === "active").length ?? 0,
        accesoBloqueado: f?.accessBlocked ?? false,
        incidenciasAbiertas: f?.openIncidents ?? 0,
      };
    },
  }),
  def({
    nombre: "consultar_centro",
    descripcion: "Nombre, dirección y enlaces (web, calculadora, contratación, visita virtual) del centro.",
    riesgo: "READ_ONLY",
    permiso: "ss.callcenter.view",
    parametrosTexto: "{}",
    parametros: vacio,
    ejecutar: async (ctx) => {
      const c = await infoCentro(ctx.empresaId, ctx.centerId);
      return { name: c.name, address: c.address, postalCode: c.postalCode, city: c.city, links: c.links };
    },
  }),
  def({
    nombre: "consultar_disponibilidad",
    descripcion: "Disponibilidad REAL en este momento por tipo de trastero (sólo sí/no). Sin precios. El precio y la contratación se confirman en la web.",
    riesgo: "READ_ONLY",
    permiso: "ss.callcenter.view",
    parametrosTexto: "{}",
    parametros: vacio,
    ejecutar: async (ctx) => {
      const centro = ctx.centerId ?? (await infoCentro(ctx.empresaId, null)).id;
      const r = await disponibilidad(ctx.empresaId, centro);
      const enlaces = await leerAjuste(pool, ctx.empresaId, centro, "call_center.links");
      return { centerName: r.centerName, checkedAt: r.checkedAt, types: r.types.map((t) => ({ name: t.name, areaM2: t.areaM2, available: t.available })), notice: r.notice, web: enlaces.web };
    },
  }),
  def({
    nombre: "obtener_base_conocimiento",
    descripcion: "Busca en la base de conocimiento ESTÁTICA (funcionamiento, contratación online, calculadora, visitas, modelo low cost, preguntas frecuentes).",
    riesgo: "READ_ONLY",
    permiso: null,
    parametrosTexto: '{"consulta": "texto a buscar"}',
    parametros: z.object({ consulta: z.string().trim().min(1).max(300) }).strict(),
    ejecutar: async (ctx, p) => {
      const items = await buscar(ctx.empresaId, ctx.centerId, ctx.idioma, p.consulta, 3);
      return { items: items.map((i) => ({ question: i.question, answer: i.answer, category: i.category })) };
    },
  }),
  // ── WRITE_SAFE (desactivadas hasta que la empresa las active) ──
  def({
    nombre: "registrar_llamada",
    descripcion: "Registra la llamada en curso en el Call Center si aún no lo está.",
    riesgo: "WRITE_SAFE",
    permiso: "ss.callcenter.create",
    parametrosTexto: '{"telefono": "opcional", "nombre": "opcional"}',
    parametros: z.object({ telefono: z.string().trim().max(30).optional(), nombre: z.string().trim().max(160).optional() }).strict(),
    ejecutar: async (ctx, p) => {
      if (ctx.callId) return { yaRegistrada: true, callId: ctx.callId };
      const l = await llamadas.crearLlamada(ctx.actorIA, { phone: p.telefono ?? null, callerName: p.nombre ?? null, centerId: ctx.centerId, direction: "incoming", handledBy: "ai", language: ctx.idioma, answered: true });
      await ctx.adoptarLlamada(l.id);
      return { callId: l.id, esCliente: Boolean(l.customerId) };
    },
  }),
  def({
    nombre: "registrar_resultado",
    descripcion: "Registra el resultado de la llamada (enviado_web, enviado_calculadora, enviado_contratacion, resuelto, requiere_seguimiento…).",
    riesgo: "WRITE_SAFE",
    permiso: "ss.callcenter.edit",
    parametrosTexto: '{"resultado": "código de resultado", "resumen": "breve"}',
    parametros: z.object({ resultado: z.string().regex(/^[a-z][a-z0-9_]{1,39}$/).refine((r) => r !== "escalado_tlc", "para escalar, usa accion=escalar"), resumen: z.string().trim().max(2000).optional() }).strict(),
    ejecutar: async (ctx, p) => {
      if (!ctx.callId) throw sinLlamada();
      const l = await llamadas.registrarResultado(ctx.actorIA, ctx.callId, { resultCode: p.resultado, summary: p.resumen ?? null });
      return { estado: l.status, resultado: l.resultCode };
    },
  }),
  def({
    nombre: "solicitar_visita",
    descripcion: "Anota una SOLICITUD de visita (virtual o guiada) para que el equipo la confirme. No la confirma ni la promete.",
    riesgo: "WRITE_SAFE",
    permiso: "ss.callcenter.edit",
    parametrosTexto: '{"tipo": "virtual|guiada", "notas": "opcional"}',
    parametros: z.object({ tipo: z.enum(["virtual", "guiada"]), notas: z.string().trim().max(1000).optional() }).strict(),
    ejecutar: async (ctx, p) => {
      if (!ctx.callId) throw sinLlamada();
      const l = await llamadas.registrarResultado(ctx.actorIA, ctx.callId, { resultCode: p.tipo === "guiada" ? "visita_guiada_solicitada" : "visita_virtual_solicitada", notes: p.notas ?? null });
      return { solicitada: true, confirmada: false, seguimiento: l.followUpAt };
    },
  }),
  def({
    nombre: "crear_incidencia",
    descripcion: "Abre una incidencia ligada a la llamada (acceso, seguridad, emergencia y fallo grave son urgentes).",
    riesgo: "WRITE_SAFE",
    permiso: "ss.incidents.create",
    parametrosTexto: `{"tipo": "${INCIDENT_TYPES.join("|")}", "titulo": "breve", "descripcion": "opcional"}`,
    parametros: z.object({ tipo: z.enum(INCIDENT_TYPES), titulo: z.string().trim().min(1).max(200), descripcion: z.string().trim().max(2000).optional() }).strict(),
    ejecutar: async (ctx, p) => {
      if (!ctx.callId) throw sinLlamada();
      const centro = ctx.centerId ?? (await infoCentro(ctx.empresaId, null)).id;
      const n = await crearIncidencia(ctx.actorIA, { callId: ctx.callId, centerId: centro, incidentType: p.tipo, title: p.titulo, description: p.descripcion ?? null }, "call");
      return { incidenciaId: n.id, prioridad: n.priority };
    },
  }),
  def({
    nombre: "crear_seguimiento",
    descripcion: "Deja la llamada pendiente de seguimiento por el equipo.",
    riesgo: "WRITE_SAFE",
    permiso: "ss.callcenter.edit",
    parametrosTexto: '{"notas": "qué hay que hacer"}',
    parametros: z.object({ notas: z.string().trim().min(1).max(1000) }).strict(),
    ejecutar: async (ctx, p) => {
      if (!ctx.callId) throw sinLlamada();
      const l = await llamadas.seguimiento(ctx.actorIA, ctx.callId, { notes: p.notas, done: false });
      return { seguimiento: l.followUpAt };
    },
  }),
  // ── SENSITIVE: definidas para que el intento quede registrado y bloqueado ──
  ...(
    [
      ["modificar_contrato", "Cambiar condiciones de un contrato."],
      ["cancelar_contrato", "Cancelar o dar de baja un contrato."],
      ["modificar_precio", "Cambiar un precio."],
      ["emitir_devolucion", "Devolver dinero."],
      ["modificar_pago", "Cambiar datos de pago o marcar pagos."],
    ] as const
  ).map(([nombre, descripcion]) => def({ nombre, descripcion: `${descripcion} PROHIBIDO al asistente.`, riesgo: "SENSITIVE", permiso: null, parametrosTexto: "{}", parametros: z.object({}).passthrough() })),
];

export type ConfigHerramienta = { active: boolean; requiresConfirmation: boolean };

/** Estado efectivo: por defecto, READ_ONLY activas; WRITE_SAFE inactivas; SENSITIVE bloqueadas siempre. */
export function efectiva(d: Pick<Definicion, "nombre" | "riesgo" | "requiereConfirmacion">, config: Record<string, ConfigHerramienta>): ConfigHerramienta {
  const c = config[d.nombre];
  if (d.riesgo === "SENSITIVE") return { active: false, requiresConfirmation: true };
  return { active: c?.active ?? d.riesgo === "READ_ONLY", requiresConfirmation: c?.requiresConfirmation ?? Boolean(d.requiereConfirmacion) };
}

export async function catalogoEfectivo(empresaId: string) {
  const config = await leerAjuste(pool, empresaId, null, "ai_assistant.tools");
  return CATALOGO.map((d) => ({ nombre: d.nombre, descripcion: d.descripcion, riesgo: d.riesgo, permiso: d.permiso, parametros: d.parametrosTexto, ...efectiva(d, config) }));
}

export type ResultadoHerramienta = { herramienta: string; estado: "success" | "error" | "blocked"; resultado?: unknown; error?: string };

/** Ejecuta una herramienta con todas las comprobaciones y deja constancia. */
export async function ejecutarHerramienta(ctx: ContextoHerramienta, nombre: string, parametrosCrudos: unknown): Promise<ResultadoHerramienta> {
  const inicio = Date.now();
  const d = CATALOGO.find((x) => x.nombre === nombre);
  const config = await leerAjuste(pool, ctx.empresaId, null, "ai_assistant.tools");
  const registrar = async (r: ResultadoHerramienta) => {
    await pool.query(
      `INSERT INTO self_storage_ai_tool_calls (empresa_id, session_id, call_id, tool, risk, actor_type, actor_id, params, result, outcome, error, duration_ms)
       VALUES ($1,$2,$3,$4,$5,'ai',$6,$7,$8,$9,$10,$11)`,
      [
        ctx.empresaId,
        ctx.sessionId,
        ctx.callId,
        /^[a-z][a-z0-9_]{1,59}$/.test(nombre) ? nombre : "desconocida",
        d?.riesgo ?? "UNKNOWN",
        ctx.staffUserId,
        JSON.stringify(sanear(parametrosCrudos ?? {})),
        r.resultado === undefined ? null : JSON.stringify(sanear(r.resultado)),
        r.estado,
        r.error?.slice(0, 500) ?? null,
        Date.now() - inicio,
      ]
    );
    return r;
  };
  if (!d) return registrar({ herramienta: nombre, estado: "blocked", error: "Herramienta desconocida." });
  if (d.riesgo === "SENSITIVE" || !d.ejecutar) return registrar({ herramienta: nombre, estado: "blocked", error: "Operación sensible: prohibida al asistente." });
  const e = efectiva(d, config);
  if (!e.active) return registrar({ herramienta: nombre, estado: "blocked", error: "Herramienta desactivada para esta empresa." });
  if (e.requiresConfirmation) return registrar({ herramienta: nombre, estado: "blocked", error: "Requiere confirmación humana." });
  if (d.permiso && !ctx.permisos.includes(d.permiso)) return registrar({ herramienta: nombre, estado: "blocked", error: `Sin permiso ${d.permiso}.` });
  const p = d.parametros.safeParse(parametrosCrudos ?? {});
  if (!p.success) return registrar({ herramienta: nombre, estado: "error", error: `Parámetros no válidos: ${p.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}` });
  try {
    const resultado = await d.ejecutar(ctx, p.data);
    return registrar({ herramienta: nombre, estado: "success", resultado });
  } catch (err) {
    return registrar({ herramienta: nombre, estado: "error", error: err instanceof Error ? err.message : "Error" });
  }
}
