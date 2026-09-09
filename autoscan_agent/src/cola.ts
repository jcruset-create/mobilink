/**
 * La cola: lo que sobrevive al reinicio.
 *
 * La regla que sostiene todo el agente es el orden de dos escrituras:
 *
 *     fichero estable → SQLite → subir
 *
 * y **nunca**:
 *
 *     fichero estable → subir → si falla ya veremos
 *
 * La diferencia se ve el día que se va la luz a las 19:58 con tres facturas
 * sin subir. Con la cola en disco, el agente arranca y sigue por donde iba.
 * Con la intención en memoria, esas tres facturas no existieron nunca.
 *
 * ## `node:sqlite`, sin dependencia nativa
 *
 * Node trae SQLite desde la 22.5. Eso quita `better-sqlite3` y con él la
 * compilación nativa —binarios por versión de Node y de Windows—, que en un
 * instalador que corre solo en quince mostradores es justo la pieza que se
 * rompe. Aquí el agente es JavaScript y la base la pone el runtime.
 *
 * ## Los estados, y por qué son estos
 *
 *     ENCOLADO ──▶ SUBIENDO ──▶ ENTREGADO ──▶ ARCHIVADO
 *         ▲            │
 *         └── espera ──┤ (fallo pasajero: red, 5xx, licencia)
 *                      │
 *                      └──▶ RECHAZADO   (400: formato, tamaño… no se arregla solo)
 *
 * `ENTREGADO` y `ARCHIVADO` van separados a propósito. Entre «el servidor dice
 * que lo tiene» y «he movido el PDF a Sent» hay una operación de disco que
 * puede fallar o quedar a medias. Con un solo estado, un corte justo ahí
 * dejaría un fichero en Inbox que ya está entregado, y el arranque siguiente lo
 * subiría otra vez — el servidor lo deduplicaría, pero el agente estaría
 * mintiendo sobre lo que ha hecho.
 */

import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

export type EstadoTarea =
  | "ENCOLADO"
  | "SUBIENDO"
  | "ENTREGADO"
  | "ARCHIVADO"
  | "RECHAZADO";

export type Tarea = {
  id: number;
  ruta: string;
  nombre: string;
  tamano: number;
  sha256: string;
  /** Clave de idempotencia. Se genera UNA vez y no cambia entre reintentos. */
  idempotencyKey: string;
  estado: EstadoTarea;
  intentos: number;
  /** Antes de esta hora no se vuelve a intentar. Es el backoff. */
  proximoIntentoMs: number;
  error: string | null;
  documentoId: number | null;
  duplicado: boolean;
  escaneadoAtMs: number | null;
  creadoAtMs: number;
  actualizadoAtMs: number;
};

