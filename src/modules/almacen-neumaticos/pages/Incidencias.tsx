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

type Empresa = {
  id: string;
  nombre: string;
};

type Cliente = {
  id: string;
  nombre: string;
};

type Producto = {
  id: string;
  marca: string;
  modelo: string | null;
  medida: string;
  dot: string | null;
};

type Incidencia = {
  id: string;
  created_at: string;
  empresa_id: string | null;
  cliente_id: string | null;
  producto_id: string | null;
  inventario_linea_id: string | null;
  tipo: string | null;
  gravedad: string | null;
  estado: string | null;
  ubicacion: string | null;
  descripcion: string | null;
  resolucion: string | null;
  creada_por: string | null;
  resuelta_por: string | null;
  resuelta_at: string | null;
  clientes:
    | {
        nombre: string;
      }
    | {
        nombre: string;
      }[]
    | null;
  productos_neumaticos:
    | {
        marca: string;
        modelo: string | null;
        medida: string;
        dot: string | null;
      }
    | {
        marca: string;
        modelo: string | null;
        medida: string;
        dot: string | null;
      }[]
    | null;
};

const UBICACIONES = [
  "Almacén Central Tarragona",
  "Base Reus",
  "Base Vilanova",
  "Taller Tarragona",
  "En camino",
  "Montado",
  "Central Alicante",
];

const TIPOS_INCIDENCIA = [
  { valor: "diferencia_traspaso", texto: "Diferencia de traspaso" },
  { valor: "diferencia_inventario", texto: "Diferencia de inventario" },
  { valor: "material_danado", texto: "Material dañado" },
  { valor: "error_ubicacion", texto: "Error de ubicación" },
  { valor: "falta_material", texto: "Falta material" },
  { valor: "otros", texto: "Otros" },
];

const GRAVEDADES_INCIDENCIA = [
  { valor: "baja", texto: "Baja" },
  { valor: "media", texto: "Media" },
  { valor: "alta", texto: "Alta" },
  { valor: "critica", texto: "Crítica" },
];

const ESTADOS_INCIDENCIA = [
  { valor: "abierta", texto: "Abierta" },
  { valor: "resuelta", texto: "Resuelta" },
];

function obtenerPrimero<T>(valor: T | T[] | null): T | null {
  if (!valor) return null;
  if (Array.isArray(valor)) return valor[0] || null;
  return valor;
}

function formatearFecha(fecha: string | null) {
  if (!fecha) return "-";
  return new Date(fecha).toLocaleString("es-ES");
}

function fechaHastaFinDia(fecha: string) {
  return `${fecha}T23:59:59`;
}

