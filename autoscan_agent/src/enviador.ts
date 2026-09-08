/**
 * Vaciar la cola: subir, y después mover el papel a su sitio.
 *
 * El vigilante mete tareas; esto las saca. La frontera importa: el enviador no
 * mira la carpeta y el vigilante no habla con la red, así que un servidor caído
 * no puede impedir que se recojan escaneos y un disco lleno no puede impedir
 * que se suban los que ya están en la cola.
 *
 * ## El orden es la promesa
 *
 * 1. Se **reclama** la tarea (queda `SUBIENDO`, con el intento ya contado).
 * 2. Se **sube**.
 * 3. Se **apunta entregada** en SQLite.
 * 4. Se **mueve** el PDF a Sent.
 *
 * Entre 3 y 4 hay una operación de disco, y ahí es donde se muere el proceso el
 * día que se va la luz. Por eso son dos estados y no uno: al arrancar,
 * `entregadasSinArchivar()` devuelve exactamente las que estaban en ese hueco, y
 * el agente **mueve el fichero sin volver a subirlo**. Al revés —mover primero y
 * apuntar después— un corte dejaría un fichero en Sent que el servidor no tiene
 * y que ya nadie va a volver a mirar: una factura perdida en silencio.
 *
 * ## No se borra nada, nunca
 *
 * Fue un requisito explícito y aquí es donde se cumple: lo entregado va a
 * `Sent`, lo rechazado a `Failed`. El agente no tiene una sola llamada a
 * `unlink`. Si el módulo pierde un documento, el papel escaneado sigue en el PC
 * del taller.
 *
 * ## Si no se puede mover, no se pierde
 *
 * Mover puede fallar —el antivirus tiene el fichero abierto, ScanSnap lo está
 * releyendo, se acabó el disco—. En ese caso la tarea se queda ENTREGADA y sin
 * archivar, y el siguiente ciclo lo vuelve a intentar. Lo que NO se hace es
 * volver a subirla: el servidor ya la tiene.
 */

import fs from "node:fs";
import path from "node:path";
import type { ClienteAutoScan } from "./api.ts";
import type { Cola, Tarea } from "./cola.ts";
import type { Config } from "./config.ts";

/** Lo que hizo un ciclo, para el log y la bandeja. */
export type Ciclo = {
  entregadas: number;
  duplicadas: number;
  reintentables: number;
  rechazadas: number;
  archivadas: number;
  /** true = la credencial ya no vale. Hay que reactivar el dispositivo. */
  credencialInvalida: boolean;
};

const CICLO_VACIO = (): Ciclo => ({
  entregadas: 0,
  duplicadas: 0,
  reintentables: 0,
  rechazadas: 0,
  archivadas: 0,
  credencialInvalida: false,
});

export class Enviador {
  readonly #cfg: Config;
  readonly #cola: Cola;
  readonly #cliente: ClienteAutoScan;
  readonly #log: (m: string) => void;

  #temporizador: NodeJS.Timeout | null = null;
  #enMarcha = false;

  constructor(cfg: Config, cola: Cola, cliente: ClienteAutoScan, log: (m: string) => void = () => {}) {
    this.#cfg = cfg;
    this.#cola = cola;
    this.#cliente = cliente;
    this.#log = log;
  }

  /**
   * Lo que hay que hacer al arrancar, ANTES de subir nada nuevo.
   *
   * Devuelve a la cola lo que quedó a medias y termina de archivar lo que ya
   * estaba entregado. Sin esto, un corte de luz en mitad de una subida dejaría
   * la tarea `SUBIENDO` para siempre: nadie la reclama y nadie la echa de menos.
   */
  async reconciliar(): Promise<{ rescatadas: number; archivadas: number }> {
    const rescatadas = this.#cola.rescatarInterrumpidas();
    if (rescatadas > 0) {
      this.#log(`[enviador] ${rescatadas} subida(s) interrumpida(s) vuelven a la cola`);
    }
    const archivadas = await this.#archivarPendientes();
    return { rescatadas, archivadas };
  }

