import type { Express, RequestHandler } from "express";
import { hayIA } from "../../core/openaiService.ts";
import { supabase } from "../../supabase.ts";
import { LectorParteIA, type LectorParte } from "./lectorParte.ts";
import { armarParte, type MovimientoFila } from "./armarParte.ts";
import { filasDeOperaciones, type OperacionFila, type MedicionPos }
  from "./filasDeOperaciones.ts";
import { quitarFondoNegro } from "./fondoPlano.ts";
import { generarPartePdf } from "./generarPdf.ts";

/**
 * Parte de servicio a partir de fotografías.
 *
 * SOLO PROPONE. No crea vehículos, no monta neumáticos y no toca el catálogo:
 * devuelve lo leído para que el técnico lo confirme o lo corrija. Guardar es
 * cosa de las funciones de la base de datos, que ya existen y piden una
 * confirmación explícita.
 *
 * Las fotos NO se guardan aquí: llegan ya subidas al Storage de Mobilink y el
 * servidor solo pasa sus URL al modelo.
 */

/** Tope de fotos por parte. Un parte son la matrícula, el cuentakilómetros,
 *  el vehículo y sus ruedas: con 24 va sobrado, y sin tope una petición podría
 *  costar lo que quisiera quien la lance. */
const MAX_FOTOS = 24;

/** El mismo cubo donde ya viven las fotos y las firmas de TyreControl. */
const BUCKET_PARTES = "tc-revisiones-fotos";

/**
 * ¿El usuario de la petición puede ver esta empresa?
 *
 * Reproduce a mano lo que hace tc_puede_ver_empresa en la base de datos,
 * porque aquí la RLS no protege: el cliente de servidor usa service_role.
 */
async function puedeVerEmpresa(req: any, empresaId: string): Promise<boolean> {
  const userId = req.authCtx?.userId as string | undefined;
  if (!userId) return false;
  if (req.authCtx?.esSuperadmin === true) return true;

  const { data: u } = await supabase
    .from("tc_usuarios").select("rol, empresa_id, es_superadmin, activo")
    .eq("id", userId).maybeSingle();
  if (!u || u.activo === false) return false;
  if (u.es_superadmin) return true;
  if (u.rol === "administrador" && u.empresa_id === empresaId) return true;
  // Cliente: solo la suya, y solo para leer — que es lo único que hace esto.
  if (u.rol === "cliente" && u.empresa_id === empresaId) return true;

  const { data: asignado } = await supabase
    .from("tc_operador_empresas").select("empresa_id")
    .eq("usuario_id", userId).eq("empresa_id", empresaId).maybeSingle();
  return !!asignado;
}

/**
 * El plano del chasis del vehículo, en bytes, para el recuadro «Posición
 * Ruedas» del parte.
 *
 * MISMO ORDEN QUE LA TABLET, y no por casualidad: la imagen propia de la marca
 * para esa configuración de ejes, si no la genérica de la configuración, y si
 * no la del tipo de vehículo. Si el papel enseñara un plano distinto del que
 * el técnico acaba de usar en la pantalla, sería peor que no enseñar ninguno.
 *
 * Devuelve null en cuanto algo no cuadra —no hay imagen, no responde, no es
 * una imagen—: el PDF deja el recuadro como estaba y el parte sale igual. Un
 * plano que no se puede traer no es motivo para no entregar el papel.
 */
