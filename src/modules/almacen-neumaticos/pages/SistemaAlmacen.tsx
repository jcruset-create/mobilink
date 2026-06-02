import { useEffect, useState } from "react";
import AlmacenMenu from "../components/AlmacenMenu";
import { supabase } from "../services/supabase";
import { usePermisosAlmacen } from "../hooks/usePermisosAlmacen";
import {
  exportarCsv,
  exportarExcel,
  type FilaExportacion,
} from "../services/exportAlmacen";

type ComprobacionSistema = {
  id: string;
  titulo: string;
  descripcion: string;
  gravedad: "ok" | "aviso" | "critico";
  total: number;
  detalle: string[];
};

type RegistroBackup = Record<string, unknown>;

type JsonBackupSistema = {
  perfiles_usuario: RegistroBackup[];
  usuario_clientes: RegistroBackup[];
  centros: RegistroBackup[];
  clientes: RegistroBackup[];
  productos_neumaticos: RegistroBackup[];
  vehiculos: RegistroBackup[];
  traspasos: RegistroBackup[];
  solicitudes_reposicion: RegistroBackup[];
  inventarios: RegistroBackup[];
  inventarios_lineas: RegistroBackup[];
  incidencias: RegistroBackup[];
  movimientos_stock: RegistroBackup[];
  auditoria_almacen: RegistroBackup[];
};

type BackupSistema = {
  id: string;
  fecha: string | null;
  usuario: string | null;
  nombre: string;
  json_backup: JsonBackupSistema;
  created_at: string | null;
};

const TABLAS_BACKUP = [
  "perfiles_usuario",
  "usuario_clientes",
  "centros",
  "clientes",
  "productos_neumaticos",
  "vehiculos",
  "traspasos",
  "solicitudes_reposicion",
  "inventarios",
  "inventarios_lineas",
  "incidencias",
  "movimientos_stock",
  "auditoria_almacen",
] as const;

const ORDEN_BORRADO = [
  "movimientos_stock",
  "inventarios_lineas",
  "inventarios",
  "incidencias",
  "solicitudes_reposicion",
  "traspasos",
  "auditoria_almacen",
  "vehiculos",
  "productos_neumaticos",
  "usuario_clientes",
  "clientes",
  "centros",
  "perfiles_usuario",
] as const;

const ORDEN_RESTAURACION = [
  "perfiles_usuario",
  "centros",
  "clientes",
  "productos_neumaticos",
  "vehiculos",
  "usuario_clientes",
  "traspasos",
  "solicitudes_reposicion",
  "inventarios",
  "inventarios_lineas",
  "incidencias",
  "movimientos_stock",
  "auditoria_almacen",
] as const;

function haceMasDeDias(fecha: string | null, dias: number) {
  if (!fecha) return false;

  const fechaDate = new Date(fecha);
  const ahora = new Date();
  const diferenciaMs = ahora.getTime() - fechaDate.getTime();
  const diferenciaDias = diferenciaMs / (1000 * 60 * 60 * 24);

  return diferenciaDias > dias;
}

function formatearFecha(fecha: string | null) {
  if (!fecha) return "-";
  return new Date(fecha).toLocaleString("es-ES");
}

function crearBackupVacio(): JsonBackupSistema {
  return {
    perfiles_usuario: [],
    usuario_clientes: [],
    centros: [],
    clientes: [],
    productos_neumaticos: [],
    vehiculos: [],
    traspasos: [],
    solicitudes_reposicion: [],
    inventarios: [],
    inventarios_lineas: [],
    incidencias: [],
    movimientos_stock: [],
    auditoria_almacen: [],
  };
}

