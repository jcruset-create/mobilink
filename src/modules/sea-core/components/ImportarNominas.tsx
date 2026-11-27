import { useState } from "react";
import { apiFetch } from "../../apiFetch";

/**
 * Importar de las nóminas del mes los trabajadores que falten en Core.
 *
 * Se sube el PDF de la gestoría, el servidor lee la cabecera de cada nómina y
 * la compara con Core por NIF, y aquí se enseña qué pasaría ANTES de tocar
 * nada. Lo que el administrador marca se manda otra vez con el mismo PDF: lo
 * que entra en Core sale del PDF, no de esta pantalla.
 *
 * De cada página solo se lee la cabecera. El PDF entero no se guarda; lo que
 * sí se puede pedir, con su casilla, es que cada nómina se guarde suelta en la
 * ficha de su trabajador, donde solo la ve el superadministrador.
 */

type Cambio = { campo: string; etiqueta: string; actual: string | null; nuevo: string };

type Fila = {
  nif: string;
  nombre: string;
  apellidos: string;
  codigo: string;
  centro: string;
  grupo: string;
  antiguedad: string | null;
  paginas: number[];
  tipo: "nuevo" | "actualizar" | "igual" | "baja_en_core";
  empleadoNombre: string | null;
  porNombre: boolean;
  cambios: Cambio[];
  avisos: string[];
};

type Analisis = {
  empresa: { id: string; nombre: string } | null;
  empresaDelPdf: { cif: string; nombre: string };
  empresas: { id: string; nombre: string }[];
  filas: Fila[];
  noEnNomina: { id: string; nombre: string; numeroTrabajador: string | null }[];
  paginasNoReconocidas: number[];
  conNumero: boolean;
  /** Se puede guardar cada nómina en la ficha de su trabajador. */
  nominasDisponible: boolean;
};

type Resultado = {
  creados: { id: string; nombre: string; numeroTrabajador: string | null }[];
  actualizados: { id: string; nombre: string; cambios: string[] }[];
  nominas: { guardadas: number; fichas: number; noGuardadas: { nombre: string; motivo: string }[]; error?: string } | null;
};

const fecha = (iso: string | null) => (iso ? iso.split("-").reverse().join("/") : "—");

