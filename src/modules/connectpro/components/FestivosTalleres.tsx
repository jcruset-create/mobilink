/**
 * Connect Pro — festivos de los talleres.
 *
 * No es el calendario de la central, que trabaja 365 días 24 horas. Es el de
 * cada taller: los festivos de su comunidad autónoma y los dos o tres de su
 * municipio, que son los que hacen que un día no esté disponible.
 *
 * Lo que decide la forma de esta pantalla es que **lo autonómico se carga una
 * vez por comunidad y lo local una vez por taller**. Meter el festivo de Aragón
 * en cada taller de Zaragoza haría que corregir una fecha fuera corregirla
 * catorce veces.
 *
 * Y por eso lo primero que se ve es la cobertura: una comunidad con talleres y
 * sin festivos cargados es una comunidad cuyos talleres van a parecer abiertos
 * todos los días del año, y eso solo se descubre llamando a uno cerrado.
 */

import { useCallback, useEffect, useState } from "react";
import { boFetch } from "../services/api";
import { Card, Th, Td, Badge, Select, Button, ErrorBanner, EmptyState } from "./ui";

type Cobertura = {
  regionCode: string | null; regionName: string | null;
  talleres: number; festivosAutonomicos: number; festivosLocales: number;
  aviso: string | null;
};

type Festivo = {
  id: number; scope: "regional" | "local"; regionCode: string | null; regionName: string | null;
  workshopId: number | null; workshopName: string | null; city: string | null;
  date: string; name: string | null;
};

type Region = { code: string; name: string };
type Taller = { id: number; name: string; city: string | null; province: string | null };