function BadgeGravedad({
  gravedad,
}: {
  gravedad: ComprobacionSistema["gravedad"];
}) {
  if (gravedad === "ok") {
    return (
      <span className="rounded-full bg-green-100 px-2 py-1 text-xs font-semibold text-green-800">
        OK
      </span>
    );
  }

  if (gravedad === "critico") {
    return (
      <span className="rounded-full bg-red-100 px-2 py-1 text-xs font-semibold text-red-800">
        Crítico
      </span>
    );
  }

  return (
    <span className="rounded-full bg-yellow-100 px-2 py-1 text-xs font-semibold text-yellow-800">
      Aviso
    </span>
  );
}

export default function SistemaAlmacen() {
  const { permisos, cargandoPermisos } = usePermisosAlmacen();

  const [comprobaciones, setComprobaciones] = useState<ComprobacionSistema[]>(
    []
  );
  const [backups, setBackups] = useState<BackupSistema[]>([]);
  const [nombreSnapshot, setNombreSnapshot] = useState("");
  const [backupRestaurarId, setBackupRestaurarId] = useState("");
  const [confirmacionRestore, setConfirmacionRestore] = useState("");
  const [confirmacionReset, setConfirmacionReset] = useState("");
  const [mensaje, setMensaje] = useState("");
  const [cargando, setCargando] = useState(false);
  const [creandoSnapshot, setCreandoSnapshot] = useState(false);
  const [restaurando, setRestaurando] = useState(false);
  const [eliminandoBackup, setEliminandoBackup] = useState(false);
  const [reseteando, setReseteando] = useState(false);

  useEffect(() => {
    if (!cargandoPermisos) {
      cargarSistema();
      cargarBackups();
    }
  }, [cargandoPermisos, permisos.perfil?.id]);

  async function cargarSistema() {
    setMensaje("");
    setCargando(true);

    const nuevasComprobaciones: ComprobacionSistema[] = [];

    const { data: usuarios, error: usuariosError } = await supabase
      .from("perfiles_usuario")
      .select("id,user_id,nombre,email,codigo_operario,rol,ubicacion,activo")
      .order("nombre");

    if (usuariosError) {
      setMensaje(`Error cargando usuarios: ${usuariosError.message}`);
      setCargando(false);
      return;
    }

    const { data: usuarioClientes, error: usuarioClientesError } =
      await supabase
        .from("usuario_clientes")
        .select("id,perfil_usuario_id,cliente_id,activo");

    if (usuarioClientesError) {
      setMensaje(
        `Error cargando asignaciones de clientes: ${usuarioClientesError.message}`
      );
      setCargando(false);
      return;
    }

    const { data: movimientos, error: movimientosError } = await supabase
      .from("movimientos_stock")
      .select(
        "id,created_at,empresa_id,cliente_id,producto_id,ubicacion,tipo,cantidad"
      )
      .order("created_at", { ascending: false })
      .limit(500);

    if (movimientosError) {
      setMensaje(`Error cargando movimientos: ${movimientosError.message}`);
      setCargando(false);
      return;
    }

    const { data: traspasos, error: traspasosError } = await supabase
      .from("traspasos")
      .select(
        "id,fecha_salida,estado,ubicacion_origen,ubicacion_destino,cantidad"
      )
      .order("fecha_salida", { ascending: false })
      .limit(500);

    if (traspasosError) {
      setMensaje(`Error cargando traspasos: ${traspasosError.message}`);
      setCargando(false);
      return;
    }

    const { data: reposiciones, error: reposicionesError } = await supabase
      .from("solicitudes_reposicion")
      .select("id,created_at,estado,ubicacion,cantidad_sugerida,traspaso_id")
      .order("created_at", { ascending: false })
      .limit(500);

    if (reposicionesError) {
      setMensaje(`Error cargando reposiciones: ${reposicionesError.message}`);
      setCargando(false);
      return;
    }

    const { data: inventarios, error: inventariosError } = await supabase
      .from("inventarios")
      .select("id,fecha_creacion,fecha_conteo,estado,ubicacion")
      .order("fecha_creacion", { ascending: false })
      .limit(500);

    if (inventariosError) {
      setMensaje(`Error cargando inventarios: ${inventariosError.message}`);
      setCargando(false);
      return;
    }

    const { data: incidencias, error: incidenciasError } = await supabase
      .from("incidencias")
      .select("id,created_at,estado,gravedad,ubicacion,descripcion")
      .order("created_at", { ascending: false })
      .limit(500);

    if (incidenciasError) {
      setMensaje(`Error cargando incidencias: ${incidenciasError.message}`);
      setCargando(false);
      return;
    }

    const usuariosActivos = (usuarios || []).filter(
      (usuario) => usuario.activo
    );

    const usuariosSinAuth = usuariosActivos.filter(
      (usuario) => !usuario.user_id
    );

    nuevasComprobaciones.push({
      id: "usuarios-sin-auth",
      titulo: "Usuarios activos sin Auth",
      descripcion:
        "Usuarios activos de perfiles_usuario que no están vinculados a un user_id de Supabase Auth.",
      gravedad: usuariosSinAuth.length > 0 ? "critico" : "ok",
      total: usuariosSinAuth.length,
      detalle: usuariosSinAuth.map(
        (usuario) =>
          `${usuario.nombre || "-"} · ${usuario.email || "-"} · ${
            usuario.rol || "-"
          }`
      ),
    });

    const usuariosSinCodigo = usuariosActivos.filter(
      (usuario) => !usuario.codigo_operario
    );

    nuevasComprobaciones.push({
      id: "usuarios-sin-codigo",
      titulo: "Usuarios activos sin código de operario",
      descripcion:
        "Todo usuario operativo debería tener código para trazabilidad en movimientos, inventarios e incidencias.",
      gravedad: usuariosSinCodigo.length > 0 ? "aviso" : "ok",
      total: usuariosSinCodigo.length,
      detalle: usuariosSinCodigo.map(
        (usuario) =>
          `${usuario.nombre || "-"} · ${usuario.email || "-"} · ${
            usuario.rol || "-"
          }`
      ),
    });

    const usuariosOperativosSinUbicacion = usuariosActivos.filter(
      (usuario) =>
        (usuario.rol === "operario" || usuario.rol === "responsable") &&
        !usuario.ubicacion
    );

    nuevasComprobaciones.push({
      id: "usuarios-sin-ubicacion",
      titulo: "Operarios/responsables sin ubicación",
      descripcion:
        "Operarios y responsables necesitan ubicación para que RLS y filtros funcionen correctamente.",
      gravedad: usuariosOperativosSinUbicacion.length > 0 ? "critico" : "ok",
      total: usuariosOperativosSinUbicacion.length,
      detalle: usuariosOperativosSinUbicacion.map(
        (usuario) =>
          `${usuario.nombre || "-"} · ${usuario.email || "-"} · ${
            usuario.rol || "-"
          }`
      ),
    });

    const asignacionesActivas = usuarioClientes || [];

    const usuariosOperativosSinClientes = usuariosActivos.filter((usuario) => {
      if (usuario.rol !== "operario" && usuario.rol !== "responsable") {
        return false;
      }

      return !asignacionesActivas.some(
        (asignacion) =>
          asignacion.perfil_usuario_id === usuario.id && asignacion.activo
      );
    });

    nuevasComprobaciones.push({
      id: "usuarios-sin-clientes",
      titulo: "Operarios/responsables sin clientes asignados",
      descripcion:
        "Sin clientes asignados, los usuarios operativos no verán stock ni operaciones de clientes.",
      gravedad: usuariosOperativosSinClientes.length > 0 ? "aviso" : "ok",
      total: usuariosOperativosSinClientes.length,
      detalle: usuariosOperativosSinClientes.map(
        (usuario) =>
          `${usuario.nombre || "-"} · ${usuario.email || "-"} · ${
            usuario.rol || "-"
          } · ${usuario.ubicacion || "-"}`
      ),
    });

    const movimientosIncompletos = (movimientos || []).filter(
      (movimiento) =>
        !movimiento.empresa_id ||
        !movimiento.cliente_id ||
        !movimiento.producto_id ||
        !movimiento.tipo ||
        movimiento.cantidad === null ||
        movimiento.cantidad === undefined
    );

    nuevasComprobaciones.push({
      id: "movimientos-incompletos",
      titulo: "Movimientos de stock incompletos",
      descripcion:
        "Movimientos sin empresa, cliente, producto, tipo o cantidad pueden romper cálculos de stock.",
      gravedad: movimientosIncompletos.length > 0 ? "critico" : "ok",
      total: movimientosIncompletos.length,
      detalle: movimientosIncompletos.slice(0, 20).map(
        (movimiento) =>
          `${movimiento.id} · ${movimiento.tipo || "-"} · cantidad ${
            movimiento.cantidad ?? "-"
          } · ubicación ${movimiento.ubicacion || "-"}`
      ),
    });

    const traspasosEnCaminoAntiguos = (traspasos || []).filter(
      (traspaso) =>
        (traspaso.estado === "en_camino" ||
          traspaso.estado === "recibido_parcial") &&
        haceMasDeDias(traspaso.fecha_salida, 7)
    );

    nuevasComprobaciones.push({
      id: "traspasos-antiguos",
      titulo: "Traspasos en camino antiguos",
      descripcion:
        "Traspasos en camino o recibidos parcialmente desde hace más de 7 días.",
      gravedad: traspasosEnCaminoAntiguos.length > 0 ? "aviso" : "ok",
      total: traspasosEnCaminoAntiguos.length,
      detalle: traspasosEnCaminoAntiguos.slice(0, 20).map(
        (traspaso) =>
          `${traspaso.id} · ${traspaso.estado || "-"} · ${
            traspaso.ubicacion_origen || "-"
          } → ${traspaso.ubicacion_destino || "-"} · cantidad ${
            traspaso.cantidad ?? "-"
          }`
      ),
    });

    const reposicionesAtascadas = (reposiciones || []).filter(
      (reposicion) =>
        (reposicion.estado === "pendiente" ||
          reposicion.estado === "aprobada" ||
          reposicion.estado === "en_traspaso") &&
        haceMasDeDias(reposicion.created_at, 7)
    );

    nuevasComprobaciones.push({
      id: "reposiciones-atascadas",
      titulo: "Reposiciones activas antiguas",
      descripcion:
        "Solicitudes pendientes, aprobadas o en traspaso desde hace más de 7 días.",
      gravedad: reposicionesAtascadas.length > 0 ? "aviso" : "ok",
      total: reposicionesAtascadas.length,
      detalle: reposicionesAtascadas.slice(0, 20).map(
        (reposicion) =>
          `${reposicion.id} · ${reposicion.estado || "-"} · ${
            reposicion.ubicacion || "-"
          } · cantidad ${reposicion.cantidad_sugerida ?? "-"}`
      ),
    });

    const inventariosAtascados = (inventarios || []).filter((inventario) => {
      if (
        inventario.estado !== "pendiente_conteo" &&
        inventario.estado !== "pendiente_revision"
      ) {
        return false;
      }

      return haceMasDeDias(
        inventario.fecha_conteo || inventario.fecha_creacion,
        7
      );
    });

    nuevasComprobaciones.push({
      id: "inventarios-atascados",
      titulo: "Inventarios pendientes antiguos",
      descripcion:
        "Inventarios pendientes de conteo o revisión desde hace más de 7 días.",
      gravedad: inventariosAtascados.length > 0 ? "aviso" : "ok",
      total: inventariosAtascados.length,
      detalle: inventariosAtascados.slice(0, 20).map(
        (inventario) =>
          `${inventario.id} · ${inventario.estado || "-"} · ${
            inventario.ubicacion || "-"
          }`
      ),
    });

    const incidenciasCriticasAbiertas = (incidencias || []).filter(
      (incidencia) =>
        incidencia.estado !== "resuelta" && incidencia.gravedad === "critica"
    );

    nuevasComprobaciones.push({
      id: "incidencias-criticas",
      titulo: "Incidencias críticas abiertas",
      descripcion:
        "Incidencias con gravedad crítica que todavía no están resueltas.",
      gravedad: incidenciasCriticasAbiertas.length > 0 ? "critico" : "ok",
      total: incidenciasCriticasAbiertas.length,
      detalle: incidenciasCriticasAbiertas.slice(0, 20).map(
        (incidencia) =>
          `${incidencia.id} · ${incidencia.ubicacion || "-"} · ${
            incidencia.descripcion || "-"
          }`
      ),
    });

    setComprobaciones(nuevasComprobaciones);
    setCargando(false);
  }

  async function cargarBackups() {
    const { data, error } = await supabase
      .from("backups_sistema")
      .select("id,fecha,usuario,nombre,json_backup,created_at")
      .order("fecha", { ascending: false });

    if (error) {
      setMensaje(`Error cargando backups: ${error.message}`);
      return;
    }

    setBackups((data || []) as BackupSistema[]);
  }

  async function leerTablaBackup(nombreTabla: (typeof TABLAS_BACKUP)[number]) {
    const { data, error } = await supabase.from(nombreTabla).select("*");

    if (error) {
      throw new Error(`Error leyendo ${nombreTabla}: ${error.message}`);
    }

    return (data || []) as RegistroBackup[];
  }

  async function crearSnapshot() {
    setMensaje("");

    if (!permisos.esAdmin) {
      setMensaje("Solo un administrador puede crear snapshots.");
      return;
    }

    if (!nombreSnapshot.trim()) {
      setMensaje("Indica un nombre para el snapshot.");
      return;
    }

    setCreandoSnapshot(true);

    try {
      const backup = crearBackupVacio();

      for (const tabla of TABLAS_BACKUP) {
        backup[tabla] = await leerTablaBackup(tabla);
      }

      const { error } = await supabase.from("backups_sistema").insert({
        nombre: nombreSnapshot.trim(),
        usuario: permisos.perfil?.email || permisos.perfil?.nombre || null,
        json_backup: backup,
      });

      if (error) {
        throw new Error(`Error creando snapshot: ${error.message}`);
      }

      setMensaje("Snapshot creado correctamente.");
      setNombreSnapshot("");
      await cargarBackups();
    } catch (error) {
      setMensaje(
        error instanceof Error ? error.message : "Error creando snapshot."
      );
    } finally {
      setCreandoSnapshot(false);
    }
  }

  async function borrarTabla(nombreTabla: string) {
    const { error } = await supabase
      .from(nombreTabla)
      .delete()
      .not("id", "is", null);

    if (error) {
      throw new Error(`Error limpiando ${nombreTabla}: ${error.message}`);
    }
  }

  async function insertarRegistros(nombreTabla: string, registros: RegistroBackup[]) {
    if (registros.length === 0) return;

    const { error } = await supabase.from(nombreTabla).insert(registros);

    if (error) {
      throw new Error(`Error restaurando ${nombreTabla}: ${error.message}`);
    }
  }

  async function limpiarDatosOperativos() {
    for (const tabla of ORDEN_BORRADO) {
      await borrarTabla(tabla);
    }
  }

  async function restaurarSnapshot() {
    setMensaje("");

    if (!permisos.esAdmin) {
      setMensaje("Solo un administrador puede restaurar snapshots.");
      return;
    }

    if (!backupRestaurarId) {
      setMensaje("Selecciona un snapshot para restaurar.");
      return;
    }

    if (confirmacionRestore !== "RESTAURAR") {
      setMensaje('Para restaurar escribe exactamente: RESTAURAR');
      return;
    }

    const backup = backups.find((item) => item.id === backupRestaurarId);

    if (!backup) {
      setMensaje("No se ha encontrado el snapshot seleccionado.");
      return;
    }

    const confirmar = window.confirm(
      `ATENCIÓN: se borrarán los datos actuales del módulo y se restaurará el snapshot "${backup.nombre}". Supabase Auth NO se toca. ¿Continuar?`
    );

    if (!confirmar) return;

    const confirmarFinal = window.confirm(
      "Confirmación final: esta acción sobrescribe los datos actuales del módulo. ¿Restaurar ahora?"
    );

    if (!confirmarFinal) return;

    setRestaurando(true);

    try {
      await limpiarDatosOperativos();

      for (const tabla of ORDEN_RESTAURACION) {
        await insertarRegistros(tabla, backup.json_backup[tabla] || []);
      }

      setMensaje(`Snapshot "${backup.nombre}" restaurado correctamente.`);
      setBackupRestaurarId("");
      setConfirmacionRestore("");
      await cargarSistema();
      await cargarBackups();
    } catch (error) {
      setMensaje(
        error instanceof Error
          ? error.message
          : "Error restaurando snapshot."
      );
    } finally {
      setRestaurando(false);
    }
  }

  async function eliminarSnapshot(id: string) {
    setMensaje("");

    if (!permisos.esAdmin) {
      setMensaje("Solo un administrador puede eliminar snapshots.");
      return;
    }

    const backup = backups.find((item) => item.id === id);

    const confirmar = window.confirm(
      `¿Eliminar definitivamente el snapshot "${backup?.nombre || id}"?`
    );

    if (!confirmar) return;

    setEliminandoBackup(true);

    const { error } = await supabase
      .from("backups_sistema")
      .delete()
      .eq("id", id);

    setEliminandoBackup(false);

    if (error) {
      setMensaje(`Error eliminando snapshot: ${error.message}`);
      return;
    }

    setMensaje("Snapshot eliminado correctamente.");
    await cargarBackups();
  }

  async function resetDemo() {
    setMensaje("");

    if (!permisos.esAdmin) {
      setMensaje("Solo un administrador puede ejecutar reset demo.");
      return;
    }

    if (confirmacionReset !== "RESET DEMO") {
      setMensaje('Para ejecutar la limpieza escribe exactamente: RESET DEMO');
      return;
    }

    const confirmar = window.confirm(
      "ATENCIÓN: se eliminarán los datos demo del módulo de almacén. No se eliminan usuarios de Supabase Auth. ¿Continuar?"
    );

    if (!confirmar) return;

    const confirmarFinal = window.confirm(
      "Confirmación final: esta acción no se puede deshacer desde la app salvo que tengas un snapshot. ¿Ejecutar reset demo ahora?"
    );

    if (!confirmarFinal) return;

    setReseteando(true);

    try {
      await limpiarDatosOperativos();

      setMensaje(
        "Reset demo completado correctamente. Supabase Auth no ha sido modificado."
      );
      setConfirmacionReset("");
      await cargarSistema();
    } catch (error) {
      setMensaje(
        error instanceof Error
          ? error.message
          : "Error ejecutando reset demo."
      );
    } finally {
      setReseteando(false);
    }
  }

  function filasExportacionSistema(): FilaExportacion[] {
    return comprobaciones.map((comprobacion) => ({
      comprobacion: comprobacion.titulo,
      gravedad: comprobacion.gravedad,
      total: comprobacion.total,
      descripcion: comprobacion.descripcion,
      detalle: comprobacion.detalle.join(" | "),
    }));
  }

  function exportarSistemaCsv() {
    const filas = filasExportacionSistema();

    if (filas.length === 0) {
      setMensaje("No hay comprobaciones para exportar.");
      return;
    }

    exportarCsv("salud-sistema-almacen", filas);
  }

  async function exportarSistemaExcel() {
    const filas = filasExportacionSistema();

    if (filas.length === 0) {
      setMensaje("No hay comprobaciones para exportar.");
      return;
    }

    await exportarExcel("salud-sistema-almacen", "Sistema", filas);
  }

  const totalCriticos = comprobaciones.filter(
    (item) => item.gravedad === "critico" && item.total > 0
  ).length;

  const totalAvisos = comprobaciones.filter(
    (item) => item.gravedad === "aviso" && item.total > 0
  ).length;

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

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Salud del sistema</h1>
          <p className="text-sm text-gray-500">
            Comprobaciones de configuración, datos operativos, snapshots y reset
            controlado del módulo.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={cargarSistema}
            className="rounded-xl border px-4 py-2 text-sm font-semibold"
          >
            {cargando ? "Comprobando..." : "Actualizar comprobaciones"}
          </button>

          <button
            type="button"
            onClick={exportarSistemaCsv}
            className="rounded-xl border px-4 py-2 text-sm font-semibold disabled:opacity-50"
            disabled={comprobaciones.length === 0}
          >
            Exportar CSV
          </button>

          <button
            type="button"
            onClick={exportarSistemaExcel}
            className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            disabled={comprobaciones.length === 0}
          >
            Exportar Excel
          </button>
        </div>
      </div>

      {mensaje && <p className="text-sm text-red-600">{mensaje}</p>}

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border bg-white p-4">
          <p className="text-sm text-gray-500">Comprobaciones</p>
          <p className="text-3xl font-bold">{comprobaciones.length}</p>
        </div>

        <div className="rounded-xl border bg-white p-4">
          <p className="text-sm text-gray-500">Críticos</p>
          <p className="text-3xl font-bold text-red-700">{totalCriticos}</p>
        </div>

        <div className="rounded-xl border bg-white p-4">
          <p className="text-sm text-gray-500">Avisos</p>
          <p className="text-3xl font-bold text-yellow-700">{totalAvisos}</p>
        </div>
      </div>

      {permisos.esAdmin && (
        <div className="rounded-xl border bg-white p-6 space-y-5">
          <div>
            <h2 className="text-lg font-bold">Snapshots internos</h2>
            <p className="mt-1 text-sm text-gray-500">
              Crea copias completas del módulo dentro de la tabla
              backups_sistema. No toca Supabase Auth.
            </p>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <input
              value={nombreSnapshot}
              onChange={(e) => setNombreSnapshot(e.target.value)}
              placeholder="Nombre del snapshot"
              className="rounded-lg border px-3 py-2 text-sm md:col-span-2"
            />

            <button
              type="button"
              onClick={crearSnapshot}
              disabled={creandoSnapshot}
              className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {creandoSnapshot ? "Creando..." : "Crear snapshot"}
            </button>
          </div>

          <div className="rounded-xl border p-4 space-y-3">
            <h3 className="font-semibold">Restaurar snapshot</h3>

            <select
              value={backupRestaurarId}
              onChange={(e) => setBackupRestaurarId(e.target.value)}
              className="w-full rounded-lg border px-3 py-2 text-sm"
            >
              <option value="">Selecciona snapshot...</option>
              {backups.map((backup) => (
                <option key={backup.id} value={backup.id}>
                  {formatearFecha(backup.fecha)} · {backup.nombre}
                </option>
              ))}
            </select>

            <input
              value={confirmacionRestore}
              onChange={(e) => setConfirmacionRestore(e.target.value)}
              placeholder="Escribe RESTAURAR"
              className="w-full rounded-lg border px-3 py-2 text-sm"
            />

            <button
              type="button"
              onClick={restaurarSnapshot}
              disabled={restaurando}
              className="rounded-xl bg-yellow-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {restaurando ? "Restaurando..." : "Restaurar snapshot"}
            </button>
          </div>

          <div className="overflow-auto rounded-xl border">
            <table className="w-full min-w-[800px] text-sm">
              <thead className="bg-gray-50 text-left">
                <tr>
                  <th className="p-3">Fecha</th>
                  <th className="p-3">Nombre</th>
                  <th className="p-3">Usuario</th>
                  <th className="p-3">Resumen</th>
                  <th className="p-3">Acción</th>
                </tr>
              </thead>

              <tbody>
                {backups.map((backup) => (
                  <tr key={backup.id} className="border-t">
                    <td className="p-3">{formatearFecha(backup.fecha)}</td>
                    <td className="p-3 font-semibold">{backup.nombre}</td>
                    <td className="p-3">{backup.usuario || "-"}</td>
                    <td className="p-3 text-xs text-gray-600">
                      Clientes: {backup.json_backup.clientes?.length || 0} ·
                      Productos:{" "}
                      {backup.json_backup.productos_neumaticos?.length || 0} ·
                      Movimientos:{" "}
                      {backup.json_backup.movimientos_stock?.length || 0}
                    </td>
                    <td className="p-3">
                      <button
                        type="button"
                        onClick={() => eliminarSnapshot(backup.id)}
                        disabled={eliminandoBackup}
                        className="rounded-lg border px-3 py-1 text-xs font-semibold"
                      >
                        Eliminar
                      </button>
                    </td>
                  </tr>
                ))}

                {backups.length === 0 && (
                  <tr>
                    <td colSpan={5} className="p-6 text-center text-gray-500">
                      No hay snapshots guardados.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {permisos.esAdmin && (
        <div className="rounded-xl border border-red-300 bg-red-50 p-6">
          <h2 className="text-lg font-bold text-red-700">Reset demo</h2>

          <p className="mt-2 text-sm text-red-700">
            Elimina los datos del módulo de almacén. No elimina usuarios de
            Supabase Auth. Crea un snapshot antes de usarlo.
          </p>

          <p className="mt-2 text-sm font-semibold text-red-700">
            Para confirmar, escribe exactamente: RESET DEMO
          </p>

          <div className="mt-4 flex flex-col gap-3 md:flex-row">
            <input
              value={confirmacionReset}
              onChange={(e) => setConfirmacionReset(e.target.value)}
              placeholder="RESET DEMO"
              className="rounded-lg border px-3 py-2 text-sm md:w-80"
            />

            <button
              type="button"
              onClick={resetDemo}
              disabled={reseteando}
              className="rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {reseteando ? "Reseteando..." : "Ejecutar reset demo"}
            </button>
          </div>
        </div>
      )}

      <div className="grid gap-4">
        {comprobaciones.map((comprobacion) => (
          <div key={comprobacion.id} className="rounded-xl border bg-white p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="font-semibold">{comprobacion.titulo}</h2>
                  <BadgeGravedad gravedad={comprobacion.gravedad} />
                </div>

                <p className="mt-1 text-sm text-gray-500">
                  {comprobacion.descripcion}
                </p>
              </div>

              <div className="text-right">
                <p className="text-3xl font-bold">{comprobacion.total}</p>
                <p className="text-xs text-gray-500">registros</p>
              </div>
            </div>

            {comprobacion.detalle.length > 0 && (
              <div className="mt-4 rounded-lg bg-gray-50 p-3">
                <p className="mb-2 text-xs font-semibold text-gray-500">
                  Detalle
                </p>

                <ul className="space-y-1 text-sm text-gray-700">
                  {comprobacion.detalle.map((item, index) => (
                    <li key={`${comprobacion.id}-${index}`}>• {item}</li>
                  ))}
                </ul>

                {comprobacion.total > comprobacion.detalle.length && (
                  <p className="mt-2 text-xs text-gray-500">
                    Mostrando solo los primeros {comprobacion.detalle.length} de{" "}
                    {comprobacion.total}.
                  </p>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}