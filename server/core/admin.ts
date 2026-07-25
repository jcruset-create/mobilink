/**
 * SaaS fase 2 — administración de tenants (SuperAdmin Mobilink).
 *
 * CRUD de empresas, centros y licencias sobre las tablas de la fase 1
 * (app_empresas / app_centros / app_licencias), con auditoría de cada
 * mutación. Todas las rutas exigen authenticate + requireSuperadmin.
 *
 * Incluye también el worker diario de caducidad de app_licencias:
 * marca 'caducada' las vencidas y registra avisos a 30/15/5 días.
 */

import { Router } from "express";
import db from "../db.ts";
import { authenticate, requireSuperadmin, registrarAuditoria } from "./auth.ts";

export const MODULOS_VALIDOS = [
  "administracion",
  "tyrecontrol",
  "almacen",
  "sea-core",
  "toolcontrol",
  "safety",
  "presencia",
  "taller",
] as const;

function slugify(nombre: string): string {
  return nombre
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function createAdminRouter(): Router {
  const router = Router();
  router.use(authenticate, requireSuperadmin);

  // ── Empresas ─────────────────────────────────────────────
  router.get("/empresas", async (_req, res) => {
    try {
      const r = await db.query(`
        SELECT e.id, e.nombre, e.slug, e.cif, e.estado, e.created_at,
               count(distinct u.id) AS usuarios,
               count(distinct l.id) FILTER (
                 WHERE l.estado = 'activa'
                   AND l.fecha_inicio <= current_date
                   AND (l.fecha_fin IS NULL OR l.fecha_fin >= current_date)
               ) AS licencias_activas
        FROM app_empresas e
        LEFT JOIN app_usuarios u ON u.empresa_id = e.id AND u.activo
        LEFT JOIN app_licencias l ON l.empresa_id = e.id
        GROUP BY e.id
        ORDER BY e.created_at
      `);
      res.json(r.rows);
    } catch (e) {
      console.error("GET /api/admin/empresas:", e);
      res.status(500).json({ error: "Error cargando empresas" });
    }
  });

  router.post("/empresas", async (req, res) => {
    try {
      const nombre = String(req.body?.nombre || "").trim();
      const cif = String(req.body?.cif || "").trim() || null;
      if (nombre.length < 2) return res.status(400).json({ error: "Nombre demasiado corto" });
      const slug = slugify(String(req.body?.slug || nombre));

      const r = await db.query(
        `INSERT INTO app_empresas (nombre, slug, cif, estado)
         VALUES ($1, $2, $3, 'activa') RETURNING *`,
        [nombre, slug, cif]
      );
      const empresa = r.rows[0];

      // Centro inicial por defecto
      await db.query(
        `INSERT INTO app_centros (empresa_id, nombre) VALUES ($1, $2)`,
        [empresa.id, "Centro principal"]
      );

      void registrarAuditoria({
        empresaId: empresa.id,
        userId: req.authCtx!.userId,
        accion: "admin.empresa.creada",
        entidad: "app_empresas",
        entidadId: empresa.id,
        detalle: { nombre, slug },
        ip: req.ip,
      });
      res.json(empresa);
    } catch (e: any) {
      if (String(e?.message).includes("idx_app_empresas_slug")) {
        return res.status(409).json({ error: "Ya existe una empresa con ese slug" });
      }
      console.error("POST /api/admin/empresas:", e);
      res.status(500).json({ error: "Error creando la empresa" });
    }
  });

  router.patch("/empresas/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const campos: string[] = [];
      const valores: unknown[] = [];
      for (const [campo, col] of [["nombre", "nombre"], ["cif", "cif"], ["estado", "estado"]] as const) {
        if (req.body?.[campo] !== undefined) {
          valores.push(req.body[campo]);
          campos.push(`${col} = $${valores.length}`);
        }
      }
      if (!campos.length) return res.status(400).json({ error: "Nada que actualizar" });
      if (req.body?.estado && !["activa", "suspendida", "prueba"].includes(req.body.estado)) {
        return res.status(400).json({ error: "Estado no válido" });
      }
      valores.push(id);
      const r = await db.query(
        `UPDATE app_empresas SET ${campos.join(", ")}, updated_at = now()
         WHERE id = $${valores.length} RETURNING *`,
        valores
      );
      if (!r.rows.length) return res.status(404).json({ error: "Empresa no encontrada" });

      void registrarAuditoria({
        empresaId: id,
        userId: req.authCtx!.userId,
        accion: "admin.empresa.editada",
        entidad: "app_empresas",
        entidadId: id,
        detalle: req.body,
        ip: req.ip,
      });
      res.json(r.rows[0]);
    } catch (e) {
      console.error("PATCH /api/admin/empresas/:id:", e);
      res.status(500).json({ error: "Error actualizando la empresa" });
    }
  });

  // ── Licencias ────────────────────────────────────────────
  router.get("/empresas/:id/licencias", async (req, res) => {
    try {
      const r = await db.query(
        `SELECT * FROM app_licencias WHERE empresa_id = $1 ORDER BY modulo, fecha_inicio DESC`,
        [req.params.id]
      );
      res.json(r.rows);
    } catch (e) {
      console.error("GET licencias:", e);
      res.status(500).json({ error: "Error cargando licencias" });
    }
  });

  router.post("/empresas/:id/licencias", async (req, res) => {
    try {
      const empresaId = req.params.id;
      const modulo = String(req.body?.modulo || "");
      if (!MODULOS_VALIDOS.includes(modulo as any)) {
        return res.status(400).json({ error: "Módulo no válido" });
      }
      const r = await db.query(
        `INSERT INTO app_licencias
           (empresa_id, modulo, fecha_inicio, fecha_fin, max_usuarios, max_dispositivos, notas)
         VALUES ($1, $2, coalesce($3::date, current_date), $4, $5, $6, $7)
         RETURNING *`,
        [
          empresaId,
          modulo,
          req.body?.fecha_inicio || null,
          req.body?.fecha_fin || null,
          req.body?.max_usuarios ?? null,
          req.body?.max_dispositivos ?? null,
          req.body?.notas ?? null,
        ]
      );
      void registrarAuditoria({
        empresaId,
        userId: req.authCtx!.userId,
        accion: "admin.licencia.creada",
        entidad: "app_licencias",
        entidadId: r.rows[0].id,
        detalle: { modulo, fecha_fin: req.body?.fecha_fin ?? null },
        ip: req.ip,
      });
      res.json(r.rows[0]);
    } catch (e: any) {
      if (String(e?.message).includes("duplicate key")) {
        return res.status(409).json({ error: "Ya existe una licencia de ese módulo con esa fecha de inicio" });
      }
      console.error("POST licencias:", e);
      res.status(500).json({ error: "Error creando la licencia" });
    }
  });

  router.patch("/licencias/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const campos: string[] = [];
      const valores: unknown[] = [];
      for (const campo of ["estado", "fecha_fin", "max_usuarios", "max_dispositivos", "notas"] as const) {
        if (req.body?.[campo] !== undefined) {
          valores.push(req.body[campo]);
          campos.push(`"${campo === "fecha_fin" ? "fecha_fin" : campo}" = $${valores.length}`);
        }
      }
      if (!campos.length) return res.status(400).json({ error: "Nada que actualizar" });
      if (req.body?.estado && !["activa", "caducada", "suspendida", "cancelada"].includes(req.body.estado)) {
        return res.status(400).json({ error: "Estado no válido" });
      }
      valores.push(id);
      const r = await db.query(
        `UPDATE app_licencias SET ${campos.join(", ")}, updated_at = now()
         WHERE id = $${valores.length} RETURNING *`,
        valores
      );
      if (!r.rows.length) return res.status(404).json({ error: "Licencia no encontrada" });

      void registrarAuditoria({
        empresaId: r.rows[0].empresa_id,
        userId: req.authCtx!.userId,
        accion: "admin.licencia.editada",
        entidad: "app_licencias",
        entidadId: id,
        detalle: req.body,
        ip: req.ip,
      });
      res.json(r.rows[0]);
    } catch (e) {
      console.error("PATCH licencias:", e);
      res.status(500).json({ error: "Error actualizando la licencia" });
    }
  });

  // ── Auditoría (consulta) ─────────────────────────────────
  router.get("/empresas/:id/auditoria", async (req, res) => {
    try {
      const r = await db.query(
        `SELECT a.*, u.nombre AS usuario_nombre
         FROM app_auditoria a
         LEFT JOIN app_usuarios u ON u.id = a.user_id
         WHERE a.empresa_id = $1
         ORDER BY a.created_at DESC
         LIMIT 200`,
        [req.params.id]
      );
      res.json(r.rows);
    } catch (e) {
      console.error("GET auditoria:", e);
      res.status(500).json({ error: "Error cargando auditoría" });
    }
  });

  return router;
}

