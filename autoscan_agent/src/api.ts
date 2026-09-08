/**
 * Las tres rutas de máquina, y nada más.
 *
 * El agente no habla con el resto de Mobilink Cash: no lee cajas, ni jornadas,
 * ni cobros. Su credencial no se lo permitiría aunque lo intentara, y este
 * fichero refleja eso — si algún día aparece aquí un `GET /operations`, algo se
 * ha entendido mal.
 *
 * ## Lo que hay que distinguir, y por qué
 *
 * La respuesta del servidor decide si un fichero se reintenta o se aparta, y
 * confundirlo tiene consecuencias feas en las dos direcciones:
 *
 *   · reintentar lo irreintentable = un PDF de 20 MB golpeando el servidor
 *     cada minuto para siempre, y nadie enterándose de que hay que bajar la
 *     calidad del escáner;
 *   · apartar lo reintentable = una factura perdida porque el Wi-Fi del taller
 *     se cayó dos minutos.
 *
 * Así que cada respuesta se traduce a una de tres cosas: **entregado**,
 * **reintentable** o **rechazado**.
 *
 * Caso aparte: **403 `LICENCIA_CADUCADA`**. La credencial es buena y la
 * licencia no. Es reintentable —se renueva y sigue solo— pero NUNCA debe
 * hacer que el agente borre su credencial, que es lo que haría con un 401.
 */

import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import path from "node:path";

export type Entregado = {
  clase: "entregado";
  documentoId: number;
  /** true = el servidor ya lo tenía. Cuenta igual como entregado. */
  duplicado: boolean;
  estado: string;
};

export type Reintentable = {
  clase: "reintentable";
  motivo: string;
  /** Para poder enseñar «sin licencia» en la bandeja y no un error genérico. */
  codigo: string | null;
  /** true = la credencial ya no vale: hay que reactivar, no reintentar. */
  credencialInvalida: boolean;
};

export type Rechazado = {
  clase: "rechazado";
  motivo: string;
  codigo: string | null;
};

export type Resultado = Entregado | Reintentable | Rechazado;

export type Activacion = {
  deviceId: number;
  secret: string;
  empresaId: string;
  centroId: string;
  nombre: string;
};

/**
 * El tipo declarado sale de la extensión, pero **no decide nada**.
 *
 * El servidor mira los primeros bytes del fichero y usa ESO. Mandar
 * `application/pdf` para un JPG solo conseguiría que el servidor lo corrigiera
 * por su cuenta; declarar lo que parece es simple honestidad, no una
 * comprobación.
 */
function tipoPorExtension(nombre: string): string {
  const ext = path.extname(nombre).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  return "application/pdf";
}

const TIEMPO_SUBIDA_MS = 120_000;
const TIEMPO_CORTO_MS = 20_000;

export class ClienteAutoScan {
  readonly #base: string;
  readonly #version: string;

  constructor(servidor: string, version: string) {
    this.#base = `${servidor.replace(/\/+$/, "")}/api/cash/autoscan`;
    this.#version = version;
  }

