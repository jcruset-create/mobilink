/**
 * Cliente de los kilómetros mensuales.
 *
 * Todo por el backend: los km salen de nuestra base, y la sincronización
 * manual la hace el servidor con la credencial del cliente, que aquí no entra.
 */

import { authHeaders } from "./data";

const API = import.meta.env.PROD ? "" : "http://localhost:4000";
const RAIZ = `${API}/api/tyrecontrol/kilometraje-mensual`;

export interface MesKilometraje {
  year: number;
  month: number;
  km: number | null;
  estado: "ok" | "empty" | "error";
  cerrado: boolean;
  odometroInicial: number | null;
  odometroFinal: number | null;
  sincronizadoMs: number;
  error: string | null;
}

export interface KilometrajeVehiculo {
  vehiculoId: string;
  empresaId: string;
  /** La empresa tiene alguna cuenta de telemática. Sin ella, no hay bloque. */
  hayTelemetria: boolean;
  meses: MesKilometraje[];
  mesActual: MesKilometraje | null;
  anioActual: { year: number; km: number; mesesConDato: number };
  mediaMensual: { km: number | null; meses: number };
}

export interface ResumenCuentaMensual {
  connectorKey: string;
  accountKey: string;
  nombre: string | null;
  zonaHoraria: string;
  unidadesPorPeticion: number;
  ritmo?: { maximo: number; ventanaMs: number };
  inicioMs: number;
  finMs: number;
  meses: string[];
  vehiculosEnlazados: number;
  vehiculosProcesados: number;
  vehiculosConKm: number;
  vehiculosSinDatos: number;
  lotes: number;
  peticiones: number;
  errores: number;
  muestraErrores: string[];
  kmTotales: number;
  abandonada?: string;
}

export interface EstadoCuenta {
  connectorKey: string;
  accountKey: string;
  nombre: string | null;
  ultimaMs: number | null;
  status: string | null;
  detalle: Partial<ResumenCuentaMensual> | null;
}

async function pedir<T>(ruta: string, opciones: RequestInit = {}): Promise<T> {
  const r = await fetch(`${RAIZ}${ruta}`, {
    ...opciones,
    headers: { "Content-Type": "application/json", ...(await authHeaders()), ...(opciones.headers ?? {}) },
  });
  const cuerpo = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((cuerpo as any)?.error ?? `Error ${r.status}`);
  return cuerpo as T;
}

export const kilometrajeDeVehiculo = (vehiculoId: string) =>
  pedir<KilometrajeVehiculo>(`/vehiculo/${encodeURIComponent(vehiculoId)}`);

export const estadoKilometraje = (empresaId?: string) =>
  pedir<{ empresaId: string; cuentas: EstadoCuenta[] }>(`/estado${empresaId ? `?empresa=${encodeURIComponent(empresaId)}` : ""}`);

export const sincronizarKilometraje = (b: {
  empresaId?: string; connectorKey: string; accountKey: string;
  desde?: { year: number; month: number }; hasta?: { year: number; month: number };
  vehiculoIds?: string[]; forzar?: boolean;
}) => pedir<{ correlationId: string; cuentas: ResumenCuentaMensual[] }>("/sincronizar", { method: "POST", body: JSON.stringify(b) });

/**
 * Una tarea de relleno lento: una unidad cada veinte segundos hasta terminar.
 * El servidor la lleva; aquí solo se arranca, se mira y se para.
 */
export interface TareaRelleno {
  empresaId: string;
  connectorKey: string;
  accountKey: string;
  meses: string[];
  intervaloSegundos: number;
  maxIntentos: number;
  forzar: boolean;
  estado: "en_curso" | "terminada" | "parada" | "abandonada";
  iniciadaMs: number;
  ultimoTickMs: number | null;
  total: number;
  hechos: number;
  sinDatos: number;
  fallidos: number;
  pendientes: number;
  minutosRestantes: number;
  restanteEnPalabras: string;
  ultimo: { vehiculo: string; mes: string; resultado: string } | null;
  muestraErrores: string[];
  nota?: string;
}

export const rellenarKilometraje = (b: {
  empresaId?: string; connectorKey: string; accountKey: string;
  desde: { year: number; month: number }; hasta: { year: number; month: number };
  intervaloSegundos?: number; forzar?: boolean;
}) => pedir<{ tarea: TareaRelleno }>("/relleno", { method: "POST", body: JSON.stringify(b) });

