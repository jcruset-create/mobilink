/**
 * API de «Por dónde rueda» (/api/tyrecontrol/por-donde-rueda).
 *
 *   · GET  /vehiculo/:id          resumen de la ficha (quien pueda ver la empresa).
 *   · POST /vehiculo/:id/analizar un día a mano, con los tramos para el mapa
 *                                 (administradores; gasta 2 peticiones de Movertis).
 *   · GET  /flota                 informe por vehículo (quien pueda ver la empresa).
 *
 * La casilla de la ficha no pasa por aquí: el navegador llama a la función
 * `tc_analisis_vias_activar`, que comprueba el permiso en la base.
 */

import { Router, json, type Response } from "express";

import { supabase } from "../../supabase.ts";
import { puedeVerEmpresa } from "../empresaAcceso.ts";
import { resolverSolicitante } from "../conciliacion/router.ts";
import { ErrorRitmo } from "../../integration-hub/infrastructure/ritmo.ts";
import { reducirPuntos } from "../kilometrajeMensual/recorrido.ts";
import { analizarDia } from "./servicio.ts";
import { estadoSinDatos, resumenFlota, resumenVehiculo, type DiasDeVehiculo, type FilaGuardada } from "./resumen.ts";
import { HORA_FIN, HORA_INICIO, ultimaVuelta } from "./worker.ts";

const PAGINA = 1000;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

function fallo(res: Response, e: unknown) {
  console.error("[por-donde-rueda] error:", (e as Error)?.message ?? e);
  return res.status(500).json({ error: "Error en «Por dónde rueda»" });
}

/** Todas las filas, de mil en mil (la API no da más de mil de golpe). */
async function filasTipoVia(filtro: { vehiculoId?: string; empresaId?: string; desde: string; hasta: string }): Promise<FilaGuardada[]> {
  const out: FilaGuardada[] = [];
  for (let desde = 0; ; desde += PAGINA) {
    let q = supabase.from("tc_recorrido_tipo_via").select("vehiculo_id, fecha, tipo, ref, km, segundos")
      .gte("fecha", filtro.desde).lte("fecha", filtro.hasta);
    if (filtro.vehiculoId) q = q.eq("vehiculo_id", filtro.vehiculoId);
    if (filtro.empresaId) q = q.eq("empresa_id", filtro.empresaId);
    const { data, error } = await q.order("fecha").order("vehiculo_id").order("tipo").order("ref").range(desde, desde + PAGINA - 1);
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as FilaGuardada[]));
    if ((data ?? []).length < PAGINA) break;
  }
  return out;
}

const hoyMenos = (dias: number) => new Date(Date.now() - dias * 86_400_000).toISOString().slice(0, 10);

