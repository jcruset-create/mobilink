/**
 * Qué rol del panel de taller tiene quien entra con su usuario de Core.
 *
 * ── El fallo que arregla ────────────────────────────────────────────────────
 *
 * El panel (Operativo 2, Agenda…) buscaba un usuario del panel con el mismo
 * nombre que el de Core. «Albert» en el panel y «albert.belles» / «Albert
 * Belles Bertran» en Core no coincidían, así que dentro de WorkPlanner salía
 * el login antiguo pidiendo otra contraseña, la del panel, que no era la suya.
 *
 * ── La regla, de más a menos concreta ───────────────────────────────────────
 *
 *  1. Superadministrador o admin de Administración → admin.
 *  2. Usuario del panel con el mismo usuario o nombre completo (como siempre).
 *  3. Usuario del panel con el nombre del TÉCNICO vinculado a su ficha de Core
 *     (app_usuarios.employee_id = techs.employee_id). Es el vínculo que se
 *     confirma en Personal → «Vincular con Core».
 *  4. Tiene el módulo WorkPlanner en Core → supervisor, con las pantallas que
 *     le marcaron allí. Ya se le dio acceso a WorkPlanner: no se le pide otra
 *     contraseña para lo mismo. Las pantallas de administrador siguen siendo
 *     solo de administradores.
 *
 * En 2 y 3, si además tiene el módulo WorkPlanner, las pantallas marcadas en
 * Core SE SUMAN a las del usuario del panel. Si no, pasaba esto: a Neus le
 * marcaban «Agenda» en Administración → Usuarios y la agenda le decía que no
 * tenía permiso, porque mandaba la lista vieja del usuario del panel. Lo que
 * se marca en Core tiene que verse en la pantalla.
 *
 * Login (`/api/login-sso`) y servidor (`getRoleFromRequestAsync`) usan esta
 * misma función: si discrepan, la pantalla deja pasar y luego todo da 403.
 */

export type RolDelPanel = "admin" | "supervisor" | "pantallas" | "tv75";

export type UsuarioDelPanel = {
  name: string;
  role: RolDelPanel;
  allowedViews?: string[] | null;
};

export type DatosDeSesion = {
  username: string | null;
  nombre: string | null;
  esSuperadmin: boolean;
  admAdmin: boolean;
  /** Técnico vinculado a su ficha de Core, si lo hay. */
  techName: string | null;
  /** null = no tiene el módulo WorkPlanner; [] o lista = lo tiene. */
  workplanner: { pantallas: string[] | null } | null;
};

export type RolResuelto = {
  role: RolDelPanel;
  name: string;
  allowedViews: string[] | null;
  via: "superadmin" | "nombre" | "tecnico" | "workplanner";
};

/** Pantallas del módulo WorkPlanner (Core) → vistas del panel. */
const VISTAS_POR_PANTALLA: Record<string, string[]> = {
  operativo2: ["operativo2"],
  agenda: ["agenda2", "agenda"],
  tecnicos: ["operarios"],
  personal: ["tecnicos"],
};

export function vistasDeWorkplanner(pantallas: string[] | null | undefined): string[] | null {
  // Sin lista, todas las del rol: es lo que significa «null» en Core.
  if (!pantallas || pantallas.length === 0) return null;
  const vistas = new Set<string>();
  for (const p of pantallas) for (const v of VISTAS_POR_PANTALLA[p] ?? []) vistas.add(v);
  // Ninguna del panel (solo Partes, Plantillas…): Operativo 2 igualmente, que
  // es donde aterriza WorkPlanner. Una lista vacía significaría «todas».
  if (vistas.size === 0) vistas.add("operativo2");
  return [...vistas];
}

/** Vistas del usuario del panel más las que le dan en Core. null = todas. */
function sumarVistas(
  delPanel: string[] | null | undefined,
  workplanner: DatosDeSesion["workplanner"]
): string[] | null {
  const base = delPanel?.length ? delPanel : null;
  if (!workplanner) return base;
  const deCore = vistasDeWorkplanner(workplanner.pantallas);
  // Cualquiera de los dos sin lista = todas.
  if (!base || !deCore) return null;
  return [...new Set([...base, ...deCore])];
}

const igual = (a: unknown, b: unknown) =>
  String(a ?? "").trim().toLowerCase() !== "" &&
  String(a ?? "").trim().toLowerCase() === String(b ?? "").trim().toLowerCase();

export function resolverRolDelPanel(
  datos: DatosDeSesion,
  usuariosDelPanel: UsuarioDelPanel[]
): RolResuelto | null {
  const nombre = String(datos.nombre || datos.username || "").trim();

  if (datos.esSuperadmin || datos.admAdmin) {
    return { role: "admin", name: nombre, allowedViews: null, via: "superadmin" };
  }

  const porNombre = usuariosDelPanel.find(
    (p) => igual(p.name, datos.username) || igual(p.name, datos.nombre)
  );
  if (porNombre) {
    return {
      role: porNombre.role,
      name: porNombre.name,
      allowedViews: sumarVistas(porNombre.allowedViews, datos.workplanner),
      via: "nombre",
    };
  }

  if (datos.techName) {
    const porTecnico = usuariosDelPanel.find((p) => igual(p.name, datos.techName));
    if (porTecnico) {
      return {
        role: porTecnico.role,
        name: porTecnico.name,
        allowedViews: sumarVistas(porTecnico.allowedViews, datos.workplanner),
        via: "tecnico",
      };
    }
  }

  if (datos.workplanner) {
    return {
      role: "supervisor",
      name: String(datos.techName || nombre),
      allowedViews: vistasDeWorkplanner(datos.workplanner.pantallas),
      via: "workplanner",
    };
  }

  return null;
}
