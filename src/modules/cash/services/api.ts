/**
 * Cliente de la API de Mobilink Cash.
 *
 * Un único sitio donde se hace `fetch`, con las cabeceras de la sesión
 * unificada (`sessionHeaders`, el mismo mecanismo que usa el resto del panel) y
 * con los errores del backend traducidos a una excepción que lleva el código.
 * Las pantallas nunca leen `response.ok` ni parsean mensajes a mano.
 */

import { sessionHeaders } from "../../sessionHeaders";
import type {
  Ajustes,
  AperturaCartucho,
  Bootstrap,
  Caja,
  Denominacion,
  DocumentoExterno,
  DocumentoOperacion,
  EntregaDinero,
  FormaPagoConfig,
  CuentaBancariaConfig,
  IngresoBancario,
  PropuestaCanjeIngreso,
  PanelIngresos,
  PedidoCambio,
  Pendientes,
  PropuestaPedido,
  EstadoIntegracion,
  LineaDenominacion,
  Movimiento,
  Operacion,
  ResultadoArqueo,
  ResultadoCambio,
  ResumenJornada,
  SeccionConfig,
  Sesion,
  Zona,
  Centro,
} from "../types";

const BASE = "/api/cash";

/**
 * Error de la API con el código estable que devuelve el backend.
 *
 * Los campos se declaran y asignan a mano en vez de con propiedades de
 * parámetro porque el proyecto compila con `erasableSyntaxOnly`: solo se admite
 * sintaxis de TypeScript que se pueda borrar sin generar código.
 */
export class ErrorApiCaja extends Error {
  readonly codigo: string;
  readonly estado: number;
  readonly detalle?: unknown;

  constructor(codigo: string, message: string, estado: number, detalle?: unknown) {
    super(message);
    this.name = "ErrorApiCaja";
    this.codigo = codigo;
    this.estado = estado;
    this.detalle = detalle;
  }
}

async function pedir<T>(ruta: string, init?: RequestInit): Promise<T> {
  // Con FormData la cabecera la pone el navegador, que es quien conoce el
  // `boundary` del multipart. Ponerla a mano rompe la subida.
  const esFormulario = typeof FormData !== "undefined" && init?.body instanceof FormData;
  const cabeceras = await sessionHeaders(
    init?.body && !esFormulario ? { "Content-Type": "application/json" } : undefined
  );

  let res: Response;
  try {
    res = await fetch(`${BASE}${ruta}`, { ...init, headers: cabeceras });
  } catch {
    // Sin red no se puede operar la caja: es mejor decirlo tal cual que dejar
    // al usuario delante de una pantalla que no reacciona.
    throw new ErrorApiCaja("SIN_CONEXION", "No hay conexión con el servidor.", 0);
  }

  const texto = await res.text();
  const datos = texto ? JSON.parse(texto) : null;

  if (!res.ok) {
    throw new ErrorApiCaja(
      datos?.code ?? "ERROR",
      datos?.error ?? `Error ${res.status}`,
      res.status,
      datos?.detalle
    );
  }
  return datos as T;
}

const json = (body: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body) });

// ── Arranque ───────────────────────────────────────────────────────────────

export const bootstrap = () => pedir<Bootstrap>("/bootstrap");

// ── Cola de eventos hacia MC Central ───────────────────────────────────────

export type ColaEventos = {
  resumen: { estado: string; total: number }[];
  muertos: {
    id: string;
    eventId: string;
    tipo: string;
    ocurridoEnMs: number;
    intentos: number;
    lastError: string | null;
  }[];
};

export const colaEventos = () => pedir<ColaEventos>("/events");

export const reintentarEventos = () =>
  pedir<{ reencolados: number; tratados: number }>("/events/retry", json({}));

// ── Jerarquía: zonas y talleres ────────────────────────────────────────────

/**
 * Zonas y talleres de la empresa, y hasta dónde llega el usuario.
 *
 * `ambitoCentroId` no es decorativo: con valor, esta sesión solo ve y opera las
 * cajas de ese taller, y la pantalla debe decirlo en vez de dar a entender que
 * la empresa tiene una sola caja.
 */
