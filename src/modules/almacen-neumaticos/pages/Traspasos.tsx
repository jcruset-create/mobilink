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

type Traspaso = {
  id: string;
  fecha_salida: string | null;
  fecha_recepcion: string | null;
  empresa_id: string;
  cliente_id: string;
  producto_id: string;
  cantidad: number;
  cantidad_recibida: number | null;
  ubicacion_origen: string | null;
  ubicacion_destino: string | null;
  estado: string | null;
  codigo_operario_salida: string | null;
  codigo_operario_recepcion: string | null;
  firma_recepcion: string | null;
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
  solicitudes_reposicion:
    | {
        id: string;
        estado: string | null;
        cantidad_sugerida: number | null;
      }
    | {
        id: string;
        estado: string | null;
        cantidad_sugerida: number | null;
      }[]
    | null;
};

const UBICACIONES_DESTINO = [
  "Almacén Central Tarragona",
  "Base Reus",
  "Base Vilanova",
  "Taller Tarragona",
];

const ESTADOS_TRASPASO = [
  { valor: "pendiente_salida", texto: "Pendiente salida" },
  { valor: "en_camino", texto: "En camino" },
  { valor: "recibido_parcial", texto: "Recibido parcial" },
  { valor: "recibido", texto: "Recibido" },
  { valor: "incidencia", texto: "Incidencia" },
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

function esUbicacionOrigenDisponible(ubicacion: string) {
  return (
    ubicacion !== "En camino" &&
    ubicacion !== "Montado" &&
    ubicacion !== "Baja"
  );
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

export default function Traspasos() {
  const { permisos, cargandoPermisos, errorPermisos, recargarPermisos } =
    usePermisosAlmacen();

  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [lineasStock, setLineasStock] = useState<LineaStock[]>([]);
  const [traspasos, setTraspasos] = useState<Traspaso[]>([]);

  const [empresaId, setEmpresaId] = useState("");
  const [ubicacionOrigen, setUbicacionOrigen] = useState("");
  const [clienteOrigenId, setClienteOrigenId] = useState("");
  const [lineaStockClave, setLineaStockClave] = useState("");
  const [ubicacionDestino, setUbicacionDestino] = useState("");
  const [cantidad, setCantidad] = useState("1");
  const [observaciones, setObservaciones] = useState("");

  const [traspasoRecepcionId, setTraspasoRecepcionId] = useState("");
  const [cantidadRecibida, setCantidadRecibida] = useState("");
  const [firmaRecepcion, setFirmaRecepcion] = useState("");

  const [fechaDesde, setFechaDesde] = useState("");
  const [fechaHasta, setFechaHasta] = useState("");
  const [filtroEstado, setFiltroEstado] = useState("");
  const [filtroProducto, setFiltroProducto] = useState("");
  const [filtroOperarioSalida, setFiltroOperarioSalida] = useState("");
  const [filtroOperarioRecepcion, setFiltroOperarioRecepcion] = useState("");
  const [filtroTexto, setFiltroTexto] = useState("");
  const [cargandoTraspasos, setCargandoTraspasos] = useState(false);

  const [mensaje, setMensaje] = useState("");

  useEffect(() => {
    cargarDatos();
  }, []);

  useEffect(() => {
    limpiarFormularioTraspaso();
    setTraspasoRecepcionId("");
    setCantidadRecibida("");
    setFirmaRecepcion("");
  }, [permisos.perfil?.id]);

  function limpiarFormularioTraspaso() {
    setUbicacionOrigen("");
    setClienteOrigenId("");
    setLineaStockClave("");
    setUbicacionDestino("");
    setCantidad("1");
    setObservaciones("");
  }

  async function cargarDatos() {
    setMensaje("");

    const { data: empresasData } = await supabase
      .from("empresas")
      .select("id,nombre")
      .order("nombre");

    setEmpresas((empresasData || []) as Empresa[]);

    if (!empresaId && empresasData && empresasData.length > 0) {
      setEmpresaId(empresasData[0].id);
    }

    await cargarStockDisponible();
    await cargarTraspasos();
  }

  async function cargarStockDisponible() {
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
      .order("created_at", { ascending: false });

    if (error) {
      setMensaje(`Error stock: ${error.message}`);
      return;
    }

    const movimientos = (data || []) as unknown as MovimientoStock[];
    const mapa = new Map<string, LineaStock>();

    movimientos.forEach((movimiento) => {
      const cliente = obtenerPrimero(movimiento.clientes);
      const producto = obtenerPrimero(movimiento.productos_neumaticos);

      if (!cliente || !producto) return;

      const ubicacion = movimiento.ubicacion || "-";

      if (!esUbicacionOrigenDisponible(ubicacion)) return;

      const productoTexto = `${producto.medida} - ${producto.marca}${
        producto.modelo ? ` ${producto.modelo}` : ""
      }${producto.dot ? ` - DOT ${producto.dot}` : ""}`;

      const clave = [
        movimiento.empresa_id,
        movimiento.cliente_id,
        movimiento.producto_id,
        ubicacion,
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
          ubicacion,
          cantidad: cantidadMovimiento,
        });
      }
    });

    const resultado = Array.from(mapa.values())
      .filter((linea) => linea.cantidad > 0)
      .sort((a, b) => {
        const ubicacionOrden = a.ubicacion.localeCompare(b.ubicacion);
        if (ubicacionOrden !== 0) return ubicacionOrden;

        const clienteOrden = a.cliente.localeCompare(b.cliente);
        if (clienteOrden !== 0) return clienteOrden;

        return a.producto.localeCompare(b.producto);
      });

    setLineasStock(resultado);
  }

  async function cargarTraspasos() {
    setMensaje("");
    setCargandoTraspasos(true);

    let query = supabase
      .from("traspasos")
      .select(`
        id,
        fecha_salida,
        fecha_recepcion,
        empresa_id,
        cliente_id,
        producto_id,
        cantidad,
        cantidad_recibida,
        ubicacion_origen,
        ubicacion_destino,
        estado,
        codigo_operario_salida,
        codigo_operario_recepcion,
        firma_recepcion,
        observaciones,
        clientes (
          nombre
        ),
        productos_neumaticos (
          marca,
          modelo,
          medida,
          dot
        ),
        solicitudes_reposicion (
          id,
          estado,
          cantidad_sugerida
        )
      `)
      .order("fecha_salida", { ascending: false })
      .limit(200);

    if (fechaDesde) {
      query = query.gte("fecha_salida", `${fechaDesde}T00:00:00`);
    }

    if (fechaHasta) {
      query = query.lte("fecha_salida", fechaHastaFinDia(fechaHasta));
    }

    if (filtroEstado) {
      query = query.eq("estado", filtroEstado);
    }

    const { data, error } = await query;

    setCargandoTraspasos(false);

    if (error) {
      setMensaje(`Error traspasos: ${error.message}`);
      return;
    }

    setTraspasos((data || []) as unknown as Traspaso[]);
  }

  function limpiarFiltrosTraspasos() {
    setFechaDesde("");
    setFechaHasta("");
    setFiltroEstado("");
    setFiltroProducto("");
    setFiltroOperarioSalida("");
    setFiltroOperarioRecepcion("");
    setFiltroTexto("");
  }

  function codigoPerfil() {
    return permisos.perfil?.codigo_operario || "";
  }

  function usuarioPuedeUsarCliente(clienteId: string) {
    if (!permisos.perfil) return false;
    if (permisos.esAdmin) return true;

    return permisos.clientesPermitidos.some(
      (cliente) => cliente.id === clienteId
    );
  }

  function usuarioPuedeUsarUbicacion(ubicacion: string | null) {
    if (!permisos.perfil) return false;
    if (permisos.esAdmin) return true;

    if (!ubicacion || !permisos.ubicacion) return false;

    return permisos.ubicacion === ubicacion;
  }

  function usuarioPuedeUsarLinea(linea: LineaStock) {
    if (!permisos.perfil) return false;
    if (permisos.esAdmin) return true;

    return (
      usuarioPuedeUsarCliente(linea.clienteId) &&
      usuarioPuedeUsarUbicacion(linea.ubicacion)
    );
  }

  function usuarioPuedeVerTraspaso(traspaso: Traspaso) {
    if (!permisos.perfil) return false;
    if (permisos.esAdmin) return true;

    const clientePermitido = usuarioPuedeUsarCliente(traspaso.cliente_id);
    const tocaUbicacion =
      usuarioPuedeUsarUbicacion(traspaso.ubicacion_origen) ||
      usuarioPuedeUsarUbicacion(traspaso.ubicacion_destino);

    return clientePermitido && tocaUbicacion;
  }

  function usuarioPuedeAutorizarSalida(traspaso: Traspaso) {
    if (!permisos.perfil) return false;
    if (permisos.esAdmin) return true;

    return (
      usuarioPuedeUsarCliente(traspaso.cliente_id) &&
      usuarioPuedeUsarUbicacion(traspaso.ubicacion_origen)
    );
  }

  function usuarioPuedeRecibirTraspaso(traspaso: Traspaso) {
    if (!permisos.perfil) return false;
    if (permisos.esAdmin) return true;

    return (
      usuarioPuedeUsarCliente(traspaso.cliente_id) &&
      usuarioPuedeUsarUbicacion(traspaso.ubicacion_destino)
    );
  }

  async function crearTraspaso() {
    setMensaje("");

    const lineaSeleccionada = lineasStock.find(
      (linea) => linea.clave === lineaStockClave
    );

    if (!permisos.perfil) {
      setMensaje("No hay perfil activo para el usuario conectado.");
      return;
    }

    if (
      !ubicacionOrigen ||
      !clienteOrigenId ||
      !lineaSeleccionada ||
      !cantidad ||
      !ubicacionDestino
    ) {
      setMensaje(
        "Origen, cliente, producto, cantidad y destino son obligatorios."
      );
      return;
    }

    if (!usuarioPuedeUsarLinea(lineaSeleccionada)) {
      setMensaje(
        "No tienes permiso para traspasar desde ese cliente o ubicación."
      );
      return;
    }

    if (lineaSeleccionada.ubicacion !== ubicacionOrigen) {
      setMensaje("El producto seleccionado no pertenece a la ubicación origen.");
      return;
    }

    if (lineaSeleccionada.clienteId !== clienteOrigenId) {
      setMensaje("El producto seleccionado no pertenece al cliente elegido.");
      return;
    }

    if (ubicacionDestino === lineaSeleccionada.ubicacion) {
      setMensaje("La ubicación destino no puede ser igual a la ubicación origen.");
      return;
    }

    const cantidadNumero = Number(cantidad);

    if (Number.isNaN(cantidadNumero) || cantidadNumero <= 0) {
      setMensaje("La cantidad debe ser mayor que 0.");
      return;
    }

    if (cantidadNumero > lineaSeleccionada.cantidad) {
      setMensaje(
        `No puedes traspasar ${cantidadNumero}. Stock disponible: ${lineaSeleccionada.cantidad}.`
      );
      return;
    }

    const codigoSalida = codigoPerfil();

    const { data: traspasoCreado, error: traspasoError } = await supabase
      .from("traspasos")
      .insert({
        empresa_id: lineaSeleccionada.empresaId,
        cliente_id: lineaSeleccionada.clienteId,
        producto_id: lineaSeleccionada.productoId,
        cantidad: cantidadNumero,
        ubicacion_origen:
          lineaSeleccionada.ubicacion === "-"
            ? null
            : lineaSeleccionada.ubicacion,
        ubicacion_destino: ubicacionDestino,
        estado: "en_camino",
        codigo_operario_salida: codigoSalida,
        fecha_salida: new Date().toISOString(),
        observaciones: observaciones.trim() || null,
      })
      .select("id")
      .single();

    if (traspasoError) {
      setMensaje(`Error traspaso: ${traspasoError.message}`);
      return;
    }

    const movimientos = [
      {
        empresa_id: lineaSeleccionada.empresaId,
        cliente_id: lineaSeleccionada.clienteId,
        producto_id: lineaSeleccionada.productoId,
        tipo: "SALIDA",
        cantidad: cantidadNumero,
        ubicacion:
          lineaSeleccionada.ubicacion === "-"
            ? null
            : lineaSeleccionada.ubicacion,
        traspaso_id: traspasoCreado.id,
        solicitud_reposicion_id: null,
        origen_movimiento: "traspaso_manual",
        observaciones: `Traspaso a ${ubicacionDestino}. Operario salida: ${codigoSalida}`,
      },
      {
        empresa_id: lineaSeleccionada.empresaId,
        cliente_id: lineaSeleccionada.clienteId,
        producto_id: lineaSeleccionada.productoId,
        tipo: "ENTRADA",
        cantidad: cantidadNumero,
        ubicacion: "En camino",
        traspaso_id: traspasoCreado.id,
        solicitud_reposicion_id: null,
        origen_movimiento: "traspaso_manual",
        observaciones: `Traspaso desde ${lineaSeleccionada.ubicacion} hacia ${ubicacionDestino}. Operario salida: ${codigoSalida}`,
      },
    ];

    const { error: movimientosError } = await supabase
      .from("movimientos_stock")
      .insert(movimientos);

    if (movimientosError) {
      setMensaje(`Error movimientos: ${movimientosError.message}`);
      return;
    }

    await registrarAuditoria({
      modulo: "traspasos",
      accion: "crear_traspaso",
      tabla_afectada: "traspasos",
      registro_id: traspasoCreado.id,
      descripcion: `Traspaso manual creado de ${lineaSeleccionada.ubicacion} a ${ubicacionDestino}.`,
      datos: {
        traspaso_id: traspasoCreado.id,
        empresa_id: lineaSeleccionada.empresaId,
        cliente_id: lineaSeleccionada.clienteId,
        producto_id: lineaSeleccionada.productoId,
        cliente: lineaSeleccionada.cliente,
        producto: lineaSeleccionada.producto,
        cantidad: cantidadNumero,
        ubicacion_origen: lineaSeleccionada.ubicacion,
        ubicacion_destino: ubicacionDestino,
        codigo_operario_salida: codigoSalida,
      },
    });

    setMensaje("Traspaso creado correctamente. Stock movido a En camino.");
    limpiarFormularioTraspaso();
    cargarDatos();
  }

  async function autorizarSalidaTraspaso(traspaso: Traspaso) {
    setMensaje("");

    if (!permisos.perfil) {
      setMensaje("No hay perfil activo para el usuario conectado.");
      return;
    }

    if (traspaso.estado !== "pendiente_salida") {
      setMensaje("Solo se puede autorizar salida de traspasos pendientes.");
      return;
    }

    if (!usuarioPuedeAutorizarSalida(traspaso)) {
      setMensaje("No tienes permiso para autorizar la salida de este traspaso.");
      return;
    }

    if (!traspaso.ubicacion_origen || !traspaso.ubicacion_destino) {
      setMensaje("El traspaso no tiene origen o destino.");
      return;
    }

    const codigoSalida = codigoPerfil();
    const solicitudReposicion = obtenerPrimero(traspaso.solicitudes_reposicion);

    const movimientos = [
      {
        empresa_id: traspaso.empresa_id,
        cliente_id: traspaso.cliente_id,
        producto_id: traspaso.producto_id,
        tipo: "SALIDA",
        cantidad: traspaso.cantidad,
        ubicacion: traspaso.ubicacion_origen,
        traspaso_id: traspaso.id,
        solicitud_reposicion_id: solicitudReposicion?.id || null,
        origen_movimiento: solicitudReposicion ? "reposicion" : "traspaso_manual",
        observaciones: `Salida autorizada de traspaso ${traspaso.id}. Operario salida: ${codigoSalida}`,
      },
      {
        empresa_id: traspaso.empresa_id,
        cliente_id: traspaso.cliente_id,
        producto_id: traspaso.producto_id,
        tipo: "ENTRADA",
        cantidad: traspaso.cantidad,
        ubicacion: "En camino",
        traspaso_id: traspaso.id,
        solicitud_reposicion_id: solicitudReposicion?.id || null,
        origen_movimiento: solicitudReposicion ? "reposicion" : "traspaso_manual",
        observaciones: `Traspaso en camino hacia ${traspaso.ubicacion_destino}. Operario salida: ${codigoSalida}`,
      },
    ];

    const { error: movimientosError } = await supabase
      .from("movimientos_stock")
      .insert(movimientos);

    if (movimientosError) {
      setMensaje(
        `Error creando movimientos de salida: ${movimientosError.message}`
      );
      return;
    }

    const { error: updateError } = await supabase
      .from("traspasos")
      .update({
        estado: "en_camino",
        codigo_operario_salida: codigoSalida,
        fecha_salida: new Date().toISOString(),
      })
      .eq("id", traspaso.id);

    if (updateError) {
      setMensaje(`Error actualizando traspaso: ${updateError.message}`);
      return;
    }

    await registrarAuditoria({
      modulo: "traspasos",
      accion: "autorizar_salida_traspaso",
      tabla_afectada: "traspasos",
      registro_id: traspaso.id,
      descripcion: `Salida autorizada de traspaso hacia ${traspaso.ubicacion_destino}.`,
      datos: {
        traspaso_id: traspaso.id,
        solicitud_reposicion_id: solicitudReposicion?.id || null,
        empresa_id: traspaso.empresa_id,
        cliente_id: traspaso.cliente_id,
        producto_id: traspaso.producto_id,
        cantidad: traspaso.cantidad,
        ubicacion_origen: traspaso.ubicacion_origen,
        ubicacion_destino: traspaso.ubicacion_destino,
        codigo_operario_salida: codigoSalida,
      },
    });

    setMensaje("Salida autorizada. Stock movido a En camino.");
    cargarDatos();
  }

  function prepararRecepcion(traspaso: Traspaso) {
    if (!permisos.perfil) {
      setMensaje("No hay perfil activo para el usuario conectado.");
      return;
    }

    if (!usuarioPuedeRecibirTraspaso(traspaso)) {
      setMensaje("No tienes permiso para recibir este traspaso.");
      return;
    }

    const yaRecibida = traspaso.cantidad_recibida || 0;
    const pendiente = traspaso.cantidad - yaRecibida;

    setTraspasoRecepcionId(traspaso.id);
    setCantidadRecibida(String(pendiente));
    setFirmaRecepcion("");
    setMensaje("");
  }

  async function recibirTraspaso() {
    setMensaje("");

    const traspaso = traspasos.find((item) => item.id === traspasoRecepcionId);

    if (!permisos.perfil) {
      setMensaje("No hay perfil activo para el usuario conectado.");
      return;
    }

    if (!traspaso) {
      setMensaje("Selecciona un traspaso pendiente de recepción.");
      return;
    }

    if (!usuarioPuedeRecibirTraspaso(traspaso)) {
      setMensaje("No tienes permiso para recibir este traspaso.");
      return;
    }

    if (
      traspaso.estado !== "en_camino" &&
      traspaso.estado !== "recibido_parcial"
    ) {
      setMensaje(
        "Solo se pueden recibir traspasos en camino o recibidos parcialmente."
      );
      return;
    }

    const cantidadNumero = Number(cantidadRecibida);

    if (Number.isNaN(cantidadNumero) || cantidadNumero <= 0) {
      setMensaje("La cantidad recibida debe ser mayor que 0.");
      return;
    }

    const yaRecibida = traspaso.cantidad_recibida || 0;
    const pendiente = traspaso.cantidad - yaRecibida;

    if (cantidadNumero > pendiente) {
      setMensaje(
        `No puedes recibir ${cantidadNumero}. Cantidad pendiente: ${pendiente}.`
      );
      return;
    }

    const codigoRecepcion = codigoPerfil();

    if (!codigoRecepcion) {
      setMensaje("El usuario conectado no tiene código de operario.");
      return;
    }

    if (!firmaRecepcion.trim()) {
      setMensaje("La firma o confirmación de recepción es obligatoria.");
      return;
    }

    const totalRecibido = (traspaso.cantidad_recibida || 0) + cantidadNumero;
    const estadoFinal =
      totalRecibido === traspaso.cantidad ? "recibido" : "recibido_parcial";
    const cantidadPendiente = traspaso.cantidad - totalRecibido;
    const solicitudReposicion = obtenerPrimero(traspaso.solicitudes_reposicion);

    const movimientos = [
      {
        empresa_id: traspaso.empresa_id,
        cliente_id: traspaso.cliente_id,
        producto_id: traspaso.producto_id,
        tipo: "SALIDA",
        cantidad: cantidadNumero,
        ubicacion: "En camino",
        traspaso_id: traspaso.id,
        solicitud_reposicion_id: solicitudReposicion?.id || null,
        origen_movimiento: solicitudReposicion ? "reposicion" : "traspaso_manual",
        observaciones: `Recepción traspaso. Operario recepción: ${codigoRecepcion}`,
      },
      {
        empresa_id: traspaso.empresa_id,
        cliente_id: traspaso.cliente_id,
        producto_id: traspaso.producto_id,
        tipo: "ENTRADA",
        cantidad: cantidadNumero,
        ubicacion: traspaso.ubicacion_destino,
        traspaso_id: traspaso.id,
        solicitud_reposicion_id: solicitudReposicion?.id || null,
        origen_movimiento: solicitudReposicion ? "reposicion" : "traspaso_manual",
        observaciones: `Recepción desde En camino. Operario recepción: ${codigoRecepcion}. Firma: ${firmaRecepcion.trim()}`,
      },
    ];

    const { error: movimientosError } = await supabase
      .from("movimientos_stock")
      .insert(movimientos);

    if (movimientosError) {
      setMensaje(`Error movimientos recepción: ${movimientosError.message}`);
      return;
    }

    const { error: updateError } = await supabase
      .from("traspasos")
      .update({
        estado: estadoFinal,
        cantidad_recibida: totalRecibido,
        codigo_operario_recepcion: codigoRecepcion,
        firma_recepcion: firmaRecepcion.trim(),
        fecha_recepcion: new Date().toISOString(),
      })
      .eq("id", traspaso.id);

    if (updateError) {
      setMensaje(`Error actualización traspaso: ${updateError.message}`);
      return;
    }

    if (estadoFinal === "recibido") {
      const { error: solicitudError } = await supabase
        .from("solicitudes_reposicion")
        .update({
          estado: "cerrada",
          cerrada_at: new Date().toISOString(),
        })
        .eq("traspaso_id", traspaso.id)
        .eq("estado", "en_traspaso");

      if (solicitudError) {
        setMensaje(
          `Traspaso recibido, pero error cerrando solicitud de reposición: ${solicitudError.message}`
        );
        return;
      }
    }

    if (estadoFinal === "recibido_parcial") {
      const { data: incidenciaCreada, error: incidenciaError } = await supabase
        .from("incidencias")
        .insert({
          empresa_id: traspaso.empresa_id,
          cliente_id: traspaso.cliente_id,
          producto_id: traspaso.producto_id,
          traspaso_id: traspaso.id,
          tipo: "diferencia_traspaso",
          gravedad: "media",
          estado: "abierta",
          ubicacion: traspaso.ubicacion_destino,
          descripcion: `Recepción parcial de traspaso. Enviadas: ${traspaso.cantidad}. Recibidas acumuladas: ${totalRecibido}. Pendientes: ${cantidadPendiente}.`,
          creada_por: codigoRecepcion,
        })
        .select("id")
        .single();

      if (incidenciaError) {
        setMensaje(
          `Traspaso actualizado, pero error creando incidencia: ${incidenciaError.message}`
        );
        return;
      }

      await registrarAuditoria({
        modulo: "traspasos",
        accion: "crear_incidencia_diferencia_traspaso",
        tabla_afectada: "incidencias",
        registro_id: incidenciaCreada?.id || null,
        descripcion: "Incidencia creada automáticamente por recepción parcial.",
        datos: {
          traspaso_id: traspaso.id,
          incidencia_id: incidenciaCreada?.id || null,
          empresa_id: traspaso.empresa_id,
          cliente_id: traspaso.cliente_id,
          producto_id: traspaso.producto_id,
          cantidad_enviada: traspaso.cantidad,
          cantidad_recibida_acumulada: totalRecibido,
          cantidad_pendiente: cantidadPendiente,
          ubicacion_destino: traspaso.ubicacion_destino,
          codigo_operario_recepcion: codigoRecepcion,
        },
      });
    }

    await registrarAuditoria({
      modulo: "traspasos",
      accion:
        estadoFinal === "recibido"
          ? "recibir_traspaso"
          : "recibir_traspaso_parcial",
      tabla_afectada: "traspasos",
      registro_id: traspaso.id,
      descripcion:
        estadoFinal === "recibido"
          ? `Traspaso recibido completamente en ${traspaso.ubicacion_destino}.`
          : `Traspaso recibido parcialmente en ${traspaso.ubicacion_destino}.`,
      datos: {
        traspaso_id: traspaso.id,
        solicitud_reposicion_id: solicitudReposicion?.id || null,
        empresa_id: traspaso.empresa_id,
        cliente_id: traspaso.cliente_id,
        producto_id: traspaso.producto_id,
        cantidad_enviada: traspaso.cantidad,
        cantidad_recibida_operacion: cantidadNumero,
        cantidad_recibida_acumulada: totalRecibido,
        cantidad_pendiente: cantidadPendiente,
        estado_final: estadoFinal,
        ubicacion_destino: traspaso.ubicacion_destino,
        codigo_operario_recepcion: codigoRecepcion,
        firma_recepcion: firmaRecepcion.trim(),
      },
    });

    setMensaje(
      estadoFinal === "recibido_parcial"
        ? "Traspaso recibido parcialmente. Incidencia creada automáticamente."
        : "Traspaso recibido correctamente. Si venía de reposición, la solicitud se ha cerrado."
    );

    setTraspasoRecepcionId("");
    setCantidadRecibida("");
    setFirmaRecepcion("");
    cargarDatos();
  }

  const clientesPermitidosIds = permisos.clientesPermitidos.map(
    (cliente) => cliente.id
  );

  const lineasPorPermisos = lineasStock.filter((linea) => {
    if (!permisos.perfil) return false;
    if (permisos.esAdmin) return true;

    return (
      clientesPermitidosIds.includes(linea.clienteId) &&
      permisos.ubicacion === linea.ubicacion
    );
  });

  const lineasPorEmpresa = lineasPorPermisos.filter(
    (linea) => !empresaId || linea.empresaId === empresaId
  );

  const ubicacionesOrigenDisponibles = Array.from(
    new Set(lineasPorEmpresa.map((linea) => linea.ubicacion))
  ).sort((a, b) => a.localeCompare(b));

  const clientesOrigenDisponibles = Array.from(
    new Map(
      lineasPorEmpresa
        .filter((linea) => !ubicacionOrigen || linea.ubicacion === ubicacionOrigen)
        .map((linea) => [
          linea.clienteId,
          {
            id: linea.clienteId,
            nombre: linea.cliente,
          },
        ])
    ).values()
  ).sort((a, b) => a.nombre.localeCompare(b.nombre));

  const productosOrigenDisponibles = lineasPorEmpresa
    .filter((linea) => !ubicacionOrigen || linea.ubicacion === ubicacionOrigen)
    .filter((linea) => !clienteOrigenId || linea.clienteId === clienteOrigenId)
    .sort((a, b) => a.producto.localeCompare(b.producto));

  const lineaSeleccionada = productosOrigenDisponibles.find(
    (linea) => linea.clave === lineaStockClave
  );

  const ubicacionesDestinoDisponibles = UBICACIONES_DESTINO.filter(
    (ubicacion) => ubicacion !== ubicacionOrigen
  );

  const traspasosPorPermisos = traspasos.filter((traspaso) =>
    usuarioPuedeVerTraspaso(traspaso)
  );

  const traspasosFiltrados = traspasosPorPermisos.filter((traspaso) => {
    const producto = obtenerPrimero(traspaso.productos_neumaticos);

    if (
      filtroProducto.trim() &&
      !textoProductoRelacionado(producto)
        .toLowerCase()
        .includes(filtroProducto.trim().toLowerCase())
    ) {
      return false;
    }

    if (
      filtroOperarioSalida.trim() &&
      !(traspaso.codigo_operario_salida || "")
        .toLowerCase()
        .includes(filtroOperarioSalida.trim().toLowerCase())
    ) {
      return false;
    }

    if (
      filtroOperarioRecepcion.trim() &&
      !(traspaso.codigo_operario_recepcion || "")
        .toLowerCase()
        .includes(filtroOperarioRecepcion.trim().toLowerCase())
    ) {
      return false;
    }

    if (!filtroTexto.trim()) return true;

    const cliente = obtenerPrimero(traspaso.clientes);
    const solicitudReposicion = obtenerPrimero(traspaso.solicitudes_reposicion);

    const texto = [
      traspaso.id,
      traspaso.estado || "",
      cliente?.nombre || "",
      textoProductoRelacionado(producto),
      traspaso.ubicacion_origen || "",
      traspaso.ubicacion_destino || "",
      traspaso.codigo_operario_salida || "",
      traspaso.codigo_operario_recepcion || "",
      traspaso.firma_recepcion || "",
      traspaso.observaciones || "",
      solicitudReposicion?.id || "",
      solicitudReposicion?.estado || "",
    ]
      .join(" ")
      .toLowerCase();

    return texto.includes(filtroTexto.trim().toLowerCase());
  });

  const traspasoRecepcion = traspasos.find(
    (item) => item.id === traspasoRecepcionId
  );

  function filasExportacionTraspasos(): FilaExportacion[] {
    return traspasosFiltrados.map((traspaso) => {
      const cliente = obtenerPrimero(traspaso.clientes);
      const producto = obtenerPrimero(traspaso.productos_neumaticos);
      const solicitudReposicion = obtenerPrimero(
        traspaso.solicitudes_reposicion
      );

      const cantidadRecibidaTabla = traspaso.cantidad_recibida || 0;
      const cantidadPendiente = traspaso.cantidad - cantidadRecibidaTabla;

      return {
        traspaso_id: traspaso.id,
        fecha_salida: traspaso.fecha_salida || "",
        fecha_recepcion: traspaso.fecha_recepcion || "",
        estado: traspaso.estado || "",
        cliente: cliente?.nombre || "-",
        producto: textoProductoRelacionado(producto),
        cantidad_enviada: traspaso.cantidad,
        cantidad_recibida: cantidadRecibidaTabla,
        cantidad_pendiente: cantidadPendiente > 0 ? cantidadPendiente : 0,
        origen: traspaso.ubicacion_origen || "-",
        destino: traspaso.ubicacion_destino || "-",
        operario_salida: traspaso.codigo_operario_salida || "",
        operario_recepcion: traspaso.codigo_operario_recepcion || "",
        firma_recepcion: traspaso.firma_recepcion || "",
        observaciones: traspaso.observaciones || "",
        reposicion_id: solicitudReposicion?.id || "",
        reposicion_estado: solicitudReposicion?.estado || "",
        reposicion_cantidad_sugerida:
          solicitudReposicion?.cantidad_sugerida ?? "",
      };
    });
  }

  function exportarTraspasosCsv() {
    const filas = filasExportacionTraspasos();

    if (filas.length === 0) {
      setMensaje("No hay traspasos visibles para exportar.");
      return;
    }

    exportarCsv("traspasos", filas);
  }

  async function exportarTraspasosExcel() {
    const filas = filasExportacionTraspasos();

    if (filas.length === 0) {
      setMensaje("No hay traspasos visibles para exportar.");
      return;
    }

    await exportarExcel("traspasos", "Traspasos", filas);
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
          <h1 className="text-2xl font-bold">Traspasos</h1>
          <p className="text-sm text-gray-500">
            Salida, tránsito y recepción de stock entre ubicaciones con permisos
            del usuario conectado. Se cargan los últimos 200 traspasos según
            filtros.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={exportarTraspasosCsv}
            className="rounded-xl border px-4 py-2 text-sm font-semibold disabled:opacity-50"
            disabled={traspasosFiltrados.length === 0}
          >
            Exportar CSV
          </button>

          <button
            type="button"
            onClick={exportarTraspasosExcel}
            className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            disabled={traspasosFiltrados.length === 0}
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
            <br />
            Clientes permitidos:{" "}
            <strong>
              {permisos.esAdmin
                ? "Todos"
                : permisos.clientesPermitidos.length > 0
                ? permisos.clientesPermitidos
                    .map((cliente) => cliente.nombre)
                    .join(", ")
                : "Ninguno"}
            </strong>
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

      <div className="rounded-xl border bg-white p-4 space-y-4">
        <h2 className="font-semibold">Crear traspaso manual</h2>

        <select
          value={empresaId}
          onChange={(e) => {
            setEmpresaId(e.target.value);
            limpiarFormularioTraspaso();
          }}
          className="w-full rounded-lg border px-3 py-2 text-sm"
          disabled={!permisos.perfil}
        >
          <option value="">Empresa...</option>
          {empresas.map((empresa) => (
            <option key={empresa.id} value={empresa.id}>
              {empresa.nombre}
            </option>
          ))}
        </select>

        <select
          value={ubicacionOrigen}
          onChange={(e) => {
            setUbicacionOrigen(e.target.value);
            setClienteOrigenId("");
            setLineaStockClave("");
            setUbicacionDestino("");
          }}
          className="w-full rounded-lg border px-3 py-2 text-sm"
          disabled={!permisos.perfil}
        >
          <option value="">1. Ubicación origen...</option>
          {ubicacionesOrigenDisponibles.map((ubicacion) => (
            <option key={ubicacion} value={ubicacion}>
              {ubicacion}
            </option>
          ))}
        </select>

        <select
          value={clienteOrigenId}
          onChange={(e) => {
            setClienteOrigenId(e.target.value);
            setLineaStockClave("");
          }}
          className="w-full rounded-lg border px-3 py-2 text-sm"
          disabled={!permisos.perfil || !ubicacionOrigen}
        >
          <option value="">2. Cliente con stock en origen...</option>
          {clientesOrigenDisponibles.map((cliente) => (
            <option key={cliente.id} value={cliente.id}>
              {cliente.nombre}
            </option>
          ))}
        </select>

        <select
          value={lineaStockClave}
          onChange={(e) => setLineaStockClave(e.target.value)}
          className="w-full rounded-lg border px-3 py-2 text-sm"
          disabled={!permisos.perfil || !ubicacionOrigen || !clienteOrigenId}
        >
          <option value="">3. Producto disponible...</option>
          {productosOrigenDisponibles.map((linea) => (
            <option key={linea.clave} value={linea.clave}>
              {linea.producto} | Stock: {linea.cantidad}
            </option>
          ))}
        </select>

        {lineaSeleccionada && (
          <div className="rounded-lg bg-gray-50 p-3 text-sm text-gray-700">
            Origen: <strong>{lineaSeleccionada.ubicacion}</strong>
            <br />
            Cliente: <strong>{lineaSeleccionada.cliente}</strong>
            <br />
            Producto: <strong>{lineaSeleccionada.producto}</strong>
            <br />
            Stock disponible: <strong>{lineaSeleccionada.cantidad}</strong>
          </div>
        )}

        <input
          value={cantidad}
          onChange={(e) => setCantidad(e.target.value)}
          type="number"
          min="1"
          max={lineaSeleccionada?.cantidad}
          placeholder="4. Cantidad"
          className="w-full rounded-lg border px-3 py-2 text-sm"
          disabled={!permisos.perfil || !lineaSeleccionada}
        />

        <select
          value={ubicacionDestino}
          onChange={(e) => setUbicacionDestino(e.target.value)}
          className="w-full rounded-lg border px-3 py-2 text-sm"
          disabled={!permisos.perfil || !lineaSeleccionada}
        >
          <option value="">5. Ubicación destino...</option>
          {ubicacionesDestinoDisponibles.map((ubicacion) => (
            <option key={ubicacion} value={ubicacion}>
              {ubicacion}
            </option>
          ))}
        </select>

        <textarea
          value={observaciones}
          onChange={(e) => setObservaciones(e.target.value)}
          placeholder="Observaciones"
          className="w-full rounded-lg border px-3 py-2 text-sm"
          disabled={!permisos.perfil}
        />

        <button
          type="button"
          onClick={crearTraspaso}
          className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          disabled={!permisos.perfil}
        >
          Crear traspaso
        </button>

        <button
          type="button"
          onClick={cargarDatos}
          className="ml-2 rounded-xl border px-4 py-2 text-sm font-semibold"
        >
          Actualizar
        </button>

        {mensaje && <p className="text-sm text-gray-700">{mensaje}</p>}
      </div>

      {traspasoRecepcion && (
        <div className="rounded-xl border bg-white p-4 space-y-4">
          <h2 className="font-semibold">Recepción de traspaso</h2>

          <div className="rounded-lg bg-gray-50 p-3 text-sm text-gray-700">
            Destino: <strong>{traspasoRecepcion.ubicacion_destino}</strong>
            <br />
            Cantidad enviada: <strong>{traspasoRecepcion.cantidad}</strong>
            <br />
            Código recepción: <strong>{codigoPerfil() || "-"}</strong>
          </div>

          <input
            value={cantidadRecibida}
            onChange={(e) => setCantidadRecibida(e.target.value)}
            type="number"
            min="1"
            placeholder="Cantidad recibida"
            className="w-full rounded-lg border px-3 py-2 text-sm"
          />

          <input
            value={firmaRecepcion}
            onChange={(e) => setFirmaRecepcion(e.target.value)}
            placeholder="Firma / confirmación recepción"
            className="w-full rounded-lg border px-3 py-2 text-sm"
          />

          <button
            type="button"
            onClick={recibirTraspaso}
            className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white"
          >
            Confirmar recepción
          </button>
        </div>
      )}

      <div className="rounded-xl border bg-white p-4 space-y-4">
        <h2 className="font-semibold">Filtros de traspasos</h2>

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
            {ESTADOS_TRASPASO.map((estado) => (
              <option key={estado.valor} value={estado.valor}>
                {estado.texto}
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
            value={filtroOperarioSalida}
            onChange={(e) => setFiltroOperarioSalida(e.target.value)}
            placeholder="Operario salida"
            className="rounded-lg border px-3 py-2 text-sm"
          />

          <input
            value={filtroOperarioRecepcion}
            onChange={(e) => setFiltroOperarioRecepcion(e.target.value)}
            placeholder="Operario recepción"
            className="rounded-lg border px-3 py-2 text-sm"
          />

          <input
            value={filtroTexto}
            onChange={(e) => setFiltroTexto(e.target.value)}
            placeholder="Buscar cliente, origen, destino, observaciones..."
            className="rounded-lg border px-3 py-2 text-sm md:col-span-2"
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={cargarTraspasos}
            className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white"
          >
            {cargandoTraspasos ? "Buscando..." : "Buscar"}
          </button>

          <button
            type="button"
            onClick={limpiarFiltrosTraspasos}
            className="rounded-xl border px-4 py-2 text-sm font-semibold"
          >
            Limpiar filtros
          </button>
        </div>
      </div>

      <div className="rounded-xl border bg-white p-3 text-sm text-gray-600">
        Mostrando <strong>{traspasosFiltrados.length}</strong> traspasos de{" "}
        <strong>{traspasosPorPermisos.length}</strong> visibles y{" "}
        <strong>{traspasos.length}</strong> cargados.
      </div>

      <div className="overflow-auto rounded-xl border bg-white">
        <table className="w-full min-w-[1500px] text-sm">
          <thead className="bg-gray-50 text-left">
            <tr>
              <th className="p-3">Fecha salida</th>
              <th className="p-3">Fecha recepción</th>
              <th className="p-3">Estado</th>
              <th className="p-3">Cliente</th>
              <th className="p-3">Producto</th>
              <th className="p-3">Cantidad</th>
              <th className="p-3">Recibida</th>
              <th className="p-3">Pendiente</th>
              <th className="p-3">Origen</th>
              <th className="p-3">Destino</th>
              <th className="p-3">Op. salida</th>
              <th className="p-3">Op. recepción</th>
              <th className="p-3">Reposición</th>
              <th className="p-3">Acción</th>
            </tr>
          </thead>

          <tbody>
            {traspasosFiltrados.map((traspaso) => {
              const cliente = obtenerPrimero(traspaso.clientes);
              const producto = obtenerPrimero(traspaso.productos_neumaticos);
              const solicitudReposicion = obtenerPrimero(
                traspaso.solicitudes_reposicion
              );

              const productoTexto = textoProductoRelacionado(producto);

              const cantidadRecibidaTabla = traspaso.cantidad_recibida || 0;
              const cantidadPendiente =
                traspaso.cantidad - cantidadRecibidaTabla;

              return (
                <tr key={traspaso.id} className="border-t align-top">
                  <td className="p-3">
                    {formatearFecha(traspaso.fecha_salida)}
                  </td>
                  <td className="p-3">
                    {formatearFecha(traspaso.fecha_recepcion)}
                  </td>
                  <td className="p-3 font-medium">
                    {traspaso.estado === "pendiente_salida" ? (
                      <span className="rounded-full bg-gray-100 px-2 py-1 text-xs font-semibold text-gray-800">
                        Pendiente salida
                      </span>
                    ) : traspaso.estado === "recibido" ? (
                      <span className="rounded-full bg-green-100 px-2 py-1 text-xs font-semibold text-green-800">
                        Recibido
                      </span>
                    ) : traspaso.estado === "recibido_parcial" ? (
                      <span className="rounded-full bg-yellow-100 px-2 py-1 text-xs font-semibold text-yellow-800">
                        Recibido parcial
                      </span>
                    ) : traspaso.estado === "en_camino" ? (
                      <span className="rounded-full bg-blue-100 px-2 py-1 text-xs font-semibold text-blue-800">
                        En camino
                      </span>
                    ) : traspaso.estado === "incidencia" ? (
                      <span className="rounded-full bg-red-100 px-2 py-1 text-xs font-semibold text-red-800">
                        Incidencia
                      </span>
                    ) : (
                      traspaso.estado || "-"
                    )}
                  </td>

                  <td className="p-3">{cliente?.nombre || "-"}</td>
                  <td className="p-3">{productoTexto}</td>
                  <td className="p-3">{traspaso.cantidad}</td>
                  <td className="p-3">{cantidadRecibidaTabla || "-"}</td>
                  <td className="p-3 font-bold">
                    {cantidadPendiente > 0 ? cantidadPendiente : "-"}
                  </td>
                  <td className="p-3">{traspaso.ubicacion_origen || "-"}</td>
                  <td className="p-3">{traspaso.ubicacion_destino || "-"}</td>
                  <td className="p-3">
                    {traspaso.codigo_operario_salida || "-"}
                  </td>
                  <td className="p-3">
                    {traspaso.codigo_operario_recepcion || "-"}
                  </td>
                  <td className="p-3">
                    {solicitudReposicion ? (
                      <div className="text-xs">
                        <span className="rounded-full bg-blue-100 px-2 py-1 font-semibold text-blue-800">
                          Reposición
                        </span>
                        <div className="mt-1 text-gray-500">
                          Estado: {solicitudReposicion.estado || "-"}
                        </div>
                        <div className="text-gray-500">
                          Cantidad:{" "}
                          {solicitudReposicion.cantidad_sugerida ?? "-"}
                        </div>
                      </div>
                    ) : (
                      "-"
                    )}
                  </td>
                  <td className="p-3">
                    {traspaso.estado === "pendiente_salida" &&
                    usuarioPuedeAutorizarSalida(traspaso) ? (
                      <button
                        type="button"
                        onClick={() => autorizarSalidaTraspaso(traspaso)}
                        className="rounded-lg border px-3 py-1 text-xs"
                      >
                        Autorizar salida
                      </button>
                    ) : (traspaso.estado === "en_camino" ||
                        traspaso.estado === "recibido_parcial") &&
                      usuarioPuedeRecibirTraspaso(traspaso) ? (
                      <button
                        type="button"
                        onClick={() => prepararRecepcion(traspaso)}
                        className="rounded-lg border px-3 py-1 text-xs"
                      >
                        Recibir
                      </button>
                    ) : (
                      "-"
                    )}
                  </td>
                </tr>
              );
            })}

            {traspasosFiltrados.length === 0 && (
              <tr>
                <td colSpan={14} className="p-6 text-center text-gray-500">
                  No hay traspasos visibles con los filtros actuales.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}