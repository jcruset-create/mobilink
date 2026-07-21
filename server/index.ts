?import dotenv from "dotenv";
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
import { startWebfleetSync, syncWebfleetOnce, startMantenimientoAvisos } from "./webfleetSync.ts";
import OpenAI, { toFile } from "openai";
import { findUserByPassword } from "./modules/users";
import twilio from "twilio";
import Stripe from "stripe";
import { initIntegrationHub, mountIntegrationHub, startIntegrationWorker } from "./integration-hub/index.ts";

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
    const { jobId, customerName, customerPhone, amountEuros, description } = req.body;

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

    const desc = String(description || "").trim();

    const session = await stripe.checkout.sessions.create({
            line_items: [
        {
          price_data: {
            currency: "eur",
            product_data: {
              name: desc ? `${desc} (ref. ${reference})` : `Paga y señal ${reference}`,
              ...(desc ? { description: desc } : {}),
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
          created_at_ms,
          description
        )
        VALUES ($1, $2, $3, $4, 'pending', $5, $6, $7, $8)
      `,
      [
        reference,
        String(customerName || ""),
        String(customerPhone || ""),
        amountCents,
        session.id,
        session.url,
        Date.now(),
        desc,
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

    const row = result.rows[0];
    // BIGINT columns arrive as strings from pg — convert to number
    if (row.paid_at_ms != null) row.paid_at_ms = Number(row.paid_at_ms);
    if (row.created_at_ms != null) row.created_at_ms = Number(row.created_at_ms);

    res.json({
      success: true,
      payment: row,
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
          created_at_ms,
          description
        FROM payments
        ORDER BY created_at_ms DESC
        LIMIT 50
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

function normalizeCobro(c: any) {
  return {
    id: c.id,
    asistencia_id: c.asistencia_id ?? null,
    operario_name: c.operario_name ?? "",
    cliente_nombre: c.cliente_nombre ?? "",
    telefono: c.telefono ?? "",
    concepto: c.concepto ?? "",
    importe_total: parseFloat(c.importe_total) || 0,
    importe_cobrado: c.importe_cobrado != null ? parseFloat(c.importe_cobrado) : null,
    estado: c.estado ?? "pendiente",
    metodo_pago: c.metodo_pago ?? null,
    fecha_cobro: c.fecha_cobro != null ? Number(c.fecha_cobro) : null,
    observaciones: c.observaciones ?? "",
    created_at_ms: c.created_at_ms != null ? Number(c.created_at_ms) : null,
    updated_at_ms: c.updated_at_ms != null ? Number(c.updated_at_ms) : null,
    plate: c.plate ?? null,
    address: c.address ?? null,
  };
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
    statusChangedAtMs: t.statusChangedAtMs != null ? Number(t.statusChangedAtMs) : null,
    statusTotals: safeJsonParse(t.statusTotals, {}),
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
  "en_camino_base",
  "llegada_taller",
  "redirigida",
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

function haversineDistanceM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
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
    waStatus: row.waStatus ?? null,
    waStatusAtMs: row.waStatusAtMs != null ? Number(row.waStatusAtMs) : null,
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
    plateRemolque: row.plateRemolque ?? null,
    esRemolque: row.esRemolque === true || row.esRemolque === "true",
    descripcionAveria: row.descripcionAveria ?? null,
    trabajosARealizar: row.trabajosARealizar ?? null,
    knownPlaceId: row.knownPlaceId != null ? Number(row.knownPlaceId) : null,
    redirectionLat: normalizeNullableNumber(row.redirectionLat),
    redirectionLng: normalizeNullableNumber(row.redirectionLng),
    redirectedAtMs: row.redirectedAtMs != null ? Number(row.redirectedAtMs) : null,
    redirectedToId: row.redirectedToId != null ? Number(row.redirectedToId) : null,
    redirectedFromId: row.redirectedFromId != null ? Number(row.redirectedFromId) : null,
    conductorNombre: row.conductorNombre ?? null,
    conductorDni: row.conductorDni ?? null,
    observacionesReparacion: row.observacionesReparacion ?? null,
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

const ROADSIDE_ACTIVE_STATUSES = new Set(["asignada", "en_camino", "en_punto", "inicio_reparacion", "finalizada", "en_camino_base"]);
const ROADSIDE_CLOSED_STATUSES = new Set(["llegada_taller", "redirigida", "cancelada"]);

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
  if (status === "en_camino_base") return null;
  if (status === "llegada_taller") return "arrivedAtWorkshopMs";
  if (status === "redirigida") return null;
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
    `Tu asistencia de Mobilink para ${plate} esta registrada.\n` +
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

  // URL de callback para que Twilio nos informe de entregado/leído
  const statusCallback = `${getPublicAppBaseUrl(req, preferredBaseUrl)}/api/whatsapp/status`;

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
      statusCallback,
    });
  }

  return twilioClient.messages.create({
    from: getWhatsAppFromNumber(),
    to: `whatsapp:${normalizeSpanishPhone(customerPhone)}`,
    body: buildRoadsideTrackingMessage(assistance, trackingUrl),
    statusCallback,
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

type WebfleetCreds = { account?: string | null; username?: string | null; password?: string | null; apikey?: string | null; baseUrl?: string | null };

// Lee las credenciales Webfleet de una empresa (cliente) de Supabase.
async function getWebfleetConfigForEmpresa(empresaId: string): Promise<WebfleetCreds | null> {
  const { data, error } = await supabase.from("tc_webfleet_config").select("*").eq("empresa_id", empresaId).maybeSingle();
  if (error || !data || !(data as any).activo || !(data as any).account) return null;
  const d = data as any;
  return { account: d.account, username: d.username, password: d.password, apikey: d.apikey, baseUrl: d.base_url };
}

// Credenciales globales (variables de entorno) si están definidas.
function globalWebfleetCreds(): WebfleetCreds | null {
  if (!process.env.WEBFLEET_ACCOUNT || !process.env.WEBFLEET_USERNAME || !process.env.WEBFLEET_PASSWORD) return null;
  return {
    account: process.env.WEBFLEET_ACCOUNT, username: process.env.WEBFLEET_USERNAME,
    password: process.env.WEBFLEET_PASSWORD, apikey: process.env.WEBFLEET_API_KEY,
    baseUrl: process.env.WEBFLEET_BASE_URL,
  };
}

// Credenciales a usar para una empresa: las suyas propias o, si no tiene, las
// globales (con las que ya funciona el módulo de asistencia). null si no hay ninguna.
async function resolveWebfleetCreds(empresaId: string): Promise<WebfleetCreds | null> {
  return (await getWebfleetConfigForEmpresa(empresaId)) ?? globalWebfleetCreds();
}

function buildWebfleetRequest(action: string, extra: Record<string, string> = {}, creds?: WebfleetCreds): { url: string; headers: Record<string, string> } {
  const account = creds?.account || process.env.WEBFLEET_ACCOUNT;
  const username = creds?.username || process.env.WEBFLEET_USERNAME;
  const password = creds?.password || process.env.WEBFLEET_PASSWORD;
  const apiKey = creds?.apikey || process.env.WEBFLEET_API_KEY;
  const baseUrl = creds?.baseUrl || process.env.WEBFLEET_BASE_URL || "https://csv.webfleet.com/extern";

  if (!account || !username || !password) {
    throw new Error("Credenciales Webfleet no configuradas (cuenta, usuario y contraseña)");
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

// ── Webfleet: viajes y recorrido para informe de seguimiento ──────────────────
function webfleetRange(fromMs: number, toMs: number): Record<string, string> {
  return {
    range_pattern: "ud",
    rangefrom_string: new Date(fromMs).toISOString().replace(/\.\d{3}Z$/, "Z"),
    rangeto_string: new Date(toMs).toISOString().replace(/\.\d{3}Z$/, "Z"),
  };
}

type WebfleetTrip = {
  start_time: string; end_time: string;
  start_latitude: number; start_longitude: number;
  end_latitude: number; end_longitude: number;
  start_postext?: string; end_postext?: string;
  distance: number; duration: number; idle_time?: number;
  avg_speed?: number; max_speed?: number; drivername?: string;
};

async function getWebfleetTrips(objectno: string, fromMs: number, toMs: number): Promise<WebfleetTrip[]> {
  const { url, headers } = buildWebfleetRequest("showTripReportExtern", { objectno, ...webfleetRange(fromMs, toMs) });
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`Webfleet trips HTTP ${r.status}`);
  const data = await r.json();
  if (data?.errorCode) throw new Error(`Webfleet ${data.errorCode}: ${data.errorMsg}`);
  const trips = (Array.isArray(data) ? data : []) as WebfleetTrip[];
  return trips.sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());
}

async function getWebfleetTracks(objectno: string, fromMs: number, toMs: number): Promise<{ lat: number; lng: number }[]> {
  const { url, headers } = buildWebfleetRequest("showTracks", { objectno, ...webfleetRange(fromMs, toMs) });
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`Webfleet tracks HTTP ${r.status}`);
  const data = await r.json();
  if (data?.errorCode) throw new Error(`Webfleet ${data.errorCode}: ${data.errorMsg}`);
  const pts = (Array.isArray(data) ? data : []) as any[];
  return pts
    .map((p) => ({ lat: Number(p.latitude) / 1_000_000, lng: Number(p.longitude) / 1_000_000 }))
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng) && (p.lat !== 0 || p.lng !== 0));
}

// Paradas = huecos entre el fin de un viaje y el inicio del siguiente (umbral en segundos)
type VehicleStop = { n: number; lat: number; lng: number; place: string; arrival: number; departure: number; durationSec: number };
function computeStops(trips: WebfleetTrip[], minSec: number): VehicleStop[] {
  const stops: VehicleStop[] = [];
  let n = 0;
  for (let i = 0; i < trips.length - 1; i++) {
    const endMs = new Date(trips[i].end_time).getTime();
    const nextStartMs = new Date(trips[i + 1].start_time).getTime();
    const gap = Math.round((nextStartMs - endMs) / 1000);
    if (gap >= minSec) {
      n++;
      stops.push({
        n,
        lat: Number(trips[i].end_latitude) / 1_000_000,
        lng: Number(trips[i].end_longitude) / 1_000_000,
        place: trips[i].end_postext || "Parada",
        arrival: endMs,
        departure: nextStartMs,
        durationSec: gap,
      });
    }
  }
  return stops;
}

function fmtDuration(sec: number): string {
  const m = Math.round(sec / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)}h ${m % 60}min`;
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
  const rawToken = String(req.headers["x-admin-token"] ?? req.query?.token ?? "");
  // La cabecera puede venir codificada (contraseñas con acentos/símbolos no caben crudas en headers HTTP)
  let token = rawToken;
  try { token = decodeURIComponent(rawToken); } catch { token = rawToken; }

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
  const techNameRaw = String(req.headers["x-roadside-operator-name"] ?? "").trim();
  // La APK envía el nombre codificado (las cabeceras HTTP no admiten acentos)
  let techName = techNameRaw;
  try { techName = decodeURIComponent(techNameRaw); } catch { /* nombre sin codificar (APK antigua) */ }
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
    void (async () => {
      const role = await getRoleFromRequestAsync(req);

      if (!role) {
        return res.status(401).json({ error: "No autorizado" });
      }

      if (!allowedRoles.includes(role)) {
        return res.status(403).json({ error: "Permisos insuficientes" });
      }

      next();
    })().catch((error) => {
      console.error("requireRole error:", error);
      res.status(500).json({ error: "Error de autorización" });
    });
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

// ── TyreControl: cerrar una intervención de cambio de neumático ──
// Agrupa las operaciones de la sesión, redacta un informe con IA y lo guarda.
app.post("/api/tyrecontrol/intervencion/cerrar", async (req, res) => {
  try {
    const { vehiculoId, desde, montajeAntes, incidencias, imagenChasis } = req.body ?? {};
    if (!vehiculoId || !desde) return res.status(400).json({ error: "vehiculoId y desde requeridos" });

    // Operaciones de la sesión aún sin intervención.
    const { data: ops, error } = await supabase
      .from("operaciones_neumaticos")
      .select("id, empresa_id, tecnico_id, tipo_operacion, motivo, is_anulada, fecha_operacion, " +
        "posicion_origen:tc_posiciones_vehiculo!operaciones_neumaticos_posicion_origen_id_fkey(codigo_posicion, nombre), " +
        "posicion_destino:tc_posiciones_vehiculo!operaciones_neumaticos_posicion_destino_id_fkey(codigo_posicion, nombre), " +
        "neumatico:tc_neumaticos(marca, modelo, medida)")
      .eq("vehiculo_id", vehiculoId)
      .is("intervencion_id", null)
      .gte("created_at", desde)
      .order("created_at", { ascending: true });
    if (error) throw error;
    const activas = (ops ?? []).filter((o: any) => !o.is_anulada);
    if (activas.length === 0) return res.json({ id: null, resumen: "", resumen_ia: "", n: 0 });

    // Resumen determinista (mismas frases que en el front).
    const MOTIVO: Record<string, string> = { desgaste: "desgaste", pinchazo: "pinchazo", rotura: "rotura", preventivo: "preventivo", desgaste_irregular: "desgaste irregular", cambio_estacional: "cambio estacional", reparacion: "reparación", fin_vida: "fin de vida", error_montaje: "error de montaje", otro: "otro" };
    const VERBO: Record<string, [string, string]> = { montaje: ["Montado", "Montados"], desmontaje: ["Desmontado", "Desmontados"], sustitucion: ["Sustituido", "Sustituidos"], rotacion: ["Rotado", "Rotados"], cambio_posicion: ["Cambiado de posición", "Cambiados de posición"], intercambio: ["Intercambiado", "Intercambiados"], descarte: ["Descartado", "Descartados"] };
    const posLabel = (o: any) => { const p = o.posicion_destino ?? o.posicion_origen; return p?.nombre ?? p?.codigo_posicion ?? o.neumatico?.medida ?? ""; };
    const unirY = (xs: string[]) => { const a = xs.filter(Boolean); if (!a.length) return ""; if (a.length === 1) return a[0]; return `${a.slice(0, -1).join(", ")} y ${a[a.length - 1]}`; };
    const porTipo = new Map<string, string[]>(); const reps = new Map<string, string[]>();
    for (const o of activas as any[]) {
      if (o.tipo_operacion === "reparacion") { const m = o.motivo ? (MOTIVO[o.motivo] ?? o.motivo) : "reparación"; const a = reps.get(m) ?? []; const pl = posLabel(o); if (pl) a.push(pl); reps.set(m, a); continue; }
      const a = porTipo.get(o.tipo_operacion) ?? []; const pl = posLabel(o); if (pl) a.push(pl); porTipo.set(o.tipo_operacion, a);
    }
    const lineas: string[] = [];
    for (const [tipo, poss] of porTipo) { const v = VERBO[tipo]; const n = poss.length || (activas as any[]).filter((o) => o.tipo_operacion === tipo).length; const s = n === 1 ? "neumático" : "neumáticos"; const verbo = v ? (n === 1 ? v[0] : v[1]) : tipo; lineas.push(`${verbo} ${n} ${s}${poss.length ? ": " + unirY(poss) : ""}`); }
    for (const [m, poss] of reps) lineas.push(`Reparación (${m})${poss.length ? ": " + unirY(poss) : ""}`);
    const resumen = lineas.join("\n");

    // Estado del vehículo DESPUÉS: montajes actuales por posición.
    const curPorPos = new Map<string, any>();
    try {
      const { data: md } = await supabase
        .from("tc_montajes_actuales")
        .select("posicion_id, neumatico:tc_neumaticos(marca, modelo, medida, profundidad_actual_mm), " +
          "posicion:tc_posiciones_vehiculo(codigo_posicion, nombre, eje, pos_x, pos_y, pos_w, pos_h)")
        .eq("vehiculo_id", vehiculoId);
      for (const r of (md ?? []) as any[]) curPorPos.set(r.posicion_id, r);
    } catch (e) { console.error("montaje después falló:", e); }

    // El plano "después" reutiliza el esqueleto del "antes" (mismas posiciones y
    // coordenadas), sustituyendo el neumático por el actual y limpiando averías.
    let montajeDespues: any[] = [];
    if (Array.isArray(montajeAntes) && montajeAntes.length) {
      montajeDespues = (montajeAntes as any[]).map((a) => {
        const cur = curPorPos.get(a.posicion_id);
        return {
          ...a,
          marca: cur?.neumatico?.marca ?? null,
          modelo: cur?.neumatico?.modelo ?? null,
          medida: cur?.neumatico?.medida ?? null,
          mm: cur?.neumatico?.profundidad_actual_mm ?? null,
          presion: null,
          averias: null,
        };
      });
    } else {
      montajeDespues = Array.from(curPorPos.values()).map((r: any) => ({
        posicion_id: r.posicion_id,
        codigo: r.posicion?.codigo_posicion ?? null,
        eje: r.posicion?.eje ?? null,
        x: r.posicion?.pos_x ?? null, y: r.posicion?.pos_y ?? null,
        w: r.posicion?.pos_w ?? null, h: r.posicion?.pos_h ?? null,
        marca: r.neumatico?.marca ?? null,
        modelo: r.neumatico?.modelo ?? null,
        medida: r.neumatico?.medida ?? null,
        mm: r.neumatico?.profundidad_actual_mm ?? null,
        presion: null,
      }));
    }

    // Trazabilidad de origen (incidencias) para el prompt y la ficha.
    const origen = Array.isArray(incidencias)
      ? (incidencias as any[])
          .filter((i) => Array.isArray(i?.averias) && i.averias.length)
          .map((i) => `${i.codigo ?? "—"}: ${i.averias.join(", ")}${i.gravedad ? ` (${i.gravedad})` : ""}`)
      : [];

    // Redacción con IA (informe técnico con trazabilidad antes→después).
    let resumenIa = resumen;
    try {
      const partes = [
        origen.length ? `Averías de origen:\n${origen.join("\n")}` : "",
        `Acciones realizadas:\n${resumen}`,
      ].filter(Boolean).join("\n\n");
      const r = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "Eres un técnico de neumáticos. Redacta un informe breve (2-4 frases, español, tono profesional) de la intervención: de qué avería se partía, qué se hizo y cómo quedó el vehículo. No inventes datos ni cifras que no aparezcan." },
          { role: "user", content: partes },
        ],
      });
      resumenIa = r.choices[0]?.message?.content?.trim() || resumen;
    } catch (e) { console.error("IA intervención falló, se guarda solo el resumen:", e); }

    const empresaId = (activas[0] as any).empresa_id;
    const tecnicoId = (activas[0] as any).tecnico_id ?? null;
    const { data: interv, error: e2 } = await supabase
      .from("tc_intervenciones")
      .insert({
        empresa_id: empresaId, vehiculo_id: vehiculoId, tecnico_id: tecnicoId,
        resumen, resumen_ia: resumenIa, n_operaciones: activas.length,
        montaje_antes: Array.isArray(montajeAntes) ? montajeAntes : null,
        montaje_despues: montajeDespues.length ? montajeDespues : null,
        incidencias: Array.isArray(incidencias) && incidencias.length ? incidencias : null,
        imagen_chasis: typeof imagenChasis === "string" && imagenChasis ? imagenChasis : null,
      })
      .select("id").single();
    if (e2) throw e2;
    await supabase.from("operaciones_neumaticos").update({ intervencion_id: interv.id }).in("id", (activas as any[]).map((o) => o.id));

    res.json({ id: interv.id, resumen, resumen_ia: resumenIa, n: activas.length });
  } catch (error: any) {
    console.error("cerrar intervención:", error);
    res.status(500).json({ error: error?.message || "Error" });
  }
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
             "roadsideCapable", "currentRoadsideAssistanceId", phone,
             "statusChangedAtMs", "statusTotals"
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

app.patch("/api/techs/:name/roadside-capable", requireAdminRole, async (req, res) => {
  try {
    const name = String(req.params.name);
    const { roadsideCapable } = req.body ?? {};

    if (roadsideCapable === undefined) {
      return res.status(400).json({ error: "roadsideCapable requerido" });
    }

    const value = Boolean(roadsideCapable);

    await db.query(
      `UPDATE techs SET "roadsideCapable" = $2 WHERE name = $1`,
      [name, value]
    );

    return res.json({ ok: true, name, roadsideCapable: value });
  } catch (error) {
    console.error("PATCH /api/techs/:name/roadside-capable error:", error);
    res.status(500).json({ error: "Error actualizando apto para carretera" });
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

app.get("/api/jobs", async (req, res) => {
  try {
    // scope=live (por defecto para el operativo y su auto-sync): solo trabajos
    // no cerrados + cerrados de los últimos 3 días (cubre las estadísticas del
    // día). El histórico/ranking piden ?scope=all para el listado completo.
    // Esto evita descargar cientos de trabajos cerrados en cada refresco.
    const scope = String((req.query?.scope as string) || "live");
    let result;
    if (scope === "all") {
      result = await db.query(`SELECT * FROM jobs ORDER BY id DESC`);
    } else {
      const cutoff = Date.now() - 3 * 24 * 60 * 60 * 1000;
      result = await db.query(
        `SELECT * FROM jobs
         WHERE status <> 'cerrado'
            OR COALESCE("closedAtMs", "createdAtMs", 0) > $1
         ORDER BY id DESC`,
        [cutoff]
      );
    }
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
   WORKSHOP CONFIG
========================================================= */

const WORKSHOP_CONFIG_KEYS = ["taller_lat", "taller_lng", "taller_direccion", "taller_radio_m"] as const;

async function getWorkshopConfig() {
  const result = await db.query(
    `SELECT key, value FROM workshop_config WHERE key = ANY($1)`,
    [WORKSHOP_CONFIG_KEYS]
  );
  const map: Record<string, string> = {};
  for (const row of result.rows) map[row.key] = row.value;
  return {
    taller_lat: map["taller_lat"] ?? "",
    taller_lng: map["taller_lng"] ?? "",
    taller_direccion: map["taller_direccion"] ?? "",
    taller_radio_m: map["taller_radio_m"] ?? "300",
  };
}

app.get("/api/workshop-config", requireAdminRole, async (_req, res) => {
  try {
    res.json(await getWorkshopConfig());
  } catch (error) {
    console.error("GET /api/workshop-config error:", error);
    res.status(500).json({ error: "Error cargando configuración" });
  }
});

app.post("/api/workshop-config", requireAdminRole, async (req, res) => {
  try {
    const { taller_lat, taller_lng, taller_direccion, taller_radio_m } = req.body ?? {};
    const entries: [string, string][] = [
      ["taller_lat", String(taller_lat ?? "")],
      ["taller_lng", String(taller_lng ?? "")],
      ["taller_direccion", String(taller_direccion ?? "")],
      ["taller_radio_m", String(taller_radio_m ?? "300")],
    ];
    for (const [key, value] of entries) {
      await db.query(
        `INSERT INTO workshop_config(key, value) VALUES($1, $2)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [key, value]
      );
    }
    res.json({ ok: true });
  } catch (error) {
    console.error("POST /api/workshop-config error:", error);
    res.status(500).json({ error: "Error guardando configuración" });
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

    // En camino al punto (en_camino) o de vuelta al taller (en_camino_base)
    const enCaminoBase = assistance.status === "en_camino_base";
    const canRecalculate =
      (assistance.status === "en_camino" || enCaminoBase) &&
      assistance.webfleetVehicleId &&
      assistance.latitude != null &&
      assistance.longitude != null;

    if (canRecalculate) {
      try {
        vehiclePosition = await getWebfleetVehiclePosition(assistance.webfleetVehicleId!);

        // Destino: si vuelve al taller, ETA al taller; si no, al punto de avería
        let destino = { lat: assistance.latitude!, lng: assistance.longitude! };
        if (enCaminoBase) {
          const wcfg = await getWorkshopConfig();
          const wlat = parseFloat(wcfg.taller_lat);
          const wlng = parseFloat(wcfg.taller_lng);
          if (Number.isFinite(wlat) && Number.isFinite(wlng)) destino = { lat: wlat, lng: wlng };
        }

        const eta = await calcularETA(vehiclePosition, destino);
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

    // Matrícula de NUESTRA furgoneta (no la del camión asistido)
    let vanPlate: string | null = null;
    if (assistance.webfleetVehicleId) {
      try {
        const vp = await db.query(
          `SELECT plate FROM roadside_vehicles WHERE "webfleetVehicleId" = $1 LIMIT 1`,
          [assistance.webfleetVehicleId]
        );
        vanPlate = vp.rows[0]?.plate ?? null;
      } catch { /* sin matrícula */ }
    }

    // Coordenadas del taller (destino en vuelta al taller)
    let workshop: { lat: number; lng: number } | null = null;
    try {
      const wcfg = await getWorkshopConfig();
      const wlat = parseFloat(wcfg.taller_lat);
      const wlng = parseFloat(wcfg.taller_lng);
      if (Number.isFinite(wlat) && Number.isFinite(wlng)) workshop = { lat: wlat, lng: wlng };
    } catch { /* sin config */ }

    res.json({
      assistance,
      vanPlate,
      workshop,
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
      const role = await getRoleFromRequestAsync(req);
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

    // Cruzar con matrícula de nuestra BD
    const dbVehicles = await db.query(
      `SELECT "webfleetVehicleId", plate FROM roadside_vehicles WHERE "webfleetVehicleId" IS NOT NULL`
    );
    const plateByWebfleetId = new Map<string, string>(
      dbVehicles.rows.map((r: any) => [r.webfleetVehicleId, r.plate])
    );

    const vehicles = Array.isArray(data) ? data : data?.data ?? [];
    res.json(
      vehicles.map((v: any) => ({
        objectno: v.objectno,
        objectname: v.objectname ?? v.objectno,
        lat: Number(v.latitude_mdeg) / 1_000_000,
        lng: Number(v.longitude_mdeg) / 1_000_000,
        postext: v.postext_short ?? v.postext ?? null,
        timestamp: v.pos_time ?? null,
        plate: plateByWebfleetId.get(v.objectno) ?? null,
        speedKmh: v.speed_kmh != null ? Number(v.speed_kmh) : null,
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

// ── TyreControl: Webfleet ─────────────────────────────────────────────────────
// Usa las credenciales de la empresa (tc_webfleet_config) o, si aún no las tiene,
// las globales del módulo de asistencia. Así los vehículos de la cuenta ya
// disponible funcionan hoy y cada cliente se conecta al entregar su propia API.

// Odómetro TOTAL del vehículo en km. Webfleet (showObjectReportExtern) da:
//   odometer_long → metros (preciso)
//   odometer      → hectómetros (0,1 km)
// Ambos son el cuentakilómetros real del vehículo, no un parcial.
function webfleetOdometerKm(o: any): number | null {
  const long = Number(o?.odometer_long);
  if (Number.isFinite(long) && long > 0) return Math.round(long / 1000); // metros → km
  const hm = Number(o?.odometer);
  if (Number.isFinite(hm) && hm > 0) return Math.round(hm / 10); // hectómetros → km
  const cand = Number(o?.can_odometer ?? o?.dashboard_odometer ?? o?.mileage ?? o?.milage);
  if (Number.isFinite(cand) && cand > 0) return cand > 200000 ? Math.round(cand / 1000) : Math.round(cand);
  return null;
}

// Fuerza un ciclo de sincronización de "vehículos en base" y devuelve el nº
// de vehículos actualizados. Para el botón "Sincronizar ahora" de la config.
app.post("/api/tyrecontrol/webfleet/sync", async (_req, res) => {
  const r = await syncWebfleetOnce();
  if ("error" in r) return res.status(502).json(r);
  res.json(r);
});

// Lista de objetos Webfleet de una empresa (para enlazar vehículos por su ID).
app.get("/api/tyrecontrol/webfleet/objects", async (req, res) => {
  try {
    const empresa = String(req.query.empresa || "");
    if (!empresa) return res.status(400).json({ error: "Falta el parámetro empresa" });
    const creds = await resolveWebfleetCreds(empresa);
    if (!creds) return res.status(503).json({ error: "Webfleet no configurado" });
    const { url, headers } = buildWebfleetRequest("showObjectReportExtern", {}, creds);
    const r = await fetch(url, { headers });
    if (!r.ok) return res.status(502).json({ error: `Webfleet HTTP ${r.status}` });
    const data = await r.json();
    if (data?.errorCode) return res.status(502).json({ error: `Webfleet ${data.errorCode}: ${data.errorMsg}` });
    const objs = Array.isArray(data) ? data : data?.data ?? [];
    res.json(objs.map((v: any) => ({
      objectno: v.objectno,
      objectname: v.objectname ?? v.objectno,
      odometer_km: webfleetOdometerKm(v),
      pos_time: v.pos_time ?? null,
    })));
  } catch (e: any) { res.status(500).json({ error: e?.message || "Error Webfleet" }); }
});

// Estado de un objeto: km (odómetro) + posición. Para sincronizar un vehículo.
app.get("/api/tyrecontrol/webfleet/odometer", async (req, res) => {
  try {
    const empresa = String(req.query.empresa || "");
    const objectno = String(req.query.objectno || "");
    if (!empresa || !objectno) return res.status(400).json({ error: "Falta empresa u objectno" });
    const creds = await resolveWebfleetCreds(empresa);
    if (!creds) return res.status(503).json({ error: "Webfleet no configurado" });
    const { url, headers } = buildWebfleetRequest("showObjectReportExtern", { objectno }, creds);
    const r = await fetch(url, { headers });
    if (!r.ok) return res.status(502).json({ error: `Webfleet HTTP ${r.status}` });
    const data = await r.json();
    if (data?.errorCode) return res.status(502).json({ error: `Webfleet ${data.errorCode}: ${data.errorMsg}` });
    const objs = Array.isArray(data) ? data : data?.data ?? [];
    const o = objs.find((v: any) => String(v.objectno) === String(objectno)) ?? objs[0];
    if (!o) return res.status(404).json({ error: "Objeto no encontrado en Webfleet" });
    const lat = o.latitude_mdeg != null ? Number(o.latitude_mdeg) / 1e6 : (o.latitude != null ? Number(o.latitude) : null);
    const lng = o.longitude_mdeg != null ? Number(o.longitude_mdeg) / 1e6 : (o.longitude != null ? Number(o.longitude) : null);
    const speed = Number(o.speed);
    res.json({
      objectno,
      objectname: o.objectname ?? objectno,
      odometer_km: webfleetOdometerKm(o),
      lat: Number.isFinite(lat as number) ? lat : null,
      lng: Number.isFinite(lng as number) ? lng : null,
      postext: o.postext ?? o.postext_short ?? null,
      speed_kmh: Number.isFinite(speed) ? speed : null,
      pos_time: o.pos_time ?? null,
    });
  } catch (e: any) { res.status(500).json({ error: e?.message || "Error Webfleet" }); }
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

      // Geofencing automático: si el operario está dentro del radio del taller, pasar a llegada_taller
      const cfg = await getWorkshopConfig();
      const tallerLat = parseFloat(cfg.taller_lat);
      const tallerLng = parseFloat(cfg.taller_lng);
      const radioM = parseFloat(cfg.taller_radio_m) || 300;

      const distM = (isFinite(tallerLat) && isFinite(tallerLng))
        ? haversineDistanceM(lat, lng, tallerLat, tallerLng)
        : Infinity;

      if (distM <= radioM) {
        const upd = await db.query(
          `
            UPDATE roadside_assistances
            SET status = 'llegada_taller', "arrivedAtWorkshopMs" = $2
            WHERE id = $1
              AND status = 'en_camino_base'
              AND "arrivedAtWorkshopMs" IS NULL
            RETURNING "assignedTechName"
          `,
          [id, Date.now()]
        );
        // Liberar al técnico al cerrar la asistencia
        if (upd.rows[0]?.assignedTechName) {
          await freeTechFromRoadside(upd.rows[0].assignedTechName, id);
        }
      }

      res.json({ ok: true, distToWorkshopM: Math.round(distM) });
    } catch (error) {
      console.error("POST /api/roadside-operator/assistances/:id/location error:", error);
      res.status(500).json({ error: "Error guardando ubicacion" });
    }
  }
);

// Lote de posiciones capturadas offline (migas de pan). Se envían al recuperar señal.
app.post(
  "/api/roadside-operator/assistances/:id/locations-batch",
  requireRoadsideOperator,
  async (req, res) => {
    try {
      const operator = (req as any).roadsideOperator as { techName: string };
      const id = Number(req.params.id);
      const points = Array.isArray(req.body?.points) ? req.body.points : [];
      if (!Number.isFinite(id)) return res.status(400).json({ error: "ID no válido" });

      const check = await db.query(
        `SELECT id FROM roadside_assistances WHERE id = $1 AND "assignedTechName" = $2 LIMIT 1`,
        [id, operator.techName]
      );
      if (check.rows.length === 0) {
        return res.status(403).json({ error: "Asistencia no encontrada o no asignada a ti" });
      }

      // Guardar todas las migas de pan (rastro), ordenadas por hora
      const valid = points
        .map((p: any) => ({ lat: Number(p.lat), lng: Number(p.lng), ts: Number(p.ts) || Date.now() }))
        .filter((p: any) => Number.isFinite(p.lat) && Number.isFinite(p.lng))
        .sort((a: any, b: any) => a.ts - b.ts);

      for (const p of valid) {
        await db.query(
          `INSERT INTO roadside_operator_track ("assistanceId", lat, lng, "ts") VALUES ($1,$2,$3,$4)`,
          [id, p.lat, p.lng, p.ts]
        );
      }

      // Aplicar la ÚLTIMA posición como ubicación actual + geovalla de taller
      if (valid.length > 0) {
        const last = valid[valid.length - 1];
        await db.query(
          `UPDATE roadside_assistances SET "operatorLat" = $2, "operatorLng" = $3, "operatorLocationAtMs" = $4 WHERE id = $1`,
          [id, last.lat, last.lng, last.ts]
        );
        const cfg = await getWorkshopConfig();
        const tLat = parseFloat(cfg.taller_lat), tLng = parseFloat(cfg.taller_lng);
        const radioM = parseFloat(cfg.taller_radio_m) || 300;
        if (isFinite(tLat) && isFinite(tLng) && haversineDistanceM(last.lat, last.lng, tLat, tLng) <= radioM) {
          const upd = await db.query(
            `UPDATE roadside_assistances SET status = 'llegada_taller', "arrivedAtWorkshopMs" = $2
             WHERE id = $1 AND status = 'en_camino_base' AND "arrivedAtWorkshopMs" IS NULL
             RETURNING "assignedTechName"`,
            [id, Date.now()]
          );
          if (upd.rows[0]?.assignedTechName) await freeTechFromRoadside(upd.rows[0].assignedTechName, id);
        }
      }

      res.json({ ok: true, stored: valid.length });
    } catch (error) {
      console.error("POST locations-batch error:", error);
      res.status(500).json({ error: "Error guardando rastro" });
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

      // Reenvío offline ya procesado → devolver estado actual sin reaplicar
      if (req.body?.clientActionId && (await isDuplicateAction(req.body.clientActionId))) {
        return res.json(normalizeRoadsideAssistanceRow(check.rows[0]));
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
              : `AND status NOT IN ('llegada_taller', 'cancelada', 'redirigida')`
          }
          ORDER BY "createdAtMs" DESC
          LIMIT 100
        `,
        [operator.techName]
      );

      const rows = result.rows.map(normalizeRoadsideAssistanceRow) as any[];

      // Adjuntar fotos (archivos subidos + imágenes recibidas por WhatsApp) a cada asistencia
      const ids = rows.map((r) => r.id);
      if (ids.length > 0) {
        const photos = await db.query(
          `SELECT "assistanceId" AS jid, url, "createdAtMs" AS ts
             FROM roadside_assistance_files
             WHERE "assistanceId" = ANY($1) AND kind <> 'firma' AND url IS NOT NULL
           UNION ALL
           SELECT job_id AS jid, COALESCE(media_stored_url, media_url) AS url, received_at AS ts
             FROM whatsapp_capture_messages
             WHERE job_id = ANY($1) AND message_type = 'image'
               AND (media_stored_url IS NOT NULL OR media_url IS NOT NULL)
           ORDER BY ts ASC`,
          [ids]
        );
        const byJob = new Map<number, string[]>();
        for (const p of photos.rows) {
          const arr = byJob.get(Number(p.jid)) ?? [];
          if (p.url && !arr.includes(p.url)) arr.push(p.url);
          byJob.set(Number(p.jid), arr);
        }
        for (const r of rows) r.photoUrls = byJob.get(r.id) ?? [];
      }

      res.json(rows);
    } catch (error) {
      console.error("GET /api/roadside-operator/assistances error:", error);
      res.status(500).json({ error: "Error obteniendo asistencias operario" });
    }
  }
);

app.patch(
  "/api/roadside-operator/assistances/:id/plate",
  requireRoadsideOperator,
  async (req, res) => {
    try {
      const id = Number(req.params.id);
      const plate = String(req.body?.plate || "").trim().toUpperCase();
      if (!plate) return res.status(400).json({ error: "Matrícula requerida" });
      const result = await db.query(
        `UPDATE roadside_assistances SET plate = $2 WHERE id = $1 RETURNING *`,
        [id, plate]
      );
      if (result.rows.length === 0) return res.status(404).json({ error: "Asistencia no encontrada" });
      res.json(normalizeRoadsideAssistanceRow(result.rows[0]));
    } catch (error) {
      console.error("PATCH /api/roadside-operator/assistances/:id/plate error:", error);
      res.status(500).json({ error: "Error actualizando matrícula" });
    }
  }
);

app.post(
  "/api/roadside-operator/assistances/:id/report-plate-mismatch",
  requireRoadsideOperator,
  async (req, res) => {
    try {
      const id = Number(req.params.id);
      const operator = (req as any).roadsideOperator as { techName: string };
      const { detected, current } = req.body as { detected?: string; current?: string };
      await db.query(
        `INSERT INTO roadside_assistance_events ("assistanceId", status, "createdBy", note, "createdAtMs")
         VALUES ($1, 'incidencia_matricula', $2, $3, $4)`,
        [id, operator.techName, `Matrícula no coincide: IA detectó "${detected ?? '?'}", asistencia tiene "${current ?? '?'}"`, Date.now()]
      );
      res.json({ ok: true });
    } catch (error) {
      console.error("POST /api/roadside-operator/assistances/:id/report-plate-mismatch error:", error);
      res.status(500).json({ error: "Error reportando incidencia" });
    }
  }
);

app.post(
  "/api/roadside-operator/assistances/:id/send-eta",
  requireRoadsideOperator,
  async (req, res) => {
    try {
      const id = Number(req.params.id);
      const { etaMinutos, distanciaKm } = req.body as { etaMinutos?: number; distanciaKm?: string };

      const result = await db.query(`SELECT * FROM roadside_assistances WHERE id = $1 LIMIT 1`, [id]);
      if (result.rows.length === 0) return res.status(404).json({ error: "Asistencia no encontrada" });

      const a = normalizeRoadsideAssistanceRow(result.rows[0]);
      const customerPhone = a.customerPhone;
      if (!customerPhone) return res.status(400).json({ error: "Sin teléfono de cliente" });

      const waResult = await sendRoadsideStatusWhatsApp(a, "en_camino", {
        etaMinutos: etaMinutos ?? null,
        etaKm: distanciaKm ?? null,
      });

      res.json({ ok: true, whatsapp: waResult });
    } catch (error: any) {
      console.error("POST /api/roadside-operator/assistances/:id/send-eta error:", error);
      res.status(500).json({ error: error?.message || "Error enviando ETA" });
    }
  }
);

app.get(
  "/api/roadside-operator/history",
  requireRoadsideOperator,
  async (req, res) => {
    try {
      const operator = (req as any).roadsideOperator as { techName: string };
      const result = await db.query(
        `SELECT * FROM roadside_assistances
         WHERE "assignedTechName" = $1
           AND status IN ('llegada_taller', 'cancelada')
         ORDER BY "createdAtMs" DESC
         LIMIT 100`,
        [operator.techName]
      );
      res.json(result.rows.map(normalizeRoadsideAssistanceRow));
    } catch (error) {
      console.error("GET /api/roadside-operator/history error:", error);
      res.status(500).json({ error: "Error obteniendo historial" });
    }
  }
);

app.get(
  "/api/roadside-operator/assistances/:id/whatsapp-capture",
  requireRoadsideOperator,
  async (req, res) => {
    try {
      const operator = (req as any).roadsideOperator as { techName: string };
      const id = Number(req.params.id);

      // Verify the assistance is assigned to this operator
      const check = await db.query(
        `SELECT id FROM roadside_assistances WHERE id = $1 AND "assignedTechName" = $2 LIMIT 1`,
        [id, operator.techName]
      );
      if (check.rows.length === 0) {
        return res.status(403).json({ error: "Asistencia no encontrada o no asignada a ti" });
      }

      // Get the most recent closed session with AI suggestions
      const sessionResult = await db.query(
        `SELECT * FROM whatsapp_capture_sessions WHERE job_id = $1 ORDER BY started_at DESC LIMIT 1`,
        [id]
      );
      if (!sessionResult.rows.length) return res.json(null);

      const session = sessionResult.rows[0];
      session.started_at = session.started_at ? Number(session.started_at) : null;
      session.ended_at = session.ended_at ? Number(session.ended_at) : null;
      if (session.ai_suggestions) {
        try { session.ai_suggestions = JSON.parse(session.ai_suggestions); } catch {}
      }

      // Get image and video messages from this session
      const msgResult = await db.query(
        `SELECT media_stored_url, media_url, message_type FROM whatsapp_capture_messages
         WHERE session_id = $1 AND message_type IN ('image','video') AND (media_stored_url IS NOT NULL OR media_url IS NOT NULL)
         ORDER BY received_at ASC`,
        [session.id]
      );
      const imageUrls: string[] = [];
      const videoUrls: string[] = [];
      for (const m of msgResult.rows) {
        const url = (m.media_stored_url || m.media_url) as string;
        if (m.message_type === "video") videoUrls.push(url);
        else imageUrls.push(url);
      }

      return res.json({
        resumen: session.ai_suggestions?.resumen ?? null,
        contactoNombre: session.ai_suggestions?.contactoNombre ?? null,
        contactoTelefono: session.ai_suggestions?.contactoTelefono ?? null,
        imageUrls,
        videoUrls,
        status: session.status,
      });
    } catch (error) {
      console.error("GET /api/roadside-operator/assistances/:id/whatsapp-capture error:", error);
      res.status(500).json({ error: "Error obteniendo captura WhatsApp" });
    }
  }
);

/* ── COBROS (operario) ──────────────────────────────────────────────────── */

// GET cobros asignados al operario (por operario_name o por asistencia asignada)
app.get(
  "/api/roadside-operator/cobros",
  requireRoadsideOperator,
  async (req, res) => {
    try {
      const operator = (req as any).roadsideOperator as { techName: string };
      const result = await db.query(
        `SELECT c.*, COALESCE(NULLIF(ra.plate, ''), ra."plateRemolque") AS plate, ra.address
         FROM cobros c
         LEFT JOIN roadside_assistances ra ON ra.id = c.asistencia_id
         WHERE c.operario_name = $1
            OR (c.asistencia_id IS NOT NULL AND ra."assignedTechName" = $1)
         ORDER BY c.created_at_ms DESC
         LIMIT 100`,
        [operator.techName]
      );
      return res.json(result.rows.map(normalizeCobro));
    } catch (error) {
      console.error("GET /api/roadside-operator/cobros error:", error);
      return res.status(500).json({ error: "Error obteniendo cobros" });
    }
  }
);

// GET cobro asociado a una asistencia concreta
app.get(
  "/api/roadside-operator/assistances/:id/cobro",
  requireRoadsideOperator,
  async (req, res) => {
    try {
      const operator = (req as any).roadsideOperator as { techName: string };
      const id = Number(req.params.id);

      const check = await db.query(
        `SELECT id FROM roadside_assistances WHERE id = $1 AND "assignedTechName" = $2 LIMIT 1`,
        [id, operator.techName]
      );
      if (check.rows.length === 0) return res.json(null);

      const result = await db.query(
        `SELECT c.*, COALESCE(NULLIF(ra.plate, ''), ra."plateRemolque") AS plate, ra.address
         FROM cobros c
         LEFT JOIN roadside_assistances ra ON ra.id = c.asistencia_id
         WHERE c.asistencia_id = $1
           AND c.estado != 'anulado'
         ORDER BY c.created_at_ms DESC
         LIMIT 1`,
        [id]
      );
      if (result.rows.length === 0) return res.json(null);
      return res.json(normalizeCobro(result.rows[0]));
    } catch (error) {
      console.error("GET /api/roadside-operator/assistances/:id/cobro error:", error);
      return res.status(500).json({ error: "Error obteniendo cobro" });
    }
  }
);

// POST marcar cobro como cobrado
app.post(
  "/api/roadside-operator/cobros/:id/marcar-cobrado",
  requireRoadsideOperator,
  async (req, res) => {
    try {
      const operator = (req as any).roadsideOperator as { techName: string };
      const id = Number(req.params.id);
      const { metodoPago, importeCobrado, observaciones } = req.body ?? {};

      const METODOS_VALIDOS = ["efectivo", "tarjeta", "transferencia", "bizum", "pendiente_facturar"];
      if (!metodoPago || !METODOS_VALIDOS.includes(metodoPago)) {
        return res.status(400).json({ error: "Método de pago no válido" });
      }
      const importe = parseFloat(importeCobrado);
      if (!importe || importe <= 0) {
        return res.status(400).json({ error: "Importe debe ser mayor que 0" });
      }

      // Verificar que el cobro pertenece al operario
      const check = await db.query(
        `SELECT c.id, c.estado
         FROM cobros c
         LEFT JOIN roadside_assistances ra ON ra.id = c.asistencia_id
         WHERE c.id = $1
           AND (c.operario_name = $2 OR ra."assignedTechName" = $2)
         LIMIT 1`,
        [id, operator.techName]
      );
      if (check.rows.length === 0) {
        return res.status(404).json({ error: "Cobro no encontrado" });
      }
      if (check.rows[0].estado === "cobrado") {
        return res.status(409).json({ error: "Este cobro ya está marcado como cobrado" });
      }

      const now = Date.now();
      const updated = await db.query(
        `UPDATE cobros
         SET estado = 'cobrado',
             metodo_pago = $2,
             importe_cobrado = $3,
             observaciones = CASE WHEN $4::text IS NOT NULL THEN $4::text ELSE observaciones END,
             fecha_cobro = $5,
             updated_at_ms = $6
         WHERE id = $1
         RETURNING *`,
        [id, metodoPago, importe, observaciones ?? null, now, now]
      );
      return res.json(normalizeCobro(updated.rows[0]));
    } catch (error) {
      console.error("POST /api/roadside-operator/cobros/:id/marcar-cobrado error:", error);
      return res.status(500).json({ error: "Error marcando cobro" });
    }
  }
);

/* ── PAGOS STRIPE (operario) ────────────────────────────────────────────── */

// POST crear enlace de pago Stripe desde la APK
app.post(
  "/api/roadside-operator/payments/create",
  requireRoadsideOperator,
  async (req, res) => {
    try {
      const { jobId, customerName, customerPhone, amountEuros, description } = req.body ?? {};
      const reference = String(jobId || "").trim();
      const amountCents = Math.round(Number(amountEuros || 0) * 100);
      const desc = String(description || "").trim();

      if (!reference) return res.status(400).json({ success: false, message: "Referencia obligatoria" });
      if (!amountCents || amountCents < 100) return res.status(400).json({ success: false, message: "Importe mínimo 1 €" });

      const session = await stripe.checkout.sessions.create({
        line_items: [{
          price_data: {
            currency: "eur",
            product_data: {
              name: desc ? `${desc} (ref. ${reference})` : `Paga y señal ${reference}`,
              ...(desc ? { description: desc } : {}),
            },
            unit_amount: amountCents,
          },
          quantity: 1,
        }],
        mode: "payment",
        success_url: `${process.env.PUBLIC_APP_URL}/payment-success`,
        cancel_url: `${process.env.PUBLIC_APP_URL}/payment-cancelled`,
        metadata: { reference, jobId: reference, customerName: String(customerName || ""), customerPhone: String(customerPhone || "") },
      });

      await db.query(
        `INSERT INTO payments (reference, customer_name, customer_phone, amount_cents, status, stripe_session_id, payment_url, created_at_ms, description)
         VALUES ($1, $2, $3, $4, 'pending', $5, $6, $7, $8)`,
        [reference, String(customerName || ""), String(customerPhone || ""), amountCents, session.id, session.url, Date.now(), desc]
      );

      return res.json({ success: true, url: session.url, sessionId: session.id, reference });
    } catch (error: any) {
      console.error("POST /api/roadside-operator/payments/create error:", error);
      return res.status(500).json({ success: false, message: error.message });
    }
  }
);

// GET historial de pagos Stripe (últimos 50)
app.get(
  "/api/roadside-operator/payments/history",
  requireRoadsideOperator,
  async (_req, res) => {
    try {
      const result = await db.query(
        `SELECT id, reference, customer_name, customer_phone, amount_cents, status, payment_url, paid_at_ms, created_at_ms, description
         FROM payments ORDER BY created_at_ms DESC LIMIT 50`
      );
      return res.json(result.rows.map((r: any) => ({
        ...r,
        amount_cents: Number(r.amount_cents),
        paid_at_ms: r.paid_at_ms != null ? Number(r.paid_at_ms) : null,
        created_at_ms: Number(r.created_at_ms),
      })));
    } catch (error) {
      console.error("GET /api/roadside-operator/payments/history error:", error);
      return res.status(500).json({ error: "Error obteniendo historial" });
    }
  }
);

// DELETE cancelar pago pendiente desde APK
app.delete(
  "/api/roadside-operator/payments/:id",
  requireRoadsideOperator,
  async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: "ID inválido" });
      const existing = await db.query(`SELECT id, status FROM payments WHERE id = $1`, [id]);
      if (existing.rows.length === 0) return res.status(404).json({ success: false, message: "Cobro no encontrado" });
      if (existing.rows[0].status === "paid") return res.status(400).json({ success: false, message: "No se puede cancelar un cobro pagado" });
      await db.query(`DELETE FROM payments WHERE id = $1`, [id]);
      return res.json({ success: true });
    } catch (error: any) {
      console.error("DELETE /api/roadside-operator/payments/:id error:", error);
      return res.status(500).json({ success: false, message: error.message });
    }
  }
);

/* ── COBROS (admin) ─────────────────────────────────────────────────────── */

// POST crear cobro desde el panel admin (para asignar al operario de una asistencia)
app.post("/api/cobros", requireAdminRole, async (req, res) => {
  try {
    const { asistencia_id, operario_name, cliente_nombre, telefono, concepto, importe_total, observaciones } = req.body ?? {};
    if (!concepto) return res.status(400).json({ error: "Concepto obligatorio" });
    const importe = parseFloat(importe_total);
    if (!importe || importe <= 0) return res.status(400).json({ error: "Importe debe ser mayor que 0" });

    const now = Date.now();
    const result = await db.query(
      `INSERT INTO cobros
         (asistencia_id, operario_name, cliente_nombre, telefono, concepto, importe_total, estado, observaciones, created_at_ms, updated_at_ms)
       VALUES ($1, $2, $3, $4, $5, $6, 'pendiente', $7, $8, $8)
       RETURNING *`,
      [asistencia_id ?? null, operario_name ?? "", cliente_nombre ?? "", telefono ?? "", concepto, importe, observaciones ?? "", now]
    );
    return res.json(normalizeCobro(result.rows[0]));
  } catch (error) {
    console.error("POST /api/cobros error:", error);
    return res.status(500).json({ error: "Error creando cobro" });
  }
});

// GET listar todos los cobros (admin)
app.get("/api/cobros", requireAdminRole, async (_req, res) => {
  try {
    const result = await db.query(
      `SELECT c.*, COALESCE(NULLIF(ra.plate, ''), ra."plateRemolque") AS plate, ra.address
       FROM cobros c
       LEFT JOIN roadside_assistances ra ON ra.id = c.asistencia_id
       ORDER BY c.created_at_ms DESC
       LIMIT 200`
    );
    return res.json(result.rows.map(normalizeCobro));
  } catch (error) {
    console.error("GET /api/cobros error:", error);
    return res.status(500).json({ error: "Error obteniendo cobros" });
  }
});

// Idempotencia: evita aplicar dos veces la misma acción reenviada desde la APK
// (modo offline). Devuelve true si ya se procesó.
async function isDuplicateAction(actionId: unknown): Promise<boolean> {
  const aid = String(actionId ?? "").trim();
  if (!aid) return false;
  try {
    const r = await db.query(
      `INSERT INTO processed_actions(action_id, "createdAtMs") VALUES($1,$2)
       ON CONFLICT (action_id) DO NOTHING RETURNING action_id`,
      [aid, Date.now()]
    );
    return r.rows.length === 0;
  } catch {
    return false;
  }
}

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
        "en_camino_base",
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

      // Acción ya procesada (reenvío offline) → devolver estado actual sin reaplicar
      if (req.body?.clientActionId && (await isDuplicateAction(req.body.clientActionId))) {
        const cur = await db.query(`SELECT * FROM roadside_assistances WHERE id = $1`, [id]);
        return res.json(normalizeRoadsideAssistanceRow(cur.rows[0]));
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

      // Auto-transición: al finalizar la reparación, pasar automáticamente a en_camino_base
      if (status === "finalizada") {
        await db.query(
          `INSERT INTO roadside_assistance_events ("assistanceId", status, note, "createdBy", "createdAtMs")
           VALUES ($1, 'en_camino_base', 'Vuelta al taller automática', $2, $3)`,
          [id, operator.techName, now + 1]
        );
        const baseResult = await db.query(
          `UPDATE roadside_assistances SET status = 'en_camino_base', "updatedAtMs" = $2 WHERE id = $1 RETURNING *`,
          [id, now + 1]
        );
        updated = normalizeRoadsideAssistanceRow(baseResult.rows[0]);
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
      const observaciones = req.body?.observacionesReparacion != null
        ? String(req.body.observacionesReparacion).trim()
        : null;

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

      // Reenvío offline ya procesado → devolver actual sin reaplicar
      if (req.body?.clientActionId && (await isDuplicateAction(req.body.clientActionId))) {
        const cur = await db.query(`SELECT * FROM roadside_assistances WHERE id = $1`, [id]);
        return res.json(normalizeRoadsideAssistanceRow(cur.rows[0]));
      }

      const result = await db.query(
        `UPDATE roadside_assistances
         SET "conductorNombre" = $2, "conductorDni" = $3, "observacionesReparacion" = COALESCE($4, "observacionesReparacion")
         WHERE id = $1 RETURNING *`,
        [id, nombre, dni, observaciones]
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

// Posición en vivo (Webfleet) + velocidad + ETA al destino correcto.
// Para en_camino → ETA al punto de avería; en_camino_base → ETA al taller.
app.get("/api/roadside-assistances/:id/live-position", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "ID no válido" });

    const r = await db.query(`SELECT * FROM roadside_assistances WHERE id = $1 LIMIT 1`, [id]);
    if (r.rows.length === 0) return res.status(404).json({ error: "Asistencia no encontrada" });
    const a = normalizeRoadsideAssistanceRow(r.rows[0]);

    if (!a.webfleetVehicleId) {
      return res.json({ available: false, reason: "sin_furgoneta" });
    }

    const enCaminoBase = a.status === "en_camino_base";
    let destino: { lat: number; lng: number } | null = null;
    if (enCaminoBase) {
      const wcfg = await getWorkshopConfig();
      const wlat = parseFloat(wcfg.taller_lat);
      const wlng = parseFloat(wcfg.taller_lng);
      if (Number.isFinite(wlat) && Number.isFinite(wlng)) destino = { lat: wlat, lng: wlng };
    } else if (a.latitude != null && a.longitude != null) {
      destino = { lat: a.latitude, lng: a.longitude };
    }

    const pos = await getWebfleetVehiclePosition(a.webfleetVehicleId);

    let etaMinutos: number | null = null;
    let etaKm: string | null = null;
    if (destino) {
      try {
        const eta = await calcularETA({ lat: pos.lat, lng: pos.lng }, destino);
        etaMinutos = eta.minutos;
        etaKm = eta.kilometros;
      } catch { /* sin ruta */ }
    }

    return res.json({
      available: true,
      lat: pos.lat,
      lng: pos.lng,
      speedKmh: pos.speedKmh,
      moving: pos.moving,
      etaMinutos,
      etaKm,
      destino: enCaminoBase ? "taller" : "punto",
      updatedAtMs: Date.now(),
    });
  } catch (error: any) {
    console.error("GET /api/roadside-assistances/:id/live-position error:", error);
    return res.status(500).json({ error: error?.message || "Error obteniendo posición" });
  }
});

// Redirigir una asistencia en camino al taller a una nueva sin pasar por el taller.
// Cierra la actual como "redirigida" guardando la posición GPS del momento.
app.post("/api/roadside-assistances/:id/redirect", requireSupervisorRole, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "ID no válido" });

    const r = await db.query(`SELECT * FROM roadside_assistances WHERE id = $1 LIMIT 1`, [id]);
    if (r.rows.length === 0) return res.status(404).json({ error: "Asistencia no encontrada" });
    const a = normalizeRoadsideAssistanceRow(r.rows[0]);

    if (a.status !== "en_camino_base") {
      return res.status(409).json({ error: "Solo se puede redirigir una asistencia 'En camino a taller'" });
    }

    // Posición actual: Webfleet → fallback a última conocida (operatorLat/Lng)
    let redirectLat: number | null = null;
    let redirectLng: number | null = null;
    if (a.webfleetVehicleId) {
      try {
        const pos = await getWebfleetVehiclePosition(a.webfleetVehicleId);
        redirectLat = pos.lat;
        redirectLng = pos.lng;
      } catch { /* fallback abajo */ }
    }
    if (redirectLat == null || redirectLng == null) {
      redirectLat = a.operatorLat ?? null;
      redirectLng = a.operatorLng ?? null;
    }

    const now = Date.now();
    await db.query(
      `UPDATE roadside_assistances
       SET status = 'redirigida',
           "redirectionLat" = $2,
           "redirectionLng" = $3,
           "redirectedAtMs" = $4,
           "updatedAtMs" = $4
       WHERE id = $1`,
      [id, redirectLat, redirectLng, now]
    );

    await db.query(
      `INSERT INTO roadside_assistance_events ("assistanceId", status, note, "createdBy", "createdAtMs")
       VALUES ($1, 'redirigida', 'Redirigida a nueva asistencia sin pasar por el taller', 'oficina', $2)`,
      [id, now]
    );

    // Liberar la furgoneta/operario de la asistencia cerrada
    if (a.assignedTechName) {
      await freeTechFromRoadside(a.assignedTechName, id);
    }

    return res.json({
      ok: true,
      // Datos para pre-rellenar la nueva asistencia (solo operario + furgoneta)
      prefill: {
        assignedTechName: a.assignedTechName ?? "",
        assignedVehicleName: a.assignedVehicleName ?? "",
        webfleetVehicleId: a.webfleetVehicleId ?? "",
      },
      redirectionLat: redirectLat,
      redirectionLng: redirectLng,
    });
  } catch (error: any) {
    console.error("POST /api/roadside-assistances/:id/redirect error:", error);
    return res.status(500).json({ error: error?.message || "Error redirigiendo asistencia" });
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

    const result = await db.query(
      `
        INSERT INTO roadside_assistances (
          "workshopId",
          status,
          priority,
          "customerName",
          "customerPhone",
          "conductorNombre",
          address,
          "googleMapsUrl",
          latitude,
          longitude,
          plate,
          "plateRemolque",
          "esRemolque",
          "descripcionAveria",
          "trabajosARealizar",
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
          $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29
        )
        RETURNING *
      `,
      [
        body.workshopId ?? null,
        incomingStatus,
        normalizeRoadsideAssistancePriority(body.priority),
        customerName,
        customerPhone,
        body.conductorNombre ? String(body.conductorNombre).trim() : null,
        address,
        googleMapsUrl || null,
        latitude,
        longitude,
        String(body.plate || "").trim().toUpperCase(),
        body.plateRemolque ? String(body.plateRemolque).trim().toUpperCase() : null,
        body.esRemolque === true,
        body.descripcionAveria ? String(body.descripcionAveria).trim() : null,
        body.trabajosARealizar ? String(body.trabajosARealizar).trim() : null,
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

    // Si en la creación se rellenó el Back Office, copiarlo a la nueva asistencia
    if (backofficeHasData(body.backoffice)) {
      try {
        await upsertBackoffice(assistance.id, body.backoffice);
      } catch (e) {
        console.error("Error guardando backoffice en creación:", e);
      }
    }

    // Enlace de redirección: si viene de otra asistencia, vincular ambas
    const redirectedFromId = Number(body.redirectedFromId);
    if (Number.isFinite(redirectedFromId) && redirectedFromId > 0) {
      await db.query(
        `UPDATE roadside_assistances SET "redirectedFromId" = $2 WHERE id = $1`,
        [assistance.id, redirectedFromId]
      );
      await db.query(
        `UPDATE roadside_assistances SET "redirectedToId" = $2 WHERE id = $1`,
        [redirectedFromId, assistance.id]
      );
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
          "plateRemolque" = $18,
          "descripcionAveria" = $19,
          "trabajosARealizar" = $20,
          "esRemolque" = $21,
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
        body.plateRemolque ? String(body.plateRemolque).trim().toUpperCase() : null,
        body.descripcionAveria ? String(body.descripcionAveria).trim() : null,
        body.trabajosARealizar ? String(body.trabajosARealizar).trim() : null,
        body.esRemolque === true,
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

async function detectPlateFromImage(
  imageUrl: string,
  options: { preferColor?: "white" | "red" } = {}
): Promise<string | null> {
  const preferColor = options.preferColor ?? "white";
  try {
    const colorInstruction =
      preferColor === "red"
        ? "En España, la matrícula ROJA es la del REMOLQUE. " +
          "Si en la imagen aparecen varias matrículas (blanca y roja), devuelve SOLO la matrícula ROJA (la del remolque). "
        : "En España, la matrícula BLANCA es la del CAMIÓN/vehículo tractor y la matrícula ROJA es la del REMOLQUE. " +
          "Si en la imagen aparecen varias matrículas (blanca y roja), devuelve SOLO la matrícula BLANCA (la del camión), ignorando la roja. ";

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
                colorInstruction +
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

// Detecta a la vez la matrícula BLANCA (camión) y la ROJA (remolque) de una sola foto.
// Devuelve { white, red } con cada matrícula normalizada o null si no se lee.
async function detectBothPlatesFromImage(
  imageUrl: string
): Promise<{ white: string | null; red: string | null }> {
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
                "Foto de matrículas de vehículos españoles. En España la matrícula BLANCA es del CAMIÓN " +
                "y la matrícula ROJA es del REMOLQUE. " +
                "La matrícula del REMOLQUE (roja) tiene el formato: una 'R' seguida de 4 dígitos y 3 letras (ej. R0000BBB, R1234BCD). " +
                "Identifica las matrículas que aparezcan y responde EXCLUSIVAMENTE en JSON con este formato: " +
                '{"blanca":"XXXX","roja":"RYYYYZZZ"}. ' +
                "La 'roja' debe empezar por R y seguir el formato R+4 dígitos+3 letras. " +
                "Usa null en el campo si esa matrícula no aparece o no es legible. Sin espacios ni guiones.",
            },
            { type: "image_url", image_url: { url: imageUrl } },
          ] as any,
        },
      ],
      max_tokens: 60,
      response_format: { type: "json_object" } as any,
    });

    const raw = response.choices[0]?.message?.content?.trim() ?? "{}";
    let parsed: any = {};
    try { parsed = JSON.parse(raw); } catch { parsed = {}; }

    const normOrNull = (v: unknown) => {
      const p = normalizePlateText(v);
      return p && p !== "NONE" && p.length >= 5 ? p : null;
    };
    return { white: normOrNull(parsed.blanca), red: normOrNull(parsed.roja) };
  } catch (error) {
    console.error("detectBothPlatesFromImage error:", error);
    return { white: null, red: null };
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

      // Reenvío offline ya procesado → no duplicar el archivo
      if (req.body?.clientActionId && (await isDuplicateAction(req.body.clientActionId))) {
        return res.json({ ok: true, deduped: true });
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
      let detectedRemolquePlate: string | null = null;
      if (kind === "matricula_camion") {
        // Detecta blanca (camión) y roja (remolque) a la vez
        const both = await detectBothPlatesFromImage(publicData.publicUrl);
        detectedPlate = both.white;
        detectedRemolquePlate = both.red;
      } else if (kind === "matricula_remolque") {
        detectedPlate = await detectPlateFromImage(publicData.publicUrl, { preferColor: "red" });
      }

      const result = await db.query(
        `INSERT INTO roadside_assistance_files ("assistanceId", kind, url, "fileName", "createdAtMs", "detectedPlate")
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [id, kind, publicData.publicUrl, req.file.originalname, Date.now(), detectedPlate]
      );

      // Si en la foto del camión también sale matrícula roja → asignar al remolque
      // automáticamente (registro matricula_remolque apuntando a la misma foto)
      if (kind === "matricula_camion" && detectedRemolquePlate) {
        await db.query(
          `INSERT INTO roadside_assistance_files ("assistanceId", kind, url, "fileName", "createdAtMs", "detectedPlate")
           VALUES ($1, 'matricula_remolque', $2, $3, $4, $5)`,
          [id, publicData.publicUrl, req.file.originalname, Date.now() + 1, detectedRemolquePlate]
        );
      }

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
        detectedRemolquePlate: detectedRemolquePlate ?? null,
      });
    } catch (error: any) {
      console.error("POST /api/roadside-assistances/:id/files error:", error);
      res.status(500).json({ error: "Error subiendo archivo" });
    }
  }
);

// Guardar archivo multimedia de WhatsApp desde URL a Supabase
app.post(
  "/api/roadside-assistances/:id/files-from-url",
  requireAdminRole,
  async (req, res) => {
    try {
      const id = Number(req.params.id);
      const mediaUrl: string = String(req.body?.url ?? "").trim();
      const kind: string = String(req.body?.kind ?? "whatsapp").trim();
      const filename: string = String(req.body?.filename ?? "archivo").trim();

      if (!Number.isFinite(id)) return res.status(400).json({ error: "ID no válido" });
      if (!mediaUrl) return res.status(400).json({ error: "URL requerida" });

      // Descargar el archivo desde la URL
      const fetchRes = await fetch(mediaUrl);
      if (!fetchRes.ok) throw new Error(`No se pudo descargar el archivo: ${fetchRes.status}`);

      const contentType = fetchRes.headers.get("content-type") ?? "application/octet-stream";
      const buffer = Buffer.from(await fetchRes.arrayBuffer());

      const extMap: Record<string, string> = {
        "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp",
        "image/gif": "gif", "video/mp4": "mp4", "video/quicktime": "mov",
        "video/webm": "webm", "audio/ogg": "ogg", "audio/mpeg": "mp3",
        "audio/mp4": "m4a", "application/pdf": "pdf",
      };
      const ext = extMap[contentType.split(";")[0].trim()] ?? "bin";
      const storagePath = `roadside/${id}/${kind}_${Date.now()}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from(SUPABASE_ROADSIDE_BUCKET)
        .upload(storagePath, buffer, { contentType, upsert: false });

      if (uploadError) throw new Error(uploadError.message);

      const { data: publicData } = supabase.storage
        .from(SUPABASE_ROADSIDE_BUCKET)
        .getPublicUrl(storagePath);

      const result = await db.query(
        `INSERT INTO roadside_assistance_files ("assistanceId", kind, url, "fileName", "createdAtMs")
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [id, kind, publicData.publicUrl, filename, Date.now()]
      );

      res.json({ file: result.rows[0] });
    } catch (error: any) {
      console.error("POST /api/roadside-assistances/:id/files-from-url error:", error);
      res.status(500).json({ error: error?.message ?? "Error guardando archivo" });
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

  // Absolute pixel of the point on the 3×3 canvas (768×768)
  const pointX = 256 + px; // center tile starts at x=256
  const pointY = 256 + py;

  // Marker centered on the point
  compositeInputs.push({
    input: markerSvg,
    left: pointX - m,
    top: pointY - m,
  });

  // Crop 480×260 centered on the point, clamped to canvas bounds
  const outW = 480;
  const outH = 260;
  const cropLeft = Math.max(0, Math.min(768 - outW, pointX - Math.round(outW / 2)));
  const cropTop  = Math.max(0, Math.min(768 - outH, pointY - Math.round(outH / 2)));

  return sharp({
    create: { width: 768, height: 768, channels: 4, background: { r: 200, g: 200, b: 200, alpha: 1 } },
  })
    .composite(compositeInputs)
    .extract({ left: cropLeft, top: cropTop, width: outW, height: outH })
    .png()
    .toBuffer();
}

// Builds a map showing the assistance point (red pin) and the van departure
// point (blue van) on the SAME image, with a line connecting them. Auto-zoom to fit both.
async function buildRouteMapImage(
  point: { lat: number; lng: number },
  departure: { lat: number; lng: number }
): Promise<Buffer | null> {
  const outW = 480;
  const outH = 300;
  const pad = 70; // margen para que los pines no queden pegados al borde

  const lngToWorldX = (lng: number, z: number) => (lng + 180) / 360 * 256 * Math.pow(2, z);
  const latToWorldY = (lat: number, z: number) => {
    const r = lat * Math.PI / 180;
    return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 256 * Math.pow(2, z);
  };

  // Elegir el zoom máximo (<=16) que contenga ambos puntos dentro del recuadro
  let zoom = 16;
  for (let z = 16; z >= 3; z--) {
    const dx = Math.abs(lngToWorldX(point.lng, z) - lngToWorldX(departure.lng, z));
    const dy = Math.abs(latToWorldY(point.lat, z) - latToWorldY(departure.lat, z));
    if (dx <= outW - pad && dy <= outH - pad) { zoom = z; break; }
    zoom = z;
  }

  const p1x = lngToWorldX(point.lng, zoom);
  const p1y = latToWorldY(point.lat, zoom);
  const p2x = lngToWorldX(departure.lng, zoom);
  const p2y = latToWorldY(departure.lat, zoom);

  const centerX = (p1x + p2x) / 2;
  const centerY = (p1y + p2y) / 2;

  // Origen del lienzo de salida (esquina sup-izq) en píxeles de mundo
  const originX = centerX - outW / 2;
  const originY = centerY - outH / 2;

  // Tiles que cubren el recuadro de salida
  const tileMinX = Math.floor(originX / 256);
  const tileMaxX = Math.floor((originX + outW) / 256);
  const tileMinY = Math.floor(originY / 256);
  const tileMaxY = Math.floor((originY + outH) / 256);

  const tiles: { tx: number; ty: number; buf: Buffer | null }[] = await Promise.all(
    (() => {
      const jobs: Promise<{ tx: number; ty: number; buf: Buffer | null }>[] = [];
      for (let tx = tileMinX; tx <= tileMaxX; tx++) {
        for (let ty = tileMinY; ty <= tileMaxY; ty++) {
          jobs.push((async () => {
            try {
              const r = await fetch(
                `https://tile.openstreetmap.org/${zoom}/${tx}/${ty}.png`,
                { headers: { "User-Agent": "SEATarragona-Informe/1.0 (internal)" }, signal: AbortSignal.timeout(6000) }
              );
              return { tx, ty, buf: r.ok ? Buffer.from(await r.arrayBuffer()) : null };
            } catch {
              return { tx, ty, buf: null };
            }
          })());
        }
      }
      return jobs;
    })()
  );

  const compositeInputs: sharp.OverlayOptions[] = [];
  for (const { tx, ty, buf } of tiles) {
    if (buf) {
      compositeInputs.push({ input: buf, left: Math.round(tx * 256 - originX), top: Math.round(ty * 256 - originY) });
    }
  }

  const ax = Math.round(p1x - originX); // punto avería
  const ay = Math.round(p1y - originY);
  const bx = Math.round(p2x - originX); // salida furgoneta
  const by = Math.round(p2y - originY);

  // Línea + pin rojo (avería) + furgoneta azul (salida), todo en un SVG superpuesto
  const overlaySvg = Buffer.from(
    `<svg width="${outW}" height="${outH}" xmlns="http://www.w3.org/2000/svg">` +
    `<line x1="${bx}" y1="${by}" x2="${ax}" y2="${ay}" stroke="#1e3a8a" stroke-width="3" stroke-dasharray="7,5" opacity="0.85"/>` +
    // Furgoneta (salida) — cuadro azul
    `<rect x="${bx-11}" y="${by-9}" width="22" height="18" rx="3" fill="#2563eb" stroke="white" stroke-width="2"/>` +
    `<rect x="${bx-6}" y="${by-5}" width="9" height="6" fill="white" opacity="0.9"/>` +
    // Pin rojo (avería)
    `<circle cx="${ax}" cy="${ay}" r="9" fill="red" stroke="white" stroke-width="2.5"/>` +
    `</svg>`
  );
  compositeInputs.push({ input: overlaySvg, left: 0, top: 0 });

  try {
    return await sharp({
      create: { width: outW, height: outH, channels: 4, background: { r: 220, g: 220, b: 220, alpha: 1 } },
    })
      .composite(compositeInputs)
      .png()
      .toBuffer();
  } catch {
    return null;
  }
}

