/**
 * Repaso quincenal de la flota telemática.
 *
 * Cada quince días, por cada cliente con telemática configurada:
 *
 *   1. Enlaza las coincidencias EXACTAS de matrícula que hayan aparecido.
 *   2. Concilia y guarda el resultado, que es lo que alimenta el contador del
 *      menú sin volver a molestar al proveedor.
 *   3. Manda un correo, pero solo si hay algo que contar.
 *
 * ── Lo que este proceso NO hace ─────────────────────────────────────────────
 *
 * No crea vehículos y no da de baja ninguno. Un vehículo que deja de aparecer
 * en el proveedor no cambia de estado en TyreControl: simplemente su
 * `last_seen_at` se queda quieto y el informe dice desde cuándo. Dar de baja
 * arrastra neumáticos montados, histórico y facturación, y esa decisión la
 * toma una persona mirando la pantalla, no un temporizador de madrugada.
 *
 * Enlazar sí se automatiza porque es reversible y no es una decisión distinta
 * de la que ya se toma a mano: una propuesta es coincidencia única y exacta de
 * matrícula normalizada, las ambiguas van a discrepancias y las que no traen
 * matrícula no proponen nada.
 *
 * ── Por qué la cadencia se guarda y no se cuenta desde el arranque ──────────
 *
 * Un `setInterval` de catorce días en un servidor que se reinicia cada dos por
 * tres no dispara nunca. Lo que manda es la marca de la última pasada, que está
 * en la base: el bucle solo se despierta a menudo para mirar el reloj y, si
 * todavía no toca, se vuelve a dormir sin hablar con nadie.
 */

import { supabase } from "../../supabase.ts";
import { getMailTransport } from "../../mail.ts";
import { ErrorConciliacion, vincularLote } from "./acciones.ts";
import {
  calcularCambios,
  guardarEstado,
  leerEstado,
  LATIDO_REPASO_MS,
  PERIODO_REPASO_MS,
  type Cambios,
  type EstadoConciliacion,
} from "./estado.ts";

/**
 * Cada cuánto toca de verdad, y cada cuánto se mira el reloj.
 *
 * Los dos números viven en `estado.ts`, no aquí: de ellos depende también
 * cuánto sigue valiendo el estado guardado para afirmar una ausencia, y
 * tenerlos en dos sitios es la forma de que un día dejen de cuadrar. Se
 * reexporta `PERIODO_MS` porque es el nombre por el que ya se conoce.
 */
export const PERIODO_MS = PERIODO_REPASO_MS;
const LATIDO_MS = LATIDO_REPASO_MS;
/** Cuántas filas se enumeran en el correo antes de resumir con «y N más». */
const MAX_FILAS_CORREO = 50;

export interface ResultadoQuincenal {
  empresaId: string;
  estado: EstadoConciliacion;
  cambios: Cambios;
  correoEnviado: boolean;
  motivoSinCorreo?: string;
}

// ── Una pasada de un cliente ────────────────────────────────────────────────

/**
 * Concilia una empresa entera: enlaza lo exacto, guarda y avisa.
 *
 * Se exporta aparte del bucle para poder dispararla a mano y para poder
 * probarla sin temporizadores.
 */
