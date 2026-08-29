/**
 * API de documentos y de estado administrativo.
 *
 * Se monta dos veces con guardas distintos: una para el panel de Assist y otra
 * para Central. Lo que cambia es quién pregunta —y por tanto qué documentos
 * salen—, no la lógica, que está en el servicio.
 */

import { Router, json, type RequestHandler, type Response } from "express";

import {
  ErrorDocumento,
  cambiarVisibilidad,
  listarDocumentos,
  marcarFacturada,
  registrarDocumento,
  situacionAdministrativa,
  validarCoste,
  type Sistema,
} from "./servicio.ts";
import { ETIQUETA_ADMIN, ETIQUETA_TIPO, TIPOS_DOCUMENTO, VISIBILIDADES } from "./tipos.ts";

function fallo(res: Response, e: unknown) {
  if (e instanceof ErrorDocumento) {
    return res.status(e.estado).json({ error: e.message, code: e.codigo });
  }
  console.error("[Documentos] error:", (e as any)?.message);
  return res.status(500).json({ error: "Error en la documentación" });
}

/**
 * `guardas` es una lista porque los dos paneles protegen distinto: Assist con
 * un middleware y Connect con dos (autenticar y luego resolver el rol). Se
 * aplican todos; coger solo uno dejaría la puerta a medio cerrar.
 */
export function createDocumentosRouter(
  system: Sistema,
  guardas: RequestHandler | RequestHandler[],
): Router {
  const router = Router();
  router.use(json({ limit: "1mb" }));
  for (const g of Array.isArray(guardas) ? guardas : [guardas]) router.use(g);

  /** Catálogo, para que el panel no repita las listas. */
  router.get("/catalogo", (_req, res) => {
    res.json({
      tipos: TIPOS_DOCUMENTO.map((t) => ({ valor: t, etiqueta: ETIQUETA_TIPO[t] })),
      visibilidades: VISIBILIDADES,
      estadosAdmin: Object.entries(ETIQUETA_ADMIN).map(([valor, etiqueta]) => ({ valor, etiqueta })),
    });
  });

  router.get("/asistencias/:id/documentos", async (req, res) => {
    try {
      res.json({ data: await listarDocumentos(system, req.params.id, "propio") });
    } catch (e) { fallo(res, e); }
  });

  router.post("/asistencias/:id/documentos", async (req: any, res) => {
    try {
      const doc = await registrarDocumento({
        system,
        tenantId: req.assistPanelUser?.tallerId ?? req.connectUser?.controlCenterId ?? null,
        assistanceId: req.params.id,
        correlationId: req.body?.correlationId ?? null,
        tipo: req.body?.tipo,
        origen: req.body?.origen,
        // La visibilidad solo se acepta si viene explícita; si no, la decide la
        // regla por tipo y origen, que es la que protege los costes internos.
        visibilidad: req.body?.visibilidad,
        url: req.body?.url ?? null,
        fileName: req.body?.fileName ?? null,
        mimeType: req.body?.mimeType ?? null,
        documentNumber: req.body?.documentNumber ?? null,
        documentDate: req.body?.documentDate ?? null,
        amount: req.body?.amount ?? null,
        currency: req.body?.currency ?? null,
        providerCompanyId: req.body?.providerCompanyId ?? null,
        dispatchId: req.body?.dispatchId ?? null,
        notes: req.body?.notes ?? null,
        uploadedBy: req.authCtx?.nombre ?? req.connectUser?.name ?? null,
      });
      res.status(201).json(doc);
    } catch (e) { fallo(res, e); }
  });

  router.patch("/documentos/:uuid/visibilidad", async (req: any, res) => {
    try {
      res.json(await cambiarVisibilidad(
        req.params.uuid, req.body?.visibilidad,
        req.authCtx?.nombre ?? req.connectUser?.name ?? null,
      ));
    } catch (e) { fallo(res, e); }
  });

  /** Qué falta y en qué estado administrativo está el expediente. */
  router.get("/asistencias/:id/situacion", async (req, res) => {
    try {
      const s = await situacionAdministrativa(system, req.params.id);
      res.json({
        ...s,
        etiqueta: s.estado ? ETIQUETA_ADMIN[s.estado] : null,
        faltanEtiquetas: s.faltan.map((t) => ETIQUETA_TIPO[t]),
      });
    } catch (e) { fallo(res, e); }
  });

  router.post("/asistencias/:id/validar-coste", async (req: any, res) => {
    try {
      const estado = await validarCoste(
        system, req.params.id,
        req.authCtx?.nombre ?? req.connectUser?.name ?? null,
      );
      res.json({ estado, etiqueta: estado ? ETIQUETA_ADMIN[estado] : null });
    } catch (e) { fallo(res, e); }
  });

  router.post("/asistencias/:id/facturada", async (req: any, res) => {
    try {
      const estado = await marcarFacturada(
        system, req.params.id,
        req.authCtx?.nombre ?? req.connectUser?.name ?? null,
        req.body?.referencia ?? null,
      );
      res.json({ estado, etiqueta: estado ? ETIQUETA_ADMIN[estado] : null });
    } catch (e) { fallo(res, e); }
  });

  return router;
}
