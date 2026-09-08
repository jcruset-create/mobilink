/**
 * Vigilar la carpeta y meter en la cola lo que ya está terminado.
 *
 * Es la única parte del agente que toca la carpeta que llena el escáner. Su
 * trabajo acaba en `Cola.encolar`: no sube nada, no borra nada y no mueve nada.
 * Lo que pase después es problema del enviador, y esa frontera es lo que
 * permite que un fallo de red no tenga forma de perder un fichero.
 *
 * ## Dos maneras de enterarse, a propósito
 *
 * **El watcher** (`fs.watch`) para lo normal: un escaneo aparece y se recoge en
 * segundos.
 *
 * **El barrido completo**, cada `reconciliacionMs` y una vez al arrancar,
 * porque `fs.watch` no es de fiar y en Windows menos: se pierde eventos si el
 * proceso está ocupado, no avisa de nada en algunas unidades de red, y deja de
 * funcionar en silencio si alguien renombra la carpeta vigilada. El watcher es
 * la vía rápida; el barrido es la que garantiza que **ningún fichero se queda
 * en la carpeta para siempre**. Con solo el watcher, un evento perdido es una
 * factura perdida y nadie se entera.
 *
 * El barrido del arranque es además la respuesta a que se vaya la luz: lo que
 * llegó con el agente parado no generó ningún evento que recuperar.
 *
 * ## No se sube lo que se acaba de ver
 *
 * Entre ver el fichero y encolarlo hay una espera deliberada: `Estabilizador`
 * decide cuándo ha terminado de escribirse. Ver `estabilidad.ts`, que es donde
 * está el razonamiento.
 *
 * ## El SHA-256 se calcula aquí, una sola vez
 *
 * Al encolar y no al subir. Si se calculara al subir, cada reintento volvería a
 * leer el fichero entero — y, peor, un fichero modificado entre el encolado y
 * el reintento subiría con un hash que no es el del contenido que se examinó.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Config } from "./config.ts";
import { Estabilizador } from "./estabilidad.ts";
import type { Cola } from "./cola.ts";

/** Lo que el vigilante cuenta de sí mismo, para la bandeja y el log. */
export type EstadoVigilante = {
  vigilados: number;
  encoladosEnTotal: number;
  /** Ficheros vacíos que llevan demasiado tiempo así. Escaneos que salieron mal. */
  atascados: string[];
};

/**
 * Media hora vacío deja de ser «está escribiéndose».
 *
 * Es un aviso, no un descarte: el fichero se sigue vigilando por si termina de
 * llegar. Lo que cambia es que deja de esperarse en silencio.
 */
const VACIO_DEMASIADO_MS = 30 * 60_000;

export class Vigilante {
  readonly #cfg: Config;
  readonly #cola: Cola;
  readonly #estabilizador: Estabilizador;
  readonly #log: (mensaje: string) => void;

  #watcher: fs.FSWatcher | null = null;
  #temporizador: NodeJS.Timeout | null = null;
  #encolados = 0;
  #atascados = new Set<string>();
  /** Evita que dos barridos solapados encolen el mismo fichero dos veces. */
  #barriendo = false;

  constructor(cfg: Config, cola: Cola, log: (m: string) => void = () => {}) {
    this.#cfg = cfg;
    this.#cola = cola;
    this.#estabilizador = new Estabilizador(cfg.estabilidadMs);
    this.#log = log;
  }

