/**
 * Conector de Business Central, con un transporte de mentira.
 *
 * **No hay ningún inquilino de Business Central contra el que probar esto**, y
 * conviene que quede dicho. Lo que sí se puede fijar es todo lo que no depende
 * de él, que es la mayor parte de lo que puede salir mal: el mapeo de las
 * respuestas, la clasificación de errores —de la que depende que el outbox
 * reintente lo que merece la pena y se rinda con lo demás—, la idempotencia y
 * la caché del testigo.
 */

import { describe, expect, it, vi } from "vitest";
import { BusinessCentralConnector, type ConfigBC } from "./BusinessCentralConnector.ts";
import { ErrorErpPermanente, ErrorErpTemporal } from "../connector.ts";

const respuesta = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), {
    status,
    headers: { "content-type": "application/json" },
  });

const TESTIGO = { access_token: "un-testigo", expires_in: 3600 };

/** Un transporte que responde por URL, y anota lo que le han pedido. */
function transporte(rutas: { patron: RegExp; responder: () => Response | Promise<Response> }[]) {
  const llamadas: { url: string; init?: RequestInit }[] = [];
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    llamadas.push({ url: u, init });
    const r = rutas.find((x) => x.patron.test(u));
    if (!r) throw new Error(`Sin ruta de prueba para ${u}`);
    return r.responder();
  });
  return { fn: fn as unknown as typeof fetch, llamadas };
}

function conector(rutas: Parameters<typeof transporte>[0], extra: Partial<ConfigBC> = {}) {
  const t = transporte([
    { patron: /login\.microsoftonline\.com/, responder: () => respuesta(TESTIGO) },
    ...rutas,
  ]);
  const c = new BusinessCentralConnector({
    tenantId: "t",
    clientId: "c",
    clientSecret: "s",
    environment: "sandbox",
    companyId: "empresa",
    fetch: t.fn,
    ...extra,
  });
  return { c, t };
}

describe("Business Central: lectura de documentos", () => {
  it("mapea una factura de cliente con el importe exacto", async () => {
    const { c } = conector([
      {
        patron: /customerLedgerEntries/,
        responder: () =>
          respuesta({
            value: [
              {
                id: "guid-1",
                documentNumber: "FV-2026-001",
                customerName: "Talleres Pérez",
                customerId: "cli-9",
                amount: "1.005",
                remainingAmount: "1.005",
                postingDate: "2026-05-01",
                dueDate: "2026-06-01",
                currencyCode: "EUR",
              },
            ],
          }),
      },
    ]);

    const docs = await c.documentosACobrar();
    expect(docs).toHaveLength(1);
    // El caso que la coma flotante se come: 1,005 € son 101 céntimos.
    expect(docs[0].pendienteCentimos).toBe(101);
    expect(docs[0].numero).toBe("FV-2026-001");
    expect(docs[0].parteNombre).toBe("Talleres Pérez");
    expect(docs[0].externalSystem).toBe("BUSINESS_CENTRAL");
  });

  /*
   * Un pendiente inventado saldría en la pantalla de cobros como una factura
   * cobrable por una cantidad que no es. Mejor no traerla.
   */
  it("descarta el apunte sin importe en vez de traerlo a medias", async () => {
    const { c } = conector([
      {
        patron: /customerLedgerEntries/,
        responder: () =>
          respuesta({
            value: [
              { id: "1", documentNumber: "A", remainingAmount: null },
              { id: "2", documentNumber: "B", remainingAmount: "50.00" },
            ],
          }),
      },
    ]);

    const docs = await c.documentosACobrar();
    expect(docs.map((d) => d.numero)).toEqual(["B"]);
  });

  it("lo pendiente de un proveedor viene en negativo y aquí es una cantidad", async () => {
    const { c } = conector([
      {
        patron: /vendorLedgerEntries/,
        responder: () =>
          respuesta({
            value: [
              { id: "1", documentNumber: "FC-7", vendorName: "Recambios SL", remainingAmount: "-240.50" },
            ],
          }),
      },
    ]);

    const docs = await c.documentosAPagar();
    expect(docs[0].pendienteCentimos).toBe(24050);
  });
});

describe("Business Central: clasificación de errores", () => {
  /*
   * De esto depende que el outbox reintente lo que puede salir bien y se rinda
   * con lo que no. Machacar seis veces un 400 solo retrasa que alguien lo mire.
   */
  it("un 500 es temporal y un 400 es permanente", async () => {
    const caido = conector([{ patron: /customerLedgerEntries/, responder: () => respuesta({}, 503) }]);
    await expect(caido.c.documentosACobrar()).rejects.toBeInstanceOf(ErrorErpTemporal);

    const malo = conector([
      { patron: /customerLedgerEntries/, responder: () => respuesta({ error: "campo" }, 400) },
    ]);
    await expect(malo.c.documentosACobrar()).rejects.toBeInstanceOf(ErrorErpPermanente);
  });

  it("el 429 se reintenta: es «ahora no», no «nunca»", async () => {
    const { c } = conector([
      { patron: /customerLedgerEntries/, responder: () => respuesta({}, 429) },
    ]);
    await expect(c.documentosACobrar()).rejects.toBeInstanceOf(ErrorErpTemporal);
  });

  it("un fallo de red es temporal, no permanente", async () => {
    const { c } = conector([
      {
        patron: /customerLedgerEntries/,
        responder: () => {
          throw new Error("ECONNRESET");
        },
      },
    ]);
    await expect(c.documentosACobrar()).rejects.toBeInstanceOf(ErrorErpTemporal);
  });

  /*
   * El 401 casi siempre es el testigo caducado: se tira y el siguiente intento
   * lo renueva. Tratarlo como permanente dejaría la integración muerta cada
   * vez que expirase un testigo.
   */
  it("un 401 tira el testigo y se reintenta", async () => {
    let veces = 0;
    const { c } = conector([
      {
        patron: /customerLedgerEntries/,
        responder: () => {
          veces++;
          return veces === 1 ? respuesta({}, 401) : respuesta({ value: [] });
        },
      },
    ]);

    await expect(c.documentosACobrar()).rejects.toBeInstanceOf(ErrorErpTemporal);
    await expect(c.documentosACobrar()).resolves.toEqual([]);
  });

  it("el mensaje de error no lleva el secreto ni el testigo", async () => {
    const { c } = conector([
      { patron: /customerLedgerEntries/, responder: () => respuesta({ detalle: "x" }, 400) },
    ]);
    const error = (await c.documentosACobrar().catch((e) => e)) as Error;
    expect(error.message).not.toContain("un-testigo");
    expect(error.message).not.toContain("s".repeat(1) + "ecret");
  });
});

