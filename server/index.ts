import dotenv from "dotenv";
dotenv.config();
import express from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import multer from "multer";
import PDFDocument from "pdfkit";
import sharp from "sharp";
import nodemailer from "nodemailer";
import { fileURLToPath } from "url";
import db, { initDb } from "./db.ts";
import { supabase, SUPABASE_STORAGE_BUCKET, SUPABASE_ROADSIDE_BUCKET } from "./supabase.ts";
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
app.use(express.json({ limit: "10mb" }));
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
    roadsideCapable: t.roadsideCapable === true || t.roadsideCapable === "true",
    currentRoadsideAssistanceId:
      t.currentRoadsideAssistanceId != null ? Number(t.currentRoadsideAssistanceId) : null,
    phone: t.phone ?? null,
  };
}

function normalizeJobRow(job: any) {
  return {
    ...job,
    urgent: !!job.urgent,
    assignedNames: safeJsonParse(job.assignedNames, [] as string[]),
    customerName: job.customerName ?? "",
    customerPhone: job.customerPhone ?? "",
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
finishedWhatsappSentAtMs: job.finishedWhatsappSentAtMs ?? null,
finishedWhatsappSid: job.finishedWhatsappSid ?? null,
  };
}

const ROADSIDE_ASSISTANCE_STATUSES = new Set([
  "pendiente",
  "asignada",
  "en_camino",
  "en_punto",
  "inicio_reparacion",
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
    assignedAtMs: row.assignedAtMs != null ? Number(row.assignedAtMs) : null,
    departedAtMs: row.departedAtMs != null ? Number(row.departedAtMs) : null,
    etaMinutos: row.etaMinutos != null ? Number(row.etaMinutos) : null,
    etaKm: row.etaKm ?? null,
    arrivedAtPointMs: row.arrivedAtPointMs != null ? Number(row.arrivedAtPointMs) : null,
    inicioReparacionAtMs: row.inicioReparacionAtMs != null ? Number(row.inicioReparacionAtMs) : null,
    finishedAtMs: row.finishedAtMs != null ? Number(row.finishedAtMs) : null,
    arrivedAtWorkshopMs: row.arrivedAtWorkshopMs != null ? Number(row.arrivedAtWorkshopMs) : null,
    cancelledAtMs: row.cancelledAtMs != null ? Number(row.cancelledAtMs) : null,
    whatsappEnCaminoEnviado: row.whatsappEnCaminoEnviado === true || row.whatsappEnCaminoEnviado === "true",
    whatsappEnCaminoAt: row.whatsappEnCaminoAt != null ? Number(row.whatsappEnCaminoAt) : null,
    etaActualizadoAt: row.etaActualizadoAt != null ? Number(row.etaActualizadoAt) : null,
    operatorLat: normalizeNullableNumber(row.operatorLat),
    operatorLng: normalizeNullableNumber(row.operatorLng),
    operatorLocationAtMs: row.operatorLocationAtMs != null ? Number(row.operatorLocationAtMs) : null,
    plateMismatch: row.plateMismatch === true || row.plateMismatch === "true",
    conductorNombre: row.conductorNombre ?? null,
    conductorDni: row.conductorDni ?? null,
    reportToken: row.reportToken ?? null,
    whatsappAsignadaSentAtMs: row.whatsappAsignadaSentAtMs != null ? Number(row.whatsappAsignadaSentAtMs) : null,
    whatsappFinalizadaSentAtMs: row.whatsappFinalizadaSentAtMs != null ? Number(row.whatsappFinalizadaSentAtMs) : null,
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
    base: row.base ?? null,
    marca: row.marca ?? null,
    modelo: row.modelo ?? null,
    esTaller: row.esTaller === true || row.esTaller === "true",
    notes: row.notes ?? null,
    active: row.active !== false,
    createdAtMs: Number(row.createdAtMs ?? Date.now()),
    updatedAtMs: Number(row.updatedAtMs ?? Date.now()),
  };
}

const ROADSIDE_ACTIVE_STATUSES = new Set(["asignada", "en_camino", "en_punto", "inicio_reparacion"]);
const ROADSIDE_CLOSED_STATUSES = new Set(["finalizada", "llegada_taller", "cancelada"]);

async function occupyTechForRoadside(techName: string, assistanceId: number) {
  await db.query(
    `
      UPDATE techs
      SET status = 'ocupado', "currentRoadsideAssistanceId" = $2
      WHERE name = $1
    `,
    [techName, assistanceId]
  );
}

async function freeTechFromRoadside(techName: string, assistanceId: number) {
  await db.query(
    `
      UPDATE techs
      SET status = 'disponible', "currentRoadsideAssistanceId" = NULL
      WHERE name = $1 AND "currentRoadsideAssistanceId" = $2
    `,
    [techName, assistanceId]
  );
}

async function syncTechRoadsideOccupation(
  assistanceId: number,
  status: string,
  assignedTechName: string | null,
  previousTechName?: string | null
) {
  if (previousTechName && previousTechName !== assignedTechName) {
    await freeTechFromRoadside(previousTechName, assistanceId);
  }

  if (!assignedTechName) return;

  if (ROADSIDE_ACTIVE_STATUSES.has(status)) {
    await occupyTechForRoadside(assignedTechName, assistanceId);
  } else if (ROADSIDE_CLOSED_STATUSES.has(status)) {
    await freeTechFromRoadside(assignedTechName, assistanceId);
  }
}

function getRoadsideStatusTimestampField(status: string) {
  if (status === "asignada") return "assignedAtMs";
  if (status === "en_camino") return "departedAtMs";
  if (status === "en_punto") return "arrivedAtPointMs";
  if (status === "inicio_reparacion") return "inicioReparacionAtMs";
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

async function getFcmAccessToken(): Promise<string | null> {
  try {
    const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!serviceAccountJson) return null;
    const { GoogleAuth } = await import("google-auth-library");
    const auth = new GoogleAuth({
      credentials: JSON.parse(serviceAccountJson),
      scopes: ["https://www.googleapis.com/auth/firebase.messaging"],
    });
    const client = await auth.getClient();
    const tokenResponse = await client.getAccessToken();
    return tokenResponse.token ?? null;
  } catch (error) {
    console.error("getFcmAccessToken error:", error);
    return null;
  }
}

async function sendFcmNotification(techName: string, title: string, body: string) {
  try {
    const result = await db.query(
      `SELECT "fcmToken" FROM techs WHERE name = $1 LIMIT 1`,
      [techName]
    );
    const token = result.rows[0]?.fcmToken;
    if (!token) return;

    const accessToken = await getFcmAccessToken();
    if (!accessToken) return;

    const projectId = "sea-tarragona";
    await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        message: {
          token,
          notification: { title, body },
          android: { priority: "high" },
        },
      }),
    });
  } catch (error) {
    console.error("sendFcmNotification error:", error);
  }
}

async function sendRoadsideStatusWhatsApp(
  assistance: any,
  status: string,
  extra?: { etaMinutos?: number | null; etaKm?: string | null; trackingUrl?: string; reportUrl?: string }
) {
  const customerPhone = String(assistance.customerPhone || "").trim();
  if (!customerPhone) return { status: "skipped", reason: "no_phone" };
  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) return { status: "skipped", reason: "no_twilio_credentials" };

  const name = assistance.customerName || "cliente";
  const tech = assistance.assignedTechName || "nuestro operario";
  const plate = assistance.plate || "tu vehículo";
  const to = `whatsapp:${normalizeSpanishPhone(customerPhone)}`;
  const from = getWhatsAppFromNumber();

  // ── asignada ────────────────────────────────────────────────────────────────
  if (status === "asignada") {
    const templateSid = String(process.env.TWILIO_TEMPLATE_ASIGNADA || "").trim();
    if (!templateSid) return { status: "skipped", reason: "no_template_asignada" };
    try {
      await twilioClient.messages.create({
        from,
        to,
        contentSid: templateSid,
        contentVariables: JSON.stringify({ "1": name, "2": plate, "3": tech }),
      });
      console.log(`[WhatsApp] asignada enviado → ${customerPhone} asistencia#${assistance.id}`);
      return { status: "sent" };
    } catch (err: any) {
      console.error(`[WhatsApp] asignada error asistencia#${assistance.id}:`, err.message);
      return { status: "error", reason: err.message };
    }
  }

  // ── en_camino ───────────────────────────────────────────────────────────────
  if (status === "en_camino") {
    const templateSid = String(
      process.env.TWILIO_TEMPLATE_EN_CAMINO || process.env.TWILIO_ROADSIDE_CONTENT_SID || ""
    ).trim();
    if (!templateSid) return { status: "skipped", reason: "no_template_en_camino" };
    if (!extra?.trackingUrl) return { status: "skipped", reason: "no_tracking_url" };
    try {
      await twilioClient.messages.create({
        from,
        to,
        contentSid: templateSid,
        contentVariables: JSON.stringify({
          "1": name,
          "2": plate,
          "3": extra.trackingUrl,
          "4": tech,
        }),
      });
      console.log(`[WhatsApp] en_camino enviado → ${customerPhone} asistencia#${assistance.id} url=${extra.trackingUrl}`);
      return { status: "sent" };
    } catch (err: any) {
      console.error(`[WhatsApp] en_camino error asistencia#${assistance.id}:`, err.message);
      return { status: "error", reason: err.message };
    }
  }

  // ── finalizada ──────────────────────────────────────────────────────────────
  if (status === "finalizada") {
    const templateSid = String(process.env.TWILIO_TEMPLATE_FINALIZADA || "").trim();
    if (!templateSid) return { status: "skipped", reason: "no_template_finalizada" };
    if (!extra?.reportUrl) return { status: "skipped", reason: "no_report_url" };
    try {
      await twilioClient.messages.create({
        from,
        to,
        contentSid: templateSid,
        contentVariables: JSON.stringify({ "1": name, "2": plate, "3": extra.reportUrl }),
      });
      console.log(`[WhatsApp] finalizada enviado → ${customerPhone} asistencia#${assistance.id} url=${extra.reportUrl}`);
      return { status: "sent" };
    } catch (err: any) {
      console.error(`[WhatsApp] finalizada error asistencia#${assistance.id}:`, err.message);
      return { status: "error", reason: err.message };
    }
  }

  return { status: "skipped", reason: "no_message_for_status" };
}

async function calcularETA(
  origen: { lat: number; lng: number },
  destino: { lat: number; lng: number }
): Promise<{ minutos: number; kilometros: string }> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_MAPS_API_KEY no configurada");

  const url = "https://routes.googleapis.com/directions/v2:computeRoutes";

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": "routes.duration,routes.distanceMeters",
    },
    body: JSON.stringify({
      origin: { location: { latLng: { latitude: origen.lat, longitude: origen.lng } } },
      destination: { location: { latLng: { latitude: destino.lat, longitude: destino.lng } } },
      travelMode: "DRIVE",
      routingPreference: "TRAFFIC_AWARE",
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Error Google Routes API: ${response.status} ${text}`);
  }

  const data = await response.json();
  const ruta = data.routes?.[0];
  if (!ruta) throw new Error("No se encontró ruta entre los puntos indicados");

  const segundos = parseInt(String(ruta.duration).replace("s", ""), 10);
  const minutos = Math.round(segundos / 60);
  const kilometros = (ruta.distanceMeters / 1000).toFixed(1);

  return { minutos, kilometros };
}

function extractLatLngFromGoogleMapsUrl(url: string): { lat: number; lng: number } | null {
  const patterns = [
    /@(-?\d+\.\d+),(-?\d+\.\d+)/,
    /[?&]q=(-?\d+\.\d+),(-?\d+\.\d+)/,
    /[?&]query=(-?\d+\.\d+),(-?\d+\.\d+)/,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) {
      return { lat: Number(match[1]), lng: Number(match[2]) };
    }
  }
  return null;
}

app.post("/api/geocode", async (req, res) => {
  try {
    const address = String(req.body?.address || "").trim();
    if (!address) {
      return res.status(400).json({ error: "Indica una dirección" });
    }

    if (/^https?:\/\//i.test(address)) {
      const fromUrl = extractLatLngFromGoogleMapsUrl(address);
      if (fromUrl) {
        return res.json({ ...fromUrl, formattedAddress: address });
      }
    }

    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      return res.status(503).json({ error: "GOOGLE_MAPS_API_KEY no configurada" });
    }

    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${apiKey}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Error Google Geocoding API: ${response.status}`);
    }

    const data = await response.json();
    if (data.status !== "OK" || !data.results?.[0]) {
      return res.status(404).json({ error: `No se encontraron coordenadas para "${address}"` });
    }

    const result = data.results[0];
    const { lat, lng } = result.geometry.location;

    res.json({ lat, lng, formattedAddress: result.formatted_address as string });
  } catch (error: any) {
    console.error("POST /api/geocode error:", error);
    res.status(500).json({ error: error?.message || "Error geocodificando dirección" });
  }
});

