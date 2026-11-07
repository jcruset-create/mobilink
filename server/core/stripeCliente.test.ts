import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Stripe from "stripe";
import {
  STRIPE_API_VERSION, stripeSiHay, stripeOCortar, _olvidarClienteStripe,
} from "./stripeCliente.ts";

/** Una respuesta de Express de mentira, que apunta lo que le piden. */
function respuestaFalsa() {
  const r = { codigo: 0 as number, cuerpo: null as unknown, llamadas: 0 };
  return {
    r,
    res: {
      status(code: number) {
        r.codigo = code; r.llamadas++;
        return { json(cuerpo: unknown) { r.cuerpo = cuerpo; return cuerpo; } };
      },
    },
  };
}

const CLAVE = process.env.STRIPE_SECRET_KEY;
beforeEach(() => { _olvidarClienteStripe(); delete process.env.STRIPE_SECRET_KEY; });
afterEach(() => {
  _olvidarClienteStripe();
  if (CLAVE === undefined) delete process.env.STRIPE_SECRET_KEY;
  else process.env.STRIPE_SECRET_KEY = CLAVE;
});

describe("con configuración válida se comporta como antes", () => {
  it("devuelve un cliente de Stripe con la misma versión de API", () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_de_pruebas_no_real";
    const s = stripeSiHay();
    expect(s).toBeInstanceOf(Stripe);
    // La versión de la API es la que usaba el código anterior, literal.
    expect(STRIPE_API_VERSION).toBe("2026-04-22.dahlia");
    expect((s as any)?.getApiField?.("version") ?? STRIPE_API_VERSION).toBe("2026-04-22.dahlia");
  });

  it("es el MISMO cliente en llamadas sucesivas: no se crea uno por petición", () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_de_pruebas_no_real";
    expect(stripeSiHay()).toBe(stripeSiHay());
  });

  it("stripeOCortar lo devuelve sin tocar la respuesta", () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_de_pruebas_no_real";
    const { r, res } = respuestaFalsa();
    const s = stripeOCortar(res);
    expect(s).toBeInstanceOf(Stripe);
    expect(r.llamadas).toBe(0);   // nadie ha respondido todavía: sigue el cobro
  });

  it("si la clave cambia, el cliente se rehace", () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_uno";
    const a = stripeSiHay();
    process.env.STRIPE_SECRET_KEY = "sk_test_dos";
    expect(stripeSiHay()).not.toBe(a);
  });
});

describe("sin clave el servidor sigue en pie y el cobro se corta antes", () => {
  it("no se construye ningún cliente, así que no puede salir una llamada", () => {
    expect(stripeSiHay()).toBeNull();
  });

  it("stripeSiHay NO lanza: es lo que tumbaba el arranque", () => {
    expect(() => stripeSiHay()).not.toThrow();
  });

  it("stripeOCortar responde 503 y devuelve null", () => {
    const { r, res } = respuestaFalsa();
    expect(stripeOCortar(res)).toBeNull();
    expect(r.codigo).toBe(503);
    expect(r.cuerpo).toEqual({ success: false, message: "Pagos no disponibles: falta STRIPE_SECRET_KEY" });
  });

  it("el 503 llega ANTES de cualquier efecto de pago", () => {
    // Se reproduce el patrón exacto de las tres rutas de cobro: pedir el
    // cliente y DEVOLVER si no hay. Si el corte fallara, `cobrado` se
    // pondría a true, que es justo lo que no puede pasar.
    let cobrado = false;
    const { r, res } = respuestaFalsa();
    const ruta = () => {
      const stripe = stripeOCortar(res);
      if (!stripe) return;
      cobrado = true;                       // aquí iría checkout.sessions.create
    };
    ruta();
    expect(cobrado).toBe(false);
    expect(r.codigo).toBe(503);
  });

  it("una clave vacía cuenta como no tener clave", () => {
    process.env.STRIPE_SECRET_KEY = "";
    expect(stripeSiHay()).toBeNull();
  });
});
