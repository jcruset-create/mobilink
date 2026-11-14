import { useEffect, useMemo, useState } from "react";
import {
  leerHojaPapel, listarPosiciones, listarVehiculos, partirPartesPapel,
  type HojaPapel,
} from "../services/data";
import type { PosicionVehiculo, Vehiculo } from "../types";
import {
  discrepanciaDeCroquis, filasConDatos, numeracionDelParteFlotas, pareceNota,
} from "../services/parteFlotas";
import { inputCls, TableWrap, tdCls, thCls } from "../components/ui";

/**
 * Importar los partes de revisión en papel.
 *
 * ── Esta pantalla todavía NO guarda nada ───────────────────────────────────
 *
 * Lee el PDF y enseña lo que ha entendido, al lado del vehículo con el que lo
 * ha casado. Nada más. Es deliberado y es el primer paso: el lector se ha
 * escrito mirando catorce partes reales pero no se ha podido ejecutar ni una
 * vez contra ellos, así que lo primero que tiene que pasar es que alguien
 * compare esta pantalla con los papeles y diga si acierta.
 *
 * Cuando acierte, se añade el botón de guardar y se engancha con la pantalla
 * de Revisión de vehículo, que desde hace poco sabe fechar la revisión en el
 * día del parte y montar gomas en posiciones vacías.
 *
 * ── Lo que se enseña y por qué ─────────────────────────────────────────────
 *
 * No el JSON del modelo, sino lo que se haría con él: qué vehículo, qué rueda
 * de ese vehículo es cada fila y qué profundidad le tocaría. Un error de
 * transcripción se ve mirando el papel; un error de CASADO —la fila 3 en el
 * gemelo que no es— solo se ve si se enseña la rueda, y es el que no da la
 * cara después.
 */

type EstadoHoja =
  | { fase: "pendiente" }
  | { fase: "leyendo" }
  | { fase: "leida"; lectura: HojaPapel }
  | { fase: "error"; motivo: string };

async function aDataUri(f: File): Promise<string> {
  return new Promise((ok, mal) => {
    const fr = new FileReader();
    fr.onload = () => ok(String(fr.result));
    fr.onerror = () => mal(new Error("No se ha podido leer el fichero"));
    fr.readAsDataURL(f);
  });
}

