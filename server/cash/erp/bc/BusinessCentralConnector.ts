/**
 * Conector de Microsoft Dynamics 365 Business Central.
 *
 * El primero contra una ERP real. El motor de caja **no cambia ni una línea**:
 * cumple `ICashErpConnector` y se registra por su clave, que era justo lo que
 * prometía el diseño de la fase inicial del módulo.
 *
 * ## Lo que significa «aislado»
 *
 * Que una ERP caída, lenta o que conteste cualquier cosa **no pueda estropear
 * una caja**. Tres cosas lo sostienen:
 *
 * 1. **Todo lleva plazo.** Sin `timeout`, una ERP que acepta la conexión y no
 *    responde deja la petición colgada para siempre y con ella el worker.
 * 2. **Los fallos se clasifican.** `ErrorErpTemporal` para lo que puede salir
 *    bien al repetir —red, 5xx, 429— y `ErrorErpPermanente` para lo que no —un
 *    404, un importe que la ERP rechaza—. El outbox reintenta lo primero y se
 *    rinde con lo segundo, en vez de machacar seis veces algo que nunca va a
 *    funcionar.
 * 3. **Los secretos no salen en los mensajes.** Un error de la ERP acaba en
 *    `last_error`, que se ve en pantalla; si el mensaje llevara el testigo,
 *    quedaría escrito en la base de datos y en los registros.
 *
 * ## Lo que NO se ha podido comprobar
 *
 * **No hay ningún inquilino de Business Central contra el que probar esto.** Lo
 * que se prueba aquí es todo lo que no depende de eso: la conversión de
 * importes, el mapeo de las respuestas, la clasificación de errores, la
 * idempotencia y la caché del testigo, con un transporte de mentira que
 * devuelve cuerpos con la forma documentada de la API.
 *
 * Antes de usarlo en producción hay que confirmar contra el inquilino real los
 * nombres de las entidades y el diario al que se contabiliza: varían según la
 * versión y la personalización de cada instalación. Están todos juntos en
 * `ENTIDADES` para que se toquen en un sitio.
 */

import {
  ErrorErpPermanente,
  ErrorErpTemporal,
  type DocumentoExterno,
  type ICashErpConnector,
  type InfoConector,
  type RespuestaErp,
  type ResultadoOperacionErp,
} from "../connector.ts";
import { aCentimos, aDecimal } from "./amount.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */

export const SISTEMA = "BUSINESS_CENTRAL";

/**
 * Nombres de la API, todos juntos.
 *
 * Cambian entre versiones de Business Central y con la personalización de cada
 * instalación. Tenerlos aquí y no repartidos por el fichero es lo que permite
 * adaptarlos sin releer la lógica.
 */
export const ENTIDADES = {
  cobrar: "customerLedgerEntries",
  pagar: "vendorLedgerEntries",
  diario: "journalLines",
} as const;

export type ConfigBC = {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  /** `production`, `sandbox`… */
  environment: string;
  companyId: string;
  /** Diario al que se contabiliza. Lo decide la instalación. */
  diario?: string;
  /** Inyectable para las pruebas. Por defecto, el `fetch` del proceso. */
  fetch?: typeof fetch;
  timeoutMs?: number;
};

const TIMEOUT_POR_DEFECTO_MS = 15_000;

export class BusinessCentralConnector implements ICashErpConnector {
  readonly info: InfoConector = {
    key: "business-central",
    displayName: "Microsoft Dynamics 365 Business Central",
    capacidades: ["documentosACobrar", "documentosAPagar", "registrarCobro", "registrarPago"],
  };

  private testigo: { valor: string; expiraMs: number } | null = null;

  constructor(private readonly cfg: ConfigBC) {}

  private get http(): typeof fetch {
    return this.cfg.fetch ?? fetch;
  }

  private get base(): string {
    return `https://api.businesscentral.dynamics.com/v2.0/${this.cfg.tenantId}/${this.cfg.environment}/api/v2.0/companies(${this.cfg.companyId})`;
  }

