/**
 * El resguardo de recepción, en papel.
 *
 * Genera el documento HTML que se manda a la impresora con TODO lo que hay en
 * la ficha de la recepción. Es una función pura —entra una recepción, sale una
 * cadena— para poder probar en un test lo que de otro modo solo se ve
 * imprimiendo: que no se pierde un campo, que un apóstrofo en el nombre del
 * cliente no rompe la página, y que el texto legal aparece cuando lo hay y no
 * deja un hueco cuando no.
 *
 * ── Por qué una ventana nueva y no `@media print` ───────────────────────────
 *
 * Es lo que ya hace el resto de la casa (las etiquetas de herramientas, las de
 * máquinas). Una hoja que se arma aparte no pelea con el tema oscuro del panel
 * ni con sus estilos globales, y lo que sale por la impresora es exactamente
 * lo que dice este fichero.
 *
 * ── Pensado para una láser barata y una fotocopia ───────────────────────────
 *
 * Negro sobre blanco, sin fondos oscuros ni grises finos: en el taller esto se
 * imprime y se fotocopia, y un diseño con medios tonos desaparece. La
 * matrícula va del tamaño de un titular porque el papel se lee desde dos
 * metros, en el patio o pegado al parabrisas.
 */

import type { RecepcionVehiculo } from "../recepcionVehiculo";

/**
 * El texto legal del resguardo de depósito.
 *
 * Vacío a propósito: hoy el papel es INTERNO. El día que exista el texto —lo
 * está buscando quien lleva el taller— se pega aquí y el bloque aparece solo,
 * sin tocar nada más. No se inventa: un texto de depósito de vehículo mal
 * redactado es peor que no tenerlo, porque parece que obliga a algo.
 */
export const TEXTO_LEGAL_DEPOSITO = "";

/** Lo que el documento necesita saber de fuera de la recepción. */
export type DatosDelResguardo = {
  /** Nombre del taller para la cabecera. */
  taller: string;
  /** Cuándo se imprime. Se pasa para que el test no dependa del reloj. */
  ahoraMs: number;
  /** Etiqueta legible del área, que la recepción guarda como clave. */
  areaLabel?: string | null;
  /** El texto de depósito, cuando lo haya. */
  textoLegal?: string;
};

/**
 * Escapa lo que va dentro del HTML.
 *
 * No es paranoia de manual: las notas del patio las escribe una persona en una
 * tablet, y un `<` suelto —o un `</script>`— parte el documento por la mitad y
 * lo que sale de la impresora es medio resguardo. Con un `&` basta para
 * empezar a torcer las cosas.
 */
