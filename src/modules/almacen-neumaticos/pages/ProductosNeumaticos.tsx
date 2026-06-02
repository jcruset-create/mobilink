import { useEffect, useState } from "react";
import AlmacenMenu from "../components/AlmacenMenu";
import { supabase } from "../services/supabase";
import {
  exportarCsv,
  exportarExcel,
  type FilaExportacion,
} from "../services/exportAlmacen";

type Empresa = { id: string; nombre: string };

type Producto = {
  id: string;
  marca: string;
  modelo: string | null;
  medida: string;
  dot: string | null;
  activo: boolean;
};

export default function ProductosNeumaticos() {
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [productos, setProductos] = useState<Producto[]>([]);

  const [empresaId, setEmpresaId] = useState("");
  const [marca, setMarca] = useState("");
  const [modelo, setModelo] = useState("");
  const [medida, setMedida] = useState("");
  const [dot, setDot] = useState("");
  const [mensaje, setMensaje] = useState("");

  useEffect(() => {
    cargarDatos();
  }, []);

  function normalizarMedida(valor: string) {
    return valor
      .trim()
      .replace(/x/i, "R")
      .replace(/\s+/g, "")
      .toUpperCase();
  }

  function separarProductoOCR(texto: string | null) {
    const valor = String(texto || "").trim();

    const medidaMatch = valor.match(/\d{3}\/\d{2}[RXx]?\d{2}(?:\.\d)?/i);
    const medidaOriginal = medidaMatch?.[0] || "";
    const medidaDetectada = medidaOriginal ? normalizarMedida(medidaOriginal) : "";

    const resto = medidaOriginal
      ? valor.replace(medidaOriginal, "").trim()
      : valor;

    const partes = resto.split(/\s+/).filter(Boolean);

    return {
      medida: medidaDetectada || "",
      marca: partes[0] || "",
      modelo: partes.slice(1).join(" ") || "",
    };
  }

  function aplicarParametrosOCR(empresasDisponibles: Empresa[]) {
    const params = new URLSearchParams(window.location.search);

    if (params.get("nuevo") !== "1") {
      return;
    }

    const productoParam = params.get("producto") || "";
    const empresaParam = params.get("empresa_id") || "";
    const datos = separarProductoOCR(productoParam);

    if (empresaParam) {
      setEmpresaId(empresaParam);
    } else if (empresasDisponibles.length > 0) {
      setEmpresaId(empresasDisponibles[0].id);
    }

    setMedida(datos.medida);
    setMarca(datos.marca);
    setModelo(datos.modelo);
    setDot("");

    setMensaje(
      `Producto importado desde OCR: ${productoParam}. Revisa los datos y pulsa Crear producto.`
    );

    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  }

  async function cargarDatos() {
    const { data: empresasData } = await supabase
      .from("empresas")
      .select("id,nombre")
      .order("nombre");

    const { data: productosData } = await supabase
      .from("productos_neumaticos")
      .select("id,marca,modelo,medida,dot,activo")
      .order("medida");

    const empresasFinales = (empresasData || []) as Empresa[];

    setEmpresas(empresasFinales);
    setProductos((productosData || []) as Producto[]);

    if (!empresaId && empresasFinales.length > 0) {
      setEmpresaId(empresasFinales[0].id);
    }

    aplicarParametrosOCR(empresasFinales);
  }

  async function crearProducto() {
    setMensaje("");

    if (!empresaId || !marca.trim() || !medida.trim()) {
      setMensaje("Empresa, marca y medida son obligatorios.");
      return;
    }

    const { error } = await supabase.from("productos_neumaticos").insert({
      empresa_id: empresaId,
      marca: marca.trim(),
      modelo: modelo.trim() || null,
      medida: normalizarMedida(medida),
      dot: dot.trim() || null,
      activo: true,
    });

    if (error) {
      setMensaje(`Error: ${error.message}`);
      return;
    }

    setMensaje("Producto creado correctamente. Puedes volver a Entradas y leer de nuevo el OCR.");
    setMarca("");
    setModelo("");
    setMedida("");
    setDot("");
    cargarDatos();
  }

  function filasExportacionProductos(): FilaExportacion[] {
    return productos.map((producto) => ({
      producto_id: producto.id,
      medida: producto.medida,
      marca: producto.marca,
      modelo: producto.modelo || "",
      dot: producto.dot || "",
      estado: producto.activo ? "Activo" : "Baja",
      activo: producto.activo ? "Sí" : "No",
    }));
  }

  function exportarProductosCsv() {
    const filas = filasExportacionProductos();

    if (filas.length === 0) {
      setMensaje("No hay productos para exportar.");
      return;
    }

    exportarCsv("productos-neumaticos", filas);
  }

  async function exportarProductosExcel() {
    const filas = filasExportacionProductos();

    if (filas.length === 0) {
      setMensaje("No hay productos para exportar.");
      return;
    }

    await exportarExcel("productos-neumaticos", "Productos", filas);
  }

  return (
    <div className="p-6 space-y-6">
      <AlmacenMenu />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Productos / Neumáticos</h1>
          <p className="text-sm text-gray-500">
            Alta básica de productos del almacén.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={exportarProductosCsv}
            className="rounded-xl border px-4 py-2 text-sm font-semibold disabled:opacity-50"
            disabled={productos.length === 0}
          >
            Exportar CSV
          </button>

          <button
            type="button"
            onClick={exportarProductosExcel}
            className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            disabled={productos.length === 0}
          >
            Exportar Excel
          </button>
        </div>
      </div>

      {mensaje && <p className="text-sm text-gray-700">{mensaje}</p>}

      <div className="rounded-xl border bg-white p-4 space-y-4">
        <select
          value={empresaId}
          onChange={(e) => setEmpresaId(e.target.value)}
          className="w-full rounded-lg border px-3 py-2 text-sm"
        >
          <option value="">Empresa...</option>
          {empresas.map((empresa) => (
            <option key={empresa.id} value={empresa.id}>
              {empresa.nombre}
            </option>
          ))}
        </select>

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

        <input
          value={medida}
          onChange={(e) => setMedida(e.target.value)}
          placeholder="Medida, ejemplo 315/70R22.5"
          className="w-full rounded-lg border px-3 py-2 text-sm"
        />

        <input
          value={dot}
          onChange={(e) => setDot(e.target.value)}
          placeholder="DOT"
          className="w-full rounded-lg border px-3 py-2 text-sm"
        />

        <button
          type="button"
          onClick={crearProducto}
          className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white"
        >
          Crear producto
        </button>
      </div>

      <div className="overflow-hidden rounded-xl border bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left">
            <tr>
              <th className="p-3">Medida</th>
              <th className="p-3">Marca</th>
              <th className="p-3">Modelo</th>
              <th className="p-3">DOT</th>
              <th className="p-3">Estado</th>
            </tr>
          </thead>

          <tbody>
            {productos.map((producto) => (
              <tr key={producto.id} className="border-t">
                <td className="p-3 font-medium">{producto.medida}</td>
                <td className="p-3">{producto.marca}</td>
                <td className="p-3">{producto.modelo || "-"}</td>
                <td className="p-3">{producto.dot || "-"}</td>
                <td className="p-3">{producto.activo ? "Activo" : "Baja"}</td>
              </tr>
            ))}

            {productos.length === 0 && (
              <tr>
                <td colSpan={5} className="p-6 text-center text-gray-500">
                  No hay productos creados.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}