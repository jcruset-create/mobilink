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

type MovimientoStock = {
  id: string;
  tipo: string;
  cantidad: number;
  ubicacion: string | null;
  empresa_id: string;
  cliente_id: string;
  producto_id: string;
};

type StockMinimo = {
  id: string;
  empresa_id: string;
  cliente_id: string;
  producto_id: string;
  ubicacion: string | null;
  cantidad_minima: number;
  cantidad_reposicion: number;
  activo: boolean | null;
  observaciones: string | null;
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

type SolicitudReposicion = {
  id: string;
  created_at: string;
  empresa_id: string;
  cliente_id: string;
  producto_id: string;
  ubicacion: string | null;
  stock_actual: number | null;
  stock_minimo: number | null;
  stock_reposicion: number | null;
  cantidad_sugerida: number | null;
  estado: string | null;
  origen: string | null;
  solicitada_por: string | null;
  aprobada_por: string | null;
  movimiento_id: string | null;
  traspaso_id: string | null;
  observaciones: string | null;
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

export default function Reposiciones() {
  const { permisos, cargandoPermisos } = usePermisosAlmacen();

  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [stockMinimos, setStockMinimos] = useState<StockMinimo[]>([]);
  const [solicitudes, setSolicitudes] = useState<SolicitudReposicion[]>([]);

  const [empresaId, setEmpresaId] = useState("");
  const [clienteId, setClienteId] = useState("");
  const [productoId, setProductoId] = useState("");
  const [ubicacion, setUbicacion] = useState("");
  const [cantidadMinima, setCantidadMinima] = useState("0");
  const [cantidadReposicion, setCantidadReposicion] = useState("0");
  const [observaciones, setObservaciones] = useState("");
  const [solicitadaPor, setSolicitadaPor] = useState("");
  const [aprobadaPor, setAprobadaPor] = useState("");
  const [mensaje, setMensaje] = useState("");

  const [filtroCliente, setFiltroCliente] = useState("");
  const [filtroProducto, setFiltroProducto] = useState("");
  const [filtroUbicacion, setFiltroUbicacion] = useState("");
  const [filtroEstado, setFiltroEstado] = useState("");
  const [filtroTexto, setFiltroTexto] = useState("");
  const [fechaDesde, setFechaDesde] = useState("");
  const [fechaHasta, setFechaHasta] = useState("");

  useEffect(() => {
    cargarDatos();
  }, []);

  useEffect(() => {
    const codigo = codigoPerfil();

    setSolicitadaPor(codigo);
    setAprobadaPor(permisos.esAdmin || permisos.esResponsable ? codigo : "");
    setClienteId("");
    setProductoId("");

    if (!permisos.esAdmin && permisos.ubicacion) {
      setUbicacion(permisos.ubicacion);
    }

    if (permisos.esAdmin) {
      setUbicacion("");
    }

    limpiarFiltros();
  }, [permisos.perfil?.id]);

  function limpiarFiltros() {
    setFiltroCliente("");
    setFiltroProducto("");
    setFiltroUbicacion("");
    setFiltroEstado("");
    setFiltroTexto("");
    setFechaDesde("");
    setFechaHasta("");
  }

  function codigoPerfil() {
    return permisos.perfil?.codigo_operario || "";
  }

  function usuarioPuedeGestionar() {
    return permisos.esAdmin || permisos.esResponsable;
  }

  function usuarioPuedeUsarCliente(clienteIdSeleccionado: string) {
    if (!permisos.perfil) return false;
    if (permisos.esAdmin) return true;

    return permisos.clientesPermitidos.some(
      (cliente) => cliente.id === clienteIdSeleccionado
    );
  }

  function usuarioPuedeUsarUbicacion(ubicacionSeleccionada: string | null) {
    if (!permisos.perfil) return false;
    if (permisos.esAdmin) return true;

    if (!ubicacionSeleccionada || !permisos.ubicacion) return false;

    return permisos.ubicacion === ubicacionSeleccionada;
  }

  function usuarioPuedeVerMinimo(minimo: StockMinimo) {
    if (!permisos.perfil) return false;
    if (permisos.esAdmin) return true;

    return (
      usuarioPuedeUsarCliente(minimo.cliente_id) &&
      usuarioPuedeUsarUbicacion(minimo.ubicacion)
    );
  }

  function usuarioPuedeVerSolicitud(solicitud: SolicitudReposicion) {
    if (!permisos.perfil) return false;
    if (permisos.esAdmin) return true;

    return (
      usuarioPuedeUsarCliente(solicitud.cliente_id) &&
      usuarioPuedeUsarUbicacion(solicitud.ubicacion)
    );
  }

  function usuarioPuedeGestionarSolicitud(solicitud: SolicitudReposicion) {
    if (!usuarioPuedeGestionar()) return false;
    if (permisos.esAdmin) return true;

    return (
      usuarioPuedeUsarCliente(solicitud.cliente_id) &&
      usuarioPuedeUsarUbicacion(solicitud.ubicacion)
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

    const { data: minimosData, error: minimosError } = await supabase
      .from("stock_minimos")
      .select(`
        id,
        empresa_id,
        cliente_id,
        producto_id,
        ubicacion,
        cantidad_minima,
        cantidad_reposicion,
        activo,
        observaciones,
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
      .order("created_at", { ascending: false });

    if (minimosError) {
      setMensaje(`Error mínimos: ${minimosError.message}`);
      return;
    }

    const { data: solicitudesData, error: solicitudesError } = await supabase
      .from("solicitudes_reposicion")
      .select(`
        id,
        created_at,
        empresa_id,
        cliente_id,
        producto_id,
        ubicacion,
        stock_actual,
        stock_minimo,
        stock_reposicion,
        cantidad_sugerida,
        estado,
        origen,
        solicitada_por,
        aprobada_por,
        movimiento_id,
        traspaso_id,
        observaciones,
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

    if (solicitudesError) {
      setMensaje(`Error solicitudes: ${solicitudesError.message}`);
      return;
    }

    setEmpresas((empresasData || []) as Empresa[]);
    setClientes((clientesData || []) as Cliente[]);
    setProductos((productosData || []) as Producto[]);
    setStockMinimos((minimosData || []) as unknown as StockMinimo[]);
    setSolicitudes((solicitudesData || []) as unknown as SolicitudReposicion[]);

    if (!empresaId && empresasData && empresasData.length > 0) {
      setEmpresaId(empresasData[0].id);
    }
  }

  async function calcularStockActual(
    empresaSeleccionadaId: string,
    clienteSeleccionadoId: string,
    productoSeleccionadoId: string,
    ubicacionSeleccionada: string
  ) {
    const { data, error } = await supabase
      .from("movimientos_stock")
      .select("id,tipo,cantidad,ubicacion,empresa_id,cliente_id,producto_id")
      .eq("empresa_id", empresaSeleccionadaId)
      .eq("cliente_id", clienteSeleccionadoId)
      .eq("producto_id", productoSeleccionadoId);

    if (error) {
      setMensaje(`Error calculando stock: ${error.message}`);
      return 0;
    }

    const movimientos = (data || []) as MovimientoStock[];

    return movimientos.reduce((total, movimiento) => {
      const ubicacionMovimiento = movimiento.ubicacion || "-";

      if (ubicacionMovimiento !== ubicacionSeleccionada) {
        return total;
      }

      if (movimiento.tipo === "SALIDA") {
        return total - Math.abs(movimiento.cantidad);
      }

      return total + Math.abs(movimiento.cantidad);
    }, 0);
  }

  async function crearStockMinimo() {
    setMensaje("");

    if (!permisos.perfil) {
      setMensaje("No hay perfil activo para el usuario conectado.");
      return;
    }

    if (!usuarioPuedeGestionar()) {
      setMensaje("Solo admin o responsable pueden crear mínimos.");
      return;
    }

    if (!empresaId || !clienteId || !productoId || !ubicacion) {
      setMensaje("Empresa, cliente, producto y ubicación son obligatorios.");
      return;
    }

    if (!usuarioPuedeUsarCliente(clienteId)) {
      setMensaje("No tienes permiso para crear mínimos de este cliente.");
      return;
    }

    if (!usuarioPuedeUsarUbicacion(ubicacion)) {
      setMensaje("No tienes permiso para crear mínimos en esta ubicación.");
      return;
    }

    const cantidad = Number(cantidadMinima);
    const reposicion = Number(cantidadReposicion);

    if (Number.isNaN(cantidad) || cantidad < 0) {
      setMensaje("La cantidad mínima debe ser 0 o superior.");
      return;
    }

    if (Number.isNaN(reposicion) || reposicion <= 0) {
      setMensaje("La cantidad de reposición debe ser mayor que 0.");
      return;
    }

    if (reposicion <= cantidad) {
      setMensaje("La cantidad de reposición debe ser mayor que el stock mínimo.");
      return;
    }

    const { data: minimoCreado, error } = await supabase
      .from("stock_minimos")
      .insert({
        empresa_id: empresaId,
        cliente_id: clienteId,
        producto_id: productoId,
        ubicacion,
        cantidad_minima: cantidad,
        cantidad_reposicion: reposicion,
        activo: true,
        observaciones: observaciones.trim() || null,
      })
      .select("id")
      .single();

    if (error) {
      setMensaje(`Error creando mínimo: ${error.message}`);
      return;
    }

    await registrarAuditoria({
      modulo: "reposiciones",
      accion: "crear_stock_minimo",
      tabla_afectada: "stock_minimos",
      registro_id: minimoCreado.id,
      descripcion: "Stock mínimo creado desde pantalla de reposiciones.",
      datos: {
        empresa_id: empresaId,
        cliente_id: clienteId,
        producto_id: productoId,
        ubicacion,
        cantidad_minima: cantidad,
        cantidad_reposicion: reposicion,
      },
    });

    setMensaje("Stock mínimo creado correctamente.");
    setClienteId("");
    setProductoId("");
    setCantidadMinima("0");
    setCantidadReposicion("0");
    setObservaciones("");

    if (permisos.esAdmin) {
      setUbicacion("");
    }

    cargarDatos();
  }

  async function generarSolicitudesAutomaticas() {
    setMensaje("");

    if (!permisos.perfil) {
      setMensaje("No hay perfil activo para el usuario conectado.");
      return;
    }

    if (!usuarioPuedeGestionar()) {
      setMensaje("Solo admin o responsable pueden generar solicitudes.");
      return;
    }

    const codigo = solicitadaPor.trim() || codigoPerfil();

    if (!codigo) {
      setMensaje("El usuario conectado no tiene código para generar solicitudes.");
      return;
    }

    let creadas = 0;
    const solicitudesCreadasIds: string[] = [];

    for (const minimo of stockMinimos) {
      if (!minimo.activo) continue;
      if (!minimo.ubicacion) continue;
      if (!usuarioPuedeVerMinimo(minimo)) continue;

      const stockActual = await calcularStockActual(
        minimo.empresa_id,
        minimo.cliente_id,
        minimo.producto_id,
        minimo.ubicacion
      );

      if (stockActual > minimo.cantidad_minima) {
        continue;
      }

      const cantidadSugerida = minimo.cantidad_reposicion - stockActual;

      if (cantidadSugerida <= 0) {
        continue;
      }

      const { data: solicitudExistente, error: existenteError } = await supabase
        .from("solicitudes_reposicion")
        .select("id,estado")
        .eq("empresa_id", minimo.empresa_id)
        .eq("cliente_id", minimo.cliente_id)
        .eq("producto_id", minimo.producto_id)
        .eq("ubicacion", minimo.ubicacion)
        .in("estado", ["pendiente", "aprobada", "en_traspaso"])
        .limit(1);

      if (existenteError) {
        setMensaje(
          `Error comprobando solicitudes existentes: ${existenteError.message}`
        );
        return;
      }

      if (solicitudExistente && solicitudExistente.length > 0) {
        continue;
      }

      const { data: solicitudCreada, error } = await supabase
        .from("solicitudes_reposicion")
        .insert({
          empresa_id: minimo.empresa_id,
          cliente_id: minimo.cliente_id,
          producto_id: minimo.producto_id,
          ubicacion: minimo.ubicacion,
          stock_actual: stockActual,
          stock_minimo: minimo.cantidad_minima,
          stock_reposicion: minimo.cantidad_reposicion,
          cantidad_sugerida: cantidadSugerida,
          estado: "pendiente",
          origen: "automatica",
          solicitada_por: codigo,
          observaciones: `Stock en mínimo o por debajo. Actual: ${stockActual}. Mínimo: ${minimo.cantidad_minima}. Reposición objetivo: ${minimo.cantidad_reposicion}.`,
        })
        .select("id")
        .single();

      if (!error && solicitudCreada?.id) {
        creadas += 1;
        solicitudesCreadasIds.push(solicitudCreada.id);
      }
    }

    await registrarAuditoria({
      modulo: "reposiciones",
      accion: "generar_solicitudes_automaticas",
      tabla_afectada: "solicitudes_reposicion",
      registro_id: null,
      descripcion: `Generación automática de solicitudes. Creadas: ${creadas}.`,
      datos: {
        creadas,
        solicitudes_ids: solicitudesCreadasIds,
        solicitada_por: codigo,
      },
    });

    setMensaje(
      `Solicitudes automáticas creadas: ${creadas}. No se duplican solicitudes ya pendientes, aprobadas o en traspaso.`
    );

    cargarDatos();
  }

  async function aprobarSolicitud(solicitud: SolicitudReposicion) {
    setMensaje("");

    if (!permisos.perfil) {
      setMensaje("No hay perfil activo para el usuario conectado.");
      return;
    }

    if (!usuarioPuedeGestionarSolicitud(solicitud)) {
      setMensaje("No tienes permiso para aprobar esta solicitud.");
      return;
    }

    const codigo = aprobadaPor.trim() || codigoPerfil();

    if (!codigo) {
      setMensaje("El usuario conectado no tiene código para aprobar.");
      return;
    }

    const { error } = await supabase
      .from("solicitudes_reposicion")
      .update({
        estado: "aprobada",
        aprobada_por: codigo,
        aprobada_at: new Date().toISOString(),
      })
      .eq("id", solicitud.id);

    if (error) {
      setMensaje(`Error aprobando solicitud: ${error.message}`);
      return;
    }

    await registrarAuditoria({
      modulo: "reposiciones",
      accion: "aprobar_solicitud_reposicion",
      tabla_afectada: "solicitudes_reposicion",
      registro_id: solicitud.id,
      descripcion: "Solicitud de reposición aprobada.",
      datos: {
        solicitud_id: solicitud.id,
        empresa_id: solicitud.empresa_id,
        cliente_id: solicitud.cliente_id,
        producto_id: solicitud.producto_id,
        ubicacion: solicitud.ubicacion,
        cantidad_sugerida: solicitud.cantidad_sugerida,
        aprobada_por: codigo,
      },
    });

    setMensaje("Solicitud aprobada correctamente.");
    cargarDatos();
  }

  async function generarTraspasoDesdeSolicitud(solicitud: SolicitudReposicion) {
    setMensaje("");

    if (!permisos.perfil) {
      setMensaje("No hay perfil activo para el usuario conectado.");
      return;
    }

    if (!usuarioPuedeGestionarSolicitud(solicitud)) {
      setMensaje("No tienes permiso para generar traspaso de esta solicitud.");
      return;
    }

    if (solicitud.estado !== "aprobada") {
      setMensaje("Solo se pueden generar traspasos desde solicitudes aprobadas.");
      return;
    }

    if (solicitud.traspaso_id || solicitud.movimiento_id) {
      setMensaje("Esta solicitud ya tiene una acción de reposición generada.");
      return;
    }

    const cantidad = solicitud.cantidad_sugerida || 0;

    if (cantidad <= 0) {
      setMensaje("La cantidad sugerida debe ser mayor que 0.");
      return;
    }

    const { data: solicitudCompleta, error: solicitudError } = await supabase
      .from("solicitudes_reposicion")
      .select("empresa_id,cliente_id,producto_id,ubicacion")
      .eq("id", solicitud.id)
      .single();

    if (solicitudError) {
      setMensaje(`Error leyendo solicitud: ${solicitudError.message}`);
      return;
    }

    const ubicacionOrigen = "Almacén Central Tarragona";
    const ubicacionDestino = solicitudCompleta.ubicacion;

    if (!ubicacionDestino) {
      setMensaje("La solicitud no tiene ubicación destino.");
      return;
    }

    if (ubicacionDestino === ubicacionOrigen) {
      setMensaje("El destino ya es Almacén Central Tarragona.");
      return;
    }

    const stockOrigen = await calcularStockActual(
      solicitudCompleta.empresa_id,
      solicitudCompleta.cliente_id,
      solicitudCompleta.producto_id,
      ubicacionOrigen
    );

    if (stockOrigen < cantidad) {
      setMensaje(
        `No hay stock suficiente en ${ubicacionOrigen}. Disponible: ${stockOrigen}. Necesario: ${cantidad}.`
      );
      return;
    }

    const { data: traspasoCreado, error: traspasoError } = await supabase
      .from("traspasos")
      .insert({
        empresa_id: solicitudCompleta.empresa_id,
        cliente_id: solicitudCompleta.cliente_id,
        producto_id: solicitudCompleta.producto_id,
        cantidad,
        ubicacion_origen: ubicacionOrigen,
        ubicacion_destino: ubicacionDestino,
        estado: "pendiente_salida",
        codigo_operario_salida: null,
        observaciones: `Traspaso pendiente de salida generado desde solicitud de reposición ${solicitud.id}. Generado por ${codigoPerfil()}`,
      })
      .select("id")
      .single();

    if (traspasoError) {
      setMensaje(`Error creando traspaso: ${traspasoError.message}`);
      return;
    }

    const { error: updateError } = await supabase
      .from("solicitudes_reposicion")
      .update({
        estado: "en_traspaso",
        traspaso_id: traspasoCreado.id,
      })
      .eq("id", solicitud.id);

    if (updateError) {
      setMensaje(
        `Traspaso creado, pero error actualizando solicitud: ${updateError.message}`
      );
      return;
    }

    await registrarAuditoria({
      modulo: "reposiciones",
      accion: "generar_traspaso_desde_reposicion",
      tabla_afectada: "traspasos",
      registro_id: traspasoCreado.id,
      descripcion: "Traspaso generado desde solicitud de reposición.",
      datos: {
        solicitud_id: solicitud.id,
        traspaso_id: traspasoCreado.id,
        empresa_id: solicitudCompleta.empresa_id,
        cliente_id: solicitudCompleta.cliente_id,
        producto_id: solicitudCompleta.producto_id,
        cantidad,
        ubicacion_origen: ubicacionOrigen,
        ubicacion_destino: ubicacionDestino,
        generado_por: codigoPerfil(),
      },
    });

    setMensaje(
      "Traspaso creado como pendiente de salida. Falta autorización de operario."
    );

    cargarDatos();
  }

  async function cerrarSolicitud(solicitud: SolicitudReposicion) {
    setMensaje("");

    if (!permisos.perfil) {
      setMensaje("No hay perfil activo para el usuario conectado.");
      return;
    }

    if (!usuarioPuedeGestionarSolicitud(solicitud)) {
      setMensaje("No tienes permiso para cerrar esta solicitud.");
      return;
    }

    const { error } = await supabase
      .from("solicitudes_reposicion")
      .update({
        estado: "cerrada",
        cerrada_at: new Date().toISOString(),
      })
      .eq("id", solicitud.id);

    if (error) {
      setMensaje(`Error cerrando solicitud: ${error.message}`);
      return;
    }

    await registrarAuditoria({
      modulo: "reposiciones",
      accion: "cerrar_solicitud_reposicion",
      tabla_afectada: "solicitudes_reposicion",
      registro_id: solicitud.id,
      descripcion: "Solicitud de reposición cerrada sin acción.",
      datos: {
        solicitud_id: solicitud.id,
        empresa_id: solicitud.empresa_id,
        cliente_id: solicitud.cliente_id,
        producto_id: solicitud.producto_id,
        ubicacion: solicitud.ubicacion,
        estado_anterior: solicitud.estado,
      },
    });

    setMensaje("Solicitud cerrada correctamente.");
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

  const stockMinimosPorPermisos = stockMinimos.filter((minimo) =>
    usuarioPuedeVerMinimo(minimo)
  );

  const solicitudesPorPermisos = solicitudes.filter((solicitud) =>
    usuarioPuedeVerSolicitud(solicitud)
  );

  const stockMinimosVisibles = stockMinimosPorPermisos.filter((minimo) => {
    const cliente = obtenerPrimero(minimo.clientes);
    const producto = obtenerPrimero(minimo.productos_neumaticos);

    if (filtroCliente && minimo.cliente_id !== filtroCliente) return false;

    if (filtroUbicacion && minimo.ubicacion !== filtroUbicacion) return false;

    if (filtroProducto.trim()) {
      const texto = textoProductoRelacionado(producto).toLowerCase();

      if (!texto.includes(filtroProducto.trim().toLowerCase())) return false;
    }

    if (filtroTexto.trim()) {
      const texto = [
        cliente?.nombre || "",
        textoProductoRelacionado(producto),
        minimo.ubicacion || "",
        minimo.observaciones || "",
        minimo.activo ? "activo" : "inactivo",
        String(minimo.cantidad_minima),
        String(minimo.cantidad_reposicion),
      ]
        .join(" ")
        .toLowerCase();

      if (!texto.includes(filtroTexto.trim().toLowerCase())) return false;
    }

    return true;
  });

  const solicitudesVisibles = solicitudesPorPermisos.filter((solicitud) => {
    const cliente = obtenerPrimero(solicitud.clientes);
    const producto = obtenerPrimero(solicitud.productos_neumaticos);

    if (filtroCliente && solicitud.cliente_id !== filtroCliente) return false;

    if (filtroUbicacion && solicitud.ubicacion !== filtroUbicacion) return false;

    if (filtroEstado && solicitud.estado !== filtroEstado) return false;

    if (
      !fechaDentroDeFiltro(
        solicitud.created_at,
        fechaDesde,
        fechaHasta
      )
    ) {
      return false;
    }

    if (filtroProducto.trim()) {
      const texto = textoProductoRelacionado(producto).toLowerCase();

      if (!texto.includes(filtroProducto.trim().toLowerCase())) return false;
    }

    if (filtroTexto.trim()) {
      const texto = [
        solicitud.id,
        solicitud.estado || "",
        solicitud.origen || "",
        cliente?.nombre || "",
        textoProductoRelacionado(producto),
        solicitud.ubicacion || "",
        solicitud.solicitada_por || "",
        solicitud.aprobada_por || "",
        solicitud.movimiento_id || "",
        solicitud.traspaso_id || "",
        solicitud.observaciones || "",
      ]
        .join(" ")
        .toLowerCase();

      if (!texto.includes(filtroTexto.trim().toLowerCase())) return false;
    }

    return true;
  });

  function filasExportacionMinimos(): FilaExportacion[] {
    return stockMinimosVisibles.map((minimo) => {
      const cliente = obtenerPrimero(minimo.clientes);
      const producto = obtenerPrimero(minimo.productos_neumaticos);

      return {
        tipo: "stock_minimo",
        id: minimo.id,
        cliente: cliente?.nombre || "-",
        producto: textoProductoRelacionado(producto),
        ubicacion: minimo.ubicacion || "-",
        cantidad_minima: minimo.cantidad_minima,
        cantidad_reposicion: minimo.cantidad_reposicion,
        activo: minimo.activo ? "Sí" : "No",
        observaciones: minimo.observaciones || "",
      };
    });
  }

  function filasExportacionSolicitudes(): FilaExportacion[] {
    return solicitudesVisibles.map((solicitud) => {
      const cliente = obtenerPrimero(solicitud.clientes);
      const producto = obtenerPrimero(solicitud.productos_neumaticos);

      return {
        tipo: "solicitud_reposicion",
        id: solicitud.id,
        fecha: solicitud.created_at,
        estado: solicitud.estado || "",
        origen: solicitud.origen || "",
        cliente: cliente?.nombre || "-",
        producto: textoProductoRelacionado(producto),
        ubicacion: solicitud.ubicacion || "-",
        stock_actual: solicitud.stock_actual ?? "",
        stock_minimo: solicitud.stock_minimo ?? "",
        stock_reposicion: solicitud.stock_reposicion ?? "",
        cantidad_sugerida: solicitud.cantidad_sugerida ?? "",
        solicitada_por: solicitud.solicitada_por || "",
        aprobada_por: solicitud.aprobada_por || "",
        movimiento_id: solicitud.movimiento_id || "",
        traspaso_id: solicitud.traspaso_id || "",
        observaciones: solicitud.observaciones || "",
      };
    });
  }

  function filasExportacionReposiciones(): FilaExportacion[] {
    return [
      ...filasExportacionMinimos(),
      ...filasExportacionSolicitudes(),
    ];
  }

  function exportarReposicionesCsv() {
    const filas = filasExportacionReposiciones();

    if (filas.length === 0) {
      setMensaje("No hay mínimos ni solicitudes visibles para exportar.");
      return;
    }

    exportarCsv("reposiciones", filas);
  }

  async function exportarReposicionesExcel() {
    const filas = filasExportacionReposiciones();

    if (filas.length === 0) {
      setMensaje("No hay mínimos ni solicitudes visibles para exportar.");
      return;
    }

    await exportarExcel("reposiciones", "Reposiciones", filas);
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
          <h1 className="text-2xl font-bold">Reposiciones</h1>
          <p className="text-sm text-gray-500">
            Gestión de stock mínimo y solicitudes de reposición con permisos del
            usuario conectado. Se cargan las últimas 200 solicitudes.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={exportarReposicionesCsv}
            className="rounded-xl border px-4 py-2 text-sm font-semibold disabled:opacity-50"
            disabled={
              stockMinimosVisibles.length === 0 &&
              solicitudesVisibles.length === 0
            }
          >
            Exportar CSV
          </button>

          <button
            type="button"
            onClick={exportarReposicionesExcel}
            className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            disabled={
              stockMinimosVisibles.length === 0 &&
              solicitudesVisibles.length === 0
            }
          >
            Exportar Excel
          </button>
        </div>
      </div>

      <div className="rounded-xl border bg-white p-4 space-y-4">
        <h2 className="font-semibold">Crear stock mínimo</h2>

        {!usuarioPuedeGestionar() && (
          <p className="rounded-lg bg-yellow-50 p-3 text-sm text-yellow-800">
            Solo un usuario admin o responsable puede crear mínimos.
          </p>
        )}

        <select
          value={empresaId}
          onChange={(e) => setEmpresaId(e.target.value)}
          className="w-full rounded-lg border px-3 py-2 text-sm"
          disabled={!usuarioPuedeGestionar()}
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
          disabled={!usuarioPuedeGestionar()}
        >
          <option value="">Cliente...</option>
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
          disabled={!usuarioPuedeGestionar()}
        >
          <option value="">Producto...</option>
          {productos.map((producto) => (
            <option key={producto.id} value={producto.id}>
              {textoProducto(producto)}
            </option>
          ))}
        </select>

        <select
          value={ubicacion}
          onChange={(e) => setUbicacion(e.target.value)}
          className="w-full rounded-lg border px-3 py-2 text-sm"
          disabled={!usuarioPuedeGestionar()}
        >
          <option value="">Ubicación...</option>
          {ubicacionesVisibles.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>

        <input
          value={cantidadMinima}
          onChange={(e) => setCantidadMinima(e.target.value)}
          type="number"
          min="0"
          placeholder="Cantidad mínima"
          className="w-full rounded-lg border px-3 py-2 text-sm"
          disabled={!usuarioPuedeGestionar()}
        />

        <input
          value={cantidadReposicion}
          onChange={(e) => setCantidadReposicion(e.target.value)}
          type="number"
          min="1"
          placeholder="Stock de reposición, ejemplo 12"
          className="w-full rounded-lg border px-3 py-2 text-sm"
          disabled={!usuarioPuedeGestionar()}
        />

        <textarea
          value={observaciones}
          onChange={(e) => setObservaciones(e.target.value)}
          placeholder="Observaciones"
          className="w-full rounded-lg border px-3 py-2 text-sm"
          disabled={!usuarioPuedeGestionar()}
        />

        <button
          type="button"
          onClick={crearStockMinimo}
          className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          disabled={!usuarioPuedeGestionar()}
        >
          Crear mínimo
        </button>

        {mensaje && <p className="text-sm text-gray-700">{mensaje}</p>}
      </div>

      <div className="rounded-xl border bg-white p-4 space-y-4">
        <h2 className="font-semibold">Generar solicitudes automáticas</h2>

        <input
          value={solicitadaPor}
          onChange={(e) => setSolicitadaPor(e.target.value)}
          placeholder="Solicitada por / responsable"
          className="w-full rounded-lg border px-3 py-2 text-sm"
          disabled={!usuarioPuedeGestionar()}
        />

        <button
          type="button"
          onClick={generarSolicitudesAutomaticas}
          className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          disabled={!usuarioPuedeGestionar()}
        >
          Revisar mínimos y generar solicitudes
        </button>
      </div>

      <div className="rounded-xl border bg-white p-4 space-y-4">
        <h2 className="font-semibold">Filtros de reposiciones</h2>

        <div className="grid gap-3 md:grid-cols-4">
          <select
            value={filtroCliente}
            onChange={(e) => setFiltroCliente(e.target.value)}
            className="rounded-lg border px-3 py-2 text-sm"
          >
            <option value="">Todos los clientes</option>
            {clientesVisibles.map((cliente) => (
              <option key={cliente.id} value={cliente.id}>
                {cliente.nombre}
              </option>
            ))}
          </select>

          <input
            value={filtroProducto}
            onChange={(e) => setFiltroProducto(e.target.value)}
            placeholder="Producto, medida, marca o DOT"
            className="rounded-lg border px-3 py-2 text-sm"
          />

          <select
            value={filtroUbicacion}
            onChange={(e) => setFiltroUbicacion(e.target.value)}
            className="rounded-lg border px-3 py-2 text-sm"
          >
            <option value="">Todas las ubicaciones</option>
            {ubicacionesVisibles.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>

          <select
            value={filtroEstado}
            onChange={(e) => setFiltroEstado(e.target.value)}
            className="rounded-lg border px-3 py-2 text-sm"
          >
            <option value="">Todos los estados solicitud</option>
            <option value="pendiente">Pendiente</option>
            <option value="aprobada">Aprobada</option>
            <option value="en_traspaso">En traspaso</option>
            <option value="cerrada">Cerrada</option>
          </select>

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

          <input
            value={filtroTexto}
            onChange={(e) => setFiltroTexto(e.target.value)}
            placeholder="Buscar..."
            className="rounded-lg border px-3 py-2 text-sm md:col-span-2"
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
            Actualizar reposiciones
          </button>
        </div>
      </div>

      <div className="rounded-xl border bg-white p-3 text-sm text-gray-600">
        Mostrando <strong>{stockMinimosVisibles.length}</strong> mínimos y{" "}
        <strong>{solicitudesVisibles.length}</strong> solicitudes filtradas.
      </div>

      <div className="overflow-auto rounded-xl border bg-white">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="bg-gray-50 text-left">
            <tr>
              <th className="p-3">Cliente</th>
              <th className="p-3">Producto</th>
              <th className="p-3">Ubicación</th>
              <th className="p-3 text-right">Mínimo</th>
              <th className="p-3 text-right">Reposición</th>
              <th className="p-3">Activo</th>
              <th className="p-3">Observaciones</th>
            </tr>
          </thead>

          <tbody>
            {stockMinimosVisibles.map((minimo) => {
              const cliente = obtenerPrimero(minimo.clientes);
              const producto = obtenerPrimero(minimo.productos_neumaticos);

              return (
                <tr key={minimo.id} className="border-t">
                  <td className="p-3">{cliente?.nombre || "-"}</td>
                  <td className="p-3">{textoProductoRelacionado(producto)}</td>
                  <td className="p-3">{minimo.ubicacion || "-"}</td>
                  <td className="p-3 text-right">{minimo.cantidad_minima}</td>
                  <td className="p-3 text-right">
                    {minimo.cantidad_reposicion}
                  </td>
                  <td className="p-3">{minimo.activo ? "Sí" : "No"}</td>
                  <td className="p-3">{minimo.observaciones || "-"}</td>
                </tr>
              );
            })}

            {stockMinimosVisibles.length === 0 && (
              <tr>
                <td colSpan={7} className="p-6 text-center text-gray-500">
                  No hay mínimos visibles con los filtros actuales.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="rounded-xl border bg-white p-4 space-y-4">
        <h2 className="font-semibold">Aprobación de solicitudes</h2>

        <input
          value={aprobadaPor}
          onChange={(e) => setAprobadaPor(e.target.value)}
          placeholder="Aprobada por / responsable"
          className="w-full rounded-lg border px-3 py-2 text-sm"
          disabled={!usuarioPuedeGestionar()}
        />
      </div>

      <div className="overflow-auto rounded-xl border bg-white">
        <table className="w-full min-w-[1500px] text-sm">
          <thead className="bg-gray-50 text-left">
            <tr>
              <th className="p-3">Fecha</th>
              <th className="p-3">Estado</th>
              <th className="p-3">Origen</th>
              <th className="p-3">Cliente</th>
              <th className="p-3">Producto</th>
              <th className="p-3">Ubicación</th>
              <th className="p-3 text-right">Actual</th>
              <th className="p-3 text-right">Mínimo</th>
              <th className="p-3 text-right">Reposición</th>
              <th className="p-3 text-right">A pedir</th>
              <th className="p-3">Solicitada por</th>
              <th className="p-3">Aprobada por</th>
              <th className="p-3">Acción</th>
            </tr>
          </thead>

          <tbody>
            {solicitudesVisibles.map((solicitud) => {
              const cliente = obtenerPrimero(solicitud.clientes);
              const producto = obtenerPrimero(solicitud.productos_neumaticos);
              const puedeGestionarSolicitud =
                usuarioPuedeGestionarSolicitud(solicitud);

              return (
                <tr key={solicitud.id} className="border-t align-top">
                  <td className="p-3">
                    {formatearFecha(solicitud.created_at)}
                  </td>
                  <td className="p-3 font-medium">
                    {solicitud.estado || "-"}
                  </td>
                  <td className="p-3">{solicitud.origen || "-"}</td>
                  <td className="p-3">{cliente?.nombre || "-"}</td>
                  <td className="p-3">{textoProductoRelacionado(producto)}</td>
                  <td className="p-3">{solicitud.ubicacion || "-"}</td>
                  <td className="p-3 text-right">
                    {solicitud.stock_actual ?? "-"}
                  </td>
                  <td className="p-3 text-right">
                    {solicitud.stock_minimo ?? "-"}
                  </td>
                  <td className="p-3 text-right">
                    {solicitud.stock_reposicion ?? "-"}
                  </td>
                  <td className="p-3 text-right font-bold">
                    {solicitud.cantidad_sugerida ?? "-"}
                  </td>
                  <td className="p-3">{solicitud.solicitada_por || "-"}</td>
                  <td className="p-3">{solicitud.aprobada_por || "-"}</td>
                  <td className="p-3">
                    {solicitud.estado === "pendiente" &&
                    puedeGestionarSolicitud ? (
                      <button
                        type="button"
                        onClick={() => aprobarSolicitud(solicitud)}
                        className="rounded-lg border px-3 py-1 text-xs"
                      >
                        Aprobar
                      </button>
                    ) : solicitud.estado === "aprobada" &&
                      puedeGestionarSolicitud ? (
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            generarTraspasoDesdeSolicitud(solicitud)
                          }
                          className="rounded-lg border px-3 py-1 text-xs"
                        >
                          Generar traspaso
                        </button>

                        <button
                          type="button"
                          onClick={() => cerrarSolicitud(solicitud)}
                          className="rounded-lg border px-3 py-1 text-xs"
                        >
                          Cerrar sin acción
                        </button>
                      </div>
                    ) : solicitud.traspaso_id ? (
                      <span className="text-xs text-blue-700">
                        Traspaso generado
                      </span>
                    ) : solicitud.estado === "en_traspaso" ? (
                      <span className="text-xs text-blue-700">En traspaso</span>
                    ) : solicitud.estado === "cerrada" ? (
                      <span className="text-xs text-green-700">Cerrada</span>
                    ) : (
                      "-"
                    )}
                  </td>
                </tr>
              );
            })}

            {solicitudesVisibles.length === 0 && (
              <tr>
                <td colSpan={13} className="p-6 text-center text-gray-500">
                  No hay solicitudes visibles con los filtros actuales.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}