/**
 * Alta, consulta y prueba de conexión de los destinos externos.
 *
 * ── La regla que manda en todo el fichero ───────────────────────────────────
 *
 * El valor de una credencial entra por `resolverSecreto()` y sale por la
 * cabecera `Authorization` de una petición. Nada más. No se guarda, no se
 * devuelve, no se registra y no se mete en un mensaje de error. Los mensajes
 * pasan siempre por `sanearError()` antes de tocar la base o el panel, porque
 * un fallo de red trae con frecuencia la URL entera dentro.
 *
 * Lo que sí sale por la API es el NOMBRE de la variable de entorno. Hace falta:
 * sin él, quien configura no sabe cuál tiene que crear en Render.
 */

import crypto from "node:crypto";

import db from "../db.ts";
import { getSecretsProvider } from "../integration-hub/infrastructure/secrets.ts";
import {
  destinoParaApi,
  estadoDestino,
  estadoGlobal,
  motivosMalaConfiguracion,
  sanearError,
  sePuedeEnviar,
  type EstadoDestino,
} from "./destinos.ts";

const TIEMPO_PRUEBA_MS = 10_000;

export class ErrorDestino extends Error {
  codigo: string;
  estado: number;
  constructor(codigo: string, mensaje: string, estado = 422) {
    super(mensaje);
    this.codigo = codigo;
    this.estado = estado;
  }
}

/**
 * Resuelve el valor de la credencial. **Única función que lo ve.**
 *
 * Se busca primero en el entorno del proceso y luego en el proveedor de
 * secretos del Integration Hub, que es el que ya usan los conectores de ERP y
 * el que permitirá pasar a un gestor real (Key Vault, Secrets Manager) sin
 * tocar nada de aquí.
 */
async function resolverSecreto(nombre: string | null | undefined): Promise<string | undefined> {
  const clave = String(nombre ?? "").trim();
  if (!clave) return undefined;
  const delEntorno = process.env[clave];
  if (delEntorno != null && delEntorno !== "") return delEntorno;
  const delProveedor = await getSecretsProvider()
    .get("dispatch", "central", clave)
    .catch(() => undefined);
  return delProveedor && delProveedor !== "" ? delProveedor : undefined;
}

/**
 * Si la variable existe y tiene contenido. Devuelve una etiqueta, nunca el
 * valor: es lo que permite que el módulo de estados no vea nunca un secreto.
 */
async function comprobarVariable(nombre: string): Promise<"ausente" | "vacia" | "ok"> {
  const clave = String(nombre ?? "").trim();
  if (!clave) return "ausente";
  const bruto = process.env[clave];
  if (bruto === undefined) {
    const alterno = await getSecretsProvider().get("dispatch", "central", clave).catch(() => undefined);
    if (alterno === undefined) return "ausente";
    return alterno.trim() === "" ? "vacia" : "ok";
  }
  return bruto.trim() === "" ? "vacia" : "ok";
}

/** Comprobador síncrono a partir de una foto de las variables ya consultadas. */
function comprobadorDesde(mapa: Map<string, "ausente" | "vacia" | "ok">) {
  return (nombre: string) => mapa.get(nombre) ?? "ausente";
}

async function fotoDeVariables(destinos: any[]) {
  const mapa = new Map<string, "ausente" | "vacia" | "ok">();
  for (const d of destinos) {
    const n = String(d.secretName ?? "").trim();
    if (n && !mapa.has(n)) mapa.set(n, await comprobarVariable(n));
  }
  return mapa;
}

/* ── Consulta ────────────────────────────────────────────────────────────── */

export type CarteraDestinos = {
  estadoGlobal: EstadoDestino;
  /** Cuántos se pueden usar ahora mismo. Cero con destinos dados de alta NO es
   *  lo mismo que no tener ninguno, y la pantalla lo distingue. */
  disponibles: number;
  data: ReturnType<typeof destinoParaApi>[];
};

/**
 * Los destinos que puede ver un taller de Assist, con su estado ya calculado.
 *
 * El estado se calcula AL LEER y no se lee de la columna: entre la última
 * prueba y ahora puede haber desaparecido la variable de entorno, y un
 * «disponible» guardado mentiría en la única pantalla donde importa.
 */
