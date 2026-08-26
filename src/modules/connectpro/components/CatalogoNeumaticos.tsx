/**
 * Connect Pro — catálogo de neumáticos de una versión tarifaria.
 *
 * Precios netos por medida, marca y posición; grupos de marcas; y baremos de
 * fabricante para los precios que van por descuento.
 *
 * La pieza que hace que esta pantalla sirva es **pegar la tabla**. Un catálogo
 * real son ciento y pico filas por lado, y de una en una no las mete nadie:
 * acabarían otra vez en un fichero de código, que es de donde se quería salir.
 * Se pega tal cual sale de Excel y se valida todo antes de escribir nada.
 *
 * Y una regla que se repite en toda la pantalla: **una celda vacía no es un
 * cero**. Al pegar, las celdas en blanco y los "0,00" se saltan en lugar de
 * cargarse como precio, porque un cero en una tarifa se factura.
 */

import { useCallback, useEffect, useState } from "react";
import { boFetch } from "../services/api";
import { Card, Th, Td, Badge, Input, Select, Button, ErrorBanner, EmptyState } from "./ui";

type Precio = {
  id: number; tireSizeCode: string | null; brandName: string | null; brandGroupCode: string | null;
  position: string; priceModel: string;
  netAmount: string | null; discountPercent: string | null;
  priority: number; active: boolean;
};

type Grupo = { id: number; code: string; name: string; marcas: string[] };
type Marca = { id: number; code: string; name: string; active: boolean };
type Medida = { id: number; normalizedCode: string; active: boolean };
type Baremo = {
  id: number; brandName: string; name: string;
  validFromMs: number; validToMs: number | null; lineas: number; active: boolean;
};

const POSICIONES: Record<string, string> = {
  STEER: "Dirección", DRIVE: "Tracción", TRAILER: "Remolque", ANY: "Cualquiera",
};

const PESTANAS = ["Precios", "Grupos de marcas", "Baremos", "Medidas y marcas"] as const;

/** Una celda vacía o un cero del origen no son un precio. */
function importeODescartar(v: string): string | null {
  const limpio = v.trim().replace(/[€\s]/g, "").replace(",", ".");
  if (!limpio) return null;
  const n = Number(limpio);
  return Number.isFinite(n) && n > 0 ? String(n) : null;
}

export default function CatalogoNeumaticos({ versionId, editable, centro }: {
  versionId: number; editable: boolean; centro: number | null;
}) {
  const [pestana, setPestana] = useState<(typeof PESTANAS)[number]>("Precios");
  const [precios, setPrecios] = useState<Precio[]>([]);
  const [grupos, setGrupos] = useState<Grupo[]>([]);
  const [marcas, setMarcas] = useState<Marca[]>([]);
  const [medidas, setMedidas] = useState<Medida[]>([]);
  const [baremos, setBaremos] = useState<Baremo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const cargar = useCallback(() => {
    if (centro == null) return;
    boFetch<{ data: Precio[] }>(`/pricing/catalog/versions/${versionId}/tire-prices`, { centro })
      .then((r) => setPrecios(r.data)).catch((e) => setError(e.message));
    boFetch<{ data: Grupo[] }>(`/pricing/catalog/versions/${versionId}/groups`, { centro })
      .then((r) => setGrupos(r.data)).catch(() => {});
    boFetch<{ data: Marca[] }>("/pricing/catalog/brands", { centro }).then((r) => setMarcas(r.data)).catch(() => {});
    boFetch<{ data: Medida[] }>("/pricing/catalog/sizes", { centro }).then((r) => setMedidas(r.data)).catch(() => {});
    boFetch<{ data: Baremo[] }>("/pricing/catalog/price-lists", { centro }).then((r) => setBaremos(r.data)).catch(() => {});
  }, [versionId, centro]);
  useEffect(cargar, [cargar]);

  return (
    <div className="flex flex-col gap-3">
      {error && <ErrorBanner message={error} onClose={() => setError(null)} />}
      {aviso && <p className="text-[13px] text-emerald-300">{aviso}</p>}

      <div className="flex flex-wrap gap-1">
        {PESTANAS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setPestana(p)}
            className={`rounded-lg px-3 py-1.5 text-[12px] font-medium ${
              pestana === p ? "bg-cyan-600/20 text-cyan-300" : "text-slate-400 hover:bg-slate-800"}`}
          >
            {p}
          </button>
        ))}
      </div>

      {pestana === "Precios" && (
        <Precios
          versionId={versionId} editable={editable} precios={precios} grupos={grupos}
          centro={centro} onCambio={cargar} onError={setError} onAviso={setAviso}
        />
      )}
      {pestana === "Grupos de marcas" && (
        <Grupos versionId={versionId} editable={editable} grupos={grupos}
                centro={centro} onCambio={cargar} onError={setError} />
      )}
      {pestana === "Baremos" && (
        <Baremos baremos={baremos} centro={centro} onCambio={cargar} onError={setError} onAviso={setAviso} />
      )}
      {pestana === "Medidas y marcas" && (
        <MedidasYMarcas medidas={medidas} marcas={marcas} centro={centro} onCambio={cargar} onError={setError} />
      )}
    </div>
  );
}

