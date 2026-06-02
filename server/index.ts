import dotenv from "dotenv";
dotenv.config();
import express from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import multer from "multer";
import { fileURLToPath } from "url";
import db, { initDb } from "./db.ts";
import { supabase, SUPABASE_STORAGE_BUCKET } from "./supabase.ts";
import OpenAI from "openai";
import { findUserByPassword } from "./modules/users";
import twilio from "twilio";
import Stripe from "stripe";

const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

const app = express();
app.post(
  "/api/stripe/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const sig = req.headers["stripe-signature"];

    try {
      const event = stripe.webhooks.constructEvent(
        req.body,
        sig as string,
        process.env.STRIPE_WEBHOOK_SECRET || ""
      );

      if (event.type === "checkout.session.completed") {
        const session = event.data.object as Stripe.Checkout.Session;

        console.log("✅ STRIPE PAGO COMPLETADO:", {
          sessionId: session.id,
          jobId: session.metadata?.jobId,
          customerName: session.metadata?.customerName,
          amountTotal: session.amount_total,
          paymentStatus: session.payment_status,
        });
        await db.query(
  `
    UPDATE payments
    SET
      status = 'paid',
      amount_cents = $1,
      paid_at_ms = $2,
      stripe_payment_intent_id = $3
    WHERE stripe_session_id = $4
  `,
  [
    session.amount_total ?? 0,
    Date.now(),
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : null,
    session.id,
  ]
);

console.log("✅ PAGO GUARDADO EN PAYMENTS:", {
  reference: session.metadata?.reference || session.metadata?.jobId,
  amount: session.amount_total,
  sessionId: session.id,
});

        const jobId = Number(session.metadata?.jobId);

if (Number.isFinite(jobId)) {
  await db.query(
    `
      UPDATE jobs
      SET
        "depositStatus" = 'paid',
        "depositAmount" = $1,
        "depositPaidAtMs" = $2,
        "stripeSessionId" = $3,
        "stripePaymentIntentId" = $4
      WHERE id = $5
    `,
    [
      session.amount_total ?? 0,
      Date.now(),
      session.id,
      typeof session.payment_intent === "string"
        ? session.payment_intent
        : null,
      jobId,
    ]
  );

  console.log("✅ SEÑAL GUARDADA EN JOB:", {
    jobId,
    amount: session.amount_total,
    sessionId: session.id,
  });
}

        // Aquí después actualizaremos la asistencia como señal pagada
      }

      res.json({ received: true });
    } catch (error: any) {
      console.error("❌ STRIPE WEBHOOK ERROR:", error.message);
      res.status(400).send(`Webhook Error: ${error.message}`);
    }
  }
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.post("/api/payments/create-deposit", async (req, res) => {
  try {
    const { jobId, customerName, customerPhone, amountEuros } = req.body;

    const reference = String(jobId || "").trim();
    const amountCents = Math.round(Number(amountEuros || 0) * 100);

    if (!reference) {
      return res.status(400).json({
        success: false,
        message: "La referencia del cobro es obligatoria",
      });
    }

    if (!amountCents || amountCents < 100) {
      return res.status(400).json({
        success: false,
        message: "El importe mínimo es 1 €",
      });
    }

    const session = await stripe.checkout.sessions.create({
            line_items: [
        {
          price_data: {
            currency: "eur",
            product_data: {
              name: `Paga y señal ${reference}`,
            },
            unit_amount: amountCents,
          },
          quantity: 1,
        },
      ],

      mode: "payment",

      success_url: `${process.env.PUBLIC_APP_URL}/payment-success`,
      cancel_url: `${process.env.PUBLIC_APP_URL}/payment-cancelled`,

      metadata: {
        reference,
        jobId: reference,
        customerName: String(customerName || ""),
        customerPhone: String(customerPhone || ""),
        amountEuros: String(amountEuros || ""),
      },
    });

    await db.query(
      `
        INSERT INTO payments (
          reference,
          customer_name,
          customer_phone,
          amount_cents,
          status,
          stripe_session_id,
          payment_url,
          created_at_ms
        )
        VALUES ($1, $2, $3, $4, 'pending', $5, $6, $7)
      `,
      [
        reference,
        String(customerName || ""),
        String(customerPhone || ""),
        amountCents,
        session.id,
        session.url,
        Date.now(),
      ]
    );

    res.json({
      success: true,
      url: session.url,
      sessionId: session.id,
      reference,
    });
  } catch (error: any) {
    console.error("STRIPE CREATE ERROR:", error);

    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

app.get("/api/payments/deposit-status/:jobId", async (req, res) => {
  try {
    const jobId = Number(req.params.jobId);

    if (!Number.isFinite(jobId)) {
      return res.status(400).json({
        success: false,
        message: "ID asistencia no válido",
      });
    }

    const result = await db.query(
      `
        SELECT
          id,
          plate,
          "depositStatus",
          "depositAmount",
          "depositPaidAtMs",
          "stripeSessionId",
          "stripePaymentIntentId"
        FROM jobs
        WHERE id = $1
      `,
      [jobId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Asistencia no encontrada",
      });
    }

    res.json({
      success: true,
      job: result.rows[0],
    });
  } catch (error: any) {
    console.error("ERROR CONSULTANDO ESTADO PAGO:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

app.get("/api/payments/status/:reference", async (req, res) => {
  try {
    const reference = String(req.params.reference || "").trim();

    if (!reference) {
      return res.status(400).json({
        success: false,
        message: "Referencia no válida",
      });
    }

    const result = await db.query(
      `
        SELECT
          id,
          reference,
          customer_name,
          customer_phone,
          amount_cents,
          status,
          stripe_session_id,
          stripe_payment_intent_id,
          payment_url,
          paid_at_ms,
          created_at_ms
        FROM payments
        WHERE reference = $1
        ORDER BY created_at_ms DESC
        LIMIT 1
      `,
      [reference]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Cobro no encontrado",
      });
    }

    res.json({
      success: true,
      payment: result.rows[0],
    });
  } catch (error: any) {
    console.error("ERROR CONSULTANDO PAYMENT:", error);

    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

app.get("/api/payments/recent", async (_req, res) => {
  try {
    const result = await db.query(
      `
        SELECT
          id,
          reference,
          customer_name,
          customer_phone,
          amount_cents,
          status,
          payment_url,
          paid_at_ms,
          created_at_ms
        FROM payments
        ORDER BY created_at_ms DESC
        LIMIT 25
      `
    );

    res.json({
      success: true,
      payments: result.rows,
    });
  } catch (error: any) {
    console.error("ERROR LISTANDO PAYMENTS:", error);

    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

app.delete("/api/payments/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);

    if (!Number.isFinite(id)) {
      return res.status(400).json({
        success: false,
        message: "ID de cobro no válido",
      });
    }

    const existing = await db.query(
      `
        SELECT id, status
        FROM payments
        WHERE id = $1
      `,
      [id]
    );

    if (existing.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Cobro no encontrado",
      });
    }

    if (existing.rows[0].status === "paid") {
      return res.status(400).json({
        success: false,
        message: "No se puede eliminar un cobro pagado",
      });
    }

    await db.query(
      `
        DELETE FROM payments
        WHERE id = $1
      `,
      [id]
    );

    res.json({
      success: true,
    });
  } catch (error: any) {
    console.error("ERROR ELIMINANDO PAYMENT:", error);

    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

app.post("/api/whatsapp/send-agenda-reminder", async (req, res) => {
  try {
    const {
      customerName,
      customerPhone,
      jobDescription,
      date,
      time,
    } = req.body;

    const message = await twilioClient.messages.create({
  from: process.env.TWILIO_WHATSAPP_FROM || "whatsapp:+34610473079",
  to: `whatsapp:${normalizeSpanishPhone(customerPhone)}`,
  contentSid:
    process.env.TWILIO_CONTENT_SID ||
    "HXdf941b56b6cf5464b5d2b2374171c926",
  contentVariables: JSON.stringify({
    "1": customerName || "cliente",
    "2": jobDescription || "servicio programado",
    "3": req.body.plate || "-",
    "4": date,
    "5": time,
  }),
});

    res.json({
      success: true,
      sid: message.sid,
    });
 } catch (error: any) {
  console.error("ERROR TWILIO:", {
    message: error.message,
    code: error.code,
    status: error.status,
    moreInfo: error.moreInfo,
  });

  res.status(500).json({
    success: false,
    message: error.message,
    code: error.code,
    status: error.status,
    moreInfo: error.moreInfo,
  });
}
});
const PORT = process.env.PORT || 4000;

const RESET_PASSWORD = "sea123";
console.log("KEY:", process.env.OPENAI_API_KEY ? "OK" : "NO CARGADA");
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "", {
  apiVersion: "2026-04-22.dahlia",
});
/* =========================================================
   HELPERS
========================================================= */
/* =========================================================
   HELPERS
========================================================= */

function normalizeSpanishPhone(phone: string) {
  const digits = String(phone || "").replace(/\D/g, "");

  if (!digits) return "";

  if (digits.startsWith("34") && digits.length === 11) {
    return `+${digits}`;
  }

  if (digits.length === 9) {
    return `+34${digits}`;
  }

  if (String(phone).trim().startsWith("+")) {
    return String(phone).trim();
  }

  return `+${digits}`;
}
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
    depositStatus: job.depositStatus ?? "none",
depositAmount: job.depositAmount ?? 0,
depositPaidAtMs: job.depositPaidAtMs ?? null,
stripeSessionId: job.stripeSessionId ?? null,
stripePaymentIntentId: job.stripePaymentIntentId ?? null,
  };
}

const ROADSIDE_ASSISTANCE_STATUSES = new Set([
  "pendiente",
  "asignada",
  "en_camino",
  "en_punto",
  "finalizada",
  "llegada_taller",
  "cancelada",
]);

const ROADSIDE_ASSISTANCE_PRIORITIES = new Set(["normal", "urgente"]);

function normalizeRoadsideAssistanceStatus(value: unknown) {
  const status = String(value || "").trim().toLowerCase();
  return ROADSIDE_ASSISTANCE_STATUSES.has(status) ? status : "pendiente";
}

function normalizeRoadsideAssistancePriority(value: unknown) {
  const priority = String(value || "").trim().toLowerCase();
  return ROADSIDE_ASSISTANCE_PRIORITIES.has(priority) ? priority : "normal";
}

function normalizeNullableNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;

  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function normalizeRoadsideAssistanceRow(row: any) {
  return {
    id: Number(row.id),
    workshopId: row.workshopId ?? null,
    status: normalizeRoadsideAssistanceStatus(row.status),
    priority: normalizeRoadsideAssistancePriority(row.priority),
    customerName: row.customerName ?? "",
    customerPhone: row.customerPhone ?? "",
    address: row.address ?? "",
    googleMapsUrl: row.googleMapsUrl ?? null,
    latitude: normalizeNullableNumber(row.latitude),
    longitude: normalizeNullableNumber(row.longitude),
    plate: row.plate ?? "",
    vehicleDescription: row.vehicleDescription ?? null,
    webfleetVehicleId: row.webfleetVehicleId ?? null,
    assignedTechName: row.assignedTechName ?? null,
    assignedVehicleName: row.assignedVehicleName ?? null,
    trackingToken: row.trackingToken ?? "",
    trackingWhatsappSentAtMs: row.trackingWhatsappSentAtMs ?? null,
    trackingWhatsappSid: row.trackingWhatsappSid ?? null,
    notes: row.notes ?? null,
    createdAtMs: Number(row.createdAtMs ?? Date.now()),
    assignedAtMs: row.assignedAtMs ?? null,
    departedAtMs: row.departedAtMs ?? null,
    arrivedAtPointMs: row.arrivedAtPointMs ?? null,
    finishedAtMs: row.finishedAtMs ?? null,
    arrivedAtWorkshopMs: row.arrivedAtWorkshopMs ?? null,
    cancelledAtMs: row.cancelledAtMs ?? null,
    updatedAtMs: Number(row.updatedAtMs ?? Date.now()),
  };
}

function normalizeRoadsideVehicleRow(row: any) {
  return {
    id: Number(row.id),
    workshopId: row.workshopId ?? null,
    name: row.name ?? "",
    plate: row.plate ?? null,
    webfleetVehicleId: row.webfleetVehicleId ?? null,
    notes: row.notes ?? null,
    active: row.active !== false,
    createdAtMs: Number(row.createdAtMs ?? Date.now()),
    updatedAtMs: Number(row.updatedAtMs ?? Date.now()),
  };
}

function getRoadsideStatusTimestampField(status: string) {
  if (status === "asignada") return "assignedAtMs";
  if (status === "en_camino") return "departedAtMs";
  if (status === "en_punto") return "arrivedAtPointMs";
  if (status === "finalizada") return "finishedAtMs";
  if (status === "llegada_taller") return "arrivedAtWorkshopMs";
  if (status === "cancelada") return "cancelledAtMs";
  return null;
}

function getWhatsAppFromNumber() {
  return (
    process.env.TWILIO_WHATSAPP_FROM ||
    process.env.TWILIO_WHATSAPP_NUMBER ||
    "whatsapp:+34610473079"
  );
}

function getPublicAppBaseUrl(req: express.Request, preferredUrl?: unknown) {
  const preferred = String(preferredUrl || "").trim();

  if (/^https?:\/\//i.test(preferred)) {
    return preferred.replace(/\/+$/, "");
  }

  const configured = String(process.env.PUBLIC_APP_URL || "").trim();

  if (
    /^https?:\/\//i.test(configured) &&
    !configured.includes("tu-app.onrender.com")
  ) {
    return configured.replace(/\/+$/, "");
  }

  return `${req.protocol}://${req.get("host")}`.replace(/\/+$/, "");
}

function buildRoadsideTrackingUrl(
  req: express.Request,
  assistance: { trackingToken?: string },
  preferredBaseUrl?: unknown
) {
  return `${getPublicAppBaseUrl(req, preferredBaseUrl)}/seguimiento/${
    assistance.trackingToken
  }`;
}

function buildRoadsideTrackingMessage(assistance: any, trackingUrl: string) {
  const customerName = assistance.customerName || "cliente";
  const plate = assistance.plate || assistance.vehicleDescription || "vehiculo";
  const techLine = assistance.assignedTechName
    ? `Operario asignado: ${assistance.assignedTechName}.\n`
    : "";

  return (
    `Hola ${customerName},\n\n` +
    `Tu asistencia de SEA Tarragona para ${plate} esta registrada.\n` +
    techLine +
    `Puedes seguir el estado aqui:\n${trackingUrl}\n\n` +
    `Gracias.`
  );
}

async function sendRoadsideTrackingWhatsApp(
  req: express.Request,
  assistance: any,
  preferredBaseUrl?: unknown
) {
  const customerPhone = String(assistance.customerPhone || "").trim();

  if (!customerPhone) {
    throw new Error("La asistencia no tiene telefono de cliente.");
  }

  const trackingUrl = buildRoadsideTrackingUrl(
    req,
    assistance,
    preferredBaseUrl
  );

  const contentSid = String(
    process.env.TWILIO_ROADSIDE_CONTENT_SID || ""
  ).trim();

  if (contentSid) {
    return twilioClient.messages.create({
      from: getWhatsAppFromNumber(),
      to: `whatsapp:${normalizeSpanishPhone(customerPhone)}`,
      contentSid,
      contentVariables: JSON.stringify({
        "1": assistance.customerName || "cliente",
        "2": assistance.plate || assistance.vehicleDescription || "vehiculo",
        "3": trackingUrl,
        "4": assistance.assignedTechName || "-",
      }),
    });
  }

  return twilioClient.messages.create({
    from: getWhatsAppFromNumber(),
    to: `whatsapp:${normalizeSpanishPhone(customerPhone)}`,
    body: buildRoadsideTrackingMessage(assistance, trackingUrl),
  });
}

function normalizeQuickTemplateRow(t: any) {
  const rawMinutes = t.standardMinutes ?? t.standardminutes ?? null;
  const rawUnitMinutes = t.unitMinutes ?? t.unitminutes ?? null;
  const rawUnitPrice = t.unitPrice ?? t.unitprice ?? null;

  const standardMinutes =
    rawMinutes == null || rawMinutes === "" ? null : Number(rawMinutes);

  const unitMinutes =
    rawUnitMinutes == null || rawUnitMinutes === ""
      ? null
      : Number(rawUnitMinutes);

  const unitPrice =
    rawUnitPrice == null || rawUnitPrice === "" ? null : Number(rawUnitPrice);

  const usesQuantity =
    t.usesQuantity === true ||
    t.usesQuantity === "true" ||
    t.usesquantity === true ||
    t.usesquantity === "true";

  return {
    ...t,
    allowedTechs: safeJsonParse(t.allowedTechs, []),
    priorityOrder: safeJsonParse(t.priorityOrder, []),
    standardMinutes: Number.isFinite(standardMinutes)
      ? standardMinutes
      : null,
    usesQuantity,
    unitMinutes: Number.isFinite(unitMinutes) ? unitMinutes : null,
    unitPrice: Number.isFinite(unitPrice) ? unitPrice : null,
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

function getRoadsideOperatorCode() {
  return (
    process.env.ROADSIDE_OPERATOR_CODE ||
    process.env.APP_PASSWORD ||
    process.env.ADMIN_TOKEN ||
    ""
  );
}

function normalizeRoadsideOperatorCodeRow(row: any) {
  const code = String(row.roadsideOperatorCode || "").trim();

  return {
    techName: row.name ?? "",
    code,
    hasCustomCode: Boolean(code),
  };
}

async function getExpectedRoadsideOperatorCode(techName: string) {
  const result = await db.query(
    `
      SELECT name, "roadsideOperatorCode"
      FROM techs
      WHERE name = $1
      LIMIT 1
    `,
    [techName]
  );

  if (result.rows.length === 0) {
    return null;
  }

  return String(
    result.rows[0].roadsideOperatorCode || getRoadsideOperatorCode() || ""
  ).trim();
}

async function getRoadsideOperatorFromRequest(req: express.Request) {
  const techName = String(req.headers["x-roadside-operator-name"] ?? "").trim();
  const code = String(req.headers["x-roadside-operator-code"] ?? "").trim();
  const expectedCode = await getExpectedRoadsideOperatorCode(techName);

  if (!techName || !code || !expectedCode || code !== expectedCode) {
    return null;
  }

  return {
    techName,
  };
}

function requireRoadsideOperator(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) {
  void (async () => {
    const operator = await getRoadsideOperatorFromRequest(req);

    if (!operator) {
      return res.status(401).json({
        error: "Operario no autorizado",
      });
    }

    (req as any).roadsideOperator = operator;
    next();
  })().catch((error) => {
    console.error("requireRoadsideOperator error:", error);
    res.status(500).json({ error: "Error validando operario" });
  });
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
    fileSize: 10 * 1024 * 1024,
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

await ensureMaintenanceTables();

await db.query(`DELETE FROM assigned_maintenance_tasks`);

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
    const assignedNames = Array.isArray(job.assignedNames)
  ? job.assignedNames.map((name: unknown) => String(name || "").trim()).filter(Boolean)
  : [];

const blockedOutsideMaintenanceTechNames =
  await getBlockedOutsideMaintenanceTechNames(assignedNames);

if (blockedOutsideMaintenanceTechNames.length > 0) {
  return res.status(409).json({
    error:
      "Asignación bloqueada: técnico en mantenimiento fuera de taller",
    blockedTechNames: blockedOutsideMaintenanceTechNames,
  });
}

const interruptedMaintenanceTasks =
  await interruptWorkshopMaintenanceForTechs(assignedNames);

if (interruptedMaintenanceTasks.length > 0) {
  console.log("Mantenimiento en taller interrumpido por trabajo real:", {
    assignedNames,
    interruptedMaintenanceTasks: interruptedMaintenanceTasks.map((task) => ({
      id: task.id,
      taskLabel: task.taskLabel,
      techName: task.techName,
    })),
  });
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
        JSON.stringify(assignedNames),
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


app.put("/api/jobs/:id", requireSupervisorRole, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const job = req.body ?? {};

    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: "ID de trabajo no válido" });
    }

    const incomingPlate = String(job.plate ?? "").trim().toUpperCase();

    if (!incomingPlate) {
      return res.status(400).json({ error: "La matrícula es obligatoria" });
    }

    const assignedNames = Array.isArray(job.assignedNames)
      ? job.assignedNames
          .map((name: unknown) => String(name || "").trim())
          .filter(Boolean)
      : [];

    const blockedOutsideMaintenanceTechNames =
      await getBlockedOutsideMaintenanceTechNames(assignedNames);

    if (blockedOutsideMaintenanceTechNames.length > 0) {
      return res.status(409).json({
        error: "Asignación bloqueada: técnico en mantenimiento fuera de taller",
        blockedTechNames: blockedOutsideMaintenanceTechNames,
      });
    }

    const interruptedMaintenanceTasks =
      await interruptWorkshopMaintenanceForTechs(assignedNames);

    if (interruptedMaintenanceTasks.length > 0) {
      console.log(
        "Mantenimiento en taller interrumpido por actualización de trabajo:",
        {
          jobId: id,
          assignedNames,
          interruptedMaintenanceTasks: interruptedMaintenanceTasks.map(
            (task) => ({
              id: task.id,
              taskLabel: task.taskLabel,
              techName: task.techName,
            })
          ),
        }
      );
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
        id,
        job.area,
        incomingPlate,
        !!job.urgent,
        job.status ?? "espera",
        JSON.stringify(assignedNames),
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
    console.error("PUT /api/jobs/:id error:", error);
    res.status(500).json({ error: "Error actualizando trabajo" });
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
   ROADSIDE ASSISTANCES
========================================================= */

app.get("/api/roadside-vehicles", async (req, res) => {
  try {
    const includeInactive = String(req.query.includeInactive || "") === "true";

    const result = await db.query(`
      SELECT *
      FROM roadside_vehicles
      ${includeInactive ? "" : "WHERE active = true"}
      ORDER BY active DESC, name ASC
    `);

    res.json(result.rows.map(normalizeRoadsideVehicleRow));
  } catch (error) {
    console.error("GET /api/roadside-vehicles error:", error);
    res.status(500).json({ error: "Error obteniendo furgonetas" });
  }
});

app.post("/api/roadside-vehicles", requireAdminRole, async (req, res) => {
  try {
    const body = req.body ?? {};
    const now = Date.now();
    const name = String(body.name || "").trim();

    if (!name) {
      return res.status(400).json({ error: "El nombre es obligatorio" });
    }

    const result = await db.query(
      `
        INSERT INTO roadside_vehicles (
          "workshopId",
          name,
          plate,
          "webfleetVehicleId",
          notes,
          active,
          "createdAtMs",
          "updatedAtMs"
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
        RETURNING *
      `,
      [
        body.workshopId ?? null,
        name,
        body.plate ? String(body.plate).trim().toUpperCase() : null,
        body.webfleetVehicleId ? String(body.webfleetVehicleId).trim() : null,
        body.notes ? String(body.notes).trim() : null,
        body.active !== false,
        now,
      ]
    );

    res.json(normalizeRoadsideVehicleRow(result.rows[0]));
  } catch (error) {
    console.error("POST /api/roadside-vehicles error:", error);
    res.status(500).json({ error: "Error creando furgoneta" });
  }
});

app.put("/api/roadside-vehicles/:id", requireAdminRole, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const body = req.body ?? {};
    const now = Date.now();
    const name = String(body.name || "").trim();

    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: "ID de furgoneta no valido" });
    }

    if (!name) {
      return res.status(400).json({ error: "El nombre es obligatorio" });
    }

    const result = await db.query(
      `
        UPDATE roadside_vehicles
        SET
          "workshopId" = $2,
          name = $3,
          plate = $4,
          "webfleetVehicleId" = $5,
          notes = $6,
          active = $7,
          "updatedAtMs" = $8
        WHERE id = $1
        RETURNING *
      `,
      [
        id,
        body.workshopId ?? null,
        name,
        body.plate ? String(body.plate).trim().toUpperCase() : null,
        body.webfleetVehicleId ? String(body.webfleetVehicleId).trim() : null,
        body.notes ? String(body.notes).trim() : null,
        body.active !== false,
        now,
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Furgoneta no encontrada" });
    }

    res.json(normalizeRoadsideVehicleRow(result.rows[0]));
  } catch (error) {
    console.error("PUT /api/roadside-vehicles/:id error:", error);
    res.status(500).json({ error: "Error actualizando furgoneta" });
  }
});

app.delete(
  "/api/roadside-vehicles/:id",
  requireAdminRole,
  async (req, res) => {
    try {
      const id = Number(req.params.id);

      if (!Number.isFinite(id)) {
        return res.status(400).json({ error: "ID de furgoneta no valido" });
      }

      const result = await db.query(
        `
          UPDATE roadside_vehicles
          SET
            active = false,
            "updatedAtMs" = $2
          WHERE id = $1
          RETURNING *
        `,
        [id, Date.now()]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Furgoneta no encontrada" });
      }

      res.json(normalizeRoadsideVehicleRow(result.rows[0]));
    } catch (error) {
      console.error("DELETE /api/roadside-vehicles/:id error:", error);
      res.status(500).json({ error: "Error desactivando furgoneta" });
    }
  }
);

app.get("/api/roadside-assistances", async (req, res) => {
  try {
    const includeClosed = String(req.query.includeClosed || "") === "true";

    const result = await db.query(`
      SELECT *
      FROM roadside_assistances
      ${
        includeClosed
          ? ""
          : `WHERE status NOT IN ('llegada_taller', 'cancelada')`
      }
      ORDER BY "createdAtMs" DESC
      LIMIT 200
    `);

    res.json(result.rows.map(normalizeRoadsideAssistanceRow));
  } catch (error) {
    console.error("GET /api/roadside-assistances error:", error);
    res.status(500).json({ error: "Error obteniendo asistencias" });
  }
});

app.get("/api/roadside-tracking/:token", async (req, res) => {
  try {
    const token = String(req.params.token || "").trim();

    if (!token) {
      return res.status(400).json({ error: "Token de seguimiento no valido" });
    }

    const assistanceResult = await db.query(
      `
        SELECT *
        FROM roadside_assistances
        WHERE "trackingToken" = $1
        LIMIT 1
      `,
      [token]
    );

    if (assistanceResult.rows.length === 0) {
      return res.status(404).json({ error: "Seguimiento no encontrado" });
    }

    const assistance = normalizeRoadsideAssistanceRow(
      assistanceResult.rows[0]
    );

    const eventsResult = await db.query(
      `
        SELECT status, "createdAtMs"
        FROM roadside_assistance_events
        WHERE "assistanceId" = $1
        ORDER BY "createdAtMs" ASC
      `,
      [assistance.id]
    );

    res.json({
      assistance,
      events: eventsResult.rows,
      expired:
        assistance.status === "llegada_taller" ||
        assistance.status === "cancelada",
    });
  } catch (error) {
    console.error("GET /api/roadside-tracking/:token error:", error);
    res.status(500).json({ error: "Error obteniendo seguimiento" });
  }
});

app.get(
  "/api/roadside-operator-codes",
  requireAdminRole,
  async (_req, res) => {
    try {
      const result = await db.query(`
        SELECT name, "roadsideOperatorCode"
        FROM techs
        ORDER BY id ASC
      `);

      res.json(result.rows.map(normalizeRoadsideOperatorCodeRow));
    } catch (error) {
      console.error("GET /api/roadside-operator-codes error:", error);
      res.status(500).json({ error: "Error obteniendo codigos de operario" });
    }
  }
);

app.put(
  "/api/roadside-operator-codes/:name",
  requireAdminRole,
  async (req, res) => {
    try {
      const name = String(req.params.name || "").trim();
      const code = String(req.body?.code || "").trim();

      if (!name) {
        return res.status(400).json({ error: "Operario no valido" });
      }

      if (!code || code.length < 4) {
        return res.status(400).json({
          error: "El codigo debe tener al menos 4 caracteres",
        });
      }

      const result = await db.query(
        `
          UPDATE techs
          SET "roadsideOperatorCode" = $2
          WHERE name = $1
          RETURNING name, "roadsideOperatorCode"
        `,
        [name, code]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Operario no encontrado" });
      }

      res.json(normalizeRoadsideOperatorCodeRow(result.rows[0]));
    } catch (error) {
      console.error("PUT /api/roadside-operator-codes/:name error:", error);
      res.status(500).json({ error: "Error guardando codigo de operario" });
    }
  }
);

app.post("/api/roadside-operator/login", async (req, res) => {
  try {
    const techName = String(req.body?.techName || "").trim();
    const code = String(req.body?.code || "").trim();
    const expectedCode = await getExpectedRoadsideOperatorCode(techName);

    if (!techName || !code || !expectedCode || code !== expectedCode) {
      return res.status(401).json({
        error: "Operario o codigo incorrecto",
      });
    }

    const techResult = await db.query(
      `
        SELECT name
        FROM techs
        WHERE name = $1
        LIMIT 1
      `,
      [techName]
    );

    if (techResult.rows.length === 0) {
      return res.status(404).json({
        error: "Operario no encontrado",
      });
    }

    res.json({
      ok: true,
      techName,
    });
  } catch (error) {
    console.error("POST /api/roadside-operator/login error:", error);
    res.status(500).json({ error: "Error iniciando sesion operario" });
  }
});

app.get(
  "/api/roadside-operator/assistances",
  requireRoadsideOperator,
  async (req, res) => {
    try {
      const operator = (req as any).roadsideOperator as { techName: string };
      const includeClosed = String(req.query.includeClosed || "") === "true";

      const result = await db.query(
        `
          SELECT *
          FROM roadside_assistances
          WHERE "assignedTechName" = $1
          ${
            includeClosed
              ? ""
              : `AND status NOT IN ('llegada_taller', 'cancelada')`
          }
          ORDER BY "createdAtMs" DESC
          LIMIT 100
        `,
        [operator.techName]
      );

      res.json(result.rows.map(normalizeRoadsideAssistanceRow));
    } catch (error) {
      console.error("GET /api/roadside-operator/assistances error:", error);
      res.status(500).json({ error: "Error obteniendo asistencias operario" });
    }
  }
);

app.post(
  "/api/roadside-operator/assistances/:id/status",
  requireRoadsideOperator,
  async (req, res) => {
    try {
      const operator = (req as any).roadsideOperator as { techName: string };
      const id = Number(req.params.id);
      const now = Date.now();
      const status = normalizeRoadsideAssistanceStatus(req.body?.status);
      const allowedStatuses = new Set([
        "en_camino",
        "en_punto",
        "finalizada",
        "llegada_taller",
      ]);

      if (!Number.isFinite(id)) {
        return res.status(400).json({ error: "ID de asistencia no valido" });
      }

      if (!allowedStatuses.has(status)) {
        return res.status(400).json({
          error: "Estado no permitido para operario",
        });
      }

      const currentResult = await db.query(
        `
          SELECT id, "assignedTechName"
          FROM roadside_assistances
          WHERE id = $1
          LIMIT 1
        `,
        [id]
      );

      if (currentResult.rows.length === 0) {
        return res.status(404).json({ error: "Asistencia no encontrada" });
      }

      if (currentResult.rows[0].assignedTechName !== operator.techName) {
        return res.status(403).json({
          error: "Esta asistencia no esta asignada a este operario",
        });
      }

      const timestampField = getRoadsideStatusTimestampField(status);

      const result = await db.query(
        `
          UPDATE roadside_assistances
          SET
            status = $2,
            "updatedAtMs" = $3
            ${
              timestampField
                ? `, "${timestampField}" = COALESCE("${timestampField}", $3)`
                : ""
            }
          WHERE id = $1
          RETURNING *
        `,
        [id, status, now]
      );

      await db.query(
        `
          INSERT INTO roadside_assistance_events (
            "assistanceId",
            status,
            note,
            "createdBy",
            "createdAtMs"
          )
          VALUES ($1, $2, $3, $4, $5)
        `,
        [
          id,
          status,
          req.body?.note ? String(req.body.note).trim() : null,
          operator.techName,
          now,
        ]
      );

      res.json(normalizeRoadsideAssistanceRow(result.rows[0]));
    } catch (error) {
      console.error("POST /api/roadside-operator/assistances/:id/status error:", error);
      res.status(500).json({ error: "Error cambiando estado operario" });
    }
  }
);

app.get("/api/roadside-assistances/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);

    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: "ID de asistencia no valido" });
    }

    const assistanceResult = await db.query(
      `
        SELECT *
        FROM roadside_assistances
        WHERE id = $1
      `,
      [id]
    );

    if (assistanceResult.rows.length === 0) {
      return res.status(404).json({ error: "Asistencia no encontrada" });
    }

    const eventsResult = await db.query(
      `
        SELECT *
        FROM roadside_assistance_events
        WHERE "assistanceId" = $1
        ORDER BY "createdAtMs" ASC
      `,
      [id]
    );

    const filesResult = await db.query(
      `
        SELECT *
        FROM roadside_assistance_files
        WHERE "assistanceId" = $1
        ORDER BY "createdAtMs" ASC
      `,
      [id]
    );

    res.json({
      assistance: normalizeRoadsideAssistanceRow(assistanceResult.rows[0]),
      events: eventsResult.rows,
      files: filesResult.rows,
    });
  } catch (error) {
    console.error("GET /api/roadside-assistances/:id error:", error);
    res.status(500).json({ error: "Error obteniendo asistencia" });
  }
});

app.post("/api/roadside-assistances", requireSupervisorRole, async (req, res) => {
  try {
    const body = req.body ?? {};
    const now = Date.now();
    const customerName = String(body.customerName || "").trim();
    const customerPhone = String(body.customerPhone || "").trim();
    const address = String(body.address || "").trim();
    const googleMapsUrl = String(body.googleMapsUrl || "").trim();
    const latitude = normalizeNullableNumber(body.latitude);
    const longitude = normalizeNullableNumber(body.longitude);
    const assignedTechName = String(body.assignedTechName || "").trim();
    const incomingStatus = body.status
      ? normalizeRoadsideAssistanceStatus(body.status)
      : assignedTechName
        ? "asignada"
        : "pendiente";
    const timestampField = getRoadsideStatusTimestampField(incomingStatus);

    if (!customerName && !customerPhone) {
      return res.status(400).json({
        error: "Indica cliente o telefono para crear la asistencia",
      });
    }

    if (!address && !googleMapsUrl && latitude == null && longitude == null) {
      return res.status(400).json({
        error: "Indica direccion, enlace de Google Maps o coordenadas",
      });
    }

    const result = await db.query(
      `
        INSERT INTO roadside_assistances (
          "workshopId",
          status,
          priority,
          "customerName",
          "customerPhone",
          address,
          "googleMapsUrl",
          latitude,
          longitude,
          plate,
          "vehicleDescription",
          "webfleetVehicleId",
          "assignedTechName",
          "assignedVehicleName",
          "trackingToken",
          notes,
          "createdAtMs",
          "assignedAtMs",
          "departedAtMs",
          "arrivedAtPointMs",
          "finishedAtMs",
          "arrivedAtWorkshopMs",
          "cancelledAtMs",
          "updatedAtMs"
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8,
          $9, $10, $11, $12, $13, $14, $15, $16,
          $17, $18, $19, $20, $21, $22, $23, $24
        )
        RETURNING *
      `,
      [
        body.workshopId ?? null,
        incomingStatus,
        normalizeRoadsideAssistancePriority(body.priority),
        customerName,
        customerPhone,
        address,
        googleMapsUrl || null,
        latitude,
        longitude,
        String(body.plate || "").trim().toUpperCase(),
        body.vehicleDescription ? String(body.vehicleDescription).trim() : null,
        body.webfleetVehicleId ? String(body.webfleetVehicleId).trim() : null,
        assignedTechName || null,
        body.assignedVehicleName ? String(body.assignedVehicleName).trim() : null,
        crypto.randomUUID(),
        body.notes ? String(body.notes).trim() : null,
        now,
        timestampField === "assignedAtMs" ? now : null,
        timestampField === "departedAtMs" ? now : null,
        timestampField === "arrivedAtPointMs" ? now : null,
        timestampField === "finishedAtMs" ? now : null,
        timestampField === "arrivedAtWorkshopMs" ? now : null,
        timestampField === "cancelledAtMs" ? now : null,
        now,
      ]
    );

    const assistance = normalizeRoadsideAssistanceRow(result.rows[0]);

    await db.query(
      `
        INSERT INTO roadside_assistance_events (
          "assistanceId",
          status,
          note,
          "createdBy",
          "createdAtMs"
        )
        VALUES ($1, $2, $3, $4, $5)
      `,
      [
        assistance.id,
        assistance.status,
        "Asistencia creada desde oficina",
        body.createdBy ?? "oficina",
        now,
      ]
    );

    res.json(assistance);
  } catch (error) {
    console.error("POST /api/roadside-assistances error:", error);
    res.status(500).json({ error: "Error creando asistencia" });
  }
});