export const estadoRelleno = (empresaId?: string) =>
  pedir<{ empresaId: string; tareas: TareaRelleno[] }>(`/relleno${empresaId ? `?empresa=${encodeURIComponent(empresaId)}` : ""}`);

export const pararRelleno = (b: { empresaId?: string; connectorKey: string; accountKey: string }) =>
  pedir<{ tarea: TareaRelleno }>("/relleno/parar", { method: "POST", body: JSON.stringify(b) });

/** El relleno del kilometraje del histórico de revisiones. */
export interface TareaRevisiones {
  empresaId: string;
  intervaloSegundos: number;
  /** Suelo del histórico del proveedor: no se pregunta por nada anterior. */
  desde: string | null;
  /** Techo a mano, o el de la ventana diaria. */
  hasta?: string | null;
  origen?: "manual" | "diario";
  notaHorizonte: string | null;
  estado: "en_curso" | "terminada" | "parada" | "abandonada";
  iniciadaMs: number;
  ultimoTickMs: number | null;
  totalAlEmpezar: number;
  pendientes: number;
  escritas: number;
  sinLectura: number;
  rechazadas: number;
  minutosRestantes: number;
  restanteEnPalabras: string;
  ultima: { fecha: string; resultado: string } | null;
  muestraMotivos: string[];
  nota?: string;
}

export const rellenarRevisiones = (b: { empresaId?: string; intervaloSegundos?: number; desde?: string; hasta?: string }) =>
  pedir<{ tarea: TareaRevisiones }>("/revisiones", { method: "POST", body: JSON.stringify(b) });

/** El reloj que lanza el relleno de las revisiones de los últimos días cada mañana. */
export interface RelojDiario {
  ultimoLanzamientoMs: number | null;
  ventana: { desde: string; hasta: string } | null;
  pendientesAlLanzar: number | null;
  lanzadoHoy: boolean;
  ultimaVuelta: { ms: number; resultado: "lanzado" | "sin_pendientes" | "al_dia" | "ocupada" | "error"; detalle?: string } | null;
  horaLocal: number;
  diasAtras: number;
}

export const estadoRevisiones = (empresaId?: string) =>
  pedir<{ empresaId: string; tarea: TareaRevisiones | null; diario?: RelojDiario | null }>(`/revisiones${empresaId ? `?empresa=${encodeURIComponent(empresaId)}` : ""}`);

export const pararRevisiones = (b: { empresaId?: string }) =>
  pedir<{ tarea: TareaRevisiones }>("/revisiones/parar", { method: "POST", body: JSON.stringify(b) });

/** Una fila del ranking de kilómetros de la flota. */
export interface VehiculoDelRanking {
  vehiculoId: string;
  matricula: string | null;
  numeroUnidad: string | null;
  kmAnual: number | null;
  /** Sobre cuántos meses completos está hecha la cifra. Va SIEMPRE al lado. */
  meses: number;
  kmAnioActual: number;
  mesesDelAnio: number;
  kmMesActual: number | null;
  mesesSinDato: number;
  mesesConError: number;
  /** CUÁLES son esos meses: el recuento alarma, el mes es lo que se arregla. */
  mesesConErrorDetalle: Array<{ year: number; month: number; error: string | null }>;
  mesesSinDatoDetalle: Array<{ year: number; month: number }>;
}

export interface Ranking {
  empresaId: string;
  vehiculos: VehiculoDelRanking[];
  /** Activos sin ningún mes con dato: casi siempre conciliación pendiente. */
  sinDatos: Array<{ vehiculoId: string; matricula: string | null; numeroUnidad: string | null }>;
  totales: { vehiculosConDato: number; kmAnualTotal: number; kmAnualMedio: number | null };
}

/** Lo que contesta el botón de rehacer los meses que le faltan a un vehículo. */
export interface HuecosVehiculo {
  vehiculoId: string;
  matricula: string | null;
  huecos: Array<{ year: number; month: number; clase: "error" | "sin_dato" | "ausente"; error?: string | null }>;
  porClase: { error: number; sin_dato: number; ausente: number };
  pedidos: number;
  sincronizacion: unknown | null;
}

/**
 * Rehace los meses que le faltan a UN vehículo.
 *
 * Qué meses son lo decide el servidor leyendo las filas de ese vehículo: el
 * navegador no manda la lista, así que no puede mandarla mal.
 */
