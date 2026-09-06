import 'api.dart';
import 'file_queue.dart';

/// Evidencias obligatorias del servicio, en un solo sitio.
///
/// Es el equivalente en el móvil de `validateFinish` de
/// `server/connect/liteRules.ts`: mismos códigos de categoría
/// (`EVIDENCE_CATEGORIES`), mismos nombres y la misma idea de devolver la
/// lista de lo que falta en vez de un booleano. El servidor sigue validando
/// por su cuenta —un cliente viejo o manipulado no puede saltárselo—; esto
/// evita que el operario descubra en el último paso, con el cliente delante,
/// que le falta una foto de hace media hora.
///
/// La estructura de la pantalla de llegada está copiada de Mobilink Assist
/// Pro (`flutter_app/lib/screens/arrival_photos_screen.dart`): huecos
/// obligatorios, miniatura al hacerla, y el botón de continuar apagado hasta
/// que estén todas. Lo que NO se trae es el OCR de matrícula, que en Pro lo
/// hace su backend y en la API de Lite no existe.
class Requisitos {
  Requisitos._();

  // Códigos de EVIDENCE_CATEGORIES (server/connect/liteRules.ts). No se
  // inventa ninguno: el backend convierte a "other" cualquier categoría que no
  // conozca, así que una foto con un código nuevo se perdería de vista.
  static const catMatricula = 'arrival'; // "Vehículo al llegar"
  static const catAveria = 'damage'; // "Daño o avería"
  static const catReparacion = 'work'; // "Trabajo realizado"
  static const catMontaje = 'mounting'; // "Montaje del neumático"

  static const etiquetas = {
    catMatricula: 'Foto de la matrícula del vehículo',
    catAveria: 'Foto de la avería',
    catReparacion: 'Foto de la reparación realizada',
    catMontaje: 'Foto del neumático nuevo montado',
  };

  /// Lo que hace falta para empezar a trabajar, al llegar al punto.
  static List<String> alLlegar(Evidencias e) => [
        if (!e.tiene(catMatricula)) etiquetas[catMatricula]!,
        if (!e.tiene(catAveria)) etiquetas[catAveria]!,
      ];

  /// Lo que hace falta para cerrar. Incluye lo de la llegada: si el operario
  /// llegó sin cobertura y se saltó algo, el cierre lo vuelve a pedir.
  static List<String> alFinalizar(Evidencias e) => [
        ...alLlegar(e),
        if (!e.tiene(catReparacion)) etiquetas[catReparacion]!,
        // Solo cuando hay un montaje confirmado de verdad: sin neumático
        // nuevo, esta foto no se pide.
        if (e.montajesConfirmados > 0 && !e.tiene(catMontaje))
          etiquetas[catMontaje]!,
        if (!e.firma) 'Firma del cliente',
        // .trim(): un nombre de espacios no es un nombre. Las fuentes ya
        // recortan, pero la regla no puede depender de que quien la alimente
        // se acuerde de hacerlo.
        if (e.firma && e.firmanteNombre.trim().isEmpty)
          'Nombre y apellidos del cliente',
        if (e.firma && e.firmanteDocumento.trim().isEmpty)
          'DNI / NIE del cliente',
      ];
}

/// Foto hecha de lo que hay ahora mismo: lo que confirma el servidor, lo que
/// espera en la cola y lo que ya se subió en otro momento.
class Evidencias {
  const Evidencias({
    required this.categorias,
    required this.firma,
    required this.firmanteNombre,
    required this.firmanteDocumento,
    required this.montajesConfirmados,
    required this.sinConexion,
  });

  /// Categorías presentes, vengan de donde vengan.
  final Set<String> categorias;
  final bool firma;
  final String firmanteNombre;
  final String firmanteDocumento;

  /// Conceptos (neumáticos pactados) confirmados como montados.
  final int montajesConfirmados;

  /// No se pudo preguntar al servidor: lo de abajo sale del móvil.
  final bool sinConexion;

  bool tiene(String categoria) => categorias.contains(categoria);

  static const vacio = Evidencias(
    categorias: {},
    firma: false,
    firmanteNombre: '',
    firmanteDocumento: '',
    montajesConfirmados: 0,
    sinConexion: false,
  );

  /// Reúne el estado real de las evidencias de una asistencia.
  ///
  /// Tres fuentes, y las tres cuentan:
  ///
  /// 1. El servidor, cuando se le puede preguntar: es la verdad.
  /// 2. La cola local: una foto hecha sin cobertura ya existe aunque no haya
  ///    salido del móvil, y bloquear al operario por eso sería castigarle por
  ///    trabajar donde no hay señal.
  /// 3. El rastro de categorías ya subidas, para cuando no hay cobertura AHORA
  ///    pero sí la hubo antes.
  ///
  /// Una evidencia en estado `failed` —la central la rechazó— NO cuenta: si
  /// contara, el operario cerraría el servicio creyendo que está entregada.
  static Future<Evidencias> cargar(
    Api api,
    int assistanceId, {
    List<Map<String, dynamic>> conceptos = const [],
  }) async {
    final categorias = <String>{};
    var firma = false;
    var nombre = '';
    var documento = '';
    var sinConexion = false;

    try {
      final data = await api.files(assistanceId);
      final files = (data['files'] as List?) ?? const [];
      final delServidor = files
          .map((e) => ((e as Map)['category'] ?? '').toString())
          .where((c) => c.isNotEmpty)
          .toSet();
      categorias.addAll(delServidor);
      await FileQueue.sincronizarCategorias(assistanceId, delServidor);

      final s = data['signature'];
      if (s is Map) {
        firma = true;
        nombre = (s['signerName'] ?? '').toString().trim();
        documento = (s['signerDocument'] ?? '').toString().trim();
      }
    } on OfflineError {
      sinConexion = true;
    } catch (_) {
      // Un error de la API tampoco puede dejar al operario sin poder cerrar:
      // se trabaja con lo que hay en el móvil y el servidor valida al recibir.
      sinConexion = true;
    }

    categorias.addAll(FileQueue.categoriasSubidas(assistanceId));

    for (final p in FileQueue.forAssistance(assistanceId)) {
      if (p.state == 'failed') continue;
      if (p.kind == 'signature') {
        firma = true;
        if (nombre.isEmpty) {
          nombre = (p.meta['signerName'] ?? '').toString().trim();
        }
        if (documento.isEmpty) {
          documento = (p.meta['signerDocument'] ?? '').toString().trim();
        }
      } else {
        categorias.add(p.category);
      }
    }

    return Evidencias(
      categorias: categorias,
      firma: firma,
      firmanteNombre: nombre,
      firmanteDocumento: documento,
      montajesConfirmados:
          conceptos.where((c) => c['status'] == 'confirmado').length,
      sinConexion: sinConexion,
    );
  }
}