app.put("/api/roadside-assistances/:id", requireSupervisorRole, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const body = req.body ?? {};
    const now = Date.now();

    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: "ID de asistencia no valido" });
    }

    const status = normalizeRoadsideAssistanceStatus(body.status);
    const timestampField = getRoadsideStatusTimestampField(status);

    const existingResult = await db.query(
      `
        SELECT status
        FROM roadside_assistances
        WHERE id = $1
        LIMIT 1
      `,
      [id]
    );

    if (existingResult.rows.length === 0) {
      return res.status(404).json({ error: "Asistencia no encontrada" });
    }

    const previousStatus = normalizeRoadsideAssistanceStatus(
      existingResult.rows[0].status
    );

    const result = await db.query(
      `
        UPDATE roadside_assistances
        SET
          "workshopId" = $2,
          status = $3,
          priority = $4,
          "customerName" = $5,
          "customerPhone" = $6,
          address = $7,
          "googleMapsUrl" = $8,
          latitude = $9,
          longitude = $10,
          plate = $11,
          "vehicleDescription" = $12,
          "webfleetVehicleId" = $13,
          "assignedTechName" = $14,
          "assignedVehicleName" = $15,
          notes = $16,
          "updatedAtMs" = $17
          ${
            timestampField
              ? `, "${timestampField}" = COALESCE("${timestampField}", $17)`
              : ""
          }
        WHERE id = $1
        RETURNING *
      `,
      [
        id,
        body.workshopId ?? null,
        status,
        normalizeRoadsideAssistancePriority(body.priority),
        String(body.customerName || "").trim(),
        String(body.customerPhone || "").trim(),
        String(body.address || "").trim(),
        body.googleMapsUrl ? String(body.googleMapsUrl).trim() : null,
        normalizeNullableNumber(body.latitude),
        normalizeNullableNumber(body.longitude),
        String(body.plate || "").trim().toUpperCase(),
        body.vehicleDescription ? String(body.vehicleDescription).trim() : null,
        body.webfleetVehicleId ? String(body.webfleetVehicleId).trim() : null,
        body.assignedTechName ? String(body.assignedTechName).trim() : null,
        body.assignedVehicleName ? String(body.assignedVehicleName).trim() : null,
        body.notes ? String(body.notes).trim() : null,
        now,
      ]
    );

    if (previousStatus !== status) {
      await db.query(
        `
          INSERT INTO roadside_assistance_events (
            "assistanceId",
            status,
            note,
            "createdBy",
            "createdAtMs"
          )
          VALUES ($1, $2, $3, $4, $5)
        `,
        [
          id,
          status,
          "Estado actualizado desde edicion de oficina",
          body.updatedBy ?? "oficina",
          now,
        ]
      );
    }

    res.json(normalizeRoadsideAssistanceRow(result.rows[0]));
  } catch (error) {
    console.error("PUT /api/roadside-assistances/:id error:", error);
    res.status(500).json({ error: "Error actualizando asistencia" });
  }
});

