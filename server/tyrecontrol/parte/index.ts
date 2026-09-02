import type { Express, RequestHandler } from "express";
import { hayIA } from "../../core/openaiService.ts";
import { supabase } from "../../supabase.ts";
import { LectorParteIA, type LectorParte } from "./lectorParte.ts";
import { armarParte, type MovimientoFila } from "./armarParte.ts";
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
        .select("*, vehiculo:tc_vehiculos(matricula, km_actual, empresa:tc_empresas(nombre))")
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

      const { data: movs } = await supabase
        .from("tc_operacion_movimientos")
        .select(`movimiento_tipo, profundidad_anterior, profundidad_final,
                 operacion:operaciones_neumaticos!inner(motivo, destino, intervencion_id),
                 neumatico:tc_neumaticos(marca, modelo, medida, numero_serie, dot, estado),
                 posicion:tc_posiciones_vehiculo!destino_posicion_id(codigo_posicion)`)
        .eq("operacion.intervencion_id", id)
        .order("orden");

      const filas: MovimientoFila[] = (movs ?? []).map((m: any) => ({
        movimiento_tipo: m.movimiento_tipo,
        profundidad_anterior: m.profundidad_anterior,
        profundidad_final: m.profundidad_final,
        posicion: m.posicion?.codigo_posicion ?? null,
        marca: m.neumatico?.marca ?? null,
        modelo: m.neumatico?.modelo ?? null,
        medida: m.neumatico?.medida ?? null,
        // El número de serie identifica la unidad; el DOT solo dice cuándo se
        // fabricó. Se prefiere el primero y se cae al segundo.
        serie: m.neumatico?.numero_serie ?? m.neumatico?.dot ?? null,
        motivo: m.operacion?.motivo ?? null,
        destino: m.operacion?.destino ?? null,
      }));

      const { data: servicios } = await supabase
        .from("tc_intervencion_servicios")
        .select("servicio, cantidad").eq("intervencion_id", id);

      const pdf = await generarPartePdf(armarParte(
        {
          ...interv,
          matricula: interv.vehiculo?.matricula ?? null,
          flota: interv.vehiculo?.empresa?.nombre ?? null,
          km: interv.vehiculo?.km_actual ?? null,
        },
        filas,
        (servicios ?? []) as { servicio: string; cantidad: number }[],
      ));

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
