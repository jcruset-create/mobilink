import { useEffect, useState } from "react";
import AlmacenMenu from "../components/AlmacenMenu";
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
  empresa_id: string | null;
  codigo: string | null;
  nombre: string;
  nif: string | null;
  telefono: string | null;
  email: string | null;
  activo: boolean;
};

type Vehiculo = {
  id: string;
  cliente_id: string;
  matricula: string;
  numero_vehiculo: string | null;
  marca: string | null;
  modelo: string | null;
};

type MovimientoStock = {
  id: string;
  tipo: string;
  cantidad: number;
  ubicacion: string | null;
  empresa_id: string;
  cliente_id: string;
  producto_id: string;
  clientes:
    | { nombre: string }
    | { nombre: string }[]
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

type LineaStock = {
  clave: string;
  empresaId: string;
  clienteId: string;
  productoId: string;
  cliente: string;
  producto: string;
  ubicacion: string;
  cantidad: number;
};

type AlbaranDetectado = {
  pagina?: number;
  albaran: string | null;
  fecha: string | null;
  cliente: string | null;
  matricula: string | null;
  numeroVehiculo?: string | null;
  producto: string | null;
  cantidad: number | null;
  duplicado?: boolean;
  confianza: "alta" | "media" | "baja";
  observaciones: string[];
};

type EstadoAlbaranPendiente =
  | "pendiente"
  | "duplicado"
  | "sin_cliente"
  | "sin_stock"
  | "varios_stock"
  | "sin_vehiculo"
  | "listo"
  | "confirmado"
  | "descartado"
  | "error";

type AlbaranPendienteValidacion = AlbaranDetectado & {
  uid: string;
  estado: EstadoAlbaranPendiente;
  clienteIdDetectado: string;
  lineaStockClave: string;
  lineasStockCandidatas: LineaStock[];
  vehiculoId: string;
  mensajeEstado: string;
  guardando?: boolean;
};

const BUCKET_DOCUMENTOS = "almacen-documentos";

function obtenerPrimero<T>(valor: T | T[] | null): T | null {
  if (!valor) return null;
  if (Array.isArray(valor)) return valor[0] || null;
  return valor;
}

function esUbicacionMontable(ubicacion: string) {
  return (
    ubicacion !== "En camino" &&
    ubicacion !== "Central Alicante" &&
    ubicacion !== "Montado" &&
    ubicacion !== "Baja"
  );
}

function textoVehiculo(vehiculo: Vehiculo) {
  return `${vehiculo.matricula}${
    vehiculo.numero_vehiculo ? ` | Nº ${vehiculo.numero_vehiculo}` : ""
  }${vehiculo.marca ? ` | ${vehiculo.marca}` : ""}${
    vehiculo.modelo ? ` ${vehiculo.modelo}` : ""
  }`;
}

export default function SalidasMontajes() {
  const { permisos, cargandoPermisos } = usePermisosAlmacen();

  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [lineasStock, setLineasStock] = useState<LineaStock[]>([]);
  const [vehiculos, setVehiculos] = useState<Vehiculo[]>([]);

  const [empresaId, setEmpresaId] = useState("");
  const [lineaStockClave, setLineaStockClave] = useState("");
  const [vehiculoId, setVehiculoId] = useState("");
  const [cantidad, setCantidad] = useState("1");
  const [documentoTipo, setDocumentoTipo] = useState("GENES");
  const [documentoNumero, setDocumentoNumero] = useState("");
  const [observaciones, setObservaciones] = useState("");
  const [archivoPdf, setArchivoPdf] = useState<File | null>(null);
  const [archivoAlbaranImportar, setArchivoAlbaranImportar] =
    useState<File | null>(null);
  const [albaranDetectado, setAlbaranDetectado] =
    useState<AlbaranDetectado | null>(null);
  const [albaranesPendientes, setAlbaranesPendientes] = useState<
    AlbaranPendienteValidacion[]
  >([]);
  const [matriculaPendienteImportada, setMatriculaPendienteImportada] =
    useState("");
  const [mensaje, setMensaje] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [importandoAlbaran, setImportandoAlbaran] = useState(false);
  const [creandoVehiculoDetectado, setCreandoVehiculoDetectado] =
    useState(false);

  const [filtroCliente, setFiltroCliente] = useState("");
  const [filtroProducto, setFiltroProducto] = useState("");
  const [filtroUbicacion, setFiltroUbicacion] = useState("");
  const [filtroVehiculo, setFiltroVehiculo] = useState("");
  const [filtroTexto, setFiltroTexto] = useState("");

  useEffect(() => {
    cargarDatos();
  }, []);

  useEffect(() => {
    cargarVehiculosCliente();
  }, [lineaStockClave]);

  useEffect(() => {
    if (!matriculaPendienteImportada || vehiculos.length === 0) return;

    const matriculaNormalizada = normalizarTextoComparacion(
      matriculaPendienteImportada
    );

    const vehiculoEncontrado = vehiculos.find(
      (vehiculo) =>
        normalizarTextoComparacion(vehiculo.matricula) ===
        matriculaNormalizada
    );

    if (vehiculoEncontrado) {
      setVehiculoId(vehiculoEncontrado.id);
      setMatriculaPendienteImportada("");
      setMensaje(
        "Vehículo encontrado automáticamente por matrícula. Revisa los datos y pulsa Registrar montaje."
      );
    }
  }, [vehiculos, matriculaPendienteImportada]);

  useEffect(() => {
    setLineaStockClave("");
    setVehiculoId("");
    setMatriculaPendienteImportada("");
    limpiarFiltros();
  }, [permisos.perfil?.id]);

  function limpiarFiltros() {
    setFiltroCliente("");
    setFiltroProducto("");
    setFiltroUbicacion("");
    setFiltroVehiculo("");
    setFiltroTexto("");
  }

  async function cargarDatos() {
    setMensaje("");

    const { data: empresasData } = await supabase
      .from("empresas")
      .select("id,nombre")
      .order("nombre");

    const { data: clientesData } = await supabase
      .from("clientes")
      .select("id,empresa_id,codigo,nombre,nif,telefono,email,activo")
      .eq("activo", true)
      .order("nombre");

    const { data, error } = await supabase
      .from("movimientos_stock")
      .select(`
        id,
        tipo,
        cantidad,
        ubicacion,
        empresa_id,
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

    if (error) {
      setMensaje(`Error: ${error.message}`);
      return;
    }

    setEmpresas((empresasData || []) as Empresa[]);
    setClientes((clientesData || []) as Cliente[]);

    if (!empresaId && empresasData && empresasData.length > 0) {
      setEmpresaId(empresasData[0].id);
    }

    const movimientos = (data || []) as unknown as MovimientoStock[];
    const mapa = new Map<string, LineaStock>();

    movimientos.forEach((movimiento) => {
      const cliente = obtenerPrimero(movimiento.clientes);
      const producto = obtenerPrimero(movimiento.productos_neumaticos);

      if (!cliente || !producto) return;

      const ubicacionMovimiento = movimiento.ubicacion || "-";

      if (!esUbicacionMontable(ubicacionMovimiento)) return;

      const productoTexto = `${producto.medida} - ${producto.marca}${
        producto.modelo ? ` ${producto.modelo}` : ""
      }${producto.dot ? ` - DOT ${producto.dot}` : ""}`;

      const clave = [
        movimiento.empresa_id,
        movimiento.cliente_id,
        movimiento.producto_id,
        ubicacionMovimiento,
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
          empresaId: movimiento.empresa_id,
          clienteId: movimiento.cliente_id,
          productoId: movimiento.producto_id,
          cliente: cliente.nombre,
          producto: productoTexto,
          ubicacion: ubicacionMovimiento,
          cantidad: cantidadMovimiento,
        });
      }
    });

    const resultado = Array.from(mapa.values())
      .filter((linea) => linea.cantidad > 0)
      .sort((a, b) => a.cliente.localeCompare(b.cliente));

    setLineasStock(resultado);
  }

  async function cargarVehiculosCliente() {
    setVehiculoId("");
    setVehiculos([]);

    const lineaSeleccionada = lineasStock.find(
      (linea) => linea.clave === lineaStockClave
    );

    if (!lineaSeleccionada) return;

    const vehiculosCliente = await cargarVehiculosPorCliente(
      lineaSeleccionada.clienteId
    );

    setVehiculos(vehiculosCliente);
  }

  async function cargarVehiculosPorCliente(clienteId: string) {
    const { data, error } = await supabase
      .from("vehiculos")
      .select("id,cliente_id,matricula,numero_vehiculo,marca,modelo")
      .eq("cliente_id", clienteId)
      .eq("activo", true)
      .order("matricula");

    if (error) {
      throw new Error(`Error vehículos: ${error.message}`);
    }

    return (data || []) as Vehiculo[];
  }

  function codigoPerfil() {
    return permisos.perfil?.codigo_operario || "";
  }

  function usuarioPuedeUsarLinea(linea: LineaStock) {
    if (!permisos.perfil) return false;
    if (permisos.esAdmin) return true;

    const clientePermitido = permisos.clientesPermitidos.some(
      (cliente) => cliente.id === linea.clienteId
    );

    const ubicacionPermitida = permisos.ubicacion === linea.ubicacion;

    return clientePermitido && ubicacionPermitida;
  }

  function normalizarTextoComparacion(valor: string | null | undefined) {
    return String(valor || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9]/g, "")
      .toLowerCase();
  }

  function buscarClientePorNombre(nombreCliente: string | null | undefined) {
    const clienteNormalizado = normalizarTextoComparacion(nombreCliente);

    if (!clienteNormalizado) return null;

    return (
      clientes.find(
        (cliente) =>
          normalizarTextoComparacion(cliente.nombre) === clienteNormalizado
      ) ||
      clientes.find((cliente) => {
        const nombreNormalizado = normalizarTextoComparacion(cliente.nombre);

        return (
          nombreNormalizado.includes(clienteNormalizado) ||
          clienteNormalizado.includes(nombreNormalizado)
        );
      }) ||
      null
    );
  }

  function empresaIdParaClienteDetectado() {
    if (empresaId) return empresaId;
    if (empresas.length > 0) return empresas[0].id;
    return "";
  }

  async function crearClienteDetectado(nombreCliente: string | null | undefined) {
    const nombreLimpio = String(nombreCliente || "").trim();
    const empresaClienteId = empresaIdParaClienteDetectado();

    if (!nombreLimpio) {
      throw new Error("No hay nombre de cliente detectado para crear.");
    }

    if (!empresaClienteId) {
      throw new Error("No hay empresa seleccionada para crear el cliente.");
    }

    const clienteExistente = buscarClientePorNombre(nombreLimpio);

    if (clienteExistente) return clienteExistente;

    const { data, error } = await supabase
      .from("clientes")
      .insert({
        empresa_id: empresaClienteId,
        codigo: null,
        nombre: nombreLimpio,
        nif: null,
        telefono: null,
        email: null,
        activo: true,
      })
      .select("id,empresa_id,codigo,nombre,nif,telefono,email,activo")
      .single();

    if (error) {
      throw new Error(`Error creando cliente: ${error.message}`);
    }

    const nuevoCliente = data as Cliente;

    setClientes((actuales) =>
      [...actuales, nuevoCliente].sort((a, b) =>
        a.nombre.localeCompare(b.nombre)
      )
    );

    return nuevoCliente;
  }

  function buscarLineasParaAlbaran(datos: AlbaranDetectado) {
    const productoDetectado = normalizarTextoComparacion(datos.producto);
    const clienteDetectado = normalizarTextoComparacion(datos.cliente);

    return lineasPorPermisos.filter((linea) => {
      const clienteOk =
        !clienteDetectado ||
        normalizarTextoComparacion(linea.cliente).includes(clienteDetectado) ||
        clienteDetectado.includes(normalizarTextoComparacion(linea.cliente));

      const productoOk =
        !productoDetectado ||
        normalizarTextoComparacion(linea.producto).includes(productoDetectado) ||
        productoDetectado.includes(normalizarTextoComparacion(linea.producto));

      return clienteOk && productoOk;
    });
  }

  function elegirLineaAutomaticaParaAlbaran(
    coincidencias: LineaStock[],
    datos: AlbaranDetectado
  ) {
    const cantidadNecesaria = Number(datos.cantidad || 0);

    const conStockSuficiente = coincidencias.filter((linea) =>
      cantidadNecesaria > 0 ? linea.cantidad >= cantidadNecesaria : true
    );

    const candidatas = conStockSuficiente.length > 0
      ? conStockSuficiente
      : coincidencias;

    if (candidatas.length === 0) return null;

    const ubicaciones = Array.from(
      new Set(candidatas.map((linea) => linea.ubicacion))
    );

    if (!permisos.esAdmin && permisos.ubicacion) {
      const deUbicacionUsuario = candidatas.filter(
        (linea) => linea.ubicacion === permisos.ubicacion
      );

      if (deUbicacionUsuario.length > 0) {
        return deUbicacionUsuario[0];
      }
    }

    if (ubicaciones.length === 1) {
      return candidatas[0];
    }

    return null;
  }

  function buscarLineaParaAlbaran(datos: AlbaranDetectado) {
    return elegirLineaAutomaticaParaAlbaran(
      buscarLineasParaAlbaran(datos),
      datos
    );
  }

  function buscarVehiculoEnLista(
    listaVehiculos: Vehiculo[],
    matricula: string | null,
    numeroVehiculo: string | null | undefined
  ) {
    const matriculaNormalizada = normalizarTextoComparacion(matricula);
    const numeroNormalizado = normalizarTextoComparacion(numeroVehiculo);

    return (
      listaVehiculos.find(
        (vehiculo) =>
          matriculaNormalizada &&
          normalizarTextoComparacion(vehiculo.matricula) ===
            matriculaNormalizada
      ) ||
      listaVehiculos.find(
        (vehiculo) =>
          numeroNormalizado &&
          normalizarTextoComparacion(vehiculo.numero_vehiculo) ===
            numeroNormalizado
      ) ||
      null
    );
  }

  async function prepararAlbaranesPendientes(
    albaranes: AlbaranDetectado[]
  ): Promise<AlbaranPendienteValidacion[]> {
    const cacheVehiculosPorCliente = new Map<string, Vehiculo[]>();

    const preparados: AlbaranPendienteValidacion[] = [];

    for (let i = 0; i < albaranes.length; i += 1) {
      const albaran = albaranes[i];
      const clienteEncontrado = buscarClientePorNombre(albaran.cliente);
      const lineasEncontradas = clienteEncontrado
        ? buscarLineasParaAlbaran(albaran)
        : [];
      const lineaEncontrada = elegirLineaAutomaticaParaAlbaran(
        lineasEncontradas,
        albaran
      );

      let vehiculoEncontrado: Vehiculo | null = null;

      if (lineaEncontrada) {
        let vehiculosCliente = cacheVehiculosPorCliente.get(
          lineaEncontrada.clienteId
        );

        if (!vehiculosCliente) {
          try {
            vehiculosCliente = await cargarVehiculosPorCliente(
              lineaEncontrada.clienteId
            );
            cacheVehiculosPorCliente.set(
              lineaEncontrada.clienteId,
              vehiculosCliente
            );
          } catch {
            vehiculosCliente = [];
          }
        }

        vehiculoEncontrado = buscarVehiculoEnLista(
          vehiculosCliente,
          albaran.matricula,
          albaran.numeroVehiculo
        );
      }

      let estado: EstadoAlbaranPendiente = "pendiente";
      let mensajeEstado = "Pendiente de revisar.";

      if (albaran.duplicado) {
        estado = "duplicado";
        mensajeEstado = "Duplicado. Ya existe una salida con este albarán.";
      } else if (!clienteEncontrado) {
        estado = "sin_cliente";
        mensajeEstado = "No se ha encontrado el cliente detectado. Puedes crearlo automáticamente.";
      } else if (lineasEncontradas.length === 0) {
        estado = "sin_stock";
        mensajeEstado = "No se ha encontrado stock coincidente.";
      } else if (!lineaEncontrada) {
        estado = "varios_stock";
        mensajeEstado =
          "Hay varias ubicaciones posibles. Selecciona el almacén correcto antes de confirmar.";
      } else if (
        albaran.cantidad &&
        Number(albaran.cantidad) > lineaEncontrada.cantidad
      ) {
        estado = "sin_stock";
        mensajeEstado = `Stock insuficiente en ${lineaEncontrada.ubicacion}. Disponible: ${lineaEncontrada.cantidad}. Salida: ${albaran.cantidad}.`;
      } else if (!vehiculoEncontrado) {
        estado = "sin_vehiculo";
        mensajeEstado = "No se ha encontrado vehículo para este cliente.";
      } else {
        estado = "listo";
        mensajeEstado = "Listo para confirmar.";
      }

      preparados.push({
        ...albaran,
        uid: `${albaran.albaran || "sin-albaran"}-${albaran.pagina || i + 1}-${Date.now()}-${i}`,
        estado,
        clienteIdDetectado: clienteEncontrado?.id || "",
        lineaStockClave: lineaEncontrada?.clave || "",
        lineasStockCandidatas: lineasEncontradas,
        vehiculoId: vehiculoEncontrado?.id || "",
        mensajeEstado,
      });
    }

    return preparados;
  }

  function seleccionarArchivoImportacion(file: File | null) {
    setMensaje("");

    if (!file) {
      setArchivoAlbaranImportar(null);
      return;
    }

    if (file.type !== "application/pdf") {
      setArchivoAlbaranImportar(null);
      setMensaje("Solo se pueden importar albaranes en PDF.");
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      setArchivoAlbaranImportar(null);
      setMensaje("El PDF no puede superar 10 MB.");
      return;
    }

    setArchivoAlbaranImportar(file);
  }

  function aplicarAlbaranDetectado(datos: AlbaranDetectado) {
    setAlbaranDetectado(datos);
    setVehiculoId("");
    setMatriculaPendienteImportada("");

    if (datos.albaran) {
      setDocumentoTipo("GENES");
      setDocumentoNumero(datos.albaran);
    }

    if (datos.cantidad && datos.cantidad > 0) {
      setCantidad(String(datos.cantidad));
    }

    const lineaEncontrada = buscarLineaParaAlbaran(datos);

    if (lineaEncontrada) {
      setEmpresaId(lineaEncontrada.empresaId);
      setLineaStockClave(lineaEncontrada.clave);
    }

    if (datos.matricula) {
      setMatriculaPendienteImportada(datos.matricula);
      setFiltroVehiculo(datos.matricula);
    }

    const observacionesAlbaran = [
      observaciones.trim(),
      datos.fecha ? `Fecha albarán: ${datos.fecha}` : "",
      datos.albaran ? `Albarán importado: ${datos.albaran}` : "",
      datos.numeroVehiculo ? `Nº vehículo: ${datos.numeroVehiculo}` : "",
      datos.observaciones.length > 0
        ? `OCR: ${datos.observaciones.join(" | ")}`
        : "",
    ]
      .filter(Boolean)
      .join(" | ");

    setObservaciones(observacionesAlbaran);

    if (!lineaEncontrada) {
      setMensaje(
        "Albarán leído, pero no se ha encontrado stock coincidente. Revisa cliente/producto y selecciona la línea manualmente."
      );
      return;
    }

    setMensaje(
      "Albarán leído correctamente. Si el vehículo no existe, podrás crearlo automáticamente."
    );
  }

  async function importarAlbaranPdf() {
    setMensaje("");

    if (!archivoAlbaranImportar) {
      setMensaje("Selecciona un PDF de albarán para importar.");
      return;
    }

    setImportandoAlbaran(true);

    try {
      const formData = new FormData();
      formData.append("albaran", archivoAlbaranImportar);

      const response = await fetch("/api/almacen/leer-albaran-pdf", {
        method: "POST",
        body: formData,
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.message || "Error leyendo el albarán.");
      }

      const albaranes = Array.isArray(result.albaranes)
        ? (result.albaranes as AlbaranDetectado[])
        : result.datos
          ? ([result.datos] as AlbaranDetectado[])
          : [];

      if (albaranes.length === 0) {
        throw new Error("No se detectó ningún albarán válido.");
      }

      setArchivoPdf(archivoAlbaranImportar);

      const preparados = await prepararAlbaranesPendientes(albaranes);
      setAlbaranesPendientes(preparados);

      if (preparados.length === 1) {
        aplicarAlbaranDetectado(preparados[0]);
      } else {
        setAlbaranDetectado(null);
      }

      const duplicados = preparados.filter(
        (item) => item.estado === "duplicado"
      ).length;
      const listos = preparados.filter((item) => item.estado === "listo").length;
      const incidencias = preparados.length - listos;

      setMensaje(
        `PDF leído: ${preparados.length} albarán/es detectado/s. Listos: ${listos}. Incidencias: ${incidencias}. Duplicados: ${duplicados}.`
      );
    } catch (error) {
      setMensaje(
        error instanceof Error
          ? error.message
          : "Error importando albarán PDF."
      );
    } finally {
      setImportandoAlbaran(false);
    }
  }

  function seleccionarArchivoPdf(file: File | null) {
    setMensaje("");

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

  async function crearVehiculoDetectado() {
    setMensaje("");

    const lineaSeleccionada = lineasStock.find(
      (linea) => linea.clave === lineaStockClave
    );

    const matricula = matriculaPendienteImportada.trim();

    if (!lineaSeleccionada) {
      setMensaje("Selecciona primero una línea de stock para saber el cliente.");
      return;
    }

    if (!matricula) {
      setMensaje("No hay matrícula detectada para crear el vehículo.");
      return;
    }

    setCreandoVehiculoDetectado(true);

    try {
      const nuevoVehiculo = await crearVehiculoParaCliente({
        clienteId: lineaSeleccionada.clienteId,
        matricula,
        numeroVehiculo: albaranDetectado?.numeroVehiculo || null,
      });

      setVehiculos((actuales) =>
        [...actuales, nuevoVehiculo].sort((a, b) =>
          a.matricula.localeCompare(b.matricula)
        )
      );
      setVehiculoId(nuevoVehiculo.id);
      setMatriculaPendienteImportada("");

      setMensaje(
        `Vehículo ${matricula} creado automáticamente para ${lineaSeleccionada.cliente}. Ya puedes registrar el montaje.`
      );
    } catch (error) {
      setMensaje(
        error instanceof Error
          ? error.message
          : "Error creando el vehículo detectado."
      );
    } finally {
      setCreandoVehiculoDetectado(false);
    }
  }

  async function crearVehiculoParaCliente({
    clienteId,
    matricula,
    numeroVehiculo,
  }: {
    clienteId: string;
    matricula: string | null;
    numeroVehiculo: string | null | undefined;
  }) {
    const matriculaLimpia = String(matricula || "").trim().toUpperCase();
    const numeroVehiculoLimpio = String(numeroVehiculo || "").trim();

    if (!matriculaLimpia) {
      throw new Error("No hay matrícula válida para crear el vehículo.");
    }

    const { data: vehiculosExistentes, error: errorBusqueda } = await supabase
      .from("vehiculos")
      .select("id,cliente_id,matricula,numero_vehiculo,marca,modelo")
      .eq("cliente_id", clienteId)
      .eq("activo", true);

    if (errorBusqueda) {
      throw new Error(`Error buscando vehículo: ${errorBusqueda.message}`);
    }

    const existente = buscarVehiculoEnLista(
      (vehiculosExistentes || []) as Vehiculo[],
      matriculaLimpia,
      numeroVehiculoLimpio
    );

    if (existente) return existente;

    const { data, error } = await supabase
      .from("vehiculos")
      .insert({
        cliente_id: clienteId,
        matricula: matriculaLimpia,
        numero_vehiculo: numeroVehiculoLimpio || null,
        marca: null,
        modelo: null,
        activo: true,
      })
      .select("id,cliente_id,matricula,numero_vehiculo,marca,modelo")
      .single();

    if (error) {
      throw new Error(`Error creando vehículo: ${error.message}`);
    }

    return data as Vehiculo;
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
      "salidas-montajes",
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

  async function registrarMovimientoDesdeAlbaran(
    item: AlbaranPendienteValidacion
  ) {
    const lineaSeleccionada = lineasStock.find(
      (linea) => linea.clave === item.lineaStockClave
    );

    if (!permisos.perfil) {
      throw new Error("No hay perfil activo para el usuario conectado.");
    }

    if (!lineaSeleccionada) {
      throw new Error("No se ha encontrado la línea de stock.");
    }

    if (!usuarioPuedeUsarLinea(lineaSeleccionada)) {
      throw new Error(
        "No tienes permiso para montar stock de este cliente o ubicación."
      );
    }

    if (item.duplicado || item.estado === "duplicado") {
      throw new Error("Este albarán está duplicado y no se puede confirmar.");
    }

    if (!item.vehiculoId) {
      throw new Error("Falta vehículo para confirmar este albarán.");
    }

    if (!item.albaran) {
      throw new Error("Falta número de albarán.");
    }

    const cantidadNumero = Number(item.cantidad || 0);

    if (Number.isNaN(cantidadNumero) || cantidadNumero <= 0) {
      throw new Error("La cantidad debe ser mayor que 0.");
    }

    if (cantidadNumero > lineaSeleccionada.cantidad) {
      throw new Error(
        `No puedes sacar ${cantidadNumero}. Stock disponible: ${lineaSeleccionada.cantidad}.`
      );
    }

    const { data: duplicadoData, error: errorDuplicado } = await supabase
      .from("movimientos_stock")
      .select("id")
      .eq("tipo", "SALIDA")
      .eq("documento_tipo", "GENES")
      .eq("documento_numero", item.albaran)
      .limit(1);

    if (errorDuplicado) {
      throw new Error(`Error comprobando duplicado: ${errorDuplicado.message}`);
    }

    if (duplicadoData && duplicadoData.length > 0) {
      throw new Error("Albarán duplicado. Ya existe una salida registrada.");
    }

    const documentoSubido = await subirDocumentoPdf();

    const observacionFinal = [
      `Montaje registrado por ${codigoPerfil() || "-"}`,
      item.fecha ? `Fecha albarán: ${item.fecha}` : "",
      item.albaran ? `Albarán importado: ${item.albaran}` : "",
      item.numeroVehiculo ? `Nº vehículo: ${item.numeroVehiculo}` : "",
      item.pagina ? `Página PDF: ${item.pagina}` : "",
      documentoSubido.nombre
        ? `Documento adjunto: ${documentoSubido.nombre}`
        : "",
      item.observaciones.length > 0
        ? `OCR: ${item.observaciones.join(" | ")}`
        : "",
    ]
      .filter(Boolean)
      .join(" | ");

    const { error } = await supabase.from("movimientos_stock").insert({
      empresa_id: lineaSeleccionada.empresaId,
      cliente_id: lineaSeleccionada.clienteId,
      producto_id: lineaSeleccionada.productoId,
      vehiculo_id: item.vehiculoId,
      tipo: "SALIDA",
      cantidad: cantidadNumero,
      ubicacion:
        lineaSeleccionada.ubicacion === "-"
          ? null
          : lineaSeleccionada.ubicacion,
      origen_movimiento: "montaje",
      documento_tipo: "GENES",
      documento_numero: item.albaran.trim(),
      observaciones: observacionFinal,
      documento_adjunto_url: documentoSubido.ruta,
      documento_adjunto_nombre: documentoSubido.nombre,
    });

    if (error) {
      throw new Error(`Error registrando salida: ${error.message}`);
    }
  }

  async function confirmarAlbaranPendiente(uid: string) {
    const item = albaranesPendientes.find((albaran) => albaran.uid === uid);
    if (!item) return;

    setAlbaranesPendientes((actuales) =>
      actuales.map((albaran) =>
        albaran.uid === uid ? { ...albaran, guardando: true } : albaran
      )
    );

    try {
      await registrarMovimientoDesdeAlbaran(item);

      setAlbaranesPendientes((actuales) =>
        actuales.map((albaran) =>
          albaran.uid === uid
            ? {
                ...albaran,
                estado: "confirmado",
                mensajeEstado: "Confirmado correctamente.",
                guardando: false,
              }
            : albaran
        )
      );

      setMensaje(`Albarán ${item.albaran || ""} confirmado correctamente.`);
      await cargarDatos();
    } catch (error) {
      setAlbaranesPendientes((actuales) =>
        actuales.map((albaran) =>
          albaran.uid === uid
            ? {
                ...albaran,
                estado: "error",
                mensajeEstado:
                  error instanceof Error
                    ? error.message
                    : "Error confirmando albarán.",
                guardando: false,
              }
            : albaran
        )
      );

      setMensaje(
        error instanceof Error ? error.message : "Error confirmando albarán."
      );
    }
  }

  async function confirmarTodosValidos() {
    const validosIniciales = albaranesPendientes.filter(
      (item) => item.estado === "listo" && item.vehiculoId
    );

    if (validosIniciales.length === 0) {
      setMensaje("No hay albaranes válidos para confirmar.");
      return;
    }

    const stockRestantePorClave = new Map<string, number>();

    lineasStock.forEach((linea) => {
      stockRestantePorClave.set(linea.clave, linea.cantidad);
    });

    const validos: AlbaranPendienteValidacion[] = [];
    const bloqueadosPorStock = new Map<string, string>();

    validosIniciales.forEach((item) => {
      const cantidadSalida = Number(item.cantidad || 0);
      const disponible = stockRestantePorClave.get(item.lineaStockClave) ?? 0;
      const restante = disponible - cantidadSalida;

      if (restante < 0) {
        bloqueadosPorStock.set(
          item.uid,
          `Stock insuficiente. Disponible acumulado: ${disponible}. Salida: ${cantidadSalida}. Esta confirmación dejaría stock negativo.`
        );
        return;
      }

      stockRestantePorClave.set(item.lineaStockClave, restante);
      validos.push(item);
    });

    if (bloqueadosPorStock.size > 0) {
      setAlbaranesPendientes((actuales) =>
        actuales.map((item) =>
          bloqueadosPorStock.has(item.uid)
            ? {
                ...item,
                estado: "error",
                mensajeEstado: bloqueadosPorStock.get(item.uid) || item.mensajeEstado,
              }
            : item
        )
      );
    }

    if (validos.length === 0) {
      setMensaje(
        "No se ha confirmado ningún albarán porque el stock quedaría en negativo."
      );
      return;
    }

    setGuardando(true);

    try {
      for (const item of validos) {
        await confirmarAlbaranPendiente(item.uid);
      }

      setMensaje(
        `Proceso terminado. Confirmados/intentos: ${validos.length}. Bloqueados por stock: ${bloqueadosPorStock.size}.`
      );
    } finally {
      setGuardando(false);
    }
  }

  async function seleccionarLineaStockAlbaranPendiente(
    uid: string,
    nuevaClave: string
  ) {
    const item = albaranesPendientes.find((albaran) => albaran.uid === uid);
    const lineaSeleccionada = lineasStock.find(
      (linea) => linea.clave === nuevaClave
    );

    if (!item || !lineaSeleccionada) return;

    let vehiculoEncontrado: Vehiculo | null = null;

    try {
      const vehiculosCliente = await cargarVehiculosPorCliente(
        lineaSeleccionada.clienteId
      );

      vehiculoEncontrado = buscarVehiculoEnLista(
        vehiculosCliente,
        item.matricula,
        item.numeroVehiculo
      );
    } catch {
      vehiculoEncontrado = null;
    }

    const cantidadSalida = Number(item.cantidad || 0);

    setAlbaranesPendientes((actuales) =>
      actuales.map((albaran) => {
        if (albaran.uid !== uid) return albaran;

        if (albaran.duplicado) {
          return {
            ...albaran,
            lineaStockClave: nuevaClave,
            vehiculoId: vehiculoEncontrado?.id || "",
            estado: "duplicado",
            mensajeEstado: "Duplicado. Ya existe una salida con este albarán.",
          };
        }

        if (cantidadSalida > lineaSeleccionada.cantidad) {
          return {
            ...albaran,
            lineaStockClave: nuevaClave,
            vehiculoId: vehiculoEncontrado?.id || "",
            estado: "sin_stock",
            mensajeEstado: `Stock insuficiente en ${lineaSeleccionada.ubicacion}. Disponible: ${lineaSeleccionada.cantidad}. Salida: ${cantidadSalida}.`,
          };
        }

        if (!vehiculoEncontrado) {
          return {
            ...albaran,
            lineaStockClave: nuevaClave,
            vehiculoId: "",
            estado: "sin_vehiculo",
            mensajeEstado:
              "Almacén seleccionado. Falta crear o seleccionar vehículo.",
          };
        }

        return {
          ...albaran,
          lineaStockClave: nuevaClave,
          vehiculoId: vehiculoEncontrado.id,
          estado: "listo",
          mensajeEstado:
            "Almacén y vehículo seleccionados. Listo para confirmar.",
        };
      })
    );
  }

  async function crearClienteParaAlbaranPendiente(uid: string) {
    const item = albaranesPendientes.find((albaran) => albaran.uid === uid);
    if (!item) return;

    if (!item.cliente) {
      setMensaje("No se puede crear cliente porque el OCR no detectó nombre.");
      return;
    }

    setAlbaranesPendientes((actuales) =>
      actuales.map((albaran) =>
        albaran.uid === uid ? { ...albaran, guardando: true } : albaran
      )
    );

    try {
      const nuevoCliente = await crearClienteDetectado(item.cliente);

      setAlbaranesPendientes((actuales) =>
        actuales.map((albaran) =>
          albaran.uid === uid
            ? {
                ...albaran,
                clienteIdDetectado: nuevoCliente.id,
                estado: "sin_stock",
                mensajeEstado:
                  "Cliente creado. Ahora falta que exista stock coincidente para este cliente/producto.",
                guardando: false,
              }
            : albaran
        )
      );

      setMensaje(`Cliente ${nuevoCliente.nombre} creado correctamente.`);
      await cargarDatos();
    } catch (error) {
      setAlbaranesPendientes((actuales) =>
        actuales.map((albaran) =>
          albaran.uid === uid
            ? {
                ...albaran,
                estado: "error",
                mensajeEstado:
                  error instanceof Error
                    ? error.message
                    : "Error creando cliente.",
                guardando: false,
              }
            : albaran
        )
      );

      setMensaje(
        error instanceof Error ? error.message : "Error creando cliente."
      );
    }
  }

  async function crearVehiculoParaAlbaranPendiente(uid: string) {
    const item = albaranesPendientes.find((albaran) => albaran.uid === uid);
    if (!item) return;

    const lineaSeleccionada = lineasStock.find(
      (linea) => linea.clave === item.lineaStockClave
    );

    if (!lineaSeleccionada) {
      setMensaje("No se puede crear vehículo sin línea de stock vinculada.");
      return;
    }

    if (!item.matricula) {
      setMensaje("No se puede crear vehículo sin matrícula detectada.");
      return;
    }

    setAlbaranesPendientes((actuales) =>
      actuales.map((albaran) =>
        albaran.uid === uid ? { ...albaran, guardando: true } : albaran
      )
    );

    try {
      const nuevoVehiculo = await crearVehiculoParaCliente({
        clienteId: lineaSeleccionada.clienteId,
        matricula: item.matricula,
        numeroVehiculo: item.numeroVehiculo || null,
      });

      setAlbaranesPendientes((actuales) =>
        actuales.map((albaran) =>
          albaran.uid === uid
            ? {
                ...albaran,
                vehiculoId: nuevoVehiculo.id,
                estado: albaran.duplicado ? "duplicado" : "listo",
                mensajeEstado: albaran.duplicado
                  ? "Duplicado. Ya existe una salida con este albarán."
                  : "Vehículo creado. Listo para confirmar.",
                guardando: false,
              }
            : albaran
        )
      );

      if (lineaSeleccionada.clave === lineaStockClave) {
        setVehiculos((actuales) => {
          const existe = actuales.some(
            (vehiculo) => vehiculo.id === nuevoVehiculo.id
          );

          if (existe) return actuales;

          return [...actuales, nuevoVehiculo].sort((a, b) =>
            a.matricula.localeCompare(b.matricula)
          );
        });
      }

      setMensaje(`Vehículo ${nuevoVehiculo.matricula} creado correctamente.`);
    } catch (error) {
      setAlbaranesPendientes((actuales) =>
        actuales.map((albaran) =>
          albaran.uid === uid
            ? {
                ...albaran,
                estado: "error",
                mensajeEstado:
                  error instanceof Error
                    ? error.message
                    : "Error creando vehículo.",
                guardando: false,
              }
            : albaran
        )
      );

      setMensaje(
        error instanceof Error ? error.message : "Error creando vehículo."
      );
    }
  }

  function descartarAlbaranPendiente(uid: string) {
    setAlbaranesPendientes((actuales) =>
      actuales.map((albaran) =>
        albaran.uid === uid
          ? {
              ...albaran,
              estado: "descartado",
              mensajeEstado: "Descartado manualmente.",
            }
          : albaran
      )
    );
  }

  function cargarAlbaranPendienteEnFormulario(item: AlbaranPendienteValidacion) {
    setAlbaranDetectado(item);
    setDocumentoTipo("GENES");
    setDocumentoNumero(item.albaran || "");
    setCantidad(item.cantidad ? String(item.cantidad) : "1");
    setLineaStockClave(item.lineaStockClave);
    setVehiculoId(item.vehiculoId);
    setMatriculaPendienteImportada(item.vehiculoId ? "" : item.matricula || "");
    setFiltroVehiculo(item.matricula || item.numeroVehiculo || "");

    const lineaSeleccionada = lineasStock.find(
      (linea) => linea.clave === item.lineaStockClave
    );

    if (lineaSeleccionada) {
      setEmpresaId(lineaSeleccionada.empresaId);
    }

    setObservaciones(
      [
        item.fecha ? `Fecha albarán: ${item.fecha}` : "",
        item.albaran ? `Albarán importado: ${item.albaran}` : "",
        item.numeroVehiculo ? `Nº vehículo: ${item.numeroVehiculo}` : "",
        item.pagina ? `Página PDF: ${item.pagina}` : "",
      ]
        .filter(Boolean)
        .join(" | ")
    );

    setMensaje("Albarán cargado en el formulario inferior para revisión manual.");
  }

  async function registrarSalida() {
    setMensaje("");

    const lineaSeleccionada = lineasStock.find(
      (linea) => linea.clave === lineaStockClave
    );

    if (!permisos.perfil) {
      setMensaje("No hay perfil activo para el usuario conectado.");
      return;
    }

    if (!empresaId || !lineaSeleccionada || !cantidad) {
      setMensaje("Empresa, línea de stock y cantidad son obligatorios.");
      return;
    }

    if (!usuarioPuedeUsarLinea(lineaSeleccionada)) {
      setMensaje(
        "No tienes permiso para montar stock de este cliente o ubicación."
      );
      return;
    }

    if (!vehiculoId) {
      setMensaje("El vehículo es obligatorio para registrar un montaje.");
      return;
    }

    if (!documentoNumero.trim()) {
      setMensaje("El número de documento Genes u OR manual es obligatorio.");
      return;
    }

    const cantidadNumero = Number(cantidad);

    if (Number.isNaN(cantidadNumero) || cantidadNumero <= 0) {
      setMensaje("La cantidad debe ser mayor que 0.");
      return;
    }

    if (cantidadNumero > lineaSeleccionada.cantidad) {
      setMensaje(
        `No puedes sacar ${cantidadNumero}. Stock disponible: ${lineaSeleccionada.cantidad}.`
      );
      return;
    }

    setGuardando(true);

    try {
      const documentoSubido = await subirDocumentoPdf();

      const observacionFinal = [
        `Montaje registrado por ${codigoPerfil() || "-"}`,
        observaciones.trim(),
        documentoSubido.nombre
          ? `Documento adjunto: ${documentoSubido.nombre}`
          : "",
      ]
        .filter(Boolean)
        .join(" | ");

      const { error } = await supabase.from("movimientos_stock").insert({
        empresa_id: lineaSeleccionada.empresaId,
        cliente_id: lineaSeleccionada.clienteId,
        producto_id: lineaSeleccionada.productoId,
        vehiculo_id: vehiculoId,
        tipo: "SALIDA",
        cantidad: cantidadNumero,
        ubicacion:
          lineaSeleccionada.ubicacion === "-"
            ? null
            : lineaSeleccionada.ubicacion,
        origen_movimiento: "montaje",
        documento_tipo: documentoTipo,
        documento_numero: documentoNumero.trim(),
        observaciones: observacionFinal,
        documento_adjunto_url: documentoSubido.ruta,
        documento_adjunto_nombre: documentoSubido.nombre,
      });

      if (error) {
        setMensaje(`Error: ${error.message}`);
        setGuardando(false);
        return;
      }

      setMensaje("Salida / montaje registrado correctamente.");
      setLineaStockClave("");
      setVehiculoId("");
      setCantidad("1");
      setDocumentoTipo("GENES");
      setDocumentoNumero("");
      setObservaciones("");
      setArchivoPdf(null);
      setArchivoAlbaranImportar(null);
      setAlbaranDetectado(null);
      setMatriculaPendienteImportada("");

      const inputArchivo = document.getElementById(
        "documento-pdf-salida"
      ) as HTMLInputElement | null;

      if (inputArchivo) {
        inputArchivo.value = "";
      }

      const inputAlbaran = document.getElementById(
        "importar-albaran-pdf"
      ) as HTMLInputElement | null;

      if (inputAlbaran) {
        inputAlbaran.value = "";
      }

      cargarDatos();
    } catch (error) {
      setMensaje(
        error instanceof Error
          ? error.message
          : "Error registrando salida con documento."
      );
    } finally {
      setGuardando(false);
    }
  }

  const clientesPermitidosIds = permisos.clientesPermitidos.map(
    (cliente) => cliente.id
  );

  const lineasPorPermisos = lineasStock.filter((linea) => {
    if (!permisos.perfil) return false;
    if (permisos.esAdmin) return true;

    return (
      clientesPermitidosIds.includes(linea.clienteId) &&
      permisos.ubicacion === linea.ubicacion
    );
  });

  const lineasFiltradas = lineasPorPermisos.filter((linea) => {
    if (empresaId && linea.empresaId !== empresaId) return false;

    if (
      filtroCliente.trim() &&
      !linea.cliente.toLowerCase().includes(filtroCliente.trim().toLowerCase())
    ) {
      return false;
    }

    if (
      filtroProducto.trim() &&
      !linea.producto
        .toLowerCase()
        .includes(filtroProducto.trim().toLowerCase())
    ) {
      return false;
    }

    if (
      filtroUbicacion.trim() &&
      !linea.ubicacion
        .toLowerCase()
        .includes(filtroUbicacion.trim().toLowerCase())
    ) {
      return false;
    }

    if (filtroTexto.trim()) {
      const texto = [
        linea.cliente,
        linea.producto,
        linea.ubicacion,
        String(linea.cantidad),
      ]
        .join(" ")
        .toLowerCase();

      if (!texto.includes(filtroTexto.trim().toLowerCase())) return false;
    }

    return true;
  });

  const vehiculosFiltrados = vehiculos.filter((vehiculo) => {
    if (!filtroVehiculo.trim()) return true;

    return textoVehiculo(vehiculo)
      .toLowerCase()
      .includes(filtroVehiculo.trim().toLowerCase());
  });

  const clientesDisponibles = Array.from(
    new Set(lineasPorPermisos.map((linea) => linea.cliente))
  ).sort((a, b) => a.localeCompare(b));

  const ubicacionesDisponibles = Array.from(
    new Set(lineasPorPermisos.map((linea) => linea.ubicacion))
  ).sort((a, b) => a.localeCompare(b));

  const lineaSeleccionada = lineasStock.find(
    (linea) => linea.clave === lineaStockClave
  );

  const mostrarAvisoVehiculoNoEncontrado =
    Boolean(matriculaPendienteImportada.trim()) &&
    Boolean(lineaSeleccionada) &&
    !vehiculoId;

  const totalAlbaranesListos = albaranesPendientes.filter(
    (item) => item.estado === "listo"
  ).length;

  function filasExportacionStockMontable(): FilaExportacion[] {
    return lineasFiltradas.map((linea) => ({
      cliente: linea.cliente,
      producto: linea.producto,
      ubicacion: linea.ubicacion,
      stock_disponible: linea.cantidad,
      empresa_id: linea.empresaId,
      cliente_id: linea.clienteId,
      producto_id: linea.productoId,
    }));
  }

  function exportarStockMontableCsv() {
    const filas = filasExportacionStockMontable();

    if (filas.length === 0) {
      setMensaje("No hay stock disponible para exportar.");
      return;
    }

    exportarCsv("stock-montable", filas);
  }

  async function exportarStockMontableExcel() {
    const filas = filasExportacionStockMontable();

    if (filas.length === 0) {
      setMensaje("No hay stock disponible para exportar.");
      return;
    }

    await exportarExcel("stock-montable", "Stock montable", filas);
  }

  function etiquetaEstado(estado: EstadoAlbaranPendiente) {
    if (estado === "listo") return "LISTO";
    if (estado === "duplicado") return "DUPLICADO";
    if (estado === "sin_cliente") return "SIN CLIENTE";
    if (estado === "sin_stock") return "SIN STOCK";
    if (estado === "varios_stock") return "VARIOS STOCK";
    if (estado === "sin_vehiculo") return "SIN VEHÍCULO";
    if (estado === "confirmado") return "CONFIRMADO";
    if (estado === "descartado") return "DESCARTADO";
    if (estado === "error") return "ERROR";
    return "PENDIENTE";
  }

  function claseEstado(estado: EstadoAlbaranPendiente) {
    if (estado === "listo") return "bg-green-100 text-green-800";
    if (estado === "duplicado") return "bg-red-100 text-red-800";
    if (
      estado === "sin_cliente" ||
      estado === "sin_stock" ||
      estado === "sin_vehiculo" ||
      estado === "varios_stock"
    ) {
      return "bg-orange-100 text-orange-800";
    }
    if (estado === "confirmado") return "bg-blue-100 text-blue-800";
    if (estado === "descartado") return "bg-gray-100 text-gray-700";
    if (estado === "error") return "bg-red-100 text-red-800";
    return "bg-gray-100 text-gray-700";
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
          <h1 className="text-2xl font-bold">Salidas / Montajes</h1>
          <p className="text-sm text-gray-500">
            Registra montajes seleccionando stock permitido, vehículo, documento
            y PDF adjunto.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={exportarStockMontableCsv}
            className="rounded-xl border px-4 py-2 text-sm font-semibold disabled:opacity-50"
            disabled={lineasFiltradas.length === 0}
          >
            Exportar CSV
          </button>

          <button
            type="button"
            onClick={exportarStockMontableExcel}
            className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            disabled={lineasFiltradas.length === 0}
          >
            Exportar Excel
          </button>
        </div>
      </div>

      <div className="rounded-xl border bg-white p-4 space-y-4">
        <h2 className="font-semibold">Filtros</h2>

        <div className="grid gap-3 md:grid-cols-4">
          <input
            value={filtroCliente}
            onChange={(e) => setFiltroCliente(e.target.value)}
            placeholder="Filtrar cliente"
            className="rounded-lg border px-3 py-2 text-sm"
            list="clientes-montaje"
          />

          <datalist id="clientes-montaje">
            {clientesDisponibles.map((cliente) => (
              <option key={cliente} value={cliente} />
            ))}
          </datalist>

          <input
            value={filtroProducto}
            onChange={(e) => setFiltroProducto(e.target.value)}
            placeholder="Producto, medida, marca o DOT"
            className="rounded-lg border px-3 py-2 text-sm"
          />

          <input
            value={filtroUbicacion}
            onChange={(e) => setFiltroUbicacion(e.target.value)}
            placeholder="Filtrar ubicación"
            className="rounded-lg border px-3 py-2 text-sm"
            list="ubicaciones-montaje"
          />

          <datalist id="ubicaciones-montaje">
            {ubicacionesDisponibles.map((item) => (
              <option key={item} value={item} />
            ))}
          </datalist>

          <input
            value={filtroVehiculo}
            onChange={(e) => setFiltroVehiculo(e.target.value)}
            placeholder="Vehículo, matrícula o Nº"
            className="rounded-lg border px-3 py-2 text-sm"
          />

          <input
            value={filtroTexto}
            onChange={(e) => setFiltroTexto(e.target.value)}
            placeholder="Buscar stock..."
            className="rounded-lg border px-3 py-2 text-sm md:col-span-3"
          />

          <button
            type="button"
            onClick={limpiarFiltros}
            className="rounded-xl border px-4 py-2 text-sm font-semibold"
          >
            Limpiar filtros
          </button>
        </div>
      </div>

      <div className="rounded-xl border bg-white p-3 text-sm text-gray-600">
        Mostrando <strong>{lineasFiltradas.length}</strong> líneas de stock de{" "}
        <strong>{lineasPorPermisos.length}</strong> visibles.
      </div>

      <div className="rounded-xl border bg-white p-4 space-y-4">
        <div>
          <h2 className="font-semibold">Importar albaranes escaneados</h2>
          <p className="text-sm text-gray-500">
            Puedes subir un PDF con uno o varios albaranes. Se leerán, se
            marcarán duplicados y podrás validar manualmente cada salida.
          </p>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <input
            id="importar-albaran-pdf"
            type="file"
            accept="application/pdf"
            onChange={(e) =>
              seleccionarArchivoImportacion(e.target.files?.[0] || null)
            }
            className="rounded-lg border px-3 py-2 text-sm md:col-span-2"
            disabled={importandoAlbaran || guardando}
          />

          <button
            type="button"
            onClick={importarAlbaranPdf}
            className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            disabled={!archivoAlbaranImportar || importandoAlbaran || guardando}
          >
            {importandoAlbaran ? "Leyendo albaranes..." : "Importar PDF"}
          </button>
        </div>

        {archivoAlbaranImportar && (
          <p className="text-sm text-gray-700">
            PDF seleccionado: <strong>{archivoAlbaranImportar.name}</strong>
          </p>
        )}

        {albaranesPendientes.length > 0 && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-semibold">Albaranes pendientes de validar</h3>

              <button
                type="button"
                onClick={confirmarTodosValidos}
                className="rounded-xl bg-green-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                disabled={guardando || totalAlbaranesListos === 0}
              >
                Confirmar válidos ({totalAlbaranesListos})
              </button>
            </div>

            <div className="overflow-x-auto rounded-xl border">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                  <tr>
                    <th className="px-3 py-2">Estado</th>
                    <th className="px-3 py-2">Pág.</th>
                    <th className="px-3 py-2">Albarán</th>
                    <th className="px-3 py-2">Cliente</th>
                    <th className="px-3 py-2">Matrícula</th>
                    <th className="px-3 py-2">Nº Vehículo</th>
                    <th className="px-3 py-2">Producto</th>
                    <th className="px-3 py-2">Cant.</th>
                    <th className="px-3 py-2">Mensaje</th>
                    <th className="px-3 py-2">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {albaranesPendientes.map((item) => (
                    <tr key={item.uid} className="border-t align-top">
                      <td className="px-3 py-2">
                        <span
                          className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${claseEstado(
                            item.estado
                          )}`}
                        >
                          {etiquetaEstado(item.estado)}
                        </span>
                      </td>
                      <td className="px-3 py-2">{item.pagina || "-"}</td>
                      <td className="px-3 py-2 font-semibold">
                        {item.albaran || "-"}
                      </td>
                      <td className="px-3 py-2">{item.cliente || "-"}</td>
                      <td className="px-3 py-2">{item.matricula || "-"}</td>
                      <td className="px-3 py-2">
                        {item.numeroVehiculo || "-"}
                      </td>
                      <td className="px-3 py-2 min-w-64">
                        {item.producto || "-"}
                      </td>
                      <td className="px-3 py-2">{item.cantidad ?? "-"}</td>
                      <td className="px-3 py-2 min-w-56">
                        {item.mensajeEstado}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-2">
                          {item.estado === "varios_stock" && (
                            <select
                              value={item.lineaStockClave}
                              onChange={(e) =>
                                seleccionarLineaStockAlbaranPendiente(
                                  item.uid,
                                  e.target.value
                                )
                              }
                              className="rounded-lg border px-2 py-1 text-xs"
                              disabled={item.guardando || guardando}
                            >
                              <option value="">Seleccionar almacén...</option>
                              {item.lineasStockCandidatas.map((linea) => (
                                <option key={linea.clave} value={linea.clave}>
                                  {linea.ubicacion} | Stock: {linea.cantidad}
                                </option>
                              ))}
                            </select>
                          )}

                          <button
                            type="button"
                            onClick={() => cargarAlbaranPendienteEnFormulario(item)}
                            className="rounded-lg border px-3 py-1 text-xs font-semibold"
                            disabled={item.estado === "confirmado"}
                          >
                            Revisar
                          </button>

                          {item.estado === "sin_cliente" && (
                            <button
                              type="button"
                              onClick={() =>
                                crearClienteParaAlbaranPendiente(item.uid)
                              }
                              className="rounded-lg bg-blue-700 px-3 py-1 text-xs font-semibold text-white disabled:opacity-50"
                              disabled={item.guardando || guardando}
                            >
                              Crear cliente
                            </button>
                          )}

                          {item.estado === "sin_vehiculo" ||
                          (item.estado === "error" &&
                            !item.vehiculoId &&
                            item.lineaStockClave) ? (
                            <button
                              type="button"
                              onClick={() =>
                                crearVehiculoParaAlbaranPendiente(item.uid)
                              }
                              className="rounded-lg bg-orange-600 px-3 py-1 text-xs font-semibold text-white disabled:opacity-50"
                              disabled={item.guardando || guardando}
                            >
                              Crear vehículo
                            </button>
                          ) : null}

                          <button
                            type="button"
                            onClick={() => confirmarAlbaranPendiente(item.uid)}
                            className="rounded-lg bg-black px-3 py-1 text-xs font-semibold text-white disabled:opacity-50"
                            disabled={
                              item.guardando ||
                              guardando ||
                              item.estado !== "listo"
                            }
                          >
                            Confirmar
                          </button>

                          <button
                            type="button"
                            onClick={() => descartarAlbaranPendiente(item.uid)}
                            className="rounded-lg border px-3 py-1 text-xs font-semibold disabled:opacity-50"
                            disabled={
                              item.guardando ||
                              item.estado === "confirmado" ||
                              item.estado === "descartado"
                            }
                          >
                            Descartar
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

        {albaranDetectado && albaranesPendientes.length <= 1 && (
          <div className="rounded-lg bg-gray-50 p-3 text-sm text-gray-700">
            <p className="font-semibold">Datos detectados</p>
            <div className="mt-2 grid gap-2 md:grid-cols-3">
              <div>
                Albarán: <strong>{albaranDetectado.albaran || "-"}</strong>
              </div>
              <div>
                Fecha: <strong>{albaranDetectado.fecha || "-"}</strong>
              </div>
              <div>
                Matrícula:{" "}
                <strong>{albaranDetectado.matricula || "-"}</strong>
              </div>
              <div>
                Nº vehículo:{" "}
                <strong>{albaranDetectado.numeroVehiculo || "-"}</strong>
              </div>
              <div>
                Cliente: <strong>{albaranDetectado.cliente || "-"}</strong>
              </div>
              <div>
                Producto:{" "}
                <strong>{albaranDetectado.producto || "-"}</strong>
              </div>
              <div>
                Cantidad:{" "}
                <strong>{albaranDetectado.cantidad ?? "-"}</strong>
              </div>
            </div>

            {albaranDetectado.observaciones.length > 0 && (
              <p className="mt-2 text-xs text-gray-500">
                {albaranDetectado.observaciones.join(" | ")}
              </p>
            )}
          </div>
        )}
      </div>

      <div className="rounded-xl border bg-white p-4 space-y-4">
        <select
          value={empresaId}
          onChange={(e) => {
            setEmpresaId(e.target.value);
            setLineaStockClave("");
            setVehiculoId("");
            setMatriculaPendienteImportada("");
          }}
          className="w-full rounded-lg border px-3 py-2 text-sm"
          disabled={!permisos.perfil || guardando}
        >
          <option value="">Empresa...</option>
          {empresas.map((empresa) => (
            <option key={empresa.id} value={empresa.id}>
              {empresa.nombre}
            </option>
          ))}
        </select>

        <select
          value={lineaStockClave}
          onChange={(e) => {
            setLineaStockClave(e.target.value);
            setVehiculoId("");
          }}
          className="w-full rounded-lg border px-3 py-2 text-sm"
          disabled={!permisos.perfil || guardando}
        >
          <option value="">
            {permisos.perfil
              ? "Selecciona stock disponible..."
              : "Sin perfil activo..."}
          </option>
          {lineasFiltradas.map((linea) => (
            <option key={linea.clave} value={linea.clave}>
              {linea.cliente} | {linea.producto} | {linea.ubicacion} | Stock:{" "}
              {linea.cantidad}
            </option>
          ))}
        </select>

        {lineaSeleccionada && (
          <div className="rounded-lg bg-gray-50 p-3 text-sm text-gray-700">
            Cliente: <strong>{lineaSeleccionada.cliente}</strong>
            <br />
            Ubicación: <strong>{lineaSeleccionada.ubicacion}</strong>
            <br />
            Stock disponible: <strong>{lineaSeleccionada.cantidad}</strong>
          </div>
        )}

        <select
          value={vehiculoId}
          onChange={(e) => setVehiculoId(e.target.value)}
          className="w-full rounded-lg border px-3 py-2 text-sm"
          disabled={!lineaStockClave || guardando}
        >
          <option value="">Vehículo...</option>
          {vehiculosFiltrados.map((vehiculo) => (
            <option key={vehiculo.id} value={vehiculo.id}>
              {textoVehiculo(vehiculo)}
            </option>
          ))}
        </select>

        {mostrarAvisoVehiculoNoEncontrado && lineaSeleccionada && (
          <div className="rounded-xl border border-orange-200 bg-orange-50 p-4 text-sm text-orange-900">
            <p className="font-semibold">
              Vehículo no encontrado: {matriculaPendienteImportada}
            </p>
            <p className="mt-1">
              El albarán ha detectado esta matrícula, pero no existe ningún
              vehículo activo con esa matrícula para el cliente{" "}
              <strong>{lineaSeleccionada.cliente}</strong>.
            </p>

            <button
              type="button"
              onClick={crearVehiculoDetectado}
              className="mt-3 rounded-xl bg-orange-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              disabled={guardando || creandoVehiculoDetectado}
            >
              {creandoVehiculoDetectado
                ? "Creando vehículo..."
                : "Crear vehículo automáticamente"}
            </button>
          </div>
        )}

        <input
          value={cantidad}
          onChange={(e) => setCantidad(e.target.value)}
          type="number"
          min="1"
          placeholder="Cantidad"
          className="w-full rounded-lg border px-3 py-2 text-sm"
          disabled={!permisos.perfil || guardando}
        />

        <select
          value={documentoTipo}
          onChange={(e) => setDocumentoTipo(e.target.value)}
          className="w-full rounded-lg border px-3 py-2 text-sm"
          disabled={!permisos.perfil || guardando}
        >
          <option value="GENES">Albarán Genes</option>
          <option value="OR_MANUAL">OR manual</option>
        </select>

        <input
          value={documentoNumero}
          onChange={(e) => setDocumentoNumero(e.target.value)}
          placeholder="Número de documento Genes u OR manual"
          className="w-full rounded-lg border px-3 py-2 text-sm"
          disabled={!permisos.perfil || guardando}
        />

        <div className="rounded-lg border bg-gray-50 p-3">
          <label className="block text-sm font-semibold">
            Adjuntar documento PDF
          </label>

          <input
            id="documento-pdf-salida"
            type="file"
            accept="application/pdf"
            onChange={(e) => seleccionarArchivoPdf(e.target.files?.[0] || null)}
            className="mt-2 w-full rounded-lg border bg-white px-3 py-2 text-sm"
            disabled={!permisos.perfil || guardando}
          />

          <p className="mt-1 text-xs text-gray-500">
            Solo PDF. Tamaño máximo recomendado: 10 MB.
          </p>

          {archivoPdf && (
            <p className="mt-2 text-sm text-gray-700">
              Documento seleccionado: <strong>{archivoPdf.name}</strong>
            </p>
          )}
        </div>

        <textarea
          value={observaciones}
          onChange={(e) => setObservaciones(e.target.value)}
          placeholder="Observaciones"
          className="w-full rounded-lg border px-3 py-2 text-sm"
          disabled={!permisos.perfil || guardando}
        />

        <button
          type="button"
          onClick={registrarSalida}
          className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          disabled={!permisos.perfil || guardando}
        >
          {guardando ? "Guardando montaje..." : "Registrar montaje manual"}
        </button>

        <button
          type="button"
          onClick={cargarDatos}
          className="ml-2 rounded-xl border px-4 py-2 text-sm font-semibold"
          disabled={guardando}
        >
          Actualizar stock disponible
        </button>

        {mensaje && <p className="text-sm text-gray-700">{mensaje}</p>}
      </div>
    </div>
  );
}