app.post(
  "/api/roadside-assistances/:id/send-tracking-whatsapp",
  requireSupervisorRole,
  async (req, res) => {
    try {
      const id = Number(req.params.id);
      const now = Date.now();

      if (!Number.isFinite(id)) {
        return res.status(400).json({ error: "ID de asistencia no valido" });
      }

      const assistanceResult = await db.query(
        `
          SELECT *
          FROM roadside_assistances
          WHERE id = $1
          LIMIT 1
        `,
        [id]
      );

      if (assistanceResult.rows.length === 0) {
        return res.status(404).json({ error: "Asistencia no encontrada" });
      }

      const assistance = normalizeRoadsideAssistanceRow(
        assistanceResult.rows[0]
      );

      const message = await sendRoadsideTrackingWhatsApp(
        req,
        assistance,
        req.body?.trackingBaseUrl
      );

      const updatedResult = await db.query(
        `
          UPDATE roadside_assistances
          SET
            "trackingWhatsappSentAtMs" = $2,
            "trackingWhatsappSid" = $3,
            "updatedAtMs" = $2
          WHERE id = $1
          RETURNING *
        `,
        [id, now, message.sid]
      );

      await db.query(
        `
          INSERT INTO roadside_assistance_events (
            "assistanceId",
            status,
            note,
            "createdBy",
            "createdAtMs"
          )
          VALUES ($1, $2, $3, $4, $5)
        `,
        [
          id,
          assistance.status,
          "Enlace de seguimiento enviado por WhatsApp",
          req.body?.createdBy ?? "oficina",
          now,
        ]
      );

      res.json({
        success: true,
        sid: message.sid,
        trackingUrl: buildRoadsideTrackingUrl(
          req,
          assistance,
          req.body?.trackingBaseUrl
        ),
        assistance: normalizeRoadsideAssistanceRow(updatedResult.rows[0]),
      });
    } catch (error: any) {
      console.error("POST /api/roadside-assistances/:id/send-tracking-whatsapp error:", {
        message: error.message,
        code: error.code,
        status: error.status,
        moreInfo: error.moreInfo,
      });

      res.status(500).json({
        success: false,
        message: error.message,
        code: error.code,
        status: error.status,
        moreInfo: error.moreInfo,
      });
    }
  }
);

app.post(
  "/api/roadside-assistances/:id/status",
  requireSupervisorRole,
  async (req, res) => {
    try {
      const id = Number(req.params.id);
      const body = req.body ?? {};
      const now = Date.now();

      if (!Number.isFinite(id)) {
        return res.status(400).json({ error: "ID de asistencia no valido" });
      }

      const status = normalizeRoadsideAssistanceStatus(body.status);
      const timestampField = getRoadsideStatusTimestampField(status);

      const result = await db.query(
        `
          UPDATE roadside_assistances
          SET
            status = $2,
            "updatedAtMs" = $3
            ${
              timestampField
                ? `, "${timestampField}" = COALESCE("${timestampField}", $3)`
                : ""
            }
          WHERE id = $1
          RETURNING *
        `,
        [id, status, now]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Asistencia no encontrada" });
      }

      await db.query(
        `
          INSERT INTO roadside_assistance_events (
            "assistanceId",
            status,
            note,
            "createdBy",
            "createdAtMs"
          )
          VALUES ($1, $2, $3, $4, $5)
        `,
        [
          id,
          status,
          body.note ? String(body.note).trim() : null,
          body.createdBy ?? "oficina",
          now,
        ]
      );

      res.json(normalizeRoadsideAssistanceRow(result.rows[0]));
    } catch (error) {
      console.error("POST /api/roadside-assistances/:id/status error:", error);
      res.status(500).json({ error: "Error cambiando estado de asistencia" });
    }
  }
);

/* =========================================================
   MAINTENANCE TASKS
========================================================= */

type MaintenanceTaskType = "en_taller" | "fuera_taller";

type AssignedMaintenanceTaskStatus =
  | "pendiente"
  | "finalizada"
  | "interrumpida";

type MaintenanceTask = {
  id: string;
  label: string;
  type: MaintenanceTaskType;
};

type AssignedMaintenanceTask = {
  id: string;
  taskId: string;
  taskLabel: string;
  taskType: MaintenanceTaskType;
  techName: string;
  assignedAtMs: number;
  status: AssignedMaintenanceTaskStatus;
  statusChangedAtMs?: number | null;
};

const DEFAULT_MAINTENANCE_TASKS: MaintenanceTask[] = [
  {
    id: "limpieza_zona_trabajo",
    label: "Limpieza zona trabajo",
    type: "en_taller",
  },
  {
    id: "ordenar_almacen",
    label: "Ordenar almacén",
    type: "en_taller",
  },
  {
    id: "revisar_herramientas",
    label: "Revisar herramientas",
    type: "en_taller",
  },
  {
    id: "cargar_baterias",
    label: "Cargar baterías",
    type: "en_taller",
  },
  {
    id: "revisar_compresor",
    label: "Revisar compresor",
    type: "en_taller",
  },
  {
    id: "recoger_material_fuera",
    label: "Recoger material fuera",
    type: "fuera_taller",
  },
];

