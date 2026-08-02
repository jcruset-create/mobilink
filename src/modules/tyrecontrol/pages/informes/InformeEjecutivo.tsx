import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, TrendingUp, TrendingDown, Minus, Printer } from "lucide-react";
import { useInformesFiltros } from "./InformesLayout";
import { obtenerInformeEjecutivo } from "../../services/informes";
import type { InformeEjecutivo as Datos, NivelDesgaste, Semaforo } from "../../types/informes";
import { KpiCard } from "../../components/informes/KpiCard";
import { Donut, BarList, ColumnChart, LineChart } from "../../components/informes/charts";

/**
 * Informe ejecutivo mensual: una sola pantalla que responde "¿cómo está la
 * flota, va a mejor o a peor, y qué hay que hacer este mes?".
 *
 * Todo el cálculo vive en la RPC tc_informe_ejecutivo. Aquí no se agrega nada:
 * si una cifra hay que cambiarla, se cambia en la migración y cambia a la vez
 * en cualquier sitio que la use.
 *
 * Los "insights" del final se redactan con plantillas a partir de esas mismas
 * cifras, NO con IA. Es una decisión deliberada: un informe que un director de
 * operaciones va a firmar no puede contener una frase cuya cifra nadie ha
 * comprobado. El asistente de IA está para preguntar; esto es para firmar.
 */

// ── Paleta ──────────────────────────────────────────────────────────────────
// Los niveles son una escala de ESTADO: color reservado y SIEMPRE acompañado
// de etiqueta y número, nunca color a secas (quien no distingue rojo de verde
// tiene que poder leer el informe igual).
const COLOR_NIVEL: Record<NivelDesgaste, string> = {
  critico: "#f43f5e",   // rojo    — por debajo del mínimo: se sustituye
  bajo: "#fb923c",      // naranja — entre mínimo y aviso
  medio: "#facc15",     // amarillo
  bueno: "#34d399",     // verde
  excelente: "#a7f3d0", // verde claro (misma familia: dentro de "bien" solo hay orden)
};
const ORDEN_NIVEL: NivelDesgaste[] = ["critico", "bajo", "medio", "bueno", "excelente"];
const ETIQUETA_NIVEL: Record<NivelDesgaste, string> = {
  critico: "Crítico", bajo: "Bajo", medio: "Medio", bueno: "Bueno", excelente: "Excelente",
};

// "Estado del banco de goma": bandas, etiquetas y colores del informe mensual
// clásico (rojo → ámbar → amarillo → verdes), que es el formato que los
// clientes ya conocen. Aquí el color SÍ transporta significado de estado, así
// que cada tramo lleva siempre su etiqueta y su cifra al lado — nunca se
// comunica solo con el color.
// El color va atado al NOMBRE de la banda, no a su posición: la RPC omite las
// bandas sin neumáticos y con índices se correría la escala.
// Los tramos son cerrados por arriba, como en el informe original: "mayor de
// 4 mm y hasta 6 mm" = (4,6], de modo que un 6,0 exacto cae en 4-6.
const BANDAS = ["<=4", "4-6", "6-8", "8-10", "10-12", ">12"] as const;
const BANDA_INFO: Record<string, { etiqueta: string; color: string }> = {
  "<=4":   { etiqueta: "Menos de 4 mm",                 color: "#e5322e" },
  "4-6":   { etiqueta: "mayor de 4 mm y hasta 6 mm",    color: "#efa508" },
  "6-8":   { etiqueta: "mayor de 6 mm y hasta 8 mm",    color: "#f6d96d" },
  "8-10":  { etiqueta: "mayor de 8 mm y hasta 10 mm",   color: "#cde0b2" },
  "10-12": { etiqueta: "mayor de 10 mm y hasta 12 mm",  color: "#8fbf6b" },
  ">12":   { etiqueta: "mayor de 12 mm",                color: "#4a7d2a" },
};

/** Oscurece un color hex — es el tono de las paredes laterales de la tarta 3D. */
function sombra(hex: string, f = 0.6): string {
  const n = parseInt(hex.slice(1), 16);
  const canal = (x: number) => Math.round(x * f).toString(16).padStart(2, "0");
  return `#${canal((n >> 16) & 255)}${canal((n >> 8) & 255)}${canal(n & 255)}`;
}

/**
 * Tarta 3D al estilo del informe mensual clásico (la de Excel): elipse
 * achatada, canto inferior en el mismo color oscurecido, porcentajes fuera y
 * arranque a las 12 en sentido horario.
 *
 * El 3D aquí es decorativo a propósito — la petición es que el informe se vea
 * EXACTAMENTE como el que los clientes llevan años recibiendo. Las cifras
 * exactas van al lado en la tabla, así que la perspectiva no le quita
 * precisión a nada.
 */
