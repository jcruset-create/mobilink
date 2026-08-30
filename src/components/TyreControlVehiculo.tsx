/**
 * Lo que TyreControl sabe de un vehículo, para enseñarlo dentro de Assist.
 *
 * Se usa en dos sitios con densidades distintas —la ficha de asistencia quiere
 * un resumen de una línea; la OTF quiere ver las ruedas— así que el mismo
 * componente admite `modo="resumen"` y `modo="completo"`.
 *
 * ── Tres cosas que no se hacen aquí, a propósito ────────────────────────────
 *
 *  1. **No se funden las dos profundidades.** TyreControl tiene la que
 *     mantiene como actual en el neumático y la que se midió en la última
 *     revisión. Pueden diferir, y enseñar «la profundidad» inventaría un dato
 *     y escondería justo la discrepancia que interesa.
 *  2. **La presión no se llama «actual».** TC no guarda presión actual: solo
 *     la de una revisión, con su fecha. Se dice así.
 *  3. **No se escribe nada.** Esta fase es de lectura. No hay ningún botón que
 *     toque TyreControl.
 */

import { useEffect, useState } from "react";

import { API_BASE, getAdminHeaders } from "../modules/workshopApi";

type Neumatico = {
  marca: string | null; modelo: string | null; medida: string | null; dot: string | null;
  estado: string; profundidadActualMm: number | null;
};

type Revision = {
  fecha: string | null; profundidadMm: number | null; ultimaPresionBar: number | null;
  estadoVisual: string | null; alertaGenerada: boolean; neumaticoAusente: boolean;
};

type Posicion = {
  posicionId: string; codigoPosicion: string; nombre: string | null;
  eje: number | null; lado: string | null; interiorExterior: string | null;
  montajeActualId: string | null; neumatico: Neumatico | null;
  fechaMontaje: string | null; kmMontaje: number | null; ultimaRevision: Revision | null;
};

type Vehiculo = {
  tcVehicleId: string; matricula: string; marca: string | null; modelo: string | null;
  tipoVehiculo: string | null; kmActual: number | null;
  empresaId: string; empresaNombre: string | null; activo: boolean;
};

type Estado = {
  estado: "FOUND" | "NOT_FOUND" | "AMBIGUOUS" | "ERROR";
  vehiculo?: Vehiculo;
  ejes?: { eje: number; ruedas: number | null; medida: string | null }[];
  posiciones?: Posicion[];
  resumen?: {
    posiciones: number; montados: number; alertas: number;
    profundidadMinimaMm: number | null; ultimaRevisionFecha: string | null;
  };
  candidatos?: Vehiculo[];
  error?: string;
};

function fecha(v: string | null | undefined): string {
  if (!v) return "";
  const d = new Date(v);
  return isNaN(d.getTime()) ? String(v) : d.toLocaleDateString("es-ES");
}

/** Verde por encima de 5 mm, ámbar de 3 a 5, rojo por debajo. */
function tonoProfundidad(mm: number | null): string {
  if (mm == null) return "text-slate-500";
  if (mm < 3) return "text-red-300";
  if (mm < 5) return "text-amber-300";
  return "text-emerald-300";
}