// Mapa estilo Webfleet: recorrido (polyline) + paradas numeradas. Auto-zoom a todos los puntos.
async function buildTrackMapImage(
  track: { lat: number; lng: number }[],
  stops: { lat: number; lng: number; n: number }[]
): Promise<Buffer | null> {
  const all = [...track, ...stops];
  if (all.length === 0) return null;

  const outW = 480;
  const outH = 380;
  const pad = 50;

  const lngToWorldX = (lng: number, z: number) => (lng + 180) / 360 * 256 * Math.pow(2, z);
  const latToWorldY = (lat: number, z: number) => {
    const r = lat * Math.PI / 180;
    return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 256 * Math.pow(2, z);
  };

  const minLat = Math.min(...all.map((p) => p.lat));
  const maxLat = Math.max(...all.map((p) => p.lat));
  const minLng = Math.min(...all.map((p) => p.lng));
  const maxLng = Math.max(...all.map((p) => p.lng));

  let zoom = 16;
  for (let z = 16; z >= 3; z--) {
    const dx = Math.abs(lngToWorldX(maxLng, z) - lngToWorldX(minLng, z));
    const dy = Math.abs(latToWorldY(minLat, z) - latToWorldY(maxLat, z));
    if (dx <= outW - pad && dy <= outH - pad) { zoom = z; break; }
    zoom = z;
  }

  const centerX = (lngToWorldX(minLng, zoom) + lngToWorldX(maxLng, zoom)) / 2;
  const centerY = (latToWorldY(minLat, zoom) + latToWorldY(maxLat, zoom)) / 2;
  const originX = centerX - outW / 2;
  const originY = centerY - outH / 2;

  const tileMinX = Math.floor(originX / 256);
  const tileMaxX = Math.floor((originX + outW) / 256);
  const tileMinY = Math.floor(originY / 256);
  const tileMaxY = Math.floor((originY + outH) / 256);

  const jobs: Promise<{ tx: number; ty: number; buf: Buffer | null }>[] = [];
  for (let tx = tileMinX; tx <= tileMaxX; tx++) {
    for (let ty = tileMinY; ty <= tileMaxY; ty++) {
      jobs.push((async () => {
        try {
          const r = await fetch(`https://tile.openstreetmap.org/${zoom}/${tx}/${ty}.png`,
            { headers: { "User-Agent": "SEATarragona-Informe/1.0 (internal)" }, signal: AbortSignal.timeout(6000) });
          return { tx, ty, buf: r.ok ? Buffer.from(await r.arrayBuffer()) : null };
        } catch { return { tx, ty, buf: null }; }
      })());
    }
  }
  const tiles = await Promise.all(jobs);

  const composite: sharp.OverlayOptions[] = [];
  for (const { tx, ty, buf } of tiles) {
    if (buf) composite.push({ input: buf, left: Math.round(tx * 256 - originX), top: Math.round(ty * 256 - originY) });
  }

  const toPx = (p: { lat: number; lng: number }) => ({
    x: Math.round(lngToWorldX(p.lng, zoom) - originX),
    y: Math.round(latToWorldY(p.lat, zoom) - originY),
  });

  const linePts = track.map(toPx).map((p) => `${p.x},${p.y}`).join(" ");
  const stopCircles = stops.map((s) => {
    const p = toPx(s);
    return `<circle cx="${p.x}" cy="${p.y}" r="11" fill="#1e3a8a" stroke="white" stroke-width="2"/>` +
      `<text x="${p.x}" y="${p.y + 4}" font-size="12" font-weight="bold" fill="white" text-anchor="middle" font-family="Arial">${s.n}</text>`;
  }).join("");

  const overlay = Buffer.from(
    `<svg width="${outW}" height="${outH}" xmlns="http://www.w3.org/2000/svg">` +
    (linePts ? `<polyline points="${linePts}" fill="none" stroke="#2563eb" stroke-width="4" stroke-linejoin="round" stroke-linecap="round" opacity="0.85"/>` : "") +
    stopCircles +
    `</svg>`
  );
  composite.push({ input: overlay, left: 0, top: 0 });

  try {
    return await sharp({ create: { width: outW, height: outH, channels: 4, background: { r: 220, g: 220, b: 220, alpha: 1 } } })
      .composite(composite).png().toBuffer();
  } catch { return null; }
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
    timeZone: "Europe/Madrid",
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
        .text("Mobilink – Informe de Asistencia", { align: "center" });

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
      // Asistencia al remolque (check del formulario, o sin matrícula de camión):
      // la matrícula del remolque es la principal y la tractora sale como dato adicional
      if ((a.esRemolque || !a.plate) && a.plateRemolque) {
        row("Matrícula remolque:", a.plateRemolque);
        if (a.plate) row("Matrícula tractora:", a.plate);
      } else {
        row("Matrícula camión:", a.plate || "-");
        if (a.plateRemolque) row("Matrícula remolque:", a.plateRemolque);
      }
      row("Vehículo:", a.vehicleDescription || "-");
      row("Prioridad:", a.priority === "urgente" ? "URGENTE" : "Normal");
      if (a.notes) row("Notas:", a.notes);

      // Mapa estático: punto de avería (rojo) + salida furgoneta (azul) en la misma imagen
      let workshopCoords: { lat: number; lng: number } | null = null;
      try {
        const wcfg = await getWorkshopConfig();
        const wlat = parseFloat(wcfg.taller_lat);
        const wlng = parseFloat(wcfg.taller_lng);
        if (Number.isFinite(wlat) && Number.isFinite(wlng)) workshopCoords = { lat: wlat, lng: wlng };
      } catch { /* sin config taller */ }

      if (a.latitude != null && a.longitude != null) {
        doc.moveDown(0.5);
        doc.fontSize(10).font("Helvetica-Bold").text("Localización de la avería:");
        doc.moveDown(0.3);
        try {
          const mapBuf = workshopCoords
            ? await buildRouteMapImage({ lat: a.latitude, lng: a.longitude }, workshopCoords)
            : await buildMapImage(a.latitude, a.longitude);
          if (mapBuf) {
            doc.image(mapBuf, { fit: [480, 300], align: "left" });
            doc.moveDown(0.2);
            // Leyenda
            doc.fontSize(8).font("Helvetica")
              .text(workshopCoords
                ? "● Punto de avería (rojo)   ■ Salida furgoneta / taller (azul)"
                : "● Punto de avería");
          } else {
            doc.fontSize(9).font("Helvetica").text(`Coordenadas: ${a.latitude}, ${a.longitude}`);
          }
        } catch {
          doc.fontSize(9).font("Helvetica").text(`Coordenadas: ${a.latitude}, ${a.longitude}`);
        }
        // Coordenadas GPS del punto de avería
        doc.fontSize(9).font("Helvetica-Bold").text("GPS punto de avería: ", { continued: true });
        doc.font("Helvetica").text(`${a.latitude.toFixed(6)}, ${a.longitude.toFixed(6)}`);
      }

      // Matrícula de la furgoneta asignada (desde roadside_vehicles)
      let vanPlate = "-";
      if (a.webfleetVehicleId) {
        try {
          const vp = await db.query(
            `SELECT plate FROM roadside_vehicles WHERE "webfleetVehicleId" = $1 LIMIT 1`,
            [a.webfleetVehicleId]
          );
          if (vp.rows[0]?.plate) vanPlate = vp.rows[0].plate;
        } catch { /* sin matrícula */ }
      }

      // Kilómetros recorridos (ida y vuelta: taller -> avería -> taller)
      let kmTotal = "-";
      if (workshopCoords && a.latitude != null && a.longitude != null) {
        try {
          const etaIda = await calcularETA(workshopCoords, { lat: a.latitude, lng: a.longitude });
          const ida = parseFloat(etaIda.kilometros);

          if (a.status === "redirigida" && a.redirectionLat != null && a.redirectionLng != null) {
            // Redirigida: ida (taller->avería) + vuelta teórica (punto de desvío -> taller)
            const etaVuelta = await calcularETA(
              { lat: a.redirectionLat, lng: a.redirectionLng },
              workshopCoords
            );
            const vuelta = parseFloat(etaVuelta.kilometros);
            if (Number.isFinite(ida) && Number.isFinite(vuelta)) {
              kmTotal = `${(ida + vuelta).toFixed(1)} km (ida + vuelta desde desvío)`;
            }
          } else if (Number.isFinite(ida)) {
            // Normal: ida y vuelta completas
            kmTotal = `${(ida * 2).toFixed(1)} km (ida y vuelta)`;
          }
        } catch { /* sin ruta */ }
      }

      doc.moveDown(1);
      doc.fontSize(13).font("Helvetica-Bold").text("Asignación");
      doc.moveDown(0.3);
      row("Operario:", a.assignedTechName || "-");
      row("Vehículo asignado:", a.assignedVehicleName || "-");
      row("Matrícula furgoneta:", vanPlate);
      row("Kilómetros recorridos:", kmTotal);
      if (a.redirectedToId) row("Redirigida a asistencia:", `#${a.redirectedToId}`);
      if (a.redirectedFromId) row("Procede de asistencia:", `#${a.redirectedFromId}`);

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
      // Transcripciones de audios recibidos por WhatsApp
      const audioRows = await db.query(
        `SELECT transcript, received_at FROM whatsapp_capture_messages
         WHERE job_id = $1 AND message_type = 'audio' AND transcript IS NOT NULL AND transcript <> ''
         ORDER BY received_at ASC`,
        [id]
      );
      if (audioRows.rows.length > 0) {
        doc.moveDown(1);
        doc.fontSize(13).font("Helvetica-Bold").text("Transcripción de audios (WhatsApp)");
        doc.moveDown(0.3);
        for (const a of audioRows.rows) {
          doc.fontSize(9).font("Helvetica-Bold")
            .text(`🎤 Transcripción de audio · ${formatDateEs(Number(a.received_at))}`);
          doc.fontSize(9).font("Helvetica").text(a.transcript, { indent: 10 });
          doc.moveDown(0.4);
        }
      }

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
          foto_or: "OR manual (técnico)",
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

      if (a.observacionesReparacion) {
        doc.moveDown(1);
        doc.fontSize(13).font("Helvetica-Bold").text("Trabajos realizados");
        doc.moveDown(0.3);
        doc.fontSize(11).font("Helvetica").text(a.observacionesReparacion, {
          lineGap: 4,
        });
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

// ── Informe de seguimiento de furgoneta (recorrido + paradas, estilo Webfleet) ──
async function buildVehicleTrackingPdfBuffer(
  objectno: string,
  fromMs: number,
  toMs: number,
  opts: { minStopSec?: number; plate?: string | null; titleExtra?: string } = {}
): Promise<Buffer> {
  const minStopSec = opts.minStopSec ?? 180;

  const [trips, track] = await Promise.all([
    getWebfleetTrips(objectno, fromMs, toMs),
    getWebfleetTracks(objectno, fromMs, toMs).catch(() => [] as { lat: number; lng: number }[]),
  ]);
  const stops = computeStops(trips, minStopSec);

  const totalKm = trips.reduce((s, t) => s + (t.distance || 0), 0) / 1000;
  const driveSec = trips.reduce((s, t) => s + (t.duration || 0), 0);
  const stoppedSec = stops.reduce((s, st) => s + st.durationSec, 0);
  const driver = trips.find((t) => t.drivername)?.drivername || "-";
  const firstStart = trips.length ? new Date(trips[0].start_time).getTime() : null;
  const lastEnd = trips.length ? new Date(trips[trips.length - 1].end_time).getTime() : null;

  const doc = new PDFDocument({ margin: 40, size: "A4" });
  const chunks: Buffer[] = [];
  doc.on("data", (c) => chunks.push(c));
  const finished = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));

  doc.fontSize(18).font("Helvetica-Bold").text("Mobilink – Seguimiento de furgoneta", { align: "center" });
  doc.moveDown(0.3);
  doc.fontSize(11).font("Helvetica").text(
    `${opts.plate || objectno}${opts.titleExtra ? ` · ${opts.titleExtra}` : ""}`,
    { align: "center" }
  );
  doc.fontSize(10).text(`${formatDateEs(fromMs)}  –  ${formatDateEs(toMs)}`, { align: "center" });
  doc.moveDown(1);

  function row(label: string, value: string) {
    doc.fontSize(10).font("Helvetica-Bold").text(label, { continued: true, width: 180 });
    doc.font("Helvetica").text(value);
  }

  doc.fontSize(13).font("Helvetica-Bold").text("Resumen");
  doc.moveDown(0.3);
  row("Conductor:", driver);
  row("Km recorridos:", `${totalKm.toFixed(1)} km`);
  row("Tiempo en marcha:", fmtDuration(driveSec));
  row("Tiempo parado total:", fmtDuration(stoppedSec));
  row("Nº de paradas:", String(stops.length));
  row("Primera salida:", firstStart ? formatDateEs(firstStart) : "-");
  row("Última llegada:", lastEnd ? formatDateEs(lastEnd) : "-");

  if (track.length > 0 || stops.length > 0) {
    doc.moveDown(0.8);
    doc.fontSize(13).font("Helvetica-Bold").text("Recorrido");
    doc.moveDown(0.3);
    try {
      const mapBuf = await buildTrackMapImage(track, stops);
      if (mapBuf) doc.image(mapBuf, { fit: [480, 380], align: "left" });
    } catch { /* sin mapa */ }
  }

  doc.moveDown(0.8);
  doc.fontSize(13).font("Helvetica-Bold").text("Paradas");
  doc.moveDown(0.3);
  if (stops.length === 0) {
    doc.fontSize(10).font("Helvetica").text("Sin paradas registradas en el periodo.");
  } else {
    for (const s of stops) {
      doc.fontSize(10).font("Helvetica-Bold").text(`${s.n}. ${s.place}`);
      doc.fontSize(9).font("Helvetica").text(
        `   Llegada: ${formatDateEs(s.arrival)}  ·  Salida: ${formatDateEs(s.departure)}  ·  Parado: ${fmtDuration(s.durationSec)}`
      );
      doc.moveDown(0.2);
    }
  }

  doc.moveDown(0.6);
  doc.fontSize(13).font("Helvetica-Bold").text("Trayectos");
  doc.moveDown(0.3);
  if (trips.length === 0) {
    doc.fontSize(10).font("Helvetica").text("Sin trayectos en el periodo.");
  } else {
    for (const t of trips) {
      doc.fontSize(9).font("Helvetica").text(
        `${formatDateEs(new Date(t.start_time).getTime())} → ${formatDateEs(new Date(t.end_time).getTime())}  ·  ` +
        `${((t.distance || 0) / 1000).toFixed(1)} km  ·  ${fmtDuration(t.duration || 0)}  ·  ` +
        `máx ${t.max_speed ?? "-"} km/h  ·  ${t.end_postext || ""}`
      );
    }
  }

  doc.end();
  return finished;
}

