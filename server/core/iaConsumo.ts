/**
 * El contador de la IA: qué se gasta, quién lo gasta y hasta dónde puede.
 *
 * ── Por qué existe ──────────────────────────────────────────────────────────
 *
 * `openaiService.ts` ya registraba cada llamada, pero solo con `console.log`.
 * Eso sirve para mirar un incidente y para nada más: no hay forma de saber qué
 * empresa gasta, ni de poner un tope, ni de notar que algo se ha disparado.
 * Con cinco lectores de imagen y un asistente ya en producción, el grifo lleva
 * tiempo abierto sin contador.
 *
 * ── Una fila por PETICIÓN, no por intento ───────────────────────────────────
 *
 * Si el proveedor falla dos veces y responde a la tercera, eso es UNA petición
 * con `intentos = 3`. Si hubo que caer al modelo de respaldo, `uso_respaldo` lo
 * dice y `modelo_servido` guarda el que contestó de verdad. Contar un intento
 * como una petición inflaría el consumo y haría saltar cuotas que nadie ha
 * consumido.
 *
 * Y una respuesta servida de CACHÉ también se apunta, con `origen = 'cache'` e
 * `intentos = 0`: no cuesta dinero, pero sin ella no se puede responder a «¿de
 * cuántas consultas nos hemos ahorrado la llamada?», que es justo lo que
 * justifica la caché.
 *
 * ── Lo que no se guarda ─────────────────────────────────────────────────────
 *
 * Ni el prompt, ni la respuesta, ni matrículas, ni documentos, ni claves. Por
 * la capa de IA pasan fichas técnicas y datos de clientes; un contador de
 * gasto no es sitio para eso. De los errores se guarda un CÓDIGO corto, nunca
 * el cuerpo.
 *
 * ── Concurrencia ────────────────────────────────────────────────────────────
 *
 * La reserva (`reservar`) comprueba el tope y apunta la petición DENTRO de la
 * misma transacción, tomando antes un `pg_advisory_xact_lock` por empresa. Sin
 * eso, veinte peticiones a la vez leerían el mismo recuento y pasarían todas.
 *
 * ── Y si la base no contesta ────────────────────────────────────────────────
 *
 * Se deja pasar la llamada y se avisa por consola con un código buscable.
 * Decidido así a propósito: un fallo del contador no puede apagar los lectores
 * ni el asistente, que llevan meses funcionando. El coste de equivocarse por
 * este lado es una llamada sin apuntar; por el otro, una avería.
 */

/** Tope por defecto cuando la empresa no tiene fila propia. 0 = sin tope. */
const PETICIONES_DIA_DEFECTO = Number(process.env.IA_MAX_PETICIONES_DIA || 0);
const TOKENS_DIA_DEFECTO = Number(process.env.IA_MAX_TOKENS_DIA || 0);

export type ResultadoUso = "ok" | "error" | "sin_clave" | "cuota";
export type OrigenUso = "proveedor" | "cache";

export interface ContextoUso {
  /** Null cuando la llamada no pertenece a ninguna empresa. No se inventa. */
  empresaId?: string | null;
  /** Si no se indica, sale del prefijo de `operacion` ("cash.cotejo" → "cash"). */
  modulo?: string;
  operacion: string;
  modeloPedido: string;
}

export interface CierreUso {
  resultado: ResultadoUso;
  modeloServido?: string | null;
  usoRespaldo?: boolean;
  intentos?: number;
  tokensEntrada?: number | null;
  tokensSalida?: number | null;
  duracionMs: number;
  /** Código corto. Nunca el mensaje del proveedor. */
  errorCodigo?: string | null;
  peticionId?: string | null;
}

/** Lo que devuelve la reserva: si se puede llamar y con qué id apuntarlo. */
export interface Reserva {
  permitido: boolean;
  /** Null si no se pudo apuntar (base caída) o si no se permite. */
  usoId: string | null;
  /** Por qué no se permite, para que el llamante lo cuente en su idioma. */
  motivo?: "ia_desactivada" | "tope_peticiones" | "tope_tokens";
  /** Lo consumido hoy, para poder decirlo sin volver a preguntar. */
  peticionesHoy?: number;
  tokensHoy?: number;
}

const PERMITIDO_SIN_CONTADOR: Reserva = { permitido: true, usoId: null };