  /**
   * Arranca la vigilancia. El primer barrido es inmediato y se espera.
   *
   * Se espera a propósito: quien arranca el agente necesita saber que lo que
   * quedó de ayer ya está en la cola antes de dar el arranque por bueno.
   */
  async arrancar(): Promise<void> {
    await this.barrer();

    try {
      this.#watcher = fs.watch(this.#cfg.inbox, { persistent: true }, () => {
        /*
         * No se mira QUÉ fichero avisó. `fs.watch` da nombres poco fiables en
         * Windows —a veces el viejo de un renombrado, a veces ninguno— y el
         * barrido completo cuesta un `readdir` de una carpeta que normalmente
         * tiene cero ficheros. Fiarse del nombre sería la parte frágil.
         */
        void this.barrer();
      });
      this.#watcher.on("error", (e) => {
        /*
         * Un watcher muerto NO puede parar el agente: el barrido periódico
         * sigue recogiéndolo todo, más despacio pero sin perder nada. Por eso
         * se apunta y se sigue en vez de propagar.
         */
        this.#log(`[vigilante] el watcher ha fallado, queda el barrido periódico: ${String(e)}`);
        this.#watcher = null;
      });
    } catch (e) {
      this.#log(`[vigilante] no se ha podido vigilar ${this.#cfg.inbox}: ${String(e)}`);
    }

    this.#temporizador = setInterval(() => void this.barrer(), this.#cfg.reconciliacionMs);
    /* Que un barrido pendiente no impida cerrar el proceso. */
    this.#temporizador.unref?.();
  }

  parar(): void {
    this.#watcher?.close();
    this.#watcher = null;
    if (this.#temporizador) clearInterval(this.#temporizador);
    this.#temporizador = null;
  }

  estado(): EstadoVigilante {
    return {
      vigilados: this.#estabilizador.vigilados,
      encoladosEnTotal: this.#encolados,
      atascados: [...this.#atascados],
    };
  }

  /**
   * Mira la carpeta entera y encola lo que ya esté terminado.
   *
   * Es idempotente: `Cola.encolar` ignora una ruta que ya conoce, así que
   * llamarlo de más no duplica nada. Esa garantía es la que permite que el
   * watcher sea tan tonto como es.
   */
  async barrer(): Promise<void> {
    if (this.#barriendo) return;
    this.#barriendo = true;
    try {
      await this.#barrerUnaVez();
    } catch (e) {
      /*
       * La carpeta puede no existir todavía —el instalador la crea, pero
       * alguien puede borrarla— y eso no puede tumbar el agente.
       */
      this.#log(`[vigilante] barrido fallido: ${String(e)}`);
    } finally {
      this.#barriendo = false;
    }
  }

  async #barrerUnaVez(): Promise<void> {
    const ahora = Date.now();
    const conocidas = this.#cola.rutasConocidas();
    const entradas = await fs.promises.readdir(this.#cfg.inbox, { withFileTypes: true });
    const presentes = new Set<string>();

    for (const entrada of entradas) {
      if (!entrada.isFile()) continue;

      const nombre = entrada.name;
      if (!this.#cfg.extensiones.includes(path.extname(nombre).toLowerCase())) continue;

      const ruta = path.join(this.#cfg.inbox, nombre);
      presentes.add(ruta);

      /*
       * Ya encolado: ni se mira. Un fichero que espera turno de subida puede
       * quedarse días en Inbox si no hay red, y volver a leerlo en cada barrido
       * sería leer el disco entero cada cinco minutos para nada.
       */
      if (conocidas.has(ruta)) continue;

      let stat: fs.Stats;
      try {
        stat = await fs.promises.stat(ruta);
      } catch {
        /* Ha desaparecido entre el readdir y el stat. Pasa, y no es un error. */
        continue;
      }

      const veredicto = this.#estabilizador.observar(
        ruta,
        { tamano: stat.size, modificadoMs: stat.mtimeMs },
        ahora
      );

      if (veredicto === "vacio") {
        const desde = this.#estabilizador.quietoDesdeMs(ruta) ?? ahora;
        if (ahora - desde >= VACIO_DEMASIADO_MS && !this.#atascados.has(ruta)) {
          this.#atascados.add(ruta);
          this.#log(`[vigilante] «${nombre}» lleva mucho rato con 0 bytes: el escaneo salió mal`);
        }
        continue;
      }
      if (veredicto === "cambiando") continue;

      await this.#encolar(ruta, nombre, stat);
    }

    /*
     * Lo que ya no está en la carpeta se olvida, en las DOS listas.
     *
     * `olvidar()` se llama al encolar, que es el final feliz. Pero un fichero
     * que alguien mueve o borra a mano antes de que se dé por terminado no pasa
     * por ahí: se quedaría en el mapa para siempre, y un agente que lleva meses
     * arrancado acabaría guardando ficheros que ya no existen.
     */
    this.#estabilizador.olvidarLosQueNoEsten(presentes);
    for (const ruta of [...this.#atascados]) if (!presentes.has(ruta)) this.#atascados.delete(ruta);
  }

  async #encolar(ruta: string, nombre: string, stat: fs.Stats): Promise<void> {
    const sha256 = await sha256De(ruta);

    this.#cola.encolar({
      ruta,
      nombre,
      tamano: stat.size,
      sha256,
      idempotencyKey: claveDeIdempotencia(ruta, sha256),
      /*
       * Cuándo se escaneó, según el disco. Es aproximado —es la fecha de
       * modificación— y por eso el servidor lo trata como una pista y no como
       * un dato: sirve para ordenar la bandeja, no para contabilizar nada.
       */
      escaneadoAtMs: Math.round(stat.mtimeMs),
    });

    this.#estabilizador.olvidar(ruta);
    this.#atascados.delete(ruta);
    this.#encolados += 1;
    this.#log(`[vigilante] encolado «${nombre}» (${stat.size} bytes)`);
  }
}

/**
 * La clave que identifica ESTE envío, estable entre reintentos.
 *
 * Sale del contenido **y de la ruta**, y las dos mitades hacen falta:
 *
 * - El **contenido** es lo que la hace estable. El mismo PDF reintentado tras
 *   un corte de red llega al servidor con la misma clave y no se duplica; con
 *   un aleatorio, cada reintento sería un documento nuevo y la idempotencia no
 *   serviría de nada.
 *
 * - La **ruta** es lo que impide que dos ficheros distintos se coman entre sí.
 *   `idempotency_key` es UNIQUE en la cola, así que con la clave sacada solo del
 *   contenido el segundo de dos escaneos idénticos —dos copias de la misma
 *   factura, o dos hojas en blanco, que pasa más de lo que parece— se descartaba
 *   en silencio al encolarlo y se quedaba en Inbox para siempre: sin subir, sin
 *   archivar y sin que nadie lo echara de menos.
 *
 * Que dos ficheros con el mismo contenido sean el mismo documento lo decide el
 * SERVIDOR, que ve todos los escáneres del centro y responde `duplicado`. El
 * agente no puede tomar esa decisión: solo ve su carpeta.
 */
export function claveDeIdempotencia(ruta: string, sha256: string): string {
  return crypto.createHash("sha256").update(`${ruta}\u0000${sha256}`).digest("hex");
}

/**
 * El hash del fichero, leyéndolo a trozos.
 *
 * Con `readFile` un lote multipágina entraría entero en memoria; en el PC de
 * recepción, que es el más flojo del taller, eso se nota. El stream lo lee de
 * 64 kB en 64 kB.
 */
export function sha256De(ruta: string): Promise<string> {
  return new Promise((resolver, rechazar) => {
    const hash = crypto.createHash("sha256");
    const flujo = fs.createReadStream(ruta);
    flujo.on("data", (trozo) => hash.update(trozo));
    flujo.on("error", rechazar);
    flujo.on("end", () => resolver(hash.digest("hex")));
  });
}
