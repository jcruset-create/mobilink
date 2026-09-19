/**
 * El adaptador fino: del puerto del módulo al conector del Integration Hub.
 *
 * El invariante de la plataforma es que ningún módulo operativo habla con
 * Business Central directamente. Este fichero es lo único de Therefore que
 * sabe que existe el Hub, y lo único que hace es traducir: pregunta por el
 * conector del tenant, y si tiene `getPurchaseReceipt`, lo llama y convierte
 * la respuesta a lo que el módulo entiende. Ni una URL, ni un token, ni una
 * suposición sobre BC viven aquí.
 *
 * ── La sociedad no es el tenant ─────────────────────────────────────────────
 *
 * El correo dice «Empresa 007». El tenant de Mobilink es uno, pero el ERP
 * tiene una company por sociedad. La correspondencia vive en `thf_config`
 * (`erp.company.007` → GUID de la company) porque es una decisión de quien
 * gestiona el módulo, no de quien despliega; sin ella se pregunta a la company
 * por defecto del conector y se dice cuál se usó.
 *
 * ── «No lo sé» sigue siendo una respuesta ───────────────────────────────────
 *
 * Sin conector, sin el método, en simulación o con el ERP caído, la consulta
 * devuelve `null`, y la pantalla dice «no se ha podido consultar», no «no
 * consta». Un `existe: false` sólo sale cuando el ERP contestó de verdad.
 */

import type { PurchaseReceipt } from "../../integration-hub/domain/connectors.ts";
import { leerTextoConfig } from "../config.ts";
import type { ConsultaAlbaranesErp, ContextoErp, EstadoAlbaranErp, LineaAlbaranErp } from "./puerto.ts";
import { sinErp } from "./sinErp.ts";

/** Clave de configuración con la company del ERP de una sociedad. */
export function claveCompany(empresaCodigo: string): string {
  return `erp.company.${empresaCodigo.trim()}`;
}

/**
 * Decimales del ERP → céntimos con signo.
 *
 * BC devuelve JSON con dos decimales; `Math.round(x * 100)` es exacto para
 * eso. La regla de «nunca parseFloat × 100» del módulo es para NÚMEROS ESCRITOS
 * POR PERSONAS, donde no se sabe cuál es el separador; aquí el dato ya es un
 * número.
 */
function aCentimos(v: number | null): number | null {
  return v === null ? null : Math.round(v * 100);
}

export function aEstadoAlbaran(
  r: { found: true; receipt: PurchaseReceipt } | { found: false },
  fuente: string,
  consultadoAt = new Date()
): EstadoAlbaranErp {
  if (!r.found) {
    return {
      existe: false,
      grabado: false,
      contabilizado: false,
      importeCentimos: null,
      facturaAsociada: null,
      lineas: null,
      consultadoAt: consultadoAt.toISOString(),
      fuente,
    };
  }
  const { receipt } = r;
  const lineas: LineaAlbaranErp[] = receipt.lines.map((l) => ({
    referencia: l.itemNumber,
    descripcion: l.description,
    cantidad: l.quantity,
    precioUnitarioCentimos: aCentimos(l.unitCost),
    importeCentimos: aCentimos(l.amountExcludingTax),
  }));
  return {
    existe: true,
    grabado: true,
    contabilizado: receipt.posted,
    importeCentimos: aCentimos(receipt.totalExcludingTax),
    facturaAsociada: receipt.invoiceNumber,
    lineas,
    consultadoAt: consultadoAt.toISOString(),
    fuente,
  };
}

/** Lo que el adaptador necesita del Hub, para poder probarlo sin él. */
export type ResolverConector = (tenantId: string) => Promise<{
  key: string;
  connector: {
    getPurchaseReceipt?: (
      ctx: { tenantId: string; correlationId: string },
      q: { vendorShipmentNumber?: string; companyId?: string }
    ) => Promise<{ found: true; receipt: PurchaseReceipt } | { found: false } | null>;
  };
} | null>;

/**
 * El resolvedor de verdad, contra el registro de conectores del Hub.
 *
 * El registro se carga aquí dentro, no arriba con el resto de imports, y no es
 * por pereza: arrastra `db.ts`, que **lanza al cargarse** si falta
 * `DATABASE_URL`. Importándolo arriba, cualquier prueba de este fichero fallaba
 * en CI antes de ejecutar nada, aunque —como la de al lado— traiga su propio
 * resolvedor y no llegue a pisar esta función. En producción no cambia nada:
 * se carga en la primera consulta y queda cacheado por el runtime.
 */
async function resolverPorDefecto(tenantId: string): ReturnType<ResolverConector> {
  try {
    const { resolveErpConnector } = await import(
      "../../integration-hub/connectors/ConnectorRegistry.ts"
    );
    const r = await resolveErpConnector(tenantId);
    return { key: r.key, connector: r.connector };
  } catch {
    return null;
  }
}

/**
 * La consulta de albaranes de una empresa, decidida en cada llamada.
 *
 * En cada llamada y no una vez, porque la configuración del conector se cambia
 * desde el panel de integraciones sin reiniciar, y un adaptador cacheado
 * seguiría diciendo «sin ERP» después de configurarlo.
 */
export async function consultaErpDe(
  empresaId: string,
  resolver: ResolverConector = resolverPorDefecto
): Promise<ConsultaAlbaranesErp> {
  const resuelto = await resolver(empresaId);
  const metodo = resuelto?.connector.getPurchaseReceipt;
  if (!resuelto || typeof metodo !== "function") return sinErp;

  const fuente = resuelto.key;
  return {
    fuente,
    disponible: () => true,
    async consultarAlbaran(ctx: ContextoErp, albaran: string): Promise<EstadoAlbaranErp | null> {
      const companyId = (await leerTextoConfig(ctx.empresaId, claveCompany(ctx.empresaCodigo))) ?? undefined;
      let r: Awaited<ReturnType<typeof metodo>>;
      try {
        r = await metodo.call(resuelto.connector, { tenantId: ctx.empresaId, correlationId: `thf-${Date.now()}` }, {
          vendorShipmentNumber: albaran,
          companyId,
        });
      } catch (e) {
        // El ERP caído es «no lo sé», no «no consta». Se deja rastro sin el contenido.
        console.error(`[Therefore] consulta al ERP (${fuente}) fallida:`, (e as Error).message);
        return null;
      }
      if (r === null) return null;
      return aEstadoAlbaran(r, fuente);
    },
  };
}
