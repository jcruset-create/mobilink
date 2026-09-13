/**
 * Limitador de ritmo: «como mucho N peticiones cada M milisegundos».
 *
 * Movertis dice 150 consultas por 5 minutos, y que pasarse alarga las
 * respuestas y puede acabar en bloqueo del token. Un token bloqueado no es un
 * error de una noche: es la flota entera sin kilometraje hasta que alguien
 * llame al proveedor. Así que aquí se trabaja con margen —100 por defecto— y
 * se ESPERA en vez de fallar: quien pide turno se queda en `await` hasta que
 * lo hay, y una sincronización que tarda diez minutos es una sincronización
 * que ha ido bien.
 *
 * Ventana deslizante sobre las marcas de tiempo de las últimas peticiones, no
 * cubos por minuto: con cubos, 100 peticiones a las 12:04:59 y otras 100 a las
 * 12:05:00 son «legales» y son exactamente 200 en un segundo.
 *
 * Un limitador por CUENTA, no por proceso: el límite es del token, y dos
 * cuentas con dos tokens no se estorban. El registro de abajo los reparte.
 */

/** No hay turno a tiempo. Lleva cuánto habría que esperar, para poder decirlo. */
export class ErrorRitmo extends Error {
  constructor(public readonly esperaMs: number) {
    super(`No hay cupo con el proveedor ahora mismo: habría que esperar ${Math.ceil(esperaMs / 1000)} s`);
    this.name = "ErrorRitmo";
  }
}

export interface OpcionesRitmo {
  /** Peticiones permitidas dentro de la ventana. */
  maximo: number;
  /** Tamaño de la ventana en ms. */
  ventanaMs: number;
  /** Para pruebas: reloj y espera inyectables. */
  ahora?: () => number;
  esperar?: (ms: number) => Promise<void>;
}

export class LimitadorDeRitmo {
  private marcas: number[] = [];
  private readonly ahora: () => number;
  private readonly esperar: (ms: number) => Promise<void>;
  /** Cola de turnos: sin ella, dos `await turno()` a la vez pasarían los dos. */
  private cola: Promise<void> = Promise.resolve();