// ── Precios ─────────────────────────────────────────────────────────────────

function Precios({ versionId, editable, precios, grupos, centro, onCambio, onError, onAviso }: {
  versionId: number; editable: boolean; precios: Precio[]; grupos: Grupo[]; centro: number | null;
  onCambio: () => void; onError: (m: string) => void; onAviso: (m: string) => void;
}) {
  const [pegando, setPegando] = useState(false);

  const desactivar = async (p: Precio) => {
    try {
      await boFetch(`/pricing/catalog/tire-prices/${p.id}`, { method: "DELETE", centro });
      onCambio();
    } catch (e: any) { onError(e.message); }
  };

  return (
    <div className="flex flex-col gap-3">
      {editable && (
        <div className="flex gap-2">
          <Button onClick={() => setPegando((v) => !v)}>
            {pegando ? "Cerrar" : "Pegar una tabla de precios"}
          </Button>
        </div>
      )}

      {pegando && (
        <PegarPrecios
          versionId={versionId} grupos={grupos} centro={centro}
          onHecho={(msg) => { setPegando(false); onAviso(msg); onCambio(); }}
          onError={onError}
        />
      )}

      {precios.length === 0 ? (
        <EmptyState message="Esta versión no tiene precios de neumático. Si el tarifario no vende neumáticos, es lo normal." />
      ) : (
        <Card className="overflow-x-auto">
          <p className="border-b border-slate-700 px-4 py-2 text-[12px] text-slate-500">
            {precios.length} precio(s). Gana el más específico: una marca concreta
            por encima de su grupo, y las dos por encima del descuento sobre baremo.
          </p>
          <table className="w-full text-[13px]">
            <thead><tr className="border-b border-slate-700">
              <Th>Medida</Th><Th>Marca o grupo</Th><Th>Posición</Th>
              <Th>Modelo</Th><Th>Valor</Th><Th>Prio.</Th><Th></Th>
            </tr></thead>
            <tbody>
              {precios.map((p) => (
                <tr key={p.id} className={`border-b border-slate-700/50 ${p.active ? "" : "opacity-40"}`}>
                  <Td className="tabular-nums">{p.tireSizeCode ?? <span className="text-slate-500">cualquiera</span>}</Td>
                  <Td>
                    {p.brandName
                      ? <span className="text-slate-100">{p.brandName}</span>
                      : p.brandGroupCode
                        ? <Badge className="border-slate-600 text-slate-400">{p.brandGroupCode}</Badge>
                        : <span className="text-slate-500">cualquiera</span>}
                  </Td>
                  <Td>{POSICIONES[p.position] ?? p.position}</Td>
                  <Td className="text-slate-400">
                    {p.priceModel === "NET_PRICE" ? "Precio neto" : "Baremo − descuento"}
                  </Td>
                  <Td className="tabular-nums font-semibold text-slate-100">
                    {p.priceModel === "NET_PRICE"
                      ? Number(p.netAmount ?? 0).toFixed(2)
                      : `${Number(p.discountPercent ?? 0)} %`}
                  </Td>
                  <Td className="tabular-nums text-slate-500">{p.priority}</Td>
                  <Td>
                    {editable && p.active && (
                      <button className="text-[12px] text-rose-300 hover:underline"
                              onClick={() => desactivar(p)}>Dar de baja</button>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

/**
 * Pegar una tabla de Excel.
 *
 * El formato es el de la propia tabla del proveedor: una columna de medida,
 * otra de posición y una columna por marca o grupo. Se pega con la cabecera
 * incluida, que es de donde se saca a qué marca pertenece cada columna.
 */
function PegarPrecios({ versionId, grupos, centro, onHecho, onError }: {
  versionId: number; grupos: Grupo[]; centro: number | null;
  onHecho: (msg: string) => void; onError: (m: string) => void;
}) {
  const [texto, setTexto] = useState("");
  const [modelo, setModelo] = useState<"NET_PRICE" | "DISCOUNT_FROM_LIST">("NET_PRICE");
  const [reemplazar, setReemplazar] = useState(true);
  const [busy, setBusy] = useState(false);
  const [previa, setPrevia] = useState<{ filas: any[]; saltadas: number } | null>(null);

  const codigosGrupo = new Set(grupos.map((g) => g.code));

  /** Convierte lo pegado en filas, saltándose las celdas sin precio. */
  const interpretar = () => {
    const lineas = texto.trim().split(/\r?\n/).filter((l) => l.trim());
    if (lineas.length < 2) {
      onError("Hacen falta al menos la cabecera y una fila");
      return;
    }
    const parte = (l: string) => l.split(/\t|;/).map((c) => c.trim());
    const cabecera = parte(lineas[0]);
    const columnas = cabecera.slice(2);   // las dos primeras son medida y posición

    const filas: any[] = [];
    let saltadas = 0;

    lineas.slice(1).forEach((l, i) => {
      const celdas = parte(l);
      const medida = celdas[0];
      const posicion = (celdas[1] || "ANY").toUpperCase();
      if (!medida) return;

      columnas.forEach((col, j) => {
        const valor = importeODescartar(celdas[j + 2] ?? "");
        if (valor == null) { saltadas++; return; }

        const esGrupo = codigosGrupo.has(col.toUpperCase());
        filas.push({
          fila: i + 2,
          medida,
          posicion: ["STEER", "DRIVE", "TRAILER", "ANY"].includes(posicion) ? posicion : "ANY",
          marca: esGrupo ? null : col,
          grupoMarca: esGrupo ? col.toUpperCase() : null,
          modeloPrecio: modelo,
          importeNeto: modelo === "NET_PRICE" ? valor : null,
          descuentoPorcentaje: modelo === "DISCOUNT_FROM_LIST" ? valor : null,
        });
      });
    });

    setPrevia({ filas, saltadas });
  };

  const cargar = async () => {
    if (!previa) return;
    setBusy(true);
    try {
      const r = await boFetch<any>(`/pricing/catalog/versions/${versionId}/tire-prices/bulk`, {
        method: "POST", centro, body: { filas: previa.filas, reemplazar },
      });
      if (r.errores?.length) {
        onError(`No se ha cargado nada. ${r.errores.length} fila(s) con problemas: ` +
          r.errores.slice(0, 5).map((e: any) => `fila ${e.fila}: ${e.motivo}`).join("; "));
        return;
      }
      onHecho(`${r.escritas} precio(s) cargados` +
        (r.borradas ? `, ${r.borradas} anteriores reemplazados.` : "."));
      setTexto(""); setPrevia(null);
    } catch (e: any) { onError(e.message); } finally { setBusy(false); }
  };

  return (
    <Card className="p-4">
      <p className="mb-1 text-[13px] font-medium text-slate-200">Pegar una tabla de precios</p>
      <p className="mb-3 text-[12px] text-slate-400">
        Copia la tabla del proveedor con su cabecera. Primera columna la medida,
        segunda la posición (DIRECCION, TRACCION, REMOLQUE o vacío), y una columna
        por marca o por grupo.{" "}
        <strong className="text-slate-300">Las celdas vacías y los ceros se saltan</strong>:
        significan que no hay precio, no que sea gratis.
      </p>

      <textarea
        value={texto}
        onChange={(e) => { setTexto(e.target.value); setPrevia(null); }}
        rows={8}
        spellCheck={false}
        placeholder={"MEDIDA\tPOSICION\tBRIDGESTONE\tHANKOOK\tEUROPEAS_1\n315/70R22.5\tSTEER\t485,49\t506,60\t436,17\n315/70R22.5\tDRIVE\t485,49\t506,60\t436,17"}
        className="w-full rounded-lg border border-slate-600 bg-slate-800 p-2 font-mono text-[12px] text-slate-200"
      />

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <label className="block">
          <span className="mb-1 block text-xs text-slate-500">Qué son los números</span>
          <Select value={modelo} onChange={(e) => { setModelo(e.target.value as any); setPrevia(null); }}>
            <option value="NET_PRICE">Precios netos</option>
            <option value="DISCOUNT_FROM_LIST">Porcentajes de descuento sobre baremo</option>
          </Select>
        </label>
        <label className="flex items-center gap-2 text-[13px] text-slate-300">
          <input type="checkbox" checked={reemplazar} onChange={(e) => setReemplazar(e.target.checked)} />
          Reemplazar los precios que ya tenga esta versión
        </label>
      </div>

      {previa && (
        <div className="mt-3 rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 text-[13px]">
          <p className="text-slate-200">
            Se van a cargar <strong>{previa.filas.length}</strong> precio(s).
            {previa.saltadas > 0 && (
              <span className="text-slate-400">
                {" "}Se saltan {previa.saltadas} celda(s) sin precio.
              </span>
            )}
          </p>
          {previa.filas.length > 0 && (
            <p className="mt-1 font-mono text-[11px] text-slate-500">
              Ejemplo: {previa.filas[0].medida} · {previa.filas[0].marca ?? previa.filas[0].grupoMarca}
              {" · "}{previa.filas[0].posicion}
              {" · "}{previa.filas[0].importeNeto ?? `${previa.filas[0].descuentoPorcentaje} %`}
            </p>
          )}
        </div>
      )}

      <div className="mt-3 flex gap-2">
        {!previa
          ? <Button variant="ghost" onClick={interpretar} disabled={!texto.trim()}>Revisar antes de cargar</Button>
          : <Button onClick={cargar} disabled={busy || previa.filas.length === 0}>
              Cargar {previa.filas.length} precio(s)
            </Button>}
        {previa && <Button variant="ghost" onClick={() => setPrevia(null)} disabled={busy}>Volver</Button>}
      </div>
    </Card>
  );
}

// ── Grupos ──────────────────────────────────────────────────────────────────

function Grupos({ versionId, editable, grupos, centro, onCambio, onError }: {
  versionId: number; editable: boolean; grupos: Grupo[]; centro: number | null;
  onCambio: () => void; onError: (m: string) => void;
}) {
  const [editando, setEditando] = useState<{ code: string; name: string; marcas: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const guardar = async () => {
    if (!editando) return;
    setBusy(true);
    try {
      await boFetch(`/pricing/catalog/versions/${versionId}/groups`, {
        method: "POST", centro,
        body: {
          code: editando.code, name: editando.name,
          marcas: editando.marcas.split(",").map((s) => s.trim()).filter(Boolean),
        },
      });
      setEditando(null);
      onCambio();
    } catch (e: any) { onError(e.message); } finally { setBusy(false); }
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[12px] text-slate-500">
        Un grupo permite dar el mismo precio a varias marcas. Cuelga de esta versión
        tarifaria, no de la marca: que Hankook sea de importación para un cliente no
        obliga a que lo sea para otro.
      </p>

      {editable && !editando && (
        <div>
          <Button onClick={() => setEditando({ code: "", name: "", marcas: "" })}>Añadir un grupo</Button>
        </div>
      )}

      {editando && (
        <Card className="p-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block">
              <span className="mb-1 block text-xs text-slate-500">Código</span>
              <Input value={editando.code}
                     onChange={(e) => setEditando({ ...editando, code: e.target.value.toUpperCase() })}
                     placeholder="EUROPEAS_1" />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-slate-500">Nombre</span>
              <Input value={editando.name} onChange={(e) => setEditando({ ...editando, name: e.target.value })} />
            </label>
            <label className="block sm:col-span-3">
              <span className="mb-1 block text-xs text-slate-500">
                Marcas, separadas por comas (las que no existan se dan de alta)
              </span>
              <Input value={editando.marcas}
                     onChange={(e) => setEditando({ ...editando, marcas: e.target.value })}
                     placeholder="Apollo, Firestone, Semperit, Barum" />
            </label>
          </div>
          <div className="mt-3 flex gap-2">
            <Button onClick={guardar} disabled={busy || !editando.code.trim()}>Guardar</Button>
            <Button variant="ghost" onClick={() => setEditando(null)} disabled={busy}>Cancelar</Button>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            La lista se reescribe entera: quitar una marca es mandar la lista sin ella.
          </p>
        </Card>
      )}

      {grupos.length === 0 ? (
        <EmptyState message="Esta versión no tiene grupos de marcas." />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead><tr className="border-b border-slate-700">
              <Th>Código</Th><Th>Nombre</Th><Th>Marcas</Th><Th></Th>
            </tr></thead>
            <tbody>
              {grupos.map((g) => (
                <tr key={g.id} className="border-b border-slate-700/50">
                  <Td className="font-semibold text-slate-100">{g.code}</Td>
                  <Td>{g.name}</Td>
                  <Td className="text-[12px] text-slate-400">
                    {g.marcas.length} · {g.marcas.join(", ")}
                  </Td>
                  <Td>
                    {editable && (
                      <button className="text-[12px] text-cyan-300 hover:underline"
                              onClick={() => setEditando({
                                code: g.code, name: g.name, marcas: g.marcas.join(", "),
                              })}>Editar</button>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

// ── Baremos ─────────────────────────────────────────────────────────────────

function Baremos({ baremos, centro, onCambio, onError, onAviso }: {
  baremos: Baremo[]; centro: number | null; onCambio: () => void;
  onError: (m: string) => void; onAviso: (m: string) => void;
}) {
  const [nuevo, setNuevo] = useState<{ marca: string; nombre: string; desde: string } | null>(null);
  const [cargandoEn, setCargandoEn] = useState<number | null>(null);
  const [lineas, setLineas] = useState("");
  const [busy, setBusy] = useState(false);

  const crear = async () => {
    if (!nuevo) return;
    setBusy(true);
    try {
      await boFetch("/pricing/catalog/price-lists", {
        method: "POST", centro,
        body: {
          marca: nuevo.marca, nombre: nuevo.nombre,
          vigenteDesdeMs: new Date(`${nuevo.desde}T00:00:00`).getTime(),
        },
      });
      setNuevo(null);
      onCambio();
    } catch (e: any) { onError(e.message); } finally { setBusy(false); }
  };

  const cargarLineas = async () => {
    if (cargandoEn == null) return;
    const filas = lineas.trim().split(/\r?\n/).map((l) => l.split(/\t|;/).map((c) => c.trim()))
      .filter((c) => c[0])
      .map((c) => ({ medida: c[0], modelo: c.length > 2 ? c[1] || null : null,
                     precio: (c[c.length - 1] ?? "").replace(/[€\s]/g, "").replace(",", ".") }))
      .filter((f) => Number(f.precio) > 0);

    if (filas.length === 0) { onError("No se ha reconocido ninguna línea con precio"); return; }
    setBusy(true);
    try {
      const r = await boFetch<any>(`/pricing/catalog/price-lists/${cargandoEn}/lines`, {
        method: "POST", centro, body: { lineas: filas },
      });
      onAviso(`${r.escritas} línea(s) cargadas en el baremo.`);
      setCargandoEn(null); setLineas("");
      onCambio();
    } catch (e: any) { onError(e.message); } finally { setBusy(false); }
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[12px] text-slate-500">
        El baremo es la tarifa publicada por el fabricante. Los precios que van por
        descuento lo necesitan cargado: sin él el motor no puede calcular el importe
        y la asistencia va a revisión manual.
      </p>

      {!nuevo && cargandoEn == null && (
        <div>
          <Button onClick={() => setNuevo({
            marca: "", nombre: "", desde: new Date().toISOString().slice(0, 10),
          })}>
            Añadir un baremo
          </Button>
        </div>
      )}

      {nuevo && (
        <Card className="p-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block">
              <span className="mb-1 block text-xs text-slate-500">Marca</span>
              <Input value={nuevo.marca} onChange={(e) => setNuevo({ ...nuevo, marca: e.target.value })} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-slate-500">Nombre del baremo</span>
              <Input value={nuevo.nombre} onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })}
                     placeholder="Baremo 2026" />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-slate-500">Vigente desde</span>
              <Input type="date" value={nuevo.desde} onChange={(e) => setNuevo({ ...nuevo, desde: e.target.value })} />
            </label>
          </div>
          <div className="mt-3 flex gap-2">
            <Button onClick={crear} disabled={busy || !nuevo.marca.trim()}>Crear</Button>
            <Button variant="ghost" onClick={() => setNuevo(null)} disabled={busy}>Cancelar</Button>
          </div>
        </Card>
      )}

      {cargandoEn != null && (
        <Card className="p-4">
          <p className="mb-1 text-[13px] font-medium text-slate-200">Pegar las líneas del baremo</p>
          <p className="mb-2 text-[12px] text-slate-400">
            Una línea por medida: <code>medida ⇥ precio</code>, o
            {" "}<code>medida ⇥ modelo ⇥ precio</code> si el fabricante distingue modelos.
          </p>
          <textarea
            value={lineas} onChange={(e) => setLineas(e.target.value)} rows={8} spellCheck={false}
            placeholder={"315/80R22.5\t1000,00\n315/70R22.5\t980,00"}
            className="w-full rounded-lg border border-slate-600 bg-slate-800 p-2 font-mono text-[12px] text-slate-200"
          />
          <div className="mt-3 flex gap-2">
            <Button onClick={cargarLineas} disabled={busy || !lineas.trim()}>Cargar</Button>
            <Button variant="ghost" onClick={() => { setCargandoEn(null); setLineas(""); }} disabled={busy}>
              Cancelar
            </Button>
          </div>
        </Card>
      )}

      {baremos.length === 0 ? (
        <EmptyState message="No hay baremos de fabricante cargados." />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead><tr className="border-b border-slate-700">
              <Th>Marca</Th><Th>Baremo</Th><Th>Desde</Th><Th>Líneas</Th><Th></Th>
            </tr></thead>
            <tbody>
              {baremos.map((b) => (
                <tr key={b.id} className="border-b border-slate-700/50">
                  <Td className="font-semibold text-slate-100">{b.brandName}</Td>
                  <Td>{b.name}</Td>
                  <Td className="whitespace-nowrap">{new Date(b.validFromMs).toLocaleDateString("es-ES")}</Td>
                  <Td className={b.lineas === 0 ? "text-amber-300" : ""}>
                    {b.lineas}{b.lineas === 0 && " · vacío, no puede calcular"}
                  </Td>
                  <Td>
                    <button className="text-[12px] text-cyan-300 hover:underline"
                            onClick={() => setCargandoEn(b.id)}>Cargar líneas</button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

// ── Medidas y marcas ────────────────────────────────────────────────────────

function MedidasYMarcas({ medidas, marcas, centro, onCambio, onError }: {
  medidas: Medida[]; marcas: Marca[]; centro: number | null;
  onCambio: () => void; onError: (m: string) => void;
}) {
  const [medida, setMedida] = useState("");
  const [marca, setMarca] = useState("");

  const anadir = async (ruta: string, cuerpo: Record<string, string>, limpiar: () => void) => {
    try {
      await boFetch(`/pricing/catalog/${ruta}`, { method: "POST", centro, body: cuerpo });
      limpiar();
      onCambio();
    } catch (e: any) { onError(e.message); }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <h3 className="border-b border-slate-700 px-4 py-3 text-sm font-semibold text-slate-300">
          Medidas ({medidas.length})
        </h3>
        <div className="flex gap-2 p-3">
          <Input value={medida} onChange={(e) => setMedida(e.target.value)} placeholder="315/80 R 22,5" />
          <Button variant="ghost" disabled={!medida.trim()}
                  onClick={() => anadir("sizes", { medida }, () => setMedida(""))}>Añadir</Button>
        </div>
        <p className="px-3 pb-2 text-[12px] text-slate-500">
          Se normaliza al guardar: «315/80 R 22,5» y «315/80R22.5» son la misma
          y no crean dos entradas.
        </p>
        <div className="max-h-72 overflow-y-auto px-3 pb-3">
          <div className="flex flex-wrap gap-1">
            {medidas.map((m) => (
              <span key={m.id} className="rounded bg-slate-800 px-2 py-0.5 font-mono text-[12px] text-slate-300">
                {m.normalizedCode}
              </span>
            ))}
          </div>
        </div>
      </Card>

      <Card>
        <h3 className="border-b border-slate-700 px-4 py-3 text-sm font-semibold text-slate-300">
          Marcas ({marcas.length})
        </h3>
        <div className="flex gap-2 p-3">
          <Input value={marca} onChange={(e) => setMarca(e.target.value)} placeholder="Bridgestone" />
          <Button variant="ghost" disabled={!marca.trim()}
                  onClick={() => anadir("brands", { marca }, () => setMarca(""))}>Añadir</Button>
        </div>
        <div className="max-h-72 overflow-y-auto px-3 pb-3">
          <div className="flex flex-wrap gap-1">
            {marcas.map((m) => (
              <span key={m.id} className="rounded bg-slate-800 px-2 py-0.5 text-[12px] text-slate-300">
                {m.name}
              </span>
            ))}
          </div>
        </div>
      </Card>
    </div>
  );
}
