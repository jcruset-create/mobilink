/**
 * La ruta de simulación del informe de tacógrafo.
 *
 * Sube el Excel y devuelve qué pasaría. **No escribe una sola fila.** Es el
 * paso que permite discutir los números antes de que existan: 1.744 filas,
 * cuántas nuevas, cuántas ya estaban, cuántas matrículas no se encuentran,
 * qué propone sobre las medidas y qué lecturas de kilometraje no cuadran.
 *
 * ── El fichero se lee AQUÍ, no en el navegador ──────────────────────────────
 *
 * Podría leerse en el panel y mandar las filas en JSON, como hacen los
 * importadores antiguos. No se hace por dos razones: el parser ya está en el
 * servidor y tener dos sería tener dos criterios, y mandar 1.744 filas en
 * JSON es varias veces el tamaño del propio Excel.
 *
 * ── La empresa se comprueba aquí ────────────────────────────────────────────
 *
 * El servidor habla con Supabase usando `service_role`, que NO pasa por RLS.
 * Sin esta comprobación, cualquiera con sesión podría simular contra la
 * empresa de otro cliente tecleando su id. Es el mismo agujero que se cerró
 * en los informes, y aquí se cierra antes de abrirlo.
 *
 * ── Ojo con el nombre ───────────────────────────────────────────────────────
 *
 * Existe `mountTacografos` —en plural— y es OTRA cosa: el módulo de
 * expedientes del anexo II (transferencias e intransferibilidad), con sus
 * tablas `tac_*` y su propio pool. Esto es el registro de intervenciones de
 * TyreControl. Se llama `mountTcTacografo` para que no se confundan en una
 * lista de imports.
 */

import type { Express, RequestHandler } from "express";
import multer from "multer";
import * as XLSX from "xlsx";

import { empresaDelInforme } from "../informes/alcance.ts";
import { SISTEMA_ORIGEN, leerRegla, leerVehiculos, leerYaImportados } from "./datos.ts";
import { ErrorFichero, leerHoja } from "./parser.ts";
import { simular } from "./simular.ts";

/**
 * El informe del centro son 3,3 MB con cinco años dentro. Veinte deja sitio
 * para que crezca unos cuantos años más sin que nadie tenga que tocar esto.
 */
const subida = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 1 },
});

const hoyISO = () => new Date().toISOString().slice(0, 10);

export function mountTcTacografo(app: Express, ...guards: RequestHandler[]): void {
  app.post("/api/tyrecontrol/tacografo/simular", ...guards, subida.single("archivo"),
    async (req, res) => {
      try {
        const alcance = await empresaDelInforme(req, req.query.empresa ?? req.body?.empresa);
        if (!alcance.empresa) return res.status(alcance.estado!).json({ error: alcance.error });
        const empresa = alcance.empresa;

        const archivo = (req as any).file as { buffer: Buffer; originalname: string } | undefined;
        if (!archivo?.buffer?.length) {
          return res.status(400).json({ error: "Falta el fichero" });
        }

        const wb = XLSX.read(archivo.buffer, { cellDates: true });
        const nombreHoja = wb.SheetNames[0];
        if (!nombreHoja) return res.status(400).json({ error: "El fichero no tiene ninguna hoja" });
        const hoja = XLSX.utils.sheet_to_json(wb.Sheets[nombreHoja],
          { header: 1, defval: null, raw: true }) as unknown[][];

        const lectura = leerHoja(hoja, nombreHoja);

        // Las tres lecturas son independientes: en paralelo.
        const [vehiculos, yaImportados, regla] = await Promise.all([
          leerVehiculos(empresa),
          leerYaImportados(empresa, SISTEMA_ORIGEN),
          leerRegla(empresa),
        ]);

        const simulacion = simular({
          filas: lectura.filas, problemas: lectura.problemas,
          vehiculos, yaImportados, regla, hoy: hoyISO(),
          archivo: archivo.originalname,
        });

        res.json({
          ok: true,
          lectura: {
            filaCabecera: lectura.filaCabecera,
            columnas: lectura.columnas,
            columnasUsadas: lectura.columnasUsadas,
            columnasDesconocidas: lectura.columnasDesconocidas,
            hoja: lectura.nombreHoja,
          },
          regla,
          simulacion,
        });
      } catch (e: any) {
        if (e instanceof ErrorFichero) return res.status(400).json({ error: e.message });
        console.error("[tacografo-simular] error:", e?.message ?? e);
        res.status(500).json({ error: e?.message || "No se ha podido leer el fichero" });
      }
    });
}
