/**
 * La bandeja a Excel.
 *
 * Mismas filas y mismos filtros que la pantalla: lo que se exporta es lo que
 * se está viendo, no «todo». Una exportación que ignora los filtros acaba
 * abriéndose en Excel para volver a filtrar a mano lo que ya estaba filtrado.
 *
 * `filasParaExcel` es pura y tiene su prueba; lo único que sabe de Excel es la
 * función de abajo, que usa `xlsx` como `tacografos/export.ts`.
 */

import * as XLSX from "xlsx";
import type { FilaBandeja } from "./service.ts";

const CABECERA = [
  "Expediente",
  "Fecha",
  "Sociedad",
  "Tipo",
  "Proveedor",
  "Factura",
  "Importe (€)",
  "Actuaciones",
  "Reclamaciones",
  "Días abierto",
  "Prioridad",
  "Estado",
  "Asignado",
  "Requiere revisión",
];

/** Céntimos con signo → número con dos decimales, para que Excel lo sume. */
function euros(centimos: number | null): number | "" {
  return centimos === null ? "" : Math.round(centimos) / 100;
}

function fecha(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("es-ES");
}

/** Una fila por expediente, con las actuaciones resumidas en una celda. */
export function filasParaExcel(expedientes: readonly FilaBandeja[]): (string | number)[][] {
  return [
    CABECERA,
    ...expedientes.map((e) => [
      e.numero,
      fecha(e.fechaPrimeraNotificacion),
      [e.empresaCodigo, e.empresaNombre].filter(Boolean).join(" "),
      e.tipo,
      e.proveedorNombre ?? "",
      e.facturaNumero ?? "",
      euros(e.importeCentimos),
      e.actuaciones
        .map((a) => `${a.accionTexto ?? a.tipoAccion}${a.albaranSolicitado ? ` ${a.albaranSolicitado}` : ""}`)
        .join(" · "),
      e.numeroReclamaciones,
      e.diasAbierto,
      e.prioridad,
      e.estado,
      e.asignadoUsuarioId ?? "",
      e.requiereRevision ? "Sí" : "No",
    ]),
  ];
}

export function componerXlsx(expedientes: readonly FilaBandeja[]): Buffer {
  const hoja = XLSX.utils.aoa_to_sheet(filasParaExcel(expedientes));
  hoja["!cols"] = CABECERA.map((c, i) => ({ wch: i === 7 ? 40 : Math.max(12, c.length + 2) }));
  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, hoja, "Expedientes");
  return XLSX.write(libro, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

export function nombreFichero(ahora = new Date()): string {
  return `therefore-expedientes-${ahora.toISOString().slice(0, 10)}.xlsx`;
}
