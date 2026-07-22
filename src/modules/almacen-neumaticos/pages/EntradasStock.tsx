import { apiFetch } from "../../apiFetch";
import { useEffect, useState } from "react";
import AlmacenLayoutOscuro from "../components/AlmacenLayoutOscuro";
import { supabase } from "../services/supabase";
import { usePermisosAlmacen } from "../hooks/usePermisosAlmacen";
import {
  exportarCsv,
  exportarExcel,
  type FilaExportacion,
} from "../services/exportAlmacen";

type Empresa = {
  id: string;
  nombre: string;
};

type Cliente = {
  id: string;
  nombre: string;
  codigo?: string | null;
  empresa_id?: string | null;
};

type Producto = {
  id: string;
  marca: string;
  modelo: string | null;
  medida: string;
  dot: string | null;
};

type EntradaOCR = {
  pagina: number;
  albaran: string | null;
  fecha: string | null;
  codigoCliente: string | null;
  cliente: string | null;
  direccionCliente: string | null;
  producto: string | null;
  cantidad: number | null;
  ubicacion: string | null;
  estado:
    | "listo"
    | "duplicado"
    | "sin_cliente"
    | "sin_producto"
    | "sin_ubicacion"
    | "confirmado"
    | "error";
  confianza: "alta" | "media" | "baja";
  observaciones: string[];
  clienteIdDetectado?: string | null;
  productoIdDetectado?: string | null;
  ubicacionDetectada?: string | null;
};

const UBICACIONES_ENTRADA = [
  "Central Alicante",
  "Almacén Central Tarragona",
  "Base Reus",
  "Base Vilanova",
  "Taller Tarragona",
];

const BUCKET_DOCUMENTOS = "almacen-documentos";

