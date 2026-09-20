/**
 * La tarea de relleno: un vehículo cada veinte segundos, hasta terminar.
 *
 * El porqué del ritmo y del pendiente-desde-la-base está en `relleno.ts`. Aquí
 * está lo que tiene reloj y base de datos.
 *
 * ── Por qué ticks y no un bucle ─────────────────────────────────────────────
 *
 * Rellenar un mes de 751 autobuses a 20 s son más de cuatro horas. Un bucle
 * `for` con `await sleep(20000)` dentro sobrevive a todo menos a lo único que
 * pasa seguro: un despliegue. Cada tick es independiente y recalcula lo que
 * falta, así que un reinicio cuesta un tick, no la tarea.
 *
 * ── Una tarea por cuenta ────────────────────────────────────────────────────
 *
 * Dos rellenos a la vez sobre la misma cuenta duplican el ritmo pactado sin
 * que nadie lo haya decidido. Se guarda una tarea por (empresa, conector,
 * cuenta) y arrancar otra encima devuelve la que ya hay.
 *
 * Los módulos del Hub se importan DENTRO de las funciones: `db.ts` revienta al
 * importarse sin `DATABASE_URL`, y este fichero lo carga `index.ts` al
 * arrancar.
 */

import { claveDeMes, type Mes } from "../../integration-hub/domain/meses.ts";
import {
  clavePaso, desenlaceDe, enPalabras, intervaloValido, minutosRestantes,
  pasosPendientes, MAX_INTENTOS_POR_DEFECTO,
  type Paso,
} from "./relleno.ts";

export interface OpcionesRelleno {
  empresaId: string;
  connectorKey: string;
  accountKey: string;
  meses: Mes[];
  intervaloSegundos?: number;
  maxIntentos?: number;
  /** Rehacer también los meses que ya estén guardados. */
  forzar?: boolean;
}

export type EstadoTarea = "en_curso" | "terminada" | "parada" | "abandonada";

export interface Tarea {
  empresaId: string;
  connectorKey: string;
  accountKey: string;
  meses: string[];
  intervaloSegundos: number;
  maxIntentos: number;
  forzar: boolean;
  estado: EstadoTarea;
  iniciadaMs: number;
  ultimoTickMs: number | null;
  total: number;
  hechos: number;
  sinDatos: number;
  fallidos: number;
  pendientes: number;
  minutosRestantes: number;
  restanteEnPalabras: string;
  /** El último vehículo pedido, para poder mirar si va bien sin abrir la base. */
  ultimo: { vehiculo: string; mes: string; resultado: string } | null;
  muestraErrores: string[];
  nota?: string;
}

interface TareaViva extends Tarea {
  intentos: Map<string, number>;
  temporizador: ReturnType<typeof setInterval> | null;
  ocupado: boolean;
}

const tareas = new Map<string, TareaViva>();

const claveTarea = (empresaId: string, connectorKey: string, accountKey: string) =>
  `${empresaId}/${connectorKey}/${accountKey}`;

function aTarea(t: TareaViva): Tarea {
  const { intentos, temporizador, ocupado, ...publico } = t;
  return { ...publico };
}

/** La tarea de una cuenta, si la hay. */
export function estadoRelleno(
  empresaId: string, connectorKey: string, accountKey: string,
): Tarea | null {
  const t = tareas.get(claveTarea(empresaId, connectorKey, accountKey));
  return t ? aTarea(t) : null;
}

/** Todas las tareas vivas de una empresa. */
export function tareasDeEmpresa(empresaId: string): Tarea[] {
  return [...tareas.values()].filter((t) => t.empresaId === empresaId).map(aTarea);
}

export function pararRelleno(
  empresaId: string, connectorKey: string, accountKey: string, nota = "Parada a mano",
): Tarea | null {
  const clave = claveTarea(empresaId, connectorKey, accountKey);
  const t = tareas.get(clave);
  if (!t) return null;
  detener(t, "parada", nota);
  return aTarea(t);
}

function detener(t: TareaViva, estado: EstadoTarea, nota?: string): void {
  if (t.temporizador) clearInterval(t.temporizador);
  t.temporizador = null;
  t.estado = estado;
  if (nota) t.nota = nota;
}

/**
 * Arranca el relleno de una cuenta.
 *
 * Devuelve enseguida: lo que hace es plantar un temporizador. Si ya había una
 * tarea en curso para esa cuenta, devuelve esa y no arranca otra.
 */
export async function iniciarRelleno(op: OpcionesRelleno): Promise<Tarea> {
  const clave = claveTarea(op.empresaId, op.connectorKey, op.accountKey);
  const previa = tareas.get(clave);
  if (previa && previa.estado === "en_curso") return aTarea(previa);

  const intervaloSegundos = intervaloValido(op.intervaloSegundos);
  const maxIntentos = Math.max(1, Math.floor(op.maxIntentos ?? MAX_INTENTOS_POR_DEFECTO));

  const t: TareaViva = {
    empresaId: op.empresaId,
    connectorKey: op.connectorKey,
    accountKey: op.accountKey,
    meses: op.meses.map(claveDeMes),
    intervaloSegundos,
    maxIntentos,
    forzar: op.forzar === true,
    estado: "en_curso",
    iniciadaMs: Date.now(),
    ultimoTickMs: null,
    total: 0, hechos: 0, sinDatos: 0, fallidos: 0, pendientes: 0,
    minutosRestantes: 0, restanteEnPalabras: "nada",
    ultimo: null, muestraErrores: [],
    intentos: new Map(), temporizador: null, ocupado: false,
  };
  tareas.set(clave, t);

  // Un primer recuento antes de contestar: así quien pulsa el botón ve
  // cuántos faltan y cuánto va a tardar, en vez de un «vale» a ciegas.
  const pendientes = await calcularPendientes(t, op.meses);
  t.total = pendientes.length;
  refrescarRestante(t, pendientes.length);
  if (pendientes.length === 0) {
    detener(t, "terminada", "No faltaba ningún vehículo: el mes ya estaba completo");
    return aTarea(t);
  }

  const vuelta = () => {
    void tick(clave, op.meses).catch((e) =>
      console.error("[km-relleno]", clave, (e as any)?.message ?? e),
    );
  };
  // El primero enseguida, para poder comprobar que funciona sin esperar 20 s.
  setTimeout(vuelta, 1000);
  t.temporizador = setInterval(vuelta, intervaloSegundos * 1000);
  return aTarea(t);
}

