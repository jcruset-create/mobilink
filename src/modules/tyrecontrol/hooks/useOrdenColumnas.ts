/**
 * Ordenar una lista tocando la cabecera de «Matrícula» o «Nº unidad».
 *
 * El mismo comportamiento en todas las listas de TyreControl:
 *   1.er toque → de mayor a menor (▼)
 *   2.º toque  → de menor a mayor (▲)
 *   3.er toque → como venía la lista (↕)
 * Una sola columna a la vez: tocar otra empieza de cero. Los números se
 * ordenan como números («987» antes que «1305») y lo vacío («—», sin
 * vehículo, sin número) va siempre al final.
 *
 * Uso:
 *   const orden = useOrdenColumnas(filas, { matricula: (f) => f.matricula, unidad: (f) => f.numeroUnidad });
 *   <th><CabeceraOrden col="matricula" orden={orden}>Matrícula</CabeceraOrden></th>
 *   {orden.filas.map(...)}
 */
import { useState } from "react";
import { ordenarPorTexto, siguienteSentido, type SentidoUnidad } from "../services/ordenPendientes";

export type ColumnaOrden = "matricula" | "unidad";
type Clave<T> = (f: T) => string | number | null | undefined;

export interface OrdenColumnas<T> {
  filas: T[];
  col: ColumnaOrden | null;
  sentido: SentidoUnidad;
  tocar: (col: ColumnaOrden) => void;
}

const texto = (v: string | number | null | undefined) => {
  const t = v == null ? "" : String(v).trim();
  return t === "—" || t === "-" ? "" : t;
};

export function useOrdenColumnas<T>(filas: T[], claves: Partial<Record<ColumnaOrden, Clave<T>>>): OrdenColumnas<T> {
  const [estado, setEstado] = useState<{ col: ColumnaOrden | null; sentido: SentidoUnidad }>({ col: null, sentido: null });
  const clave = estado.col ? claves[estado.col] : undefined;
  // Sin memo a propósito: las listas son de cientos de filas y las claves
  // suelen ser funciones nuevas en cada render; ordenar es más barato que
  // equivocarse con una dependencia.
  const vistas = clave && estado.sentido ? ordenarPorTexto(filas, estado.sentido, (f) => texto(clave(f))) : filas;
  return {
    filas: vistas,
    col: estado.col,
    sentido: estado.sentido,
    tocar: (col) => setEstado((e) => ({ col, sentido: siguienteSentido(e.col === col ? e.sentido : null) })),
  };
}

