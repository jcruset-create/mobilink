/**
 * ¿Es este registro «histórico de albarán importado»?
 *
 * EL criterio, el único, para panel, informes y PDF: el vínculo con la
 * importación del histórico (`importacion_lote_id`, clave ajena a
 * tc_importacion_lotes). Ni `source = 'import'` —lo usan otras importaciones
 * (vehículos, revisiones, CheckPoint)— ni «tiene referencia de origen» valen
 * por sí solos. Si se cambia el criterio, se cambia aquí y en ningún otro
 * sitio.
 *
 * Compartido entre el panel (src/) y el servidor (server/), que es donde se
 * arma el PDF: los dos tienen que decidir lo mismo.
 */
export interface ConVinculoImportacion {
  importacion_lote_id?: string | null;
}

export function esHistoricoAlbaran(x: ConVinculoImportacion | null | undefined): boolean {
  return !!x?.importacion_lote_id;
}

/** Cómo se enseña: «Histórico importado · albarán B2_26/4905 (genes)». */
export function etiquetaHistorico(x: { origen_doc?: string | null; origen_sistema?: string | null } | null | undefined): string {
  const doc = (x?.origen_doc ?? "").split("|")[0];
  const sis = x?.origen_sistema ? ` (${x.origen_sistema})` : "";
  return doc ? `Histórico importado · albarán ${doc}${sis}` : `Histórico importado${sis}`;
}

/** Cómo se nombra un neumático histórico, que no tiene ficha: «Hankook AH51 156L 315/80R22.5 · nueva». */
export function textoNeumaticoHistorico(o: {
  marca_txt?: string | null; modelo_txt?: string | null; medida_txt?: string | null;
  condicion?: string | null;
} | null | undefined): string {
  if (!o) return "—";
  const ref = [o.marca_txt, o.modelo_txt, o.medida_txt].map((x) => (x ?? "").trim()).filter(Boolean).join(" ");
  const cond = o.condicion ? ` · ${o.condicion}` : "";
  return (ref || "sin referencia") + cond;
}

/** La posición con su procedencia: «E1_IZQ (deducida)», «—» si no se sabe. */
export function textoPosicionHistorica(codigo: string | null | undefined, fuente: string | null | undefined): string {
  if (!codigo) return fuente === "desconocida" ? "— (desconocida)" : "";
  return fuente === "deducida" ? `${codigo} (deducida)` : codigo;
}

/**
 * Cómo se nombra la goma que SALIÓ en una sustitución histórica.
 *
 * El hecho del desmontaje es cierto —cada montaje sustituye al ocupante de
 * esa posición— pero la identidad casi nunca consta. No se inventa: se dice.
 */
export function textoRetirado(o: {
  identidad_retirado?: string | null;
  neumatico?: { numero_interno?: string | null; codigo_interno?: string | null } | null;
} | null | undefined): string {
  const n = o?.neumatico?.numero_interno ?? o?.neumatico?.codigo_interno ?? null;
  if (o?.identidad_retirado === "respaldada" && n) return `${n} (identificada)`;
  if (o?.identidad_retirado === "reconstruida" && n) return `${n} (reconstruida)`;
  return "no consta cuál salió";
}
