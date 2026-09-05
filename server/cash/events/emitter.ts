/**
 * Emisión de eventos de dominio hacia MC Central.
 *
 * Una regla y una consecuencia.
 *
 * **La regla:** el evento se escribe DENTRO de la transacción que mueve el
 * dinero. Si el cobro cuaja, su evento existe; si el cobro se deshace, el
 * evento desaparece con él. No hay ningún estado en el que Central sepa de un
 * cobro que la caja no tiene, ni al revés.
 *
 * **La consecuencia:** este INSERT no puede fallar por los datos. Si fallara,
 * arrastraría consigo un cobro que ya ocurrió físicamente —el dinero está en el
 * cajón y el cliente se ha ido— y esa es la peor avería que puede tener este
 * módulo. Por eso la tabla no tiene claves ajenas ni CHECK sobre el tipo, y por
 * eso aquí no se valida nada: no hay ninguna comprobación que merezca el riesgo
 * de tirar una transacción de dinero. Lo único que puede rechazar la fila es
 * que la base esté caída, y en ese caso el cobro tampoco se habría guardado.
 *
 * Lo que este fichero NO hace, y es igual de importante: no envía nada. Escribe
 * en la cola y se acaba su responsabilidad. Enviar es del worker, fuera de la
 * transacción, con reintentos. Es la misma separación que ya salvó al módulo
 * con la ERP: una integración caída no puede revertir un movimiento físico.
 */

import type { PoolClient } from "pg";

/**
 * Qué le ha pasado a la caja. En pasado, siempre: son hechos consumados, no
 * peticiones. Central no puede rechazar un cobro que ya ocurrió; como mucho
 * puede marcarlo para que lo mire una persona.
 */
export type TipoEvento =
  | "SESSION_OPENED"
  | "SESSION_CLOSED"
  | "SESSION_REOPENED"
  | "OPERATION_REGISTERED"
  | "OPERATION_REVERSED"
  | "COUNT_RECORDED"
  | "COUNT_ADJUSTED"
  | "BANK_DEPOSIT_CREATED"
  /*
   * Al ingreso se le ha puesto la fecha REAL del banco (y, de paso, su
   * referencia). Es un hecho distinto de crearlo y necesita evento propio: el
   * ingreso se registra cuando se prepara la bolsa y la fecha se sabe después,
   * al volver del banco. Sin este evento, la caja pasaba a «Confirmado» y
   * Central se quedaba enseñándolo como «Pendiente de confirmar» para siempre.
   */
  | "BANK_DEPOSIT_COMPLETED"
  | "BANK_DEPOSIT_VOIDED"
  /*
   * Dinero que ha salido del cajón y todavía no ha vuelto: el cambio que se ha
   * ido a buscar al banco o los 50 € que lleva alguien para comprar algo.
   *
   * Necesita evento propio y no se puede deducir del movimiento de efectivo:
   * las dos cosas se asientan como `CASH_DELIVERY` y vuelven como `MANUAL_IN`,
   * que es también el tipo de una entrada de caja cualquiera. Sin estos dos
   * eventos, Central vería salir el dinero y no sabría que va a volver ni con
   * quién está mientras tanto.
   */
  | "TRANSIT_OPENED"
  | "TRANSIT_SETTLED"
  /*
   * Se ha repuesto el fondo del cajón con dinero del montón que esperaba al
   * banco. Necesita evento propio por la misma razón que los tránsitos: se
   * asienta como un `MANUAL_IN` cualquiera, así que del movimiento de efectivo
   * no se puede deducir. Y sin él, Central cuenta esos euros DOS VECES —en el
   * cajón, porque el `MANUAL_IN` los mete, y esperando al banco, porque el
   * cierre que los apartó sigue sin conciliar.
   */
  | "FLOAT_TOPUP_REGISTERED";

/** Estados de la cola. La lista vive aquí y en el CHECK de `schema.ts`. */
export type EstadoEvento =
  | "PENDING"
  | "SENDING"
  | "SENT"
  | "ERROR"
  | "RETRY_PENDING"
  | "CANCELLED";

