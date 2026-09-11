/**
 * El registro del agente: un fichero por día, y los viejos se van solos.
 *
 * En el PC de recepción nadie va a mirar esto hasta que algo falle, y entonces
 * lo va a mirar por teléfono alguien que no está delante. De ahí las dos
 * decisiones:
 *
 * **Un fichero por día**, con la fecha en el nombre. «Mándame el de ayer» es
 * una instrucción que se puede dar por teléfono; «busca en el log la parte del
 * martes» no.
 *
 * **Se borran los de hace más de un mes.** Un agente lleva años arrancado en
 * una máquina a la que nadie entra: sin poda, el registro crece hasta llenar el
 * disco, y el primer síntoma sería que ScanSnap no puede escribir el PDF. Que
 * el diagnóstico se coma el disco del paciente es la peor forma de fallar.
 *
 * ## Lo que no se escribe aquí
 *
 * Ni la credencial, ni el token del panel, ni el código de activación. Un
 * registro se manda por correo cuando algo va mal, y va a parar a un buzón, a
 * un móvil y a una carpeta de descargas. Un secreto ahí dentro deja de serlo
 * en el momento en que alguien pide ayuda.
 *
 * La regla es fácil de saltarse sin querer —basta un `${JSON.stringify(algo)}`
 * de más—, así que además de escribirla, `tapar()` la aplica: lo que huela a
 * secreto se sustituye antes de tocar el disco.
 */

import fs from "node:fs";
import path from "node:path";

/** Cuánto se guarda. Un mes cubre «esto pasó antes de vacaciones». */
const DIAS_QUE_SE_GUARDAN = 31;

/**
 * Lo que nunca debe acabar en un fichero de texto.
 *
 * Se buscan las FORMAS, no los valores concretos: el secreto del dispositivo es
 * hexadecimal largo y el código de activación son letras y números en bloque.
 * Preferimos tapar de más —algún hash de fichero saldrá censurado— que dejar
 * escapar una credencial. Un sha256 tapado no rompe nada; un secreto en un
 * correo, sí.
 */
const SOSPECHOSOS: { patron: RegExp; con: string }[] = [
  /* `"secret":"…"`, `token=…`, `x-autoscan-key: …` y familia. */
  {
    patron: /((?:secret|token|clave|password|key|codigo)["'\s:=]+)([A-Za-z0-9_\-.]{8,})/gi,
    con: "$1«tapado»",
  },
  /* Cualquier tira hexadecimal larga y suelta: secretos y tokens del panel. */
  { patron: /\b[0-9a-f]{32,}\b/gi, con: "«tapado»" },
];

/** Quita del texto lo que no debería salir de esta máquina. */
export function tapar(texto: string): string {
  let salida = texto;
  for (const s of SOSPECHOSOS) salida = salida.replace(s.patron, s.con);
  return salida;
}

/** `2026-09-08`, en hora local: es la que usa quien pide «el de ayer». */
function dia(fecha: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${fecha.getFullYear()}-${p(fecha.getMonth() + 1)}-${p(fecha.getDate())}`;
}

export class Registro {
  readonly #carpeta: string;
  readonly #alaConsola: boolean;
  #diaAbierto = "";
  #flujo: fs.WriteStream | null = null;

  constructor(carpeta: string, alaConsola = true) {
    this.#carpeta = carpeta;
    this.#alaConsola = alaConsola;
  }

  /**
   * Escribe una línea. Nunca lanza.
   *
   * Un fallo al registrar no puede tumbar el agente: quedarse sin subir
   * facturas porque no se pudo escribir en el log sería cambiar un problema
   * pequeño por el único que importa.
   */
  escribir(mensaje: string, ahora = new Date()): void {
    const linea = `${ahora.toISOString()} ${tapar(mensaje)}\n`;
    if (this.#alaConsola) process.stdout.write(linea);
    try {
      this.#abrirSiToca(ahora);
      this.#flujo?.write(linea);
    } catch {
      /* Si el disco no deja escribir, el agente sigue. */
    }
  }

  /** Cierra el fichero. Idempotente. */
  cerrar(): void {
    this.#flujo?.end();
    this.#flujo = null;
    this.#diaAbierto = "";
  }

  /** El fichero de hoy, para poder decirle a alguien cuál mandar. */
  ficheroDe(fecha = new Date()): string {
    return path.join(this.#carpeta, `agente-${dia(fecha)}.log`);
  }

  #abrirSiToca(ahora: Date): void {
    const hoy = dia(ahora);
    if (hoy === this.#diaAbierto && this.#flujo) return;

    this.#flujo?.end();
    fs.mkdirSync(this.#carpeta, { recursive: true });

    const flujo = fs.createWriteStream(this.ficheroDe(ahora), { flags: "a" });
    /*
     * ESTE `on("error")` es lo que impide que el registro mate al agente.
     *
     * `createWriteStream` abre el fichero de forma ASÍNCRONA: el `try/catch` de
     * quien llama ya ha terminado cuando el fallo aparece, y un `error` sin
     * oyente en un stream es una excepción no capturada — que en Node tumba el
     * proceso. O sea: el agente dejaría de subir facturas porque no pudo
     * escribir una línea de log. Pasa de verdad cuando alguien borra o renombra
     * la carpeta con el agente en marcha.
     *
     * Se apunta a la consola y se suelta el flujo, para que el siguiente
     * `escribir()` intente abrirlo otra vez: si la carpeta vuelve, el registro
     * vuelve solo.
     */
    flujo.on("error", (e) => {
      if (this.#flujo === flujo) {
        this.#flujo = null;
        this.#diaAbierto = "";
      }
      if (this.#alaConsola) process.stdout.write(`[registro] no se puede escribir: ${String(e)}\n`);
    });

    this.#flujo = flujo;
    this.#diaAbierto = hoy;

    /*
     * La poda va aquí, al cambiar de día, y no en un temporizador: así ocurre
     * exactamente una vez por día natural y en un agente que lleve meses
     * apagado se hace en cuanto vuelve, sin esperar a que pase un intervalo.
     */
    this.podar(ahora);
  }

  /**
   * Borra los registros de hace más de un mes.
   *
   * Solo toca ficheros con SU nombre. En esa carpeta puede haber cualquier cosa
   * que alguien haya dejado —un volcado, una captura— y un `readdir` que borra
   * todo lo viejo es una línea a la que se le acaba escapando algo que
   * importaba.
   */
  podar(ahora = new Date(), diasQueSeGuardan = DIAS_QUE_SE_GUARDAN): number {
    const limite = ahora.getTime() - diasQueSeGuardan * 86_400_000;
    let borrados = 0;
    try {
      for (const nombre of fs.readdirSync(this.#carpeta)) {
        const m = /^agente-(\d{4}-\d{2}-\d{2})\.log$/.exec(nombre);
        if (!m) continue;
        /* Mediodía para que el huso no mueva la fecha de un día al otro. */
        if (new Date(`${m[1]}T12:00:00Z`).getTime() >= limite) continue;
        fs.unlinkSync(path.join(this.#carpeta, nombre));
        borrados += 1;
      }
    } catch {
      /* Si no se puede podar, se sigue: no es motivo para parar nada. */
    }
    return borrados;
  }
}
