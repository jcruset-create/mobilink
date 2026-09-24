/**
 * Leer un parte de trabajo del taller y devolver lo que pone.
 *
 * Solo LEE. No guarda el parte, no crea revisiones ni monta gomas: eso lo hace
 * el panel llamando a `tc_guardar_parte_guiado` cuando una persona ha
 * confirmado la propuesta. Un endpoint que escribiera dejaría la flota a
 * merced de lo que el modelo crea ver en un escaneo torcido.
 *
 * Pasa por el servidor porque la clave de OpenAI vive aquí y no puede salir.
 *
 * ── Qué NO se registra ──────────────────────────────────────────────────────
 *
 * Ni el fichero, ni la matrícula, ni el cliente, ni el contenido de la
 * respuesta. En el log queda que se ha leído un parte, cuánto ha tardado y si
 * ha ido bien. Lo demás es un documento del cliente.
 */

import { Router, json, type Request, type Response } from "express";

import { supabase } from "../../supabase.ts";
import { LectorParteIA, type LectorParte } from "./lector.ts";
import { comprobarFichero } from "./fichero.ts";

async function usuarioDe(req: Request): Promise<{ userId: string } | null> {
  const cabecera = String(req.headers.authorization ?? "");
  const token = cabecera.startsWith("Bearer ") ? cabecera.slice(7) : "";
  if (!token) return null;
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return null;
  const { data: perfil } = await supabase
    .from("tc_usuarios").select("activo").eq("id", data.user.id).maybeSingle();
  if (!perfil || (perfil as { activo?: boolean }).activo === false) return null;
  return { userId: data.user.id };
}

export function createParteProveedorRouter(lector: LectorParte = new LectorParteIA()): Router {
  const router = Router();
  // 12 MB: el data: URI abulta un tercio más que el fichero, y del tamaño de
  // verdad se encarga comprobarFichero con el tope real.
  router.use(json({ limit: "12mb" }));

  router.post("/leer", async (req: Request, res: Response) => {
    const inicio = Date.now();
    try {
      const usuario = await usuarioDe(req);
      if (!usuario) return res.status(401).json({ error: "Sin sesión" });

      const dataUri = String((req.body as { fichero?: string })?.fichero ?? "");
      const comprobado = comprobarFichero(dataUri);
      if (comprobado.ok === false) return res.status(400).json({ error: comprobado.error });

      const lectura = await lector.leer({
        dataUri,
        nombre: String((req.body as { nombre?: string })?.nombre ?? "parte.pdf").slice(0, 120),
      });

      // Del papel no se registra nada: ni matrícula, ni cliente, ni filas.
      console.log(`[parte-proveedor] leído en ${Date.now() - inicio} ms · ` +
        `${lectura.filas.length} filas · ${lectura.productos.length} productos`);

      return res.json({ lectura });
    } catch (e) {
      console.error("[parte-proveedor] fallo al leer:", (e as Error)?.message ?? e);
      return res.status(500).json({ error: "No se ha podido leer el parte" });
    }
  });

  return router;
}