  /**
   * Testigo de Microsoft, con caché.
   *
   * Se renueva un minuto antes de caducar: pedirlo justo al expirar deja una
   * ventana en la que la ERP lo rechaza por unos segundos de desfase de reloj,
   * y eso aparece como un fallo aleatorio imposible de reproducir.
   */
  private async token(): Promise<string> {
    if (this.testigo && this.testigo.expiraMs > Date.now() + 60_000) return this.testigo.valor;

    const cuerpo = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: this.cfg.clientId,
      client_secret: this.cfg.clientSecret,
      scope: "https://api.businesscentral.dynamics.com/.default",
    });

    const r = await this.pedir(
      `https://login.microsoftonline.com/${this.cfg.tenantId}/oauth2/v2.0/token`,
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: cuerpo.toString(),
      },
      // Sin testigo, evidentemente: ésta es la petición que lo consigue.
      false
    );

    const datos: any = await r.json();
    if (!datos?.access_token) {
      // Sin detalle del cuerpo: puede traer eco de las credenciales.
      throw new ErrorErpPermanente("Business Central no ha devuelto ningún testigo de acceso.");
    }

    this.testigo = {
      valor: datos.access_token,
      expiraMs: Date.now() + Number(datos.expires_in ?? 3600) * 1000,
    };
    return this.testigo.valor;
  }

  /**
   * Una petición, con plazo y con los errores ya clasificados.
   *
   * Es el único sitio del conector que habla por la red, para que la regla de
   * qué se reintenta y qué no viva en un solo lugar.
   */
  private async pedir(url: string, init: RequestInit, conTestigo = true): Promise<Response> {
    const cabeceras: Record<string, string> = {
      accept: "application/json",
      ...((init.headers as Record<string, string>) ?? {}),
    };
    if (conTestigo) cabeceras.authorization = `Bearer ${await this.token()}`;

    let r: Response;
    try {
      r = await this.http(url, {
        ...init,
        headers: cabeceras,
        signal: AbortSignal.timeout(this.cfg.timeoutMs ?? TIMEOUT_POR_DEFECTO_MS),
      });
    } catch (e) {
      // Red, DNS o plazo agotado: puede ir bien al repetir.
      throw new ErrorErpTemporal(
        `No se ha podido hablar con Business Central: ${e instanceof Error ? e.message : String(e)}`
      );
    }

    if (r.ok) return r;

    /*
     * 429 y 5xx se reintentan; el resto no.
     *
     * Un 400 o un 404 no mejoran por insistir: el documento no existe o el
     * importe no le vale a la ERP. Reintentarlos seis veces solo retrasa el
     * momento de que alguien lo mire, y mientras tanto la cola parece viva
     * cuando en realidad está atascada.
     *
     * El 401 se trata como temporal a propósito: casi siempre es el testigo
     * caducado, y basta con tirarlo para que el siguiente intento lo renueve.
     */
    const detalle = (await r.text().catch(() => "")).slice(0, 300);
    if (r.status === 401) {
      this.testigo = null;
      throw new ErrorErpTemporal("Business Central ha rechazado el testigo; se renovará.");
    }
    if (r.status === 429 || r.status >= 500) {
      throw new ErrorErpTemporal(`Business Central no está disponible (HTTP ${r.status}).`);
    }
    throw new ErrorErpPermanente(`Business Central ha rechazado la petición (HTTP ${r.status}): ${detalle}`);
  }

  async probarConexion(): Promise<{ ok: boolean; mensaje: string }> {
    try {
      await this.pedir(`${this.base}/companyInformation?$top=1`, { method: "GET" });
      return { ok: true, mensaje: "Conexión correcta con Business Central." };
    } catch (e) {
      return { ok: false, mensaje: e instanceof Error ? e.message : String(e) };
    }
  }

  async documentosACobrar(): Promise<DocumentoExterno[]> {
    const r = await this.pedir(
      `${this.base}/${ENTIDADES.cobrar}?$filter=remainingAmount ne 0&$top=200`,
      { method: "GET" }
    );
    const datos: any = await r.json();
    return (datos?.value ?? [])
      .map((e: any) => this.aDocumento(e, "FACTURA_CLIENTE", "CLIENTE"))
      .filter(Boolean) as DocumentoExterno[];
  }

  async documentosAPagar(): Promise<DocumentoExterno[]> {
    const r = await this.pedir(
      `${this.base}/${ENTIDADES.pagar}?$filter=remainingAmount ne 0&$top=200`,
      { method: "GET" }
    );
    const datos: any = await r.json();
    return (datos?.value ?? [])
      .map((e: any) => this.aDocumento(e, "FACTURA_PROVEEDOR", "PROVEEDOR"))
      .filter(Boolean) as DocumentoExterno[];
  }

  /**
   * Un apunte de la ERP a un documento del módulo.
   *
   * Devuelve `null` en lugar de un documento a medias cuando falta el importe:
   * un pendiente inventado saldría en la pantalla de cobros como una factura
   * cobrable por una cantidad que no es.
   */
  private aDocumento(e: any, tipo: any, parteTipo: any): DocumentoExterno | null {
    const total = aCentimos(e?.amount ?? e?.originalAmount);
    const pendiente = aCentimos(e?.remainingAmount);
    if (pendiente === null) return null;

    return {
      externalSystem: SISTEMA,
      externalId: String(e.id ?? e.number ?? ""),
      externalReference: e.externalDocumentNumber ?? null,
      tipo,
      parteTipo,
      parteExternalId: e.customerId ?? e.vendorId ?? null,
      parteNombre: e.customerName ?? e.vendorName ?? "(sin nombre)",
      numero: String(e.documentNumber ?? e.number ?? ""),
      fecha: e.postingDate ?? null,
      vencimiento: e.dueDate ?? null,
      // En la ERP, lo pendiente de una factura de proveedor viene en negativo;
      // aquí siempre es una cantidad a pagar, y el signo lo pone el tipo.
      totalCentimos: Math.abs(total ?? pendiente),
      pendienteCentimos: Math.abs(pendiente),
      moneda: e.currencyCode || "EUR",
      estadoErp: e.documentType ?? null,
    };
  }

  registrarCobro(r: ResultadoOperacionErp): Promise<RespuestaErp> {
    return this.contabilizar(r, "cobro");
  }

  registrarPago(r: ResultadoOperacionErp): Promise<RespuestaErp> {
    return this.contabilizar(r, "pago");
  }

  /**
   * Contabiliza el movimiento como una línea de diario.
   *
   * **Idempotente por el número de operación de Mobilink**, que viaja en
   * `externalDocumentNumber`. Antes de escribir se pregunta si ya existe: un
   * reintento del outbox no puede contabilizar el cobro dos veces, y ésa es la
   * única garantía que el módulo no puede dar por su cuenta —el outbox evita
   * mandar dos veces, pero no que la primera llegara y se perdiera la
   * respuesta—.
   */
  private async contabilizar(
    op: ResultadoOperacionErp,
    que: "cobro" | "pago"
  ): Promise<RespuestaErp> {
    const yaEsta = await this.buscarPorNumero(op.operacionNumero);
    if (yaEsta) {
      return {
        ok: true,
        duplicado: true,
        referencia: yaEsta,
        mensaje: "Business Central ya tenía este movimiento registrado.",
      };
    }

    const importe = que === "cobro" ? -op.importeCentimos : op.importeCentimos;
    const r = await this.pedir(`${this.base}/${ENTIDADES.diario}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        journalDisplayName: this.cfg.diario ?? "GENERAL",
        postingDate: op.fechaIso.slice(0, 10),
        documentNumber: op.operacionNumero,
        externalDocumentNumber: op.operacionNumero,
        accountType: que === "cobro" ? "Customer" : "Vendor",
        amount: aDecimal(importe),
        description: (op.observaciones ?? `Mobilink Cash ${op.operacionNumero}`).slice(0, 100),
      }),
    });

    const datos: any = await r.json().catch(() => ({}));
    return { ok: true, referencia: datos?.id ?? datos?.documentNumber ?? null };
  }

  /**
   * ¿Está ya contabilizado este número de operación?
   *
   * **Los errores se propagan a propósito, sin capturar.** Si la consulta falla
   * no se da por hecho que el movimiento no está: el outbox reintentará.
   * Tragarse el fallo y seguir llevaría a contabilizar un cobro que quizá ya
   * estaba, que es justo el error que esta comprobación viene a evitar.
   */
  private async buscarPorNumero(numero: string): Promise<string | null> {
    const r = await this.pedir(
      `${this.base}/${ENTIDADES.diario}?$filter=externalDocumentNumber eq '${encodeURIComponent(numero)}'&$top=1`,
      { method: "GET" }
    );
    const datos: any = await r.json();
    const fila = (datos?.value ?? [])[0];
    return fila ? String(fila.id ?? fila.documentNumber ?? numero) : null;
  }
}

/** Lee la configuración del entorno. `null` si no está completa. */
export function configDesdeEntorno(): ConfigBC | null {
  const { BC_TENANT_ID, BC_CLIENT_ID, BC_CLIENT_SECRET, BC_COMPANY_ID } = process.env;
  if (!BC_TENANT_ID || !BC_CLIENT_ID || !BC_CLIENT_SECRET || !BC_COMPANY_ID) return null;

  return {
    tenantId: BC_TENANT_ID,
    clientId: BC_CLIENT_ID,
    clientSecret: BC_CLIENT_SECRET,
    environment: process.env.BC_ENVIRONMENT || "production",
    companyId: BC_COMPANY_ID,
    diario: process.env.BC_JOURNAL || undefined,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */
