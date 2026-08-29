/**
 * El enrutado, de principio a fin.
 *
 * Tres pasos, siempre en este orden y por este motivo:
 *
 *   1. **Quién puede** — `acuerdos/dominio.ts`. Zona, horario, servicio,
 *      vigencia y tope. Un partner que no puede no compite.
 *   2. **Qué dice la central** — `reglas.ts`. Las excepciones explícitas:
 *      forzar, excluir, preferir, penalizar. Van antes de puntuar porque una
 *      exclusión no es un peso: no se compensa con ser barato.
 *   3. **Quién es mejor** — `dominio.ts`. Se pondera lo que queda.
 *
 * Al final se guarda la decisión entera. No es telemetría: es la única forma
 * de contestar «por qué se mandó a éste» dentro de un mes, cuando los pesos,
 * las reglas y las métricas ya han cambiado.
 *
 * ── Sugerir, no ejecutar ────────────────────────────────────────────────────
 *
 * Por defecto el motor propone y una persona encarga (`routingMode` =
 * `suggest`). Es deliberado: una central que acaba de configurar sus reglas no
 * debería descubrir que están mal porque una grúa fue a Teruel. El modo
 * automático existe, pero se enciende a sabiendas.
 */

import crypto from "node:crypto";

import db from "../db.ts";
import { evaluar, type Peticion } from "../acuerdos/dominio.ts";
import { aAcuerdo } from "../acuerdos/servicio.ts";
import {
  codigoPostalDe, normalizarPesos, ordenar,
  type Medidas, type Pesos, type Puntuado,
} from "./dominio.ts";
import { medidasDe, metricasDe } from "./metricas.ts";
import { decidir, leerRegla, type Contexto, type Regla } from "./reglas.ts";

export class ErrorEnrutado extends Error {
  constructor(public estado: number, public codigo: string, mensaje: string) { super(mensaje); }
}

export type CandidatoEnrutado = {
  authorizationId: number;
  providerCompanyId: number;
  nombre: string;
  medidas: Medidas;
  requierePresupuesto: boolean;
};

export type Descartado = {
  authorizationId: number;
  nombre: string;
  motivos: string[];
};

export type Resultado = {
  modo: string;
  pesos: Pesos;
  elegido: Puntuado<CandidatoEnrutado> | null;
  candidatos: Puntuado<CandidatoEnrutado>[];
  descartados: Descartado[];
  reglasAplicadas: { reglaId: number; nombre: string; accion: string; partners: number[] }[];
  exigePresupuesto: boolean;
  decisionId: number | null;
};

export async function reglasDe(controlCenterId: number): Promise<Regla[]> {
  const r = await db.query(
    `SELECT * FROM connect_routing_rules WHERE "controlCenterId" = $1 ORDER BY "sortOrder", id`,
    [controlCenterId],
  );
  return r.rows.map(leerRegla);
}

export async function configuracionDe(controlCenterId: number): Promise<{ pesos: Pesos; modo: string }> {
  const r = await db.query(
    `SELECT "routingWeights", "routingMode" FROM connect_control_centers WHERE id = $1`,
    [controlCenterId],
  );
  const f = r.rows[0];
  return {
    pesos: normalizarPesos(f?.routingWeights),
    modo: String(f?.routingMode ?? "suggest"),
  };
}

/**
 * Precio estimado con la tarifa pactada del acuerdo.
 *
 * Es el precio que ESTA central paga a ESE partner, no el de nadie más: sale
 * de su propia línea de tarifa. Un precio medio de mercado sería el dato de
 * todos, y aquí no se calcula ninguno.
 */
async function preciosDe(authorizationIds: number[], servicio: string | null): Promise<Map<number, number>> {
  if (authorizationIds.length === 0 || !servicio) return new Map();
  const r = await db.query(
    `SELECT "authorizationId", "baseAmount" FROM connect_tariff_lines
      WHERE "authorizationId" = ANY($1::int[]) AND "serviceTypeCode" = $2 AND active`,
    [authorizationIds, servicio],
  ).catch(() => ({ rows: [] as any[] }));
  return new Map(r.rows.map((f: any) => [Number(f.authorizationId), Number(f.baseAmount)]));
}

export type PeticionEnrutado = Peticion & Contexto & {
  assistanceId?: number | null;
  correlationId?: string | null;
  /** Distancias ya calculadas por acuerdo, si quien llama las tiene. */
  distancias?: Record<number, number>;
};

