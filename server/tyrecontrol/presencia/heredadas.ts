/**
 * Cuentas de telemática heredadas: los clientes de Webfleet de toda la vida.
 *
 * El barrido de «Vehículos en bases» recorre las empresas que tienen un
 * conector de telemática dado de alta en el Hub. Eso deja fuera a los clientes
 * de Webfleet anteriores al Hub: llevan años con su sincronización funcionando,
 * con sus credenciales puestas y sus vehículos enlazados, y aun así la pantalla
 * les salía en blanco con un aviso diciendo que no tenían cuenta. Darlos de
 * alta a mano, uno por uno, es pedirles que vuelvan a declarar algo que ya
 * está declarado.
 *
 * Es la misma idea que el `enlaceHeredado` de los vehículos
 * (BasePresenceService): si el trabajo ya está hecho por el camino viejo, se
 * aprovecha en vez de exigir que se rehaga. Y con la misma regla de
 * precedencia: **el Hub manda**. Si la empresa tiene su cuenta de Webfleet dada
 * de alta, ésa es la buena y aquí no se hereda nada.
 *
 * ── Qué cuenta como «cliente de Webfleet», y por qué así ────────────────────
 *
 * Dos cosas a la vez, y las dos hacen falta:
 *
 *  1. Tiene VEHÍCULOS ENLAZADOS a objetos de Webfleet
 *     (`tc_vehiculos.webfleet_vehicle_id`). Ésta es la prueba de que la empresa
 *     es cliente de Webfleet de verdad: alguien hizo ese trabajo.
 *  2. Sus credenciales RESUELVEN, por donde sea (gestor de secretos, su fila de
 *     `tc_webfleet_config`, o las globales de la casa).
 *
 * El punto 1 no es un adorno: sin él, bastarían las credenciales globales para
 * que TODAS las empresas entraran en el barrido —las globales resuelven para
 * cualquiera—, y nos pondríamos a consultar Webfleet en nombre de clientes que
 * no son de Webfleet. Eso es gasto del proveedor y datos de quien no toca.
 *
 * ── Esto NO da de alta nada ─────────────────────────────────────────────────
 *
 * No se escribe en `integration_connector_configs`. Inscribir a un cliente en
 * el Hub mete su flota, además de en esta pantalla, en la conciliación y en el
 * kilometraje mensual; eso es una decisión con consumo detrás y se toma en el
 * panel, a mano. Aquí solo se contesta a «¿a quién puedo preguntar por los
 * vehículos de esta empresa?» mientras dura el barrido.
 */

/*
 * Supabase y las credenciales se importan DENTRO de cada función, igual que el
 * Hub en `barrido.ts` y por el mismo motivo: `supabase.ts` LANZA al importarse
 * si falta `SUPABASE_URL`. Con imports estáticos, la regla de arriba —que es
 * pura y es lo único que puede equivocarse— no se podría probar sin montar
 * medio entorno.
 */

/** El proveedor heredado. Hoy solo Webfleet: es el único anterior al Hub. */
export const PROVEEDOR_HEREDADO = "webfleet";

/** La cuenta que se le supone a un cliente heredado. */
export const CUENTA_HEREDADA = "default";

export interface SenalesHerencia {
  /** ¿Tiene ya una cuenta de ese proveedor dada de alta en el Hub? */
  tieneCuentaEnHub: boolean;
  /** ¿Hay algún vehículo suyo enlazado a un objeto del proveedor? */
  tieneVehiculosEnlazados: boolean;
  /** De dónde salieron las credenciales, o `ninguno` si no hay. */
  origenCredenciales: "secretos" | "tabla" | "globales" | "ninguno";
}

/**
 * ¿Hay que heredarle la cuenta a esta empresa?
 *
 * Pura y sin excusas: es la única regla de todo esto que puede equivocarse, y
 * equivocarse aquí significa preguntarle al proveedor por la flota de alguien
 * que no es su cliente.
 */
export function heredaCuenta(s: SenalesHerencia): boolean {
  if (s.tieneCuentaEnHub) return false;          // el Hub manda
  if (!s.tieneVehiculosEnlazados) return false;  // no es cliente del proveedor
  return s.origenCredenciales !== "ninguno";     // y hay con qué preguntar
}