export const jerarquia = () =>
  pedir<{ zonas: Zona[]; centros: Centro[]; ambitoCentroId: string | null }>("/hierarchy");

export const crearZona = (nombre: string) => pedir<{ zona: Zona }>("/zones", json({ nombre }));

export const actualizarZona = (id: string, datos: { nombre?: string; activa?: boolean }) =>
  pedir<{ zona: Zona }>(`/zones/${id}`, { method: "PATCH", body: JSON.stringify(datos) });

export const asignarZonaACentro = (centroId: string, zonaId: string | null) =>
  pedir<{ ok: true }>(`/centers/${centroId}/zone`, {
    method: "PATCH",
    body: JSON.stringify({ zonaId }),
  });

// ── Configuración ──────────────────────────────────────────────────────────

/** Cajas de la empresa, incluidas las dadas de baja. */
export const listarCajas = () =>
  pedir<{
    cajas: (Caja & { activa: boolean; jornadas: string; jornadaAbierta: number | null })[];
  }>("/registers");

export const crearCaja = (nombre: string, centro: string, centroId?: string | null) =>
  pedir<{ caja: Caja & { activa: boolean } }>(
    "/registers",
    json({ nombre, centro, centroId: centroId ?? null })
  );


export const actualizarCaja = (
  id: number,
  datos: {
    nombre?: string;
    centro?: string;
    /** Taller al que se asigna. `null` explícito lo desasigna. */
    centroId?: string | null;
    /** Iniciales que abren el número de sus documentos: `TAR1-IB-26-001`. */
    codigo?: string;
    activa?: boolean;
    /** Fondo fijo del cajón, en céntimos. 0 = sin fondo fijo. */
    fondoObjetivoCentimos?: number;
  }
) =>
  pedir<{ caja: Caja & { activa: boolean } }>(`/registers/${id}`, {
    method: "PATCH",
    body: JSON.stringify(datos),
  });

/** Catálogo completo, incluidas las denominaciones desactivadas. */
export const listarDenominaciones = () =>
  pedir<{ denominaciones: Denominacion[] }>("/denominations");

export const actualizarDenominacion = (
  id: number,
  datos: {
    activa?: boolean;
    piezasPorCartucho?: number | null;
    piezasPorBolsa?: number | null;
  }
) =>
  pedir<{ denominacion: Denominacion }>(`/denominations/${id}`, {
    method: "PATCH",
    body: JSON.stringify(datos),
  });

/** Sube la foto del billete o de la moneda y devuelve la fila ya con su URL. */
export const subirImagenDenominacion = (id: number, fichero: File) => {
  const cuerpo = new FormData();
  cuerpo.append("imagen", fichero);
  return pedir<{ denominacion: Denominacion }>(`/denominations/${id}/image`, {
    method: "POST",
    body: cuerpo,
  });
};

/** Recorta el fondo de las fotos ya subidas, sin tener que volver a subirlas. */
export const recortarImagenesDenominaciones = () =>
  pedir<{ recortadas: number; fallos: string[]; denominaciones: Denominacion[] }>(
    "/denominations/images/rebuild",
    { method: "POST" }
  );

export const quitarImagenDenominacion = (id: number) =>
  pedir<{ denominacion: Denominacion }>(`/denominations/${id}/image`, { method: "DELETE" });

/** Catálogo de formas de pago, incluidas las dadas de baja. */
export const listarFormasPago = () =>
  pedir<{ formasPago: FormaPagoConfig[] }>("/payment-methods");

export const crearFormaPago = (datos: {
  nombre: string;
  codigo?: string;
  pideReferencia?: boolean;
  enCobros?: boolean;
  enPagos?: boolean;
  orden?: number;
}) => pedir<{ forma: FormaPagoConfig }>("/payment-methods", json(datos));

export const actualizarFormaPago = (
  id: number,
  datos: {
    nombre?: string;
    activa?: boolean;
    pideReferencia?: boolean;
    enCobros?: boolean;
    enPagos?: boolean;
    orden?: number;
    /** `null` quita la imagen; omitirlo la deja como está. */
    imagenUrl?: string | null;
  }
) =>
  pedir<{ forma: FormaPagoConfig }>(`/payment-methods/${id}`, {
    method: "PATCH",
    body: JSON.stringify(datos),
  });

