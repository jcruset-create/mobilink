/**
 * La hoja del patio en PDF.
 *
 * Los vehículos que están DENTRO de una base ahora mismo y les toca
 * revisión, agrupados por base y ordenados por lo que más corre. Se puede
 * acotar a una base con `?base=`, que es el uso normal: el jefe de taller de
 * Tarragona no quiere las fichas de Reus.
 *
 * Se arma al vuelo con lo que hay en la base en ese momento. No se guarda ni
 * se cachea a propósito: un informe de hace una hora dice que un autobús
 * está en el patio cuando ya va por la autopista, y el papel se usa para ir
 * a buscarlo. Por eso la cabecera lleva la hora y el documento lo dice.
 *
 * Quién puede pedirlo: lo resuelve `empresaDelInforme`. Aquí NO vale apoyarse
 * en la RLS, porque el servidor va con `service_role` y no pasa por ella.
 */

import type { Express, RequestHandler } from "express";

import { armarPendientes, type PresenciaFila } from "./armar.ts";
import { leerFichas, leerRevisionEstado, nombreEmpresa } from "./datos.ts";
import { generarPendientesPdf } from "./pdf.ts";
import { empresaDelInforme } from "../informes/alcance.ts";
import { leerPresencia } from "../presencia/router.ts";

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export function mountInformePendientes(app: Express, ...guards: RequestHandler[]): void {
  app.get("/api/tyrecontrol/informes/pendientes-en-base/pdf", ...guards, async (req, res) => {
    try {
      const alcance = await empresaDelInforme(req, req.query.empresa);
      if (!alcance.empresa) return res.status(alcance.estado).json({ error: alcance.error });
      const empresa = alcance.empresa;

      const baseId = String(req.query.base ?? "").trim() || null;

      // Las tres lecturas son independientes: en paralelo, que esto se pide
      // de pie delante de la pantalla.
      const [presencia, revisiones, fichas, nombre] = await Promise.all([
        leerPresencia(empresa) as Promise<PresenciaFila[]>,
        leerRevisionEstado(),
        leerFichas(empresa),
        nombreEmpresa(empresa),
      ]);

      const documento = armarPendientes(
        presencia, revisiones, fichas, nombre || "Empresa", { baseId });

      const pdf = await generarPendientesPdf(documento);
      const fichero = `pendientes-en-base-${slug(nombre || "empresa")}`
        + `${documento.baseFiltrada ? `-${slug(documento.baseFiltrada)}` : ""}`
        + `-${documento.generado.slice(0, 10)}.pdf`;

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `inline; filename="${fichero}"`);
      res.end(Buffer.from(pdf));
    } catch (e: any) {
      console.error("[informe-pendientes] error:", e?.message ?? e);
      res.status(500).json({ error: e?.message || "No se ha podido generar la hoja" });
    }
  });
}