/**
 * El agregado al que pertenece el evento, que es lo que ordena la versión.
 *
 * Son dos y no uno porque los ingresos bancarios no cuelgan de una jornada:
 * agrupan varios cierres y pertenecen a la caja. Forzarlos dentro de una
 * jornada obligaría a elegir cuál de los cierres agrupados manda, y cualquier
 * respuesta sería inventada.
 */
export type Agregado =
  | { tipo: "SESSION"; id: number }
  | { tipo: "REGISTER"; id: number };

export type EntradaEvento = {
  empresaId: string;
  /** Taller de la caja en el momento del hecho. Puede no estar asignado. */
  centroId?: string | null;
  registerId?: number | null;
  sessionId?: number | null;
  agregado: Agregado;
  tipo: TipoEvento;
  /** Cuándo ocurrió. No es cuándo se envía ni cuándo se tecleó. */
  ocurridoEnMs: number;
  actorUserId?: string | null;
  /**
   * Lo mínimo para identificar el hecho y su importe. Deliberadamente delgado:
   * un evento que arrastra la operación entera se convierte en un segundo
   * modelo de datos que mantener sincronizado, y Central siempre puede pedir el
   * detalle por la API cuando de verdad lo necesite.
   */
  datos?: Record<string, unknown>;
};

/**
 * Siguiente versión del agregado.
 *
 * Se calcula con `UPDATE … RETURNING` sobre una fila que la transacción **ya
 * tiene bloqueada** —la jornada por `bloquearSesion`, la caja por el bloqueo de
 * los ingresos—, así que dos terminales no pueden obtener el mismo número:
 * la segunda espera al COMMIT de la primera. No añade contención porque no
 * añade ningún bloqueo nuevo.
 *
 * Si la fila no existe devuelve `null` en vez de reventar: un evento sin número
 * de orden sigue siendo mejor que una transacción de dinero deshecha.
 */
async function siguienteVersion(client: PoolClient, agregado: Agregado): Promise<number | null> {
  const tabla = agregado.tipo === "SESSION" ? "cash_sessions" : "cash_registers";
  const { rows } = await client.query(
    `UPDATE ${tabla} SET version = version + 1 WHERE id = $1 RETURNING version`,
    [agregado.id]
  );
  return rows[0]?.version == null ? null : Number(rows[0].version);
}

/**
 * Encola un evento. Devuelve su `event_id`, que es la clave de deduplicación
 * con la que viajará al destino.
 */
export async function emitirEvento(client: PoolClient, e: EntradaEvento): Promise<string> {
  const version = await siguienteVersion(client, e.agregado);

  const { rows } = await client.query(
    `INSERT INTO cash_event_outbox
       (empresa_id, centro_id, register_id, session_id,
        aggregate_type, aggregate_id, aggregate_version,
        tipo, ocurrido_en_ms, actor_user_id, datos, created_at_ms)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$9)
     RETURNING event_id`,
    [
      e.empresaId,
      e.centroId ?? null,
      e.registerId ?? null,
      e.sessionId ?? null,
      e.agregado.tipo,
      e.agregado.id,
      version,
      e.tipo,
      e.ocurridoEnMs,
      e.actorUserId ?? null,
      JSON.stringify(e.datos ?? {}),
    ]
  );

  return rows[0].event_id;
}

/**
 * El taller de una caja, para sellarlo en el evento.
 *
 * Va aquí y no en quien emite porque casi todos los emisores tienen a mano la
 * jornada pero no la caja. Es una lectura por clave primaria dentro de una
 * transacción ya abierta; el coste no se nota en una caja de mostrador.
 */
export async function centroDeCaja(
  client: PoolClient,
  registerId: number
): Promise<string | null> {
  const { rows } = await client.query(`SELECT centro_id FROM cash_registers WHERE id = $1`, [
    registerId,
  ]);
  return rows[0]?.centro_id ?? null;
}
