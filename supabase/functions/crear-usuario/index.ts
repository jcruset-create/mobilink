// Edge Function: crear-usuario
// Crea un usuario de Auth + su fila en `usuarios`. Solo lo puede llamar
// un administrador (de su empresa) o un super-admin (cualquier empresa).
// Requiere secretos: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY
//
// Deploy:  supabase functions deploy crear-usuario
//
// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Cliente con el JWT del que llama → para saber QUIÉN pide el alta
    const authHeader = req.headers.get("Authorization") ?? "";
    const asCaller = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
    const { data: { user: caller } } = await asCaller.auth.getUser();
    if (!caller) return json({ error: "No autenticado" }, 401);

    // Perfil del que llama (con service role, sin RLS)
    const admin = createClient(url, service);
    const { data: perfil } = await admin.from("usuarios").select("rol, empresa_id, es_superadmin, activo").eq("id", caller.id).single();
    if (!perfil || !perfil.activo) return json({ error: "Perfil no válido" }, 403);
    const esSuper = perfil.es_superadmin === true;
    const esAdmin = perfil.rol === "administrador";
    if (!esSuper && !esAdmin) return json({ error: "Permisos insuficientes" }, 403);

    const body = await req.json();
    const nombre = String(body.nombre ?? "").trim();
    const email = String(body.email ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");
    const rol = String(body.rol ?? "cliente");
    const accesoApk = Boolean(body.acceso_apk ?? false);
    const accesoPanel = Boolean(body.acceso_panel ?? true);
    // Un admin normal solo puede crear en SU empresa; el super-admin en la que indique.
    const empresaId = esSuper ? String(body.empresa_id ?? perfil.empresa_id) : perfil.empresa_id;

    if (!nombre || !email || !password) return json({ error: "Nombre, email y contraseña son obligatorios" }, 400);
    if (!["administrador", "operador", "cliente"].includes(rol)) return json({ error: "Rol no válido" }, 400);

    // 1) Crear usuario de Auth (confirmado)
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email, password, email_confirm: true,
    });
    if (createErr || !created.user) return json({ error: createErr?.message ?? "No se pudo crear el usuario" }, 400);

    // 2) Crear fila de perfil
    const { error: insErr } = await admin.from("usuarios").insert({
      id: created.user.id,
      empresa_id: empresaId,
      nombre, email, rol,
      acceso_apk: accesoApk,
      acceso_panel: accesoPanel,
      es_superadmin: false,
      activo: true,
    });
    if (insErr) {
      // rollback del auth user si falla el perfil
      await admin.auth.admin.deleteUser(created.user.id);
      return json({ error: insErr.message }, 400);
    }

    return json({ ok: true, id: created.user.id });
  } catch (e: any) {
    return json({ error: e?.message ?? "Error interno" }, 500);
  }
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status, headers: { ...cors, "Content-Type": "application/json" },
  });
}
