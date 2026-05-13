import dotenv from "dotenv";
dotenv.config();
import express from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import multer from "multer";
import { fileURLToPath } from "url";
import db, { initDb } from "./db.ts";
import { supabase, SUPABASE_STORAGE_BUCKET } from "./supabase.ts";
import OpenAI from "openai";
import { findUserByPassword } from "./modules/users";


const app = express();
const PORT = process.env.PORT || 4000;

const RESET_PASSWORD = "sea123";
console.log("KEY:", process.env.OPENAI_API_KEY ? "OK" : "NO CARGADA");
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});
/* =========================================================
   HELPERS
========================================================= */

function safeJsonParse<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string" || value.trim() === "") return fallback;

  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function normalizeTechRow(t: any) {
  return {
    name: t.name,
    status: t.status,
    blocked: !!t.blocked,
    currentJobId: t.currentJobId ?? null,
    competencies: safeJsonParse(t.competencies, {}),
    priorities: safeJsonParse(t.priorities, {}),
    avatar: t.avatar ?? null,
  };
}

function normalizeJobRow(job: any) {
  return {
    ...job,
    urgent: !!job.urgent,
    assignedNames: safeJsonParse(job.assignedNames, [] as string[]),
    startedAtMs: job.startedAtMs ?? null,
    closedAtMs: job.closedAtMs ?? null,
    template: job.template ?? null,
    quickEntryLabel: job.quickEntryLabel ?? null,
    quickEntryMode: job.quickEntryMode ?? null,
    actualMinutes: job.actualMinutes ?? null,
    workedAccumulatedMinutes: job.workedAccumulatedMinutes ?? 0,
    pausedAccumulatedMinutes: job.pausedAccumulatedMinutes ?? 0,
    pausedAtMs: job.pausedAtMs ?? null,
  };
}

function normalizeQuickTemplateRow(t: any) {
  const rawStandardMinutes =
    t.standardMinutes ?? t.standardminutes ?? t.standard_minutes ?? null;

  const standardMinutes =
    rawStandardMinutes === null ||
    rawStandardMinutes === undefined ||
    rawStandardMinutes === ""
      ? null
      : Number(rawStandardMinutes);

  return {
    ...t,
    allowedTechs: safeJsonParse(t.allowedTechs, [] as string[]),
    priorityOrder: safeJsonParse(t.priorityOrder, [] as string[]),
    standardMinutes:
      standardMinutes === null || !Number.isFinite(standardMinutes)
        ? null
        : standardMinutes,
  };
}

/* =========================================================
   PATHS / UPLOADS
========================================================= */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const uploadsDir = path.join(__dirname, "uploads");

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

/* =========================================================
   MIDDLEWARE
========================================================= */

app.use(cors());
app.use(express.json({ limit: "10mb" }));
function requireAdmin(req: express.Request, res: express.Response, next: express.NextFunction) {
  const expectedToken = process.env.ADMIN_TOKEN;
  const token = String(req.headers["x-admin-token"] ?? "");

  if (!expectedToken) {
    return res.status(500).json({
      error: "ADMIN_TOKEN no está configurado",
    });
  }

  if (token !== expectedToken) {
    return res.status(401).json({
      error: "No autorizado",
    });
  }

  next();
}
type UserRole = "admin" | "supervisor" | "pantallas" | "tv75";

function getRoleFromRequest(req: express.Request): UserRole | null {
  const token = String(req.headers["x-admin-token"] ?? "");

  if (process.env.ADMIN_PASSWORD && token === process.env.ADMIN_PASSWORD) {
    return "admin";
  }

  if (
    process.env.SUPERVISOR_PASSWORD &&
    token === process.env.SUPERVISOR_PASSWORD
  ) {
    return "supervisor";
  }

if (
  process.env.SCREENS_PASSWORD &&
  token === process.env.SCREENS_PASSWORD
) {
  return "pantallas";
}
if (
  process.env.TV75_PASSWORD &&
  token === process.env.TV75_PASSWORD
) {
  return "tv75";
}
  return null;
}

