/**
 * API de la cartera de empresas y de la relación comercial con la central.
 *
 * Regla de la casa, y es la razón de ser de este fichero: **ninguna consulta
 * de aquí toca `connect_provider_companies` sin pasar por
 * `connect_tenant_companies`**. El aislamiento no se apoya en que el panel
 * mande el filtro correcto —un panel se puede saltar con `curl`— sino en que
 * la propia consulta no puede devolver una empresa con la que la central no
 * tiene relación.
 *
 * De ahí que no haya un `SELECT ... WHERE id = $1` suelto en todo el módulo:
 * el id siempre viaja acompañado del centro, y `cargarEmpresa()` es el único
 * sitio por el que se entra a una ficha.
 *
 * El superadministrador del hub atraviesa las centrales, igual que ya hacía en
 * `backoffice.ts`: es quien da de alta y da soporte a las plataformas. No es
 * una excepción nueva, es la que ya existe.
 */

import crypto from "node:crypto";

import { Router, json, type Request, type Response } from "express";

import db from "../db.ts";
import { auditConnect, requireConnectRole, type ConnectRole } from "./rbac.ts";
import {
  leerRoles,
  normalizarCif,
  normalizarRoles,
  puedeEditarRelacion,
  validarCondiciones,
} from "./empresas.ts";

function err(res: Response, status: number, code: string, message: string) {
  return res.status(status).json({ error: { code, message } });
}

/**
 * Centro por el que se filtra, o null si se ven todos (solo superadmin).
 * Mismo criterio y mismo nombre que `centroDe` en backoffice.ts.
 */
function centroDe(req: Request): number | null {
  const u = req.connectUser;
  if (!u || u.role === "superadmin") return null;
  return u.controlCenterId;
}

/**
 * El centro sobre el que se opera cuando hace falta uno concreto.
 *
 * Crear una relación comercial «para todas las centrales a la vez» no
 * significa nada, así que el superadministrador tiene que decir en cuál está.
 */
