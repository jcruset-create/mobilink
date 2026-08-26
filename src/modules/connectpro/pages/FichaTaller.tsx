/**
 * Connect Pro — Ficha de taller: operarios (con teléfono para llamarles),
 * unidades móviles, panel Lite, KPIs y asistencias del taller.
 * Ruta: /connect/empresas/:id/talleres/:wid
 */

import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { boFetch } from "../services/api";
import { useConnectAuth, hasRole } from "../contexts/ConnectAuthContext";
import { PageTitle, Card, Th, Td, Badge, Input, Button, ErrorBanner, EmptyState } from "../components/ui";
import TablaUnidades from "../components/TablaUnidades";
import Fotos from "../components/Fotos";
import BotonCoordenadas from "../components/BotonCoordenadas";
import TarjetaOperario, { type Operator } from "../components/TarjetaOperario";
import { LitePanel } from "./Talleres";
import {
  ASSISTANCE_STATUS_LABELS, ASSISTANCE_STATUS_STYLES, WORKSHOP_TIER, WORKSHOP_TIER_LABELS,
  WORKSHOP_TIER_STYLES, fmtDateTime, type WorkshopIntegrationType, type ServiceType,
} from "../types";

type Workshop = {
  id: number; name: string; phone: string | null; latitude: number; longitude: number;
  radiusKm: number; connectStatus: string; currentScore: number; providerName: string | null;
  providerCompanyId: number | null; integrationType: WorkshopIntegrationType;
  networkParticipation: boolean; liteCode: string | null;
  address: string | null; postalCode: string | null; city: string | null; province: string | null;
  email: string | null; commercialNetwork: string | null; openingHours: string | null;
  notes: string | null; services: string | null;
};

/** Dirección postal en una línea, saltando lo que el taller no tenga informado. */
function direccionCompleta(w: Workshop): string {
  return [w.address, [w.postalCode, w.city].filter(Boolean).join(" "), w.province]
    .map((p) => p?.trim()).filter(Boolean).join(", ");
}

type Kpis = Record<string, number | null>;

const KPI_LABELS: Record<string, string> = {
  services: "Servicios", finished: "Finalizados", acceptanceRate: "% aceptación",
  slaCompliance: "% SLA", avgAcceptMin: "Aceptación (min)", avgTravelMin: "Desplazamiento (min)",
  avgWorkMin: "Trabajo (min)", avgStatusQuality: "Calidad de estados",
};

const TABS = ["Ficha", "Operarios", "Unidades móviles", "KPIs", "Asistencias"] as const;

/*
 * Los datos del taller, en el orden en que se preguntan al darlo de alta.
 * La ubicación va aquí y no solo en el alta porque un taller se muda, y hasta
 * ahora mover el punto del mapa obligaba a borrarlo y volverlo a crear.
 */
const CAMPOS_TALLER: [string, string, string][] = [
  ["name", "Nombre", "w-72"],
  ["phone", "Teléfono", "w-40"],
  ["email", "Email", "w-64"],
  ["address", "Dirección", "w-72"],
  ["postalCode", "Código postal", "w-28"],
  ["city", "Municipio", "w-48"],
  ["province", "Provincia", "w-40"],
  ["commercialNetwork", "Red comercial", "w-48"],
  ["openingHours", "Horario", "w-64"],
  ["latitude", "Latitud", "w-32"],
  ["longitude", "Longitud", "w-32"],
  ["radiusKm", "Radio (km)", "w-24"],
  ["notes", "Notas", "w-full"],
];