function requireRole(allowedRoles: UserRole[]) {
  return (
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) => {
    const role = getRoleFromRequest(req);

    if (!role) {
      return res.status(401).json({
        error: "No autorizado",
      });
    }

    if (!allowedRoles.includes(role)) {
      return res.status(403).json({
        error: "Permisos insuficientes",
      });
    }

    next();
  };
}

const requireAdminRole = requireRole(["admin"]);
const requireSupervisorRole = requireRole(["admin", "supervisor"]);
const requireOperarioRole = requireRole(["admin", "supervisor", "pantallas"]);
app.use((req, _res, next) => {
  console.log(`[REQ] ${req.method} ${req.url}`);
  next();
});

app.use("/uploads", express.static(uploadsDir));

/* =========================================================
   MULTER
========================================================= */

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
});

/* =========================================================
   BASIC
========================================================= */


app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/ai-test", async (req, res) => {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "Eres un asistente técnico." },
        { role: "user", content: "Dime una recomendación de tecnología para un mecánico" }
      ],
    });

    res.json({
      result: response.choices[0].message.content,
    });

  } catch (error) {
    console.error(error);
    res.status(500).send("Error con OpenAI");
  }
});

/* =========================================================
   RESET
========================================================= */

app.post("/api/reset", requireAdminRole, async (req, res) => {
  try {
    const { password } = req.body ?? {};

    if (password !== RESET_PASSWORD) {
      return res.status(401).json({ error: "Contraseña incorrecta" });
    }

   await db.query(`DELETE FROM jobs`);
await db.query(`DELETE FROM logs`);

await db.query(`
  UPDATE techs
  SET
    status = CASE WHEN name = 'Ramón' THEN 'supervisor' ELSE 'disponible' END,
    blocked = false,
    "currentJobId" = NULL
`);

const techsResult = await db.query(`
  SELECT name, status, blocked, "currentJobId", competencies, priorities, avatar
  FROM techs
  ORDER BY id ASC
`);

const techs = techsResult.rows;

    res.json({
      ok: true,
      message: "Sistema reiniciado correctamente",
      techs: techs.map(normalizeTechRow),
    });
  } catch (error) {
    console.error("POST /api/reset error:", error);
    res.status(500).json({ error: "Error reiniciando el sistema" });
  }
});
app.post("/api/ai/taller", async (req, res) => {
  try {
    const { jobs, techs, operationReport, techOperationStats } = req.body;

    const prompt = `
Eres un asistente de asignación para un taller.

Objetivo:
Recomendar el mejor técnico para cada trabajo en espera o activo.

Reglas obligatorias:
- No asignar técnicos bloqueados.
- No asignar técnicos ocupados como responsables.
- Respetar competencias por área y operación.
- Ramón solo como último recurso y con confirmación.
- Proteger técnicos de móvil si quedan pocos libres.
- En trabajos "1 técnico", no proponer apoyo.
- En camión normal, proponer responsable y apoyo si procede.

Datos actuales:
${JSON.stringify({
  waitingJobs: jobs.filter((j: any) => j.status === "espera"),
runningJobs: jobs.filter((j: any) => j.status === "activo"),
techs: techs.map((t: any) => ({
    name: t.name,
    status: t.status,
    blocked: t.blocked,
    currentJobId: t.currentJobId,
    competencies: t.competencies,
    priorities: t.priorities,
  })),
  operationReport,
  techOperationStats,
})}

Responde SOLO en JSON con este formato:
{
  "recommendations": [
    {
      "jobId": 1,
      "plate": "1234ABC",
      "responsable": "José",
      "apoyo": "Iván",
      "confidence": "alta",
      "reason": "Motivo breve"
    }
  ],
  "alerts": [
    "Alerta breve si existe"
  ],
  "summary": "Resumen general breve"
}

No inventes técnicos.
No propongas saltarte reglas.
Si no hay técnico válido, responsable debe ser null.
`;

    const response = await openai.responses.create({
      model: "gpt-4o-mini",
      input: prompt,
    });

    res.json({
      text: response.output_text,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error IA" });
  }
});
/* =========================================================
   TECHS
========================================================= */

app.get("/api/techs", async (_req, res) => {
  try {
    const result = await db.query(`
      SELECT name, status, blocked, "currentJobId", competencies, priorities, avatar
      FROM techs
      ORDER BY id ASC
    `);

    res.json(result.rows.map(normalizeTechRow));
  } catch (error) {
    console.error("GET /api/techs error:", error);
    res.status(500).json({ error: "Error obteniendo técnicos" });
  }
});

app.put("/api/techs/:name", requireAdminRole, async (req, res) => {
  try {
    const name = String(req.params.name);

    const {
      status,
      blocked,
      currentJobId,
      competencies,
      priorities,
      avatar,
      statusChangedAtMs,
      statusTotals,
    } = req.body ?? {};

    const normalizedStatus = status ?? "disponible";

    const protectedStatuses = new Set([
      "nodisponible",
      "vacaciones",
      "baja",
      "permiso",
      "otro_taller",
    ]);

    const normalizedBlocked =
      protectedStatuses.has(normalizedStatus) || Boolean(blocked);

    await db.query(
      `
        INSERT INTO techs (
          name,
          status,
          blocked,
          "currentJobId",
          competencies,
          priorities,
          avatar,
          "statusChangedAtMs",
          "statusTotals"
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (name)
        DO UPDATE SET
          status = EXCLUDED.status,
          blocked = EXCLUDED.blocked,
          "currentJobId" = EXCLUDED."currentJobId",
          competencies = EXCLUDED.competencies,
          priorities = EXCLUDED.priorities,
          avatar = EXCLUDED.avatar,
          "statusChangedAtMs" = EXCLUDED."statusChangedAtMs",
          "statusTotals" = EXCLUDED."statusTotals"
      `,
      [
        name,
        normalizedStatus,
        normalizedBlocked,
        currentJobId ?? null,
        JSON.stringify(competencies ?? {}),
        JSON.stringify(priorities ?? {}),
        avatar ?? null,
        statusChangedAtMs ?? Date.now(),
        JSON.stringify(statusTotals ?? {}),
      ]
    );

    const techResult = await db.query(
      `
        SELECT
          name,
          status,
          blocked,
          "currentJobId",
          competencies,
          priorities,
          avatar,
          "statusChangedAtMs",
          "statusTotals"
        FROM techs
        WHERE name = $1
      `,
      [name]
    );

    const tech = techResult.rows[0];

    res.json(normalizeTechRow(tech));
  } catch (error) {
    console.error("PUT /api/techs/:name error:", error);
    res.status(500).json({ error: "Error actualizando técnico" });
  }
});

app.post(
  "/api/techs/:name/avatar",
  requireAdminRole,
  upload.single("avatar"),
  async (req, res) => {
    try {
      const name = String(req.params.name);

      if (!req.file) {
        return res.status(400).json({ error: "No se recibió archivo" });
      }

      const existsResult = await db.query(
        `SELECT avatar FROM techs WHERE name = $1`,
        [name]
      );

      const exists = existsResult.rows[0];

      if (!exists) {
        return res.status(404).json({ error: "Técnico no encontrado" });
      }

      const safeName = name
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-zA-Z0-9_-]/g, "_");

      const ext = path.extname(req.file.originalname) || ".jpg";
      const filePath = `techs/${safeName}_${Date.now()}${ext}`;

      const { error: uploadError } = await supabase.storage
        .from(SUPABASE_STORAGE_BUCKET)
        .upload(filePath, req.file.buffer, {
          contentType: req.file.mimetype,
          upsert: true,
        });

      if (uploadError) {
        console.error("Supabase Storage upload error:", uploadError);
        return res.status(500).json({ error: "Error subiendo avatar" });
      }

      const { data } = supabase.storage
        .from(SUPABASE_STORAGE_BUCKET)
        .getPublicUrl(filePath);

      const avatarUrl = data.publicUrl;

      await db.query(
        `
          UPDATE techs
          SET avatar = $1
          WHERE name = $2
        `,
        [avatarUrl, name]
      );

      const techResult = await db.query(
        `
          SELECT name, status, blocked, "currentJobId", competencies, priorities, avatar
          FROM techs
          WHERE name = $1
        `,
        [name]
      );

      const tech = techResult.rows[0];

      res.json(normalizeTechRow(tech));
    } catch (error) {
      console.error("POST /api/techs/:name/avatar error:", error);
      res.status(500).json({ error: "Error subiendo avatar" });
    }
  }
);