/** Los pares (vehículo, mes) que todavía no tienen fila guardada. */
async function calcularPendientes(t: TareaViva, meses: Mes[]): Promise<Paso[]> {
  const { listVehicleMappings, listMonthlyMileageStatus } = await import(
    "../../integration-hub/infrastructure/repositories.ts"
  );

  const enlaces = (await listVehicleMappings({
    tenantId: t.empresaId, system: t.connectorKey, accountKey: t.accountKey,
  }))
    .filter((e: any) => e.active !== false)
    .map((e: any) => ({
      mobilinkId: String(e.mobilink_id),
      externalCode: String(e.external_code),
      matricula: e.metadata?.internal_plate_snapshot ?? e.metadata?.external_plate_snapshot ?? null,
    }));

  const hechos = new Set<string>();
  if (!t.forzar) {
    for (const mes of meses) {
      const estados = await listMonthlyMileageStatus({
        tenantId: t.empresaId, system: t.connectorKey, accountKey: t.accountKey,
        year: mes.year, month: mes.month,
      });
      for (const [mobilinkId, fila] of estados) {
        // `error` no cuenta como hecho: se reintenta. `ok` y `empty` sí.
        if (fila.syncStatus === "ok" || fila.syncStatus === "empty") {
          hechos.add(clavePaso({ mobilinkId, year: mes.year, month: mes.month }));
        }
      }
    }
  }

  return pasosPendientes({
    enlaces, meses, hechos, intentos: t.intentos, maxIntentos: t.maxIntentos,
  });
}

function refrescarRestante(t: TareaViva, pendientes: number): void {
  t.pendientes = pendientes;
  t.minutosRestantes = minutosRestantes(pendientes, t.intervaloSegundos);
  t.restanteEnPalabras = enPalabras(t.minutosRestantes);
}

/** Una vuelta: un vehículo, un mes, una petición. */
async function tick(clave: string, meses: Mes[]): Promise<void> {
  const t = tareas.get(clave);
  if (!t || t.estado !== "en_curso") return;
  // Un tick que se alarga no puede solaparse con el siguiente: sería pedir de
  // dos en dos sin haberlo decidido.
  if (t.ocupado) return;
  t.ocupado = true;
  try {
    const pendientes = await calcularPendientes(t, meses);
    refrescarRestante(t, pendientes.length);
    if (pendientes.length === 0) {
      detener(t, "terminada", "Todos los vehículos tienen ya su mes guardado");
      console.log(`[km-relleno] ${clave} terminado: ${t.hechos} con km, ${t.sinDatos} sin datos, ${t.fallidos} fallidos`);
      return;
    }

    const paso = pendientes[0];
    t.ultimoTickMs = Date.now();

    const { syncMonthlyMileage } = await import(
      "../../integration-hub/application/services/MonthlyMileageSyncService.ts"
    );
    const resumen = await syncMonthlyMileage({
      tenantId: t.empresaId,
      connectorKey: t.connectorKey,
      accountKey: t.accountKey,
      meses: [{ year: paso.year, month: paso.month }],
      mobilinkIds: [paso.mobilinkId],
      forzar: t.forzar,
      // Sin tope de espera: aquí no hay nadie delante de una pantalla, y
      // esperar turno es mejor que gastar un intento del vehículo.
    });

    const mes = claveDeMes({ year: paso.year, month: paso.month });
    const d = desenlaceDe(resumen);
    if (d.tipo === "ok") {
      t.hechos += 1;
      t.ultimo = { vehiculo: paso.etiqueta, mes, resultado: `${d.km ?? 0} km` };
    } else if (d.tipo === "sin_datos") {
      t.sinDatos += 1;
      t.ultimo = { vehiculo: paso.etiqueta, mes, resultado: "sin datos" };
    } else if (d.tipo === "esperar") {
      // Ni hecho ni fallido: no se llegó a preguntar. El siguiente tick vuelve.
      t.ultimo = { vehiculo: paso.etiqueta, mes, resultado: "esperando turno" };
    } else if (d.tipo === "abandonar") {
      detener(t, "abandonada", d.mensaje);
      console.warn(`[km-relleno] ${clave} abandonado: ${d.mensaje}`);
      return;
    } else {
      const k = clavePaso(paso);
      const intentos = (t.intentos.get(k) ?? 0) + 1;
      t.intentos.set(k, intentos);
      if (intentos >= t.maxIntentos) t.fallidos += 1;
      if (t.muestraErrores.length < 5) t.muestraErrores.push(`${paso.etiqueta} ${mes}: ${d.mensaje}`);
      t.ultimo = { vehiculo: paso.etiqueta, mes, resultado: `error (intento ${intentos})` };
    }
  } finally {
    t.ocupado = false;
  }
}

/** Solo para las pruebas: deja el registro limpio entre casos. */
export function olvidarTareas(): void {
  for (const t of tareas.values()) if (t.temporizador) clearInterval(t.temporizador);
  tareas.clear();
}