// Por furgoneta + rango de fechas
app.get("/api/webfleet/vehicle/:objectno/tracking-report.pdf", requireAdminRole, async (req, res) => {
  try {
    const objectno = String(req.params.objectno);
    const from = Number(req.query.from);
    const to = Number(req.query.to);
    const minStop = req.query.minStop ? Number(req.query.minStop) : 180;
    if (!Number.isFinite(from) || !Number.isFinite(to)) {
      return res.status(400).json({ error: "Parámetros from/to (ms) requeridos" });
    }
    const vp = await db.query(`SELECT plate FROM roadside_vehicles WHERE "webfleetVehicleId" = $1 LIMIT 1`, [objectno]);
    const buffer = await buildVehicleTrackingPdfBuffer(objectno, from, to, { minStopSec: minStop, plate: vp.rows[0]?.plate });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="seguimiento_${objectno}.pdf"`);
    res.send(buffer);
  } catch (error: any) {
    console.error("GET tracking-report.pdf (vehicle) error:", error);
    if (!res.headersSent) res.status(500).json({ error: error?.message || "Error generando informe" });
  }
});

// Por asistencia (recorrido durante la asistencia: salida → llegada al taller o ahora)
app.get("/api/roadside-assistances/:id/tracking-report.pdf", requireSupervisorRole, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "ID no válido" });
    const r = await db.query(`SELECT * FROM roadside_assistances WHERE id = $1 LIMIT 1`, [id]);
    if (r.rows.length === 0) return res.status(404).json({ error: "Asistencia no encontrada" });
    const a = normalizeRoadsideAssistanceRow(r.rows[0]);
    if (!a.webfleetVehicleId) return res.status(400).json({ error: "La asistencia no tiene furgoneta Webfleet asignada" });

    const fromMs = a.departedAtMs || a.assignedAtMs || a.createdAtMs;
    const toMs = a.arrivedAtWorkshopMs || a.finishedAtMs || Date.now();
    const buffer = await buildVehicleTrackingPdfBuffer(a.webfleetVehicleId, fromMs, toMs, {
      plate: a.assignedVehicleName || a.webfleetVehicleId,
      titleExtra: `Asistencia #${a.id}`,
    });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="seguimiento_asistencia_${id}.pdf"`);
    res.send(buffer);
  } catch (error: any) {
    console.error("GET tracking-report.pdf (asistencia) error:", error);
    if (!res.headersSent) res.status(500).json({ error: error?.message || "Error generando informe" });
  }
});

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
              body: `Hola ${assistance.customerName || "cliente"}, adjuntamos el informe de tu asistencia de Mobilink.`,
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
              subject: `Informe de asistencia Mobilink #${id}`,
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

// ¿Tiene el back office algún dato relevante? (para no crear filas vacías al crear asistencia)
function backofficeHasData(b: any): boolean {
  if (!b || typeof b !== "object") return false;
  for (const [k, v] of Object.entries(b)) {
    if (v == null) continue;
    if (Array.isArray(v)) { if (v.length > 0) return true; continue; }
    if (typeof v === "string") { if (v.trim() !== "") return true; continue; }
    if (typeof v === "boolean") { if (k !== "facturable" && v) return true; continue; }
    if (typeof v === "number") return true;
  }
  return false;
}

async function upsertBackoffice(id: number, b: any) {
  const now = Date.now();
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
        b.kilometraje != null && b.kilometraje !== "" ? Number(b.kilometraje) : null,
        b.medidaNeumatico ?? null, b.ejeAfectado ?? null, b.posicionRueda ?? null,
        b.vehiculoCargado ?? null, b.mercancia ?? null, b.adr ?? null,
        b.facturable ?? true, b.pendienteAutorizacion ?? false, b.garantia ?? false, b.interna ?? false,
        b.importeAcordado != null && b.importeAcordado !== "" ? Number(b.importeAcordado) : null,
        b.observacionesFacturacion ?? null,
        now, now,
      ]
    );
    return result.rows[0];
  }
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
      b.kilometraje != null && b.kilometraje !== "" ? Number(b.kilometraje) : null,
      b.medidaNeumatico ?? null, b.ejeAfectado ?? null, b.posicionRueda ?? null,
      b.vehiculoCargado ?? null, b.mercancia ?? null, b.adr ?? null,
      b.facturable ?? true, b.pendienteAutorizacion ?? false, b.garantia ?? false, b.interna ?? false,
      b.importeAcordado != null && b.importeAcordado !== "" ? Number(b.importeAcordado) : null,
      b.observacionesFacturacion ?? null,
      now,
    ]
  );
  return result.rows[0];
}

