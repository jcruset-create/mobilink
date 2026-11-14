/**
 * Leer los partes de revisión en papel de Grupo Soledad.
 *
 * Solo LEE. No guarda la hoja, no crea revisiones, no monta gomas y no toca
 * el vehículo: eso lo hace el panel cuando una persona ha confirmado lo que
 * ve. Un endpoint que escribiera dejaría la flota a merced de lo que el
 * modelo crea ver en un escaneo torcido, y estos escaneos vienen torcidos.
 *
 * Pasa por el servidor porque la clave de OpenAI vive aquí y no puede salir.
 *
 * ── Dos pasos, y no uno ────────────────────────────────────────────────────
 *
 * `POST /hojas` parte el fichero y devuelve una página por parte.
 * `POST /leer`  lee UNA de esas páginas.
 *
 * Podría ser una sola llamada que lo hiciera todo, y sería peor. Un PDF de
 * catorce partes son catorce llamadas al proveedor: metidas en una sola
 * petición HTTP son más de dos minutos colgando de una conexión que puede
 * cortarse, sin nada que enseñar mientras tanto y sin forma de reintentar la
 * hoja 7 sin repetir las otras trece.
 *
 * Partido en dos, el panel puede ir enseñando «hoja 3 de 14», reintentar la
 * que falle y dejar que el usuario empiece a revisar las que ya están.
 *
 * ── Qué NO se registra ─────────────────────────────────────────────────────
 *
 * Ni el fichero, ni la matrícula, ni el contenido de la respuesta. En el log
 * queda que se ha leído una hoja, cuánto ha tardado y si ha ido bien. Lo demás
 * es un documento del cliente.
 */

import { Router, json, type Request, type Response } from "express";

import { supabase } from "../../supabase.ts";
import { comprobarFichero } from "../parteProveedor/fichero.ts";
import { LectorHojaFlotasIA, type LectorHojaFlotas } from "./lector.ts";
import { partirEnHojas } from "./paginas.ts";

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

export function createParteFlotasRouter(
  lector: LectorHojaFlotas = new LectorHojaFlotasIA(),
): Router {
  const router = Router();
  // 12 MB: el data URI abulta un tercio más que el fichero, y del tamaño de
  // verdad se encarga `comprobarFichero` con el tope real de 8 MB.
  router.use(json({ limit: "12mb" }));

  /** Partir el fichero en una página por parte. No llama al proveedor. */
  router.post("/hojas", async (req: Request, res: Response) => {
    try {
      if (!(await usuarioDe(req))) return res.status(401).json({ error: "Sin sesión" });

      const fichero = String((req.body as { fichero?: string })?.fichero ?? "");
      const comprobado = comprobarFichero(fichero);
      // `"error" in` y no `!comprobado.ok`: `tsconfig.server.json` va sin
      // `strict`, así que TypeScript no estrecha la unión por el booleano.
      if ("error" in comprobado) return res.status(400).json({ error: comprobado.error });

      const troceado = await partirEnHojas(fichero);
      if ("motivo" in troceado) return res.status(400).json({ error: troceado.motivo });

      console.log(`[parte-flotas] fichero partido en ${troceado.total} hojas`);
      res.json({ total: troceado.total, hojas: troceado.paginas });
    } catch (e) {
      console.error("[parte-flotas] fallo al partir:", (e as Error)?.message ?? e);
      res.status(500).json({ error: "No se ha podido abrir el fichero" });
    }
  });

  /** Leer UNA hoja. Devuelve lo que pone; no decide nada. */
  router.post("/leer", async (req: Request, res: Response) => {
    const inicio = Date.now();
    try {
      if (!(await usuarioDe(req))) return res.status(401).json({ error: "Sin sesión" });

      const cuerpo = req.body as { hoja?: string; nombre?: string };
      const hoja = String(cuerpo?.hoja ?? "");
      const comprobado = comprobarFichero(hoja);
      if ("error" in comprobado) return res.status(400).json({ error: comprobado.error });

      const lectura = await lector.leer({ dataUri: hoja, nombre: cuerpo?.nombre });
      console.log(
        `[parte-flotas] hoja leída en ${Date.now() - inicio} ms · ` +
        `${lectura.filas.length} filas · confianza ${lectura.confianza ?? "?"}`,
      );
      res.json({ lectura });
    } catch (e) {
      console.error("[parte-flotas] fallo al leer:", (e as Error)?.message ?? e);
      // Una hoja que no se puede leer no puede tumbar el lote: el panel la
      // marca y deja teclearla a mano.
      res.status(502).json({ error: "No se ha podido leer la hoja" });
    }
  });

  return router;
}