/** Matrícula sin espacios ni guiones, para comparar. */
function normalizar(s: string | null | undefined): string {
  return (s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export default function ImportarPartesPapel() {
  const [hojas, setHojas] = useState<string[]>([]);
  const [estados, setEstados] = useState<EstadoHoja[]>([]);
  const [vehiculos, setVehiculos] = useState<Vehiculo[]>([]);
  const [posicionesPorTipo, setPosicionesPorTipo] = useState<Record<string, PosicionVehiculo[]>>({});
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState("");
  const [nombre, setNombre] = useState("");

  const porUnidad = useMemo(() => {
    const m = new Map<string, Vehiculo>();
    for (const v of vehiculos) if (v.numero_unidad) m.set(String(v.numero_unidad).trim(), v);
    return m;
  }, [vehiculos]);

  const porMatricula = useMemo(() => {
    const m = new Map<string, Vehiculo>();
    for (const v of vehiculos) m.set(normalizar(v.matricula), v);
    return m;
  }, [vehiculos]);

  async function subir(f: File) {
    setError(""); setCargando(true); setHojas([]); setEstados([]); setNombre(f.name);
    try {
      const [trozos, flota] = await Promise.all([
        partirPartesPapel(await aDataUri(f)),
        listarVehiculos(),
      ]);
      setVehiculos(flota);
      setHojas(trozos);
      setEstados(trozos.map(() => ({ fase: "pendiente" as const })));
      void leerTodas(trozos);
    } catch (e: unknown) {
      setError((e as Error)?.message ?? "No se ha podido abrir el fichero");
    } finally { setCargando(false); }
  }

  /**
   * Leer las hojas de tres en tres.
   *
   * Ni una a una —catorce hojas seguidas son varios minutos de espera— ni
   * todas a la vez, que es como se agota el cupo del proveedor de golpe. Tres
   * deja la pantalla viva y el gasto acotado.
   */
  async function leerTodas(trozos: string[]) {
    const EN_PARALELO = 3;
    let siguiente = 0;
    const obrero = async () => {
      for (;;) {
        const i = siguiente++;
        if (i >= trozos.length) return;
        setEstados((p) => p.map((e, j) => (j === i ? { fase: "leyendo" } : e)));
        try {
          const lectura = await leerHojaPapel(trozos[i]);
          setEstados((p) => p.map((e, j) => (j === i ? { fase: "leida", lectura } : e)));
        } catch (e: unknown) {
          const motivo = (e as Error)?.message ?? "No se ha podido leer";
          setEstados((p) => p.map((e2, j) => (j === i ? { fase: "error", motivo } : e2)));
        }
      }
    };
    await Promise.all(Array.from({ length: EN_PARALELO }, obrero));
  }

  /** El vehículo de una hoja. La unidad manda; la matrícula contrasta. */
  function casar(l: HojaPapel): { veh: Vehiculo | null; aviso: string | null } {
    const unidad = (l.numero_unidad ?? "").trim();
    const porU = unidad ? porUnidad.get(unidad) ?? null : null;
    const porM = porMatricula.get(normalizar(l.matricula)) ?? null;

    // La unidad manda, y no es un capricho: al transcribir estos catorce
    // partes a mano se leyeron mal cuatro matrículas de catorce y ninguna
    // unidad. Son cuatro dígitos contra siete caracteres sin redundancia.
    if (porU) {
      if (porM && porM.id !== porU.id) {
        return { veh: porU, aviso: `La matrícula leída (${l.matricula}) es de otro vehículo. Manda la unidad.` };
      }
      if (!porM && l.matricula) {
        return { veh: porU, aviso: `La matrícula leída (${l.matricula}) no cuadra con la unidad ${unidad}.` };
      }
      return { veh: porU, aviso: null };
    }
    if (porM) return { veh: porM, aviso: `Sin número de unidad legible; casado por matrícula.` };
    return { veh: null, aviso: "No se ha reconocido el vehículo." };
  }

  async function posicionesDe(v: Vehiculo): Promise<PosicionVehiculo[]> {
    if (!v.tipo_vehiculo_id) return [];
    const ya = posicionesPorTipo[v.tipo_vehiculo_id];
    if (ya) return ya;
    const ps = await listarPosiciones(v.tipo_vehiculo_id);
    setPosicionesPorTipo((p) => ({ ...p, [v.tipo_vehiculo_id as string]: ps }));
    return ps;
  }

  return (
    <div>
      <h1 className="mb-1 text-lg font-black">Importar partes en papel</h1>
      <p className="mb-3 max-w-3xl text-[12px] text-slate-400">
        Sube el PDF escaneado de los partes de Grupo Soledad. Se lee una hoja por vehículo
        y se enseña lo que ha entendido. <b className="text-amber-300">Todavía no guarda nada</b>:
        esta pantalla es para comprobar que lo lee bien antes de dejarle escribir.
      </p>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          type="file" accept="application/pdf,image/*" className={`${inputCls} max-w-sm`}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void subir(f); }}
        />
        {cargando && <span className="text-[12px] text-slate-400">Abriendo…</span>}
        {nombre && !cargando && (
          <span className="text-[12px] text-slate-400">{nombre} · {hojas.length} hojas</span>
        )}
      </div>

      {error && <div className="mb-3 text-sm text-red-300">{error}</div>}

      <div className="flex flex-col gap-3">
        {estados.map((e, i) => (
          <Hoja
            key={i} numero={i + 1} estado={e}
            casar={casar} posicionesDe={posicionesDe}
          />
        ))}
      </div>
    </div>
  );
}

