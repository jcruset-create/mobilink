/**
 * El relleno de kilometraje del histórico de revisiones: una cada 20 segundos.
 *
 * ── Qué problema resuelve ───────────────────────────────────────────────────
 *
 * `kilometrajeRevision.ts` ya pone kilómetros a las revisiones que llegan del
 * CheckPoint, pero con un truco que solo vale para lo reciente: comprueba que
 * el autobús sigue parado donde estaba y atribuye el odómetro de ahora. Para
 * una revisión de marzo eso falla siempre, porque el bus lleva 20.000 km
 * desde entonces. El histórico se queda sin kilometraje, y sin él no hay
 * desgaste por 1.000 km ni «este neumático se montó a 512.480».
 *
 * Aquí el kilometraje sale de `odometroEnInstante` (Hub), que pide ventanas
 * que TERMINAN en el momento de la revisión. El porqué del método y sus tres
 * trampas están en la cabecera de `HistoricOdometerService.ts`.
 *
 * ── El ritmo y por qué ticks ────────────────────────────────────────────────
 *
 * Una revisión cada 20 s, y cada una gasta DOS peticiones —las dos ventanas
 * que tienen que coincidir—, o sea 6 por minuto. Con el relleno mensual a la
 * vez son 9 por minuto, 45 por ventana de cinco, frente a las 100 asignadas
 * de la cuota de Movertis. Cabe, y no por poco.
 *
 * 1.247 revisiones son unas 7 horas, así que vale lo mismo que en el relleno
 * mensual: no es un bucle, es una tarea con ticks que se guarda a cada vuelta
 * y se rearma sola tras un despliegue. Lo pendiente sale de los datos —una
 * revisión con `km_vehiculo` nulo—, así que reanudar es volver a preguntar.
 *
 * ── Lo que NO hace ──────────────────────────────────────────────────────────
 *
 * No pisa un kilometraje escrito a mano: el UPDATE lleva su propio
 * `is("km_vehiculo", null)`, así que si un técnico lo rellena mientras esto
 * corre, gana el técnico. No inventa: un número que no pasa las cotas no se
 * escribe y se cuenta aparte, con su motivo. Y no toca el día en curso, que
 * es el único en que el proveedor se contradice.
 */

import { ZONA_HORARIA_POR_DEFECTO } from "../../integration-hub/domain/meses.ts";
import { esCoherente, hayCotaIndependiente, instanteDeRevision } from "./coherencia.ts";
import {
  cotasDelMes, cuantasSinKm, guardarKm, revisionesSinKm, vecinasConKm, TAMANO_PAGINA,
  type RevisionPendiente,
} from "./datos.ts";
import { claveDeMes } from "../../integration-hub/domain/meses.ts";

export const INTERVALO_SEGUNDOS_POR_DEFECTO = 20;
export const INTERVALO_SEGUNDOS_MINIMO = 5;
export const MAX_INTENTOS = 3;

/** La entrada en `integration_sync_state` donde vive la tarea. */
export const ENTIDAD = "km_revisiones";

export type EstadoTarea = "en_curso" | "terminada" | "parada" | "abandonada";

