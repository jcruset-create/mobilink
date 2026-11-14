/**
 * API de la presencia en bases.
 *
 * Dos cosas, y las dos para el panel: barrer ahora y leer lo último barrido.
 *
 * La empresa se deriva de la sesión de TyreControl, igual que en la
 * conciliación y por el mismo motivo: aceptar la empresa que venga en el cuerpo
 * dejaría a un administrador de un cliente barriendo —y leyendo— la flota de
 * otro. Se reutiliza el guarda que ya existe en vez de escribir otro.
 *
 * Leer exige sesión pero no ser administrador: quien organiza el taller mira
 * esta pantalla para decidir a qué autobús le toca revisión, y no tiene por qué
 * ser administrador de nada. Barrer sí, porque habla con el proveedor.
 */

import { Router, json, type Request, type Response } from "express";

import { supabase } from "../../supabase.ts";
import { empresaDe, resolverSolicitante, type Solicitante } from "../conciliacion/router.ts";
import { barrerBases } from "./barrido.ts";
import { empresaParaLeer } from "./empresaPedida.ts";
import { refrescarAntiguedad } from "./frescura.ts";
import { filtrarPresencia, type PresenciaFiltrada } from "./seguimiento.ts";

type Peticion = Request & { solicitante: Solicitante };

function fallo(res: Response, e: unknown) {
  console.error("[presencia-bases] error:", (e as any)?.message ?? e);
  return res.status(500).json({ error: "Error en la presencia en bases" });
}

/** Columnas que necesita la pantalla, con matrícula y nombre de base. */
const CAMPOS =
  "vehiculo_id, estado, delegacion_id, es_su_base, distancia_m, antiguedad_min, " +
  "lat, lng, velocidad_kmh, posicion_at, entrada_base_at, proveedor, cuenta, " +
  "externo, motivo, calculado_at, " +
  // La matrícula viaja con la fila: la pantalla la necesita para cada vehículo,
  // y sin esto habría que leer la flota entera aparte solo para poner un
  // nombre a cada línea.
  // La matrícula viaja con la fila; `activo` y `en_seguimiento` deciden si la
  // fila cuenta. Van aquí y no en una consulta aparte porque se necesitan para
  // cada una de las 717 filas.
  "vehiculo:tc_vehiculos(id, matricula, numero_unidad, activo, en_seguimiento), " +
  "delegacion:tc_delegaciones(id, nombre)";

/**
 * La presencia de una empresa, en páginas y ya filtrada.
 *
 * Supabase devuelve como mucho mil filas por consulta, y esta flota ya va por
 * 751. Sin paginar, el día que pase de mil la pantalla enseñaría menos
 * vehículos de los que hay sin un solo error a la vista, que es la peor forma
 * de equivocarse.
 *
 * Devuelve SOLO los que cuentan: ni dados de baja ni fuera del mantenimiento
 * integral. El porqué está en `seguimiento.ts`; el resumen es que la tabla se
 * escribe con UPSERT y nunca borra, así que saltárselos en el barrido no basta.
 * Se filtra aquí, en la lectura, porque es lo que comparten las TRES pantallas
 * que lo enseñan: el panel, la tablet y la hoja del patio en PDF. Filtrar en
 * cada una sería el principio de que tres sitios dijeran tres números.
 */
export async function leerPresencia(empresaId: string): Promise<any[]> {
  return (await leerPresenciaConDescartes(empresaId)).filas;
}

/** Lo mismo, diciendo además a cuántos ha dejado fuera y por qué. */
export async function leerPresenciaConDescartes(
  empresaId: string,
): Promise<PresenciaFiltrada<any>> {
  const out: any[] = [];
  const TAMANO = 1000;
  for (let desde = 0; ; desde += TAMANO) {
    const { data, error } = await supabase
      .from("tc_vehiculo_presencia_base")
      .select(CAMPOS)
      .eq("empresa_id", empresaId)
      .range(desde, desde + TAMANO - 1);
    if (error) throw new Error(error.message);
    const pagina = data ?? [];
    out.push(...pagina);
    if (pagina.length < TAMANO) break;
  }
  /*
   * `antiguedad_min` se recalcula aquí y no se lee de la fila.
   *
   * Es lo que permite que el barrido deje de reescribir las filas que no
   * cambian: ese número crece solo aunque no llegue ninguna posición nueva, y
   * era la única razón por la que un vehículo parado necesitaba que se le
   * reescribiera la fila cada diez minutos. Además el dato sale mejor: lo
   * guardado era «cuánto hacía en el último barrido» y esto es «cuánto hace
   * ahora mismo».
   *
   * Va antes de filtrar para que las TRES pantallas que leen por aquí —el
   * panel, la tablet y la hoja del patio en PDF— reciban exactamente lo mismo.
   */
  return filtrarPresencia(refrescarAntiguedad(out));
}