export function createPorDondeRuedaRouter(): Router {
  const router = Router();
  router.use(json({ limit: "16kb" }));

  router.get("/vehiculo/:id", async (req, res) => {
    try {
      const s = await resolverSolicitante(req, { exigirAdmin: false });
      if (!s) return res.status(401).json({ error: "Sin sesión" });
      const vehiculoId = String(req.params.id ?? "").trim();
      const { data: v } = await supabase.from("tc_vehiculos").select("id, empresa_id").eq("id", vehiculoId).maybeSingle();
      const empresaId = String((v as { empresa_id?: string } | null)?.empresa_id ?? "");
      if (!v || !(await puedeVerEmpresa({ userId: s.usuarioId, esSuperadmin: s.esSuperadmin }, empresaId))) {
        return res.status(404).json({ error: "Vehículo no encontrado" });
      }
      const { data: marca } = await supabase.from("tc_analisis_vias_vehiculo").select("activo").eq("vehiculo_id", vehiculoId).maybeSingle();
      const { data: dias } = await supabase.from("tc_recorrido_dia")
        .select("fecha, estado, puntos, km_puntos, km_resumen, km_sin_via, error")
        .eq("vehiculo_id", vehiculoId).order("fecha", { ascending: false }).limit(40);
      const filas = await filasTipoVia({ vehiculoId, desde: hoyMenos(400), hasta: hoyMenos(-1) });
      res.json({
        vehiculoId,
        activo: (marca as { activo?: boolean } | null)?.activo === true,
        puedeAdministrar: s.esAdmin && (s.esSuperadmin || s.empresaPropia === empresaId),
        ultimosDias: dias ?? [],
        ...resumenVehiculo(filas),
      });
    } catch (e) {
      fallo(res, e);
    }
  });

  router.post("/vehiculo/:id/analizar", async (req, res) => {
    try {
      const s = await resolverSolicitante(req);
      if (!s) return res.status(401).json({ error: "Solo un administrador puede analizar un día" });
      const vehiculoId = String(req.params.id ?? "").trim();
      const fecha = String(req.body?.fecha ?? "").trim();
      if (!FECHA.test(fecha)) return res.status(400).json({ error: "Falta la fecha (AAAA-MM-DD)" });
      const { data: v } = await supabase.from("tc_vehiculos").select("empresa_id").eq("id", vehiculoId).maybeSingle();
      const empresaId = String((v as { empresa_id?: string } | null)?.empresa_id ?? "");
      if (!v || (!s.esSuperadmin && empresaId !== s.empresaPropia)) return res.status(404).json({ error: "Vehículo no encontrado" });
      try {
        const r = await analizarDia(empresaId, vehiculoId, fecha, { esperaMs: 45_000, topeTeselas: 40 });
        res.json({
          ...r,
          resumen: r.resumen ? { kmPuntos: r.resumen.kmPuntos, kmSinVia: r.resumen.kmSinVia, filas: r.resumen.filas } : null,
          tramos: r.tramos.map((t) => ({ ...t, puntos: reducirPuntos(t.puntos, 400) })),
        });
      } catch (e) {
        if (e instanceof ErrorRitmo) return res.status(429).json({ error: "Límite de peticiones a Movertis: repite en unos minutos." });
        return res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
      }
    } catch (e) {
      fallo(res, e);
    }
  });

  router.get("/flota", async (req, res) => {
    try {
      const s = await resolverSolicitante(req, { exigirAdmin: false });
      if (!s) return res.status(401).json({ error: "Sin sesión" });
      const empresaId = s.esSuperadmin ? String(req.query.empresaId ?? s.empresaPropia) : s.empresaPropia;
      if (!(await puedeVerEmpresa({ userId: s.usuarioId, esSuperadmin: s.esSuperadmin }, empresaId))) {
        return res.status(404).json({ error: "Empresa no encontrada" });
      }
      const desde = FECHA.test(String(req.query.desde)) ? String(req.query.desde) : hoyMenos(30);
      const hasta = FECHA.test(String(req.query.hasta)) ? String(req.query.hasta) : hoyMenos(0);
      const filas = await filasTipoVia({ empresaId, desde, hasta });
      const { data: marcados } = await supabase.from("tc_analisis_vias_vehiculo")
        .select("vehiculo_id").eq("empresa_id", empresaId).eq("activo", true);
      const marcadosIds = ((marcados ?? []) as { vehiculo_id: string }[]).map((m) => String(m.vehiculo_id));
      const ids = [...new Set([...filas.map((f) => f.vehiculo_id), ...marcadosIds])];
      const nombres = new Map<string, { matricula: string | null; numero_unidad: string | null }>();
      for (let i = 0; i < ids.length; i += 150) {
        const { data } = await supabase.from("tc_vehiculos").select("id, matricula, numero_unidad").in("id", ids.slice(i, i + 150));
        for (const v of (data ?? []) as { id: string; matricula: string | null; numero_unidad: string | null }[]) {
          nombres.set(String(v.id), { matricula: v.matricula ?? null, numero_unidad: v.numero_unidad ?? null });
        }
      }
      const marcadosSet = new Set(marcadosIds);
      const porVehiculo = new Map(resumenFlota(filas).map((r) => [r.vehiculoId, r]));

      // Qué ha pasado con cada día analizado, para decir POR QUÉ no hay datos
      // en lugar de un «sin datos todavía» que lo mismo es esperar que un error.
      const dias = new Map<string, DiasDeVehiculo>();
      for (let i = 0; i < ids.length; i += 150) {
        const { data } = await supabase.from("tc_recorrido_dia")
          .select("vehiculo_id, fecha, estado, error").in("vehiculo_id", ids.slice(i, i + 150))
          .gte("fecha", desde).lte("fecha", hasta).order("fecha", { ascending: false }).limit(5000);
        for (const r of (data ?? []) as { vehiculo_id: string; estado: string; error: string | null }[]) {
          const d = dias.get(r.vehiculo_id) ?? { ok: 0, sinPuntos: 0, errores: 0, ultimoError: null };
          if (r.estado === "ok") d.ok++;
          else if (r.estado === "sin_puntos") d.sinPuntos++;
          else if (r.estado === "error") { d.errores++; d.ultimoError ??= r.error; }
          dias.set(r.vehiculo_id, d);
        }
      }
      const vuelta = ultimaVuelta();
      const { count: teselas } = await supabase.from("tc_vias_osm_teselas").select("tesela", { count: "exact", head: true });
      const { data: ultimaTesela } = await supabase.from("tc_vias_osm_teselas")
        .select("cargada_at").order("cargada_at", { ascending: false }).limit(1).maybeSingle();
      const ventana = { desde: HORA_INICIO, hasta: HORA_FIN };

      res.json({
        empresaId, desde, hasta,
        trabajo: {
          ultimaVuelta: vuelta, ventana,
          mapa: { teselas: teselas ?? 0, ultimaCarga: (ultimaTesela as any)?.cargada_at ?? null },
        },
        vehiculos: ids.map((id) => ({
          vehiculoId: id, ...nombres.get(id), activo: marcadosSet.has(id),
          ...(porVehiculo.get(id) ?? { dias: 0, km: 0, porTipo: null, pctUrbana: null }),
          estado: estadoSinDatos(dias.get(id) ?? { ok: 0, sinPuntos: 0, errores: 0, ultimoError: null }, vuelta, ventana),
        })),
      });
    } catch (e) {
      fallo(res, e);
    }
  });

  return router;
}
