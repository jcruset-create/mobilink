import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "../services/supabase";
import {
  cargarPermisosPorCodigoOperario,
  usuarioPuedeUsarUbicacion,
} from "../services/permisosAlmacen";

type Traspaso = {
  id: string;
  codigo: string | null;
  estado: string;
  empresa_id: string;
  cliente_id: string;
  producto_id: string;
  cantidad: number;
  cantidad_recibida: number | null;
  ubicacion_origen: string | null;
  ubicacion_destino: string | null;
  productos_neumaticos:
    | {
        marca: string;
        modelo: string | null;
        medida: string;
        dot: string | null;
      }
    | {
        marca: string;
        modelo: string | null;
        medida: string;
        dot: string | null;
      }[]
    | null;
  solicitudes_reposicion:
    | {
        id: string;
        estado: string | null;
        cantidad_sugerida: number | null;
      }
    | {
        id: string;
        estado: string | null;
        cantidad_sugerida: number | null;
      }[]
    | null;
};

type Linea = {
  id: string;
  producto: string;
  cantidad_enviada: number;
  cantidad_recibida: number;
  cantidad_pendiente: number;
};

function estadoTexto(estado: string) {
  if (estado === "pendiente_salida") return "Pendiente salida";
  if (estado === "preparado") return "Pendiente salida";
  if (estado === "en_camino") return "Pendiente de recepción";
  if (estado === "recibido_parcial") return "Recibido parcial";
  if (estado === "recibido") return "Recibido";
  return estado;
}

function estadoClase(estado: string) {
  if (estado === "pendiente_salida") return "bg-yellow-100 text-yellow-800";
  if (estado === "preparado") return "bg-yellow-100 text-yellow-800";
  if (estado === "en_camino") return "bg-blue-100 text-blue-800";
  if (estado === "recibido_parcial") return "bg-orange-100 text-orange-800";
  if (estado === "recibido") return "bg-green-100 text-green-800";
  return "bg-gray-100 text-gray-800";
}

function obtenerPrimero<T>(valor: T | T[] | null): T | null {
  if (!valor) return null;
  if (Array.isArray(valor)) return valor[0] || null;
  return valor;
}

function textoProducto(
  producto:
    | {
        marca: string;
        modelo: string | null;
        medida: string;
        dot: string | null;
      }
    | null
) {
  if (!producto) return "-";

  return `${producto.medida} - ${producto.marca}${
    producto.modelo ? ` ${producto.modelo}` : ""
  }${producto.dot ? ` - DOT ${producto.dot}` : ""}`;
}

function codigoTraspaso(traspaso: Traspaso) {
  return traspaso.codigo || `TR-${traspaso.id.slice(0, 8).toUpperCase()}`;
}

function crearLineaDesdeTraspaso(traspaso: Traspaso): Linea {
  const producto = obtenerPrimero(traspaso.productos_neumaticos);
  const recibida = traspaso.cantidad_recibida || 0;
  const pendiente = traspaso.cantidad - recibida;

  return {
    id: traspaso.id,
    producto: textoProducto(producto),
    cantidad_enviada: traspaso.cantidad,
    cantidad_recibida: recibida,
    cantidad_pendiente: pendiente > 0 ? pendiente : 0,
  };
}

async function validarCodigoParaAlmacen(codigo: string, ubicacion: string) {
  const permisos = await cargarPermisosPorCodigoOperario(codigo);

  if (!permisos.perfil) {
    return {
      ok: false,
      mensaje: "Código personal no autorizado.",
    };
  }

  if (!usuarioPuedeUsarUbicacion(permisos, ubicacion)) {
    return {
      ok: false,
      mensaje: `El código ${codigo} no está autorizado para ${ubicacion}.`,
    };
  }

  return {
    ok: true,
    mensaje: "",
  };
}

function refrescarPagina() {
  window.location.reload();
}

export default function MobileTraspasoDetalle() {
  const { id } = useParams();

  const [traspaso, setTraspaso] = useState<Traspaso | null>(null);
  const [lineas, setLineas] = useState<Linea[]>([]);
  const [codigoPersonal, setCodigoPersonal] = useState("");
  const [mensaje, setMensaje] = useState("");
  const [loading, setLoading] = useState(true);
  const [guardando, setGuardando] = useState(false);

  async function cargarDatos() {
    if (!id) return;

    setLoading(true);
    setMensaje("");

    const { data: traspasoData, error: traspasoError } = await supabase
      .from("traspasos")
      .select(`
        id,
        codigo,
        empresa_id,
        cliente_id,
        producto_id,
        cantidad,
        cantidad_recibida,
        ubicacion_origen,
        ubicacion_destino,
        estado,
        productos_neumaticos (
          marca,
          modelo,
          medida,
          dot
        ),
        solicitudes_reposicion (
          id,
          estado,
          cantidad_sugerida
        )
      `)
      .eq("id", id)
      .single();

    if (traspasoError) {
      setMensaje(`Error cargando traspaso: ${traspasoError.message}`);
      setLoading(false);
      return;
    }

    const traspasoCargado = traspasoData as unknown as Traspaso;

    setTraspaso(traspasoCargado);
    setLineas([crearLineaDesdeTraspaso(traspasoCargado)]);
    setLoading(false);
  }

  async function confirmarRecogida() {
    if (!id || guardando) return;

    const codigo = codigoPersonal.trim().toUpperCase();

    if (codigo.length < 3) {
      setMensaje("Introduce un código personal válido.");
      return;
    }

    if (!traspaso) {
      setMensaje("No se ha cargado el traspaso.");
      return;
    }

    if (
      traspaso.estado !== "pendiente_salida" &&
      traspaso.estado !== "preparado"
    ) {
      setMensaje("Este traspaso no está pendiente de salida.");
      await cargarDatos();
      return;
    }

    if (!traspaso.ubicacion_origen || !traspaso.ubicacion_destino) {
      setMensaje("El traspaso no tiene origen o destino informado.");
      return;
    }

    setGuardando(true);

    const validacionCodigo = await validarCodigoParaAlmacen(
      codigo,
      traspaso.ubicacion_origen
    );

    if (!validacionCodigo.ok) {
      setMensaje(validacionCodigo.mensaje);
      setGuardando(false);
      return;
    }

    const solicitudReposicion = obtenerPrimero(traspaso.solicitudes_reposicion);

    const movimientos = [
      {
        empresa_id: traspaso.empresa_id,
        cliente_id: traspaso.cliente_id,
        producto_id: traspaso.producto_id,
        tipo: "SALIDA",
        cantidad: traspaso.cantidad,
        ubicacion: traspaso.ubicacion_origen,
        traspaso_id: traspaso.id,
        solicitud_reposicion_id: solicitudReposicion?.id || null,
        origen_movimiento: solicitudReposicion ? "reposicion" : "traspaso_manual",
        observaciones: `Salida autorizada desde mobile. Operario salida: ${codigo}`,
      },
      {
        empresa_id: traspaso.empresa_id,
        cliente_id: traspaso.cliente_id,
        producto_id: traspaso.producto_id,
        tipo: "ENTRADA",
        cantidad: traspaso.cantidad,
        ubicacion: "En camino",
        traspaso_id: traspaso.id,
        solicitud_reposicion_id: solicitudReposicion?.id || null,
        origen_movimiento: solicitudReposicion ? "reposicion" : "traspaso_manual",
        observaciones: `Traspaso hacia ${traspaso.ubicacion_destino}. Operario salida: ${codigo}`,
      },
    ];

    const { error: movimientosError } = await supabase
      .from("movimientos_stock")
      .insert(movimientos);

    if (movimientosError) {
      setMensaje(`Error creando movimientos: ${movimientosError.message}`);
      setGuardando(false);
      return;
    }

    const { data, error } = await supabase
      .from("traspasos")
      .update({
        estado: "en_camino",
        codigo_operario_salida: codigo,
        fecha_salida: new Date().toISOString(),
      })
      .eq("id", id)
      .in("estado", ["pendiente_salida", "preparado"])
      .select("id")
      .maybeSingle();

    if (error || !data) {
      setMensaje(
        "No se pudo confirmar. Puede que el traspaso ya haya cambiado de estado."
      );
      setGuardando(false);
      await cargarDatos();
      return;
    }

    const { error: auditoriaError } = await supabase
      .from("traspasos_auditoria")
      .insert({
        traspaso_id: id,
        accion: "aceptacion_transporte",
        codigo_personal: codigo,
        estado_anterior: traspaso.estado,
        estado_nuevo: "en_camino",
      });

    if (auditoriaError) {
      setMensaje(
        `Traspaso aceptado, pero error guardando auditoría: ${auditoriaError.message}`
      );
      setGuardando(false);
      await cargarDatos();
      return;
    }

    setCodigoPersonal("");
    refrescarPagina();
  }

  async function confirmarRecepcion() {
    if (!id || guardando) return;

    const codigo = codigoPersonal.trim().toUpperCase();

    if (codigo.length < 3) {
      setMensaje("Introduce un código personal válido.");
      return;
    }

    if (!traspaso) {
      setMensaje("No se ha cargado el traspaso.");
      return;
    }

    if (
      traspaso.estado !== "en_camino" &&
      traspaso.estado !== "recibido_parcial"
    ) {
      setMensaje("Este traspaso no está pendiente de recepción.");
      await cargarDatos();
      return;
    }

    if (!traspaso.ubicacion_destino) {
      setMensaje("El traspaso no tiene destino informado.");
      return;
    }

    setGuardando(true);

    const validacionCodigo = await validarCodigoParaAlmacen(
      codigo,
      traspaso.ubicacion_destino
    );

    if (!validacionCodigo.ok) {
      setMensaje(validacionCodigo.mensaje);
      setGuardando(false);
      return;
    }

    const cantidadRecibidaActual = traspaso.cantidad_recibida || 0;
    const cantidadPendiente = traspaso.cantidad - cantidadRecibidaActual;

    if (cantidadPendiente <= 0) {
      setMensaje("No queda cantidad pendiente por recibir.");
      setGuardando(false);
      return;
    }

    const solicitudReposicion = obtenerPrimero(traspaso.solicitudes_reposicion);
    const totalRecibido = cantidadRecibidaActual + cantidadPendiente;

    const movimientos = [
      {
        empresa_id: traspaso.empresa_id,
        cliente_id: traspaso.cliente_id,
        producto_id: traspaso.producto_id,
        tipo: "SALIDA",
        cantidad: cantidadPendiente,
        ubicacion: "En camino",
        traspaso_id: traspaso.id,
        solicitud_reposicion_id: solicitudReposicion?.id || null,
        origen_movimiento: solicitudReposicion ? "reposicion" : "traspaso_manual",
        observaciones: `Recepción traspaso desde mobile. Operario recepción: ${codigo}`,
      },
      {
        empresa_id: traspaso.empresa_id,
        cliente_id: traspaso.cliente_id,
        producto_id: traspaso.producto_id,
        tipo: "ENTRADA",
        cantidad: cantidadPendiente,
        ubicacion: traspaso.ubicacion_destino,
        traspaso_id: traspaso.id,
        solicitud_reposicion_id: solicitudReposicion?.id || null,
        origen_movimiento: solicitudReposicion ? "reposicion" : "traspaso_manual",
        observaciones: `Recepción en ${traspaso.ubicacion_destino}. Operario recepción: ${codigo}`,
      },
    ];

    const { error: movimientosError } = await supabase
      .from("movimientos_stock")
      .insert(movimientos);

    if (movimientosError) {
      setMensaje(`Error creando movimientos: ${movimientosError.message}`);
      setGuardando(false);
      return;
    }

    const { data, error } = await supabase
      .from("traspasos")
      .update({
        estado: "recibido",
        cantidad_recibida: totalRecibido,
        codigo_operario_recepcion: codigo,
        firma_recepcion: codigo,
        fecha_recepcion: new Date().toISOString(),
      })
      .eq("id", id)
      .in("estado", ["en_camino", "recibido_parcial"])
      .select("id")
      .maybeSingle();

    if (error || !data) {
      setMensaje(
        "No se pudo confirmar. Puede que el traspaso ya haya cambiado de estado."
      );
      setGuardando(false);
      await cargarDatos();
      return;
    }

    if (solicitudReposicion) {
      await supabase
        .from("solicitudes_reposicion")
        .update({
          estado: "cerrada",
          cerrada_at: new Date().toISOString(),
        })
        .eq("traspaso_id", traspaso.id)
        .eq("estado", "en_traspaso");
    }

    const { error: auditoriaError } = await supabase
      .from("traspasos_auditoria")
      .insert({
        traspaso_id: id,
        accion: "recepcion",
        codigo_personal: codigo,
        estado_anterior: traspaso.estado,
        estado_nuevo: "recibido",
      });

    if (auditoriaError) {
      setMensaje(
        `Recepción hecha, pero error guardando auditoría: ${auditoriaError.message}`
      );
      setGuardando(false);
      await cargarDatos();
      return;
    }

    setCodigoPersonal("");
    refrescarPagina();
  }

  useEffect(() => {
    cargarDatos();
  }, [id]);

  if (loading) {
    return <div className="p-4">Cargando...</div>;
  }

  return (
    <div className="min-h-screen bg-gray-100 p-4">
      <div className="mx-auto max-w-md space-y-4">
        <div className="rounded-2xl bg-white p-4 shadow-sm">
          <h1 className="text-2xl font-bold">
            {traspaso ? codigoTraspaso(traspaso) : "Traspaso"}
          </h1>

          <p className="text-sm text-gray-500">
            {traspaso?.ubicacion_origen || "-"} →{" "}
            {traspaso?.ubicacion_destino || "-"}
          </p>

          <div className="mt-3">
            <span
              className={`inline-block rounded-full px-3 py-1 text-xs font-semibold ${
                traspaso
                  ? estadoClase(traspaso.estado)
                  : "bg-gray-100 text-gray-800"
              }`}
            >
              {traspaso ? estadoTexto(traspaso.estado) : "-"}
            </span>
          </div>
        </div>

        <div className="rounded-2xl bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-lg font-bold">Líneas</h2>

          {lineas.length === 0 && (
            <p className="text-sm text-gray-500">
              No hay líneas asociadas a este traspaso.
            </p>
          )}

          <div className="space-y-3">
            {lineas.map((linea) => (
              <div key={linea.id} className="rounded-xl border p-3">
                <p className="font-semibold">{linea.producto}</p>

                <p className="text-sm">
                  Enviada: <strong>{linea.cantidad_enviada}</strong>
                </p>

                <p className="text-sm">
                  Recibida: <strong>{linea.cantidad_recibida}</strong>
                </p>

                <p className="text-sm">
                  Pendiente: <strong>{linea.cantidad_pendiente}</strong>
                </p>
              </div>
            ))}
          </div>
        </div>

        {traspaso?.estado !== "recibido" && (
          <div className="rounded-2xl bg-white p-4 shadow-sm">
            <label className="text-sm font-semibold">Código personal</label>

            <p className="mt-1 text-xs text-gray-500">
              {(traspaso?.estado === "pendiente_salida" ||
                traspaso?.estado === "preparado") &&
                "Introduce el código del operario que transporta los neumáticos."}
              {(traspaso?.estado === "en_camino" ||
                traspaso?.estado === "recibido_parcial") &&
                "Introduce el código del operario que recibe los neumáticos en destino."}
            </p>

            <input
              type="password"
              value={codigoPersonal}
              onChange={(e) => setCodigoPersonal(e.target.value)}
              disabled={guardando}
              autoComplete="off"
              className="mt-2 w-full rounded-xl border px-4 py-3 text-lg disabled:bg-gray-100"
              placeholder="Ej: 1234"
            />

            {(traspaso?.estado === "pendiente_salida" ||
              traspaso?.estado === "preparado") && (
              <button
                onClick={confirmarRecogida}
                disabled={guardando}
                className="mt-4 w-full rounded-xl bg-black px-4 py-4 font-semibold text-white disabled:opacity-50"
              >
                {guardando ? "Guardando..." : "Aceptar traspaso"}
              </button>
            )}

            {(traspaso?.estado === "en_camino" ||
              traspaso?.estado === "recibido_parcial") && (
              <button
                onClick={confirmarRecepcion}
                disabled={guardando}
                className="mt-4 w-full rounded-xl bg-green-700 px-4 py-4 font-semibold text-white disabled:opacity-50"
              >
                {guardando ? "Guardando..." : "Recepcionar traspaso"}
              </button>
            )}
          </div>
        )}

        {traspaso?.estado === "recibido" && (
          <div className="rounded-2xl bg-green-50 p-4 text-sm text-green-700 shadow-sm">
            Este traspaso ya ha sido recibido.
          </div>
        )}

        {mensaje && (
          <div className="rounded-2xl bg-white p-4 text-sm shadow-sm">
            {mensaje}
          </div>
        )}

        <button
          onClick={cargarDatos}
          disabled={guardando}
          className="w-full rounded-2xl bg-white p-4 text-center text-sm font-semibold shadow-sm disabled:opacity-50"
        >
          Actualizar
        </button>

        <a
          href="/almacen-neumaticos/mobile"
          className="block rounded-2xl bg-white p-4 text-center text-sm font-semibold shadow-sm"
        >
          Volver
        </a>
      </div>
    </div>
  );
}