export default function ImportarNominas({ onCerrar, onImportado }: { onCerrar: () => void; onImportado: () => void }) {
  const [pdf, setPdf] = useState<File | null>(null);
  const [analisis, setAnalisis] = useState<Analisis | null>(null);
  const [crear, setCrear] = useState<Set<string>>(new Set());
  const [actualizar, setActualizar] = useState<Set<string>>(new Set());
  const [trabajando, setTrabajando] = useState<"" | "leyendo" | "importando">("");
  const [error, setError] = useState("");
  const [resultado, setResultado] = useState<Resultado | null>(null);
  /** Guardar cada nómina en la ficha de su trabajador. Marcada de entrada. */
  const [guardarNominas, setGuardarNominas] = useState(true);

  async function analizar(fichero: File, companyId?: string) {
    setTrabajando("leyendo");
    setError("");
    setResultado(null);
    try {
      const cuerpo = new FormData();
      cuerpo.append("pdf", fichero);
      if (companyId) cuerpo.append("companyId", companyId);
      const r = await apiFetch("/api/core/empleados/importar-nominas/analizar", { method: "POST", body: cuerpo });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.error ?? "No se han podido leer las nóminas.");
      const a = d as Analisis;
      setAnalisis(a);
      // Por defecto, todo marcado: es lo que casi siempre se quiere, y se ve
      // en la tabla antes de confirmar.
      setCrear(new Set(a.filas.filter((f) => f.tipo === "nuevo").map((f) => f.nif)));
      setActualizar(new Set(a.filas.filter((f) => f.tipo === "actualizar").map((f) => f.nif)));
    } catch (e) {
      setAnalisis(null);
      setError(e instanceof Error ? e.message : "No se han podido leer las nóminas.");
    } finally {
      setTrabajando("");
    }
  }

  async function importar() {
    if (!pdf || !analisis?.empresa) return;
    setTrabajando("importando");
    setError("");
    try {
      const cuerpo = new FormData();
      cuerpo.append("pdf", pdf);
      cuerpo.append("companyId", analisis.empresa.id);
      cuerpo.append("crear", JSON.stringify([...crear]));
      cuerpo.append("actualizar", JSON.stringify([...actualizar]));
      if (guardarNominas && analisis.nominasDisponible) cuerpo.append("guardarNominas", "1");
      const r = await apiFetch("/api/core/empleados/importar-nominas/aplicar", { method: "POST", body: cuerpo });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.error ?? "No se ha podido importar.");
      setResultado(d as Resultado);
      onImportado();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se ha podido importar.");
    } finally {
      setTrabajando("");
    }
  }

  const alternar = (conjunto: Set<string>, poner: (s: Set<string>) => void, nif: string) => {
    const s = new Set(conjunto);
    if (s.has(nif)) s.delete(nif);
    else s.add(nif);
    poner(s);
  };

  const nuevos = analisis?.filas.filter((f) => f.tipo === "nuevo") ?? [];
  const aActualizar = analisis?.filas.filter((f) => f.tipo === "actualizar") ?? [];
  const iguales = analisis?.filas.filter((f) => f.tipo === "igual") ?? [];
  const deBaja = analisis?.filas.filter((f) => f.tipo === "baja_en_core") ?? [];
  const marcados = crear.size + actualizar.size;
  const seGuardan = guardarNominas && analisis?.nominasDisponible === true;
  /** Cuántas nóminas trae el PDF (hay quien tiene dos en el mes). */
  const totalNominas = analisis?.filas.reduce((n, f) => n + f.paginas.length, 0) ?? 0;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-black/60 p-4">
      <div className="my-6 w-full max-w-4xl rounded-2xl border border-slate-700 bg-slate-800 p-6 text-slate-100 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold">Importar de nóminas</h2>
            <p className="text-sm text-slate-400">
              Sube el PDF de nóminas del mes. Se lee solo la cabecera de cada una (nombre, NIF, Seguridad Social,
              antigüedad, categoría y código); los importes no se leen.
            </p>
          </div>
          <button onClick={onCerrar} className="rounded-lg border border-slate-600 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-700/50">
            Cerrar
          </button>
        </div>

        <label className="mt-4 flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-dashed border-slate-600 bg-slate-900 p-4">
          <span className="text-sm">
            {pdf ? <b>{pdf.name}</b> : "Elige el PDF de las nóminas"}
            {trabajando === "leyendo" && <span className="ml-2 text-slate-400">Leyendo…</span>}
          </span>
          <span className="rounded-lg bg-slate-700 px-3 py-1.5 text-xs font-semibold">{pdf ? "Cambiar PDF" : "Elegir PDF"}</span>
          <input
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (!f) return;
              setPdf(f);
              void analizar(f);
            }}
          />
        </label>

        {error && <p className="mt-3 rounded-lg border border-red-800 bg-red-950/60 p-3 text-sm text-red-200">{error}</p>}

        {resultado && (
          <div className="mt-4 rounded-xl border border-green-800 bg-green-900/20 p-4 text-sm text-green-100">
            <b>Importación hecha.</b>
            {resultado.creados.length > 0 && (
              <p className="mt-1">
                Creados ({resultado.creados.length}):{" "}
                {resultado.creados.map((c) => `${c.nombre}${c.numeroTrabajador ? ` (Nº ${c.numeroTrabajador})` : ""}`).join(", ")}.
                Están «Sin enlace»: ponles el móvil y mándales el enlace de alta.
              </p>
            )}
            {resultado.actualizados.length > 0 && (
              <p className="mt-1">Actualizados ({resultado.actualizados.length}): {resultado.actualizados.map((a) => a.nombre).join(", ")}.</p>
            )}
            {resultado.creados.length + resultado.actualizados.length === 0 && !resultado.nominas && (
              <p className="mt-1">No había nada que cambiar: ya estaba todo igual que en la nómina.</p>
            )}
            {resultado.nominas && !resultado.nominas.error && (
              <p className="mt-1">
                <b>Nóminas guardadas: {resultado.nominas.guardadas}</b>, en {resultado.nominas.fichas}{" "}
                {resultado.nominas.fichas === 1 ? "ficha" : "fichas"}.
              </p>
            )}
            {resultado.nominas?.error && <p className="mt-1 text-amber-200">⚠ {resultado.nominas.error}</p>}
            {resultado.nominas && resultado.nominas.noGuardadas.length > 0 && (
              <p className="mt-1 text-amber-200">
                Sin guardar: {resultado.nominas.noGuardadas.map((n) => `${n.nombre} (${n.motivo})`).join("; ")}.
              </p>
            )}
          </div>
        )}

        {analisis && !resultado && (
          <div className="mt-4 space-y-5">
            {/* Empresa */}
            {analisis.empresa ? (
              <p className="text-sm text-slate-300">
                Empresa: <b>{analisis.empresa.nombre}</b>
                <span className="text-slate-500"> · en el PDF: {analisis.empresaDelPdf.nombre} ({analisis.empresaDelPdf.cif || "sin CIF"})</span>
              </p>
            ) : (
              <div className="rounded-xl border border-amber-700 bg-amber-500/10 p-3 text-sm text-amber-100">
                No reconozco en Core la empresa del PDF (<b>{analisis.empresaDelPdf.nombre}</b>, {analisis.empresaDelPdf.cif || "sin CIF"}).
                Elige a cuál corresponde:
                <select
                  defaultValue=""
                  onChange={(e) => { if (pdf && e.target.value) void analizar(pdf, e.target.value); }}
                  className="ml-2 rounded-lg border border-slate-600 bg-slate-900 px-2 py-1 text-sm text-slate-100"
                >
                  <option value="" disabled>Elegir empresa…</option>
                  {analisis.empresas.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
                </select>
              </div>
            )}

            {analisis.paginasNoReconocidas.length > 0 && (
              <p className="rounded-lg border border-amber-700 bg-amber-500/10 p-3 text-sm text-amber-100">
                No he reconocido como nómina {analisis.paginasNoReconocidas.length === 1 ? "la página" : "las páginas"}{" "}
                {analisis.paginasNoReconocidas.join(", ")}. Mírala{analisis.paginasNoReconocidas.length === 1 ? "" : "s"} a mano.
              </p>
            )}

            {analisis.empresa && (
              <>
                <Bloque titulo={`Nuevos (${nuevos.length})`} nota="Están en la nómina y no en Core. Se crean pendientes del enlace de alta." tono="sky">
                  {nuevos.length === 0 ? <Vacio>Nadie nuevo.</Vacio> : (
                    <Tabla cabeceras={["", "Nº", "Trabajador", "NIF", "Alta", "Centro / categoría"]}>
                      {nuevos.map((f) => (
                        <tr key={f.nif} className="border-t border-slate-700 align-top">
                          <td className="p-2"><input type="checkbox" checked={crear.has(f.nif)} onChange={() => alternar(crear, setCrear, f.nif)} /></td>
                          <td className="p-2 font-mono">{f.codigo || "—"}</td>
                          <td className="p-2">
                            <b>{f.nombre} {f.apellidos}</b>
                            <Avisos lista={f.avisos} />
                          </td>
                          <td className="p-2 font-mono text-slate-300">{f.nif}</td>
                          <td className="p-2 text-slate-300">{fecha(f.antiguedad)}</td>
                          <td className="p-2 text-slate-300">{f.centro}<div className="text-xs text-slate-500">{f.grupo}</div></td>
                        </tr>
                      ))}
                    </Tabla>
                  )}
                </Bloque>

                <Bloque titulo={`A actualizar (${aActualizar.length})`} nota="Ya están en Core. Solo se iguala el número con el de la nómina y se rellena lo que falte; lo que ya está puesto no se pisa." tono="amber">
                  {aActualizar.length === 0 ? <Vacio>Nada que actualizar.</Vacio> : (
                    <Tabla cabeceras={["", "Trabajador", "Qué cambia"]}>
                      {aActualizar.map((f) => (
                        <tr key={f.nif} className="border-t border-slate-700 align-top">
                          <td className="p-2"><input type="checkbox" checked={actualizar.has(f.nif)} onChange={() => alternar(actualizar, setActualizar, f.nif)} /></td>
                          <td className="p-2">
                            <b>{f.empleadoNombre}</b>
                            <Avisos lista={f.avisos} />
                          </td>
                          <td className="p-2 text-slate-300">
                            {f.cambios.map((c) => (
                              <div key={c.campo}>
                                {c.etiqueta}: {c.actual ? <><span className="text-slate-500 line-through">{c.actual}</span> → </> : null}
                                <b className="font-mono">{c.campo === "fecha_alta" ? fecha(c.nuevo) : c.nuevo}</b>
                              </div>
                            ))}
                          </td>
                        </tr>
                      ))}
                    </Tabla>
                  )}
                </Bloque>

                {deBaja.length > 0 && (
                  <Bloque titulo={`Salen en la nómina pero están de baja en Core (${deBaja.length})`} nota="No se crea otro. Si han vuelto, dales de alta desde su ficha." tono="rose">
                    <ul className="list-disc pl-5 text-sm text-slate-300">{deBaja.map((f) => <li key={f.nif}>{f.empleadoNombre}</li>)}</ul>
                  </Bloque>
                )}

                {analisis.noEnNomina.length > 0 && (
                  <Bloque titulo={`Activos en Core que no salen en esta nómina (${analisis.noEnNomina.length})`} nota="Puede ser una baja, o alguien que no cobra por esta empresa. Solo es un aviso: aquí no se da de baja a nadie." tono="rose">
                    <ul className="list-disc pl-5 text-sm text-slate-300">
                      {analisis.noEnNomina.map((e) => <li key={e.id}>{e.nombre}{e.numeroTrabajador ? ` · Nº ${e.numeroTrabajador}` : ""}</li>)}
                    </ul>
                  </Bloque>
                )}

                <p className="text-sm text-slate-400">Sin cambios: {iguales.length}.</p>

                {analisis.nominasDisponible ? (
                  <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-sky-800 bg-sky-500/10 p-3 text-sm">
                    <input type="checkbox" className="mt-0.5" checked={guardarNominas} onChange={(e) => setGuardarNominas(e.target.checked)} />
                    <span>
                      <b>Guardar cada nómina en la ficha de su trabajador</b>
                      <span className="block text-xs text-slate-400">
                        El PDF se parte por páginas y a cada persona se le guarda solo la suya. Solo las ve el
                        superadministrador. Si ese mes ya estaba guardado, se sustituye.
                      </span>
                    </span>
                  </label>
                ) : (
                  <p className="text-xs text-slate-500">
                    Para poder guardar cada nómina en la ficha de su trabajador falta ejecutar en Supabase la migración
                    de las nóminas.
                  </p>
                )}

                {!analisis.conNumero && (
                  <p className="text-sm text-amber-300">
                    Falta ejecutar la migración del número de trabajador: los nuevos se crearán sin número.
                  </p>
                )}

                <div className="flex items-center justify-end gap-3 border-t border-slate-700 pt-4">
                  <span className="text-sm text-slate-400">
                    {crear.size} a crear · {actualizar.size} a actualizar
                    {seGuardan ? ` · ${totalNominas} ${totalNominas === 1 ? "nómina" : "nóminas"} a guardar` : ""}
                  </span>
                  <button
                    onClick={() => void importar()}
                    disabled={(marcados === 0 && !seGuardan) || trabajando !== ""}
                    className="rounded-xl bg-sky-600 px-4 py-2 text-sm font-bold text-white hover:bg-sky-500 disabled:opacity-40"
                  >
                    {trabajando === "importando" ? "Importando…" : marcados === 0 && seGuardan ? "Guardar las nóminas" : "Importar lo marcado"}
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const BORDE: Record<string, string> = { sky: "border-sky-800", amber: "border-amber-800", rose: "border-rose-900" };

function Bloque({ titulo, nota, tono, children }: { titulo: string; nota: string; tono: "sky" | "amber" | "rose"; children: React.ReactNode }) {
  return (
    <section className={`rounded-xl border ${BORDE[tono]} bg-slate-900/40 p-4`}>
      <h3 className="font-semibold">{titulo}</h3>
      <p className="mb-2 text-xs text-slate-400">{nota}</p>
      {children}
    </section>
  );
}

function Tabla({ cabeceras, children }: { cabeceras: string[]; children: React.ReactNode }) {
  return (
    <div className="overflow-auto">
      <table className="w-full min-w-[560px] text-sm">
        <thead className="text-left text-xs text-slate-400">
          <tr>{cabeceras.map((c, i) => <th key={i} className="p-2 font-medium">{c}</th>)}</tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function Vacio({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-slate-500">{children}</p>;
}

function Avisos({ lista }: { lista: string[] }) {
  if (lista.length === 0) return null;
  return <div className="mt-0.5 space-y-0.5">{lista.map((a, i) => <div key={i} className="text-xs text-amber-300">⚠ {a}</div>)}</div>;
}
