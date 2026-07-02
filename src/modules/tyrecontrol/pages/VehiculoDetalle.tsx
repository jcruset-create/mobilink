import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { obtenerVehiculo, listarPosiciones, listarMontajesVehiculo } from "../services/data";
import type { MontajeActual, PosicionVehiculo, Vehiculo } from "../types";
import { ORIGEN_KM_LABELS } from "../types";
import { Badge } from "../components/ui";
import VehicleLayoutImage from "../components/VehicleLayoutImage";
import { useTyreAuth } from "../contexts/TyreAuthContext";

export default function VehiculoDetalle() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { perfil } = useTyreAuth();
  const esCliente = perfil?.rol === "cliente" && !perfil?.es_superadmin;
  const [v, setV] = useState<Vehiculo | null>(null);
  const [posiciones, setPosiciones] = useState<PosicionVehiculo[]>([]);
  const [montajes, setMontajes] = useState<MontajeActual[]>([]);

  async function cargar() {
    const veh = await obtenerVehiculo(id);
    setV(veh);
    if (veh?.tipo_vehiculo_id) setPosiciones(await listarPosiciones(veh.tipo_vehiculo_id));
    setMontajes(await listarMontajesVehiculo(id));
  }
  useEffect(() => { void cargar(); /* eslint-disable-next-line */ }, [id]);

  const dato = (l: string, val?: string | null) => (
    <div><div className="text-[10px] text-slate-400">{l}</div><div className="text-sm text-slate-200">{val || "—"}</div></div>
  );

  if (!v) return <div className="text-slate-400">Cargando ficha…</div>;

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <button onClick={() => navigate("/tyrecontrol/vehiculos")} className="rounded bg-slate-800 px-3 py-1 text-[12px] text-slate-200">← Vehículos</button>
        <h1 className="text-lg font-black">{v.matricula}</h1>
        <Badge ok={v.activo}>{v.activo ? "Activo" : "Inactivo"}</Badge>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {/* Datos generales */}
        <div className="rounded-lg bg-slate-800 p-3">
          <div className="mb-2 text-[11px] font-bold uppercase text-slate-400">Datos generales</div>
          <div className="grid gap-2 sm:grid-cols-2">
            {dato("Empresa", v.empresa?.nombre)}{dato("Delegación", v.delegacion?.nombre)}
            {dato("Marca", v.marca)}{dato("Modelo", v.modelo)}
            {dato("Tipo", v.tipo?.descripcion ?? v.tipo?.nombre)}{dato("Bastidor", v.bastidor)}
            {dato("Fecha matriculación", v.fecha_matriculacion)}{dato("Webfleet ID", v.webfleet_vehicle_id)}
          </div>
        </div>

        {/* Kilometraje */}
        <div className="rounded-lg bg-slate-800 p-3">
          <div className="mb-2 text-[11px] font-bold uppercase text-slate-400">Kilometraje</div>
          <div className="text-3xl font-black">{Number(v.km_actual).toLocaleString("es-ES")} <span className="text-sm font-normal text-slate-400">km</span></div>
          <div className="mt-1 text-xs text-slate-500">Origen: {ORIGEN_KM_LABELS[v.origen_km]}</div>
        </div>
      </div>

      {/* Plano gráfico del vehículo */}
      <div className="mt-3 rounded-lg bg-slate-800 p-3">
        <div className="mb-2 text-[11px] font-bold uppercase text-slate-400">Plano del vehículo</div>
        <VehicleLayoutImage
          tipo={v.tipo}
          posiciones={posiciones}
          vehiculoId={v.id}
          empresaId={v.empresa_id}
          montajes={montajes}
          editable={!esCliente}
          puedeCalibrar={!!perfil?.es_superadmin}
          onFicha={(nid) => navigate(`/tyrecontrol/neumaticos/${nid}`)}
          onChanged={cargar}
          onTipoChanged={cargar}
        />
      </div>

      {/* Estructura de posiciones */}
      <div className="mt-3 rounded-lg bg-slate-800 p-3">
        <div className="mb-2 text-[11px] font-bold uppercase text-slate-400">Estructura de posiciones ({posiciones.length})</div>
        {posiciones.length === 0 ? (
          <div className="text-sm text-slate-500">
            {v.tipo_vehiculo_id ? "Este tipo de vehículo no tiene posiciones definidas." : "Asigna un tipo de vehículo para ver sus posiciones."}
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {posiciones.map((p) => (
              <div key={p.id} className="rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-center">
                <div className="text-[13px] font-bold text-sky-300">{p.codigo_posicion}</div>
                <div className="text-[10px] text-slate-400">{p.nombre}</div>
                <div className="text-[9px] text-slate-500">Eje {p.eje ?? "—"} · {p.lado ?? ""}{p.interior_exterior ? ` · ${p.interior_exterior}` : ""}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Placeholders futuros */}
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        {["Histórico de neumáticos", "Inspecciones", "Operaciones"].map((t) => (
          <div key={t} className="rounded-lg border border-dashed border-slate-700 bg-slate-800 p-6 text-center text-sm text-slate-500">
            {t}<div className="text-[11px]">Disponible en próximas fases</div>
          </div>
        ))}
      </div>
    </div>
  );
}