export interface Tarea {
  empresaId: string;
  intervaloSegundos: number;
  /** Suelo del histórico: no se pregunta por nada anterior. `YYYY-MM-DD`. */
  desde: string | null;
  /** De dónde salió ese suelo, para que el número no aparezca por magia. */
  notaHorizonte: string | null;
  estado: EstadoTarea;
  iniciadaMs: number;
  ultimoTickMs: number | null;
  /** Las que quedaban al arrancar, para poder dibujar una barra. */
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

interface TareaViva extends Tarea {
  intentos: Map<string, number>;
  /**
   * El odómetro de hoy por vehículo, consultado una vez y guardado.
   *
   * Como TECHO vale aunque envejezca: el odómetro solo sube, así que el valor
   * de cuando se pidió es una cota más estricta que la de ahora, nunca más
   * laxa. Guardarlo evita una llamada por revisión y deja una por vehículo.
   */
  techos: Map<string, { km: number } | null>;
  temporizador: ReturnType<typeof setInterval> | null;
  ocupado: boolean;
}

const tareas = new Map<string, TareaViva>();

function publica(t: TareaViva): Tarea {
  const { intentos, techos, temporizador, ocupado, ...resto } = t;
  return { ...resto };
}

export function estadoRellenoRevisiones(empresaId: string): Tarea | null {
  const t = tareas.get(empresaId);
  return t ? publica(t) : null;
}

export function pararRellenoRevisiones(empresaId: string): Tarea | null {
  const t = tareas.get(empresaId);
  if (!t) return null;
  detener(t, "parada", "Parada a mano");
  return publica(t);
}

function detener(t: TareaViva, estado: EstadoTarea, nota?: string): void {
  if (t.temporizador) clearInterval(t.temporizador);
  t.temporizador = null;
  t.estado = estado;
  if (nota) t.nota = nota;
  // Sin esto, un reinicio reviviría algo que acaban de parar.
  void guardarTarea(t);
}

function intervaloValido(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n < INTERVALO_SEGUNDOS_MINIMO) return INTERVALO_SEGUNDOS_POR_DEFECTO;
  return Math.min(3600, Math.floor(n));
}

