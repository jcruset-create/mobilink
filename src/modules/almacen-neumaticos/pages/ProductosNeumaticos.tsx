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
  referencia_neumatico_id: string | null;
};

type CatMarca = { id: string; nombre: string };
type CatModelo = { id: string; nombre: string; marca_id: string };
type CatReferencia = { id: string; modelo_id: string; referencia_completa: string };

type FichaReferencia = {
  id: string;
  profundidad_dibujo_mm: number | null;
  llanta_recomendada: string | null;
  diametro_exterior_mm: number | null;
  revoluciones_km: number | null;
  carga_maxima_kg: number | null;
  presion_maxima_bar: number | null;
  peso_kg: number | null;
  ply: number | null;
  ancho_seccion_mm: number | null;
  anchura_rodadura_mm: number | null;
  radio_carga_mm: number | null;
  etiqueta_rr: string | null;
  etiqueta_grip_humedo: string | null;
  etiqueta_ruido_db: number | null;
  etiqueta_ruido_clase: string | null;
  modelo: {
    nombre: string;
    gama: string | null;
    eje_recomendado: string | null;
    aplicacion: string | null;
    m_s: boolean | null;
    tres_pmsf: boolean | null;
    foto_modelo_url: string | null;
    marca: { nombre: string } | null;
  } | null;
  tyre_size: {
    medida: string;
    indice_carga_simple: string;
    indice_carga_doble: string | null;
    codigo_velocidad: string;
  } | null;
};

const FICHA_SELECT = `
  id, profundidad_dibujo_mm, llanta_recomendada, diametro_exterior_mm, revoluciones_km,
  carga_maxima_kg, presion_maxima_bar, peso_kg, ply, ancho_seccion_mm, anchura_rodadura_mm,
  radio_carga_mm, etiqueta_rr, etiqueta_grip_humedo, etiqueta_ruido_db, etiqueta_ruido_clase,
  modelo:tc_cat_modelos_neumatico(nombre, gama, eje_recomendado, aplicacion, m_s, tres_pmsf, foto_modelo_url, marca:tc_cat_marcas_neumatico(nombre)),
  tyre_size:tyre_sizes(medida, indice_carga_simple, indice_carga_doble, codigo_velocidad)
`;