async function ensureMaintenanceTables() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS maintenance_tasks (
      id TEXT PRIMARY KEY,
      data JSONB NOT NULL,
      "updatedAtMs" BIGINT NOT NULL
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS assigned_maintenance_tasks (
      id TEXT PRIMARY KEY,
      data JSONB NOT NULL,
      "updatedAtMs" BIGINT NOT NULL
    )
  `);
}

function normalizeMaintenanceTask(item: any): MaintenanceTask | null {
  if (!item || typeof item !== "object") return null;

  const id = String(item.id || "").trim();
  const label = String(item.label || "").trim();

  if (!id || !label) return null;

  const type: MaintenanceTaskType =
    item.type === "fuera_taller" || item.type === "en_taller"
      ? item.type
      : "en_taller";

  return {
    id,
    label,
    type,
  };
}

function normalizeAssignedMaintenanceTask(
  item: any
): AssignedMaintenanceTask | null {
  if (!item || typeof item !== "object") return null;

  const id = String(item.id || "").trim();
  const taskId = String(item.taskId || "").trim();
  const taskLabel = String(item.taskLabel || "").trim();
  const techName = String(item.techName || "").trim();

  if (!id || !taskId || !taskLabel || !techName) return null;

  const assignedAtMs = Number(item.assignedAtMs || Date.now());

  if (!Number.isFinite(assignedAtMs)) return null;

  const taskType: MaintenanceTaskType =
    item.taskType === "fuera_taller" || item.taskType === "en_taller"
      ? item.taskType
      : "en_taller";

  const status: AssignedMaintenanceTaskStatus =
    item.status === "finalizada" ||
    item.status === "interrumpida" ||
    item.status === "pendiente"
      ? item.status
      : "pendiente";

  const statusChangedAtMs =
    typeof item.statusChangedAtMs === "number" &&
    Number.isFinite(item.statusChangedAtMs)
      ? item.statusChangedAtMs
      : null;

  return {
    id,
    taskId,
    taskLabel,
    taskType,
    techName,
    assignedAtMs,
    status,
    statusChangedAtMs,
  };
}

async function getBlockedOutsideMaintenanceTechNames(techNames: string[]) {
  await ensureMaintenanceTables();

  const uniqueTechNames = Array.from(
    new Set(
      techNames
        .map((name) => String(name || "").trim())
        .filter(Boolean)
    )
  );

  if (uniqueTechNames.length === 0) {
    return [];
  }

  const result = await db.query(
    `
      SELECT data
      FROM assigned_maintenance_tasks
      WHERE data->>'status' = 'pendiente'
        AND data->>'taskType' = 'fuera_taller'
        AND data->>'techName' = ANY($1::text[])
    `,
    [uniqueTechNames]
  );

  const blockedNames = result.rows
    .map((row) => normalizeAssignedMaintenanceTask(row.data))
    .filter(Boolean)
    .map((task) => task!.techName);

  return Array.from(new Set(blockedNames));
}

async function interruptWorkshopMaintenanceForTechs(techNames: string[]) {
  await ensureMaintenanceTables();

  const uniqueTechNames = Array.from(
    new Set(
      techNames
        .map((name) => String(name || "").trim())
        .filter(Boolean)
    )
  );

  if (uniqueTechNames.length === 0) {
    return [];
  }

  const result = await db.query(
    `
      SELECT id, data
      FROM assigned_maintenance_tasks
      WHERE data->>'status' = 'pendiente'
        AND data->>'taskType' = 'en_taller'
        AND data->>'techName' = ANY($1::text[])
    `,
    [uniqueTechNames]
  );

  const now = Date.now();
  const interruptedTasks: AssignedMaintenanceTask[] = [];

  for (const row of result.rows) {
    const currentTask = normalizeAssignedMaintenanceTask(row.data);

    if (!currentTask) continue;

    const nextTask: AssignedMaintenanceTask = {
      ...currentTask,
      status: "interrumpida",
      statusChangedAtMs: now,
    };

    await db.query(
      `
        UPDATE assigned_maintenance_tasks
        SET
          data = $2,
          "updatedAtMs" = $3
        WHERE id = $1
      `,
      [row.id, JSON.stringify(nextTask), now]
    );

    interruptedTasks.push(nextTask);
  }

  return interruptedTasks;
}

async function seedDefaultMaintenanceTasksIfEmpty() {
  await ensureMaintenanceTables();

  const countResult = await db.query(`
    SELECT COUNT(*)::int AS count
    FROM maintenance_tasks
  `);

  const count = Number(countResult.rows[0]?.count || 0);

  if (count > 0) return;

  const now = Date.now();

  for (const task of DEFAULT_MAINTENANCE_TASKS) {
    await db.query(
      `
        INSERT INTO maintenance_tasks (id, data, "updatedAtMs")
        VALUES ($1, $2, $3)
        ON CONFLICT (id)
        DO NOTHING
      `,
      [task.id, JSON.stringify(task), now]
    );
  }
}

app.get("/api/maintenance-tasks", async (_req, res) => {
  try {
    await seedDefaultMaintenanceTasksIfEmpty();

    const result = await db.query(`
      SELECT data
      FROM maintenance_tasks
      ORDER BY LOWER(data->>'label') ASC
    `);

    const tasks = result.rows
      .map((row) => normalizeMaintenanceTask(row.data))
      .filter(Boolean);

    res.json(tasks);
  } catch (error) {
    console.error("GET /api/maintenance-tasks error:", error);
    res.status(500).json({ error: "Error obteniendo tareas de mantenimiento" });
  }
});

app.post("/api/maintenance-tasks", async (req, res) => {
  try {
    await ensureMaintenanceTables();

    const task = normalizeMaintenanceTask({
      id: req.body?.id || `maintenance-${Date.now()}`,
      label: req.body?.label,
      type: req.body?.type,
    });

    if (!task) {
      return res.status(400).json({
        error: "Tarea de mantenimiento no válida",
      });
    }

    const now = Date.now();

    await db.query(
      `
        INSERT INTO maintenance_tasks (id, data, "updatedAtMs")
        VALUES ($1, $2, $3)
        ON CONFLICT (id)
        DO UPDATE SET
          data = EXCLUDED.data,
          "updatedAtMs" = EXCLUDED."updatedAtMs"
      `,
      [task.id, JSON.stringify(task), now]
    );

    res.json(task);
  } catch (error) {
    console.error("POST /api/maintenance-tasks error:", error);
    res.status(500).json({ error: "Error creando tarea de mantenimiento" });
  }
});

app.put("/api/maintenance-tasks/:id", async (req, res) => {
  try {
    await ensureMaintenanceTables();

    const id = String(req.params.id || "").trim();

    if (!id) {
      return res.status(400).json({ error: "ID de tarea no válido" });
    }

    const existingResult = await db.query(
      `
        SELECT data
        FROM maintenance_tasks
        WHERE id = $1
        LIMIT 1
      `,
      [id]
    );

    if (existingResult.rows.length === 0) {
      return res.status(404).json({ error: "Tarea no encontrada" });
    }

    const existingTask = existingResult.rows[0].data ?? {};

    const task = normalizeMaintenanceTask({
      ...existingTask,
      ...req.body,
      id,
    });

    if (!task) {
      return res.status(400).json({
        error: "Tarea de mantenimiento no válida",
      });
    }

    const now = Date.now();

    await db.query(
      `
        UPDATE maintenance_tasks
        SET
          data = $2,
          "updatedAtMs" = $3
        WHERE id = $1
      `,
      [id, JSON.stringify(task), now]
    );

    res.json(task);
  } catch (error) {
    console.error("PUT /api/maintenance-tasks/:id error:", error);
    res.status(500).json({ error: "Error actualizando tarea de mantenimiento" });
  }
});

app.delete("/api/maintenance-tasks/:id", async (req, res) => {
  try {
    await ensureMaintenanceTables();

    const id = String(req.params.id || "").trim();

    if (!id) {
      return res.status(400).json({ error: "ID de tarea no válido" });
    }

    await db.query(`DELETE FROM maintenance_tasks WHERE id = $1`, [id]);

    res.json({ ok: true });
  } catch (error) {
    console.error("DELETE /api/maintenance-tasks/:id error:", error);
    res.status(500).json({ error: "Error eliminando tarea de mantenimiento" });
  }
});

app.get("/api/assigned-maintenance-tasks", async (_req, res) => {
  try {
    await ensureMaintenanceTables();

    const result = await db.query(`
      SELECT data
      FROM assigned_maintenance_tasks
      ORDER BY COALESCE((data->>'assignedAtMs')::bigint, 0) DESC
    `);

    const tasks = result.rows
      .map((row) => normalizeAssignedMaintenanceTask(row.data))
      .filter(Boolean);

    res.json(tasks);
  } catch (error) {
    console.error("GET /api/assigned-maintenance-tasks error:", error);
    res.status(500).json({
      error: "Error obteniendo tareas de mantenimiento asignadas",
    });
  }
});

app.get("/api/maintenance-availability", async (_req, res) => {
  try {
    await ensureMaintenanceTables();

    const result = await db.query(`
  SELECT data
  FROM assigned_maintenance_tasks
  WHERE data->>'status' IN ('pendiente', 'interrumpida')
  ORDER BY COALESCE((data->>'assignedAtMs')::bigint, 0) DESC
`);
    
    const activeMaintenanceTasks = result.rows
  .map((row) => normalizeAssignedMaintenanceTask(row.data))
  .filter(Boolean) as AssignedMaintenanceTask[];

const pendingTasks = activeMaintenanceTasks.filter(
  (task) => task.status === "pendiente"
);

const interruptedTasks = activeMaintenanceTasks.filter(
  (task) => task.status === "interrumpida"
);  

    const outsideWorkshopTasks = pendingTasks.filter(
      (task) => task.taskType === "fuera_taller"
    );

    const workshopTasks = pendingTasks.filter(
      (task) => task.taskType === "en_taller"
    );

    const blockedTechNames = Array.from(
      new Set(outsideWorkshopTasks.map((task) => task.techName))
    );

    const workshopMaintenanceTechNames = Array.from(
      new Set(workshopTasks.map((task) => task.techName))
    );

    res.json({
  blockedTechNames,
  workshopMaintenanceTechNames,
  outsideWorkshopTasks,
  workshopTasks,
  pendingTasks,
  interruptedTasks,
  activeMaintenanceTasks,
});
  } catch (error) {
    console.error("GET /api/maintenance-availability error:", error);
    res.status(500).json({
      error: "Error obteniendo disponibilidad de mantenimiento",
    });
  }
});

app.post("/api/assigned-maintenance-tasks", async (req, res) => {
  try {
    await ensureMaintenanceTables();

    const task = normalizeAssignedMaintenanceTask({
      id: req.body?.id || `assigned-maintenance-${Date.now()}`,
      taskId: req.body?.taskId,
      taskLabel: req.body?.taskLabel,
      taskType: req.body?.taskType,
      techName: req.body?.techName,
      assignedAtMs: req.body?.assignedAtMs ?? Date.now(),
      status: req.body?.status ?? "pendiente",
      statusChangedAtMs: req.body?.statusChangedAtMs ?? null,
    });

    if (!task) {
      return res.status(400).json({
        error: "Asignación de mantenimiento no válida",
      });
    }

    const existingPending = await db.query(
      `
        SELECT data
        FROM assigned_maintenance_tasks
        WHERE data->>'techName' = $1
          AND data->>'status' = 'pendiente'
        LIMIT 1
      `,
      [task.techName]
    );

    if (existingPending.rows.length > 0) {
      return res.status(409).json({
        error: "El técnico ya tiene una tarea de mantenimiento pendiente",
        assignedTask: existingPending.rows[0].data,
      });
    }

    const now = Date.now();

    await db.query(
      `
        INSERT INTO assigned_maintenance_tasks (id, data, "updatedAtMs")
        VALUES ($1, $2, $3)
        ON CONFLICT (id)
        DO UPDATE SET
          data = EXCLUDED.data,
          "updatedAtMs" = EXCLUDED."updatedAtMs"
      `,
      [task.id, JSON.stringify(task), now]
    );

    res.json(task);
  } catch (error) {
    console.error("POST /api/assigned-maintenance-tasks error:", error);
    res.status(500).json({
      error: "Error asignando tarea de mantenimiento",
    });
  }
});

async function updateAssignedMaintenanceTaskStatus(
  id: string,
  status: AssignedMaintenanceTaskStatus,
  extra: Record<string, unknown> = {}
) {
  await ensureMaintenanceTables();

  const existingResult = await db.query(
    `
      SELECT data
      FROM assigned_maintenance_tasks
      WHERE id = $1
      LIMIT 1
    `,
    [id]
  );

  if (existingResult.rows.length === 0) {
    return null;
  }

  const current = existingResult.rows[0].data ?? {};
  const now = Date.now();

  const nextTask = normalizeAssignedMaintenanceTask({
    ...current,
    ...extra,
    id,
    status,
    statusChangedAtMs: status === "pendiente" ? null : now,
  });

  if (!nextTask) {
    return null;
  }

  await db.query(
    `
      UPDATE assigned_maintenance_tasks
      SET
        data = $2,
        "updatedAtMs" = $3
      WHERE id = $1
    `,
    [id, JSON.stringify(nextTask), now]
  );

  return nextTask;
}

app.put("/api/assigned-maintenance-tasks/:id/finish", async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();

    const task = await updateAssignedMaintenanceTaskStatus(id, "finalizada");

    if (!task) {
      return res.status(404).json({ error: "Asignación no encontrada" });
    }

    res.json(task);
  } catch (error) {
    console.error("PUT /api/assigned-maintenance-tasks/:id/finish error:", error);
    res.status(500).json({ error: "Error finalizando mantenimiento" });
  }
});

app.put("/api/assigned-maintenance-tasks/:id/interrupt", async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();

    const task = await updateAssignedMaintenanceTaskStatus(id, "interrumpida");

    if (!task) {
      return res.status(404).json({ error: "Asignación no encontrada" });
    }

    res.json(task);
  } catch (error) {
    console.error(
      "PUT /api/assigned-maintenance-tasks/:id/interrupt error:",
      error
    );
    res.status(500).json({ error: "Error interrumpiendo mantenimiento" });
  }
});

app.put("/api/assigned-maintenance-tasks/:id/resume", async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();

    const task = await updateAssignedMaintenanceTaskStatus(id, "pendiente", {
      assignedAtMs: Date.now(),
    });

    if (!task) {
      return res.status(404).json({ error: "Asignación no encontrada" });
    }

    res.json(task);
  } catch (error) {
    console.error("PUT /api/assigned-maintenance-tasks/:id/resume error:", error);
    res.status(500).json({ error: "Error reanudando mantenimiento" });
  }
});

app.delete("/api/assigned-maintenance-tasks/history", async (_req, res) => {
  try {
    await ensureMaintenanceTables();

    await db.query(`
      DELETE FROM assigned_maintenance_tasks
      WHERE data->>'status' IN ('finalizada', 'interrumpida')
    `);

    res.json({ ok: true });
  } catch (error) {
    console.error("DELETE /api/assigned-maintenance-tasks/history error:", error);
    res.status(500).json({ error: "Error limpiando historial" });
  }
});

app.delete("/api/assigned-maintenance-tasks/:id", async (req, res) => {
  try {
    await ensureMaintenanceTables();

    const id = String(req.params.id || "").trim();

    if (!id) {
      return res.status(400).json({ error: "ID de asignación no válido" });
    }

    await db.query(`DELETE FROM assigned_maintenance_tasks WHERE id = $1`, [
      id,
    ]);

    res.json({ ok: true });
  } catch (error) {
    console.error("DELETE /api/assigned-maintenance-tasks/:id error:", error);
    res.status(500).json({ error: "Error eliminando asignación" });
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
        standardMinutes: 90,
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
        ON CONFLICT (key) DO NOTHING
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
      SELECT *
      FROM quick_templates
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

    const standardMinutes =
      t.standardMinutes == null || t.standardMinutes === ""
        ? null
        : Number(t.standardMinutes);

    const unitMinutes =
      t.unitMinutes == null || t.unitMinutes === ""
        ? null
        : Number(t.unitMinutes);

    const unitPrice =
      t.unitPrice == null || t.unitPrice === ""
        ? null
        : Number(t.unitPrice);

    const result = await db.query(
      `
        INSERT INTO quick_templates (
          key,
          label,
          area,
          mode,
          "allowedTechs",
          "priorityOrder",
          "standardMinutes",
          "usesQuantity",
          "unitMinutes",
          "unitPrice"
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING *
      `,
      [
        t.key,
        t.label,
        t.area,
        t.mode,
        JSON.stringify(Array.isArray(t.allowedTechs) ? t.allowedTechs : []),
        JSON.stringify(Array.isArray(t.priorityOrder) ? t.priorityOrder : []),
        Number.isFinite(standardMinutes) ? standardMinutes : null,
        Boolean(t.usesQuantity),
        Number.isFinite(unitMinutes) ? unitMinutes : null,
        Number.isFinite(unitPrice) ? unitPrice : null,
      ]
    );

    res.json(normalizeQuickTemplateRow(result.rows[0]));
  } catch (error) {
    console.error("POST /api/quick-templates error:", error);
    res.status(500).json({ error: "Error creando entrada rápida" });
  }
});

app.put("/api/quick-templates/:key", requireAdminRole, async (req, res) => {
  try {
    const key = String(req.params.key || "").trim();
    const body = req.body || {};

    if (!key) {
      return res.status(400).json({ error: "Key inválida" });
    }

    const standardMinutes =
      body.standardMinutes == null || body.standardMinutes === ""
        ? null
        : Number(body.standardMinutes);

    const unitMinutes =
      body.unitMinutes == null || body.unitMinutes === ""
        ? null
        : Number(body.unitMinutes);

    const unitPrice =
      body.unitPrice == null || body.unitPrice === ""
        ? null
        : Number(body.unitPrice);

    const result = await db.query(
      `
        INSERT INTO quick_templates (
          key,
          label,
          area,
          mode,
          "standardMinutes",
          "usesQuantity",
          "unitMinutes",
          "unitPrice",
          "allowedTechs",
          "priorityOrder"
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (key)
        DO UPDATE SET
          label = EXCLUDED.label,
          area = EXCLUDED.area,
          mode = EXCLUDED.mode,
          "standardMinutes" = EXCLUDED."standardMinutes",
          "usesQuantity" = EXCLUDED."usesQuantity",
          "unitMinutes" = EXCLUDED."unitMinutes",
          "unitPrice" = EXCLUDED."unitPrice",
          "allowedTechs" = EXCLUDED."allowedTechs",
          "priorityOrder" = EXCLUDED."priorityOrder"
        RETURNING *
      `,
      [
        key,
        body.label ?? "",
        body.area ?? "camion",
        body.mode ?? "single",
        Number.isFinite(standardMinutes) ? standardMinutes : null,
        Boolean(body.usesQuantity),
        Number.isFinite(unitMinutes) ? unitMinutes : null,
        Number.isFinite(unitPrice) ? unitPrice : null,
        JSON.stringify(Array.isArray(body.allowedTechs) ? body.allowedTechs : []),
        JSON.stringify(
          Array.isArray(body.priorityOrder) ? body.priorityOrder : []
        ),
      ]
    );

    res.json(normalizeQuickTemplateRow(result.rows[0]));
  } catch (error) {
    console.error("PUT /api/quick-templates/:key error:", error);
    res.status(500).json({ error: "Error guardando entrada rápida" });
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
      WHERE COALESCE(data::jsonb->>'status', '') NOT IN (
        'cancelado',
        'eliminado'
      )
      ORDER BY id ASC
    `);

    res.json(result.rows.map((row) => row.data));
  } catch (error) {
    console.error("GET /api/scheduled-jobs error:", error);
    res.status(500).json({ error: "Error obteniendo citas programadas" });
  }
});
app.get("/api/scheduled-tech-statuses", async (_req, res) => {
  try {
    const result = await db.query(
      `
        SELECT
          id,
          "techName",
          status,
          "startDate",
          "endDate",
          label,
          notes,
          "createdAtMs",
          "workshopId"
        FROM scheduled_tech_statuses
        ORDER BY "createdAtMs" DESC
      `
    );

    res.json(result.rows);
  } catch (error) {
    console.error("GET /api/scheduled-tech-statuses error:", error);
    res.status(500).json({
      error: "Error cargando estados técnicos programados",
    });
  }
});