export function moduloDe(operacion: string): string {
  const i = operacion.indexOf(".");
  return i > 0 ? operacion.slice(0, i) : "otros";
}

/**
 * El pool se importa DENTRO de la función por lo mismo que en
 * `kilometrajeRevision.ts`: `db.ts` LANZA al importarse si no hay
 * `DATABASE_URL`, y la capa de IA la usan módulos que no siempre la tienen.
 */
async function pool() {
  return (await import("../db.ts")).default;
}

function avisar(que: string, e: unknown) {
  console.warn(JSON.stringify({
    service: "mobilink-ai",
    operation: "consumo." + que,
    status: "degradado",
    error: String((e as Error)?.message ?? e).slice(0, 200),
  }));
}

/**
 * ¿Puede esta empresa hacer una llamada más hoy? Si sí, la apunta como
 * `en_curso` y devuelve su id para cerrarla después.
 */
export async function reservar(ctx: ContextoUso): Promise<Reserva> {
  let p;
  try { p = await pool(); } catch (e) { avisar("sin_pool", e); return PERMITIDO_SIN_CONTADOR; }

  const cliente = await p.connect().catch((e: unknown) => { avisar("sin_conexion", e); return null; });
  if (!cliente) return PERMITIDO_SIN_CONTADOR;

  try {
    await cliente.query("begin");
    // Serializa por empresa: sin esto, N peticiones simultáneas leen el mismo
    // recuento y pasan todas. El lock se suelta solo al cerrar la transacción.
    await cliente.query("select pg_advisory_xact_lock(hashtext($1))",
      ["ia_cuota:" + (ctx.empresaId ?? "global")]);

    let activa = true;
    let maxPeticiones = PETICIONES_DIA_DEFECTO;
    let maxTokens = TOKENS_DIA_DEFECTO;

    if (ctx.empresaId) {
      const { rows } = await cliente.query(
        `select ia_activa, max_peticiones_dia, max_tokens_dia
           from ia_limites where empresa_id = $1`, [ctx.empresaId]);
      if (rows[0]) {
        activa = rows[0].ia_activa !== false;
        if (rows[0].max_peticiones_dia != null) maxPeticiones = Number(rows[0].max_peticiones_dia);
        if (rows[0].max_tokens_dia != null) maxTokens = Number(rows[0].max_tokens_dia);
      }
    }

    // Lo de hoy: solo lo que ha costado dinero. Las respuestas de caché se
    // apuntan pero no consumen cuota, que es el sentido de tenerla.
    const { rows: usado } = await cliente.query(
      `select count(*)::int as peticiones,
              coalesce(sum(coalesce(tokens_entrada,0) + coalesce(tokens_salida,0)), 0)::int as tokens
         from ia_uso
        where creado_at >= date_trunc('day', now())
          and origen = 'proveedor'
          -- Los rechazos por cuota y las peticiones que ni salieron (sin
          -- clave configurada) no han gastado nada: se apuntan, pero no
          -- consumen cuota.
          and resultado not in ('cuota', 'sin_clave')
          and ($1::uuid is null or empresa_id = $1::uuid)`,
      [ctx.empresaId ?? null]);
    const peticionesHoy = Number(usado[0]?.peticiones ?? 0);
    const tokensHoy = Number(usado[0]?.tokens ?? 0);

    const negar = (motivo: Reserva["motivo"]): Reserva => ({
      permitido: false, usoId: null, motivo, peticionesHoy, tokensHoy,
    });

    let rechazo: Reserva | null = null;
    if (!activa) rechazo = negar("ia_desactivada");
    else if (maxPeticiones > 0 && peticionesHoy >= maxPeticiones) rechazo = negar("tope_peticiones");
    else if (maxTokens > 0 && tokensHoy >= maxTokens) rechazo = negar("tope_tokens");

    if (rechazo) {
      // El rechazo también se apunta: sin esta fila no hay forma de ver que
      // una empresa está chocando con su tope todos los días.
      await cliente.query(
        `insert into ia_uso (empresa_id, modulo, operacion, modelo_pedido,
                             origen, intentos, resultado, error_codigo, cerrado_at)
         values ($1, $2, $3, $4, 'proveedor', 0, 'cuota', $5, now())`,
        [ctx.empresaId ?? null, ctx.modulo ?? moduloDe(ctx.operacion),
         ctx.operacion, ctx.modeloPedido, rechazo.motivo]);
      await cliente.query("commit");
      return rechazo;
    }

    const { rows: creada } = await cliente.query(
      `insert into ia_uso (empresa_id, modulo, operacion, modelo_pedido, origen, resultado)
       values ($1, $2, $3, $4, 'proveedor', 'en_curso') returning id`,
      [ctx.empresaId ?? null, ctx.modulo ?? moduloDe(ctx.operacion),
       ctx.operacion, ctx.modeloPedido]);
    await cliente.query("commit");
    return { permitido: true, usoId: String(creada[0].id), peticionesHoy, tokensHoy };
  } catch (e) {
    await cliente.query("rollback").catch(() => {});
    avisar("reservar", e);
    return PERMITIDO_SIN_CONTADOR;
  } finally {
    cliente.release();
  }
}