function centroPedido(req: Request): number | null {
  const propio = centroDe(req);
  if (propio != null) return propio;
  const pedido = req.query?.controlCenterId ?? req.body?.controlCenterId;
  if (pedido == null || pedido === "") return null;
  const n = Number(pedido);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** Fila de empresa + su relación, tal y como la enseña la API. */
function aApi(row: any) {
  return {
    id: Number(row.id),
    uuid: row.uuid,
    name: row.name,
    legalName: row.legalName ?? null,
    commercialName: row.commercialName ?? null,
    taxId: row.taxId ?? null,
    vatNumber: row.vatNumber ?? null,
    address: row.address ?? null,
    postalCode: row.postalCode ?? null,
    city: row.city ?? null,
    province: row.province ?? null,
    country: row.country ?? null,
    contactEmail: row.contactEmail ?? null,
    contactPhone: row.contactPhone ?? null,
    web: row.web ?? null,
    status: row.status,
    relacion: row.relacionId
      ? {
          id: Number(row.relacionId),
          uuid: row.relacionUuid,
          controlCenterId: Number(row.relacionCentro),
          internalCode: row.internalCode ?? null,
          roles: leerRoles(row.roles),
          status: row.relacionStatus,
          paymentTerms: row.paymentTerms ?? null,
          paymentMethod: row.paymentMethod ?? null,
          creditLimit: row.creditLimit == null ? null : Number(row.creditLimit),
          authorizationLimit:
            row.authorizationLimit == null ? null : Number(row.authorizationLimit),
          slaAcceptMin: row.slaAcceptMin ?? null,
          slaArrivalMin: row.slaArrivalMin ?? null,
          tariffPlanId: row.tariffPlanId ?? null,
          billingConfig: seguro(row.billingConfig),
          communicationsConfig: seguro(row.communicationsConfig),
          validFromMs: row.validFromMs == null ? null : Number(row.validFromMs),
          validToMs: row.validToMs == null ? null : Number(row.validToMs),
          notes: row.notes ?? null,
        }
      : null,
    talleres: row.talleres != null ? Number(row.talleres) : 0,
  };
}

function seguro(v: unknown): Record<string, unknown> {
  try {
    return typeof v === "string" ? JSON.parse(v) : ((v as any) ?? {});
  } catch {
    return {};
  }
}

/**
 * Las columnas de la ficha y de la relación, en un solo sitio.
 *
 * El JOIN con la relación es INNER cuando hay centro y LEFT cuando no lo hay
 * (superadmin): así el filtro por central no es un `WHERE` que se pueda
 * olvidar, sino la propia forma de la consulta.
 */
const SELECT_EMPRESA = `
  SELECT pc.id, pc.uuid, pc.name, pc."legalName", pc."commercialName", pc."taxId",
         pc."vatNumber", pc.address, pc."postalCode", pc.city, pc.province, pc.country,
         pc."contactEmail", pc."contactPhone", pc.web, pc.status,
         tc.id AS "relacionId", tc.uuid AS "relacionUuid",
         tc."controlCenterId" AS "relacionCentro", tc."internalCode", tc.roles,
         tc.status AS "relacionStatus", tc."paymentTerms", tc."paymentMethod",
         tc."creditLimit", tc."authorizationLimit", tc."slaAcceptMin", tc."slaArrivalMin",
         tc."tariffPlanId", tc."billingConfig", tc."communicationsConfig",
         tc."validFromMs", tc."validToMs", tc.notes,
         (SELECT COUNT(*)::int FROM connect_workshops w WHERE w."providerCompanyId" = pc.id) AS talleres
    FROM connect_provider_companies pc
`;

/**
 * Carga UNA empresa comprobando el acceso en la misma consulta.
 *
 * Devuelve null si la empresa no existe **o** si la central no tiene relación
 * con ella: desde fuera las dos cosas son un 404 idéntico, y eso es
 * deliberado. Distinguirlas contestaría «esa empresa existe pero no es tuya»,
 * que es justo el dato que permitiría a una plataforma ir tanteando ids para
 * enumerar la cartera de otra.
 */
async function cargarEmpresa(id: number, centro: number | null) {
  const r = await db.query(
    `${SELECT_EMPRESA}
     ${centro == null
        ? `LEFT JOIN connect_tenant_companies tc ON tc."companyId" = pc.id`
        : `JOIN connect_tenant_companies tc ON tc."companyId" = pc.id AND tc."controlCenterId" = $2`}
      WHERE pc.id = $1 AND pc."deletedAtMs" IS NULL
      LIMIT 1`,
    centro == null ? [id] : [id, centro],
  );
  return r.rows[0] ?? null;
}

export function createEmpresasRouter(): Router {
  const router = Router();
  router.use(json({ limit: "1mb" }));

  /* ── Cartera de empresas de la central ──────────────────────────────────
   *
   * Búsqueda por nombre, CIF, población y código interno: es lo que se tiene
   * a mano cuando llama alguien. El CIF se busca normalizado para que
   * «B-12345678» encuentre la ficha guardada como «B12345678».
   */
  router.get("/", ...requireConnectRole("analyst"), async (req, res) => {
    try {
      const centro = centroDe(req);
      const q = String(req.query.q ?? "").trim();
      const rol = String(req.query.rol ?? "").trim().toUpperCase();
      const params: unknown[] = [];
      const cond: string[] = [`pc."deletedAtMs" IS NULL`];

      let join = `LEFT JOIN connect_tenant_companies tc ON tc."companyId" = pc.id`;
      if (centro != null) {
        params.push(centro);
        join = `JOIN connect_tenant_companies tc ON tc."companyId" = pc.id AND tc."controlCenterId" = $${params.length}`;
      }
      if (q) {
        params.push(`%${q.toLowerCase()}%`, `%${normalizarCif(q)}%`);
        const a = params.length - 1;
        cond.push(
          `(lower(pc.name) LIKE $${a} OR lower(COALESCE(pc."legalName",'')) LIKE $${a}
            OR lower(COALESCE(pc.city,'')) LIKE $${a}
            OR lower(COALESCE(tc."internalCode",'')) LIKE $${a}
            OR COALESCE(pc."taxIdNormalized",'') LIKE $${params.length})`,
        );
      }
      if (rol) {
        params.push(`%"${rol}"%`);
        cond.push(`tc.roles LIKE $${params.length}`);
      }

      const r = await db.query(
        `${SELECT_EMPRESA} ${join} WHERE ${cond.join(" AND ")} ORDER BY pc.name LIMIT 300`,
        params,
      );
      res.json({ data: r.rows.map(aApi) });
    } catch (e: any) {
      console.error("[Connect] GET /empresas:", e?.message);
      err(res, 500, "internal_error", "Error listando empresas");
    }
  });

  router.get("/:id", ...requireConnectRole("analyst"), async (req, res) => {
    try {
      const fila = await cargarEmpresa(Number(req.params.id), centroDe(req));
      if (!fila) return err(res, 404, "not_found", "Empresa no encontrada");
      res.json(aApi(fila));
    } catch (e: any) {
      console.error("[Connect] GET /empresas/:id:", e?.message);
      err(res, 500, "internal_error", "Error cargando la empresa");
    }
  });

  /* ── Alta ───────────────────────────────────────────────────────────────
   *
   * Dos pasos que no se pueden separar: la identidad y la relación con quien
   * la da de alta. Una empresa sin relación no la vería nadie, ni siquiera
   * quien acaba de crearla, así que van en la misma transacción.
   *
   * Si el CIF ya existe NO se crea otra ficha: se devuelve 409 con el id de
   * la que hay. Es el caso que la ficha maestra viene a resolver, y el panel
   * puede ofrecer «añadirla a tu cartera» en vez de duplicarla.
   */
  router.post("/", ...requireConnectRole("cc_admin"), async (req, res) => {
    const centro = centroPedido(req);
    if (centro == null) {
      return err(res, 422, "control_center_required", "Indica la central para la que se da de alta");
    }
    const nombre = String(req.body?.name ?? "").trim();
    if (!nombre) return err(res, 422, "name_required", "El nombre de la empresa es obligatorio");

    const cif = normalizarCif(req.body?.taxId);
    const roles = normalizarRoles(req.body?.roles ?? ["PROVIDER"]);
    if (roles.length === 0) {
      return err(res, 422, "roles_required", "Indica al menos un rol para la empresa");
    }
    const fallos = validarCondiciones(req.body ?? {});
    if (fallos.length) return err(res, 422, "invalid_conditions", fallos.join(". "));

    const cliente = await db.connect();
    try {
      await cliente.query("BEGIN");
      const now = Date.now();

      let companyId: number | null = null;
      if (cif) {
        const ya = await cliente.query(
          `SELECT id, name FROM connect_provider_companies
            WHERE "taxIdNormalized" = $1 AND "deletedAtMs" IS NULL LIMIT 1`,
          [cif],
        );
        if (ya.rows[0]) {
          await cliente.query("ROLLBACK");
          return res.status(409).json({
            error: {
              code: "company_exists",
              message: `Ya existe una empresa con ese CIF: ${ya.rows[0].name}`,
            },
            companyId: Number(ya.rows[0].id),
          });
        }
      }

      const ins = await cliente.query(
        `INSERT INTO connect_provider_companies
           (uuid, name, "legalName", "commercialName", "taxId", "taxIdNormalized", "vatNumber",
            address, "postalCode", city, province, country, "contactEmail", "contactPhone", web,
            "createdAtMs", "updatedAtMs")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$16)
         RETURNING id`,
        [
          crypto.randomUUID(), nombre,
          txt(req.body?.legalName), txt(req.body?.commercialName),
          txt(req.body?.taxId), cif || null, txt(req.body?.vatNumber),
          txt(req.body?.address), txt(req.body?.postalCode), txt(req.body?.city),
          txt(req.body?.province), txt(req.body?.country),
          txt(req.body?.contactEmail), txt(req.body?.contactPhone), txt(req.body?.web),
          now,
        ],
      );
      companyId = Number(ins.rows[0].id);

      await cliente.query(
        `INSERT INTO connect_tenant_companies
           (uuid, "controlCenterId", "companyId", "internalCode", roles, status,
            "createdAtMs", "updatedAtMs")
         VALUES ($1,$2,$3,$4,$5,'active',$6,$6)`,
        [crypto.randomUUID(), centro, companyId, txt(req.body?.internalCode), JSON.stringify(roles), now],
      );
      await cliente.query("COMMIT");

      await auditConnect({
        req, action: "empresa.creada", resourceType: "company", resourceId: companyId,
        detail: { nombre, roles, controlCenterId: centro },
      });
      const fila = await cargarEmpresa(companyId, centro);
      res.status(201).json(fila ? aApi(fila) : { id: companyId });
    } catch (e: any) {
      await cliente.query("ROLLBACK").catch(() => {});
      console.error("[Connect] POST /empresas:", e?.message);
      err(res, 500, "internal_error", "Error creando la empresa");
    } finally {
      cliente.release();
    }
  });

  /* ── Datos de identidad ─────────────────────────────────────────────────
   *
   * Ojo con lo que se toca aquí: la ficha es COMPARTIDA. Cambiar el domicilio
   * fiscal se lo cambia a todas las centrales que trabajan con esa empresa, y
   * eso es exactamente lo que se buscaba. Las condiciones propias de cada una
   * están en la relación y se editan en el endpoint de abajo.
   */
  router.patch("/:id", ...requireConnectRole("cc_admin"), async (req, res) => {
    try {
      const id = Number(req.params.id);
      const centro = centroDe(req);
      const fila = await cargarEmpresa(id, centro);
      if (!fila) return err(res, 404, "not_found", "Empresa no encontrada");

      const CAMPOS = [
        "name", "legalName", "commercialName", "taxId", "vatNumber", "address",
        "postalCode", "city", "province", "country", "contactEmail", "contactPhone", "web", "notes",
      ] as const;
      const sets: string[] = [];
      const params: unknown[] = [id];
      for (const campo of CAMPOS) {
        if (!(campo in (req.body ?? {}))) continue;
        params.push(txt(req.body[campo]));
        sets.push(`"${campo}" = $${params.length}`);
        // El CIF normalizado se mantiene al día en la misma sentencia: si se
        // quedara atrás, el control de duplicados dejaría de ver el cambio.
        if (campo === "taxId") {
          params.push(normalizarCif(req.body[campo]) || null);
          sets.push(`"taxIdNormalized" = $${params.length}`);
        }
      }
      if (sets.length === 0) return res.json(aApi(fila));

      params.push(Date.now());
      sets.push(`"updatedAtMs" = $${params.length}`);
      try {
        await db.query(
          `UPDATE connect_provider_companies SET ${sets.join(", ")} WHERE id = $1`,
          params,
        );
      } catch (e: any) {
        if (String(e?.message).includes("idx_connect_companies_cif")) {
          return err(res, 409, "company_exists", "Ya hay otra empresa con ese CIF");
        }
        throw e;
      }

      await auditConnect({
        req, action: "empresa.modificada", resourceType: "company", resourceId: id,
        detail: { campos: sets.map((s) => s.split(" ")[0]) },
      });
      const fresca = await cargarEmpresa(id, centro);
      res.json(fresca ? aApi(fresca) : {});
    } catch (e: any) {
      console.error("[Connect] PATCH /empresas/:id:", e?.message);
      err(res, 500, "internal_error", "Error guardando la empresa");
    }
  });

  /* ── Relación comercial ─────────────────────────────────────────────────
   *
   * Aquí sí es todo privado de la central: roles, código interno, condiciones
   * de pago, límites y SLA. Un PUT porque la relación existe o se crea: es la
   * misma operación desde el punto de vista de quien la usa («esta empresa
   * trabaja conmigo con estas condiciones»).
   */
  router.put("/:id/relacion", ...requireConnectRole("cc_admin"), async (req, res) => {
    try {
      const id = Number(req.params.id);
      const centro = centroPedido(req);
      if (centro == null) {
        return err(res, 422, "control_center_required", "Indica la central de la relación");
      }
      if (!puedeEditarRelacion(req.connectUser?.role as ConnectRole)) {
        return err(res, 403, "forbidden", "Permisos insuficientes");
      }

      const existe = await db.query(
        `SELECT id FROM connect_provider_companies WHERE id = $1 AND "deletedAtMs" IS NULL`,
        [id],
      );
      if (!existe.rows[0]) return err(res, 404, "not_found", "Empresa no encontrada");

      const roles = normalizarRoles(req.body?.roles);
      if (roles.length === 0) {
        return err(res, 422, "roles_required", "Indica al menos un rol para la empresa");
      }
      const fallos = validarCondiciones(req.body ?? {});
      if (fallos.length) return err(res, 422, "invalid_conditions", fallos.join(". "));

      const now = Date.now();
      await db.query(
        `INSERT INTO connect_tenant_companies
           (uuid, "controlCenterId", "companyId", "internalCode", roles, status,
            "paymentTerms", "paymentMethod", "creditLimit", "authorizationLimit",
            "slaAcceptMin", "slaArrivalMin", "tariffPlanId",
            "billingConfig", "communicationsConfig", "validFromMs", "validToMs", notes,
            "createdAtMs", "updatedAtMs")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$19)
         ON CONFLICT ("controlCenterId", "companyId") DO UPDATE SET
           "internalCode" = EXCLUDED."internalCode",
           roles = EXCLUDED.roles,
           status = EXCLUDED.status,
           "paymentTerms" = EXCLUDED."paymentTerms",
           "paymentMethod" = EXCLUDED."paymentMethod",
           "creditLimit" = EXCLUDED."creditLimit",
           "authorizationLimit" = EXCLUDED."authorizationLimit",
           "slaAcceptMin" = EXCLUDED."slaAcceptMin",
           "slaArrivalMin" = EXCLUDED."slaArrivalMin",
           "tariffPlanId" = EXCLUDED."tariffPlanId",
           "billingConfig" = EXCLUDED."billingConfig",
           "communicationsConfig" = EXCLUDED."communicationsConfig",
           "validFromMs" = EXCLUDED."validFromMs",
           "validToMs" = EXCLUDED."validToMs",
           notes = EXCLUDED.notes,
           "updatedAtMs" = EXCLUDED."updatedAtMs"`,
        [
          crypto.randomUUID(), centro, id,
          txt(req.body?.internalCode), JSON.stringify(roles),
          req.body?.status ? String(req.body.status) : "active",
          txt(req.body?.paymentTerms), txt(req.body?.paymentMethod),
          num(req.body?.creditLimit), num(req.body?.authorizationLimit),
          ent(req.body?.slaAcceptMin), ent(req.body?.slaArrivalMin), ent(req.body?.tariffPlanId),
          JSON.stringify(req.body?.billingConfig ?? {}),
          JSON.stringify(req.body?.communicationsConfig ?? {}),
          ent(req.body?.validFromMs), ent(req.body?.validToMs), txt(req.body?.notes),
          now,
        ],
      );

      await auditConnect({
        req, action: "empresa.relacion_guardada", resourceType: "company", resourceId: id,
        detail: { controlCenterId: centro, roles, status: req.body?.status ?? "active" },
      });
      const fila = await cargarEmpresa(id, centro);
      res.json(fila ? aApi(fila) : {});
    } catch (e: any) {
      if (String(e?.message).includes("idx_tenant_companies_codigo")) {
        return err(res, 409, "code_exists", "Ese código interno ya lo usa otra empresa");
      }
      console.error("[Connect] PUT /empresas/:id/relacion:", e?.message);
      err(res, 500, "internal_error", "Error guardando la relación comercial");
    }
  });

  /*
   * Quitar la relación NO borra la empresa: deja de estar en la cartera de
   * esta central y sigue existiendo para las demás. Es lo que hace falta para
   * deshacer el backfill sin destruir nada.
   */
  router.delete("/:id/relacion", ...requireConnectRole("cc_admin"), async (req, res) => {
    try {
      const id = Number(req.params.id);
      const centro = centroPedido(req);
      if (centro == null) {
        return err(res, 422, "control_center_required", "Indica la central de la relación");
      }
      const r = await db.query(
        `DELETE FROM connect_tenant_companies WHERE "companyId" = $1 AND "controlCenterId" = $2`,
        [id, centro],
      );
      if (!r.rowCount) return err(res, 404, "not_found", "Esa empresa no está en tu cartera");
      await auditConnect({
        req, action: "empresa.relacion_retirada", resourceType: "company", resourceId: id,
        detail: { controlCenterId: centro },
      });
      res.json({ ok: true });
    } catch (e: any) {
      console.error("[Connect] DELETE /empresas/:id/relacion:", e?.message);
      err(res, 500, "internal_error", "Error retirando la relación");
    }
  });

  return router;
}

function txt(v: unknown): string | null {
  const s = v == null ? "" : String(v).trim();
  return s === "" ? null : s;
}

function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function ent(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
}
