/**
 * El endpoint de la búsqueda de catálogo con IA.
 *
 * Solo busca y clasifica: NO crea nada. Crear referencias se sigue haciendo
 * por donde se hacía —`crearReferenciaNeumatico` desde el panel, con la sesión
 * de la persona y la RLS del catálogo—, porque esa función ya resuelve marca,
 * modelo, medida y referencia, y ya es idempotente. Montar aquí una segunda
 * vía de alta habría sido la forma más rápida de que las dos acabaran
 * guardando cosas distintas.
 *
 * Permiso: superadministrador, el mismo que exige la pantalla del catálogo
 * para editar. Buscar no escribe, pero gasta IA y sirve para proponer altas;
 * dejarlo abierto a todo el mundo sería una puerta de atrás al catálogo.
 */

import { Router, json, type Request, type Response } from "express";

import { supabase } from "../../supabase.ts";
import { resolverSolicitante, type Solicitante } from "../conciliacion/router.ts";
import {
  clasificarTodos, consultaDe, interpretarConsulta,
  type Candidato, type ReferenciaExistente,
} from "../../../src/modules/tyrecontrol/services/catalogoIA.ts";
import { buscarModelos } from "./busqueda.ts";

type Peticion = Request & { solicitante: Solicitante };

function fallo(res: Response, e: unknown) {
  console.error("[catalogo-ia] error:", (e as any)?.message ?? e);
  res.status(500).json({ error: "No se ha podido completar la búsqueda" });
}

/**
 * Las referencias del catálogo de esa marca, para no proponer duplicados.
 *
 * Se filtra por marca en la base y no en memoria: el catálogo entero son
 * miles de filas y de lo único que hay que protegerse es de duplicar DENTRO
 * de la marca que se está buscando.
 */
async function referenciasDe(marca: string): Promise<ReferenciaExistente[]> {
  const { data, error } = await supabase
    .from("tc_referencias_neumatico")
    .select("id, referencia_completa, activo, modelo:tc_cat_modelos_neumatico(nombre, marca:tc_cat_marcas_neumatico(nombre)), tyre_size:tyre_sizes(medida)")
    .eq("activo", true)
    .limit(5000);
  if (error) throw new Error(error.message);

  const objetivo = marca.trim().toLowerCase();
  const out: ReferenciaExistente[] = [];
  for (const r of (data ?? []) as any[]) {
    const nombreMarca = String(r.modelo?.marca?.nombre ?? "");
    // Comparación holgada a propósito: «Ceat» y «CEAT S.A.» son la misma casa,
    // y lo que se busca aquí es con qué comparar, no quién es quién.
    const n = nombreMarca.trim().toLowerCase();
    if (!n || (!n.includes(objetivo) && !objetivo.includes(n))) continue;
    out.push({
      id: String(r.id),
      marca: nombreMarca,
      modelo: String(r.modelo?.nombre ?? ""),
      medida: String(r.tyre_size?.medida ?? ""),
      referenciaCompleta: r.referencia_completa ?? null,
    });
  }
  return out;
}

export function createCatalogoIARouter(): Router {
  const router = Router();
  router.use(json({ limit: "16kb" }));

  router.use(async (req, res, next) => {
    try {
      const solicitante = await resolverSolicitante(req, { exigirAdmin: true });
      if (!solicitante) return res.status(401).json({ error: "Sesión no válida" });
      if (!solicitante.esSuperadmin) {
        return res.status(403).json({ error: "Solo un superadministrador puede proponer altas de catálogo" });
      }
      (req as Peticion).solicitante = solicitante;
      next();
    } catch (e) {
      fallo(res, e);
    }
  });

  /**
   * Busca modelos y los devuelve ya clasificados contra el catálogo.
   *
   * Devuelve 200 aunque no encuentre nada: «no hay resultados» es una
   * respuesta correcta, no un error, y la pantalla tiene que poder enseñar el
   * motivo en vez de un mensaje rojo genérico.
   */
  router.post("/buscar", async (req, res) => {
    try {
      const cuerpo = req.body as any;
      const marca = String(cuerpo?.marca ?? "").trim();
      const medida = String(cuerpo?.medida ?? "").trim();
      const texto = String(cuerpo?.consulta ?? "").trim();

      if (marca.length > 80 || medida.length > 40 || texto.length > 300) {
        return res.status(400).json({ error: "La consulta es demasiado larga" });
      }

      // Dos caminos. Lo normal es que la pantalla mande marca y medida, que es
      // lo que se elige en los desplegables: elegido de una lista no hay nada
      // que interpretar, así que no hay nada que interpretar mal. La frase
      // suelta sigue valiendo, para quien la escriba o la llame desde fuera.
      const consulta = marca || medida
        ? consultaDe(marca, medida)
        : interpretarConsulta(texto);

      if (!consulta.fabricante && !consulta.medida) {
        return res.status(400).json({ error: "Falta la marca y la medida" });
      }
      const busqueda = await buscarModelos(consulta);

      // Sin marca entendida no hay con qué comparar: se devuelve la
      // interpretación para que la pantalla diga qué ha entendido y qué no.
      const existentes = consulta.fabricante ? await referenciasDe(consulta.fabricante) : [];
      const candidatos: Candidato[] = clasificarTodos(busqueda.candidatos, consulta, existentes);

      res.json({
        consulta: { texto: consulta.texto, fabricante: consulta.fabricante, medida: consulta.medida },
        candidatos,
        citas: busqueda.citas,
        aviso: busqueda.aviso,
        enCatalogo: existentes.length,
      });
    } catch (e) {
      fallo(res, e);
    }
  });

  return router;
}