  /** Arranca el bucle. Un ciclo cada `muestreoMs`. */
  arrancar(secret: string): void {
    if (this.#temporizador) return;
    this.#temporizador = setInterval(() => void this.ciclo(secret), this.#cfg.muestreoMs);
    this.#temporizador.unref?.();
  }

  parar(): void {
    if (this.#temporizador) clearInterval(this.#temporizador);
    this.#temporizador = null;
  }

  /**
   * Un ciclo: archiva lo que quedó pendiente y sube todo lo que se pueda.
   *
   * No sale hasta vaciar la cola porque un lote de veinte hojas escaneadas
   * seguidas son veinte tareas, y subirlas de una en una por ciclo las repartiría
   * a lo largo de veinte segundos sin ninguna razón.
   */
  async ciclo(secret: string): Promise<Ciclo> {
    if (this.#enMarcha) return CICLO_VACIO();
    this.#enMarcha = true;
    const r = CICLO_VACIO();
    try {
      r.archivadas = await this.#archivarPendientes();

      for (;;) {
        const tarea = this.#cola.reclamar();
        if (!tarea) break;
        const seguir = await this.#enviar(secret, tarea, r);
        /*
         * Con la credencial inválida o sin licencia se para el ciclo entero. Sin
         * esto, una cola de cincuenta escaneos daría cincuenta 401 seguidos
         * contra el servidor cada segundo.
         */
        if (!seguir) break;
      }
    } catch (e) {
      this.#log(`[enviador] ciclo fallido: ${String(e)}`);
    } finally {
      this.#enMarcha = false;
    }
    return r;
  }

  /** @returns false si hay que parar el ciclo entero. */
  async #enviar(secret: string, tarea: Tarea, r: Ciclo): Promise<boolean> {
    /*
     * El tamaño se comprueba aquí y no al encolar: entre una cosa y otra pueden
     * pasar horas sin red, y gastar dos minutos de subida en algo que va a
     * acabar en 400 es tiempo que le falta al siguiente.
     */
    if (tarea.tamano > this.#cfg.tamanoMaximoBytes) {
      const mb = Math.round(this.#cfg.tamanoMaximoBytes / (1024 * 1024));
      await this.#rechazar(
        tarea,
        `El documento pasa de ${mb} MB. Baja la calidad del perfil de ScanSnap ` +
          "(color 300 ppp o gris, no «Excelente») y vuelve a escanearlo.",
        r
      );
      return true;
    }

    if (!fs.existsSync(tarea.ruta)) {
      /*
       * Alguien lo ha movido o borrado a mano mientras esperaba. No es un error
       * del servidor ni tiene arreglo reintentando: se aparta con su motivo para
       * que quede constancia de que ese escaneo NO se subió.
       */
      await this.#rechazar(tarea, "El fichero ya no está en la carpeta.", r);
      return true;
    }

    const res = await this.#cliente.subir(
      secret,
      { ruta: tarea.ruta, nombre: tarea.nombre, tamano: tarea.tamano },
      tarea.idempotencyKey,
      tarea.escaneadoAtMs
    );

    if (res.clase === "entregado") {
      /*
       * Primero la base, después el disco. Es el orden que convierte un corte de
       * luz en «hay que mover un fichero» en vez de en «hay que adivinar si esto
       * se subió».
       */
      this.#cola.marcarEntregada(tarea.id, res.documentoId, res.duplicado);
      if (res.duplicado) r.duplicadas += 1;
      else r.entregadas += 1;

      if (await this.#archivar(tarea, this.#cfg.sent)) r.archivadas += 1;
      this.#log(
        `[enviador] «${tarea.nombre}» ${res.duplicado ? "ya estaba en" : "entregado a"} Mobilink (documento ${res.documentoId})`
      );
      return true;
    }

    if (res.clase === "rechazado") {
      await this.#rechazar(tarea, res.motivo, r);
      return true;
    }

    // Reintentable.
    r.reintentables += 1;
    this.#cola.devolverACola(tarea.id, res.motivo, tarea.intentos, this.#cfg.reintentoMaximoMs);

    if (res.credencialInvalida) {
      r.credencialInvalida = true;
      this.#log("[enviador] la credencial ya no vale: hay que volver a activar el dispositivo");
      return false;
    }
    if (res.codigo === "LICENCIA_CADUCADA") {
      /*
       * La credencial es buena y la licencia no. Se para el ciclo pero NO se
       * toca la credencial: cuando se renueve, el agente sigue solo sin que
       * nadie tenga que reactivar nada.
       */
      this.#log("[enviador] licencia de Cash caducada: las subidas esperan a que se renueve");
      return false;
    }

    this.#log(`[enviador] «${tarea.nombre}» se reintentará: ${res.motivo}`);
    return true;
  }

  async #rechazar(tarea: Tarea, motivo: string, r: Ciclo): Promise<void> {
    this.#cola.marcarRechazada(tarea.id, motivo);
    r.rechazadas += 1;
    /*
     * A Failed y no a la papelera. Lo rechazado es justo lo que alguien va a
     * querer mirar: el PDF de 20 MB que hay que volver a escanear más flojo.
     */
    if (await this.#archivar(tarea, this.#cfg.failed)) r.archivadas += 1;
    this.#log(`[enviador] «${tarea.nombre}» apartado: ${motivo}`);
  }

  /** Termina de archivar lo que se quedó entregado y sin mover. */
  async #archivarPendientes(): Promise<number> {
    let n = 0;
    for (const tarea of this.#cola.entregadasSinArchivar()) {
      if (await this.#archivar(tarea, this.#cfg.sent)) n += 1;
    }
    return n;
  }

  /**
   * Mueve el fichero, sin pisar nada.
   *
   * @returns false si no se ha podido; la tarea se queda como está y el
   * siguiente ciclo lo reintenta.
   */
  async #archivar(tarea: Tarea, destino: string): Promise<boolean> {
    try {
      await fs.promises.mkdir(destino, { recursive: true });
      const ruta = await rutaLibre(destino, tarea.nombre);
      await mover(tarea.ruta, ruta);
      this.#cola.marcarArchivada(tarea.id, ruta);
      return true;
    } catch (e) {
      if (!fs.existsSync(tarea.ruta)) {
        /*
         * Ya no está en Inbox: o lo movió un ciclo anterior que se murió justo
         * después, o lo movió una persona. En los dos casos el trabajo está
         * hecho — dejarlo pendiente lo reintentaría eternamente.
         */
        this.#cola.marcarArchivada(tarea.id, path.join(destino, tarea.nombre));
        return true;
      }
      this.#log(`[enviador] no se ha podido mover «${tarea.nombre}», se reintentará: ${String(e)}`);
      return false;
    }
  }
}

