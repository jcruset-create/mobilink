/**
 * Deja solo el ejemplar del cliente en los informes que YA estaban adjuntos.
 *
 * Los informes subidos antes de que el adjunto se recortara (ver
 * `ejemplarCliente.ts`) siguen guardados enteros, con el ejemplar del taller
 * dentro. Esto los pasa uno a uno por el mismo recorte.
 *
 * ── El orden, que es lo que importa ─────────────────────────────────────────
 *
 * Por cada informe:
 *
 *   1. Se sube el recortado a una ruta NUEVA.
 *   2. Se apunta el documento a esa ruta.
 *   3. Se borra el fichero antiguo.
 *
 * Así nunca hay un clip que no abre nada: si falla el paso 2 se retira el
 * fichero nuevo y el informe sigue como estaba; si falla el 3, el informe ya
 * enseña el recortado y el antiguo queda suelto en el almacén, sin enlazar, y
 * se dice para que alguien lo quite.
 *
 * El paso 3 no tiene vuelta atrás: el fichero entero deja de existir. Por eso
 * la tarea se puede SIMULAR, y por eso lo que no se recorta con seguridad no
 * se toca.
 *
 * La entrada y la salida van inyectadas para poder probar el orden sin
 * almacén ni base de datos.
 */
import { decidirRecorte } from "./ejemplarCliente.ts";
import { copiasDelInforme, lineasDeInforme, ordenDeLaCopia } from "./informePdf.ts";

export interface AdjuntoGuardado {
  id: string;
  ruta: string;
  nombre: string;
  /** El «A1» de su intervención, si el documento sigue enlazado a una. */
  idOrigen: string | null;
  matricula: string | null;
}

export interface Almacen {
  listar(): Promise<AdjuntoGuardado[]>;
  descargar(ruta: string): Promise<Buffer>;
  subir(ruta: string, pdf: Buffer): Promise<void>;
  apuntar(id: string, cambios: { ruta: string; paginas: number; bytes: number }): Promise<void>;
  borrar(ruta: string): Promise<void>;
}

export type AccionRecorte = "recortado" | "se_recortaria" | "ya_estaba" | "no_se_puede";

export interface ResultadoRecorte {
  id: string;
  nombre: string;
  idOrigen: string | null;
  matricula: string | null;
  accion: AccionRecorte;
  motivo?: string;
  paginas?: number;
  bytesAntes?: number;
  bytesDespues?: number;
  aviso?: string;
}

/** `…/E94-1700000000000.pdf` → `…/E94-1700000000000-cliente.pdf`. */
export function rutaDelRecortado(ruta: string): string {
  return /\.pdf$/i.test(ruta) ? ruta.replace(/\.pdf$/i, "-cliente.pdf") : `${ruta}-cliente.pdf`;
}

export async function recortarAdjuntos(almacen: Almacen, simular: boolean): Promise<ResultadoRecorte[]> {
  const resultados: ResultadoRecorte[] = [];
  for (const doc of await almacen.listar()) {
    const base = { id: doc.id, nombre: doc.nombre, idOrigen: doc.idOrigen, matricula: doc.matricula };
    try {
      const pdf = await almacen.descargar(doc.ruta);
      const lineas = await lineasDeInforme(pdf);

      // Sin intervención enlazada, vale el número de orden del propio PDF,
      // pero solo si trae una: con varias no se sabe cuál es la suya.
      let idOrigen = doc.idOrigen;
      if (!idOrigen) {
        const ordenes = new Set(copiasDelInforme(lineas).map(ordenDeLaCopia).filter(Boolean) as string[]);
        idOrigen = ordenes.size === 1 ? [...ordenes][0] : null;
      }
      if (!idOrigen) {
        resultados.push({ ...base, accion: "no_se_puede", motivo: "No se sabe de qué intervención es este PDF." });
        continue;
      }

      const d = await decidirRecorte(pdf, lineas, idOrigen);
      if (d.estado === "ya_estaba") { resultados.push({ ...base, idOrigen, accion: "ya_estaba" }); continue; }
      if (d.estado === "no_se_puede") { resultados.push({ ...base, idOrigen, accion: "no_se_puede", motivo: d.motivo }); continue; }

      const cifras = { paginas: d.paginas, bytesAntes: pdf.length, bytesDespues: d.pdf.length };
      if (simular) { resultados.push({ ...base, idOrigen, accion: "se_recortaria", ...cifras }); continue; }

      const nueva = rutaDelRecortado(doc.ruta);
      await almacen.subir(nueva, d.pdf);
      try {
        await almacen.apuntar(doc.id, { ruta: nueva, paginas: d.paginas, bytes: d.pdf.length });
      } catch (e) {
        // El informe sigue apuntando al entero: se retira el nuevo y no ha pasado nada.
        await almacen.borrar(nueva).catch(() => undefined);
        throw e;
      }
      let aviso: string | undefined;
      try {
        await almacen.borrar(doc.ruta);
      } catch {
        aviso = "El informe ya enseña el recortado, pero el fichero antiguo no se ha podido borrar del almacén.";
      }
      resultados.push({ ...base, idOrigen, accion: "recortado", ...cifras, ...(aviso ? { aviso } : {}) });
    } catch (e) {
      resultados.push({ ...base, accion: "no_se_puede", motivo: e instanceof Error ? e.message : String(e) });
    }
  }
  return resultados;
}