export async function repasarEmpresa(empresaId: string): Promise<ResultadoQuincenal | null> {
  const { resolveTelematicsConnectors } = await import(
    "../../integration-hub/connectors/ConnectorRegistry.ts"
  );
  const cuentas = await resolveTelematicsConnectors(empresaId);
  // Sin cuentas no hay nada que repasar, y guardar un estado vacío haría que el
  // menú enseñara un cero como si se hubiera comprobado algo.
  if (cuentas.length === 0) return null;

  // El estado anterior se lee ANTES de tocar nada: es con lo que se compara.
  const previo = await leerEstado(empresaId);

  // ── 1. Enlazar las coincidencias exactas, cuenta por cuenta ──────────────
  let enlazadosAuto = 0;
  for (const c of cuentas) {
    try {
      // Sin `esperados`: aquí no hay pantalla que pueda ir desfasada, y el
      // servidor enlaza exactamente lo que él mismo acaba de calcular.
      const r = await vincularLote(
        { empresaId, connectorKey: c.key, accountKey: c.accountKey },
        // Nadie está mirando: los enlaces quedan marcados como automáticos.
        { automatico: true },
      );
      enlazadosAuto += r.enlazados;
      for (const f of r.fallidos) {
        console.warn(`[conciliacion-quincenal] ${empresaId} no se pudo enlazar: ${f.error}`);
      }
    } catch (e) {
      // Que no haya nada que enlazar es lo normal a partir de la segunda
      // pasada, no un fallo: el resto sí se registra.
      if (e instanceof ErrorConciliacion && e.codigo === "SIN_PROPUESTAS") continue;
      console.warn(
        `[conciliacion-quincenal] ${empresaId}/${c.key}/${c.accountKey}:`,
        (e as any)?.message ?? e,
      );
    }
  }

  // ── 2. Conciliar ya con los enlaces nuevos puestos ───────────────────────
  const { conciliarFlota } = await import(
    "../../integration-hub/application/services/VehicleReconciliationService.ts"
  );
  const { leerFlotaInterna } = await import("./flota.ts");
  const { normalizarMatricula } = await import("../matricula.ts");
  const { nextCorrelationId } = await import("../../integration-hub/infrastructure/repositories.ts");

  const resultado = await conciliarFlota(
    { tenantId: empresaId, correlationId: await nextCorrelationId() },
    { leerFlotaInterna, normalizarMatricula },
  );

  const estado: EstadoConciliacion = {
    version: 1,
    ejecutadoMs: Date.now(),
    status: resultado.resumen.status,
    enlazadosAuto,
    pendientes: {
      soloProveedor: resultado.resumen.providerOnlyCount,
      soloTyreControl: resultado.resumen.tyrecontrolOnlyCount,
      discrepancias: resultado.resumen.discrepancyCount,
    },
    cuentas: resultado.resumen.cuentas.map((c) => ({
      connectorKey: c.connectorKey,
      accountKey: c.accountKey,
      ok: c.ok,
      ...(c.error ? { error: c.error } : {}),
    })),
    externosVistos: resultado.externosVistos,
    // Una pasada incompleta no sirve de referencia: lo que falta no es que haya
    // desaparecido, es que no se ha podido preguntar.
    externosCompletos: resultado.resumen.status === "complete",
  };

  const cambios = calcularCambios(previo, estado);
  await guardarEstado(empresaId, estado);

  // ── 3. Avisar, si hay de qué ─────────────────────────────────────────────
  const hayNoticia =
    previo === null ||
    estado.status !== "complete" ||
    enlazadosAuto > 0 ||
    cambios.altas.length > 0 ||
    cambios.bajas.length > 0;

  if (!hayNoticia) {
    return { empresaId, estado, cambios, correoEnviado: false, motivoSinCorreo: "sin cambios" };
  }

  const etiquetas = etiquetasDeExternos(resultado);
  const envio = await avisar(empresaId, estado, cambios, etiquetas);
  return { empresaId, estado, cambios, ...envio };
}

/** externalId → algo legible («1234ABC» o el nombre en la plataforma). */
function etiquetasDeExternos(resultado: {
  enlazados: Array<{ externo: { providerVehicleId: string; plate?: string; name?: string } }>;
  soloProveedor: Array<{ externo: { providerVehicleId: string; plate?: string; name?: string } }>;
}): Map<string, string> {
  const m = new Map<string, string>();
  const anotar = (e: { providerVehicleId: string; plate?: string; name?: string }) => {
    const texto = e.plate || e.name;
    if (texto) m.set(e.providerVehicleId, texto);
  };
  resultado.enlazados.forEach((f) => anotar(f.externo));
  resultado.soloProveedor.forEach((f) => anotar(f.externo));
  return m;
}

// ── El correo ───────────────────────────────────────────────────────────────

/**
 * A quién se avisa.
 *
 * `CONCILIACION_CORREO_AVISOS` manda cuando está puesta, porque este informe es
 * técnico y en muchas casas no va al buzón general del cliente. Si no está, se
 * usa el correo de la empresa, que es el único que consta.
 */
async function destinatarios(empresaId: string): Promise<{ para: string[]; empresa: string }> {
  const { data } = await supabase
    .from("tc_empresas")
    .select("nombre, email")
    .eq("id", empresaId)
    .maybeSingle();

  const configurado = (process.env.CONCILIACION_CORREO_AVISOS ?? "").trim();
  const bruto = configurado || String((data as any)?.email ?? "");
  return {
    para: bruto.split(",").map((d) => d.trim()).filter(Boolean),
    empresa: String((data as any)?.nombre ?? empresaId),
  };
}

function listar(ids: string[], etiquetas: Map<string, string>): string {
  const visibles = ids.slice(0, MAX_FILAS_CORREO).map((id) => `  · ${etiquetas.get(id) ?? id}`);
  const resto = ids.length - visibles.length;
  return visibles.join("\n") + (resto > 0 ? `\n  … y ${resto} más` : "");
}