app.get("/api/agenda-date-reminders", async (_req, res) => {
  try {
    const result = await db.query(
      `
        SELECT
          id,
          "workshopId",
          kind,
          title,
          "startDate",
          "endDate",
          color,
          notes,
          "techStatusId",
          "techName",
          "techStatus"
        FROM agenda_date_reminders
        ORDER BY "startDate" ASC, id ASC
      `
    );

    res.json(result.rows);
  } catch (error) {
    console.error("GET /api/agenda-date-reminders error:", error);
    res.status(500).json({
      error: "Error cargando recordatorios de agenda",
    });
  }
});

app.put("/api/agenda-date-reminders", requireSupervisorRole, async (req, res) => {
  try {
    const items = Array.isArray(req.body) ? req.body : [];

    await db.query("BEGIN");

    await db.query(`DELETE FROM agenda_date_reminders`);

    for (const item of items) {
      await db.query(
        `
          INSERT INTO agenda_date_reminders (
            id,
            "workshopId",
            kind,
            title,
            "startDate",
            "endDate",
            color,
            notes,
            "techStatusId",
            "techName",
            "techStatus"
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          ON CONFLICT (id)
          DO UPDATE SET
            "workshopId" = EXCLUDED."workshopId",
            kind = EXCLUDED.kind,
            title = EXCLUDED.title,
            "startDate" = EXCLUDED."startDate",
            "endDate" = EXCLUDED."endDate",
            color = EXCLUDED.color,
            notes = EXCLUDED.notes,
            "techStatusId" = EXCLUDED."techStatusId",
            "techName" = EXCLUDED."techName",
            "techStatus" = EXCLUDED."techStatus"
        `,
        [
          Number(item.id || Date.now()),
          item.workshopId ?? null,
          item.kind ?? "normal",
          String(item.title || ""),
          String(item.startDate || ""),
          String(item.endDate || ""),
          item.color ?? "red",
          item.notes ?? null,
          item.techStatusId ?? null,
          item.techName ?? null,
          item.techStatus ?? null,
        ]
      );
    }

    await db.query("COMMIT");

    const result = await db.query(
      `
        SELECT
          id,
          "workshopId",
          kind,
          title,
          "startDate",
          "endDate",
          color,
          notes,
          "techStatusId",
          "techName",
          "techStatus"
        FROM agenda_date_reminders
        ORDER BY "startDate" ASC, id ASC
      `
    );

    res.json(result.rows);
  } catch (error) {
    await db.query("ROLLBACK").catch(() => null);

    console.error("PUT /api/agenda-date-reminders error:", error);
    res.status(500).json({
      error: "Error guardando recordatorios de agenda",
    });
  }
});

app.put("/api/scheduled-tech-statuses", requireSupervisorRole, async (req, res) => {
  try {
    const items = Array.isArray(req.body) ? req.body : [];

    await db.query("BEGIN");

    await db.query(`DELETE FROM scheduled_tech_statuses`);

    for (const item of items) {
      await db.query(
        `
          INSERT INTO scheduled_tech_statuses (
            id,
            "techName",
            status,
            "startDate",
            "endDate",
            label,
            notes,
            "createdAtMs",
            "workshopId"
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          ON CONFLICT (id)
          DO UPDATE SET
            "techName" = EXCLUDED."techName",
            status = EXCLUDED.status,
            "startDate" = EXCLUDED."startDate",
            "endDate" = EXCLUDED."endDate",
            label = EXCLUDED.label,
            notes = EXCLUDED.notes,
            "createdAtMs" = EXCLUDED."createdAtMs",
            "workshopId" = EXCLUDED."workshopId"
        `,
        [
          String(item.id),
          String(item.techName || ""),
          String(item.status || "disponible"),
          String(item.startDate || ""),
          String(item.endDate || ""),
          item.label ?? null,
          item.notes ?? null,
          Number(item.createdAtMs || Date.now()),
          item.workshopId ?? null,
        ]
      );
    }

    await db.query("COMMIT");

    const result = await db.query(
      `
        SELECT
          id,
          "techName",
          status,
          "startDate",
          "endDate",
          label,
          notes,
          "createdAtMs",
          "workshopId"
        FROM scheduled_tech_statuses
        ORDER BY "createdAtMs" DESC
      `
    );

    res.json(result.rows);
  } catch (error) {
    await db.query("ROLLBACK").catch(() => null);

    console.error("PUT /api/scheduled-tech-statuses error:", error);
    res.status(500).json({
      error: "Error guardando estados técnicos programados",
    });
  }
});


app.put("/api/scheduled-jobs", async (req, res) => {
  try {
    const items = Array.isArray(req.body) ? req.body : [];
    const now = Date.now();

    if (items.length === 0) {
      console.warn(
        "PUT /api/scheduled-jobs recibido vacío. No se borra la agenda por seguridad."
      );

      const current = await db.query(`
        SELECT data
        FROM scheduled_jobs
        WHERE COALESCE(data::jsonb->>'status', '') NOT IN (
          'cancelado',
          'eliminado'
        )
        ORDER BY id ASC
      `);

      res.json(current.rows.map((row) => row.data));
      return;
    }

    for (const item of items) {
      if (!item || item.id == null) continue;

      const incomingStatus = String(item.status || "").toLowerCase().trim();

      const existing = await db.query(
        `
        SELECT data
        FROM scheduled_jobs
        WHERE id = $1
        LIMIT 1
        `,
        [item.id]
      );

      const existingData = existing.rows[0]?.data ?? null;
      const existingStatus = String(existingData?.status || "")
        .toLowerCase()
        .trim();

      if (
        ["cancelado", "eliminado"].includes(existingStatus) &&
        !["cancelado", "eliminado"].includes(incomingStatus)
      ) {
        console.warn(
          `PUT /api/scheduled-jobs ignorado: intento de reactivar cita eliminada id=${item.id}`
        );
        continue;
      }

      const nextItem =
        ["cancelado", "eliminado"].includes(incomingStatus)
          ? {
              ...item,
              status: incomingStatus,
              deletedAtMs: item.deletedAtMs ?? now,
            }
          : item;

      await db.query(
        `
          INSERT INTO scheduled_jobs (id, data, "updatedAtMs")
          VALUES ($1, $2, $3)
          ON CONFLICT (id)
          DO UPDATE SET
            data = EXCLUDED.data,
            "updatedAtMs" = EXCLUDED."updatedAtMs"
        `,
        [nextItem.id, JSON.stringify(nextItem), now]
      );
    }

    const current = await db.query(`
      SELECT data
      FROM scheduled_jobs
      WHERE COALESCE(data::jsonb->>'status', '') NOT IN (
        'cancelado',
        'eliminado'
      )
      ORDER BY id ASC
    `);

    res.json(current.rows.map((row) => row.data));
  } catch (error) {
    console.error("PUT /api/scheduled-jobs error:", error);
    res.status(500).json({ error: "Error guardando citas programadas" });
  }
});

