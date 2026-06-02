import { useEffect, useState } from "react";
import AlmacenMenu from "../components/AlmacenMenu";
import { supabase } from "../services/supabase";
import {
  exportarCsv,
  exportarExcel,
  type FilaExportacion,
} from "../services/exportAlmacen";

type Empresa = {
  id: string;
  nombre: string;
};

export default function CentrosAlmacen() {
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [nombre, setNombre] = useState("");
  const [mensaje, setMensaje] = useState("");

  useEffect(() => {
    cargarDatos();
  }, []);

  async function cargarDatos() {
    setMensaje("");

    const { data, error } = await supabase
      .from("empresas")
      .select("id,nombre")
      .order("nombre");

    if (error) {
      setMensaje(`Error cargando centros/empresas: ${error.message}`);
      return;
    }

    setEmpresas((data || []) as Empresa[]);
  }

  async function crearEmpresa() {
    setMensaje("");

    if (!nombre.trim()) {
      setMensaje("El nombre del centro / empresa es obligatorio.");
      return;
    }

    const { error } = await supabase.from("empresas").insert({
      nombre: nombre.trim(),
    });

    if (error) {
      setMensaje(`Error creando centro / empresa: ${error.message}`);
      return;
    }

    setMensaje("Centro / empresa creado correctamente.");
    setNombre("");
    cargarDatos();
  }

  function filasExportacionCentros(): FilaExportacion[] {
    return empresas.map((empresa) => ({
      empresa_id: empresa.id,
      nombre: empresa.nombre,
    }));
  }

  function exportarCentrosCsv() {
    const filas = filasExportacionCentros();

    if (filas.length === 0) {
      setMensaje("No hay centros / empresas para exportar.");
      return;
    }

    exportarCsv("centros-empresas", filas);
  }

  async function exportarCentrosExcel() {
    const filas = filasExportacionCentros();

    if (filas.length === 0) {
      setMensaje("No hay centros / empresas para exportar.");
      return;
    }

    await exportarExcel("centros-empresas", "Centros", filas);
  }

  return (
    <div className="p-6 space-y-6">
      <AlmacenMenu />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Centros / Empresas</h1>
          <p className="text-sm text-gray-500">
            Gestión básica de centros o empresas del módulo de almacén.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={exportarCentrosCsv}
            className="rounded-xl border px-4 py-2 text-sm font-semibold disabled:opacity-50"
            disabled={empresas.length === 0}
          >
            Exportar CSV
          </button>

          <button
            type="button"
            onClick={exportarCentrosExcel}
            className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            disabled={empresas.length === 0}
          >
            Exportar Excel
          </button>
        </div>
      </div>

      <div className="rounded-xl border bg-white p-4 space-y-4">
        <h2 className="font-semibold">Crear centro / empresa</h2>

        <input
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          placeholder="Nombre del centro / empresa"
          className="w-full rounded-lg border px-3 py-2 text-sm"
        />

        <button
          type="button"
          onClick={crearEmpresa}
          className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white"
        >
          Crear centro / empresa
        </button>

        {mensaje && <p className="text-sm text-gray-700">{mensaje}</p>}
      </div>

      <div className="overflow-hidden rounded-xl border bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left">
            <tr>
              <th className="p-3">Nombre</th>
              <th className="p-3">ID</th>
            </tr>
          </thead>

          <tbody>
            {empresas.map((empresa) => (
              <tr key={empresa.id} className="border-t">
                <td className="p-3 font-medium">{empresa.nombre}</td>
                <td className="p-3 text-xs text-gray-500">{empresa.id}</td>
              </tr>
            ))}

            {empresas.length === 0 && (
              <tr>
                <td colSpan={2} className="p-6 text-center text-gray-500">
                  No hay centros / empresas creados.
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
        Actualizar centros / empresas
      </button>
    </div>
  );
}