function buildWebfleetRequest(action: string, extra: Record<string, string> = {}): { url: string; headers: Record<string, string> } {
  const account = process.env.WEBFLEET_ACCOUNT;
  const username = process.env.WEBFLEET_USERNAME;
  const password = process.env.WEBFLEET_PASSWORD;
  const apiKey = process.env.WEBFLEET_API_KEY;
  const baseUrl = process.env.WEBFLEET_BASE_URL || "https://csv.webfleet.com/extern";

  if (!account || !username || !password) {
    throw new Error("Variables de entorno Webfleet no configuradas (WEBFLEET_ACCOUNT, WEBFLEET_USERNAME, WEBFLEET_PASSWORD)");
  }

  const params = new URLSearchParams({ account, action, lang: "en", outputformat: "json", useISO8601: "true", ...extra });
  if (apiKey) params.set("apikey", apiKey);

  const credentials = Buffer.from(`${username}:${password}`).toString("base64");

  return {
    url: `${baseUrl}?${params.toString()}`,
    headers: { Authorization: `Basic ${credentials}` },
  };
}

const STOPPED_SPEED_THRESHOLD_KMH = 3;

async function getWebfleetVehiclePosition(vehicleId: string): Promise<{
  lat: number;
  lng: number;
  vehicleId: string;
  timestamp?: string;
  speedKmh: number | null;
  moving: boolean | null;
}> {
  const { url, headers } = buildWebfleetRequest("showObjectReportExtern", { objectno: vehicleId });
  const response = await fetch(url, { headers });

  if (!response.ok) throw new Error(`Webfleet error HTTP ${response.status}`);

  const data = await response.json();
  if (data?.errorCode) throw new Error(`Webfleet error ${data.errorCode}: ${data.errorMsg}`);

  const vehicles = Array.isArray(data) ? data : data?.data ?? [];
  const vehicle = vehicles.find((v: any) => String(v.objectno) === String(vehicleId));

  if (!vehicle) throw new Error(`Vehículo ${vehicleId} no encontrado en Webfleet`);

  // Webfleet devuelve posición en milésimas de grado
  const lat = Number(vehicle.latitude_mdeg) / 1_000_000;
  const lng = Number(vehicle.longitude_mdeg) / 1_000_000;

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new Error(`Posición inválida para vehículo ${vehicleId}`);
  }

  const rawSpeed = Number(vehicle.speed);
  const speedKmh = Number.isFinite(rawSpeed) ? rawSpeed : null;
  const moving = speedKmh != null ? speedKmh >= STOPPED_SPEED_THRESHOLD_KMH : null;

  return {
    lat,
    lng,
    vehicleId,
    timestamp: vehicle.pos_time ?? undefined,
    speedKmh,
    moving,
  };
}

function getJobOperationLabel(job: any) {
  return (
    job.quickEntryLabel ||
    job.template ||
    job.area ||
    "trabajo de taller"
  );
}

async function sendJobFinishedWhatsApp(job: any) {
  const customerPhone = String(job.customerPhone || "").trim();

  if (!customerPhone) {
    return { status: "skipped", reason: "missing_phone" };
  }

  if (job.finishedWhatsappSentAtMs) {
    return {
      status: "skipped",
      reason: "already_sent",
      sentAtMs: job.finishedWhatsappSentAtMs,
      sid: job.finishedWhatsappSid ?? null,
    };
  }

  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
    return { status: "skipped", reason: "missing_twilio_credentials" };
  }

  const contentSid = String(
    process.env.TWILIO_JOB_FINISHED_CONTENT_SID || ""
  ).trim();

  if (!contentSid) {
    return { status: "skipped", reason: "missing_job_finished_template" };
  }

  const message = await twilioClient.messages.create({
    from: getWhatsAppFromNumber(),
    to: `whatsapp:${normalizeSpanishPhone(customerPhone)}`,
    contentSid,
    contentVariables: JSON.stringify({
      "1": job.customerName || "cliente",
      "2": job.plate || "-",
      "3": getJobOperationLabel(job),
    }),
  });

  const sentAtMs = Date.now();

  await db.query(
    `
      UPDATE jobs
      SET
        "finishedWhatsappSentAtMs" = $1,
        "finishedWhatsappSid" = $2
      WHERE id = $3
    `,
    [sentAtMs, message.sid, job.id]
  );

  return { status: "sent", sentAtMs, sid: message.sid };
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
  const token = String(req.headers["x-admin-token"] ?? req.query?.token ?? "");

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
  const token = String(req.headers["x-admin-token"] ?? req.query?.token ?? "");

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