export const rehacerHuecosVehiculo = (b: { vehiculoId: string; empresaId?: string; incluirSinDato?: boolean }) =>
  pedir<HuecosVehiculo>("/huecos-vehiculo", { method: "POST", body: JSON.stringify(b) });

export const rankingKilometraje = (empresaId?: string) =>
  pedir<Ranking>(`/ranking${empresaId ? `?empresa=${encodeURIComponent(empresaId)}` : ""}`);

/** Lo que contesta la revisión de coherencia del histórico. */
export interface RevisionCoherencia {
  empresaId: string;
  aplicado: boolean;
  filas: number;
  vehiculos: number;
  muestra: Array<{
    mobilinkId: string;
    externalCode: string;
    year: number;
    month: number;
    km: number;
    avance: number;
  }>;
}

export const revisarCoherencia = (b: { empresaId?: string; aplicar?: boolean }) =>
  pedir<RevisionCoherencia>("/coherencia", { method: "POST", body: JSON.stringify(b) });

// El texto de los meses vive en su propio módulo, sin red, para poder
// probarlo. Se reexporta para no romper a quien ya lo importaba de aquí.
export { nombreDeMes, mesCorto, listaDeMeses, detalleDeMeses } from "./mesesEtiqueta";

// ── Km de toda la flota por meses y años (pantalla «Km de la flota») ────────
export interface MesDeFlota {
  year: number; month: number;
  kmAutenticos: number; vehiculosAutenticos: number;
  kmProvisionales: number; vehiculosProvisionales: number;
  descartados: number; kmDescartados: number; sinDato: number;
  estado: "cerrado" | "incompleto" | "en_curso";
  cuentasSinCerrar: Array<{ connectorKey: string; accountKey: string }>;
}
export interface AnoDeFlota { year: number; kmAutenticos: number; mesesCerrados: number; mediaMensual: number | null; kmProvisionales: number }
export interface KmDeFlota { empresaId: string; vehiculosActivos: number; meses: MesDeFlota[]; anos: AnoDeFlota[] }

export const kmDeFlota = (empresaId?: string) =>
  pedir<KmDeFlota>(`/flota${empresaId ? `?empresa=${encodeURIComponent(empresaId)}` : ""}`);

// ── «Probar con Movertis» un solo vehículo (no guarda nada) ────────────────
export type RespuestaPrueba =
  | { tipo: "ok"; km: number; odometroInicial: number | null; odometroFinal: number | null; viajes: number | null }
  | { tipo: "vacio" }
  | { tipo: "error"; mensaje: string }
  | { tipo: "sin_turno" };
export interface VentanaProbada {
  clave: "mes" | "q1" | "q2" | "semana" | "dia" | "anterior" | "control";
  etiqueta: string; desde: string; hasta: string; unidad: string;
  peticion: { units: number[]; initial_date: number; end_date: number };
  respuesta: RespuestaPrueba;
}
export interface PruebaVehiculo {
  vehiculoId: string; matricula: string | null;
  cuenta: { connectorKey: string; accountKey: string }; unidad: string; unidadControl: string | null;
  probadoEn: string; resultados: VentanaProbada[]; conclusion: string;
}
export const probarVehiculo = (b: { empresaId?: string; vehiculoId: string; year: number; month: number }) =>
  pedir<PruebaVehiculo>("/probar-vehiculo", { method: "POST", body: JSON.stringify(b) });

/** «Buscar los días que fallan»: el mes pedido por partes (no guarda nada). */
export interface PartePrueba {
  desde: string; hasta: string; dias: [number, number];
  resultado:
    | { tipo: "ok"; km: number; odometroInicial: number | null; odometroFinal: number | null; viajes: number | null }
    | { tipo: "error"; mensaje: string }
    | { tipo: "sin_turno" };
}
export interface PruebaPorPartes {
  vehiculoId: string; matricula: string | null; unidad: string; probadoEn: string;
  km: number | null; kmPorOdometro: number; odometroInicial: number | null; odometroFinal: number | null;
  viajes: number; diasFallidos: number[]; peticiones: number; motivo: string | null; partes: PartePrueba[];
}
export const probarVehiculoPorPartes = (b: { empresaId?: string; vehiculoId: string; year: number; month: number }) =>
  pedir<PruebaPorPartes>("/probar-vehiculo/partes", { method: "POST", body: JSON.stringify(b) });