/* eslint-disable @typescript-eslint/no-explicit-any */
function aTarea(r: any): Tarea {
  return {
    id: Number(r.id),
    ruta: String(r.ruta),
    nombre: String(r.nombre),
    tamano: Number(r.tamano),
    sha256: String(r.sha256),
    idempotencyKey: String(r.idempotency_key),
    estado: String(r.estado) as EstadoTarea,
    intentos: Number(r.intentos),
    proximoIntentoMs: Number(r.proximo_intento_ms),
    error: r.error == null ? null : String(r.error),
    documentoId: r.documento_id == null ? null : Number(r.documento_id),
    duplicado: Number(r.duplicado) === 1,
    escaneadoAtMs: r.escaneado_at_ms == null ? null : Number(r.escaneado_at_ms),
    creadoAtMs: Number(r.creado_at_ms),
    actualizadoAtMs: Number(r.actualizado_at_ms),
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export class Cola {
  readonly #db: DatabaseSync;

  constructor(ruta: string) {
    fs.mkdirSync(path.dirname(ruta), { recursive: true });
    this.#db = new DatabaseSync(ruta);
    /*
     * WAL para que leer el estado desde la ventana de la bandeja no bloquee al
     * que está subiendo, y `synchronous = FULL` porque el punto entero de esta
     * tabla es sobrevivir a un corte de luz: con NORMAL, SQLite puede perder la
     * última transacción, que es exactamente la que importa.
     */
    this.#db.exec("PRAGMA journal_mode = WAL");
    this.#db.exec("PRAGMA synchronous = FULL");
    this.#crear();
  }

  #crear(): void {
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS tareas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ruta TEXT NOT NULL,
        nombre TEXT NOT NULL,
        tamano INTEGER NOT NULL,
        sha256 TEXT NOT NULL,
        idempotency_key TEXT NOT NULL UNIQUE,
        estado TEXT NOT NULL,
        intentos INTEGER NOT NULL DEFAULT 0,
        proximo_intento_ms INTEGER NOT NULL DEFAULT 0,
        error TEXT,
        documento_id INTEGER,
        duplicado INTEGER NOT NULL DEFAULT 0,
        escaneado_at_ms INTEGER,
        creado_at_ms INTEGER NOT NULL,
        actualizado_at_ms INTEGER NOT NULL
      );

      /*
        Un fichero de Inbox entra UNA vez.

        Es lo que hace que el rescan del arranque pueda ser tonto: mira la
        carpeta, intenta encolar todo, y los que ya estaban chocan aquí en vez
        de duplicarse. Por ruta y no por contenido a propósito — la
        deduplicación por sha256 es del servidor, que es quien ve todos los
        escáneres del centro; aquí solo hace falta no subir dos veces el mismo
        fichero.
      */
      CREATE UNIQUE INDEX IF NOT EXISTS tareas_ruta_idx ON tareas(ruta);
      CREATE INDEX IF NOT EXISTS tareas_pendientes_idx
        ON tareas(estado, proximo_intento_ms);
    `);
  }

  /**
   * Mete un fichero en la cola. Si ya estaba, devuelve el que había.
   *
   * Es idempotente por diseño: lo llaman el watcher y el rescan del arranque, a
   * veces por el mismo fichero y casi a la vez.
   */
  encolar(e: {
    ruta: string;
    nombre: string;
    tamano: number;
    sha256: string;
    idempotencyKey: string;
    escaneadoAtMs: number | null;
  }): Tarea {
    const ahora = Date.now();
    this.#db
      .prepare(
        `INSERT INTO tareas
           (ruta, nombre, tamano, sha256, idempotency_key, estado, proximo_intento_ms,
            escaneado_at_ms, creado_at_ms, actualizado_at_ms)
         VALUES (?,?,?,?,?, 'ENCOLADO', 0, ?, ?, ?)
         ON CONFLICT(ruta) DO NOTHING`
      )
      .run(
        e.ruta,
        e.nombre,
        e.tamano,
        e.sha256,
        e.idempotencyKey,
        e.escaneadoAtMs,
        ahora,
        ahora
      );
    return this.porRuta(e.ruta)!;
  }

  porRuta(ruta: string): Tarea | null {
    const r = this.#db.prepare(`SELECT * FROM tareas WHERE ruta = ?`).get(ruta);
    return r ? aTarea(r) : null;
  }

  /**
   * La siguiente que toca subir, si es que toca alguna.
   *
   * La marca `SUBIENDO` en la misma sentencia que la elige: dos hilos del
   * enviador no pueden llevarse la misma. Hoy solo hay uno, pero el día que
   * haya dos este `WHERE estado = 'ENCOLADO'` es lo único que lo impide.
   */
  reclamar(ahora = Date.now()): Tarea | null {
    const fila = this.#db
      .prepare(
        `UPDATE tareas
            SET estado = 'SUBIENDO', intentos = intentos + 1, actualizado_at_ms = ?
          WHERE id = (
            SELECT id FROM tareas
             WHERE estado = 'ENCOLADO' AND proximo_intento_ms <= ?
             ORDER BY creado_at_ms
             LIMIT 1)
          RETURNING *`
      )
      .get(ahora, ahora);
    return fila ? aTarea(fila) : null;
  }

  /** El servidor lo tiene. Todavía NO se ha movido el fichero. */
  marcarEntregada(id: number, documentoId: number, duplicado: boolean): void {
    this.#db
      .prepare(
        `UPDATE tareas SET estado='ENTREGADO', documento_id=?, duplicado=?, error=NULL,
                actualizado_at_ms=? WHERE id=?`
      )
      .run(documentoId, duplicado ? 1 : 0, Date.now(), id);
  }

  /** Movido a Sent. Éste es el final feliz. */
  marcarArchivada(id: number, rutaNueva: string): void {
    this.#db
      .prepare(`UPDATE tareas SET estado='ARCHIVADO', ruta=?, actualizado_at_ms=? WHERE id=?`)
      .run(rutaNueva, Date.now(), id);
  }

  /**
   * Fallo pasajero: vuelve a la cola con espera.
   *
   * Backoff exponencial con tope. Sin tope, cuatro días de vacaciones con el
   * servidor caído dejarían el próximo intento a dos semanas vista; con él, el
   * agente sigue probando cada cuarto de hora y se recupera solo en cuanto
   * vuelva la red.
   */
  devolverACola(id: number, motivo: string, intentos: number, topeMs: number): void {
    const espera = Math.min(topeMs, 2 ** Math.min(intentos, 20) * 1_000);
    this.#db
      .prepare(
        `UPDATE tareas SET estado='ENCOLADO', error=?, proximo_intento_ms=?, actualizado_at_ms=?
          WHERE id=?`
      )
      .run(motivo.slice(0, 500), Date.now() + espera, Date.now(), id);
  }

  /** No se arregla reintentando: formato, tamaño. Se aparta y se enseña. */
  marcarRechazada(id: number, motivo: string): void {
    this.#db
      .prepare(`UPDATE tareas SET estado='RECHAZADO', error=?, actualizado_at_ms=? WHERE id=?`)
      .run(motivo.slice(0, 500), Date.now(), id);
  }

  /** Lo entregado que todavía no se ha movido. Se reintenta al arrancar. */
  entregadasSinArchivar(): Tarea[] {
    return this.#db
      .prepare(`SELECT * FROM tareas WHERE estado='ENTREGADO' ORDER BY id`)
      .all()
      .map(aTarea);
  }

  /**
   * Devuelve a la cola lo que se quedó en SUBIENDO.
   *
   * Solo puede haber quedado así por una muerte a mitad de subida: nadie deja
   * ese estado al salir bien. El documento pudo llegar o no al servidor, y por
   * eso se reintenta con la MISMA clave de idempotencia — el servidor
   * responderá 200 si ya lo tenía, y el fichero no se sube dos veces.
   */
  rescatarInterrumpidas(): number {
    const r = this.#db
      .prepare(
        `UPDATE tareas SET estado='ENCOLADO', proximo_intento_ms=0, actualizado_at_ms=?
          WHERE estado='SUBIENDO'`
      )
      .run(Date.now());
    return Number(r.changes ?? 0);
  }

  /** Las rutas que la cola ya conoce, para que el rescan sepa qué es nuevo. */
  rutasConocidas(): Set<string> {
    const filas = this.#db.prepare(`SELECT ruta FROM tareas`).all();
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
    return new Set(filas.map((f: any) => String(f.ruta)));
  }

  /** Para reintentar a mano desde la bandeja: todo lo rechazado, otra vez. */
  reencolarRechazadas(): number {
    const r = this.#db
      .prepare(
        `UPDATE tareas SET estado='ENCOLADO', intentos=0, proximo_intento_ms=0,
                error=NULL, actualizado_at_ms=? WHERE estado='RECHAZADO'`
      )
      .run(Date.now());
    return Number(r.changes ?? 0);
  }

  /** Lo que enseña la bandeja. Una consulta, no cinco. */
  resumen(): { pendientes: number; subiendo: number; rechazadas: number; archivadas: number } {
    const fila = this.#db
      .prepare(
        `SELECT
           COUNT(*) FILTER (WHERE estado='ENCOLADO')  AS pendientes,
           COUNT(*) FILTER (WHERE estado IN ('SUBIENDO','ENTREGADO')) AS subiendo,
           COUNT(*) FILTER (WHERE estado='RECHAZADO') AS rechazadas,
           COUNT(*) FILTER (WHERE estado='ARCHIVADO') AS archivadas
         FROM tareas`
      )
      /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
      .get() as any;
    return {
      pendientes: Number(fila?.pendientes ?? 0),
      subiendo: Number(fila?.subiendo ?? 0),
      rechazadas: Number(fila?.rechazadas ?? 0),
      archivadas: Number(fila?.archivadas ?? 0),
    };
  }

  cerrar(): void {
    this.#db.close();
  }
}