function normalizeRoadsideOperatorCodeRow(row: any, includeCode = true) {
  const code = String(row.roadsideOperatorCode || "").trim();

  return {
    techName: row.name ?? "",
    code: includeCode ? code : "",
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

  return String(result.rows[0].roadsideOperatorCode || "").trim();
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
    const safeJobs = Array.isArray(jobs) ? jobs : [];
    const safeTechs = Array.isArray(techs) ? techs : [];
    const summarizeJobForAI = (job: any) => ({
      id: job.id,
      area: job.area,
      plate: job.plate,
      urgent: !!job.urgent,
      status: job.status,
      assignedNames: Array.isArray(job.assignedNames) ? job.assignedNames : [],
      reason: job.reason || "",
      template: job.template || null,
      quickEntryLabel: job.quickEntryLabel || null,
      quickEntryMode: job.quickEntryMode || null,
      startedAtMs: job.startedAtMs ?? null,
      workedAccumulatedMinutes: job.workedAccumulatedMinutes ?? 0,
      pausedAccumulatedMinutes: job.pausedAccumulatedMinutes ?? 0,
    });

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
  waitingJobs: safeJobs
    .filter((j: any) => j.status === "espera")
    .map(summarizeJobForAI),
runningJobs: safeJobs
  .filter((j: any) => j.status === "activo")
  .map(summarizeJobForAI),
techs: safeTechs.map((t: any) => ({
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
      SELECT name, status, blocked, "currentJobId", competencies, priorities, avatar,
             "roadsideCapable", "currentRoadsideAssistanceId", phone
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
      roadsideCapable,
      phone,
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

    const existingResult = await db.query(
      `SELECT "roadsideCapable" FROM techs WHERE name = $1`,
      [name]
    );
    const normalizedRoadsideCapable =
      roadsideCapable === undefined
        ? existingResult.rows[0]?.roadsideCapable === true
        : Boolean(roadsideCapable);

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
          "statusTotals",
          "roadsideCapable",
          phone
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        ON CONFLICT (name)
        DO UPDATE SET
          status = EXCLUDED.status,
          blocked = EXCLUDED.blocked,
          "currentJobId" = EXCLUDED."currentJobId",
          competencies = EXCLUDED.competencies,
          priorities = EXCLUDED.priorities,
          avatar = EXCLUDED.avatar,
          "statusChangedAtMs" = EXCLUDED."statusChangedAtMs",
          "statusTotals" = EXCLUDED."statusTotals",
          "roadsideCapable" = EXCLUDED."roadsideCapable",
          phone = EXCLUDED.phone
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
        normalizedRoadsideCapable,
        phone != null ? String(phone).trim() || null : null,
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
          "statusTotals",
          "roadsideCapable",
          "currentRoadsideAssistanceId",
          phone
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

app.delete("/api/techs/:name", requireAdminRole, async (req, res) => {
  try {
    const name = String(req.params.name);

    if (name === "Ramón") {
      return res.status(400).json({ error: "No se puede eliminar a Ramón" });
    }

    const result = await db.query(`DELETE FROM techs WHERE name = $1 RETURNING name`, [name]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Técnico no encontrado" });
    }

    res.json({ ok: true });
  } catch (error) {
    console.error("DELETE /api/techs/:name error:", error);
    res.status(500).json({ error: "Error eliminando técnico" });
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
          "customerName",
          "customerPhone",
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
          $10, $11, $12, $13, $14, $15, $16, $17,
          $18, $19
        )
        ON CONFLICT (id) DO UPDATE SET
          area = EXCLUDED.area,
          plate = EXCLUDED.plate,
          urgent = EXCLUDED.urgent,
          status = EXCLUDED.status,
          "assignedNames" = EXCLUDED."assignedNames",
          reason = EXCLUDED.reason,
          "customerName" = EXCLUDED."customerName",
          "customerPhone" = EXCLUDED."customerPhone",
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
        String(job.customerName || "").trim(),
        String(job.customerPhone || "").trim(),
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
          "customerName",
          "customerPhone",
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
          $10, $11, $12, $13, $14, $15, $16, $17,
          $18, $19
        )
        ON CONFLICT (id) DO UPDATE SET
          area = EXCLUDED.area,
          plate = EXCLUDED.plate,
          urgent = EXCLUDED.urgent,
          status = EXCLUDED.status,
          "assignedNames" = EXCLUDED."assignedNames",
          reason = EXCLUDED.reason,
          "customerName" = EXCLUDED."customerName",
          "customerPhone" = EXCLUDED."customerPhone",
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
        String(job.customerName || "").trim(),
        String(job.customerPhone || "").trim(),
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

    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: "ID de trabajo no valido" });
    }

    const {
      closedAtMs,
      actualMinutes,
      workedAccumulatedMinutes,
      pausedAccumulatedMinutes,
    } = req.body ?? {};

    const result = await db.query(
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
    RETURNING *
  `,
  [
    closedAtMs ?? Date.now(),
    actualMinutes ?? null,
    workedAccumulatedMinutes ?? actualMinutes ?? 0,
    pausedAccumulatedMinutes ?? 0,
    id,
  ]
);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Trabajo no encontrado" });
    }

    const closedJob = normalizeJobRow(result.rows[0]);
    let whatsapp: any = { status: "skipped", reason: "not_attempted" };

    try {
      whatsapp = await sendJobFinishedWhatsApp(closedJob);
    } catch (whatsappError: any) {
      whatsapp = {
        status: "error",
        message: whatsappError?.message || "Error enviando WhatsApp",
        code: whatsappError?.code ?? null,
      };

      console.error("Error enviando WhatsApp de trabajo finalizado:", {
        jobId: id,
        to: normalizeSpanishPhone(closedJob.customerPhone),
        contentSid: process.env.TWILIO_JOB_FINISHED_CONTENT_SID,
        message: whatsappError?.message,
        code: whatsappError?.code,
        status: whatsappError?.status,
        moreInfo: whatsappError?.moreInfo,
      });
    }

    res.json({ ok: true, whatsapp });
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
          base,
          marca,
          modelo,
          "esTaller",
          notes,
          active,
          "createdAtMs",
          "updatedAtMs"
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)
        RETURNING *
      `,
      [
        body.workshopId ?? null,
        name,
        body.plate ? String(body.plate).trim().toUpperCase() : null,
        body.webfleetVehicleId ? String(body.webfleetVehicleId).trim() : null,
        body.base ? String(body.base).trim() : null,
        body.marca ? String(body.marca).trim() : null,
        body.modelo ? String(body.modelo).trim() : null,
        body.esTaller === true || body.esTaller === "true",
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
          base = $6,
          marca = $7,
          modelo = $8,
          "esTaller" = $9,
          notes = $10,
          active = $11,
          "updatedAtMs" = $12
        WHERE id = $1
        RETURNING *
      `,
      [
        id,
        body.workshopId ?? null,
        name,
        body.plate ? String(body.plate).trim().toUpperCase() : null,
        body.webfleetVehicleId ? String(body.webfleetVehicleId).trim() : null,
        body.base ? String(body.base).trim() : null,
        body.marca ? String(body.marca).trim() : null,
        body.modelo ? String(body.modelo).trim() : null,
        body.esTaller === true || body.esTaller === "true",
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

app.get("/api/roadside-assistances/historial", requireSupervisorRole, async (req, res) => {
  try {
    const q = String(req.query.q || "").trim().toLowerCase();
    const status = String(req.query.status || "").trim();
    const techName = String(req.query.techName || "").trim();
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = 50;
    const offset = (page - 1) * limit;

    const conditions: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (q) {
      conditions.push(
        `(LOWER("plate") LIKE $${idx} OR LOWER("customerName") LIKE $${idx} OR LOWER("customerPhone") LIKE $${idx} OR LOWER("address") LIKE $${idx})`
      );
      params.push(`%${q}%`);
      idx++;
    }
    if (status) {
      conditions.push(`status = $${idx}`);
      params.push(status);
      idx++;
    }
    if (techName) {
      conditions.push(`"assignedTechName" = $${idx}`);
      params.push(techName);
      idx++;
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const [dataResult, countResult] = await Promise.all([
      db.query(
        `SELECT * FROM roadside_assistances ${where} ORDER BY "createdAtMs" DESC LIMIT $${idx} OFFSET $${idx + 1}`,
        [...params, limit, offset]
      ),
      db.query(
        `SELECT COUNT(*) FROM roadside_assistances ${where}`,
        params
      ),
    ]);

    res.json({
      items: dataResult.rows.map(normalizeRoadsideAssistanceRow),
      total: Number(countResult.rows[0].count),
      page,
      limit,
    });
  } catch (error) {
    console.error("GET /api/roadside-assistances/historial error:", error);
    res.status(500).json({ error: "Error obteniendo historial" });
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

    let assistance = normalizeRoadsideAssistanceRow(assistanceResult.rows[0]);

    // Recalcular ETA en tiempo real si la furgoneta está en camino
    let etaWarning: string | null = null;
    let vehiclePosition: {
      lat: number;
      lng: number;
      speedKmh: number | null;
      moving: boolean | null;
    } | null = null;

    const canRecalculate =
      assistance.status === "en_camino" &&
      assistance.webfleetVehicleId &&
      assistance.latitude != null &&
      assistance.longitude != null;

    if (canRecalculate) {
      try {
        vehiclePosition = await getWebfleetVehiclePosition(assistance.webfleetVehicleId!);
        const eta = await calcularETA(
          vehiclePosition,
          { lat: assistance.latitude!, lng: assistance.longitude! }
        );
        const now = Date.now();

        await db.query(
          `UPDATE roadside_assistances
           SET "etaMinutos" = $2, "etaKm" = $3, "etaActualizadoAt" = $4
           WHERE id = $1`,
          [assistance.id, eta.minutos, eta.kilometros, now]
        );

        assistance = {
          ...assistance,
          etaMinutos: eta.minutos,
          etaKm: eta.kilometros,
          etaActualizadoAt: now,
        };
      } catch (etaErr: any) {
        etaWarning = etaErr?.message ?? "Error recalculando ETA";
        console.error("tracking ETA recalc error:", etaWarning);
      }
    }

    const [eventsResult, filesResult] = await Promise.all([
      db.query(
        `SELECT status, "createdAtMs"
         FROM roadside_assistance_events
         WHERE "assistanceId" = $1
         ORDER BY "createdAtMs" ASC`,
        [assistance.id]
      ),
      db.query(
        `SELECT id, kind, url, "fileName", "createdAtMs"
         FROM roadside_assistance_files
         WHERE "assistanceId" = $1
         ORDER BY "createdAtMs" ASC`,
        [assistance.id]
      ),
    ]);

    res.json({
      assistance,
      events: eventsResult.rows.map((e: any) => ({
        status: e.status,
        createdAtMs: Number(e.createdAtMs),
      })),
      files: filesResult.rows.map((f: any) => ({
        id: Number(f.id),
        kind: f.kind,
        url: f.url,
        fileName: f.fileName ?? null,
        createdAtMs: Number(f.createdAtMs),
      })),
      vehiclePosition: vehiclePosition
        ? {
            lat: Math.round(vehiclePosition.lat * 1000) / 1000,
            lng: Math.round(vehiclePosition.lng * 1000) / 1000,
            speedKmh: vehiclePosition.speedKmh,
            moving: vehiclePosition.moving,
          }
        : null,
      etaWarning,
      expired:
        assistance.status === "llegada_taller" ||
        assistance.status === "cancelada",
    });
  } catch (error) {
    console.error("GET /api/roadside-tracking/:token error:", error);
    res.status(500).json({ error: "Error obteniendo seguimiento" });
  }
});

app.get("/api/roadside-report/:token", async (req, res) => {
  try {
    const token = String(req.params.token || "").trim();
    if (!token) return res.status(400).json({ error: "Token no valido" });

    const assistanceResult = await db.query(
      `SELECT * FROM roadside_assistances WHERE "reportToken" = $1 LIMIT 1`,
      [token]
    );

    if (assistanceResult.rows.length === 0) {
      return res.status(404).json({ error: "Informe no encontrado" });
    }

    const assistance = normalizeRoadsideAssistanceRow(assistanceResult.rows[0]);

    const [eventsResult, filesResult] = await Promise.all([
      db.query(
        `SELECT status, "createdAtMs"
         FROM roadside_assistance_events
         WHERE "assistanceId" = $1
         ORDER BY "createdAtMs" ASC`,
        [assistance.id]
      ),
      db.query(
        `SELECT id, kind, url, "fileName", "createdAtMs"
         FROM roadside_assistance_files
         WHERE "assistanceId" = $1
         ORDER BY "createdAtMs" ASC`,
        [assistance.id]
      ),
    ]);

    res.json({
      assistance,
      events: eventsResult.rows.map((e: any) => ({
        status: e.status,
        createdAtMs: Number(e.createdAtMs),
      })),
      files: filesResult.rows.map((f: any) => ({
        id: Number(f.id),
        kind: f.kind,
        url: f.url,
        fileName: f.fileName ?? null,
        createdAtMs: Number(f.createdAtMs),
      })),
      pdfUrl: `/api/roadside-report/${token}/pdf`,
    });
  } catch (error) {
    console.error("GET /api/roadside-report/:token error:", error);
    res.status(500).json({ error: "Error obteniendo informe" });
  }
});

app.get("/api/roadside-report/:token/pdf", async (req, res) => {
  try {
    const token = String(req.params.token || "").trim();
    if (!token) return res.status(400).json({ error: "Token no valido" });

    const assistanceResult = await db.query(
      `SELECT id FROM roadside_assistances WHERE "reportToken" = $1 LIMIT 1`,
      [token]
    );
    if (assistanceResult.rows.length === 0) {
      return res.status(404).json({ error: "Informe no encontrado" });
    }

    const id = Number(assistanceResult.rows[0].id);
    const { buffer } = await buildAssistanceReportPdfBuffer(id);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="asistencia_${id}.pdf"`);
    res.send(buffer);
  } catch (error: any) {
    console.error("GET /api/roadside-report/:token/pdf error:", error);
    if (!res.headersSent) {
      res.status(500).json({ error: "Error generando informe PDF" });
    }
  }
});

app.get(
  "/api/roadside-operator-codes",
  requireSupervisorRole,
  async (req, res) => {
    try {
      const role = getRoleFromRequest(req);
      const includeCode = role === "admin";

      const result = await db.query(`
        SELECT name, "roadsideOperatorCode"
        FROM techs
        WHERE NULLIF(TRIM(COALESCE("roadsideOperatorCode", '')), '') IS NOT NULL
        ORDER BY id ASC
      `);

      res.json(
        result.rows.map((row) =>
          normalizeRoadsideOperatorCodeRow(row, includeCode)
        )
      );
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

app.delete(
  "/api/roadside-operator-codes/:name",
  requireAdminRole,
  async (req, res) => {
    try {
      const name = String(req.params.name || "").trim();

      if (!name) {
        return res.status(400).json({ error: "Operario no valido" });
      }

      const result = await db.query(
        `
          UPDATE techs
          SET "roadsideOperatorCode" = NULL
          WHERE name = $1
          RETURNING name, "roadsideOperatorCode"
        `,
        [name]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Operario no encontrado" });
      }

      res.json(normalizeRoadsideOperatorCodeRow(result.rows[0]));
    } catch (error) {
      console.error("DELETE /api/roadside-operator-codes/:name error:", error);
      res.status(500).json({ error: "Error dando de baja operario" });
    }
  }
);

/* ── ETA ─────────────────────────────────────────────────────────────── */
app.post("/api/maps/eta", async (req, res) => {
  try {
    const { origen, destino } = req.body;
    const eta = await calcularETA(origen, destino);
    res.json({ ok: true, eta });
  } catch (error) {
    console.error("Error ETA:", error);
    res.status(500).json({ ok: false, error: "No se pudo calcular el ETA" });
  }
});

app.post("/api/roadside-eta", async (req, res) => {
  try {
    const { origen, destino } = req.body as {
      origen?: { lat: number; lng: number };
      destino?: { lat: number; lng: number };
    };

    if (
      !origen || typeof origen.lat !== "number" || typeof origen.lng !== "number" ||
      !destino || typeof destino.lat !== "number" || typeof destino.lng !== "number"
    ) {
      res.status(400).json({ error: "Se requieren origen.lat, origen.lng, destino.lat, destino.lng" });
      return;
    }

    const result = await calcularETA(origen, destino);
    res.json(result);
  } catch (error: any) {
    const noKey = error?.message?.includes("no configurada");
    res.status(noKey ? 503 : 500).json({ error: error?.message || "Error calculando ETA" });
  }
});

app.get("/api/webfleet/debug", async (_req, res) => {
  try {
    const { url, headers } = buildWebfleetRequest("showObjectReportExtern");
    const response = await fetch(url, { headers });
    const text = await response.text();
    res.json({
      status: response.status,
      authHeader: headers.Authorization ? "Basic ***" : "none",
      rawResponse: text.slice(0, 3000),
    });
  } catch (error: any) {
    res.status(500).json({ error: error?.message });
  }
});

app.get("/api/webfleet/vehicles", async (_req, res) => {
  try {
    const { url, headers } = buildWebfleetRequest("showObjectReportExtern");
    const response = await fetch(url, { headers });
    if (!response.ok) return res.status(502).json({ error: `Webfleet error HTTP ${response.status}` });

    const data = await response.json();
    if (data?.errorCode) return res.status(502).json({ error: `Webfleet error ${data.errorCode}: ${data.errorMsg}` });

    const vehicles = Array.isArray(data) ? data : data?.data ?? [];
    res.json(
      vehicles.map((v: any) => ({
        objectno: v.objectno,
        objectname: v.objectname ?? v.objectno,
        lat: Number(v.latitude_mdeg) / 1_000_000,
        lng: Number(v.longitude_mdeg) / 1_000_000,
        postext: v.postext_short ?? v.postext ?? null,
        timestamp: v.pos_time ?? null,
      }))
    );
  } catch (error: any) {
    res.status(500).json({ error: error?.message || "Error listando vehículos Webfleet" });
  }
});

app.get("/api/webfleet/vehicle/:vehicleId/position", async (req, res) => {
  try {
    const { vehicleId } = req.params;
    const position = await getWebfleetVehiclePosition(vehicleId);
    res.json(position);
  } catch (error: any) {
    const noConfig = error?.message?.includes("no configuradas");
    res.status(noConfig ? 503 : 500).json({ error: error?.message || "Error obteniendo posición Webfleet" });
  }
});

app.post("/api/asistencias/:id/en-camino", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: "ID de asistencia no valido" });
    }

    const current = await db.query(
      `SELECT * FROM roadside_assistances WHERE id = $1 LIMIT 1`,
      [id]
    );
    if (current.rows.length === 0) {
      return res.status(404).json({ error: "Asistencia no encontrada" });
    }

    const row = current.rows[0];
    const destLat = normalizeNullableNumber(row.latitude);
    const destLng = normalizeNullableNumber(row.longitude);
    if (destLat === null || destLng === null) {
      return res.status(400).json({ error: "La asistencia no tiene coordenadas de destino" });
    }

    let origen: { lat: number; lng: number };
    if (row.webfleetVehicleId) {
      origen = await getWebfleetVehiclePosition(row.webfleetVehicleId);
    } else {
      origen = { lat: 41.1452, lng: 1.3987 };
    }

    const destino = { lat: destLat, lng: destLng };
    const eta = await calcularETA(origen, destino);
    const now = Date.now();

    const result = await db.query(
      `
        UPDATE roadside_assistances
        SET
          status = 'en_camino',
          "departedAtMs" = COALESCE("departedAtMs", $2),
          "etaMinutos" = $3,
          "etaKm" = $4,
          "updatedAtMs" = $2
        WHERE id = $1
        RETURNING *
      `,
      [id, now, eta.minutos, eta.kilometros]
    );

    const updated = normalizeRoadsideAssistanceRow(result.rows[0]);

    // Enviar WhatsApp si tiene teléfono y no se ha enviado ya
    let whatsappWarning: string | undefined;
    if (updated.customerPhone && !row.whatsappEnCaminoEnviado) {
      try {
        const trackingUrl = buildRoadsideTrackingUrl(req, updated);
        const waResult = await sendRoadsideStatusWhatsApp(updated, "en_camino", {
          etaMinutos: updated.etaMinutos,
          etaKm: updated.etaKm,
          trackingUrl,
        });

        if (waResult?.status === "sent") {
          await db.query(
            `UPDATE roadside_assistances
             SET "whatsappEnCaminoEnviado" = true, "whatsappEnCaminoAt" = $2
             WHERE id = $1`,
            [id, now]
          );
        } else {
          whatsappWarning = `WhatsApp no enviado: ${waResult?.reason ?? "desconocido"}`;
        }
      } catch (waErr: any) {
        whatsappWarning = `WhatsApp fallido: ${waErr?.message ?? "error desconocido"}`;
        console.error("en-camino WhatsApp error:", waErr?.message);
      }
    }

    await syncTechRoadsideOccupation(updated.id, updated.status, updated.assignedTechName);

    return res.json({
      ...updated,
      whatsappWarning: whatsappWarning ?? null,
    });
  } catch (error: any) {
    const noConfig = error?.message?.includes("no configuradas") || error?.message?.includes("no configurada");
    res.status(noConfig ? 503 : 500).json({ error: error?.message || "Error al actualizar asistencia" });
  }
});

