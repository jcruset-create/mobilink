/**
 * Tipos de Mobilink Cash en el navegador.
 *
 * Espejo de lo que devuelve `/api/cash/*`. Igual que en el servidor, **el
 * dinero son céntimos enteros**: la interfaz nunca calcula con euros en coma
 * flotante, solo formatea al pintar.
 */

export type TipoDenominacion = "BILLETE" | "MONEDA";

export type Denominacion = {
  id: number;
  valor: number;
  tipo: TipoDenominacion;
  etiqueta: string;
  piezasPorCartucho: number | null;
  activa: boolean;
  orden: number;
};

export type LineaDenominacion = { valor: number; cantidad: number };

export type Caja = { id: number; centro: string; nombre: string };

export type EstadoSesion =
  | "DRAFT"
  | "OPEN"
  | "PENDING_CLOSE"
  | "CLOSED"
  | "REOPENED"
  | "CANCELLED";

export type Sesion = {
  id: number;
  empresaId: string;
  registerId: number;
  fecha: string;
  estado: EstadoSesion;
  abiertaPor: string | null;
  abiertaAtMs: number | null;
  cerradaPor: string | null;
  cerradaAtMs: number | null;
  fondoInicialCentimos: number;
  fondoInicialHeredado: boolean;
  sesionAnteriorId: number | null;
  contadoCentimos: number | null;
  diferenciaCentimos: number | null;
  denominacionesCuadran: boolean | null;
  cambioFinalCentimos: number | null;
  ingresoBancarioCentimos: number | null;
  notas: string | null;
};

export type TipoOperacion =
  | "COLLECTION"
  | "PAYMENT"
  | "MANUAL_IN"
  | "MANUAL_OUT"
  | "CASH_DELIVERY"
  | "BANK_DEPOSIT"
  | "ADJUSTMENT"
  | "OPENING_FLOAT"
  | "CLOSING_FLOAT";

export type OrigenOperacion = "MANUAL" | "ERP" | "API" | "IMPORT" | "POS" | "OTHER";

export type FormaPago =
  | "CASH"
  | "BBVA_CARD"
  | "CAIXABANK_CARD"
  | "AMEX"
  | "BANK_TRANSFER"
  | "BIZUM"
  | "OTHER";

export type EstadoSyncErp =
  | "NOT_APPLICABLE"
  | "PENDING"
  | "SYNCING"
  | "SYNCED"
  | "ERROR"
  | "RETRY_PENDING"
  | "CANCELLED";

export type Operacion = {
  id: number;
  numero: string;
  tipo: TipoOperacion;
  origen: OrigenOperacion;
  importeCentimos: number;
  efectivoNetoCentimos: number;
  estado: string;
  erpSyncStatus: EstadoSyncErp;
  partyNombre: string;
  concepto: string;
  referencia: string | null;
  externalSystem: string | null;
  externalDocumentId: string | null;
  externalDocumentReference: string | null;
  createdAtMs: number;
};

export type Movimiento = {
  id: number;
  operationId: number | null;
  valor: number;
  cantidad: number;
  direccion: "IN" | "OUT";
  motivo: string;
  importe: number;
  createdAtMs: number;
};

/** Tubos que hay que abrir para poder entregar una combinación. */
export type AperturaCartucho = {
  valor: number;
  cartuchos: number;
  /** Monedas que salen del tubo al abrirlo. */
  piezas: number;
};

export type ResumenJornada = {
  sesion: Sesion;
  /** Piezas totales por valor, tubos incluidos. */
  stock: LineaDenominacion[];
  /** De esas piezas, cuántas están sueltas. */
  stockSueltas: LineaDenominacion[];
  /** Tubos precintados por valor de la moneda. */
  stockCartuchos: LineaDenominacion[];
  totalStockCentimos: number;
  piezas: number;
  porFormaPago: { forma: string; importeCentimos: number }[];
  cobros: { erpCentimos: number; manualCentimos: number; totalCentimos: number };
  pagos: { erpCentimos: number; manualCentimos: number; totalCentimos: number };
  salidasCentimos: number;
  entregasCentimos: number;
  operaciones: number;
  pendientesErp: number;
};

