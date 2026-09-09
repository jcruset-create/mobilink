import { supabase } from "./supabase";
import { esSuperadmin } from "../../superadmin";
import { resolverRolAlmacen, type OrigenRol, type RolResuelto } from "./rolAlmacen";

export type PerfilAlmacen = {
  id: string;
  user_id: string | null;
  nombre: string | null;
  email: string | null;
  codigo_operario: string | null;
  rol: string | null;
  ubicacion: string | null;
  activo: boolean | null;
};

export type ClientePermitido = {
  id: string;
  nombre: string;
};

export type PermisosAlmacen = {
  perfil: PerfilAlmacen | null;
  clientesPermitidos: ClientePermitido[];
  /** De dónde salió el rol efectivo: Core, ficha heredada o superadmin. */
  origenRol: OrigenRol;
  esAdmin: boolean;
  esResponsable: boolean;
  esOperario: boolean;
  ubicacion: string | null;
};

export const permisosIniciales: PermisosAlmacen = {
  perfil: null,
  clientesPermitidos: [],
  origenRol: "ninguno",
  esAdmin: false,
  esResponsable: false,
  esOperario: false,
  ubicacion: null,
};

function obtenerPrimero<T>(valor: T | T[] | null): T | null {
  if (!valor) return null;
  if (Array.isArray(valor)) return valor[0] || null;
  return valor;
}

async function cargarClientesPermitidos(
  perfilId: string
): Promise<ClientePermitido[]> {
  const { data } = await supabase
    .from("usuario_clientes")
    .select(`
      id,
      cliente_id,
      clientes (
        id,
        nombre
      )
    `)
    .eq("perfil_usuario_id", perfilId)
    .eq("activo", true);

  return (data || [])
    .map((item) => {
      const cliente = obtenerPrimero(
        item.clientes as
          | {
              id: string;
              nombre: string;
            }
          | {
              id: string;
              nombre: string;
            }[]
          | null
      );

      if (!cliente) return null;

      return {
        id: cliente.id,
        nombre: cliente.nombre,
      };
    })
    .filter(Boolean) as ClientePermitido[];
}

function construirPermisos(
  perfil: PerfilAlmacen | null,
  clientesPermitidos: ClientePermitido[],
  // Rol ya resuelto (paso 1 de la unificación). Si no se pasa, se usa el de la
  // ficha del módulo, que es lo que hacían las vías heredadas (APK por código).
  rolResuelto?: RolResuelto
): PermisosAlmacen {
  if (!perfil) {
    return permisosIniciales;
  }

  const rol = rolResuelto ? rolResuelto.rol : perfil.rol || "operario";

  return {
    perfil,
    clientesPermitidos,
    origenRol: rolResuelto?.origen ?? "legacy",
    esAdmin: rol === "admin",
    esResponsable: rol === "responsable",
    esOperario: rol === "operario",
    ubicacion: perfil.ubicacion,
  };
}

export async function cargarPermisosUsuarioActual(): Promise<PermisosAlmacen> {
  const { data: sessionData, error: sessionError } =
    await supabase.auth.getSession();

  if (sessionError || !sessionData.session?.user) {
    return permisosIniciales;
  }

  const user = sessionData.session.user;

  // El rol sale de Core (`app_usuario_modulos`), que es lo que gestiona
  // Administración → Usuarios. La ficha del módulo se sigue leyendo porque
  // aporta lo suyo: ubicación, código de operario y los clientes asignados.
  const [{ data: accesoCore }, { data: perfilData, error: perfilError }, superadmin] =
    await Promise.all([
      supabase
        .from("app_usuario_modulos")
        .select("rol")
        .eq("user_id", user.id)
        .eq("modulo", "almacen")
        .maybeSingle(),
      supabase
        .from("perfiles_usuario")
        .select("id,user_id,nombre,email,codigo_operario,rol,ubicacion,activo")
        .or(`user_id.eq.${user.id},email.eq.${user.email}`)
        .eq("activo", true)
        .maybeSingle(),
      esSuperadmin(user.id),
    ]);

  const rolResuelto = resolverRolAlmacen(
    accesoCore?.rol,
    perfilError ? null : (perfilData as PerfilAlmacen | null)?.rol,
    superadmin
  );

  if (!rolResuelto.rol) {
    return permisosIniciales;
  }

  if (perfilError || !perfilData) {
    // Con acceso concedido en Core (o siendo superadmin) se entra aunque no
    // exista ficha en perfiles_usuario: la ficha es un satélite del módulo, no
    // la fuente de la identidad.
    return construirPermisos(
      {
        id: `core:${user.id}`,
        user_id: user.id,
        nombre: user.email ?? "Usuario",
        email: user.email ?? "",
        codigo_operario: null,
        rol: rolResuelto.rol,
        ubicacion: null,
        activo: true,
      } as unknown as PerfilAlmacen,
      [],
      rolResuelto
    );
  }

  const perfil = perfilData as PerfilAlmacen;
  const clientesPermitidos = await cargarClientesPermitidos(perfil.id);

  return construirPermisos(perfil, clientesPermitidos, rolResuelto);
}

export async function cargarPermisosPorCodigoOperario(
  codigoOperario: string
): Promise<PermisosAlmacen> {
  const codigo = codigoOperario.trim().toUpperCase();

  if (!codigo) {
    return permisosIniciales;
  }

  const { data: perfilData, error: perfilError } = await supabase
    .from("perfiles_usuario")
    .select("id,user_id,nombre,email,codigo_operario,rol,ubicacion,activo")
    .eq("codigo_operario", codigo)
    .eq("activo", true)
    .maybeSingle();

  if (perfilError || !perfilData) {
    return permisosIniciales;
  }

  const perfil = perfilData as PerfilAlmacen;
  const clientesPermitidos = await cargarClientesPermitidos(perfil.id);

  return construirPermisos(perfil, clientesPermitidos);
}

export function usuarioPuedeUsarCliente(
  permisos: PermisosAlmacen,
  clienteId: string | null
) {
  if (!permisos.perfil) return false;
  if (permisos.esAdmin) return true;
  if (!clienteId) return true;

  return permisos.clientesPermitidos.some((cliente) => cliente.id === clienteId);
}

export function usuarioPuedeUsarUbicacion(
  permisos: PermisosAlmacen,
  ubicacion: string | null
) {
  if (!permisos.perfil) return false;
  if (permisos.esAdmin) return true;
  if (!ubicacion) return true;
  if (!permisos.ubicacion) return false;

  return permisos.ubicacion === ubicacion;
}