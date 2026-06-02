import { supabase } from "./supabase";

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
  esAdmin: boolean;
  esResponsable: boolean;
  esOperario: boolean;
  ubicacion: string | null;
};

export const permisosIniciales: PermisosAlmacen = {
  perfil: null,
  clientesPermitidos: [],
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
  clientesPermitidos: ClientePermitido[]
): PermisosAlmacen {
  if (!perfil) {
    return permisosIniciales;
  }

  const rol = perfil.rol || "operario";

  return {
    perfil,
    clientesPermitidos,
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

  const { data: perfilData, error: perfilError } = await supabase
    .from("perfiles_usuario")
    .select("id,user_id,nombre,email,codigo_operario,rol,ubicacion,activo")
    .or(`user_id.eq.${user.id},email.eq.${user.email}`)
    .eq("activo", true)
    .maybeSingle();

  if (perfilError || !perfilData) {
    return permisosIniciales;
  }

  const perfil = perfilData as PerfilAlmacen;
  const clientesPermitidos = await cargarClientesPermitidos(perfil.id);

  return construirPermisos(perfil, clientesPermitidos);
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