export type ResultadoCambio =
  | {
      ok: true;
      lineas: LineaDenominacion[];
      piezas: number;
      /** Vacío cuando ha bastado con las monedas sueltas. */
      aperturas: AperturaCartucho[];
    }
  | { ok: false; motivo: string; mensaje: string };

export type DiferenciaDenominacion = {
  valor: number;
  teorico: number;
  contado: number;
  diferencia: number;
  importeDiferencia: number;
};

export type ResultadoArqueo = {
  arqueoId: number;
  totalTeorico: number;
  totalContado: number;
  diferencia: number;
  estado: "CUADRADA" | "SOBRANTE" | "FALTANTE";
  cuadraImporte: boolean;
  cuadranDenominaciones: boolean;
  piezasTeoricas: number;
  piezasContadas: number;
  lineas: DiferenciaDenominacion[];
  descuadres: DiferenciaDenominacion[];
};

export type DocumentoExterno = {
  id: number;
  external_system: string;
  external_id: string;
  external_reference: string | null;
  tipo: string;
  party_nombre: string;
  numero: string;
  fecha: string | null;
  vencimiento: string | null;
  total_centimos: string | number;
  pendiente_centimos: string | number;
  estado: string;
  metadata: Record<string, unknown> | null;
};

export type EstadoIntegracion = "NO_CONFIGURADA" | "CONECTADA" | "ERROR" | "DESACTIVADA";

export type FormaPagoConfig = {
  id: number;
  /** Lo que se guarda en cada cobro. No cambia nunca. */
  codigo: string;
  nombre: string;
  /** Imagen del botón. Si no hay, el botón sale con el nombre. */
  imagenUrl: string | null;
  /** La única que mueve el cajón físico. Solo el efectivo. */
  afectaEfectivo: boolean;
  pideReferencia: boolean;
  activa: boolean;
  /** Sale como botón al cobrar. */
  enCobros: boolean;
  /** Sale como botón al pagar. */
  enPagos: boolean;
  orden: number;
  usos: number;
};

/** Justificante escaneado colgado de un cobro o un pago. */
export type DocumentoOperacion = {
  id: number;
  operationId: number;
  sessionId: number;
  nombre: string;
  mime: string;
  tamanoBytes: number;
  anulado: boolean;
  anuladoMotivo: string | null;
  subidoAtMs: number;
  /** Enlace temporal: caduca, así que no vale guardarlo en ningún sitio. */
  url: string | null;
};

// ── Ingresos bancarios ─────────────────────────────────────────────────────

/** Cierre de jornada cuyo importe "para el banco" aún no se ha ingresado. */
export type CierrePendiente = {
  sessionId: number;
  fecha: string;
  importeCentimos: number;
  cerradaPor: string | null;
  cerradaPorNombre: string | null;
  dias: number;
};

export type IngresoBancario = {
  id: number;
  numero: string;
  estado: "CONFIRMADO" | "ANULADO";
  registerId: number;
  fechaIngreso: string | null;
  referencia: string | null;
  observaciones: string | null;
  remanenteAnteriorCentimos: number;
  totalCierresCentimos: number;
  importeCentimos: number;
  remanenteNuevoCentimos: number;
  cierres: { sessionId: number; fecha: string; importeCentimos: number }[];
  creadoPor: string | null;
  creadoAtMs: number;
  anuladoAtMs: number | null;
  anuladoMotivo: string | null;
  /** Solo el último confirmado se puede anular: el remanente es una cadena. */
  esUltimo: boolean;
};

export type PanelIngresos = {
  pendientes: CierrePendiente[];
  remanenteCentimos: number;
  totalPendienteCentimos: number;
  ingresos: IngresoBancario[];
};

// ── Tesorería ──────────────────────────────────────────────────────────────

export type LineaConCartuchos = LineaDenominacion & { cartuchos: number; motivo?: string | null };

export type PedidoCambio = {
  id: number;
  numero: string;
  estado: "PENDIENTE" | "RECIBIDO" | "CANCELADO";
  registerId: number;
  importeCentimos: number;
  importeRecibidoCentimos: number | null;
  diferenciaMotivo: string | null;
  /** Lo que se le pide al banco. */
  solicitado: LineaConCartuchos[];
  /** Los billetes que salieron de la caja. */
  enviado: LineaConCartuchos[];
  /** Lo que el banco acabó dando. */
  recibido: LineaConCartuchos[];
  notas: string | null;
  creadoAtMs: number;
  cerradoAtMs: number | null;
};