/**
 * A quién se manda esto.
 *
 * `guardar` a false para el simulador: probar una regla no puede ensuciar el
 * historial de decisiones reales, o el historial deja de servir para auditar.
 */
export async function enrutar(
  controlCenterId: number, p: PeticionEnrutado, opciones: { guardar?: boolean; quien?: string } = {},
): Promise<Resultado> {
  const cuando = p.cuando ?? new Date();
  const { pesos, modo } = await configuracionDe(controlCenterId);

  const filas = await db.query(
    `SELECT a.*, pc.name AS "companyName"
       FROM connect_provider_authorizations a
       JOIN connect_provider_companies pc ON pc.id = a."providerCompanyId"
      WHERE a."controlCenterId" = $1`,
    [controlCenterId],
  );

  /* Paso 1: quién puede. */
  const aptos: { fila: any; requierePresupuesto: boolean }[] = [];
  const descartados: Descartado[] = [];
  for (const fila of filas.rows) {
    const acuerdo = aAcuerdo(fila);
    const e = evaluar(acuerdo, { ...p, cuando });
    if (e.apto) aptos.push({ fila, requierePresupuesto: e.requierePresupuesto });
    else descartados.push({
      authorizationId: acuerdo.id, nombre: String(fila.companyName ?? ""), motivos: e.motivos,
    });
  }

  /* Paso 2: qué dice la central. */
  const reglas = await reglasDe(controlCenterId);
  const decision = decidir(reglas, { ...p, cuando }, aptos.map((a) => Number(a.fila.id)));

  let enJuego = aptos;
  if (decision.forzados.length > 0) {
    const forzados = new Set(decision.forzados);
    for (const a of aptos) {
      if (!forzados.has(Number(a.fila.id))) {
        descartados.push({
          authorizationId: Number(a.fila.id), nombre: String(a.fila.companyName ?? ""),
          motivos: ["Una regla obliga a usar otro partner"],
        });
      }
    }
    enJuego = aptos.filter((a) => forzados.has(Number(a.fila.id)));
  }
  for (const a of [...enJuego]) {
    const fuera = decision.excluidos.get(Number(a.fila.id));
    if (fuera) {
      descartados.push({
        authorizationId: Number(a.fila.id), nombre: String(a.fila.companyName ?? ""),
        motivos: [`Excluido por la regla «${fuera.nombre}»`],
      });
      enJuego = enJuego.filter((x) => x !== a);
    }
  }

  /* Paso 3: quién es mejor. */
  const ids = enJuego.map((a) => Number(a.fila.id));
  const [metricas, precios] = await Promise.all([
    metricasDe(controlCenterId, cuando.getTime()),
    preciosDe(ids, p.servicio ?? null),
  ]);

  const candidatos: CandidatoEnrutado[] = enJuego.map(({ fila, requierePresupuesto }) => {
    const id = Number(fila.id);
    return {
      authorizationId: id,
      providerCompanyId: Number(fila.providerCompanyId),
      nombre: String(fila.companyName ?? ""),
      requierePresupuesto,
      medidas: medidasDe(metricas.get(id), {
        distanciaKm: p.distancias?.[id] ?? p.distanciaKm ?? null,
        precio: precios.get(id) ?? null,
        slaLlegadaMin: fila.slaArrivalMin == null ? null : Number(fila.slaArrivalMin),
        preferente: fila.preferred === true,
      }),
    };
  });

  const puntuados = ordenar(candidatos, pesos).map((x) => {
    const ajuste = decision.ajustes.get(x.candidato.authorizationId) ?? 0;
    if (ajuste === 0) return x;
    /*
     * El ajuste de una regla se suma DESPUÉS de puntuar y se dice en el
     * motivo. Meterlo dentro de los pesos lo escondería: quien mire la
     * puntuación tiene que ver que hubo una mano encima.
     */
    return {
      ...x,
      puntos: Math.round(Math.max(0, Math.min(100, x.puntos + ajuste)) * 10) / 10,
      motivo: `${x.motivo} · ${ajuste > 0 ? "+" : ""}${ajuste} por regla`,
    };
  }).sort((a, b) => b.puntos - a.puntos || a.candidato.nombre.localeCompare(b.candidato.nombre));

  const elegido = puntuados[0] ?? null;
  const exigePresupuesto = decision.exigirPresupuesto || (elegido?.candidato.requierePresupuesto ?? false);

  let decisionId: number | null = null;
  if (opciones.guardar !== false) {
    decisionId = await guardarDecision(controlCenterId, p, pesos, puntuados, decision, elegido, opciones.quien);
  }

  return {
    modo, pesos, elegido, candidatos: puntuados, descartados,
    reglasAplicadas: decision.aplicadas.map((a) => ({
      reglaId: a.regla.reglaId, nombre: a.regla.nombre, accion: a.regla.accion, partners: a.partners,
    })),
    exigePresupuesto, decisionId,
  };
}