/** ¿Tiene esta empresa algún vehículo enlazado con Webfleet? */
export async function tieneVehiculosDeWebfleet(empresaId: string): Promise<boolean> {
  const { supabase } = await import("../../supabase.ts");
  // `head` + `count`: no se traen las filas, solo si hay alguna. Esto corre
  // cada diez minutos y por cada empresa.
  const { count, error } = await supabase
    .from("tc_vehiculos")
    .select("id", { count: "exact", head: true })
    .eq("empresa_id", empresaId)
    .eq("activo", true)
    .not("webfleet_vehicle_id", "is", null);
  if (error) return false;
  return (count ?? 0) > 0;
}

/** ¿Tiene ya cuenta de ese proveedor dada de alta en el Hub? */
async function tieneCuentaEnHub(empresaId: string, connectorKey: string): Promise<boolean> {
  try {
    const { listConnectorConfigs } = await import(
      "../../integration-hub/infrastructure/repositories.ts"
    );
    const configs = await listConnectorConfigs(empresaId);
    // Dada de alta cuenta aunque esté DESACTIVADA: si alguien la dio de alta y
    // la apagó, apagada está. Heredarle una cuenta por detrás sería deshacer
    // esa decisión sin decírselo a nadie.
    return (configs ?? []).some((c: any) => String(c.connector_key) === connectorKey);
  } catch {
    // Si la base del Hub no contesta no se hereda: ante la duda, no preguntar
    // al proveedor en nombre de nadie.
    return true;
  }
}

/**
 * Las cuentas heredadas de una empresa, listas para el barrido.
 *
 * Devuelve [] cuando no hay nada que heredar, que es el caso normal.
 */
export async function cuentasHeredadasDe(empresaId: string): Promise<
  Array<{ key: string; accountKey: string; nombre: string | null; connector: unknown }>
> {
  /*
   * Las señales se miran por orden de coste, no todas a la vez.
   *
   * `heredaCuenta` es un Y de tres condiciones independientes, así que en
   * cuanto una falla el resultado ya no puede cambiar: salir antes no es otra
   * regla, es la misma sin gastar lo que no hace falta. Y lo que se ahorra no
   * es poco — resolver credenciales son cinco lecturas al gestor de secretos
   * por empresa, y esto corre cada diez minutos para toda la cartera—.
   */
  if (await tieneCuentaEnHub(empresaId, PROVEEDOR_HEREDADO)) return [];
  if (!(await tieneVehiculosDeWebfleet(empresaId))) return [];

  const { resolverCredencialesWebfleet } = await import("../webfleetCredenciales.ts");
  const origenCredenciales = await resolverCredencialesWebfleet(empresaId)
    .then((r) => r.origen)
    .catch(() => "ninguno" as const);

  // La decisión sigue pasando por la regla, con las tres señales ya sabidas:
  // es el único sitio donde está escrita.
  if (!heredaCuenta({
    tieneCuentaEnHub: false,
    tieneVehiculosEnlazados: true,
    origenCredenciales,
  })) return [];

  const { buildTelematicsConnector } = await import(
    "../../integration-hub/connectors/ConnectorRegistry.ts"
  );
  return [{
    key: PROVEEDOR_HEREDADO,
    accountKey: CUENTA_HEREDADA,
    // Se dice en el nombre para que en la pantalla no parezca una cuenta que
    // alguien dio de alta y nadie recuerda.
    nombre: "Webfleet (heredada, sin alta en el Hub)",
    connector: await buildTelematicsConnector(empresaId, PROVEEDOR_HEREDADO, CUENTA_HEREDADA),
  }];
}

/**
 * Las empresas que entran en el barrido por herencia.
 *
 * Se recorren las empresas activas —son decenas, no miles— y se le pregunta a
 * cada una por las dos señales. Lo contrario, sacar las empresas de los
 * vehículos enlazados, traería una fila por vehículo: miles de uuids cada diez
 * minutos para contestar a una pregunta de sí o no.
 */
export async function empresasConTelematicaHeredada(): Promise<string[]> {
  const { supabase } = await import("../../supabase.ts");
  const { data, error } = await supabase.from("tc_empresas").select("id");
  if (error) {
    console.warn("[presencia-bases] no se pudieron leer las empresas:", error.message);
    return [];
  }
  const out: string[] = [];
  for (const e of (data ?? []) as Array<{ id: string }>) {
    try {
      if ((await cuentasHeredadasDe(String(e.id))).length) out.push(String(e.id));
    } catch {
      // Una empresa que falle no puede dejar sin barrer a las demás.
    }
  }
  return out;
}
