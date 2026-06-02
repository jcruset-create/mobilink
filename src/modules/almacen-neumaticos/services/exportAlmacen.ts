export type FilaExportacion = Record<string, unknown>;

function escaparCsv(valor: unknown) {
  if (valor === null || valor === undefined) return "";

  const texto =
    typeof valor === "object" ? JSON.stringify(valor) : String(valor);

  return `"${texto.replace(/"/g, '""')}"`;
}

function descargarArchivo(
  nombreArchivo: string,
  contenido: BlobPart,
  tipo: string
) {
  const blob = new Blob([contenido], {
    type: tipo,
  });

  const url = URL.createObjectURL(blob);
  const enlace = document.createElement("a");

  enlace.href = url;
  enlace.download = nombreArchivo;
  enlace.click();

  URL.revokeObjectURL(url);
}

function fechaArchivo() {
  return new Date().toISOString().slice(0, 10);
}

export function exportarCsv(nombreBase: string, filas: FilaExportacion[]) {
  if (filas.length === 0) return;

  const cabeceras = Object.keys(filas[0]);

  const csv = [
    cabeceras.map(escaparCsv).join(";"),
    ...filas.map((fila) =>
      cabeceras.map((cabecera) => escaparCsv(fila[cabecera])).join(";")
    ),
  ].join("\n");

  descargarArchivo(
    `${nombreBase}-${fechaArchivo()}.csv`,
    csv,
    "text/csv;charset=utf-8;"
  );
}

export async function exportarExcel(
  nombreBase: string,
  nombreHoja: string,
  filas: FilaExportacion[]
) {
  if (filas.length === 0) return;

  const XLSX = await import("xlsx");

  const hoja = XLSX.utils.json_to_sheet(filas);
  const libro = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(libro, hoja, nombreHoja);

  const contenido = XLSX.write(libro, {
    bookType: "xlsx",
    type: "array",
  });

  descargarArchivo(
    `${nombreBase}-${fechaArchivo()}.xlsx`,
    contenido,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
}