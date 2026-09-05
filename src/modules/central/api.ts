/**
 * Cliente HTTP de MC Central.
 *
 * Misma forma que el de la caja: `Authorization: Bearer` de la sesión unificada
 * y un solo sitio donde se traduce un error del servidor a un mensaje. La
 * empresa NO viaja en ninguna llamada — la resuelve el servidor desde la
 * sesión, y ése es justo el motivo por el que no se puede falsear desde aquí.
 */

import { sessionHeaders } from "../sessionHeaders";

const BASE = "/api/central";

async function pedir<T>(ruta: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${BASE}${ruta}`, {
    ...init,
    // `sessionHeaders` es asíncrono: refresca el token si hace falta antes de
    // devolverlo. Sin el await se manda un Promise como cabecera y el servidor
    // contesta 401 sin que se entienda por qué.
    headers: {
      "Content-Type": "application/json",
      ...(await sessionHeaders()),
      ...(init?.headers ?? {}),
    },
  });
  const cuerpo = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(cuerpo?.error || `Error ${r.status}`);
  return cuerpo as T;
}

const json = (b: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(b) });

export type CajaEnRed = {
  registerId: number;
  centroId: string | null;
  centroNombre: string | null;
  nombre: string | null;
  codigo: string | null;
  jornadaAbiertaId: number | null;
  ultimaActividadMs: number | null;
  ultimaFechaCerrada: string | null;
  diasSinCerrar: number | null;
  ingresadoCentimos: number;
};

export type ResumenRed = {
  cajas: number;
  jornadasAbiertas: number;
  descuadres: number;
  descuadreCentimos: number;
  cobradoHoyCentimos: number;
  eventosTardios: number;
};

export type Zona = { id: string; nombre: string; activa: boolean; centros: number };
export type Centro = { id: string; nombre: string; zonaId: string | null; activo: boolean };

export type JornadaEnRed = {
  sessionId: number;
  registerId: number;
  caja: string | null;
  codigo: string | null;
  centro: string | null;
  fecha: string | null;
  estado: string | null;
  operaciones: number;
  cobrosCentimos: number;
  pagosCentimos: number;
  efectivoNetoCentimos: number;
  contadoCentimos: number | null;
  diferenciaCentimos: number | null;
  ingresoBancarioCentimos: number | null;
  anulaciones: number;
  reaperturas: number;
};

export type PosicionGlobal = {
  enCajonesCentimos: number;
  enTransitoCentimos: number;
  enTransitoBancoCentimos: number;
  enTransitoPersonasCentimos: number;
  transitosAbiertos: number;
  /** Cierres sin conciliar MENOS lo repuesto al cajón: el neto que dice la caja. */
  pendienteBancoCentimos: number;
  /** Lo repuesto y sin ingresar. Ya viene restado de `pendienteBancoCentimos`. */
  repuestoCentimos: number;
  /** Monedas que el banco no admitió y se quedaron en la tienda. */
  remanenteCentimos: number;
  totalCentimos: number;
};

export type TransitoAbierto = {
  clase: string;
  documentoId: number;
  numero: string | null;
  caja: string | null;
  centro: string | null;
  responsable: string | null;
  importeCentimos: number;
  abiertoEnMs: number | null;
  dias: number | null;
};

export const posicion = () =>
  pedir<{ posicion: PosicionGlobal; transitos: TransitoAbierto[] }>("/position");

export type IngresoEnRed = {
  depositId: number;
  numero: string | null;
  fecha: string | null;
  referencia: string | null;
  caja: string | null;
  centro: string | null;
  importeCentimos: number;
  totalCierresCentimos: number;
  remanenteNuevoCentimos: number;
  estado: string;
  anuladoMotivo: string | null;
  origen: { sessionId: number; fecha: string | null; importeCentimos: number }[];
};

export type PendienteDeIngresar = {
  registerId: number;
  caja: string | null;
  centro: string | null;
  jornadas: number;
  centimos: number;
  desde: string | null;
  dias: number | null;
};

export type FiltrosIngresos = {
  centroId?: string | null;
  registerId?: number | null;
  desde?: string | null;
  hasta?: string | null;
};

export const ingresos = (f: FiltrosIngresos = {}) => {
  const q = new URLSearchParams();
  if (f.centroId) q.set("centroId", f.centroId);
  if (f.registerId) q.set("registerId", String(f.registerId));
  if (f.desde) q.set("desde", f.desde);
  if (f.hasta) q.set("hasta", f.hasta);
  const cola = q.toString();
  return pedir<{ ingresos: IngresoEnRed[]; pendiente: PendienteDeIngresar[] }>(
    `/deposits${cola ? `?${cola}` : ""}`
  );
};

export type CambioPorPieza = {
  valorCentimos: number;
  cantidad: number;
  importeCentimos: number;
  cajasSinNinguna: number;
};

export type CajaSinCambio = {
  registerId: number;
  caja: string | null;
  centro: string | null;
  calderillaCentimos: number;
  contadoEnMs: number | null;
};

export type DescuadrePorPieza = { valorCentimos: number; diferencia: number; cajas: number };

export const cambio = () =>
  pedir<{
    piezas: CambioPorPieza[];
    cajas: CajaSinCambio[];
    descuadres: DescuadrePorPieza[];
  }>("/change");

export type Regla = {
  id: string;
  tipo: string;
  ambito: string;
  ambitoId: string | null;
  umbral: number;
  activa: boolean;
};

export type Incidencia = {
  id: string;
  tipo: string;
  registerId: number;
  caja: string | null;
  sessionId: number | null;
  umbral: number;
  valor: number;
  estado: string;
  nota: string | null;
  abiertaEnMs: number;
  cerradaMotivo: string | null;
  ambitoRegla: string | null;
};

export const alertas = (todas = false) =>
  pedir<{ incidencias: Incidencia[]; reglas: Regla[]; permisos: string[] }>(
    `/alerts${todas ? "?todas=1" : ""}`
  );

export const evaluarAhora = () =>
  pedir<{ abiertas: number; cerradas: number; evaluadas: number }>("/alerts/evaluate", json({}));

export const guardarRegla = (r: {
  tipo: string;
  ambito: string;
  ambitoId?: string | null;
  umbral: number;
  activa?: boolean;
}) => pedir<{ regla: Regla }>("/rules", json(r));

export const cambiarIncidencia = (id: string, estado: "RECONOCIDA" | "RESUELTA", nota?: string) =>
  pedir<{ ok: true }>(`/incidents/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ estado, nota }),
  });

