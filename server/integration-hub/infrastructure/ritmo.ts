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

  /** Espera hasta que se pueda hacer una petición más, y la apunta. */
  turno(): Promise<void> {
    const mio = this.cola.then(() => this.esperarHueco());
    // La cola no se rompe por un rechazo: el siguiente sigue esperando lo suyo.
    this.cola = mio.catch(() => undefined);
    return mio;
  }

  private async esperarHueco(): Promise<void> {
    for (;;) {
      const t = this.ahora();
      this.marcas = this.marcas.filter((m) => t - m < this.opciones.ventanaMs);
      if (this.marcas.length < this.opciones.maximo) {
        this.marcas.push(t);
        return;
      }
      // Hasta que caduque la más antigua, ni un milisegundo antes.
      const libera = this.marcas[0] + this.opciones.ventanaMs - t;
      await this.esperar(Math.max(1, libera));
    }
  }

  /** Cuántas peticiones se han hecho dentro de la ventana actual. */
  enVentana(): number {
    const t = this.ahora();
    return this.marcas.filter((m) => t - m < this.opciones.ventanaMs).length;
  }
}

/** Movertis: 150 / 5 min documentados. Se trabaja a dos tercios. */
export const RITMO_MOVERTIS: Pick<OpcionesRitmo, "maximo" | "ventanaMs"> = {
  maximo: 100,
  ventanaMs: 5 * 60_000,
};

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
  let l = registro.get(clave);
  if (!l) {
    l = new LimitadorDeRitmo(opciones);
    registro.set(clave, l);
  }
  return l;
}

/** Solo para pruebas: olvida todos los limitadores. */
export function reiniciarLimitadoresParaPruebas(): void {
  registro.clear();
}