/**
 * Cuándo corrió el último barrido de esta empresa.
 *
 * Va en su propio try y devuelve `null` si algo falla: es el dato que explica
 * la pantalla, no la pantalla. Que no se pueda leer la hora no puede dejar sin
 * ver los 717 vehículos.
 */
async function leerHoraDelBarrido(empresaId: string): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from("tc_presencia_barrido")
      .select("calculado_at")
      .eq("empresa_id", empresaId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data?.calculado_at ? String(data.calculado_at) : null;
  } catch (e) {
    console.warn("[presencia-bases] no se pudo leer la hora del barrido:", (e as any)?.message ?? e);
    return null;
  }
}

/**
 * Las cuentas de telemática que tiene esta empresa dada de alta en el Hub.
 *
 * La pantalla salía con cuatro ceros y un «todavía no se ha barrido ninguna
 * vez» sin decir por qué, y el motivo más frecuente no se ve desde ahí: la
 * empresa no tiene ninguna cuenta habilitada, así que el barrido no tiene a
 * quién preguntar. Con esto la pantalla puede decirlo en vez de hacer que uno
 * lo adivine.
 *
 * Se leen las CONFIGURACIONES, no los conectores: es una consulta a la base del
 * Hub y no resuelve credenciales ni llama a nadie. Y va en su propio try: si la
 * base del Hub no contesta, la pantalla enseña lo que ya sabía en vez de caerse
 * por un dato que solo sirve para explicar.
 */
async function cuentasDeTelematica(
  empresaId: string,
): Promise<Array<{ proveedor: string; cuenta: string; nombre: string | null; activa: boolean }>> {
  try {
    const { listConnectorConfigs } = await import(
      "../../integration-hub/infrastructure/repositories.ts"
    );
    const { knownTelematicsConnectorKeys } = await import(
      "../../integration-hub/connectors/ConnectorRegistry.ts"
    );
    const claves = new Set(knownTelematicsConnectorKeys());
    const configs = await listConnectorConfigs(empresaId);
    return (configs ?? [])
      .filter((c: any) => claves.has(String(c.connector_key)))
      .map((c: any) => ({
        proveedor: String(c.connector_key),
        cuenta: String(c.account_key ?? "default"),
        nombre: c.name ?? null,
        activa: c.enabled === true,
      }));
  } catch (e) {
    console.warn("[presencia-bases] no se pudieron leer las cuentas:", (e as any)?.message ?? e);
    return [];
  }
}

