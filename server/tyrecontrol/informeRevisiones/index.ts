/**
 * El informe de revisiones en PDF.
 *
 * Una ruta que devuelve el PDF directamente. No se guarda en Storage ni se
 * cachea: se arma con lo que hay en la base en ese momento, que es lo que
 * quien lo pide espera ver. Si algún día hace falta un enlace para la APK,
 * se copia el patrón de `parte/index.ts`, que ya resuelve ese problema.
 *
 * ── Quién puede pedirlo ─────────────────────────────────────────────────────
 *
 * Lo resuelve `informes/alcance.ts`, y se comprueba AQUÍ. La primera
 * versión decía que la RLS de las revisiones bastaba; no es verdad: el
 * servidor habla con Supabase con `service_role`, que no pasa por RLS, así
 * que un usuario de rol `cliente` que tecleara el UUID de otro cliente
 * recibía su informe.
 *
 * El ÁMBITO también: solo un administrador puede pedir el informe interno,
 * que lleva nombres de técnico y códigos internos. Un cliente que pidiera
 * `ambito=interno` recibe el del cliente, sin error: lo que no debe ver no
 * se le enseña, y tampoco se le confirma que exista. Esto salía del
 * contexto de sesión equivocado —un `req.tcAdmin` que este middleware no
 * pone—, con lo que el ámbito interno no lo alcanzaba NADIE, ni el
 * super-admin. Ahora se lee de `req.authCtx`, que es quien lo sabe.
 */

import type { Express, RequestHandler } from "express";

import { armarInforme, type Ambito, type Formato } from "./armar.ts";
import { leerMediciones, leerRevisiones, nombreEmpresa } from "./datos.ts";
import { generarInformeRevisiones } from "./pdf.ts";
import { empresaDelInforme, esAdministrador } from "../informes/alcance.ts";

const FORMATOS: Formato[] = ["resumen", "detalle", "vehiculo"];

/** Una fecha ISO válida, o null. No se acepta «hoy» ni nada que haya que interpretar. */
function fechaValida(v: unknown): string | null {
  const s = String(v ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : s;
}

/** Por defecto, el año en curso: es lo que se pide nueve de cada diez veces. */
export function periodoPorDefecto(hoy = new Date()): { desde: string; hasta: string } {
  const a = hoy.getUTCFullYear();
  return { desde: `${a}-01-01`, hasta: hoy.toISOString().slice(0, 10) };
}

export function mountInformeRevisiones(app: Express, ...guards: RequestHandler[]): void {
  app.get("/api/tyrecontrol/informes/revisiones/pdf", ...guards, async (req, res) => {
    try {
      const alcance = await empresaDelInforme(req, req.query.empresa);
      if (!alcance.empresa) return res.status(alcance.estado).json({ error: alcance.error });
      const empresa = alcance.empresa;

      const pd = periodoPorDefecto();
      const desde = fechaValida(req.query.desde) ?? pd.desde;
      const hasta = fechaValida(req.query.hasta) ?? pd.hasta;
      if (desde > hasta) return res.status(400).json({ error: "«Desde» es posterior a «hasta»" });

      const formato = FORMATOS.includes(req.query.formato as Formato)
        ? (req.query.formato as Formato) : "resumen";

      // Solo un administrador saca el informe interno. A los demás se les da
      // el del cliente en silencio: lo que no deben ver, no se les enseña.
      const pedido = String(req.query.ambito ?? "cliente");
      const ambito: Ambito = pedido === "interno" && esAdministrador(req) ? "interno" : "cliente";

      // Por defecto NO se filtra: dejar de imprimir revisiones que existen
      // es decisión de quien pide el informe.
      const soloConMediciones = String(req.query.soloConMediciones ?? "") === "1";

      const { filas: revisiones, truncado } = await leerRevisiones({ empresa, desde, hasta });
      const mediciones = await leerMediciones({ empresa, desde, hasta }, revisiones.map((r) => r.id));
      const documento = armarInforme(revisiones, mediciones, {
        empresa, desde, hasta, formato, ambito, soloConMediciones, truncado,
      });
      const nombre = await nombreEmpresa(empresa);

      const pdf = await generarInformeRevisiones(documento, nombre || "Empresa");
      const fichero = `revisiones-${(nombre || "empresa").toLowerCase().replace(/[^a-z0-9]+/g, "-")}`
        + `-${desde}_${hasta}-${formato}${ambito === "interno" ? "-interno" : ""}`
        + `${soloConMediciones ? "-con-datos" : ""}.pdf`;

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `inline; filename="${fichero}"`);
      res.end(Buffer.from(pdf));
    } catch (e: any) {
      console.error("[informe-revisiones] error:", e?.message ?? e);
      res.status(500).json({ error: e?.message || "No se ha podido generar el informe" });
    }
  });
}