app.get("/api/roadside-operator/techs", async (_req, res) => {
  try {
    const result = await db.query(`
      SELECT *
      FROM techs
      WHERE NULLIF(TRIM(COALESCE("roadsideOperatorCode", '')), '') IS NOT NULL
      ORDER BY id ASC
    `);

    res.json(result.rows.map(normalizeTechRow));
  } catch (error) {
    console.error("GET /api/roadside-operator/techs error:", error);
    res.status(500).json({ error: "Error obteniendo operarios asistencia" });
  }
});

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

app.post(
  "/api/roadside-operator/register-token",
  requireRoadsideOperator,
  async (req, res) => {
    try {
      const operator = (req as any).roadsideOperator as { techName: string };
      const fcmToken = String(req.body?.fcmToken || "").trim();

      if (!fcmToken) {
        return res.status(400).json({ error: "Token requerido" });
      }

      await db.query(
        `UPDATE techs SET "fcmToken" = $1 WHERE name = $2`,
        [fcmToken, operator.techName]
      );

      res.json({ ok: true });
    } catch (error) {
      console.error("POST /api/roadside-operator/register-token error:", error);
      res.status(500).json({ error: "Error registrando token" });
    }
  }
);

app.post(
  "/api/roadside-operator/assistances/:id/location",
  requireRoadsideOperator,
  async (req, res) => {
    try {
      const operator = (req as any).roadsideOperator as { techName: string };
      const id = Number(req.params.id);
      const lat = normalizeNullableNumber(req.body?.lat);
      const lng = normalizeNullableNumber(req.body?.lng);

      if (!Number.isFinite(id)) {
        return res.status(400).json({ error: "ID de asistencia no valido" });
      }

      if (lat == null || lng == null) {
        return res.status(400).json({ error: "Coordenadas no validas" });
      }

      const check = await db.query(
        `SELECT id FROM roadside_assistances WHERE id = $1 AND "assignedTechName" = $2 LIMIT 1`,
        [id, operator.techName]
      );

      if (check.rows.length === 0) {
        return res.status(403).json({ error: "Asistencia no encontrada o no asignada a ti" });
      }

      await db.query(
        `
          UPDATE roadside_assistances
          SET "operatorLat" = $2, "operatorLng" = $3, "operatorLocationAtMs" = $4
          WHERE id = $1
        `,
        [id, lat, lng, Date.now()]
      );

      res.json({ ok: true });
    } catch (error) {
      console.error("POST /api/roadside-operator/assistances/:id/location error:", error);
      res.status(500).json({ error: "Error guardando ubicacion" });
    }
  }
);

app.post(
  "/api/roadside-operator/assistances/:id/en-camino",
  requireRoadsideOperator,
  async (req, res) => {
    try {
      const operator = (req as any).roadsideOperator as { techName: string };
      const id = Number(req.params.id);

      if (!Number.isFinite(id)) {
        return res.status(400).json({ error: "ID de asistencia no valido" });
      }

      // Verificar que la asistencia pertenece al operario
      const check = await db.query(
        `SELECT * FROM roadside_assistances WHERE id = $1 AND "assignedTechName" = $2 LIMIT 1`,
        [id, operator.techName]
      );

      if (check.rows.length === 0) {
        return res.status(403).json({ error: "Asistencia no encontrada o no asignada a ti" });
      }

      if (check.rows[0].status !== "asignada") {
        return res.status(400).json({ error: "La asistencia no está en estado asignada" });
      }

      // Reutilizar lógica de en-camino (Webfleet + ETA)
      const internalRes = await fetch(
        `http://localhost:${process.env.PORT || 3000}/api/asistencias/${id}/en-camino`,
        { method: "POST" }
      );
      const data = await internalRes.json();

      if (!internalRes.ok) {
        return res.status(internalRes.status).json(data);
      }

      res.json(data);
    } catch (error) {
      console.error("POST /api/roadside-operator/assistances/:id/en-camino error:", error);
      res.status(500).json({ error: "Error al salir en camino" });
    }
  }
);

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
        "inicio_reparacion",
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

      let updated = normalizeRoadsideAssistanceRow(result.rows[0]);

      // Generar reportToken al finalizar
      if (status === "finalizada" && !updated.reportToken) {
        const { randomUUID } = await import("crypto");
        const reportToken = randomUUID();
        const rtResult = await db.query(
          `UPDATE roadside_assistances SET "reportToken" = $2 WHERE id = $1 RETURNING *`,
          [id, reportToken]
        );
        updated = normalizeRoadsideAssistanceRow(rtResult.rows[0]);
      }

      await syncTechRoadsideOccupation(updated.id, updated.status, updated.assignedTechName);
      res.json(updated);

      if (status === "finalizada" && updated.customerPhone && !updated.whatsappFinalizadaSentAtMs && updated.reportToken) {
        const reportUrl = `${getPublicAppBaseUrl(req)}/informe/${updated.reportToken}`;
        const waResult = await sendRoadsideStatusWhatsApp(updated, "finalizada", { reportUrl });
        if (waResult?.status === "sent") {
          await db.query(
            `UPDATE roadside_assistances SET "whatsappFinalizadaSentAtMs" = $2 WHERE id = $1`,
            [id, now]
          );
        }
      }
    } catch (error) {
      console.error("POST /api/roadside-operator/assistances/:id/status error:", error);
      res.status(500).json({ error: "Error cambiando estado operario" });
    }
  }
);

app.post(
  "/api/roadside-operator/assistances/:id/conductor",
  requireRoadsideOperator,
  async (req, res) => {
    try {
      const operator = (req as any).roadsideOperator as { techName: string };
      const id = Number(req.params.id);
      const nombre = String(req.body?.conductorNombre || "").trim();
      const dni = String(req.body?.conductorDni || "").trim();

      if (!Number.isFinite(id)) {
        return res.status(400).json({ error: "ID no válido" });
      }
      if (!nombre || !dni) {
        return res.status(400).json({ error: "Nombre y DNI obligatorios" });
      }

      const check = await db.query(
        `SELECT id FROM roadside_assistances WHERE id = $1 AND "assignedTechName" = $2 LIMIT 1`,
        [id, operator.techName]
      );
      if (check.rows.length === 0) {
        return res.status(403).json({ error: "Asistencia no encontrada o no asignada a ti" });
      }

      const result = await db.query(
        `UPDATE roadside_assistances SET "conductorNombre" = $2, "conductorDni" = $3 WHERE id = $1 RETURNING *`,
        [id, nombre, dni]
      );

      res.json(normalizeRoadsideAssistanceRow(result.rows[0]));
    } catch (error) {
      console.error("POST /api/roadside-operator/assistances/:id/conductor error:", error);
      res.status(500).json({ error: "Error guardando datos del conductor" });
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

    // Notificación push al técnico asignado
    if (assistance.assignedTechName && assistance.status === "asignada") {
      void sendFcmNotification(
        assistance.assignedTechName,
        "Nueva asistencia asignada",
        `${assistance.plate || "Vehículo"} · ${assistance.address || assistance.customerName}`
      );
    }

    await syncTechRoadsideOccupation(
      assistance.id,
      assistance.status,
      assistance.assignedTechName
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
        SELECT status, "assignedTechName"
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
    const previousTechName: string | null = existingResult.rows[0].assignedTechName ?? null;

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

    const updated = normalizeRoadsideAssistanceRow(result.rows[0]);

    // Notificación push al técnico si se le asigna la asistencia
    if (updated.assignedTechName && previousStatus === "pendiente" && status === "asignada") {
      void sendFcmNotification(
        updated.assignedTechName,
        "Nueva asistencia asignada",
        `${updated.plate || "Vehículo"} · ${updated.address || updated.customerName}`
      );
    }

    await syncTechRoadsideOccupation(
      updated.id,
      updated.status,
      updated.assignedTechName,
      previousTechName
    );

    res.json(updated);
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

      let updated = normalizeRoadsideAssistanceRow(result.rows[0]);

      // ── Generar reportToken si se finaliza y no existe ya ──────────────────
      if (status === "finalizada" && !updated.reportToken) {
        const { randomUUID } = await import("crypto");
        const reportToken = randomUUID();
        const rtResult = await db.query(
          `UPDATE roadside_assistances SET "reportToken" = $2 WHERE id = $1 RETURNING *`,
          [id, reportToken]
        );
        updated = normalizeRoadsideAssistanceRow(rtResult.rows[0]);
      }

      await syncTechRoadsideOccupation(updated.id, updated.status, updated.assignedTechName);
      res.json(updated);

      // ── WhatsApp con deduplicación ─────────────────────────────────────────
      if (status === "asignada" && updated.customerPhone && !updated.whatsappAsignadaSentAtMs) {
        const waResult = await sendRoadsideStatusWhatsApp(updated, "asignada");
        if (waResult?.status === "sent") {
          await db.query(
            `UPDATE roadside_assistances SET "whatsappAsignadaSentAtMs" = $2 WHERE id = $1`,
            [id, now]
          );
        }
      }

      if (status === "finalizada" && updated.customerPhone && !updated.whatsappFinalizadaSentAtMs && updated.reportToken) {
        const reportUrl = `${getPublicAppBaseUrl(req)}/informe/${updated.reportToken}`;
        const waResult = await sendRoadsideStatusWhatsApp(updated, "finalizada", { reportUrl });
        if (waResult?.status === "sent") {
          await db.query(
            `UPDATE roadside_assistances SET "whatsappFinalizadaSentAtMs" = $2 WHERE id = $1`,
            [id, now]
          );
        }
      }
    } catch (error) {
      console.error("POST /api/roadside-assistances/:id/status error:", error);
      res.status(500).json({ error: "Error cambiando estado de asistencia" });
    }
  }
);

/* =========================================================
   ROADSIDE FILES (fotos + firma)
========================================================= */

const PLATE_KINDS = new Set(["matricula_camion", "matricula_remolque"]);

function normalizePlateText(value: unknown) {
  const cleaned = String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  return cleaned;
}

async function detectPlateFromImage(imageUrl: string): Promise<string | null> {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text:
                "Esta es una foto de la matrícula de un vehículo español. " +
                "Responde EXCLUSIVAMENTE con el texto de la matrícula (sin espacios ni guiones), " +
                "o con la palabra NONE si no se puede leer ninguna matrícula en la imagen.",
            },
            { type: "image_url", image_url: { url: imageUrl } },
          ] as any,
        },
      ],
      max_tokens: 20,
    });

    const text = response.choices[0]?.message?.content?.trim() ?? "";
    const plate = normalizePlateText(text);
    return plate && plate !== "NONE" && plate.length >= 5 ? plate : null;
  } catch (error) {
    console.error("detectPlateFromImage error:", error);
    return null;
  }
}