  constructor(private readonly opciones: OpcionesRitmo) {
    this.ahora = opciones.ahora ?? (() => Date.now());
    this.esperar = opciones.esperar ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  /**
   * Espera hasta que se pueda hacer una petición más, y la apunta.
   *
   * `esperaMaximaMs` es para quien tiene a alguien delante mirando: si el
   * turno no va a llegar a tiempo, se rinde con `ErrorRitmo` en vez de dejar
   * la petición HTTP colgada cinco minutos. Un job nocturno no lo pasa nunca:
   * él sí puede esperar, y esperar es exactamente lo que debe hacer.
   */
  turno(esperaMaximaMs?: number): Promise<void> {
    const mio = this.cola.then(() => this.esperarHueco(esperaMaximaMs));
    // La cola no se rompe por un rechazo: el siguiente sigue esperando lo suyo.
    this.cola = mio.catch(() => undefined);
    return mio;
  }

  private async esperarHueco(esperaMaximaMs?: number): Promise<void> {
    const limite = esperaMaximaMs === undefined ? undefined : this.ahora() + esperaMaximaMs;
    for (;;) {
      const t = this.ahora();
      this.marcas = this.marcas.filter((m) => t - m < this.opciones.ventanaMs);
      if (this.marcas.length < this.opciones.maximo) {
        this.marcas.push(t);
        return;
      }
      // Hasta que caduque la más antigua, ni un milisegundo antes.
      const libera = this.marcas[0] + this.opciones.ventanaMs - t;
      if (limite !== undefined && t + libera > limite) {
        throw new ErrorRitmo(Math.max(1, libera));
      }
      await this.esperar(Math.max(1, libera));
    }
  }

  /** El ritmo con el que se construyó, para saber si la config ya no cuadra. */
  get ritmo(): Pick<OpcionesRitmo, "maximo" | "ventanaMs"> {
    return { maximo: this.opciones.maximo, ventanaMs: this.opciones.ventanaMs };
  }

  /** Cuántas peticiones se han hecho dentro de la ventana actual. */
  enVentana(): number {
    const t = this.ahora();
    return this.marcas.filter((m) => t - m < this.opciones.ventanaMs).length;
  }
}

/**
 * Movertis: 150 / 5 min documentados. Se trabaja a dos tercios.
 *
 * Es el TECHO, no lo que se usa: la cuenta puede pedir menos desde su config
 * (`ritmo`), y en Autocares Plana se pide bastante menos. Ver `ritmoDeConfig`.
 */
export const RITMO_MOVERTIS: Pick<OpcionesRitmo, "maximo" | "ventanaMs"> = {
  maximo: 100,
  ventanaMs: 5 * 60_000,
};

/**
 * El ritmo que pide la config de una cuenta, saneado.
 *
 * Existe porque el límite documentado NO es necesariamente el límite real: la
 * primera importación de Plana empezó a recibir «Core Error: 4» a todo sin que
 * hubiera documentación de qué significa. Poder bajar el ritmo desde una
 * columna, sin desplegar, es la diferencia entre probar una hipótesis esta
 * tarde y probarla la semana que viene.
 *
 * Se acepta `{"ritmo":{"maximo":1,"ventanaMs":300000}}` en la config del
 * conector. Nunca por encima del techo documentado: una config no puede
 * subirse el límite del proveedor, solo bajárselo.
 */
export function ritmoDeConfig(
  config: Record<string, unknown> | undefined,
  techo: Pick<OpcionesRitmo, "maximo" | "ventanaMs"> = RITMO_MOVERTIS,
): Pick<OpcionesRitmo, "maximo" | "ventanaMs"> {
  const r = (config?.ritmo ?? {}) as Record<string, unknown>;
  const maximo = Number(r.maximo);
  const ventanaMs = Number(r.ventanaMs);
  if (!Number.isFinite(maximo) || maximo < 1) return techo;

  const pedido = {
    maximo: Math.floor(maximo),
    // Menos de un segundo no es un ritmo, es un descuido.
    ventanaMs: Number.isFinite(ventanaMs) && ventanaMs >= 1000 ? Math.floor(ventanaMs) : techo.ventanaMs,
  };
  // Se compara el RITMO —peticiones por milisegundo—, no la ventana.
  //
  // La primera versión exigía una ventana al menos tan larga como la del
  // techo, y eso rechazaba justo lo que hacía falta: «una petición por
  // minuto» es la vigésima parte de 100 cada 5 minutos, pero con la ventana
  // más corta. Y la ventana corta no es un detalle, es lo único que ESPACIA:
  // con 12/5 min el limitador deja salir doce seguidas, que es exactamente la
  // ráfaga que tumbó a Movertis —seis peticiones de cuarenta segundos una
  // detrás de otra, sin respiro—.
  return pedido.maximo / pedido.ventanaMs > techo.maximo / techo.ventanaMs ? techo : pedido;
}

const registro = new Map<string, LimitadorDeRitmo>();

/**
 * El limitador de una cuenta concreta. Compartido por todo el proceso: el job
 * nocturno y una resincronización manual lanzada a la vez se reparten el
 * mismo cupo, que es lo que ve el proveedor.
 */
export function limitadorDe(
  clave: string,
  opciones: Pick<OpcionesRitmo, "maximo" | "ventanaMs"> = RITMO_MOVERTIS,
): LimitadorDeRitmo {
  const existente = registro.get(clave);
  // Si la config cambió el ritmo, se construye otro: quedarse con el de antes
  // haría que bajar el límite en la base no sirviera de nada hasta reiniciar,
  // que es justo cuando más prisa hay por bajarlo.
  if (existente && existente.ritmo.maximo === opciones.maximo && existente.ritmo.ventanaMs === opciones.ventanaMs) {
    return existente;
  }
  const l = new LimitadorDeRitmo(opciones);
  registro.set(clave, l);
  return l;
}

/** Solo para pruebas: olvida todos los limitadores. */
export function reiniciarLimitadoresParaPruebas(): void {
  registro.clear();
}
