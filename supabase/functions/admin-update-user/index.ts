// deno-lint-ignore-file no-import-prefix
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type ActualizarUsuarioPayload = {
  perfil_id: string;
  nombre?: string;
  email?: string;
  password?: string;
  codigo_operario?: string;
  rol?: "admin" | "responsable" | "operario";
  ubicacion?: string;
  activo?: boolean;
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

function limpiarEmail(email: string) {
  return email.trim().toLowerCase();
}

function limpiarCodigo(codigo: string) {
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

  const { data: perfilAdmin, error: perfilAdminError } = await supabaseUser
    .from("perfiles_usuario")
    .select("id, rol, activo")
    .or(`user_id.eq.${user.id},email.eq.${user.email}`)
    .eq("activo", true)
    .maybeSingle();

  if (perfilAdminError) {
    return jsonResponse(
      { error: `Error comprobando admin: ${perfilAdminError.message}` },
      500
    );
  }

  if (!perfilAdmin || perfilAdmin.rol !== "admin") {
    return jsonResponse(
      { error: "Solo un usuario admin puede editar usuarios." },
      403
    );
  }

  let body: ActualizarUsuarioPayload;

  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Body JSON inválido." }, 400);
  }

  if (!body.perfil_id) {
    return jsonResponse({ error: "perfil_id es obligatorio." }, 400);
  }

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

  const { data: perfilActual, error: perfilActualError } = await supabaseAdmin
    .from("perfiles_usuario")
    .select("id,user_id,nombre,email,codigo_operario,rol,ubicacion,activo")
    .eq("id", body.perfil_id)
    .single();

  if (perfilActualError || !perfilActual) {
    return jsonResponse(
      {
        error:
          perfilActualError?.message || "No se encontró el perfil de usuario.",
      },
      404
    );
  }

  const nuevoNombre =
    typeof body.nombre === "string" ? body.nombre.trim() : perfilActual.nombre;

  const nuevoEmail =
    typeof body.email === "string" && body.email.trim()
      ? limpiarEmail(body.email)
      : perfilActual.email;

  const nuevoCodigo =
    typeof body.codigo_operario === "string" && body.codigo_operario.trim()
      ? limpiarCodigo(body.codigo_operario)
      : perfilActual.codigo_operario;

  const nuevoRol = body.rol || perfilActual.rol;
  const nuevaUbicacion =
    typeof body.ubicacion === "string" && body.ubicacion.trim()
      ? body.ubicacion.trim()
      : perfilActual.ubicacion;

  const nuevoActivo =
    typeof body.activo === "boolean" ? body.activo : perfilActual.activo;

  if (nuevoRol && !["admin", "responsable", "operario"].includes(nuevoRol)) {
    return jsonResponse({ error: "Rol no válido." }, 400);
  }

  if (body.password && body.password.length < 6) {
    return jsonResponse(
      { error: "La nueva contraseña debe tener al menos 6 caracteres." },
      400
    );
  }

  let authUserId = perfilActual.user_id as string | null;

  if (!authUserId && perfilActual.email) {
    const { data: usersList, error: listError } =
      await supabaseAdmin.auth.admin.listUsers();

    if (listError) {
      return jsonResponse(
        { error: `Error buscando usuario Auth: ${listError.message}` },
        500
      );
    }

const usuarioAuth = usersList.users.find(
  (item: { id: string; email?: string }) =>
    item.email?.toLowerCase() === perfilActual.email?.toLowerCase()
);

    authUserId = usuarioAuth?.id || null;
  }

  if (!authUserId) {
    return jsonResponse(
      {
        error:
          "Este perfil no está vinculado a un usuario Auth. Crea el usuario Auth o vincula user_id.",
      },
      400
    );
  }

  const authUpdate: {
    email?: string;
    password?: string;
    user_metadata?: Record<string, unknown>;
  } = {
    user_metadata: {
      nombre: nuevoNombre,
      codigo_operario: nuevoCodigo,
      rol: nuevoRol,
      ubicacion: nuevaUbicacion,
    },
  };

  if (nuevoEmail && nuevoEmail !== perfilActual.email) {
    authUpdate.email = nuevoEmail;
  }

  if (body.password) {
    authUpdate.password = body.password;
  }

  const { error: authUpdateError } =
    await supabaseAdmin.auth.admin.updateUserById(authUserId, authUpdate);

  if (authUpdateError) {
    return jsonResponse(
      { error: `Error actualizando Auth: ${authUpdateError.message}` },
      400
    );
  }

  const { data: perfilActualizado, error: perfilUpdateError } =
    await supabaseAdmin
      .from("perfiles_usuario")
      .update({
        user_id: authUserId,
        nombre: nuevoNombre,
        email: nuevoEmail,
        codigo_operario: nuevoCodigo,
        rol: nuevoRol,
        ubicacion: nuevaUbicacion,
        activo: nuevoActivo,
      })
      .eq("id", body.perfil_id)
      .select("id,user_id,nombre,email,codigo_operario,rol,ubicacion,activo")
      .single();

  if (perfilUpdateError) {
    return jsonResponse(
      {
        error: `Auth actualizado, pero error actualizando perfil: ${perfilUpdateError.message}`,
      },
      500
    );
  }

  return jsonResponse({
    ok: true,
    perfil: perfilActualizado,
    password_actualizada: Boolean(body.password),
  });
});