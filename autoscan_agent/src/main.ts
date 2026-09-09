/**
 * El agente: lo que arranca el instalador y lo que ata todas las piezas.
 *
 * Aquí no hay lógica de negocio. Cada decisión de verdad vive en su módulo
 * —cuándo un fichero está terminado, en qué orden se apunta y se mueve, qué se
 * tapa en el registro— y esto solo los pone a funcionar en el orden correcto y
 * los para bien. Si algún día hay que discutir una regla, no se discute aquí.
 *
 * ## El orden del arranque no es casual
 *
 * 1. **Configuración y carpetas.** Sin ellas no hay ni dónde escribir el log.
 * 2. **Registro**, cuanto antes: a partir de aquí lo que falle deja rastro.
 * 3. **El panel**, ANTES que nada más. Es lo que da la bandeja y la pantalla de
 *    activación; si el agente todavía no tiene credencial, esto es lo único que
 *    puede arreglarlo, y sin panel no habría por dónde.
 * 4. **La cola y la reconciliación**: rescatar lo que quedó a medias y terminar
 *    de archivar lo entregado. ANTES de subir nada nuevo, para no duplicar.
 * 5. **Vigilante y enviador.**
 *
 * ## Una sola instancia, y el portero es el puerto
 *
 * Dos agentes sobre la misma carpeta se pisarían al archivar: uno mueve el PDF
 * mientras el otro cree que sigue en Inbox. No hace falta un fichero de bloqueo
 * con su PID y su limpieza tras un cuelgue —que es otra cosa que puede
 * quedarse mal—: el panel ya ocupa un puerto, y el sistema operativo no deja
 * ocuparlo dos veces. Si `listen` da EADDRINUSE, hay otro agente y este se va
 * diciéndolo.
 *
 * ## Sin credencial NO se para: se espera
 *
 * Un agente recién instalado no tiene credencial, y ése es su estado normal
 * hasta que alguien pega el código de activación. Salir con error dejaría al
 * técnico sin bandeja donde escribirlo. Así que arranca, vigila la carpeta
 * —encolar no necesita servidor— y espera. En cuanto se activa, la cola que se
 * ha ido llenando sale sola.
 */

import { Actualizador } from "./actualizador.ts";
import { ClienteAutoScan, type ServidorDeAutoScan } from "./api.ts";
import { Cola } from "./cola.ts";
import { cargarConfig, prepararCarpetas, type Config } from "./config.ts";
import { AlmacenEnMemoria, type AlmacenDeCredencial, type Credencial } from "./credencial.ts";
import { almacenDelSistema } from "./dpapi.ts";
import { Enviador } from "./enviador.ts";
import { Panel, PUERTO_POR_DEFECTO, type Estado } from "./panel.ts";
import { Registro } from "./registro.ts";
import { Vigilante } from "./vigilante.ts";
import { esMasNueva } from "./version.ts";

/** La versión que se le dice al servidor en la activación y en cada latido. */
export const VERSION = "1.0.4";

export class Agente {
  readonly #cfg: Config;
  readonly #registro: Registro;
  readonly #cola: Cola;
  readonly #almacen: AlmacenDeCredencial;
  readonly #cliente: ServidorDeAutoScan;
  readonly #vigilante: Vigilante;
  readonly #enviador: Enviador;
  readonly #panel: Panel;
  readonly #actualizador: Actualizador;

  #credencial: Credencial | null = null;
  /**
   * La versión publicada que SÍ es más nueva que la nuestra, o `null`.
   *
   * Se guarda ya filtrada: lo que el servidor anuncia pasa por `esMasNueva`
   * antes de llegar aquí, así que si esto tiene valor es que hay algo que
   * instalar de verdad. Guardar lo anunciado en crudo obligaría a repetir la
   * comparación en cada sitio que lo mire —el panel, la bandeja— y bastaría
   * olvidarla en uno para ofrecer un botón que retrocede de versión.
   */
  #actualizacion: { version: string; url: string } | null = null;
  #ultimoLatidoMs: number | null = null;
  #ultimoError: string | null = null;
  #latido: NodeJS.Timeout | null = null;
  #puerto = 0;

