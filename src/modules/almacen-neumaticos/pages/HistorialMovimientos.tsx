import { useEffect, useState } from "react";
import AlmacenMenu from "../components/AlmacenMenu";
import { supabase } from "../services/supabase";
import {
  exportarCsv,
  exportarExcel,
  type FilaExportacion,
} from "../services/exportAlmacen";

type Movimiento = {
  id: string;
  created_at: string;
  tipo: string;
  cantidad: number;
  ubicacion: string | null;
  documento_tipo: string | null;
  documento_numero: string | null;
  observaciones: string | null;
  documento_adjunto_url: string | null;
  documento_adjunto_nombre: string | null;
  origen_movimiento: string | null;
  traspaso_id: string | null;
  solicitud_reposicion_id: string | null;
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
  vehiculos:
    | {
        matricula: string;
        numero_vehiculo: string | null;
        marca: string | null;
        modelo: string | null;
      }
    | {
        matricula: string;
        numero_vehiculo: string | null;
        marca: string | null;
        modelo: string | null;
      }[]
    | null;
};

const ORIGENES = [
  { valor: "entrada_manual", texto: "Entrada manual" },
  { valor: "traspaso_manual", texto: "Traspaso manual" },
  { valor: "reposicion", texto: "Reposición" },
  { valor: "montaje", texto: "Montaje" },
  { valor: "ajuste_inventario", texto: "Ajuste inventario" },
];

function obtenerPrimero<T>(valor: T | T[] | null): T | null {
  if (!valor) return null;
  if (Array.isArray(valor)) return valor[0] || null;
  return valor;
}

function formatearFecha(fecha: string) {
  return new Date(fecha).toLocaleString("es-ES");
}

