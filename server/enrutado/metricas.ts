/**
 * Cómo se ha portado cada partner, por central.
 *
 * ── La regla que gobierna este fichero ──────────────────────────────────────
 *
 * **Ninguna consulta agrega sin agrupar por central.** El comportamiento de un
 * partner con la Plataforma A no es asunto de la B, aunque sea el mismo
 * partner: son dos relaciones comerciales distintas, con precios distintos y
 * volúmenes distintos, y mezclarlas filtraría el volumen de negocio de A a la
 * B por el camino más tonto: una media.
 *
 * Por eso `controlCenterId` está en el WHERE de todas y cada una, y no como
 * filtro opcional.
 *
 * ── Y lo que NO se calcula ──────────────────────────────────────────────────
 *
 * Aquí no hay ningún importe. Ni medio, ni total, ni margen. Las métricas
 * viajan al motor de enrutado y de ahí a una pantalla que puede ver un
 * operador, y un «coste medio del partner» es exactamente el dato que el
 * partner no quiere que su competencia lea. El precio entra en la decisión por
 * la tarifa pactada del acuerdo, que sí es de quien la mira.
 *
 * ── Misma escala que el score de talleres ───────────────────────────────────
 *
 * Ventana de 90 días y las mismas normalizaciones que `connect/score.ts`. Dos
 * escalas de calidad distintas en el mismo panel serían dos números que no se
 * pueden comparar y que se comparan igualmente.
 */

import db from "../db.ts";
import { MEDIDAS_VACIAS, type Medidas } from "./dominio.ts";

const VENTANA_MS = 90 * 24 * 3600_000;

export type MetricasPartner = {
  authorizationId: number;
  providerCompanyId: number;
  enviados: number;
  aceptados: number;
  rechazados: number;
  errores: number;
  completados: number;
  ratioAceptacion: number | null;
  tiempoAceptacionMin: number | null;
  incidenciasPor100: number | null;
  calidad: number | null;
};

/**
 * Métricas de todos los partners de UNA central.
 *
 * Se piden de una vez y no partner a partner: enrutar con veinte candidatos
 * lanzaría veinte consultas en el camino crítico de una asistencia urgente.
 */
export async function metricasDe(controlCenterId: number, ahora = Date.now()): Promise<Map<number, MetricasPartner>> {
  const desde = ahora - VENTANA_MS;

  /*
   * El historial de trato con un partner externo son los despachos. Se cruzan
   * por el destino del acuerdo, y el centro va en el WHERE por partida doble:
   * en el acuerdo y en el propio despacho.
   */
  const envios = await db.query(
    `SELECT a.id AS "authorizationId", a."providerCompanyId",
            COUNT(*)::int AS enviados,
            COUNT(*) FILTER (WHERE d.status IN ('ACCEPTED','COMPLETED'))::int AS aceptados,
            COUNT(*) FILTER (WHERE d.status = 'REJECTED')::int AS rechazados,
            COUNT(*) FILTER (WHERE d.status = 'ERROR')::int AS errores,
            COUNT(*) FILTER (WHERE d.status = 'COMPLETED')::int AS completados,
            AVG((d."acceptedAtMs" - d."createdAtMs") / 60000.0)
              FILTER (WHERE d."acceptedAtMs" IS NOT NULL) AS "tiempoAceptacionMin"
       FROM connect_provider_authorizations a
       JOIN external_dispatches d
         ON d."destinationId" = a."destinationId"
        AND d."sourceSystem" = 'central'
        AND d."sourceTenantId" = a."controlCenterId"::text
      WHERE a."controlCenterId" = $1
        AND a."destinationId" IS NOT NULL
        AND d."createdAtMs" >= $2
      GROUP BY a.id, a."providerCompanyId"`,
    [controlCenterId, desde],
  ).catch(() => ({ rows: [] as any[] }));

  /*
   * Las incidencias se cuentan por empresa proveedora y SOLO las abiertas por
   * esta central. Es lo que impide que un problema entre el partner y la
   * Plataforma B baje la nota que ve la A: son relaciones distintas y cada una
   * responde de la suya.
   */
  const incidencias = await db.query(
    `SELECT "providerCompanyId", COUNT(*)::int AS n
       FROM connect_incidents
      WHERE "controlCenterId" = $1 AND "providerCompanyId" IS NOT NULL
        AND "scoreImpact" = true AND "createdAtMs" >= $2
      GROUP BY "providerCompanyId"`,
    [controlCenterId, desde],
  ).catch(() => ({ rows: [] as any[] }));

  const porEmpresa = new Map<number, number>(
    incidencias.rows.map((f: any) => [Number(f.providerCompanyId), Number(f.n)]),
  );

  /*
   * La calidad de la empresa es la media de la de sus talleres, que ya calcula
   * `connect/score.ts`. No se recalcula: sería una segunda definición de
   * «calidad» y las dos acabarían discrepando en el mismo panel.
   *
   * Este score SÍ es de red y no por central, y es así desde antes: es la
   * reputación del taller, que ya se enseña a todas en «Talleres de la red».
   * No se convierte en un dato por central aquí porque eso cambiaría el
   * significado de un número que ya está publicado; lo que sí es por central
   * —aceptación, rechazos, incidencias— se calcula arriba con el centro en el
   * WHERE.
   */
  const calidad = await db.query(
    `SELECT w."providerCompanyId", AVG(w."currentScore") AS media
       FROM connect_workshops w
      WHERE w."providerCompanyId" IS NOT NULL
      GROUP BY w."providerCompanyId"`,
  ).catch(() => ({ rows: [] as any[] }));

  const notaEmpresa = new Map<number, number>(
    calidad.rows.map((f: any) => [Number(f.providerCompanyId), Number(f.media)]),
  );

  const salida = new Map<number, MetricasPartner>();
  for (const f of envios.rows) {
    const empresa = Number(f.providerCompanyId);
    const decididos = Number(f.aceptados) + Number(f.rechazados);
    const completados = Number(f.completados);
    const inc = porEmpresa.get(empresa) ?? 0;
    salida.set(Number(f.authorizationId), {
      authorizationId: Number(f.authorizationId),
      providerCompanyId: empresa,
      enviados: Number(f.enviados),
      aceptados: Number(f.aceptados),
      rechazados: Number(f.rechazados),
      errores: Number(f.errores),
      completados,
      ratioAceptacion: decididos > 0 ? Number(f.aceptados) / decididos : null,
      tiempoAceptacionMin: f.tiempoAceptacionMin == null ? null : Number(f.tiempoAceptacionMin),
      incidenciasPor100: completados > 0 ? (inc / completados) * 100 : (inc > 0 ? inc * 100 : null),
      calidad: notaEmpresa.has(empresa) ? Number(notaEmpresa.get(empresa)) : null,
    });
  }
  return salida;
}

/** Convierte las métricas en las medidas que entiende el motor de puntuación. */
export function medidasDe(
  m: MetricasPartner | undefined,
  extra: { distanciaKm?: number | null; precio?: number | null; slaLlegadaMin?: number | null; preferente?: boolean },
): Medidas {
  return {
    ...MEDIDAS_VACIAS,
    distanciaKm: extra.distanciaKm ?? null,
    precio: extra.precio ?? null,
    slaLlegadaMin: extra.slaLlegadaMin ?? null,
    preferente: extra.preferente === true,
    ratioAceptacion: m?.ratioAceptacion ?? null,
    tiempoAceptacionMin: m?.tiempoAceptacionMin ?? null,
    calidad: m?.calidad ?? null,
    volumen: m?.completados ?? 0,
    incidenciasPor100: m?.incidenciasPor100 ?? null,
  };
}
