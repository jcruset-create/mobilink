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

type MovimientoStock = {
  id: string;
  tipo: string;
  cantidad: number;
  ubicacion: string | null;
  empresa_id: string;
  cliente_id: string;
  producto_id: string;
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

type LineaStock = {
  clave: string;
  empresaId: string;
  clienteId: string;
  productoId: string;
  cliente: string;
  producto: string;
  ubicacion: string;
  cantidad: number;
};

type Inventario = {
  id: string;
  fecha_creacion: string;
  fecha_conteo: string | null;
  fecha_revision: string | null;
  ubicacion: string | null;
  estado: string | null;
  creado_por: string | null;
  contado_por: string | null;
  revisado_por: string | null;
  observaciones: string | null;
  empresas:
    | {
        nombre: string;
      }
    | {
        nombre: string;
      }[]
    | null;
};

type InventarioLinea = {
  id: string;
  inventario_id: string;
  empresa_id: string;
  cliente_id: string;
  producto_id: string;
  ubicacion: string | null;
  stock_sistema: number;
  stock_fisico: number | null;
  diferencia: number | null;
  estado: string | null;
  observaciones: string | null;
  aprobado: boolean | null;
  revisado_por: string | null;
  revisado_at: string | null;
  movimiento_ajuste_id: string | null;
  incidencia_id: string | null;
  motivo_revision: string | null;
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

const ESTADOS_INVENTARIO = [
  "pendiente_conteo",
  "pendiente_revision",
  "revisado",
];

const ESTADOS_LINEA = [
  "pendiente",
  "ok",
  "diferencia",
  "aprobado_sin_ajuste",
  "ajuste_aprobado",
  "pendiente_investigacion",
  "pendiente_recuento",
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

function fechaDentroDeFiltro(fecha: string, desde: string, hasta: string) {
  const fechaRegistro = new Date(fecha);

  if (desde) {
    const fechaDesde = new Date(`${desde}T00:00:00`);
    if (fechaRegistro < fechaDesde) return false;
  }

  if (hasta) {
    const fechaHasta = new Date(`${hasta}T23:59:59`);
    if (fechaRegistro > fechaHasta) return false;
  }

  return true;
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

export default function Inventarios() {
  const { permisos, cargandoPermisos } = usePermisosAlmacen();

  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [inventarios, setInventarios] = useState<Inventario[]>([]);
  const [lineas, setLineas] = useState<InventarioLinea[]>([]);

  const [empresaId, setEmpresaId] = useState("");
  const [ubicacion, setUbicacion] = useState("");
  const [creadoPor, setCreadoPor] = useState("");
  const [observaciones, setObservaciones] = useState("");

  const [inventarioSeleccionadoId, setInventarioSeleccionadoId] = useState("");
  const [contadoPor, setContadoPor] = useState("");
  const [revisadoPor, setRevisadoPor] = useState("");
  const [mensaje, setMensaje] = useState("");

  const [fechaDesde, setFechaDesde] = useState("");
  const [fechaHasta, setFechaHasta] = useState("");
  const [filtroUbicacion, setFiltroUbicacion] = useState("");
  const [filtroEstadoInventario, setFiltroEstadoInventario] = useState("");
  const [filtroCliente, setFiltroCliente] = useState("");
  const [filtroProducto, setFiltroProducto] = useState("");
  const [filtroEstadoLinea, setFiltroEstadoLinea] = useState("");
  const [filtroTexto, setFiltroTexto] = useState("");

  useEffect(() => {
    cargarDatos();
  }, []);

  useEffect(() => {
    if (inventarioSeleccionadoId) {
      cargarLineasInventario(inventarioSeleccionadoId);
    } else {
      setLineas([]);
    }
  }, [inventarioSeleccionadoId]);

  useEffect(() => {
    const codigo = codigoPerfil();

    setInventarioSeleccionadoId("");
    setLineas([]);
    setContadoPor(codigo);
    setCreadoPor(codigo);
    setRevisadoPor(permisos.esAdmin || permisos.esResponsable ? codigo : "");
    limpiarFiltros();

    if (!permisos.esAdmin && permisos.ubicacion) {
      setUbicacion(permisos.ubicacion);
    }

    if (permisos.esAdmin) {
      setUbicacion("");
    }
  }, [permisos.perfil?.id]);

  function limpiarFiltros() {
    setFechaDesde("");
    setFechaHasta("");
    setFiltroUbicacion("");
    setFiltroEstadoInventario("");
    setFiltroCliente("");
    setFiltroProducto("");
    setFiltroEstadoLinea("");
    setFiltroTexto("");
  }

  function usuarioPuedeUsarCliente(clienteId: string) {
    if (!permisos.perfil) return false;
    if (permisos.esAdmin) return true;

    return permisos.clientesPermitidos.some(
      (cliente) => cliente.id === clienteId
    );
  }

  function usuarioPuedeUsarUbicacion(ubicacionLinea: string | null) {
    if (!permisos.perfil) return false;
    if (permisos.esAdmin) return true;

    if (!ubicacionLinea || !permisos.ubicacion) return false;

    return permisos.ubicacion === ubicacionLinea;
  }

  function usuarioPuedeVerInventario(inventario: Inventario) {
    if (!permisos.perfil) return false;
    if (permisos.esAdmin) return true;

    return usuarioPuedeUsarUbicacion(inventario.ubicacion);
  }

  function usuarioPuedeContarLinea(linea: InventarioLinea) {
    if (!permisos.perfil) return false;
    if (permisos.esAdmin) return true;

    return (
      usuarioPuedeUsarCliente(linea.cliente_id) &&
      usuarioPuedeUsarUbicacion(linea.ubicacion)
    );
  }

  function usuarioPuedeRevisarLinea(linea: InventarioLinea) {
    if (!permisos.perfil) return false;
    if (permisos.esAdmin) return true;
    if (!permisos.esResponsable) return false;

    return (
      usuarioPuedeUsarCliente(linea.cliente_id) &&
      usuarioPuedeUsarUbicacion(linea.ubicacion)
    );
  }

  function usuarioPuedeCrearInventario() {
    if (!permisos.perfil) return false;
    return permisos.esAdmin || permisos.esResponsable;
  }

  function codigoPerfil() {
    return permisos.perfil?.codigo_operario || "";
  }

  async function cargarDatos() {
    setMensaje("");

    const { data: empresasData } = await supabase
      .from("empresas")
      .select("id,nombre")
      .order("nombre");

    const { data: inventariosData, error: inventariosError } = await supabase
      .from("inventarios")
      .select(`
        id,
        fecha_creacion,
        fecha_conteo,
        fecha_revision,
        ubicacion,
        estado,
        creado_por,
        contado_por,
        revisado_por,
        observaciones,
        empresas (
          nombre
        )
      `)
      .order("fecha_creacion", { ascending: false })
      .limit(200);

    if (inventariosError) {
      setMensaje(`Error inventarios: ${inventariosError.message}`);
      return;
    }

    setEmpresas((empresasData || []) as Empresa[]);
    setInventarios((inventariosData || []) as unknown as Inventario[]);

    if (!empresaId && empresasData && empresasData.length > 0) {
      setEmpresaId(empresasData[0].id);
    }
  }

  async function obtenerStockActualPorUbicacion(
    empresaSeleccionadaId: string,
    ubicacionSeleccionada: string
  ) {
    const { data, error } = await supabase
      .from("movimientos_stock")
      .select(`
        id,
        tipo,
        cantidad,
        ubicacion,
        empresa_id,
        cliente_id,
        producto_id,
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
      .eq("empresa_id", empresaSeleccionadaId);

    if (error) {
      setMensaje(`Error stock: ${error.message}`);
      return [];
    }

    const movimientos = (data || []) as unknown as MovimientoStock[];
    const mapa = new Map<string, LineaStock>();

    movimientos.forEach((movimiento) => {
      const cliente = obtenerPrimero(movimiento.clientes);
      const producto = obtenerPrimero(movimiento.productos_neumaticos);

      if (!cliente || !producto) return;

      const ubicacionMovimiento = movimiento.ubicacion || "-";

      if (ubicacionMovimiento !== ubicacionSeleccionada) return;

      if (!permisos.esAdmin && !usuarioPuedeUsarCliente(movimiento.cliente_id)) {
        return;
      }

      if (!permisos.esAdmin && !usuarioPuedeUsarUbicacion(ubicacionMovimiento)) {
        return;
      }

      const productoTexto = textoProductoRelacionado(producto);

      const clave = [
        movimiento.empresa_id,
        movimiento.cliente_id,
        movimiento.producto_id,
        ubicacionMovimiento,
      ].join("|");

      const cantidadMovimiento =
        movimiento.tipo === "SALIDA"
          ? -Math.abs(movimiento.cantidad)
          : Math.abs(movimiento.cantidad);

      const existente = mapa.get(clave);

      if (existente) {
        existente.cantidad += cantidadMovimiento;
      } else {
        mapa.set(clave, {
          clave,
          empresaId: movimiento.empresa_id,
          clienteId: movimiento.cliente_id,
          productoId: movimiento.producto_id,
          cliente: cliente.nombre,
          producto: productoTexto,
          ubicacion: ubicacionMovimiento,
          cantidad: cantidadMovimiento,
        });
      }
    });

    return Array.from(mapa.values()).filter((linea) => linea.cantidad !== 0);
  }

  async function crearInventario() {
    setMensaje("");

    if (!permisos.perfil) {
      setMensaje("No hay perfil activo para el usuario conectado.");
      return;
    }

    if (!usuarioPuedeCrearInventario()) {
      setMensaje("Solo admin o responsable pueden crear inventarios.");
      return;
    }

    if (!empresaId || !ubicacion) {
      setMensaje("Empresa y ubicación son obligatorias.");
      return;
    }

    if (!usuarioPuedeUsarUbicacion(ubicacion)) {
      setMensaje("No tienes permiso para crear inventario en esta ubicación.");
      return;
    }

    const stockActual = await obtenerStockActualPorUbicacion(
      empresaId,
      ubicacion
    );

    if (stockActual.length === 0) {
      setMensaje("No hay stock sistema visible en esta ubicación.");
      return;
    }

    const codigo = creadoPor.trim() || codigoPerfil();

    const { data: inventarioCreado, error: inventarioError } = await supabase
      .from("inventarios")
      .insert({
        empresa_id: empresaId,
        ubicacion,
        estado: "pendiente_conteo",
        creado_por: codigo,
        observaciones: observaciones.trim() || null,
      })
      .select("id")
      .single();

    if (inventarioError) {
      setMensaje(`Error creando inventario: ${inventarioError.message}`);
      return;
    }

    const inventarioId = inventarioCreado.id as string;

    const lineasInsert = stockActual.map((linea) => ({
      inventario_id: inventarioId,
      empresa_id: linea.empresaId,
      cliente_id: linea.clienteId,
      producto_id: linea.productoId,
      ubicacion: linea.ubicacion,
      stock_sistema: linea.cantidad,
      stock_fisico: null,
      diferencia: null,
      estado: "pendiente",
    }));

    const { error: lineasError } = await supabase
      .from("inventario_lineas")
      .insert(lineasInsert);

    if (lineasError) {
      setMensaje(`Error creando líneas: ${lineasError.message}`);
      return;
    }

    await registrarAuditoria({
      modulo: "inventarios",
      accion: "crear_inventario",
      tabla_afectada: "inventarios",
      registro_id: inventarioId,
      descripcion: `Inventario creado en ${ubicacion}.`,
      datos: {
        inventario_id: inventarioId,
        empresa_id: empresaId,
        ubicacion,
        creado_por: codigo,
        lineas_creadas: lineasInsert.length,
      },
    });

    setMensaje("Inventario creado correctamente.");
    setUbicacion(permisos.esAdmin ? "" : permisos.ubicacion || "");
    setObservaciones("");
    setInventarioSeleccionadoId(inventarioId);
    cargarDatos();
  }

  async function cargarLineasInventario(inventarioId: string) {
    const { data, error } = await supabase
      .from("inventario_lineas")
      .select(`
        id,
        inventario_id,
        empresa_id,
        cliente_id,
        producto_id,
        ubicacion,
        stock_sistema,
        stock_fisico,
        diferencia,
        estado,
        observaciones,
        aprobado,
        revisado_por,
        revisado_at,
        movimiento_ajuste_id,
        incidencia_id,
        motivo_revision,
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
      .eq("inventario_id", inventarioId)
      .order("created_at");

    if (error) {
      setMensaje(`Error líneas inventario: ${error.message}`);
      return;
    }

    setLineas((data || []) as unknown as InventarioLinea[]);
  }

  async function actualizarConteoLinea(
    linea: InventarioLinea,
    stockFisicoTexto: string
  ) {
    setMensaje("");

    if (!permisos.perfil) {
      setMensaje("No hay perfil activo para el usuario conectado.");
      return;
    }

    if (!usuarioPuedeContarLinea(linea)) {
      setMensaje("No tienes permiso para contar esta línea.");
      return;
    }

    const stockFisico = Number(stockFisicoTexto);

    if (Number.isNaN(stockFisico) || stockFisico < 0) {
      setMensaje("El stock físico debe ser 0 o superior.");
      return;
    }

    const diferencia = stockFisico - linea.stock_sistema;

    const nuevoEstado =
      linea.estado === "pendiente_recuento"
        ? diferencia === 0
          ? "ok"
          : "diferencia"
        : diferencia === 0
        ? "ok"
        : "diferencia";

    const { error } = await supabase
      .from("inventario_lineas")
      .update({
        stock_fisico: stockFisico,
        diferencia,
        estado: nuevoEstado,
        aprobado: false,
        revisado_por: null,
        revisado_at: null,
        motivo_revision:
          linea.estado === "pendiente_recuento"
            ? "Recuento realizado. Línea vuelve a revisión."
            : linea.motivo_revision,
      })
      .eq("id", linea.id);

    if (error) {
      setMensaje(`Error actualizando línea: ${error.message}`);
      return;
    }

    await registrarAuditoria({
      modulo: "inventarios",
      accion:
        linea.estado === "pendiente_recuento"
          ? "recontar_linea_inventario"
          : "contar_linea_inventario",
      tabla_afectada: "inventario_lineas",
      registro_id: linea.id,
      descripcion: "Conteo físico guardado en línea de inventario.",
      datos: {
        inventario_id: linea.inventario_id,
        linea_id: linea.id,
        empresa_id: linea.empresa_id,
        cliente_id: linea.cliente_id,
        producto_id: linea.producto_id,
        ubicacion: linea.ubicacion,
        stock_sistema: linea.stock_sistema,
        stock_fisico: stockFisico,
        diferencia,
        estado_anterior: linea.estado,
        estado_nuevo: nuevoEstado,
        contado_por: contadoPor.trim() || codigoPerfil(),
      },
    });

    if (linea.estado === "pendiente_recuento") {
      setMensaje("Recuento guardado. La línea vuelve a revisión.");
    }

    cargarLineasInventario(linea.inventario_id);
  }

  async function cerrarConteo() {
    setMensaje("");

    if (!permisos.perfil) {
      setMensaje("No hay perfil activo para el usuario conectado.");
      return;
    }

    if (!inventarioSeleccionadoId) {
      setMensaje("Selecciona un inventario.");
      return;
    }

    const codigo = codigoPerfil();

    if (!codigo) {
      setMensaje("El usuario conectado no tiene código de operario.");
      return;
    }

    const pendientes = lineasVisibles.filter(
      (linea) => linea.stock_fisico === null
    );

    if (pendientes.length > 0) {
      setMensaje("Hay líneas visibles pendientes de contar.");
      return;
    }

    const contado = contadoPor.trim() || codigo;

    const { error } = await supabase
      .from("inventarios")
      .update({
        estado: "pendiente_revision",
        contado_por: contado,
        fecha_conteo: new Date().toISOString(),
      })
      .eq("id", inventarioSeleccionadoId);

    if (error) {
      setMensaje(`Error cerrando conteo: ${error.message}`);
      return;
    }

    await registrarAuditoria({
      modulo: "inventarios",
      accion: "cerrar_conteo_inventario",
      tabla_afectada: "inventarios",
      registro_id: inventarioSeleccionadoId,
      descripcion: "Conteo cerrado y enviado a revisión.",
      datos: {
        inventario_id: inventarioSeleccionadoId,
        contado_por: contado,
        lineas_visibles: lineasVisibles.length,
      },
    });

    setMensaje("Conteo cerrado. Pendiente de revisión por responsable.");
    cargarDatos();
  }

  async function aprobarAjusteLinea(linea: InventarioLinea) {
    setMensaje("");

    if (!permisos.perfil) {
      setMensaje("No hay perfil activo para el usuario conectado.");
      return;
    }

    if (!usuarioPuedeRevisarLinea(linea)) {
      setMensaje("Solo admin o responsable pueden aprobar esta línea.");
      return;
    }

    if (!inventarioSeleccionadoId) {
      setMensaje("Selecciona un inventario.");
      return;
    }

    const codigo = revisadoPor.trim() || codigoPerfil();

    if (!codigo) {
      setMensaje("El usuario conectado no tiene código de responsable.");
      return;
    }

    if (linea.stock_fisico === null || linea.diferencia === null) {
      setMensaje("La línea todavía no tiene conteo físico.");
      return;
    }

    if (linea.diferencia === 0) {
      const { error } = await supabase
        .from("inventario_lineas")
        .update({
          aprobado: true,
          estado: "aprobado_sin_ajuste",
          revisado_por: codigo,
          revisado_at: new Date().toISOString(),
        })
        .eq("id", linea.id);

      if (error) {
        setMensaje(`Error aprobando línea: ${error.message}`);
        return;
      }

      await registrarAuditoria({
        modulo: "inventarios",
        accion: "aprobar_linea_sin_ajuste",
        tabla_afectada: "inventario_lineas",
        registro_id: linea.id,
        descripcion: "Línea de inventario aprobada sin ajuste.",
        datos: {
          inventario_id: inventarioSeleccionadoId,
          linea_id: linea.id,
          empresa_id: linea.empresa_id,
          cliente_id: linea.cliente_id,
          producto_id: linea.producto_id,
          ubicacion: linea.ubicacion,
          stock_sistema: linea.stock_sistema,
          stock_fisico: linea.stock_fisico,
          diferencia: linea.diferencia,
          revisado_por: codigo,
        },
      });

      cargarLineasInventario(inventarioSeleccionadoId);
      return;
    }

    const tipoMovimiento = linea.diferencia > 0 ? "ENTRADA" : "SALIDA";
    const cantidadAjuste = Math.abs(linea.diferencia);

    const { data: movimientoCreado, error: movimientoError } = await supabase
      .from("movimientos_stock")
      .insert({
        empresa_id: linea.empresa_id,
        cliente_id: linea.cliente_id,
        producto_id: linea.producto_id,
        tipo: tipoMovimiento,
        cantidad: cantidadAjuste,
        ubicacion: linea.ubicacion,
        origen_movimiento: "ajuste_inventario",
        observaciones: `Ajuste inventario ${inventarioSeleccionadoId}. Responsable: ${codigo}`,
      })
      .select("id")
      .single();

    if (movimientoError) {
      setMensaje(`Error creando ajuste: ${movimientoError.message}`);
      return;
    }

    const { error: lineaError } = await supabase
      .from("inventario_lineas")
      .update({
        aprobado: true,
        estado: "ajuste_aprobado",
        revisado_por: codigo,
        revisado_at: new Date().toISOString(),
        movimiento_ajuste_id: movimientoCreado.id,
      })
      .eq("id", linea.id);

    if (lineaError) {
      setMensaje(`Error actualizando línea: ${lineaError.message}`);
      return;
    }

    await registrarAuditoria({
      modulo: "inventarios",
      accion: "aprobar_ajuste_inventario",
      tabla_afectada: "inventario_lineas",
      registro_id: linea.id,
      descripcion: "Ajuste de inventario aprobado y movimiento de stock creado.",
      datos: {
        inventario_id: inventarioSeleccionadoId,
        linea_id: linea.id,
        movimiento_ajuste_id: movimientoCreado.id,
        empresa_id: linea.empresa_id,
        cliente_id: linea.cliente_id,
        producto_id: linea.producto_id,
        ubicacion: linea.ubicacion,
        stock_sistema: linea.stock_sistema,
        stock_fisico: linea.stock_fisico,
        diferencia: linea.diferencia,
        tipo_movimiento: tipoMovimiento,
        cantidad_ajuste: cantidadAjuste,
        revisado_por: codigo,
      },
    });

    setMensaje("Ajuste aprobado y movimiento creado.");
    cargarLineasInventario(inventarioSeleccionadoId);
    cargarDatos();
  }

  async function crearIncidenciaRevision(
    linea: InventarioLinea,
    accion: "investigar" | "recontar"
  ) {
    setMensaje("");

    if (!permisos.perfil) {
      setMensaje("No hay perfil activo para el usuario conectado.");
      return;
    }

    if (!usuarioPuedeRevisarLinea(linea)) {
      setMensaje("Solo admin o responsable pueden revisar esta línea.");
      return;
    }

    if (!inventarioSeleccionadoId) {
      setMensaje("Selecciona un inventario.");
      return;
    }

    const codigo = revisadoPor.trim() || codigoPerfil();

    if (!codigo) {
      setMensaje("El usuario conectado no tiene código de responsable.");
      return;
    }

    if (linea.stock_fisico === null || linea.diferencia === null) {
      setMensaje("La línea todavía no tiene conteo físico.");
      return;
    }

    if (linea.diferencia === 0) {
      setMensaje("Esta línea no tiene diferencia.");
      return;
    }

    const estadoLinea =
      accion === "recontar" ? "pendiente_recuento" : "pendiente_investigacion";

    const motivo =
      accion === "recontar"
        ? "Responsable solicita recuento antes de aprobar ajuste."
        : "Responsable solicita investigación antes de aprobar ajuste.";

    const { data: incidenciaCreada, error: incidenciaError } = await supabase
      .from("incidencias")
      .insert({
        empresa_id: linea.empresa_id,
        cliente_id: linea.cliente_id,
        producto_id: linea.producto_id,
        inventario_linea_id: linea.id,
        tipo: "diferencia_inventario",
        gravedad: "media",
        estado: "abierta",
        ubicacion: linea.ubicacion,
        descripcion: `Diferencia de inventario. Sistema: ${linea.stock_sistema}. Físico: ${linea.stock_fisico}. Diferencia: ${linea.diferencia}. Acción responsable: ${accion}.`,
        creada_por: codigo,
      })
      .select("id")
      .single();

    if (incidenciaError) {
      setMensaje(`Error creando incidencia: ${incidenciaError.message}`);
      return;
    }

    const { error: lineaError } = await supabase
      .from("inventario_lineas")
      .update({
        estado: estadoLinea,
        revisado_por: codigo,
        revisado_at: new Date().toISOString(),
        incidencia_id: incidenciaCreada.id,
        motivo_revision: motivo,
      })
      .eq("id", linea.id);

    if (lineaError) {
      setMensaje(`Error actualizando línea: ${lineaError.message}`);
      return;
    }

    await registrarAuditoria({
      modulo: "inventarios",
      accion:
        accion === "recontar"
          ? "solicitar_recuento_inventario"
          : "solicitar_investigacion_inventario",
      tabla_afectada: "inventario_lineas",
      registro_id: linea.id,
      descripcion:
        accion === "recontar"
          ? "Responsable solicita recuento de línea de inventario."
          : "Responsable solicita investigación de diferencia de inventario.",
      datos: {
        inventario_id: inventarioSeleccionadoId,
        linea_id: linea.id,
        incidencia_id: incidenciaCreada.id,
        empresa_id: linea.empresa_id,
        cliente_id: linea.cliente_id,
        producto_id: linea.producto_id,
        ubicacion: linea.ubicacion,
        stock_sistema: linea.stock_sistema,
        stock_fisico: linea.stock_fisico,
        diferencia: linea.diferencia,
        accion_responsable: accion,
        revisado_por: codigo,
      },
    });

    setMensaje(
      accion === "recontar"
        ? "Incidencia creada y línea marcada para recuento."
        : "Incidencia creada y línea marcada para investigación."
    );

    cargarLineasInventario(inventarioSeleccionadoId);
  }

  async function cerrarRevisionInventario() {
    setMensaje("");

    if (!permisos.perfil) {
      setMensaje("No hay perfil activo para el usuario conectado.");
      return;
    }

    if (!permisos.esAdmin && !permisos.esResponsable) {
      setMensaje("Solo admin o responsable pueden cerrar la revisión.");
      return;
    }

    if (!inventarioSeleccionadoId) {
      setMensaje("Selecciona un inventario.");
      return;
    }

    const codigo = revisadoPor.trim() || codigoPerfil();

    if (!codigo) {
      setMensaje("El usuario conectado no tiene código de responsable.");
      return;
    }

    const pendientes = lineasVisibles.filter(
      (linea) =>
        linea.stock_fisico !== null &&
        !linea.aprobado &&
        linea.estado !== "pendiente_investigacion" &&
        linea.estado !== "pendiente_recuento"
    );

    const bloqueadas = lineasVisibles.filter(
      (linea) =>
        linea.estado === "pendiente_investigacion" ||
        linea.estado === "pendiente_recuento"
    );

    if (bloqueadas.length > 0) {
      setMensaje(
        "No puedes cerrar la revisión: hay líneas pendientes de investigación o recuento."
      );
      return;
    }

    if (pendientes.length > 0) {
      setMensaje("Hay líneas contadas pendientes de aprobar.");
      return;
    }

    const { error } = await supabase
      .from("inventarios")
      .update({
        estado: "revisado",
        revisado_por: codigo,
        fecha_revision: new Date().toISOString(),
      })
      .eq("id", inventarioSeleccionadoId);

    if (error) {
      setMensaje(`Error cerrando revisión: ${error.message}`);
      return;
    }

    await registrarAuditoria({
      modulo: "inventarios",
      accion: "cerrar_revision_inventario",
      tabla_afectada: "inventarios",
      registro_id: inventarioSeleccionadoId,
      descripcion: "Inventario revisado y cerrado.",
      datos: {
        inventario_id: inventarioSeleccionadoId,
        revisado_por: codigo,
        lineas_visibles: lineasVisibles.length,
      },
    });

    setMensaje("Inventario revisado correctamente.");
    cargarDatos();
  }

  const inventariosPorPermisos = inventarios.filter((inventario) =>
    usuarioPuedeVerInventario(inventario)
  );

  const inventariosVisibles = inventariosPorPermisos.filter((inventario) => {
    const empresa = obtenerPrimero(inventario.empresas);

    if (
      !fechaDentroDeFiltro(
        inventario.fecha_creacion,
        fechaDesde,
        fechaHasta
      )
    ) {
      return false;
    }

    if (filtroUbicacion && inventario.ubicacion !== filtroUbicacion) {
      return false;
    }

    if (filtroEstadoInventario && inventario.estado !== filtroEstadoInventario) {
      return false;
    }

    if (filtroTexto.trim()) {
      const texto = [
        inventario.id,
        empresa?.nombre || "",
        inventario.ubicacion || "",
        inventario.estado || "",
        inventario.creado_por || "",
        inventario.contado_por || "",
        inventario.revisado_por || "",
        inventario.observaciones || "",
      ]
        .join(" ")
        .toLowerCase();

      if (!texto.includes(filtroTexto.trim().toLowerCase())) return false;
    }

    return true;
  });

  const inventarioSeleccionado = inventariosVisibles.find(
    (inventario) => inventario.id === inventarioSeleccionadoId
  );

  const lineasPorPermisos = lineas.filter((linea) => {
    if (!permisos.perfil) return false;
    if (permisos.esAdmin) return true;

    return (
      usuarioPuedeUsarCliente(linea.cliente_id) &&
      usuarioPuedeUsarUbicacion(linea.ubicacion)
    );
  });

  const lineasVisibles = lineasPorPermisos.filter((linea) => {
    const cliente = obtenerPrimero(linea.clientes);
    const producto = obtenerPrimero(linea.productos_neumaticos);

    if (filtroCliente.trim()) {
      const textoCliente = cliente?.nombre || "";

      if (
        !textoCliente
          .toLowerCase()
          .includes(filtroCliente.trim().toLowerCase())
      ) {
        return false;
      }
    }

    if (filtroProducto.trim()) {
      const textoProducto = textoProductoRelacionado(producto);

      if (
        !textoProducto
          .toLowerCase()
          .includes(filtroProducto.trim().toLowerCase())
      ) {
        return false;
      }
    }

    if (filtroEstadoLinea && linea.estado !== filtroEstadoLinea) {
      return false;
    }

    if (filtroTexto.trim()) {
      const texto = [
        cliente?.nombre || "",
        textoProductoRelacionado(producto),
        linea.ubicacion || "",
        linea.estado || "",
        linea.observaciones || "",
        linea.revisado_por || "",
        linea.motivo_revision || "",
        linea.movimiento_ajuste_id || "",
        linea.incidencia_id || "",
      ]
        .join(" ")
        .toLowerCase();

      if (!texto.includes(filtroTexto.trim().toLowerCase())) return false;
    }

    return true;
  });

  const ubicacionesDisponibles = permisos.esAdmin
    ? UBICACIONES
    : permisos.ubicacion
    ? [permisos.ubicacion]
    : [];

  function filasExportacionInventario(): FilaExportacion[] {
    return lineasVisibles.map((linea) => {
      const cliente = obtenerPrimero(linea.clientes);
      const producto = obtenerPrimero(linea.productos_neumaticos);

      return {
        inventario_id: linea.inventario_id,
        linea_id: linea.id,
        cliente: cliente?.nombre || "-",
        producto: textoProductoRelacionado(producto),
        ubicacion: linea.ubicacion || "-",
        stock_sistema: linea.stock_sistema,
        stock_fisico: linea.stock_fisico ?? "",
        diferencia: linea.diferencia ?? "",
        estado: linea.estado || "-",
        aprobado: linea.aprobado ? "Sí" : "No",
        revisado_por: linea.revisado_por || "",
        revisado_at: linea.revisado_at || "",
        movimiento_ajuste_id: linea.movimiento_ajuste_id || "",
        incidencia_id: linea.incidencia_id || "",
        motivo_revision: linea.motivo_revision || "",
      };
    });
  }

  function nombreBaseInventario() {
    const sufijo = inventarioSeleccionadoId
      ? inventarioSeleccionadoId.slice(0, 8)
      : "sin-seleccion";

    return `inventario-lineas-${sufijo}`;
  }

  function exportarInventarioCsv() {
    const filas = filasExportacionInventario();

    if (!inventarioSeleccionadoId || filas.length === 0) {
      setMensaje("Selecciona un inventario con líneas visibles para exportar.");
      return;
    }

    exportarCsv(nombreBaseInventario(), filas);
  }

  async function exportarInventarioExcel() {
    const filas = filasExportacionInventario();

    if (!inventarioSeleccionadoId || filas.length === 0) {
      setMensaje("Selecciona un inventario con líneas visibles para exportar.");
      return;
    }

    await exportarExcel(nombreBaseInventario(), "Inventario", filas);
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
          <h1 className="text-2xl font-bold">Inventarios</h1>
          <p className="text-sm text-gray-500">
            Generación, conteo y revisión de inventarios por ubicación con
            permisos del usuario conectado. Se cargan los últimos 200
            inventarios.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={exportarInventarioCsv}
            className="rounded-xl border px-4 py-2 text-sm font-semibold disabled:opacity-50"
            disabled={!inventarioSeleccionadoId || lineasVisibles.length === 0}
          >
            Exportar CSV
          </button>

          <button
            type="button"
            onClick={exportarInventarioExcel}
            className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            disabled={!inventarioSeleccionadoId || lineasVisibles.length === 0}
          >
            Exportar Excel
          </button>
        </div>
      </div>

      <div className="rounded-xl border bg-white p-4 space-y-4">
        <h2 className="font-semibold">Crear inventario</h2>

        {!usuarioPuedeCrearInventario() && (
          <p className="rounded-lg bg-yellow-50 p-3 text-sm text-yellow-800">
            Solo un usuario admin o responsable puede crear inventarios.
          </p>
        )}

        <select
          value={empresaId}
          onChange={(e) => setEmpresaId(e.target.value)}
          className="w-full rounded-lg border px-3 py-2 text-sm"
          disabled={!usuarioPuedeCrearInventario()}
        >
          <option value="">Empresa...</option>
          {empresas.map((empresa) => (
            <option key={empresa.id} value={empresa.id}>
              {empresa.nombre}
            </option>
          ))}
        </select>

        <select
          value={ubicacion}
          onChange={(e) => setUbicacion(e.target.value)}
          className="w-full rounded-lg border px-3 py-2 text-sm"
          disabled={!usuarioPuedeCrearInventario()}
        >
          <option value="">Ubicación...</option>
          {ubicacionesDisponibles.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>

        <input
          value={creadoPor}
          onChange={(e) => setCreadoPor(e.target.value)}
          placeholder="Creado por / responsable"
          className="w-full rounded-lg border px-3 py-2 text-sm"
          disabled={!usuarioPuedeCrearInventario()}
        />

        <textarea
          value={observaciones}
          onChange={(e) => setObservaciones(e.target.value)}
          placeholder="Observaciones"
          className="w-full rounded-lg border px-3 py-2 text-sm"
          disabled={!usuarioPuedeCrearInventario()}
        />

        <button
          type="button"
          onClick={crearInventario}
          className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          disabled={!usuarioPuedeCrearInventario()}
        >
          Crear inventario
        </button>

        {mensaje && <p className="text-sm text-gray-700">{mensaje}</p>}
      </div>

      <div className="rounded-xl border bg-white p-4 space-y-4">
        <h2 className="font-semibold">Filtros</h2>

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
            value={filtroUbicacion}
            onChange={(e) => setFiltroUbicacion(e.target.value)}
            className="rounded-lg border px-3 py-2 text-sm"
          >
            <option value="">Todas las ubicaciones</option>
            {ubicacionesDisponibles.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>

          <select
            value={filtroEstadoInventario}
            onChange={(e) => setFiltroEstadoInventario(e.target.value)}
            className="rounded-lg border px-3 py-2 text-sm"
          >
            <option value="">Todos los estados inventario</option>
            {ESTADOS_INVENTARIO.map((estado) => (
              <option key={estado} value={estado}>
                {estado}
              </option>
            ))}
          </select>

          <input
            value={filtroCliente}
            onChange={(e) => setFiltroCliente(e.target.value)}
            placeholder="Filtrar cliente"
            className="rounded-lg border px-3 py-2 text-sm"
          />

          <input
            value={filtroProducto}
            onChange={(e) => setFiltroProducto(e.target.value)}
            placeholder="Producto, medida, marca o DOT"
            className="rounded-lg border px-3 py-2 text-sm"
          />

          <select
            value={filtroEstadoLinea}
            onChange={(e) => setFiltroEstadoLinea(e.target.value)}
            className="rounded-lg border px-3 py-2 text-sm"
          >
            <option value="">Todos los estados línea</option>
            {ESTADOS_LINEA.map((estado) => (
              <option key={estado} value={estado}>
                {estado}
              </option>
            ))}
          </select>

          <input
            value={filtroTexto}
            onChange={(e) => setFiltroTexto(e.target.value)}
            placeholder="Buscar..."
            className="rounded-lg border px-3 py-2 text-sm"
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={limpiarFiltros}
            className="rounded-xl border px-4 py-2 text-sm font-semibold"
          >
            Limpiar filtros
          </button>

          <button
            type="button"
            onClick={cargarDatos}
            className="rounded-xl border px-4 py-2 text-sm font-semibold"
          >
            Actualizar inventarios
          </button>
        </div>
      </div>

      <div className="rounded-xl border bg-white p-4 space-y-4">
        <h2 className="font-semibold">Inventarios creados</h2>

        <select
          value={inventarioSeleccionadoId}
          onChange={(e) => setInventarioSeleccionadoId(e.target.value)}
          className="w-full rounded-lg border px-3 py-2 text-sm"
          disabled={!permisos.perfil}
        >
          <option value="">
            {permisos.perfil
              ? "Selecciona inventario..."
              : "Sin perfil activo..."}
          </option>
          {inventariosVisibles.map((inventario) => {
            const empresa = obtenerPrimero(inventario.empresas);

            return (
              <option key={inventario.id} value={inventario.id}>
                {formatearFecha(inventario.fecha_creacion)} |{" "}
                {empresa?.nombre || "-"} | {inventario.ubicacion || "-"} |{" "}
                {inventario.estado || "-"}
              </option>
            );
          })}
        </select>

        <div className="rounded-lg bg-gray-50 p-3 text-sm text-gray-600">
          Mostrando <strong>{inventariosVisibles.length}</strong> inventarios de{" "}
          <strong>{inventariosPorPermisos.length}</strong> visibles.
        </div>

        {inventarioSeleccionado && (
          <div className="rounded-lg bg-gray-50 p-3 text-sm text-gray-700">
            Ubicación: <strong>{inventarioSeleccionado.ubicacion}</strong>
            <br />
            Estado: <strong>{inventarioSeleccionado.estado}</strong>
            <br />
            Creado por:{" "}
            <strong>{inventarioSeleccionado.creado_por || "-"}</strong>
          </div>
        )}
      </div>

      {inventarioSeleccionado && (
        <div className="rounded-xl border bg-white p-4 space-y-4">
          <h2 className="font-semibold">Conteo físico</h2>

          <div className="rounded-lg bg-gray-50 p-3 text-sm text-gray-600">
            Mostrando <strong>{lineasVisibles.length}</strong> líneas de{" "}
            <strong>{lineasPorPermisos.length}</strong> visibles.
          </div>

          {inventarioSeleccionado.estado === "pendiente_revision" && (
            <div className="rounded-lg border bg-gray-50 p-4 space-y-3">
              <h3 className="font-semibold">Revisión responsable</h3>

              <input
                value={revisadoPor}
                onChange={(e) => setRevisadoPor(e.target.value)}
                placeholder="Código responsable revisión"
                className="w-full rounded-lg border px-3 py-2 text-sm"
                disabled={!permisos.esAdmin && !permisos.esResponsable}
              />

              <p className="text-sm text-gray-600">
                El responsable puede aprobar el ajuste, investigar la diferencia
                o solicitar recuento. Solo al aprobar se genera movimiento de
                stock.
              </p>
            </div>
          )}

          <div className="overflow-auto rounded-xl border bg-white">
            <table className="w-full min-w-[1100px] text-sm">
              <thead className="bg-gray-50 text-left">
                <tr>
                  <th className="p-3">Cliente</th>
                  <th className="p-3">Producto</th>
                  <th className="p-3">Ubicación</th>
                  <th className="p-3 text-right">Sistema</th>
                  <th className="p-3 text-right">Físico</th>
                  <th className="p-3 text-right">Diferencia</th>
                  <th className="p-3">Estado</th>
                  <th className="p-3">Revisión</th>
                  <th className="p-3">Acción</th>
                </tr>
              </thead>

              <tbody>
                {lineasVisibles.map((linea) => {
                  const cliente = obtenerPrimero(linea.clientes);
                  const producto = obtenerPrimero(linea.productos_neumaticos);
                  const productoTexto = textoProductoRelacionado(producto);

                  const puedeContar =
                    usuarioPuedeContarLinea(linea) &&
                    (inventarioSeleccionado.estado === "pendiente_conteo" ||
                      linea.estado === "pendiente_recuento");

                  const puedeRevisar =
                    inventarioSeleccionado.estado === "pendiente_revision" &&
                    usuarioPuedeRevisarLinea(linea) &&
                    !linea.aprobado &&
                    linea.estado !== "pendiente_investigacion" &&
                    linea.estado !== "pendiente_recuento";

                  return (
                    <tr key={linea.id} className="border-t">
                      <td className="p-3">{cliente?.nombre || "-"}</td>
                      <td className="p-3">{productoTexto}</td>
                      <td className="p-3">{linea.ubicacion || "-"}</td>
                      <td className="p-3 text-right">{linea.stock_sistema}</td>

                      <td className="p-3 text-right">
                        <input
                          defaultValue={linea.stock_fisico ?? ""}
                          type="number"
                          min="0"
                          disabled={!puedeContar}
                          onBlur={(e) =>
                            actualizarConteoLinea(linea, e.target.value)
                          }
                          className="w-24 rounded-lg border px-2 py-1 text-right text-sm disabled:bg-gray-100"
                        />
                      </td>

                      <td className="p-3 text-right font-bold">
                        {linea.diferencia ?? "-"}
                      </td>

                      <td className="p-3">{linea.estado || "-"}</td>

                      <td className="p-3">
                        {linea.aprobado ? (
                          <span className="rounded-full bg-green-100 px-2 py-1 text-xs font-semibold text-green-800">
                            Aprobado
                          </span>
                        ) : linea.estado === "diferencia" ? (
                          <span className="rounded-full bg-yellow-100 px-2 py-1 text-xs font-semibold text-yellow-800">
                            Pendiente aprobar
                          </span>
                        ) : (
                          "-"
                        )}
                      </td>

                      <td className="p-3">
                        {puedeRevisar ? (
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => aprobarAjusteLinea(linea)}
                              className="rounded-lg border px-3 py-1 text-xs"
                            >
                              Aprobar ajuste
                            </button>

                            {linea.diferencia !== 0 && (
                              <>
                                <button
                                  type="button"
                                  onClick={() =>
                                    crearIncidenciaRevision(
                                      linea,
                                      "investigar"
                                    )
                                  }
                                  className="rounded-lg border px-3 py-1 text-xs"
                                >
                                  Investigar
                                </button>

                                <button
                                  type="button"
                                  onClick={() =>
                                    crearIncidenciaRevision(linea, "recontar")
                                  }
                                  className="rounded-lg border px-3 py-1 text-xs"
                                >
                                  Recontar
                                </button>
                              </>
                            )}
                          </div>
                        ) : linea.estado === "pendiente_investigacion" ? (
                          <span className="text-xs text-yellow-700">
                            En investigación
                          </span>
                        ) : linea.estado === "pendiente_recuento" ? (
                          <span className="text-xs text-blue-700">
                            Pendiente recuento
                          </span>
                        ) : (
                          "-"
                        )}
                      </td>
                    </tr>
                  );
                })}

                {lineasVisibles.length === 0 && (
                  <tr>
                    <td colSpan={9} className="p-6 text-center text-gray-500">
                      No hay líneas de inventario visibles con los filtros
                      actuales.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {inventarioSeleccionado.estado === "pendiente_revision" &&
            (permisos.esAdmin || permisos.esResponsable) && (
              <button
                type="button"
                onClick={cerrarRevisionInventario}
                className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white"
              >
                Cerrar revisión
              </button>
            )}

          {inventarioSeleccionado.estado === "pendiente_conteo" && (
            <div className="space-y-3">
              <input
                value={contadoPor}
                onChange={(e) => setContadoPor(e.target.value)}
                placeholder="Código operario conteo"
                className="w-full rounded-lg border px-3 py-2 text-sm"
              />

              <button
                type="button"
                onClick={cerrarConteo}
                className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white"
              >
                Cerrar conteo y enviar a revisión
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}