function enPalabras(minutos: number): string {
  if (minutos <= 0) return "nada";
  if (minutos < 60) return `${minutos} min`;
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

function refrescarRestante(t: TareaViva, pendientes: number): void {
  t.pendientes = pendientes;
  t.minutosRestantes = pendientes <= 0 ? 0 : Math.ceil((pendientes * t.intervaloSegundos) / 60);
  t.restanteEnPalabras = enPalabras(t.minutosRestantes);
}

/**
 * Averigua el suelo: o lo dice quien llama, o se le pregunta al proveedor.
 *
 * Si el sondeo falla no se inventa nada y se procesa todo, como antes: un
 * suelo equivocado dejaría revisiones sin rellenar en silencio, que es peor
 * que gastar peticiones de más.
 */
async function suelo(op: { empresaId: string; desde?: string | null }): Promise<{
  desde: string | null;
  notaHorizonte: string | null;
}> {
  if (op.desde) return { desde: op.desde, notaHorizonte: "Suelo puesto a mano" };
  try {
    const { horizonteDelProveedor } = await import(
      "../../integration-hub/application/services/HistoricOdometerService.ts"
    );
    const r = await horizonteDelProveedor(
      { tenantId: op.empresaId, correlationId: `km-rev-horizonte` },
      { zonaHoraria: ZONA_HORARIA_POR_DEFECTO },
    );
    if (r.estado === "encontrado") {
      return {
        desde: `${claveDeMes(r.mes)}-01`,
        notaHorizonte:
          `El proveedor no guarda nada anterior a ${claveDeMes(r.mes)}; ` +
          `averiguado con ${r.peticiones} consultas al arrancar.`,
      };
    }
    if (r.estado === "sin_historico") {
      return { desde: null, notaHorizonte: "El proveedor no contestó a ningún mes: se procesa todo." };
    }
    return { desde: null, notaHorizonte: `No se pudo sondear el histórico (${r.motivo}): se procesa todo.` };
  } catch (e: any) {
    return { desde: null, notaHorizonte: `No se pudo sondear el histórico (${e?.message ?? e}): se procesa todo.` };
  }
}

export async function iniciarRellenoRevisiones(op: {
  empresaId: string;
  intervaloSegundos?: number;
  /** Suelo a mano. Sin él, se le pregunta al proveedor. */
  desde?: string | null;
}): Promise<Tarea> {
  const previa = tareas.get(op.empresaId);
  if (previa && previa.estado === "en_curso") return publica(previa);

  // El suelo: hasta dónde llega el histórico del proveedor. Sin esto la tarea
  // empieza por 2021 —la revisión más antigua de Plana— y se pasa horas
  // preguntando por años que nadie puede contestar. Ver `horizonteDelProveedor`.
  const { desde, notaHorizonte } = await suelo(op);

  const t: TareaViva = {
    empresaId: op.empresaId,
    desde,
    notaHorizonte,
    intervaloSegundos: intervaloValido(op.intervaloSegundos),
    estado: "en_curso",
    iniciadaMs: Date.now(),
    ultimoTickMs: null,
    totalAlEmpezar: 0,
    pendientes: 0, escritas: 0, sinLectura: 0, rechazadas: 0,
    minutosRestantes: 0, restanteEnPalabras: "nada",
    ultima: null, muestraMotivos: [],
    intentos: new Map(), techos: new Map(), temporizador: null, ocupado: false,
  };
  tareas.set(op.empresaId, t);

  // Un recuento antes de contestar: quien pulsa el botón ve cuántas faltan y
  // cuánto va a tardar, en vez de un «vale» a ciegas.
  const quedan = await cuantasSinKm(op.empresaId, desde);
  t.totalAlEmpezar = quedan;
  refrescarRestante(t, quedan);
  if (quedan === 0) {
    detener(t, "terminada", "No había ninguna revisión sin kilometraje");
    return publica(t);
  }
  await guardarTarea(t);

  const vuelta = () => {
    void tick(op.empresaId).catch((e) =>
      console.error("[km-revisiones]", op.empresaId, (e as any)?.message ?? e),
    );
  };
  setTimeout(vuelta, 1000);
  t.temporizador = setInterval(vuelta, t.intervaloSegundos * 1000);
  return publica(t);
}

/** Una vuelta: una revisión. */
async function tick(empresaId: string): Promise<void> {
  const t = tareas.get(empresaId);
  if (!t || t.estado !== "en_curso") return;
  if (t.ocupado) return;
  t.ocupado = true;
  try {
    const siguiente = await siguientePendiente(t);
    // Lo que queda sale de la cuenta, no de otra consulta cada veinte segundos:
    // las descartadas siguen con el km vacío y la base las seguiría contando.
    refrescarRestante(
      t,
      Math.max(0, t.totalAlEmpezar - t.escritas - t.sinLectura - t.rechazadas),
    );

    if (!siguiente) {
      detener(
        t, "terminada",
        t.rechazadas + t.sinLectura > 0
          ? `Terminado: ${t.escritas} escritas, ${t.sinLectura} sin lectura, ${t.rechazadas} rechazadas por incoherentes`
          : `Terminado: ${t.escritas} revisiones con kilometraje`,
      );
      console.log(`[km-revisiones] ${empresaId} ${t.nota}`);
      return;
    }

    t.ultimoTickMs = Date.now();
    await procesar(t, siguiente);
    await guardarTarea(t);
  } finally {
    t.ocupado = false;
  }
}

/**
 * La primera pendiente que todavía se puede intentar.
 *
 * Hay que pasar de largo las descartadas: una revisión sin lectura o rechazada
 * por incoherente conserva el kilometraje vacío, así que sigue saliendo en la
 * consulta y, como se ordena por fecha, se queda amontonada al principio. Sin
 * este desplazamiento la tarea se daría por terminada con miles por delante en
 * cuanto las cincuenta primeras se descartaran.
 */
async function siguientePendiente(t: TareaViva): Promise<RevisionPendiente | null> {
  const agotada = (r: RevisionPendiente) => (t.intentos.get(r.id) ?? 0) >= MAX_INTENTOS;
  // Tope: con 1.247 revisiones son 25 páginas. 200 deja margen de sobra y evita
  // que un fallo raro convierta esto en una consulta infinita.
  for (let pagina = 0; pagina < 200; pagina++) {
    const filas = await revisionesSinKm(t.empresaId, pagina * TAMANO_PAGINA, t.desde);
    if (filas.length === 0) return null;
    const candidata = filas.find((r) => !agotada(r));
    if (candidata) return candidata;
  }
  return null;
}

/**
 * El odómetro de hoy de un vehículo, preguntado una vez por tarea.
 *
 * Se guarda incluso cuando sale `null`: un vehículo sin techo hoy no lo va a
 * tener dentro de diez minutos, y reintentarlo por cada revisión suya sería
 * gastar cupo para el mismo «no».
 */
async function techoDe(t: TareaViva, vehiculoId: string): Promise<{ km: number } | null> {
  if (t.techos.has(vehiculoId)) return t.techos.get(vehiculoId)!;
  let techo: { km: number } | null = null;
  try {
    const { odometroDeHoy } = await import(
      "../../integration-hub/application/services/VehicleOdometerService.ts"
    );
    const hoy = await odometroDeHoy(
      { tenantId: t.empresaId, correlationId: `km-rev-techo-${vehiculoId}` },
      vehiculoId,
    );
    if (hoy) techo = { km: hoy.km };
  } catch (e: any) {
    // Sin techo se sigue: es una cota menos, no un fallo del relleno.
    console.warn("[km-revisiones] no se pudo leer el odómetro de hoy:", e?.message ?? e);
  }
  t.techos.set(vehiculoId, techo);
  return techo;
}

async function procesar(t: TareaViva, r: RevisionPendiente): Promise<void> {
  const fecha = String(r.fecha_revision).slice(0, 10);
  const anotar = (motivo: string) => {
    if (t.muestraMotivos.length < 5) t.muestraMotivos.push(`${fecha}: ${motivo}`);
  };
  const fallo = () => t.intentos.set(r.id, (t.intentos.get(r.id) ?? 0) + 1);

  const cuando = instanteDeRevision(r);
  if (!cuando) {
    t.sinLectura += 1;
    t.intentos.set(r.id, MAX_INTENTOS);
    t.ultima = { fecha, resultado: "fecha ilegible" };
    anotar("la fecha de la revisión no se puede leer");
    return;
  }

  const { odometroEnInstante, ANCHURAS_DIAS } = await import(
    "../../integration-hub/application/services/HistoricOdometerService.ts"
  );
  const res = await odometroEnInstante(
    { tenantId: t.empresaId, correlationId: `km-rev-${r.id}` },
    r.vehiculo_id,
    cuando.instante,
    { zonaHoraria: ZONA_HORARIA_POR_DEFECTO },
  );

  if (res.estado !== "encontrado") {
    // `no_disponible` es un fallo del proveedor y merece reintento; el resto
    // son respuestas, y repetirlas sería gastar cupo para el mismo «no».
    if (res.estado === "no_disponible") {
      fallo();
      t.ultima = { fecha, resultado: `error (intento ${t.intentos.get(r.id)})` };
      anotar(res.motivo);
      return;
    }
    t.sinLectura += 1;
    t.intentos.set(r.id, MAX_INTENTOS);
    const motivo =
      res.estado === "discrepancia" ? res.motivo
      : res.estado === "dia_abierto" ? res.motivo
      : res.estado === "sin_telematica" ? "el vehículo no está enlazado con ninguna cuenta de telemática"
      : `el proveedor no dio odómetro en ninguna de las ventanas (${ANCHURAS_DIAS.map((d) => (d === 0 ? "día" : `${d} días`)).join(", ")}) que terminan en ese momento`;
    t.ultima = { fecha, resultado: res.estado.replace("_", " ") };
    anotar(motivo);
    return;
  }

  const km = res.odometro.odometerKm;

  // Las cotas de fuera de la API. Ver `coherencia.ts`.
  const [vecinas, mes] = await Promise.all([
    vecinasConKm(r.vehiculo_id, fecha),
    cotasDelMes(
      t.empresaId, r.vehiculo_id,
      cuando.instante.getUTCFullYear(), cuando.instante.getUTCMonth() + 1,
    ),
  ]);
  const hoy = await techoDe(t, r.vehiculo_id);
  const cotas = { ...vecinas, mes, hoy };

  // Un número respaldado por UNA sola ventana no se escribe a ciegas: hace
  // falta que alguna cota de fuera de la API lo ate. Sin ninguna, «coherente»
  // solo querría decir que no había con qué desmentirlo.
  if (res.odometro.corroboracion === "una_ventana" && !hayCotaIndependiente(cotas)) {
    t.sinLectura += 1;
    t.intentos.set(r.id, MAX_INTENTOS);
    t.ultima = { fecha, resultado: "sin corroborar" };
    anotar(
      `Odómetro ${Math.round(km).toLocaleString("es-ES")} km de una sola ventana ` +
      `(${res.odometro.ventanas.join(", ")}) y sin ninguna cota con la que comprobarlo: ` +
      "ni revisión vecina con kilómetros, ni mes sincronizado, ni odómetro de hoy.",
    );
    return;
  }

  const veredicto = esCoherente(km, cotas);
  if (veredicto.estado === "rechazado") {
    t.rechazadas += 1;
    t.intentos.set(r.id, MAX_INTENTOS);
    t.ultima = { fecha, resultado: "rechazado por incoherente" };
    anotar(veredicto.motivo);
    return;
  }

  const desfaseMin = Math.round((res.odometro.instante.getTime() - cuando.instante.getTime()) / 60000);
  const escrita = await guardarKm({
    revisionId: r.id, km, capturadoAt: res.odometro.instante, desfaseMin,
  });
  if (!escrita) {
    // Alguien lo puso a mano entre que se eligió y se escribió. Manda él.
    t.intentos.set(r.id, MAX_INTENTOS);
    t.ultima = { fecha, resultado: "ya tenía kilometraje" };
    return;
  }
  t.escritas += 1;
  t.ultima = {
    fecha,
    resultado: `${Math.round(km).toLocaleString("es-ES")} km${cuando.exacto ? "" : " (día sin hora)"}`,
  };
}

/** Deja la tarea escrita, para poder reanudarla tras un despliegue. */
async function guardarTarea(t: TareaViva): Promise<void> {
  try {
    const { upsertSyncState } = await import("../../integration-hub/infrastructure/repositories.ts");
    await upsertSyncState({
      tenantId: t.empresaId,
      entity: ENTIDAD,
      lastSyncMs: t.ultimoTickMs ?? t.iniciadaMs,
      status: t.estado,
      detail: JSON.stringify(publica(t)),
    });
  } catch (e: any) {
    console.warn("[km-revisiones] no se pudo guardar el progreso:", e?.message ?? e);
  }
}

/** Rearma los rellenos que un reinicio dejó a medias. */
export async function reanudarRellenoRevisiones(): Promise<number> {
  const { listTenantsWithConnectors, getSyncState } = await import(
    "../../integration-hub/infrastructure/repositories.ts"
  );
  const { knownTelematicsConnectorKeys } = await import(
    "../../integration-hub/connectors/ConnectorRegistry.ts"
  );

  let revividas = 0;
  for (const empresaId of await listTenantsWithConnectors(knownTelematicsConnectorKeys())) {
    try {
      const fila = await getSyncState(empresaId, ENTIDAD);
      if (!fila || fila.status !== "en_curso") continue;
      let d: any = null;
      try { d = fila.detail ? JSON.parse(String(fila.detail)) : null; } catch { d = null; }
      await iniciarRellenoRevisiones({
        empresaId, intervaloSegundos: d?.intervaloSegundos, desde: d?.desde ?? null,
      });
      const viva = tareas.get(empresaId);
      if (viva) {
        viva.nota = `Reanudada tras un reinicio; antes llevaba ${d?.escritas ?? 0} escritas`;
        await guardarTarea(viva);
      }
      revividas += 1;
      console.log(`[km-revisiones] reanudado ${empresaId}`);
    } catch (e: any) {
      console.warn("[km-revisiones] no se pudo reanudar", empresaId, e?.message ?? e);
    }
  }
  return revividas;
}

export function startRellenoRevisiones(): void {
  setTimeout(() => {
    void reanudarRellenoRevisiones()
      .then((n) => { if (n > 0) console.log(`[km-revisiones] ${n} tarea(s) reanudadas`); })
      .catch((e) => console.error("[km-revisiones]", (e as any)?.message ?? e));
  }, 2 * 60 * 1000);
}

/** Solo para las pruebas. */
export function olvidarTareasRevisiones(): void {
  for (const t of tareas.values()) if (t.temporizador) clearInterval(t.temporizador);
  tareas.clear();
}
