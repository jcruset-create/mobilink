import { useEffect, useState } from "react";
import AlmacenMenu from "../components/AlmacenMenu";
import { supabase } from "../services/supabase";
import {
  exportarCsv,
  exportarExcel,
  type FilaExportacion,
} from "../services/exportAlmacen";

type Cliente = {
  id: string;
  nombre: string;
  requiere_numero_vehiculo: boolean | null;
};

type Vehiculo = {
  id: string;
  cliente_id: string;
  matricula: string;
  numero_vehiculo: string | null;
  marca: string | null;
  modelo: string | null;
  activo: boolean;
  clientes:
    | {
        nombre: string;
      }
    | {
        nombre: string;
      }[]
    | null;
};

function obtenerPrimero<T>(valor: T | T[] | null): T | null {
  if (!valor) return null;
  if (Array.isArray(valor)) return valor[0] || null;
  return valor;
}

export default function VehiculosAlmacen() {
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [vehiculos, setVehiculos] = useState<Vehiculo[]>([]);

  const [clienteId, setClienteId] = useState("");
  const [matricula, setMatricula] = useState("");
  const [numeroVehiculo, setNumeroVehiculo] = useState("");
  const [marca, setMarca] = useState("");
  const [modelo, setModelo] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [mensaje, setMensaje] = useState("");

  useEffect(() => {
    cargarDatos();
  }, []);

  async function cargarDatos() {
    setMensaje("");

    const { data: clientesData, error: clientesError } = await supabase
      .from("clientes")
      .select("id,nombre,requiere_numero_vehiculo")
      .eq("activo", true)
      .order("nombre");

    if (clientesError) {
      setMensaje(`Error clientes: ${clientesError.message}`);
      return;
    }

    const { data: vehiculosData, error: vehiculosError } = await supabase
      .from("vehiculos")
      .select(`
        id,
        cliente_id,
        matricula,
        numero_vehiculo,
        marca,
        modelo,
        activo,
        clientes (
          nombre
        )
      `)
      .order("matricula");

    if (vehiculosError) {
      setMensaje(`Error vehículos: ${vehiculosError.message}`);
      return;
    }

    setClientes((clientesData || []) as Cliente[]);
    setVehiculos((vehiculosData || []) as unknown as Vehiculo[]);

    if (!clienteId && clientesData && clientesData.length > 0) {
      setClienteId(clientesData[0].id);
    }
  }

  function clienteSeleccionado() {
    return clientes.find((cliente) => cliente.id === clienteId) || null;
  }

  async function crearVehiculo() {
    setMensaje("");

    const cliente = clienteSeleccionado();

    if (!clienteId || !matricula.trim()) {
      setMensaje("Cliente y matrícula son obligatorios.");
      return;
    }

    if (cliente?.requiere_numero_vehiculo && !numeroVehiculo.trim()) {
      setMensaje("Este cliente requiere número de vehículo.");
      return;
    }

    const { error } = await supabase.from("vehiculos").insert({
      cliente_id: clienteId,
      matricula: matricula.trim().toUpperCase(),
      numero_vehiculo: numeroVehiculo.trim() || null,
      marca: marca.trim() || null,
      modelo: modelo.trim() || null,
      activo: true,
    });

    if (error) {
      setMensaje(`Error: ${error.message}`);
      return;
    }

    setMensaje("Vehículo creado correctamente.");
    setMatricula("");
    setNumeroVehiculo("");
    setMarca("");
    setModelo("");
    cargarDatos();
  }

  async function cambiarEstadoVehiculo(id: string, activo: boolean) {
    setMensaje("");

    const { error } = await supabase
      .from("vehiculos")
      .update({ activo: !activo })
      .eq("id", id);

    if (error) {
      setMensaje(`Error: ${error.message}`);
      return;
    }

    cargarDatos();
  }

  const vehiculosFiltrados = vehiculos.filter((vehiculo) => {
    const texto = [
      vehiculo.matricula,
      vehiculo.numero_vehiculo || "",
      vehiculo.marca || "",
      vehiculo.modelo || "",
      obtenerPrimero(vehiculo.clientes)?.nombre || "",
    ]
      .join(" ")
      .toLowerCase();

    return texto.includes(busqueda.toLowerCase());
  });

  function filasExportacionVehiculos(): FilaExportacion[] {
    return vehiculosFiltrados.map((vehiculo) => {
      const cliente = obtenerPrimero(vehiculo.clientes);

      return {
        vehiculo_id: vehiculo.id,
        cliente_id: vehiculo.cliente_id,
        cliente: cliente?.nombre || "-",
        matricula: vehiculo.matricula,
        numero_vehiculo: vehiculo.numero_vehiculo || "",
        marca: vehiculo.marca || "",
        modelo: vehiculo.modelo || "",
        estado: vehiculo.activo ? "Activo" : "Baja",
        activo: vehiculo.activo ? "Sí" : "No",
      };
    });
  }

  function exportarVehiculosCsv() {
    const filas = filasExportacionVehiculos();

    if (filas.length === 0) {
      setMensaje("No hay vehículos filtrados para exportar.");
      return;
    }

    exportarCsv("vehiculos-almacen", filas);
  }

  async function exportarVehiculosExcel() {
    const filas = filasExportacionVehiculos();

    if (filas.length === 0) {
      setMensaje("No hay vehículos filtrados para exportar.");
      return;
    }

    await exportarExcel("vehiculos-almacen", "Vehiculos", filas);
  }

  return (
    <div className="p-6 space-y-6">
      <AlmacenMenu />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Vehículos</h1>
          <p className="text-sm text-gray-500">
            Alta y consulta de vehículos por cliente.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={exportarVehiculosCsv}
            className="rounded-xl border px-4 py-2 text-sm font-semibold disabled:opacity-50"
            disabled={vehiculosFiltrados.length === 0}
          >
            Exportar CSV
          </button>

          <button
            type="button"
            onClick={exportarVehiculosExcel}
            className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            disabled={vehiculosFiltrados.length === 0}
          >
            Exportar Excel
          </button>
        </div>
      </div>

      <div className="rounded-xl border bg-white p-4 space-y-4">
        <select
          value={clienteId}
          onChange={(e) => setClienteId(e.target.value)}
          className="w-full rounded-lg border px-3 py-2 text-sm"
        >
          <option value="">Cliente...</option>
          {clientes.map((cliente) => (
            <option key={cliente.id} value={cliente.id}>
              {cliente.nombre}
            </option>
          ))}
        </select>

        <input
          value={matricula}
          onChange={(e) => setMatricula(e.target.value)}
          placeholder="Matrícula"
          className="w-full rounded-lg border px-3 py-2 text-sm"
        />

        <input
          value={numeroVehiculo}
          onChange={(e) => setNumeroVehiculo(e.target.value)}
          placeholder={
            clienteSeleccionado()?.requiere_numero_vehiculo
              ? "Número de vehículo obligatorio"
              : "Número de vehículo"
          }
          className="w-full rounded-lg border px-3 py-2 text-sm"
        />

        <input
          value={marca}
          onChange={(e) => setMarca(e.target.value)}
          placeholder="Marca"
          className="w-full rounded-lg border px-3 py-2 text-sm"
        />

        <input
          value={modelo}
          onChange={(e) => setModelo(e.target.value)}
          placeholder="Modelo"
          className="w-full rounded-lg border px-3 py-2 text-sm"
        />

        <button
          type="button"
          onClick={crearVehiculo}
          className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white"
        >
          Crear vehículo
        </button>

        {mensaje && <p className="text-sm text-gray-700">{mensaje}</p>}
      </div>

      <div className="rounded-xl border bg-white p-4">
        <input
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar por matrícula, número de vehículo, cliente, marca o modelo..."
          className="w-full rounded-lg border px-3 py-2 text-sm"
        />
      </div>

      <div className="overflow-hidden rounded-xl border bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left">
            <tr>
              <th className="p-3">Cliente</th>
              <th className="p-3">Matrícula</th>
              <th className="p-3">Nº vehículo</th>
              <th className="p-3">Marca</th>
              <th className="p-3">Modelo</th>
              <th className="p-3">Estado</th>
              <th className="p-3">Acción</th>
            </tr>
          </thead>

          <tbody>
            {vehiculosFiltrados.map((vehiculo) => {
              const cliente = obtenerPrimero(vehiculo.clientes);

              return (
                <tr key={vehiculo.id} className="border-t">
                  <td className="p-3 font-medium">{cliente?.nombre || "-"}</td>
                  <td className="p-3">{vehiculo.matricula}</td>
                  <td className="p-3">{vehiculo.numero_vehiculo || "-"}</td>
                  <td className="p-3">{vehiculo.marca || "-"}</td>
                  <td className="p-3">{vehiculo.modelo || "-"}</td>
                  <td className="p-3">
                    {vehiculo.activo ? "Activo" : "Baja"}
                  </td>
                  <td className="p-3">
                    <button
                      type="button"
                      onClick={() =>
                        cambiarEstadoVehiculo(vehiculo.id, vehiculo.activo)
                      }
                      className="rounded-lg border px-3 py-1 text-xs"
                    >
                      {vehiculo.activo ? "Dar de baja" : "Reactivar"}
                    </button>
                  </td>
                </tr>
              );
            })}

            {vehiculosFiltrados.length === 0 && (
              <tr>
                <td colSpan={7} className="p-6 text-center text-gray-500">
                  No hay vehículos.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}