/** Cierra la fila de una petición reservada. Nunca lanza. */
export async function cerrar(usoId: string | null, c: CierreUso): Promise<void> {
  if (!usoId) return;
  try {
    const p = await pool();
    await p.query(
      `update ia_uso
          set resultado = $2, modelo_servido = $3, uso_respaldo = $4, intentos = $5,
              tokens_entrada = $6, tokens_salida = $7, duracion_ms = $8,
              error_codigo = $9, peticion_id = $10, cerrado_at = now()
        where id = $1`,
      [usoId, c.resultado, c.modeloServido ?? null, c.usoRespaldo ?? false,
       c.intentos ?? 0, c.tokensEntrada ?? null, c.tokensSalida ?? null,
       Math.round(c.duracionMs), (c.errorCodigo ?? null)?.slice(0, 80) ?? null,
       (c.peticionId ?? null)?.slice(0, 120) ?? null]);
  } catch (e) {
    avisar("cerrar", e);
  }
}

/**
 * Apunta una respuesta servida de caché. No consume cuota y no cuesta: se
 * registra para poder medir cuánto se ahorra.
 */
export async function registrarCache(ctx: ContextoUso, duracionMs: number): Promise<void> {
  try {
    const p = await pool();
    await p.query(
      `insert into ia_uso (empresa_id, modulo, operacion, modelo_pedido, origen,
                           intentos, resultado, duracion_ms, cerrado_at)
       values ($1, $2, $3, $4, 'cache', 0, 'ok', $5, now())`,
      [ctx.empresaId ?? null, ctx.modulo ?? moduloDe(ctx.operacion),
       ctx.operacion, ctx.modeloPedido, Math.round(duracionMs)]);
  } catch (e) {
    avisar("registrarCache", e);
  }
}

/**
 * Apunta una petición que no llegó a salir porque el servidor no tiene clave.
 * No consume cuota —no ha gastado nada—, pero sin esta fila una instancia mal
 * configurada se ve igual que una instancia sin uso.
 */
export async function registrarSinClave(ctx: ContextoUso): Promise<void> {
  try {
    const p = await pool();
    await p.query(
      `insert into ia_uso (empresa_id, modulo, operacion, modelo_pedido, origen,
                           intentos, resultado, duracion_ms, cerrado_at)
       values ($1, $2, $3, $4, 'proveedor', 0, 'sin_clave', 0, now())`,
      [ctx.empresaId ?? null, ctx.modulo ?? moduloDe(ctx.operacion),
       ctx.operacion, ctx.modeloPedido]);
  } catch (e) {
    avisar("registrarSinClave", e);
  }
}

/** ¿Tiene esta empresa encendido el resumen de vehículo? Apagado por defecto. */
export async function resumenVehiculoActivo(empresaId: string): Promise<boolean> {
  try {
    const p = await pool();
    const { rows } = await p.query(
      `select resumen_vehiculo_activo from ia_limites where empresa_id = $1`, [empresaId]);
    return rows[0]?.resumen_vehiculo_activo === true;
  } catch (e) {
    // Aquí sí se falla CERRADO, al revés que en la cuota: es una
    // funcionalidad nueva que nadie echa de menos, y encenderla sola a toda
    // la cartera por un fallo de base sería lo contrario de lo pedido.
    avisar("resumenVehiculoActivo", e);
    return false;
  }
}