app.put(
  "/api/roadside-assistances/:id/backoffice",
  requireSupervisorRole,
  async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!id) return res.status(400).json({ error: "ID inválido" });
      const saved = await upsertBackoffice(id, req.body);
      return res.json(saved);
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

// ── Usuarios de aplicación (gestión de accesos por pantalla) ──────────────────
type DbAppUser = {
  id: string;
  name: string;
  password: string;
  role: UserRole;
  allowedViews: string[];
};

async function ensureAppUsersTable() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS app_users (
      id TEXT PRIMARY KEY,
      data JSONB NOT NULL,
      "updatedAtMs" BIGINT NOT NULL
    )
  `);
}

function normalizeDbAppUser(data: any): DbAppUser | null {
  if (!data || typeof data !== "object") return null;
  const id = String(data.id || "").trim();
  const name = String(data.name || "").trim();
  if (!id || !name) return null;
  const role: UserRole = ["admin", "supervisor", "pantallas", "tv75"].includes(data.role)
    ? data.role
    : "supervisor";
  return {
    id,
    name,
    password: String(data.password || ""),
    role,
    allowedViews: Array.isArray(data.allowedViews) ? data.allowedViews.map(String) : [],
  };
}

async function listDbAppUsers(): Promise<DbAppUser[]> {
  await ensureAppUsersTable();
  const r = await db.query(`SELECT data FROM app_users ORDER BY data->>'name'`);
  return r.rows.map((row: any) => normalizeDbAppUser(row.data)).filter(Boolean) as DbAppUser[];
}

async function findDbUserByPassword(password: string | undefined): Promise<DbAppUser | null> {
  if (!password) return null;
  const users = await listDbAppUsers();
  return users.find((u) => u.password && u.password === password) ?? null;
}

async function getRoleFromRequestAsync(req: express.Request): Promise<UserRole | null> {
  const sync = getRoleFromRequest(req);
  if (sync) return sync;
  const rawToken = String(req.headers["x-admin-token"] ?? req.query?.token ?? "");
  let token = rawToken;
  try { token = decodeURIComponent(rawToken); } catch { token = rawToken; }
  if (token) {
    try {
      const u = await findDbUserByPassword(token);
      if (u) return u.role;
    } catch (e) {
      console.error("getRoleFromRequestAsync error:", e);
    }
  }
  return null;
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

app.post("/api/login", async (req, res) => {
  try {
    const { password, name } = req.body ?? {};

    // 1) Usuarios creados en BD (con pantallas personalizadas)
    try {
      let dbUser: DbAppUser | null = null;
      const wantName = String(name || "").trim();
      if (wantName) {
        const users = await listDbAppUsers();
        dbUser = users.find(
          (u) => u.name.toLowerCase() === wantName.toLowerCase() && u.password && u.password === password
        ) ?? null;
      } else {
        dbUser = await findDbUserByPassword(password);
      }
      if (dbUser) {
        return res.json({
          ok: true,
          role: dbUser.role,
          name: dbUser.name,
          allowedViews: dbUser.allowedViews,
        });
      }
    } catch (e) {
      console.error("login db users error:", e);
    }

    // 2) Usuarios fijos por variable de entorno
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

// Puente SSO: entra al panel de taller con la sesión unificada (Supabase).
// Empareja el usuario unificado con un usuario del panel por nombre
// (username o nombre completo). Los superadmin entran como admin.
app.post("/api/login-sso", async (req, res) => {
  try {
    const auth = String(req.headers.authorization || "");
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!token) return res.status(401).json({ error: "Falta el token de sesión" });

    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user) return res.status(401).json({ error: "Sesión no válida" });

    const r = await db.query(
      `SELECT a.username, a.nombre, a.activo, a.es_superadmin,
              coalesce((SELECT rol = 'admin' FROM adm_usuarios WHERE id = $1 AND activo), false) AS adm_admin
       FROM app_usuarios a WHERE a.id = $1`,
      [data.user.id]
    );
    const u = r.rows[0];
    if (!u || !u.activo) return res.status(403).json({ error: "Usuario no activo en la aplicación" });

    // 1) Usuario del panel con el mismo nombre (username o nombre completo)
    try {
      const users = await listDbAppUsers();
      const objetivo = [String(u.username).toLowerCase(), String(u.nombre).toLowerCase()];
      const panelUser = users.find((p) => objetivo.includes(p.name.toLowerCase()));
      if (panelUser) {
        return res.json({
          ok: true,
          role: panelUser.role,
          name: panelUser.name,
          allowedViews: panelUser.allowedViews,
          adminToken: panelUser.password ?? "",
        });
      }
    } catch (e) {
      console.error("login-sso db users error:", e);
    }

    // 2) Superadmin / admin de administración → admin del panel
    if ((u.es_superadmin || u.adm_admin) && process.env.ADMIN_PASSWORD) {
      return res.json({
        ok: true,
        role: "admin",
        name: u.nombre,
        allowedViews: null,
        adminToken: process.env.ADMIN_PASSWORD,
      });
    }

    return res.status(404).json({ error: "Tu usuario no tiene acceso al panel de taller" });
  } catch (error) {
    console.error("POST /api/login-sso error:", error);
    res.status(500).json({ error: "Error iniciando sesión" });
  }
});

/* =========================================================
   USUARIOS (gestión de accesos)
========================================================= */

app.get("/api/users", requireAdminRole, async (_req, res) => {
  try {
    const users = await listDbAppUsers();
    res.json(users.map(({ password, ...rest }) => ({ ...rest, hasPassword: Boolean(password) })));
  } catch (error) {
    console.error("GET /api/users error:", error);
    res.status(500).json({ error: "Error cargando usuarios" });
  }
});

app.post("/api/users", requireAdminRole, async (req, res) => {
  try {
    const { name, password, role, allowedViews } = req.body ?? {};
    if (!name || !password) {
      return res.status(400).json({ error: "Nombre y contraseña obligatorios" });
    }
    await ensureAppUsersTable();
    const id = `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const user = normalizeDbAppUser({ id, name, password, role, allowedViews });
    await db.query(
      `INSERT INTO app_users (id, data, "updatedAtMs") VALUES ($1, $2, $3)`,
      [id, JSON.stringify(user), Date.now()]
    );
    res.json({ ok: true, id });
  } catch (error) {
    console.error("POST /api/users error:", error);
    res.status(500).json({ error: "Error creando usuario" });
  }
});

app.put("/api/users/:id", requireAdminRole, async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    await ensureAppUsersTable();
    const existing = await db.query(`SELECT data FROM app_users WHERE id = $1`, [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: "Usuario no encontrado" });
    }
    const cur = normalizeDbAppUser(existing.rows[0].data)!;
    const { name, password, role, allowedViews } = req.body ?? {};
    const next = normalizeDbAppUser({
      id,
      name: name ?? cur.name,
      password: password ? password : cur.password,
      role: role ?? cur.role,
      allowedViews: Array.isArray(allowedViews) ? allowedViews : cur.allowedViews,
    });
    await db.query(
      `UPDATE app_users SET data = $2, "updatedAtMs" = $3 WHERE id = $1`,
      [id, JSON.stringify(next), Date.now()]
    );
    res.json({ ok: true });
  } catch (error) {
    console.error("PUT /api/users/:id error:", error);
    res.status(500).json({ error: "Error actualizando usuario" });
  }
});