/** Sube la imagen del botón y devuelve la forma ya con su URL. */
export const subirImagenFormaPago = (id: number, fichero: File) => {
  const cuerpo = new FormData();
  cuerpo.append("imagen", fichero);
  return pedir<{ forma: FormaPagoConfig }>(`/payment-methods/${id}/image`, {
    method: "POST",
    body: cuerpo,
  });
};

// ── Justificantes escaneados ───────────────────────────────────────────────

export const documentosDeOperacion = (operationId: number) =>
  pedir<{ documentos: DocumentoOperacion[] }>(`/operations/${operationId}/documents`);

/**
 * Sube el PDF del escáner a una operación YA registrada.
 *
 * Va en su propia petición a propósito: si falla, el cobro sigue registrado y
 * solo queda volver a adjuntar desde el histórico.
 */
export const adjuntarDocumento = (operationId: number, fichero: File) => {
  const cuerpo = new FormData();
  cuerpo.append("documento", fichero);
  return pedir<{ documento: DocumentoOperacion }>(`/operations/${operationId}/documents`, {
    method: "POST",
    body: cuerpo,
  });
};

export const completarIngreso = (
  depositId: number,
  datos: {
    fechaIngreso?: string | null;
    referencia?: string | null;
    observaciones?: string | null;
    bankAccountId?: number | null;
  }
) =>
  // El method va DESPUÉS del spread: json() trae POST y lo pisaría.
  pedir<{ ingreso: IngresoBancario }>(`/bank-deposits/${depositId}`, {
    ...json(datos),
    method: "PATCH",
  });

export const cuentasBancarias = () =>
  pedir<{ cuentas: CuentaBancariaConfig[] }>(`/bank-accounts`);

export const crearCuentaBancaria = (datos: {
  banco: string;
  iban: string;
  alias?: string;
  porDefecto?: boolean;
}) => pedir<{ cuenta: CuentaBancariaConfig }>(`/bank-accounts`, json(datos));

export const actualizarCuentaBancaria = (
  id: number,
  cambios: {
    banco?: string;
    iban?: string;
    alias?: string;
    activa?: boolean;
    porDefecto?: boolean;
  }
) =>
  // El method va DESPUÉS del spread: json() trae POST y lo pisaría.
  pedir<{ cuenta: CuentaBancariaConfig }>(`/bank-accounts/${id}`, {
    ...json(cambios),
    method: "PATCH",
  });

export const documentosDeIngreso = (depositId: number) =>
  pedir<{ documentos: DocumentoOperacion[] }>(`/bank-deposits/${depositId}/documents`);

export const adjuntarDocumentoAIngreso = (depositId: number, fichero: File) => {
  const cuerpo = new FormData();
  cuerpo.append("documento", fichero);
  return pedir<{ documento: DocumentoOperacion }>(`/bank-deposits/${depositId}/documents`, {
    method: "POST",
    body: cuerpo,
  });
};

export const anularDocumento = (id: number, motivo: string) =>
  pedir<{ documento: DocumentoOperacion }>(`/documents/${id}/void`, json({ motivo }));

/**
 * Descarga un PDF del servidor con la sesión puesta.
 *
 * No puede ser un `<a href>`: el token viaja en la cabecera `Authorization` y
 * un enlace no puede llevarla, así que el enlace directo devolvía «Falta el
 * token de sesión». Sirve para cualquier informe: el de cierre y el resguardo
 * del ingreso comparten este camino.
 */
export async function descargarPdf(ruta: string): Promise<Blob> {
  const cabeceras = await sessionHeaders();

  let res: Response;
  try {
    res = await fetch(`${BASE}${ruta}`, { headers: cabeceras });
  } catch {
    throw new ErrorApiCaja("SIN_CONEXION", "No hay conexión con el servidor.", 0);
  }

  if (!res.ok) {
    // El error sí viene en JSON, aunque la ruta prometa un PDF.
    const texto = await res.text();
    let mensaje = "No se ha podido generar el informe.";
    let codigo = "ERROR";
    try {
      const datos = JSON.parse(texto);
      mensaje = datos?.error ?? mensaje;
      codigo = datos?.code ?? codigo;
    } catch {
      /* El cuerpo no era JSON: se queda el mensaje genérico. */
    }
    throw new ErrorApiCaja(codigo, mensaje, res.status);
  }

  return res.blob();
}