export type CanalAviso = {
  id: string;
  canal: string;
  destino: string;
  ambito: string;
  ambitoId: string | null;
  tipos: string[];
  activo: boolean;
};

export const canales = () =>
  pedir<{
    canales: CanalAviso[];
    cola: { estado: string; total: number }[];
    smtp: boolean;
  }>("/channels");

export const guardarCanal = (c: {
  destino: string;
  ambito?: string;
  ambitoId?: string | null;
  tipos?: string[];
  activo?: boolean;
}) => pedir<{ canal: CanalAviso }>("/channels", json(c));

// ── Tesorería predictiva, salud e informes (fases 15 a 20) ─────────────────

export type PrediccionCaja = {
  registerId: number;
  calderillaActualCentimos: number;
  diasDeAutonomia: number | null;
  faltaCentimos: number;
  irAlBancoAntesDe: string | null;
  confianza: "ALTA" | "MEDIA" | "SIN_DATOS";
  explicacion: string;
  porDia: { fecha: string; esperadoCentimos: number; base: "DIA" | "MEDIA" }[];
};

export const prediccion = (dias = 7) =>
  pedir<{ cajas: PrediccionCaja[] }>(`/forecast?dias=${dias}`);

export type MotivoPuntuacion = { factor: string; puntos: number; detalle: string };

export type PuntuacionCaja = {
  registerId: number;
  puntos: number | null;
  nivel: string;
  motivos: MotivoPuntuacion[];
  caja: string | null;
  centro: string | null;
};

export const puntuacion = () =>
  pedir<{
    puntos: number | null;
    conDatos: number;
    sinDatos: number;
    peores: PuntuacionCaja[];
  }>("/score");

export type Traslado = {
  desdeRegisterId: number;
  haciaRegisterId: number;
  piezas: { valor: number; cantidad: number }[];
  importeCentimos: number;
  motivo: string;
};

