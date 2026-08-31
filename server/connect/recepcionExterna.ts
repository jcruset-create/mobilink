/**
 * Recepción en Central de una asistencia que llega de otro sistema.
 *
 * Lo que resuelve, y es el motivo de que exista: cuando entra una asistencia
 * por la API, quien la manda dice de qué empresa viene («Talleres Pérez SL,
 * CIF B-12345678»), pero Central necesita la EMPRESA de su cartera para poder
 * facturar. Aquí se hace ese emparejamiento, contra el núcleo multiempresa que
 * ya existe: `connect_provider_companies` + `connect_tenant_companies`.
 *
 * ── Por qué se da de alta sola si no existe ─────────────────────────────────
 *
 * La alternativa era rechazar la asistencia y esperar a que alguien creara la
 * ficha a mano. Con una grúa esperando en el arcén, eso es exactamente lo que
 * no puede pasar: el servicio entra, y la ficha se crea con lo que se sabe y
 * queda auditada para revisarla luego.
 *
 * Lo que NO hace: darle rol de proveedor. Entra como CUSTOMER y nada más, con
 * lo que puede pedir servicios pero no aparece en el reparto de asistencias
 * como si estuviera homologada.
 */

import crypto from "node:crypto";

import db from "../db.ts";
import { normalizarCif, leerRoles } from "./empresas.ts";

export type Solicitante = {
  company?: string | null;
  tax_id?: string | null;
  email?: string | null;
  phone?: string | null;
};

export type EmpresaResuelta = {
  companyId: number;
  clientId: number | null;
  creada: boolean;
  relacionCreada: boolean;
};

/**
 * Empareja al solicitante con una empresa de la cartera del centro, creándola
 * si hace falta.
 *
 * Devuelve `null` si no hay centro (una API key sin centro asignado): sin
 * saber de qué plataforma hablamos no se puede resolver ninguna cartera, y
 * apuntar a una al azar sería peor que no apuntar a ninguna.
 */
export async function resolverSolicitante(
  controlCenterId: number | null,
  solicitante: Solicitante | null | undefined,
): Promise<EmpresaResuelta | null> {
  if (controlCenterId == null) return null;
  const nombre = String(solicitante?.company ?? "").trim();
  const cif = normalizarCif(solicitante?.tax_id);
  if (!nombre && !cif) return null;

  const now = Date.now();
  let companyId: number | null = null;
  let creada = false;

  /*
   * Se busca por CIF normalizado, nunca por nombre: «Talleres Pérez, S.L.» y
   * «TALLERES PEREZ SL» son la misma empresa y el nombre no lo demuestra. Sin
   * CIF no se empareja nada — se crea ficha nueva — porque emparejar por
   * nombre parecido acaba facturando a quien no es.
   */
  if (cif) {
    const r = await db.query(
      `SELECT id FROM connect_provider_companies
        WHERE "taxIdNormalized" = $1 AND "deletedAtMs" IS NULL LIMIT 1`,
      [cif],
    );
    if (r.rows[0]) companyId = Number(r.rows[0].id);
  }

  if (companyId == null) {
    const ins = await db.query(
      `INSERT INTO connect_provider_companies
         (uuid, name, "taxId", "taxIdNormalized", "contactEmail", "contactPhone",
          notes, "createdAtMs", "updatedAtMs")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8) RETURNING id`,
      [
        crypto.randomUUID(),
        nombre || `Empresa ${cif || "sin identificar"}`,
        solicitante?.tax_id ? String(solicitante.tax_id).trim() : null,
        cif || null,
        solicitante?.email ? String(solicitante.email).trim() : null,
        solicitante?.phone ? String(solicitante.phone).trim() : null,
        "Alta automática al recibir una asistencia externa. Revisar datos fiscales.",
        now,
      ],
    );
    companyId = Number(ins.rows[0].id);
    creada = true;
  }

  // La relación con ESTA central: es lo que la mete en su cartera y lo que
  // decide que pueda verla. Si ya existe, se le añade el papel de cliente sin
  // tocar sus condiciones comerciales, que las puso alguien a conciencia.
  const rel = await db.query(
    `SELECT id, roles FROM connect_tenant_companies
      WHERE "controlCenterId" = $1 AND "companyId" = $2`,
    [controlCenterId, companyId],
  );
  let relacionCreada = false;
  if (!rel.rows[0]) {
    await db.query(
      `INSERT INTO connect_tenant_companies
         (uuid, "controlCenterId", "companyId", roles, status, notes, "createdAtMs", "updatedAtMs")
       VALUES ($1,$2,$3,'["CUSTOMER"]','active',$4,$5,$5)
       ON CONFLICT ("controlCenterId", "companyId") DO NOTHING`,
      [crypto.randomUUID(), controlCenterId, companyId,
       "Relación creada al recibir una asistencia externa.", now],
    );
    relacionCreada = true;
  } else {
    const roles = leerRoles(rel.rows[0].roles);
    if (!roles.includes("CUSTOMER")) {
      const nuevos = [...roles, "CUSTOMER"].sort();
      await db.query(
        `UPDATE connect_tenant_companies SET roles = $2, "updatedAtMs" = $3 WHERE id = $1`,
        [rel.rows[0].id, JSON.stringify(nuevos), now],
      );
    }
  }

  /*
   * El cliente de facturación es otra cosa que la empresa: `connect_clients`
   * lleva las condiciones de facturación y puede haber varios por empresa. Se
   * enlaza el que ya esté apuntando a esta empresa; si no hay ninguno, se deja
   * sin cliente y que lo decida quien factura. Crear uno a ciegas metería una
   * ficha de facturación que nadie ha revisado.
   */
  const cli = await db.query(
    `SELECT id FROM connect_clients
      WHERE "controlCenterId" = $1 AND "companyId" = $2 AND active
      ORDER BY id LIMIT 1`,
    [controlCenterId, companyId],
  );

  return {
    companyId,
    clientId: cli.rows[0] ? Number(cli.rows[0].id) : null,
    creada,
    relacionCreada,
  };
}
