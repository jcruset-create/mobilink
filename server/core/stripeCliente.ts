/**
 * El cliente de Stripe, solo si hay credencial.
 *
 * Antes vivía suelto en `server/index.ts` y se construía EN EL ARRANQUE con
 * `new Stripe(process.env.STRIPE_SECRET_KEY || "")`. La librería lanza al
 * instante con la clave vacía, así que el servidor entero no levantaba sin
 * credenciales de pago: no se podía arrancar en un entorno de pruebas sin
 * meter una clave de Stripe, que es justo lo que no se quiere fuera de
 * producción.
 *
 * Aquí está la misma lógica, en un módulo propio para poder probarla:
 *
 *   · CON clave, el comportamiento es el de siempre: un cliente con la misma
 *     `apiVersion`, creado una sola vez y reutilizado.
 *   · SIN clave, no se crea ningún cliente —así que no puede salir ni una
 *     llamada— y las rutas de cobro responden 503 ANTES de intentar nada.
 */
import Stripe from "stripe";

/** La versión de la API con la que trabaja el código de cobros. No cambia. */
export const STRIPE_API_VERSION = "2026-04-22.dahlia" as const;

let cliente: Stripe | null = null;
let claveDelCliente: string | null = null;

/** El cliente, o null si no hay `STRIPE_SECRET_KEY`. Nunca lanza. */
export function stripeSiHay(): Stripe | null {
  const clave = process.env.STRIPE_SECRET_KEY;
  if (!clave) return null;
  // Si la clave cambia (en pruebas, sobre todo), se rehace el cliente.
  if (!cliente || claveDelCliente !== clave) {
    cliente = new Stripe(clave, { apiVersion: STRIPE_API_VERSION });
    claveDelCliente = clave;
  }
  return cliente;
}

/** Mínimo de `express.Response` que necesita el corte, para poder probarlo. */
export interface RespuestaDeCorte {
  status(code: number): { json(cuerpo: unknown): unknown };
}

/**
 * El cliente, o 503 y null. Quien lo llama DEVUELVE si recibe null, para no
 * seguir con el cobro.
 */
export function stripeOCortar(res: RespuestaDeCorte): Stripe | null {
  const s = stripeSiHay();
  if (!s) {
    res.status(503).json({ success: false, message: "Pagos no disponibles: falta STRIPE_SECRET_KEY" });
    return null;
  }
  return s;
}

/** Solo para las pruebas: olvida el cliente memorizado. */
export function _olvidarClienteStripe(): void {
  cliente = null;
  claveDelCliente = null;
}