app.delete("/api/users/:id", requireAdminRole, async (req, res) => {
  try {
    await ensureAppUsersTable();
    await db.query(`DELETE FROM app_users WHERE id = $1`, [String(req.params.id || "").trim()]);
    res.json({ ok: true });
  } catch (error) {
    console.error("DELETE /api/users/:id error:", error);
    res.status(500).json({ error: "Error eliminando usuario" });
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
   GEOFENCING WEBFLEET — llegada al taller via posición Webfleet
========================================================= */

async function checkWebfleetWorkshopArrival() {
  try {
    // Busca asistencias en_camino_base con furgoneta Webfleet asignada
    const result = await db.query(`
      SELECT ra.id, ra."webfleetVehicleId"
      FROM roadside_assistances ra
      WHERE ra.status = 'en_camino_base'
        AND ra."arrivedAtWorkshopMs" IS NULL
        AND ra."webfleetVehicleId" IS NOT NULL
    `);
    if (result.rows.length === 0) return;

    const cfg = await getWorkshopConfig();
    const tallerLat = parseFloat(cfg.taller_lat);
    const tallerLng = parseFloat(cfg.taller_lng);
    const radioM = parseFloat(cfg.taller_radio_m) || 300;
    if (!isFinite(tallerLat) || !isFinite(tallerLng)) return;

    for (const row of result.rows) {
      try {
        const pos = await getWebfleetVehiclePosition(row.webfleetVehicleId);
        const distM = haversineDistanceM(pos.lat, pos.lng, tallerLat, tallerLng);
        console.log(`Webfleet geofence check #${row.id} (${row.webfleetVehicleId}): ${Math.round(distM)}m al taller`);

        // Actualizar posición del operario para que el mapa del panel esté en vivo
        await db.query(
          `UPDATE roadside_assistances
           SET "operatorLat" = $2, "operatorLng" = $3, "operatorLocationAtMs" = $4
           WHERE id = $1 AND status = 'en_camino_base'`,
          [row.id, pos.lat, pos.lng, Date.now()]
        );

        if (distM <= radioM) {
          const now = Date.now();
          const upd = await db.query(
            `UPDATE roadside_assistances
             SET status = 'llegada_taller', "arrivedAtWorkshopMs" = $2
             WHERE id = $1 AND status = 'en_camino_base' AND "arrivedAtWorkshopMs" IS NULL
             RETURNING "assignedTechName"`,
            [row.id, now]
          );
          await db.query(
            `INSERT INTO roadside_assistance_events ("assistanceId", status, note, "createdBy", "createdAtMs")
             VALUES ($1, 'llegada_taller', 'Llegada al taller detectada por Webfleet GPS', 'sistema', $2)`,
            [row.id, now]
          );
          // Liberar al técnico al cerrar la asistencia
          if (upd.rows[0]?.assignedTechName) {
            await freeTechFromRoadside(upd.rows[0].assignedTechName, row.id);
          }
          console.log(`✓ Asistencia #${row.id} → llegada_taller (Webfleet geofence)`);
        }
      } catch (err) {
        console.warn(`Webfleet geofence error para asistencia #${row.id}:`, err);
      }
    }
  } catch (err) {
    console.error("checkWebfleetWorkshopArrival error:", err);
  }
}

// Libera técnicos cuya asistencia de carretera ya está cerrada o no existe (autocuración)
async function reconcileTechRoadsideOccupation() {
  try {
    const r = await db.query(
      `UPDATE techs t
       SET status = 'disponible', "currentRoadsideAssistanceId" = NULL
       WHERE t."currentRoadsideAssistanceId" IS NOT NULL
         AND (
           NOT EXISTS (SELECT 1 FROM roadside_assistances r WHERE r.id = t."currentRoadsideAssistanceId")
           OR EXISTS (SELECT 1 FROM roadside_assistances r
                      WHERE r.id = t."currentRoadsideAssistanceId"
                        AND r.status IN ('llegada_taller','redirigida','cancelada'))
         )
       RETURNING name`
    );
    if (r.rows.length > 0) {
      console.log(`Técnicos liberados (asistencia cerrada): ${r.rows.map((x: any) => x.name).join(", ")}`);
    }

    // Cerrar capturas WhatsApp huérfanas (asistencia cerrada o inexistente)
    const cs = await db.query(
      `UPDATE whatsapp_capture_sessions s
       SET status = 'CLOSED', ended_at = $1
       WHERE s.status = 'ACTIVE'
         AND (
           NOT EXISTS (SELECT 1 FROM roadside_assistances r WHERE r.id = s.job_id)
           OR EXISTS (SELECT 1 FROM roadside_assistances r
                      WHERE r.id = s.job_id
                        AND r.status IN ('llegada_taller','redirigida','cancelada'))
         )
       RETURNING s.id`,
      [Date.now()]
    );
    if (cs.rows.length > 0) {
      console.log(`Capturas WhatsApp cerradas (asistencia cerrada): ${cs.rows.map((x: any) => x.id).join(", ")}`);
    }
  } catch (err) {
    console.error("reconcileTechRoadsideOccupation error:", err);
  }
}

// Check-in automático: la furgoneta entra en la geozona de la base de una OTF
async function checkOtfBaseArrival() {
  try {
    const r = await db.query(`
      SELECT id, "webfleetVehicleId", lat, lng FROM otf
      WHERE status = 'planificada' AND "arrivedAtBaseMs" IS NULL
        AND "webfleetVehicleId" IS NOT NULL AND lat IS NOT NULL AND lng IS NOT NULL
    `);
    for (const o of r.rows) {
      try {
        const pos = await getWebfleetVehiclePosition(o.webfleetVehicleId);
        const dist = haversineDistanceM(pos.lat, pos.lng, Number(o.lat), Number(o.lng));
        if (dist <= KNOWN_PLACE_RADIUS_M) {
          await db.query(
            `UPDATE otf SET status = 'en_curso', "arrivedAtBaseMs" = $2, "updatedAtMs" = $2
             WHERE id = $1 AND status = 'planificada' AND "arrivedAtBaseMs" IS NULL`,
            [o.id, Date.now()]
          );
          console.log(`✓ OTF #${o.id} → en_curso (check-in automático en base, ${Math.round(dist)}m)`);
        }
      } catch (err) {
        console.warn(`OTF check-in error #${o.id}:`, err);
      }
    }
  } catch (e) {
    console.error("checkOtfBaseArrival error:", e);
  }
}

// Comprobar cada 2 minutos
setInterval(() => {
  void checkWebfleetWorkshopArrival();
  void reconcileTechRoadsideOccupation();
  void checkOtfBaseArrival();
}, 2 * 60 * 1000);
void checkWebfleetWorkshopArrival();
void reconcileTechRoadsideOccupation();
void checkOtfBaseArrival();

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

      // ── Respuesta de un cliente con expediente de recobro abierto ─────
      // Si el remitente coincide con el teléfono de un cliente con recobro
      // abierto, la respuesta se registra en el historial del expediente.
      try {
        const digits = String(From).replace(/[^0-9]/g, "");
        const local = digits.startsWith("34") ? digits.slice(2) : digits;
        if (local.length >= 9) {
          const caso = await db.query(
            `SELECT r.id FROM adm_recovery_cases r
             JOIN adm_customers cu ON cu.id = r.customer_id
             WHERE r.closed_at IS NULL
               AND (regexp_replace(COALESCE(cu.admin_phone,''), '[^0-9]', '', 'g') LIKE '%' || $1
                 OR regexp_replace(COALESCE(cu.phone,''), '[^0-9]', '', 'g') LIKE '%' || $1)
             ORDER BY r.updated_at DESC
             LIMIT 1`,
            [local]
          );
          if (caso.rows.length > 0) {
            await db.query(
              `INSERT INTO adm_recovery_actions (recovery_case_id, action_type, notes)
               VALUES ($1, 'respuesta_whatsapp', $2)`,
              [
                caso.rows[0].id,
                `${ProfileName ? ProfileName + ": " : ""}${Body || "(mensaje multimedia)"}`,
              ]
            );
            console.log(`[Recobros] respuesta WhatsApp registrada en expediente ${caso.rows[0].id}`);
          }
        }
      } catch (e) {
        console.error("[Recobros] error registrando respuesta WhatsApp:", e);
      }

      // ── Route to active capture session if one exists ─────────────────
      const activeSession = await db.query(
        `SELECT id, job_id FROM whatsapp_capture_sessions WHERE status = 'ACTIVE' LIMIT 1`
      );
      if (activeSession.rows.length > 0) {
        const { id: sessionId, job_id: jobId } = activeSession.rows[0];
        const msgType = detectMessageType(req.body);
        const mediaUrl0: string | null = req.body["MediaUrl0"] ?? null;

        // Parse vCard contact attachment
        let vcardContactName: string | null = null;
        let vcardContactPhone: string | null = null;
        if (msgType === "contact" && mediaUrl0) {
          try {
            const vcardResp = await fetch(mediaUrl0, {
              headers: {
                Authorization: "Basic " + Buffer.from(
                  `${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`
                ).toString("base64"),
              },
            });
            if (vcardResp.ok) {
              const vcardText = await vcardResp.text();
              const parsed = parseVCard(vcardText);
              vcardContactName = parsed.name;
              vcardContactPhone = parsed.phone;
            }
          } catch (vcErr) {
            console.warn("Could not parse vCard:", vcErr);
          }
        }

        // Try to store media in Supabase if it's an image/audio/video/document
        let storedUrl: string | null = null;
        if (mediaUrl0 && ["image","audio","video","document"].includes(msgType)) {
          try {
            const mediaResp = await fetch(mediaUrl0, {
              headers: {
                Authorization: "Basic " + Buffer.from(
                  `${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`
                ).toString("base64"),
              },
            });
            if (mediaResp.ok) {
              const contentType = mediaResp.headers.get("content-type") ?? "application/octet-stream";
              const ext = contentType.split("/")[1]?.split(";")[0] ?? "bin";
              const buffer = Buffer.from(await mediaResp.arrayBuffer());
              const storagePath = `roadside/${jobId}/whatsapp_${Date.now()}.${ext}`;
              const { error: upErr } = await supabase.storage
                .from(process.env.SUPABASE_ROADSIDE_BUCKET || "roadside")
                .upload(storagePath, buffer, { contentType, upsert: false });
              if (!upErr) {
                const { data: pub } = supabase.storage
                  .from(process.env.SUPABASE_ROADSIDE_BUCKET || "roadside")
                  .getPublicUrl(storagePath);
                storedUrl = pub.publicUrl ?? null;
              }
            }
          } catch (mediaErr) {
            console.warn("Could not store WhatsApp media:", mediaErr);
          }
        }

        // Detect Google Maps URL in text messages and extract coordinates
        let effectiveMsgType = msgType;
        let lat = req.body.Latitude ? parseFloat(req.body.Latitude) : null;
        let lng = req.body.Longitude ? parseFloat(req.body.Longitude) : null;
        let resolvedAddress: string | null = req.body.Label ?? null;

        if (msgType === "text" && Body) {
          // Coordenadas DMS escritas en el propio mensaje (ubicaciones reenviadas de
          // Google Maps: `41°04'55.2"N 1°08'54.6"E`). Es la vía más fiable: sin red.
          const dms = Body.match(
            /(\d{1,3})°(\d{1,2})'([\d.]+)"?\s*([NS])[\s,+]+(\d{1,3})°(\d{1,2})'([\d.]+)"?\s*([EW])/
          );
          if (dms) {
            const latAbs = Number(dms[1]) + Number(dms[2]) / 60 + Number(dms[3]) / 3600;
            const lngAbs = Number(dms[5]) + Number(dms[6]) / 60 + Number(dms[7]) / 3600;
            lat = dms[4].toUpperCase() === "S" ? -latAbs : latAbs;
            lng = dms[8].toUpperCase() === "W" ? -lngAbs : lngAbs;
            effectiveMsgType = "location";
          }
          const mapsUrlMatch = Body.match(/https?:\/\/(maps\.app\.goo\.gl|goo\.gl\/maps|maps\.google\.com|www\.google\.com\/maps)[^\s]*/i);
          if (mapsUrlMatch && lat == null) {
            try {
              // Follow redirects to get the final URL with coordinates
              const mapsResp = await fetch(mapsUrlMatch[0], { redirect: "follow", signal: AbortSignal.timeout(5000) });
              const finalUrl = decodeURIComponent(mapsResp.url);
              // Extract lat/lng from URL patterns like @41.123,1.456, ?q=41.123,1.456, ll=..., !3d..!4d..,
              // or DMS in the place name of the final URL
              const coordMatch = finalUrl.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/) ||
                                 finalUrl.match(/[?&]q=(-?\d+\.\d+),(-?\d+\.\d+)/) ||
                                 finalUrl.match(/[?&]ll=(-?\d+\.\d+),(-?\d+\.\d+)/) ||
                                 finalUrl.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
              const urlDms = coordMatch ? null : finalUrl.match(
                /(\d{1,3})°(\d{1,2})'([\d.]+)"?([NS])\+?(\d{1,3})°(\d{1,2})'([\d.]+)"?([EW])/
              );
              if (coordMatch || urlDms) {
                if (coordMatch) {
                  lat = parseFloat(coordMatch[1]);
                  lng = parseFloat(coordMatch[2]);
                } else if (urlDms) {
                  const latAbs = Number(urlDms[1]) + Number(urlDms[2]) / 60 + Number(urlDms[3]) / 3600;
                  const lngAbs = Number(urlDms[5]) + Number(urlDms[6]) / 60 + Number(urlDms[7]) / 3600;
                  lat = urlDms[4].toUpperCase() === "S" ? -latAbs : latAbs;
                  lng = urlDms[8].toUpperCase() === "W" ? -lngAbs : lngAbs;
                }
                effectiveMsgType = "location";
                // Reverse geocode
                try {
                  const geoResp = await fetch(
                    `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`,
                    { headers: { "User-Agent": "sea-tarragona-app/1.0" } }
                  );
                  if (geoResp.ok) {
                    const geoData: any = await geoResp.json();
                    resolvedAddress = geoData.display_name ?? null;
                  }
                } catch {}
              }
            } catch (mapsErr) {
              console.warn("Google Maps URL resolution failed:", mapsErr);
            }
          }
        }

        // Reverse geocode native GPS location using Nominatim
        // (effectiveMsgType cubre también las coordenadas DMS extraídas del texto)
        if (effectiveMsgType === "location" && lat != null && lng != null && !resolvedAddress) {
          try {
            const geoResp = await fetch(
              `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`,
              { headers: { "User-Agent": "sea-tarragona-app/1.0" } }
            );
            if (geoResp.ok) {
              const geoData: any = await geoResp.json();
              resolvedAddress = geoData.display_name ?? null;
            }
          } catch (geoErr) {
            console.warn("Reverse geocoding failed:", geoErr);
          }
        }

        const capMsg = await db.query(
          `INSERT INTO whatsapp_capture_messages
            (session_id, job_id, message_sid, from_phone, message_type,
             text_content, media_url, media_stored_url,
             latitude, longitude, address, contact_name, contact_phone,
             raw_payload, received_at,
             transcript_status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
           RETURNING id`,
          [
            sessionId, jobId, MessageSid, From, effectiveMsgType,
            effectiveMsgType === "location" ? null : (Body ?? null),
            mediaUrl0,
            storedUrl,
            lat,
            lng,
            resolvedAddress,
            vcardContactName,
            vcardContactPhone,
            JSON.stringify(req.body),
            Date.now(),
            effectiveMsgType === "audio" ? "pending" : "none",
          ]
        );
        console.log(`WhatsApp capture: message ${MessageSid} routed to session #${sessionId} (job ${jobId})`);

        // Audio → transcribir en segundo plano (no bloquea la respuesta a Twilio)
        if (effectiveMsgType === "audio" && mediaUrl0 && capMsg.rows[0]?.id) {
          void transcribeCaptureAudio(capMsg.rows[0].id, mediaUrl0);
        }

        return res.status(200).type("text/xml").send("<Response></Response>");
      }

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

      // Actualizar estado del WhatsApp de seguimiento en la asistencia correspondiente.
      // Ranking para no rebajar (p.ej. un 'delivered' tardío no debe pisar 'read').
      if (MessageSid && MessageStatus) {
        await db.query(
          `UPDATE roadside_assistances
           SET "waStatus" = $2, "waStatusAtMs" = $3
           WHERE "trackingWhatsappSid" = $1
             AND (
               $2 IN ('failed','undelivered')
               OR COALESCE(CASE "waStatus"
                    WHEN 'queued' THEN 0 WHEN 'sent' THEN 1
                    WHEN 'delivered' THEN 2 WHEN 'read' THEN 3 ELSE -1 END, -1)
                  <= CASE $2
                    WHEN 'queued' THEN 0 WHEN 'sent' THEN 1
                    WHEN 'delivered' THEN 2 WHEN 'read' THEN 3 ELSE -1 END
             )`,
          [MessageSid, MessageStatus, Date.now()]
        );
      }
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

app.post("/api/whatsapp/send", requireSupervisorRole, async (req, res) => {
  try {
    const { to, body } = req.body;
    if (!to || !body) return res.status(400).json({ error: "Faltan campos to/body" });

    const from = process.env.TWILIO_WHATSAPP_FROM || process.env.TWILIO_WHATSAPP_NUMBER || "whatsapp:+34610473079";
    const toFormatted = to.startsWith("whatsapp:") ? to : `whatsapp:${to}`;

    const message = await twilioClient.messages.create({ from, to: toFormatted, body });
    console.log(`WhatsApp reply sent to ${toFormatted}: ${message.sid}`);
    return res.json({ ok: true, sid: message.sid });
  } catch (error: any) {
    console.error("POST /api/whatsapp/send error:", error);
    return res.status(500).json({ error: error.message ?? "Error enviando mensaje" });
  }
});

/* =========================================================
   WHATSAPP CAPTURE SESSIONS
========================================================= */

// Helper: AI analysis of capture session messages
// Transcribe un audio de WhatsApp (Whisper) y lo guarda en el mensaje de captura.
// Se ejecuta async tras responder a Twilio (no bloquea el webhook).
async function transcribeCaptureAudio(captureMessageId: number, twilioMediaUrl: string) {
  try {
    await db.query(
      `UPDATE whatsapp_capture_messages SET transcript_status = 'pending' WHERE id = $1`,
      [captureMessageId]
    );

    const resp = await fetch(twilioMediaUrl, {
      headers: {
        Authorization:
          "Basic " +
          Buffer.from(
            `${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`
          ).toString("base64"),
      },
      signal: AbortSignal.timeout(20000),
    });
    if (!resp.ok) throw new Error(`Audio download HTTP ${resp.status}`);

    const contentType = resp.headers.get("content-type") ?? "audio/ogg";
    const ext = (contentType.split("/")[1] || "ogg").split(";")[0];
    const buffer = Buffer.from(await resp.arrayBuffer());

    const file = await toFile(buffer, `audio.${ext}`, { type: contentType });
    const tr = await openai.audio.transcriptions.create({
      file,
      model: "whisper-1",
      prompt: "Asistencia en carretera: matrícula, avería, ubicación, chofer, autorización.",
    });
    const transcript = (tr.text || "").trim();

    // Guardamos la transcripción y la usamos como text_content para que el análisis IA la incluya
    const upd = await db.query(
      `UPDATE whatsapp_capture_messages
       SET transcript = $2, transcript_status = 'done',
           text_content = COALESCE(NULLIF(text_content, ''), $2)
       WHERE id = $1
       RETURNING job_id`,
      [captureMessageId, transcript]
    );
    console.log(`WhatsApp audio transcrito (capture msg #${captureMessageId}): ${transcript.slice(0, 80)}…`);

    // Si el audio empieza por "trabajos a realizar", añadir el resto al campo de la asistencia
    const jobId = upd.rows[0]?.job_id;
    if (jobId) {
      const norm = transcript
        .toLowerCase()
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, ""); // sin acentos
      if (norm.startsWith("trabajos a realizar")) {
        // Quita el encabezado "trabajos a realizar" (y posible ":" o "-") del texto original
        const cuerpo = transcript.replace(/^\s*trabajos a realizar\s*[:.\-]?\s*/i, "").trim();
        if (cuerpo) {
          await db.query(
            `UPDATE roadside_assistances
             SET "trabajosARealizar" =
                   CASE WHEN COALESCE("trabajosARealizar", '') = ''
                        THEN $2
                        ELSE "trabajosARealizar" || E'\\n' || $2 END,
                 "updatedAtMs" = $3
             WHERE id = $1`,
            [jobId, cuerpo, Date.now()]
          );
          console.log(`Trabajos a realizar añadidos a asistencia #${jobId} desde audio`);
        }
      }
    }
  } catch (e) {
    console.error("transcribeCaptureAudio error:", e);
    await db.query(
      `UPDATE whatsapp_capture_messages SET transcript_status = 'error' WHERE id = $1`,
      [captureMessageId]
    ).catch(() => {});
  }
}

async function analyzeCaptureSesionWithAI(sessionId: number): Promise<Record<string, any>> {
  const result = await db.query(
    `SELECT message_type, text_content, latitude, longitude, address,
            contact_name, contact_phone, media_stored_url, media_url, transcript
     FROM whatsapp_capture_messages
     WHERE session_id = $1
     ORDER BY received_at ASC`,
    [sessionId]
  );
  const messages = result.rows;
  if (!messages.length) return {};

  // Build context for AI — text lines + image URLs for vision
  const lines: string[] = [];
  const imageUrls: string[] = [];
  for (const m of messages) {
    if (m.message_type === "text" && m.text_content) lines.push(`[TEXTO] ${m.text_content}`);
    else if (m.message_type === "location") lines.push(`[UBICACION] lat=${m.latitude} lng=${m.longitude}${m.address ? ` dir="${m.address}"` : ""}`);
    else if (m.message_type === "contact") lines.push(`[CONTACTO] nombre="${m.contact_name}" tel="${m.contact_phone}"`);
    else if (m.message_type === "image") {
      const url = m.media_stored_url || m.media_url;
      if (url) imageUrls.push(url);
      lines.push(`[IMAGEN enviada]`);
    }
    else if (m.message_type === "audio") lines.push(m.transcript ? `[AUDIO transcrito] ${m.transcript}` : `[AUDIO sin transcribir]`);
    else if (m.message_type === "document") lines.push(`[DOCUMENTO]`);
  }

  const systemPrompt = `Eres un asistente de una empresa de asistencia en carretera.
Analiza los mensajes e imágenes de WhatsApp de una incidencia y extrae la información relevante.

INSTRUCCIONES CRÍTICAS para imágenes:
1. Busca matrículas de vehículos en todas las imágenes (en la placa física, documentos, capturas de pantalla).
2. Busca coordenadas GPS en cualquier formato: decimal (41.123, 1.456), DMS (41°19'20.4"N 1°15'57.8"E), o en capturas de mapas.
   - Si encuentras coordenadas DMS, conviértelas a decimal: grados + minutos/60 + segundos/3600. Norte/Este = positivo, Sur/Oeste = negativo.
3. Busca direcciones, nombres de calles, municipios visibles en imágenes de mapas o capturas de pantalla.

MATRÍCULAS (España):
- Matrícula BLANCA = camión/vehículo tractor → campo "plate".
- Matrícula ROJA = REMOLQUE → campo "plateRemolque". Formato del remolque: una "R" seguida de 4 dígitos y 3 letras (ej. R0000BBB, R1234BCD). Devuélvela sin espacios ni guiones, empezando por R.
- Si en una imagen aparecen la blanca y la roja juntas: la blanca es del camión ("plate") y la roja del remolque ("plateRemolque").
- No pongas una matrícula roja (que empieza por R con formato R+4 dígitos+3 letras) en "plate"; esa va siempre en "plateRemolque".

Responde SOLO con JSON válido, sin markdown.
Campos a extraer (null si no disponible):
{
  "customerName": string,
  "conductorNombre": string,
  "empresa": string,
  "contactoNombre": string,
  "contactoTelefono": string,
  "plate": string (matrícula BLANCA del vehículo averiado/camión, sin espacios ni guiones),
  "plateRemolque": string (matrícula ROJA del remolque, formato R+4 dígitos+3 letras, ej. R0000BBB, o null),
  "vehicleBrand": string,
  "vehicleModel": string,
  "vehicleDescription": string,
  "latitude": number (decimal, extraído de texto, imagen de mapa o coordenadas DMS),
  "longitude": number (decimal, extraído de texto, imagen de mapa o coordenadas DMS),
  "address": string,
  "municipio": string,
  "provincia": string,
  "tipoAveria": string,
  "descripcionAveria": string,
  "resumen": string (resumen breve de 1-2 frases),
  "confidence": "high"|"medium"|"low"
}`;

  // Build vision-capable user message content
  type ContentPart =
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string; detail: "auto" } };

  const userContent: ContentPart[] = [
    { type: "text", text: `Mensajes de la sesión:\n${lines.join("\n")}` },
    ...imageUrls.map((url) => ({
      type: "image_url" as const,
      image_url: { url, detail: "auto" as const },
    })),
  ];

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
      temperature: 0.1,
      max_tokens: 700,
    });
    const raw = response.choices[0]?.message?.content ?? "{}";
    const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    return JSON.parse(cleaned);
  } catch (e) {
    console.error("analyzeCaptureSesionWithAI error:", e);
    return {};
  }
}

// Helper: detect message type from Twilio payload
function detectMessageType(body: Record<string, any>): string {
  const numMedia = Number(body.NumMedia ?? 0);
  if (body.Latitude) return "location";
  if (body.Body?.startsWith("BEGIN:VCARD")) return "contact";
  if (numMedia > 0) {
    const contentType: string = body["MediaContentType0"] ?? "";
    if (contentType.startsWith("image/")) return "image";
    if (contentType.startsWith("video/")) return "video";
    if (contentType.startsWith("audio/")) return "audio";
    if (contentType.includes("vcard") || contentType.includes("x-vcard")) return "contact";
    return "document";
  }
  return "text";
}

function parseVCard(vcardText: string): { name: string | null; phone: string | null } {
  const fnMatch = vcardText.match(/^FN[^:]*:(.+)$/m);
  const name = fnMatch ? fnMatch[1].trim() : null;
  const telMatch = vcardText.match(/^TEL[^:]*:([+\d\s\-()]+)$/m);
  const phone = telMatch ? telMatch[1].replace(/\s+/g, "").trim() : null;
  return { name, phone };
}

// GET active session (global)
app.get("/api/whatsapp-capture/active", requireAdminRole, async (_req, res) => {
  try {
    const result = await db.query(
      `SELECT s.*, COALESCE(NULLIF(ra.plate, ''), ra."plateRemolque") AS plate, ra."customerName"
       FROM whatsapp_capture_sessions s
       LEFT JOIN roadside_assistances ra ON ra.id = s.job_id
       WHERE s.status = 'ACTIVE'
       ORDER BY s.started_at DESC
       LIMIT 1`
    );
    return res.json(result.rows[0] ?? null);
  } catch (error) {
    console.error("GET /api/whatsapp-capture/active error:", error);
    return res.status(500).json({ error: "Error obteniendo sesión activa" });
  }
});

// GET session + messages for a job
app.get("/api/whatsapp-capture/by-job/:jobId", requireAdminRole, async (req, res) => {
  try {
    const jobId = Number(req.params.jobId);
    const sessionResult = await db.query(
      `SELECT * FROM whatsapp_capture_sessions WHERE job_id = $1 ORDER BY started_at DESC LIMIT 1`,
      [jobId]
    );
    if (!sessionResult.rows.length) return res.json(null);
    const session = sessionResult.rows[0];
    session.started_at = session.started_at ? Number(session.started_at) : null;
    session.ended_at = session.ended_at ? Number(session.ended_at) : null;
    if (session.ai_suggestions) {
      try { session.ai_suggestions = JSON.parse(session.ai_suggestions); } catch {}
    }
    const msgResult = await db.query(
      `SELECT * FROM whatsapp_capture_messages WHERE session_id = $1 ORDER BY received_at ASC`,
      [session.id]
    );
    const messages = msgResult.rows.map((m: any) => ({
      ...m,
      received_at: m.received_at ? Number(m.received_at) : null,
      latitude: m.latitude != null ? Number(m.latitude) : null,
      longitude: m.longitude != null ? Number(m.longitude) : null,
    }));
    return res.json({ ...session, messages });
  } catch (error) {
    console.error("GET /api/whatsapp-capture/by-job error:", error);
    return res.status(500).json({ error: "Error obteniendo sesión" });
  }
});

// POST start capture session
app.post("/api/whatsapp-capture/sessions", requireAdminRole, async (req, res) => {
  try {
    const { job_id, created_by } = req.body;
    if (!job_id) return res.status(400).json({ error: "job_id requerido" });

    // Solo puede haber una captura activa a la vez (los WhatsApp entrantes se
    // enrutan a la sesión activa). Si la que bloquea es de una asistencia ya
    // cerrada, se cierra sola y se permite la nueva.
    const existing = await db.query(
      `SELECT s.id, s.job_id, COALESCE(NULLIF(ra.plate, ''), ra."plateRemolque") AS plate, ra."customerName", ra.status AS job_status
       FROM whatsapp_capture_sessions s
       LEFT JOIN roadside_assistances ra ON ra.id = s.job_id
       WHERE s.status = 'ACTIVE'`
    );
    const CLOSED = new Set(["llegada_taller", "redirigida", "cancelada"]);
    for (const active of existing.rows) {
      // Misma asistencia: ya tiene su captura, no creamos otra
      if (Number(active.job_id) === Number(job_id)) {
        return res.status(409).json({ error: "Esta asistencia ya tiene una captura activa" });
      }
      // Captura huérfana (asistencia cerrada o inexistente) → cerrarla automáticamente
      if (!active.job_status || CLOSED.has(active.job_status)) {
        await db.query(
          `UPDATE whatsapp_capture_sessions SET status = 'CLOSED', ended_at = $2 WHERE id = $1`,
          [active.id, Date.now()]
        );
        continue;
      }
      // Captura activa de otra asistencia AÚN ABIERTA → bloquear
      const label = active.plate || active.customerName || `#${active.job_id}`;
      return res.status(409).json({
        error: `Ya hay una captura activa en la asistencia ${label}. Ciérrala antes de empezar otra.`,
        activeSession: active,
      });
    }

    const now = Date.now();
    const result = await db.query(
      `INSERT INTO whatsapp_capture_sessions (job_id, status, started_at, created_by)
       VALUES ($1, 'ACTIVE', $2, $3)
       RETURNING *`,
      [job_id, now, created_by ?? null]
    );
    const row = result.rows[0];
    row.started_at = row.started_at ? Number(row.started_at) : null;
    row.ended_at = row.ended_at ? Number(row.ended_at) : null;
    return res.json(row);
  } catch (error) {
    console.error("POST /api/whatsapp-capture/sessions error:", error);
    return res.status(500).json({ error: "Error iniciando sesión" });
  }
});

// POST close session + trigger AI
app.post("/api/whatsapp-capture/sessions/:id/close", requireAdminRole, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const session = await db.query(
      `SELECT * FROM whatsapp_capture_sessions WHERE id = $1`,
      [id]
    );
    if (!session.rows.length) return res.status(404).json({ error: "Sesión no encontrada" });
    if (session.rows[0].status === "CLOSED") return res.status(400).json({ error: "Sesión ya cerrada" });

    const now = Date.now();
    await db.query(
      `UPDATE whatsapp_capture_sessions SET status = 'CLOSED', ended_at = $2 WHERE id = $1`,
      [id, now]
    );

    // Save WhatsApp media as roadside_assistance_files and build notes from text messages
    const jobId = session.rows[0].job_id;
    const msgs = await db.query(
      `SELECT * FROM whatsapp_capture_messages WHERE session_id = $1 ORDER BY received_at ASC`,
      [id]
    );
    const noteLines: string[] = [];
    for (const msg of msgs.rows) {
      if ((msg.message_type === "image" || msg.message_type === "video" || msg.message_type === "audio" || msg.message_type === "document") && (msg.media_stored_url || msg.media_url)) {
        const url = msg.media_stored_url || msg.media_url;
        // Evitar duplicados al reabrir y volver a cerrar la sesión: solo insertar si esa URL aún no está guardada
        await db.query(
          `INSERT INTO roadside_assistance_files ("assistanceId", kind, url, "fileName", "createdAtMs")
           SELECT $1, $2, $3, $4, $5
           WHERE NOT EXISTS (
             SELECT 1 FROM roadside_assistance_files WHERE "assistanceId" = $1 AND url = $3
           )`,
          [jobId, `whatsapp_${msg.message_type}`, url, `WhatsApp ${msg.message_type} ${new Date(Number(msg.received_at)).toLocaleTimeString("es-ES")}`, now]
        ).catch(() => {});
      }
      if (msg.message_type === "text" && msg.text_content) {
        noteLines.push(`[WhatsApp ${new Date(Number(msg.received_at)).toLocaleTimeString("es-ES")}] ${msg.text_content}`);
      }
      if (msg.message_type === "location" && msg.address) {
        noteLines.push(`[Ubicación GPS] ${msg.address}`);
      }
    }
    // Append WhatsApp notes to assistance notes field
    if (noteLines.length > 0) {
      const existing = await db.query(`SELECT notes FROM roadside_assistances WHERE id = $1`, [jobId]);
      const prevNotes = existing.rows[0]?.notes ?? "";
      // Evitar duplicar notas ya añadidas en un cierre anterior de la misma sesión
      const freshLines = noteLines.filter((l) => !prevNotes.includes(l));
      if (freshLines.length > 0) {
        const newNotes = [prevNotes, ...freshLines].filter(Boolean).join("\n");
        await db.query(`UPDATE roadside_assistances SET notes = $2, "updatedAtMs" = $3 WHERE id = $1`, [jobId, newNotes, now]);
      }
    }

    // Run AI analysis asynchronously — don't block the response
    analyzeCaptureSesionWithAI(id).then(async (suggestions) => {
      if (Object.keys(suggestions).length > 0) {
        await db.query(
          `UPDATE whatsapp_capture_sessions SET ai_suggestions = $2 WHERE id = $1`,
          [id, JSON.stringify(suggestions)]
        );
        console.log(`WhatsApp capture session #${id} AI analysis complete`);
      }
    }).catch((e) => console.error("AI analysis error:", e));

    const updated = await db.query(`SELECT * FROM whatsapp_capture_sessions WHERE id = $1`, [id]);
    return res.json(updated.rows[0]);
  } catch (error) {
    console.error("POST /api/whatsapp-capture/sessions/:id/close error:", error);
    return res.status(500).json({ error: "Error cerrando sesión" });
  }
});

// POST reopen a closed session to receive more WhatsApp messages
app.post("/api/whatsapp-capture/sessions/:id/reopen", requireAdminRole, async (req, res) => {
  try {
    const id = Number(req.params.id);

    // No puede haber otra sesión activa
    const existing = await db.query(
      `SELECT id FROM whatsapp_capture_sessions WHERE status = 'ACTIVE' AND id != $1 LIMIT 1`,
      [id]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: "Ya existe otra captura activa. Ciérrala primero." });
    }

    const result = await db.query(
      `UPDATE whatsapp_capture_sessions
       SET status = 'ACTIVE', ended_at = NULL, ai_suggestions = NULL
       WHERE id = $1
       RETURNING *`,
      [id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: "Sesión no encontrada" });
    const row = result.rows[0];
    row.started_at = row.started_at ? Number(row.started_at) : null;
    row.ended_at = null;
    return res.json(row);
  } catch (error) {
    console.error("POST /api/whatsapp-capture/sessions/:id/reopen error:", error);
    return res.status(500).json({ error: "Error reabriendo sesión" });
  }
});

