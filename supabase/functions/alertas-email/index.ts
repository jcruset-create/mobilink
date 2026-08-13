import { serve } from "@std/http/server";
import { createClient } from "@supabase/supabase-js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL     = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const RESEND_API_KEY   = Deno.env.get("RESEND_API_KEY")!;
  const EMAIL_TO         = Deno.env.get("ALERTAS_EMAIL_DESTINO") ?? "admin@seaplatform.com";
  const EMAIL_FROM       = Deno.env.get("ALERTAS_EMAIL_FROM") ?? "alertas@seaplatform.com";

  if (!RESEND_API_KEY) return jsonResponse({ error: "RESEND_API_KEY no configurado." }, 500);

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE);

  const hoy    = new Date();
  const en30   = new Date(hoy); en30.setDate(en30.getDate() + 30);
  const hoyStr = hoy.toISOString().slice(0, 10);
  const en30Str = en30.toISOString().slice(0, 10);

  // ── Consultas en paralelo ──────────────────────────────────────────────────
  const [
    { data: certsExp },
    { data: autsExp },
    { data: formExp },
    { data: episRaw },
    { data: herrsVencidas },
    { data: incidenciasCrit },
    { data: inspeccionesCrit },
  ] = await Promise.all([
    supabase.from("sea_employee_certifications")
      .select("nombre, fecha_caducidad, sea_employees(nombre)")
      .lte("fecha_caducidad", en30Str).gte("fecha_caducidad", hoyStr).limit(20),

    supabase.from("sea_employee_authorizations")
      .select("fecha_caducidad, sea_employees(nombre), sea_authorizations(nombre)")
      .lte("fecha_caducidad", en30Str).gte("fecha_caducidad", hoyStr).limit(20),

    supabase.from("sea_training_records")
      .select("nombre_curso, fecha_caducidad, sea_employees(nombre)")
      .lte("fecha_caducidad", en30Str).gte("fecha_caducidad", hoyStr).limit(20),

    supabase.from("sm_epis").select("nombre, stock_actual, stock_minimo").eq("activo", true),

    supabase.from("tc_tools")
      .select("nombre, proxima_revision")
      .eq("activa", true).lt("proxima_revision", hoyStr).not("proxima_revision", "is", null).limit(20),

    supabase.from("tc_incidents")
      .select("titulo, created_at").eq("estado", "abierta").eq("gravedad", "alta").limit(20),

    supabase.from("sm_inspections")
      .select("titulo, fecha_inspeccion").eq("resultado", "critico").is("fecha_cierre", null).limit(20),
  ]);

  const episBajo = (episRaw ?? []).filter((e) => e.stock_actual <= e.stock_minimo);

  // ── Construir secciones del email ──────────────────────────────────────────
  type Fila = { nivel: "🔴" | "🟠"; texto: string };
  const filas: Fila[] = [];

  const dias = (fecha: string) =>
    Math.ceil((new Date(fecha).getTime() - hoy.getTime()) / 86400000);

  for (const c of certsExp ?? []) {
    const d = dias(c.fecha_caducidad);
    filas.push({ nivel: d <= 7 ? "🔴" : "🟠",
      texto: `[Core] Certificación "${c.nombre}" de ${(c as any).sea_employees?.nombre ?? "?"} caduca en ${d} días` });
  }
  for (const a of autsExp ?? []) {
    const d = dias(a.fecha_caducidad);
    filas.push({ nivel: d <= 7 ? "🔴" : "🟠",
      texto: `[Core] Autorización "${(a as any).sea_authorizations?.nombre}" de ${(a as any).sea_employees?.nombre ?? "?"} caduca en ${d} días` });
  }
  for (const f of formExp ?? []) {
    const d = dias(f.fecha_caducidad);
    filas.push({ nivel: d <= 7 ? "🔴" : "🟠",
      texto: `[Core] Formación "${f.nombre_curso}" de ${(f as any).sea_employees?.nombre ?? "?"} caduca en ${d} días` });
  }
  for (const e of episBajo) {
    filas.push({ nivel: e.stock_actual === 0 ? "🔴" : "🟠",
      texto: `[Safety] EPI "${e.nombre}": stock ${e.stock_actual} (mínimo ${e.stock_minimo})` });
  }
  for (const h of herrsVencidas ?? []) {
    const d = Math.ceil((hoy.getTime() - new Date(h.proxima_revision).getTime()) / 86400000);
    filas.push({ nivel: d > 30 ? "🔴" : "🟠",
      texto: `[ToolControl] Revisión vencida: "${h.nombre}" (hace ${d} días)` });
  }
  for (const i of incidenciasCrit ?? []) {
    filas.push({ nivel: "🔴",
      texto: `[ToolControl] Incidencia alta sin resolver: "${i.titulo}"` });
  }
  for (const ins of inspeccionesCrit ?? []) {
    filas.push({ nivel: "🔴",
      texto: `[Safety] Inspección crítica pendiente: "${ins.titulo}"` });
  }

  if (filas.length === 0) {
    return jsonResponse({ ok: true, enviado: false, motivo: "Sin alertas activas." });
  }

  // Ordenar críticas primero
  filas.sort((a, b) => (a.nivel === "🔴" ? -1 : 1) - (b.nivel === "🔴" ? -1 : 1));

  const criticas = filas.filter((f) => f.nivel === "🔴").length;
  const avisos   = filas.filter((f) => f.nivel === "🟠").length;

  const listaHtml = filas
    .map((f) => `<li style="margin-bottom:6px">${f.nivel} ${f.texto}</li>`)
    .join("");

  const html = `
    <!DOCTYPE html><html lang="es"><body style="font-family:Arial,sans-serif;color:#111827;max-width:600px;margin:0 auto;padding:20px">
    <div style="background:#111827;color:white;padding:16px 20px;border-radius:12px 12px 0 0">
      <h1 style="margin:0;font-size:18px">⚠️ SEA Platform · Resumen de alertas</h1>
      <p style="margin:4px 0 0;font-size:12px;opacity:.7">${hoy.toLocaleDateString("es-ES", { weekday:"long", year:"numeric", month:"long", day:"numeric" })}</p>
    </div>
    <div style="border:1px solid #e5e7eb;border-top:none;padding:20px;border-radius:0 0 12px 12px">
      <p style="margin:0 0 16px">
        Se han detectado <strong style="color:#dc2626">${criticas} alerta${criticas !== 1 ? "s" : ""} crítica${criticas !== 1 ? "s" : ""}</strong>
        ${avisos > 0 ? ` y <strong style="color:#d97706">${avisos} aviso${avisos !== 1 ? "s" : ""}</strong>` : ""} que requieren atención:
      </p>
      <ul style="padding-left:16px;margin:0 0 20px">${listaHtml}</ul>
      <a href="${Deno.env.get("APP_URL") ?? "https://sea-tarragona.onrender.com"}/sea"
        style="display:inline-block;background:#111827;color:white;padding:10px 20px;border-radius:8px;text-decoration:none;font-size:13px;font-weight:bold">
        Ver en SEA Platform →
      </a>
      <p style="margin:20px 0 0;font-size:11px;color:#9ca3af">
        Este email se envía automáticamente cada día a las 8:00h.<br>
        SEA Platform · Sistema de gestión industrial
      </p>
    </div>
    </body></html>
  `;

  // ── Enviar con Resend ──────────────────────────────────────────────────────
  const resendRes = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_API_KEY}` },
    body: JSON.stringify({
      from: EMAIL_FROM,
      to:   EMAIL_TO.split(",").map((e) => e.trim()),
      subject: `⚠️ SEA Platform: ${criticas} alerta${criticas !== 1 ? "s" : ""} crítica${criticas !== 1 ? "s" : ""} — ${hoy.toLocaleDateString("es-ES")}`,
      html,
    }),
  });

  if (!resendRes.ok) {
    const err = await resendRes.text();
    return jsonResponse({ error: "Error enviando email", detalle: err }, 500);
  }

  return jsonResponse({ ok: true, enviado: true, alertas: filas.length, criticas, avisos });
});