function formatearOrigen(origen: string | null) {
  if (!origen) return "-";

  const mapa: Record<string, string> = {
    entrada_manual: "Entrada manual",
    traspaso_manual: "Traspaso manual",
    reposicion: "Reposición",
    montaje: "Montaje",
    ajuste_inventario: "Ajuste inventario",
  };

  return mapa[origen] || origen;
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

function textoMatricula(
  vehiculo:
    | {
        matricula: string;
        numero_vehiculo: string | null;
        marca: string | null;
        modelo: string | null;
      }
    | null
) {
  return vehiculo?.matricula || "-";
}

function textoNumeroVehiculo(
  vehiculo:
    | {
        matricula: string;
        numero_vehiculo: string | null;
        marca: string | null;
        modelo: string | null;
      }
    | null
) {
  return vehiculo?.numero_vehiculo || "-";
}

function textoMarcaModeloVehiculo(
  vehiculo:
    | {
        matricula: string;
        numero_vehiculo: string | null;
        marca: string | null;
        modelo: string | null;
      }
    | null
) {
  if (!vehiculo) return "-";

  const marcaModelo = `${vehiculo.marca || ""} ${vehiculo.modelo || ""}`.trim();

  return marcaModelo || "-";
}

function textoDocumento(movimiento: Movimiento) {
  if (!movimiento.documento_tipo && !movimiento.documento_numero) return "-";

  return `${movimiento.documento_tipo || "-"} ${
    movimiento.documento_numero || ""
  }`;
}

async function abrirPdfDocumento(ruta: string) {
  try {
    const rutaLimpia = String(ruta || "").trim();

    if (!rutaLimpia) {
      alert("No hay ruta de PDF guardada para este movimiento.");
      return;
    }

    const { data, error } = await supabase.storage
      .from("almacen-documentos")
      .createSignedUrl(rutaLimpia, 600);

    if (error) {
      console.error("Error generando URL firmada del PDF:", error);
      alert(`Error abriendo PDF: ${error.message}`);
      return;
    }

    if (!data?.signedUrl) {
      alert("No se pudo generar la URL del PDF.");
      return;
    }

    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  } catch (error) {
    console.error("Error inesperado abriendo PDF:", error);
    alert("Error inesperado abriendo el PDF.");
  }
}

function fechaHastaFinDia(fecha: string) {
  return `${fecha}T23:59:59`;
}

export default function HistorialMovimientos() {
  const [movimientos, setMovimientos] = useState<Movimiento[]>([]);
  const [mensaje, setMensaje] = useState("");
  const [cargando, setCargando] = useState(false);

  const [fechaDesde, setFechaDesde] = useState("");
  const [fechaHasta, setFechaHasta] = useState("");
  const [filtroTipo, setFiltroTipo] = useState("");
  const [filtroOrigen, setFiltroOrigen] = useState("");
  const [filtroTexto, setFiltroTexto] = useState("");
  const [filtroMatricula, setFiltroMatricula] = useState("");
  const [filtroNumeroVehiculo, setFiltroNumeroVehiculo] = useState("");

  useEffect(() => {
    cargarMovimientos();
  }, []);

  async function cargarMovimientos() {
    setMensaje("");
    setCargando(true);

    let query = supabase
      .from("movimientos_stock")
      .select(`
        id,
        created_at,
        tipo,
        cantidad,
        ubicacion,
        documento_tipo,
        documento_numero,
        observaciones,
        documento_adjunto_url,
        documento_adjunto_nombre,
        origen_movimiento,
        traspaso_id,
        solicitud_reposicion_id,
        clientes (
          nombre
        ),
        productos_neumaticos (
          marca,
          modelo,
          medida,
          dot
        ),
        vehiculos (
          matricula,
          numero_vehiculo,
          marca,
          modelo
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

    if (filtroTipo) {
      query = query.eq("tipo", filtroTipo);
    }

    if (filtroOrigen) {
      query = query.eq("origen_movimiento", filtroOrigen);
    }

    const { data, error } = await query;

    setCargando(false);

    if (error) {
      setMensaje(`Error: ${error.message}`);
      return;
    }

    setMovimientos((data || []) as unknown as Movimiento[]);
  }

  function limpiarFiltros() {
    setFechaDesde("");
    setFechaHasta("");
    setFiltroTipo("");
    setFiltroOrigen("");
    setFiltroTexto("");
    setFiltroMatricula("");
    setFiltroNumeroVehiculo("");
  }

  const movimientosFiltrados = movimientos.filter((movimiento) => {
    const cliente = obtenerPrimero(movimiento.clientes);
    const producto = obtenerPrimero(movimiento.productos_neumaticos);
    const vehiculo = obtenerPrimero(movimiento.vehiculos);

    if (
      filtroMatricula.trim() &&
      !textoMatricula(vehiculo)
        .toLowerCase()
        .includes(filtroMatricula.trim().toLowerCase())
    ) {
      return false;
    }

    if (
      filtroNumeroVehiculo.trim() &&
      !textoNumeroVehiculo(vehiculo)
        .toLowerCase()
        .includes(filtroNumeroVehiculo.trim().toLowerCase())
    ) {
      return false;
    }

    if (!filtroTexto.trim()) return true;

    const texto = [
      movimiento.tipo,
      formatearOrigen(movimiento.origen_movimiento),
      cliente?.nombre || "",
      textoProducto(producto),
      movimiento.ubicacion || "",
      textoMatricula(vehiculo),
      textoNumeroVehiculo(vehiculo),
      textoMarcaModeloVehiculo(vehiculo),
      textoDocumento(movimiento),
      movimiento.observaciones || "",
      movimiento.traspaso_id || "",
      movimiento.solicitud_reposicion_id || "",
    ]
      .join(" ")
      .toLowerCase();

    return texto.includes(filtroTexto.trim().toLowerCase());
  });

  function filasExportacionHistorial(): FilaExportacion[] {
    return movimientosFiltrados.map((movimiento) => {
      const cliente = obtenerPrimero(movimiento.clientes);
      const producto = obtenerPrimero(movimiento.productos_neumaticos);
      const vehiculo = obtenerPrimero(movimiento.vehiculos);

      return {
        movimiento_id: movimiento.id,
        fecha: movimiento.created_at,
        tipo: movimiento.tipo,
        origen: formatearOrigen(movimiento.origen_movimiento),
        cliente: cliente?.nombre || "-",
        producto: textoProducto(producto),
        cantidad: movimiento.cantidad,
        ubicacion: movimiento.ubicacion || "-",
        matricula: textoMatricula(vehiculo),
        numero_vehiculo: textoNumeroVehiculo(vehiculo),
        marca_modelo_vehiculo: textoMarcaModeloVehiculo(vehiculo),
        documento: textoDocumento(movimiento),
        documento_tipo: movimiento.documento_tipo || "",
        documento_numero: movimiento.documento_numero || "",
        documento_adjunto_nombre: movimiento.documento_adjunto_nombre || "",
        documento_adjunto_url: movimiento.documento_adjunto_url || "",
        observaciones: movimiento.observaciones || "",
        origen_movimiento: movimiento.origen_movimiento || "",
        traspaso_id: movimiento.traspaso_id || "",
        solicitud_reposicion_id: movimiento.solicitud_reposicion_id || "",
      };
    });
  }

  function exportarHistorialCsv() {
    const filas = filasExportacionHistorial();

    if (filas.length === 0) {
      setMensaje("No hay movimientos para exportar.");
      return;
    }

    exportarCsv("historial-movimientos", filas);
  }

  async function exportarHistorialExcel() {
    const filas = filasExportacionHistorial();

    if (filas.length === 0) {
      setMensaje("No hay movimientos para exportar.");
      return;
    }

    await exportarExcel("historial-movimientos", "Historial", filas);
  }

  return (
    <div className="p-6 space-y-6">
      <AlmacenMenu />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Historial de movimientos</h1>
          <p className="text-sm text-gray-500">
            Trazabilidad completa de entradas, salidas, montajes, traspasos,
            reposiciones y ajustes. Se cargan los últimos 200 movimientos según
            filtros.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={exportarHistorialCsv}
            className="rounded-xl border px-4 py-2 text-sm font-semibold disabled:opacity-50"
            disabled={movimientosFiltrados.length === 0}
          >
            Exportar CSV
          </button>

          <button
            type="button"
            onClick={exportarHistorialExcel}
            className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            disabled={movimientosFiltrados.length === 0}
          >
            Exportar Excel
          </button>
        </div>
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
            value={filtroTipo}
            onChange={(e) => setFiltroTipo(e.target.value)}
            className="rounded-lg border px-3 py-2 text-sm"
          >
            <option value="">Todos los tipos</option>
            <option value="ENTRADA">ENTRADA</option>
            <option value="SALIDA">SALIDA</option>
          </select>

          <select
            value={filtroOrigen}
            onChange={(e) => setFiltroOrigen(e.target.value)}
            className="rounded-lg border px-3 py-2 text-sm"
          >
            <option value="">Todos los orígenes</option>
            {ORIGENES.map((origen) => (
              <option key={origen.valor} value={origen.valor}>
                {origen.texto}
              </option>
            ))}
          </select>

          <input
            value={filtroMatricula}
            onChange={(e) => setFiltroMatricula(e.target.value)}
            placeholder="Filtrar por matrícula"
            className="rounded-lg border px-3 py-2 text-sm"
          />

          <input
            value={filtroNumeroVehiculo}
            onChange={(e) => setFiltroNumeroVehiculo(e.target.value)}
            placeholder="Filtrar por Nº vehículo"
            className="rounded-lg border px-3 py-2 text-sm"
          />

          <input
            value={filtroTexto}
            onChange={(e) => setFiltroTexto(e.target.value)}
            placeholder="Buscar cliente, producto, documento..."
            className="rounded-lg border px-3 py-2 text-sm md:col-span-2"
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={cargarMovimientos}
            className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white"
          >
            {cargando ? "Buscando..." : "Buscar"}
          </button>

          <button
            type="button"
            onClick={limpiarFiltros}
            className="rounded-xl border px-4 py-2 text-sm font-semibold"
          >
            Limpiar filtros
          </button>
        </div>
      </div>

      {mensaje && <p className="text-sm text-red-600">{mensaje}</p>}

      <div className="rounded-xl border bg-white p-3 text-sm text-gray-600">
        Mostrando <strong>{movimientosFiltrados.length}</strong> movimientos de{" "}
        <strong>{movimientos.length}</strong> cargados.
      </div>

      <div className="overflow-auto rounded-xl border bg-white">
        <table className="w-full min-w-[1400px] text-sm">
          <thead className="bg-gray-50 text-left">
            <tr>
              <th className="p-3">Fecha</th>
              <th className="p-3">Tipo</th>
              <th className="p-3">Origen</th>
              <th className="p-3">Cliente</th>
              <th className="p-3">Producto</th>
              <th className="p-3">Cantidad</th>
              <th className="p-3">Ubicación</th>
              <th className="p-3">Matrícula</th>
              <th className="p-3">Nº vehículo</th>
              <th className="p-3">Marca / modelo</th>
              <th className="p-3">Documento</th>
              <th className="p-3">PDF</th>
              <th className="p-3">Observaciones</th>
            </tr>
          </thead>

          <tbody>
            {movimientosFiltrados.map((movimiento) => {
              const cliente = obtenerPrimero(movimiento.clientes);
              const producto = obtenerPrimero(movimiento.productos_neumaticos);
              const vehiculo = obtenerPrimero(movimiento.vehiculos);

              return (
                <tr key={movimiento.id} className="border-t align-top">
                  <td className="p-3">
                    {formatearFecha(movimiento.created_at)}
                  </td>

                  <td className="p-3 font-medium">{movimiento.tipo}</td>

                  <td className="p-3">
                    <div className="text-sm font-medium">
                      {formatearOrigen(movimiento.origen_movimiento)}
                    </div>

                    {movimiento.traspaso_id && (
                      <div className="text-xs text-gray-500">
                        Traspaso asociado
                      </div>
                    )}

                    {movimiento.solicitud_reposicion_id && (
                      <div className="text-xs text-blue-700">
                        Solicitud reposición
                      </div>
                    )}
                  </td>

                  <td className="p-3">{cliente?.nombre || "-"}</td>
                  <td className="p-3">{textoProducto(producto)}</td>
                  <td className="p-3">{movimiento.cantidad}</td>
                  <td className="p-3">{movimiento.ubicacion || "-"}</td>
                  <td className="p-3">{textoMatricula(vehiculo)}</td>
                  <td className="p-3">{textoNumeroVehiculo(vehiculo)}</td>
                  <td className="p-3">
                    {textoMarcaModeloVehiculo(vehiculo)}
                  </td>
                  <td className="p-3">{textoDocumento(movimiento)}</td>

                  <td className="p-3">
                    {movimiento.documento_adjunto_url ? (
                      <button
                        type="button"
                        onClick={() =>
                          abrirPdfDocumento(movimiento.documento_adjunto_url as string)
                        }
                        className="rounded-lg border px-2 py-1 text-xs font-semibold hover:bg-gray-50"
                        title={movimiento.documento_adjunto_nombre || "Ver PDF"}
                      >
                        📄 Ver PDF
                      </button>
                    ) : (
                      "-"
                    )}
                  </td>

                  <td className="p-3">{movimiento.observaciones || "-"}</td>
                </tr>
              );
            })}

            {movimientosFiltrados.length === 0 && (
              <tr>
                <td colSpan={13} className="p-6 text-center text-gray-500">
                  No hay movimientos con los filtros actuales.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <button
        type="button"
        onClick={cargarMovimientos}
        className="rounded-xl border px-4 py-2 text-sm font-semibold"
      >
        Actualizar historial
      </button>
    </div>
  );
}