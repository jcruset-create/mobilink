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

type CatMarca = { id: string; nombre: string };
type CatModelo = { id: string; nombre: string; marca_id: string };
type CatMedida = { valor: string };

export default function ProductosNeumaticos() {
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [catMarcas, setCatMarcas] = useState<CatMarca[]>([]);
  const [catModelos, setCatModelos] = useState<CatModelo[]>([]);
  const [catMedidas, setCatMedidas] = useState<CatMedida[]>([]);

  const [empresaId, setEmpresaId] = useState("");
  const [marcaId, setMarcaId] = useState("");
  const [modeloId, setModeloId] = useState("");
  const [medida, setMedida] = useState("");
  const [dot, setDot] = useState("");
  const [mensaje, setMensaje] = useState("");

  useEffect(() => {
    void inicializar();
  }, []);

  async function inicializar() {
    const [{ marcas, medidas }, empresasFinales] = await Promise.all([
      cargarCatalogosCompartidos(),
      cargarDatos(),
    ]);
    aplicarParametrosOCR(empresasFinales, marcas, medidas);
  }

  // Catálogo compartido con TyreControl (tc_cat_marcas_neumatico / tc_cat_modelos_neumatico /
  // tc_cat_medidas_neumatico) — la marca/modelo/medida de un producto de almacén se eligen
  // SIEMPRE de aquí, para que los dos módulos hablen de los mismos neumáticos exactos y no
  // haya formatos distintos para lo mismo (ej. "295/80R22-5" vs "295/80 R22.5").
  async function cargarCatalogosCompartidos() {
    const [{ data: marcasData }, { data: modelosData }, { data: medidasData }] = await Promise.all([
      supabase.from("tc_cat_marcas_neumatico").select("id,nombre").eq("activo", true).order("nombre"),
      supabase.from("tc_cat_modelos_neumatico").select("id,nombre,marca_id").eq("activo", true).order("nombre"),
      supabase.from("tc_cat_medidas_neumatico").select("valor").eq("activo", true).order("valor"),
    ]);
    const marcas = (marcasData || []) as CatMarca[];
    const modelos = (modelosData || []) as CatModelo[];
    const medidas = (medidasData || []) as CatMedida[];
    setCatMarcas(marcas);
    setCatModelos(modelos);
    setCatMedidas(medidas);
    return { marcas, modelos, medidas };
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
    };
  }

  // Intenta preseleccionar marca/medida del catálogo a partir del texto leído por
  // OCR. Si no encuentra una coincidencia exacta, avisa en vez de dejar pasar un
  // valor libre: la marca/medida del catálogo debe existir antes de poder usarse
  // aquí (añádela en TyreControl → Configuración si es nueva).
  function aplicarParametrosOCR(empresasDisponibles: Empresa[], marcas: CatMarca[], medidas: CatMedida[]) {
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

    const marcaEncontrada = marcas.find((m) => m.nombre.toLowerCase() === datos.marca.toLowerCase());
    const medidaEncontrada = medidas.find((m) => m.valor.toUpperCase() === datos.medida.toUpperCase());
    setMarcaId(marcaEncontrada?.id || "");
    setModeloId("");
    setMedida(medidaEncontrada?.valor || "");
    setDot("");

    const faltantes = [!marcaEncontrada && datos.marca && `marca "${datos.marca}"`, !medidaEncontrada && datos.medida && `medida "${datos.medida}"`]
      .filter(Boolean).join(" y ");

    setMensaje(
      faltantes
        ? `Producto importado desde OCR: ${productoParam}. No se encontró en el catálogo la ${faltantes}; añádela en TyreControl → Configuración y vuelve a leer el OCR, o selecciónala manualmente si ya existe con otro nombre.`
        : `Producto importado desde OCR: ${productoParam}. Revisa los datos y pulsa Crear producto.`
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

    return empresasFinales;
  }

  async function crearProducto() {
    setMensaje("");

    const marcaSel = catMarcas.find((m) => m.id === marcaId);
    if (!empresaId || !marcaSel || !medida.trim()) {
      setMensaje("Empresa, marca y medida son obligatorios (elígelas del catálogo).");
      return;
    }
    const modeloSel = modeloId ? catModelos.find((m) => m.id === modeloId) : null;

    const { error } = await supabase.from("productos_neumaticos").insert({
      empresa_id: empresaId,
      marca: marcaSel.nombre,
      modelo: modeloSel?.nombre || null,
      medida,
      dot: dot.trim() || null,
      activo: true,
    });

    if (error) {
      setMensaje(`Error: ${error.message}`);
      return;
    }

    setMensaje("Producto creado correctamente. Puedes volver a Entradas y leer de nuevo el OCR.");
    setMarcaId("");
    setModeloId("");
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

          <select
            value={marcaId}
            onChange={(e) => { setMarcaId(e.target.value); setModeloId(""); }}
            className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100"
          >
            <option value="">Marca del catálogo...</option>
            {catMarcas.map((m) => <option key={m.id} value={m.id}>{m.nombre}</option>)}
          </select>
          {catMarcas.length === 0 && (
            <p className="text-[11px] text-amber-300">No hay marcas en el catálogo. Añádelas en TyreControl → Configuración.</p>
          )}

          <select
            value={modeloId}
            onChange={(e) => setModeloId(e.target.value)}
            disabled={!marcaId}
            className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 disabled:opacity-50"
          >
            <option value="">Modelo (opcional)...</option>
            {catModelos.filter((m) => m.marca_id === marcaId).map((m) => <option key={m.id} value={m.id}>{m.nombre}</option>)}
          </select>

          <select
            value={medida}
            onChange={(e) => setMedida(e.target.value)}
            className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100"
          >
            <option value="">Medida del catálogo...</option>
            {catMedidas.map((m) => <option key={m.valor} value={m.valor}>{m.valor}</option>)}
          </select>
          {catMedidas.length === 0 && (
            <p className="text-[11px] text-amber-300">No hay medidas en el catálogo. Añádelas en TyreControl → Medidas de neumáticos.</p>
          )}

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