// ── Ingresos bancarios ─────────────────────────────────────────────────────

export const panelIngresos = (registerId: number) =>
  pedir<PanelIngresos>(`/registers/${registerId}/bank-deposits`);

/**
 * Qué se puede ingresar de verdad y qué canje lo mejoraría.
 *
 * El desglose sale del libro mayor, no de redondear el total: lo que va al
 * banco son los billetes que hay en el montón, y las monedas hay que cambiarlas
 * antes por billetes del cajón.
 */
export const proponerCanjeIngreso = (registerId: number, sessionIds: readonly number[]) =>
  pedir<PropuestaCanjeIngreso>(
    `/registers/${registerId}/bank-deposits/swap` +
      (sessionIds.length > 0 ? `?cierres=${sessionIds.join(",")}` : "")
  );

export const registrarCanjeIngreso = (datos: {
  registerId: number;
  sessionIds: number[];
  monedasEntregadas: LineaDenominacion[];
  billetesEntregados: LineaDenominacion[];
  billetesRecibidos: LineaDenominacion[];
}) => pedir<{ operacionId: number; numero: string }>("/bank-deposits/swap", json(datos));

export const crearIngresoBancario = (datos: {
  registerId: number;
  sessionIds: number[];
  importeCentimos: number;
  fechaIngreso?: string;
  referencia?: string;
  observaciones?: string;
}) => pedir<{ ingreso: IngresoBancario }>("/bank-deposits", json(datos));

export const anularIngresoBancario = (id: number, motivo: string) =>
  pedir<{ ingreso: IngresoBancario }>(`/bank-deposits/${id}/void`, json({ motivo }));

// ── Tesorería: cambio al banco y entregas de dinero ────────────────────────

export const tesoreria = (registerId: number) =>
  pedir<{ pedidos: PedidoCambio[]; entregas: EntregaDinero[] }>(`/registers/${registerId}/treasury`);

/** Lo que está fuera de la caja: para los avisos de jornada y de cierre. */
export const pendientesTesoreria = (registerId: number) =>
  pedir<Pendientes>(`/registers/${registerId}/treasury/pending`);

export const proponerPedidoCambio = (sessionId: number, importeCentimos: number) =>
  pedir<PropuestaPedido>(`/sessions/${sessionId}/change-order/proposal?importe=${importeCentimos}`);

export const crearPedidoCambio = (datos: {
  sessionId: number;
  importeCentimos: number;
  solicitado: {
    valor: number;
    cantidad: number;
    cartuchos?: number;
    bolsas?: number;
    motivo?: string;
  }[];
  salida?: LineaDenominacion[];
  notas?: string;
}) => pedir<{ pedido: PedidoCambio }>("/change-orders", json(datos));

export const recibirPedidoCambio = (
  id: number,
  datos: {
    sessionId: number;
    recibido: { valor: number; cantidad: number; cartuchos?: number; bolsas?: number }[];
    diferenciaMotivo?: string;
  }
) => pedir<{ pedido: PedidoCambio }>(`/change-orders/${id}/receive`, json(datos));

export const cancelarPedidoCambio = (id: number, sessionId: number, motivo: string) =>
  pedir<{ pedido: PedidoCambio }>(`/change-orders/${id}/cancel`, json({ sessionId, motivo }));

export const entregarDinero = (datos: {
  sessionId: number;
  persona: string;
  motivo: string;
  importeCentimos: number;
  entregado: LineaDenominacion[];
  notas?: string;
}) => pedir<{ entrega: EntregaDinero }>("/advances", json(datos));

export const liquidarEntrega = (
  id: number,
  datos: {
    sessionId: number;
    gastoCentimos: number;
    devuelto?: LineaDenominacion[];
    proveedor?: string;
    facturaReferencia?: string;
    concepto?: string;
    diferenciaMotivo?: string;
  }
) => pedir<{ entrega: EntregaDinero }>(`/advances/${id}/settle`, json(datos));

