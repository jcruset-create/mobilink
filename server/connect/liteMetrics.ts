/**
 * Mobilink Assist Lite — medición de lo que hoy no se veía.
 *
 * El encargo pide vigilar seis cosas y ninguna se medía: fallos de API por
 * endpoint, posiciones perdidas, avisos push fallidos, colas offline atascadas,
 * conflictos de estado y versiones antiguas de la APK en uso. Sin esto, un
 * taller cuyo seguimiento no llega o cuyas notificaciones se pierden no se
 * detecta hasta que alguien lo cuenta por teléfono.
 *
 * Tres de ellas se cuentan aquí, en memoria del proceso, en cubos de un minuto
 * sobre una ventana de una hora: es lo que hace falta para responder «¿está
 * pasando ahora?». Las otras tres (colas atascadas, versiones en uso y
 * dispositivos sin push) salen de la base de datos, que es donde viven.
 *
 * Deliberadamente NO se guarda nada identificativo: ni matrículas, ni nombres,
 * ni tokens, ni identificadores de asistencia. Solo agregados por endpoint y
 * por taller.
 */

const CUBO_MS = 60_000;
const CUBOS = 60;

interface Cubo {
  minuto: number;
  /** endpoint → código de estado → veces */
  api: Map<string, Map<number, number>>;
  /** endpoint → milisegundos de cada respuesta (para la mediana y el p95) */
  duraciones: Map<string, number[]>;
  /** endpoint → rechazos por límite de uso */
  limitados: Map<string, number>;
  puntosRecibidos: number;
  puntosGuardados: number;
  pushIntentados: number;
  pushEntregados: number;
  pushTokensInvalidos: number;
  conflictos: number;
  /** tallerId → conflictos, para saber a quién le pasa */
  conflictosPorTaller: Map<number, number>;
}

function nuevoCubo(minuto: number): Cubo {
  return {
    minuto,
    api: new Map(),
    duraciones: new Map(),
    limitados: new Map(),
    puntosRecibidos: 0,
    puntosGuardados: 0,
    pushIntentados: 0,
    pushEntregados: 0,
    pushTokensInvalidos: 0,
    conflictos: 0,
    conflictosPorTaller: new Map(),
  };
}

function sumar<K>(mapa: Map<K, number>, clave: K, cuanto = 1): void {
  mapa.set(clave, (mapa.get(clave) ?? 0) + cuanto);
}

function percentil(valores: number[], p: number): number | null {
  if (valores.length === 0) return null;
  const orden = [...valores].sort((a, b) => a - b);
  const i = Math.min(orden.length - 1, Math.max(0, Math.ceil((p / 100) * orden.length) - 1));
  return Math.round(orden[i]);
}

export interface ApiEndpointStats {
  endpoint: string;
  total: number;
  /** 5xx y 502: fallos del servidor, no del cliente. */
  errores: number;
  /** 4xx que no son 429: peticiones mal formadas o fuera de estado. */
  rechazos: number;
  limitados: number;
  errorRate: number;
  p50Ms: number | null;
  p95Ms: number | null;
}

export interface LiteMetricsSnapshot {
  ventanaMin: number;
  desdeMs: number;
  hastaMs: number;
  api: ApiEndpointStats[];
  totales: { peticiones: number; errores: number; rechazos: number; limitados: number };
  posiciones: { recibidas: number; guardadas: number; perdidas: number; perdidaRate: number };
  push: { intentados: number; entregados: number; fallidos: number; tokensInvalidos: number; falloRate: number };
  conflictos: { total: number; porTaller: { workshopId: number; total: number }[] };
}

export class LiteMetrics {
  private cubos: Cubo[] = [];

  private cubo(now: number): Cubo {
    const minuto = Math.floor(now / CUBO_MS);
    const ultimo = this.cubos[this.cubos.length - 1];
    if (ultimo && ultimo.minuto === minuto) return ultimo;
    const nuevo = nuevoCubo(minuto);
    this.cubos.push(nuevo);
    // La ventana se recorta aquí: no hace falta ninguna tarea periódica.
    while (this.cubos.length > CUBOS) this.cubos.shift();
    return nuevo;
  }

  private vigentes(now: number): Cubo[] {
    const minimo = Math.floor(now / CUBO_MS) - CUBOS + 1;
    return this.cubos.filter((c) => c.minuto >= minimo);
  }

  recordApi(endpoint: string, status: number, ms: number, now = Date.now()): void {
    const c = this.cubo(now);
    let porEstado = c.api.get(endpoint);
    if (!porEstado) { porEstado = new Map(); c.api.set(endpoint, porEstado); }
    sumar(porEstado, status);
    const d = c.duraciones.get(endpoint);
    if (d) {
      // Techo por endpoint y minuto: guardar cada duración de un pico de tráfico
      // gastaría más memoria de la que vale el percentil.
      if (d.length < 500) d.push(ms);
    } else {
      c.duraciones.set(endpoint, [ms]);
    }
  }