/* =========================================================
   JOBS
========================================================= */

app.get("/api/jobs", async (_req, res) => {
  try {
    const result = await db.query(`SELECT * FROM jobs ORDER BY id DESC`);
    res.json(result.rows.map(normalizeJobRow));
  } catch (error) {
    console.error("GET /api/jobs error:", error);
    res.status(500).json({ error: "Error obteniendo trabajos" });
  }
});

app.post("/api/jobs", requireSupervisorRole, async (req, res) => {
  try {
    const job = req.body ?? {};

    const safeJobId = job.id ?? Date.now();
    const incomingPlate = String(job.plate ?? "").trim().toUpperCase();

    if (!incomingPlate) {
      res.status(400).json({ error: "La matrícula es obligatoria" });
      return;
    }

    const existingResult = await db.query(
      `
        SELECT id, plate, status
        FROM jobs
        WHERE id = $1
        LIMIT 1
      `,
      [safeJobId]
    );

    if (existingResult.rows.length > 0) {
      const existingJob = existingResult.rows[0];
      const existingPlate = String(existingJob.plate ?? "").trim().toUpperCase();

      if (existingPlate && existingPlate !== incomingPlate) {
        console.error("Intento de sobrescribir trabajo bloqueado:", {
          id: safeJobId,
          existingPlate,
          incomingPlate,
          existingStatus: existingJob.status,
        });

        res.status(409).json({
          error:
            "Conflicto de ID: se ha evitado sobrescribir un trabajo existente",
          id: safeJobId,
          existingPlate,
          incomingPlate,
        });
        return;
      }
    }

    const result = await db.query(
      `
        INSERT INTO jobs (
          id,
          area,
          plate,
          urgent,
          status,
          "assignedNames",
          reason,
          "createdAtMs",
          "startedAtMs",
          "closedAtMs",
          template,
          "quickEntryLabel",
          "quickEntryMode",
          "actualMinutes",
          "workedAccumulatedMinutes",
          "pausedAccumulatedMinutes",
          "pausedAtMs"
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9,
          $10, $11, $12, $13, $14, $15, $16, $17
        )
        ON CONFLICT (id) DO UPDATE SET
          area = EXCLUDED.area,
          plate = EXCLUDED.plate,
          urgent = EXCLUDED.urgent,
          status = EXCLUDED.status,
          "assignedNames" = EXCLUDED."assignedNames",
          reason = EXCLUDED.reason,
          "createdAtMs" = EXCLUDED."createdAtMs",
          "startedAtMs" = EXCLUDED."startedAtMs",
          "closedAtMs" = EXCLUDED."closedAtMs",
          template = EXCLUDED.template,
          "quickEntryLabel" = EXCLUDED."quickEntryLabel",
          "quickEntryMode" = EXCLUDED."quickEntryMode",
          "actualMinutes" = EXCLUDED."actualMinutes",
          "workedAccumulatedMinutes" = EXCLUDED."workedAccumulatedMinutes",
          "pausedAccumulatedMinutes" = EXCLUDED."pausedAccumulatedMinutes",
          "pausedAtMs" = EXCLUDED."pausedAtMs"
        RETURNING *
      `,
      [
        safeJobId,
        job.area,
        incomingPlate,
        !!job.urgent,
        job.status ?? "espera",
        JSON.stringify(Array.isArray(job.assignedNames) ? job.assignedNames : []),
        job.reason ?? "",
        job.createdAtMs ?? Date.now(),
        job.startedAtMs ?? null,
        job.closedAtMs ?? null,
        job.template ?? null,
        job.quickEntryLabel ?? null,
        job.quickEntryMode ?? null,
        job.actualMinutes ?? null,
        job.workedAccumulatedMinutes ?? 0,
        job.pausedAccumulatedMinutes ?? 0,
        job.pausedAtMs ?? null,
      ]
    );

    res.json(normalizeJobRow(result.rows[0]));
  } catch (error) {
    console.error("POST /api/jobs error:", error);
    res.status(500).json({ error: "Error guardando trabajo" });
  }
});

