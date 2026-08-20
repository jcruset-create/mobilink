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
  pendienteBancoCentimos: number;
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

export const ingresos = () =>
  pedir<{ ingresos: IngresoEnRed[]; pendiente: PendienteDeIngresar[] }>("/deposits");

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
