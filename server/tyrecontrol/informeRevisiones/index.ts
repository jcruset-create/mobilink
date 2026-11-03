/**
 * El informe de revisiones en PDF.
 *
 * Una ruta que devuelve el PDF directamente. No se guarda en Storage ni se
 * cachea: se arma con lo que hay en la base en ese momento, que es lo que
 * quien lo pide espera ver. Si algún día hace falta un enlace para la APK,
 * se copia el patrón de `parte/index.ts`, que ya resuelve ese problema.
 *
 * Quién puede pedirlo: cualquiera que pueda ver la empresa. La RLS de las
 * revisiones y la función de mediciones (`security invoker`) hacen el resto,
 * así que un cliente solo puede sacar el suyo aunque teclee otro id.
 *
 * El ÁMBITO sí se comprueba aquí: solo un administrador puede pedir el
 * informe interno, que lleva nombres de técnico y códigos internos. Un
 * cliente que pidiera `ambito=interno` recibe el del cliente, sin error: lo
 * que no debe ver no se le enseña, y tampoco se le confirma que exista.
 */

import type { Express, RequestHandler } from "express";

import { armarInforme, type Ambito, type Formato } from "./armar.ts";
import { leerMediciones, leerRevisiones, nombreEmpresa } from "./datos.ts";
import { generarInformeRevisiones } from "./pdf.ts";

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
      const empresa = String(req.query.empresa ?? "").trim();
      if (!empresa) return res.status(400).json({ error: "Falta la empresa" });

      const pd = periodoPorDefecto();
      const desde = fechaValida(req.query.desde) ?? pd.desde;
      const hasta = fechaValida(req.query.hasta) ?? pd.hasta;
      if (desde > hasta) return res.status(400).json({ error: "«Desde» es posterior a «hasta»" });

      const formato = FORMATOS.includes(req.query.formato as Formato)
        ? (req.query.formato as Formato) : "resumen";

      // Solo un administrador saca el informe interno. A los demás se les da
      // el del cliente en silencio: lo que no deben ver, no se les enseña.
      const esAdmin = Boolean((req as any).tcAdmin)
        || ["administrador"].includes(String((req as any).usuario?.rol ?? ""));
      const pedido = String(req.query.ambito ?? "cliente");
      const ambito: Ambito = pedido === "interno" && esAdmin ? "interno" : "cliente";

      const revisiones = await leerRevisiones({ empresa, desde, hasta });
      const mediciones = await leerMediciones({ empresa, desde, hasta }, revisiones.map((r) => r.id));
      const documento = armarInforme(revisiones, mediciones, { empresa, desde, hasta, formato, ambito });
      const nombre = await nombreEmpresa(empresa);

      const pdf = await generarInformeRevisiones(documento, nombre || "Empresa");
      const fichero = `revisiones-${(nombre || "empresa").toLowerCase().replace(/[^a-z0-9]+/g, "-")}`
        + `-${desde}_${hasta}-${formato}${ambito === "interno" ? "-interno" : ""}.pdf`;

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `inline; filename="${fichero}"`);
      res.end(Buffer.from(pdf));
    } catch (e: any) {
      console.error("[informe-revisiones] error:", e?.message ?? e);
      res.status(500).json({ error: e?.message || "No se ha podido generar el informe" });
    }
  });
}
