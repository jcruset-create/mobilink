/**
 * Imágenes de satélite de Google para el mapa de una base en el panel.
 *
 * La clave de Google (`GOOGLE_MAPS_API_KEY`) vive en el servidor y no sale de
 * él: el navegador pide las teselas aquí y este router las trae de la Map
 * Tiles API de Google. Si la clave se pusiera en la URL de cada tesela,
 * cualquiera que abriera las herramientas del navegador se la llevaría.
 *
 * Las teselas las carga Leaflet con <img>, que no manda la cabecera de sesión.
 * Por eso el panel pide antes una FIRMA de corta duración (con su sesión) y la
 * pone en la URL de cada tesela. Sin firma válida no se sirve nada: así nadie
 * de fuera puede gastar la cuota de la clave.
 *
 * Si no hay clave, o Google no tiene activada la Map Tiles API para ella, la
 * sesión responde 503 y el panel cae a otra capa de satélite sin clave.
 */

import { Router, type Request, type Response } from "express";

import { resolverSolicitante } from "../conciliacion/router.ts";
import { VIDA_FIRMA_MS, firmaValida, firmar, teselaValida } from "./firma.ts";

/** La sesión de la Map Tiles API: dura unos días; se guarda hasta que caduca. */
let sesionGoogle: { id: string; expira: number } | null = null;

async function sesionDeGoogle(clave: string): Promise<string> {
  if (sesionGoogle && sesionGoogle.expira > Date.now() + 60_000) return sesionGoogle.id;
  const r = await fetch(`https://tile.googleapis.com/v1/createSession?key=${encodeURIComponent(clave)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mapType: "satellite", language: "es-ES", region: "ES" }),
  });
  if (!r.ok) throw new Error(`createSession ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const d = (await r.json()) as { session?: string; expiry?: string };
  if (!d.session) throw new Error("Google no ha devuelto sesión");
  sesionGoogle = { id: d.session, expira: Number(d.expiry ?? 0) * 1000 || Date.now() + 3_600_000 };
  return d.session;
}

export function createSateliteRouter(): Router {
  const router = Router();

  // Con la sesión del panel: devuelve la firma para pedir teselas.
  router.post("/sesion", async (req: Request, res: Response) => {
    try {
      const quien = await resolverSolicitante(req, { exigirAdmin: false });
      if (!quien) return res.status(401).json({ error: "No autenticado" });
      const clave = process.env.GOOGLE_MAPS_API_KEY;
      if (!clave) return res.status(503).json({ error: "GOOGLE_MAPS_API_KEY no configurada" });
      await sesionDeGoogle(clave);
      const expira = Date.now() + VIDA_FIRMA_MS;
      res.json({ firma: firmar(expira), expira });
    } catch (e: unknown) {
      // Lo normal aquí: la clave existe pero no tiene la Map Tiles API activada.
      console.error("[satelite] sesión:", e instanceof Error ? e.message : e);
      res.status(503).json({ error: "Google no da imágenes de satélite con esta clave" });
    }
  });

  // La tesela, con la firma en la URL (la pide un <img>, sin cabeceras).
  router.get("/:z/:x/:y", async (req: Request, res: Response) => {
    const z = Number(req.params.z);
    const x = Number(req.params.x);
    const y = Number(String(req.params.y).replace(/\.\w+$/, ""));
    if (!teselaValida(z, x, y)) return res.status(400).end();
    if (!firmaValida(req.query.f, req.query.e)) return res.status(403).end();
    const clave = process.env.GOOGLE_MAPS_API_KEY;
    if (!clave) return res.status(503).end();
    try {
      const sesion = await sesionDeGoogle(clave);
      const r = await fetch(
        `https://tile.googleapis.com/v1/2dtiles/${z}/${x}/${y}?session=${encodeURIComponent(sesion)}&key=${encodeURIComponent(clave)}`,
      );
      if (!r.ok) {
        // Sesión caducada antes de tiempo: se pide otra la próxima vez.
        if (r.status === 401 || r.status === 403) sesionGoogle = null;
        return res.status(r.status === 404 ? 404 : 502).end();
      }
      res.setHeader("Content-Type", r.headers.get("content-type") ?? "image/jpeg");
      // El navegador la guarda un día: volver al mismo patio no vuelve a pagar.
      res.setHeader("Cache-Control", "private, max-age=86400");
      res.send(Buffer.from(await r.arrayBuffer()));
    } catch (e: unknown) {
      console.error("[satelite] tesela:", e instanceof Error ? e.message : e);
      res.status(502).end();
    }
  });

  return router;
}