export function escapa(valor: unknown): string {
  return String(valor ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Fecha y hora como se dicen aquí: 25/09/2026 09:44. */
export function fechaHora(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(Number(ms))) return "—";
  const d = new Date(Number(ms));
  const dos = (n: number) => String(n).padStart(2, "0");
  return `${dos(d.getDate())}/${dos(d.getMonth() + 1)}/${d.getFullYear()} ${dos(
    d.getHours()
  )}:${dos(d.getMinutes())}`;
}

/** Los kilómetros con su punto de miles, o una raya si no se tomaron. */
export function kilometrosLegibles(km: number | null | undefined): string {
  if (km == null || !Number.isFinite(Number(km))) return "—";
  return Number(km).toLocaleString("es-ES");
}

const ESTADOS: Record<string, string> = {
  pendiente: "Pendiente de validar",
  convertida: "Convertida en trabajo",
  descartada: "Descartada",
};

/** Un campo con su rótulo, como se pinta en la hoja. */
function campo(rotulo: string, valor: string, anchoPx?: number): string {
  const ancho = anchoPx ? `width:${anchoPx}px` : "flex-grow:1";
  const falta = valor === "" || valor === "—";
  return `<div style="${ancho}">
    <div style="font-size:11px;letter-spacing:1.4px;color:#4a4a46;font-weight:600">${escapa(
      rotulo
    )}</div>
    <div style="font-size:17px;font-weight:600;margin-top:2px;color:${
      falta ? "#8a8a84" : "#141413"
    }">${falta ? "—" : escapa(valor)}</div>
  </div>`;
}

/**
 * El documento entero, listo para `document.write`.
 *
 * Se imprime solo al terminar de cargar: `window.onload` espera a las fotos, y
 * sin esa espera la hoja sale con los recuadros vacíos.
 */
export function htmlDelResguardo(
  r: RecepcionVehiculo,
  datos: DatosDelResguardo
): string {
  const legal = (datos.textoLegal ?? TEXTO_LEGAL_DEPOSITO).trim();

  const fotos = (r.fotos ?? []).filter((f) => f && f.url);
  const bloqueFotos = fotos.length
    ? `<div style="display:flex;gap:12px;flex-wrap:wrap">${fotos
        .map(
          (f) =>
            `<img src="${escapa(f.url)}" alt="${escapa(
              f.nombre || "Foto de la recepción"
            )}" style="width:168px;height:112px;object-fit:cover;border:1.5px solid #141413;border-radius:8px">`
        )
        .join("")}</div>`
    : `<div style="font-size:13px;color:#8a8a84">Sin fotos.</div>`;

  const bloqueTrabajo =
    r.jobId != null
      ? `<div style="margin-top:16px;border:1.5px solid #141413;border-radius:10px;overflow:hidden">
          <div style="background:#141413;color:#fff;padding:7px 16px;font-size:11px;letter-spacing:1.4px;font-weight:600">ORDEN DE TRABAJO</div>
          <div style="padding:16px;display:flex;gap:20px">
            ${campo("Nº TRABAJO", String(r.jobId), 150)}
            ${campo("VALIDADA POR", r.resueltaPor || "—")}
            ${campo("FECHA", fechaHora(r.resueltaAtMs), 180)}
          </div>
        </div>`
      : "";

  const bloqueLegal = legal
    ? `<div style="margin-top:16px;border:1.5px solid #141413;border-radius:10px;padding:14px 16px">
        <div style="font-size:11px;letter-spacing:1.4px;color:#4a4a46;font-weight:600;margin-bottom:6px">CONDICIONES DE DEPÓSITO</div>
        <div style="font-size:11px;line-height:1.5;text-align:justify">${escapa(
          legal
        )}</div>
      </div>`
    : "";

  const descarte =
    r.estado === "descartada" && r.motivoDescarte
      ? `<div style="margin-top:16px;border:1.5px solid #141413;border-radius:10px;padding:14px 16px">
          <div style="font-size:11px;letter-spacing:1.4px;color:#4a4a46;font-weight:600">MOTIVO DEL DESCARTE</div>
          <div style="font-size:15px;margin-top:4px">${escapa(r.motivoDescarte)}</div>
        </div>`
      : "";

  return `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8">
<title>Recepción ${escapa(r.matricula)}</title>
<style>
  @page { size: A4; margin: 14mm }
  * { box-sizing: border-box }
  body { margin:0; background:#fff; color:#141413;
         font-family: 'Archivo', 'Helvetica Neue', Helvetica, sans-serif }
  strong { color:#141413 }
</style></head>
<body>
<div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #141413;padding-bottom:14px">
  <div>
    <div style="font-size:22px;font-weight:700;letter-spacing:-0.4px;line-height:1">WorkPlanner</div>
    <div style="font-size:12px;color:#4a4a46;margin-top:3px">${escapa(
      datos.taller
    )} · Recepción de vehículos</div>
  </div>
  <div style="text-align:right">
    <div style="font-size:15px;font-weight:700;letter-spacing:0.6px">RESGUARDO DE RECEPCIÓN</div>
    <div style="font-size:12px;color:#4a4a46;margin-top:3px">Nº ${escapa(
      r.id
    )} · ${escapa(fechaHora(r.creadaAtMs))}</div>
  </div>
</div>

<div style="display:flex;gap:20px;margin-top:22px;align-items:stretch">
  <div style="flex-grow:1;border:3px solid #141413;border-radius:10px;padding:14px 20px 16px">
    <div style="font-size:11px;letter-spacing:1.4px;color:#4a4a46;font-weight:600">MATRÍCULA</div>
    <div style="font-size:62px;font-weight:700;line-height:1.02;letter-spacing:1px">${escapa(
      r.matricula
    )}</div>
  </div>
  <div style="width:232px;display:flex;flex-direction:column;gap:10px">
    <div style="border:1.5px solid #141413;border-radius:10px;padding:12px 16px 13px">
      <div style="font-size:11px;letter-spacing:1.4px;color:#4a4a46;font-weight:600">KILÓMETROS</div>
      <div style="font-size:30px;font-weight:700;line-height:1.15">${escapa(
        kilometrosLegibles(r.kilometros)
      )}</div>
    </div>
    <div style="flex-grow:1;border:${
      r.urgente ? "3px" : "1.5px"
    } solid #141413;border-radius:10px;padding:12px 16px;display:flex;flex-direction:column;justify-content:center">
      <div style="font-size:11px;letter-spacing:1.4px;color:#4a4a46;font-weight:600">ESTADO</div>
      <div style="font-size:17px;font-weight:700">${escapa(
        ESTADOS[r.estado] ?? r.estado
      )}${r.urgente ? " · URGENTE" : ""}</div>
    </div>
  </div>
