/**
 * De fila de Postgres a objeto de la aplicación.
 *
 * `pg` devuelve los `BIGINT` como **cadena**. Si no se convierten aquí, un
 * `id` llega al navegador como "1700000000000" y todas las comparaciones con
 * `===` fallan en silencio: el trabajo no se encuentra, la recepción no se
 * marca, y nadie ve un error. Hay un test que fija este comportamiento.
 */

export type FilaRecepcion = Record<string, any>;

function aNumero(valor: unknown): number | null {
  if (valor == null || valor === "") return null;
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
}

function aLista(valor: unknown): any[] {
  if (Array.isArray(valor)) return valor;
  if (typeof valor === "string" && valor.trim() !== "") {
    try {
      const parsed = JSON.parse(valor);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

export function normalizeRecepcionRow(fila: FilaRecepcion) {
  return {
    id: aNumero(fila.id) ?? 0,
    workshopId: fila.workshopId ?? null,
    matricula: String(fila.matricula ?? ""),
    matriculaNormal: String(fila.matriculaNormal ?? ""),
    matriculaOcr: fila.matriculaOcr ?? null,
    confianzaOcr: aNumero(fila.confianzaOcr),
    clienteNombre: fila.clienteNombre ?? null,
    kilometros: aNumero(fila.kilometros),
    kilometrosOcr: aNumero(fila.kilometrosOcr),
    confianzaKilometrosOcr: aNumero(fila.confianzaKilometrosOcr),
    vehiculoId: fila.vehiculoId ?? null,
    vehiculoOrigen: fila.vehiculoOrigen ?? null,
    area: fila.area ?? null,
    plantillaKey: fila.plantillaKey ?? null,
    operacionLabel: fila.operacionLabel ?? null,
    notas: fila.notas ?? null,
    urgente: fila.urgente === true || fila.urgente === "true",
    fotos: aLista(fila.fotos),
    estado: String(fila.estado ?? "pendiente"),
    operarioNombre: String(fila.operarioNombre ?? ""),
    creadaAtMs: aNumero(fila.creadaAtMs) ?? 0,
    resueltaAtMs: aNumero(fila.resueltaAtMs),
    resueltaPor: fila.resueltaPor ?? null,
    motivoDescarte: fila.motivoDescarte ?? null,
    jobId: aNumero(fila.jobId),
  };
}