// ── Jornada ────────────────────────────────────────────────────────────────

export const jornadaAbierta = (registerId: number) =>
  pedir<ResumenJornada | { sesion: null }>(`/registers/${registerId}/session`);

export const abrirJornada = (datos: {
  registerId: number;
  fondoManual?: LineaDenominacion[];
  /** Tubos precintados del fondo: `cantidad` son tubos, no monedas. */
  fondoCartuchos?: LineaDenominacion[];
  /** Bolsas precintadas del fondo: `cantidad` son bolsas, no monedas. */
  fondoBolsas?: LineaDenominacion[];
  motivoFondoManual?: string;
  /** Fecha contable `YYYY-MM-DD`. Omitida, hoy. Sirve para meter días pasados. */
  fecha?: string;
  /** Confirmación explícita si esa caja ya tiene una jornada ese día. */
  permitirFechaRepetida?: boolean;
  notas?: string;
}) => pedir<{ sesion: Sesion; stock: LineaDenominacion[] }>("/sessions", json(datos));

export const detalleJornada = (sessionId: number) =>
  pedir<ResumenJornada & { operaciones: Operacion[]; arqueos: unknown[] }>(`/sessions/${sessionId}`);

export const stockJornada = (sessionId: number) =>
  pedir<{
    lineas: LineaDenominacion[];
    sueltas: LineaDenominacion[];
    cartuchos: LineaDenominacion[];
    bolsas: LineaDenominacion[];
    totalCentimos: number;
    piezas: number;
  }>(`/sessions/${sessionId}/stock`);

export const movimientosJornada = (sessionId: number) =>
  pedir<{ movimientos: Movimiento[] }>(`/sessions/${sessionId}/movements`);

export const reabrirJornada = (sessionId: number, motivo: string) =>
  pedir<{ sesion: Sesion }>(`/sessions/${sessionId}/reopen`, json({ motivo }));

export const anularJornada = (sessionId: number, motivo: string) =>
  pedir<{ sesion: Sesion }>(`/sessions/${sessionId}/void`, json({ motivo }));

export const fondoHeredable = (sessionId: number) =>
  pedir<{
    candidato: {
      sesionId: number;
      fecha: string;
      totalCentimos: number;
      composicion: LineaDenominacion[];
    } | null;
  }>(`/sessions/${sessionId}/inheritable-float`);

export const traerFondoDeCierre = (sessionId: number, motivo: string) =>
  pedir<{ sesion: Sesion }>(`/sessions/${sessionId}/inherit-float`, json({ motivo }));

/**
 * Propuesta de cambio. Es una consulta: no reserva nada, y por eso la
 * confirmación vuelve a validar en el servidor con la jornada bloqueada.
 */
export const proponerCambio = (
  sessionId: number,
  importeCentimos: number,
  /** Denominaciones que no se pueden proponer: las que acaban de entrar. */
  excluirValores?: readonly number[]
) =>
  pedir<ResultadoCambio>(
    `/sessions/${sessionId}/change?importe=${importeCentimos}` +
      (excluirValores && excluirValores.length > 0 ? `&excluir=${excluirValores.join(",")}` : "")
  );

/**
 * Cambio de moneda en mostrador: entra dinero y sale el mismo importe en otras
 * piezas. En los dos sentidos — un billete por monedas, o monedas por billete.
 */
export const darCambio = (datos: {
  sessionId: number;
  importeCentimos: number;
  recibido: LineaDenominacion[];
  entregado: LineaDenominacion[];
  concepto?: string;
}) => pedir<RespuestaOperacion>("/exchange", json(datos));

// ── Operaciones ────────────────────────────────────────────────────────────

export type RespuestaOperacion = {
  operacionId: number;
  numero: string;
  efectivoNetoCentimos: number;
  stock: LineaDenominacion[];
  totalStockCentimos: number;
  erpSyncStatus: string;
  /** Cartuchos que ha habido que abrir para poder entregar. */
  aperturas: AperturaCartucho[];
};

