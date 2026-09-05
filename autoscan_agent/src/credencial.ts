/**
 * Dónde vive el secreto del dispositivo.
 *
 * La credencial que devuelve `/autoscan/activate` **no caduca**. Es la llave
 * que deja subir facturas a nombre de una empresa y un centro, y vive en el PC
 * de recepción del taller, que es una máquina a la que se acerca cualquiera.
 * Un `.json` en texto plano al lado del ejecutable la regala.
 *
 * Por eso se cifra con **DPAPI en ámbito de usuario**: el sistema la ata a la
 * cuenta de Windows que la guardó. Copiar el fichero a otro PC, o abrirlo desde
 * otra cuenta, no sirve de nada. No hay clave que gestionar ni que esconder en
 * el binario —que sería esconderla debajo del felpudo—.
 *
 * ## Un puerto, y por qué
 *
 * `AlmacenDeCredencial` es una interfaz con dos implementaciones: DPAPI de
 * verdad, y una en memoria para las pruebas. Sin esto, la suite entera
 * dependería de estar corriendo en Windows, y el agente se desarrollaría a
 * ciegas hasta el día de instalarlo.
 *
 * ## Lo que NO se hace: caer a texto plano
 *
 * Si DPAPI no está disponible, esto **falla**. No escribe el secreto sin cifrar
 * «para que al menos funcione». Un fallback silencioso a texto plano convierte
 * un problema visible —el agente no arranca y alguien lo mira— en uno invisible
 * —el agente funciona y la llave está en un fichero legible durante dos años—.
 */

export type Credencial = {
  secret: string;
  deviceId: number;
  empresaId: string;
  centroId: string;
  nombre: string;
  /** Cuándo se activó, para poder decirlo en la ventana de estado. */
  activadoAtMs: number;
};

export interface AlmacenDeCredencial {
  /** `null` si el dispositivo todavía no está activado. */
  leer(): Promise<Credencial | null>;
  guardar(c: Credencial): Promise<void>;
  /** Al revocar o al reactivar. No falla si no había nada. */
  borrar(): Promise<void>;
  /** Para la ventana de estado: dónde se guarda y con qué se protege. */
  descripcion(): string;
}

/**
 * Almacén de mentira para las pruebas y para desarrollo fuera de Windows.
 *
 * Se llama así, y no `AlmacenSimple` ni nada que suene a producción, porque
 * alguien acabará leyendo esta línea buscando por qué su secreto no sobrevive
 * a un reinicio.
 */
export class AlmacenEnMemoria implements AlmacenDeCredencial {
  #valor: Credencial | null = null;

  async leer(): Promise<Credencial | null> {
    return this.#valor;
  }
  async guardar(c: Credencial): Promise<void> {
    this.#valor = c;
  }
  async borrar(): Promise<void> {
    this.#valor = null;
  }
  descripcion(): string {
    return "en memoria (solo pruebas: se pierde al cerrar)";
  }
}

export class ErrorDeCredencial extends Error {
  readonly codigo: string;
  constructor(codigo: string, mensaje: string) {
    super(mensaje);
    this.codigo = codigo;
    this.name = "ErrorDeCredencial";
  }
}
