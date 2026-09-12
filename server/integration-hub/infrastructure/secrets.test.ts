/**
 * La resolución de secretos, con el escalón de la cuenta.
 *
 * Lo que se fija aquí es una cosa y su contraria: que dos cuentas del mismo
 * cliente pueden tener tokens distintos, y que **nada de lo que ya estaba
 * configurado deja de resolverse**. Lo segundo importa tanto como lo primero,
 * porque este módulo lo comparten Business Central, Twilio, SMTP, TecDoc y los
 * dos conectores de telemática: una regresión aquí los deja a todos sin
 * credenciales a la vez, y en producción eso se nota como «el proveedor no
 * contesta», que manda a buscar el fallo al sitio equivocado.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getSecretsProvider, nombresCandidatos, setSecretsProvider } from "./secrets.ts";

const TENANT = "empresa-plana";
const CONECTOR = "movertis";

/** Variables que pone cada prueba, para poder quitarlas después. */
let puestas: string[] = [];

function poner(clave: string, valor: string) {
  process.env[clave] = valor;
  puestas.push(clave);
}

const leer = (nombre: string, cuenta?: string) =>
  getSecretsProvider().get(TENANT, CONECTOR, nombre, cuenta);

beforeEach(() => {
  puestas = [];
});

afterEach(() => {
  for (const c of puestas) delete process.env[c];
});

describe("nombresCandidatos()", () => {
  it("sin cuenta son los dos de siempre, en el mismo orden", () => {
    expect(nombresCandidatos(TENANT, CONECTOR, "token")).toEqual([
      "IH_SECRET__EMPRESA_PLANA__MOVERTIS__TOKEN",
      "IH_SECRET__MOVERTIS__TOKEN",
    ]);
  });

  it("con cuenta añade uno DELANTE, sin quitar ninguno", () => {
    expect(nombresCandidatos(TENANT, CONECTOR, "token", "plana-buses")).toEqual([
      "IH_SECRET__EMPRESA_PLANA__MOVERTIS__PLANA_BUSES__TOKEN",
      "IH_SECRET__EMPRESA_PLANA__MOVERTIS__TOKEN",
      "IH_SECRET__MOVERTIS__TOKEN",
    ]);
  });

  it("normaliza a mayúsculas y convierte lo que no es alfanumérico", () => {
    expect(nombresCandidatos("uuid-1234", "business-central", "client_secret", "soc.A")[0]).toBe(
      "IH_SECRET__UUID_1234__BUSINESS_CENTRAL__SOC_A__CLIENT_SECRET",
    );
  });
});

describe("resolución por variables de entorno", () => {
  it("la cuenta gana al secreto del cliente", async () => {
    poner("IH_SECRET__EMPRESA_PLANA__MOVERTIS__TOKEN", "el-del-cliente");
    poner("IH_SECRET__EMPRESA_PLANA__MOVERTIS__PLANA_BUSES__TOKEN", "el-de-los-buses");
    expect(await leer("token", "plana-buses")).toBe("el-de-los-buses");
  });

  it("dos cuentas del mismo cliente resuelven tokens distintos", async () => {
    // Es el fallo que motivó el cambio: antes las dos leían la misma variable.
    poner("IH_SECRET__EMPRESA_PLANA__MOVERTIS__BUSES__TOKEN", "token-buses");
    poner("IH_SECRET__EMPRESA_PLANA__MOVERTIS__AUXILIAR__TOKEN", "token-auxiliar");
    expect(await leer("token", "buses")).toBe("token-buses");
    expect(await leer("token", "auxiliar")).toBe("token-auxiliar");
  });

  it("una cuenta sin variable propia cae al secreto del cliente", async () => {
    poner("IH_SECRET__EMPRESA_PLANA__MOVERTIS__TOKEN", "el-del-cliente");
    expect(await leer("token", "una-cuenta-cualquiera")).toBe("el-del-cliente");
  });

  it("y de ahí al fallback global del conector", async () => {
    poner("IH_SECRET__MOVERTIS__TOKEN", "el-global");
    expect(await leer("token", "buses")).toBe("el-global");
  });

  it("sin nada configurado devuelve undefined, no una cadena vacía", async () => {
    expect(await leer("token", "buses")).toBeUndefined();
  });

  it("una variable vacía no cuenta como secreto: se sigue bajando", async () => {
    poner("IH_SECRET__EMPRESA_PLANA__MOVERTIS__BUSES__TOKEN", "");
    poner("IH_SECRET__EMPRESA_PLANA__MOVERTIS__TOKEN", "el-bueno");
    expect(await leer("token", "buses")).toBe("el-bueno");
  });
});

describe("retrocompatibilidad", () => {
  it("quien NO pasa cuenta resuelve exactamente como antes", async () => {
    poner("IH_SECRET__EMPRESA_PLANA__MOVERTIS__TOKEN", "el-del-cliente");
    expect(await leer("token")).toBe("el-del-cliente");
  });

  it("y su fallback global sigue funcionando", async () => {
    poner("IH_SECRET__MOVERTIS__TOKEN", "el-global");
    expect(await leer("token")).toBe("el-global");
  });

  it("el secreto de una cuenta NO se cuela en quien no pide cuenta", async () => {
    // Si se colara, un conector sin cuenta empezaría a usar el token de una
    // cuenta concreta sin que nadie lo haya pedido.
    poner("IH_SECRET__EMPRESA_PLANA__MOVERTIS__BUSES__TOKEN", "el-de-los-buses");
    expect(await leer("token")).toBeUndefined();
  });

  it("un proveedor inyectado con la firma vieja sigue valiendo", async () => {
    // Los tests de otros conectores inyectan funciones de tres parámetros. Una
    // función con menos parámetros satisface la interfaz, y tiene que seguir
    // haciéndolo: si no, el cambio rompería sus pruebas.
    const anterior = getSecretsProvider();
    try {
      setSecretsProvider({ get: async (_t, _c, n) => (n === "token" ? "de-mentira" : undefined) });
      expect(await leer("token", "buses")).toBe("de-mentira");
      expect(await leer("otra-cosa", "buses")).toBeUndefined();
    } finally {
      setSecretsProvider(anterior);
    }
  });
});