export default function ProductosNeumaticos() {
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [catMarcas, setCatMarcas] = useState<CatMarca[]>([]);
  const [catModelos, setCatModelos] = useState<CatModelo[]>([]);
  const [catReferencias, setCatReferencias] = useState<CatReferencia[]>([]);

  const [empresaId, setEmpresaId] = useState("");
  const [marcaId, setMarcaId] = useState("");
  const [modeloId, setModeloId] = useState("");
  const [referenciaId, setReferenciaId] = useState("");
  const [dot, setDot] = useState("");
  const [mensaje, setMensaje] = useState("");
  const [ficha, setFicha] = useState<FichaReferencia | null>(null);
  const [cargandoFicha, setCargandoFicha] = useState(false);

  useEffect(() => {
    void inicializar();
  }, []);

  async function inicializar() {
    const [{ marcas }, empresasFinales] = await Promise.all([
      cargarCatalogosCompartidos(),
      cargarDatos(),
    ]);
    aplicarParametrosOCR(empresasFinales, marcas);
  }

  // Catálogo compartido con TyreControl: solo se pueden dar de alta productos
  // que sean una referencia exacta ya existente (modelo + medida + índice de
  // carga/velocidad), para que las dos apps hablen siempre de los mismos
  // neumáticos y se pueda abrir la misma ficha técnica desde el almacén.
  async function cargarCatalogosCompartidos() {
    const [{ data: marcasData }, { data: modelosData }, { data: referenciasData }] = await Promise.all([
      supabase.from("tc_cat_marcas_neumatico").select("id,nombre").eq("activo", true).order("nombre"),
      supabase.from("tc_cat_modelos_neumatico").select("id,nombre,marca_id").eq("activo", true).order("nombre"),
      supabase.from("tc_referencias_neumatico").select("id,modelo_id,referencia_completa,tyre_size:tyre_sizes(referencia_completa)").eq("activo", true),
    ]);
    const marcas = (marcasData || []) as CatMarca[];
    const modelos = (modelosData || []) as CatModelo[];
    const referencias = ((referenciasData || []) as any[]).map((r) => ({
      id: r.id, modelo_id: r.modelo_id, referencia_completa: r.tyre_size?.referencia_completa || r.referencia_completa,
    })) as CatReferencia[];
    setCatMarcas(marcas);
    setCatModelos(modelos);
    setCatReferencias(referencias);
    return { marcas, modelos, referencias };
  }

  function separarProductoOCR(texto: string | null) {
    const valor = String(texto || "").trim();
    const medidaMatch = valor.match(/\d{3}\/\d{2}[RXx]?\d{2}(?:\.\d)?/i);
    const medidaOriginal = medidaMatch?.[0] || "";
    const resto = medidaOriginal ? valor.replace(medidaOriginal, "").trim() : valor;
    const partes = resto.split(/\s+/).filter(Boolean);
    return { marca: partes[0] || "" };
  }

  // Intenta preseleccionar la marca del catálogo a partir del texto leído por
  // OCR. El modelo y la referencia exacta (medida + índice de carga/velocidad)
  // hay que elegirlos siempre a mano, porque el texto del OCR no suele traer
  // el índice de carga con fiabilidad.
  function aplicarParametrosOCR(empresasDisponibles: Empresa[], marcas: CatMarca[]) {
    const params = new URLSearchParams(window.location.search);
    if (params.get("nuevo") !== "1") return;

    const productoParam = params.get("producto") || "";
    const empresaParam = params.get("empresa_id") || "";
    const datos = separarProductoOCR(productoParam);

    if (empresaParam) {
      setEmpresaId(empresaParam);
    } else if (empresasDisponibles.length > 0) {
      setEmpresaId(empresasDisponibles[0].id);
    }

    const marcaEncontrada = marcas.find((m) => m.nombre.toLowerCase() === datos.marca.toLowerCase());
    setMarcaId(marcaEncontrada?.id || "");
    setModeloId("");
    setReferenciaId("");
    setDot("");

    setMensaje(
      marcaEncontrada
        ? `Producto importado desde OCR: ${productoParam}. Marca detectada: ${marcaEncontrada.nombre}. Elige el modelo y la medida exacta del catálogo.`
        : `Producto importado desde OCR: ${productoParam}. No se encontró la marca en el catálogo; añádela en TyreControl → Configuración o selecciónala manualmente si ya existe con otro nombre.`
    );

    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function cargarDatos() {
    const { data: empresasData } = await supabase
      .from("empresas")
      .select("id,nombre")
      .order("nombre");

    const { data: productosData } = await supabase
      .from("productos_neumaticos")
      .select("id,marca,modelo,medida,dot,activo,referencia_neumatico_id")
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
    const modeloSel = catModelos.find((m) => m.id === modeloId);
    const referenciaSel = catReferencias.find((r) => r.id === referenciaId);
    if (!empresaId || !marcaSel || !modeloSel || !referenciaSel) {
      setMensaje("Empresa, marca, modelo y medida son obligatorios (elígelos del catálogo).");
      return;
    }

    const { error } = await supabase.from("productos_neumaticos").insert({
      empresa_id: empresaId,
      marca: marcaSel.nombre,
      modelo: modeloSel.nombre,
      medida: referenciaSel.referencia_completa,
      referencia_neumatico_id: referenciaSel.id,
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
    setReferenciaId("");
    setDot("");
    cargarDatos();
  }

  async function verFicha(referenciaId: string | null) {
    if (!referenciaId) return;
    setCargandoFicha(true);
    try {
      const { data } = await supabase.from("tc_referencias_neumatico").select(FICHA_SELECT).eq("id", referenciaId).maybeSingle();
      setFicha((data as unknown as FichaReferencia) ?? null);
    } finally {
      setCargandoFicha(false);
    }
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
            onChange={(e) => { setMarcaId(e.target.value); setModeloId(""); setReferenciaId(""); }}
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
            onChange={(e) => { setModeloId(e.target.value); setReferenciaId(""); }}
            disabled={!marcaId}
            className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 disabled:opacity-50"
          >
            <option value="">Modelo del catálogo...</option>
            {catModelos.filter((m) => m.marca_id === marcaId).map((m) => <option key={m.id} value={m.id}>{m.nombre}</option>)}
          </select>

          <select
            value={referenciaId}
            onChange={(e) => setReferenciaId(e.target.value)}
            disabled={!modeloId}
            className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 disabled:opacity-50"
          >
            <option value="">Medida del catálogo...</option>
            {catReferencias.filter((r) => r.modelo_id === modeloId).map((r) => <option key={r.id} value={r.id}>{r.referencia_completa}</option>)}
          </select>
          {modeloId && catReferencias.filter((r) => r.modelo_id === modeloId).length === 0 && (
            <p className="text-[11px] text-amber-300">Este modelo no tiene medidas en el catálogo. Añádelas en TyreControl → Catálogo de neumáticos.</p>
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
                <th className="p-3 text-[11px] uppercase text-slate-400"></th>
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
                  <td className="p-3">
                    {producto.referencia_neumatico_id && (
                      <button
                        type="button"
                        onClick={() => verFicha(producto.referencia_neumatico_id)}
                        className="rounded border border-sky-600 px-2 py-1 text-[11px] font-semibold text-sky-300 hover:bg-sky-600/10"
                      >
                        Ficha
                      </button>
                    )}
                  </td>
                </tr>
              ))}

              {productos.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-6 text-center text-slate-500">
                    No hay productos creados.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {(ficha || cargandoFicha) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setFicha(null)}>
          <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-800 text-slate-100" onClick={(e) => e.stopPropagation()}>
            <div className="flex shrink-0 items-center justify-between border-b border-slate-700 px-4 py-3">
              <h3 className="text-sm font-bold">Ficha técnica</h3>
              <button onClick={() => setFicha(null)} className="rounded-lg p-1 text-slate-400 hover:bg-slate-700">✕</button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {cargandoFicha || !ficha ? (
                <div className="text-sm text-slate-500">Cargando…</div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-[140px_1fr]">
                  <div>
                    {ficha.modelo?.foto_modelo_url ? (
                      <img src={ficha.modelo.foto_modelo_url} alt={ficha.modelo.nombre} className="h-32 w-32 rounded-lg bg-white object-contain" />
                    ) : (
                      <div className="flex h-32 w-32 items-center justify-center rounded-lg bg-slate-900 text-center text-[10px] text-slate-500">Imagen no disponible</div>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <Dato label="Marca" v={ficha.modelo?.marca?.nombre} />
                    <Dato label="Modelo" v={ficha.modelo?.nombre} />
                    <Dato label="Gama" v={ficha.modelo?.gama} />
                    <Dato label="Medida" v={ficha.tyre_size?.medida} />
                    <Dato label="Índice carga" v={ficha.tyre_size ? (ficha.tyre_size.indice_carga_doble ? `${ficha.tyre_size.indice_carga_simple}/${ficha.tyre_size.indice_carga_doble}` : ficha.tyre_size.indice_carga_simple) : null} />
                    <Dato label="Código velocidad" v={ficha.tyre_size?.codigo_velocidad} />
                    <Dato label="Eje recomendado" v={ficha.modelo?.eje_recomendado} />
                    <Dato label="Aplicación" v={ficha.modelo?.aplicacion} />
                    <Dato label="M+S" v={ficha.modelo?.m_s ? "Sí" : "No"} />
                    <Dato label="3PMSF" v={ficha.modelo?.tres_pmsf ? "Sí" : "No"} />
                    <Dato label="Profundidad dibujo" v={ficha.profundidad_dibujo_mm != null ? `${ficha.profundidad_dibujo_mm} mm` : null} />
                    <Dato label="Llanta recomendada" v={ficha.llanta_recomendada} />
                    <Dato label="Diámetro exterior" v={ficha.diametro_exterior_mm != null ? `${ficha.diametro_exterior_mm} mm` : null} />
                    <Dato label="Carga máxima" v={ficha.carga_maxima_kg != null ? `${ficha.carga_maxima_kg} kg` : null} />
                    <Dato label="Presión máxima" v={ficha.presion_maxima_bar != null ? `${ficha.presion_maxima_bar} bar` : null} />
                    <Dato label="Peso" v={ficha.peso_kg != null ? `${ficha.peso_kg} kg` : null} />
                    <Dato label="Ply" v={ficha.ply} />
                    <Dato label="Resistencia rodadura (UE)" v={ficha.etiqueta_rr} />
                    <Dato label="Agarre en mojado (UE)" v={ficha.etiqueta_grip_humedo} />
                    <Dato label="Ruido exterior (UE)" v={ficha.etiqueta_ruido_db != null ? `${ficha.etiqueta_ruido_db} dB` : null} />
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </AlmacenLayoutOscuro>
  );
}

function Dato({ label, v }: { label: string; v?: string | number | null }) {
  return (
    <div>
      <div className="text-[10px] text-slate-400">{label}</div>
      <div className="text-slate-200">{v ?? "—"}</div>
    </div>
  );
}