export default function Incidencias() {
  const { permisos, cargandoPermisos } = usePermisosAlmacen();

  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [incidencias, setIncidencias] = useState<Incidencia[]>([]);

  const [empresaId, setEmpresaId] = useState("");
  const [clienteId, setClienteId] = useState("");
  const [productoId, setProductoId] = useState("");
  const [tipo, setTipo] = useState("diferencia_traspaso");
  const [gravedad, setGravedad] = useState("media");
  const [ubicacion, setUbicacion] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [creadaPor, setCreadaPor] = useState("");
  const [mensaje, setMensaje] = useState("");

  const [resolucionPorId, setResolucionPorId] = useState("");
  const [resolucion, setResolucion] = useState("");
  const [resueltaPor, setResueltaPor] = useState("");

  const [fechaDesde, setFechaDesde] = useState("");
  const [fechaHasta, setFechaHasta] = useState("");
  const [filtroEstado, setFiltroEstado] = useState("");
  const [filtroGravedad, setFiltroGravedad] = useState("");
  const [filtroTipo, setFiltroTipo] = useState("");
  const [filtroProducto, setFiltroProducto] = useState("");
  const [filtroTexto, setFiltroTexto] = useState("");
  const [cargandoIncidencias, setCargandoIncidencias] = useState(false);

  useEffect(() => {
    cargarDatos();
  }, []);

  useEffect(() => {
    const codigo = codigoPerfil();

    setCreadaPor(codigo);
    setResueltaPor(permisos.esAdmin || permisos.esResponsable ? codigo : "");
    setClienteId("");
    setProductoId("");
    setResolucionPorId("");
    setResolucion("");

    if (!permisos.esAdmin && permisos.ubicacion) {
      setUbicacion(permisos.ubicacion);
    }

    if (permisos.esAdmin) {
      setUbicacion("");
    }
  }, [permisos.perfil?.id]);

  function codigoPerfil() {
    return permisos.perfil?.codigo_operario || "";
  }

  function usuarioPuedeGestionar() {
    return permisos.esAdmin || permisos.esResponsable;
  }

  function usuarioPuedeUsarCliente(clienteIdSeleccionado: string | null) {
    if (!permisos.perfil) return false;
    if (permisos.esAdmin) return true;

    if (!clienteIdSeleccionado) return true;

    return permisos.clientesPermitidos.some(
      (cliente) => cliente.id === clienteIdSeleccionado
    );
  }

  function usuarioPuedeUsarUbicacion(ubicacionSeleccionada: string | null) {
    if (!permisos.perfil) return false;
    if (permisos.esAdmin) return true;

    if (!ubicacionSeleccionada) return true;
    if (!permisos.ubicacion) return false;

    return permisos.ubicacion === ubicacionSeleccionada;
  }

  function usuarioPuedeVerIncidencia(incidencia: Incidencia) {
    if (!permisos.perfil) return false;
    if (permisos.esAdmin) return true;

    return (
      usuarioPuedeUsarCliente(incidencia.cliente_id) &&
      usuarioPuedeUsarUbicacion(incidencia.ubicacion)
    );
  }

  function usuarioPuedeCrearIncidencia() {
    return Boolean(permisos.perfil);
  }

  function usuarioPuedeResolverIncidencia(incidencia: Incidencia) {
    if (!usuarioPuedeGestionar()) return false;
    if (permisos.esAdmin) return true;

    return (
      usuarioPuedeUsarCliente(incidencia.cliente_id) &&
      usuarioPuedeUsarUbicacion(incidencia.ubicacion)
    );
  }

  async function cargarDatos() {
    setMensaje("");

    const { data: empresasData } = await supabase
      .from("empresas")
      .select("id,nombre")
      .order("nombre");

    const { data: clientesData } = await supabase
      .from("clientes")
      .select("id,nombre")
      .eq("activo", true)
      .order("nombre");

    const { data: productosData } = await supabase
      .from("productos_neumaticos")
      .select("id,marca,modelo,medida,dot")
      .eq("activo", true)
      .order("medida");

    setEmpresas((empresasData || []) as Empresa[]);
    setClientes((clientesData || []) as Cliente[]);
    setProductos((productosData || []) as Producto[]);

    if (!empresaId && empresasData && empresasData.length > 0) {
      setEmpresaId(empresasData[0].id);
    }

    await cargarIncidencias();
  }

  async function cargarIncidencias() {
    setMensaje("");
    setCargandoIncidencias(true);

    let query = supabase
      .from("incidencias")
      .select(`
        id,
        created_at,
        empresa_id,
        cliente_id,
        producto_id,
        inventario_linea_id,
        tipo,
        gravedad,
        estado,
        ubicacion,
        descripcion,
        resolucion,
        creada_por,
        resuelta_por,
        resuelta_at,
        clientes (
          nombre
        ),
        productos_neumaticos (
          marca,
          modelo,
          medida,
          dot
        )
      `)
      .order("created_at", { ascending: false })
      .limit(200);

    if (fechaDesde) {
      query = query.gte("created_at", `${fechaDesde}T00:00:00`);
    }

    if (fechaHasta) {
      query = query.lte("created_at", fechaHastaFinDia(fechaHasta));
    }

    if (filtroEstado) {
      query = query.eq("estado", filtroEstado);
    }

    if (filtroGravedad) {
      query = query.eq("gravedad", filtroGravedad);
    }

    if (filtroTipo) {
      query = query.eq("tipo", filtroTipo);
    }

    const { data: incidenciasData, error: incidenciasError } = await query;

    setCargandoIncidencias(false);

    if (incidenciasError) {
      setMensaje(`Error incidencias: ${incidenciasError.message}`);
      return;
    }

    setIncidencias((incidenciasData || []) as unknown as Incidencia[]);
  }

  function limpiarFiltrosIncidencias() {
    setFechaDesde("");
    setFechaHasta("");
    setFiltroEstado("");
    setFiltroGravedad("");
    setFiltroTipo("");
    setFiltroProducto("");
    setFiltroTexto("");
  }

  async function crearIncidencia() {
    setMensaje("");

    if (!permisos.perfil) {
      setMensaje("No hay perfil activo para el usuario conectado.");
      return;
    }

    if (!empresaId || !tipo || !descripcion.trim()) {
      setMensaje("Empresa, tipo y descripción son obligatorios.");
      return;
    }

    if (clienteId && !usuarioPuedeUsarCliente(clienteId)) {
      setMensaje("No tienes permiso para crear incidencias de este cliente.");
      return;
    }

    if (ubicacion && !usuarioPuedeUsarUbicacion(ubicacion)) {
      setMensaje("No tienes permiso para crear incidencias en esta ubicación.");
      return;
    }

    const codigo = creadaPor.trim() || codigoPerfil() || null;

    const { data: incidenciaCreada, error } = await supabase
      .from("incidencias")
      .insert({
        empresa_id: empresaId,
        cliente_id: clienteId || null,
        producto_id: productoId || null,
        tipo,
        gravedad,
        estado: "abierta",
        ubicacion: ubicacion.trim() || null,
        descripcion: descripcion.trim(),
        creada_por: codigo,
      })
      .select("id")
      .single();

    if (error) {
      setMensaje(`Error: ${error.message}`);
      return;
    }

    await registrarAuditoria({
      modulo: "incidencias",
      accion: "crear_incidencia",
      tabla_afectada: "incidencias",
      registro_id: incidenciaCreada.id,
      descripcion: "Incidencia creada manualmente desde pantalla de incidencias.",
      datos: {
        incidencia_id: incidenciaCreada.id,
        empresa_id: empresaId,
        cliente_id: clienteId || null,
        producto_id: productoId || null,
        tipo,
        gravedad,
        ubicacion: ubicacion.trim() || null,
        creada_por: codigo,
      },
    });

    setMensaje("Incidencia creada correctamente.");
    setClienteId("");
    setProductoId("");
    setTipo("diferencia_traspaso");
    setGravedad("media");
    setDescripcion("");
    setCreadaPor(codigoPerfil());

    if (permisos.esAdmin) {
      setUbicacion("");
    }

    cargarDatos();
  }

  function prepararResolucion(id: string) {
    const incidencia = incidencias.find((item) => item.id === id);

    if (!incidencia) {
      setMensaje("No se ha encontrado la incidencia.");
      return;
    }

    if (!usuarioPuedeResolverIncidencia(incidencia)) {
      setMensaje("No tienes permiso para resolver esta incidencia.");
      return;
    }

    setResolucionPorId(id);
    setResolucion("");
    setResueltaPor(codigoPerfil());
    setMensaje("");
  }

  async function resolverIncidencia() {
    setMensaje("");

    if (!resolucionPorId) {
      setMensaje("Selecciona una incidencia.");
      return;
    }

    if (!resolucion.trim()) {
      setMensaje("La resolución es obligatoria.");
      return;
    }

    if (!resueltaPor.trim()) {
      setMensaje("Indica quién resuelve la incidencia.");
      return;
    }

    const incidencia = incidencias.find((item) => item.id === resolucionPorId);

    if (!incidencia) {
      setMensaje("No se ha encontrado la incidencia seleccionada.");
      return;
    }

    if (!usuarioPuedeResolverIncidencia(incidencia)) {
      setMensaje("No tienes permiso para resolver esta incidencia.");
      return;
    }

    const resolucionTexto = resolucion.trim();
    const codigo = resueltaPor.trim();
    const ahora = new Date().toISOString();

    const { error } = await supabase
      .from("incidencias")
      .update({
        estado: "resuelta",
        resolucion: resolucionTexto,
        resuelta_por: codigo,
        resuelta_at: ahora,
      })
      .eq("id", resolucionPorId);

    if (error) {
      setMensaje(`Error: ${error.message}`);
      return;
    }

    let nuevoEstadoLinea: string | null = null;

    if (incidencia.inventario_linea_id) {
      nuevoEstadoLinea =
        resolucionTexto.toLowerCase().includes("recontar") ||
        resolucionTexto.toLowerCase().includes("recuento")
          ? "pendiente_recuento"
          : "diferencia";

      const { error: lineaError } = await supabase
        .from("inventario_lineas")
        .update({
          estado: nuevoEstadoLinea,
          motivo_revision: `Incidencia resuelta: ${resolucionTexto}`,
        })
        .eq("id", incidencia.inventario_linea_id);

      if (lineaError) {
        setMensaje(
          `Incidencia resuelta, pero error desbloqueando línea: ${lineaError.message}`
        );
        return;
      }
    }

    await registrarAuditoria({
      modulo: "incidencias",
      accion: "resolver_incidencia",
      tabla_afectada: "incidencias",
      registro_id: resolucionPorId,
      descripcion: "Incidencia resuelta desde pantalla de incidencias.",
      datos: {
        incidencia_id: resolucionPorId,
        empresa_id: incidencia.empresa_id,
        cliente_id: incidencia.cliente_id,
        producto_id: incidencia.producto_id,
        inventario_linea_id: incidencia.inventario_linea_id,
        tipo: incidencia.tipo,
        gravedad: incidencia.gravedad,
        ubicacion: incidencia.ubicacion,
        estado_anterior: incidencia.estado,
        estado_nuevo: "resuelta",
        resolucion: resolucionTexto,
        resuelta_por: codigo,
        nuevo_estado_linea_inventario: nuevoEstadoLinea,
      },
    });

    setMensaje("Incidencia resuelta correctamente.");
    setResolucionPorId("");
    setResolucion("");
    setResueltaPor(codigoPerfil());
    cargarDatos();
  }

  function textoProducto(producto: Producto) {
    return `${producto.medida} - ${producto.marca}${
      producto.modelo ? ` ${producto.modelo}` : ""
    }${producto.dot ? ` - DOT ${producto.dot}` : ""}`;
  }

  function textoProductoRelacionado(
    producto:
      | {
          marca: string;
          modelo: string | null;
          medida: string;
          dot: string | null;
        }
      | null
  ) {
    if (!producto) return "-";

    return `${producto.medida} - ${producto.marca}${
      producto.modelo ? ` ${producto.modelo}` : ""
    }${producto.dot ? ` - DOT ${producto.dot}` : ""}`;
  }

  const clientesVisibles = permisos.esAdmin
    ? clientes
    : clientes.filter((cliente) =>
        permisos.clientesPermitidos.some(
          (permitido) => permitido.id === cliente.id
        )
      );

  const ubicacionesVisibles = permisos.esAdmin
    ? UBICACIONES
    : permisos.ubicacion
    ? [permisos.ubicacion]
    : [];

  const incidenciasPorPermisos = incidencias.filter((incidencia) =>
    usuarioPuedeVerIncidencia(incidencia)
  );

  const incidenciasVisibles = incidenciasPorPermisos.filter((incidencia) => {
    const producto = obtenerPrimero(incidencia.productos_neumaticos);

    if (
      filtroProducto.trim() &&
      !textoProductoRelacionado(producto)
        .toLowerCase()
        .includes(filtroProducto.trim().toLowerCase())
    ) {
      return false;
    }

    if (!filtroTexto.trim()) return true;

    const cliente = obtenerPrimero(incidencia.clientes);

    const texto = [
      incidencia.id,
      incidencia.estado || "",
      incidencia.tipo || "",
      incidencia.gravedad || "",
      cliente?.nombre || "",
      textoProductoRelacionado(producto),
      incidencia.ubicacion || "",
      incidencia.descripcion || "",
      incidencia.creada_por || "",
      incidencia.resolucion || "",
      incidencia.resuelta_por || "",
      incidencia.inventario_linea_id || "",
    ]
      .join(" ")
      .toLowerCase();

    return texto.includes(filtroTexto.trim().toLowerCase());
  });

  const incidenciaSeleccionada = incidencias.find(
    (incidencia) => incidencia.id === resolucionPorId
  );

  function filasExportacionIncidencias(): FilaExportacion[] {
    return incidenciasVisibles.map((incidencia) => {
      const cliente = obtenerPrimero(incidencia.clientes);
      const producto = obtenerPrimero(incidencia.productos_neumaticos);

      return {
        incidencia_id: incidencia.id,
        fecha_creacion: incidencia.created_at,
        estado: incidencia.estado || "",
        tipo: incidencia.tipo || "",
        gravedad: incidencia.gravedad || "",
        cliente: cliente?.nombre || "-",
        producto: textoProductoRelacionado(producto),
        ubicacion: incidencia.ubicacion || "-",
        descripcion: incidencia.descripcion || "",
        creada_por: incidencia.creada_por || "",
        resolucion: incidencia.resolucion || "",
        resuelta_por: incidencia.resuelta_por || "",
        resuelta_at: incidencia.resuelta_at || "",
        empresa_id: incidencia.empresa_id || "",
        cliente_id: incidencia.cliente_id || "",
        producto_id: incidencia.producto_id || "",
        inventario_linea_id: incidencia.inventario_linea_id || "",
      };
    });
  }

  function exportarIncidenciasCsv() {
    const filas = filasExportacionIncidencias();

    if (filas.length === 0) {
      setMensaje("No hay incidencias visibles para exportar.");
      return;
    }

    exportarCsv("incidencias", filas);
  }

  async function exportarIncidenciasExcel() {
    const filas = filasExportacionIncidencias();

    if (filas.length === 0) {
      setMensaje("No hay incidencias visibles para exportar.");
      return;
    }

    await exportarExcel("incidencias", "Incidencias", filas);
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
          <h1 className="text-2xl font-bold">Incidencias</h1>
          <p className="text-sm text-gray-500">
            Registro y resolución de incidencias de almacén con permisos del
            usuario conectado. Se cargan las últimas 200 incidencias según
            filtros.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={exportarIncidenciasCsv}
            className="rounded-xl border px-4 py-2 text-sm font-semibold disabled:opacity-50"
            disabled={incidenciasVisibles.length === 0}
          >
            Exportar CSV
          </button>

          <button
            type="button"
            onClick={exportarIncidenciasExcel}
            className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            disabled={incidenciasVisibles.length === 0}
          >
            Exportar Excel
          </button>
        </div>
      </div>

      <div className="rounded-xl border bg-white p-4 space-y-4">
        <h2 className="font-semibold">Crear incidencia</h2>

        {!usuarioPuedeCrearIncidencia() && (
          <p className="rounded-lg bg-yellow-50 p-3 text-sm text-yellow-800">
            Necesitas un perfil activo para crear incidencias.
          </p>
        )}

        <select
          value={empresaId}
          onChange={(e) => setEmpresaId(e.target.value)}
          className="w-full rounded-lg border px-3 py-2 text-sm"
          disabled={!usuarioPuedeCrearIncidencia()}
        >
          <option value="">Empresa...</option>
          {empresas.map((empresa) => (
            <option key={empresa.id} value={empresa.id}>
              {empresa.nombre}
            </option>
          ))}
        </select>

        <select
          value={clienteId}
          onChange={(e) => setClienteId(e.target.value)}
          className="w-full rounded-lg border px-3 py-2 text-sm"
          disabled={!usuarioPuedeCrearIncidencia()}
        >
          <option value="">Cliente opcional...</option>
          {clientesVisibles.map((cliente) => (
            <option key={cliente.id} value={cliente.id}>
              {cliente.nombre}
            </option>
          ))}
        </select>

        <select
          value={productoId}
          onChange={(e) => setProductoId(e.target.value)}
          className="w-full rounded-lg border px-3 py-2 text-sm"
          disabled={!usuarioPuedeCrearIncidencia()}
        >
          <option value="">Producto opcional...</option>
          {productos.map((producto) => (
            <option key={producto.id} value={producto.id}>
              {textoProducto(producto)}
            </option>
          ))}
        </select>

        <select
          value={tipo}
          onChange={(e) => setTipo(e.target.value)}
          className="w-full rounded-lg border px-3 py-2 text-sm"
          disabled={!usuarioPuedeCrearIncidencia()}
        >
          {TIPOS_INCIDENCIA.map((item) => (
            <option key={item.valor} value={item.valor}>
              {item.texto}
            </option>
          ))}
        </select>

        <select
          value={gravedad}
          onChange={(e) => setGravedad(e.target.value)}
          className="w-full rounded-lg border px-3 py-2 text-sm"
          disabled={!usuarioPuedeCrearIncidencia()}
        >
          {GRAVEDADES_INCIDENCIA.map((item) => (
            <option key={item.valor} value={item.valor}>
              {item.texto}
            </option>
          ))}
        </select>

        <select
          value={ubicacion}
          onChange={(e) => setUbicacion(e.target.value)}
          className="w-full rounded-lg border px-3 py-2 text-sm"
          disabled={!usuarioPuedeCrearIncidencia()}
        >
          <option value="">Ubicación opcional...</option>
          {ubicacionesVisibles.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>

        <textarea
          value={descripcion}
          onChange={(e) => setDescripcion(e.target.value)}
          placeholder="Descripción de la incidencia"
          className="w-full rounded-lg border px-3 py-2 text-sm"
          disabled={!usuarioPuedeCrearIncidencia()}
        />

        <input
          value={creadaPor}
          onChange={(e) => setCreadaPor(e.target.value)}
          placeholder="Creada por / código operario"
          className="w-full rounded-lg border px-3 py-2 text-sm"
          disabled={!usuarioPuedeCrearIncidencia()}
        />

        <button
          type="button"
          onClick={crearIncidencia}
          className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          disabled={!usuarioPuedeCrearIncidencia()}
        >
          Crear incidencia
        </button>

        {mensaje && <p className="text-sm text-gray-700">{mensaje}</p>}
      </div>

      {incidenciaSeleccionada && (
        <div className="rounded-xl border bg-white p-4 space-y-4">
          <h2 className="font-semibold">Resolver incidencia</h2>

          <div className="rounded-lg bg-gray-50 p-3 text-sm">
            <strong>Incidencia:</strong>{" "}
            {incidenciaSeleccionada.descripcion || "-"}
          </div>

          <textarea
            value={resolucion}
            onChange={(e) => setResolucion(e.target.value)}
            placeholder="Resolución aplicada"
            className="w-full rounded-lg border px-3 py-2 text-sm"
          />

          <input
            value={resueltaPor}
            onChange={(e) => setResueltaPor(e.target.value)}
            placeholder="Resuelta por / código responsable"
            className="w-full rounded-lg border px-3 py-2 text-sm"
          />

          <button
            type="button"
            onClick={resolverIncidencia}
            className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white"
          >
            Confirmar resolución
          </button>
        </div>
      )}

      <div className="rounded-xl border bg-white p-4 space-y-4">
        <h2 className="font-semibold">Filtros de incidencias</h2>

        <div className="grid gap-3 md:grid-cols-4">
          <input
            type="date"
            value={fechaDesde}
            onChange={(e) => setFechaDesde(e.target.value)}
            className="rounded-lg border px-3 py-2 text-sm"
          />

          <input
            type="date"
            value={fechaHasta}
            onChange={(e) => setFechaHasta(e.target.value)}
            className="rounded-lg border px-3 py-2 text-sm"
          />

          <select
            value={filtroEstado}
            onChange={(e) => setFiltroEstado(e.target.value)}
            className="rounded-lg border px-3 py-2 text-sm"
          >
            <option value="">Todos los estados</option>
            {ESTADOS_INCIDENCIA.map((item) => (
              <option key={item.valor} value={item.valor}>
                {item.texto}
              </option>
            ))}
          </select>

          <select
            value={filtroGravedad}
            onChange={(e) => setFiltroGravedad(e.target.value)}
            className="rounded-lg border px-3 py-2 text-sm"
          >
            <option value="">Todas las gravedades</option>
            {GRAVEDADES_INCIDENCIA.map((item) => (
              <option key={item.valor} value={item.valor}>
                {item.texto}
              </option>
            ))}
          </select>

          <select
            value={filtroTipo}
            onChange={(e) => setFiltroTipo(e.target.value)}
            className="rounded-lg border px-3 py-2 text-sm"
          >
            <option value="">Todos los tipos</option>
            {TIPOS_INCIDENCIA.map((item) => (
              <option key={item.valor} value={item.valor}>
                {item.texto}
              </option>
            ))}
          </select>

          <input
            value={filtroProducto}
            onChange={(e) => setFiltroProducto(e.target.value)}
            placeholder="Filtrar por producto, medida, marca o DOT"
            className="rounded-lg border px-3 py-2 text-sm"
          />

          <input
            value={filtroTexto}
            onChange={(e) => setFiltroTexto(e.target.value)}
            placeholder="Buscar cliente, ubicación, descripción..."
            className="rounded-lg border px-3 py-2 text-sm md:col-span-2"
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={cargarIncidencias}
            className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white"
          >
            {cargandoIncidencias ? "Buscando..." : "Buscar"}
          </button>

          <button
            type="button"
            onClick={limpiarFiltrosIncidencias}
            className="rounded-xl border px-4 py-2 text-sm font-semibold"
          >
            Limpiar filtros
          </button>
        </div>
      </div>

      <div className="rounded-xl border bg-white p-3 text-sm text-gray-600">
        Mostrando <strong>{incidenciasVisibles.length}</strong> incidencias de{" "}
        <strong>{incidenciasPorPermisos.length}</strong> visibles y{" "}
        <strong>{incidencias.length}</strong> cargadas.
      </div>

      <div className="overflow-auto rounded-xl border bg-white">
        <table className="w-full min-w-[1300px] text-sm">
          <thead className="bg-gray-50 text-left">
            <tr>
              <th className="p-3">Fecha</th>
              <th className="p-3">Estado</th>
              <th className="p-3">Tipo</th>
              <th className="p-3">Gravedad</th>
              <th className="p-3">Cliente</th>
              <th className="p-3">Producto</th>
              <th className="p-3">Ubicación</th>
              <th className="p-3">Descripción</th>
              <th className="p-3">Creada por</th>
              <th className="p-3">Resolución</th>
              <th className="p-3">Acción</th>
            </tr>
          </thead>

          <tbody>
            {incidenciasVisibles.map((incidencia) => {
              const cliente = obtenerPrimero(incidencia.clientes);
              const producto = obtenerPrimero(incidencia.productos_neumaticos);
              const puedeResolver = usuarioPuedeResolverIncidencia(incidencia);

              const productoTexto = textoProductoRelacionado(producto);

              return (
                <tr key={incidencia.id} className="border-t align-top">
                  <td className="p-3">
                    {formatearFecha(incidencia.created_at)}
                  </td>
                  <td className="p-3 font-medium">
                    {incidencia.estado || "-"}
                  </td>
                  <td className="p-3">{incidencia.tipo || "-"}</td>
                  <td className="p-3">{incidencia.gravedad || "-"}</td>
                  <td className="p-3">{cliente?.nombre || "-"}</td>
                  <td className="p-3">{productoTexto}</td>
                  <td className="p-3">{incidencia.ubicacion || "-"}</td>
                  <td className="p-3">{incidencia.descripcion || "-"}</td>
                  <td className="p-3">{incidencia.creada_por || "-"}</td>
                  <td className="p-3">{incidencia.resolucion || "-"}</td>
                  <td className="p-3">
                    {incidencia.estado !== "resuelta" && puedeResolver ? (
                      <button
                        type="button"
                        onClick={() => prepararResolucion(incidencia.id)}
                        className="rounded-lg border px-3 py-1 text-xs"
                      >
                        Resolver
                      </button>
                    ) : incidencia.estado !== "resuelta" ? (
                      <span className="text-xs text-gray-500">
                        Sin permiso
                      </span>
                    ) : (
                      "-"
                    )}
                  </td>
                </tr>
              );
            })}

            {incidenciasVisibles.length === 0 && (
              <tr>
                <td colSpan={11} className="p-6 text-center text-gray-500">
                  No hay incidencias visibles con los filtros actuales.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <button
        type="button"
        onClick={cargarDatos}
        className="rounded-xl border px-4 py-2 text-sm font-semibold"
      >
        Actualizar incidencias
      </button>
    </div>
  );
}