  /**
   * El cliente y el almacén entran por el constructor, no se construyen dentro.
   *
   * Es el mismo patrón que el resto de la casa (`AlmacenDeCredencial`,
   * `ComprobadorDeLicencia`): la implementación de verdad habla con Mobilink y
   * las pruebas registran una falsa. Sin esta costura, probar el recorrido
   * entero exigiría o levantar un servidor o hurgar en campos privados, y las
   * dos cosas terminan probando el andamio en vez del agente.
   */
  constructor(
    cfg: Config,
    almacen: AlmacenDeCredencial,
    cliente: ServidorDeAutoScan = new ClienteAutoScan(cfg.servidor, VERSION)
  ) {
    this.#cfg = cfg;
    this.#almacen = almacen;
    /*
     * A consola sí, salvo bajo vitest: el fichero sigue escribiéndose igual y
     * lo que se prueba se comprueba ahí, pero doce agentes arrancando en una
     * suite llenarían la salida y esconderían lo que sí hay que leer.
     */
    this.#registro = new Registro(cfg.logs, !process.env.VITEST);
    this.#cola = new Cola(cfg.baseDatos);
    this.#cliente = cliente;

    const log = (m: string) => this.#registro.escribir(m);
    this.#vigilante = new Vigilante(cfg, this.#cola, log);
    this.#enviador = new Enviador(cfg, this.#cola, this.#cliente, log);
    this.#actualizador = new Actualizador(cfg, log);
    this.#panel = new Panel(cfg, this.#acciones(), log);
  }

  /** El puerto que ha acabado ocupando el panel. Útil con `puerto = 0`. */
  get puerto(): number {
    return this.#puerto;
  }

  async arrancar(puerto = PUERTO_POR_DEFECTO): Promise<void> {
    this.#registro.escribir(`[agente] arrancando ${VERSION} sobre ${this.#cfg.raiz}`);

    try {
      this.#puerto = await this.#panel.arrancar(puerto);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "EADDRINUSE") {
        /*
         * El puerto ocupado es la señal de que ya hay un agente. Se dice y se
         * sale limpiamente: dos agentes sobre la misma carpeta se pisarían al
         * archivar, y eso sí puede perder un fichero.
         */
        throw new Error(
          `Ya hay un agente de AutoScan en marcha (puerto ${puerto} ocupado). Este no arranca.`
        );
      }
      throw e;
    }

    this.#credencial = await this.#leerCredencial();
    if (this.#credencial) {
      this.#registro.escribir(`[agente] activado en «${this.#credencial.nombre}»`);
    } else {
      /*
       * No es un error: es el estado de una instalación recién hecha. Se dice
       * en el log para que quien mire sepa que falta un paso, no que algo se ha
       * roto.
       */
      this.#registro.escribir("[agente] sin activar todavía: pega el código desde la bandeja");
    }

