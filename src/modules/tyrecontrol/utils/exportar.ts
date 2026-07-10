// Exportación de tablas a CSV (sin dependencias). La exportación a Excel y
// PDF con diseño se añadirá en fases posteriores del módulo de Informes.

function escapar(v: string | number | null | undefined): string {
  const s = v == null ? "" : String(v);
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function descargarCSV(nombre: string, cabeceras: string[], filas: (string | number | null | undefined)[][]): void {
  const sep = ";"; // Excel en configuración regional ES usa ';'
  const lineas = [cabeceras, ...filas].map((f) => f.map(escapar).join(sep));
  const contenido = "﻿" + lineas.join("\r\n"); // BOM para acentos en Excel
  const blob = new Blob([contenido], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre.endsWith(".csv") ? nombre : `${nombre}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