function TartaBandas({ items }: { items: { banda: string; n: number }[] }) {
  const total = items.reduce((s, x) => s + x.n, 0);
  if (total === 0) return <p className="text-sm text-slate-500">Sin datos.</p>;

  // Elipse achatada (ry/rx ≈ 0,62, como Excel) + profundidad del canto.
  const cx = 230, cy = 138, rx = 150, ry = 93, h = 34;
  const px = (a: number) => cx + rx * Math.cos(a);
  const py = (a: number) => cy + ry * Math.sin(a);

  const TAU = 2 * Math.PI;
  let ang = -Math.PI / 2; // a las 12, sentido horario (en pantalla, y crece hacia abajo)
  const sectores = items.filter((x) => x.n > 0).map((x) => {
    const frac = x.n / total;
    const a0 = ang, a1 = ang + frac * TAU;
    ang = a1;
    return { banda: x.banda, frac, a0, a1, am: (a0 + a1) / 2 };
  });

  // Canto: solo la mitad delantera de la elipse (sin(a) > 0). Cada sector
  // aporta el trozo de su arco que cae en esa mitad; puede partirse en dos
  // tramos si el sector cruza las 3 o las 9. Sin las paredes el disco parece
  // flotar; con paredes también detrás, se verían a través del borde superior.
  const paredes: { banda: string; d: string }[] = [];
  for (const s of sectores) {
    // Normalizado a [0, 2π): la mitad visible es (0, π) y su copia (2π, 3π).
    const b0 = ((s.a0 % TAU) + TAU) % TAU;
    const b1 = b0 + (s.a1 - s.a0);
    for (const [v0, v1] of [[0, Math.PI], [TAU, TAU + Math.PI]]) {
      const c0 = Math.max(b0, v0), c1 = Math.min(b1, v1);
      if (c1 - c0 < 0.004) continue;
      paredes.push({
        banda: s.banda,
        d: `M${px(c0)},${py(c0)} A${rx},${ry} 0 0 1 ${px(c1)},${py(c1)} ` +
           `L${px(c1)},${py(c1) + h} A${rx},${ry} 0 0 0 ${px(c0)},${py(c0) + h} Z`,
      });
    }
  }

  const etiquetas = sectores.map((s) => ({
    banda: s.banda,
    pct: s.frac * 100,
    lx: cx + (rx + 16) * Math.cos(s.am),
    // Las etiquetas de la mitad delantera bajan con el canto para no pisarlo.
    ly: cy + (ry + 14) * Math.sin(s.am) + (Math.sin(s.am) > 0.2 ? h + 6 : 0),
    izquierda: Math.cos(s.am) < -0.08,
  }));
  // Anticolisión: dos sectores pequeños contiguos ponen sus porcentajes casi a
  // la misma altura y "25%"+"12,5%" se lee como una sola cifra.
  for (const lado of [true, false]) {
    const grupo = etiquetas.filter((e) => e.izquierda === lado).sort((a, b) => a.ly - b.ly);
    for (let i = 1; i < grupo.length; i++) {
      if (grupo[i].ly - grupo[i - 1].ly < 15) grupo[i].ly = grupo[i - 1].ly + 15;
    }
  }

  const cara = (s: (typeof sectores)[number]) =>
    s.frac >= 0.9995
      ? "" // círculo completo: se pinta como <ellipse>, un arco degeneraría
      : `M${cx},${cy} L${px(s.a0)},${py(s.a0)} ` +
        `A${rx},${ry} 0 ${s.frac > 0.5 ? 1 : 0} 1 ${px(s.a1)},${py(s.a1)} Z`;

  return (
    <svg viewBox="0 0 460 302" className="h-auto w-full max-w-[430px]" role="img">
      {/* 1º los cantos (quedan detrás), 2º las caras, 3º las cifras. */}
      {paredes.map((w, i) => (
        <path key={`w${i}`} d={w.d} fill={sombra(BANDA_INFO[w.banda]?.color ?? "#64748b")} />
      ))}
      {sectores.map((s) =>
        s.frac >= 0.9995 ? (
          <ellipse key={s.banda} cx={cx} cy={cy} rx={rx} ry={ry}
            fill={BANDA_INFO[s.banda]?.color ?? "#64748b"} stroke="#ffffff" strokeWidth={1.5} />
        ) : (
          <path key={s.banda} d={cara(s)} fill={BANDA_INFO[s.banda]?.color ?? "#64748b"}
            stroke="#ffffff" strokeWidth={1.5} strokeLinejoin="round">
            <title>{`${BANDA_INFO[s.banda]?.etiqueta ?? s.banda}: ${(s.frac * 100).toFixed(2)}%`}</title>
          </path>
        ),
      )}
      {etiquetas.map((e) => (
        <text key={`t-${e.banda}`} x={e.lx} y={e.ly}
          textAnchor={e.izquierda ? "end" : Math.abs(e.lx - cx) < 30 ? "middle" : "start"}
          dominantBaseline="middle" fill="#cbd5e1" style={{ fontSize: 12, fontWeight: 600 }}>
          {`${e.pct.toFixed(2).replace(".", ",")}%`}
        </text>
      ))}
    </svg>
  );
}

/** Texto negro o blanco según la luminosidad del fondo de la celda. */
function tintaSobre(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.55 ? "#1f2937" : "#ffffff";
}

const SEMAFORO: Record<Semaforo, { label: string; punto: string; color: string }> = {
  intervenir: { label: "Intervenir", punto: "🔴", color: "text-rose-400" },
  revisar:    { label: "Revisar",    punto: "🟠", color: "text-orange-400" },
  vigilar:    { label: "Vigilar",    punto: "🟡", color: "text-yellow-400" },
  correcto:   { label: "Correcto",   punto: "🟢", color: "text-emerald-400" },
  sin_datos:  { label: "Sin datos",  punto: "⚪", color: "text-slate-400" },
};

const nf = (n: number | null | undefined, d = 0) =>
  n == null ? "—" : n.toLocaleString("es-ES", { minimumFractionDigits: d, maximumFractionDigits: d });

/** Variación porcentual. Devuelve null si no hay base con la que comparar. */
function variacion(actual: number | null, previo: number | null): number | null {
  if (actual == null || previo == null || previo === 0) return null;
  return ((actual - previo) / previo) * 100;
}