describe("Business Central: contabilizar", () => {
  const operacion = {
    externalSystem: "BUSINESS_CENTRAL",
    externalDocumentId: "guid-1",
    operacionNumero: "TAR1-C-26-001",
    importeCentimos: 12345,
    fechaIso: "2026-05-01T10:00:00.000Z",
    formasPago: [],
  };

  it("contabiliza el cobro con el número de Mobilink como referencia", async () => {
    const { c, t } = conector([
      { patron: /journalLines\?\$filter/, responder: () => respuesta({ value: [] }) },
      { patron: /journalLines$/, responder: () => respuesta({ id: "asiento-1" }) },
    ]);

    const r = await c.registrarCobro(operacion);
    expect(r.ok).toBe(true);
    expect(r.referencia).toBe("asiento-1");

    const envio = t.llamadas.find((l) => l.init?.method === "POST" && /journalLines$/.test(l.url));
    const cuerpo = JSON.parse(String(envio!.init!.body));
    expect(cuerpo.externalDocumentNumber).toBe("TAR1-C-26-001");
    // Un cobro deja al cliente a deber menos: entra en la ERP con signo negativo.
    expect(cuerpo.amount).toBe("-123.45");
  });

  /*
   * El outbox evita mandar dos veces, pero no que la primera llegara y se
   * perdiera la respuesta. Preguntar antes es la única forma de no contabilizar
   * el mismo cobro dos veces.
   */
  it("si la ERP ya lo tenía, no lo vuelve a contabilizar", async () => {
    const { c, t } = conector([
      {
        patron: /journalLines\?\$filter/,
        responder: () => respuesta({ value: [{ id: "ya-estaba" }] }),
      },
    ]);

    const r = await c.registrarCobro(operacion);
    expect(r.duplicado).toBe(true);
    expect(r.referencia).toBe("ya-estaba");
    expect(t.llamadas.some((l) => l.init?.method === "POST" && /journalLines$/.test(l.url))).toBe(
      false
    );
  });

  /*
   * Si la comprobación previa falla, NO se supone que no está: se propaga y el
   * outbox reintenta. Suponer que no existe llevaría a contabilizar dos veces,
   * que es justo lo que la comprobación viene a evitar.
   */
  it("si no se puede comprobar si ya estaba, no se contabiliza a ciegas", async () => {
    const { c, t } = conector([
      { patron: /journalLines\?\$filter/, responder: () => respuesta({}, 503) },
    ]);

    await expect(c.registrarCobro(operacion)).rejects.toBeInstanceOf(ErrorErpTemporal);
    // Ojo: la petición del testigo también es un POST, así que se mira la del
    // diario en concreto. La comprobación amplia daba un falso verde.
    expect(
      t.llamadas.some((l) => l.init?.method === "POST" && /journalLines$/.test(l.url))
    ).toBe(false);
  });

  it("un pago entra con signo contrario al de un cobro", async () => {
    const { c, t } = conector([
      { patron: /journalLines\?\$filter/, responder: () => respuesta({ value: [] }) },
      { patron: /journalLines$/, responder: () => respuesta({ id: "asiento-2" }) },
    ]);

    await c.registrarPago(operacion);
    const envio = t.llamadas.find((l) => l.init?.method === "POST" && /journalLines$/.test(l.url));
    expect(JSON.parse(String(envio!.init!.body)).amount).toBe("123.45");
  });
});

describe("Business Central: testigo", () => {
  it("se pide una vez y se reutiliza", async () => {
    const { c, t } = conector([
      { patron: /customerLedgerEntries/, responder: () => respuesta({ value: [] }) },
    ]);

    await c.documentosACobrar();
    await c.documentosACobrar();

    const peticionesDeTestigo = t.llamadas.filter((l) => /login\.microsoftonline/.test(l.url));
    expect(peticionesDeTestigo).toHaveLength(1);
  });

  it("sin testigo en la respuesta, el fallo es permanente y no dice por qué en detalle", async () => {
    const t = transporte([
      { patron: /login\.microsoftonline/, responder: () => respuesta({ error: "invalid_client" }) },
    ]);
    const c = new BusinessCentralConnector({
      tenantId: "t",
      clientId: "c",
      clientSecret: "secreto-de-verdad",
      environment: "sandbox",
      companyId: "e",
      fetch: t.fn,
    });

    const error = (await c.documentosACobrar().catch((e) => e)) as Error;
    expect(error).toBeInstanceOf(ErrorErpPermanente);
    expect(error.message).not.toContain("secreto-de-verdad");
  });
});
