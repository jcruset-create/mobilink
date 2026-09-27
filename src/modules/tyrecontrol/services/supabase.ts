/**
 * Reexporta el cliente Supabase compartido.
 *
 * Aquí había un `createClient` propio. Eran tres, uno por módulo, sobre el
 * mismo proyecto y la misma clave de almacenamiento: tres `GoTrueClient`
 * rotando el mismo refresh token, con la pérdida de sesión que eso provoca
 * («Invalid Refresh Token»). El motivo completo está en
 * `src/services/supabaseCliente.ts`.
 *
 * El fichero se mantiene —en vez de reescribir los 80 imports que apuntan
 * aquí— para no cambiar el contrato público sin necesidad. `import { supabase }
 * from ".../tyrecontrol/services/supabase"` sigue funcionando igual; lo que
 * devuelve es ahora la instancia única.
 */
export { supabase } from "../../../services/supabaseCliente";