export async function listarDestinosConEstado(tenantId: string | null): Promise<CarteraDestinos> {
  const r = await db.query(
    `SELECT * FROM external_destinations
      WHERE "ownerTenantId" IS NULL OR "ownerTenantId" = $1
      ORDER BY name`,
    [tenantId],
  );
  const variables = await fotoDeVariables(r.rows);
  const hay = comprobadorDesde(variables);

  const data = r.rows.map((d: any) => {
    const estado = estadoDestino(d, hay);
    return destinoParaApi(d, estado, motivosMalaConfiguracion(d, hay));
  });

  return {
    estadoGlobal: estadoGlobal(data.map((d) => d.estado)),
    disponibles: data.filter((d) => d.estado === "AVAILABLE").length,
    data,
  };
}

/**
 * Carga un destino comprobando que el taller puede usarlo.
 *
 * El filtro por dueño va DENTRO de la consulta: un destino de otro taller no
 * se puede alcanzar cambiando el id en la URL, que es lo que se prueba.
 */
export async function cargarDestinoDe(id: number, tenantId: string | null) {
  const r = await db.query(
    `SELECT * FROM external_destinations
      WHERE id = $1 AND ("ownerTenantId" IS NULL OR "ownerTenantId" = $2)`,
    [id, tenantId],
  );
  return r.rows[0] ?? null;
}

/** El estado de un destino concreto, recalculado ahora mismo. */
export async function estadoDeDestino(d: any): Promise<{
  estado: EstadoDestino;
  motivos: ReturnType<typeof motivosMalaConfiguracion>;
}> {
  const hay = comprobadorDesde(await fotoDeVariables([d]));
  return { estado: estadoDestino(d, hay), motivos: motivosMalaConfiguracion(d, hay) };
}

/**
 * Puerta única antes de enviar nada a un destino.
 *
 * Se comprueba aquí y no solo en la pantalla: el botón deshabilitado es una
 * comodidad, esto es la garantía. Un destino sin credencial no puede enviar
 * aunque se llame a la API directamente.
 */
export async function exigirDestinoUtilizable(id: number, tenantId: string | null) {
  const d = await cargarDestinoDe(id, tenantId);
  if (!d) throw new ErrorDestino("destination_not_found", "Destino no disponible", 404);
  const { estado, motivos } = await estadoDeDestino(d);
  if (!sePuedeEnviar(estado)) {
    const detalle = motivos.length ? ` (${motivos.join("; ")})` : "";
    throw new ErrorDestino(
      `destination_${estado.toLowerCase()}`,
      `«${d.name}» no se puede usar: estado ${estado}${detalle}`,
      409,
    );
  }
  return d;
}

/* ── Alta y edición ──────────────────────────────────────────────────────── */

export type AltaDestino = {
  name: string;
  system?: string;
  baseUrl: string;
  apiKeyEnvName: string;
  remoteTenant?: string | null;
  partnerRef?: string | null;
  apiVersion?: string | null;
  capabilities?: unknown;
  timeoutMs?: number | null;
  maxRetries?: number | null;
  metadata?: unknown;
  notes?: string | null;
  ownerTenantId: string | null;
};

/**
 * Da de alta un destino.
 *
 * Rechaza explícitamente cualquier intento de mandar la credencial en el
 * cuerpo. No es paranoia: es el error natural de quien rellena un formulario
 * de integración, y aceptarlo «por comodidad» convertiría la base en un
 * almacén de claves. Se contesta diciendo qué hay que hacer en su lugar.
 */