export const reparto = (dias = 7) =>
  pedir<{
    traslados: Traslado[];
    alBanco: { registerId: number; piezas: { valor: number; cantidad: number }[] }[];
    cajas: number;
  }>(`/redistribution?dias=${dias}`);

export type EstadoCola = {
  nombre: string;
  pendientes: number;
  enError: number;
  retrasoMinutos: number | null;
  estado: "OK" | "RETRASO" | "ATASCADA";
};

export const salud = () =>
  pedir<{
    estado: "OK" | "DEGRADADO" | "ATASCADO";
    baseDeDatosMs: number;
    colas: EstadoCola[];
    ultimoEventoRecibidoMs: number | null;
  }>("/health");

export type Kpis = {
  desde: string;
  hasta: string;
  jornadas: number;
  efectivoCentimos: number;
  descuadreCentimos: number;
  jornadasConDescuadre: number;
  diasHastaElBanco: number | null;
  centros: {
    centroId: string | null;
    centro: string | null;
    jornadas: number;
    efectivoCentimos: number;
    descuadreCentimos: number;
  }[];
};

export const kpis = (desde?: string, hasta?: string) => {
  const q = new URLSearchParams();
  if (desde) q.set("desde", desde);
  if (hasta) q.set("hasta", hasta);
  return pedir<Kpis>(`/kpis${q.toString() ? `?${q}` : ""}`);
};

/** La exportación no pasa por `pedir`: es un fichero, no JSON. */
export const urlExportacion = (desde?: string, hasta?: string) => {
  const q = new URLSearchParams();
  if (desde) q.set("desde", desde);
  if (hasta) q.set("hasta", hasta);
  return `/api/central/reports/sessions.csv${q.toString() ? `?${q}` : ""}`;
};

export const red = () =>
  pedir<{
    resumen: ResumenRed;
    cajas: CajaEnRed[];
    zonas: Zona[];
    centros: Centro[];
    permisos: string[];
  }>("/network");

export const jornadas = (f: {
  desde?: string;
  hasta?: string;
  centroId?: string;
  descuadres?: boolean;
}) => {
  const q = new URLSearchParams();
  if (f.desde) q.set("desde", f.desde);
  if (f.hasta) q.set("hasta", f.hasta);
  if (f.centroId) q.set("centroId", f.centroId);
  if (f.descuadres) q.set("descuadres", "1");
  return pedir<{ jornadas: JornadaEnRed[] }>(`/sessions?${q.toString()}`);
};

export const crearZona = (nombre: string) => pedir<{ zona: Zona }>("/zones", json({ nombre }));

export const actualizarZona = (id: string, datos: { nombre?: string; activa?: boolean }) =>
  pedir<{ zona: Zona }>(`/zones/${id}`, { method: "PATCH", body: JSON.stringify(datos) });

export const asignarZona = (centroId: string, zonaId: string | null) =>
  pedir<{ ok: true }>(`/centers/${centroId}/zone`, {
    method: "PATCH",
    body: JSON.stringify({ zonaId }),
  });

/**
 * Vuelve a pedirle a la caja que cuente sus ingresos. No cambia nada en la
 * caja: repara lo que Central no llegó a ver.
 */
export const reemitirIngresos = (f: { centroId?: string | null; registerId?: number | null }) =>
  pedir<{ reenviados: number; reposiciones: number }>("/deposits/resync", json({
    centroId: f.centroId ?? null,
    registerId: f.registerId ?? null,
  }));

/**
 * El resguardo del ingreso, por la API de Central y no por la de la caja: un
 * supervisor de red puede no tener `cash.view`, y el PDF es el mismo.
 */
export async function resguardoIngreso(depositId: number): Promise<Blob> {
  const r = await fetch(`${BASE}/deposits/${depositId}/report.pdf`, {
    headers: await sessionHeaders(),
  });
  if (!r.ok) {
    // El error viene en JSON aunque la ruta prometa un PDF.
    const cuerpo = await r.json().catch(() => ({}));
    throw new Error(cuerpo?.error || `Error ${r.status}`);
  }
  return r.blob();
}

/** Un piso más abajo del árbol: qué taller es el de esta caja. */
export const asignarCentro = (registerId: number, centroId: string | null) =>
  pedir<{ ok: true }>(`/registers/${registerId}/center`, {
    method: "PATCH",
    body: JSON.stringify({ centroId }),
  });