/**
 * Un nombre que no pise lo que ya hay.
 *
 * ScanSnap reutiliza nombres alegremente —`2026_09_08_11_02.pdf` sale otra vez
 * si alguien reinicia el contador—, y sobrescribir en Sent borraría el papel de
 * una factura ya entregada: la única copia que queda de ese escaneo. Se añade
 * un sufijo hasta encontrar hueco.
 */
export async function rutaLibre(carpeta: string, nombre: string): Promise<string> {
  const ext = path.extname(nombre);
  const base = path.basename(nombre, ext);
  let intento = path.join(carpeta, nombre);
  for (let n = 2; fs.existsSync(intento); n += 1) {
    intento = path.join(carpeta, `${base} (${n})${ext}`);
    /* Un tope por si algo va muy mal: mejor fallar que girar para siempre. */
    if (n > 9_999) throw new Error(`No hay hueco para «${nombre}» en ${carpeta}.`);
  }
  return intento;
}

/**
 * `rename`, y si no se puede, copiar y borrar.
 *
 * `rename` falla con EXDEV cuando origen y destino están en unidades distintas,
 * y eso pasa de verdad: hay talleres con la carpeta vigilada en una unidad de
 * red y el agente instalado en C:. Sin el respaldo, en esas instalaciones no se
 * archivaría nunca nada.
 */
async function mover(origen: string, destino: string): Promise<void> {
  try {
    await fs.promises.rename(origen, destino);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EXDEV") throw e;
    await fs.promises.copyFile(origen, destino);
    await fs.promises.unlink(origen);
  }
}