  recordRateLimited(endpoint: string, now = Date.now()): void {
    sumar(this.cubo(now).limitados, endpoint);
  }

  /** Posiciones que llegaron frente a las que se guardaron de verdad. */
  recordPoints(recibidas: number, guardadas: number, now = Date.now()): void {
    const c = this.cubo(now);
    c.puntosRecibidos += Math.max(0, recibidas);
    c.puntosGuardados += Math.max(0, guardadas);
  }

  recordPush(intentados: number, entregados: number, tokensInvalidos: number, now = Date.now()): void {
    const c = this.cubo(now);
    c.pushIntentados += Math.max(0, intentados);
    c.pushEntregados += Math.max(0, entregados);
    c.pushTokensInvalidos += Math.max(0, tokensInvalidos);
  }

  /** Estado oficial incompatible con lo que traía la cola offline. */
  recordConflict(workshopId: number | null, now = Date.now()): void {
    const c = this.cubo(now);
    c.conflictos++;
    if (workshopId != null) sumar(c.conflictosPorTaller, workshopId);
  }

  snapshot(now = Date.now()): LiteMetricsSnapshot {
    const cubos = this.vigentes(now);
    const porEndpoint = new Map<string, { estados: Map<number, number>; duraciones: number[]; limitados: number }>();
    let puntosRecibidos = 0, puntosGuardados = 0;
    let pushIntentados = 0, pushEntregados = 0, pushInvalidos = 0;
    let conflictos = 0;
    const conflictosPorTaller = new Map<number, number>();

    for (const c of cubos) {
      for (const [endpoint, estados] of c.api) {
        const acc = porEndpoint.get(endpoint) ?? { estados: new Map(), duraciones: [], limitados: 0 };
        for (const [status, veces] of estados) sumar(acc.estados, status, veces);
        acc.duraciones.push(...(c.duraciones.get(endpoint) ?? []));
        porEndpoint.set(endpoint, acc);
      }
      for (const [endpoint, veces] of c.limitados) {
        const acc = porEndpoint.get(endpoint) ?? { estados: new Map(), duraciones: [], limitados: 0 };
        acc.limitados += veces;
        porEndpoint.set(endpoint, acc);
      }
      puntosRecibidos += c.puntosRecibidos;
      puntosGuardados += c.puntosGuardados;
      pushIntentados += c.pushIntentados;
      pushEntregados += c.pushEntregados;
      pushInvalidos += c.pushTokensInvalidos;
      conflictos += c.conflictos;
      for (const [taller, veces] of c.conflictosPorTaller) sumar(conflictosPorTaller, taller, veces);
    }

    const api: ApiEndpointStats[] = [...porEndpoint.entries()].map(([endpoint, acc]) => {
      let total = 0, errores = 0, rechazos = 0;
      for (const [status, veces] of acc.estados) {
        total += veces;
        if (status >= 500) errores += veces;
        else if (status >= 400 && status !== 429) rechazos += veces;
      }
      return {
        endpoint,
        total,
        errores,
        rechazos,
        limitados: acc.limitados,
        errorRate: total > 0 ? Number((errores / total).toFixed(4)) : 0,
        p50Ms: percentil(acc.duraciones, 50),
        p95Ms: percentil(acc.duraciones, 95),
      };
    }).sort((a, b) => b.errores - a.errores || b.total - a.total);

    const perdidas = Math.max(0, puntosRecibidos - puntosGuardados);
    const pushFallidos = Math.max(0, pushIntentados - pushEntregados);

    return {
      ventanaMin: CUBOS,
      desdeMs: (Math.floor(now / CUBO_MS) - CUBOS + 1) * CUBO_MS,
      hastaMs: now,
      api,
      totales: {
        peticiones: api.reduce((s, e) => s + e.total, 0),
        errores: api.reduce((s, e) => s + e.errores, 0),
        rechazos: api.reduce((s, e) => s + e.rechazos, 0),
        limitados: api.reduce((s, e) => s + e.limitados, 0),
      },
      posiciones: {
        recibidas: puntosRecibidos,
        guardadas: puntosGuardados,
        perdidas,
        perdidaRate: puntosRecibidos > 0 ? Number((perdidas / puntosRecibidos).toFixed(4)) : 0,
      },
      push: {
        intentados: pushIntentados,
        entregados: pushEntregados,
        fallidos: pushFallidos,
        tokensInvalidos: pushInvalidos,
        falloRate: pushIntentados > 0 ? Number((pushFallidos / pushIntentados).toFixed(4)) : 0,
      },
      conflictos: {
        total: conflictos,
        porTaller: [...conflictosPorTaller.entries()]
          .map(([workshopId, total]) => ({ workshopId, total }))
          .sort((a, b) => b.total - a.total),
      },
    };
  }

  /** Solo para las pruebas. */
  reset(): void {
    this.cubos = [];
  }
}

/** Registro del proceso: lo alimentan el router de Lite y los envíos push. */
export const liteMetrics = new LiteMetrics();
