/**
 * El estado de la flota en Excel.
 *
 * Un libro con dos hojas: «Flota», una fila por vehículo, y «Por cliente»,
 * el recuento. Se genera al vuelo y se devuelve; no se guarda ni se cachea.
 *
 * La clasificación de cada vehículo la hace la base
 * (`tc_informe_flota_detalle`), con la misma cascada que alimenta la
 * pantalla de Estado de flota. Aquí no se recalcula: si se hiciera, el Excel
 * y el panel acabarían diciendo cosas distintas.
 *
 * ── Quién ve qué ────────────────────────────────────────────────────────────
 *
 * Se comprueba AQUÍ. La primera versión de este fichero decía que la RLS y
 * el `security invoker` de la función bastaban; no es verdad: el servidor
 * habla con Supabase usando `service_role`, que no pasa por RLS, así que un
 * usuario de rol `cliente` que tecleara el UUID de otro cliente recibía su
 * libro entero. El criterio está en `informes/alcance.ts`, uno para los tres
 * informes.
 *
 * Sin `?empresa=`, el super-admin saca el libro de TODAS —que es para lo que
 * está la hoja «Por cliente»—, y cualquier otro el de la suya.
 */

import type { Express, RequestHandler } from "express";
import * as XLSX from "xlsx";

import { supabase } from "../../supabase.ts";
import { hojaFlota, hojaPorCliente, type FilaFlota } from "./armar.ts";
import { empresaDelInforme } from "../informes/alcance.ts";
import { paginar } from "../informes/paginar.ts";

/**
 * La flota, por páginas y con orden fijo.
 *
 * Sin paginar, PostgREST corta en su tope de filas y el Excel sale con
 * menos vehículos de los que hay sin dar un error. Esta flota ya va por 751.
 */
function leerFlota(empresa: string | null): Promise<FilaFlota[]> {
  return paginar<FilaFlota>((desde, hasta) =>
    supabase
      .rpc("tc_informe_flota_detalle", { p_empresa: empresa })
      .select("*")
      .order("cliente", { ascending: true })
      .order("matricula", { ascending: true })
      .range(desde, hasta));
}

export function mountInformeFlota(app: Express, ...guards: RequestHandler[]): void {
  app.get("/api/tyrecontrol/informes/flota/excel", ...guards, async (req, res) => {
    try {
      const pedida = String(req.query.empresa ?? "").trim();
      let empresa: string | null;
      if (!pedida) {
        if (req.authCtx?.esSuperadmin) {
          empresa = null;
        } else if (req.authCtx?.empresaId) {
          empresa = req.authCtx.empresaId;
        } else {
          return res.status(401).json({ error: "Sesión requerida" });
        }
      } else {
        const alcance = await empresaDelInforme(req, pedida);
        if (!alcance.empresa) return res.status(alcance.estado).json({ error: alcance.error });
        empresa = alcance.empresa;
      }

      const filas = await leerFlota(empresa);

      const libro = XLSX.utils.book_new();
      // La lista primero: es la hoja que se abre al hacer doble clic.
      XLSX.utils.book_append_sheet(libro, XLSX.utils.json_to_sheet(hojaFlota(filas)), "Flota");
      const porCliente = hojaPorCliente(filas);
      if (porCliente.length > 0) {
        XLSX.utils.book_append_sheet(libro, XLSX.utils.json_to_sheet(porCliente), "Por cliente");
      }

      const bytes = XLSX.write(libro, { type: "buffer", bookType: "xlsx" }) as Buffer;
      const hoy = new Date().toISOString().slice(0, 10);
      const quien = empresa && filas.length > 0
        ? `-${String(filas[0].cliente ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-")}` : "";
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="estado-flota${quien}-${hoy}.xlsx"`);
      res.end(bytes);
    } catch (e: any) {
      console.error("[informe-flota] error:", e?.message ?? e);
      res.status(500).json({ error: e?.message || "No se ha podido generar el Excel" });
    }
  });
}
