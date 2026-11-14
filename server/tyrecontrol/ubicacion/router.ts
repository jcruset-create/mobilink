/**
 * La tablet dice dónde está.
 *
 * Dos rutas y nada más: mandar la posición y borrarla al cerrar sesión. No hay
 * ruta de lectura porque no hace falta: el panel lee `tc_posicion_tablet`
 * directamente por Supabase, con su RLS, igual que lee la lista de usuarios.
 *
 * ── Por qué pasa por el servidor y no escribe la tablet ─────────────────────
 *
 * Porque la tabla no tiene política de escritura para `authenticated`: escribe
 * el backend con la clave de servicio. Si la tablet pudiera escribir con su
 * propio token, cualquiera podría colocar su tablet donde le conviniera desde
 * un móvil con el PIN de otro. Así la posición solo entra por aquí, y aquí se
 * sabe de quién es porque sale del token, no del cuerpo de la petición.
 */

import { Router, json, type Request, type Response } from "express";

import { supabase } from "../../supabase.ts";
import { borrarPosicion, guardarPosicion, posicionValida } from "./posicionTablet.ts";

type Operario = { usuarioId: string; empresaId: string | null };

function fallo(res: Response, e: unknown) {
  console.error("[ubicacion-tablet] error:", (e as any)?.message ?? e);
  return res.status(500).json({ error: "Error con la ubicación" });
}

/**
 * Quién manda la posición.
 *
 * No se reutiliza `resolverSolicitante` de la conciliación porque aquel exige
 * un perfil con rol y aquí vale cualquier usuario activo con la APK: el dueño
 * de la posición es quien tiene el token, y punto.
 */
async function operarioDe(req: Request): Promise<Operario | null> {
  const cabecera = String(req.headers.authorization ?? "");
  const token = cabecera.startsWith("Bearer ") ? cabecera.slice(7) : "";
  if (!token) return null;

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return null;

  const { data: perfil } = await supabase
    .from("tc_usuarios")
    .select("id, empresa_id, activo")
    .eq("id", data.user.id)
    .maybeSingle();
  if (!perfil || (perfil as any).activo === false) return null;

  return {
    usuarioId: String((perfil as any).id),
    empresaId: (perfil as any).empresa_id ? String((perfil as any).empresa_id) : null,
  };
}

export function createUbicacionRouter(): Router {
  const router = Router();
  router.use(json({ limit: "8kb" }));

  router.use(async (req, res, next) => {
    try {
      const operario = await operarioDe(req);
      if (!operario) return res.status(401).json({ error: "Sesión no válida" });
      (req as any).operario = operario;
      next();
    } catch (e) {
      fallo(res, e);
    }
  });

  /**
   * Una posición.
   *
   * `vistoAt` lo manda la tablet: con la cola offline, el momento en que se
   * tomó y el momento en que llega pueden ser muy distintos, y el que vale es
   * el primero. Si no viene o no se entiende, se usa el de ahora, que es lo
   * que se hacía antes de que existiera la cola.
   */
  router.post("/", async (req, res) => {
    try {
      const { usuarioId, empresaId } = (req as any).operario as Operario;
      const lat = Number(req.body?.lat);
      const lng = Number(req.body?.lng);
      if (!posicionValida({ lat, lng })) {
        return res.status(400).json({ error: "Coordenadas no válidas" });
      }
      const crudo = req.body?.vistoAt ? Date.parse(String(req.body.vistoAt)) : NaN;
      const vistoAt = Number.isFinite(crudo) ? new Date(crudo) : new Date();

      await guardarPosicion(usuarioId, empresaId, {
        lat,
        lng,
        precisionM: Number.isFinite(Number(req.body?.precisionM))
          ? Number(req.body.precisionM)
          : null,
        velocidadKmh: Number.isFinite(Number(req.body?.velocidadKmh))
          ? Number(req.body.velocidadKmh)
          : null,
        vistoAt,
      });
      res.json({ ok: true });
    } catch (e) {
      fallo(res, e);
    }
  });

  /** Al cerrar sesión. */
  router.delete("/", async (req, res) => {
    try {
      const { usuarioId } = (req as any).operario as Operario;
      await borrarPosicion(usuarioId);
      res.json({ ok: true });
    } catch (e) {
      fallo(res, e);
    }
  });

  return router;
}