export async function crearDestino(p: AltaDestino & { [k: string]: unknown }) {
  for (const prohibido of ["apiKey", "api_key", "secret", "token", "password", "credential"]) {
    if (p[prohibido] != null && String(p[prohibido]).trim() !== "") {
      throw new ErrorDestino(
        "secret_not_allowed",
        "No se admiten credenciales en la ficha. Guarda la clave en una variable de " +
          "entorno del servidor e indica aquí solo su nombre (apiKeyEnvName).",
      );
    }
  }

  const name = String(p.name ?? "").trim();
  const baseUrl = String(p.baseUrl ?? "").trim().replace(/\/+$/, "");
  const envName = String(p.apiKeyEnvName ?? "").trim();
  if (!name) throw new ErrorDestino("name_required", "El nombre del destino es obligatorio");
  if (!baseUrl) throw new ErrorDestino("base_url_required", "La URL del destino es obligatoria");
  if (!envName) {
    throw new ErrorDestino(
      "env_name_required",
      "Indica el nombre de la variable de entorno con la credencial (p. ej. CENTRAL_PARTNER_A_API_KEY)",
    );
  }
  /*
   * Esta comprobación va ANTES que la del formato, y a propósito: un valor con
   * pinta de clave en el campo del NOMBRE es casi siempre alguien pegando la
   * credencial donde no toca, y decírselo así se arregla en un segundo.
   * «Formato inválido» le haría probar variantes de la clave.
   */
  if (/^mkc_/i.test(envName) || envName.length > 100) {
    throw new ErrorDestino(
      "env_name_looks_like_secret",
      "Ahí va el nombre de la variable de entorno, no la clave.",
    );
  }
  if (!/^[A-Z][A-Z0-9_]*$/.test(envName)) {
    throw new ErrorDestino(
      "env_name_invalid",
      "El nombre de la variable debe ir en MAYÚSCULAS con guiones bajos, como CENTRAL_PARTNER_A_API_KEY",
    );
  }
  if (!/^https:\/\//i.test(baseUrl) && !/^http:\/\/(localhost|127\.0\.0\.1)/i.test(baseUrl)) {
    throw new ErrorDestino("base_url_insecure", "La URL debe ser https (o localhost en desarrollo)");
  }

  const now = Date.now();
  const sistema = String(p.system ?? "CENTRAL").toUpperCase();
  const r = await db.query(
    `INSERT INTO external_destinations
       (uuid, name, kind, system, "baseUrl", "secretName", "destinationTenantLabel",
        "partnerRef", "apiVersion", capabilities, "timeoutMs", "maxRetries", metadata,
        "ownerTenantId", notes, "createdAtMs", "updatedAtMs")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$16)
     RETURNING *`,
    [
      crypto.randomUUID(), name,
      sistema === "CENTRAL" ? "central" : "external", sistema,
      baseUrl, envName,
      txt(p.remoteTenant), txt(p.partnerRef), txt(p.apiVersion),
      JSON.stringify(Array.isArray(p.capabilities) ? p.capabilities : []),
      ent(p.timeoutMs), ent(p.maxRetries),
      JSON.stringify(p.metadata && typeof p.metadata === "object" ? p.metadata : {}),
      p.ownerTenantId, txt(p.notes), now,
    ],
  );
  const fila = r.rows[0];
  const { estado, motivos } = await estadoDeDestino(fila);
  return destinoParaApi(fila, estado, motivos);
}

export async function activarDestino(id: number, tenantId: string | null, activo: boolean) {
  const d = await cargarDestinoDe(id, tenantId);
  if (!d) throw new ErrorDestino("destination_not_found", "Destino no encontrado", 404);
  await db.query(
    `UPDATE external_destinations SET active = $2, "updatedAtMs" = $3 WHERE id = $1`,
    [id, activo, Date.now()],
  );
  const fresco = await cargarDestinoDe(id, tenantId);
  const { estado, motivos } = await estadoDeDestino(fresco);
  return destinoParaApi(fresco, estado, motivos);
}

/* ── Prueba de conexión ──────────────────────────────────────────────────── */

export type ResultadoPrueba = {
  ok: boolean;
  estado: EstadoDestino;
  mensaje: string;
  durationMs: number;
  remoteTenant?: string | null;
};

/**
 * Comprueba de verdad que el destino se puede usar, en este orden:
 *
 *   1. que la variable de entorno exista y tenga contenido
 *   2. que el endpoint responda
 *   3. que acepte la credencial
 *
 * El orden importa porque cada fallo lleva a un sitio distinto: a Render, al
 * responsable de red, o a quien administra la Central destino. Un único
 * «error de conexión» obliga a probar los tres.
 *
 * Se llama a un endpoint de LECTURA. Probar la conexión no puede crear una
 * asistencia en el destino: sería el peor efecto secundario posible de un
 * botón que la gente pulsa para ver si algo funciona.
 */