/** «🗺 Recorrido»: los puntos de un vehículo en un día y si bastan para saber la carretera. */
export interface PruebaRecorrido {
  vehiculoId: string; matricula: string | null; unidad: string; fecha: string; desde: string; hasta: string;
  errorPuntos: string | null; kmResumen: number | null; errorResumen: string | null;
  estadistica: {
    puntos: number; primero: string | null; ultimo: string | null;
    intervaloMediana: number | null; intervaloP90: number | null; intervaloMaximo: number | null;
    huecos: number; minutosEnHuecos: number; conVelocidad: number; kmPorPuntos: number;
    veredicto: "suficiente" | "justo" | "insuficiente" | "sin_datos"; explicacion: string;
  };
  puntos: Array<{ t: number; lat: number; lng: number; velocidad: number | null }>;
}
export const probarRecorrido = (b: { empresaId?: string; vehiculoId: string; fecha: string }) =>
  pedir<PruebaRecorrido>("/probar-recorrido", { method: "POST", body: JSON.stringify(b) });

/**
 * «Ver los sensores»: qué calcula el dispositivo de este vehículo.
 *
 * Sirve para saber si de Movertis se puede sacar el ralentí. Lo decide el
 * veredicto: con horas de motor, sí y hacia atrás; con solo contacto, a base
 * de muestreos y solo de hoy en adelante; sin ninguno, no.
 */
export interface SensorDispositivo {
  nombre: string;
  valor: string | number | boolean | null;
  unidad: string | null;
  conLectura: boolean;
  interes: "ralenti" | "horas_motor" | "revoluciones" | "contacto" | null;
}
export interface SensoresVehiculo {
  vehiculoId: string; matricula: string | null; unidad: string;
  cuenta: { connectorKey: string; accountKey: string };
  pedidoEn: string;
  peticion: unknown;
  sensores: SensorDispositivo[];
  veredicto: {
    nivel: "ralenti_directo" | "horas_motor" | "revoluciones" | "solo_contacto" | "nada" | "sin_sensores";
    texto: string;
    apoyo: string[];
  };
  crudo: string;
  /** Ya redactado por el servidor, para «Copiar para Movertis». */
  texto: string;
  /** Los sensores puestos en claro. `null` si el aparato no da nada de esto. */
  lectura: LecturaAparato | null;
}

/**
 * Lo que el aparato sabe del vehículo: horas de motor, gasóleo consumido,
 * peso por eje y el estado de ahora mismo.
 *
 * `deposito` y `otros` van SIN unidad a propósito: Movertis no las documenta
 * y ponerle un «%» a un número es inventarse el dato. Lo que sí está derivado
 * —el consumo medio— se comprueba antes en el servidor.
 */
export interface LecturaAparato {
  horasMotor: number | null;
  consumidoL: number | null;
  odometroKm: number | null;
  consumoMedioL100: number | null;
  rpm: number | null;
  velocidadKmh: number | null;
  contacto: boolean | null;
  ejes: Array<{ eje: number; kg: number }>;
  pesoTotalKg: number | null;
  deposito: Array<{ nombre: string; valor: number | string | boolean }>;
  otros: Array<{ nombre: string; valor: number | string | boolean }>;
}
export const verSensores = (b: { empresaId?: string; vehiculoId: string }) =>
  pedir<SensoresVehiculo>("/sensores", { method: "POST", body: JSON.stringify(b) });

/**
 * El histórico diario de los contadores del aparato, desde nuestra base.
 *
 * Nunca llama al proveedor: lo escribe el reloj de las 04:00. Por eso esto sí
 * se puede cargar al abrir la ficha.
 */
export interface TramoAparato {
  desde: string; hasta: string;
  horasTranscurridas: number;
  horasMotor: number | null;
  litros: number | null;
  km: number | null;
  l100: number | null;
  aviso: string | null;
}
export interface HistoricoAparato {
  vehiculoId: string;
  fotos: number;
  primeraFoto: string | null;
  ultimaFoto: string | null;
  pesoUltimo: { totalKg: number | null; ejes: Array<{ eje: number; kg: number }> } | null;
  tramos: TramoAparato[];
  ultimos30: {
    tramos: number; conAviso: number;
    horasMotor: number | null; litros: number | null; km: number | null; l100: number | null;
    horasCubiertas: number;
  };
}
export const historicoAparato = (vehiculoId: string, dias = 60) =>
  pedir<HistoricoAparato>(`/lecturas/${encodeURIComponent(vehiculoId)}?dias=${dias}`);