app.post(
  "/api/roadside-assistances/:id/files",
  requireRoadsideOperator,
  upload.single("file"),
  async (req, res) => {
    try {
      const id = Number(req.params.id);
      const kind = String(req.body?.kind || "foto").trim();

      if (!Number.isFinite(id)) {
        return res.status(400).json({ error: "ID no válido" });
      }

      if (!req.file) {
        return res.status(400).json({ error: "No se recibió archivo" });
      }

      const mimeToExt: Record<string, string> = {
        "image/jpeg": "jpg",
        "image/png": "png",
        "image/webp": "webp",
      };
      const ext = mimeToExt[req.file.mimetype] ?? "jpg";
      const storagePath = `roadside/${id}/${kind}_${Date.now()}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from(SUPABASE_ROADSIDE_BUCKET)
        .upload(storagePath, req.file.buffer, {
          contentType: req.file.mimetype,
          upsert: false,
        });

      if (uploadError) throw new Error(uploadError.message);

      const { data: publicData } = supabase.storage
        .from(SUPABASE_ROADSIDE_BUCKET)
        .getPublicUrl(storagePath);

      let detectedPlate: string | null = null;
      if (PLATE_KINDS.has(kind)) {
        detectedPlate = await detectPlateFromImage(publicData.publicUrl);
      }

      const result = await db.query(
        `INSERT INTO roadside_assistance_files ("assistanceId", kind, url, "fileName", "createdAtMs", "detectedPlate")
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [id, kind, publicData.publicUrl, req.file.originalname, Date.now(), detectedPlate]
      );

      let plateAction: "none" | "assigned" | "match" | "mismatch" = "none";
      let currentPlateAfter: string | null = null;

      if (kind === "matricula_camion" && detectedPlate) {
        const assistanceResult = await db.query(
          `SELECT plate FROM roadside_assistances WHERE id = $1 LIMIT 1`,
          [id]
        );
        const currentPlate = normalizePlateText(assistanceResult.rows[0]?.plate);

        if (!currentPlate) {
          await db.query(
            `UPDATE roadside_assistances SET plate = $2 WHERE id = $1`,
            [id, detectedPlate]
          );
          plateAction = "assigned";
          currentPlateAfter = detectedPlate;
        } else if (currentPlate === detectedPlate) {
          plateAction = "match";
          currentPlateAfter = currentPlate;
        } else {
          await db.query(
            `UPDATE roadside_assistances SET "plateMismatch" = true WHERE id = $1`,
            [id]
          );
          plateAction = "mismatch";
          currentPlateAfter = currentPlate;
        }
      }

      res.json({
        file: result.rows[0],
        plateAction,
        detectedPlate: detectedPlate ?? null,
        currentPlate: currentPlateAfter,
      });
    } catch (error: any) {
      console.error("POST /api/roadside-assistances/:id/files error:", error);
      res.status(500).json({ error: "Error subiendo archivo" });
    }
  }
);

app.get("/api/roadside-assistances/:id/files", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const result = await db.query(
      `SELECT * FROM roadside_assistance_files WHERE "assistanceId" = $1 ORDER BY "createdAtMs" ASC`,
      [id]
    );
    res.json(result.rows);
  } catch (error) {
    console.error("GET /api/roadside-assistances/:id/files error:", error);
    res.status(500).json({ error: "Error cargando archivos" });
  }
});

app.delete(
  "/api/roadside-assistances/:id/files/:fileId",
  requireSupervisorRole,
  async (req, res) => {
    try {
      const fileId = Number(req.params.fileId);
      const result = await db.query(
        `DELETE FROM roadside_assistance_files WHERE id = $1 RETURNING *`,
        [fileId]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Archivo no encontrado" });
      }
      res.json({ deleted: true });
    } catch (error) {
      console.error("DELETE /api/roadside-assistances/:id/files/:fileId error:", error);
      res.status(500).json({ error: "Error eliminando archivo" });
    }
  }
);

/* =========================================================
   ROADSIDE PDF REPORT
========================================================= */

// Builds a 480×260 map image by compositing a 3×3 grid of OSM tiles + red marker
async function buildMapImage(lat: number, lng: number): Promise<Buffer | null> {
  const zoom = 15;
  const n = Math.pow(2, zoom);

  const cx = (lng + 180) / 360 * n;
  const latRad = lat * Math.PI / 180;
  const cy = (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n;

  const tileX = Math.floor(cx);
  const tileY = Math.floor(cy);

  // Fetch 3×3 tiles in parallel
  const positions: { dx: number; dy: number; buf: Buffer | null }[] = await Promise.all(
    [-1, 0, 1].flatMap(dy =>
      [-1, 0, 1].map(async dx => {
        try {
          const r = await fetch(
            `https://tile.openstreetmap.org/${zoom}/${tileX + dx}/${tileY + dy}.png`,
            { headers: { "User-Agent": "SEATarragona-Informe/1.0 (internal)" }, signal: AbortSignal.timeout(6000) }
          );
          return { dx, dy, buf: r.ok ? Buffer.from(await r.arrayBuffer()) : null };
        } catch {
          return { dx, dy, buf: null };
        }
      })
    )
  );

  // Pixel offset of the exact point within the center tile
  const px = Math.round((cx - tileX) * 256);
  const py = Math.round((cy - tileY) * 256);

  // Marker SVG (red pin 20×20)
  const m = 10;
  const markerSvg = Buffer.from(
    `<svg width="${m*2}" height="${m*2}" xmlns="http://www.w3.org/2000/svg">` +
    `<circle cx="${m}" cy="${m}" r="${m-2}" fill="red" stroke="white" stroke-width="2.5"/>` +
    `</svg>`
  );

  const compositeInputs: sharp.OverlayOptions[] = [];

  for (const { dx, dy, buf } of positions) {
    if (buf) {
      compositeInputs.push({ input: buf, left: (dx + 1) * 256, top: (dy + 1) * 256 });
    }
  }

  // Center of the 3×3 canvas is at tile (1,1) → pixel (256+px, 256+py)
  compositeInputs.push({
    input: markerSvg,
    left: 256 + px - m,
    top: 256 + py - m,
  });

  return sharp({
    create: { width: 768, height: 768, channels: 4, background: { r: 200, g: 200, b: 200, alpha: 1 } },
  })
    .composite(compositeInputs)
    .resize(480, 260)
    .png()
    .toBuffer();
}

async function fetchImageForPdf(url: string): Promise<Buffer> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const raw = Buffer.from(await resp.arrayBuffer());
  // Convert to PNG: fixes scan-line artifacts from Android JPEG color profiles/subsampling.
  // sharp auto-rotates EXIF orientation and strips metadata.
  // Falls back to raw buffer if sharp fails.
  try {
    return await sharp(raw).rotate().png().toBuffer();
  } catch {
    return raw;
  }
}

function formatDateEs(ms: number | null | undefined): string {
  if (!ms) return "-";
  return new Date(ms).toLocaleString("es-ES", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function diffMinutes(a: number | null | undefined, b: number | null | undefined): string {
  if (!a || !b) return "-";
  const mins = Math.round(Math.abs(b - a) / 60000);
  if (mins < 60) return `${mins} min`;
  return `${Math.floor(mins / 60)}h ${mins % 60}min`;
}

async function buildAssistanceReportPdfBuffer(id: number): Promise<{ buffer: Buffer; assistance: any }> {
      const assistanceResult = await db.query(
        `SELECT * FROM roadside_assistances WHERE id = $1 LIMIT 1`,
        [id]
      );

      if (assistanceResult.rows.length === 0) {
        throw new Error("Asistencia no encontrada");
      }

      const a = normalizeRoadsideAssistanceRow(assistanceResult.rows[0]);

      const eventsResult = await db.query(
        `SELECT * FROM roadside_assistance_events WHERE "assistanceId" = $1 ORDER BY "createdAtMs" ASC`,
        [id]
      );

      const filesResult = await db.query(
        `SELECT * FROM roadside_assistance_files WHERE "assistanceId" = $1 ORDER BY "createdAtMs" ASC`,
        [id]
      );

      const doc = new PDFDocument({ margin: 40, size: "A4" });
      const chunks: Buffer[] = [];
      doc.on("data", (chunk) => chunks.push(chunk));
      const finished = new Promise<Buffer>((resolve) => {
        doc.on("end", () => resolve(Buffer.concat(chunks)));
      });

      // Header
      doc
        .fontSize(18)
        .font("Helvetica-Bold")
        .text("SEA Tarragona – Informe de Asistencia", { align: "center" });

      doc.moveDown(0.3);
      doc
        .fontSize(11)
        .font("Helvetica")
        .text(`Asistencia nº ${a.id}   |   ${formatDateEs(a.createdAtMs)}`, { align: "center" });

      doc.moveDown(1);

      // Helper to draw a row
      function row(label: string, value: string) {
        doc
          .fontSize(10)
          .font("Helvetica-Bold")
          .text(label, { continued: true, width: 160 });
        doc.font("Helvetica").text(value);
      }

      doc.fontSize(13).font("Helvetica-Bold").text("Datos del cliente");
      doc.moveDown(0.3);
      row("Nombre:", a.customerName || "-");
      row("Teléfono:", a.customerPhone || "-");
      row("Dirección:", a.address || "-");
      row("Matrícula:", a.plate || "-");
      row("Vehículo:", a.vehicleDescription || "-");
      row("Prioridad:", a.priority === "urgente" ? "URGENTE" : "Normal");
      if (a.notes) row("Notas:", a.notes);

      // Mapa estático de la ubicación
      if (a.latitude != null && a.longitude != null) {
        doc.moveDown(0.5);
        doc.fontSize(10).font("Helvetica-Bold").text("Localización de la avería:");
        doc.moveDown(0.3);
        try {
          const mapBuf = await buildMapImage(a.latitude, a.longitude);
          if (mapBuf) {
            doc.image(mapBuf, { fit: [480, 260], align: "left" });
          } else {
            doc.fontSize(9).font("Helvetica").text(`Coordenadas: ${a.latitude}, ${a.longitude}`);
          }
        } catch {
          doc.fontSize(9).font("Helvetica").text(`Coordenadas: ${a.latitude}, ${a.longitude}`);
        }
      }

      doc.moveDown(1);
      doc.fontSize(13).font("Helvetica-Bold").text("Asignación");
      doc.moveDown(0.3);
      row("Operario:", a.assignedTechName || "-");
      row("Vehículo asignado:", a.assignedVehicleName || "-");

      doc.moveDown(1);
      doc.fontSize(13).font("Helvetica-Bold").text("Tiempos");
      doc.moveDown(0.3);
      row("Creación:", formatDateEs(a.createdAtMs));
      row("Asignada:", formatDateEs(a.assignedAtMs));
      row("Salida taller:", formatDateEs(a.departedAtMs));
      row("Llegada punto:", formatDateEs(a.arrivedAtPointMs));
      row("Finalización:", formatDateEs(a.finishedAtMs));
      row("Llegada taller:", formatDateEs(a.arrivedAtWorkshopMs));

      doc.moveDown(0.5);
      doc.fontSize(10).font("Helvetica-Bold").text("Tiempos calculados:");
      doc.font("Helvetica");
      doc.text(`  · Salida -> Llegada al punto: ${diffMinutes(a.departedAtMs, a.arrivedAtPointMs)}`);
      doc.text(`  · Punto -> Finalización: ${diffMinutes(a.arrivedAtPointMs, a.finishedAtMs)}`);
      doc.text(`  · Tiempo total (salida -> taller): ${diffMinutes(a.departedAtMs, a.arrivedAtWorkshopMs)}`);

      // Events
      if (eventsResult.rows.length > 0) {
        doc.moveDown(1);
        doc.fontSize(13).font("Helvetica-Bold").text("Historial de estados");
        doc.moveDown(0.3);
        for (const ev of eventsResult.rows) {
          const label = ev.status;
          const by = ev.createdBy ? ` (${ev.createdBy})` : "";
          const note = ev.note ? ` – ${ev.note}` : "";
          doc
            .fontSize(9)
            .font("Helvetica")
            .text(`${formatDateEs(Number(ev.createdAtMs))}  ->  ${label}${by}${note}`);
        }
      }

      // Photos
      const photos = filesResult.rows.filter((f: any) => f.kind !== "firma");
      const signature = filesResult.rows.find((f: any) => f.kind === "firma");

      if (photos.length > 0) {
        doc.addPage();
        doc.fontSize(13).font("Helvetica-Bold").text("Fotografías");
        doc.moveDown(0.5);

        const kindLabels: Record<string, string> = {
          matricula_camion: "Matrícula camión",
          matricula_remolque: "Matrícula remolque",
          foto_averia: "Avería (antes de reparar)",
          foto_extra: "Foto adicional",
          foto_reparacion: "Reparación finalizada",
        };

        const maxW = 480;
        const maxH = 320;

        for (const photo of photos) {
          try {
            const buf = await fetchImageForPdf(photo.url);
            doc.fontSize(9).font("Helvetica-Bold")
              .text(kindLabels[photo.kind] ?? photo.kind);
            doc.moveDown(0.2);
            doc.image(buf, { fit: [maxW, maxH], align: "center" });
            doc.moveDown(0.8);
          } catch { /* skip */ }

          // Nueva página si queda poco espacio
          if (doc.y > 680) doc.addPage();
        }
      }

      if (signature) {
        doc.addPage();
        doc.fontSize(13).font("Helvetica-Bold").text("Firma del conductor");
        doc.moveDown(0.5);
        if (a.conductorNombre || a.conductorDni) {
          doc.fontSize(11).font("Helvetica-Bold").text(a.conductorNombre ?? "", { continued: false });
          doc.fontSize(10).font("Helvetica").text(`DNI / NIE: ${a.conductorDni ?? "-"}`);
          doc.moveDown(0.5);
        }
        try {
          const buffer = await fetchImageForPdf(signature.url);
          doc.image(buffer, { fit: [400, 150], align: "left" });
        } catch {
          doc.fontSize(9).font("Helvetica").text(`[Firma no disponible]`);
        }
      }

      doc.end();
      const buffer = await finished;
      return { buffer, assistance: a };
}

app.get(
  "/api/roadside-assistances/:id/report.pdf",
  requireSupervisorRole,
  async (req, res) => {
    try {
      const id = Number(req.params.id);

      if (!Number.isFinite(id)) {
        return res.status(400).json({ error: "ID no válido" });
      }

      const { buffer } = await buildAssistanceReportPdfBuffer(id);

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `inline; filename="asistencia_${id}.pdf"`
      );
      res.send(buffer);
    } catch (error: any) {
      console.error("GET /api/roadside-assistances/:id/report.pdf error:", error);
      if (!res.headersSent) {
        const notFound = error?.message === "Asistencia no encontrada";
        res
          .status(notFound ? 404 : 500)
          .json({ error: notFound ? error.message : "Error generando informe PDF" });
      }
    }
  }
);

let mailTransport: import("nodemailer").Transporter | null = null;
function getMailTransport() {
  if (mailTransport) return mailTransport;
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
    return null;
  }
  mailTransport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT || 587) === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
  return mailTransport;
}