export const registrarCobro = (datos: {
  sessionId: number;
  importeCentimos: number;
  formasPago: { forma: string; importe: number; referencia?: string | null }[];
  efectivoRecibido?: LineaDenominacion[];
  cambioManual?: LineaDenominacion[];
  partyNombre?: string;
  concepto?: string;
  referencia?: string | null;
  documentoId?: number | null;
  externalSystem?: string | null;
  externalDocumentId?: string | null;
  externalDocumentReference?: string | null;
  /** Sección de negocio del cobro (taller, gasolinera…). */
  sectionId?: number | null;
}) => pedir<RespuestaOperacion>("/collections", json(datos));

export const registrarPago = (datos: {
  sessionId: number;
  importeCentimos: number;
  formasPago: { forma: string; importe: number; referencia?: string | null }[];
  efectivoEntregado?: LineaDenominacion[];
  /** Vuelta que devuelve el proveedor cuando se paga con un billete de más. */
  efectivoRecibido?: LineaDenominacion[];
  partyNombre?: string;
  concepto?: string;
  referencia?: string | null;
  documentoId?: number | null;
  externalSystem?: string | null;
  externalDocumentId?: string | null;
}) => pedir<RespuestaOperacion>("/payments", json(datos));

export const registrarMovimiento = (datos: {
  sessionId: number;
  tipo: "MANUAL_IN" | "MANUAL_OUT" | "CASH_DELIVERY" | "BANK_DEPOSIT" | "ADJUSTMENT";
  importeCentimos: number;
  efectivo: LineaDenominacion[];
  /** Tubos precintados que entran o salen sin abrirse. */
  cartuchos?: LineaDenominacion[];
  /** Bolsas precintadas que entran o salen sin abrirse. */
  bolsas?: LineaDenominacion[];
  concepto?: string;
  partyNombre?: string;
  referencia?: string | null;
}) => pedir<RespuestaOperacion>("/movements", json(datos));

export const anularOperacion = (operationId: number, motivo: string) =>
  pedir<{ operacionId: number; numero: string }>(`/operations/${operationId}/reverse`, json({ motivo }));

// ── Arqueo y cierre ────────────────────────────────────────────────────────

export const guardarArqueo = (
  sessionId: number,
  datos: {
    contado: LineaDenominacion[];
    cartuchos?: LineaDenominacion[];
    bolsas?: LineaDenominacion[];
    tipo?: "INTERMEDIATE" | "CLOSING";
    notas?: string;
  }
) => pedir<ResultadoArqueo>(`/sessions/${sessionId}/count`, json(datos));

export const proponerCierre = (sessionId: number, objetivoCentimos: number) =>
  pedir<{
    cambioFinal: LineaDenominacion[];
    cambioFinalCartuchos: LineaDenominacion[];
    cambioFinalBolsas: LineaDenominacion[];
    ingresoBancario: LineaDenominacion[];
    ingresoBancarioCartuchos: LineaDenominacion[];
    ingresoBancarioBolsas: LineaDenominacion[];
  }>(
    `/sessions/${sessionId}/closing-proposal?objetivo=${objetivoCentimos}`
  );

export const cerrarJornada = (
  sessionId: number,
  datos: {
    cambioFinal: LineaDenominacion[];
    cambioFinalCartuchos?: LineaDenominacion[];
    cambioFinalBolsas?: LineaDenominacion[];
    arqueoId?: number;
    notas?: string;
    /** Confirmación explícita para dejar la caja a cero teniendo fondo fijo. */
    permitirCajaVacia?: boolean;
  }
) =>
  pedir<{
    sesion: Sesion;
    cambioFinal: LineaDenominacion[];
    ingresoBancario: LineaDenominacion[];
    totalCambioCentimos: number;
    totalIngresoCentimos: number;
    diferenciaCentimos: number;
    denominacionesCuadran: boolean;
  }>(`/sessions/${sessionId}/close`, json(datos));

// ── Histórico y documentos ─────────────────────────────────────────────────

export const historico = (filtros: {
  desde?: string;
  hasta?: string;
  registerId?: number;
  estado?: string;
}) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(filtros)) if (v) q.set(k, String(v));
  return pedir<{ sesiones: Record<string, unknown>[] }>(`/sessions?${q}`);
};

