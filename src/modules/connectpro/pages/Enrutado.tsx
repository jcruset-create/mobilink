/**
 * Connect Pro — a quién se manda cada servicio.
 *
 * Cuatro pestañas que son cuatro preguntas distintas:
 *
 *   · **Criterios** — qué le importa a esta central. Los pesos se editan aquí
 *     y no en el código, que es lo que permite que dos centrales del mismo
 *     Central opinen distinto sin desplegar nada.
 *   · **Reglas** — las excepciones que no son medias: «los camiones, siempre a
 *     Pesadas». Se aplican ANTES de puntuar, porque una exclusión no se
 *     compensa siendo barato.
 *   · **Simular** — el caso concreto, contestado por el servidor. Existe
 *     porque la pregunta que llega es «por qué no salió nadie», y sin poder
 *     verlo aquí hay que reproducirlo en producción.
 *   · **Decisiones** — el historial. Lo que permite contestar «por qué se
 *     mandó a éste» un mes después, cuando ni los pesos ni las reglas son ya
 *     los mismos.
 *
 * Lo que esta pantalla NO hace: puntuar. Ni un solo cálculo de orden vive en
 * el navegador. Si lo hiciera, el panel enseñaría un orden y la API aplicaría
 * otro en cuanto uno de los dos cambiara.
 */

import { Fragment, useCallback, useEffect, useState } from "react";

import { boFetch } from "../services/api";
import { useConnectAuth, hasRole } from "../contexts/ConnectAuthContext";
import { PageTitle, Card, Th, Td, Badge, Input, Select, Button, ErrorBanner, EmptyState } from "../components/ui";

type Pesos = Record<string, number>;

type Regla = {
  id: number; nombre: string; orden: number; activa: boolean;
  condicion: Record<string, any>; accion: string; partners: number[]; ajuste: number;
};

type Puntuado = {
  candidato: { authorizationId: number; nombre: string; requierePresupuesto: boolean };
  puntos: number; motivo: string; notas: Record<string, number>; aportacion: Record<string, number>;
};

type Simulacion = {
  modo: string; pesos: Pesos; elegido: Puntuado | null; candidatos: Puntuado[];
  descartados: { authorizationId: number; nombre: string; motivos: string[] }[];
  reglasAplicadas: { reglaId: number; nombre: string; accion: string }[];
  exigePresupuesto: boolean;
};

const CRITERIOS: { clave: string; etiqueta: string; ayuda: string }[] = [
  { clave: "distancia", etiqueta: "Cercanía", ayuda: "0 km puntúa 1; a 100 km, 0." },
  { clave: "sla", etiqueta: "SLA de llegada", ayuda: "20 min o menos puntúa 1; 120 min, 0." },
  { clave: "aceptacion", etiqueta: "Ratio de aceptación", ayuda: "De cuántos encargos aceptó." },
  { clave: "calidad", etiqueta: "Calidad", ayuda: "La nota de sus talleres, de 0 a 100." },
  { clave: "precio", etiqueta: "Precio", ayuda: "Contra la media de los candidatos, no contra una escala fija." },
  { clave: "rapidez", etiqueta: "Rapidez en contestar", ayuda: "Contestar en 0 min puntúa 1; en 30, 0." },
  { clave: "historial", etiqueta: "Historial", ayuda: "Rodaje, no calidad. Se aplasta a partir de 100 servicios." },
  { clave: "preferencia", etiqueta: "Es preferente", ayuda: "La marca del acuerdo." },
];

const ACCIONES = [
  { v: "excluir", t: "Excluir" },
  { v: "forzar", t: "Forzar" },
  { v: "preferir", t: "Preferir (+puntos)" },
  { v: "penalizar", t: "Penalizar (−puntos)" },
  { v: "exigir_presupuesto", t: "Exigir presupuesto" },
];

