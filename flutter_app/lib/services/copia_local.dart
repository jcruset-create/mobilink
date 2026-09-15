/// La copia de las fotos que se queda en la tablet.
///
/// ── Qué problema resuelve ────────────────────────────────────────────────
///
/// Hasta ahora la tablet guardaba una copia SOLO mientras la foto estaba en la
/// cola de subida, y la borraba en cuanto el servidor contestaba que sí. Eso
/// protege de quedarse sin cobertura, que no es lo único que pasa: si la foto
/// se pierde después —o el que mira el informe ve que falta— ya no hay de
/// dónde sacarla. Y la matrícula y la firma, que suben en directo, no llegaban
/// a tener copia nunca.
///
/// Ahora la copia se queda después de subir y caduca sola: 30 días o 1 GB, lo
/// que llegue antes (ver `retencion_copias.dart`, que es donde está la regla y
/// donde está probada).
///
/// ── Dos copias, y por qué ────────────────────────────────────────────────
///
///  1. **Privada de la app**, en `Documents/copias_fotos/`. Es la que sirve
///     para REENVIAR: la app sabe de qué asistencia es cada foto y puede
///     volver a encolarla. No sale en la Galería ni se mezcla con las fotos
///     personales del operario.
///  2. **En la Galería del terminal**, álbum «Mobilink Assist». Es la que
///     sirve cuando lo que falla es la app o la tablet se reinstala, y la que
///     permite mandar una foto por otro medio sin depender de nosotros.
///
/// La de la Galería se hace lo mejor que se puede y NUNCA corta el camino de
/// la foto: si el operario no da el permiso, la foto se sube igual y la copia
/// privada se guarda igual. Un permiso denegado no puede costar una subida.
library;

import 'dart:async';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:gal/gal.dart';
import 'package:hive_flutter/hive_flutter.dart';
import 'package:path_provider/path_provider.dart';

import 'retencion_copias.dart';

class CopiaLocal {
  static Box? _box;

  /// Cuántas copias hay guardadas, para la pantalla.
  static final ValueNotifier<int> total = ValueNotifier<int>(0);

  /// Se ha llegado al tope y lo que ocupa está sin subir: hay que avisar.
  static final ValueNotifier<bool> llena = ValueNotifier<bool>(false);

  static Future<void> init() async {
    _box = await Hive.openBox('sea_copias');
    total.value = todas().length;
  }

  static Future<Directory> _dir() async {
    final base = await getApplicationDocumentsDirectory();
    final d = Directory('${base.path}/copias_fotos');
    if (!await d.exists()) await d.create(recursive: true);
    return d;
  }

  /// Guarda la copia y devuelve su ruta. Es la ruta que se encola para subir:
  /// así la foto que viaja y la que se queda son el mismo fichero, y no hay
  /// dos copias de lo mismo ocupando sitio.
  static Future<String> guardar(
    File origen, {
    required int assistanceId,
    required String kind,
  }) async {
    final dir = await _dir();
    final ext = origen.path.contains('.') ? origen.path.split('.').last : 'jpg';
    final ts = DateTime.now();
    final destino =
        '${dir.path}/${assistanceId}_${kind}_${ts.microsecondsSinceEpoch}.$ext';
    final fichero = await origen.copy(destino);

    await _apuntar(CopiaGuardada(
      ruta: destino,
      assistanceId: assistanceId,
      kind: kind,
      ts: ts.millisecondsSinceEpoch,
      bytes: await fichero.length(),
      subida: false,
    ));

    if (vaALaGaleria(kind)) unawaited(_aLaGaleria(destino));
    return destino;
  }

  /// El servidor ya la tiene: a partir de aquí la copia puede caducar.
  static Future<void> marcarSubida(String ruta) async {
    final lista = todas();
    var tocado = false;
    for (var i = 0; i < lista.length; i++) {
      if (lista[i].ruta == ruta && !lista[i].subida) {
        lista[i] = CopiaGuardada(
          ruta: lista[i].ruta,
          assistanceId: lista[i].assistanceId,
          kind: lista[i].kind,
          ts: lista[i].ts,
          bytes: lista[i].bytes,
          subida: true,
        );
        tocado = true;
      }
    }
    if (tocado) await _guardarIndice(lista);
  }

  static List<CopiaGuardada> todas() {
    final raw = _box?.get('indice');
    if (raw is! List) return [];
    final out = <CopiaGuardada>[];
    for (final e in raw) {
      try {
        out.add(CopiaGuardada.deMapa(Map<String, dynamic>.from(e as Map)));
      } catch (_) {
        // Una fila ilegible del índice no puede dejar sin ver las demás.
      }
    }
    return out;
  }

  /// Las de una asistencia, de la más reciente a la más antigua.
  static List<CopiaGuardada> deAsistencia(int assistanceId) =>
      todas().where((c) => c.assistanceId == assistanceId).toList()
        ..sort((a, b) => b.ts.compareTo(a.ts));

  /// Lo que ocupan todas las copias, en bytes.
  static int bytesOcupados() => todas().fold(0, (s, c) => s + c.bytes);

  /// Aplica la caducidad. Se llama al arrancar y después de cada subida.
  ///
  /// Borra primero el fichero y solo después lo quita del índice: al revés, un
  /// corte a medias dejaría el fichero ocupando sitio sin que nadie supiera
  /// que está ahí.
  static Future<void> limpiar({DateTime? ahora}) async {
    final plan = planDeLimpieza(
      todas(),
      ahoraMs: (ahora ?? DateTime.now()).millisecondsSinceEpoch,
    );
    llena.value = plan.sigueLlena;
    if (plan.aBorrar.isEmpty) return;

    final borradas = <String>{};
    for (final c in plan.aBorrar) {
      try {
        final f = File(c.ruta);
        if (await f.exists()) await f.delete();
        borradas.add(c.ruta);
      } catch (e) {
        // Si no se puede borrar, se queda en el índice y se reintenta la
        // próxima vez. Quitarlo de la lista lo volvería invisible y eterno.
        debugPrint('[CopiaLocal] no se pudo borrar ${c.ruta}: $e');
      }
    }
    if (borradas.isEmpty) return;
    await _guardarIndice(
        todas().where((c) => !borradas.contains(c.ruta)).toList());
  }

  /// Quita del índice las copias cuyo fichero ya no está.
  ///
  /// Android limpia directorios por su cuenta y el usuario puede borrar desde
  /// la Galería. Una entrada que apunta a un hueco haría que la pantalla
  /// prometiera una foto que no se puede enseñar ni reenviar.
  static Future<void> depurarFantasmas() async {
    final lista = todas();
    final vivas = <CopiaGuardada>[];
    for (final c in lista) {
      if (await File(c.ruta).exists()) vivas.add(c);
    }
    if (vivas.length != lista.length) await _guardarIndice(vivas);
  }

  static Future<void> _apuntar(CopiaGuardada c) async {
    await _guardarIndice([...todas(), c]);
  }

  static Future<void> _guardarIndice(List<CopiaGuardada> lista) async {
    await _box?.put('indice', lista.map((c) => c.aMapa()).toList());
    total.value = lista.length;
  }

  /// Copia a la Galería del terminal. Best-effort de verdad: cualquier fallo
  /// se apunta y se sigue.
  static Future<void> _aLaGaleria(String ruta) async {
    try {
      if (!await Gal.hasAccess(toAlbum: true)) {
        if (!await Gal.requestAccess(toAlbum: true)) return;
      }
      await Gal.putImage(ruta, album: 'Mobilink Assist');
    } catch (e) {
      debugPrint('[CopiaLocal] sin copia en la Galería: $e');
    }
  }
}