// POST apply AI suggestion to assistance
app.post("/api/whatsapp-capture/sessions/:id/apply", requireAdminRole, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const session = await db.query(
      `SELECT * FROM whatsapp_capture_sessions WHERE id = $1`,
      [id]
    );
    if (!session.rows.length) return res.status(404).json({ error: "Sesión no encontrada" });

    const { field, value } = req.body;
    if (!field || value === undefined) return res.status(400).json({ error: "field y value requeridos" });

    const jobId = session.rows[0].job_id;

    // Allowed fields that can be applied to roadside_assistances
    const ALLOWED_FIELDS: Record<string, string> = {
      customerName: '"customerName"',
      customerPhone: '"customerPhone"',
      conductorNombre: '"conductorNombre"',
      plate: "plate",
      plateRemolque: '"plateRemolque"',
      address: "address",
      latitude: "latitude",
      longitude: "longitude",
      vehicleDescription: '"vehicleDescription"',
      notes: "notes",
    };

    // Special compound action: apply location (address + lat + lng)
    if (field === "location") {
      const { address: addr, latitude: locLat, longitude: locLng } = value as any;
      await db.query(
        `UPDATE roadside_assistances SET address = $2, latitude = $3, longitude = $4, "updatedAtMs" = $5 WHERE id = $1`,
        [jobId, addr ?? "", locLat ?? null, locLng ?? null, Date.now()]
      );
      const updated = await db.query(`SELECT * FROM roadside_assistances WHERE id = $1`, [jobId]);
      return res.json({ ok: true, assistance: updated.rows[0] });
    }

    if (!ALLOWED_FIELDS[field]) return res.status(400).json({ error: "Campo no permitido" });

    await db.query(
      `UPDATE roadside_assistances SET ${ALLOWED_FIELDS[field]} = $2, "updatedAtMs" = $3 WHERE id = $1`,
      [jobId, value, Date.now()]
    );

    const updated = await db.query(
      `SELECT * FROM roadside_assistances WHERE id = $1`,
      [jobId]
    );
    return res.json({ ok: true, assistance: updated.rows[0] });
  } catch (error) {
    console.error("POST /api/whatsapp-capture/sessions/:id/apply error:", error);
    return res.status(500).json({ error: "Error aplicando sugerencia" });
  }
});

/* =========================================================
   LUGARES CONOCIDOS (parkings, bases de cliente…)
========================================================= */

const KNOWN_PLACE_RADIUS_M = 300;

function normalizeKnownPlace(row: any) {
  return {
    id: Number(row.id),
    nombre: row.nombre ?? "",
    tipo: row.tipo ?? "otro",
    direccion: row.direccion ?? null,
    lat: row.lat != null ? Number(row.lat) : null,
    lng: row.lng != null ? Number(row.lng) : null,
    clientId: row.clientId != null ? Number(row.clientId) : null,
    clientName: row.clientName ?? null,
    notas: row.notas ?? null,
    active: row.active !== false,
    createdAtMs: row.createdAtMs != null ? Number(row.createdAtMs) : null,
  };
}

// Devuelve el lugar conocido activo más cercano dentro del radio, o null
async function findNearbyKnownPlace(lat: number, lng: number, radiusM = KNOWN_PLACE_RADIUS_M) {
  const r = await db.query(`SELECT * FROM roadside_known_places WHERE active = true`);
  let best: any = null;
  let bestDist = Infinity;
  for (const p of r.rows) {
    const d = haversineDistanceM(lat, lng, Number(p.lat), Number(p.lng));
    if (d <= radiusM && d < bestDist) { best = p; bestDist = d; }
  }
  return best ? { place: normalizeKnownPlace(best), distM: Math.round(bestDist) } : null;
}

// Crea un lugar conocido evitando duplicados por cercanía. Devuelve {place, reused}
async function createKnownPlaceDedup(data: {
  nombre: string; tipo?: string; direccion?: string | null;
  lat: number; lng: number; clientId?: number | null; clientName?: string | null;
  notas?: string | null; createdBy?: string | null;
}) {
  const nearby = await findNearbyKnownPlace(data.lat, data.lng);
  if (nearby) return { place: nearby.place, reused: true };
  const now = Date.now();
  const r = await db.query(
    `INSERT INTO roadside_known_places
      (nombre, tipo, direccion, lat, lng, "clientId", "clientName", notas, "createdBy", active, "createdAtMs", "updatedAtMs")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true,$10,$10) RETURNING *`,
    [
      data.nombre || "Lugar sin nombre",
      data.tipo || "otro",
      data.direccion ?? null,
      data.lat, data.lng,
      data.clientId ?? null, data.clientName ?? null,
      data.notas ?? null, data.createdBy ?? null,
      now,
    ]
  );
  return { place: normalizeKnownPlace(r.rows[0]), reused: false };
}

// ── Admin CRUD ──
app.get("/api/roadside-known-places", requireAdminRole, async (req, res) => {
  try {
    const clientId = req.query.clientId ? Number(req.query.clientId) : null;
    const q = String(req.query.q ?? "").trim().toLowerCase();
    const params: any[] = [];
    const conds: string[] = ["active = true"];
    if (clientId) { params.push(clientId); conds.push(`"clientId" = $${params.length}`); }
    if (q) { params.push(`%${q}%`); conds.push(`(LOWER(nombre) LIKE $${params.length} OR LOWER(COALESCE(direccion,'')) LIKE $${params.length})`); }
    const r = await db.query(
      `SELECT * FROM roadside_known_places WHERE ${conds.join(" AND ")} ORDER BY nombre ASC LIMIT 200`,
      params
    );
    res.json(r.rows.map(normalizeKnownPlace));
  } catch (e) {
    console.error("GET known-places error:", e);
    res.status(500).json({ error: "Error obteniendo lugares" });
  }
});

app.get("/api/roadside-known-places/near", requireAdminRole, async (req, res) => {
  try {
    const lat = Number(req.query.lat), lng = Number(req.query.lng);
    const radius = req.query.radius ? Number(req.query.radius) : KNOWN_PLACE_RADIUS_M;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return res.status(400).json({ error: "lat/lng requeridos" });
    res.json(await findNearbyKnownPlace(lat, lng, radius));
  } catch (e) {
    console.error("GET known-places/near error:", e);
    res.status(500).json({ error: "Error buscando lugar cercano" });
  }
});

app.post("/api/roadside-known-places", requireAdminRole, async (req, res) => {
  try {
    const b = req.body ?? {};
    const lat = Number(b.lat), lng = Number(b.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return res.status(400).json({ error: "lat/lng requeridos" });
    const result = await createKnownPlaceDedup({
      nombre: String(b.nombre ?? "").trim(), tipo: b.tipo, direccion: b.direccion ?? null,
      lat, lng, clientId: b.clientId ?? null, clientName: b.clientName ?? null,
      notas: b.notas ?? null, createdBy: "oficina",
    });
    res.json(result);
  } catch (e) {
    console.error("POST known-places error:", e);
    res.status(500).json({ error: "Error creando lugar" });
  }
});

app.put("/api/roadside-known-places/:id", requireAdminRole, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const b = req.body ?? {};
    const r = await db.query(
      `UPDATE roadside_known_places SET
         nombre = COALESCE($2, nombre), tipo = COALESCE($3, tipo),
         direccion = $4, lat = COALESCE($5, lat), lng = COALESCE($6, lng),
         "clientId" = $7, "clientName" = $8, notas = $9, "updatedAtMs" = $10
       WHERE id = $1 RETURNING *`,
      [id, b.nombre ?? null, b.tipo ?? null, b.direccion ?? null,
       b.lat != null ? Number(b.lat) : null, b.lng != null ? Number(b.lng) : null,
       b.clientId ?? null, b.clientName ?? null, b.notas ?? null, Date.now()]
    );
    if (!r.rows[0]) return res.status(404).json({ error: "Lugar no encontrado" });
    res.json(normalizeKnownPlace(r.rows[0]));
  } catch (e) {
    console.error("PUT known-places error:", e);
    res.status(500).json({ error: "Error actualizando lugar" });
  }
});

app.delete("/api/roadside-known-places/:id", requireAdminRole, async (req, res) => {
  try {
    const id = Number(req.params.id);
    await db.query(`UPDATE roadside_known_places SET active = false, "updatedAtMs" = $2 WHERE id = $1`, [id, Date.now()]);
    res.json({ ok: true });
  } catch (e) {
    console.error("DELETE known-places error:", e);
    res.status(500).json({ error: "Error eliminando lugar" });
  }
});

// ── Operario: capturar destino al llegar + crear lugar ──
// Captura el GPS de destino (si la asistencia no tenía) y comprueba si ya es un lugar conocido.
app.post("/api/roadside-operator/assistances/:id/capture-destination", requireRoadsideOperator, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const lat = Number(req.body?.lat), lng = Number(req.body?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return res.status(400).json({ error: "lat/lng requeridos" });

    if (req.body?.clientActionId && (await isDuplicateAction(req.body.clientActionId))) {
      return res.json({ alreadyKnown: false, deduped: true });
    }

    const cur = await db.query(`SELECT latitude, longitude, "clientName" FROM roadside_assistances WHERE id = $1`, [id]);
    if (!cur.rows[0]) return res.status(404).json({ error: "Asistencia no encontrada" });

    // Si no tenía coordenadas, guardamos el destino capturado
    if (cur.rows[0].latitude == null || cur.rows[0].longitude == null) {
      await db.query(
        `UPDATE roadside_assistances SET latitude = $2, longitude = $3, "updatedAtMs" = $4 WHERE id = $1`,
        [id, lat, lng, Date.now()]
      );
    }

    // ¿Ya es un lugar conocido?
    const nearby = await findNearbyKnownPlace(lat, lng);
    if (nearby) {
      await db.query(`UPDATE roadside_assistances SET "knownPlaceId" = $2 WHERE id = $1`, [id, nearby.place.id]);
      return res.json({ alreadyKnown: true, place: nearby.place });
    }
    return res.json({ alreadyKnown: false });
  } catch (e) {
    console.error("POST capture-destination error:", e);
    res.status(500).json({ error: "Error capturando destino" });
  }
});

// Crea un lugar conocido desde la APK (con dedup) y lo enlaza a la asistencia
app.post("/api/roadside-operator/known-places", requireRoadsideOperator, async (req, res) => {
  try {
    const operator = (req as any).roadsideOperator as { techName: string };
    const b = req.body ?? {};
    const lat = Number(b.lat), lng = Number(b.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return res.status(400).json({ error: "lat/lng requeridos" });

    let clientName: string | null = null;
    if (b.assistanceId) {
      const a = await db.query(`SELECT "customerName" FROM roadside_assistances WHERE id = $1`, [Number(b.assistanceId)]);
      clientName = a.rows[0]?.customerName ?? null;
    }

    const result = await createKnownPlaceDedup({
      nombre: String(b.nombre ?? "").trim() || (b.direccion ?? "Lugar nuevo"),
      tipo: b.tipo ?? "otro", direccion: b.direccion ?? null,
      lat, lng, clientName, createdBy: operator.techName,
    });

    if (b.assistanceId) {
      await db.query(`UPDATE roadside_assistances SET "knownPlaceId" = $2 WHERE id = $1`, [Number(b.assistanceId), result.place.id]);
    }
    res.json(result);
  } catch (e) {
    console.error("POST operator known-places error:", e);
    res.status(500).json({ error: "Error creando lugar" });
  }
});

/* =========================================================
   OTF — Órdenes de Trabajo de Flota
========================================================= */

function normalizeOtf(row: any) {
  return {
    id: Number(row.id),
    workshopId: row.workshopId ?? null,
    clientName: row.clientName ?? "",
    clientId: row.clientId != null ? Number(row.clientId) : null,
    knownPlaceId: row.knownPlaceId != null ? Number(row.knownPlaceId) : null,
    baseName: row.baseName ?? null,
    direccion: row.direccion ?? null,
    lat: row.lat != null ? Number(row.lat) : null,
    lng: row.lng != null ? Number(row.lng) : null,
    fechaProgramadaMs: row.fechaProgramadaMs != null ? Number(row.fechaProgramadaMs) : null,
    status: row.status ?? "planificada",
    assignedTechName: row.assignedTechName ?? null,
    assignedVehicleName: row.assignedVehicleName ?? null,
    webfleetVehicleId: row.webfleetVehicleId ?? null,
    notas: row.notas ?? null,
    arrivedAtBaseMs: row.arrivedAtBaseMs != null ? Number(row.arrivedAtBaseMs) : null,
    finishedAtMs: row.finishedAtMs != null ? Number(row.finishedAtMs) : null,
    firmaUrl: row.firmaUrl ?? null,
    firmanteNombre: row.firmanteNombre ?? null,
    firmanteDni: row.firmanteDni ?? null,
    createdAtMs: Number(row.createdAtMs ?? Date.now()),
    updatedAtMs: Number(row.updatedAtMs ?? Date.now()),
  };
}

function normalizeOtfTrabajo(row: any) {
  return {
    id: Number(row.id),
    otfId: Number(row.otfId),
    plate: row.plate ?? null,
    plateRemolque: row.plateRemolque ?? null,
    tipoVehiculo: row.tipoVehiculo ?? null,
    trabajoPlantilla: row.trabajoPlantilla ?? null,
    detalleManual: row.detalleManual ?? null,
    trabajo: row.trabajo ?? null,
    status: row.status ?? "pendiente",
    origen: row.origen ?? "oficina",
    creadoPorTecnico: row.creadoPorTecnico ?? null,
    motivoAltaCampo: row.motivoAltaCampo ?? null,
    fechaAltaCampoMs: row.fechaAltaCampoMs != null ? Number(row.fechaAltaCampoMs) : null,
    observaciones: row.observaciones ?? null,
    requiereAprobacion: row.requiereAprobacion === true,
    createdAtMs: Number(row.createdAtMs ?? Date.now()),
  };
}

function combineTrabajo(plantilla?: string | null, manual?: string | null): string {
  return [plantilla, manual].map((x) => (x ?? "").trim()).filter(Boolean).join(" - ");
}

async function otfWithDetails(id: number) {
  const h = await db.query(`SELECT * FROM otf WHERE id = $1`, [id]);
  if (!h.rows[0]) return null;
  const t = await db.query(`SELECT * FROM otf_trabajos WHERE "otfId" = $1 ORDER BY id ASC`, [id]);
  const f = await db.query(`SELECT * FROM otf_trabajo_files WHERE "otfId" = $1 ORDER BY id ASC`, [id]);
  const filesByTrabajo = new Map<number, any[]>();
  for (const file of f.rows) {
    const arr = filesByTrabajo.get(Number(file.trabajoId)) ?? [];
    arr.push({ id: Number(file.id), kind: file.kind, url: file.url });
    filesByTrabajo.set(Number(file.trabajoId), arr);
  }
  const trabajos = t.rows.map((r: any) => ({ ...normalizeOtfTrabajo(r), fotos: filesByTrabajo.get(Number(r.id)) ?? [] }));
  const total = trabajos.length;
  const hechos = trabajos.filter((x: any) => x.status === "finalizado" || x.status === "no_realizado").length;
  return { ...normalizeOtf(h.rows[0]), trabajos, progreso: { hechos, total } };
}

// ── Oficina ──
app.get("/api/otf", requireAdminRole, async (req, res) => {
  try {
    const status = req.query.status ? String(req.query.status) : null;
    const params: any[] = [];
    const where = status ? `WHERE status = $1` : "";
    if (status) params.push(status);
    const r = await db.query(`SELECT * FROM otf ${where} ORDER BY "createdAtMs" DESC LIMIT 200`, params);
    // progreso por OTF en una sola consulta
    const ids = r.rows.map((x: any) => Number(x.id));
    const prog = new Map<number, { hechos: number; total: number }>();
    if (ids.length) {
      const p = await db.query(
        `SELECT "otfId",
                COUNT(*) AS total,
                COUNT(*) FILTER (WHERE status IN ('finalizado','no_realizado')) AS hechos
         FROM otf_trabajos WHERE "otfId" = ANY($1) GROUP BY "otfId"`,
        [ids]
      );
      for (const row of p.rows) prog.set(Number(row.otfId), { hechos: Number(row.hechos), total: Number(row.total) });
    }
    res.json(r.rows.map((x: any) => ({ ...normalizeOtf(x), progreso: prog.get(Number(x.id)) ?? { hechos: 0, total: 0 } })));
  } catch (e) {
    console.error("GET /api/otf error:", e);
    res.status(500).json({ error: "Error obteniendo OTF" });
  }
});

app.get("/api/otf/:id", requireAdminRole, async (req, res) => {
  try {
    const data = await otfWithDetails(Number(req.params.id));
    if (!data) return res.status(404).json({ error: "OTF no encontrada" });
    res.json(data);
  } catch (e) {
    console.error("GET /api/otf/:id error:", e);
    res.status(500).json({ error: "Error obteniendo OTF" });
  }
});

app.post("/api/otf", requireSupervisorRole, async (req, res) => {
  try {
    const b = req.body ?? {};
    const now = Date.now();
    const r = await db.query(
      `INSERT INTO otf ("workshopId","clientName","clientId","knownPlaceId","baseName",direccion,lat,lng,
        "fechaProgramadaMs",status,"assignedTechName","assignedVehicleName","webfleetVehicleId",notas,"createdAtMs","updatedAtMs")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'planificada',$10,$11,$12,$13,$14,$14) RETURNING *`,
      [
        b.workshopId ?? null, String(b.clientName ?? "").trim(), b.clientId ?? null, b.knownPlaceId ?? null,
        b.baseName ?? null, b.direccion ?? null,
        b.lat != null ? Number(b.lat) : null, b.lng != null ? Number(b.lng) : null,
        b.fechaProgramadaMs ?? null, b.assignedTechName ?? null, b.assignedVehicleName ?? null,
        b.webfleetVehicleId ?? null, b.notas ?? null, now,
      ]
    );
    res.json(normalizeOtf(r.rows[0]));
  } catch (e) {
    console.error("POST /api/otf error:", e);
    res.status(500).json({ error: "Error creando OTF" });
  }
});

app.put("/api/otf/:id", requireSupervisorRole, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const b = req.body ?? {};
    await db.query(
      `UPDATE otf SET
         "clientName" = COALESCE($2,"clientName"),
         "knownPlaceId" = $3, "baseName" = $4, direccion = $5, lat = $6, lng = $7,
         "fechaProgramadaMs" = $8, status = COALESCE($9,status),
         "assignedTechName" = $10, "assignedVehicleName" = $11, "webfleetVehicleId" = $12,
         notas = $13, "updatedAtMs" = $14
       WHERE id = $1`,
      [id, b.clientName ?? null, b.knownPlaceId ?? null, b.baseName ?? null, b.direccion ?? null,
       b.lat != null ? Number(b.lat) : null, b.lng != null ? Number(b.lng) : null,
       b.fechaProgramadaMs ?? null, b.status ?? null, b.assignedTechName ?? null,
       b.assignedVehicleName ?? null, b.webfleetVehicleId ?? null, b.notas ?? null, Date.now()]
    );
    res.json(await otfWithDetails(id));
  } catch (e) {
    console.error("PUT /api/otf/:id error:", e);
    res.status(500).json({ error: "Error actualizando OTF" });
  }
});

app.post("/api/otf/:id/trabajos", requireSupervisorRole, async (req, res) => {
  try {
    const otfId = Number(req.params.id);
    const b = req.body ?? {};
    const trabajo = combineTrabajo(b.trabajoPlantilla, b.detalleManual);
    const now = Date.now();
    const r = await db.query(
      `INSERT INTO otf_trabajos ("otfId",plate,"plateRemolque","tipoVehiculo","trabajoPlantilla","detalleManual",trabajo,
        status,origen,observaciones,"createdAtMs","updatedAtMs")
       VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8,'pendiente'),'oficina',$9,$10,$10) RETURNING *`,
      [otfId, (b.plate ?? "").toUpperCase().trim() || null, (b.plateRemolque ?? "").toUpperCase().trim() || null,
       b.tipoVehiculo ?? null, b.trabajoPlantilla ?? null, b.detalleManual ?? null, trabajo,
       b.status ?? null, b.observaciones ?? null, now]
    );
    res.json(normalizeOtfTrabajo(r.rows[0]));
  } catch (e) {
    console.error("POST /api/otf/:id/trabajos error:", e);
    res.status(500).json({ error: "Error añadiendo trabajo" });
  }
});

app.put("/api/otf/trabajos/:tid", requireSupervisorRole, async (req, res) => {
  try {
    const tid = Number(req.params.tid);
    const b = req.body ?? {};
    const trabajo = b.trabajoPlantilla != null || b.detalleManual != null
      ? combineTrabajo(b.trabajoPlantilla, b.detalleManual) : null;
    const r = await db.query(
      `UPDATE otf_trabajos SET
         plate = COALESCE($2,plate), "plateRemolque" = $3, "tipoVehiculo" = COALESCE($4,"tipoVehiculo"),
         "trabajoPlantilla" = $5, "detalleManual" = $6, trabajo = COALESCE($7,trabajo),
         status = COALESCE($8,status), observaciones = $9, "updatedAtMs" = $10
       WHERE id = $1 RETURNING *`,
      [tid, b.plate != null ? String(b.plate).toUpperCase().trim() : null, b.plateRemolque ?? null,
       b.tipoVehiculo ?? null, b.trabajoPlantilla ?? null, b.detalleManual ?? null, trabajo,
       b.status ?? null, b.observaciones ?? null, Date.now()]
    );
    if (!r.rows[0]) return res.status(404).json({ error: "Trabajo no encontrado" });
    res.json(normalizeOtfTrabajo(r.rows[0]));
  } catch (e) {
    console.error("PUT /api/otf/trabajos/:tid error:", e);
    res.status(500).json({ error: "Error actualizando trabajo" });
  }
});

app.delete("/api/otf/trabajos/:tid", requireSupervisorRole, async (req, res) => {
  try {
    await db.query(`DELETE FROM otf_trabajos WHERE id = $1`, [Number(req.params.tid)]);
    res.json({ ok: true });
  } catch (e) {
    console.error("DELETE /api/otf/trabajos/:tid error:", e);
    res.status(500).json({ error: "Error eliminando trabajo" });
  }
});

// ── Operario (APK) ──
app.get("/api/roadside-operator/otf", requireRoadsideOperator, async (req, res) => {
  try {
    const operator = (req as any).roadsideOperator as { techName: string };
    const r = await db.query(
      `SELECT * FROM otf WHERE "assignedTechName" = $1 AND status NOT IN ('finalizada','cancelada')
       ORDER BY "createdAtMs" DESC LIMIT 100`,
      [operator.techName]
    );
    const ids = r.rows.map((x: any) => Number(x.id));
    const prog = new Map<number, { hechos: number; total: number }>();
    if (ids.length) {
      const p = await db.query(
        `SELECT "otfId", COUNT(*) AS total,
                COUNT(*) FILTER (WHERE status IN ('finalizado','no_realizado')) AS hechos
         FROM otf_trabajos WHERE "otfId" = ANY($1) GROUP BY "otfId"`, [ids]);
      for (const row of p.rows) prog.set(Number(row.otfId), { hechos: Number(row.hechos), total: Number(row.total) });
    }
    res.json(r.rows.map((x: any) => ({ ...normalizeOtf(x), progreso: prog.get(Number(x.id)) ?? { hechos: 0, total: 0 } })));
  } catch (e) {
    console.error("GET operator otf error:", e);
    res.status(500).json({ error: "Error obteniendo OTF" });
  }
});

app.get("/api/roadside-operator/otf/:id", requireRoadsideOperator, async (req, res) => {
  try {
    const data = await otfWithDetails(Number(req.params.id));
    if (!data) return res.status(404).json({ error: "OTF no encontrada" });
    res.json(data);
  } catch (e) {
    console.error("GET operator otf/:id error:", e);
    res.status(500).json({ error: "Error obteniendo OTF" });
  }
});

// Check-in manual a la base (si el GPS automático falla)
app.post("/api/roadside-operator/otf/:id/checkin", requireRoadsideOperator, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const now = Date.now();
    await db.query(
      `UPDATE otf SET status = CASE WHEN status = 'planificada' THEN 'en_curso' ELSE status END,
         "arrivedAtBaseMs" = COALESCE("arrivedAtBaseMs", $2), "updatedAtMs" = $2
       WHERE id = $1`,
      [id, now]
    );
    res.json(await otfWithDetails(id));
  } catch (e) {
    console.error("POST otf checkin error:", e);
    res.status(500).json({ error: "Error en check-in" });
  }
});

// Trabajo añadido EN CAMPO por el técnico (directo, sin aprobación)
app.post("/api/roadside-operator/otf/:id/trabajos", requireRoadsideOperator, async (req, res) => {
  try {
    const operator = (req as any).roadsideOperator as { techName: string };
    const otfId = Number(req.params.id);
    const b = req.body ?? {};
    if (!b.plate || !b.tipoVehiculo || (!b.trabajoPlantilla && !b.detalleManual) || !b.motivoAltaCampo) {
      return res.status(400).json({ error: "Matrícula, tipo, trabajo y motivo son obligatorios" });
    }
    if (req.body?.clientActionId && (await isDuplicateAction(req.body.clientActionId))) {
      const dup = await db.query(`SELECT * FROM otf_trabajos WHERE "otfId" = $1 ORDER BY id DESC LIMIT 1`, [otfId]);
      return res.json(normalizeOtfTrabajo(dup.rows[0]));
    }
    const trabajo = combineTrabajo(b.trabajoPlantilla, b.detalleManual);
    const now = Date.now();
    const r = await db.query(
      `INSERT INTO otf_trabajos ("otfId",plate,"plateRemolque","tipoVehiculo","trabajoPlantilla","detalleManual",trabajo,
        status,origen,"creadoPorTecnico","motivoAltaCampo","fechaAltaCampoMs","createdAtMs","updatedAtMs")
       VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8,'pendiente'),'tecnico_campo',$9,$10,$11,$11,$11) RETURNING *`,
      [otfId, String(b.plate).toUpperCase().trim(), (b.plateRemolque ?? "").toUpperCase().trim() || null,
       b.tipoVehiculo, b.trabajoPlantilla ?? null, b.detalleManual ?? null, trabajo,
       b.status ?? null, operator.techName, b.motivoAltaCampo, now]
    );
    res.json(normalizeOtfTrabajo(r.rows[0]));
  } catch (e) {
    console.error("POST operator otf trabajos error:", e);
    res.status(500).json({ error: "Error añadiendo trabajo en campo" });
  }
});