</div>

<div style="margin-top:20px;display:flex;gap:20px">
  <div style="flex-grow:1;border-bottom:1.5px solid #141413;padding-bottom:9px">
    ${campo("CLIENTE", r.clienteNombre || "—")}
  </div>
  <div style="width:232px;border-bottom:1.5px solid #141413;padding-bottom:9px">
    ${campo("TELÉFONO", r.clienteTelefono || "—")}
  </div>
</div>

<div style="margin-top:22px;border:1.5px solid #141413;border-radius:10px;overflow:hidden">
  <div style="background:#141413;color:#fff;padding:7px 16px;font-size:11px;letter-spacing:1.4px;font-weight:600">TRABAJO PEDIDO</div>
  <div style="padding:16px">
    <div style="display:flex;gap:20px">
      ${campo("ÁREA", datos.areaLabel || r.area || "—", 150)}
      ${campo("OPERACIÓN", r.operacionLabel || "—")}
      ${campo("CON CITA", r.scheduledJobId != null ? "Sí" : "No", 118)}
    </div>
    <div style="border-top:1px solid #d6d6d0;padding-top:12px;margin-top:14px">
      <div style="font-size:11px;letter-spacing:1.4px;color:#4a4a46;font-weight:600">NOTAS DEL PATIO</div>
      <div style="font-size:15px;line-height:1.55;margin-top:4px;white-space:pre-line;color:${
        r.notas ? "#141413" : "#8a8a84"
      }">${r.notas ? escapa(r.notas) : "Sin notas."}</div>
    </div>
  </div>
</div>

${bloqueTrabajo}
${descarte}

<div style="margin-top:22px">
  <div style="font-size:11px;letter-spacing:1.4px;color:#4a4a46;font-weight:600;margin-bottom:9px">FOTOS DE LA RECEPCIÓN</div>
  ${bloqueFotos}
</div>

${bloqueLegal}

<div style="display:flex;gap:24px;margin-top:34px">
  <div style="flex-grow:1">
    <div style="height:62px;border-bottom:1.5px solid #141413"></div>
    <div style="font-size:12px;color:#4a4a46;margin-top:7px">Recibido en el patio por <strong>${escapa(
      r.operarioNombre
    )}</strong> · ${escapa(fechaHora(r.creadaAtMs))}</div>
  </div>
  <div style="flex-grow:1">
    <div style="height:62px;border-bottom:1.5px solid #141413"></div>
    <div style="font-size:12px;color:#4a4a46;margin-top:7px">Firma del cliente</div>
  </div>
</div>

<div style="margin-top:18px;border-top:1px solid #d6d6d0;padding-top:11px;display:flex;justify-content:space-between;font-size:11px;color:#4a4a46">
  <div>${
    legal
      ? "Resguardo de depósito del vehículo."
      : "Documento interno. No es un presupuesto ni una factura."
  }</div>
  <div>Impreso el ${escapa(fechaHora(datos.ahoraMs))}</div>
</div>

<script>window.onload=function(){window.print()}<\/script>
</body></html>`;
}