// ── Worker de caducidad de app_licencias ───────────────────
// Diario: marca caducadas las vencidas y deja aviso (30/15/5 días) en
// auditoría, que el dashboard puede mostrar.
async function cicloCaducidad(): Promise<void> {
  try {
    const caducadas = await db.query(`
      UPDATE app_licencias SET estado = 'caducada', updated_at = now()
      WHERE estado = 'activa' AND fecha_fin IS NOT NULL AND fecha_fin < current_date
      RETURNING id, empresa_id, modulo
    `);
    for (const l of caducadas.rows) {
      void registrarAuditoria({
        empresaId: l.empresa_id,
        accion: "licencia.caducada",
        entidad: "app_licencias",
        entidadId: l.id,
        detalle: { modulo: l.modulo },
      });
    }

    const avisos = await db.query(`
      SELECT id, empresa_id, modulo, fecha_fin, (fecha_fin - current_date) AS dias
      FROM app_licencias
      WHERE estado = 'activa' AND fecha_fin IS NOT NULL
        AND (fecha_fin - current_date) IN (30, 15, 5)
    `);
    for (const l of avisos.rows) {
      // Evitar duplicar el aviso del mismo día
      const ya = await db.query(
        `SELECT 1 FROM app_auditoria
         WHERE accion = 'licencia.aviso-caducidad' AND entidad_id = $1
           AND detalle->>'dias' = $2 AND created_at::date = current_date`,
        [String(l.id), String(l.dias)]
      );
      if (ya.rows.length) continue;
      void registrarAuditoria({
        empresaId: l.empresa_id,
        accion: "licencia.aviso-caducidad",
        entidad: "app_licencias",
        entidadId: l.id,
        detalle: { modulo: l.modulo, dias: l.dias, fecha_fin: l.fecha_fin },
      });
    }
    if (caducadas.rows.length || avisos.rows.length) {
      console.log(
        `[licencias-saas] caducadas: ${caducadas.rows.length}, avisos: ${avisos.rows.length}`
      );
    }
  } catch (e) {
    console.error("[licencias-saas] ciclo de caducidad:", e);
  }
}

export function startSaasLicenseWorker(): void {
  void cicloCaducidad(); // al arrancar
  setInterval(() => void cicloCaducidad(), 24 * 60 * 60 * 1000);
}
