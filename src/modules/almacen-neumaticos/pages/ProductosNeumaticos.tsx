import { useEffect, useState } from "react";
import AlmacenLayoutOscuro from "../components/AlmacenLayoutOscuro";
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
  const [catMarcas, setCatMarcas] = useState<string[]>([]);
  const [catMedidas, setCatMedidas] = useState<string[]>([]);

  const [empresaId, setEmpresaId] = useState("");
  const [marca, setMarca] = useState("");
  const [modelo, setModelo] = useState("");
  const [medida, setMedida] = useState("");
  const [dot, setDot] = useState("");
  const [mensaje, setMensaje] = useState("");

  useEffect(() => {
    cargarDatos();
    cargarCatalogosCompartidos();
  }, []);

  // Catálogo compartido con TyreControl (tc_cat_marcas_neumatico / tc_cat_medidas_neumatico)
  // — solo lectura aquí, para sugerir valores ya usados y no duplicar nombres distintos
  // para lo mismo (ej. "Michelin" vs "MICHELIN").
  async function cargarCatalogosCompartidos() {
    const [{ data: marcasData }, { data: medidasData }] = await Promise.all([
      supabase.from("tc_cat_marcas_neumatico").select("nombre").eq("activo", true).order("nombre"),
      supabase.from("tc_cat_medidas_neumatico").select("valor").eq("activo", true).order("valor"),
    ]);
    setCatMarcas(((marcasData || []) as { nombre: string }[]).map((m) => m.nombre));
    setCatMedidas(((medidasData || []) as { valor: string }[]).map((m) => m.valor));
  }

  // Añade la marca/medida al catálogo compartido si es nueva (best-effort:
  // si falla por permisos no bloquea la creación del producto).
  async function sincronizarCatalogoCompartido(marcaValor: string, medidaValor: string) {
    try {
      if (marcaValor) await supabase.from("tc_cat_marcas_neumatico").upsert({ nombre: marcaValor }, { onConflict: "nombre" });
      if (medidaValor) await supabase.from("tc_cat_medidas_neumatico").upsert({ valor: medidaValor }, { onConflict: "valor" });
    } catch {
      // silencioso: es solo una sugerencia para el desplegable de TyreControl
    }
  }

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

    await sincronizarCatalogoCompartido(marca.trim(), normalizarMedida(medida));

    setMensaje("Producto creado correctamente. Puedes volver a Entradas y leer de nuevo el OCR.");
    setMarca("");
    setModelo("");
    setMedida("");
    setDot("");
    cargarDatos();
    cargarCatalogosCompartidos();
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
    <AlmacenLayoutOscuro>
      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-black">Productos / Neumáticos</h1>
            <p className="text-sm text-slate-400">Alta básica de productos del almacén.</p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={exportarProductosCsv}
              className="rounded-lg border border-slate-600 px-3 py-1.5 text-[12px] font-semibold text-slate-200 disabled:opacity-50"
              disabled={productos.length === 0}
            >
              Exportar CSV
            </button>

            <button
              type="button"
              onClick={exportarProductosExcel}
              className="rounded-lg bg-sky-600 px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-50"
              disabled={productos.length === 0}
            >
              Exportar Excel
            </button>
          </div>
        </div>

        {mensaje && <p className={`text-sm ${mensaje.startsWith("Error") ? "text-red-300" : "text-slate-300"}`}>{mensaje}</p>}

        <div className="rounded-lg bg-slate-800 p-3 space-y-2">
          <select
            value={empresaId}
            onChange={(e) => setEmpresaId(e.target.value)}
            className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100"
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
            list="catalogo-marcas"
            className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500"
          />
          <datalist id="catalogo-marcas">
            {catMarcas.map((m) => <option key={m} value={m} />)}
          </datalist>

          <input
            value={modelo}
            onChange={(e) => setModelo(e.target.value)}
            placeholder="Modelo"
            className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500"
          />

          <input
            value={medida}
            onChange={(e) => setMedida(e.target.value)}
            placeholder="Medida, ejemplo 315/70R22.5"
            list="catalogo-medidas"
            className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500"
          />
          <datalist id="catalogo-medidas">
            {catMedidas.map((m) => <option key={m} value={m} />)}
          </datalist>

          <input
            value={dot}
            onChange={(e) => setDot(e.target.value)}
            placeholder="DOT"
            className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500"
          />

          <button
            type="button"
            onClick={crearProducto}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-500"
          >
            + Crear producto
          </button>
        </div>

        <div className="overflow-hidden rounded-lg bg-slate-800">
          <table className="w-full text-sm">
            <thead className="bg-slate-900 text-left">
              <tr>
                <th className="p-3 text-[11px] uppercase text-slate-400">Medida</th>
                <th className="p-3 text-[11px] uppercase text-slate-400">Marca</th>
                <th className="p-3 text-[11px] uppercase text-slate-400">Modelo</th>
                <th className="p-3 text-[11px] uppercase text-slate-400">DOT</th>
                <th className="p-3 text-[11px] uppercase text-slate-400">Estado</th>
              </tr>
            </thead>

            <tbody>
              {productos.map((producto) => (
                <tr key={producto.id} className="border-t border-slate-700/60">
                  <td className="p-3 font-semibold">{producto.medida}</td>
                  <td className="p-3 text-slate-300">{producto.marca}</td>
                  <td className="p-3 text-slate-300">{producto.modelo || "-"}</td>
                  <td className="p-3 text-slate-300">{producto.dot || "-"}</td>
                  <td className="p-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${producto.activo ? "bg-emerald-500/20 text-emerald-300" : "bg-slate-600 text-slate-300"}`}>
                      {producto.activo ? "Activo" : "Baja"}
                    </span>
                  </td>
                </tr>
              ))}

              {productos.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-6 text-center text-slate-500">
                    No hay productos creados.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </AlmacenLayoutOscuro>
  );
}