app.post("/api/jobs/:id/finish", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const {
      closedAtMs,
      actualMinutes,
      workedAccumulatedMinutes,
      pausedAccumulatedMinutes,
    } = req.body ?? {};

    await db.query(
  `
    UPDATE jobs
    SET
      status = 'cerrado',
      "closedAtMs" = $1,
      "actualMinutes" = $2,
      "workedAccumulatedMinutes" = $3,
      "pausedAccumulatedMinutes" = $4,
      "pausedAtMs" = NULL
    WHERE id = $5
  `,
  [
    closedAtMs ?? Date.now(),
    actualMinutes ?? null,
    workedAccumulatedMinutes ?? actualMinutes ?? 0,
    pausedAccumulatedMinutes ?? 0,
    id,
  ]
);

    res.json({ ok: true });
  } catch (error) {
    console.error("POST /api/jobs/:id/finish error:", error);
    res.status(500).json({ error: "Error cerrando trabajo" });
  }
});

app.delete("/api/jobs/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);

    await db.query(`DELETE FROM jobs WHERE id = $1`, [id]);

    res.json({ ok: true });
  } catch (error) {
    console.error("DELETE /api/jobs/:id error:", error);
    res.status(500).json({ error: "Error eliminando trabajo" });
  }
});

/* =========================================================
   LOGS
========================================================= */