app.post(
  "/api/roadside-assistances/:id/send-report",
  requireSupervisorRole,
  async (req, res) => {
    try {
      const id = Number(req.params.id);
      const channels: string[] = Array.isArray(req.body?.channels) ? req.body.channels : [];
      const email = String(req.body?.email || "").trim();

      if (!Number.isFinite(id)) {
        return res.status(400).json({ error: "ID no válido" });
      }

      if (channels.length === 0) {
        return res.status(400).json({ error: "Selecciona al menos un canal de envío" });
      }

      if (channels.includes("email") && !email) {
        return res.status(400).json({ error: "Indica un email de destino" });
      }

      const { buffer, assistance } = await buildAssistanceReportPdfBuffer(id);

      const result: { whatsapp?: string; email?: string } = {};

      if (channels.includes("whatsapp")) {
        const customerPhone = String(assistance.customerPhone || "").trim();
        if (!customerPhone) {
          result.whatsapp = "skipped: sin teléfono";
        } else if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
          result.whatsapp = "skipped: Twilio no configurado";
        } else {
          try {
            const storagePath = `roadside/${id}/informe_${Date.now()}.pdf`;
            const { error: uploadError } = await supabase.storage
              .from(SUPABASE_ROADSIDE_BUCKET)
              .upload(storagePath, buffer, {
                contentType: "application/pdf",
                upsert: false,
              });
            if (uploadError) throw new Error(uploadError.message);

            const { data: publicData } = supabase.storage
              .from(SUPABASE_ROADSIDE_BUCKET)
              .getPublicUrl(storagePath);

            await twilioClient.messages.create({
              from: getWhatsAppFromNumber(),
              to: `whatsapp:${normalizeSpanishPhone(customerPhone)}`,
              body: `Hola ${assistance.customerName || "cliente"}, adjuntamos el informe de tu asistencia de SEA Tarragona.`,
              mediaUrl: [publicData.publicUrl],
            });
            result.whatsapp = "sent";
          } catch (err: any) {
            console.error("send-report whatsapp error:", err.message);
            result.whatsapp = `error: ${err.message}`;
          }
        }
      }

      if (channels.includes("email")) {
        const transport = getMailTransport();
        if (!transport) {
          result.email = "skipped: SMTP no configurado";
        } else {
          try {
            await transport.sendMail({
              from: process.env.SMTP_FROM || process.env.SMTP_USER,
              to: email,
              subject: `Informe de asistencia SEA Tarragona #${id}`,
              text: `Hola ${assistance.customerName || "cliente"}, adjuntamos el informe de tu asistencia.`,
              attachments: [
                { filename: `asistencia_${id}.pdf`, content: buffer, contentType: "application/pdf" },
              ],
            });
            result.email = "sent";
          } catch (err: any) {
            console.error("send-report email error:", err.message);
            result.email = `error: ${err.message}`;
          }
        }
      }

      res.json({ ok: true, result });
    } catch (error: any) {
      console.error("POST /api/roadside-assistances/:id/send-report error:", error);
      res.status(500).json({ error: "Error enviando informe" });
    }
  }
);

/* =========================================================
   BACK OFFICE
========================================================= */

app.get(
  "/api/roadside-assistances/:id/backoffice",
  requireSupervisorRole,
  async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!id) return res.status(400).json({ error: "ID inválido" });
      const result = await db.query(
        `SELECT * FROM roadside_backoffice WHERE "assistanceId" = $1`,
        [id]
      );
      return res.json(result.rows[0] ?? null);
    } catch (error) {
      console.error("GET backoffice error:", error);
      return res.status(500).json({ error: "Error obteniendo back office" });
    }
  }
);

app.put(
  "/api/roadside-assistances/:id/backoffice",
  requireSupervisorRole,
  async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!id) return res.status(400).json({ error: "ID inválido" });
      const now = Date.now();
      const b = req.body;

      const existing = await db.query(
        `SELECT id FROM roadside_backoffice WHERE "assistanceId" = $1`,
        [id]
      );

      if (existing.rows.length === 0) {
        const result = await db.query(
          `INSERT INTO roadside_backoffice (
            "assistanceId",
            "solicitanteNombre","solicitanteTelefono","solicitanteWhatsapp","solicitanteEmail",
            "conductorTelefono",
            "responsableNombre","responsableTelefono","responsableCargo",
            "autorizadorNombre","autorizadorTelefono","autorizadorCargo",
            "empresaSolicitanteNombre","empresaSolicitanteTelefono","empresaSolicitanteEmail",
            "empresaServicioNombre","empresaServicioCif","empresaServicioTelefono",
            "empresaFacturacionNombre","empresaFacturacionCif","empresaFacturacionEmail",
            "expedienteExterno","referenciaCliente","referenciaAutorizacion",
            "tiposAsistencia","tipoVehiculo","estadoVehiculo","ubicacionIncidencia",
            marca,modelo,color,vin,kilometraje,
            "medidaNeumatico","ejeAfectado","posicionRueda","vehiculoCargado",mercancia,adr,
            facturable,"pendienteAutorizacion",garantia,interna,"importeAcordado","observacionesFacturacion",
            "createdAtMs","updatedAtMs"
          ) VALUES (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40,$41,$42,$43,$44,$45,$46
          ) RETURNING *`,
          [
            id,
            b.solicitanteNombre ?? null, b.solicitanteTelefono ?? null, b.solicitanteWhatsapp ?? null, b.solicitanteEmail ?? null,
            b.conductorTelefono ?? null,
            b.responsableNombre ?? null, b.responsableTelefono ?? null, b.responsableCargo ?? null,
            b.autorizadorNombre ?? null, b.autorizadorTelefono ?? null, b.autorizadorCargo ?? null,
            b.empresaSolicitanteNombre ?? null, b.empresaSolicitanteTelefono ?? null, b.empresaSolicitanteEmail ?? null,
            b.empresaServicioNombre ?? null, b.empresaServicioCif ?? null, b.empresaServicioTelefono ?? null,
            b.empresaFacturacionNombre ?? null, b.empresaFacturacionCif ?? null, b.empresaFacturacionEmail ?? null,
            b.expedienteExterno ?? null, b.referenciaCliente ?? null, b.referenciaAutorizacion ?? null,
            b.tiposAsistencia ? JSON.stringify(b.tiposAsistencia) : null,
            b.tipoVehiculo ?? null, b.estadoVehiculo ?? null, b.ubicacionIncidencia ?? null,
            b.marca ?? null, b.modelo ?? null, b.color ?? null, b.vin ?? null,
            b.kilometraje != null ? Number(b.kilometraje) : null,
            b.medidaNeumatico ?? null, b.ejeAfectado ?? null, b.posicionRueda ?? null,
            b.vehiculoCargado ?? null, b.mercancia ?? null, b.adr ?? null,
            b.facturable ?? true, b.pendienteAutorizacion ?? false, b.garantia ?? false, b.interna ?? false,
            b.importeAcordado != null ? Number(b.importeAcordado) : null,
            b.observacionesFacturacion ?? null,
            now, now,
          ]
        );
        return res.json(result.rows[0]);
      } else {
        const result = await db.query(
          `UPDATE roadside_backoffice SET
            "solicitanteNombre"=$2,"solicitanteTelefono"=$3,"solicitanteWhatsapp"=$4,"solicitanteEmail"=$5,
            "conductorTelefono"=$6,
            "responsableNombre"=$7,"responsableTelefono"=$8,"responsableCargo"=$9,
            "autorizadorNombre"=$10,"autorizadorTelefono"=$11,"autorizadorCargo"=$12,
            "empresaSolicitanteNombre"=$13,"empresaSolicitanteTelefono"=$14,"empresaSolicitanteEmail"=$15,
            "empresaServicioNombre"=$16,"empresaServicioCif"=$17,"empresaServicioTelefono"=$18,
            "empresaFacturacionNombre"=$19,"empresaFacturacionCif"=$20,"empresaFacturacionEmail"=$21,
            "expedienteExterno"=$22,"referenciaCliente"=$23,"referenciaAutorizacion"=$24,
            "tiposAsistencia"=$25,"tipoVehiculo"=$26,"estadoVehiculo"=$27,"ubicacionIncidencia"=$28,
            marca=$29,modelo=$30,color=$31,vin=$32,kilometraje=$33,
            "medidaNeumatico"=$34,"ejeAfectado"=$35,"posicionRueda"=$36,"vehiculoCargado"=$37,mercancia=$38,adr=$39,
            facturable=$40,"pendienteAutorizacion"=$41,garantia=$42,interna=$43,"importeAcordado"=$44,"observacionesFacturacion"=$45,
            "updatedAtMs"=$46
          WHERE "assistanceId"=$1 RETURNING *`,
          [
            id,
            b.solicitanteNombre ?? null, b.solicitanteTelefono ?? null, b.solicitanteWhatsapp ?? null, b.solicitanteEmail ?? null,
            b.conductorTelefono ?? null,
            b.responsableNombre ?? null, b.responsableTelefono ?? null, b.responsableCargo ?? null,
            b.autorizadorNombre ?? null, b.autorizadorTelefono ?? null, b.autorizadorCargo ?? null,
            b.empresaSolicitanteNombre ?? null, b.empresaSolicitanteTelefono ?? null, b.empresaSolicitanteEmail ?? null,
            b.empresaServicioNombre ?? null, b.empresaServicioCif ?? null, b.empresaServicioTelefono ?? null,
            b.empresaFacturacionNombre ?? null, b.empresaFacturacionCif ?? null, b.empresaFacturacionEmail ?? null,
            b.expedienteExterno ?? null, b.referenciaCliente ?? null, b.referenciaAutorizacion ?? null,
            b.tiposAsistencia ? JSON.stringify(b.tiposAsistencia) : null,
            b.tipoVehiculo ?? null, b.estadoVehiculo ?? null, b.ubicacionIncidencia ?? null,
            b.marca ?? null, b.modelo ?? null, b.color ?? null, b.vin ?? null,
            b.kilometraje != null ? Number(b.kilometraje) : null,
            b.medidaNeumatico ?? null, b.ejeAfectado ?? null, b.posicionRueda ?? null,
            b.vehiculoCargado ?? null, b.mercancia ?? null, b.adr ?? null,
            b.facturable ?? true, b.pendienteAutorizacion ?? false, b.garantia ?? false, b.interna ?? false,
            b.importeAcordado != null ? Number(b.importeAcordado) : null,
            b.observacionesFacturacion ?? null,
            now,
          ]
        );
        return res.json(result.rows[0]);
      }
    } catch (error) {
      console.error("PUT backoffice error:", error);
      return res.status(500).json({ error: "Error guardando back office" });
    }
  }
);

