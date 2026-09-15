/// Qué copias locales se borran y cuáles no. Lógica pura, sin disco.
///
/// Está aparte del almacén a propósito: es el único trozo de todo esto que
/// BORRA fotos, y quería poder probarlo de verdad —con fechas y tamaños
/// concretos— sin montar un sistema de ficheros. Un fallo aquí no da un error,
/// da una foto que ya no está.
library;

/// Una copia guardada en la tablet, vista por la política de retención.
class CopiaGuardada {
  const CopiaGuardada({
    required this.ruta,
    required this.assistanceId,
    required this.kind,
    required this.ts,
    required this.bytes,
    required this.subida,
  });

  final String ruta;
  final int assistanceId;
  final String kind;

  /// Cuándo se hizo la foto (epoch ms).
  final int ts;
  final int bytes;

  /// Si el servidor ya la tiene. Las que NO han subido no se borran nunca.
  final bool subida;

  factory CopiaGuardada.deMapa(Map<String, dynamic> m) => CopiaGuardada(
        ruta: m['ruta'] as String,
        assistanceId: (m['assistanceId'] as num).toInt(),
        kind: m['kind'] as String? ?? 'desconocido',
        ts: (m['ts'] as num).toInt(),
        bytes: (m['bytes'] as num?)?.toInt() ?? 0,
        subida: m['subida'] == true,
      );

  Map<String, dynamic> aMapa() => {
        'ruta': ruta,
        'assistanceId': assistanceId,
        'kind': kind,
        'ts': ts,
        'bytes': bytes,
        'subida': subida,
      };
}

/// Cuánto se guarda una foto ya subida: 30 días o 1 GB, lo que llegue antes.
///
/// Los 30 días son el margen para que alguien abra el informe, vea que falta
/// una foto y venga a buscarla; una semana se queda corta en cuanto el parte
/// se mira el lunes siguiente. El giga es para que una tablet de 32 GB no se
/// llene sola: a 1920 px son del orden de dos mil fotos, meses de trabajo.
const int kDiasRetencion = 30;
const int kMaxBytesCopias = 1024 * 1024 * 1024;

/// El resultado de aplicar la política.
class PlanDeLimpieza {
  const PlanDeLimpieza({required this.aBorrar, required this.bytesTrasLimpiar});

  final List<CopiaGuardada> aBorrar;

  /// Lo que seguirá ocupando después de borrar. Puede pasarse del tope si lo
  /// que queda son fotos sin subir, que no se tocan.
  final int bytesTrasLimpiar;

  bool get sigueLlena => bytesTrasLimpiar > kMaxBytesCopias;
}

/// Decide qué se borra.
///
/// Dos reglas, y la primera manda sobre la segunda:
///
///  1. **Una copia que no ha subido NO se borra jamás**, tenga la edad que
///     tenga y ocupe lo que ocupe. Mientras el servidor no la tenga, esa copia
///     no es una copia: es el original, y es lo único que queda de esa foto.
///     Aplicar la caducidad a ciegas convertiría esto en la causa de la
///     pérdida que viene a evitar.
///
///  2. De las subidas, fuera las que pasen de [dias]. Si aun así se pasa del
///     tope, se van cayendo las más antiguas hasta entrar.
///
/// Si al final no cabe porque lo que queda está sin subir, se dice
/// ([PlanDeLimpieza.sigueLlena]) en vez de forzar: quien tiene que enterarse
/// es el operario, que puede recuperar cobertura y vaciar la cola.
PlanDeLimpieza planDeLimpieza(
  List<CopiaGuardada> copias, {
  required int ahoraMs,
  int dias = kDiasRetencion,
  int maxBytes = kMaxBytesCopias,
}) {
  final aBorrar = <CopiaGuardada>[];
  final limite = ahoraMs - dias * 24 * 60 * 60 * 1000;

  // Por antigüedad: al recortar por tamaño se empieza por lo más viejo.
  final resto = [...copias]..sort((a, b) => a.ts.compareTo(b.ts));

  for (final c in [...resto]) {
    if (c.subida && c.ts < limite) {
      aBorrar.add(c);
      resto.remove(c);
    }
  }

  int ocupado = resto.fold(0, (s, c) => s + c.bytes);
  for (final c in [...resto]) {
    if (ocupado <= maxBytes) break;
    if (!c.subida) continue; // regla 1
    aBorrar.add(c);
    resto.remove(c);
    ocupado -= c.bytes;
  }

  return PlanDeLimpieza(aBorrar: aBorrar, bytesTrasLimpiar: ocupado);
}

/// Los tipos de foto que además se copian a la Galería del terminal.
///
/// La firma del cliente NO va: es un dato personal suyo, y en la Galería
/// acabaría en la copia de Google Fotos y a un toque de mandarse por WhatsApp.
/// En la copia privada de la app sí está, que es donde hace falta para poder
/// reenviarla.
bool vaALaGaleria(String kind) => kind != 'firma';