app.get("/api/logs", async (_req, res) => {
  try {
    const result = await db.query(`SELECT * FROM logs ORDER BY id DESC LIMIT 50`);

    res.json(result.rows);
  } catch (error) {
    console.error("GET /api/logs error:", error);
    res.status(500).json({ error: "Error obteniendo logs" });
  }
});

app.post("/api/logs", async (req, res) => {
  try {
    const log = req.body ?? {};

    await db.query(
      `
        INSERT INTO logs (id, time, text)
        VALUES ($1, $2, $3)
        ON CONFLICT (id) DO UPDATE SET
          time = EXCLUDED.time,
          text = EXCLUDED.text
      `,
      [log.id, log.time, log.text]
    );

    res.json({ ok: true });
  } catch (error) {
    console.error("POST /api/logs error:", error);
    res.status(500).json({ error: "Error guardando log" });
  }
});

/* =========================================================
   RULES
========================================================= */

app.get("/api/rules", async (_req, res) => {
  try {
    const result = await db.query(`SELECT * FROM rules ORDER BY id ASC`);
    res.json(result.rows);
  } catch (error) {
    console.error("GET /api/rules error:", error);
    res.status(500).json({ error: "Error obteniendo reglas" });
  }
});

/* =========================================================
   QUICK TEMPLATES
========================================================= */

app.get("/api/quick-templates", async (_req, res) => {
  try {
    const defaults = [
  {
    key: "alineacion_camion",
    label: "Alineación Camión",
    area: "camion",
    mode: "single",
    allowedTechs: JSON.stringify(["Anthoni", "Alejandro", "José"]),
    priorityOrder: JSON.stringify(["Anthoni", "Alejandro", "José"]),
    standardMinutes: 45,
  },
  {
    key: "pinchazo_camion",
    label: "Pinchazo camión",
    area: "camion",
    mode: "single",
    allowedTechs: JSON.stringify([
      "José",
      "Iván",
      "Alejandro",
      "Jesús",
      "Anthoni",
      "David",
    ]),
    priorityOrder: JSON.stringify([
      "José",
      "Iván",
      "Alejandro",
      "Jesús",
      "Anthoni",
      "David",
    ]),
    standardMinutes: 25,
  },
  {
    key: "cambio_4_neumaticos_camion",
    label: "Cambio de 4 neumáticos de camión",
    area: "camion",
    mode: "team",
    allowedTechs: JSON.stringify([
      "José",
      "Iván",
      "Alejandro",
      "Jesús",
      "Anthoni",
      "David",
    ]),
    priorityOrder: JSON.stringify([
      "José",
      "Iván",
      "Alejandro",
      "Jesús",
      "Anthoni",
      "David",
    ]),
    standardMinutes: 60,
  },
];

    for (const item of defaults) {
      await db.query(
  `
    INSERT INTO quick_templates
    (key, label, area, mode, "allowedTechs", "priorityOrder", "standardMinutes")
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    ON CONFLICT (key) DO UPDATE SET
      label = EXCLUDED.label,
      area = EXCLUDED.area,
      mode = EXCLUDED.mode,
      "allowedTechs" = EXCLUDED."allowedTechs",
      "priorityOrder" = EXCLUDED."priorityOrder",
      "standardMinutes" = EXCLUDED."standardMinutes"
  `,
  [
    item.key,
    item.label,
    item.area,
    item.mode,
    item.allowedTechs,
    item.priorityOrder,
    item.standardMinutes ?? null,
  ]
);
    }

    const result = await db.query(`
      SELECT * FROM quick_templates
      ORDER BY id ASC
    `);

    res.json(result.rows.map(normalizeQuickTemplateRow));
  } catch (error) {
    console.error("GET /api/quick-templates error:", error);
    res.status(500).json({ error: "Error obteniendo entradas rápidas" });
  }
});