/* ── Companies ── */

app.get("/api/companies", requireSupervisorRole, async (req, res) => {
  try {
    const q = String(req.query.q ?? "").trim();
    const workshopId = req.query.workshopId as string | undefined;
    const params: any[] = [];
    const conditions: string[] = [];
    if (q) {
      params.push(`%${q}%`);
      conditions.push(`(nombre ILIKE $${params.length} OR nif ILIKE $${params.length})`);
    }
    if (workshopId) {
      params.push(workshopId);
      conditions.push(`"workshopId" = $${params.length}`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const result = await db.query(
      `SELECT * FROM companies ${where} ORDER BY nombre LIMIT 50`,
      params
    );
    return res.json(result.rows);
  } catch (error) {
    console.error("GET companies error:", error);
    return res.status(500).json({ error: "Error obteniendo empresas" });
  }
});

app.post("/api/companies", requireSupervisorRole, async (req, res) => {
  try {
    const { workshopId, nombre, nif, telefono, email, tipo } = req.body;
    if (!nombre) return res.status(400).json({ error: "Nombre requerido" });
    const now = Date.now();
    const result = await db.query(
      `INSERT INTO companies ("workshopId",nombre,nif,telefono,email,tipo,"createdAtMs","updatedAtMs")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [workshopId ?? null, nombre, nif ?? null, telefono ?? null, email ?? null, tipo ?? "otro", now, now]
    );
    return res.json(result.rows[0]);
  } catch (error) {
    console.error("POST companies error:", error);
    return res.status(500).json({ error: "Error creando empresa" });
  }
});

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

app.delete(
  "/api/assigned-maintenance-tasks/old-interrupted",
  async (req, res) => {
    try {
      await ensureMaintenanceTables();

      const olderThanMs = Date.now() - 12 * 60 * 60 * 1000;
      const dryRun = String(req.query.dryRun || "") === "true";
      const oldInterruptedFilter = `
        data->>'status' = 'interrumpida'
        AND data->>'taskType' = 'en_taller'
        AND COALESCE(
          CASE
            WHEN data->>'statusChangedAtMs' ~ '^[0-9]+$'
              THEN (data->>'statusChangedAtMs')::bigint
          END,
          CASE
            WHEN data->>'assignedAtMs' ~ '^[0-9]+$'
              THEN (data->>'assignedAtMs')::bigint
          END,
          0
        ) < $1
      `;

      if (dryRun) {
        const result = await db.query(
          `
            SELECT COUNT(*)::int AS "deletedCount"
            FROM assigned_maintenance_tasks
            WHERE ${oldInterruptedFilter}
          `,
          [olderThanMs]
        );

        return res.json({
          ok: true,
          dryRun: true,
          deletedCount: Number(result.rows[0]?.deletedCount ?? 0),
        });
      }

      const result = await db.query(
        `
          WITH deleted AS (
            DELETE FROM assigned_maintenance_tasks
            WHERE ${oldInterruptedFilter}
            RETURNING id
          )
          SELECT COUNT(*)::int AS "deletedCount"
          FROM deleted
        `,
        [olderThanMs]
      );

      res.json({
        ok: true,
        deletedCount: Number(result.rows[0]?.deletedCount ?? 0),
      });
    } catch (error) {
      console.error(
        "DELETE /api/assigned-maintenance-tasks/old-interrupted error:",
        error
      );
      res.status(500).json({ error: "Error limpiando interrumpidas antiguas" });
    }
  }
);

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
const WORKSHOP_AUTO_STANDBY_TIMES = ["13:30", "18:30"];
const WORKSHOP_AUTO_STANDBY_GRACE_MINUTES = 20;

let reminderCheckerRunning = false;
let workshopAutoStandbyRunning = false;
const workshopAutoStandbyCompletedKeys = new Set<string>();

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
    // Sin teléfono — saltar silenciosamente sin lanzar error
    return null;
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

          if (!message) {
            // Sin teléfono, saltar
            continue;
          }

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

function getZonedDateTimeParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const values: Record<string, string> = {};

  for (const part of parts) {
    if (part.type !== "literal") {
      values[part.type] = part.value;
    }
  }

  return {
    dateKey: `${values.year}-${values.month}-${values.day}`,
    minutesOfDay: Number(values.hour) * 60 + Number(values.minute),
  };
}

function getWorkshopAutoStandbyDue(date: Date) {
  const zoned = getZonedDateTimeParts(date, AGENDA_TIME_ZONE);

  for (const time of WORKSHOP_AUTO_STANDBY_TIMES) {
    const [hours, minutes] = time.split(":").map(Number);
    const targetMinutes = hours * 60 + minutes;
    const elapsedMinutes = zoned.minutesOfDay - targetMinutes;

    if (
      elapsedMinutes >= 0 &&
      elapsedMinutes < WORKSHOP_AUTO_STANDBY_GRACE_MINUTES
    ) {
      return {
        time,
        key: `${zoned.dateKey}:${time}`,
      };
    }
  }

  return null;
}

function getServerLogTime(date = new Date()) {
  return new Intl.DateTimeFormat("es-ES", {
    timeZone: AGENDA_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

async function appendServerLog(text: string) {
  await db.query(
    `
      INSERT INTO logs (id, time, text)
      VALUES ($1, $2, $3)
    `,
    [Date.now() + Math.random(), getServerLogTime(), text]
  );
}

async function pauseActiveWorkshopJobsForStandby(triggerTime: string) {
  const now = Date.now();
  const result = await db.query(`
    SELECT *
    FROM jobs
    WHERE status = 'activo'
    ORDER BY id ASC
  `);

  if (result.rows.length === 0) return 0;

  const techNamesToFree = new Set<string>();

  for (const row of result.rows) {
    const assignedNames = safeJsonParse(row.assignedNames, [] as string[]);

    for (const name of assignedNames) {
      if (name) techNamesToFree.add(name);
    }

    const startedAtMs =
      row.startedAtMs == null ? null : Number(row.startedAtMs);
    const currentWorked =
      startedAtMs != null && Number.isFinite(startedAtMs)
        ? Math.max(0, Math.round((now - startedAtMs) / 60000))
        : 0;
    const totalWorked =
      Number(row.workedAccumulatedMinutes ?? 0) + currentWorked;
    const reason = String(row.reason || "Trabajo");
    const nextReason = reason.includes("STAND BY")
      ? reason
      : `${reason} · STAND BY automatico ${triggerTime}.`;

    await db.query(
      `
        UPDATE jobs
        SET
          status = 'parado',
          "workedAccumulatedMinutes" = $1,
          "pausedAccumulatedMinutes" = COALESCE("pausedAccumulatedMinutes", 0),
          "pausedAtMs" = $2,
          "startedAtMs" = NULL,
          reason = $3
        WHERE id = $4
      `,
      [totalWorked, now, nextReason, row.id]
    );
  }

  const techNames = Array.from(techNamesToFree);

  if (techNames.length > 0) {
    await db.query(
      `
        UPDATE techs
        SET
          status = 'disponible',
          "currentJobId" = NULL
        WHERE name = ANY($1)
          AND status IN ('ocupado', 'refuerzo')
      `,
      [techNames]
    );
  }

  await appendServerLog(
    `Stand by automatico ${triggerTime}: ${result.rows.length} trabajo(s) activo(s) pausado(s).`
  );

  return result.rows.length;
}

async function checkWorkshopAutoStandby() {
  if (workshopAutoStandbyRunning) return;

  const due = getWorkshopAutoStandbyDue(new Date());

  if (!due) return;
  if (workshopAutoStandbyCompletedKeys.has(due.key)) return;

  workshopAutoStandbyCompletedKeys.add(due.key);
  workshopAutoStandbyRunning = true;

  try {
    const pausedCount = await pauseActiveWorkshopJobsForStandby(due.time);

    if (pausedCount > 0) {
      console.log(
        `Stand by automatico ${due.time}: ${pausedCount} trabajo(s) pausado(s).`
      );
    }
  } catch (error) {
    workshopAutoStandbyCompletedKeys.delete(due.key);
    console.error("checkWorkshopAutoStandby error:", error);
  } finally {
    workshopAutoStandbyRunning = false;
  }
}

function startWorkshopAutoStandbyChecker() {
  console.log("Stand by automatico de taller activo.");

  void checkWorkshopAutoStandby();

  setInterval(() => {
    void checkWorkshopAutoStandby();
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

/* =========================================================
   WORKSHOP OPERATOR (TECH MOBILE PORTAL)
========================================================= */

async function getWorkshopOperatorFromRequest(req: express.Request) {
  const techName = String(req.headers["x-operator-name"] ?? "").trim();
  const pin = String(req.headers["x-operator-pin"] ?? "").trim();
  if (!techName || !pin) return null;
  const result = await db.query(
    `SELECT name FROM techs WHERE name = $1 AND "workshopPin" = $2 LIMIT 1`,
    [techName, pin]
  );
  if (result.rows.length === 0) return null;
  return { techName };
}

function requireWorkshopOperatorAuth(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) {
  void (async () => {
    const operator = await getWorkshopOperatorFromRequest(req);
    if (!operator) {
      return res.status(401).json({ error: "Operario no autorizado" });
    }
    (req as any).workshopOperator = operator;
    next();
  })().catch((error) => {
    console.error("requireWorkshopOperatorAuth error:", error);
    res.status(500).json({ error: "Error validando operario taller" });
  });
}

// Public: list techs
app.get("/api/workshop-operator/techs-list", async (_req, res) => {
  try {
    const result = await db.query(
      `SELECT name FROM techs ORDER BY name ASC`
    );
    res.json(result.rows.map((r: any) => ({ name: r.name })));
  } catch (error) {
    console.error("GET /api/workshop-operator/techs-list error:", error);
    res.status(500).json({ error: "Error obteniendo operarios" });
  }
});

// Public: login
app.post("/api/workshop-operator/login", async (req, res) => {
  try {
    const name = String(req.body?.name || "").trim();
    const pin = String(req.body?.pin || "").trim();
    if (!name || !pin) {
      return res.status(400).json({ error: "Faltan datos" });
    }
    const result = await db.query(
      `SELECT name FROM techs WHERE name = $1 AND "workshopPin" = $2 LIMIT 1`,
      [name, pin]
    );
    if (result.rows.length === 0) {
      return res.status(401).json({ error: "PIN incorrecto" });
    }
    res.json({ ok: true, techName: name });
  } catch (error) {
    console.error("POST /api/workshop-operator/login error:", error);
    res.status(500).json({ error: "Error iniciando sesion operario taller" });
  }
});

// Protected: status
app.get(
  "/api/workshop-operator/status",
  requireWorkshopOperatorAuth,
  async (req, res) => {
    try {
      const { techName } = (req as any).workshopOperator as { techName: string };
      const techResult = await db.query(
        `SELECT name, status, "currentJobId" FROM techs WHERE name = $1 LIMIT 1`,
        [techName]
      );
      if (techResult.rows.length === 0) {
        return res.status(404).json({ error: "Operario no encontrado" });
      }
      const tech = techResult.rows[0];
      let job = null;
      if (tech.currentJobId) {
        const jobResult = await db.query(
          `SELECT id, plate, area, reason, status, "workedAccumulatedMinutes", "startedAtMs", "quickEntryLabel" FROM jobs WHERE id = $1 LIMIT 1`,
          [tech.currentJobId]
        );
        if (jobResult.rows.length > 0) job = jobResult.rows[0];
      }
      if (!job) {
        const jobResult = await db.query(
          `SELECT id, plate, area, reason, status, "workedAccumulatedMinutes", "startedAtMs", "quickEntryLabel" FROM jobs WHERE status IN ('activo','parado') AND "assignedNames"::jsonb ? $1 ORDER BY "startedAtMs" DESC LIMIT 1`,
          [techName]
        );
        if (jobResult.rows.length > 0) job = jobResult.rows[0];
      }
      res.json({
        tech: { name: tech.name, status: tech.status, currentJobId: tech.currentJobId ?? null },
        job,
      });
    } catch (error) {
      console.error("GET /api/workshop-operator/status error:", error);
      res.status(500).json({ error: "Error obteniendo estado operario" });
    }
  }
);

// Protected: start break
app.post(
  "/api/workshop-operator/break/start",
  requireWorkshopOperatorAuth,
  async (req, res) => {
    try {
      const { techName } = (req as any).workshopOperator as { techName: string };
      const breakType = String(req.body?.breakType || "").trim();
      if (!["cigarro", "cafe", "descanso", "otro"].includes(breakType)) {
        return res.status(400).json({ error: "Tipo de pausa inválido" });
      }
      const nowMs = Date.now();
      // End any open break
      await db.query(
        `UPDATE tech_breaks SET "endedAtMs" = $1 WHERE "techName" = $2 AND "endedAtMs" IS NULL`,
        [nowMs, techName]
      );
      const insertResult = await db.query(
        `INSERT INTO tech_breaks ("techName", "breakType", "startedAtMs") VALUES ($1, $2, $3) RETURNING id, "startedAtMs"`,
        [techName, breakType, nowMs]
      );
      const row = insertResult.rows[0];
      res.json({ ok: true, breakId: row.id, startedAtMs: row.startedAtMs });
    } catch (error) {
      console.error("POST /api/workshop-operator/break/start error:", error);
      res.status(500).json({ error: "Error iniciando pausa" });
    }
  }
);

// Protected: end break
app.post(
  "/api/workshop-operator/break/end",
  requireWorkshopOperatorAuth,
  async (req, res) => {
    try {
      const { techName } = (req as any).workshopOperator as { techName: string };
      const nowMs = Date.now();
      const result = await db.query(
        `UPDATE tech_breaks SET "endedAtMs" = $1 WHERE "techName" = $2 AND "endedAtMs" IS NULL RETURNING "startedAtMs"`,
        [nowMs, techName]
      );
      if (result.rows.length === 0) {
        return res.json({ ok: true, durationMin: 0 });
      }
      const durationMin = Math.round((nowMs - Number(result.rows[0].startedAtMs)) / 60000);
      res.json({ ok: true, durationMin });
    } catch (error) {
      console.error("POST /api/workshop-operator/break/end error:", error);
      res.status(500).json({ error: "Error finalizando pausa" });
    }
  }
);

// Protected: today's breaks
app.get(
  "/api/workshop-operator/breaks/today",
  requireWorkshopOperatorAuth,
  async (req, res) => {
    try {
      const { techName } = (req as any).workshopOperator as { techName: string };
      const startOfDayMs = new Date().setHours(0, 0, 0, 0);
      const result = await db.query(
        `SELECT id, "breakType", "startedAtMs", "endedAtMs", "jobId" FROM tech_breaks WHERE "techName" = $1 AND "startedAtMs" >= $2 ORDER BY "startedAtMs" DESC`,
        [techName, startOfDayMs]
      );
      res.json(result.rows);
    } catch (error) {
      console.error("GET /api/workshop-operator/breaks/today error:", error);
      res.status(500).json({ error: "Error obteniendo pausas" });
    }
  }
);

// Supervisor: set workshop PIN
app.put(
  "/api/techs/:name/workshop-pin",
  requireSupervisorRole,
  async (req, res) => {
    try {
      const techName = String(req.params.name || "").trim();
      const pin = String(req.body?.pin || "").trim();
      if (!techName) return res.status(400).json({ error: "Nombre requerido" });
      await db.query(
        `UPDATE techs SET "workshopPin" = $1 WHERE name = $2`,
        [pin || null, techName]
      );
      res.json({ ok: true });
    } catch (error) {
      console.error("PUT /api/techs/:name/workshop-pin error:", error);
      res.status(500).json({ error: "Error guardando PIN" });
    }
  }
);

/* =========================================================
   STATIC / SPA CATCH-ALL (must be after all API routes)
========================================================= */

app.use(express.static(path.join(__dirname, "../dist")));

app.get(/.*/, (_req, res) => {
  res.sendFile(path.join(__dirname, "../dist/index.html"));
});

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
   WHATSAPP INBOUND
========================================================= */

async function extractAssistanceFromMessage(body: string, mediaUrls: string[]): Promise<{ data: Record<string, any>; confidence: string }> {
  const systemPrompt = `Eres un asistente especializado en asistencias en carretera.
Analiza el mensaje de WhatsApp y extrae los datos de la asistencia en formato JSON.
Reglas estrictas:
- NO inventes datos. Si un campo no está presente, devuelve null.
- Normaliza el teléfono al formato español (+34XXXXXXXXX o 6XXXXXXXX).
- Normaliza la matrícula al formato español (4 dígitos + 3 letras, o antiguo formato).
- Si hay un enlace de Google Maps, extráelo en googleMapsUrl.
- Si el texto tiene muy poca información útil, marca confidence como "low".
- Si tiene información suficiente para crear una asistencia, marca confidence "high".
- En caso intermedio, "medium".

Devuelve SOLO el JSON sin texto adicional:
{
  "cliente": null,
  "telefonoWhatsapp": null,
  "direccion": null,
  "googleMapsUrl": null,
  "latitud": null,
  "longitud": null,
  "matricula": null,
  "vehiculo": null,
  "tipoAsistencia": null,
  "tipoVehiculo": null,
  "estadoVehiculo": null,
  "empresaSolicitante": null,
  "numeroExpedienteExterno": null,
  "conductor": null,
  "telefonoConductor": null,
  "observaciones": null,
  "confidence": "medium",
  "warnings": []
}`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Mensaje WhatsApp:\n${body}${mediaUrls.length ? `\n\nAdjuntos: ${mediaUrls.join(", ")}` : ""}` },
      ],
      temperature: 0.1,
      max_tokens: 800,
    });

    const raw = response.choices[0]?.message?.content ?? "{}";
    const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const parsed = JSON.parse(cleaned);
    const confidence = parsed.confidence ?? "medium";
    return { data: parsed, confidence };
  } catch (e) {
    console.error("extractAssistanceFromMessage error:", e);
    return { data: {}, confidence: "low" };
  }
}

