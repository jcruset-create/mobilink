/**
 * Nueva referencia de catálogo: marca, modelo, medida, índices de carga y
 * código de velocidad, con lo que no esté añadible con ＋ al lado.
 *
 * Si el modelo tiene oferta del fabricante (tc_cat_oferta_fabricante), solo
 * enseña sus medidas y, de la medida, sus IC y CV.
 *
 * Se abre desde Catálogo de neumáticos (+ Nueva referencia y Sin catalogar)
 * y desde «Informar los neumáticos que ya lleva montados», para dar de alta
 * la goma que falta sin salir del vehículo.
 */
import { useEffect, useState } from "react";
import {
  listarMarcas, crearMarca, listarModelos, crearModelo, listarMedidas, crearMedida,
  listarIndicesCarga, crearIndiceCarga, listarIndicesVelocidad, crearIndiceVelocidad,
  listarEjesNeumatico, listarAplicacionesNeumatico, crearUsoCatalogo, type UsoCatalogo,
  leerOfertaFabricante, type OfertaFabricante, crearReferenciaNeumatico,
} from "../services/data";
import { etiquetaModelo, ofertaDelModelo } from "../services/importarCatalogo";
import type { MarcaNeumatico, ModeloNeumatico, MedidaNeumatico, IndiceCarga, IndiceVelocidad } from "../types";
import { Modal } from "./ui";
import { SelectorConAlta } from "./SelectorConAlta";
import { opcionesConElegido } from "../catalogo/usos";

export type FormRef = { marca: string; modelo: string; medida: string; indiceCargaSimple: string; indiceCargaDoble: string; codigoVelocidad: string; eje: string; aplicacion: string };
const vacioRef: FormRef = { marca: "", modelo: "", medida: "", indiceCargaSimple: "", indiceCargaDoble: "", codigoVelocidad: "", eje: "", aplicacion: "" };