app.post("/api/quick-templates", requireSupervisorRole, async (req, res) => {
  try {
    const t = req.body ?? {};

    const result = await db.query(
  `
    INSERT INTO quick_templates
    (key, label, area, mode, "allowedTechs", "priorityOrder", "standardMinutes")
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING *
  `,
  [
    t.key,
    t.label,
    t.area,
    t.mode,
    JSON.stringify(Array.isArray(t.allowedTechs) ? t.allowedTechs : []),
    JSON.stringify(Array.isArray(t.priorityOrder) ? t.priorityOrder : []),
    t.standardMinutes ?? null,
  ]
);

    res.json(normalizeQuickTemplateRow(result.rows[0]));
  } catch (error) {
    console.error("POST /api/quick-templates error:", error);
    res.status(500).json({ error: "Error creando entrada rápida" });
  }
});

app.put("/api/quick-templates/:key", requireSupervisorRole, async (req, res) => {
  try {
    const key = String(req.params.key ?? "");
    const template = req.body ?? {};

    if (!key) {
      res.status(400).json({ error: "Falta la clave de la entrada rápida" });
      return;
    }

    const standardMinutesValue =
      template.standardMinutes === "" ||
      template.standardMinutes === null ||
      template.standardMinutes === undefined
        ? null
        : Number(template.standardMinutes);

    if (
      standardMinutesValue !== null &&
      (!Number.isFinite(standardMinutesValue) || standardMinutesValue < 0)
    ) {
      res.status(400).json({ error: "standardMinutes no es válido" });
      return;
    }

    const result = await db.query(
      `
        UPDATE quick_templates
        SET
          label = $2,
          area = $3,
          mode = $4,
          "allowedTechs" = $5,
          "priorityOrder" = $6,
          "standardMinutes" = $7
        WHERE key = $1
        RETURNING *
      `,
      [
        key,
        template.label ?? "",
        template.area ?? "",
        template.mode ?? "single",
        JSON.stringify(
          Array.isArray(template.allowedTechs) ? template.allowedTechs : []
        ),
        JSON.stringify(
          Array.isArray(template.priorityOrder) ? template.priorityOrder : []
        ),
        standardMinutesValue,
      ]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: "Entrada rápida no encontrada" });
      return;
    }

    res.json(normalizeQuickTemplateRow(result.rows[0]));
  } catch (error) {
    console.error("PUT /api/quick-templates/:key error:", error);
    res.status(500).json({ error: "Error actualizando entrada rápida" });
  }
});

app.delete("/api/quick-templates/:key", requireAdminRole, async (req, res) => {
  try {
    await db.query(`DELETE FROM quick_templates WHERE key = $1`, [
      req.params.key,
    ]);

    res.json({ ok: true });
  } catch (error) {
    console.error("DELETE /api/quick-templates/:key error:", error);
    res.status(500).json({ error: "Error eliminando entrada rápida" });
  }
});

