/**
 * Connect Pro — acuerdos comerciales con cada partner.
 *
 * Un acuerdo dice qué hace un partner por esta central, dónde, cuándo y por
 * cuánto. La pantalla se ordena por esa pregunta y no por la tabla: primero a
 * quién cubre, luego cuándo trabaja, luego el dinero y las condiciones.
 *
 * Lo que NO se hace aquí, a propósito: decidir. La pantalla no elige partner y
 * no calcula si uno vale para un servicio. Eso lo contesta el servidor —el
 * mismo cálculo para el panel, para la API y para el motor de enrutado— y aquí
 * solo se enseña el resultado y el motivo. Un descarte que se calculara en el
 * navegador sería un descarte que la API no aplicaría.
 *
 * El probador de la derecha llama a `/acuerdos/evaluar` justamente para eso:
 * para que se pueda ver por qué un partner no sale, sin tener que reproducir
 * el caso en producción.
 */

import { Fragment, useCallback, useEffect, useState } from "react";

import { boFetch } from "../services/api";
import { useConnectAuth, hasRole } from "../contexts/ConnectAuthContext";
import { PageTitle, Card, Th, Td, Badge, Input, Select, Button, ErrorBanner, EmptyState } from "../components/ui";

type Acuerdo = {
  id: number;
  empresa: string;
  cif: string | null;
  destino: string | null;
  status: string;
  serviciosCubiertos: string[];
  cobertura: {
    paises: string[]; provincias: string[]; codigosPostales: string[];
    codigosPostalesExcluidos: string[]; radioKm: number | null;
  };
  horario: { veinticuatroHoras: boolean; franjas: { dia: number; inicio: number; fin: number }[] };
  economico: {
    moneda: string; limiteSinPresupuesto: number | null;
    limiteMaximo: number | null; presupuestoObligatorio: boolean;
  };
  condiciones: {
    documentacionExigida: string[]; cancelacionSinCosteMin: number | null;
    cancelacionCoste: number | null; cancelacionEnPorcentaje: boolean;
  };
  slaAcceptMin: number | null;
  slaArrivalMin: number | null;
  preferred: boolean;
  excluded: boolean;
  validFromMs: number | null;
  validToMs: number | null;
};

type Candidato = { acuerdo: Acuerdo; empresa: string; evaluacion: { apto: boolean; motivos: string[]; requierePresupuesto: boolean } };

const DIAS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