export default function EntradasStock() {
  const { permisos, cargandoPermisos } = usePermisosAlmacen();

  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [productos, setProductos] = useState<Producto[]>([]);

  const [empresaId, setEmpresaId] = useState("");
  const [clienteId, setClienteId] = useState("");
  const [productoId, setProductoId] = useState("");
  const [cantidad, setCantidad] = useState("1");
  const [ubicacion, setUbicacion] = useState("");
  const [observaciones, setObservaciones] = useState("");
  const [archivoPdf, setArchivoPdf] = useState<File | null>(null);
  const [mensaje, setMensaje] = useState("");
  const [guardando, setGuardando] = useState(false);

  const [entradasOCR, setEntradasOCR] = useState<EntradaOCR[]>([]);
  const [leyendoOCR, setLeyendoOCR] = useState(false);

  const [filtroCliente, setFiltroCliente] = useState("");
  const [filtroProducto, setFiltroProducto] = useState("");
  const [filtroUbicacion, setFiltroUbicacion] = useState("");
  const [filtroTexto, setFiltroTexto] = useState("");

  useEffect(() => {
    cargarDatos();
  }, []);

  useEffect(() => {
    setClienteId("");
    limpiarFiltros();

    if (!permisos.esAdmin && permisos.ubicacion) {
      setUbicacion(permisos.ubicacion);
    }

    if (permisos.esAdmin) {
      setUbicacion("");
    }
  }, [permisos.perfil?.id]);

  async function cargarDatos() {
    setMensaje("");

    const { data: empresasData, error: empresasError } = await supabase
      .from("empresas")
      .select("id,nombre")
      .order("nombre");

    if (empresasError) {
      setMensaje(`Error empresas: ${empresasError.message}`);
      return;
    }

    const { data: clientesData, error: clientesError } = await supabase
      .from("clientes")
      .select("id,nombre,codigo,empresa_id")
      .eq("activo", true)
      .order("nombre");

    if (clientesError) {
      setMensaje(`Error clientes: ${clientesError.message}`);
      return;
    }

    const { data: productosData, error: productosError } = await supabase
      .from("productos_neumaticos")
      .select("id,marca,modelo,medida,dot")
      .eq("activo", true)
      .order("medida");

    if (productosError) {
      setMensaje(`Error productos: ${productosError.message}`);
      return;
    }

    setEmpresas((empresasData || []) as Empresa[]);
    setClientes((clientesData || []) as Cliente[]);
    setProductos((productosData || []) as Producto[]);

    if (!empresaId && empresasData && empresasData.length > 0) {
      setEmpresaId(empresasData[0].id);
    }
  }

  function limpiarFiltros() {
    setFiltroCliente("");
    setFiltroProducto("");
    setFiltroUbicacion("");
    setFiltroTexto("");
  }

  function codigoPerfil() {
    return permisos.perfil?.codigo_operario || "";
  }

  function usuarioPuedeCrearEntrada() {
    return permisos.esAdmin || permisos.esResponsable;
  }

  function usuarioPuedeUsarCliente(clienteSeleccionadoId: string) {
    if (!permisos.perfil) return false;
    if (permisos.esAdmin) return true;

    return permisos.clientesPermitidos.some(
      (cliente) => cliente.id === clienteSeleccionadoId
    );
  }

  function usuarioPuedeUsarUbicacion(ubicacionSeleccionada: string) {
    if (!permisos.perfil) return false;
    if (permisos.esAdmin) return true;
    if (!permisos.ubicacion) return false;

    return permisos.ubicacion === ubicacionSeleccionada;
  }

  function seleccionarArchivoPdf(file: File | null) {
    setMensaje("");
    setEntradasOCR([]);

    if (!file) {
      setArchivoPdf(null);
      return;
    }

    if (file.type !== "application/pdf") {
      setArchivoPdf(null);
      setMensaje("Solo se permiten documentos PDF.");
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      setArchivoPdf(null);
      setMensaje("El PDF no puede superar 10 MB.");
      return;
    }

    setArchivoPdf(file);
  }

  async function subirDocumentoPdf() {
    if (!archivoPdf) {
      return {
        ruta: null,
        nombre: null,
      };
    }

    const extension = archivoPdf.name.split(".").pop() || "pdf";
    const nombreSeguro = archivoPdf.name
      .replace(/\s+/g, "-")
      .replace(/[^a-zA-Z0-9._-]/g, "");

    const ruta = [
      "entradas",
      new Date().toISOString().slice(0, 10),
      `${Date.now()}-${Math.random().toString(36).slice(2)}-${
        nombreSeguro || `documento.${extension}`
      }`,
    ].join("/");

    const { error } = await supabase.storage
      .from(BUCKET_DOCUMENTOS)
      .upload(ruta, archivoPdf, {
        contentType: "application/pdf",
        upsert: false,
      });

    if (error) {
      throw new Error(`Error subiendo PDF: ${error.message}`);
    }

    return {
      ruta,
      nombre: archivoPdf.name,
    };
  }

  function extraerObservacion(campo: string) {
    const partes = observaciones.split("|").map((item) => item.trim());
    const encontrado = partes.find((item) =>
      item.toLowerCase().startsWith(`${campo.toLowerCase()}:`)
    );

    if (!encontrado) return null;

    return encontrado.slice(campo.length + 1).trim() || null;
  }

  async function crearEntrada() {
    setMensaje("");

    if (!permisos.perfil) {
      setMensaje("No hay perfil activo para el usuario conectado.");
      return;
    }

    if (!usuarioPuedeCrearEntrada()) {
      setMensaje("Solo admin o responsable pueden registrar entradas manuales.");
      return;
    }

    if (!empresaId || !clienteId || !productoId || !cantidad || !ubicacion) {
      setMensaje(
        "Empresa, cliente, producto, cantidad y ubicación son obligatorios."
      );
      return;
    }

    if (!usuarioPuedeUsarCliente(clienteId)) {
      setMensaje("No tienes permiso para registrar entradas de este cliente.");
      return;
    }

    if (!usuarioPuedeUsarUbicacion(ubicacion)) {
      setMensaje("No tienes permiso para registrar entradas en esta ubicación.");
      return;
    }

    const cantidadNumero = Number(cantidad);

    if (Number.isNaN(cantidadNumero) || cantidadNumero <= 0) {
      setMensaje("La cantidad debe ser mayor que 0.");
      return;
    }

    setGuardando(true);

    try {
      const documentoSubido = await subirDocumentoPdf();

      const documentoNumero = extraerObservacion("Albarán");
      const fechaDocumento = extraerObservacion("Fecha");
      const esOCR = observaciones.includes("Entrada detectada por OCR");

      const observacionFinal = [
        observaciones.trim(),
        `${esOCR ? "Entrada OCR" : "Entrada manual"} registrada por ${
          codigoPerfil() || "-"
        }`,
        documentoSubido.nombre
          ? `Documento adjunto: ${documentoSubido.nombre}`
          : "",
      ]
        .filter(Boolean)
        .join(" | ");

      const { error } = await supabase.from("movimientos_stock").insert({
        empresa_id: empresaId,
        cliente_id: clienteId,
        producto_id: productoId,
        tipo: "ENTRADA",
        cantidad: cantidadNumero,
        ubicacion,
        origen_movimiento: esOCR ? "ocr_pdf" : "entrada_manual",
        documento_tipo: "GENES",
        documento_numero: documentoNumero,
        fecha_documento: fechaDocumento,
        observaciones: observacionFinal,
        documento_adjunto_url: documentoSubido.ruta,
        documento_adjunto_nombre: documentoSubido.nombre,
      });

      if (error) {
        setMensaje(`Error: ${error.message}`);
        setGuardando(false);
        return;
      }

      setMensaje("Entrada registrada correctamente.");
      setClienteId("");
      setProductoId("");
      setCantidad("1");
      setObservaciones("");
      setArchivoPdf(null);
      setEntradasOCR([]);

      const inputArchivo = document.getElementById(
        "documento-pdf-entrada"
      ) as HTMLInputElement | null;

      if (inputArchivo) {
        inputArchivo.value = "";
      }

      if (permisos.esAdmin) {
        setUbicacion("");
      }

      cargarDatos();
    } catch (error) {
      setMensaje(
        error instanceof Error
          ? error.message
          : "Error registrando entrada con documento."
      );
    } finally {
      setGuardando(false);
    }
  }

  function textoProducto(producto: Producto) {
    return `${producto.medida} - ${producto.marca}${
      producto.modelo ? ` ${producto.modelo}` : ""
    }${producto.dot ? ` - DOT ${producto.dot}` : ""}`;
  }

  function normalizarBusqueda(valor: unknown) {
    return String(valor || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function buscarClienteOCR(entrada: EntradaOCR) {
    const codigo = normalizarBusqueda(entrada.codigoCliente);
    const nombre = normalizarBusqueda(entrada.cliente);

    if (codigo) {
      const porCodigo = clientes.find(
        (cliente) => normalizarBusqueda(cliente.codigo) === codigo
      );

      if (porCodigo) return porCodigo;
    }

    if (!nombre) return null;

    return (
      clientes.find((cliente) => normalizarBusqueda(cliente.nombre) === nombre) ||
      clientes.find((cliente) =>
        normalizarBusqueda(cliente.nombre).includes(nombre)
      ) ||
      clientes.find((cliente) =>
        nombre.includes(normalizarBusqueda(cliente.nombre))
      ) ||
      null
    );
  }

  function buscarProductoPorTexto(texto: string | null) {
    if (!texto) return null;

    const buscado = normalizarBusqueda(texto);

    return (
      productos.find(
        (producto) => normalizarBusqueda(textoProducto(producto)) === buscado
      ) ||
      productos.find((producto) =>
        normalizarBusqueda(textoProducto(producto)).includes(buscado)
      ) ||
      productos.find((producto) =>
        buscado.includes(normalizarBusqueda(producto.medida)) &&
        buscado.includes(normalizarBusqueda(producto.marca))
      ) ||
      null
    );
  }

  function resolverUbicacionOCR(valor: string | null) {
    if (!permisos.esAdmin && permisos.ubicacion) {
      return permisos.ubicacion;
    }

    if (!valor) return null;

    const buscada = normalizarBusqueda(valor);

    return (
      UBICACIONES_ENTRADA.find(
        (item) => normalizarBusqueda(item) === buscada
      ) ||
      UBICACIONES_ENTRADA.find((item) =>
        normalizarBusqueda(item).includes(buscada)
      ) ||
      null
    );
  }

  function prepararEntradaOCR(item: EntradaOCR): EntradaOCR {
    const clienteDetectado = buscarClienteOCR(item);
    const productoDetectado = buscarProductoPorTexto(item.producto);
    const ubicacionDetectada = resolverUbicacionOCR(item.ubicacion);

    let estado = item.estado || "listo";

    if (estado !== "duplicado") {
      if (!clienteDetectado) {
        estado = "sin_cliente";
      } else if (!productoDetectado) {
        estado = "sin_producto";
      } else if (!ubicacionDetectada) {
        estado = "sin_ubicacion";
      } else {
        estado = "listo";
      }
    }

    return {
      ...item,
      estado,
      clienteIdDetectado: clienteDetectado?.id || null,
      productoIdDetectado: productoDetectado?.id || null,
      ubicacionDetectada,
    };
  }

  async function importarPdfEntradaOCR() {
    setMensaje("");

    if (!archivoPdf) {
      setMensaje("Selecciona primero un PDF de entrada.");
      return;
    }

    setLeyendoOCR(true);

    try {
      const formData = new FormData();
      formData.append("albaran", archivoPdf);

      const response = await apiFetch("/api/almacen/leer-entrada-pdf", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();

      if (!data.success) {
        setMensaje(data.message || "No se pudo leer el PDF de entrada.");
        return;
      }

      const entradasPreparadas = ((data.entradas || []) as EntradaOCR[]).map(
        prepararEntradaOCR
      );

      setEntradasOCR(entradasPreparadas);
      setMensaje(
        `OCR completado. Entradas detectadas: ${entradasPreparadas.length}`
      );
    } catch (error) {
      setMensaje(
        error instanceof Error ? error.message : "Error leyendo el PDF con OCR."
      );
    } finally {
      setLeyendoOCR(false);
    }
  }

  function abrirClienteOCR(entrada: EntradaOCR) {
    const params = new URLSearchParams();

    params.set("nuevo", "1");
    params.set("codigo", entrada.codigoCliente || "");
    params.set("nombre", entrada.cliente || "");
    params.set("direccion", entrada.direccionCliente || "");
    params.set("empresa_id", empresaId || "");

    window.open(`/almacen-neumaticos/clientes?${params.toString()}`, "_blank");
  }

  function abrirProductoOCR(entrada: EntradaOCR) {
    const params = new URLSearchParams();

    params.set("nuevo", "1");
    params.set("producto", entrada.producto || "");

    window.open(`/almacen-neumaticos/productos?${params.toString()}`, "_blank");
  }

  function cargarEntradaOCRAlFormulario(entrada: EntradaOCR) {
    setMensaje("");

    if (entrada.estado === "duplicado") {
      setMensaje("No se puede cargar una entrada duplicada.");
      return;
    }

    if (!entrada.clienteIdDetectado) {
      setMensaje("Primero crea o valida el cliente y vuelve a leer el OCR.");
      return;
    }

    if (!entrada.productoIdDetectado) {
      setMensaje("Primero crea o valida el producto y vuelve a leer el OCR.");
      return;
    }

    setClienteId(entrada.clienteIdDetectado);
    setProductoId(entrada.productoIdDetectado);

    if (entrada.cantidad) {
      setCantidad(String(entrada.cantidad));
    }

    const ubicacionFinal =
      entrada.ubicacionDetectada ||
      entrada.ubicacion ||
      permisos.ubicacion ||
      "";

    if (ubicacionFinal) {
      setUbicacion(ubicacionFinal);
    }

    const observacionOCR = [
      "Entrada detectada por OCR",
      entrada.albaran ? `Albarán: ${entrada.albaran}` : "",
      entrada.fecha ? `Fecha: ${entrada.fecha}` : "",
      entrada.codigoCliente ? `Código cliente: ${entrada.codigoCliente}` : "",
      entrada.cliente ? `Cliente: ${entrada.cliente}` : "",
      entrada.direccionCliente
        ? `Dirección cliente: ${entrada.direccionCliente}`
        : "",
      entrada.producto ? `Producto OCR: ${entrada.producto}` : "",
      entrada.observaciones.length > 0
        ? `OCR observaciones: ${entrada.observaciones.join(", ")}`
        : "",
    ]
      .filter(Boolean)
      .join(" | ");

    setObservaciones(observacionOCR);

    setMensaje(
      ubicacionFinal
        ? "Entrada OCR cargada. Revisa los datos y pulsa Registrar entrada."
        : "Entrada OCR cargada. Falta seleccionar ubicación antes de registrar."
    );
  }

  function quitarEntradaOCR(index: number) {
    setEntradasOCR((actuales) => actuales.filter((_, i) => i !== index));
  }

  function claseEstadoOCR(estado: EntradaOCR["estado"]) {
    if (estado === "listo") return "bg-emerald-500/20 text-emerald-300";
    if (estado === "duplicado") return "bg-red-500/20 text-red-300";
    if (estado === "confirmado") return "bg-sky-500/20 text-sky-300";
    if (estado === "error") return "bg-red-500/20 text-red-300";
    return "bg-amber-500/20 text-amber-300";
  }

  const clientesVisibles = permisos.esAdmin
    ? clientes
    : clientes.filter((cliente) =>
        permisos.clientesPermitidos.some(
          (permitido) => permitido.id === cliente.id
        )
      );

  const ubicacionesVisibles = permisos.esAdmin
    ? UBICACIONES_ENTRADA
    : permisos.ubicacion
    ? [permisos.ubicacion]
    : [];

  const clientesFiltrados = clientesVisibles.filter((cliente) => {
    if (!filtroCliente.trim() && !filtroTexto.trim()) return true;

    const texto = [cliente.nombre, cliente.codigo].join(" ").toLowerCase();
    const filtroClienteOk =
      !filtroCliente.trim() ||
      texto.includes(filtroCliente.trim().toLowerCase());
    const filtroTextoOk =
      !filtroTexto.trim() || texto.includes(filtroTexto.trim().toLowerCase());

    return filtroClienteOk && filtroTextoOk;
  });

  const productosFiltrados = productos.filter((producto) => {
    const texto = textoProducto(producto).toLowerCase();

    if (
      filtroProducto.trim() &&
      !texto.includes(filtroProducto.trim().toLowerCase())
    ) {
      return false;
    }

    if (filtroTexto.trim() && !texto.includes(filtroTexto.trim().toLowerCase())) {
      return false;
    }

    return true;
  });

  const ubicacionesFiltradas = ubicacionesVisibles.filter((item) => {
    if (
      filtroUbicacion.trim() &&
      !item.toLowerCase().includes(filtroUbicacion.trim().toLowerCase())
    ) {
      return false;
    }

    if (
      filtroTexto.trim() &&
      !item.toLowerCase().includes(filtroTexto.trim().toLowerCase())
    ) {
      return false;
    }

    return true;
  });

  function filasExportacionEntradas(): FilaExportacion[] {
    return productosFiltrados.flatMap((producto) =>
      clientesFiltrados.flatMap((cliente) =>
        ubicacionesFiltradas.map((ubicacionItem) => ({
          cliente: cliente.nombre,
          producto: textoProducto(producto),
          ubicacion: ubicacionItem,
          empresa_id: empresaId,
          cliente_id: cliente.id,
          producto_id: producto.id,
        }))
      )
    );
  }

  function exportarEntradasCsv() {
    const filas = filasExportacionEntradas();

    if (filas.length === 0) {
      setMensaje("No hay datos filtrados para exportar.");
      return;
    }

    exportarCsv("entradas-stock-opciones", filas);
  }

  async function exportarEntradasExcel() {
    const filas = filasExportacionEntradas();

    if (filas.length === 0) {
      setMensaje("No hay datos filtrados para exportar.");
      return;
    }

    await exportarExcel("entradas-stock-opciones", "Entradas", filas);
  }

  if (cargandoPermisos) {
    return (
      <AlmacenLayoutOscuro>
        <div className="rounded-lg bg-slate-800 p-6 text-sm text-slate-400">
          Cargando permisos del usuario conectado...
        </div>
      </AlmacenLayoutOscuro>
    );
  }

  return (
    <AlmacenLayoutOscuro>
      <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-black">Entradas de stock</h1>
          <p className="text-sm text-slate-400">
            Registra entradas manuales de neumáticos con permisos del usuario
            conectado y documento PDF adjunto.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={exportarEntradasCsv}
            className="rounded-lg border border-slate-600 px-4 py-2 text-sm font-semibold text-slate-200 disabled:opacity-50"
            disabled={filasExportacionEntradas().length === 0}
          >
            Exportar CSV
          </button>

          <button
            type="button"
            onClick={exportarEntradasExcel}
            className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            disabled={filasExportacionEntradas().length === 0}
          >
            Exportar Excel
          </button>
        </div>
      </div>

      <div className="rounded-lg bg-slate-800 p-4 space-y-4">
        <h2 className="font-semibold">Filtros</h2>

        <div className="grid gap-3 md:grid-cols-4">
          <input
            value={filtroCliente}
            onChange={(e) => setFiltroCliente(e.target.value)}
            placeholder="Filtrar cliente"
            className="rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100"
          />

          <input
            value={filtroProducto}
            onChange={(e) => setFiltroProducto(e.target.value)}
            placeholder="Producto, medida, marca o DOT"
            className="rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100"
          />

          <input
            value={filtroUbicacion}
            onChange={(e) => setFiltroUbicacion(e.target.value)}
            placeholder="Filtrar ubicación"
            className="rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100"
          />

          <input
            value={filtroTexto}
            onChange={(e) => setFiltroTexto(e.target.value)}
            placeholder="Buscar..."
            className="rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100"
          />
        </div>

        <button
          type="button"
          onClick={limpiarFiltros}
          className="rounded-lg border border-slate-600 px-4 py-2 text-sm font-semibold text-slate-200"
        >
          Limpiar filtros
        </button>
      </div>

      <div className="rounded-lg bg-slate-800 p-3 text-sm text-slate-400">
        Clientes visibles: <strong>{clientesFiltrados.length}</strong> ·
        Productos visibles: <strong>{productosFiltrados.length}</strong> ·
        Ubicaciones visibles: <strong>{ubicacionesFiltradas.length}</strong>
      </div>

      <div className="rounded-lg bg-slate-800 p-4 space-y-4">
        <h2 className="font-semibold">Registrar entrada</h2>

        {!usuarioPuedeCrearEntrada() && (
          <p className="rounded-lg bg-amber-500/10 p-3 text-sm text-amber-300">
            Solo un usuario admin o responsable puede registrar entradas
            manuales.
          </p>
        )}

        <select
          value={empresaId}
          onChange={(e) => setEmpresaId(e.target.value)}
          className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100"
          disabled={!usuarioPuedeCrearEntrada() || guardando}
        >
          <option value="">Empresa...</option>
          {empresas.map((empresa) => (
            <option key={empresa.id} value={empresa.id}>
              {empresa.nombre}
            </option>
          ))}
        </select>

        <select
          value={clienteId}
          onChange={(e) => setClienteId(e.target.value)}
          className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100"
          disabled={!usuarioPuedeCrearEntrada() || guardando}
        >
          <option value="">Cliente...</option>
          {clientesFiltrados.map((cliente) => (
            <option key={cliente.id} value={cliente.id}>
              {cliente.codigo
                ? `${cliente.codigo} - ${cliente.nombre}`
                : cliente.nombre}
            </option>
          ))}
        </select>

        <select
          value={productoId}
          onChange={(e) => setProductoId(e.target.value)}
          className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100"
          disabled={!usuarioPuedeCrearEntrada() || guardando}
        >
          <option value="">Producto / neumático...</option>
          {productosFiltrados.map((producto) => (
            <option key={producto.id} value={producto.id}>
              {textoProducto(producto)}
            </option>
          ))}
        </select>

        <input
          value={cantidad}
          onChange={(e) => setCantidad(e.target.value)}
          type="number"
          min="1"
          placeholder="Cantidad"
          className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100"
          disabled={!usuarioPuedeCrearEntrada() || guardando}
        />

        <select
          value={ubicacion}
          onChange={(e) => setUbicacion(e.target.value)}
          className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100"
          disabled={!usuarioPuedeCrearEntrada() || guardando}
        >
          <option value="">Ubicación...</option>
          {ubicacionesFiltradas.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>

        <div className="rounded-lg border border-slate-600 bg-slate-900 p-3 space-y-3">
          <label className="block text-sm font-semibold">
            Adjuntar albarán PDF
          </label>

          <input
            id="documento-pdf-entrada"
            type="file"
            accept="application/pdf"
            onChange={(e) => seleccionarArchivoPdf(e.target.files?.[0] || null)}
            className="w-full rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-slate-100"
            disabled={!usuarioPuedeCrearEntrada() || guardando || leyendoOCR}
          />

          <p className="text-xs text-slate-500">
            Solo PDF. Tamaño máximo recomendado: 10 MB.
          </p>

          {archivoPdf && (
            <p className="text-sm text-slate-300">
              Documento seleccionado: <strong>{archivoPdf.name}</strong>
            </p>
          )}

          <button
            type="button"
            onClick={importarPdfEntradaOCR}
            className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            disabled={
              !usuarioPuedeCrearEntrada() ||
              guardando ||
              leyendoOCR ||
              !archivoPdf
            }
          >
            {leyendoOCR ? "Leyendo PDF..." : "Leer entrada con OCR"}
          </button>
        </div>

        <textarea
          value={observaciones}
          onChange={(e) => setObservaciones(e.target.value)}
          placeholder="Observaciones"
          className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100"
          disabled={!usuarioPuedeCrearEntrada() || guardando}
        />

        <button
          type="button"
          onClick={crearEntrada}
          className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          disabled={!usuarioPuedeCrearEntrada() || guardando}
        >
          {guardando ? "Guardando entrada..." : "Registrar entrada"}
        </button>

        {mensaje && <p className="text-sm text-slate-300">{mensaje}</p>}
      </div>

      {entradasOCR.length > 0 && (
        <div className="rounded-lg bg-slate-800 p-4 space-y-4">
          <div>
            <h2 className="font-semibold">Entradas detectadas por OCR</h2>
            <p className="text-sm text-slate-400">
              Si falta cliente o producto, créalo/valídalo en su pantalla y
              vuelve a pulsar “Leer entrada con OCR”.
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-slate-700 bg-slate-900 text-left">
                  <th className="px-3 py-2">Estado</th>
                  <th className="px-3 py-2">Pág.</th>
                  <th className="px-3 py-2">Albarán</th>
                  <th className="px-3 py-2">Fecha</th>
                  <th className="px-3 py-2">Código cliente</th>
                  <th className="px-3 py-2">Cliente</th>
                  <th className="px-3 py-2">Producto OCR</th>
                  <th className="px-3 py-2">Cantidad</th>
                  <th className="px-3 py-2">Ubicación</th>
                  <th className="px-3 py-2">Acciones</th>
                </tr>
              </thead>

              <tbody>
                {entradasOCR.map((entrada, index) => (
                  <tr key={`${entrada.pagina}-${index}`} className="border-b border-slate-700/60">
                    <td className="px-3 py-2">
                      <span
                        className={`rounded-full px-2 py-1 text-xs font-semibold ${claseEstadoOCR(
                          entrada.estado
                        )}`}
                      >
                        {entrada.estado}
                      </span>
                    </td>

                    <td className="px-3 py-2">{entrada.pagina}</td>
                    <td className="px-3 py-2">{entrada.albaran || "-"}</td>
                    <td className="px-3 py-2">{entrada.fecha || "-"}</td>
                    <td className="px-3 py-2">
                      {entrada.codigoCliente || "-"}
                    </td>

                    <td className="px-3 py-2">
                      <div>{entrada.cliente || "-"}</div>
                      {entrada.direccionCliente && (
                        <div className="text-xs text-slate-500">
                          {entrada.direccionCliente}
                        </div>
                      )}

                      {entrada.clienteIdDetectado ? (
                        <div className="text-xs text-emerald-400">
                          Cliente encontrado
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => abrirClienteOCR(entrada)}
                          className="mt-1 rounded-lg border border-amber-600 px-2 py-1 text-xs font-semibold text-amber-300"
                        >
                          Crear / validar cliente
                        </button>
                      )}
                    </td>

                    <td className="px-3 py-2">
                      <div>{entrada.producto || "-"}</div>

                      {entrada.productoIdDetectado ? (
                        <div className="text-xs text-emerald-400">
                          Producto encontrado
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => abrirProductoOCR(entrada)}
                          className="mt-1 rounded-lg border border-amber-600 px-2 py-1 text-xs font-semibold text-amber-300"
                        >
                          Crear / validar producto
                        </button>
                      )}
                    </td>

                    <td className="px-3 py-2">{entrada.cantidad || "-"}</td>

                    <td className="px-3 py-2">
                      {entrada.ubicacionDetectada ||
                        entrada.ubicacion ||
                        "Sin ubicación"}
                    </td>

                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => cargarEntradaOCRAlFormulario(entrada)}
                          className="rounded-lg bg-emerald-600 px-3 py-1 text-xs font-semibold text-white disabled:opacity-50"
                          disabled={
                            entrada.estado === "duplicado" ||
                            !entrada.clienteIdDetectado ||
                            !entrada.productoIdDetectado
                          }
                        >
                          Cargar
                        </button>

                        <button
                          type="button"
                          onClick={() => quitarEntradaOCR(index)}
                          className="rounded-lg border border-slate-600 px-3 py-1 text-xs font-semibold text-slate-200"
                        >
                          Quitar
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      </div>
    </AlmacenLayoutOscuro>
  );
}