export default function NuevaReferenciaModal({ prefill, onClose, onCreada }: {
  prefill?: Partial<FormRef>;
  onClose: () => void;
  onCreada: (r: { id: string; marca: string; modelo: string; medida: string }) => void;
}) {
  const [nuevaRef, setNuevaRef] = useState<FormRef>({ ...vacioRef, ...prefill });
  const [creando, setCreando] = useState(false);
  const [msg, setMsg] = useState("");
  const [cats, setCats] = useState<{
    marcas: MarcaNeumatico[]; medidas: MedidaNeumatico[];
    cargas: IndiceCarga[]; velocidades: IndiceVelocidad[];
    ejes: UsoCatalogo[]; aplicaciones: UsoCatalogo[];
  } | null>(null);
  const [modelosMarca, setModelosMarca] = useState<ModeloNeumatico[]>([]);
  // Lo que fabrica cada modelo según el Excel del fabricante: filtra la medida
  // y propone el IC y el CV. Vacía si no se ha importado (o la tabla no está).
  const [oferta, setOferta] = useState<OfertaFabricante[]>([]);

  // Las listas se cargan al abrir, no al abrir la página que lo contiene.
  useEffect(() => {
    void (async () => {
    try {
      const [marcas, medidas, cargas, velocidades, ejes, aplicaciones, of] = await Promise.all([
        listarMarcas(), listarMedidas(), listarIndicesCarga(), listarIndicesVelocidad(),
        listarEjesNeumatico(), listarAplicacionesNeumatico(), leerOfertaFabricante(),
      ]);
      setCats({ marcas, medidas, cargas, velocidades, ejes, aplicaciones });
      setOferta(of);
      if (prefill?.marca) await cargarModelos(prefill.marca, marcas);
    } catch (e: unknown) {
      // Sin catálogos el formulario sigue sirviendo: los desplegables saldrán
      // vacíos y todo se puede crear con el botón de al lado. Peor sería no
      // dejar dar de alta nada porque una consulta ha fallado.
      setMsg((e as Error)?.message || "No se han podido cargar las listas; puedes crear los valores a mano");
    }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Los modelos de una marca, para el segundo desplegable. */
  async function cargarModelos(marca: string, marcas?: MarcaNeumatico[]) {
    const lista = marcas ?? cats?.marcas ?? [];
    const m = lista.find((x) => x.nombre.toLowerCase() === marca.trim().toLowerCase());
    setModelosMarca(m ? await listarModelos(m.id) : []);
  }

  /**
   * El modelo elegido, si ya existe en el catálogo.
   *
   * De él salen el eje y el tipo de uso que se enseñan: son datos del modelo
   * entero, así que al elegir uno que ya está no se le cambian desde aquí.
   */
  const modeloExistente = nuevaRef
    ? modelosMarca.find((m) => m.nombre.toLowerCase() === nuevaRef.modelo.trim().toLowerCase()) ?? null
    : null;

  /** Las opciones de cada desplegable. Ver `catalogo/usos.ts`. */
  const opciones = opcionesConElegido;

  /** Lo que el fabricante dice de este modelo y esta medida. */
  const idModelo = (nombre: string) =>
    modelosMarca.find((m) => m.nombre.toLowerCase() === nombre.trim().toLowerCase())?.id ?? null;
  const ofertaForm = nuevaRef ? ofertaDelModelo(oferta, modeloExistente?.id, nuevaRef.medida) : null;

  /**
   * Al elegir modelo o medida: si el fabricante solo da un IC y un CV para esa
   * medida, quedan puestos; si da varios, se vacían para elegir entre ellos.
   * Una medida que ese modelo no tiene se quita al cambiar de modelo; elegida
   * a propósito (con ＋), se respeta.
   */
  function conOferta(f: FormRef, cambiaModelo = false): FormRef {
    const o = ofertaDelModelo(oferta, idModelo(f.modelo), f.medida);
    if (!o.conOferta || (o.medidaFuera && !cambiaModelo)) return f;
    if (o.medidaFuera) return { ...f, medida: "", indiceCargaSimple: "", indiceCargaDoble: "", codigoVelocidad: "" };
    if (!f.medida) return f;
    const uno = (xs: string[], actual: string) => (xs.includes(actual) ? actual : xs.length === 1 ? xs[0] : "");
    return {
      ...f,
      indiceCargaSimple: uno(o.simples, f.indiceCargaSimple),
      indiceCargaDoble: uno(o.dobles, f.indiceCargaDoble),
      codigoVelocidad: uno(o.velocidades, f.codigoVelocidad),
    };
  }
  /**
   * Las opciones de un desplegable: primero las del fabricante y después el
   * resto, marcadas. Ocultarlas no servía: un Excel incompleto (el RA58 en
   * 225/75R16 lo llevan vehículos de Plana y Hankook no lo lista) dejaba sin
   * poder elegir una medida que sí existe.
   */
  const deOferta = (delFabricante: string[] | undefined, todas: string[], elegido: string) => {
    if (!delFabricante?.length) return opciones(todas, elegido);
    const suyas = new Set(delFabricante.map((x) => x.toUpperCase()));
    return [
      ...opciones(delFabricante, elegido),
      ...todas.filter((x) => !suyas.has(x.toUpperCase()) && x.toUpperCase() !== elegido.trim().toUpperCase())
        .map((x) => ({ valor: x, etiqueta: `${x} · no está en el Excel` })),
    ];
  };

  async function guardar() {
    setCreando(true); setMsg("");
    try {
      const id = await crearReferenciaNeumatico({
        marca: nuevaRef.marca, modelo: nuevaRef.modelo, medida: nuevaRef.medida,
        indiceCargaSimple: nuevaRef.indiceCargaSimple, indiceCargaDoble: nuevaRef.indiceCargaDoble || null,
        codigoVelocidad: nuevaRef.codigoVelocidad,
        // Solo se aplican si el modelo se crea ahora; si ya existe, la base lo
        // deja como está y la pantalla lo ha avisado.
        eje: nuevaRef.eje || null, aplicacion: nuevaRef.aplicacion || null,
      });
      onCreada({ id, marca: nuevaRef.marca, modelo: nuevaRef.modelo, medida: nuevaRef.medida });
    } catch (e: unknown) { setMsg((e as Error)?.message || "Error al crear la referencia"); } finally { setCreando(false); }
  }

  return (
      <Modal title="Nueva referencia de catálogo" onClose={onClose}
        footer={<div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-200">Cancelar</button>
          <button onClick={() => void guardar()} disabled={creando || !nuevaRef.marca.trim() || !nuevaRef.modelo.trim() || !nuevaRef.medida.trim()} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{creando ? "Creando…" : "Crear referencia"}</button>
        </div>}>
        <p className="mb-3 text-xs text-slate-400">
          Se elige de la lista; lo que no esté se añade con el botón <b>＋</b> de al lado y queda elegido.
          La medida se parsea (ancho/perfil/llanta) automáticamente.
        </p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <SelectorConAlta
            label="Marca"
            opciones={opciones((cats?.marcas ?? []).map((m) => m.nombre), nuevaRef.marca)}
            valor={nuevaRef.marca}
            onChange={async (v) => {
              // Al cambiar de marca se vacía el modelo: un modelo es de UNA
              // marca, y dejar el anterior puesto crearía «Michelin HS5».
              setNuevaRef({ ...nuevaRef, marca: v, modelo: "" });
              await cargarModelos(v);
            }}
            onCrear={async (nombre) => {
              await crearMarca(nombre);
              const marcas = await listarMarcas();
              setCats((c) => (c ? { ...c, marcas } : c));
              setModelosMarca([]);
              return nombre.trim();
            }}
            placeholder="Michelin"
          />

          <SelectorConAlta
            label="Modelo"
            opciones={opciones(modelosMarca.map((m) => m.nombre), nuevaRef.modelo)
              .map((o) => {
                const m = modelosMarca.find((x) => x.nombre === o.valor);
                return m ? { ...o, etiqueta: etiquetaModelo(m) } : o;
              })}
            valor={nuevaRef.modelo}
            onChange={(v) => setNuevaRef(conOferta({ ...nuevaRef, modelo: v }, true))}
            deshabilitado={!nuevaRef.marca}
            ayuda={!nuevaRef.marca ? "Elige antes la marca" : undefined}
            onCrear={async (nombre) => {
              const marca = (cats?.marcas ?? []).find(
                (x) => x.nombre.toLowerCase() === nuevaRef.marca.trim().toLowerCase());
              await crearModelo(marca?.id ?? null, nombre);
              await cargarModelos(nuevaRef.marca);
              return nombre.trim();
            }}
            placeholder="X Multi D"
          />

          <SelectorConAlta
            label="Medida"
            opciones={deOferta(ofertaForm?.medidas, (cats?.medidas ?? []).map((m) => m.valor), nuevaRef.medida)}
            valor={nuevaRef.medida}
            onChange={(v) => setNuevaRef(conOferta({ ...nuevaRef, medida: v }))}
            onCrear={async (valor) => {
              await crearMedida(valor);
              const medidas = await listarMedidas();
              setCats((c) => (c ? { ...c, medidas } : c));
              return valor.trim();
            }}
            placeholder="315/80R22.5"
          />

          <SelectorConAlta
            label="Índice carga simple"
            opciones={deOferta(ofertaForm?.simples, (cats?.cargas ?? []).map((i) => i.valor), nuevaRef.indiceCargaSimple)}
            valor={nuevaRef.indiceCargaSimple}
            onChange={(v) => setNuevaRef({ ...nuevaRef, indiceCargaSimple: v })}
            onCrear={async (valor) => {
              await crearIndiceCarga(valor);
              const cargas = await listarIndicesCarga();
              setCats((c) => (c ? { ...c, cargas } : c));
              return valor.trim();
            }}
            placeholder="156"
          />

          <SelectorConAlta
            label="Índice carga doble (opc.)"
            opciones={deOferta(ofertaForm?.dobles, (cats?.cargas ?? []).map((i) => i.valor), nuevaRef.indiceCargaDoble)}
            valor={nuevaRef.indiceCargaDoble}
            onChange={(v) => setNuevaRef({ ...nuevaRef, indiceCargaDoble: v })}
            onCrear={async (valor) => {
              await crearIndiceCarga(valor);
              const cargas = await listarIndicesCarga();
              setCats((c) => (c ? { ...c, cargas } : c));
              return valor.trim();
            }}
            placeholder="150"
          />

          <SelectorConAlta
            label="Código velocidad"
            opciones={deOferta(ofertaForm?.velocidades, (cats?.velocidades ?? []).map((i) => i.valor), nuevaRef.codigoVelocidad)}
            valor={nuevaRef.codigoVelocidad}
            onChange={(v) => setNuevaRef({ ...nuevaRef, codigoVelocidad: v })}
            onCrear={async (valor) => {
              await crearIndiceVelocidad(valor);
              const velocidades = await listarIndicesVelocidad();
              setCats((c) => (c ? { ...c, velocidades } : c));
              return valor.trim().toUpperCase();
            }}
            placeholder="L"
          />
        </div>

        {ofertaForm?.conOferta && (
          <p className={`mt-2 text-[11px] ${ofertaForm.medidaFuera ? "text-amber-300" : "text-sky-300"}`}>
            {ofertaForm.medidaFuera
              ? `${nuevaRef.marca} no fabrica el ${nuevaRef.modelo} en ${nuevaRef.medida} según su Excel. Si de verdad existe, se puede crear igual.`
              : `Según el Excel de ${nuevaRef.marca}, el ${nuevaRef.modelo} se fabrica en ${ofertaForm.medidas.length} medida(s): salen primero, y el IC y el CV de la medida elegida. Las demás siguen en la lista, marcadas «no está en el Excel».`}
          </p>
        )}

        {/* ── El uso: del MODELO, no de esta medida ────────────────────── */}
        <div className="mt-4 rounded-lg border border-slate-700 bg-slate-900/40 p-3">
          <p className="mb-2 text-[11px] text-slate-400">
            El <b>uso</b> y el <b>tipo de uso</b> son del modelo, no de esta medida: valen para
            todas las medidas de {nuevaRef.modelo || "ese dibujo"}.
          </p>

          {modeloExistente ? (
            // Decisión tomada: al elegir un modelo que ya existe NO se le
            // cambian estos dos datos desde aquí. Crear una referencia no
            // puede modificar en silencio algo que comparten otras medidas.
            <div className="text-xs text-slate-300">
              <span className="text-slate-400">Este modelo ya está en el catálogo con: </span>
              <b>{modeloExistente.eje_recomendado
                  ? (cats?.ejes ?? []).find((e) => e.codigo === modeloExistente.eje_recomendado)?.nombre
                    ?? modeloExistente.eje_recomendado
                  : "sin uso"}</b>
              {" · "}
              <b>{modeloExistente.aplicacion
                  ? (cats?.aplicaciones ?? []).find((a) => a.codigo === modeloExistente.aplicacion)?.nombre
                    ?? modeloExistente.aplicacion
                  : "sin tipo de uso"}</b>
              <span className="text-slate-500">. Para cambiarlo, edítalo en la ficha del modelo.</span>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <SelectorConAlta
                label="Uso (eje)"
                opciones={(cats?.ejes ?? []).map((e) => ({ valor: e.codigo, etiqueta: e.nombre }))}
                valor={nuevaRef.eje}
                onChange={(v) => setNuevaRef({ ...nuevaRef, eje: v })}
                onCrear={async (nombre) => {
                  const codigo = await crearUsoCatalogo("ejes", nombre);
                  setCats((c) => (c ? { ...c, ejes: [...c.ejes, { codigo, nombre, orden: 999, activo: true }] } : c));
                  return codigo;
                }}
                placeholder="Dirección"
              />
              <SelectorConAlta
                label="Tipo de uso"
                opciones={(cats?.aplicaciones ?? []).map((a) => ({ valor: a.codigo, etiqueta: a.nombre }))}
                valor={nuevaRef.aplicacion}
                onChange={(v) => setNuevaRef({ ...nuevaRef, aplicacion: v })}
                onCrear={async (nombre) => {
                  const codigo = await crearUsoCatalogo("aplicaciones", nombre);
                  setCats((c) => (c ? { ...c, aplicaciones: [...c.aplicaciones, { codigo, nombre, orden: 999, activo: true }] } : c));
                  return codigo;
                }}
                placeholder="Regional"
              />
            </div>
          )}
        </div>
        {msg && <div className="mt-2 text-xs text-red-300">{msg}</div>}
      </Modal>
  );
}