function Hoja({ numero, estado, casar, posicionesDe }: {
  numero: number;
  estado: EstadoHoja;
  casar: (l: HojaPapel) => { veh: Vehiculo | null; aviso: string | null };
  posicionesDe: (v: Vehiculo) => Promise<PosicionVehiculo[]>;
}) {
  const [posiciones, setPosiciones] = useState<PosicionVehiculo[] | null>(null);

  const casado = estado.fase === "leida" ? casar(estado.lectura) : null;
  const veh = casado?.veh ?? null;

  // Las posiciones del vehículo, una vez casado. En un efecto y no en el
  // cuerpo del render: pedirlas ahí escribiría estado durante el render, que
  // en React es un aviso y, con el doble render del modo estricto, una
  // segunda petición por cada hoja.
  const vehId = veh?.id ?? null;
  useEffect(() => {
    if (!veh) return;
    let vivo = true;
    void posicionesDe(veh).then((ps) => { if (vivo) setPosiciones(ps); });
    return () => { vivo = false; };
    // `vehId` y no `veh`: el objeto se vuelve a crear en cada render y
    // dispararía el efecto en bucle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehId]);

  const numeracion = useMemo(
    () => (posiciones && posiciones.length > 0 ? numeracionDelParteFlotas(posiciones) : null),
    [posiciones],
  );

  return (
    <div className="rounded-lg bg-slate-800 p-3">
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="rounded bg-slate-700 px-2 py-0.5 text-[11px] font-bold text-slate-200">
          Hoja {numero}
        </span>

        {estado.fase === "pendiente" && <span className="text-[12px] text-slate-500">En cola…</span>}
        {estado.fase === "leyendo" && <span className="text-[12px] text-sky-300">Leyendo…</span>}
        {estado.fase === "error" && <span className="text-[12px] text-rose-300">{estado.motivo}</span>}

        {estado.fase === "leida" && (
          <>
            <span className="text-[13px] font-bold text-slate-100">
              {veh ? `${veh.matricula} · unidad ${veh.numero_unidad ?? "—"}` : "Vehículo sin reconocer"}
            </span>
            <span className="text-[12px] text-slate-400">
              Papel: {estado.lectura.matricula ?? "—"} / {estado.lectura.numero_unidad ?? "—"}
              {estado.lectura.fecha ? ` · ${estado.lectura.fecha}` : ""}
              {estado.lectura.croquis ? ` · ${estado.lectura.croquis}` : " · sin croquis"}
            </span>
            {estado.lectura.confianza != null && (
              <span className={`rounded px-1.5 py-0.5 text-[11px] font-bold ${
                estado.lectura.confianza >= 0.8
                  ? "bg-emerald-500/20 text-emerald-300"
                  : "bg-amber-500/20 text-amber-300"}`}>
                confianza {Math.round(estado.lectura.confianza * 100)} %
              </span>
            )}
          </>
        )}
      </div>

      {estado.fase === "leida" && (
        <Avisos
          lectura={estado.lectura} casado={casado!} veh={veh}
          posiciones={posiciones} numeracion={numeracion}
        />
      )}

      {estado.fase === "leida" && (
        <TableWrap>
          <thead className="bg-slate-900"><tr>
            <th className={thCls}>POS</th>
            <th className={thCls}>Rueda del vehículo</th>
            <th className={thCls}>Profundidad</th>
            <th className={thCls}>Medida</th>
            <th className={thCls}>Marca</th>
            <th className={thCls}>Modelo</th>
            <th className={thCls}>Serie / nota</th>
          </tr></thead>
          <tbody>
            {filasConDatos(estado.lectura.filas).map((f, j) => {
              const rueda = f.pos != null ? numeracion?.get(f.pos) ?? null : null;
              return (
                <tr key={j} className="border-t border-slate-700/60">
                  <td className={tdCls + " font-semibold"}>{f.pos ?? "R"}</td>
                  <td className={tdCls}>
                    {rueda
                      ? <span className="font-semibold text-sky-300">{rueda.codigo_posicion}</span>
                      : <span className="text-amber-300">—</span>}
                  </td>
                  <td className={tdCls + (f.profundidad_mm == null ? " text-amber-300" : " text-slate-200")}>
                    {f.profundidad_mm != null ? `${f.profundidad_mm} mm` : "sin leer"}
                  </td>
                  <td className={tdCls + " text-slate-400"}>{f.medida ?? "—"}</td>
                  <td className={tdCls + " text-slate-400"}>{f.marca ?? "—"}</td>
                  <td className={tdCls + " text-slate-400"}>{f.modelo ?? "—"}</td>
                  <td className={tdCls + " text-slate-400"}>
                    {/* La casilla del serie se usa de bloc de notas: en un
                        parte real pone «Cambio y alinear». */}
                    {pareceNota(f.numero_serie)
                      ? <span className="text-amber-300">nota: {f.numero_serie}</span>
                      : f.numero_serie ?? "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </TableWrap>
      )}
    </div>
  );
}

/** Lo que hay que mirar a mano en esta hoja. */
function Avisos({ lectura, casado, veh, posiciones, numeracion }: {
  lectura: HojaPapel;
  casado: { veh: Vehiculo | null; aviso: string | null };
  veh: Vehiculo | null;
  posiciones: PosicionVehiculo[] | null;
  numeracion: Map<number, { codigo_posicion: string }> | null;
}) {
  const lineas: string[] = [];
  if (casado.aviso) lineas.push(casado.aviso);
  if (lectura.aviso) lineas.push(lectura.aviso);

  if (veh && posiciones && posiciones.length === 0) {
    lineas.push(
      "Este vehículo no tiene tipo asignado, así que no tiene ruedas donde poner las medidas."
      + (lectura.croquis ? ` El papel marca ${lectura.croquis}.` : ""),
    );
  }
  if (posiciones && posiciones.length > 0 && !numeracion) {
    lineas.push("El plano de este vehículo no se sabe numerar como el papel.");
  }
  const discrepancia = posiciones ? discrepanciaDeCroquis(posiciones, lectura.croquis) : null;
  if (discrepancia) lineas.push(discrepancia);

  const sinLeer = filasConDatos(lectura.filas).filter((f) => f.profundidad_mm == null).length;
  if (sinLeer > 0) lineas.push(`${sinLeer} profundidad(es) sin leer: compruébalas en el papel.`);

  if (lineas.length === 0) return null;
  return (
    <div className="mb-2 rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-200">
      {lineas.map((l, i) => <div key={i}>{l}</div>)}
    </div>
  );
}
