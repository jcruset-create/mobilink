/**
 * Central — partners de integración y sus credenciales.
 *
 * Es el otro extremo del cable: aquí se da de alta quién puede mandarnos
 * asistencias y con qué permisos.
 *
 * ── Cómo se guardan las claves ──────────────────────────────────────────────
 *
 * Igual que una contraseña: **solo el hash SHA-256**. La clave completa se
 * enseña UNA vez, en la respuesta de creación, y después no existe en ningún
 * sitio del que se pueda recuperar. Si se pierde, se rota; no se «consulta».
 *
 * Eso lo hacía ya `generateApiKey` en auth.ts y se reutiliza tal cual. Lo que
 * faltaba era todo lo demás: listar, revocar, rotar, ver el uso, y sobre todo
 * que la credencial quedara atada al CENTRO de quien la crea. Una clave creada
 * por la Plataforma A no puede acabar dando de alta asistencias en la B.
 *
 * ── Por qué el partner lleva centro obligatorio ─────────────────────────────
 *
 * El tenant destino de una asistencia entrante se deduce del partner de la
 * credencial (`connect_partners.controlCenterId`). Un partner sin centro deja
 * asistencias sin dueño: no las ve nadie, o las ven todas. Por eso aquí no se
 * puede crear uno sin centro.
 */

import crypto from "node:crypto";

import { Router, json, type Response } from "express";

import db from "../db.ts";
import { auditConnect, requireConnectRole } from "./rbac.ts";
import { expandirScopes, generateApiKey, sha256 } from "./auth.ts";

/** Permisos que se pueden conceder a una credencial. */
export const SCOPES = [
  "assistances:create",
  "assistances:read",
  "assistances:update",
  "documents:write",
  "documents:read",
] as const;

export type Scope = (typeof SCOPES)[number];

/**
 * Compatibilidad: `assistances:write` es el permiso original, de antes de que
 * existiera este catálogo. Se sigue admitiendo al crear una clave porque hay
 * claves vivas con él; la equivalencia real la resuelve `auth.ts`, que es
 * quien las comprueba, para no tener dos tablas que se puedan desincronizar.
 */
export const HEREDADOS = ["assistances:write"];

export function normalizarScopes(entrada: unknown): string[] {
  const bruto = Array.isArray(entrada) ? entrada : typeof entrada === "string" ? entrada.split(",") : [];
  const vistos = new Set<string>();
  for (const v of bruto) {
    const s = String(v ?? "").trim().toLowerCase();
    if ((SCOPES as readonly string[]).includes(s) || HEREDADOS.includes(s)) vistos.add(s);
  }
  return [...vistos].sort();
}

/** Los permisos efectivos de una clave, resolviendo las equivalencias. */
export function scopesEfectivos(scopes: unknown): string[] {
  return expandirScopes((Array.isArray(scopes) ? scopes : []).map(String)).sort();
}

/**
 * Cómo sale una credencial por la API: nunca la clave, solo su prefijo.
 *
 * El prefijo (`mkc_live_ab12`) sirve para reconocerla en una lista sin
 * revelarla, igual que los cuatro últimos dígitos de una tarjeta.
 */
export function claveParaApi(k: any) {
  return {
    id: Number(k.id),
    name: k.name ?? "",
    prefix: k.keyPrefix,
    environment: k.environment,
    scopes: JSON.parse(k.scopes || "[]"),
    scopesEfectivos: scopesEfectivos(JSON.parse(k.scopes || "[]")),
    active: !k.revokedAtMs,
    lastUsedAtMs: k.lastUsedAtMs != null ? Number(k.lastUsedAtMs) : null,
    revokedAtMs: k.revokedAtMs != null ? Number(k.revokedAtMs) : null,
    createdAtMs: Number(k.createdAtMs),
  };
}

/** Claves que NUNCA pueden salir en la respuesta de una credencial. */
export const CLAVES_PROHIBIDAS = ["keyHash", "key_hash", "hash", "secret"] as const;

function err(res: Response, status: number, code: string, message: string) {
  return res.status(status).json({ error: { code, message } });
}

function centroDe(req: any): number | null {
  const u = req.connectUser;
  if (!u || u.role === "superadmin") return null;
  return u.controlCenterId;
}

