/**
 * Lo que este módulo necesitará saber del ERP, escrito hoy y sin implementar.
 *
 * ── Por qué existe un puerto vacío ──────────────────────────────────────────
 *
 * Porque la alternativa es que la pantalla, el servicio y el repositorio
 * acaben preguntándole al ERP cada uno a su manera cuando llegue el momento, y
 * entonces conectar Business Central sea reescribir el módulo. Con el contrato
 * puesto desde el principio, el día que haya respuestas sólo hay que escribir
 * quien las dé.
 *
 * ── Y por qué está vacío ────────────────────────────────────────────────────
 *
 * Porque hoy **no hay de dónde sacar los datos**, y eso no es una suposición:
 *
 *   · `IErpConnector` (Integration Hub) llega a clientes, artículos y pedidos
 *     de venta y compra. No a albaranes de compra.
 *   · `ICashErpConnector` (Mobilink Cash) llega a apuntes de cliente y de
 *     proveedor —`customerLedgerEntries`, `vendorLedgerEntries`—, que son
 *     asientos, no líneas de albarán.
 *
 * Inventar una implementación que devolviera datos plausibles sería peor que no
 * tener ninguna: la pantalla diría que el albarán ya está grabado y alguien se
 * lo creería. Así que la implementación de serie contesta «no lo sé», y la
 * pantalla lo dice con esas palabras.
 *
 * ── Cómo se conectará ───────────────────────────────────────────────────────
 *
 * Ampliando `IErpConnector` con métodos OPCIONALES (como ya lo están
 * `getProviders?` y `pushAssistance?`) y escribiendo aquí un adaptador fino que
 * los llame. NO llamando a Business Central desde este módulo: el invariante de
 * la plataforma es que ningún módulo operativo habla con el ERP directamente,
 * y saltárselo es lo que convierte un conector en cinco.
 */

/** Lo que el ERP puede decir de un albarán de compra. */
export type EstadoAlbaranErp = {
  existe: boolean;
  /** Grabado en el ERP, aunque todavía no esté contabilizado. */
  grabado: boolean;
  contabilizado: boolean;
  /** En céntimos y con signo, como en todo el módulo. */
  importeCentimos: number | null;
  /** Número de la factura de proveedor con la que quedó casado, si la hay. */
  facturaAsociada: string | null;
  /** Las líneas, cuando el ERP las exponga: es lo que permitirá comparar. */
  lineas: LineaAlbaranErp[] | null;
  /** Cuándo se preguntó, para poder decir «según el ERP a las 9:14». */
  consultadoAt: string;
  /** Qué sistema contestó: `business-central`, `mock`… */
  fuente: string;
};

export type LineaAlbaranErp = {
  referencia: string | null;
  descripcion: string | null;
  cantidad: number | null;
  precioUnitarioCentimos: number | null;
  importeCentimos: number | null;
};

export type ContextoErp = {
  empresaId: string;
  /** La sociedad del ERP («007»), que no es el tenant de Mobilink. */
  empresaCodigo: string;
};

/**
 * Consultar un albarán en el ERP.
 *
 * Una sola función, a propósito: cuanto más pequeño es el puerto, más fácil es
 * que haya detrás una implementación honesta. `null` significa **no lo sé**, y
 * es distinto de un `existe: false`, que significa «he mirado y no está».
 */
export interface ConsultaAlbaranesErp {
  /** Nombre de quien contesta, para poder enseñarlo. */
  readonly fuente: string;
  /** ¿Hay algo detrás? Si es `false`, la pantalla no ofrece la consulta. */
  disponible(): boolean;
  consultarAlbaran(ctx: ContextoErp, albaran: string): Promise<EstadoAlbaranErp | null>;
}