export default function FichaTaller() {
  const { id: empresaId, wid } = useParams();
  const { user } = useConnectAuth();
  const canEdit = hasRole(user, "cc_admin");
  const canOperate = hasRole(user, "operator");

  const [w, setW] = useState<Workshop | null>(null);
  const [tab, setTab] = useState<(typeof TABS)[number]>("Ficha");
  /** Borrador de la ficha mientras se edita; null cuando solo se está mirando. */
  const [edicion, setEdicion] = useState<Record<string, string> | null>(null);
  /*
   * Lo que el taller sabe hacer. No es decoración: es lo que decide si se le
   * puede mandar un camión con un problema de mecánica o solo de neumático.
   * Se guarda al pulsar, sin esperar al boton de la ficha, porque marcar una
   * casilla y que no pase nada visible se presta a creer que ya está guardado.
   */
  const [servicios, setServicios] = useState<ServiceType[]>([]);

  const serviciosDelTaller = (w: Workshop | null): string[] => {
    try { const v = JSON.parse(w?.services ?? "[]"); return Array.isArray(v) ? v.map(String) : []; }
    catch { return []; }
  };

  const cambiarServicio = async (code: string, activo: boolean) => {
    if (!w) return;
    const actuales = new Set(serviciosDelTaller(w));
    if (activo) actuales.add(code); else actuales.delete(code);
    setBusy(true); setError(null);
    try {
      await boFetch(`/workshops/${wid}`, {
        method: "PATCH", body: { services: JSON.stringify([...actuales]) },
      });
      load();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };
  const [operators, setOperators] = useState<Operator[]>([]);
  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [asistencias, setAsistencias] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [contacto, setContacto] = useState({ name: "", phone: "", role: "" });

  const load = useCallback(() => {
    boFetch<Workshop>(`/workshops/${wid}`).then(setW).catch((e) => setError(e.message));
    boFetch<{ data: Operator[] }>(`/workshops/${wid}/operators`).then((r) => setOperators(r.data)).catch(() => {});
  }, [wid]);
  useEffect(load, [load]);

  useEffect(() => {
    boFetch<{ service_types: ServiceType[] }>("/catalogs")
      .then((r) => setServicios(r.service_types.filter((t) => t.active)))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (tab === "KPIs") boFetch<Kpis>(`/workshops/${wid}/kpis?days=30`).then(setKpis).catch(() => {});
    if (tab === "Asistencias") {
      boFetch<{ data: any[] }>(`/assistances?workshopId=${wid}&limit=50`).then((r) => setAsistencias(r.data)).catch(() => {});
    }
  }, [tab, wid]);

  /*
   * Guardar la ficha entera. La ubicación viaja como número porque el
   * servidor la rechaza de otro modo: un taller con la latitud en blanco
   * dejaría de encontrarse en las búsquedas por cercanía.
   */
  const guardarFicha = async () => {
    if (!edicion) return;
    const lat = Number(edicion.latitude);
    const lng = Number(edicion.longitude);
    const radio = Number(edicion.radiusKm);
    if (!edicion.name?.trim()) { setError("El taller necesita un nombre."); return; }
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      setError("Latitud y longitud tienen que ser números: sin ubicación el taller no se encuentra por cercanía.");
      return;
    }
    if (!Number.isFinite(radio) || radio <= 0) { setError("El radio tiene que ser un número de kilómetros."); return; }
    setBusy(true); setError(null);
    try {
      await boFetch(`/workshops/${wid}`, {
        method: "PATCH",
        body: { ...edicion, latitude: lat, longitude: lng, radiusKm: radio },
      });
      setEdicion(null);
      load();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  const añadirContacto = async () => {
    if (!contacto.name.trim()) { setError("El nombre del contacto es obligatorio."); return; }
    setBusy(true);
    try {
      await boFetch(`/workshops/${wid}/contacts`, { method: "POST", body: contacto });
      setContacto({ name: "", phone: "", role: "" });
      load();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  if (!w) return <p className="text-sm text-slate-500">{error ?? "Cargando…"}</p>;

  return (
    <div>
      <PageTitle
        title={w.name}
        subtitle={
          <span>
            <Link className="text-cyan-300 hover:underline" to={`/connect/empresas/${empresaId ?? w.providerCompanyId ?? ""}`}>
              ← {w.providerName ?? "Empresa"}
            </Link>
            {" · "}
            <Badge className={WORKSHOP_TIER_STYLES[w.integrationType]}>
              {WORKSHOP_TIER[w.integrationType]} · {WORKSHOP_TIER_LABELS[w.integrationType]}
            </Badge>
            {w.commercialNetwork && <span className="ml-2 text-slate-400">Red {w.commercialNetwork}</span>}
            {w.liteCode && <span className="ml-2 font-mono text-[12px] text-violet-300">Código app: {w.liteCode}</span>}
            {w.phone && <a className="ml-3 text-cyan-300 hover:underline" href={`tel:${w.phone}`}>📞 {w.phone}</a>}
            <a
              className="ml-3 text-cyan-300 hover:underline" target="_blank" rel="noreferrer"
              href={`https://www.google.com/maps?q=${w.latitude},${w.longitude}`}
            >
              Ver en mapa ↗
            </a>
          </span>
        }
      />
      {error && <ErrorBanner message={error} onClose={() => setError(null)} />}

      {(direccionCompleta(w) || w.email || w.openingHours || w.notes) && (
        <Card className="mb-3 flex flex-wrap gap-x-8 gap-y-2 p-4 text-[13px]">
          {direccionCompleta(w) && (
            <div>
              <div className="text-[11px] uppercase tracking-wide text-slate-500">Dirección</div>
              <div className="text-slate-200">{direccionCompleta(w)}</div>
            </div>
          )}
          {w.email && (
            <div>
              <div className="text-[11px] uppercase tracking-wide text-slate-500">Email</div>
              <a className="text-cyan-300 hover:underline" href={`mailto:${w.email}`}>{w.email}</a>
            </div>
          )}
          {w.openingHours && (
            <div>
              <div className="text-[11px] uppercase tracking-wide text-slate-500">Horario</div>
              <div className="text-slate-200">{w.openingHours}</div>
            </div>
          )}
          {w.notes && (
            <div className="w-full">
              <div className="text-[11px] uppercase tracking-wide text-slate-500">Observaciones</div>
              <div className="whitespace-pre-line text-slate-200">{w.notes}</div>
            </div>
          )}
        </Card>
      )}

      <div className="mb-3 flex gap-1">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-lg px-3 py-1.5 text-[13px] font-medium ${tab === t ? "bg-cyan-600/20 text-cyan-300" : "text-slate-400 hover:bg-slate-800"}`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "Ficha" && (
        <div className="flex flex-col gap-3">
          {canEdit && (
            <div className="flex items-center gap-2">
              {edicion === null ? (
                <Button variant="ghost" onClick={() => setEdicion(Object.fromEntries(
                  CAMPOS_TALLER.map(([c]) => [c, String((w as any)[c] ?? "")])))}>
                  ✎ Editar ficha
                </Button>
              ) : (
                <>
                  <Button disabled={busy} onClick={guardarFicha}>Guardar cambios</Button>
                  <Button variant="ghost" disabled={busy} onClick={() => setEdicion(null)}>Cancelar</Button>
                  <span className="text-[12px] text-slate-500">
                    Se guarda todo de una vez; lo que dejes en blanco se borra.
                  </span>
                </>
              )}
            </div>
          )}

          <Card className="p-4">
            <h3 className="mb-3 text-sm font-semibold text-cyan-300">Datos del taller</h3>
            {edicion === null ? (
              <div className="grid grid-cols-1 gap-x-8 gap-y-1 md:grid-cols-2">
                {CAMPOS_TALLER.map(([campo, etiqueta]) => (
                  <div key={campo} className="flex items-baseline gap-2 border-b border-slate-700/40 py-1.5 text-[13px]">
                    <span className="w-36 shrink-0 text-slate-500">{etiqueta}</span>
                    <span className="text-slate-200">
                      {String((w as any)[campo] ?? "") || <span className="text-slate-600">—</span>}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-wrap items-end gap-2">
                {CAMPOS_TALLER.map(([campo, etiqueta, ancho]) => (
                  <label key={campo} className={`flex flex-col gap-1 ${campo === "notes" ? "w-full" : ""}`}>
                    <span className="text-[11px] uppercase tracking-wide text-slate-500">{etiqueta}</span>
                    <Input
                      value={edicion[campo] ?? ""}
                      className={ancho}
                      onChange={(e) => setEdicion({ ...edicion, [campo]: e.target.value })}
                    />
                  </label>
                ))}
                <BotonCoordenadas
                  direccion={{
                    address: edicion.address, postalCode: edicion.postalCode,
                    city: edicion.city, province: edicion.province,
                  }}
                  onEncontrado={(p) => setEdicion({
                    ...edicion, latitude: String(p.lat), longitude: String(p.lng),
                  })}
                  onError={setError}
                />
              </div>
            )}
            <p className="mt-3 text-[12px] text-slate-500">
              El producto (Assist, Lite o externo) y la adhesión a la red se cambian desde el listado
              de talleres: llevan su propio registro de quién los cambió y cuándo.
            </p>
          </Card>

          <Card className="p-4">
            <h3 className="mb-1 text-sm font-semibold text-cyan-300">Servicios que puede atender</h3>
            <p className="mb-3 text-[12px] text-slate-500">
              Es lo que se mira antes de mandarle un vehículo: un taller que solo hace neumático no
              puede resolver una avería mecánica, y enviarlo allí es un viaje perdido y un SLA
              incumplido.
            </p>
            {serviciosDelTaller(w).length === 0 && (
              <div className="mb-3 rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-[13px] text-amber-300">
                Sin ningún servicio marcado, el reparto entiende que este taller acepta
                cualquiera y le mandará de todo. Marca lo que sepa hacer.
              </div>
            )}
            {servicios.length === 0 ? (
              <p className="text-[13px] text-slate-500">No hay catálogo de servicios configurado.</p>
            ) : (
              <div className="flex flex-wrap gap-x-6 gap-y-2">
                {servicios.map((t) => {
                  const puestos = serviciosDelTaller(w);
                  return (
                    <label key={t.code} className="flex items-center gap-1.5 text-[13px] text-slate-300">
                      <input
                        type="checkbox"
                        disabled={!canEdit || busy}
                        checked={puestos.includes(t.code)}
                        onChange={(e) => cambiarServicio(t.code, e.target.checked)}
                      />
                      {t.name}
                    </label>
                  );
                })}
              </div>
            )}
          </Card>

          <Fotos
            endpoint={`/workshops/${wid}/photos`}
            borrarBase="/workshops/photos"
            canEdit={canEdit}
            titulo="Fotos del taller"
            ayuda="La fachada para reconocerlo al llegar, el acceso para saber si entra un camión y por dónde, y el interior para ver con qué se cuenta."
            categorias={[["fachada", "Fachada"], ["accesos", "Accesos"], ["interior", "Interior"], ["otros", "Otras"]]}
          />
        </div>
      )}

      {tab === "Operarios" && (
        <div className="flex flex-col gap-4">
          {operators.length === 0 ? (
            <EmptyState message={
              w.integrationType === "external"
                ? "Taller externo sin contactos todavía: añade abajo a quién llamar."
                : "Sin operarios registrados en este taller."
            } />
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {operators.map((op) => <TarjetaOperario key={`${op.source}-${op.id}`} op={op} />)}
            </div>
          )}

          {canOperate && (
            <Card className="p-4">
              <h3 className="mb-2 text-[13px] font-semibold text-slate-300">Añadir contacto manual (encargado, centralita…)</h3>
              <div className="flex flex-wrap gap-2">
                <Input placeholder="Nombre *" value={contacto.name} onChange={(e) => setContacto({ ...contacto, name: e.target.value })} className="w-48" />
                <Input placeholder="Teléfono" value={contacto.phone} onChange={(e) => setContacto({ ...contacto, phone: e.target.value })} className="w-36" />
                <Input placeholder="Cargo" value={contacto.role} onChange={(e) => setContacto({ ...contacto, role: e.target.value })} className="w-40" />
                <Button onClick={añadirContacto} disabled={busy}>Añadir</Button>
              </div>
            </Card>
          )}

          {w.integrationType === "lite" && (
            <LitePanel workshop={w as any} canEdit={canEdit} onError={setError} />
          )}
        </div>
      )}

      {tab === "Unidades móviles" && (
        <div className="flex flex-col gap-3">
          {w.integrationType === "lite" && (
            <p className="text-[13px] text-slate-400">
              Un taller Lite no tiene GPS de flota: la posición sale del móvil de sus operarios
              durante cada asistencia, así que sus furgonetas se dan de alta aquí a mano. Los
              operarios y sus dispositivos están en la pestaña Operarios.
            </p>
          )}
          <TablaUnidades
            endpoint={`/workshops/${wid}/mobile-units`}
            canMove={canEdit}
            workshops={w ? [{ id: w.id, name: w.name }] : []}
            workshopId={Number(wid)}
            puedeAltaManual
          />
        </div>
      )}

      {tab === "KPIs" && (
        !kpis ? <p className="text-sm text-slate-500">Cargando…</p> : (
          <div className="flex flex-wrap gap-2">
            {Object.entries(KPI_LABELS).map(([key, label]) => (
              <div key={key} className="rounded-lg border border-slate-700 px-4 py-3">
                <div className="text-[11px] uppercase tracking-wide text-slate-500">{label}</div>
                <div className="text-[18px] font-bold text-slate-100">{kpis[key] ?? "—"}</div>
              </div>
            ))}
          </div>
        )
      )}

      {tab === "Asistencias" && (
        asistencias.length === 0 ? <EmptyState message="Sin asistencias registradas en este taller." /> : (
          <Card className="overflow-x-auto">
            <table className="w-full">
              <thead><tr className="border-b border-slate-700">
                <Th>Asistencia</Th><Th>Estado</Th><Th>Cliente</Th><Th>Dirección</Th><Th>Creada</Th>
              </tr></thead>
              <tbody>
                {asistencias.map((a) => (
                  <tr key={a.id} className="border-b border-slate-700/50 hover:bg-slate-700/30">
                    <Td>
                      <Link className="text-cyan-300 hover:underline" to={`/connect/asistencias/${a.id}`}>
                        #{a.id}{a.expedientNumber ? ` · ${a.expedientNumber}` : ""}
                      </Link>
                    </Td>
                    <Td>
                      <Badge className={ASSISTANCE_STATUS_STYLES[a.status] ?? "border-slate-600 text-slate-400"}>
                        {ASSISTANCE_STATUS_LABELS[a.status] ?? a.status}
                      </Badge>
                    </Td>
                    <Td>{a.customerName || a.clientName || "-"}</Td>
                    <Td className="max-w-[280px] truncate">{a.address}</Td>
                    <Td className="whitespace-nowrap text-[12px] text-slate-500">{fmtDateTime(Number(a.createdAtMs))}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )
      )}
    </div>
  );
}