// Twilio sends form-encoded bodies for webhooks
app.post(
  "/api/whatsapp/inbound",
  express.urlencoded({ extended: false }),
  async (req, res) => {
    try {
      // Validate Twilio signature
      const authToken = process.env.TWILIO_AUTH_TOKEN ?? "";
      const twilioSig = req.headers["x-twilio-signature"] as string | undefined;
      const fullUrl = `${process.env.PUBLIC_APP_URL ?? "https://sea-tarragona.onrender.com"}/api/whatsapp/inbound`;

      if (authToken && twilioSig) {
        const valid = twilio.validateRequest(authToken, twilioSig, fullUrl, req.body);
        if (!valid) {
          console.warn("Invalid Twilio signature on /api/whatsapp/inbound — procesando igualmente");
        }
      }

      const {
        MessageSid,
        From,
        ProfileName,
        Body,
        NumMedia,
        ...rest
      } = req.body;

      if (!MessageSid || !From) {
        return res.status(400).send("Missing required fields");
      }

      // Dedup
      const existing = await db.query(
        `SELECT id FROM whatsapp_messages WHERE message_sid = $1`,
        [MessageSid]
      );
      if (existing.rows.length > 0) {
        return res.status(200).send("<Response></Response>");
      }

      const numMedia = Number(NumMedia ?? 0);
      const mediaUrls: string[] = [];
      for (let i = 0; i < numMedia; i++) {
        const url = req.body[`MediaUrl${i}`];
        if (url) mediaUrls.push(url);
      }

      const now = Date.now();

      // Save message
      const msgResult = await db.query(
        `INSERT INTO whatsapp_messages
          (message_sid, from_phone, profile_name, body, num_media, media_urls, raw_payload, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         RETURNING id`,
        [
          MessageSid,
          From,
          ProfileName ?? null,
          Body ?? null,
          numMedia,
          mediaUrls.length ? JSON.stringify(mediaUrls) : null,
          JSON.stringify({ ...rest, From, ProfileName, Body, NumMedia, MessageSid }),
          now,
        ]
      );
      const msgId = msgResult.rows[0].id;

      // Extract with AI
      const { data: extracted, confidence } = await extractAssistanceFromMessage(
        Body ?? "",
        mediaUrls
      );

      // Save draft
      const draftResult = await db.query(
        `INSERT INTO assistance_drafts
          (source, source_message_id, extracted_json, confidence, status, created_at, updated_at)
         VALUES ('whatsapp', $1, $2, $3, 'pending', $4, $4)
         RETURNING id`,
        [msgId, JSON.stringify(extracted), confidence, now]
      );
      const draftId = draftResult.rows[0].id;

      // Link message → draft
      await db.query(
        `UPDATE whatsapp_messages SET processed = true, assistance_draft_id = $1 WHERE id = $2`,
        [draftId, msgId]
      );

      console.log(`WhatsApp inbound: ${MessageSid} from ${From}, draft #${draftId}, confidence=${confidence}`);

      // Twilio expects TwiML response
      return res.status(200).type("text/xml").send("<Response></Response>");
    } catch (error) {
      console.error("POST /api/whatsapp/inbound error:", error);
      return res.status(200).type("text/xml").send("<Response></Response>");
    }
  }
);

app.post(
  "/api/whatsapp/status",
  express.urlencoded({ extended: false }),
  async (req, res) => {
    try {
      const { MessageSid, MessageStatus, ErrorCode } = req.body;
      console.log(`WhatsApp status update: ${MessageSid} → ${MessageStatus}${ErrorCode ? ` (err ${ErrorCode})` : ""}`);
      return res.status(200).send("OK");
    } catch (error) {
      console.error("POST /api/whatsapp/status error:", error);
      return res.status(200).send("OK");
    }
  }
);

app.get("/api/whatsapp/messages", requireSupervisorRole, async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit ?? 50), 200);
    const offset = Number(req.query.offset ?? 0);
    const result = await db.query(
      `SELECT m.*, d.extracted_json, d.confidence, d.status AS draft_status, d.id AS draft_id
       FROM whatsapp_messages m
       LEFT JOIN assistance_drafts d ON d.id = m.assistance_draft_id
       ORDER BY m.created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    const total = await db.query(`SELECT COUNT(*) FROM whatsapp_messages`);
    return res.json({ items: result.rows, total: Number(total.rows[0].count) });
  } catch (error) {
    console.error("GET /api/whatsapp/messages error:", error);
    return res.status(500).json({ error: "Error obteniendo mensajes" });
  }
});

app.get("/api/assistance-drafts", requireSupervisorRole, async (req, res) => {
  try {
    const status = req.query.status as string | undefined;
    const params: any[] = [];
    const where = status ? `WHERE d.status = $${params.push(status)}` : "";
    const result = await db.query(
      `SELECT d.*, m.from_phone, m.profile_name, m.body AS original_body, m.media_urls
       FROM assistance_drafts d
       LEFT JOIN whatsapp_messages m ON m.id = d.source_message_id
       ${where}
       ORDER BY d.created_at DESC
       LIMIT 100`,
      params
    );
    return res.json(result.rows);
  } catch (error) {
    console.error("GET /api/assistance-drafts error:", error);
    return res.status(500).json({ error: "Error obteniendo borradores" });
  }
});

app.patch("/api/assistance-drafts/:id", requireSupervisorRole, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { extracted_json, status } = req.body;
    const result = await db.query(
      `UPDATE assistance_drafts
       SET extracted_json = COALESCE($2, extracted_json),
           status = COALESCE($3, status),
           updated_at = $4
       WHERE id = $1 RETURNING *`,
      [id, extracted_json ? JSON.stringify(extracted_json) : null, status ?? null, Date.now()]
    );
    return res.json(result.rows[0]);
  } catch (error) {
    console.error("PATCH /api/assistance-drafts/:id error:", error);
    return res.status(500).json({ error: "Error actualizando borrador" });
  }
});

app.post("/api/assistance-drafts/:id/ignore", requireSupervisorRole, async (req, res) => {
  try {
    const id = Number(req.params.id);
    await db.query(
      `UPDATE assistance_drafts SET status = 'ignored', updated_at = $2 WHERE id = $1`,
      [id, Date.now()]
    );
    return res.json({ ok: true });
  } catch (error) {
    console.error("POST /api/assistance-drafts/:id/ignore error:", error);
    return res.status(500).json({ error: "Error ignorando borrador" });
  }
});

/* =========================================================
   START SERVER
========================================================= */
initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Servidor backend en puerto ${PORT}`);
      startAgendaWhatsAppReminderChecker();
      startWorkshopAutoStandbyChecker();
    });
  })
  .catch((error) => {
    console.error("Error inicializando base de datos:", error);
    process.exit(1);
  });