app.get("/api/scheduled-jobs", async (_req, res) => {
  try {
    const result = await db.query(`
      SELECT data
      FROM scheduled_jobs
      ORDER BY id ASC
    `);

    res.json(result.rows.map((row) => row.data));
  } catch (error) {
    console.error("GET /api/scheduled-jobs error:", error);
    res.status(500).json({ error: "Error obteniendo citas programadas" });
  }
});

app.put("/api/scheduled-jobs", async (req, res) => {
  try {
    const items = Array.isArray(req.body) ? req.body : [];

    if (items.length === 0) {
      console.warn(
        "PUT /api/scheduled-jobs recibido vacío. No se borra la agenda por seguridad."
      );

      const current = await db.query(`
        SELECT data
        FROM scheduled_jobs
        ORDER BY id ASC
      `);

      res.json(current.rows.map((row) => row.data));
      return;
    }

    for (const item of items) {
      if (!item || item.id == null) continue;

      await db.query(
        `
          INSERT INTO scheduled_jobs (id, data, "updatedAtMs")
          VALUES ($1, $2, $3)
          ON CONFLICT (id)
          DO UPDATE SET
            data = EXCLUDED.data,
            "updatedAtMs" = EXCLUDED."updatedAtMs"
        `,
        [item.id, JSON.stringify(item), Date.now()]
      );
    }

    const current = await db.query(`
      SELECT data
      FROM scheduled_jobs
      ORDER BY id ASC
    `);

    res.json(current.rows.map((row) => row.data));
  } catch (error) {
    console.error("PUT /api/scheduled-jobs error:", error);
    res.status(500).json({ error: "Error guardando citas programadas" });
  }
});

/* =========================================================
   AUTH
========================================================= */

app.post("/api/login", (req, res) => {
  try {
    const { password } = req.body ?? {};

    const user = findUserByPassword(password);

    if (!user) {
      return res.status(401).json({
        error: "Contraseña incorrecta",
      });
    }

    res.json({
      ok: true,
      role: user.role,
    });
  } catch (error) {
    console.error("POST /api/login error:", error);
    res.status(500).json({ error: "Error iniciando sesión" });
  }
});

/* =========================================================
   BACKUP
========================================================= */

app.get("/api/backup", requireAdminRole, async (req, res) => {
  try {
        const password = String(req.query.password ?? "");
    const expectedPassword = process.env.BACKUP_PASSWORD;

    if (!expectedPassword) {
      return res.status(500).json({
        error: "BACKUP_PASSWORD no está configurada",
      });
    }

    if (password !== expectedPassword) {
      return res.status(401).json({
        error: "Contraseña de backup incorrecta",
      });
    }
    const tables = [
      "techs",
      "jobs",
      "logs",
      "rules",
      "quick_templates",
      "job_assignments",
    ];

    const data: Record<string, unknown[]> = {};

    for (const table of tables) {
      const result = await db.query(`SELECT * FROM ${table} ORDER BY id ASC`);
      data[table] = result.rows;
    }

    const backup = {
      createdAt: new Date().toISOString(),
      source: "sea-tarragona",
      tables: data,
    };

    const timestamp = new Date()
      .toISOString()
      .replace(/:/g, "-")
      .replace(/\..+/, "");

    res.setHeader("Content-Type", "application/json");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="sea-tarragona-backup-${timestamp}.json"`
    );

    res.send(JSON.stringify(backup, null, 2));
  } catch (error) {
    console.error("GET /api/backup error:", error);
    res.status(500).json({ error: "Error creando backup" });
  }
});

/* =========================================================
   FRONTEND REACT / VITE
========================================================= */

app.use(express.static(path.join(__dirname, "../dist")));

app.get(/.*/, (_req, res) => {
  res.sendFile(path.join(__dirname, "../dist/index.html"));
});

/* =========================================================
   404 / ERROR
========================================================= */

app.use((_req, res) => {
  res.status(404).json({ error: "Ruta no encontrada" });
});

app.use(
  (
    error: any,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    console.error("Unhandled server error:", error);
    res.status(500).json({ error: "Error interno del servidor" });
  }
);

/* =========================================================
   START SERVER
========================================================= */
initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Servidor backend en puerto ${PORT}`);
    });
  })
  .catch((error) => {
    console.error("Error inicializando base de datos:", error);
    process.exit(1);
  });