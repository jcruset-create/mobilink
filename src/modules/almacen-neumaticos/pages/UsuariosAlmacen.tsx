import { useEffect, useState } from "react";
import AlmacenMenu from "../components/AlmacenMenu";
import { supabase } from "../services/supabase";
import { usePermisosAlmacen } from "../hooks/usePermisosAlmacen";
import { registrarAuditoria } from "../services/auditoriaAlmacen";
import {
  exportarCsv,
  exportarExcel,
  type FilaExportacion,
} from "../services/exportAlmacen";

type PerfilUsuario = {
  id: string;
  user_id: string | null;
  nombre: string | null;
  email: string | null;
  codigo_operario: string | null;
  rol: string | null;
  ubicacion: string | null;
  activo: boolean | null;
};

type Cliente = {
  id: string;
  nombre: string;
};

type UsuarioCliente = {
  id: string;
  perfil_usuario_id: string | null;
  cliente_id: string | null;
  activo: boolean | null;
  perfiles_usuario:
    | {
        nombre: string | null;
        email: string | null;
        codigo_operario: string | null;
      }
    | {
        nombre: string | null;
        email: string | null;
        codigo_operario: string | null;
      }[]
    | null;
  clientes:
    | {
        nombre: string;
      }
    | {
        nombre: string;
      }[]
    | null;
};

const ROLES = ["admin", "responsable", "operario"];

const UBICACIONES = [
  "Almacén Central Tarragona",
  "Base Reus",
  "Base Vilanova",
  "Taller Tarragona",
  "Central Alicante",
];

function obtenerPrimero<T>(valor: T | T[] | null): T | null {
  if (!valor) return null;
  if (Array.isArray(valor)) return valor[0] || null;
  return valor;
}

async function obtenerDetalleErrorFuncion(error: unknown) {
  let detalle = error instanceof Error ? error.message : "Error desconocido.";

  const posibleError = error as {
    context?: Response;
    message?: string;
  };

  if (posibleError.context) {
    try {
      const texto = await posibleError.context.text();

      try {
        const json = JSON.parse(texto);
        detalle = json.error || texto || detalle;
      } catch {
        detalle = texto || detalle;
      }
    } catch {
      detalle = posibleError.message || detalle;
    }
  }

  return detalle;
}

