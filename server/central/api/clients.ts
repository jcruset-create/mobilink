/**
 * Clientes máquina-a-máquina de MC Central.
 *
 * Hasta aquí **no existía ninguna forma de que un programa hablara con
 * Mobilink**: toda la API exige el Bearer de una sesión de Supabase, o sea, un
 * usuario con su contraseña. Un proceso desatendido —el conector de una ERP, un
 * cuadro de mando, un script nocturno— tenía que usar la cuenta de una persona,
 * que es exactamente lo que no se debe hacer: hereda todos sus permisos, y el
 * día que esa persona se va, deja de funcionar sin que nadie sepa por qué. Era
 * el riesgo R8.
 *
 * **Qué es y qué no es.** Esto implementa `client_credentials`, que es el único
 * flujo de OAuth2 que tiene sentido sin usuario delante: un cliente cambia su
 * identificador y su secreto por un testigo de vida corta. No hay servidor de
 * autorización, ni códigos, ni refresco, ni consentimiento, porque no hay a
 * quién pedírselo. Llamarlo «OAuth2» a secas sería prometer de más; lo que hay
 * es su parte útil aquí, con la forma de petición y respuesta del estándar para
 * que cualquier cliente lo entienda sin documentación especial.
 *
 * **Los secretos no se guardan.** Ni el secreto del cliente ni el testigo: de
 * los dos se guarda su huella. Una copia de la base de datos no da acceso a
 * nada, y el secreto se enseña **una sola vez**, al crearlo. Si se pierde, se
 * genera otro: no hay forma de recuperarlo, y esa es la propiedad que se busca.
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import pool from "../../db.ts";

/** Qué puede hacer un cliente. Deliberadamente pocos y gruesos. */
export const ALCANCES = ["read:network", "read:sessions", "write:events"] as const;
export type Alcance = (typeof ALCANCES)[number];

/** Vida del testigo. Corta: un testigo filtrado caduca solo. */
export const VIDA_TESTIGO_S = 3600;

const huella = (v: string) => createHash("sha256").update(v).digest("hex");

/**
 * Comparación en tiempo constante.
 *
 * Comparar con `===` filtra por el tiempo de respuesta cuántos caracteres del
 * secreto son correctos, y con suficientes intentos eso se convierte en
 * adivinarlo carácter a carácter. Con huellas de longitud fija, `timingSafeEqual`
 * no necesita más cuidado.
 */
function iguales(a: string, b: string): boolean {
  const x = Buffer.from(a, "utf8");
  const y = Buffer.from(b, "utf8");
  return x.length === y.length && timingSafeEqual(x, y);
}

export type ClienteApi = {
  clientId: string;
  nombre: string;
  alcances: string[];
  activo: boolean;
  ultimoUsoMs: number | null;
};

export async function listarClientes(empresaId: string): Promise<ClienteApi[]> {
  const { rows } = await pool.query(
    `SELECT client_id, nombre, alcances, activo, ultimo_uso_ms
       FROM central_api_clients WHERE empresa_id = $1 ORDER BY nombre`,
    [empresaId]
  );
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  return rows.map((r: any) => ({
    clientId: r.client_id,
    nombre: r.nombre,
    alcances: r.alcances ?? [],
    activo: r.activo,
    ultimoUsoMs: r.ultimo_uso_ms == null ? null : Number(r.ultimo_uso_ms),
  }));
}

/**
 * Crea un cliente y devuelve su secreto **una única vez**.
 *
 * Quien llame a esto tiene que enseñárselo al usuario en ese momento: no hay
 * segunda oportunidad, y es a propósito.
 */
export async function crearCliente(
  empresaId: string,
  nombre: string,
  alcances: string[]
): Promise<{ clientId: string; clientSecret: string }> {
  const clientId = `mc_${randomBytes(9).toString("hex")}`;
  const clientSecret = randomBytes(32).toString("base64url");
  const validos = alcances.filter((a) => (ALCANCES as readonly string[]).includes(a));

  await pool.query(
    `INSERT INTO central_api_clients
       (empresa_id, client_id, nombre, secreto_huella, alcances, creado_en_ms)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [empresaId, clientId, nombre.trim() || clientId, huella(clientSecret), validos, Date.now()]
  );

  return { clientId, clientSecret };
}

export async function revocarCliente(empresaId: string, clientId: string): Promise<void> {
  /*
   * Se desactiva y además se borran sus testigos vivos. Sin lo segundo, revocar
   * un cliente lo dejaría entrando hasta una hora más: justo el rato en el que
   * a alguien le urge cortarle el acceso.
   */
  await pool.query(
    `UPDATE central_api_clients SET activo = false WHERE empresa_id = $1 AND client_id = $2`,
    [empresaId, clientId]
  );
  await pool.query(`DELETE FROM central_api_tokens WHERE client_id = $1`, [clientId]);
}

export type Testigo = { access_token: string; token_type: "Bearer"; expires_in: number; scope: string };

/** Cambia identificador y secreto por un testigo. */
export async function emitirTestigo(
  clientId: string,
  clientSecret: string
): Promise<Testigo | null> {
  const { rows } = await pool.query(
    `SELECT empresa_id, secreto_huella, alcances, activo
       FROM central_api_clients WHERE client_id = $1`,
    [clientId]
  );
  const c = rows[0];
  // Mismo resultado para «no existe» y «secreto incorrecto»: distinguirlos
  // permitiría enumerar clientes válidos.
  if (!c || !c.activo || !iguales(c.secreto_huella, huella(clientSecret))) return null;

  const token = randomBytes(32).toString("base64url");
  const expiraMs = Date.now() + VIDA_TESTIGO_S * 1000;

  await pool.query(
    `INSERT INTO central_api_tokens (token_huella, client_id, empresa_id, alcances, expira_ms)
     VALUES ($1,$2,$3,$4,$5)`,
    [huella(token), clientId, c.empresa_id, c.alcances ?? [], expiraMs]
  );

  await pool.query(
    `UPDATE central_api_clients SET ultimo_uso_ms = $2 WHERE client_id = $1`,
    [clientId, Date.now()]
  );

  return {
    access_token: token,
    token_type: "Bearer",
    expires_in: VIDA_TESTIGO_S,
    scope: (c.alcances ?? []).join(" "),
  };
}

export type ContextoApi = { empresaId: string; clientId: string; alcances: string[] };

/** Resuelve un testigo. `null` si no vale o ha caducado. */
export async function resolverTestigo(token: string): Promise<ContextoApi | null> {
  const { rows } = await pool.query(
    `SELECT t.client_id, t.empresa_id, t.alcances
       FROM central_api_tokens t
       JOIN central_api_clients c ON c.client_id = t.client_id
      WHERE t.token_huella = $1 AND t.expira_ms > $2 AND c.activo`,
    [huella(token), Date.now()]
  );
  const t = rows[0];
  return t
    ? { empresaId: t.empresa_id, clientId: t.client_id, alcances: t.alcances ?? [] }
    : null;
}

/** Limpia los testigos caducados. No urge, pero la tabla no debe crecer sola. */
export async function limpiarTestigos(): Promise<number> {
  const { rowCount } = await pool.query(`DELETE FROM central_api_tokens WHERE expira_ms < $1`, [
    Date.now(),
  ]);
  return rowCount ?? 0;
}