app.delete("/api/scheduled-jobs/:id", requireSupervisorRole, async (req, res) => {
  try {
    const id = Number(req.params.id);

    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: "ID de cita inválido" });
    }

    const deletedAtMs = Date.now();

    const current = await db.query(
      `
      SELECT data
      FROM scheduled_jobs
      WHERE id = $1
      LIMIT 1
      `,
      [id]
    );

    if (current.rowCount === 0) {
      return res.status(404).json({ error: "Cita no encontrada" });
    }

    const currentData = current.rows[0].data ?? {};

    const nextData = {
      ...currentData,
      status: "cancelado",
      deletedAtMs,
    };

    const result = await db.query(
      `
      UPDATE scheduled_jobs
      SET
        data = $2,
        "updatedAtMs" = $3
      WHERE id = $1
      RETURNING data
      `,
      [id, JSON.stringify(nextData), deletedAtMs]
    );

    res.json({
      ok: true,
      scheduledJob: result.rows[0].data,
    });
  } catch (error) {
    console.error("DELETE /api/scheduled-jobs/:id error:", error);
    res.status(500).json({ error: "Error eliminando cita programada" });
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
   WHATSAPP AGENDA REMINDERS
========================================================= */

const AGENDA_TIME_ZONE = process.env.AGENDA_TIME_ZONE || "Europe/Madrid";
const REMINDER_CHECK_INTERVAL_MS = 60 * 1000;
const REMINDER_GRACE_MS = 12 * 60 * 60 * 1000;

let reminderCheckerRunning = false;

function getTimeZoneOffsetMs(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const values: Record<string, string> = {};

  for (const part of parts) {
    if (part.type !== "literal") {
      values[part.type] = part.value;
    }
  }

  const asUtc = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second)
  );

  return asUtc - date.getTime();
}

function zonedDateTimeToUtcMs(dateValue: string, timeValue: string, timeZone: string) {
  if (!dateValue || !timeValue) return null;

  const [year, month, day] = dateValue.split("-").map(Number);
  const [hour, minute] = timeValue.split(":").map(Number);

  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    !Number.isFinite(day) ||
    !Number.isFinite(hour) ||
    !Number.isFinite(minute)
  ) {
    return null;
  }

  const localAsUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
  let utcMs = localAsUtc - getTimeZoneOffsetMs(new Date(localAsUtc), timeZone);

  utcMs = localAsUtc - getTimeZoneOffsetMs(new Date(utcMs), timeZone);

  return utcMs;
}

function getScheduledJobLabel(job: any) {
  return (
    job.linkedTemplateLabel ||
    job.templateLabel ||
    job.quickEntryLabel ||
    job.templateKey ||
    "servicio programado"
  );
}

function formatSpanishDate(dateValue: string) {
  if (!dateValue || !dateValue.includes("-")) return dateValue;

  const [year, month, day] = dateValue.split("-");

  return `${day}/${month}/${year}`;
}

function buildReminderMessage(job: any, reminderLabel: string) {
  const customerName = job.customerName || "cliente";
  const jobDescription = getScheduledJobLabel(job);
  const date = formatSpanishDate(job.date || "");
  const time = job.startTime || "";
  const plate = job.plate ? `Matrícula: ${job.plate}\n` : "";
const notes = job.notes ? `Observaciones: ${job.notes}\n` : "";

return (
  `Hola ${customerName},\n\n` +
  `Te recordamos tu cita:\n\n` +
  `Trabajo: ${jobDescription}\n` +
  plate +
  `Fecha: ${date}\n` +
  `Hora: ${time}\n` +
  notes +
  `\n${reminderLabel}\n\n` +
  `Gracias.`
);
}

async function sendWhatsAppAgendaReminder(job: any, reminderLabel: string) {
  if (!job.customerPhone || !String(job.customerPhone).trim()) {
    throw new Error(`La cita ${job.id} no tiene teléfono de cliente.`);
  }

  return twilioClient.messages.create({
  from: process.env.TWILIO_WHATSAPP_FROM || "whatsapp:+34610473079",
 to: `whatsapp:${normalizeSpanishPhone(job.customerPhone)}`,
  contentSid:
    process.env.TWILIO_CONTENT_SID ||
    "HXdf941b56b6cf5464b5d2b2374171c926",
  contentVariables: JSON.stringify({
    "1": job.customerName || "cliente",
    "2": getScheduledJobLabel(job),
    "3": job.plate || "-",
    "4": formatSpanishDate(job.date || ""),
    "5": job.startTime || "",
  }),
});
}

function shouldSendReminder(triggerAtMs: number | null, appointmentAtMs: number | null, nowMs: number) {
  if (triggerAtMs == null) return false;
  if (triggerAtMs > nowMs) return false;
  if (nowMs - triggerAtMs > REMINDER_GRACE_MS) return false;

  if (appointmentAtMs != null && appointmentAtMs <= nowMs) return false;

  return true;
}

async function markScheduledJobReminderSent(job: any, sentField: string, sentAtMs: number) {
  const nextData = {
    ...job,
    [sentField]: sentAtMs,
  };

  await db.query(
    `
    UPDATE scheduled_jobs
    SET
      data = $2,
      "updatedAtMs" = $3
    WHERE id = $1
    `,
    [job.id, JSON.stringify(nextData), sentAtMs]
  );
}

async function checkAgendaWhatsAppReminders() {
  if (reminderCheckerRunning) return;

  reminderCheckerRunning = true;

  try {
    const nowMs = Date.now();

    const result = await db.query(`
      SELECT data
      FROM scheduled_jobs
      WHERE COALESCE(data::jsonb->>'status', '') NOT IN (
        'cancelado',
        'eliminado',
        'cerrado'
      )
      ORDER BY id ASC
    `);

    for (const row of result.rows) {
      const job = row.data;
      if (!job || job.id == null) continue;

      const appointmentAtMs = zonedDateTimeToUtcMs(
        String(job.date || ""),
        String(job.startTime || ""),
        AGENDA_TIME_ZONE
      );

      if (appointmentAtMs == null) continue;

      const reminders = [
        {
          enabled: !!job.manualReminderEnabled,
          sentField: "manualReminderSentAtMs",
          sentAt: job.manualReminderSentAtMs,
          triggerAtMs: zonedDateTimeToUtcMs(
            String(job.manualReminderDate || ""),
            String(job.manualReminderTime || ""),
            AGENDA_TIME_ZONE
          ),
          label: "Recordatorio programado manualmente.",
        },
        {
          enabled: job.sendReminder24h !== false,
          sentField: "whatsappReminder24hSentAtMs",
          sentAt: job.whatsappReminder24hSentAtMs,
          triggerAtMs: appointmentAtMs - 24 * 60 * 60 * 1000,
          label: "Recordatorio 24h antes.",
        },
        {
          enabled: job.sendReminder1h !== false,
          sentField: "whatsappReminder1hSentAtMs",
          sentAt: job.whatsappReminder1hSentAtMs,
          triggerAtMs: appointmentAtMs - 60 * 60 * 1000,
          label: "Recordatorio 1h antes.",
        },
      ];

      for (const reminder of reminders) {
        if (!reminder.enabled) continue;
        if (reminder.sentAt) continue;

        if (!shouldSendReminder(reminder.triggerAtMs, appointmentAtMs, nowMs)) {
          continue;
        }

        try {
          const message = await sendWhatsAppAgendaReminder(job, reminder.label);

          await markScheduledJobReminderSent(job, reminder.sentField, nowMs);

          job[reminder.sentField] = nowMs;

          console.log(
            `WhatsApp agenda reminder enviado: cita=${job.id} tipo=${reminder.sentField} sid=${message.sid}`
          );
        } catch (error: any) {
         console.error("Error enviando recordatorio WhatsApp agenda:", {
  jobId: job.id,
  sentField: reminder.sentField,
  to: normalizeSpanishPhone(job.customerPhone),
  from: process.env.TWILIO_WHATSAPP_FROM,
  contentSid: process.env.TWILIO_CONTENT_SID,
  message: error.message,
  code: error.code,
  status: error.status,
  moreInfo: error.moreInfo,
  fullError: JSON.stringify(error, null, 2),
});
        }
      }
    }
  } catch (error) {
    console.error("checkAgendaWhatsAppReminders error:", error);
  } finally {
    reminderCheckerRunning = false;
  }
}

function startAgendaWhatsAppReminderChecker() {
  console.log("Recordatorios WhatsApp agenda activos.");

  void checkAgendaWhatsAppReminders();

  setInterval(() => {
    void checkAgendaWhatsAppReminders();
  }, REMINDER_CHECK_INTERVAL_MS);
}


/* =========================================================
   ALMACEN NEUMATICOS - OCR ALBARANES
========================================================= */

type DatosAlbaranAlmacen = {
  pagina: number;
  albaran: string | null;
  fecha: string | null;
  cliente: string | null;
  matricula: string | null;
  numeroVehiculo: string | null;
  producto: string | null;
  cantidad: number | null;
  duplicado: boolean;
  confianza: "alta" | "media" | "baja";
  observaciones: string[];
};

