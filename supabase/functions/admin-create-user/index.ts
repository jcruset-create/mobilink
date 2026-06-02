import { serve } from "@std/http/server";
import { createClient } from "@supabase/supabase-js";

type CrearUsuarioPayload = {
  nombre: string;
  email: string;
  password: string;
  codigo_operario: string;
  rol: "admin" | "responsable" | "operario";
  ubicacion: string;
  clientes_ids?: string[];
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function normalizarEmail(email: string) {
  return email.trim().toLowerCase();
}

function normalizarCodigo(codigo: string) {
  return codigo.trim().toUpperCase();
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Método no permitido." }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return jsonResponse(
      {
        error:
          "Faltan variables SUPABASE_URL, SUPABASE_ANON_KEY o SUPABASE_SERVICE_ROLE_KEY.",
      },
      500
    );
  }

  const authorization = req.headers.get("Authorization");

  if (!authorization) {
    return jsonResponse({ error: "Falta cabecera Authorization." }, 401);
  }

  const supabaseUser = createClient(supabaseUrl, anonKey, {
    global: {
      headers: {
        Authorization: authorization,
      },
    },
  });

  const {
    data: { user },
    error: userError,
  } = await supabaseUser.auth.getUser();

  if (userError || !user) {
    return jsonResponse({ error: "Sesión no válida." }, 401);
  }

  const { data: perfilAdmin, error: perfilError } = await supabaseUser
    .from("perfiles_usuario")
    .select("id, rol, activo")
    .or(`user_id.eq.${user.id},email.eq.${user.email}`)
    .eq("activo", true)
    .maybeSingle();

  if (perfilError) {
    return jsonResponse(
      { error: `Error comprobando perfil admin: ${perfilError.message}` },
      500
    );
  }

  if (!perfilAdmin || perfilAdmin.rol !== "admin") {
    return jsonResponse(
      { error: "Solo un usuario admin puede crear usuarios." },
      403
    );
  }

  let body: CrearUsuarioPayload;

  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Body JSON inválido." }, 400);
  }

  const nombre = body.nombre?.trim();
  const email = normalizarEmail(body.email || "");
  const password = body.password || "";
  const codigoOperario = normalizarCodigo(body.codigo_operario || "");
  const rol = body.rol;
  const ubicacion = body.ubicacion?.trim();
  const clientesIds = Array.isArray(body.clientes_ids)
    ? body.clientes_ids.filter(Boolean)
    : [];

  if (!nombre || !email || !password || !codigoOperario || !rol || !ubicacion) {
    return jsonResponse(
      {
        error:
          "Nombre, email, password, código operario, rol y ubicación son obligatorios.",
      },
      400
    );
  }

  if (!["admin", "responsable", "operario"].includes(rol)) {
    return jsonResponse({ error: "Rol no válido." }, 400);
  }

  if (password.length < 6) {
    return jsonResponse(
      { error: "La contraseña temporal debe tener al menos 6 caracteres." },
      400
    );
  }

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

  const { data: userCreado, error: createUserError } =
    await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        nombre,
        codigo_operario: codigoOperario,
        rol,
        ubicacion,
      },
    });

  if (createUserError) {
    return jsonResponse(
      { error: `Error creando usuario Auth: ${createUserError.message}` },
      400
    );
  }

  const authUserId = userCreado.user?.id;

  if (!authUserId) {
    return jsonResponse(
      { error: "Usuario Auth creado sin ID. Revisa Supabase Auth." },
      500
    );
  }

  const { data: perfilCreado, error: perfilUpsertError } = await supabaseAdmin
    .from("perfiles_usuario")
    .upsert(
      {
        user_id: authUserId,
        nombre,
        email,
        codigo_operario: codigoOperario,
        rol,
        ubicacion,
        activo: true,
      },
      {
        onConflict: "email",
      }
    )
    .select("id, nombre, email, codigo_operario, rol, ubicacion, activo")
    .single();

  if (perfilUpsertError) {
    return jsonResponse(
      {
        error: `Usuario Auth creado, pero error creando perfil: ${perfilUpsertError.message}`,
      },
      500
    );
  }

  if (clientesIds.length > 0) {
    const asignaciones = clientesIds.map((clienteId) => ({
      perfil_usuario_id: perfilCreado.id,
      cliente_id: clienteId,
      activo: true,
    }));

    const { error: clientesError } = await supabaseAdmin
      .from("usuario_clientes")
      .upsert(asignaciones, {
        onConflict: "perfil_usuario_id,cliente_id",
      });

    if (clientesError) {
      return jsonResponse(
        {
          error: `Usuario creado, pero error asignando clientes: ${clientesError.message}`,
        },
        500
      );
    }
  }

  return jsonResponse({
    ok: true,
    usuario: {
      auth_user_id: authUserId,
      perfil: perfilCreado,
      clientes_asignados: clientesIds.length,
    },
  });
});