export default function FestivosTalleres() {
  const [anio, setAnio] = useState(String(new Date().getFullYear()));
  const [cobertura, setCobertura] = useState<Cobertura[]>([]);
  const [festivos, setFestivos] = useState<Festivo[]>([]);
  const [regiones, setRegiones] = useState<Region[]>([]);
  const [talleres, setTalleres] = useState<Taller[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cargando, setCargando] = useState<"regional" | "local" | null>(null);

  const cargar = useCallback(() => {
    boFetch<{ data: Cobertura[] }>(`/workshop-holidays/coverage?anio=${anio}`)
      .then((r) => setCobertura(r.data)).catch((e) => setError(e.message));
    boFetch<{ data: Festivo[] }>(`/workshop-holidays?desde=${anio}-01-01&hasta=${anio}-12-31`)
      .then((r) => setFestivos(r.data)).catch(() => {});
  }, [anio]);
  useEffect(cargar, [cargar]);

  useEffect(() => {
    boFetch<{ data: Region[] }>("/workshop-holidays/regions").then((r) => setRegiones(r.data)).catch(() => {});
    boFetch<{ data: Taller[] }>("/workshops").then((r) => setTalleres(r.data)).catch(() => {});
  }, []);

  const resolverRegiones = async () => {
    setBusy(true); setError(null); setAviso(null);
    try {
      const r = await boFetch<any>("/workshop-holidays/resolve-regions", { method: "POST", body: {} });
      setAviso(
        `${r.actualizados} taller(es) asignados a su comunidad.` +
        (r.sinReconocer.length
          ? ` ${r.sinReconocer.length} sin reconocer la provincia: ${
              r.sinReconocer.slice(0, 5).map((x: any) => `${x.name} (${x.province ?? "sin provincia"})`).join(", ")}`
          : ""));
      cargar();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  const borrar = async (f: Festivo) => {
    try {
      await boFetch(`/workshop-holidays/${f.id}`, { method: "DELETE" });
      cargar();
    } catch (e: any) { setError(e.message); }
  };

  const sinComunidad = cobertura.find((c) => c.regionCode == null);

  return (
    <div className="flex flex-col gap-4">
      {error && <ErrorBanner message={error} onClose={() => setError(null)} />}
      {aviso && <p className="text-[13px] text-emerald-300">{aviso}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <Select value={anio} onChange={(e) => setAnio(e.target.value)}>
          {[-1, 0, 1].map((n) => {
            const a = new Date().getFullYear() + n;
            return <option key={a} value={a}>{a}</option>;
          })}
        </Select>
        <Button variant="ghost" onClick={resolverRegiones} disabled={busy}>
          Asignar comunidad a los talleres
        </Button>
        <Button onClick={() => setCargando("regional")} disabled={busy}>
          Cargar festivos de una comunidad
        </Button>
        <Button variant="ghost" onClick={() => setCargando("local")} disabled={busy}>
          Cargar fiestas locales de un taller
        </Button>
      </div>

      <p className="text-[12px] text-slate-500">
        La central trabaja 365 días 24 horas; los talleres no. Estos festivos son
        los que se avisan al operador cuando va a llamar a un taller, para que
        pueda elegir otro cercano que sí esté trabajando.
      </p>

      {sinComunidad && sinComunidad.talleres > 0 && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[13px] text-amber-300">
          {sinComunidad.talleres} taller(es) sin comunidad autónoma asignada. No se les
          van a aplicar los festivos autonómicos y van a parecer abiertos siempre.
          Pulsa «Asignar comunidad a los talleres»; los que no se reconozcan hay que
          corregirles la provincia en su ficha.
        </div>
      )}

      {cargando && (
        <Cargar
          modo={cargando} regiones={regiones} talleres={talleres} anio={anio}
          onHecho={(msg) => { setCargando(null); setAviso(msg); cargar(); }}
          onCancelar={() => setCargando(null)}
          onError={setError}
        />
      )}

      <Card className="overflow-x-auto">
        <h3 className="border-b border-slate-700 px-4 py-3 text-sm font-semibold text-slate-300">
          Cobertura por comunidad
        </h3>
        {cobertura.length === 0 ? (
          <div className="p-4"><EmptyState message="Este centro no tiene talleres en su red todavía." /></div>
        ) : (
          <table className="w-full text-[13px]">
            <thead><tr className="border-b border-slate-700">
              <Th>Comunidad</Th><Th>Talleres</Th><Th>Festivos autonómicos</Th>
              <Th>Fiestas locales</Th><Th></Th>
            </tr></thead>
            <tbody>
              {cobertura.map((c) => (
                <tr key={c.regionCode ?? "sin"} className="border-b border-slate-700/50">
                  <Td className="font-semibold text-slate-100">
                    {c.regionName ?? <span className="text-amber-300">Sin comunidad asignada</span>}
                  </Td>
                  <Td>{c.talleres}</Td>
                  <Td className={c.festivosAutonomicos === 0 ? "text-amber-300" : ""}>
                    {c.festivosAutonomicos}
                  </Td>
                  <Td>{c.festivosLocales}</Td>
                  <Td className="text-[12px] text-amber-300">{c.aviso ?? ""}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card className="overflow-x-auto">
        <h3 className="border-b border-slate-700 px-4 py-3 text-sm font-semibold text-slate-300">
          Festivos cargados en {anio} ({festivos.length})
        </h3>
        {festivos.length === 0 ? (
          <div className="p-4"><EmptyState message="Ningún festivo cargado para este año." /></div>
        ) : (
          <table className="w-full text-[13px]">
            <thead><tr className="border-b border-slate-700">
              <Th>Fecha</Th><Th>Ámbito</Th><Th>Dónde</Th><Th>Nombre</Th><Th></Th>
            </tr></thead>
            <tbody>
              {festivos.map((f) => (
                <tr key={f.id} className="border-b border-slate-700/50">
                  <Td className="tabular-nums whitespace-nowrap">{f.date}</Td>
                  <Td>
                    <Badge className={f.scope === "regional"
                      ? "border-cyan-500/40 text-cyan-300" : "border-fuchsia-500/40 text-fuchsia-300"}>
                      {f.scope === "regional" ? "Autonómico" : "Local"}
                    </Badge>
                  </Td>
                  <Td>
                    {f.scope === "regional"
                      ? f.regionName ?? f.regionCode
                      : `${f.workshopName ?? "—"}${f.city ? ` · ${f.city}` : ""}`}
                  </Td>
                  <Td>{f.name ?? "—"}</Td>
                  <Td>
                    <button className="text-[12px] text-rose-300 hover:underline"
                            onClick={() => borrar(f)}>Quitar</button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

/**
 * Alta en lote.
 *
 * Los autonómicos llegan doce o catorce de golpe, publicados en un boletín, y
 * los locales de un taller son dos. De uno en uno no los mete nadie, así que se
 * pegan las fechas y ya está.
 */
function Cargar({ modo, regiones, talleres, anio, onHecho, onCancelar, onError }: {
  modo: "regional" | "local";
  regiones: Region[]; talleres: Taller[]; anio: string;
  onHecho: (msg: string) => void; onCancelar: () => void; onError: (m: string) => void;
}) {
  const [regionCode, setRegionCode] = useState("");
  const [workshopId, setWorkshopId] = useState("");
  const [texto, setTexto] = useState("");
  const [busy, setBusy] = useState(false);

  const guardar = async () => {
    const festivos = texto.trim().split(/\r?\n/).map((l) => {
      const [fecha, ...resto] = l.split(/\t|;|,/).map((c) => c.trim());
      if (!fecha) return null;
      // Se acepta 2026-04-23 y 23/04/2026, que es como se copia de un boletín
      const m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(fecha);
      const iso = m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : fecha;
      return {
        scope: modo,
        regionCode: modo === "regional" ? regionCode : null,
        workshopId: modo === "local" ? Number(workshopId) : null,
        date: iso,
        name: resto.join(" ").trim() || null,
      };
    }).filter(Boolean);

    if (festivos.length === 0) { onError("No se ha reconocido ninguna fecha"); return; }

    setBusy(true);
    try {
      const r = await boFetch<any>("/workshop-holidays", { method: "POST", body: { festivos } });
      onHecho(`${r.escritos} festivo(s) cargados.`);
    } catch (e: any) { onError(e.message); } finally { setBusy(false); }
  };

  const listo = modo === "regional" ? !!regionCode : !!workshopId;

  return (
    <Card className="p-4">
      <p className="mb-3 text-[13px] font-medium text-slate-200">
        {modo === "regional"
          ? "Festivos autonómicos — se aplican a todos los talleres de esa comunidad"
          : "Fiestas locales — solo del taller que se elija"}
      </p>

      <div className="mb-3 max-w-md">
        {modo === "regional" ? (
          <label className="block">
            <span className="mb-1 block text-xs text-slate-500">Comunidad autónoma</span>
            <Select value={regionCode} onChange={(e) => setRegionCode(e.target.value)}>
              <option value="">Elegir…</option>
              {regiones.map((r) => <option key={r.code} value={r.code}>{r.name}</option>)}
            </Select>
          </label>
        ) : (
          <label className="block">
            <span className="mb-1 block text-xs text-slate-500">Taller</span>
            <Select value={workshopId} onChange={(e) => setWorkshopId(e.target.value)}>
              <option value="">Elegir…</option>
              {talleres.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}{t.city ? ` · ${t.city}` : ""}
                </option>
              ))}
            </Select>
          </label>
        )}
      </div>

      <p className="mb-1 text-[12px] text-slate-400">
        Una fecha por línea, con el nombre detrás si se quiere. Se acepta
        <code className="mx-1">{anio}-04-23</code> y <code className="mx-1">23/04/{anio}</code>.
      </p>
      <textarea
        value={texto} onChange={(e) => setTexto(e.target.value)} rows={6} spellCheck={false}
        placeholder={`${anio}-04-23\tSan Jorge\n${anio}-10-13\tFiestas del Pilar`}
        className="w-full rounded-lg border border-slate-600 bg-slate-800 p-2 font-mono text-[12px] text-slate-200"
      />

      <div className="mt-3 flex gap-2">
        <Button onClick={guardar} disabled={busy || !listo || !texto.trim()}>Cargar</Button>
        <Button variant="ghost" onClick={onCancelar} disabled={busy}>Cancelar</Button>
      </div>
      {!listo && (
        <p className="mt-2 text-xs text-slate-500">
          Elige {modo === "regional" ? "la comunidad" : "el taller"} antes de cargar.
        </p>
      )}
    </Card>
  );
}
