/**
 * Lector de extractos bancarios en **Norma 43** (cuaderno 43 del CSB/AEB).
 *
 * Es el formato en el que **todos** los bancos españoles entregan el extracto:
 * Santander, BBVA, CaixaBank, Sabadell y las cajas rurales exportan el mismo
 * fichero. Elegir CSV habría significado un lector distinto por banco, y encima
 * cambiándolo cada vez que uno de ellos moviera una columna.
 *
 * El fichero son líneas de 80 caracteres, cada una con su código de registro:
 *
 * · `11` cabecera de cuenta (entidad, oficina, cuenta, fechas, saldo inicial)
 * · `22` movimiento (fecha, importe, concepto, referencias)
 * · `23` concepto ampliado del movimiento anterior (hasta cinco por movimiento)
 * · `33` fin de cuenta (saldo final y sumas de control)
 * · `88` fin de fichero
 *
 * Sin dependencias: el formato es de ancho fijo y las librerías que hay añaden
 * más superficie de la que ahorran.
 *
 * ## Dos decisiones que definen el lector
 *
 * **Los importes se leen como enteros, nunca como decimales.** El campo trae 12
 * dígitos de céntimos sin coma —`000000012345` son 123,45 €— así que se lee
 * como entero y ya está en la unidad del módulo. La coma flotante no llega a
 * tocar el dinero en ningún momento.
 *
 * **Un fichero mal formado no se lee «lo mejor posible».** Se devuelven los
 * errores, y quien llama decide. Un extracto leído a medias es peor que uno que
 * no se lee: conciliar contra la mitad de los movimientos da por descuadrado lo
 * que en realidad estaba bien.
 */

/** Un movimiento del extracto, ya en céntimos. */
export type MovimientoBancario = {
  /** Cuenta a la que pertenece, en formato CCC (20 dígitos). */
  cuenta: string;
  /** AAAA-MM-DD. */
  fecha: string;
  /** Fecha valor, que puede diferir de la de operación. */
  fechaValor: string;
  /** Positivo si entra dinero, negativo si sale. */
  importeCentimos: number;
  /** Concepto común (el código del banco) más el propio. */
  concepto: string;
  /** Referencias del banco: sirven para casar con el resguardo del ingreso. */
  referencia1: string;
  referencia2: string;
  /** Líneas `23`, ya unidas. Aquí suele venir el detalle útil. */
  ampliado: string;
};

export type ExtractoLeido = {
  cuentas: {
    cuenta: string;
    desde: string;
    hasta: string;
    saldoInicialCentimos: number;
    saldoFinalCentimos: number | null;
    movimientos: MovimientoBancario[];
    /** El saldo final declarado cuadra con inicial + movimientos. */
    cuadra: boolean;
  }[];
  errores: string[];
};

const num = (s: string) => Number(s.replace(/\D/g, "") || "0");

/** `AAMMDD` → `AAAA-MM-DD`. El siglo se decide como manda el cuaderno. */
function fecha(seis: string): string {
  const aa = num(seis.slice(0, 2));
  const mm = seis.slice(2, 4);
  const dd = seis.slice(4, 6);
  // Los ficheros del cuaderno llevan el año en dos cifras. Se toma el 2000 como
  // base: un extracto de los años noventa no se concilia con nada.
  return `${2000 + aa}-${mm}-${dd}`;
}

/**
 * El signo va en un campo aparte: `1` es debe (sale dinero) y `2` es haber
 * (entra). Es al revés de lo que sugiere el orden, así que conviene leerlo
 * despacio: para la CAJA, un ingreso en el banco es dinero que ENTRA en la
 * cuenta, o sea, un `2`.
 */
function conSigno(signo: string, importe: number): number {
  return signo === "1" ? -importe : importe;
}

export function leerNorma43(contenido: string): ExtractoLeido {
  const salida: ExtractoLeido = { cuentas: [], errores: [] };

  const lineas = contenido
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.length > 0);

  if (lineas.length === 0) {
    salida.errores.push("El fichero está vacío.");
    return salida;
  }

  let actual: ExtractoLeido["cuentas"][number] | null = null;
  let ultimo: MovimientoBancario | null = null;

  lineas.forEach((linea, i) => {
    const codigo = linea.slice(0, 2);
    const n = i + 1;

    switch (codigo) {
      case "11": {
        // Entidad(4) oficina(4) cuenta(10) → CCC con dígitos de control (2),
        // que el cuaderno no trae: se deja el CCC sin ellos, que es lo que
        // hace falta para identificar la cuenta.
        actual = {
          cuenta: linea.slice(2, 20),
          desde: fecha(linea.slice(20, 26)),
          hasta: fecha(linea.slice(26, 32)),
          saldoInicialCentimos: conSigno(linea.slice(32, 33), num(linea.slice(33, 47))),
          saldoFinalCentimos: null,
          movimientos: [],
          cuadra: false,
        };
        salida.cuentas.push(actual);
        ultimo = null;
        break;
      }

      case "22": {
        if (!actual) {
          salida.errores.push(`Línea ${n}: hay un movimiento antes de la cabecera de cuenta.`);
          break;
        }
        ultimo = {
          cuenta: actual.cuenta,
          fecha: fecha(linea.slice(10, 16)),
          fechaValor: fecha(linea.slice(16, 22)),
          importeCentimos: conSigno(linea.slice(27, 28), num(linea.slice(28, 42))),
          concepto: linea.slice(22, 27).trim(),
          referencia1: linea.slice(42, 52).trim(),
          referencia2: linea.slice(52, 68).trim(),
          ampliado: "",
        };
        actual.movimientos.push(ultimo);
        break;
      }

      case "23": {
        if (!ultimo) {
          salida.errores.push(`Línea ${n}: concepto ampliado sin movimiento al que pertenecer.`);
          break;
        }
        // Dos campos de 38, que se pegan al concepto ampliado del movimiento.
        const texto = `${linea.slice(4, 42)} ${linea.slice(42, 80)}`.replace(/\s+/g, " ").trim();
        ultimo.ampliado = `${ultimo.ampliado} ${texto}`.trim();
        break;
      }

      case "33": {
        if (!actual) {
          salida.errores.push(`Línea ${n}: fin de cuenta sin cuenta abierta.`);
          break;
        }
        actual.saldoFinalCentimos = conSigno(linea.slice(59, 60), num(linea.slice(60, 74)));

        /*
         * La comprobación que da valor al lector: saldo inicial + movimientos
         * tiene que dar el saldo final que declara el banco. Si no cuadra, el
         * fichero está incompleto o mal leído, y conciliar contra él sería
         * dar por descuadrado lo que en realidad estaba bien.
         */
        const suma = actual.movimientos.reduce((a, m) => a + m.importeCentimos, 0);
        actual.cuadra = actual.saldoInicialCentimos + suma === actual.saldoFinalCentimos;
        if (!actual.cuadra) {
          salida.errores.push(
            `Cuenta ${actual.cuenta}: el saldo final del banco no cuadra con la suma de sus movimientos.`
          );
        }
        actual = null;
        ultimo = null;
        break;
      }

      case "88":
        break;

      default:
        salida.errores.push(`Línea ${n}: código de registro «${codigo}» desconocido.`);
    }
  });

  if (salida.cuentas.length === 0) {
    salida.errores.push("El fichero no tiene ninguna cabecera de cuenta: ¿es una Norma 43?");
  }

  return salida;
}