app.put("/api/roadside-operator/otf/trabajos/:tid/status", requireRoadsideOperator, async (req, res) => {
  try {
    const tid = Number(req.params.tid);
    const status = String(req.body?.status ?? "");
    const allowed = new Set(["pendiente", "en_proceso", "finalizado", "no_realizado"]);
    if (!allowed.has(status)) return res.status(400).json({ error: "Estado no válido" });
    if (req.body?.clientActionId && (await isDuplicateAction(req.body.clientActionId))) {
      const cur = await db.query(`SELECT * FROM otf_trabajos WHERE id = $1`, [tid]);
      return res.json(cur.rows[0] ? normalizeOtfTrabajo(cur.rows[0]) : { ok: true });
    }
    const r = await db.query(
      `UPDATE otf_trabajos SET status = $2, "updatedAtMs" = $3 WHERE id = $1 RETURNING *`,
      [tid, status, Date.now()]
    );
    if (!r.rows[0]) return res.status(404).json({ error: "Trabajo no encontrado" });
    res.json(normalizeOtfTrabajo(r.rows[0]));
  } catch (e) {
    console.error("PUT operator otf trabajo status error:", e);
    res.status(500).json({ error: "Error actualizando estado" });
  }
});

// Subir foto de un trabajo de OTF (operario)
app.post(
  "/api/roadside-operator/otf/trabajos/:tid/files",
  requireRoadsideOperator,
  upload.single("file"),
  async (req, res) => {
    try {
      const tid = Number(req.params.tid);
      const kind = String(req.body?.kind || "foto").trim();
      if (!req.file) return res.status(400).json({ error: "No se recibió archivo" });
      if (req.body?.clientActionId && (await isDuplicateAction(req.body.clientActionId))) {
        return res.json({ ok: true, deduped: true });
      }
      const tr = await db.query(`SELECT "otfId" FROM otf_trabajos WHERE id = $1`, [tid]);
      if (!tr.rows[0]) return res.status(404).json({ error: "Trabajo no encontrado" });
      const otfId = Number(tr.rows[0].otfId);

      const ext = ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" } as Record<string, string>)[req.file.mimetype] ?? "jpg";
      const storagePath = `otf/${otfId}/${tid}/${kind}_${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from(SUPABASE_ROADSIDE_BUCKET)
        .upload(storagePath, req.file.buffer, { contentType: req.file.mimetype, upsert: false });
      if (upErr) throw new Error(upErr.message);
      const { data: pub } = supabase.storage.from(SUPABASE_ROADSIDE_BUCKET).getPublicUrl(storagePath);
      const r = await db.query(
        `INSERT INTO otf_trabajo_files ("trabajoId","otfId",kind,url,"createdAtMs") VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [tid, otfId, kind, pub.publicUrl, Date.now()]
      );
      res.json({ ok: true, file: { id: Number(r.rows[0].id), kind, url: pub.publicUrl } });
    } catch (e: any) {
      console.error("POST otf trabajo files error:", e);
      res.status(500).json({ error: e?.message || "Error subiendo foto" });
    }
  }
);

// Finalizar OTF con firma única del responsable (operario)
app.post(
  "/api/roadside-operator/otf/:id/finalizar",
  requireRoadsideOperator,
  upload.single("firma"),
  async (req, res) => {
    try {
      const id = Number(req.params.id);
      const firmanteNombre = String(req.body?.firmanteNombre || "").trim() || null;
      const firmanteDni = String(req.body?.firmanteDni || "").trim() || null;
      let firmaUrl: string | null = null;

      if (req.file) {
        const storagePath = `otf/${id}/firma_${Date.now()}.png`;
        const { error: upErr } = await supabase.storage
          .from(SUPABASE_ROADSIDE_BUCKET)
          .upload(storagePath, req.file.buffer, { contentType: req.file.mimetype || "image/png", upsert: false });
        if (!upErr) {
          firmaUrl = supabase.storage.from(SUPABASE_ROADSIDE_BUCKET).getPublicUrl(storagePath).data.publicUrl ?? null;
        }
      }

      const now = Date.now();
      await db.query(
        `UPDATE otf SET status = 'finalizada', "finishedAtMs" = $2,
           "firmaUrl" = COALESCE($3, "firmaUrl"),
           "firmanteNombre" = COALESCE($4, "firmanteNombre"),
           "firmanteDni" = COALESCE($5, "firmanteDni"),
           "updatedAtMs" = $2
         WHERE id = $1`,
        [id, now, firmaUrl, firmanteNombre, firmanteDni]
      );
      res.json(await otfWithDetails(id));
    } catch (e: any) {
      console.error("POST otf finalizar error:", e);
      res.status(500).json({ error: e?.message || "Error finalizando OTF" });
    }
  }
);

// Informe PDF de la OTF
app.get("/api/otf/:id/report.pdf", requireAdminRole, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const data = await otfWithDetails(id);
    if (!data) return res.status(404).json({ error: "OTF no encontrada" });

    const doc = new PDFDocument({ margin: 40, size: "A4" });
    const chunks: Buffer[] = [];
    doc.on("data", (c) => chunks.push(c));
    const finished = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));

    doc.fontSize(18).font("Helvetica-Bold").text("Mobilink – Orden de Trabajo de Flota", { align: "center" });
    doc.moveDown(0.3);
    doc.fontSize(11).font("Helvetica").text(`OTF nº ${data.id}   |   ${formatDateEs(data.createdAtMs)}`, { align: "center" });
    doc.moveDown(1);

    const row = (l: string, v: string) => {
      doc.fontSize(10).font("Helvetica-Bold").text(l, { continued: true, width: 170 });
      doc.font("Helvetica").text(v);
    };
    doc.fontSize(13).font("Helvetica-Bold").text("Datos");
    doc.moveDown(0.3);
    row("Cliente:", data.clientName || "-");
    row("Base:", data.baseName || data.direccion || "-");
    row("Operario:", data.assignedTechName || "-");
    row("Furgoneta:", data.assignedVehicleName || "-");
    row("Estado:", data.status);
    row("Progreso:", `${data.progreso.hechos} / ${data.progreso.total}`);

    doc.moveDown(1);
    doc.fontSize(13).font("Helvetica-Bold").text("Trabajos");
    doc.moveDown(0.3);
    const planificados = data.trabajos.filter((t: any) => t.origen !== "tecnico_campo");
    const enCampo = data.trabajos.filter((t: any) => t.origen === "tecnico_campo");

    const printT = (t: any) => {
      doc.fontSize(10).font("Helvetica-Bold").text(`${t.plate || "—"} · ${t.tipoVehiculo || ""}  [${t.status}]`);
      doc.fontSize(9).font("Helvetica").text(`   ${t.trabajo || ""}`);
      if (t.motivoAltaCampo) doc.fontSize(8).font("Helvetica-Oblique").text(`   Motivo alta en campo: ${t.motivoAltaCampo}`);
      doc.moveDown(0.2);
    };

    doc.fontSize(11).font("Helvetica-Bold").text("Planificados por oficina:");
    if (planificados.length === 0) doc.fontSize(9).font("Helvetica").text("  (ninguno)");
    planificados.forEach(printT);

    doc.moveDown(0.4);
    doc.fontSize(11).font("Helvetica-Bold").text("Añadidos en campo por el técnico:");
    if (enCampo.length === 0) doc.fontSize(9).font("Helvetica").text("  (ninguno)");
    enCampo.forEach(printT);

    // Firma única
    if (data.firmaUrl || data.firmanteNombre) {
      doc.moveDown(1);
      doc.fontSize(13).font("Helvetica-Bold").text("Conformidad del responsable");
      doc.moveDown(0.3);
      if (data.firmanteNombre) row("Firmante:", data.firmanteNombre);
      if (data.firmanteDni) row("DNI:", data.firmanteDni);
      if (data.firmaUrl) {
        try {
          const buf = await fetchImageForPdf(data.firmaUrl);
          doc.moveDown(0.3);
          doc.image(buf, { fit: [220, 110] });
        } catch { /* sin firma */ }
      }
    }

    doc.end();
    const buffer = await finished;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="otf_${id}.pdf"`);
    res.send(buffer);
  } catch (e: any) {
    console.error("GET otf report.pdf error:", e);
    if (!res.headersSent) res.status(500).json({ error: "Error generando PDF" });
  }
});

// Escaneo de matrícula con IA (operario): foto → matrícula → asistencia abierta
app.post(
  "/api/roadside-operator/scan-plate",
  requireRoadsideOperator,
  upload.single("file"),
  async (req, res) => {
    try {
      const operator = (req as any).roadsideOperator as { techName: string };
      if (!req.file) return res.status(400).json({ error: "No se recibió imagen" });

      // Subir a Supabase para tener una URL que la IA pueda leer
      const ext = ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" } as Record<string, string>)[req.file.mimetype] ?? "jpg";
      const storagePath = `scan/${operator.techName}/${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from(SUPABASE_ROADSIDE_BUCKET)
        .upload(storagePath, req.file.buffer, { contentType: req.file.mimetype, upsert: false });
      if (upErr) throw new Error(upErr.message);
      const { data: pub } = supabase.storage.from(SUPABASE_ROADSIDE_BUCKET).getPublicUrl(storagePath);

      const plate = await detectPlateFromImage(pub.publicUrl);
      if (!plate) return res.json({ plate: null });

      // Buscar asistencia ABIERTA del técnico con esa matrícula
      const norm = plate.toUpperCase().replace(/[^A-Z0-9]/g, "");
      const r = await db.query(
        `SELECT id FROM roadside_assistances
         WHERE "assignedTechName" = $1
           AND status NOT IN ('llegada_taller','cancelada','redirigida')
           AND UPPER(REPLACE(REPLACE(COALESCE(plate,''),' ',''),'-','')) = $2
         ORDER BY "createdAtMs" DESC LIMIT 1`,
        [operator.techName, norm]
      );
      return res.json({ plate, assistanceId: r.rows[0]?.id ?? null });
    } catch (e: any) {
      console.error("POST scan-plate error:", e);
      res.status(500).json({ error: e?.message || "Error escaneando matrícula" });
    }
  }
);

// ── App móvil TyreControl (tyrecontrol_app, Flutter) ────────────
// A diferencia del resto de TyreControl (que habla directo con
// Supabase desde el cliente, con RLS), el reconocimiento de matrícula
// necesita la clave de OpenAI y por eso pasa por este servidor. La
// autenticación es el propio JWT de Supabase Auth del técnico (la app
// ya inició sesión contra Supabase, no un usuario/código aparte).
function requireTyreControlUser(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) {
  void (async () => {
    const authHeader = String(req.headers["authorization"] ?? "");
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!token) return res.status(401).json({ error: "No autenticado" });

    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user) return res.status(401).json({ error: "Sesión no válida" });

    const { data: perfil } = await supabase
      .from("tc_usuarios")
      .select("id, acceso_apk, activo")
      .eq("id", data.user.id)
      .maybeSingle();
    if (!perfil || !perfil.acceso_apk || !perfil.activo) {
      return res.status(403).json({ error: "Sin acceso a la app de revisiones" });
    }

    (req as any).tyreControlUserId = data.user.id;
    next();
  })().catch((error) => {
    console.error("requireTyreControlUser error:", error);
    res.status(500).json({ error: "Error de autenticación" });
  });
}

// Login unificado: el técnico usa el MISMO nombre + PIN que en la app
// de asistencias (tabla techs / roadsideOperatorCode). Este endpoint
// valida ese PIN y crea/sincroniza por detrás el usuario de Supabase
// Auth + tc_usuarios que TyreControl necesita para que funcione la RLS.
// Devuelve el email sintético con el que la app hace signInWithPassword.
app.post("/api/tyrecontrol/login-operario", async (req, res) => {
  try {
    const techName = String(req.body?.techName || "").trim();
    const code = String(req.body?.code || "").trim();
    const expectedCode = await getExpectedRoadsideOperatorCode(techName);

    if (!techName || !code || !expectedCode || code !== expectedCode) {
      return res.status(401).json({ error: "Operario o código incorrecto" });
    }

    const slug = techName
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    const email = `apk-${slug}@seatyrecheck.app`;

    // ¿Ya existe el usuario? (tc_usuarios.id == auth.users.id)
    const { data: existente } = await supabase
      .from("tc_usuarios")
      .select("id")
      .eq("email", email)
      .maybeSingle();

    let userId: string;
    if (existente) {
      userId = existente.id;
      // Mantener la contraseña de Supabase sincronizada con el PIN actual
      await supabase.auth.admin.updateUserById(userId, { password: code });
      await supabase
        .from("tc_usuarios")
        .update({ acceso_apk: true, activo: true, nombre: techName })
        .eq("id", userId);
    } else {
      const { data: created, error: createErr } = await supabase.auth.admin.createUser({
        email,
        password: code,
        email_confirm: true,
      });
      if (createErr || !created.user) {
        throw new Error(createErr?.message || "No se pudo crear el usuario");
      }
      userId = created.user.id;

      // Empresa de referencia: Mobilink Tarragona (nombre legacy "SEA Tarragona"
      // aceptado hasta ejecutar la migración de datos; si no, la más antigua).
      const { data: empresa } = await supabase
        .from("tc_empresas")
        .select("id")
        .in("nombre", ["Mobilink Tarragona", "SEA Tarragona"])
        .order("nombre", { ascending: true }) // "Mobilink..." < "SEA..." → prioriza el nuevo
        .limit(1)
        .maybeSingle();
      let empresaId = empresa?.id;
      if (!empresaId) {
        const { data: primera } = await supabase
          .from("tc_empresas")
          .select("id")
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle();
        empresaId = primera?.id;
      }
      if (!empresaId) throw new Error("No hay empresas en TyreControl");

      const { error: insertErr } = await supabase.from("tc_usuarios").insert({
        id: userId,
        empresa_id: empresaId,
        nombre: techName,
        email,
        rol: "operador",
        acceso_apk: true,
        acceso_panel: false,
        activo: true,
      });
      if (insertErr) throw new Error(insertErr.message);
    }

    // El técnico de SEA atiende a todas las flotas: asignar todas las
    // empresas activas (la RLS de operador solo muestra las asignadas).
    // EXCEPTO si el usuario tiene asignación manual desde el panel
    // (empresas_manual): entonces sus empresas las gestiona el administrador
    // y el login no las toca.
    const { data: perfilUsuario } = await supabase
      .from("tc_usuarios")
      .select("empresas_manual")
      .eq("id", userId)
      .maybeSingle();
    if (!perfilUsuario?.empresas_manual) {
      const { data: empresas } = await supabase
        .from("tc_empresas")
        .select("id")
        .eq("activo", true);
      if (empresas && empresas.length > 0) {
        await supabase.from("tc_operador_empresas").upsert(
          empresas.map((e: { id: string }) => ({ usuario_id: userId, empresa_id: e.id })),
          { onConflict: "usuario_id,empresa_id" }
        );
      }
    }

    res.json({ ok: true, email, techName });
  } catch (error: any) {
    console.error("POST /api/tyrecontrol/login-operario error:", error);
    res.status(500).json({ error: error?.message || "Error iniciando sesión" });
  }
});

// ── Gestión de usuarios desde el panel (admin/super-admin) ──────────────
// Igual que requireTyreControlUser pero exige rol administrador (o
// super-admin) con acceso al panel. Deja el perfil en req.
function requireTyreControlAdmin(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) {
  void (async () => {
    const authHeader = String(req.headers["authorization"] ?? "");
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!token) return res.status(401).json({ error: "No autenticado" });

    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user) return res.status(401).json({ error: "Sesión no válida" });

    const { data: perfil } = await supabase
      .from("tc_usuarios")
      .select("id, rol, es_superadmin, acceso_panel, activo")
      .eq("id", data.user.id)
      .maybeSingle();
    if (!perfil || !perfil.activo || (!perfil.es_superadmin && perfil.rol !== "administrador")) {
      return res.status(403).json({ error: "Solo un administrador puede gestionar usuarios" });
    }

    (req as any).tcAdmin = perfil;
    next();
  })().catch((error) => {
    console.error("requireTyreControlAdmin error:", error);
    res.status(500).json({ error: "Error de autenticación" });
  });
}

// Elimina un usuario del todo (perfil + asignaciones + usuario de auth).
// Si el usuario tiene historial (revisiones, etc., por FK) se bloquea con
// un 409 y se recomienda desactivarlo en su lugar: no se pierde histórico.
app.delete("/api/tyrecontrol/usuarios/:id", requireTyreControlAdmin, async (req, res) => {
  try {
    const id = String(req.params.id);
    const admin = (req as any).tcAdmin as { id: string };
    if (id === admin.id) return res.status(400).json({ error: "No puedes eliminarte a ti mismo" });

    const { data: objetivo } = await supabase
      .from("tc_usuarios")
      .select("id, es_superadmin, nombre")
      .eq("id", id)
      .maybeSingle();
    if (!objetivo) return res.status(404).json({ error: "Usuario no encontrado" });
    if (objetivo.es_superadmin) return res.status(400).json({ error: "No se puede eliminar un super-admin" });

    // Asignaciones de empresas: fuera siempre.
    await supabase.from("tc_operador_empresas").delete().eq("usuario_id", id);

    // Perfil: si tiene historial enlazado por FK (revisiones, planes…),
    // Postgres lo rechaza → informamos en claro.
    const { error: delPerfil } = await supabase.from("tc_usuarios").delete().eq("id", id);
    if (delPerfil) {
      if (/foreign key|violates/i.test(delPerfil.message)) {
        return res.status(409).json({
          error: `"${objetivo.nombre}" tiene historial (revisiones u operaciones). Desactívalo en lugar de eliminarlo.`,
        });
      }
      throw new Error(delPerfil.message);
    }

    // Usuario de autenticación (best-effort: el perfil ya no existe).
    try { await supabase.auth.admin.deleteUser(id); } catch (e) {
      console.error("auth.admin.deleteUser:", e);
    }

    res.json({ ok: true });
  } catch (error: any) {
    console.error("DELETE /api/tyrecontrol/usuarios/:id error:", error);
    res.status(500).json({ error: error?.message || "Error eliminando usuario" });
  }
});

app.post(
  "/api/tyrecontrol/scan-plate",
  requireTyreControlUser,
  upload.single("file"),
  async (req, res) => {
    try {
      const userId = (req as any).tyreControlUserId as string;
      if (!req.file) return res.status(400).json({ error: "No se recibió imagen" });

      const ext = ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" } as Record<string, string>)[req.file.mimetype] ?? "jpg";
      const storagePath = `scan/${userId}/${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("tc-revisiones-fotos")
        .upload(storagePath, req.file.buffer, { contentType: req.file.mimetype, upsert: false });
      if (upErr) throw new Error(upErr.message);
      const { data: pub } = supabase.storage.from("tc-revisiones-fotos").getPublicUrl(storagePath);

      const plate = await detectPlateFromImage(pub.publicUrl);
      return res.json({ plate });
    } catch (e: any) {
      console.error("POST /api/tyrecontrol/scan-plate error:", e);
      res.status(500).json({ error: e?.message || "Error escaneando matrícula" });
    }
  }
);

// KPIs / Dashboard de dirección
app.get("/api/dashboard/kpis", requireAdminRole, async (req, res) => {
  try {
    const days = Math.max(1, Math.min(365, Number(req.query.days) || 30));
    const now = Date.now();
    const cutoff = now - days * 86400000;
    const startToday = new Date(); startToday.setHours(0, 0, 0, 0);
    const ms7 = now - 7 * 86400000;

    const a = await db.query(
      `SELECT * FROM roadside_assistances WHERE "createdAtMs" >= $1 ORDER BY "createdAtMs" DESC LIMIT 5000`,
      [cutoff]
    );
    const rows = a.rows.map(normalizeRoadsideAssistanceRow);

    const CLOSED = new Set(["llegada_taller", "cancelada", "redirigida"]);
    const avg = (vals: number[]) => vals.length ? Math.round(vals.reduce((s, v) => s + v, 0) / vals.length) : 0;
    const diffMin = (x?: number | null, y?: number | null) =>
      x && y ? Math.round(Math.abs(y - x) / 60000) : null;

    const tiemposSalidaPunto: number[] = [];
    const tiemposPuntoFin: number[] = [];
    const porTecnico = new Map<string, { total: number; finalizadas: number }>();
    let hoy = 0, semana = 0;

    for (const r of rows as any[]) {
      if (r.createdAtMs >= startToday.getTime()) hoy++;
      if (r.createdAtMs >= ms7) semana++;
      const t1 = diffMin(r.departedAtMs, r.arrivedAtPointMs); if (t1 != null) tiemposSalidaPunto.push(t1);
      const t2 = diffMin(r.arrivedAtPointMs, r.finishedAtMs); if (t2 != null) tiemposPuntoFin.push(t2);
      const tech = r.assignedTechName || "Sin asignar";
      const e = porTecnico.get(tech) ?? { total: 0, finalizadas: 0 };
      e.total++;
      if (r.status === "llegada_taller") e.finalizadas++;
      porTecnico.set(tech, e);
    }

    // Estado actual (no del periodo): conteo de activas por estado
    const estadoActual = await db.query(
      `SELECT status, COUNT(*)::int AS n FROM roadside_assistances
       WHERE status NOT IN ('llegada_taller','cancelada','redirigida') GROUP BY status`
    );

    // OTF
    const otf = await db.query(
      `SELECT COUNT(*) FILTER (WHERE status IN ('planificada','en_curso'))::int AS activas,
              COUNT(*)::int AS total FROM otf`
    );
    const otfTrab = await db.query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE status IN ('finalizado','no_realizado'))::int AS hechos
       FROM otf_trabajos t JOIN otf o ON o.id = t."otfId" WHERE o.status IN ('planificada','en_curso')`
    );

    res.json({
      dias: days,
      asistencias: {
        periodo: rows.length,
        hoy,
        semana,
        cerradasPeriodo: rows.filter((r: any) => r.status === "llegada_taller").length,
        canceladasPeriodo: rows.filter((r: any) => r.status === "cancelada").length,
      },
      estadoActual: estadoActual.rows.reduce((acc: any, r: any) => { acc[r.status] = r.n; return acc; }, {}),
      tiempos: {
        salidaPuntoMin: avg(tiemposSalidaPunto),
        puntoFinMin: avg(tiemposPuntoFin),
      },
      porTecnico: Array.from(porTecnico.entries())
        .map(([tech, v]) => ({ tech, ...v }))
        .sort((x, y) => y.total - x.total),
      otf: {
        activas: otf.rows[0]?.activas ?? 0,
        total: otf.rows[0]?.total ?? 0,
        trabajos: otfTrab.rows[0]?.total ?? 0,
        trabajosHechos: otfTrab.rows[0]?.hechos ?? 0,
      },
    });
  } catch (e) {
    console.error("GET /api/dashboard/kpis error:", e);
    res.status(500).json({ error: "Error calculando KPIs" });
  }
});

// Historial completo de un vehículo por matrícula (asistencias + trabajos OTF)
app.get("/api/vehiculo-historial", requireAdminRole, async (req, res) => {
  try {
    const raw = String(req.query.plate ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!raw || raw.length < 4) return res.status(400).json({ error: "Matrícula no válida" });
    const norm = `UPPER(REPLACE(REPLACE(COALESCE(%COL%,''),' ',''),'-','')) = $1`;

    // Asistencias (por matrícula del camión o del remolque)
    const asis = await db.query(
      `SELECT * FROM roadside_assistances
       WHERE ${norm.replace("%COL%", "plate")} OR ${norm.replace("%COL%", '"plateRemolque"')}
       ORDER BY "createdAtMs" DESC LIMIT 200`,
      [raw]
    );
    const asistencias = asis.rows.map(normalizeRoadsideAssistanceRow);

    // Trabajos de OTF
    const trab = await db.query(
      `SELECT t.*, o."clientName", o."baseName", o."fechaProgramadaMs", o."createdAtMs" AS otf_created
       FROM otf_trabajos t JOIN otf o ON o.id = t."otfId"
       WHERE ${norm.replace("%COL%", "t.plate")} OR ${norm.replace("%COL%", 't."plateRemolque"')}
       ORDER BY t."createdAtMs" DESC LIMIT 200`,
      [raw]
    );
    const trabajosOtf = trab.rows.map((r: any) => ({
      ...normalizeOtfTrabajo(r),
      clientName: r.clientName ?? null,
      baseName: r.baseName ?? null,
      fecha: r.otf_created != null ? Number(r.otf_created) : null,
    }));

    // Clientes asociados
    const clientes = Array.from(new Set([
      ...asistencias.map((a: any) => a.customerName).filter(Boolean),
      ...trabajosOtf.map((t: any) => t.clientName).filter(Boolean),
    ]));

    // Incidencias repetidas: ≥2 asistencias en los últimos 90 días
    const hace90 = Date.now() - 90 * 24 * 60 * 60 * 1000;
    const recientes = asistencias.filter((a: any) => (a.createdAtMs ?? 0) >= hace90).length;
    const alerta = recientes >= 2 ? `⚠️ ${recientes} intervenciones en los últimos 90 días` : null;

    res.json({
      plate: raw,
      resumen: {
        totalAsistencias: asistencias.length,
        totalTrabajosOtf: trabajosOtf.length,
        clientes,
        ultimaMs: asistencias[0]?.createdAtMs ?? trabajosOtf[0]?.fecha ?? null,
      },
      alerta,
      asistencias,
      trabajosOtf,
    });
  } catch (e) {
    console.error("GET /api/vehiculo-historial error:", e);
    res.status(500).json({ error: "Error obteniendo historial" });
  }
});

/* =========================================================
   SEA ADMINISTRACIÓN — analizar imagen de impagado (devolución
   de recibo bancario) y extraer datos para crear el recobro
========================================================= */
app.post(
  "/api/administracion/analizar-impagado",
  upload.single("imagen"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ success: false, message: "No se recibió ninguna imagen." });
      }
      if (!req.file.mimetype.startsWith("image/")) {
        return res.status(400).json({ success: false, message: "El archivo debe ser una imagen." });
      }

      const base64 = req.file.buffer.toString("base64");
      const dataUrl = `data:${req.file.mimetype};base64,${base64}`;

      const systemPrompt = `Eres un extractor de datos de administración de un taller.
Recibirás la imagen de un aviso de devolución de recibo bancario o de una factura pendiente
(normalmente un email del banco o de contabilidad con campos como CLIENTE, FACTURA,
VENCIMIENTO, NOMINAL, GASTOS, TOTAL).

Responde SOLO con JSON válido, sin markdown, con esta estructura exacta:
{
  "clienteCodigo": string | null,      // código numérico del cliente si aparece (ej. "100506")
  "clienteNombre": string | null,      // razón social (ej. "DENIS EXPRESS CARGO, S.L.")
  "numeroFactura": string | null,      // número de la factura o recibo (ej. "0000001535")
  "vencimiento": string | null,        // fecha de vencimiento en formato ISO yyyy-mm-dd
  "numeroVencimiento": string | null,  // si la factura está partida en varios vencimientos, cuál es (ej. "2/3", "1/2"); null si no aparece
  "fechaContabilizacion": string | null, // FECHA CONTABILIZACIÓN del aviso en ISO yyyy-mm-dd
  "fechaFactura": string | null,       // fecha de emisión de la factura en ISO yyyy-mm-dd; SOLO si aparece explícitamente como fecha de factura (no confundir con la contabilización)
  "nominal": number | null,            // importe nominal en euros
  "gastos": number | null,             // gastos de devolución en euros
  "total": number | null,              // importe total en euros (nominal + gastos)
  "confianza": "alta" | "media" | "baja"
}

Reglas:
- Fechas tipo "30.06.26" o "2.07.26" son dd.mm.aa → conviértelas a ISO (2026-06-30, 2026-07-02).
- Importes en formato español "1.997,32" → 1997.32 (número, punto decimal).
- Si el total no aparece pero sí nominal y gastos, calcula total = nominal + gastos.
- Devuelve null en cualquier campo que no puedas leer con claridad.`;

      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: [
              { type: "text", text: "Extrae los datos del impagado de esta imagen:" },
              { type: "image_url", image_url: { url: dataUrl, detail: "high" } },
            ],
          },
        ],
        temperature: 0,
        max_tokens: 400,
      });

      const raw = response.choices[0]?.message?.content ?? "{}";
      const jsonTexto = limpiarJsonOpenAI(raw);

      let datos: any;
      try {
        datos = JSON.parse(jsonTexto);
      } catch {
        console.error("analizar-impagado: respuesta no parseable:", raw);
        return res.status(422).json({ success: false, message: "No se pudieron extraer datos de la imagen." });
      }

      return res.json({ success: true, datos });
    } catch (error) {
      console.error("Error en /api/administracion/analizar-impagado:", error);
      return res.status(500).json({ success: false, message: "Error analizando la imagen." });
    }
  }
);