/** El cuerpo del aviso. Separado para poder probarlo sin SMTP. */
export function redactarAviso(
  empresa: string,
  estado: EstadoConciliacion,
  cambios: Cambios,
  etiquetas: Map<string, string> = new Map(),
): { asunto: string; texto: string } {
  const partes: string[] = [];

  if (estado.status !== "complete") {
    const caidas = estado.cuentas.filter((c) => !c.ok);
    partes.push(
      "ATENCIÓN: la lectura no fue completa, así que lo que sigue está a medias.",
      ...caidas.map((c) => `  · ${c.connectorKey}/${c.accountKey}: ${c.error ?? "sin respuesta"}`),
      "Mientras una cuenta no conteste, ningún vehículo se cuenta como desaparecido.",
      "",
    );
  }

  if (estado.enlazadosAuto > 0) {
    partes.push(`Enlazados automáticamente por matrícula exacta: ${estado.enlazadosAuto}`, "");
  }

  if (cambios.comparable) {
    partes.push(
      cambios.altas.length > 0
        ? `Altas en el proveedor (${cambios.altas.length}):\n${listar(cambios.altas, etiquetas)}`
        : "Altas en el proveedor: ninguna",
      "",
      cambios.bajas.length > 0
        ? `Han dejado de aparecer (${cambios.bajas.length}):\n${listar(cambios.bajas, etiquetas)}\n` +
          "  (no se ha dado de baja ninguno: eso se decide a mano en el panel)"
        : "Han dejado de aparecer: ninguno",
      "",
    );
  } else {
    partes.push(
      "No hay con qué comparar todavía: este es el primer repaso completo o el",
      "anterior se quedó a medias. El siguiente ya podrá decir altas y bajas.",
      "",
    );
  }

  partes.push(
    "Pendiente de revisar en el panel:",
    `  · Solo en el proveedor, sin enlazar: ${estado.pendientes.soloProveedor}`,
    `  · Solo en TyreControl: ${estado.pendientes.soloTyreControl}`,
    `  · Discrepancias: ${estado.pendientes.discrepancias}`,
    "",
    "Panel → Conciliación telemática.",
  );

  const total =
    estado.pendientes.soloProveedor +
    estado.pendientes.soloTyreControl +
    estado.pendientes.discrepancias;

  return {
    asunto: `[TyreControl] Conciliación telemática de ${empresa}: ${total} por revisar`,
    texto: partes.join("\n"),
  };
}

async function avisar(
  empresaId: string,
  estado: EstadoConciliacion,
  cambios: Cambios,
  etiquetas: Map<string, string>,
): Promise<{ correoEnviado: boolean; motivoSinCorreo?: string }> {
  const transporte = getMailTransport();
  if (!transporte) return { correoEnviado: false, motivoSinCorreo: "SMTP no configurado" };

  const { para, empresa } = await destinatarios(empresaId);
  if (para.length === 0) return { correoEnviado: false, motivoSinCorreo: "sin destinatario" };

  const { asunto, texto } = redactarAviso(empresa, estado, cambios, etiquetas);
  try {
    await transporte.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: para.join(", "),
      subject: asunto,
      text: texto,
    });
    return { correoEnviado: true };
  } catch (e) {
    // Un aviso que no sale no debe deshacer el repaso, que ya está guardado.
    console.warn("[conciliacion-quincenal] no se pudo enviar el aviso:", (e as any)?.message ?? e);
    return { correoEnviado: false, motivoSinCorreo: "fallo al enviar" };
  }
}

// ── El bucle ────────────────────────────────────────────────────────────────

/**
 * Una vuelta: repasa los clientes a los que ya les toca.
 *
 * Devuelve lo que ha hecho, para poder probarlo y para que el registro diga
 * algo cuando no hace nada.
 */
export async function tickConciliacionQuincenal(
  ahora = Date.now(),
): Promise<{ repasados: string[]; omitidos: number }> {
  const { listTenantsWithConnectors } = await import(
    "../../integration-hub/infrastructure/repositories.ts"
  );
  const { knownTelematicsConnectorKeys } = await import(
    "../../integration-hub/connectors/ConnectorRegistry.ts"
  );

  const empresas = await listTenantsWithConnectors(knownTelematicsConnectorKeys());
  const repasados: string[] = [];
  let omitidos = 0;

  // En serie a propósito: cada repaso descarga la flota entera de un proveedor
  // y hace cientos de escrituras. Hacerlo de todos los clientes a la vez es la
  // forma más rápida de agotar el pool y de que nos limiten desde el otro lado.
  for (const empresaId of empresas) {
    const estado = await leerEstado(empresaId);
    if (estado && ahora - estado.ejecutadoMs < PERIODO_MS) {
      omitidos += 1;
      continue;
    }
    try {
      const r = await repasarEmpresa(empresaId);
      if (r) repasados.push(empresaId);
    } catch (e) {
      // Un cliente que falla no puede dejar sin repasar a los siguientes.
      console.error("[conciliacion-quincenal]", empresaId, (e as any)?.message ?? e);
    }
  }

  return { repasados, omitidos };
}

let temporizador: ReturnType<typeof setInterval> | null = null;

export function startConciliacionQuincenal(): void {
  if (temporizador) return;
  const vuelta = () => {
    void tickConciliacionQuincenal()
      .then(({ repasados, omitidos }) => {
        if (repasados.length > 0) {
          console.log(`[conciliacion-quincenal] ${repasados.length} empresas repasadas`);
        } else if (omitidos > 0) {
          console.log(`[conciliacion-quincenal] nada que repasar (${omitidos} al día)`);
        }
      })
      .catch((e) => console.error("[conciliacion-quincenal]", (e as any)?.message ?? e));
  };
  // La primera, a los cinco minutos: deja que el servidor acabe de levantarse.
  setTimeout(vuelta, 5 * 60 * 1000);
  temporizador = setInterval(vuelta, LATIDO_MS);
}

export function stopConciliacionQuincenal(): void {
  if (temporizador) clearInterval(temporizador);
  temporizador = null;
}
