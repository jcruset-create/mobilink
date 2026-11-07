/**
 * Alcance de un usuario de TyreControl: sobre qué empresa puede trabajar.
 *
 * Esto era una función privada de `asistente.ts`. Vive aparte desde que hay
 * más de un consumidor —el resumen de vehículo y los cinco lectores de
 * imagen, que necesitan saber a QUÉ EMPRESA se le imputa el gasto de IA— y
 * porque una segunda copia de la comprobación de aislamiento es exactamente
 * la clase de duplicado que un día se queda atrás.
 *
 * ⚠️ El cliente `supabase` del servidor usa SERVICE ROLE y NO aplica RLS: la
 * empresa que devuelve esta función es la única barrera entre clientes.
 */
import { supabase } from "../supabase.ts";

export type Alcance = { empresaId: string; nombre: string; esCliente: boolean };

/**
 * Calcula la empresa sobre la que trabaja este usuario. `empresaSolicitada`
 * solo se acepta si el usuario ya tenía acceso a ella.
 */
export async function resolverAlcance(userId: string, empresaSolicitada?: string): Promise<Alcance | null> {
  const { data: u } = await supabase
    .from("tc_usuarios")
    .select("rol, empresa_id, es_superadmin")
    .eq("id", userId)
    .maybeSingle();
  if (!u) return null;

  const esCliente = u.rol === "cliente" && !u.es_superadmin;

  // Un cliente responde SIEMPRE por su empresa: no puede pedir otra.
  let empresaId: string | null = esCliente ? (u.empresa_id as string) : null;

  if (!esCliente) {
    const permitidas = new Set<string>();
    if (u.empresa_id) permitidas.add(u.empresa_id as string);
    const { data: asignadas } = await supabase
      .from("tc_operador_empresas")
      .select("empresa_id")
      .eq("usuario_id", userId);
    for (const a of asignadas ?? []) permitidas.add(a.empresa_id as string);

    if (empresaSolicitada) {
      // Un superadmin puede consultar cualquiera; el resto, solo las suyas.
      if (!u.es_superadmin && !permitidas.has(empresaSolicitada)) return null;
      empresaId = empresaSolicitada;
    } else {
      empresaId = (u.empresa_id as string) ?? [...permitidas][0] ?? null;
    }
  }
  if (!empresaId) return null;

  const { data: e } = await supabase.from("tc_empresas").select("nombre").eq("id", empresaId).maybeSingle();
  return { empresaId, nombre: (e?.nombre as string) ?? "tu empresa", esCliente };
}

/**
 * A qué empresa se le imputa lo que gaste esta sesión.
 *
 * Para los lectores de imagen (flanco, etiqueta, parte, parte de proveedor)
 * no hay otro contexto que la sesión: la petición es una foto y nada más. Así
 * que el gasto se imputa a la empresa del usuario que pulsa.
 *
 * Matiz que conviene tener escrito: cuando el que lee la foto es un OPERADOR
 * de taller que trabaja para varios clientes, el gasto cae en SU empresa, no
 * en la del cliente cuyo neumático está mirando. Para repartirlo de otra
 * forma habría que mandar el contexto del cliente desde el APK, y eso no es
 * esta fase. Donde el registro sí dice de quién es —la ficha técnica de un
 * vehículo, el resumen de la ficha— la empresa se saca del registro y es
 * exacta.
 *
 * Nunca lanza y nunca inventa una empresa: si no se puede resolver devuelve
 * null y la llamada se apunta sin empresa (y por tanto sin tope por cliente).
 */
export async function empresaDeSesion(userId: string | undefined | null): Promise<string | null> {
  if (!userId) return null;
  try {
    return (await resolverAlcance(userId))?.empresaId ?? null;
  } catch {
    return null;
  }
}
