import { useEffect, useState } from "react";
import { Bell } from "lucide-react";
import { Link } from "react-router-dom";
import {
  listarAlertasPresionAbiertas, listarAlertasWebfleet,
  marcarAlertaLeida, marcarAlertasLeidas,
} from "../services/data";
import {
  avisoDeBase, avisoDePresion, cuantosSeMarcan, ordenarAvisos, type AvisoCampana,
} from "../services/campana";
import { fechaYHoraCorta } from "../services/alertasPresion";

/**
 * La campana del panel. Enseña dos clases de aviso que no se comportan igual.
 *
 *   · entradas en base con revisión pendiente (`tc_webfleet_alertas`), que se
 *     marcan como leídas y desaparecen;
 *   · avisos de presión de Goodyear (`tc_alertas_presion`), que NO.
 *
 * El porqué de esa diferencia está en `services/campana.ts`, que es donde
 * vive la decisión y donde se prueba. El resumen: quitar un aviso de presión
 * de la vista no infla la rueda, así que desde aquí se mira y se va al
 * vehículo; se cierra donde cerrarlo significa algo.
 *
 * Se llamaba `AlertasWebfleet` y se ha renombrado: el nombre viejo describía
 * una de las dos fuentes y habría hecho pensar que la otra no está.
 */
export default function CampanaAvisos() {
  const [avisos, setAvisos] = useState<AvisoCampana[]>([]);
  const [abierto, setAbierto] = useState(false);

  /**
   * Las dos fuentes, por separado y tolerando que una falle: que no se puedan
   * leer los avisos de presión no puede dejar sin ver los de base, ni al revés.
   */
  async function leerLasDos(): Promise<AvisoCampana[]> {
    const [base, presion] = await Promise.all([
      listarAlertasWebfleet(true, 30).catch(() => []),
      listarAlertasPresionAbiertas(30).catch(() => []),
    ]);
    return ordenarAvisos([
      ...base.map(avisoDeBase),
      ...presion.map((a) => avisoDePresion(a, a.vehiculo?.matricula)),
    ]);
  }

  useEffect(() => {
    // `vivo` evita escribir estado sobre un componente ya desmontado: la
    // consulta tarda y la campana se desmonta al cambiar de módulo.
    let vivo = true;
    const refrescar = () => { void leerLasDos().then((a) => { if (vivo) setAvisos(a); }); };
    refrescar();
    const t = setInterval(refrescar, 60000); // cada minuto
    return () => { vivo = false; clearInterval(t); };
  }, []);

  async function leerUno(a: AvisoCampana) {
    if (!a.sePuedeMarcarLeido) return;
    await marcarAlertaLeida(a.id);
    setAvisos((prev) => prev.filter((x) => x.clave !== a.clave));
  }

  async function leerTodas() {
    await marcarAlertasLeidas();
    // Solo se van los de base. Los de presión siguen ahí, que es el sentido de
    // todo esto: siguen abiertos.
    setAvisos((prev) => prev.filter((x) => !x.sePuedeMarcarLeido));
  }

  const n = avisos.length;
  const marcables = cuantosSeMarcan(avisos);

  return (
    <div className="relative">
      <button
        onClick={() => { setAbierto((v) => !v); if (!abierto) void leerLasDos().then(setAvisos); }}
        className="relative rounded-lg p-1.5 hover:bg-slate-800"
        title="Avisos"
      >
        <Bell className="h-5 w-5 text-slate-200" />
        {n > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">
            {n > 9 ? "9+" : n}
          </span>
        )}
      </button>

      {abierto && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setAbierto(false)} />
          <div className="absolute right-0 z-40 mt-2 w-96 rounded-xl border border-slate-700 bg-slate-900 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-700 px-3 py-2">
              <span className="text-[12px] font-bold text-slate-200">Avisos {n > 0 ? `(${n})` : ""}</span>
              {marcables > 0 && (
                <button onClick={leerTodas} className="text-[11px] text-sky-300 hover:underline">
                  Marcar {marcables} leídas
                </button>
              )}
            </div>

            <div className="max-h-96 overflow-auto">
              {n === 0 ? (
                <div className="px-3 py-6 text-center text-[12px] text-slate-500">Sin avisos nuevos.</div>
              ) : (
                avisos.map((a) => (
                  <div key={a.clave} className="flex items-start gap-2 border-b border-slate-800 px-3 py-2 last:border-0">
                    <div
                      className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${a.origen === "presion" ? "bg-rose-500" : "bg-amber-400"}`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-[12px] text-slate-200">{a.texto}</div>
                      {a.detalle && <div className="mt-0.5 text-[11px] text-slate-400">{a.detalle}</div>}
                      <div className="mt-0.5 flex items-center gap-2">
                        {a.instante && (
                          <span className="text-[10px] text-slate-500">{fechaYHoraCorta(a.instante)}</span>
                        )}
                        {a.vehiculoId && (
                          <Link
                            to={`/tyrecontrol/vehiculos/${a.vehiculoId}`}
                            onClick={() => setAbierto(false)}
                            className="text-[10px] text-sky-300 hover:underline"
                          >
                            Ver vehículo
                          </Link>
                        )}
                      </div>
                    </div>

                    {a.sePuedeMarcarLeido ? (
                      <button
                        onClick={() => void leerUno(a)}
                        className="shrink-0 text-[11px] text-slate-400 hover:text-slate-200"
                        title="Marcar leída"
                      >
                        ✓
                      </button>
                    ) : (
                      // A propósito no hay ✓: ver `services/campana.ts`.
                      <span
                        className="shrink-0 text-[10px] text-slate-500"
                        title="Un aviso de presión se cierra en la ficha del vehículo, cuando la rueda está arreglada"
                      >
                        abierto
                      </span>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