/** Flecha de tendencia. `mejorSiBaja` invierte el color, no la dirección. */
function Tendencia({ pct, mejorSiBaja = false }: { pct: number | null; mejorSiBaja?: boolean }) {
  if (pct == null) return <span className="text-[11px] text-slate-500">sin comparativa</span>;
  const plano = Math.abs(pct) < 1;
  const bueno = mejorSiBaja ? pct < 0 : pct > 0;
  const Icono = plano ? Minus : pct > 0 ? TrendingUp : TrendingDown;
  const color = plano ? "text-slate-400" : bueno ? "text-emerald-400" : "text-rose-400";
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-semibold ${color}`}>
      <Icono className="h-3 w-3" />
      {pct > 0 ? "+" : ""}{pct.toFixed(0)}%
    </span>
  );
}

function Seccion({ titulo, sub, children }: { titulo: string; sub?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg bg-slate-800 p-4">
      <h2 className="text-sm font-black text-slate-100">{titulo}</h2>
      {sub && <p className="mb-3 mt-0.5 text-[11px] text-slate-400">{sub}</p>}
      <div className={sub ? "" : "mt-3"}>{children}</div>
    </section>
  );
}

/**
 * Conclusiones redactadas a partir de las cifras del informe. Cada frase sale
 * de una comprobación explícita: si el dato no está, la frase no se escribe.
 */
/** Concordancia de número: "1 medición" / "3 mediciones". */
const plural = (n: number, sing: string, plur: string) => `${n} ${n === 1 ? sing : plur}`;

function conclusiones(d: Datos): string[] {
  const out: string[] = [];
  const { cabecera: c, comparativa: k, prediccion: p, anomalias: a } = d;

  const cobertura = c.vehiculos_total > 0 ? (c.vehiculos_revisados / c.vehiculos_total) * 100 : null;
  if (cobertura != null) {
    out.push(
      `Se ha revisado el ${cobertura.toFixed(0)}% de la flota (${c.vehiculos_revisados} de ${c.vehiculos_total} vehículos)` +
      (c.vehiculos_pendientes > 0 ? `; queda${c.vehiculos_pendientes === 1 ? "" : "n"} ${plural(c.vehiculos_pendientes, "vehículo", "vehículos")} sin revisar en el periodo.` : "."),
    );
  }

  const vRev = variacion(k.revisiones_actual, k.revisiones_previo);
  if (vRev != null && Math.abs(vRev) >= 5) {
    out.push(`La actividad de revisión ${vRev > 0 ? "sube" : "baja"} un ${Math.abs(vRev).toFixed(0)}% respecto al periodo anterior (${k.revisiones_actual} frente a ${k.revisiones_previo}).`);
  }

  const vCrit = variacion(k.criticos_actual, k.criticos_previo);
  if (k.criticos_actual > 0) {
    out.push(
      `Hay ${plural(k.criticos_actual, "medición", "mediciones")} por debajo del mínimo legal (1,6 mm) en el periodo` +
      (vCrit != null ? `, un ${Math.abs(vCrit).toFixed(0)}% ${vCrit > 0 ? "más" : "menos"} que el anterior.` : ".") +
      (k.criticos_actual === 1 ? " Ese neumático se sustituye, no se vigila." : " Esos neumáticos se sustituyen, no se vigilan."),
    );
  } else if (k.criticos_previo > 0) {
    out.push(`Ninguna medición del periodo baja del mínimo legal, frente a ${plural(k.criticos_previo, "medición", "mediciones")} en el periodo anterior.`);
  }

  const cv = d.estadistica.coef_variacion;
  if (cv != null && d.estadistica.n >= 20) {
    out.push(
      cv > 40
        ? `La dispersión del desgaste es alta (coeficiente de variación ${cv.toFixed(0)}%): conviven neumáticos casi nuevos con otros al límite, lo que suele indicar sustituciones sueltas en vez de por eje.`
        : `El desgaste es homogéneo (coeficiente de variación ${cv.toFixed(0)}%), coherente con una política de sustitución por ejes.`,
    );
  }

  const peorBase = [...d.por_base].filter((b) => b.vehiculos >= 2).sort((x, y) => y.intervenir - x.intervenir)[0];
  if (peorBase && peorBase.intervenir > 0) {
    out.push(`La base de ${peorBase.base} concentra ${plural(peorBase.intervenir, "vehículo", "vehículos")} que requiere${peorBase.intervenir === 1 ? "" : "n"} intervención inmediata.`);
  }

  const marcas = d.por_marca.filter((m) => m.marca !== "Sin registrar" && m.unidades >= 5);
  if (marcas.length >= 2) {
    const orden = [...marcas].sort((x, y) => (y.prof_media ?? 0) - (x.prof_media ?? 0));
    const mejor = orden[0], peor = orden[orden.length - 1];
    if (mejor.prof_media != null && peor.prof_media != null && mejor.marca !== peor.marca) {
      out.push(
        `${mejor.marca} presenta la mayor profundidad media (${nf(mejor.prof_media, 1)} mm sobre ${mejor.unidades} unidades) y ${peor.marca} la menor (${nf(peor.prof_media, 1)} mm sobre ${peor.unidades}). ` +
        "No es una comparación de durabilidad: no se conoce la antigüedad de montaje de cada grupo.",
      );
    }
  }

  const ejeMax = [...d.por_eje].sort((x, y) => y.criticos - x.criticos)[0];
  if (ejeMax && ejeMax.criticos > 0) {
    out.push(`El eje ${ejeMax.eje} acumula ${plural(ejeMax.criticos, "neumático", "neumáticos")} en estado crítico, más que ningún otro.`);
  }

  // Media por eje: solo se señala si la diferencia entre ejes es real (≥1 mm);
  // por debajo de eso es ruido de medición y no merece una conclusión.
  const ejesConMedia = d.por_eje.filter((e) => e.prof_media != null && e.unidades >= 2);
  if (ejesConMedia.length >= 2) {
    const orden = [...ejesConMedia].sort((x, y) => (x.prof_media ?? 0) - (y.prof_media ?? 0));
    const peor = orden[0], mejor = orden[orden.length - 1];
    if ((mejor.prof_media ?? 0) - (peor.prof_media ?? 0) >= 1) {
      out.push(
        `El eje ${peor.eje} presenta la menor profundidad media (${nf(peor.prof_media, 1)} mm, frente a ` +
        `${nf(mejor.prof_media, 1)} mm del eje ${mejor.eje}): es donde antes tocará renovar.`,
      );
    }
  }

  if (p.vencidos > 0 || p.dias_30 > 0) {
    out.push(`Según el ritmo de desgaste medido, ${plural(p.vencidos + p.dias_30, "neumático alcanza", "neumáticos alcanzan")} el mínimo en los próximos 30 días (${p.vencidos} ya lo ${p.vencidos === 1 ? "ha" : "han"} alcanzado).`);
  }
  if (p.sin_historico > 0) {
    out.push(`La predicción cubre ${plural(p.con_ritmo_medido, "neumático", "neumáticos")}; ${p.sin_historico === 1 ? "otro tiene" : `otros ${p.sin_historico} tienen`} una sola medición y no permite${p.sin_historico === 1 ? "" : "n"} calcular ritmo todavía.`);
  }

  if (a.ejes_descompensados.length > 0) {
    out.push(`Se detecta${a.ejes_descompensados.length === 1 ? "" : "n"} ${plural(a.ejes_descompensados.length, "eje", "ejes")} con más de 2 mm de diferencia entre ruedas, un patrón asociado a presiones desiguales o problemas de alineación.`);
  }
  if (a.ejes_marcas_mezcladas.length > 0) {
    out.push(`Hay ${plural(a.ejes_marcas_mezcladas.length, "eje que monta", "ejes que montan")} marcas distintas en la misma posición de eje.`);
  }
  if (a.sin_marca > 0 || a.sin_medida > 0) {
    out.push(`Calidad del dato: ${plural(a.sin_marca, "neumático", "neumáticos")} sin marca y ${a.sin_medida} sin medida en ficha. Los cortes por marca y medida no cubren esas unidades.`);
  }

  return out;
}

export default function InformeEjecutivo() {
  const { filtros } = useInformesFiltros();
  const [d, setD] = useState<Datos | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    setCargando(true);
    setError(null);
    obtenerInformeEjecutivo(filtros)
      .then((r) => { if (vivo) setD(r); })
      .catch((e) => { if (vivo) setError(e?.message ?? "Error al cargar el informe"); })
      .finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
  }, [filtros]);

  const insights = useMemo(() => (d ? conclusiones(d) : []), [d]);

  if (cargando) return <div className="p-6 text-sm text-slate-400">Calculando el informe…</div>;
  if (error) {
    return (
      <div className="rounded-lg border border-rose-800 bg-rose-950/40 p-4 text-sm text-rose-200">
        <p className="font-semibold">No se ha podido generar el informe.</p>
        <p className="mt-1 text-[12px]">{error}</p>
        <p className="mt-2 text-[12px] text-rose-300/80">
          Si el mensaje menciona <code>tc_informe_ejecutivo</code>, falta ejecutar la migración
          <code> tyrecontrol_informe_ejecutivo.sql</code> en Supabase.
        </p>
      </div>
    );
  }
  if (!d) return null;

  const c = d.cabecera;
  const pctRevisado = c.vehiculos_total > 0 ? (c.vehiculos_revisados / c.vehiculos_total) * 100 : 0;
  const criticos = d.niveles.critico ?? 0;
  const bajos = d.niveles.bajo ?? 0;
  const totalNiveles = ORDEN_NIVEL.reduce((s, n) => s + (d.niveles[n] ?? 0), 0);

  const segmentos = ORDEN_NIVEL
    .filter((n) => (d.niveles[n] ?? 0) > 0)
    .map((n) => ({ etiqueta: ETIQUETA_NIVEL[n], valor: d.niveles[n] ?? 0, color: COLOR_NIVEL[n] }));

  // Se pintan siempre las seis bandas, con cero donde no hay: un histograma al
  // que le faltan columnas no se puede comparar con el del mes pasado.
  const bandas = BANDAS.map((b) => ({ banda: b, n: d.bandas.find((x) => x.banda === b)?.n ?? 0 }));
  const totalBandas = bandas.reduce((s, b) => s + b.n, 0);
  const porSemaforo = (s: Semaforo) => d.vehiculos.filter((v) => v.semaforo === s).length;

  return (
    <div className="flex flex-col gap-4 print:gap-3">
      {/* ── Portada ── */}
      <div className="flex flex-wrap items-end justify-between gap-3 rounded-lg bg-slate-800 p-4">
        <div>
          <h1 className="text-xl font-black text-slate-100">Informe ejecutivo de flota</h1>
          <p className="text-[12px] text-slate-400">
            Periodo {d.periodo.desde} → {d.periodo.hasta} · generado el{" "}
            {new Date(d.generado).toLocaleDateString("es-ES")}
          </p>
        </div>
        <button
          onClick={() => window.print()}
          className="flex items-center gap-1 rounded-lg bg-slate-700 px-3 py-1.5 text-[12px] font-semibold hover:bg-slate-600 print:hidden"
        >
          <Printer className="h-4 w-4" /> Imprimir / PDF
        </button>
      </div>

      {/* ── KPIs con tendencia ── */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <KpiCard title="Vehículos" value={nf(c.vehiculos_total)} hint={`${c.vehiculos_pendientes} sin revisar`} />
        <KpiCard
          title="Flota revisada"
          value={`${pctRevisado.toFixed(0)}%`}
          hint={`${c.vehiculos_revisados} de ${c.vehiculos_total}`}
          tono={pctRevisado >= 80 ? "ok" : pctRevisado >= 50 ? "warn" : "danger"}
        />
        <KpiCard title="Neumáticos medidos" value={nf(c.neumaticos_medidos)} hint={`${c.revisiones} revisiones`} />
        <KpiCard
          title="Bajo mínimo"
          value={nf(criticos)}
          hint={`${bajos} en aviso`}
          tono={criticos > 0 ? "danger" : "ok"}
        />
        <KpiCard
          title="Profundidad media"
          value={d.estadistica.media != null ? `${nf(d.estadistica.media, 1)} mm` : "—"}
          hint={`mediana ${nf(d.estadistica.mediana, 1)} mm`}
        />
      </div>

      {/* ── Comparativa con el periodo anterior ── */}
      <Seccion
        titulo="Evolución respecto al periodo anterior"
        sub={`Comparado con ${d.periodo_anterior.desde} → ${d.periodo_anterior.hasta}, de la misma duración.`}
      >
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {[
            { t: "Revisiones", a: d.comparativa.revisiones_actual, p: d.comparativa.revisiones_previo, baja: false },
            { t: "Vehículos revisados", a: d.comparativa.vehiculos_revisados_actual, p: d.comparativa.vehiculos_revisados_previo, baja: false },
            { t: "Mediciones bajo mínimo", a: d.comparativa.criticos_actual, p: d.comparativa.criticos_previo, baja: true },
            { t: "Profundidad media (mm)", a: d.comparativa.prof_media_actual, p: d.comparativa.prof_media_previo, baja: false, dec: 1 },
          ].map((x) => (
            <div key={x.t} className="rounded-lg bg-slate-900 p-3">
              <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{x.t}</div>
              {/* En móvil el valor y la tendencia compartían línea y "sin
                  comparativa" se partía encima de la cifra. Cada cosa en su
                  renglón: la cifra manda y la tendencia la acompaña. */}
              <div className="mt-1 text-2xl font-black leading-tight text-slate-100">{nf(x.a, x.dec ?? 0)}</div>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <Tendencia pct={variacion(x.a, x.p)} mejorSiBaja={x.baja} />
                <span className="text-[11px] text-slate-500">antes: {nf(x.p, x.dec ?? 0)}</span>
              </div>
            </div>
          ))}
        </div>
      </Seccion>

      {/* ── Estado del banco + estadística ── */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Seccion titulo="Estado del banco de neumáticos" sub="Cada neumático montado, clasificado por su última medición frente al umbral de su medida.">
          {totalNiveles === 0
            ? <p className="text-sm text-slate-500">Todavía no hay mediciones de neumáticos montados.</p>
            : <Donut segmentos={segmentos} />}
        </Seccion>

        <Seccion titulo="Estadística de profundidades" sub="Sobre la última medición de cada neumático montado.">
          {d.estadistica.n === 0
            ? <p className="text-sm text-slate-500">Sin datos.</p>
            : (
              <dl className="grid grid-cols-3 gap-3 text-[12px]">
                {[
                  ["Media", `${nf(d.estadistica.media, 1)} mm`], ["Mediana", `${nf(d.estadistica.mediana, 1)} mm`],
                  ["P25", `${nf(d.estadistica.p25, 1)} mm`], ["P75", `${nf(d.estadistica.p75, 1)} mm`],
                  ["Desviación", nf(d.estadistica.desviacion, 1)],
                  ["CV", d.estadistica.coef_variacion != null ? `${nf(d.estadistica.coef_variacion, 0)}%` : "—"],
                ].map(([k, v]) => (
                  <div key={k} className="rounded-lg bg-slate-900 p-3">
                    <dt className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{k}</dt>
                    <dd className="mt-0.5 whitespace-nowrap text-lg font-black text-slate-100">{v}</dd>
                  </div>
                ))}
              </dl>
            )}
        </Seccion>
      </div>

      {/* ── Banco de goma: a lo ancho, tarta 3D + tabla como el informe ── */}
      <Seccion titulo="Estado del banco de goma" sub="Profundidades de los neumáticos montados, en el formato del informe mensual.">
          {d.estadistica.n === 0 && <p className="text-sm text-slate-500">Sin datos.</p>}
          {d.estadistica.n > 0 && (
            <div>
              <h3 className="mb-1 text-center text-[15px] font-semibold uppercase tracking-wide text-slate-300">
                Estado banco de goma
              </h3>
              <div className="flex flex-wrap items-center justify-center gap-6">
                <div className="min-w-[300px] max-w-[440px] flex-1">
                  <TartaBandas items={bandas} />
                  {/* Leyenda bajo la tarta, como en el original. */}
                  <div className="mx-auto mt-1 grid max-w-[420px] grid-cols-2 gap-x-4 gap-y-1">
                    {bandas.map((b) => (
                      <span key={b.banda} className="flex items-center gap-1.5 text-[10.5px] text-slate-300">
                        <span className="inline-block h-2.5 w-2.5 shrink-0" style={{ background: BANDA_INFO[b.banda].color }} />
                        {BANDA_INFO[b.banda].etiqueta}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="min-w-[340px] flex-1 overflow-x-auto">
                  <table className="w-full border-collapse text-[12px]">
                    <thead>
                      <tr className="text-left text-slate-300">
                        <th className="border border-slate-600 px-2 py-1.5 font-semibold">Profundidad Neumáticos</th>
                        <th className="border border-slate-600 px-2 py-1.5 text-right font-semibold">nº de Neumáticos</th>
                        <th className="border border-slate-600 px-2 py-1.5 text-right font-semibold">%</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bandas.map((b) => (
                        <tr key={b.banda}>
                          {/* Celda coloreada con el tramo, como el informe; la
                              tinta cambia a blanco sobre fondos oscuros. */}
                          <td
                            className="whitespace-nowrap border border-slate-600 px-2 py-1"
                            style={{ background: BANDA_INFO[b.banda].color, color: tintaSobre(BANDA_INFO[b.banda].color) }}
                          >
                            {BANDA_INFO[b.banda].etiqueta}
                          </td>
                          <td className="border border-slate-600 px-2 py-1 text-right font-semibold text-slate-100">{nf(b.n)}</td>
                          <td className="border border-slate-600 px-2 py-1 text-right text-slate-200">
                            {(totalBandas > 0 ? (b.n / totalBandas) * 100 : 0).toFixed(2).replace(".", ",")}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </Seccion>

      {/* ── Serie histórica del banco de goma ── */}
      <Seccion
        titulo="Serie histórica del banco de goma"
        sub="Reparto porcentual de las mediciones de cada mes. Un mes sin columna de datos es un mes sin revisiones."
      >
        {(() => {
          const meses = d.evolucion_bandas ?? [];
          const conDatos = meses.some((m) => m.total > 0);
          if (!conDatos) return <p className="text-sm text-slate-500">Sin mediciones en los últimos 12 meses.</p>;
          const pct = (n: number, total: number) =>
            total > 0 ? `${((n / total) * 100).toFixed(2).replace(".", ",")}%` : "";
          const cabMes = (mes: string) => {
            const [y, m] = mes.split("-");
            const nombre = new Date(Number(y), Number(m) - 1, 1)
              .toLocaleDateString("es-ES", { month: "long" });
            return { nombre: nombre.toUpperCase(), anyo: y };
          };
          const filaExtra = [
            { k: "reesculturados" as const, etiqueta: "Reesculturadas", color: "#4472c4" },
            { k: "recauchutados" as const, etiqueta: "Recauchutadas", color: "#ed7d31" },
            { k: "rees_y_recau" as const, etiqueta: "Reesculturadas y recauchutadas", color: "#d93025" },
          ];
          return (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-[12px]">
                <thead className="text-slate-400">
                  <tr className="border-b border-slate-700 text-left">
                    <th className="py-1.5 pr-2">Profundidad Neumáticos</th>
                    {meses.map((m) => {
                      const c = cabMes(m.mes);
                      return (
                        <th key={m.mes} className="px-1 text-center font-semibold">
                          <div>{c.nombre}</div>
                          <div className="font-normal text-slate-500">{c.anyo}</div>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {BANDAS.map((b) => (
                    <tr key={b} className="border-b border-slate-700/50">
                      <td className="whitespace-nowrap py-1.5 pr-2">
                        <span className="flex items-center gap-2">
                          <span className="inline-block h-3 w-3 shrink-0 rounded-sm" style={{ background: BANDA_INFO[b].color }} />
                          <span className="text-slate-300">{BANDA_INFO[b].etiqueta}</span>
                        </span>
                      </td>
                      {meses.map((m) => (
                        <td key={m.mes} className="px-1 text-center text-slate-200">
                          {pct(m.bandas?.[b] ?? 0, m.total)}
                        </td>
                      ))}
                    </tr>
                  ))}
                  {/* Bloque reesculturadas / recauchutadas, como en el informe. */}
                  <tr>
                    <td colSpan={1 + meses.length} className="pt-3 pb-1 text-[11px] font-bold uppercase tracking-wide text-slate-400">
                      Reesculturadas y Recauchutadas
                    </td>
                  </tr>
                  {filaExtra.map((f) => (
                    <tr key={f.k} className="border-b border-slate-700/50">
                      <td className="whitespace-nowrap py-1.5 pr-2">
                        <span className="flex items-center gap-2">
                          <span className="inline-block h-3 w-3 shrink-0 rounded-sm" style={{ background: f.color }} />
                          <span className="text-slate-300">{f.etiqueta}</span>
                        </span>
                      </td>
                      {meses.map((m) => (
                        <td key={m.mes} className="px-1 text-center text-slate-200">
                          {pct(m[f.k] ?? 0, m.total)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })()}
      </Seccion>

      {/* ── Evolución mensual: una magnitud por gráfico, nunca doble eje ── */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Seccion titulo="Revisiones por mes" sub="Últimos 12 meses.">
          <ColumnChart items={d.evolucion.map((e) => ({ etiqueta: e.mes.slice(5), valor: e.revisiones }))} />
        </Seccion>
        <Seccion titulo="Profundidad media por mes (mm)" sub="Los meses sin mediciones aparecen como hueco, no como cero.">
          <LineChart items={d.evolucion.map((e) => ({ etiqueta: e.mes, valor: e.prof_media }))} sufijo=" mm" />
        </Seccion>
      </div>

      {/* ── Predicción ── */}
      <Seccion
        titulo="Previsión de sustituciones"
        sub={`Extrapolación lineal del desgaste medido entre revisiones. Cubre ${d.prediccion.con_ritmo_medido} neumáticos; ${d.prediccion.sin_historico} tienen una sola medición y quedan fuera.`}
      >
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {[
            { t: "Ya al límite", v: d.prediccion.vencidos, tono: "danger" as const },
            { t: "≤ 30 días", v: d.prediccion.dias_30, tono: "danger" as const },
            { t: "31-60 días", v: d.prediccion.dias_60, tono: "warn" as const },
            { t: "61-90 días", v: d.prediccion.dias_90, tono: "warn" as const },
            { t: "91-180 días", v: d.prediccion.dias_180, tono: "neutral" as const },
          ].map((x) => <KpiCard key={x.t} title={x.t} value={nf(x.v)} tono={x.v > 0 ? x.tono : "neutral"} />)}
        </div>
        {d.prediccion.con_ritmo_medido === 0 && (
          <p className="mt-3 text-[12px] text-amber-300">
            Todavía no hay ningún neumático con dos mediciones, así que no se puede calcular ritmo de desgaste.
            La previsión aparecerá tras la segunda ronda de revisiones.
          </p>
        )}
      </Seccion>

      {/* ── Bases y ejes ── */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Seccion titulo="Por base" sub="Vehículos por delegación y cuántos requieren acción.">
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead className="text-slate-400">
                <tr className="border-b border-slate-700 text-left">
                  <th className="py-1.5">Base</th><th>Vehículos</th><th>Intervenir</th>
                  <th>Revisar</th><th>Mín. mm</th><th>Media mm</th>
                </tr>
              </thead>
              <tbody>
                {d.por_base.map((b) => (
                  <tr key={b.base} className="border-b border-slate-700/50">
                    <td className="py-1.5 font-semibold text-slate-200">{b.base}</td>
                    <td>{b.vehiculos}</td>
                    <td className={b.intervenir > 0 ? "font-bold text-rose-400" : "text-slate-400"}>{b.intervenir}</td>
                    <td className={b.revisar > 0 ? "font-bold text-orange-400" : "text-slate-400"}>{b.revisar}</td>
                    <td>{nf(b.min_mm, 1)}</td>
                    <td>{nf(b.media_mm, 1)}</td>
                  </tr>
                ))}
                {d.por_base.length === 0 && <tr><td colSpan={6} className="py-3 text-slate-500">Sin datos.</td></tr>}
              </tbody>
            </table>
          </div>
        </Seccion>

        <Seccion
          titulo="Profundidad media por eje"
          sub="Los ejes se identifican por su número. El sistema no registra cuál es el motriz, así que no se etiquetan como dirección o tracción."
        >
          {d.por_eje.length === 0 && <p className="text-sm text-slate-500">Sin datos.</p>}
          <div className="flex flex-col gap-2.5">
            {d.por_eje.map((e) => {
              // Escala fija de 0 a 15 mm (dibujo típico de camión nuevo):
              // comparable entre meses. Con el máximo del propio mes, un mes
              // malo estiraría sus barras y parecería igual de sano.
              const pct = e.prof_media != null ? Math.min(100, (e.prof_media / 15) * 100) : 0;
              return (
                <div key={e.eje}>
                  <div className="mb-0.5 flex items-baseline justify-between text-[12px]">
                    <span className="text-slate-300">
                      Eje {e.eje} <span className="text-slate-500">· {e.unidades} ud</span>
                      {e.criticos > 0 && (
                        <span className="ml-2 font-bold text-rose-400">{e.criticos} bajo mínimo</span>
                      )}
                    </span>
                    <span className="font-semibold text-slate-100">
                      {e.prof_media != null ? `${nf(e.prof_media, 1)} mm` : "—"}
                    </span>
                  </div>
                  <div className="h-2.5 overflow-hidden rounded bg-slate-900">
                    <div
                      className="h-full rounded"
                      // La barra es la MEDIA del eje: si además hay críticos, se
                      // avisa en texto — la media puede ser buena con una rueda al
                      // límite, y eso la barra sola no lo enseña.
                      style={{ width: `${pct}%`, background: e.criticos > 0 ? "#fb923c" : "#38bdf8" }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
          {d.por_eje.every((e) => e.criticos === 0) && d.por_eje.length > 0 && (
            <p className="mt-2.5 text-[12px] text-emerald-400">Ningún eje tiene neumáticos por debajo del mínimo.</p>
          )}
        </Seccion>
      </div>

      {/* ── Marcas y medidas ── */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Seccion titulo="Por marca" sub="Reparto de lo montado y su estado.">
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead className="text-slate-400">
                <tr className="border-b border-slate-700 text-left">
                  <th className="py-1.5">Marca</th><th>Unidades</th><th>Media mm</th><th>Críticos</th><th>Reescult.</th>
                </tr>
              </thead>
              <tbody>
                {d.por_marca.map((m) => (
                  <tr key={m.marca} className="border-b border-slate-700/50">
                    <td className="py-1.5 font-semibold text-slate-200">{m.marca}</td>
                    <td>{m.unidades}</td><td>{nf(m.prof_media, 1)}</td>
                    <td className={m.criticos > 0 ? "font-bold text-rose-400" : "text-slate-400"}>{m.criticos}</td>
                    <td>{m.reesculturados}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Seccion>

        <Seccion titulo="Por medida" sub="Útil para dimensionar el stock del mes.">
          <BarList
            items={d.por_medida.slice(0, 10).map((m) => ({ etiqueta: `${m.medida} · ${nf(m.prof_media, 1)} mm media`, valor: m.unidades }))}
          />
        </Seccion>
      </div>

      {/* ── Anomalías ── */}
      <Seccion titulo="Anomalías detectadas" sub="Patrones que no se ven mirando un neumático aislado.">
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <h3 className="mb-2 flex items-center gap-1.5 text-[12px] font-bold text-amber-300">
              <AlertTriangle className="h-3.5 w-3.5" />
              Ejes descompensados ({d.anomalias.ejes_descompensados.length})
            </h3>
            <p className="mb-2 text-[11px] text-slate-500">Más de 2 mm de diferencia entre ruedas del mismo eje.</p>
            {d.anomalias.ejes_descompensados.length === 0
              ? <p className="text-[12px] text-emerald-400">Ninguno.</p>
              : (
                <ul className="flex flex-col gap-1 text-[12px]">
                  {d.anomalias.ejes_descompensados.slice(0, 12).map((x, i) => (
                    <li key={i} className="flex justify-between border-b border-slate-700/50 pb-1">
                      <span className="text-slate-300">{x.matricula} · eje {x.eje}</span>
                      <span className="font-bold text-amber-300">{nf(x.dif_mm, 1)} mm</span>
                    </li>
                  ))}
                </ul>
              )}
          </div>
          <div>
            <h3 className="mb-2 flex items-center gap-1.5 text-[12px] font-bold text-amber-300">
              <AlertTriangle className="h-3.5 w-3.5" />
              Marcas mezcladas en un eje ({d.anomalias.ejes_marcas_mezcladas.length})
            </h3>
            <p className="mb-2 text-[11px] text-slate-500">Distintas marcas montadas en el mismo eje.</p>
            {d.anomalias.ejes_marcas_mezcladas.length === 0
              ? <p className="text-[12px] text-emerald-400">Ninguno.</p>
              : (
                <ul className="flex flex-col gap-1 text-[12px]">
                  {d.anomalias.ejes_marcas_mezcladas.slice(0, 12).map((x, i) => (
                    <li key={i} className="flex justify-between border-b border-slate-700/50 pb-1">
                      <span className="text-slate-300">{x.matricula} · eje {x.eje}</span>
                      <span className="font-bold text-amber-300">{x.marcas} marcas</span>
                    </li>
                  ))}
                </ul>
              )}
            {(d.anomalias.sin_marca > 0 || d.anomalias.sin_medida > 0) && (
              <p className="mt-3 border-t border-slate-700 pt-2 text-[11px] text-slate-400">
                Calidad del dato: {d.anomalias.sin_marca} sin marca · {d.anomalias.sin_medida} sin medida en ficha.
              </p>
            )}
          </div>
        </div>
      </Seccion>

      {/* ── Vehículos ── */}
      <Seccion
        titulo="Estado por vehículo"
        sub="Cada vehículo toma el estado de su peor neumático. Ordenados por urgencia."
      >
        <div className="mb-3 flex flex-wrap gap-3 text-[11px]">
          {(["intervenir", "revisar", "vigilar", "correcto", "sin_datos"] as Semaforo[]).map((s) => (
            <span key={s} className="flex items-center gap-1">
              <span>{SEMAFORO[s].punto}</span>
              <span className="text-slate-400">{SEMAFORO[s].label}</span>
              <span className="font-bold text-slate-200">{porSemaforo(s)}</span>
            </span>
          ))}
        </div>
        <div className="max-h-[420px] overflow-auto print:max-h-none">
          <table className="w-full text-[12px]">
            <thead className="sticky top-0 bg-slate-800 text-slate-400">
              <tr className="border-b border-slate-700 text-left">
                <th className="py-1.5">Estado</th><th>Matrícula</th><th>Base</th>
                <th>Neum.</th><th>Mín. mm</th><th>Media mm</th><th>Últ. revisión</th>
              </tr>
            </thead>
            <tbody>
              {d.vehiculos.map((v) => (
                <tr key={v.matricula} className="border-b border-slate-700/50">
                  {/* Punto + texto: el estado nunca se transmite solo por color. */}
                  <td className={`py-1.5 whitespace-nowrap font-semibold ${SEMAFORO[v.semaforo].color}`}>
                    {SEMAFORO[v.semaforo].punto} {SEMAFORO[v.semaforo].label}
                  </td>
                  <td className="font-semibold text-slate-200">{v.matricula}</td>
                  <td className="text-slate-400">{v.base ?? "—"}</td>
                  <td>{v.n_neumaticos}</td>
                  <td className={v.criticos > 0 ? "font-bold text-rose-400" : ""}>{nf(v.min_mm, 1)}</td>
                  <td>{nf(v.media_mm, 1)}</td>
                  <td className="text-slate-400">{v.ultima_revision ?? "sin revisar"}</td>
                </tr>
              ))}
              {d.vehiculos.length === 0 && <tr><td colSpan={7} className="py-3 text-slate-500">Sin vehículos activos.</td></tr>}
            </tbody>
          </table>
        </div>
      </Seccion>

      {/* ── Conclusiones ── */}
      <Seccion
        titulo="Conclusiones"
        sub="Redactadas a partir de las cifras de este mismo informe: cada frase es comprobable en las tablas de arriba."
      >
        {insights.length === 0
          ? <p className="text-sm text-slate-500">No hay datos suficientes para extraer conclusiones.</p>
          : (
            <ul className="flex flex-col gap-2">
              {insights.map((t, i) => (
                <li key={i} className="flex gap-2 text-[13px] leading-relaxed text-slate-300">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-sky-400" />
                  <span>{t}</span>
                </li>
              ))}
            </ul>
          )}
      </Seccion>
    </div>
  );
}