function centroPedido(req: any): number | null {
  const propio = centroDe(req);
  if (propio != null) return propio;
  const pedido = req.query?.controlCenterId ?? req.body?.controlCenterId;
  if (pedido == null || pedido === "") return null;
  const n = Number(pedido);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Carga un partner comprobando el centro en la misma consulta.
 *
 * Devuelve null si no existe **o** si es de otro centro: el mismo 404 para las
 * dos cosas, para no confirmar la existencia de partners ajenos tanteando ids.
 */
async function cargarPartner(id: number, centro: number | null) {
  const r = await db.query(
    `SELECT * FROM connect_partners
      WHERE id = $1 AND ($2::int IS NULL OR "controlCenterId" = $2)`,
    [id, centro],
  );
  return r.rows[0] ?? null;
}

export function createIntegracionesRouter(): Router {
  const router = Router();
  router.use(json({ limit: "1mb" }));

  /* ── Partners de integración ───────────────────────────────────────────── */

  router.get("/partners", ...requireConnectRole("analyst"), async (req, res) => {
    try {
      const centro = centroDe(req);
      const r = await db.query(
        `SELECT p.*,
                (SELECT COUNT(*)::int FROM connect_api_keys k
                  WHERE k."partnerId" = p.id AND k."revokedAtMs" IS NULL) AS "clavesActivas",
                (SELECT MAX(k."lastUsedAtMs") FROM connect_api_keys k
                  WHERE k."partnerId" = p.id) AS "ultimoUso"
           FROM connect_partners p
          WHERE $1::int IS NULL OR p."controlCenterId" = $1
          ORDER BY p.name`,
        [centro],
      );
      res.json({
        data: r.rows.map((p: any) => ({
          id: Number(p.id),
          uuid: p.uuid,
          name: p.name,
          legalName: p.legalName ?? null,
          taxId: p.taxId ?? null,
          contactEmail: p.contactEmail ?? null,
          status: p.status,
          controlCenterId: p.controlCenterId != null ? Number(p.controlCenterId) : null,
          assignmentMode: p.assignmentMode,
          clavesActivas: Number(p.clavesActivas ?? 0),
          ultimoUsoMs: p.ultimoUso != null ? Number(p.ultimoUso) : null,
          createdAtMs: Number(p.createdAtMs),
        })),
      });
    } catch (e: any) {
      console.error("[Connect] GET /integraciones/partners:", e?.message);
      err(res, 500, "internal_error", "Error listando partners de integración");
    }
  });

  router.post("/partners", ...requireConnectRole("cc_admin"), async (req, res) => {
    try {
      const centro = centroPedido(req);
      if (centro == null) {
        return err(res, 422, "control_center_required",
          "Indica la central a la que pertenece el partner");
      }
      const name = String(req.body?.name ?? "").trim();
      if (!name) return err(res, 422, "name_required", "El nombre del partner es obligatorio");

      const now = Date.now();
      const r = await db.query(
        `INSERT INTO connect_partners
           (uuid, name, "legalName", "taxId", "contactEmail", "controlCenterId",
            "assignmentMode", "createdAtMs", "updatedAtMs")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8) RETURNING *`,
        [
          crypto.randomUUID(), name,
          txt(req.body?.legalName), txt(req.body?.taxId), txt(req.body?.contactEmail),
          centro, req.body?.assignmentMode === "auto" ? "auto" : "manual", now,
        ],
      );
      await auditConnect({
        req, action: "integracion.partner_creado", resourceType: "partner",
        resourceId: r.rows[0].id, detail: { name, controlCenterId: centro },
      });
      res.status(201).json({ id: Number(r.rows[0].id), uuid: r.rows[0].uuid, name });
    } catch (e: any) {
      console.error("[Connect] POST /integraciones/partners:", e?.message);
      err(res, 500, "internal_error", "Error creando el partner");
    }
  });

  /* ── Credenciales ──────────────────────────────────────────────────────── */

  router.get("/partners/:id/claves", ...requireConnectRole("cc_admin"), async (req, res) => {
    try {
      const p = await cargarPartner(Number(req.params.id), centroDe(req));
      if (!p) return err(res, 404, "not_found", "Partner no encontrado");
      const r = await db.query(
        `SELECT * FROM connect_api_keys WHERE "partnerId" = $1 ORDER BY id DESC`, [p.id],
      );
      res.json({ data: r.rows.map(claveParaApi) });
    } catch (e: any) {
      console.error("[Connect] GET claves:", e?.message);
      err(res, 500, "internal_error", "Error listando credenciales");
    }
  });

  /**
   * Genera una credencial. **Única respuesta que contiene la clave.**
   *
   * A partir de aquí solo existe su hash; si se pierde, se rota.
   */
  router.post("/partners/:id/claves", ...requireConnectRole("cc_admin"), async (req, res) => {
    try {
      const p = await cargarPartner(Number(req.params.id), centroDe(req));
      if (!p) return err(res, 404, "not_found", "Partner no encontrado");
      if (p.controlCenterId == null) {
        return err(res, 409, "partner_without_center",
          "Este partner no tiene central asignada: una credencial suya dejaría las " +
          "asistencias entrantes sin dueño");
      }

      const scopes = normalizarScopes(req.body?.scopes ?? ["assistances:create", "assistances:read"]);
      if (scopes.length === 0) {
        return err(res, 422, "scopes_required",
          `Indica al menos un permiso: ${SCOPES.join(", ")}`);
      }
      const environment = req.body?.environment === "test" ? "test" : "live";
      const { key, prefix, hash } = generateApiKey(environment);
      const now = Date.now();

      const r = await db.query(
        `INSERT INTO connect_api_keys
           ("partnerId", name, "keyPrefix", "keyHash", scopes, environment, "createdAtMs")
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [p.id, String(req.body?.name ?? "").trim(), prefix, hash, JSON.stringify(scopes), environment, now],
      );

      // Se audita la creación, con el prefijo. NUNCA con la clave.
      await auditConnect({
        req, action: "integracion.clave_generada", resourceType: "api_key",
        resourceId: r.rows[0].id, detail: { partnerId: p.id, prefix, environment, scopes },
      });

      res.status(201).json({
        id: Number(r.rows[0].id),
        api_key: key,
        prefix,
        environment,
        scopes,
        aviso: "Guárdala ahora: no se puede volver a consultar. Si se pierde, hay que rotarla.",
      });
    } catch (e: any) {
      console.error("[Connect] POST clave:", e?.message);
      err(res, 500, "internal_error", "Error generando la credencial");
    }
  });

  /** Revocar: la clave deja de valer inmediatamente y no se puede reactivar. */
  router.delete("/claves/:id", ...requireConnectRole("cc_admin"), async (req, res) => {
    try {
      const k = await cargarClave(Number(req.params.id), centroDe(req));
      if (!k) return err(res, 404, "not_found", "Credencial no encontrada");
      if (k.revokedAtMs) return res.json({ ok: true, yaRevocada: true });

      await db.query(`UPDATE connect_api_keys SET "revokedAtMs" = $2 WHERE id = $1`,
        [k.id, Date.now()]);
      await auditConnect({
        req, action: "integracion.clave_revocada", resourceType: "api_key",
        resourceId: k.id, detail: { partnerId: k.partnerId, prefix: k.keyPrefix },
      });
      res.json({ ok: true });
    } catch (e: any) {
      console.error("[Connect] DELETE clave:", e?.message);
      err(res, 500, "internal_error", "Error revocando la credencial");
    }
  });

  /**
   * Rotar: genera la nueva y revoca la vieja, en una transacción.
   *
   * Las dos cosas juntas o ninguna. Si se generara la nueva y fallara la
   * revocación quedarían dos claves vivas —justo lo que la rotación viene a
   * evitar—; y al revés, el partner se quedaría sin ninguna en mitad de un
   * servicio.
   *
   * `graciaMs` deja la vieja viva un rato para poder desplegar la nueva sin
   * corte. Con 0 se corta en seco, que es lo que se quiere si la clave se ha
   * filtrado.
   */
  router.post("/claves/:id/rotar", ...requireConnectRole("cc_admin"), async (req, res) => {
    const cliente = await db.connect();
    try {
      const k = await cargarClave(Number(req.params.id), centroDe(req));
      if (!k) return err(res, 404, "not_found", "Credencial no encontrada");
      if (k.revokedAtMs) {
        return err(res, 409, "already_revoked", "Esa credencial ya está revocada: genera una nueva");
      }
      const graciaMs = Number(req.body?.graciaMs);
      const gracia = Number.isFinite(graciaMs) && graciaMs > 0 ? Math.min(graciaMs, 86_400_000) : 0;

      const { key, prefix, hash } = generateApiKey(k.environment);
      const now = Date.now();

      await cliente.query("BEGIN");
      const nueva = await cliente.query(
        `INSERT INTO connect_api_keys
           ("partnerId", name, "keyPrefix", "keyHash", scopes, environment, "createdAtMs")
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [k.partnerId, `${k.name || "clave"} (rotada)`, prefix, hash, k.scopes, k.environment, now],
      );
      await cliente.query(
        `UPDATE connect_api_keys SET "revokedAtMs" = $2 WHERE id = $1`,
        [k.id, now + gracia],
      );
      await cliente.query("COMMIT");

      await auditConnect({
        req, action: "integracion.clave_rotada", resourceType: "api_key",
        resourceId: nueva.rows[0].id,
        detail: { anterior: k.id, prefijoAnterior: k.keyPrefix, prefijoNuevo: prefix, graciaMs: gracia },
      });
      res.status(201).json({
        id: Number(nueva.rows[0].id),
        api_key: key,
        prefix,
        environment: k.environment,
        anteriorRevocadaEnMs: now + gracia,
        aviso: gracia > 0
          ? "La credencial anterior seguirá valiendo durante el periodo de gracia."
          : "La credencial anterior ha dejado de valer ahora mismo.",
      });
    } catch (e: any) {
      await cliente.query("ROLLBACK").catch(() => {});
      console.error("[Connect] rotar clave:", e?.message);
      err(res, 500, "internal_error", "Error rotando la credencial");
    } finally {
      cliente.release();
    }
  });

  return router;
}

async function cargarClave(id: number, centro: number | null) {
  const r = await db.query(
    `SELECT k.* FROM connect_api_keys k
       JOIN connect_partners p ON p.id = k."partnerId"
      WHERE k.id = $1 AND ($2::int IS NULL OR p."controlCenterId" = $2)`,
    [id, centro],
  );
  return r.rows[0] ?? null;
}

function txt(v: unknown): string | null {
  const s = v == null ? "" : String(v).trim();
  return s === "" ? null : s;
}

export { sha256 };
