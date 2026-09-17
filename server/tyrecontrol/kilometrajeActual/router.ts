/**
 * El cuentakilómetros de un vehículo, ahora, para la APK del técnico.
 *
 * ── Por qué pasa por aquí y no lo pide Flutter ──────────────────────────────
 *
 * Porque la credencial de Movertis vive en el gestor de secretos del Hub y NO
 * puede salir de él. Una APK se descompila; una clave dentro de una APK es una
 * clave pública. La tablet pregunta «¿cuántos km lleva el 1234ABC?» y recibe un
 * número con su fecha: ni el token, ni la URL del proveedor, ni el
 * identificador de la cuenta viajan al móvil.
 *
 * ── Por qué es una consulta y no una sincronización ─────────────────────────
 *
 * El técnico abre el parte y necesita el dato AHORA, no el que dejó el barrido
 * nocturno. Pero tampoco puede costar una petición cada vez que alguien roza
 * la pantalla: el cupo del proveedor es limitado y lo comparte con el barrido
 * de presencia en bases. Por eso el cliente decide cuándo pedir —al abrir, al
 * pulsar Actualizar y antes de cerrar SI la lectura ya no vale— y esa decisión
 * la toma `tocaRefrescar`, que es código puro y con pruebas.
 *
 * ── Qué NO hace ─────────────────────────────────────────────────────────────
 *
 * No escribe nada. No toca los km del vehículo ni crea revisiones: eso lo hace
 * quien confirma el parte, con el dato ya en la mano y con el técnico delante.
 * Una consulta que escribiera dejaría el kilometraje del vehículo a merced de
 * quien abriera una pantalla y se arrepintiera.
 */

import { Router, json, type Request, type Response } from "express";

import { supabase } from "../../supabase.ts";
import { puedeVerEmpresa } from "../empresaAcceso.ts";
import { clasificarLectura, frescuraDeConfig, avisoDeSalto, type LecturaOdometro } from "./frescura.ts";

/*
 * El Hub se importa DENTRO de la función, igual que en `kilometrajeRevision.ts`:
 * arrastra `db.ts`, que LANZA al importarse si no hay `DATABASE_URL`, y
 * TyreControl habla por Supabase y no siempre la tiene.
 */
async function servicioDelHub() {
  return import("../../integration-hub/application/services/VehicleOdometerService.ts");
}

async function usuarioDe(req: Request): Promise<{ userId: string; esSuperadmin: boolean } | null> {
  const cabecera = String(req.headers.authorization ?? "");
  const token = cabecera.startsWith("Bearer ") ? cabecera.slice(7) : "";
  if (!token) return null;
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return null;
  const { data: perfil } = await supabase
    .from("tc_usuarios").select("es_superadmin, activo").eq("id", data.user.id).maybeSingle();
  if (!perfil || (perfil as any).activo === false) return null;
  return { userId: data.user.id, esSuperadmin: (perfil as any).es_superadmin === true };
}

/** La respuesta, en el vocabulario de la pantalla y sin nada del proveedor. */
function aRespuesta(l: LecturaOdometro, aviso: string | null) {
  return {
    estado: l.estado,
    km: l.km,
    capturadoAt: l.capturadoAt?.toISOString() ?? null,
    consultadoAt: l.consultadoAt.toISOString(),
    antiguedadMin: l.antiguedadMin,
    proveedor: l.proveedor,
    externo: l.externo,
    origenOdometro: l.origenOdometro ?? null,
    texto: l.texto,
    aviso,
  };
}

export function createKilometrajeActualRouter(): Router {
  const router = Router();
  router.use(json({ limit: "8kb" }));

  /**
   * El odómetro de un vehículo ahora mismo.
   *
   * Nunca lanza hacia el técnico por culpa del proveedor: si la telemática
   * falla, se contesta `error` con una frase en cristiano. Un parte que no se
   * pudiera abrir porque Movertis está caído sería un fallo peor que el que
   * evita — el kilometraje es un dato valioso, no un requisito para cambiar
   * una rueda.
   */
  router.get("/vehiculo/:id", async (req, res) => {
    const consultadoAt = new Date();
    try {
      const usuario = await usuarioDe(req);
      if (!usuario) return res.status(401).json({ error: "Sin sesión" });

      const vehiculoId = String(req.params.id ?? "").trim();
      const { data: v } = await supabase
        .from("tc_vehiculos").select("id, empresa_id, km_actual").eq("id", vehiculoId).maybeSingle();
      if (!v) return res.status(404).json({ error: "Vehículo no encontrado" });
      const empresaId = String((v as any).empresa_id ?? "");
      const puede = await puedeVerEmpresa(
        { userId: usuario.userId, esSuperadmin: usuario.esSuperadmin }, empresaId);
      // Mismo cuerpo que «no existe»: no se confirma que el vehículo esté ahí.
      if (!puede) return res.status(404).json({ error: "Vehículo no encontrado" });

      let resultado: any;
      try {
        const { kilometrajeEnOperacion } = await servicioDelHub();
        resultado = await kilometrajeEnOperacion(
          { tenantId: empresaId, correlationId: `km-actual:${vehiculoId}:${consultadoAt.getTime()}` },
          vehiculoId,
          consultadoAt,
        );
      } catch (e) {
        // El motivo va al registro, no a la tablet, y sin token ni matrícula.
        console.error("[km-actual] telemática no disponible:", (e as any)?.message ?? e);
        resultado = { estado: "no_disponible" };
      }

      const frescuraMin = await frescuraDeEmpresa(empresaId);
      const lectura = clasificarLectura({
        ahora: consultadoAt,
        frescuraMin,
        resultado: resultado.estado === "encontrado"
          ? {
              estado: "encontrado",
              km: resultado.kilometraje.odometerKm,
              capturadoAt: resultado.kilometraje.capturedAt,
              proveedor: resultado.kilometraje.provider,
              externo: resultado.kilometraje.providerVehicleId,
              origenOdometro: resultado.kilometraje.odometerSource,
            }
          : { estado: resultado.estado },
      });

      const kmAnterior = Number((v as any).km_actual);
      const aviso = lectura.km === null
        ? null
        : avisoDeSalto({ km: lectura.km, kmAnterior: Number.isFinite(kmAnterior) ? kmAnterior : null });

      res.json({ vehiculoId, kmAnterior: Number.isFinite(kmAnterior) ? kmAnterior : null,
                 frescuraMin, ...aRespuesta(lectura, aviso) });
    } catch (e) {
      console.error("[km-actual] error:", (e as any)?.message ?? e);
      // Ni siquiera un fallo nuestro puede impedir abrir un parte: se contesta
      // el estado de error y el técnico teclea los km.
      res.json({ estado: "error", km: null, capturadoAt: null,
                 consultadoAt: consultadoAt.toISOString(), antiguedadMin: null,
                 proveedor: null, externo: null, origenOdometro: null, aviso: null,
                 texto: "No se ha podido consultar la telemática." });
    }
  });

  return router;
}

/** El umbral de frescura de la empresa, de su cuenta de telemática. */
async function frescuraDeEmpresa(empresaId: string): Promise<number> {
  try {
    const { listConnectorConfigs } = await import("../../integration-hub/infrastructure/repositories.ts");
    const configs = await listConnectorConfigs(empresaId);
    const activa = configs.find((c: any) => c.enabled);
    return frescuraDeConfig(activa?.config);
  } catch {
    return frescuraDeConfig(undefined);
  }
}