  /**
   * Canjea el código por la credencial permanente.
   *
   * Se llama UNA vez en la vida del dispositivo. El servidor gasta el código en
   * la misma transacción que crea el dispositivo, así que si esto devuelve algo
   * y luego se pierde, el código ya no sirve: hay que pedir otro.
   */
  async activar(codigo: string): Promise<Activacion> {
    const res = await this.#pedir("/activate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ codigo: codigo.trim().toUpperCase(), version: this.#version }),
      señal: TIEMPO_CORTO_MS,
    });
    const cuerpo = await this.#json(res);
    if (res.status !== 201) {
      throw new Error(
        typeof cuerpo.error === "string"
          ? cuerpo.error
          : "No se ha podido activar el dispositivo."
      );
    }
    return cuerpo as Activacion;
  }

  /**
   * Deja un documento en la bandeja del centro.
   *
   * `idempotencyKey` es OBLIGATORIA para el servidor, y va por **cabecera** a
   * propósito: como campo del multipart solo funcionaría si viajara antes del
   * fichero —`multer` descarta los campos que llegan después—, y eso es una
   * trampa que se paga con una idempotencia que parece funcionar y no funciona.
   */
  async subir(
    secret: string,
    fichero: { ruta: string; nombre: string; tamano: number },
    idempotencyKey: string,
    escaneadoAtMs: number | null
  ): Promise<Resultado> {
    const form = new FormData();

    /*
     * ANTES del fichero, y no es cosmético: `multer` solo deja en `req.body`
     * los campos que llegan antes del adjunto. Puesto después, el servidor no
     * lo vería y la fecha del escaneo se perdería sin que nadie se entere.
     *
     * La clave de idempotencia va por cabecera justo para no depender de esto.
     */
    if (escaneadoAtMs) form.append("escaneadoAtMs", String(escaneadoAtMs));

    const cuerpo = Readable.toWeb(createReadStream(fichero.ruta)) as ReadableStream;
    form.append(
      "documento",
      new File([await new Response(cuerpo).blob()], path.basename(fichero.nombre), {
        type: tipoPorExtension(fichero.nombre),
      })
    );

    let res: Response;
    try {
      res = await this.#pedir("/documents", {
        method: "POST",
        headers: {
          "x-autoscan-key": secret,
          "idempotency-key": idempotencyKey,
        },
        body: form,
        señal: TIEMPO_SUBIDA_MS,
      });
    } catch (e) {
      // Sin respuesta: red, DNS, servidor caído. Siempre reintentable.
      return {
        clase: "reintentable",
        motivo: e instanceof Error ? e.message : "No se ha podido contactar con Mobilink.",
        codigo: null,
        credencialInvalida: false,
      };
    }

    return this.#traducir(res, await this.#json(res));
  }

  /** Sigo vivo, y ésta es mi versión. Que falle no es grave: se reintenta solo. */
  async latido(secret: string): Promise<boolean> {
    try {
      const res = await this.#pedir("/heartbeat", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-autoscan-key": secret },
        body: JSON.stringify({ version: this.#version }),
        señal: TIEMPO_CORTO_MS,
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /* eslint-disable @typescript-eslint/no-explicit-any */
  #traducir(res: Response, cuerpo: any): Resultado {
    const codigo = typeof cuerpo?.code === "string" ? cuerpo.code : null;
    const mensaje =
      typeof cuerpo?.error === "string" ? cuerpo.error : `El servidor ha respondido ${res.status}.`;

    /*
     * 202 nuevo, 200 ya lo tenía. Los dos significan lo mismo para el agente:
     * el documento ESTÁ en el servidor y este fichero ya no es su problema.
     * Tratar el 200 como error haría que un reintento tras un corte de red
     * dejara el fichero atascado para siempre.
     */
    if (res.status === 202 || res.status === 200) {
      return {
        clase: "entregado",
        documentoId: Number(cuerpo?.documentoId ?? 0),
        duplicado: Boolean(cuerpo?.duplicado),
        estado: String(cuerpo?.estado ?? "PENDIENTE"),
      };
    }

    if (res.status === 401) {
      return {
        clase: "reintentable",
        motivo: "La credencial de este escáner ya no vale. Hay que volver a activarlo.",
        codigo,
        // Reintentable en el sentido de «no tires el fichero», pero la cola se
        // para hasta que alguien reactive: seguir intentando no arregla nada.
        credencialInvalida: true,
      };
    }

    if (res.status === 403) {
      return {
        clase: "reintentable",
        motivo: mensaje,
        codigo,
        // La credencial es BUENA. No se borra por esto.
        credencialInvalida: false,
      };
    }

    /*
     * 400 es del documento: formato, tamaño, o falta algo. Reintentarlo da
     * exactamente el mismo 400 dentro de una hora. Se aparta y se enseña.
     */
    if (res.status === 400) {
      return { clase: "rechazado", motivo: mensaje, codigo };
    }

    // 5xx, 429 y lo que no esperábamos: del servidor, y se le da otra oportunidad.
    return { clase: "reintentable", motivo: mensaje, codigo, credencialInvalida: false };
  }

  async #json(res: Response): Promise<any> {
    try {
      return await res.json();
    } catch {
      return {};
    }
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */

  async #pedir(
    ruta: string,
    opciones: RequestInit & { señal: number }
  ): Promise<Response> {
    const { señal, ...resto } = opciones;
    if (!this.#base.startsWith("http")) {
      throw new Error(
        "No hay servidor configurado. Falta la dirección de Mobilink en la configuración del agente."
      );
    }
    return fetch(`${this.#base}${ruta}`, { ...resto, signal: AbortSignal.timeout(señal) });
  }
}
