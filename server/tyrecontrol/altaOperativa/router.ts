/**
 * API del alta operativa de vehículos, para la APK del técnico.
 *
 * Contesta una sola pregunta: ¿con qué vehículos de esta empresa no se puede
 * trabajar todavía, y qué les falta? La decisión la toma `estadoDeAlta()`, que
 * es código puro y con pruebas; aquí solo se juntan los recuentos que da la
 * base y se comprueba quién pregunta.
 *
 * ── Por qué un endpoint y no una consulta desde la APK ──────────────────────
 *
 * Porque el recuento de profundidades no se puede hacer en el móvil sin
 * traerse `revisiones_neumaticos_detalle` entero —cientos de miles de filas en
 * una flota grande— y porque el criterio de «qué está pendiente» tiene que ser
 * UNO. Si lo calculara cada pantalla, el contador del menú y la lista podrían
 * discrepar, que es exactamente lo que no puede pasar en un contador.
 *
 * ── Permisos ────────────────────────────────────────────────────────────────
 *
 * El mismo criterio que el resto de TyreControl: `puedeVerEmpresa`. No se
 * inventa uno más estrecho para los técnicos porque «todo técnico ve todas las
 * flotas» es una decisión deliberada del proyecto, escrita en
 * `empresaAcceso.ts`. Lo que sí impide es que un usuario de rol cliente
 * alcance la flota de otro.
 *
 * Se comprueba AQUÍ además de en la base: el servidor habla con `service_role`
 * y no pasa por RLS.
 */

import { Router, json, type Request, type Response } from "express";

import { supabase } from "../../supabase.ts";
import { puedeVerEmpresa } from "../empresaAcceso.ts";
import { pendientes, type VehiculoParaAlta } from "./estado.ts";

/** Sesión → usuario. Sin rol: para leer basta con poder ver la empresa. */
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

function fallo(res: Response, e: unknown) {
  // Sin matrículas ni identificadores en el registro: es una lista de flota.
  console.error("[alta-operativa] error:", (e as any)?.message ?? e);
  return res.status(500).json({ error: "Error al leer los vehículos pendientes" });
}

/** Una fila de `tc_alta_operativa_recuentos` en el vocabulario del dominio. */
function aVehiculo(f: Record<string, unknown>): VehiculoParaAlta & { numeroUnidad: string | null; tipoNombre: string | null } {
  const n = (v: unknown) => {
    const x = Number(v);
    return Number.isFinite(x) ? x : 0;
  };
  return {
    id: String(f.vehiculo_id ?? ""),
    matricula: String(f.matricula ?? ""),
    tipoId: f.tipo_id ? String(f.tipo_id) : null,
    posicionesDelTipo: n(f.posiciones_del_tipo),
    posicionesConNeumatico: n(f.posiciones_con_neumatico),
    posicionesConProfundidad: n(f.posiciones_con_profundidad),
    numeroUnidad: f.numero_unidad ? String(f.numero_unidad) : null,
    tipoNombre: f.tipo_nombre ? String(f.tipo_nombre) : null,
  };
}

export function createAltaOperativaRouter(): Router {
  const router = Router();
  router.use(json({ limit: "16kb" }));

  /**
   * Los vehículos de una empresa a los que les falta el alta operativa.
   *
   * Devuelve además `total`, que es lo que enseña el contador del menú. Va en
   * la MISMA respuesta que la lista a propósito: pedirlo aparte permitiría que
   * el número y la lista se contradijeran.
   */
  router.get("/pendientes", async (req, res) => {
    try {
      const usuario = await usuarioDe(req);
      if (!usuario) return res.status(401).json({ error: "Sin sesión" });

      const empresaId = String(req.query.empresa ?? "").trim();
      if (!empresaId) return res.status(400).json({ error: "Falta la empresa" });
      const puede = await puedeVerEmpresa(
        { userId: usuario.userId, esSuperadmin: usuario.esSuperadmin }, empresaId,
      );
      // Mismo cuerpo que una empresa vacía: no se confirma que exista.
      if (!puede) return res.json({ empresaId, total: 0, vehiculos: [] });

      const { data, error } = await supabase.rpc("tc_alta_operativa_recuentos", { p_empresa: empresaId });
      if (error) throw new Error(error.message);

      const lista = pendientes((data ?? []).map(aVehiculo) as VehiculoParaAlta[]);
      res.json({
        empresaId,
        total: lista.length,
        vehiculos: lista.map((v) => ({
          id: v.id,
          matricula: v.matricula,
          numeroUnidad: (v as any).numeroUnidad ?? null,
          // El tipo que ya tuviera, para que al reanudar un alta a medias el
          // asistente no vuelva a preguntar lo que ya está contestado.
          tipoId: v.tipoId,
          tipoNombre: (v as any).tipoNombre ?? null,
          motivo: v.estado.motivo,
          texto: v.estado.texto,
          progreso: v.estado.progreso,
        })),
      });
    } catch (e) {
      fallo(res, e);
    }
  });

  return router;
}
