/**
 * La matrícula de la foto manda.
 *
 * En la OTF la oficina escribe la matrícula al planificar, a veces a ciegas
 * («XXXXSM», «remolque plaza 27») o con una errata. El operario fotografía la
 * placa al llegar y la IA la lee: lo que se ve en la placa es el vehículo en
 * que se ha trabajado, así que esa matrícula sustituye a la del trabajo, en la
 * pantalla, en el informe y en el montaje de TyreControl (que se registra al
 * cerrar el trabajo, con la matrícula que haya entonces).
 *
 * La que puso la oficina no se pierde: queda en «platePlanificada», la
 * primera vez, para poder ver qué se había planificado.
 */

export type MatriculasTrabajo = {
  plate: string | null;
  plateRemolque: string | null;
  platePlanificada: string | null;
};

export type Sustitucion = {
  /** La matrícula que queda en el trabajo. */
  plate: string;
  /** La que había planificado la oficina (la primera, si se cambia dos veces). */
  platePlanificada: string | null;
};

/**
 * Qué hacer con la matrícula leída. null si no hay nada que cambiar: no se
 * leyó, o coincide con la del trabajo o con la de su remolque.
 */
export function sustitucionPorFoto(
  leida: string | null | undefined,
  t: MatriculasTrabajo,
  normalizar: (v: unknown) => string,
): Sustitucion | null {
  const l = normalizar(leida);
  if (!l || l.length < 4) return null;
  const actuales = [t.plate, t.plateRemolque].map(normalizar).filter(Boolean);
  if (actuales.includes(l)) return null;
  return { plate: l, platePlanificada: t.platePlanificada || t.plate || null };
}