async function planoDelVehiculo(veh: any): Promise<Uint8Array | null> {
  if (!veh) return null;
  try {
    const candidatos: (string | null | undefined)[] = [];

    if (veh.config_ejes_id) {
      // La mayoría de vehículos guardan la marca como texto suelto y no
      // enlazada al catálogo, así que si no hay marca_id se busca por nombre.
      let marcaId: string | null = veh.marca_id ?? null;
      if (!marcaId && (veh.marca ?? "").trim()) {
        const { data: m } = await supabase
          .from("tc_cat_marcas_vehiculo").select("id")
          .ilike("nombre", String(veh.marca).trim()).limit(1);
        marcaId = (m?.[0] as any)?.id ?? null;
      }
      if (marcaId) {
        const { data: cm } = await supabase
          .from("tc_config_ejes_marca").select("imagen_chasis_url")
          .eq("config_ejes_id", veh.config_ejes_id).eq("marca_id", marcaId).limit(1);
        candidatos.push((cm?.[0] as any)?.imagen_chasis_url);
      }
      const { data: ce } = await supabase
        .from("tc_config_ejes").select("imagen_chasis_url")
        .eq("id", veh.config_ejes_id).maybeSingle();
      candidatos.push((ce as any)?.imagen_chasis_url);
    }
    candidatos.push(veh.tipo?.imagen_chasis_url);

    const url = candidatos.map((u) => (u ?? "").trim()).find(Boolean);
    if (!url) return null;

    const r = await fetch(url);
    if (!r.ok) return null;
    const tipo = r.headers.get("content-type") ?? "";
    // pdf-lib solo sabe incrustar PNG y JPEG. Un SVG o un WebP reventarían al
    // incrustarlo, y ese error no debe llevarse por delante el parte.
    if (tipo && !/image\/(png|jpe?g)/i.test(tipo)) return null;
    // Los planos son renders sobre fondo negro: metidos tal cual dejan un
    // rectángulo negro en medio del papel. Ver fondoPlano.ts.
    return await quitarFondoNegro(new Uint8Array(await r.arrayBuffer()));
  } catch {
    return null;
  }
}

