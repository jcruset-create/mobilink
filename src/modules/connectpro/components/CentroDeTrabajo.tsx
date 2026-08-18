/**
 * Connect Pro — sobre qué central se está configurando.
 *
 * Hay una asimetría deliberada en el backoffice: en los LISTADOS, el
 * superadministrador no tiene centro y eso significa «los ve todos». Pero
 * configurar no es listar. No existe «publicar la tarifa de todas las
 * centrales a la vez», ni «aplicar esta plantilla a todas», así que las
 * pantallas de configuración necesitan una central concreta y el
 * superadministrador es justo quien no la tiene.
 *
 * Esto es lo que la pone. Para cualquier otro rol el backend ya sabe cuál es
 * por su usuario, así que el selector se queda con un solo elemento y no se
 * pinta: nadie tiene que elegir lo que no puede cambiar.
 *
 * La elección se recuerda en `localStorage` porque configurar una central son
 * cinco pantallas —tarifario, contratos, neumáticos, festivos, cierre— y
 * volver a elegirla en cada una es la clase de fricción que acaba en
 * configurar la central equivocada.
 */

import { useCallback, useEffect, useState } from "react";
import { boFetch } from "../services/api";
import { useConnectAuth } from "../contexts/ConnectAuthContext";
import { Select } from "./ui";

export type Central = { id: number; name: string };

const CLAVE = "connectpro.centroDeTrabajo";

export type CentroDeTrabajo = {
  /** La central sobre la que se opera, o null mientras no se sepa cuál. */
  centro: number | null;
  centrales: Central[];
  elegir: (id: number) => void;
  /** Ya se sabe si hace falta elegir o no; hasta entonces no se pide nada. */
  listo: boolean;
  /** Hay varias y aún no se ha elegido ninguna. */
  faltaElegir: boolean;
};

export function useCentroDeTrabajo(): CentroDeTrabajo {
  const { user, controlCenter } = useConnectAuth();
  const [centrales, setCentrales] = useState<Central[]>([]);
  const [elegido, setElegido] = useState<number | null>(null);
  const [listo, setListo] = useState(false);

  useEffect(() => {
    if (!user) return;

    // Quien tiene centro propio no elige: el backend lo impone igualmente.
    if (controlCenter) {
      setCentrales([controlCenter]);
      setElegido(controlCenter.id);
      setListo(true);
      return;
    }

    boFetch<{ data: Central[] }>("/setup/control-centers")
      .then((r) => {
        setCentrales(r.data);
        const guardado = Number(localStorage.getItem(CLAVE));
        // Solo se recupera si la central sigue existiendo: una guardada que ya
        // no está daría un 404 raro en cada pantalla en vez de pedir otra.
        const valida = r.data.some((c) => c.id === guardado) ? guardado : null;
        setElegido(valida ?? (r.data.length === 1 ? r.data[0].id : null));
      })
      .catch(() => setCentrales([]))
      .finally(() => setListo(true));
  }, [user, controlCenter]);

  const elegir = useCallback((id: number) => {
    setElegido(id);
    localStorage.setItem(CLAVE, String(id));
  }, []);

  return {
    centro: elegido,
    centrales,
    elegir,
    listo,
    faltaElegir: listo && elegido == null && centrales.length > 1,
  };
}

/**
 * El selector. Con una sola central no se pinta nada: enseñar un desplegable
 * de un elemento solo consigue que parezca que hay algo que decidir.
 */
export function SelectorCentro({ ctx }: { ctx: CentroDeTrabajo }) {
  if (!ctx.listo || ctx.centrales.length <= 1) return null;

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <span className="text-xs text-slate-500">Central que se está configurando</span>
      <Select
        value={ctx.centro ?? ""}
        onChange={(e) => ctx.elegir(Number(e.target.value))}
      >
        <option value="" disabled>Elige una central…</option>
        {ctx.centrales.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </Select>
    </div>
  );
}

/**
 * Lo que se enseña en lugar del contenido mientras no hay central elegida.
 * Es un aviso, no un error: no ha fallado nada, falta un dato.
 */
export function AvisoElegirCentro() {
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900/40 px-3 py-2 text-[13px] text-slate-400">
      Elige arriba sobre qué central quieres trabajar.
    </div>
  );
}