function limpiarJsonOpenAI(texto: string) {
  const limpio = String(texto || "").trim();

  if (limpio.startsWith("```")) {
    return limpio
      .replace(/^```json/i, "")
      .replace(/^```/i, "")
      .replace(/```$/i, "")
      .trim();
  }

  return limpio;
}

function normalizarMatricula(valor: unknown) {
  const texto = String(valor || "")
    .replace(/\s+/g, "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toUpperCase();

  return texto || null;
}

function normalizarTextoSimple(valor: unknown) {
  const texto = String(valor || "").trim();
  return texto || null;
}

function normalizarCantidad(valor: unknown) {
  const numero = Number(
    String(valor ?? "")
      .replace(",", ".")
      .replace(/[^\d.-]/g, "")
  );

  if (!Number.isFinite(numero) || numero === 0) return null;

  return Math.abs(numero);
}

function normalizarConfianza(valor: unknown): "alta" | "media" | "baja" {
  if (valor === "alta" || valor === "media" || valor === "baja") {
    return valor;
  }

  return "media";
}

function normalizarDatosAlbaran(datos: any, indice: number): DatosAlbaranAlmacen {
  return {
    pagina: Number(datos?.pagina || indice + 1),
    albaran: normalizarTextoSimple(datos?.albaran),
    fecha: normalizarTextoSimple(datos?.fecha),
    cliente: normalizarTextoSimple(datos?.cliente),
    matricula: normalizarMatricula(datos?.matricula),
    numeroVehiculo: normalizarTextoSimple(
      datos?.numeroVehiculo ??
        datos?.numero_vehiculo ??
        datos?.numeroVehículo ??
        datos?.["NºVEHICULO"]
    ),
    producto: normalizarTextoSimple(datos?.producto),
    cantidad: normalizarCantidad(datos?.cantidad),
    duplicado: false,
    confianza: normalizarConfianza(datos?.confianza),
    observaciones: Array.isArray(datos?.observaciones)
      ? datos.observaciones.map((item: unknown) => String(item))
      : [],
  };
}

async function comprobarDuplicadoAlbaran(albaran: string | null) {
  if (!albaran) return false;

  const { data, error } = await supabase
    .from("movimientos_stock")
    .select("id")
    .eq("tipo", "SALIDA")
    .eq("documento_tipo", "GENES")
    .eq("documento_numero", albaran)
    .limit(1);

  if (error) {
    console.error("Error comprobando duplicado:", error);
    return false;
  }

  return Boolean(data && data.length > 0);
}

async function guardarHistorialOcrAlbaran(
  datos: DatosAlbaranAlmacen,
  pdfNombre: string
) {
  const { error } = await supabase.from("ocr_albaranes_importados").insert({
    albaran: datos.albaran,
    fecha: datos.fecha,
    cliente: datos.cliente,
    matricula: datos.matricula,
    numero_vehiculo: datos.numeroVehiculo,
    producto: datos.producto,
    cantidad: datos.cantidad,
    pdf_nombre: pdfNombre,
    pagina: datos.pagina,
    estado: datos.duplicado ? "duplicado" : "pendiente",
    datos_json: datos,
  });

  if (error) {
    console.error("Error guardando historial OCR:", error);
  }
}

app.post(
  "/api/almacen/leer-albaran-pdf",
  upload.single("albaran"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: "No se recibió ningún PDF.",
        });
      }

      if (req.file.mimetype !== "application/pdf") {
        return res.status(400).json({
          success: false,
          message: "El archivo debe ser un PDF.",
        });
      }

      const base64Pdf = req.file.buffer.toString("base64");

      const prompt = `
Eres un extractor de datos para albaranes escaneados de Comercial Sea / Grupo Soledad.

El PDF puede contener 1 o varios albaranes. Normalmente cada página es un albarán distinto.

Devuelve SOLO JSON válido, sin markdown, con esta estructura exacta:

{
  "albaranes": [
    {
      "pagina": 1,
      "albaran": "B2_0002525",
      "fecha": "30/05/2026",
      "cliente": "EMPRESA PLANA S.L.",
      "matricula": "9035LVV",
      "numeroVehiculo": "1234",
      "producto": "295/80R22.5 HANKOOK AH51",
      "cantidad": 2,
      "confianza": "alta",
      "observaciones": []
    }
  ]
}

Reglas obligatorias:
- Si el PDF tiene varias páginas, devuelve un objeto por cada albarán detectado.
- No mezcles datos de páginas distintas.
- El número de albarán está junto a "Albarán:".
- La fecha está junto a "Fecha:".
- La matrícula está en el bloque "Vehículo".
- El cliente está en el bloque "Cliente".
- El producto y la cantidad salen de la línea que empieza por "Salidas Almacen Cliente".
- La cantidad puede venir negativa, por ejemplo -2,00. Devuelve siempre cantidad positiva.
- Normaliza medidas: 295/80x22.5 y 295/80R22.5 deben devolverse como 295/80R22.5.
- Si aparece "NºVEHICULO:", "Nº VEHICULO:", "NUMERO VEHICULO:" o "Nº VEHÍCULO:", extrae ese valor en "numeroVehiculo".
- Si no aparece número de vehículo, devuelve "numeroVehiculo": null.
- Devuelve null si un campo no se puede leer.
- "confianza" debe ser "alta", "media" o "baja".
- Si una página no parece un albarán, no la incluyas.
`;

      const response = await (openai.responses.create as any)({
        model: "gpt-4o-mini",
        input: [
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: prompt,
              },
              {
                type: "input_file",
                filename: req.file.originalname || "albaranes.pdf",
                file_data: `data:application/pdf;base64,${base64Pdf}`,
              },
            ],
          },
        ],
      });

      const textoRespuesta = String(response.output_text || "");
      const jsonTexto = limpiarJsonOpenAI(textoRespuesta);

      let datosRaw: any;

      try {
        datosRaw = JSON.parse(jsonTexto);
      } catch (error) {
        console.error("Respuesta OCR no parseable:", textoRespuesta);

        return res.status(500).json({
          success: false,
          message: "No se pudo interpretar la respuesta del OCR.",
          raw: textoRespuesta,
        });
      }

      const listaRaw = Array.isArray(datosRaw?.albaranes)
        ? datosRaw.albaranes
        : Array.isArray(datosRaw)
          ? datosRaw
          : datosRaw
            ? [datosRaw]
            : [];

      const albaranes: DatosAlbaranAlmacen[] = [];

      for (let i = 0; i < listaRaw.length; i += 1) {
        const datos = normalizarDatosAlbaran(listaRaw[i], i);

        if (
          !datos.albaran &&
          !datos.cliente &&
          !datos.matricula &&
          !datos.producto
        ) {
          continue;
        }

        datos.duplicado = await comprobarDuplicadoAlbaran(datos.albaran);

        if (datos.duplicado) {
          datos.observaciones = [
            ...datos.observaciones,
            "Albarán duplicado: ya existe una salida registrada con este número.",
          ];
        }

        await guardarHistorialOcrAlbaran(
          datos,
          req.file.originalname || "albaranes.pdf"
        );

        albaranes.push(datos);
      }

      if (albaranes.length === 0) {
        return res.status(422).json({
          success: false,
          message: "No se detectó ningún albarán válido en el PDF.",
        });
      }

      return res.json({
        success: true,
        albaranes,
        datos: albaranes[0],
      });
    } catch (error: any) {
      console.error("POST /api/almacen/leer-albaran-pdf error:", error);

      return res.status(500).json({
        success: false,
        message:
          error?.message || "Error leyendo el albarán PDF con OCR.",
      });
    }
  }
);

app.post(
  "/api/almacen/leer-entrada-pdf",
  upload.single("albaran"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: "No se recibió ningún PDF.",
        });
      }

      if (req.file.mimetype !== "application/pdf") {
        return res.status(400).json({
          success: false,
          message: "El archivo debe ser un PDF.",
        });
      }

      const base64Pdf = req.file.buffer.toString("base64");

      const prompt = `
Eres un extractor de datos para ALBARANES DE ENTRADA de neumáticos en el almacén de un CLIENTE.

IMPORTANTE:
Estos documentos NO son compras a proveedor.
Son entradas de neumáticos al almacén de un cliente.

El PDF puede contener 1 o varios albaranes. Normalmente cada página es un albarán distinto.

Debes leer:
- número de albarán
- fecha
- número/código de cliente
- nombre del cliente
- dirección del cliente
- SOLO los neumáticos resaltados, subrayados o marcados en amarillo o gris
- cantidad de cada neumático resaltado

Devuelve SOLO JSON válido, sin markdown, con esta estructura exacta:

{
  "entradas": [
    {
      "pagina": 1,
      "albaran": "123456",
      "fecha": "30/05/2026",
      "codigoCliente": "4300123",
      "cliente": "TRANSPORTES EJEMPLO S.L.",
      "direccionCliente": "CALLE EJEMPLO 1, TARRAGONA",
      "producto": "315/80R22.5 HANKOOK AH51",
      "cantidad": 4,
      "ubicacion": null,
      "confianza": "alta",
      "observaciones": []
    }
  ]
}

Reglas obligatorias:
- Extrae el número de albarán.
- Extrae la fecha.
- Extrae el número o código de cliente si aparece.
- Extrae el nombre del cliente.
- Extrae la dirección del cliente si aparece.
- Los productos válidos son SOLO neumáticos resaltados, subrayados o marcados en amarillo o gris.
- Ignora neumáticos no resaltados.
- Si hay varias líneas resaltadas, devuelve una entrada por cada línea.
- Si una línea resaltada contiene medida, marca, modelo y cantidad, extrae todo.
- Si no puedes confirmar visualmente que una línea está resaltada, añade en observaciones: "No se pudo confirmar resaltado".
- Extrae producto/neumático completo.
- Extrae cantidad.
- Si la cantidad aparece negativa, devuelve siempre cantidad positiva.
- Normaliza medidas: 295/80x22.5 debe ser 295/80R22.5.
- Si aparece ubicación o almacén, devuélvelo en "ubicacion".
- Si no aparece ubicación, devuelve null.
- Devuelve null si un campo no se puede leer.
- "confianza" debe ser "alta", "media" o "baja".
- Si una página no parece un albarán de entrada de cliente, no la incluyas.
`;

      const response = await (openai.responses.create as any)({
        model: "gpt-4o-mini",
        input: [
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: prompt,
              },
              {
                type: "input_file",
                filename: req.file.originalname || "entrada.pdf",
                file_data: `data:application/pdf;base64,${base64Pdf}`,
              },
            ],
          },
        ],
      });

      const textoRespuesta = String(response.output_text || "");
      const jsonTexto = limpiarJsonOpenAI(textoRespuesta);

      let datosRaw: any;

      try {
        datosRaw = JSON.parse(jsonTexto);
      } catch (error) {
        console.error("Respuesta OCR entrada no parseable:", textoRespuesta);

        return res.status(500).json({
          success: false,
          message: "No se pudo interpretar la respuesta del OCR de entrada.",
          raw: textoRespuesta,
        });
      }

      const listaRaw = Array.isArray(datosRaw?.entradas)
        ? datosRaw.entradas
        : Array.isArray(datosRaw)
          ? datosRaw
          : datosRaw
            ? [datosRaw]
            : [];

      const entradas = [];

      for (let i = 0; i < listaRaw.length; i += 1) {
        const item = listaRaw[i];

        const albaran = normalizarTextoSimple(item?.albaran);
        const fecha = normalizarTextoSimple(item?.fecha);
        const codigoCliente = normalizarTextoSimple(
          item?.codigoCliente ?? item?.codigo_cliente ?? item?.numeroCliente
        );
        const cliente = normalizarTextoSimple(
          item?.cliente ?? item?.nombreCliente ?? item?.nombre_cliente
        );
        const direccionCliente = normalizarTextoSimple(
          item?.direccionCliente ?? item?.direccion_cliente ?? item?.direccion
        );
        const producto = normalizarTextoSimple(item?.producto);
        const cantidad = normalizarCantidad(item?.cantidad);
        const ubicacion = normalizarTextoSimple(item?.ubicacion);

        if (!albaran && !codigoCliente && !cliente && !producto) {
          continue;
        }

        const { data: duplicadoData, error: duplicadoError } = await supabase
          .from("movimientos_stock")
          .select("id")
          .eq("tipo", "ENTRADA")
          .eq("documento_tipo", "GENES")
          .eq("documento_numero", albaran)
          .limit(1);

        if (duplicadoError) {
          console.error("Error comprobando duplicado entrada:", duplicadoError);
        }

        const duplicado = Boolean(duplicadoData && duplicadoData.length > 0);

        let estado:
          | "listo"
          | "duplicado"
          | "sin_cliente"
          | "sin_producto"
          | "sin_ubicacion"
          | "error" = "listo";

        const observaciones = Array.isArray(item?.observaciones)
          ? item.observaciones.map((x: unknown) => String(x))
          : [];

        if (duplicado) {
          estado = "duplicado";
          observaciones.push(
            "Albarán duplicado: ya existe una entrada registrada con este número."
          );
        } else if (!codigoCliente && !cliente) {
          estado = "sin_cliente";
        } else if (!producto) {
          estado = "sin_producto";
        } else if (!ubicacion) {
          estado = "sin_ubicacion";
        }

        entradas.push({
          pagina: Number(item?.pagina || i + 1),
          albaran,
          fecha,
          codigoCliente,
          cliente,
          direccionCliente,
          producto,
          cantidad,
          ubicacion,
          estado,
          confianza: normalizarConfianza(item?.confianza),
          observaciones,
        });
      }

      if (entradas.length === 0) {
        return res.status(422).json({
          success: false,
          message:
            "No se detectó ningún albarán de entrada válido en el PDF.",
        });
      }

      return res.json({
        success: true,
        entradas,
        datos: entradas[0],
      });
    } catch (error: any) {
      console.error("POST /api/almacen/leer-entrada-pdf error:", error);

      return res.status(500).json({
        success: false,
        message:
          error?.message || "Error leyendo el albarán de entrada PDF con OCR.",
      });
    }
  }
);



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
      startAgendaWhatsAppReminderChecker();
    });
  })
  .catch((error) => {
    console.error("Error inicializando base de datos:", error);
    process.exit(1);
  });