export function mountParte(app: Express, ...guards: RequestHandler[]): void {
  const lector: LectorParte = new LectorParteIA();

  app.get("/api/tyrecontrol/parte/estado", ...guards, (_req, res) => {
    res.json({ disponible: hayIA(), max_fotos: MAX_FOTOS });
  });

  app.post("/api/tyrecontrol/parte/leer", ...guards, async (req, res) => {
    try {
      if (!hayIA()) {
        return res.status(503).json({ error: "Lectura de partes no disponible (falta OPENAI_API_KEY)" });
      }
      const brutas = req.body?.imagenes;
      if (!Array.isArray(brutas) || brutas.length === 0) {
        return res.status(400).json({ error: "Hacen falta las fotografías" });
      }
      if (brutas.length > MAX_FOTOS) {
        return res.status(400).json({ error: `Demasiadas fotografías (máximo ${MAX_FOTOS})` });
      }

      const imagenes = brutas.map((x: unknown) => String(x ?? "").trim()).filter(Boolean);
      // Solo lo que esté subido a Mobilink o venga dentro de la petición.
      // Aceptar cualquier URL convertiría esto en un descargador de lo que le
      // pidan desde fuera.
      for (const url of imagenes) {
        const esDataUri = url.startsWith("data:image/");
        const esNuestra = /^https:\/\/[a-z0-9-]+\.supabase\.co\//i.test(url);
        if (!esDataUri && !esNuestra) {
          return res.status(400).json({ error: "Las fotos tienen que estar subidas a Mobilink" });
        }
        if (esDataUri && url.length > 12_000_000) {
          return res.status(413).json({ error: "Alguna fotografía es demasiado grande" });
        }
      }

      const parte = await lector.leer(imagenes);
      // 200 aunque no se haya podido leer: unas fotos que no dan no son un
      // error del servidor. El APK enseña los avisos y deja seguir a mano.
      res.json(parte);
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "No se ha podido leer el parte" });
    }
  });

  /**
   * El parte en PDF de una intervención.
   *
   * No se rellena a mano: se DERIVA de lo que Mobilink ya guarda —la
   * intervención, sus movimientos de neumático y sus líneas de servicio—, así
   * que reimprimirlo mañana dice lo que de verdad pasó.
   *
   * Está aparte de la ruta porque hay dos maneras de pedirlo —descargarlo, o
   * guardarlo para abrirlo desde el móvil— y las dos tienen que comprobar
   * exactamente el mismo permiso.
   */
  async function construirPdf(req: any, id: string):
      Promise<{ estado: number; error: string } | { pdf: Uint8Array; nombre: string }> {
      if (!/^[0-9a-f-]{36}$/i.test(id)) return { estado: 400, error: "Parte no válido" };

      const { data: interv, error: e1 } = await supabase
        .from("tc_intervenciones")
        .select(`*, vehiculo:tc_vehiculos(id, matricula, km_actual, config_ejes_id,
                   marca, marca_id, tipo:tc_tipos_vehiculo(imagen_chasis_url),
                   empresa:tc_empresas(nombre))`)
        .eq("id", id).maybeSingle();
      if (e1) throw new Error(e1.message);
      if (!interv) return { estado: 404, error: "Parte no encontrado" };

      // Este endpoint corre con service_role, o sea que SE SALTA LA RLS. El
      // permiso hay que comprobarlo aquí a mano y con la misma regla que usa
      // tc_puede_ver_empresa: superadmin, administrador de esa empresa, u
      // operador asignado a ella. Sin esto, cualquiera con sesión podría
      // descargarse el parte de otro cliente.
      if (!(await puedeVerEmpresa(req, interv.empresa_id))) {
        return { estado: 403, error: "Sin permiso sobre este parte" };
      }

      // Las OPERACIONES, que es la tabla que escriben todas las RPC. Antes esto
      // leía tc_operacion_movimientos, que tc_desmontar_neumatico y
      // tc_montar_desde_catalogo no rellenan, y el papel salía en blanco
      // aunque el parte estuviera perfectamente guardado. Ver
      // filasDeOperaciones.ts.
      const { data: ops } = await supabase
        .from("operaciones_neumaticos")
        .select(`tipo_operacion, motivo, destino, estado_anterior, estado_nuevo,
                 observaciones, is_anulada, status,
                 neumatico:tc_neumaticos(marca, modelo, medida, numero_serie, dot, numero_interno),
                 posicion_origen:tc_posiciones_vehiculo!operaciones_neumaticos_posicion_origen_id_fkey(codigo_posicion),
                 posicion_destino:tc_posiciones_vehiculo!operaciones_neumaticos_posicion_destino_id_fkey(codigo_posicion)`)
        .eq("intervencion_id", id)
        .order("created_at");

      // Los milímetros y la presión los mide el técnico en la revisión del
      // propio parte, por posición: las RPC de montaje y desmontaje no guardan
      // profundidades. Si la intervención no vino del parte guiado no hay
      // revisión, y las casillas se quedan vacías en vez de inventarse.
      const medicionPorPosicion: Record<string, MedicionPos> = {};
      const { data: pg } = await supabase
        .from("tc_partes_guiados").select("revision_id")
        .eq("intervencion_id", id).maybeSingle();
      if (pg?.revision_id) {
        const { data: det } = await supabase
          .from("revisiones_neumaticos_detalle")
          .select("profundidad_mm, presion_bar, posicion:tc_posiciones_vehiculo(codigo_posicion)")
          .eq("revision_id", pg.revision_id);
        for (const d of (det ?? []) as any[]) {
          const cod = d.posicion?.codigo_posicion;
          if (cod) medicionPorPosicion[cod] = {
            profundidad_mm: d.profundidad_mm, presion_bar: d.presion_bar,
          };
        }
      }

      const filas: MovimientoFila[] = filasDeOperaciones(
        (ops ?? []) as OperacionFila[], medicionPorPosicion);

      const { data: servicios } = await supabase
        .from("tc_intervencion_servicios")
        .select("servicio, cantidad").eq("intervencion_id", id);

      // El plano REAL del vehículo, encima del diagrama numerado de Conti360.
      // El PDF ya sabía ponerlo; lo que faltaba era dárselo. Enseñar la
      // numeración 1IZI/2IZE de la plantilla cuando Mobilink usa otra es pedir
      // que alguien apunte una medición en la rueda equivocada.
      const plano = await planoDelVehiculo(interv.vehiculo);

      // Y dónde cae cada rueda en ese plano, para marcar las que se han
      // tocado. Son las mismas coordenadas calibradas que usa la tablet.
      const marcas: { x: number; y: number }[] = [];
      if (plano && interv.vehiculo?.id) {
        const { data: veh2 } = await supabase
          .from("tc_vehiculos").select("tipo_vehiculo_id")
          .eq("id", interv.vehiculo.id).maybeSingle();
        if ((veh2 as any)?.tipo_vehiculo_id) {
          const { data: pos } = await supabase
            .from("tc_posiciones_vehiculo")
            .select("codigo_posicion, pos_x, pos_y")
            .eq("tipo_vehiculo_id", (veh2 as any).tipo_vehiculo_id);
          const porCodigo = new Map<string, { x: number; y: number }>();
          for (const q of (pos ?? []) as any[]) {
            if (q.pos_x == null || q.pos_y == null) continue;
            porCodigo.set(q.codigo_posicion, { x: Number(q.pos_x), y: Number(q.pos_y) });
          }
          // Una posición tocada dos veces (sale una goma y entra otra) se
          // marca UNA vez: dos cruces encima de la misma rueda no dicen más.
          const vistas = new Set<string>();
          for (const f of filas) {
            const c = f.posicion;
            if (!c || vistas.has(c)) continue;
            const p = porCodigo.get(c);
            if (p) { marcas.push(p); vistas.add(c); }
          }
        }
      }

      const parte = armarParte(
        {
          ...interv,
          matricula: interv.vehiculo?.matricula ?? null,
          flota: interv.vehiculo?.empresa?.nombre ?? null,
          km: interv.vehiculo?.km_actual ?? null,
        },
        filas,
        (servicios ?? []) as { servicio: string; cantidad: number }[],
      );

      const pdf = await generarPartePdf({ ...parte, plano, marcas });

      return { pdf, nombre: `parte-${(interv.numero || id).replace(/[^\w.-]/g, "_")}.pdf` };
  }

  app.get("/api/tyrecontrol/parte/:id/pdf", ...guards, async (req, res) => {
    try {
      const r = await construirPdf(req, String(req.params.id ?? ""));
      if ("error" in r) return res.status(r.estado).json({ error: r.error });
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `inline; filename="${r.nombre}"`);
      res.end(Buffer.from(r.pdf));
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "No se ha podido generar el parte" });
    }
  });

  /**
   * El mismo parte, pero guardado y devuelto como enlace.
   *
   * Existe por la APK: para abrir el PDF el móvil lanza el visor del sistema,
   * y ese visor NO lleva la cabecera de sesión, así que pedir directamente la
   * ruta de arriba devolvería un 401. Meter el token en la URL tampoco vale
   * —acabaría en el historial del navegador y en los registros—, de modo que
   * el permiso se comprueba aquí, con sesión, y lo que viaja al visor es un
   * enlace de Storage con un nombre que no se adivina.
   */
  app.post("/api/tyrecontrol/parte/:id/pdf/enlace", ...guards, async (req, res) => {
    try {
      const id = String(req.params.id ?? "");
      const r = await construirPdf(req, id);
      if ("error" in r) return res.status(r.estado).json({ error: r.error });

      const ruta = `partes/${id}/${r.nombre}`;
      const { error } = await supabase.storage.from(BUCKET_PARTES)
        .upload(ruta, Buffer.from(r.pdf), { contentType: "application/pdf", upsert: true });
      if (error) throw new Error(error.message);

      // Firmado y con caducidad: el parte lleva matrícula, cliente y firmas, y
      // no tiene por qué quedar colgando en una dirección permanente.
      const { data, error: e2 } = await supabase.storage.from(BUCKET_PARTES)
        .createSignedUrl(ruta, 60 * 60);
      if (e2 || !data?.signedUrl) throw new Error(e2?.message || "No se ha podido firmar el enlace");
      res.json({ url: data.signedUrl });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "No se ha podido generar el parte" });
    }
  });
}
