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
 * `security invoker` en la función y la RLS de `tc_vehiculos` hacen el
 * aislamiento, así que un cliente que pida «todas las empresas» recibe solo
 * la suya. No hace falta —ni serviría— comprobarlo otra vez aquí.
 */

import type { Express, RequestHandler } from "express";
import * as XLSX from "xlsx";

import { supabase } from "../../supabase.ts";
import { hojaFlota, hojaPorCliente, type FilaFlota } from "./armar.ts";

export function mountInformeFlota(app: Express, ...guards: RequestHandler[]): void {
  app.get("/api/tyrecontrol/informes/flota/excel", ...guards, async (req, res) => {
    try {
      const empresa = String(req.query.empresa ?? "").trim() || null;

      const { data, error } = await supabase.rpc("tc_informe_flota_detalle", { p_empresa: empresa });
      if (error) return res.status(400).json({ error: error.message });
      const filas = (data ?? []) as FilaFlota[];

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