async function guardarDecision(
  controlCenterId: number, p: PeticionEnrutado, pesos: Pesos,
  puntuados: Puntuado<CandidatoEnrutado>[], decision: ReturnType<typeof decidir>,
  elegido: Puntuado<CandidatoEnrutado> | null, quien?: string,
): Promise<number | null> {
  try {
    const now = Date.now();
    const r = await db.query(
      `INSERT INTO connect_routing_decisions
         (uuid, "controlCenterId", "assistanceId", "correlationId", context, weights,
          candidates, "rulesApplied", "chosenAuthorizationId", "decidedBy", "createdAtMs")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
      [
        crypto.randomUUID(), controlCenterId, p.assistanceId ?? null, p.correlationId ?? null,
        JSON.stringify({
          servicio: p.servicio ?? null, provincia: p.provincia ?? null,
          codigoPostal: p.codigoPostal ?? null, prioridad: p.prioridad ?? null,
          tipoVehiculo: p.tipoVehiculo ?? null,
        }),
        JSON.stringify(pesos),
        JSON.stringify(puntuados.slice(0, 20).map((x) => ({
          authorizationId: x.candidato.authorizationId,
          nombre: x.candidato.nombre,
          puntos: x.puntos,
          notas: x.notas,
          motivo: x.motivo,
        }))),
        JSON.stringify(decision.aplicadas.map((a) => a.regla)),
        elegido?.candidato.authorizationId ?? null,
        quien ?? "system", now,
      ],
    );
    return Number(r.rows[0].id);
  } catch (e) {
    /*
     * No poder guardar la traza NO puede impedir que salga la grúa. Se registra
     * el fallo y el enrutado sigue: perder la auditoría de una decisión es malo,
     * dejar a alguien tirado en la carretera es peor.
     */
    console.error("[Enrutado] no se pudo guardar la decisión:", (e as any)?.message);
    return null;
  }
}

/* ── Enrutar una asistencia concreta ─────────────────────────────────────── */

/**
 * A quién mandar ESTA asistencia.
 *
 * Lee la asistencia con el centro en el WHERE —de otra plataforma no se enruta
 * nada— y compone la petición con lo que se sabe. Lo que quien llama mande en
 * `manual` pisa lo deducido: el operador que está mirando el mapa sabe más que
 * una expresión regular sobre una dirección.
 */
export async function enrutarAsistencia(
  controlCenterId: number, assistanceId: number,
  manual: Partial<PeticionEnrutado> = {},
  opciones: { guardar?: boolean; quien?: string } = {},
): Promise<Resultado> {
  const r = await db.query(
    `SELECT id, address, priority, "serviceType", vehicle, "estimatedCost",
            "requesterCompanyId", "correlationId"
       FROM connect_assistances WHERE id = $1 AND "controlCenterId" = $2`,
    [assistanceId, controlCenterId],
  );
  const a = r.rows[0];
  if (!a) throw new ErrorEnrutado(404, "not_found", "Asistencia no encontrada");

  let vehiculo: Record<string, any> = {};
  try {
    const o = JSON.parse(String(a.vehicle ?? "") || "{}");
    if (o && typeof o === "object") vehiculo = o;
  } catch { /* un vehículo mal guardado no impide enrutar */ }

  return enrutar(controlCenterId, {
    servicio: a.serviceType ?? null,
    codigoPostal: codigoPostalDe(a.address),
    prioridad: a.priority ?? null,
    tipoVehiculo: vehiculo.type ?? null,
    clienteId: a.requesterCompanyId == null ? null : Number(a.requesterCompanyId),
    importeEstimado: a.estimatedCost == null ? null : Number(a.estimatedCost),
    assistanceId,
    correlationId: a.correlationId ?? null,
    ...manual,
  }, opciones);
}

/* ── Reglas: alta, baja y orden ──────────────────────────────────────────── */

export async function crearRegla(controlCenterId: number, cuerpo: any, usuarioId: number | null) {
  const nombre = String(cuerpo?.name ?? cuerpo?.nombre ?? "").trim();
  if (!nombre) throw new ErrorEnrutado(422, "name_required", "La regla necesita un nombre que la explique");
  const now = Date.now();
  const r = await db.query(
    `INSERT INTO connect_routing_rules
       (uuid, "controlCenterId", name, "sortOrder", active, condition, action, partners,
        adjustment, notes, "createdAtMs", "updatedAtMs", "updatedByUserId")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11,$12) RETURNING *`,
    [crypto.randomUUID(), controlCenterId, nombre, Number(cuerpo?.sortOrder ?? 100),
     cuerpo?.active !== false, JSON.stringify(cuerpo?.condition ?? {}),
     String(cuerpo?.action ?? "preferir"), JSON.stringify(cuerpo?.partners ?? []),
     Number(cuerpo?.adjustment ?? 0), cuerpo?.notes ?? null, now, usuarioId],
  );
  return leerRegla(r.rows[0]);
}

export async function actualizarRegla(
  id: number, controlCenterId: number, cuerpo: any, usuarioId: number | null,
) {
  const campos: Record<string, string> = {
    name: "name", sortOrder: "sortOrder", active: "active", condition: "condition",
    action: "action", partners: "partners", adjustment: "adjustment", notes: "notes",
  };
  const sets: string[] = []; const valores: unknown[] = [];
  for (const [clave, col] of Object.entries(campos)) {
    if (!(clave in (cuerpo ?? {}))) continue;
    let v = cuerpo[clave];
    if (col === "condition" || col === "partners") v = JSON.stringify(v ?? (col === "partners" ? [] : {}));
    valores.push(v);
    sets.push(`"${col}" = $${valores.length}`);
  }
  if (sets.length === 0) throw new ErrorEnrutado(422, "nothing_to_update", "No hay nada que cambiar");
  valores.push(Date.now()); sets.push(`"updatedAtMs" = $${valores.length}`);
  valores.push(usuarioId); sets.push(`"updatedByUserId" = $${valores.length}`);
  valores.push(id); const iId = valores.length;
  valores.push(controlCenterId);

  // El centro va en el WHERE: una regla de otra central no se toca ni por su id.
  const r = await db.query(
    `UPDATE connect_routing_rules SET ${sets.join(", ")}
      WHERE id = $${iId} AND "controlCenterId" = $${valores.length} RETURNING *`,
    valores,
  );
  if (r.rows.length === 0) throw new ErrorEnrutado(404, "not_found", "Regla no encontrada");
  return leerRegla(r.rows[0]);
}

export async function borrarRegla(id: number, controlCenterId: number): Promise<void> {
  const r = await db.query(
    `DELETE FROM connect_routing_rules WHERE id = $1 AND "controlCenterId" = $2`,
    [id, controlCenterId],
  );
  if ((r.rowCount ?? 0) === 0) throw new ErrorEnrutado(404, "not_found", "Regla no encontrada");
}

export async function guardarPesos(controlCenterId: number, entrada: unknown): Promise<Pesos> {
  const pesos = normalizarPesos(entrada);
  await db.query(
    `UPDATE connect_control_centers SET "routingWeights" = $2 WHERE id = $1`,
    [controlCenterId, JSON.stringify(pesos)],
  );
  return pesos;
}

export async function guardarModo(controlCenterId: number, modo: string): Promise<string> {
  const limpio = modo === "auto" ? "auto" : "suggest";
  await db.query(`UPDATE connect_control_centers SET "routingMode" = $2 WHERE id = $1`,
    [controlCenterId, limpio]);
  return limpio;
}

export async function decisionesDe(controlCenterId: number, limite = 50) {
  const r = await db.query(
    `SELECT * FROM connect_routing_decisions WHERE "controlCenterId" = $1
      ORDER BY id DESC LIMIT $2`,
    [controlCenterId, Math.min(Math.max(1, limite), 200)],
  );
  return r.rows;
}