/**
 * Justificantes de la jornada entera: el taco de facturas escaneado de una vez,
 * el resguardo del banco. No cuelgan de ninguna operación porque no son de
 * ninguna, y se admiten varios.
 */
export const documentosDeJornada = (sessionId: number) =>
  pedir<{ documentos: DocumentoOperacion[] }>(`/sessions/${sessionId}/documents`);

export const adjuntarDocumentoAJornada = (sessionId: number, fichero: File) => {
  const cuerpo = new FormData();
  cuerpo.append("documento", fichero);
  return pedir<{ documento: DocumentoOperacion }>(`/sessions/${sessionId}/documents`, {
    method: "POST",
    body: cuerpo,
  });
};

export const documentos = (tipo: "RECEIVABLE" | "PAYABLE", q = "") =>
  pedir<{ documentos: DocumentoExterno[] }>(
    `/documents?tipo=${tipo}${q ? `&q=${encodeURIComponent(q)}` : ""}`
  );

// ── Integración ERP ────────────────────────────────────────────────────────

export const estadoErp = () =>
  pedir<{
    estado: EstadoIntegracion;
    connectorKey: string | null;
    displayName: string | null;
    capacidades: string[];
    conectoresDisponibles: string[];
    documentosRecibidos: number;
    outbox: Record<string, number>;
    errores: Record<string, unknown>[];
    config: Record<string, unknown> | null;
  }>("/erp/status");

export const probarErp = () => pedir<{ ok: boolean; mensaje: string }>("/erp/test", json({}));
export const sincronizarErp = () => pedir<{ importados: number }>("/erp/sync", json({}));
export const reintentarErp = () =>
  pedir<{ reencolados: number; tratados: number }>("/erp/retry", json({}));

export const guardarConfigErp = (datos: {
  connectorKey: string;
  activo: boolean;
  centro?: string;
  permiteCobroParcial?: boolean;
}) => pedir<{ config: Record<string, unknown> }>("/erp/config", { method: "PUT", body: JSON.stringify(datos) });

// ── Ajustes del módulo ─────────────────────────────────────────────────────

/** Sube la imagen del botón «Mixto» y devuelve los ajustes ya actualizados. */
export const subirImagenMixto = (fichero: File) => {
  const cuerpo = new FormData();
  cuerpo.append("imagen", fichero);
  return pedir<{ ajustes: Ajustes }>("/settings/mixed-image", { method: "POST", body: cuerpo });
};

export const quitarImagenMixto = () =>
  pedir<{ ajustes: Ajustes }>("/settings/mixed-image", { method: "DELETE" });

// ── Secciones de negocio ───────────────────────────────────────────────────

export const listarSecciones = () => pedir<{ secciones: SeccionConfig[] }>("/sections");

export const crearSeccion = (datos: { nombre: string; orden?: number }) =>
  pedir<{ seccion: SeccionConfig }>("/sections", json(datos));

export const actualizarSeccion = (
  id: number,
  datos: {
    nombre?: string;
    activa?: boolean;
    porDefecto?: boolean;
    arqueaAparte?: boolean;
    orden?: number;
  }
) =>
  pedir<{ seccion: SeccionConfig }>(`/sections/${id}`, {
    method: "PATCH",
    body: JSON.stringify(datos),
  });

/** Reclasifica una operación: le cambia la sección. `null` la deja sin ninguna. */
export const cambiarSeccionOperacion = (operationId: number, sectionId: number | null) =>
  pedir<{ operacionId: number; sectionId: number | null; seccionNombre: string | null }>(
    `/operations/${operationId}/section`,
    { method: "PATCH", body: JSON.stringify({ sectionId }) }
  );

/**
 * Regulariza la caja contra el último arqueo: deja el teórico igual a lo
 * contado y escribe la diferencia como ajuste auditado.
 */
export const regularizarArqueo = (sessionId: number, motivo?: string) =>
  pedir<{
    operacionId: number;
    numero: string;
    diferenciaCentimos: number;
    arqueoId: number;
  }>(`/sessions/${sessionId}/regularize`, json({ motivo }));