export default function UsuariosAlmacen() {
  const { permisos, cargandoPermisos, errorPermisos, recargarPermisos } =
    usePermisosAlmacen();

  const [usuarios, setUsuarios] = useState<PerfilUsuario[]>([]);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [usuarioClientes, setUsuarioClientes] = useState<UsuarioCliente[]>([]);

  const [nombre, setNombre] = useState("");
  const [email, setEmail] = useState("");
  const [passwordTemporal, setPasswordTemporal] = useState("");
  const [codigoOperario, setCodigoOperario] = useState("");
  const [rol, setRol] = useState("operario");
  const [ubicacion, setUbicacion] = useState("");
  const [clientesNuevoUsuarioIds, setClientesNuevoUsuarioIds] = useState<
    string[]
  >([]);

  const [usuarioSeleccionadoId, setUsuarioSeleccionadoId] = useState("");
  const [clienteSeleccionadoId, setClienteSeleccionadoId] = useState("");

  const [mensaje, setMensaje] = useState("");
  const [creandoUsuario, setCreandoUsuario] = useState(false);
  const [passwordsPorUsuario, setPasswordsPorUsuario] = useState<
    Record<string, string>
  >({});

  useEffect(() => {
    cargarDatos();
  }, []);

  async function cargarDatos() {
    setMensaje("");

    await cargarUsuarios();
    await cargarClientes();
    await cargarUsuarioClientes();
  }

  async function cargarUsuarios() {
    const { data, error } = await supabase
      .from("perfiles_usuario")
      .select("id,user_id,nombre,email,codigo_operario,rol,ubicacion,activo")
      .order("nombre");

    if (error) {
      setMensaje(`Error usuarios: ${error.message}`);
      return;
    }

    setUsuarios((data || []) as PerfilUsuario[]);
  }

  async function cargarClientes() {
    const { data, error } = await supabase
      .from("clientes")
      .select("id,nombre")
      .eq("activo", true)
      .order("nombre");

    if (error) {
      setMensaje(`Error clientes: ${error.message}`);
      return;
    }

    setClientes((data || []) as Cliente[]);
  }

  async function cargarUsuarioClientes() {
    const { data, error } = await supabase
      .from("usuario_clientes")
      .select(`
        id,
        perfil_usuario_id,
        cliente_id,
        activo,
        perfiles_usuario (
          nombre,
          email,
          codigo_operario
        ),
        clientes (
          nombre
        )
      `)
      .eq("activo", true)
      .order("created_at", { ascending: false });

    if (error) {
      setMensaje(`Error clientes asignados: ${error.message}`);
      return;
    }

    setUsuarioClientes((data || []) as unknown as UsuarioCliente[]);
  }

  function limpiarFormularioNuevoUsuario() {
    setNombre("");
    setEmail("");
    setPasswordTemporal("");
    setCodigoOperario("");
    setRol("operario");
    setUbicacion("");
    setClientesNuevoUsuarioIds([]);
  }

  function alternarClienteNuevoUsuario(clienteId: string) {
    setClientesNuevoUsuarioIds((actuales) => {
      if (actuales.includes(clienteId)) {
        return actuales.filter((id) => id !== clienteId);
      }

      return [...actuales, clienteId];
    });
  }

  function cambiarPasswordTemporalUsuario(usuarioId: string, valor: string) {
    setPasswordsPorUsuario((actual) => ({
      ...actual,
      [usuarioId]: valor,
    }));
  }

  async function crearUsuario() {
    setMensaje("");

    if (!permisos.esAdmin) {
      setMensaje("Solo un usuario admin puede crear usuarios.");
      return;
    }

    if (
      !nombre.trim() ||
      !email.trim() ||
      !passwordTemporal.trim() ||
      !codigoOperario.trim() ||
      !rol ||
      !ubicacion
    ) {
      setMensaje(
        "Nombre, email, contraseña temporal, código operario, rol y ubicación son obligatorios."
      );
      return;
    }

    if (passwordTemporal.trim().length < 6) {
      setMensaje("La contraseña temporal debe tener al menos 6 caracteres.");
      return;
    }

    setCreandoUsuario(true);

    const { data, error } = await supabase.functions.invoke(
      "admin-create-user",
      {
        body: {
          nombre: nombre.trim(),
          email: email.trim().toLowerCase(),
          password: passwordTemporal.trim(),
          codigo_operario: codigoOperario.trim().toUpperCase(),
          rol,
          ubicacion,
          clientes_ids: clientesNuevoUsuarioIds,
        },
      }
    );

    setCreandoUsuario(false);

    if (error) {
      const detalle = await obtenerDetalleErrorFuncion(error);
      setMensaje(`Error creando usuario: ${detalle}`);
      return;
    }

    if (data?.error) {
      setMensaje(`Error creando usuario: ${data.error}`);
      return;
    }

    await registrarAuditoria({
      modulo: "usuarios",
      accion: "crear_usuario",
      tabla_afectada: "perfiles_usuario",
      registro_id: data?.usuario?.perfil?.id || null,
      descripcion: `Usuario creado desde pantalla admin: ${email
        .trim()
        .toLowerCase()}`,
      datos: {
        email: email.trim().toLowerCase(),
        codigo_operario: codigoOperario.trim().toUpperCase(),
        rol,
        ubicacion,
        clientes_ids: clientesNuevoUsuarioIds,
      },
    });

    setMensaje("Usuario Auth y perfil de almacén creados correctamente.");
    limpiarFormularioNuevoUsuario();
    await cargarDatos();
  }

  async function cambiarPassword(perfilId: string, password: string) {
    try {
      setMensaje("");

      if (!permisos.esAdmin) {
        setMensaje("Solo admin puede cambiar contraseñas.");
        return;
      }

      if (!password.trim()) {
        setMensaje("Introduce una nueva contraseña.");
        return;
      }

      if (password.trim().length < 6) {
        setMensaje("La nueva contraseña debe tener al menos 6 caracteres.");
        return;
      }

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        setMensaje("No hay sesión activa.");
        return;
      }

      const { data, error } = await supabase.functions.invoke(
        "admin-update-user",
        {
          body: {
            perfil_id: perfilId,
            password: password.trim(),
          },
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        }
      );

      if (error) {
        const detalle = await obtenerDetalleErrorFuncion(error);
        setMensaje(`Error cambiando contraseña: ${detalle}`);
        return;
      }

      if (data?.error) {
        setMensaje(`Error: ${data.error}`);
        return;
      }

      await registrarAuditoria({
        modulo: "usuarios",
        accion: "cambiar_password",
        tabla_afectada: "perfiles_usuario",
        registro_id: perfilId,
        descripcion: "Contraseña cambiada por administrador.",
      });

      setMensaje("Contraseña actualizada correctamente.");
      setPasswordsPorUsuario((actual) => ({
        ...actual,
        [perfilId]: "",
      }));
    } catch (error) {
      console.error(error);
      setMensaje("Error inesperado cambiando contraseña.");
    }
  }

  async function cambiarActivo(usuario: PerfilUsuario) {
    setMensaje("");

    if (!permisos.esAdmin) {
      setMensaje("Solo admin puede activar o desactivar usuarios.");
      return;
    }

    const { error } = await supabase
      .from("perfiles_usuario")
      .update({
        activo: !usuario.activo,
      })
      .eq("id", usuario.id);

    if (error) {
      setMensaje(`Error actualizando usuario: ${error.message}`);
      return;
    }

    await registrarAuditoria({
      modulo: "usuarios",
      accion: usuario.activo ? "desactivar_usuario" : "activar_usuario",
      tabla_afectada: "perfiles_usuario",
      registro_id: usuario.id,
      descripcion: `${usuario.activo ? "Desactivado" : "Activado"} usuario ${
        usuario.email || usuario.nombre || usuario.id
      }`,
      datos: {
        usuario_email: usuario.email,
        estado_anterior: usuario.activo,
        estado_nuevo: !usuario.activo,
      },
    });

    setMensaje("Usuario actualizado correctamente.");
    cargarUsuarios();
  }

  async function actualizarRol(usuario: PerfilUsuario, nuevoRol: string) {
    setMensaje("");

    if (!permisos.esAdmin) {
      setMensaje("Solo admin puede cambiar roles.");
      return;
    }

    if (usuario.rol === nuevoRol) {
      return;
    }

    const { error } = await supabase
      .from("perfiles_usuario")
      .update({
        rol: nuevoRol,
      })
      .eq("id", usuario.id);

    if (error) {
      setMensaje(`Error actualizando rol: ${error.message}`);
      return;
    }

    await registrarAuditoria({
      modulo: "usuarios",
      accion: "cambiar_rol",
      tabla_afectada: "perfiles_usuario",
      registro_id: usuario.id,
      descripcion: `Cambio de rol de ${
        usuario.email || usuario.nombre || usuario.id
      }`,
      datos: {
        usuario_email: usuario.email,
        rol_anterior: usuario.rol,
        rol_nuevo: nuevoRol,
      },
    });

    setMensaje("Rol actualizado correctamente.");
    cargarUsuarios();
  }

  async function actualizarUbicacion(
    usuario: PerfilUsuario,
    nuevaUbicacion: string
  ) {
    setMensaje("");

    if (!permisos.esAdmin) {
      setMensaje("Solo admin puede cambiar ubicaciones.");
      return;
    }

    if (usuario.ubicacion === nuevaUbicacion) {
      return;
    }

    const { error } = await supabase
      .from("perfiles_usuario")
      .update({
        ubicacion: nuevaUbicacion,
      })
      .eq("id", usuario.id);

    if (error) {
      setMensaje(`Error actualizando ubicación: ${error.message}`);
      return;
    }

    await registrarAuditoria({
      modulo: "usuarios",
      accion: "cambiar_ubicacion",
      tabla_afectada: "perfiles_usuario",
      registro_id: usuario.id,
      descripcion: `Cambio de ubicación de ${
        usuario.email || usuario.nombre || usuario.id
      }`,
      datos: {
        usuario_email: usuario.email,
        ubicacion_anterior: usuario.ubicacion,
        ubicacion_nueva: nuevaUbicacion,
      },
    });

    setMensaje("Ubicación actualizada correctamente.");
    cargarUsuarios();
  }

  async function actualizarCodigoOperario(
    usuario: PerfilUsuario,
    nuevoCodigo: string
  ) {
    setMensaje("");

    if (!permisos.esAdmin) {
      setMensaje("Solo admin puede cambiar códigos de operario.");
      return;
    }

    const codigoLimpio = nuevoCodigo.trim().toUpperCase();

    if (!codigoLimpio) {
      setMensaje("El código de operario no puede estar vacío.");
      return;
    }

    if (usuario.codigo_operario === codigoLimpio) {
      return;
    }

    const { error } = await supabase
      .from("perfiles_usuario")
      .update({
        codigo_operario: codigoLimpio,
      })
      .eq("id", usuario.id);

    if (error) {
      setMensaje(`Error actualizando código: ${error.message}`);
      return;
    }

    await registrarAuditoria({
      modulo: "usuarios",
      accion: "cambiar_codigo_operario",
      tabla_afectada: "perfiles_usuario",
      registro_id: usuario.id,
      descripcion: `Cambio de código operario de ${
        usuario.email || usuario.nombre || usuario.id
      }`,
      datos: {
        usuario_email: usuario.email,
        codigo_anterior: usuario.codigo_operario,
        codigo_nuevo: codigoLimpio,
      },
    });

    setMensaje("Código actualizado correctamente.");
    cargarUsuarios();
  }

  async function asignarClienteUsuario() {
    setMensaje("");

    if (!permisos.esAdmin) {
      setMensaje("Solo admin puede asignar clientes a usuarios.");
      return;
    }

    if (!usuarioSeleccionadoId || !clienteSeleccionadoId) {
      setMensaje("Selecciona un usuario y un cliente.");
      return;
    }

    const { data: existente, error: existenteError } = await supabase
      .from("usuario_clientes")
      .select("id,activo")
      .eq("perfil_usuario_id", usuarioSeleccionadoId)
      .eq("cliente_id", clienteSeleccionadoId)
      .limit(1);

    if (existenteError) {
      setMensaje(`Error comprobando asignación: ${existenteError.message}`);
      return;
    }

    if (existente && existente.length > 0) {
      const asignacion = existente[0];

      if (asignacion.activo) {
        setMensaje("Este cliente ya está asignado a este usuario.");
        return;
      }

      const { error: reactivarError } = await supabase
        .from("usuario_clientes")
        .update({
          activo: true,
        })
        .eq("id", asignacion.id);

      if (reactivarError) {
        setMensaje(`Error reactivando asignación: ${reactivarError.message}`);
        return;
      }

      await registrarAuditoria({
        modulo: "usuarios",
        accion: "reasignar_cliente_usuario",
        tabla_afectada: "usuario_clientes",
        registro_id: asignacion.id,
        descripcion: "Cliente reasignado a usuario.",
        datos: {
          perfil_usuario_id: usuarioSeleccionadoId,
          cliente_id: clienteSeleccionadoId,
        },
      });

      setMensaje("Cliente reasignado correctamente.");
      setClienteSeleccionadoId("");
      cargarUsuarioClientes();
      return;
    }

    const { data: asignacionCreada, error } = await supabase
      .from("usuario_clientes")
      .insert({
        perfil_usuario_id: usuarioSeleccionadoId,
        cliente_id: clienteSeleccionadoId,
        activo: true,
      })
      .select("id")
      .single();

    if (error) {
      setMensaje(`Error asignando cliente: ${error.message}`);
      return;
    }

    await registrarAuditoria({
      modulo: "usuarios",
      accion: "asignar_cliente_usuario",
      tabla_afectada: "usuario_clientes",
      registro_id: asignacionCreada?.id || null,
      descripcion: "Cliente asignado a usuario.",
      datos: {
        perfil_usuario_id: usuarioSeleccionadoId,
        cliente_id: clienteSeleccionadoId,
      },
    });

    setMensaje("Cliente asignado correctamente.");
    setClienteSeleccionadoId("");
    cargarUsuarioClientes();
  }

  async function quitarClienteUsuario(asignacion: UsuarioCliente) {
    setMensaje("");

    if (!permisos.esAdmin) {
      setMensaje("Solo admin puede quitar clientes a usuarios.");
      return;
    }

    const { error } = await supabase
      .from("usuario_clientes")
      .update({
        activo: false,
      })
      .eq("id", asignacion.id);

    if (error) {
      setMensaje(`Error quitando cliente: ${error.message}`);
      return;
    }

    await registrarAuditoria({
      modulo: "usuarios",
      accion: "quitar_cliente_usuario",
      tabla_afectada: "usuario_clientes",
      registro_id: asignacion.id,
      descripcion: "Cliente quitado a usuario.",
      datos: {
        perfil_usuario_id: asignacion.perfil_usuario_id,
        cliente_id: asignacion.cliente_id,
      },
    });

    setMensaje("Cliente quitado correctamente.");
    cargarUsuarioClientes();
  }

  const usuarioSeleccionado = usuarios.find(
    (usuario) => usuario.id === usuarioSeleccionadoId
  );

  const clientesAsignadosUsuario = usuarioClientes.filter(
    (asignacion) => asignacion.perfil_usuario_id === usuarioSeleccionadoId
  );

  function clientesAsignadosTexto(perfilUsuarioId: string) {
    const nombres = usuarioClientes
      .filter(
        (asignacion) =>
          asignacion.perfil_usuario_id === perfilUsuarioId && asignacion.activo
      )
      .map((asignacion) => {
        const cliente = obtenerPrimero(asignacion.clientes);
        return cliente?.nombre || "";
      })
      .filter(Boolean);

    return nombres.join(" | ");
  }

  function filasExportacionUsuarios(): FilaExportacion[] {
    return usuarios.map((usuario) => ({
      tipo: "usuario",
      perfil_usuario_id: usuario.id,
      user_id: usuario.user_id || "",
      nombre: usuario.nombre || "",
      email: usuario.email || "",
      auth: usuario.user_id ? "Vinculado" : "Sin Auth",
      codigo_operario: usuario.codigo_operario || "",
      rol: usuario.rol || "",
      ubicacion: usuario.ubicacion || "",
      activo: usuario.activo ? "Sí" : "No",
      clientes_asignados: clientesAsignadosTexto(usuario.id),
    }));
  }

  function filasExportacionAsignaciones(): FilaExportacion[] {
    return usuarioClientes.map((asignacion) => {
      const usuario = obtenerPrimero(asignacion.perfiles_usuario);
      const cliente = obtenerPrimero(asignacion.clientes);

      return {
        tipo: "cliente_asignado",
        asignacion_id: asignacion.id,
        perfil_usuario_id: asignacion.perfil_usuario_id || "",
        cliente_id: asignacion.cliente_id || "",
        usuario_nombre: usuario?.nombre || "",
        usuario_email: usuario?.email || "",
        usuario_codigo_operario: usuario?.codigo_operario || "",
        cliente: cliente?.nombre || "",
        activo: asignacion.activo ? "Sí" : "No",
      };
    });
  }

  function filasExportacionUsuariosAlmacen(): FilaExportacion[] {
    return [...filasExportacionUsuarios(), ...filasExportacionAsignaciones()];
  }

  function exportarUsuariosCsv() {
    const filas = filasExportacionUsuariosAlmacen();

    if (filas.length === 0) {
      setMensaje("No hay usuarios ni asignaciones para exportar.");
      return;
    }

    exportarCsv("usuarios-almacen", filas);
  }

  async function exportarUsuariosExcel() {
    const filas = filasExportacionUsuariosAlmacen();

    if (filas.length === 0) {
      setMensaje("No hay usuarios ni asignaciones para exportar.");
      return;
    }

    await exportarExcel("usuarios-almacen", "Usuarios", filas);
  }

  if (cargandoPermisos) {
    return (
      <div className="p-6 space-y-6">
        <AlmacenMenu />

        <div className="rounded-xl border bg-white p-6 text-sm text-gray-600">
          Cargando permisos del usuario conectado...
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <AlmacenMenu />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Usuarios almacén</h1>
          <p className="text-sm text-gray-500">
            Gestión de usuarios Auth, perfiles, roles, ubicación asignada,
            código de operario y clientes permitidos.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={exportarUsuariosCsv}
            className="rounded-xl border px-4 py-2 text-sm font-semibold disabled:opacity-50"
            disabled={usuarios.length === 0 && usuarioClientes.length === 0}
          >
            Exportar CSV
          </button>

          <button
            type="button"
            onClick={exportarUsuariosExcel}
            className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            disabled={usuarios.length === 0 && usuarioClientes.length === 0}
          >
            Exportar Excel
          </button>
        </div>
      </div>

      <div className="rounded-xl border bg-white p-4 space-y-4">
        <h2 className="font-semibold">Usuario activo</h2>

        {errorPermisos && (
          <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
            {errorPermisos}
          </p>
        )}

        {permisos.perfil ? (
          <div className="rounded-lg bg-gray-50 p-3 text-sm text-gray-700">
            Usuario: <strong>{permisos.perfil.nombre || "-"}</strong>
            <br />
            Email: <strong>{permisos.perfil.email || "-"}</strong>
            <br />
            Código: <strong>{permisos.perfil.codigo_operario || "-"}</strong>
            <br />
            Rol: <strong>{permisos.perfil.rol || "-"}</strong>
            <br />
            Ubicación: <strong>{permisos.ubicacion || "-"}</strong>
          </div>
        ) : (
          <p className="rounded-lg bg-yellow-50 p-3 text-sm text-yellow-800">
            No hay perfil activo vinculado al usuario conectado.
          </p>
        )}

        <button
          type="button"
          onClick={recargarPermisos}
          className="rounded-xl border px-4 py-2 text-sm font-semibold"
        >
          Recargar permisos
        </button>
      </div>

      {!permisos.esAdmin && (
        <div className="rounded-xl border bg-yellow-50 p-4 text-sm text-yellow-800">
          Esta pantalla solo puede ser gestionada por un usuario admin.
        </div>
      )}

      <div className="rounded-xl border bg-white p-4 space-y-4">
        <h2 className="font-semibold">Crear usuario Auth + perfil almacén</h2>

        <input
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          placeholder="Nombre"
          className="w-full rounded-lg border px-3 py-2 text-sm"
          disabled={!permisos.esAdmin || creandoUsuario}
        />

        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email de login"
          type="email"
          className="w-full rounded-lg border px-3 py-2 text-sm"
          disabled={!permisos.esAdmin || creandoUsuario}
        />

        <input
          value={passwordTemporal}
          onChange={(e) => setPasswordTemporal(e.target.value)}
          placeholder="Contraseña temporal"
          type="password"
          className="w-full rounded-lg border px-3 py-2 text-sm"
          disabled={!permisos.esAdmin || creandoUsuario}
        />

        <input
          value={codigoOperario}
          onChange={(e) => setCodigoOperario(e.target.value)}
          placeholder="Código operario, ejemplo: REUS01"
          className="w-full rounded-lg border px-3 py-2 text-sm"
          disabled={!permisos.esAdmin || creandoUsuario}
        />

        <select
          value={rol}
          onChange={(e) => setRol(e.target.value)}
          className="w-full rounded-lg border px-3 py-2 text-sm"
          disabled={!permisos.esAdmin || creandoUsuario}
        >
          {ROLES.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>

        <select
          value={ubicacion}
          onChange={(e) => setUbicacion(e.target.value)}
          className="w-full rounded-lg border px-3 py-2 text-sm"
          disabled={!permisos.esAdmin || creandoUsuario}
        >
          <option value="">Ubicación...</option>
          {UBICACIONES.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>

        <div className="rounded-xl border p-3 space-y-2">
          <p className="text-sm font-semibold">Clientes permitidos iniciales</p>

          {clientes.map((cliente) => (
            <label
              key={cliente.id}
              className="flex items-center gap-2 text-sm text-gray-700"
            >
              <input
                type="checkbox"
                checked={clientesNuevoUsuarioIds.includes(cliente.id)}
                onChange={() => alternarClienteNuevoUsuario(cliente.id)}
                disabled={!permisos.esAdmin || creandoUsuario}
              />
              {cliente.nombre}
            </label>
          ))}

          {clientes.length === 0 && (
            <p className="text-sm text-gray-500">No hay clientes activos.</p>
          )}
        </div>

        <button
          type="button"
          onClick={crearUsuario}
          className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          disabled={!permisos.esAdmin || creandoUsuario}
        >
          {creandoUsuario ? "Creando usuario..." : "Crear usuario"}
        </button>

        {mensaje && <p className="text-sm text-gray-700">{mensaje}</p>}
      </div>

      <div className="overflow-hidden rounded-xl border bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left">
            <tr>
              <th className="p-3">Nombre</th>
              <th className="p-3">Email</th>
              <th className="p-3">Auth</th>
              <th className="p-3">Código operario</th>
              <th className="p-3">Rol</th>
              <th className="p-3">Ubicación</th>
              <th className="p-3">Activo</th>
              <th className="p-3">Nueva contraseña</th>
              <th className="p-3">Acción</th>
            </tr>
          </thead>

          <tbody>
            {usuarios.map((usuario) => (
              <tr key={usuario.id} className="border-t">
                <td className="p-3">{usuario.nombre || "-"}</td>
                <td className="p-3">{usuario.email || "-"}</td>

                <td className="p-3">
                  {usuario.user_id ? (
                    <span className="rounded-full bg-green-100 px-2 py-1 text-xs font-semibold text-green-800">
                      Vinculado
                    </span>
                  ) : (
                    <span className="rounded-full bg-yellow-100 px-2 py-1 text-xs font-semibold text-yellow-800">
                      Sin Auth
                    </span>
                  )}
                </td>

                <td className="p-3">
                  <input
                    defaultValue={usuario.codigo_operario || ""}
                    onBlur={(e) =>
                      actualizarCodigoOperario(usuario, e.target.value)
                    }
                    className="w-32 rounded-lg border px-2 py-1 text-sm"
                    disabled={!permisos.esAdmin}
                  />
                </td>

                <td className="p-3">
                  <select
                    value={usuario.rol || "operario"}
                    onChange={(e) => actualizarRol(usuario, e.target.value)}
                    className="rounded-lg border px-2 py-1 text-sm"
                    disabled={!permisos.esAdmin}
                  >
                    {ROLES.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                </td>

                <td className="p-3">
                  <select
                    value={usuario.ubicacion || ""}
                    onChange={(e) =>
                      actualizarUbicacion(usuario, e.target.value)
                    }
                    className="rounded-lg border px-2 py-1 text-sm"
                    disabled={!permisos.esAdmin}
                  >
                    <option value="">-</option>
                    {UBICACIONES.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                </td>

                <td className="p-3">{usuario.activo ? "Sí" : "No"}</td>

                <td className="p-3">
                  <div className="flex items-center gap-2">
                    <input
                      type="password"
                      value={passwordsPorUsuario[usuario.id] || ""}
                      onChange={(e) =>
                        cambiarPasswordTemporalUsuario(
                          usuario.id,
                          e.target.value
                        )
                      }
                      placeholder="Nueva contraseña"
                      className="w-40 rounded-lg border px-2 py-1 text-sm"
                      disabled={!permisos.esAdmin || !usuario.user_id}
                    />

                    <button
                      type="button"
                      onClick={() =>
                        cambiarPassword(
                          usuario.id,
                          passwordsPorUsuario[usuario.id] || ""
                        )
                      }
                      className="rounded-lg border px-3 py-1 text-xs disabled:opacity-50"
                      disabled={!permisos.esAdmin || !usuario.user_id}
                    >
                      Cambiar
                    </button>
                  </div>
                </td>

                <td className="p-3">
                  <button
                    type="button"
                    onClick={() => cambiarActivo(usuario)}
                    className="rounded-lg border px-3 py-1 text-xs disabled:opacity-50"
                    disabled={!permisos.esAdmin}
                  >
                    {usuario.activo ? "Desactivar" : "Activar"}
                  </button>
                </td>
              </tr>
            ))}

            {usuarios.length === 0 && (
              <tr>
                <td colSpan={9} className="p-6 text-center text-gray-500">
                  No hay usuarios creados.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="rounded-xl border bg-white p-4 space-y-4">
        <h2 className="font-semibold">Clientes permitidos por usuario</h2>

        <select
          value={usuarioSeleccionadoId}
          onChange={(e) => {
            setUsuarioSeleccionadoId(e.target.value);
            setClienteSeleccionadoId("");
          }}
          className="w-full rounded-lg border px-3 py-2 text-sm"
          disabled={!permisos.esAdmin}
        >
          <option value="">Usuario...</option>
          {usuarios.map((usuario) => (
            <option key={usuario.id} value={usuario.id}>
              {usuario.nombre || "-"} | {usuario.codigo_operario || "-"} |{" "}
              {usuario.rol || "-"} | {usuario.ubicacion || "-"}
            </option>
          ))}
        </select>

        {usuarioSeleccionado && (
          <div className="rounded-lg bg-gray-50 p-3 text-sm text-gray-700">
            Usuario: <strong>{usuarioSeleccionado.nombre || "-"}</strong>
            <br />
            Email: <strong>{usuarioSeleccionado.email || "-"}</strong>
            <br />
            Rol: <strong>{usuarioSeleccionado.rol || "-"}</strong>
            <br />
            Ubicación: <strong>{usuarioSeleccionado.ubicacion || "-"}</strong>
          </div>
        )}

        <select
          value={clienteSeleccionadoId}
          onChange={(e) => setClienteSeleccionadoId(e.target.value)}
          className="w-full rounded-lg border px-3 py-2 text-sm"
          disabled={!usuarioSeleccionadoId || !permisos.esAdmin}
        >
          <option value="">Cliente...</option>
          {clientes.map((cliente) => (
            <option key={cliente.id} value={cliente.id}>
              {cliente.nombre}
            </option>
          ))}
        </select>

        <button
          type="button"
          onClick={asignarClienteUsuario}
          className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          disabled={!usuarioSeleccionadoId || !permisos.esAdmin}
        >
          Asignar cliente
        </button>

        {usuarioSeleccionadoId && (
          <div className="overflow-hidden rounded-xl border">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left">
                <tr>
                  <th className="p-3">Cliente asignado</th>
                  <th className="p-3">Acción</th>
                </tr>
              </thead>

              <tbody>
                {clientesAsignadosUsuario.map((asignacion) => {
                  const cliente = obtenerPrimero(asignacion.clientes);

                  return (
                    <tr key={asignacion.id} className="border-t">
                      <td className="p-3">{cliente?.nombre || "-"}</td>
                      <td className="p-3">
                        <button
                          type="button"
                          onClick={() => quitarClienteUsuario(asignacion)}
                          className="rounded-lg border px-3 py-1 text-xs disabled:opacity-50"
                          disabled={!permisos.esAdmin}
                        >
                          Quitar
                        </button>
                      </td>
                    </tr>
                  );
                })}

                {clientesAsignadosUsuario.length === 0 && (
                  <tr>
                    <td colSpan={2} className="p-6 text-center text-gray-500">
                      Este usuario no tiene clientes asignados.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={cargarDatos}
        className="rounded-xl border px-4 py-2 text-sm font-semibold"
      >
        Actualizar usuarios
      </button>
    </div>
  );
}