export function createPresenciaRouter(): Router {
  const router = Router();
  router.use(json({ limit: "64kb" }));

  // Sesión de TyreControl para todo. El rol se comprueba por endpoint.
  router.use(async (req, res, next) => {
    try {
      const solicitante = await resolverSolicitante(req, { exigirAdmin: false });
      if (!solicitante) return res.status(401).json({ error: "Sesión no válida" });
      (req as Peticion).solicitante = solicitante;
      next();
    } catch (e) {
      fallo(res, e);
    }
  });

  /**
   * Lo último que se supo de cada vehículo.
   *
   * Se lee de la tabla, no del proveedor: la pantalla se abre muchas veces y el
   * barrido cuesta una llamada a la telemática. Lo que se devuelve dice CUÁNDO
   * se calculó, para que nadie confunda «lo último sabido» con «ahora mismo».
   */
  router.get("/", async (req, res) => {
    try {
      const { solicitante } = req as Peticion;
      /*
       * Aquí NO vale `empresaDe()`, y es el motivo de `empresaPedida.ts`: a
       * quien no es super-admin le da la empresa de su perfil y le ignora la
       * que pida. El técnico de la tablet trabaja para varios clientes y su
       * perfil apunta a la empresa de servicio, que no tiene flota: con
       * `empresaDe()` la pantalla le saldría vacía, sin un solo error.
       */
      const pedida = await empresaParaLeer(solicitante, req.query?.empresaId);
      if ("prohibida" in pedida) {
        return res.status(403).json({ error: "Sin acceso a esa empresa" });
      }
      if ("sinEmpresa" in pedida) return res.status(400).json({ error: "Sin empresa" });
      const { empresaId } = pedida;

      const [presencia, { data: bases }, cuentas, barrido] = await Promise.all([
        leerPresenciaConDescartes(empresaId),
        supabase
          .from("tc_delegaciones")
          .select("id, nombre, base_lat, base_lng, base_radio_m")
          .eq("empresa_id", empresaId)
          .not("base_lat", "is", null),
        cuentasDeTelematica(empresaId),
        leerHoraDelBarrido(empresaId),
      ]);

      const { filas, sinSeguimiento } = presencia;

      const porEstado: Record<string, number> = {};
      for (const f of filas) {
        const e = String((f as any).estado);
        porEstado[e] = (porEstado[e] ?? 0) + 1;
      }

      res.json({
        ok: true,
        vehiculos: filas,
        // Para que la pantalla pueda explicar un barrido vacío en vez de
        // enseñar ceros sin motivo.
        cuentas,
        /*
         * Cuántos se han dejado fuera por estar fuera del mantenimiento
         * integral. No es un detalle: esos vehículos siguen saliendo en la
         * lista de vehículos y en la telemática, así que sin decirlo aquí el
         * «N dentro» de una base no cuadra con lo que se ve en otra pantalla y
         * nadie sabe por qué. Los dados de baja no se cuentan: que un vehículo
         * de baja no salga no sorprende a nadie.
         */
        sinSeguimiento,
        bases: (bases ?? []).map((b: any) => ({
          id: b.id,
          nombre: b.nombre,
          lat: Number(b.base_lat),
          lng: Number(b.base_lng),
          radioM: b.base_radio_m == null ? null : Number(b.base_radio_m),
        })),
        porEstado,
        /*
         * Cuándo pasó el barrido.
         *
         * Sale de `tc_presencia_barrido`, que lo guarda una vez por vuelta.
         * Antes salía de `max(calculado_at)` de las filas, y eso dependía de
         * que el barrido las reescribiera TODAS cada vez; desde que se salta
         * las que no cambian, de madrugada podrían pasar horas sin tocar
         * ninguna y esto diría que el barrido lleva parado toda la noche.
         *
         * El `max` de las filas se queda de respaldo, para las empresas que
         * todavía no hayan tenido un barrido desde el despliegue.
         */
        calculadoAt:
          barrido ??
          filas.reduce<string | null>((max, f: any) => {
            const c = f.calculado_at ? String(f.calculado_at) : null;
            return c && (!max || c > max) ? c : max;
          }, null) ??
          null,
      });
    } catch (e) {
      fallo(res, e);
    }
  });

  /** Barre ahora. Habla con el proveedor, así que es de administradores. */
  router.post("/barrer", async (req, res) => {
    try {
      const { solicitante } = req as Peticion;
      if (!solicitante.esAdmin) {
        return res.status(403).json({ error: "Hace falta ser administrador" });
      }
      const empresaId = empresaDe(solicitante, req.body?.empresaId);
      if (!empresaId) return res.status(400).json({ error: "Sin empresa" });

      const r = await barrerBases(empresaId, {
        connectorKey: req.body?.connectorKey ? String(req.body.connectorKey) : undefined,
        accountKey: req.body?.accountKey ? String(req.body.accountKey) : undefined,
        // `guardar: false` permite previsualizar sin dejar rastro, igual que en
        // la conciliación. Por defecto se guarda, que es el uso normal.
        guardar: req.body?.guardar !== false,
      });
      res.json(r);
    } catch (e) {
      fallo(res, e);
    }
  });

  return router;
}