function hhmm(m: number): string {
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** El horario en una línea: es lo que se mira de un vistazo, no una tabla. */
function resumirHorario(h: Acuerdo["horario"]): string {
  if (h.veinticuatroHoras) return "24 h";
  if (h.franjas.length === 0) return "24 h";
  return h.franjas
    .map((f) => `${DIAS[f.dia]} ${hhmm(f.inicio)}–${hhmm(f.fin)}`)
    .join(" · ");
}

/** La zona igual: se dice lo pactado, y «todo» cuando no se pactó nada. */
function resumirZona(c: Acuerdo["cobertura"]): string {
  const partes: string[] = [];
  if (c.paises.length) partes.push(c.paises.join(", "));
  if (c.provincias.length) partes.push(c.provincias.join(", "));
  if (c.codigosPostales.length) partes.push(`CP ${c.codigosPostales.join(", ")}`);
  if (c.radioKm != null) partes.push(`${c.radioKm} km`);
  if (partes.length === 0) return "Sin límite de zona";
  const texto = partes.join(" · ");
  return c.codigosPostalesExcluidos.length
    ? `${texto} (salvo ${c.codigosPostalesExcluidos.join(", ")})`
    : texto;
}

export default function Acuerdos() {
  const { user } = useConnectAuth();
  const puedeEditar = hasRole(user, "supervisor");

  const [data, setData] = useState<Acuerdo[]>([]);
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(true);
  const [abierto, setAbierto] = useState<number | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const r = await boFetch<{ data: Acuerdo[] }>("/acuerdos");
      setData(r.data ?? []);
      setError("");
    } catch (e: any) { setError(e.message); }
    finally { setCargando(false); }
  }, []);

  useEffect(() => { void cargar(); }, [cargar]);

  return (
    <div className="space-y-4">
      <PageTitle
        title="Acuerdos comerciales"
        subtitle="Qué hace cada partner por esta central, dónde, cuándo y por cuánto."
      />

      {error && <ErrorBanner message={error} onClose={() => setError("")} />}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card>
          {cargando ? (
            <p className="p-4 text-sm text-slate-500">Cargando…</p>
          ) : data.length === 0 ? (
            <EmptyState message="Todavía no hay acuerdos. Se crean al autorizar a una empresa proveedora desde su ficha." />
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <Th>Partner</Th><Th>Zona</Th><Th>Horario</Th><Th>SLA</Th><Th>Estado</Th>
                </tr>
              </thead>
              <tbody>
                {data.map((a) => (
                  <Fragment key={a.id}>
                    <tr
                      className="cursor-pointer hover:bg-slate-800/50"
                      onClick={() => setAbierto(abierto === a.id ? null : a.id)}
                    >
                      <Td>
                        <div className="font-semibold text-slate-100">{a.empresa}</div>
                        <div className="text-[11px] text-slate-500">{a.cif ?? "sin CIF"}</div>
                      </Td>
                      <Td className="text-slate-300">{resumirZona(a.cobertura)}</Td>
                      <Td className="text-slate-300">{resumirHorario(a.horario)}</Td>
                      <Td className="text-slate-400">
                        {a.slaArrivalMin != null ? `${a.slaArrivalMin} min` : "—"}
                      </Td>
                      <Td>
                        {a.excluded ? (
                          <Badge className="border-red-500/40 bg-red-500/10 text-red-300">Excluido</Badge>
                        ) : a.status !== "active" ? (
                          <Badge className="border-amber-500/40 bg-amber-500/10 text-amber-300">{a.status}</Badge>
                        ) : a.preferred ? (
                          <Badge className="border-emerald-500/40 bg-emerald-500/10 text-emerald-300">Preferente</Badge>
                        ) : (
                          <Badge className="border-slate-600 text-slate-400">Activo</Badge>
                        )}
                      </Td>
                    </tr>
                    {abierto === a.id && (
                      <tr>
                        <td colSpan={5} className="bg-slate-900/60 px-4 py-3">
                          <Detalle a={a} puedeEditar={puedeEditar} onGuardado={cargar} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Probador />
      </div>
    </div>
  );
}

/* ── Detalle de un acuerdo ─────────────────────────────────────────────────── */

function Detalle({ a, puedeEditar, onGuardado }: {
  a: Acuerdo; puedeEditar: boolean; onGuardado: () => void;
}) {
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const [tope, setTope] = useState(a.economico.limiteMaximo ?? "");
  const [umbral, setUmbral] = useState(a.economico.limiteSinPresupuesto ?? "");
  const [obligatorio, setObligatorio] = useState(a.economico.presupuestoObligatorio);

  async function guardar() {
    setGuardando(true);
    try {
      await boFetch(`/acuerdos/${a.id}`, {
        method: "PATCH",
        body: {
          maxAmount: tope === "" ? null : Number(tope),
          quoteThreshold: umbral === "" ? null : Number(umbral),
          quoteRequired: obligatorio,
        },
      });
      setError("");
      onGuardado();
    } catch (e: any) { setError(e.message); }
    finally { setGuardando(false); }
  }

  return (
    <div className="space-y-3 text-[13px]">
      {error && <ErrorBanner message={error} onClose={() => setError("")} />}

      <div className="grid gap-3 sm:grid-cols-3">
        <Dato titulo="Servicios">
          {a.serviciosCubiertos.length === 0 ? "Todos" : a.serviciosCubiertos.join(", ")}
        </Dato>
        <Dato titulo="Documentación exigida">
          {a.condiciones.documentacionExigida.length === 0
            ? "Ninguna" : a.condiciones.documentacionExigida.join(", ")}
        </Dato>
        <Dato titulo="Cancelación">
          {a.condiciones.cancelacionSinCosteMin == null
            ? "Sin política pactada"
            : `Gratis hasta ${a.condiciones.cancelacionSinCosteMin} min antes` +
              (a.condiciones.cancelacionCoste != null
                ? `; después ${a.condiciones.cancelacionCoste}${a.condiciones.cancelacionEnPorcentaje ? " %" : ` ${a.economico.moneda}`}`
                : "")}
        </Dato>
        <Dato titulo="Vigencia">
          {a.validFromMs == null && a.validToMs == null ? "Indefinida"
            : `${a.validFromMs ? new Date(a.validFromMs).toLocaleDateString() : "—"} → ${a.validToMs ? new Date(a.validToMs).toLocaleDateString() : "—"}`}
        </Dato>
        <Dato titulo="SLA de aceptación">
          {a.slaAcceptMin != null ? `${a.slaAcceptMin} min` : "—"}
        </Dato>
        <Dato titulo="Plataforma destino">{a.destino ?? "No es una plataforma externa"}</Dato>
      </div>

      <div className="rounded-lg border border-slate-700 p-3">
        <div className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">
          Límites económicos
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-[12px] text-slate-400">
            <div className="mb-1">Tope del acuerdo ({a.economico.moneda})</div>
            <Input
              value={String(tope)} disabled={!puedeEditar}
              onChange={(e) => setTope(e.target.value)} placeholder="sin tope"
            />
          </label>
          <label className="text-[12px] text-slate-400">
            <div className="mb-1">Presupuesto por encima de</div>
            <Input
              value={String(umbral)} disabled={!puedeEditar}
              onChange={(e) => setUmbral(e.target.value)} placeholder="nunca"
            />
          </label>
          <label className="flex items-center gap-2 text-[12px] text-slate-400">
            <input
              type="checkbox" checked={obligatorio} disabled={!puedeEditar}
              onChange={(e) => setObligatorio(e.target.checked)}
            />
            Presupuesto siempre
          </label>
          {puedeEditar && (
            <Button onClick={() => void guardar()} disabled={guardando}>
              {guardando ? "Guardando…" : "Guardar"}
            </Button>
          )}
        </div>
        <p className="mt-2 text-[11px] text-slate-500">
          El tope descarta al partner; el umbral solo obliga a pedirle precio antes de encargar.
        </p>
      </div>
    </div>
  );
}

function Dato({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{titulo}</div>
      <div className="text-slate-300">{children}</div>
    </div>
  );
}

/* ── Probador ──────────────────────────────────────────────────────────────── */

/**
 * «¿Quién puede con esto?», preguntado al servidor.
 *
 * Existe porque la pregunta que llega a soporte no es quién puede, sino por
 * qué no sale nadie. Sin poder verlo aquí hay que reproducirlo en producción.
 */
function Probador() {
  const [servicio, setServicio] = useState("");
  const [provincia, setProvincia] = useState("");
  const [cp, setCp] = useState("");
  const [importe, setImporte] = useState("");
  const [r, setR] = useState<{ aptos: Candidato[]; descartados: Candidato[] } | null>(null);
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(false);

  async function probar() {
    setCargando(true);
    try {
      const res = await boFetch<{ aptos: Candidato[]; descartados: Candidato[] }>("/acuerdos/evaluar", {
        method: "POST",
        body: {
          servicio: servicio || null,
          provincia: provincia || null,
          codigoPostal: cp || null,
          importeEstimado: importe === "" ? null : Number(importe),
        },
      });
      setR(res);
      setError("");
    } catch (e: any) { setError(e.message); }
    finally { setCargando(false); }
  }

  return (
    <Card className="p-4">
      <h2 className="mb-1 text-sm font-bold text-slate-200">¿Quién puede con esto?</h2>
      <p className="mb-3 text-[11px] text-slate-500">
        Lo contesta el servidor, con las mismas reglas que se aplican al encargar.
      </p>

      {error && <ErrorBanner message={error} onClose={() => setError("")} />}

      <div className="space-y-2">
        <Select value={servicio} onChange={(e) => setServicio(e.target.value)}>
          <option value="">Cualquier servicio</option>
          <option value="tow_truck">Grúa</option>
          <option value="mechanical">Mecánica</option>
          <option value="tyres">Neumáticos</option>
          <option value="battery">Batería</option>
          <option value="fuel">Combustible</option>
          <option value="lockout">Apertura</option>
        </Select>
        <Input value={provincia} onChange={(e) => setProvincia(e.target.value)} placeholder="Provincia" />
        <Input value={cp} onChange={(e) => setCp(e.target.value)} placeholder="Código postal" />
        <Input value={importe} onChange={(e) => setImporte(e.target.value)} placeholder="Importe estimado" />
        <Button onClick={() => void probar()} disabled={cargando}>
          {cargando ? "Consultando…" : "Probar"}
        </Button>
      </div>

      {r && (
        <div className="mt-4 space-y-3">
          <div>
            <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-emerald-400">
              Pueden ({r.aptos.length})
            </div>
            {r.aptos.length === 0 ? (
              <p className="text-[12px] text-slate-500">Ninguno. Los motivos están abajo.</p>
            ) : (
              <ul className="space-y-1">
                {r.aptos.map((c) => (
                  <li key={c.acuerdo.id} className="text-[12px] text-slate-300">
                    {c.empresa}
                    {c.evaluacion.requierePresupuesto && (
                      <Badge className="ml-2 border-violet-500/40 bg-violet-500/10 text-violet-300">
                        pide presupuesto
                      </Badge>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {r.descartados.length > 0 && (
            <div>
              <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-500">
                Descartados ({r.descartados.length})
              </div>
              <ul className="space-y-1">
                {r.descartados.map((c) => (
                  <li key={c.acuerdo.id} className="text-[12px]">
                    <span className="text-slate-400">{c.empresa}</span>
                    <span className="text-slate-600"> — {c.evaluacion.motivos.join("; ")}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