export default function Enrutado() {
  const { user } = useConnectAuth();
  const puedeEditar = hasRole(user, "supervisor");
  const puedeCambiarModo = hasRole(user, "cc_admin");

  const [pestana, setPestana] = useState<"criterios" | "reglas" | "simular" | "decisiones">("criterios");
  const [pesos, setPesos] = useState<Pesos>({});
  const [modo, setModo] = useState("suggest");
  const [reglas, setReglas] = useState<Regla[]>([]);
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(true);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const r = await boFetch<{ pesos: Pesos; modo: string; reglas: Regla[] }>("/enrutado/config");
      setPesos(r.pesos ?? {});
      setModo(r.modo ?? "suggest");
      setReglas(r.reglas ?? []);
      setError("");
    } catch (e: any) { setError(e.message); }
    finally { setCargando(false); }
  }, []);

  useEffect(() => { void cargar(); }, [cargar]);

  const total = CRITERIOS.reduce((s, c) => s + (pesos[c.clave] ?? 0), 0);

  async function guardarPesos() {
    try {
      await boFetch("/enrutado/config/pesos", { method: "PUT", body: { pesos } });
      setError("");
    } catch (e: any) { setError(e.message); }
  }

  async function cambiarModo(nuevo: string) {
    try {
      const r = await boFetch<{ modo: string }>("/enrutado/config/modo", { method: "PUT", body: { modo: nuevo } });
      setModo(r.modo);
    } catch (e: any) { setError(e.message); }
  }

  return (
    <div className="space-y-4">
      <PageTitle
        title="Enrutado"
        subtitle="A quién se manda cada servicio, y por qué."
        actions={
          <div className="flex items-center gap-2">
            <Badge className={modo === "auto"
              ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
              : "border-slate-600 text-slate-400"}>
              {modo === "auto" ? "Encarga solo" : "Solo sugiere"}
            </Badge>
            {puedeCambiarModo && (
              <Button
                variant="ghost"
                onClick={() => void cambiarModo(modo === "auto" ? "suggest" : "auto")}
              >
                {modo === "auto" ? "Volver a sugerir" : "Pasar a automático"}
              </Button>
            )}
          </div>
        }
      />

      {error && <ErrorBanner message={error} onClose={() => setError("")} />}

      {modo === "auto" && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[13px] text-amber-200">
          En automático sale una grúa sin que nadie mire. Revisa las reglas en el simulador antes de dejarlo así.
        </div>
      )}

      <div className="flex gap-1 border-b border-slate-700">
        {([
          ["criterios", "Criterios"], ["reglas", `Reglas (${reglas.length})`],
          ["simular", "Simular"], ["decisiones", "Decisiones"],
        ] as const).map(([k, t]) => (
          <button
            key={k}
            onClick={() => setPestana(k)}
            className={`px-3 py-2 text-sm font-bold ${
              pestana === k ? "border-b-2 border-orange-500 text-orange-300" : "text-slate-400 hover:text-slate-200"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {cargando ? (
        <p className="text-sm text-slate-500">Cargando…</p>
      ) : pestana === "criterios" ? (
        <Card className="p-4">
          <p className="mb-4 text-[13px] text-slate-400">
            Los pesos son relativos: lo que importa es la proporción entre ellos, no que sumen 100.
            Ahora suman <strong className="text-slate-200">{total}</strong>.
          </p>
          <div className="space-y-3">
            {CRITERIOS.map((c) => (
              <div key={c.clave} className="grid grid-cols-[minmax(0,10rem)_1fr_3rem] items-center gap-3">
                <div>
                  <div className="text-[13px] font-semibold text-slate-200">{c.etiqueta}</div>
                  <div className="text-[11px] text-slate-500">{c.ayuda}</div>
                </div>
                <input
                  type="range" min={0} max={50} value={pesos[c.clave] ?? 0}
                  disabled={!puedeEditar}
                  onChange={(e) => setPesos({ ...pesos, [c.clave]: Number(e.target.value) })}
                  className="w-full accent-orange-500"
                />
                <div className="text-right text-[13px] text-slate-300">
                  {total > 0 ? `${Math.round(((pesos[c.clave] ?? 0) / total) * 100)} %` : "—"}
                </div>
              </div>
            ))}
          </div>
          {puedeEditar && (
            <div className="mt-4">
              <Button onClick={() => void guardarPesos()}>Guardar criterios</Button>
            </div>
          )}
        </Card>
      ) : pestana === "reglas" ? (
        <Reglas reglas={reglas} puedeEditar={puedeEditar} onCambio={cargar} />
      ) : pestana === "simular" ? (
        <Simulador />
      ) : (
        <Decisiones />
      )}
    </div>
  );
}

/* ── Reglas ────────────────────────────────────────────────────────────────── */

function Reglas({ reglas, puedeEditar, onCambio }: {
  reglas: Regla[]; puedeEditar: boolean; onCambio: () => void;
}) {
  const [nombre, setNombre] = useState("");
  const [accion, setAccion] = useState("preferir");
  const [error, setError] = useState("");

  async function crear() {
    try {
      await boFetch("/enrutado/reglas", { method: "POST", body: { name: nombre, action: accion } });
      setNombre("");
      onCambio();
    } catch (e: any) { setError(e.message); }
  }

  async function borrar(id: number, texto: string) {
    if (!confirm(`Borrar la regla «${texto}»?`)) return;
    try {
      await boFetch(`/enrutado/reglas/${id}`, { method: "DELETE" });
      onCambio();
    } catch (e: any) { setError(e.message); }
  }

  async function alternar(r: Regla) {
    try {
      await boFetch(`/enrutado/reglas/${r.id}`, { method: "PATCH", body: { active: !r.activa } });
      onCambio();
    } catch (e: any) { setError(e.message); }
  }

  return (
    <div className="space-y-3">
      {error && <ErrorBanner message={error} onClose={() => setError("")} />}

      <Card>
        <p className="px-4 pt-3 text-[13px] text-slate-400">
          Se aplican en orden, de menor a mayor. Una exclusión no se compensa siendo barato:
          por eso van antes de puntuar.
        </p>
        {reglas.length === 0 ? (
          <EmptyState message="Sin reglas: se elige solo por los criterios." />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr><Th>Orden</Th><Th>Regla</Th><Th>Acción</Th><Th>Partners</Th><Th></Th></tr>
            </thead>
            <tbody>
              {reglas.map((r) => (
                <tr key={r.id} className={r.activa ? "" : "opacity-50"}>
                  <Td className="text-slate-500">{r.orden}</Td>
                  <Td>
                    <div className="font-semibold text-slate-100">{r.nombre}</div>
                    <div className="text-[11px] text-slate-500">{resumirCondicion(r.condicion)}</div>
                  </Td>
                  <Td>
                    <Badge className="border-slate-600 text-slate-300">
                      {ACCIONES.find((a) => a.v === r.accion)?.t ?? r.accion}
                      {(r.accion === "preferir" || r.accion === "penalizar") && ` ${Math.abs(r.ajuste)}`}
                    </Badge>
                  </Td>
                  <Td className="text-slate-400">
                    {r.partners.length === 0 ? "Todos los que encajen" : `${r.partners.length}`}
                  </Td>
                  <Td>
                    {puedeEditar && (
                      <div className="flex gap-2">
                        <Button variant="ghost" onClick={() => void alternar(r)}>
                          {r.activa ? "Desactivar" : "Activar"}
                        </Button>
                        <Button variant="danger" onClick={() => void borrar(r.id, r.nombre)}>Borrar</Button>
                      </div>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {puedeEditar && (
        <Card className="p-4">
          <h3 className="mb-2 text-sm font-bold text-slate-200">Nueva regla</h3>
          <div className="flex flex-wrap items-end gap-2">
            <Input
              value={nombre} onChange={(e) => setNombre(e.target.value)}
              placeholder="Nombre que la explique, p. ej. «Camiones a Pesadas»"
              className="min-w-[18rem]"
            />
            <Select value={accion} onChange={(e) => setAccion(e.target.value)}>
              {ACCIONES.map((a) => <option key={a.v} value={a.v}>{a.t}</option>)}
            </Select>
            <Button onClick={() => void crear()} disabled={!nombre.trim()}>Crear</Button>
          </div>
          <p className="mt-2 text-[11px] text-slate-500">
            Se crea sin condiciones, o sea aplicando siempre. Ajústala antes de activarla en automático.
          </p>
        </Card>
      )}
    </div>
  );
}

function resumirCondicion(c: Record<string, any>): string {
  const partes: string[] = [];
  if (c.servicios?.length) partes.push(`servicios: ${c.servicios.join(", ")}`);
  if (c.provincias?.length) partes.push(`provincias: ${c.provincias.join(", ")}`);
  if (c.codigosPostales?.length) partes.push(`CP: ${c.codigosPostales.join(", ")}`);
  if (c.tiposVehiculo?.length) partes.push(`vehículo: ${c.tiposVehiculo.join(", ")}`);
  if (c.prioridades?.length) partes.push(`prioridad: ${c.prioridades.join(", ")}`);
  if (c.importeDesde != null) partes.push(`desde ${c.importeDesde}`);
  if (c.desdeMinuto != null && c.hastaMinuto != null) partes.push("con franja horaria");
  return partes.length === 0 ? "Sin condiciones: aplica siempre" : partes.join(" · ");
}

/* ── Simulador ─────────────────────────────────────────────────────────────── */

function Simulador() {
  const [servicio, setServicio] = useState("");
  const [provincia, setProvincia] = useState("");
  const [cp, setCp] = useState("");
  const [prioridad, setPrioridad] = useState("");
  const [r, setR] = useState<Simulacion | null>(null);
  const [error, setError] = useState("");

  async function simular() {
    try {
      setR(await boFetch<Simulacion>("/enrutado/simular", {
        method: "POST",
        body: {
          servicio: servicio || null, provincia: provincia || null,
          codigoPostal: cp || null, prioridad: prioridad || null,
        },
      }));
      setError("");
    } catch (e: any) { setError(e.message); }
  }

  return (
    <div className="space-y-3">
      {error && <ErrorBanner message={error} onClose={() => setError("")} />}

      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-2">
          <Select value={servicio} onChange={(e) => setServicio(e.target.value)}>
            <option value="">Cualquier servicio</option>
            <option value="tow_truck">Grúa</option>
            <option value="mechanical">Mecánica</option>
            <option value="tyres">Neumáticos</option>
            <option value="battery">Batería</option>
          </Select>
          <Input value={provincia} onChange={(e) => setProvincia(e.target.value)} placeholder="Provincia" />
          <Input value={cp} onChange={(e) => setCp(e.target.value)} placeholder="Código postal" />
          <Select value={prioridad} onChange={(e) => setPrioridad(e.target.value)}>
            <option value="">Prioridad normal</option>
            <option value="urgente">Urgente</option>
          </Select>
          <Button onClick={() => void simular()}>Simular</Button>
        </div>
        <p className="mt-2 text-[11px] text-slate-500">
          No encarga nada y no queda en el historial de decisiones.
        </p>
      </Card>

      {r && (
        <>
          {r.elegido ? (
            <Card className="p-4">
              <div className="text-[11px] font-bold uppercase tracking-wide text-emerald-400">Se mandaría a</div>
              <div className="mt-1 flex flex-wrap items-baseline gap-3">
                <span className="text-lg font-black text-slate-100">{r.elegido.candidato.nombre}</span>
                <span className="text-sm text-slate-400">{r.elegido.puntos} puntos</span>
                <span className="text-[13px] text-slate-500">{r.elegido.motivo}</span>
                {r.exigePresupuesto && (
                  <Badge className="border-violet-500/40 bg-violet-500/10 text-violet-300">
                    hay que pedirle presupuesto
                  </Badge>
                )}
              </div>
            </Card>
          ) : (
            <Card className="p-4">
              <p className="text-sm font-bold text-red-300">No hay ningún partner disponible.</p>
              <p className="mt-1 text-[12px] text-slate-500">Los motivos están más abajo.</p>
            </Card>
          )}

          {r.reglasAplicadas.length > 0 && (
            <Card className="p-4">
              <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-500">
                Reglas que dispararon
              </div>
              <ul className="text-[13px] text-slate-300">
                {r.reglasAplicadas.map((x) => (
                  <li key={x.reglaId}>{x.nombre} — {x.accion}</li>
                ))}
              </ul>
            </Card>
          )}

          {r.candidatos.length > 0 && (
            <Card>
              <table className="w-full text-sm">
                <thead>
                  <tr><Th>Partner</Th><Th>Puntos</Th><Th>Por qué</Th><Th>Dónde puntúa</Th></tr>
                </thead>
                <tbody>
                  {r.candidatos.map((c) => (
                    <tr key={c.candidato.authorizationId}>
                      <Td className="font-semibold text-slate-100">{c.candidato.nombre}</Td>
                      <Td className="text-slate-300">{c.puntos}</Td>
                      <Td className="text-slate-400">{c.motivo}</Td>
                      <Td>
                        <div className="flex flex-wrap gap-1">
                          {Object.entries(c.aportacion)
                            .filter(([, v]) => v > 0)
                            .sort((a, b) => b[1] - a[1])
                            .slice(0, 3)
                            .map(([k, v]) => (
                              <Badge key={k} className="border-slate-700 text-slate-400">
                                {k} {v}
                              </Badge>
                            ))}
                        </div>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}

          {r.descartados.length > 0 && (
            <Card className="p-4">
              <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-500">
                Descartados ({r.descartados.length})
              </div>
              <ul className="space-y-1 text-[12px]">
                {r.descartados.map((d) => (
                  <li key={d.authorizationId}>
                    <span className="text-slate-400">{d.nombre}</span>
                    <span className="text-slate-600"> — {d.motivos.join("; ")}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

/* ── Historial ─────────────────────────────────────────────────────────────── */

function Decisiones() {
  const [data, setData] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [abierta, setAbierta] = useState<number | null>(null);

  useEffect(() => {
    boFetch<{ data: any[] }>("/enrutado/decisiones")
      .then((r) => setData(r.data ?? []))
      .catch((e) => setError(e.message));
  }, []);

  return (
    <div className="space-y-3">
      {error && <ErrorBanner message={error} onClose={() => setError("")} />}
      <Card>
        <p className="px-4 pt-3 text-[13px] text-slate-400">
          Cada decisión con los candidatos y los pesos que había ese día. Es lo que permite
          explicarla cuando ya no son los mismos.
        </p>
        {data.length === 0 ? (
          <EmptyState message="Todavía no se ha enrutado nada." />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr><Th>Cuándo</Th><Th>Asistencia</Th><Th>Elegido</Th><Th>Quién</Th></tr>
            </thead>
            <tbody>
              {data.map((d) => {
                const candidatos = seguro(d.candidates);
                const elegido = candidatos.find((c: any) => c.authorizationId === d.chosenAuthorizationId);
                return (
                  <Fragment key={d.id}>
                    <tr
                      className="cursor-pointer hover:bg-slate-800/50"
                      onClick={() => setAbierta(abierta === d.id ? null : d.id)}
                    >
                      <Td className="text-slate-400">{new Date(Number(d.createdAtMs)).toLocaleString()}</Td>
                      <Td className="text-slate-300">{d.assistanceId ?? "—"}</Td>
                      <Td className="font-semibold text-slate-100">
                        {elegido?.nombre ?? "ninguno"}
                        {elegido && <span className="ml-2 text-[12px] text-slate-500">{elegido.puntos}</span>}
                      </Td>
                      <Td className="text-slate-500">{d.decidedBy}</Td>
                    </tr>
                    {abierta === d.id && (
                      <tr>
                        <td colSpan={4} className="bg-slate-900/60 px-4 py-3 text-[12px]">
                          <div className="mb-2 text-slate-400">
                            Contexto: {JSON.stringify(seguroObj(d.context))}
                          </div>
                          <ul className="space-y-1">
                            {candidatos.map((c: any) => (
                              <li key={c.authorizationId} className="text-slate-300">
                                {c.nombre} · {c.puntos} · <span className="text-slate-500">{c.motivo}</span>
                              </li>
                            ))}
                          </ul>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

/** Lo guardado puede ser viejo: leerlo mal no puede tumbar la pantalla. */
function seguro(v: unknown): any[] {
  try { const o = typeof v === "string" ? JSON.parse(v) : v; return Array.isArray(o) ? o : []; }
  catch { return []; }
}
function seguroObj(v: unknown): Record<string, unknown> {
  try { const o = typeof v === "string" ? JSON.parse(v) : v; return o && typeof o === "object" ? o : {}; }
  catch { return {}; }
}
