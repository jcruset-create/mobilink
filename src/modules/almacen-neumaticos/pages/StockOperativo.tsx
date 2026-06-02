import { useEffect, useState } from "react";
import AlmacenMenu from "../components/AlmacenMenu";
import { supabase } from "../services/supabase";
import { usePermisosAlmacen } from "../hooks/usePermisosAlmacen";
import {
  exportarCsv,
  exportarExcel,
  type FilaExportacion,
} from "../services/exportAlmacen";

type MovimientoStock = {
  id: string;
  tipo: string;
  cantidad: number;
  ubicacion: string | null;
  cliente_id: string | null;
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

type StockAgrupado = {
  clave: string;
  clienteId: string;
  cliente: string;
  medida: string;
  marca: string;
  modelo: string;
  dot: string;
  ubicacion: string;
  cantidad: number;
};

function obtenerPrimero<T>(valor: T | T[] | null): T | null {
  if (!valor) return null;
  if (Array.isArray(valor)) return valor[0] || null;
  return valor;
}

function estadoUbicacion(ubicacion: string) {
  if (ubicacion === "En camino") return "en_camino";
  if (ubicacion === "Central Alicante") return "no_disponible";
  if (ubicacion === "Montado") return "montado";
  if (ubicacion === "Baja") return "baja";
  return "disponible";
}

function textoEstado(ubicacion: string) {
  const estado = estadoUbicacion(ubicacion);

  if (estado === "en_camino") return "En tránsito";
  if (estado === "no_disponible") return "No disponible";
  if (estado === "montado") return "Montado";
  if (estado === "baja") return "Baja";

  return "Disponible";
}

function etiquetaEstado(ubicacion: string) {
  const estado = estadoUbicacion(ubicacion);

  if (estado === "en_camino") {
    return (
      <span className="rounded-full bg-yellow-100 px-2 py-1 text-xs font-semibold text-yellow-800">
        En tránsito
      </span>
    );
  }

  if (estado === "no_disponible") {
    return (
      <span className="rounded-full bg-red-100 px-2 py-1 text-xs font-semibold text-red-800">
        No disponible
      </span>
    );
  }

  if (estado === "montado") {
    return (
      <span className="rounded-full bg-blue-100 px-2 py-1 text-xs font-semibold text-blue-800">
        Montado
      </span>
    );
  }

  if (estado === "baja") {
    return (
      <span className="rounded-full bg-gray-100 px-2 py-1 text-xs font-semibold text-gray-800">
        Baja
      </span>
    );
  }

  return (
    <span className="rounded-full bg-green-100 px-2 py-1 text-xs font-semibold text-green-800">
      Disponible
    </span>
  );
}

export default function StockOperativo() {
  const { permisos, cargandoPermisos } = usePermisosAlmacen();

  const [stock, setStock] = useState<StockAgrupado[]>([]);
  const [filtroCliente, setFiltroCliente] = useState("");
  const [filtroUbicacion, setFiltroUbicacion] = useState("");
  const [filtroEstado, setFiltroEstado] = useState("");
  const [filtroProducto, setFiltroProducto] = useState("");
  const [filtroTexto, setFiltroTexto] = useState("");
  const [soloStockBajo, setSoloStockBajo] = useState(false);
  const [soloStockPositivo, setSoloStockPositivo] = useState(false);
  const [mensaje, setMensaje] = useState("");

  useEffect(() => {
    cargarStock();
  }, []);

  useEffect(() => {
    limpiarFiltros();
  }, [permisos.perfil?.id]);

  function limpiarFiltros() {
    setFiltroCliente("");
    setFiltroUbicacion("");
    setFiltroEstado("");
    setFiltroProducto("");
    setFiltroTexto("");
    setSoloStockBajo(false);
    setSoloStockPositivo(false);
  }

  async function cargarStock() {
    setMensaje("");

    const { data, error } = await supabase
      .from("movimientos_stock")
      .select(`
        id,
        tipo,
        cantidad,
        ubicacion,
        cliente_id,
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
      setMensaje(`Error: ${error.message}`);
      return;
    }

    const movimientos = (data || []) as unknown as MovimientoStock[];
    const mapa = new Map<string, StockAgrupado>();

    movimientos.forEach((movimiento) => {
      const cliente = obtenerPrimero(movimiento.clientes);
      const producto = obtenerPrimero(movimiento.productos_neumaticos);

      if (!producto || !cliente) return;

      const ubicacion = movimiento.ubicacion || "-";
      const modelo = producto.modelo || "-";
      const dot = producto.dot || "-";
      const clienteId = movimiento.cliente_id || "sin-cliente";

      const clave = [
        clienteId,
        cliente.nombre,
        producto.medida,
        producto.marca,
        modelo,
        dot,
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
          clienteId,
          cliente: cliente.nombre,
          medida: producto.medida,
          marca: producto.marca,
          modelo,
          dot,
          ubicacion,
          cantidad: cantidadMovimiento,
        });
      }
    });

    const resultado = Array.from(mapa.values())
      .filter((linea) => linea.cantidad !== 0)
      .sort((a, b) => {
        const clienteOrden = a.cliente.localeCompare(b.cliente);
        if (clienteOrden !== 0) return clienteOrden;
        return a.ubicacion.localeCompare(b.ubicacion);
      });

    setStock(resultado);
  }

  const clientesPermitidosIds = permisos.clientesPermitidos.map(
    (cliente) => cliente.id
  );

  const stockPorPermisos = stock.filter((linea) => {
    if (!permisos.perfil) return false;
    if (permisos.esAdmin) return true;

    const puedeCliente = clientesPermitidosIds.includes(linea.clienteId);
    const puedeUbicacion = permisos.ubicacion === linea.ubicacion;

    return puedeCliente && puedeUbicacion;
  });

  const clientesDisponibles = Array.from(
    new Map(
      stockPorPermisos.map((linea) => [
        linea.clienteId,
        {
          id: linea.clienteId,
          nombre: linea.cliente,
        },
      ])
    ).values()
  ).sort((a, b) => a.nombre.localeCompare(b.nombre));

  const ubicacionesDisponibles = Array.from(
    new Set(stockPorPermisos.map((linea) => linea.ubicacion))
  ).sort((a, b) => a.localeCompare(b));

  const stockFiltrado = stockPorPermisos.filter((linea) => {
    if (filtroCliente && linea.clienteId !== filtroCliente) return false;

    if (filtroUbicacion && linea.ubicacion !== filtroUbicacion) {
      return false;
    }

    if (filtroEstado && estadoUbicacion(linea.ubicacion) !== filtroEstado) {
      return false;
    }

    if (soloStockBajo && linea.cantidad >= 5) {
      return false;
    }

    if (soloStockPositivo && linea.cantidad <= 0) {
      return false;
    }

    if (filtroProducto.trim()) {
      const productoTexto = [linea.medida, linea.marca, linea.modelo, linea.dot]
        .join(" ")
        .toLowerCase();

      if (!productoTexto.includes(filtroProducto.trim().toLowerCase())) {
        return false;
      }
    }

    if (filtroTexto.trim()) {
      const texto = [
        linea.cliente,
        linea.medida,
        linea.marca,
        linea.modelo,
        linea.dot,
        linea.ubicacion,
        textoEstado(linea.ubicacion),
        String(linea.cantidad),
      ]
        .join(" ")
        .toLowerCase();

      if (!texto.includes(filtroTexto.trim().toLowerCase())) {
        return false;
      }
    }

    return true;
  });

  const totalDisponible = stockFiltrado
    .filter((linea) => estadoUbicacion(linea.ubicacion) === "disponible")
    .reduce((total, linea) => total + linea.cantidad, 0);

  const totalEnCamino = stockFiltrado
    .filter((linea) => estadoUbicacion(linea.ubicacion) === "en_camino")
    .reduce((total, linea) => total + linea.cantidad, 0);

  const totalNoDisponible = stockFiltrado
    .filter((linea) => estadoUbicacion(linea.ubicacion) === "no_disponible")
    .reduce((total, linea) => total + linea.cantidad, 0);

  const totalMontado = stockFiltrado
    .filter((linea) => estadoUbicacion(linea.ubicacion) === "montado")
    .reduce((total, linea) => total + linea.cantidad, 0);

  const totalBaja = stockFiltrado
    .filter((linea) => estadoUbicacion(linea.ubicacion) === "baja")
    .reduce((total, linea) => total + linea.cantidad, 0);

  const totalFiltrado = stockFiltrado.reduce(
    (total, linea) => total + linea.cantidad,
    0
  );

  function filasExportacionStock(): FilaExportacion[] {
    return stockFiltrado.map((linea) => ({
      cliente: linea.cliente,
      medida: linea.medida,
      marca: linea.marca,
      modelo: linea.modelo,
      dot: linea.dot,
      ubicacion: linea.ubicacion,
      estado: textoEstado(linea.ubicacion),
      stock: linea.cantidad,
      stock_bajo: linea.cantidad < 5 ? "Sí" : "No",
    }));
  }

  function exportarStockCsv() {
    const filas = filasExportacionStock();

    if (filas.length === 0) {
      setMensaje("No hay stock filtrado para exportar.");
      return;
    }

    exportarCsv("stock-operativo", filas);
  }

  async function exportarStockExcel() {
    const filas = filasExportacionStock();

    if (filas.length === 0) {
      setMensaje("No hay stock filtrado para exportar.");
      return;
    }

    await exportarExcel("stock-operativo", "Stock", filas);
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
          <h1 className="text-2xl font-bold">Stock operativo</h1>
          <p className="text-sm text-gray-500">
            Stock calculado a partir de movimientos, filtrado automáticamente por
            permisos del usuario conectado.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={cargarStock}
            className="rounded-xl border px-4 py-2 text-sm font-semibold"
          >
            Actualizar stock
          </button>

          <button
            type="button"
            onClick={exportarStockCsv}
            className="rounded-xl border px-4 py-2 text-sm font-semibold disabled:opacity-50"
            disabled={stockFiltrado.length === 0}
          >
            Exportar CSV
          </button>

          <button
            type="button"
            onClick={exportarStockExcel}
            className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            disabled={stockFiltrado.length === 0}
          >
            Exportar Excel
          </button>
        </div>
      </div>

      {mensaje && <p className="text-sm text-red-600">{mensaje}</p>}

      <div className="rounded-xl border bg-white p-4 space-y-4">
        <h2 className="font-semibold">Filtros</h2>

        <div className="grid gap-3 md:grid-cols-4">
          <select
            value={filtroCliente}
            onChange={(e) => setFiltroCliente(e.target.value)}
            className="rounded-lg border px-3 py-2 text-sm"
            disabled={!permisos.perfil}
          >
            <option value="">Todos los clientes visibles</option>
            {clientesDisponibles.map((cliente) => (
              <option key={cliente.id} value={cliente.id}>
                {cliente.nombre}
              </option>
            ))}
          </select>

          <select
            value={filtroUbicacion}
            onChange={(e) => setFiltroUbicacion(e.target.value)}
            className="rounded-lg border px-3 py-2 text-sm"
            disabled={!permisos.perfil}
          >
            <option value="">Todas las ubicaciones visibles</option>
            {ubicacionesDisponibles.map((ubicacion) => (
              <option key={ubicacion} value={ubicacion}>
                {ubicacion}
              </option>
            ))}
          </select>

          <select
            value={filtroEstado}
            onChange={(e) => setFiltroEstado(e.target.value)}
            className="rounded-lg border px-3 py-2 text-sm"
            disabled={!permisos.perfil}
          >
            <option value="">Todos los estados</option>
            <option value="disponible">Disponible</option>
            <option value="en_camino">En camino</option>
            <option value="no_disponible">No disponible</option>
            <option value="montado">Montado</option>
            <option value="baja">Baja</option>
          </select>

          <input
            value={filtroProducto}
            onChange={(e) => setFiltroProducto(e.target.value)}
            placeholder="Producto, medida, marca o DOT"
            className="rounded-lg border px-3 py-2 text-sm"
            disabled={!permisos.perfil}
          />

          <input
            value={filtroTexto}
            onChange={(e) => setFiltroTexto(e.target.value)}
            placeholder="Buscar cliente, producto, ubicación..."
            className="rounded-lg border px-3 py-2 text-sm md:col-span-2"
            disabled={!permisos.perfil}
          />

          <label className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
            <input
              type="checkbox"
              checked={soloStockBajo}
              onChange={(e) => setSoloStockBajo(e.target.checked)}
              disabled={!permisos.perfil}
            />
            Solo stock bajo (&lt;5)
          </label>

          <label className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
            <input
              type="checkbox"
              checked={soloStockPositivo}
              onChange={(e) => setSoloStockPositivo(e.target.checked)}
              disabled={!permisos.perfil}
            />
            Solo stock positivo
          </label>
        </div>

        <button
          type="button"
          onClick={limpiarFiltros}
          className="rounded-xl border px-4 py-2 text-sm font-semibold"
        >
          Limpiar filtros
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-6">
        <div className="rounded-xl border bg-white p-4">
          <p className="text-sm text-gray-500">Total filtrado</p>
          <p className="text-2xl font-bold">{totalFiltrado}</p>
        </div>

        <div className="rounded-xl border bg-white p-4">
          <p className="text-sm text-gray-500">Disponible</p>
          <p className="text-2xl font-bold">{totalDisponible}</p>
        </div>

        <div className="rounded-xl border bg-white p-4">
          <p className="text-sm text-gray-500">En camino</p>
          <p className="text-2xl font-bold">{totalEnCamino}</p>
        </div>

        <div className="rounded-xl border bg-white p-4">
          <p className="text-sm text-gray-500">No disponible</p>
          <p className="text-2xl font-bold">{totalNoDisponible}</p>
        </div>

        <div className="rounded-xl border bg-white p-4">
          <p className="text-sm text-gray-500">Montado</p>
          <p className="text-2xl font-bold">{totalMontado}</p>
        </div>

        <div className="rounded-xl border bg-white p-4">
          <p className="text-sm text-gray-500">Baja</p>
          <p className="text-2xl font-bold">{totalBaja}</p>
        </div>
      </div>

      <div className="rounded-xl border bg-white p-3 text-sm text-gray-600">
        Mostrando <strong>{stockFiltrado.length}</strong> líneas de stock de{" "}
        <strong>{stockPorPermisos.length}</strong> visibles.
      </div>

      <div className="overflow-auto rounded-xl border bg-white">
        <table className="w-full min-w-[1000px] text-sm">
          <thead className="bg-gray-50 text-left">
            <tr>
              <th className="p-3">Cliente</th>
              <th className="p-3">Medida</th>
              <th className="p-3">Marca</th>
              <th className="p-3">Modelo</th>
              <th className="p-3">DOT</th>
              <th className="p-3">Ubicación</th>
              <th className="p-3">Estado</th>
              <th className="p-3 text-right">Stock</th>
            </tr>
          </thead>

          <tbody>
            {stockFiltrado.map((linea) => (
              <tr
                key={linea.clave}
                className={`border-t ${
                  linea.cantidad < 5 ? "bg-red-50" : ""
                }`}
              >
                <td className="p-3 font-medium">{linea.cliente}</td>
                <td className="p-3">{linea.medida}</td>
                <td className="p-3">{linea.marca}</td>
                <td className="p-3">{linea.modelo}</td>
                <td className="p-3">{linea.dot}</td>
                <td className="p-3">{linea.ubicacion}</td>
                <td className="p-3">{etiquetaEstado(linea.ubicacion)}</td>
                <td className="p-3 text-right font-bold">
                  {linea.cantidad}
                </td>
              </tr>
            ))}

            {stockFiltrado.length === 0 && (
              <tr>
                <td colSpan={8} className="p-6 text-center text-gray-500">
                  No hay stock visible con los filtros actuales.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}