/* =========================================================
   SEA ADMINISTRACIÓN — analizar captura de ficha de cliente
   (ERP GENES u otro) y extraer datos para el alta de cliente
========================================================= */
app.post(
  "/api/administracion/analizar-cliente",
  upload.array("imagenes", 8),
  async (req, res) => {
    try {
      const files = (req.files as Express.Multer.File[] | undefined) ?? [];
      if (!files.length) {
        return res.status(400).json({ success: false, message: "No se recibió ninguna imagen." });
      }
      if (files.some((f) => !f.mimetype.startsWith("image/"))) {
        return res.status(400).json({ success: false, message: "Todos los archivos deben ser imágenes." });
      }

      const dataUrls = files.map((f) => `data:${f.mimetype};base64,${f.buffer.toString("base64")}`);

      const systemPrompt = `Eres un extractor de datos de administración de un taller.
Recibirás UNA O VARIAS capturas de la MISMA ficha de cliente de un ERP (normalmente CEINOR GENES):
pueden ser distintas pestañas de la misma ficha ("Datos Generales", "Delegaciones", "Forma de Pago",
"Observ. y Coment."...). Combina la información de TODAS las capturas en un único cliente.
Campos habituales: "Código Cliente", "Nombre Comercial", "Nombre Fiscal", "Nº Documento" (NIF/CIF),
"Email Envio Docs", teléfonos, delegaciones con dirección y contactos.

Responde SOLO con JSON válido, sin markdown, con esta estructura exacta:
{
  "codigo": string | null,           // Código Cliente (ej. "100506")
  "nombre": string | null,           // Nombre fiscal o comercial (ej. "DENIS EXPRESS CARGO, S.L.")
  "nif": string | null,              // Nº Documento / NIF / CIF (ej. "B56809189")
  "telefono": string | null,         // teléfono principal o del contacto
  "email": string | null,            // email (ej. de "Email Envio Docs"), en minúsculas
  "contacto": string | null,         // nombre de la persona de contacto si aparece y es distinto de la razón social
  "formaPago": string | null,        // forma de pago si es visible (ej. "Giro bancario", "Transferencia")
  "confianza": "alta" | "media" | "baja"
}

Reglas:
- El código de cliente es numérico y suele estar junto a "Código Cliente".
- Devuelve el email en minúsculas.
- Si el contacto es la misma razón social, devuelve contacto = null.
- Si un dato aparece en varias capturas con valores distintos, prioriza el de "Datos Generales".
- Devuelve null en cualquier campo que no puedas leer con claridad.`;

      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: [
              { type: "text", text: `Extrae los datos del cliente combinando estas ${dataUrls.length} captura(s):` },
              ...dataUrls.map((url) => ({ type: "image_url" as const, image_url: { url, detail: "high" as const } })),
            ],
          },
        ],
        temperature: 0,
        max_tokens: 400,
      });

      const raw = response.choices[0]?.message?.content ?? "{}";
      const jsonTexto = limpiarJsonOpenAI(raw);

      let datos: any;
      try {
        datos = JSON.parse(jsonTexto);
      } catch {
        console.error("analizar-cliente: respuesta no parseable:", raw);
        return res.status(422).json({ success: false, message: "No se pudieron extraer datos de la imagen." });
      }

      return res.json({ success: true, datos });
    } catch (error) {
      console.error("Error en /api/administracion/analizar-cliente:", error);
      return res.status(500).json({ success: false, message: "Error analizando la imagen." });
    }
  }
);

/* =========================================================
   SEA ADMINISTRACIÓN — envíos automáticos de recobros
   (WhatsApp/email programados + avisos diarios).
   Requiere plantillas de WhatsApp aprobadas en Twilio:
   TWILIO_RECOBROS_CONTENT_SID (deudor) y
   TWILIO_RECOBROS_RESUMEN_SID (resumen interno).
========================================================= */

const RECOBROS_NOTIFY_HOUR = process.env.RECOBROS_NOTIFY_HOUR || "08:00";
const RECOBROS_CHECK_INTERVAL_MS = 5 * 60 * 1000;

function normalizarTelefonoWhatsApp(raw: string | null | undefined): string | null {
  const digits = String(raw ?? "").replace(/\D/g, "");
  if (!digits) return null;
  return digits.length === 9 ? `34${digits}` : digits;
}

function fmtEurServer(n: number): string {
  return Number(n).toLocaleString("es-ES", { style: "currency", currency: "EUR" });
}

function fmtFechaServer(iso: string | null): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric" });
}

async function enviarWhatsAppRecobro(
  telefono: string,
  variables: Record<string, string>,
  contentSidEnv: string
): Promise<string> {
  const contentSid = String(process.env[contentSidEnv] || "").trim();
  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) throw new Error("Twilio no configurado");
  if (!contentSid) throw new Error(`Falta la plantilla ${contentSidEnv}`);
  const baseUrl = String(process.env.PUBLIC_APP_URL || "https://sea-tarragona.onrender.com").replace(/\/+$/, "");
  const message = await twilioClient.messages.create({
    from: process.env.TWILIO_WHATSAPP_FROM || "whatsapp:+34610473079",
    to: `whatsapp:+${telefono}`,
    contentSid,
    contentVariables: JSON.stringify(variables),
    statusCallback: `${baseUrl}/api/administracion/whatsapp-status`,
  });
  return message.sid;
}

async function enviarEmailRecobro(destino: string, asunto: string, cuerpo: string) {
  const transport = getMailTransport();
  if (!transport) throw new Error("SMTP no configurado");
  await transport.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: destino,
    subject: asunto,
    text: cuerpo,
  });
}

async function procesarNotificacionesProgramadasRecobros(hoy: string) {
  const { rows } = await db.query(
    `SELECT n.id, n.recovery_case_id, n.canal, n.mensaje,
            cu.name AS cliente_nombre, cu.payment_contact_name AS contacto,
            COALESCE(cu.admin_phone, cu.phone) AS telefono,
            COALESCE(cu.admin_email, cu.email) AS email,
            inv.invoice_number AS factura, r.due_date::text AS vencimiento, r.pending_amount AS pendiente
     FROM adm_notificaciones n
     LEFT JOIN adm_recovery_cases r ON r.id = n.recovery_case_id
     LEFT JOIN adm_customers cu ON cu.id = r.customer_id
     LEFT JOIN adm_invoices inv ON inv.id = r.invoice_id
     WHERE n.estado = 'pendiente' AND n.fecha_programada <= $1
       AND n.canal IN ('whatsapp_deudor','whatsapp_deudor_aviso1','email_deudor')`,
    [hoy]
  );

  for (const n of rows) {
    try {
      if (Number(n.pendiente ?? 0) <= 0) {
        await db.query(
          `UPDATE adm_notificaciones SET estado='cancelado', error_text='Sin importe pendiente' WHERE id=$1`,
          [n.id]
        );
        continue;
      }
      const doc = n.factura ? `la factura ${n.factura}` : "el importe pendiente";
      let twilioSid: string | null = null;
      if (n.canal === "whatsapp_deudor" || n.canal === "whatsapp_deudor_aviso1") {
        const tel = normalizarTelefonoWhatsApp(n.telefono);
        if (!tel) throw new Error("Cliente sin teléfono");
        const contentSidEnv = n.canal === "whatsapp_deudor_aviso1" ? "TWILIO_RECOBROS_AVISO1_SID" : "TWILIO_RECOBROS_AVISO2_SID";
        twilioSid = await enviarWhatsAppRecobro(tel, {
          "1": n.contacto || n.cliente_nombre || "cliente",
          "2": n.factura || "pendiente",
          "3": fmtEurServer(Number(n.pendiente ?? 0)),
          "4": fmtFechaServer(n.vencimiento),
        }, contentSidEnv);
      } else {
        if (!n.email) throw new Error("Cliente sin email");
        const cuerpo =
          `Hola${n.contacto ? " " + n.contacto : ""},\n\n` +
          `Le recordamos que ${doc}, con vencimiento ${fmtFechaServer(n.vencimiento)}, ` +
          `tiene un importe pendiente de ${fmtEurServer(Number(n.pendiente ?? 0))}.\n\n` +
          (n.mensaje ? `${n.mensaje}\n\n` : "") +
          `Si ya ha realizado el pago, ignore este mensaje.\n\nGracias,\nAdministración Mobilink`;
        await enviarEmailRecobro(n.email, `Recordatorio de pago — ${doc}`, cuerpo);
      }
      await db.query(
        `UPDATE adm_notificaciones SET estado='enviado', enviado_at=now(), twilio_sid=$2, twilio_status=$3 WHERE id=$1`,
        [n.id, twilioSid, twilioSid ? "sent" : null]
      );
      if (n.recovery_case_id) {
        const esWhatsapp = n.canal === "whatsapp_deudor" || n.canal === "whatsapp_deudor_aviso1";
        await db.query(
          `INSERT INTO adm_recovery_actions (recovery_case_id, action_type, notes)
           VALUES ($1, $2, $3)`,
          [
            n.recovery_case_id,
            esWhatsapp ? "whatsapp" : "recordatorio_email",
            `Envío automático programado (${esWhatsapp ? "WhatsApp" : "email"})`,
          ]
        );
      }
      console.log(`[Recobros] enviado ${n.canal} · notificación ${n.id}`);
    } catch (e: any) {
      console.error(`[Recobros] error en notificación ${n.id}:`, e?.message);
      await db.query(
        `UPDATE adm_notificaciones SET estado='error', error_text=$2 WHERE id=$1`,
        [n.id, String(e?.message ?? e)]
      ).catch(() => {});
    }
  }
}

async function procesarAvisosDiariosRecobros(hoy: string) {
  // Deduplicación: si ya hay marcador de resumen para hoy, el trabajo diario ya corrió
  const marker = await db.query(
    `SELECT 1 FROM adm_notificaciones
     WHERE canal='resumen_interno' AND fecha_programada=$1 AND estado IN ('enviado','error') LIMIT 1`,
    [hoy]
  );
  if (marker.rows.length) return;

  // 1) WhatsApp al deudor cuando hoy vence su compromiso de pago
  const compromisos = await db.query(
    `SELECT r.id, r.pending_amount, r.due_date::text AS vencimiento,
            cu.name AS cliente_nombre, cu.payment_contact_name AS contacto,
            COALESCE(cu.admin_phone, cu.phone) AS telefono,
            inv.invoice_number AS factura
     FROM adm_recovery_cases r
     JOIN adm_customers cu ON cu.id = r.customer_id
     LEFT JOIN adm_invoices inv ON inv.id = r.invoice_id
     WHERE r.closed_at IS NULL AND r.status = 'compromiso_pago' AND r.next_action_date = $1`,
    [hoy]
  );
  for (const r of compromisos.rows) {
    try {
      const tel = normalizarTelefonoWhatsApp(r.telefono);
      if (!tel) continue;
      const sid = await enviarWhatsAppRecobro(tel, {
        "1": r.contacto || r.cliente_nombre || "cliente",
        "2": r.factura || "pendiente",
        "3": fmtEurServer(Number(r.pending_amount ?? 0)),
        "4": fmtFechaServer(r.vencimiento),
      }, "TWILIO_RECOBROS_AVISO2_SID");
      await db.query(
        `INSERT INTO adm_notificaciones (recovery_case_id, canal, destinatario, fecha_programada, estado, enviado_at, twilio_sid, twilio_status)
         VALUES ($1,'whatsapp_deudor',$2,$3,'enviado',now(),$4,'sent')`,
        [r.id, tel, hoy, sid]
      );
      await db.query(
        `INSERT INTO adm_recovery_actions (recovery_case_id, action_type, notes)
         VALUES ($1,'whatsapp','Recordatorio automático: hoy vence su compromiso de pago')`,
        [r.id]
      );
      console.log(`[Recobros] recordatorio de compromiso enviado · expediente ${r.id}`);
    } catch (e: any) {
      console.error(`[Recobros] error en compromiso ${r.id}:`, e?.message);
    }
  }

  // 2) Resumen interno por WhatsApp a los destinatarios configurados
  const resumen = await db.query(
    `SELECT
       (SELECT count(*) FROM adm_recovery_cases WHERE closed_at IS NULL AND status='compromiso_pago' AND next_action_date=$1) AS compromisos_hoy,
       (SELECT count(*) FROM adm_recovery_cases WHERE closed_at IS NULL AND next_action_date < $1) AS acciones_vencidas,
       (SELECT COALESCE(sum(pending_amount),0) FROM adm_recovery_cases WHERE closed_at IS NULL) AS total_pendiente,
       (SELECT count(*) FROM adm_payment_tracking WHERE closed_at IS NULL AND expected_payment_date=$1) AS pagos_previstos`,
    [hoy]
  );
  const s = resumen.rows[0];
  const texto =
    `Compromisos que vencen hoy: ${s.compromisos_hoy} · ` +
    `Acciones vencidas: ${s.acciones_vencidas} · ` +
    `Pagos previstos hoy: ${s.pagos_previstos} · ` +
    `Total pendiente en recobro: ${fmtEurServer(Number(s.total_pendiente))}`;

  const dest = await db.query(
    `SELECT nombre, telefono FROM adm_notificacion_destinatarios WHERE activo = true`
  );
  let enviados = 0;
  let errorTxt: string | null = null;
  for (const d of dest.rows) {
    try {
      const tel = normalizarTelefonoWhatsApp(d.telefono);
      if (!tel) continue;
      await enviarWhatsAppRecobro(tel, { "1": fmtFechaServer(hoy), "2": texto }, "TWILIO_RECOBROS_RESUMEN_SID");
      enviados++;
    } catch (e: any) {
      errorTxt = String(e?.message ?? e);
      console.error(`[Recobros] error enviando resumen a ${d.nombre}:`, e?.message);
    }
  }
  await db.query(
    `INSERT INTO adm_notificaciones (canal, destinatario, mensaje, fecha_programada, estado, enviado_at, error_text)
     VALUES ('resumen_interno',$1,$2,$3,$4,now(),$5)`,
    [
      `${enviados} destinatario(s)`,
      texto,
      hoy,
      enviados > 0 || dest.rows.length === 0 ? "enviado" : "error",
      errorTxt,
    ]
  );
  console.log(`[Recobros] resumen interno ${hoy}: ${texto} → ${enviados} enviado(s)`);
}

// Callback de Twilio con el estado de entrega de los WhatsApp de recobros
// (queued → sent → delivered → read / failed)
app.post(
  "/api/administracion/whatsapp-status",
  express.urlencoded({ extended: false }),
  async (req, res) => {
    try {
      const sid = String(req.body?.MessageSid || "").trim();
      const status = String(req.body?.MessageStatus || "").trim();
      if (sid && status) {
        await db.query(
          `UPDATE adm_notificaciones SET twilio_status = $2 WHERE twilio_sid = $1`,
          [sid, status]
        );
      }
      res.status(200).send("<Response></Response>");
    } catch (error) {
      console.error("POST /api/administracion/whatsapp-status error:", error);
      res.status(200).send("<Response></Response>");
    }
  }
);

// Escalada manual de cobro por WhatsApp (avisos 1 a 4, disparados a mano
// desde el expediente): 1) recibo devuelto, 2) recordatorio, 3) aviso previo
// de traslado a Crédito y Caución, 4) confirmación del traslado.
app.post("/api/administracion/recobro-whatsapp", async (req, res) => {
  try {
    const recoveryCaseId = String(req.body?.recoveryCaseId || "").trim();
    const aviso = Number(req.body?.aviso);
    if (!recoveryCaseId || ![1, 2, 3, 4].includes(aviso)) {
      return res.status(400).json({ success: false, message: "Datos inválidos" });
    }

    const { rows } = await db.query(
      `SELECT r.id, r.pending_amount, r.due_date::text AS vencimiento,
              cu.name AS cliente_nombre, cu.payment_contact_name AS contacto,
              COALESCE(cu.admin_phone, cu.phone) AS telefono,
              inv.invoice_number AS factura
       FROM adm_recovery_cases r
       JOIN adm_customers cu ON cu.id = r.customer_id
       LEFT JOIN adm_invoices inv ON inv.id = r.invoice_id
       WHERE r.id = $1`,
      [recoveryCaseId]
    );
    if (!rows.length) return res.status(404).json({ success: false, message: "Expediente no encontrado" });
    const r = rows[0];

    const tel = normalizarTelefonoWhatsApp(r.telefono);
    if (!tel) return res.status(400).json({ success: false, message: "El cliente no tiene teléfono" });
    if (Number(r.pending_amount ?? 0) <= 0) {
      return res.status(400).json({ success: false, message: "El expediente no tiene importe pendiente" });
    }

    const nombreContacto = r.contacto || r.cliente_nombre || "cliente";
    let contentSidEnv: string;
    let variables: Record<string, string>;
    let nuevoEstado: string;
    let actionType: string;

    if (aviso === 1) {
      contentSidEnv = "TWILIO_RECOBROS_AVISO1_SID";
      variables = {
        "1": nombreContacto, "2": r.factura || "pendiente",
        "3": fmtEurServer(Number(r.pending_amount ?? 0)), "4": fmtFechaServer(r.vencimiento),
      };
      nuevoEstado = "primer_aviso"; actionType = "primer_aviso";
    } else if (aviso === 2) {
      contentSidEnv = "TWILIO_RECOBROS_AVISO2_SID";
      variables = {
        "1": nombreContacto, "2": r.factura || "pendiente",
        "3": fmtEurServer(Number(r.pending_amount ?? 0)), "4": fmtFechaServer(r.vencimiento),
      };
      nuevoEstado = "segundo_aviso"; actionType = "segundo_aviso";
    } else if (aviso === 3) {
      contentSidEnv = "TWILIO_RECOBROS_AVISO3_SID";
      variables = { "1": nombreContacto };
      nuevoEstado = "aviso_credito_caucion"; actionType = "aviso_credito_caucion";
    } else {
      contentSidEnv = "TWILIO_RECOBROS_AVISO4_SID";
      variables = { "1": nombreContacto };
      nuevoEstado = "trasladado_credito_caucion"; actionType = "trasladado_credito_caucion";
    }

    const sid = await enviarWhatsAppRecobro(tel, variables, contentSidEnv);

    await db.query(
      `INSERT INTO adm_notificaciones (recovery_case_id, canal, destinatario, fecha_programada, estado, enviado_at, twilio_sid, twilio_status)
       VALUES ($1,'whatsapp_deudor',$2,current_date,'enviado',now(),$3,'sent')`,
      [recoveryCaseId, tel, sid]
    );
    await db.query(
      `INSERT INTO adm_recovery_actions (recovery_case_id, action_type, notes)
       VALUES ($1,$2,$3)`,
      [recoveryCaseId, actionType, `Aviso ${aviso} enviado por WhatsApp`]
    );
    await db.query(`UPDATE adm_recovery_cases SET status = $2 WHERE id = $1`, [recoveryCaseId, nuevoEstado]);

    res.json({ success: true });
  } catch (error: any) {
    console.error("Error en /api/administracion/recobro-whatsapp:", error);
    res.status(500).json({ success: false, message: error?.message || "Error enviando el aviso" });
  }
});

/* =========================================================
   USUARIOS UNIFICADOS — gestión de cuentas de Auth desde la
   pantalla Usuarios (solo administradores). El login es por
   USERNAME + contraseña; internamente Supabase Auth usa un
   email sintético {username}@usuarios.sea.
========================================================= */

// Verifica que quien llama es admin (superadmin de app_usuarios
// o rol admin de adm_usuarios) a partir de su token de sesión.
async function verificarAdminApp(req: express.Request): Promise<{ ok: boolean; userId?: string; error?: string }> {
  const auth = String(req.headers.authorization || "");
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return { ok: false, error: "Falta el token de sesión" };
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return { ok: false, error: "Sesión no válida" };
  const r = await db.query(
    `SELECT
       coalesce((SELECT es_superadmin FROM app_usuarios WHERE id = $1 AND activo), false)
       OR coalesce((SELECT rol = 'admin' FROM adm_usuarios WHERE id = $1 AND activo), false) AS es_admin`,
    [data.user.id]
  );
  if (!r.rows[0]?.es_admin) return { ok: false, error: "Solo un administrador puede gestionar usuarios" };
  return { ok: true, userId: data.user.id };
}

function emailSintetico(username: string): string {
  return `${username.trim().toLowerCase().replace(/[^a-z0-9._-]/g, "")}@usuarios.sea`;
}

// Crear cuenta de Auth para un usuario nuevo (la ficha y los accesos
// se guardan después vía RPC app_guardar_usuario desde el cliente).
app.post("/api/administracion/usuarios/crear-auth", async (req, res) => {
  try {
    const admin = await verificarAdminApp(req);
    if (!admin.ok) return res.status(403).json({ success: false, message: admin.error });

    const username = String(req.body?.username || "").trim();
    const nombre = String(req.body?.nombre || "").trim();
    const password = String(req.body?.password || "");
    if (username.length < 2) return res.status(400).json({ success: false, message: "Usuario demasiado corto" });
    if (password.length < 6) return res.status(400).json({ success: false, message: "Contraseña interna demasiado corta" });

    const { data, error } = await supabase.auth.admin.createUser({
      email: emailSintetico(username),
      password,
      email_confirm: true,
      user_metadata: { username, nombre },
    });
    if (error) {
      const msg = /already/i.test(error.message) ? "Ya existe un usuario con ese nombre" : error.message;
      return res.status(400).json({ success: false, message: msg });
    }
    return res.json({ success: true, userId: data.user?.id });
  } catch (e: any) {
    console.error("crear-auth error:", e);
    return res.status(500).json({ success: false, message: e?.message || "Error creando el usuario" });
  }
});

// Restablecer la contraseña de cualquier usuario (botón llave)
app.post("/api/administracion/usuarios/reset-password", async (req, res) => {
  try {
    const admin = await verificarAdminApp(req);
    if (!admin.ok) return res.status(403).json({ success: false, message: admin.error });

    const userId = String(req.body?.userId || "").trim();
    const password = String(req.body?.password || "");
    if (!userId) return res.status(400).json({ success: false, message: "Falta el usuario" });
    if (password.length < 6) return res.status(400).json({ success: false, message: "Contraseña interna demasiado corta" });

    const { error } = await supabase.auth.admin.updateUserById(userId, { password });
    if (error) return res.status(400).json({ success: false, message: error.message });
    return res.json({ success: true });
  } catch (e: any) {
    console.error("reset-password error:", e);
    return res.status(500).json({ success: false, message: e?.message || "Error cambiando la contraseña" });
  }
});

// Borrar la cuenta de Auth (solo tras app_eliminar_usuario = 'eliminado')
app.post("/api/administracion/usuarios/eliminar-auth", async (req, res) => {
  try {
    const admin = await verificarAdminApp(req);
    if (!admin.ok) return res.status(403).json({ success: false, message: admin.error });

    const userId = String(req.body?.userId || "").trim();
    if (!userId) return res.status(400).json({ success: false, message: "Falta el usuario" });
    if (userId === admin.userId) return res.status(400).json({ success: false, message: "No puedes eliminar tu propio usuario" });

    // seguridad extra: no borrar Auth si la ficha maestra sigue existiendo
    const r = await db.query(`SELECT 1 FROM app_usuarios WHERE id = $1`, [userId]);
    if (r.rows.length) return res.status(400).json({ success: false, message: "El usuario aún existe en la aplicación" });

    const { error } = await supabase.auth.admin.deleteUser(userId);
    if (error) return res.status(400).json({ success: false, message: error.message });
    return res.json({ success: true });
  } catch (e: any) {
    console.error("eliminar-auth error:", e);
    return res.status(500).json({ success: false, message: e?.message || "Error eliminando el usuario" });
  }
});

let recobrosNotifierRunning = false;
async function checkRecobrosNotifications() {
  if (recobrosNotifierRunning) return;
  recobrosNotifierRunning = true;
  try {
    const zoned = getZonedDateTimeParts(new Date(), AGENDA_TIME_ZONE);
    const [h, m] = RECOBROS_NOTIFY_HOUR.split(":").map(Number);
    if (zoned.minutesOfDay < h * 60 + (m || 0)) return;
    await procesarNotificacionesProgramadasRecobros(zoned.dateKey);
    await procesarAvisosDiariosRecobros(zoned.dateKey);
  } catch (e) {
    console.error("checkRecobrosNotifications error:", e);
  } finally {
    recobrosNotifierRunning = false;
  }
}

function startRecobrosNotifierChecker() {
  console.log(`Envíos automáticos de recobros activos (a partir de las ${RECOBROS_NOTIFY_HOUR}).`);
  void checkRecobrosNotifications();
  setInterval(() => { void checkRecobrosNotifications(); }, RECOBROS_CHECK_INTERVAL_MS);
}

/* =========================================================
   MOBILINK INTEGRATION HUB (API Gateway bajo /api/v1)
   Debe montarse ANTES del catch-all SPA para no quedar tapado.
========================================================= */

mountIntegrationHub(app);

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
   START SERVER
========================================================= */
initDb()
  .then(() => initIntegrationHub())
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Servidor backend en puerto ${PORT}`);
      startAgendaWhatsAppReminderChecker();
      startWorkshopAutoStandbyChecker();
      startRecobrosNotifierChecker();
      startWebfleetSync(); // sincronización periódica de "vehículos en base"
      startMantenimientoAvisos(); // avisos automáticos de revisiones (próximas/vencidas)
      startIntegrationWorker(); // reproceso de operaciones de integración RETRY_PENDING
    });
  })
  .catch((error) => {
    console.error("Error inicializando base de datos:", error);
    process.exit(1);
  });
