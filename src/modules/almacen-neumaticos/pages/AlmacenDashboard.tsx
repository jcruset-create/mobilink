import { useEffect, useState } from "react";
import AlmacenMenu from "../components/AlmacenMenu";
import { supabase } from "../services/supabase";
import { usePermisosAlmacen } from "../hooks/usePermisosAlmacen";

type MovimientoStock = {
  id: string;
  created_at: string;
  tipo: string;
  cantidad: number;
  ubicacion: string | null;
  cliente_id: string | null;
  producto_id: string | null;
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

type Traspaso = {
  id: string;
  estado: string | null;
  recibido_at: string | null;
};

type SolicitudReposicion = {
  id: string;
  estado: string | null;
};

type Incidencia = {
  id: string;
  estado: string | null;
  gravedad: string | null;
};

type Inventario = {
  id: string;
  estado: string | null;
};

type Kpis = {
  stockTotal: number;
  stockDisponible: number;
  stockEnCamino: number;
  stockNoDisponible: number;
  traspasosPendienteSalida: number;
  traspasosPendienteRecogida: number;
  traspasosEnCamino: number;
  traspasosRecibidosHoy: number;
  traspasosRecibidos30Dias: number;
  reposicionesPendientes: number;
  reposicionesEnTraspaso: number;
  incidenciasAbiertas: number;
  incidenciasCriticas: number;
  inventariosPendientesConteo: number;
  inventariosPendientesRevision: number;
  entradasMes: number;
  salidasMes: number;
  movimientosMes: number;
  clientesActivos: number;
  clientesStockNegativo: number;
};

type StockPorUbicacion = {
  ubicacion: string;
  cantidad: number;
};

type StockPorCliente = {
  clienteId: string;
  cliente: string;
  total: number;
  ubicaciones: StockPorUbicacion[];
};

const kpisIniciales: Kpis = {
  stockTotal: 0,
  stockDisponible: 0,
  stockEnCamino: 0,
  stockNoDisponible: 0,
  traspasosPendienteSalida: 0,
  traspasosPendienteRecogida: 0,
  traspasosEnCamino: 0,
  traspasosRecibidosHoy: 0,
  traspasosRecibidos30Dias: 0,
  reposicionesPendientes: 0,
  reposicionesEnTraspaso: 0,
  incidenciasAbiertas: 0,
  incidenciasCriticas: 0,
  inventariosPendientesConteo: 0,
  inventariosPendientesRevision: 0,
  entradasMes: 0,
  salidasMes: 0,
  movimientosMes: 0,
  clientesActivos: 0,
  clientesStockNegativo: 0,
};

function obtenerPrimero<T>(valor: T | T[] | null): T | null {
  if (!valor) return null;
  if (Array.isArray(valor)) return valor[0] || null;
  return valor;
}

function calcularCantidadMovimiento(movimiento: MovimientoStock) {
  if (movimiento.tipo === "SALIDA") {
    return -Math.abs(movimiento.cantidad);
  }

  return Math.abs(movimiento.cantidad);
}

function esUbicacionDisponible(ubicacion: string | null) {
  return (
    ubicacion !== "En camino" &&
    ubicacion !== "Central Alicante" &&
    ubicacion !== "Montado" &&
    ubicacion !== "Baja"
  );
}

function formatearFecha(fecha: string | null) {
  if (!fecha) return "-";
  return new Date(fecha).toLocaleString("es-ES");
}

function textoProducto(
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

function TarjetaKpi({
  titulo,
  valor,
  texto,
}: {
  titulo: string;
  valor: number;
  texto?: string;
}) {
  return (
    <div className="rounded-xl border bg-white p-4">
      <p className="text-sm text-gray-500">{titulo}</p>
      <p className="text-3xl font-bold">{valor}</p>
      {texto && <p className="mt-1 text-xs text-gray-500">{texto}</p>}
    </div>
  );
}

export default function AlmacenDashboard() {
  const { permisos, cargandoPermisos, errorPermisos, recargarPermisos } =
    usePermisosAlmacen();

  const [kpis, setKpis] = useState<Kpis>(kpisIniciales);
  const [stockPorCliente, setStockPorCliente] = useState<StockPorCliente[]>([]);
  const [ultimosMovimientos, setUltimosMovimientos] = useState<
    MovimientoStock[]
  >([]);
  const [mensaje, setMensaje] = useState("");
  const [cargando, setCargando] = useState(false);

  const puedeGestionar = permisos.esAdmin || permisos.esResponsable;
  const puedeVerAdmin = permisos.esAdmin;

  useEffect(() => {
    if (!cargandoPermisos) {
      cargarDashboard();
    }
  }, [cargandoPermisos, permisos.perfil?.id]);

  async function cargarDashboard() {
    setMensaje("");

    if (!permisos.perfil && !cargandoPermisos) {
      setKpis(kpisIniciales);
      setStockPorCliente([]);
      setUltimosMovimientos([]);
      return;
    }

    setCargando(true);

    const { data: movimientosData, error: movimientosError } = await supabase
      .from("movimientos_stock")
      .select(`
        id,
        created_at,
        tipo,
        cantidad,
        ubicacion,
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

    if (movimientosError) {
      setMensaje(`Error movimientos: ${movimientosError.message}`);
      setCargando(false);
      return;
    }

    const { data: traspasosData, error: traspasosError } = await supabase
      .from("traspasos")
      .select("id,estado,recibido_at");

    if (traspasosError) {
      setMensaje(`Error traspasos: ${traspasosError.message}`);
      setCargando(false);
      return;
    }

    const { data: reposicionesData, error: reposicionesError } = await supabase
      .from("solicitudes_reposicion")
      .select("id,estado");

    if (reposicionesError) {
      setMensaje(`Error reposiciones: ${reposicionesError.message}`);
      setCargando(false);
      return;
    }

    const { data: incidenciasData, error: incidenciasError } = await supabase
      .from("incidencias")
      .select("id,estado,gravedad");

    if (incidenciasError) {
      setMensaje(`Error incidencias: ${incidenciasError.message}`);
      setCargando(false);
      return;
    }

    const { data: inventariosData, error: inventariosError } = await supabase
      .from("inventarios")
      .select("id,estado");

    if (inventariosError) {
      setMensaje(`Error inventarios: ${inventariosError.message}`);
      setCargando(false);
      return;
    }

    const movimientos = (movimientosData || []) as unknown as MovimientoStock[];
    const traspasos = (traspasosData || []) as Traspaso[];
    const reposiciones = (reposicionesData || []) as SolicitudReposicion[];
    const incidencias = (incidenciasData || []) as Incidencia[];
    const inventarios = (inventariosData || []) as Inventario[];

    const stockTotal = movimientos.reduce(
      (total, movimiento) => total + calcularCantidadMovimiento(movimiento),
      0
    );

    const stockEnCamino = movimientos
      .filter((movimiento) => movimiento.ubicacion === "En camino")
      .reduce(
        (total, movimiento) => total + calcularCantidadMovimiento(movimiento),
        0
      );

    const stockNoDisponible = movimientos
      .filter(
        (movimiento) =>
          movimiento.ubicacion === "Central Alicante" ||
          movimiento.ubicacion === "Montado" ||
          movimiento.ubicacion === "Baja"
      )
      .reduce(
        (total, movimiento) => total + calcularCantidadMovimiento(movimiento),
        0
      );

    const stockDisponible = movimientos
      .filter((movimiento) => esUbicacionDisponible(movimiento.ubicacion))
      .reduce(
        (total, movimiento) => total + calcularCantidadMovimiento(movimiento),
        0
      );

    const inicioMes = new Date();
    inicioMes.setDate(1);
    inicioMes.setHours(0, 0, 0, 0);

    const hoyTexto = new Date().toISOString().slice(0, 10);
    const hace30Dias = new Date();
    hace30Dias.setDate(hace30Dias.getDate() - 29);
    hace30Dias.setHours(0, 0, 0, 0);

    const movimientosMes = movimientos.filter(
      (movimiento) => new Date(movimiento.created_at) >= inicioMes
    );

    const entradasMes = movimientosMes
      .filter((movimiento) => movimiento.tipo === "ENTRADA")
      .reduce((total, movimiento) => total + Math.abs(movimiento.cantidad), 0);

    const salidasMes = movimientosMes
      .filter((movimiento) => movimiento.tipo === "SALIDA")
      .reduce((total, movimiento) => total + Math.abs(movimiento.cantidad), 0);

    const clientesActivos = new Set(
      movimientos
        .filter((movimiento) => movimiento.cliente_id)
        .map((movimiento) => movimiento.cliente_id)
    ).size;

    const mapaClientes = new Map<string, StockPorCliente>();

    movimientos.forEach((movimiento) => {
      const cliente = obtenerPrimero(movimiento.clientes);
      const nombreCliente = cliente?.nombre || "Sin cliente";
      const ubicacionMovimiento = movimiento.ubicacion || "-";
      const cantidadMovimiento = calcularCantidadMovimiento(movimiento);
      const claveCliente = movimiento.cliente_id || "sin-cliente";

      const clienteExistente = mapaClientes.get(claveCliente);

      if (!clienteExistente) {
        mapaClientes.set(claveCliente, {
          clienteId: claveCliente,
          cliente: nombreCliente,
          total: cantidadMovimiento,
          ubicaciones: [
            {
              ubicacion: ubicacionMovimiento,
              cantidad: cantidadMovimiento,
            },
          ],
        });

        return;
      }

      clienteExistente.total += cantidadMovimiento;

      const ubicacionExistente = clienteExistente.ubicaciones.find(
        (item) => item.ubicacion === ubicacionMovimiento
      );

      if (ubicacionExistente) {
        ubicacionExistente.cantidad += cantidadMovimiento;
      } else {
        clienteExistente.ubicaciones.push({
          ubicacion: ubicacionMovimiento,
          cantidad: cantidadMovimiento,
        });
      }
    });

    const resumenClientes = Array.from(mapaClientes.values())
      .map((cliente) => ({
        ...cliente,
        ubicaciones: cliente.ubicaciones
          .filter((ubicacion) => ubicacion.cantidad !== 0)
          .sort((a, b) => a.ubicacion.localeCompare(b.ubicacion)),
      }))
      .filter((cliente) => cliente.total !== 0)
      .sort((a, b) => b.total - a.total);

    const clientesStockNegativo = resumenClientes.filter(
      (cliente) => cliente.total < 0
    ).length;

    setStockPorCliente(resumenClientes);
    setUltimosMovimientos(movimientos.slice(0, 10));

    setKpis({
      stockTotal,
      stockDisponible,
      stockEnCamino,
      stockNoDisponible,
      traspasosPendienteSalida: traspasos.filter(
        (traspaso) => traspaso.estado === "pendiente_salida"
      ).length,
      traspasosPendienteRecogida: traspasos.filter(
        (traspaso) => traspaso.estado === "preparado"
      ).length,
      traspasosEnCamino: traspasos.filter(
        (traspaso) =>
          traspaso.estado === "en_camino" ||
          traspaso.estado === "recibido_parcial"
      ).length,
      traspasosRecibidosHoy: traspasos.filter(
        (traspaso) =>
          traspaso.estado === "recibido" &&
          traspaso.recibido_at?.slice(0, 10) === hoyTexto
      ).length,
      traspasosRecibidos30Dias: traspasos.filter(
        (traspaso) =>
          traspaso.estado === "recibido" &&
          traspaso.recibido_at &&
          new Date(traspaso.recibido_at) >= hace30Dias
      ).length,
      reposicionesPendientes: reposiciones.filter(
        (reposicion) => reposicion.estado === "pendiente"
      ).length,
      reposicionesEnTraspaso: reposiciones.filter(
        (reposicion) => reposicion.estado === "en_traspaso"
      ).length,
      incidenciasAbiertas: incidencias.filter(
        (incidencia) => incidencia.estado !== "resuelta"
      ).length,
      incidenciasCriticas: incidencias.filter(
        (incidencia) =>
          incidencia.estado !== "resuelta" &&
          incidencia.gravedad === "critica"
      ).length,
      inventariosPendientesConteo: inventarios.filter(
        (inventario) => inventario.estado === "pendiente_conteo"
      ).length,
      inventariosPendientesRevision: inventarios.filter(
        (inventario) => inventario.estado === "pendiente_revision"
      ).length,
      entradasMes,
      salidasMes,
      movimientosMes: movimientosMes.length,
      clientesActivos,
      clientesStockNegativo,
    });

    setCargando(false);
  }

  const alertas = [
    {
      titulo: "Traspasos pendientes de salida",
      valor: kpis.traspasosPendienteSalida,
      texto: "Necesitan autorización de operario de salida.",
      url: "/almacen-neumaticos/traspasos",
      visible: true,
    },
    {
      titulo: "Traspasos pendientes de recogida",
      valor: kpis.traspasosPendienteRecogida,
      texto: "Preparados y pendientes de recoger desde móvil.",
      url: "/almacen-neumaticos/mobile",
      visible: true,
    },
    {
      titulo: "Traspasos en camino",
      valor: kpis.traspasosEnCamino,
      texto: "Pendientes de recepción o recepción parcial.",
      url: "/almacen-neumaticos/mobile",
      visible: true,
    },
    {
      titulo: "Reposiciones pendientes",
      valor: kpis.reposicionesPendientes,
      texto: "Solicitudes pendientes de aprobación.",
      url: "/almacen-neumaticos/reposiciones",
      visible: puedeGestionar,
    },
    {
      titulo: "Reposiciones en traspaso",
      valor: kpis.reposicionesEnTraspaso,
      texto: "Solicitudes con traspaso generado.",
      url: "/almacen-neumaticos/reposiciones",
      visible: puedeGestionar,
    },
    {
      titulo: "Inventarios pendientes de conteo",
      valor: kpis.inventariosPendientesConteo,
      texto: "Inventarios abiertos pendientes de conteo físico.",
      url: "/almacen-neumaticos/inventarios",
      visible: true,
    },
    {
      titulo: "Inventarios pendientes revisión",
      valor: kpis.inventariosPendientesRevision,
      texto: "Inventarios cerrados por operario y pendientes de responsable.",
      url: "/almacen-neumaticos/inventarios",
      visible: puedeGestionar,
    },
    {
      titulo: "Incidencias abiertas",
      valor: kpis.incidenciasAbiertas,
      texto: "Incidencias pendientes de resolución.",
      url: "/almacen-neumaticos/incidencias",
      visible: true,
    },
    {
      titulo: "Incidencias críticas",
      valor: kpis.incidenciasCriticas,
      texto: "Incidencias críticas todavía abiertas.",
      url: "/almacen-neumaticos/incidencias",
      visible: true,
    },
    {
      titulo: "Clientes con stock negativo",
      valor: kpis.clientesStockNegativo,
      texto: "Hay clientes con stock total negativo. Revisar movimientos.",
      url: "/almacen-neumaticos/stock",
      visible: kpis.clientesStockNegativo > 0,
    },
    {
      titulo: "Demasiados inventarios pendientes",
      valor:
        kpis.inventariosPendientesConteo +
        kpis.inventariosPendientesRevision,
      texto: "Existen inventarios pendientes de cerrar.",
      url: "/almacen-neumaticos/inventarios",
      visible:
        kpis.inventariosPendientesConteo +
          kpis.inventariosPendientesRevision >
        5,
    },
    {
      titulo: "Reposiciones acumuladas",
      valor: kpis.reposicionesPendientes,
      texto: "Hay muchas reposiciones pendientes de aprobación.",
      url: "/almacen-neumaticos/reposiciones",
      visible: puedeGestionar && kpis.reposicionesPendientes > 10,
    },
    {
      titulo: "Traspasos acumulados",
      valor: kpis.traspasosEnCamino,
      texto: "Hay muchos traspasos pendientes de recepción.",
      url: "/almacen-neumaticos/mobile",
      visible: kpis.traspasosEnCamino > 10,
    },
  ].filter((alerta) => alerta.visible && alerta.valor > 0);

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
          <h1 className="text-2xl font-bold">Dashboard almacén neumáticos</h1>
          <p className="text-sm text-gray-500">
            Vista operativa de stock, traspasos, reposiciones, inventarios e
            incidencias según los permisos del usuario conectado.
          </p>
        </div>

        <button
          type="button"
          onClick={cargarDashboard}
          className="rounded-xl border px-4 py-2 text-sm font-semibold"
        >
          {cargando ? "Actualizando..." : "Actualizar dashboard"}
        </button>
      </div>

      {errorPermisos && (
        <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
          {errorPermisos}
        </p>
      )}

      {mensaje && <p className="text-sm text-red-600">{mensaje}</p>}

      {permisos.perfil && (
        <div className="rounded-xl border bg-white p-4 text-sm text-gray-700">
          Usuario: <strong>{permisos.perfil.nombre || "-"}</strong> · Rol:{" "}
          <strong>{permisos.perfil.rol || "-"}</strong> · Ubicación:{" "}
          <strong>{permisos.ubicacion || "-"}</strong> · Clientes:{" "}
          <strong>
            {permisos.esAdmin
              ? "Todos"
              : permisos.clientesPermitidos.length > 0
              ? permisos.clientesPermitidos
                  .map((cliente) => cliente.nombre)
                  .join(", ")
              : "Ninguno"}
          </strong>
          <button
            type="button"
            onClick={recargarPermisos}
            className="ml-3 rounded-lg border px-3 py-1 text-xs font-semibold"
          >
            Recargar permisos
          </button>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-4">
        <TarjetaKpi
          titulo="Stock total sistema"
          valor={kpis.stockTotal}
          texto="Total neto visible para este usuario."
        />

        <TarjetaKpi
          titulo="Stock disponible"
          valor={kpis.stockDisponible}
          texto="Stock utilizable en ubicaciones operativas."
        />

        <TarjetaKpi
          titulo="En camino"
          valor={kpis.stockEnCamino}
          texto="Stock actualmente en tránsito."
        />

        <TarjetaKpi
          titulo="No disponible"
          valor={kpis.stockNoDisponible}
          texto="Central Alicante, montado o baja."
        />
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <TarjetaKpi
          titulo="Traspasos activos"
          valor={
            kpis.traspasosPendienteSalida +
            kpis.traspasosPendienteRecogida +
            kpis.traspasosEnCamino
          }
          texto="Pendientes de salida, recogida o recepción."
        />

        <TarjetaKpi
          titulo="Reposiciones activas"
          valor={kpis.reposicionesPendientes + kpis.reposicionesEnTraspaso}
          texto={
            puedeGestionar
              ? "Pendientes o actualmente en traspaso."
              : "Solo visibles para admin/responsable."
          }
        />

        <TarjetaKpi
          titulo="Inventarios abiertos"
          valor={
            kpis.inventariosPendientesConteo +
            kpis.inventariosPendientesRevision
          }
          texto="Pendientes de conteo o revisión."
        />

        <TarjetaKpi
          titulo="Incidencias abiertas"
          valor={kpis.incidenciasAbiertas}
          texto={`Críticas: ${kpis.incidenciasCriticas}`}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <TarjetaKpi
          titulo="Pendientes recogida"
          valor={kpis.traspasosPendienteRecogida}
          texto="Traspasos preparados pendientes de recoger."
        />

        <TarjetaKpi
          titulo="En camino"
          valor={kpis.traspasosEnCamino}
          texto="Traspasos pendientes de recepción."
        />

        <TarjetaKpi
          titulo="Recibidos hoy"
          valor={kpis.traspasosRecibidosHoy}
          texto="Recepciones confirmadas hoy."
        />

        <TarjetaKpi
          titulo="Recibidos 30 días"
          valor={kpis.traspasosRecibidos30Dias}
          texto="Recepciones confirmadas en los últimos 30 días."
        />
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <TarjetaKpi
          titulo="Entradas del mes"
          valor={kpis.entradasMes}
          texto="Neumáticos incorporados este mes."
        />

        <TarjetaKpi
          titulo="Salidas del mes"
          valor={kpis.salidasMes}
          texto="Montajes y salidas registradas."
        />

        <TarjetaKpi
          titulo="Movimientos del mes"
          valor={kpis.movimientosMes}
          texto="Entradas y salidas acumuladas."
        />

        <TarjetaKpi
          titulo="Clientes activos"
          valor={kpis.clientesActivos}
          texto="Clientes con movimientos registrados."
        />
      </div>

      <div className="rounded-xl border bg-white p-4 space-y-4">
        <div>
          <h2 className="font-semibold">Alertas operativas avanzadas</h2>
          <p className="text-sm text-gray-500">
            Elementos que requieren acción del equipo.
          </p>
        </div>

        {alertas.length === 0 ? (
          <div className="rounded-lg bg-gray-50 p-4 text-sm text-gray-600">
            No hay alertas operativas pendientes.
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {alertas.map((alerta) => (
              <a
                key={alerta.titulo}
                href={alerta.url}
                className="rounded-xl border p-4 hover:bg-gray-50"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold">{alerta.titulo}</p>
                    <p className="text-sm text-gray-500">{alerta.texto}</p>
                  </div>

                  <span className="rounded-full bg-red-100 px-3 py-1 text-sm font-bold text-red-800">
                    {alerta.valor}
                  </span>
                </div>
              </a>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-xl border bg-white p-4 space-y-4">
        <div>
          <h2 className="font-semibold">Top 5 clientes por stock</h2>
          <p className="text-sm text-gray-500">
            Resumen total agrupado por cliente y almacén. Los datos ya vienen
            filtrados por RLS.
          </p>
        </div>

        {stockPorCliente.length === 0 ? (
          <div className="rounded-lg bg-gray-50 p-4 text-sm text-gray-600">
            No hay stock visible por cliente.
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left">
                <tr>
                  <th className="p-3">Cliente</th>
                  <th className="p-3 text-right">Total</th>
                  <th className="p-3">Ubicaciones</th>
                </tr>
              </thead>

              <tbody>
                {stockPorCliente.slice(0, 5).map((cliente) => (
                  <tr key={cliente.clienteId} className="border-t align-top">
                    <td className="p-3 font-semibold">{cliente.cliente}</td>

                    <td className="p-3 text-right text-lg font-bold">
                      {cliente.total}
                    </td>

                    <td className="p-3">
                      <div className="flex flex-wrap gap-2">
                        {cliente.ubicaciones.map((ubicacionItem) => (
                          <span
                            key={ubicacionItem.ubicacion}
                            className="rounded-full border bg-gray-50 px-3 py-1 text-xs"
                          >
                            {ubicacionItem.ubicacion}:{" "}
                            <strong>{ubicacionItem.cantidad}</strong>
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="rounded-xl border bg-white p-4 space-y-4">
        <div>
          <h2 className="font-semibold">Últimos movimientos visibles</h2>
          <p className="text-sm text-gray-500">
            Últimos movimientos de stock accesibles según permisos.
          </p>
        </div>

        {ultimosMovimientos.length === 0 ? (
          <div className="rounded-lg bg-gray-50 p-4 text-sm text-gray-600">
            No hay movimientos visibles.
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left">
                <tr>
                  <th className="p-3">Fecha</th>
                  <th className="p-3">Tipo</th>
                  <th className="p-3">Cliente</th>
                  <th className="p-3">Producto</th>
                  <th className="p-3">Ubicación</th>
                  <th className="p-3 text-right">Cantidad</th>
                </tr>
              </thead>

              <tbody>
                {ultimosMovimientos.map((movimiento) => {
                  const cliente = obtenerPrimero(movimiento.clientes);
                  const producto = obtenerPrimero(
                    movimiento.productos_neumaticos
                  );

                  return (
                    <tr key={movimiento.id} className="border-t">
                      <td className="p-3">
                        {formatearFecha(movimiento.created_at)}
                      </td>
                      <td className="p-3 font-medium">{movimiento.tipo}</td>
                      <td className="p-3">{cliente?.nombre || "-"}</td>
                      <td className="p-3">{textoProducto(producto)}</td>
                      <td className="p-3">{movimiento.ubicacion || "-"}</td>
                      <td className="p-3 text-right font-bold">
                        {movimiento.cantidad}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <a
          href="/almacen-neumaticos/stock"
          className="rounded-xl border bg-white p-4 hover:bg-gray-50"
        >
          <p className="font-semibold">Stock operativo</p>
          <p className="text-sm text-gray-500">Ver stock por ubicación.</p>
        </a>

        <a
          href="/almacen-neumaticos/mobile"
          className="rounded-xl border bg-white p-4 hover:bg-gray-50"
        >
          <p className="font-semibold">Mobile</p>
          <p className="text-sm text-gray-500">Vista móvil de traspasos.</p>
        </a>

        <a
          href="/almacen-neumaticos/traspasos"
          className="rounded-xl border bg-white p-4 hover:bg-gray-50"
        >
          <p className="font-semibold">Traspasos</p>
          <p className="text-sm text-gray-500">
            Autorizar salidas y recepciones.
          </p>
        </a>

        <a
          href="/almacen-neumaticos/inventarios"
          className="rounded-xl border bg-white p-4 hover:bg-gray-50"
        >
          <p className="font-semibold">Inventarios</p>
          <p className="text-sm text-gray-500">Conteo y revisión de stock.</p>
        </a>

        <a
          href="/almacen-neumaticos/incidencias"
          className="rounded-xl border bg-white p-4 hover:bg-gray-50"
        >
          <p className="font-semibold">Incidencias</p>
          <p className="text-sm text-gray-500">Resolver incidencias abiertas.</p>
        </a>

        {puedeGestionar && (
          <>
            <a
              href="/almacen-neumaticos/entradas"
              className="rounded-xl border bg-white p-4 hover:bg-gray-50"
            >
              <p className="font-semibold">Entradas</p>
              <p className="text-sm text-gray-500">
                Registrar entradas manuales.
              </p>
            </a>

            <a
              href="/almacen-neumaticos/reposiciones"
              className="rounded-xl border bg-white p-4 hover:bg-gray-50"
            >
              <p className="font-semibold">Reposiciones</p>
              <p className="text-sm text-gray-500">
                Gestionar mínimos y solicitudes.
              </p>
            </a>
          </>
        )}

        {puedeVerAdmin && (
          <>
            <a
              href="/almacen-neumaticos/usuarios"
              className="rounded-xl border bg-white p-4 hover:bg-gray-50"
            >
              <p className="font-semibold">Usuarios</p>
              <p className="text-sm text-gray-500">Gestionar roles y accesos.</p>
            </a>

            <a
              href="/almacen-neumaticos/auditoria"
              className="rounded-xl border bg-white p-4 hover:bg-gray-50"
            >
              <p className="font-semibold">Auditoría</p>
              <p className="text-sm text-gray-500">
                Ver acciones críticas registradas.
              </p>
            </a>

            <a
              href="/almacen-neumaticos/auditoria-traspasos"
              className="rounded-xl border bg-white p-4 hover:bg-gray-50"
            >
              <p className="font-semibold">Auditoría traspasos</p>
              <p className="text-sm text-gray-500">
                Ver recogidas y recepciones móviles.
              </p>
            </a>
          </>
        )}
      </div>
    </div>
  );
}