export type EntregaDinero = {
  id: number;
  numero: string;
  estado: "ABIERTA" | "LIQUIDADA" | "DEVUELTA" | "CANCELADA";
  registerId: number;
  persona: string;
  motivo: string;
  importeCentimos: number;
  gastoCentimos: number | null;
  devueltoCentimos: number | null;
  diferenciaCentimos: number | null;
  diferenciaMotivo: string | null;
  facturaReferencia: string | null;
  proveedor: string | null;
  /** Pago generado al liquidar: donde se cuelga la factura del empleado. */
  operationPagoId: number | null;
  entregado: LineaDenominacion[];
  notas: string | null;
  creadoAtMs: number;
  cerradoAtMs: number | null;
};

export type LineaPropuesta = {
  valor: number;
  piezas: number;
  cartuchos: number;
  importe: number;
  /** Por qué se pide esta línea, en una frase. */
  motivo: string;
};

export type PropuestaPedido = {
  lineas: LineaPropuesta[];
  totalCentimos: number;
  sobranteCentimos: number;
  aviso: string | null;
  /** Billetes que saldrían de la caja para pagar el pedido. */
  salida: LineaDenominacion[];
  salidaPosible: boolean;
};

/** Dinero que ahora mismo no está en el cajón y se espera de vuelta. */
export type Pendientes = {
  pedidos: PedidoCambio[];
  entregas: EntregaDinero[];
  totalFueraCentimos: number;
};

export type Bootstrap = {
  denominaciones: Denominacion[];
  formasPago: FormaPagoConfig[];
  cajas: Caja[];
  permisos: string[];
  rol: string | null;
  erp: { estado: EstadoIntegracion; connectorKey: string | null; displayName: string | null };
  cambioMaximoCentimos: number;
};

/**
 * Etiquetas de respaldo de las formas de pago.
 *
 * La fuente de verdad es el catálogo de la empresa (`cash_payment_methods`),
 * que llega en el arranque. Esto solo se usa para poner nombre a un código que
 * ya no está en el catálogo —una forma borrada a mano en base de datos— para
 * que el histórico no acabe enseñando "BBVA_CARD" en crudo.
 */
export const ETIQUETA_FORMA_PAGO: Record<string, string> = {
  CASH: "Efectivo",
  BBVA_CARD: "TPV BBVA",
  CAIXABANK_CARD: "TPV CaixaBank",
  AMEX: "American Express",
  BANK_TRANSFER: "Transferencia",
  BIZUM: "Bizum",
  OTHER: "Otra",
};

export const ETIQUETA_TIPO_OPERACION: Record<TipoOperacion, string> = {
  COLLECTION: "Cobro",
  PAYMENT: "Pago",
  MANUAL_IN: "Ingreso manual",
  MANUAL_OUT: "Salida manual",
  CASH_DELIVERY: "Entrega de efectivo",
  BANK_DEPOSIT: "Ingreso bancario",
  ADJUSTMENT: "Ajuste",
  OPENING_FLOAT: "Fondo inicial",
  CLOSING_FLOAT: "Cambio final",
};

export const ETIQUETA_MOTIVO: Record<string, string> = {
  OPENING_FLOAT: "Fondo inicial",
  CUSTOMER_PAYMENT: "Entrega del cliente",
  CHANGE_GIVEN: "Cambio devuelto",
  SUPPLIER_PAYMENT: "Pago a proveedor",
  MANUAL_IN: "Ingreso manual",
  MANUAL_OUT: "Salida manual",
  CASH_DELIVERY: "Entrega de efectivo",
  BANK_DEPOSIT: "Ingreso bancario",
  ADJUSTMENT: "Ajuste",
  CLOSING_FLOAT: "Cambio final",
};

export const ETIQUETA_ESTADO_SESION: Record<EstadoSesion, string> = {
  DRAFT: "Borrador",
  OPEN: "Abierta",
  PENDING_CLOSE: "Pendiente de cierre",
  CLOSED: "Cerrada",
  REOPENED: "Reabierta",
  CANCELLED: "Anulada",
};