export async function probarConexion(
  id: number,
  tenantId: string | null,
  porQuien?: string,
): Promise<ResultadoPrueba> {
  const d = await cargarDestinoDe(id, tenantId);
  if (!d) throw new ErrorDestino("destination_not_found", "Destino no encontrado", 404);

  const inicio = Date.now();
  const { estado: previo, motivos } = await estadoDeDestino(d);
  if (previo === "DISABLED") {
    return await anotar(d, "DISABLED", "El destino está desactivado.", 0, porQuien);
  }
  if (previo === "MISCONFIGURED") {
    return await anotar(d, "MISCONFIGURED", motivos.join("; ") || "Configuración incompleta", 0, porQuien);
  }

  const secreto = await resolverSecreto(d.secretName);
  if (!secreto) {
    // No debería pasar tras la comprobación de arriba, pero si pasa NO se
    // intenta la llamada: una petición sin credencial ensucia el log del
    // destino con un 401 que no significa nada.
    return await anotar(d, "MISCONFIGURED", "No se ha podido resolver la credencial", 0, porQuien);
  }

  const controlador = new AbortController();
  const limite = Number(d.timeoutMs) > 0 ? Number(d.timeoutMs) : TIEMPO_PRUEBA_MS;
  const temporizador = setTimeout(() => controlador.abort(), limite);
  try {
    const res = await fetch(
      `${String(d.baseUrl).replace(/\/+$/, "")}/api/connect/v1/assistances?limit=1`,
      {
        headers: { Authorization: `Bearer ${secreto}`, Accept: "application/json" },
        signal: controlador.signal,
      },
    );
    const duracion = Date.now() - inicio;

    if (res.status === 401 || res.status === 403) {
      const cuerpo = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      const motivo = sanearError(
        cuerpo?.error?.message ?? `El destino rechazó la credencial (${res.status})`,
        [secreto],
      );
      return await anotar(d, "AUTH_ERROR", motivo, duracion, porQuien);
    }
    if (!res.ok) {
      return await anotar(
        d, "UNREACHABLE",
        sanearError(`El destino respondió ${res.status}`, [secreto]),
        duracion, porQuien,
      );
    }

    await res.json().catch(() => null);
    return await anotar(
      d, "AVAILABLE",
      `Conexión correcta${d.destinationTenantLabel ? ` con ${d.destinationTenantLabel}` : ""}.`,
      duracion, porQuien,
    );
  } catch (e: any) {
    const duracion = Date.now() - inicio;
    const motivo =
      e?.name === "AbortError"
        ? `El destino no respondió en ${Math.round(limite / 1000)} s`
        : sanearError(e, [secreto]);
    return await anotar(d, "UNREACHABLE", motivo, duracion, porQuien);
  } finally {
    clearTimeout(temporizador);
  }
}

/** Guarda el resultado de la prueba. El detalle entra YA saneado. */
async function anotar(
  d: any,
  estado: EstadoDestino,
  mensaje: string,
  durationMs: number,
  porQuien?: string,
): Promise<ResultadoPrueba> {
  const now = Date.now();
  const limpio = sanearError(mensaje);
  await db.query(
    `UPDATE external_destinations
        SET "healthStatus" = $2,
            "lastAttemptAtMs" = $3,
            "lastOkAtMs" = CASE WHEN $2 = 'AVAILABLE' THEN $3 ELSE "lastOkAtMs" END,
            "lastError" = CASE WHEN $2 = 'AVAILABLE' THEN NULL ELSE $4 END,
            "updatedAtMs" = $3
      WHERE id = $1`,
    [d.id, estado, now, limpio],
  );
  await db.query(
    `INSERT INTO external_destination_checks
       ("destinationId", estado, "durationMs", detail, "byUser", "checkedAtMs")
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [d.id, estado, durationMs, limpio, porQuien ?? null, now],
  );
  return {
    ok: estado === "AVAILABLE",
    estado,
    mensaje: limpio,
    durationMs,
    remoteTenant: d.destinationTenantLabel ?? null,
  };
}

export { resolverSecreto };

function txt(v: unknown): string | null {
  const s = v == null ? "" : String(v).trim();
  return s === "" ? null : s;
}

function ent(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}