export default function TyreControlVehiculo({ plate, modo = "resumen" }: {
  plate: string | null | undefined;
  modo?: "resumen" | "completo";
}) {
  const [estado, setEstado] = useState<Estado | null>(null);
  const [cargando, setCargando] = useState(false);

  const limpia = String(plate ?? "").replace(/[^A-Z0-9]/gi, "");
  /*
   * Con menos de cuatro caracteres no se consulta nada. Se decide aquí, no
   * borrando el estado dentro del efecto: escribir estado en el cuerpo del
   * efecto encadena renders, y además no hace falta — si no hay matrícula que
   * consultar, el componente sencillamente no pinta.
   */
  const consultable = limpia.length >= 4;

  useEffect(() => {
    if (!consultable) return;
    let vivo = true;

    // Antirrebote: al teclear una matrícula no se lanza una consulta por letra.
    const t = setTimeout(() => {
      if (!vivo) return;
      setCargando(true);
      fetch(`${API_BASE}/api/tyrecontrol/vehicle-state?plate=${encodeURIComponent(limpia)}`,
            { headers: getAdminHeaders() })
        .then((r) => r.json())
        .then((d) => { if (vivo) setEstado(d); })
        .catch(() => { if (vivo) setEstado({ estado: "ERROR" }); })
        .finally(() => { if (vivo) setCargando(false); });
    }, 500);

    return () => { vivo = false; clearTimeout(t); };
  }, [limpia, consultable]);

  if (!consultable) return null;
  if (!estado && !cargando) return null;

  /*
   * Un vehículo que no está en TyreControl es lo normal para media flota. No
   * se pinta nada: un aviso permanente de «no encontrado» es ruido que la
   * gente aprende a ignorar, y con él ignora también los que sí importan.
   */
  if (estado?.estado === "NOT_FOUND") return null;

  if (estado?.estado === "ERROR") {
    return (
      <div className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-500">
        🛞 No se ha podido consultar TyreControl.
      </div>
    );
  }

  /*
   * Ambigua: la misma matrícula existe en dos empresas de TyreControl. Es un
   * asunto de oficina —hay que decidir de quién es el vehículo—, no algo que
   * se pueda resolver aquí, así que se avisa y se enseñan los candidatos.
   */
  if (estado?.estado === "AMBIGUOUS") {
    return (
      <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs">
        <div className="font-black text-amber-300">
          🛞 Esa matrícula está en {estado.candidatos?.length ?? 0} empresas de TyreControl
        </div>
        <div className="mt-1 text-amber-200/80">
          {estado.candidatos?.map((c) => c.empresaNombre ?? c.empresaId).join(" · ")}
        </div>
        <div className="mt-1 text-[11px] text-slate-400">
          No se puede saber a cuál corresponde. Hay que resolverlo desde TyreControl.
        </div>
      </div>
    );
  }

  if (cargando && !estado) {
    return <div className="px-3 py-2 text-xs text-slate-500">🛞 Consultando TyreControl…</div>;
  }
  if (estado?.estado !== "FOUND" || !estado.vehiculo) return null;

  const v = estado.vehiculo;
  const r = estado.resumen;

  const cabecera = (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="font-black text-cyan-300">🛞 TyreControl</span>
      <span className="font-bold text-cyan-200">
        {v.matricula}
        {v.marca ? ` · ${v.marca}${v.modelo ? ` ${v.modelo}` : ""}` : ""}
        {v.tipoVehiculo ? ` · ${v.tipoVehiculo}` : ""}
        {v.kmActual != null ? ` · ${v.kmActual.toLocaleString("es-ES")} km` : ""}
      </span>
      {!v.activo && (
        <span className="rounded border border-slate-600 px-1.5 py-0.5 text-[10px] text-slate-400">
          dado de baja en TC
        </span>
      )}
      {r && (
        <span className={r.alertas > 0 ? "font-bold text-red-300" : "text-cyan-300"}>
          {r.montados}/{r.posiciones} ruedas
          {r.profundidadMinimaMm != null ? ` · mín. ${r.profundidadMinimaMm} mm` : ""}
          {r.alertas > 0 ? ` · ⚠ ${r.alertas} alerta${r.alertas !== 1 ? "s" : ""}` : ""}
        </span>
      )}
      {r?.ultimaRevisionFecha && (
        <span className="text-slate-400">última revisión {fecha(r.ultimaRevisionFecha)}</span>
      )}
    </div>
  );

  if (modo === "resumen") {
    return (
      <div className="rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-3 py-2">{cabecera}</div>
    );
  }

  /* Modo completo: el plano de ruedas, agrupado por eje. */
  const porEje = new Map<number | string, Posicion[]>();
  for (const p of estado.posiciones ?? []) {
    const clave = p.eje ?? "?";
    porEje.set(clave, [...(porEje.get(clave) ?? []), p]);
  }

  return (
    <div className="rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-3 py-2">
      {cabecera}

      {(estado.posiciones ?? []).length === 0 ? (
        <div className="mt-2 text-[11px] text-slate-400">
          Este vehículo aún no tiene configuración de ruedas en TyreControl.
        </div>
      ) : (
        <div className="mt-2 space-y-2">
          {[...porEje.entries()].map(([eje, posiciones]) => {
            const datosEje = estado.ejes?.find((e) => e.eje === eje);
            return (
              <div key={String(eje)}>
                <div className="mb-1 text-[10px] font-black uppercase tracking-wide text-slate-500">
                  Eje {eje}
                  {datosEje?.medida ? ` · ${datosEje.medida}` : ""}
                  {datosEje?.ruedas ? ` · ${datosEje.ruedas} ruedas` : ""}
                </div>
                <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-4">
                  {posiciones.map((p) => (
                    <div
                      key={p.posicionId}
                      className={`rounded border px-2 py-1 text-[11px] ${
                        p.ultimaRevision?.alertaGenerada
                          ? "border-red-500/40 bg-red-500/10"
                          : "border-slate-700 bg-slate-900/60"
                      }`}
                    >
                      <div className="font-bold text-slate-200">{p.codigoPosicion}</div>
                      {p.neumatico ? (
                        <>
                          <div className="truncate text-slate-400">
                            {[p.neumatico.marca, p.neumatico.modelo].filter(Boolean).join(" ") || "sin marca"}
                          </div>
                          <div className="text-slate-500">{p.neumatico.medida ?? ""}</div>
                          <div className={tonoProfundidad(p.neumatico.profundidadActualMm)}>
                            {p.neumatico.profundidadActualMm != null
                              ? `${p.neumatico.profundidadActualMm} mm en TC`
                              : "sin profundidad en TC"}
                          </div>
                          {/* La medida de la revisión va aparte de la de TC: son
                              dos datos distintos y pueden no coincidir. */}
                          {p.ultimaRevision?.profundidadMm != null && (
                            <div className="text-slate-500">
                              {p.ultimaRevision.profundidadMm} mm medidos el {fecha(p.ultimaRevision.fecha)}
                            </div>
                          )}
                          {p.ultimaRevision?.ultimaPresionBar != null && (
                            <div className="text-slate-500">
                              última presión {p.ultimaRevision.ultimaPresionBar} bar
                            </div>
                          )}
                        </>
                      ) : (
                        <div className="text-slate-600">sin neumático montado</div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