    const r = await this.#enviador.reconciliar();
    if (r.rescatadas || r.archivadas) {
      this.#registro.escribir(
        `[agente] al arrancar: ${r.rescatadas} rescatada(s), ${r.archivadas} archivada(s)`
      );
    }

    await this.#vigilante.arrancar();
    this.#ponerEnMarchaLoQueNecesitaCredencial();
  }

  async parar(): Promise<void> {
    this.#registro.escribir("[agente] parando");
    if (this.#latido) clearInterval(this.#latido);
    this.#latido = null;
    this.#vigilante.parar();
    this.#enviador.parar();
    await this.#panel.parar();
    this.#cola.cerrar();
    this.#registro.cerrar();
  }

  /** El enviador y el latido solo tienen sentido con credencial. */
  #ponerEnMarchaLoQueNecesitaCredencial(): void {
    const c = this.#credencial;
    if (!c || this.#latido) return;

    this.#enviador.arrancar(c.secret);
    const latir = async () => {
      const r = await this.#cliente.latido(c.secret);
      if (!r.ok) return;
      this.#ultimoLatidoMs = Date.now();
      /*
       * El filtro está AQUÍ y en un solo sitio. Lo que el servidor anuncia no
       * es una orden: si no es más nueva que la nuestra, no existe.
       */
      this.#actualizacion =
        r.publicado && esMasNueva(r.publicado.version, VERSION) ? r.publicado : null;
    };
    void latir();
    this.#latido = setInterval(() => void latir(), this.#cfg.latidoMs);
    this.#latido.unref?.();
  }

  async #leerCredencial(): Promise<Credencial | null> {
    try {
      return await this.#almacen.leer();
    } catch (e) {
      /*
       * DPAPI puede fallar de verdad: la credencial la cifró OTRA cuenta de
       * Windows, o el perfil se ha restaurado en otra máquina. No se inventa
       * nada ni se cae a texto plano — se dice, y el remedio es reactivar.
       */
      this.#ultimoError =
        "No se ha podido leer la credencial guardada. Hay que volver a activar el dispositivo.";
      this.#registro.escribir(`[agente] credencial ilegible: ${String(e)}`);
      return null;
    }
  }

  #acciones() {
    return {
      estado: (): Estado => {
        const r = this.#cola.resumen();
        const v = this.#vigilante.estado();
        return {
          version: VERSION,
          activado: this.#credencial != null,
          centro: this.#credencial?.nombre ?? null,
          ultimoLatidoMs: this.#ultimoLatidoMs,
          pendientes: r.pendientes,
          subiendo: r.subiendo,
          rechazadas: r.rechazadas,
          archivadas: r.archivadas,
          vigilados: v.vigilados,
          atascados: v.atascados,
          ultimoError: this.#ultimoError,
          actualizacion: this.#actualizacion,
          carpetas: {
            inbox: this.#cfg.inbox,
            sent: this.#cfg.sent,
            failed: this.#cfg.failed,
            logs: this.#cfg.logs,
          },
        };
      },

      reintentarRechazadas: (): number => {
        const n = this.#cola.reencolarRechazadas();
        this.#registro.escribir(`[agente] ${n} documento(s) apartados vuelven a la cola`);
        return n;
      },

      /*
       * «Sincronizar ahora» hace las DOS cosas: mirar la carpeta y vaciar la
       * cola. Quien pulsa ese botón acaba de dejar un papel en el escáner y no
       * distingue entre «no lo he visto» y «no lo he subido» — ni tiene por qué.
       */
      sincronizarAhora: async (): Promise<void> => {
        await this.#vigilante.barrer();
        if (this.#credencial) await this.#enviador.ciclo(this.#credencial.secret);
      },

      /*
       * Actualizar lo pide una persona desde la bandeja, y no se hace solo.
       *
       * No es falta de ganas: el guion para el agente, mueve carpetas y vuelve
       * atrás si la versión nueva no responde, y nada de eso se ha podido
       * probar en Windows desde el entorno de desarrollo. Con alguien delante,
       * un cambio que salga mal se ve en el momento y en un mostrador; sin
       * nadie, saldría mal en los veinte a la vez y de madrugada.
       *
       * Cuando esto se haya usado unas cuantas veces de verdad, automatizarlo
       * es mover esta llamada a un temporizador. Antes, no.
       */
      actualizar: async (): Promise<string> => {
        const a = this.#actualizacion;
        if (!a) throw new Error("No hay ninguna versión nueva que instalar.");
        await this.#actualizador.aplicar(a, VERSION);
        return a.version;
      },

      activar: async (codigo: string): Promise<void> => {
        const a = await this.#cliente.activar(codigo);
        const credencial: Credencial = {
          secret: a.secret,
          deviceId: a.deviceId,
          empresaId: a.empresaId,
          centroId: a.centroId,
          nombre: a.nombre,
          activadoAtMs: Date.now(),
        };
        /*
         * Se guarda ANTES de darlo por bueno. El servidor gasta el código en la
         * misma transacción que crea el dispositivo: si esto devuelve algo y no
         * se guarda, el código ya no sirve y hay que pedir otro.
         */
        await this.#almacen.guardar(credencial);
        this.#credencial = credencial;
        this.#ultimoError = null;
        /* Sin código ni secreto en el log: el nombre del centro basta. */
        this.#registro.escribir(`[agente] activado en «${a.nombre}»`);
        this.#ponerEnMarchaLoQueNecesitaCredencial();
      },
    };
  }
}

/**
 * Arranque real, el que ejecuta el servicio de Windows.
 *
 * Fuera de Windows usa el almacén en memoria: `almacenDelSistema` se niega a
 * adivinar, y para desarrollo hace falta poder levantarlo en Linux sin guardar
 * el secreto en claro en ningún sitio.
 */
export async function principal(): Promise<void> {
  const cfg = cargarConfig();
  prepararCarpetas(cfg);

  const almacen =
    process.platform === "win32" ? almacenDelSistema(cfg.raiz) : new AlmacenEnMemoria();

  const agente = new Agente(cfg, almacen);
  await agente.arrancar(Number(process.env.MOBILINK_AUTOSCAN_PUERTO) || PUERTO_POR_DEFECTO);

  /*
   * Parar bien importa: cerrar SQLite deja la cola consistente y el panel borra
   * su token. Un `kill` a secas también sobrevive —para eso está la
   * reconciliación del arranque— pero no hay razón para hacerlo mal cuando
   * Windows avisa.
   */
  for (const señal of ["SIGINT", "SIGTERM"] as const) {
    process.on(señal, () => {
      void agente.parar().then(() => process.exit(0));
    });
  }
}
