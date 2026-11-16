import 'dart:async';

import 'package:flutter/foundation.dart';

import 'api.dart';
import 'avisador.dart';
import 'queue.dart';

/// Los avisos de la central sin leer, mientras el operario trabaja.
///
/// El equivalente en Lite de `MensajesOficina` de Assist Pro
/// (`flutter_app/lib/services/mensajes_oficina.dart`).
///
/// Pregunta al servidor cada 15 s. Cuando llega uno nuevo suena y la app lo
/// enseña a pantalla completa (`widgets/aviso_mensaje.dart`) hasta que el
/// operario pulsa «Entendido» o contesta.
///
/// **Normal: suena una vez. Urgente, o normal con más de 3 min sin leer:
/// vuelve a sonar cada 15 s.** Quién es qué lo decide el servidor
/// (`repetirSonido`, en `server/connect/liteMensajes.ts`), no el móvil: así la
/// regla está en un solo sitio y Central ve exactamente lo mismo que el
/// operario oye.
///
/// Por qué un sondeo y no solo el push: el push puede no llegar (sin
/// `google-services.json`, permiso denegado, Google Play Services ausente en
/// una tablet china de taller), y un aviso urgente que no suena es el fallo
/// que esto viene a arreglar. El push adelanta el aviso; el sondeo lo
/// garantiza.
class MensajesCentral extends ChangeNotifier {
  MensajesCentral({Avisador? avisador}) : _avisador = avisador ?? AvisadorNotificaciones();

  static final MensajesCentral instancia = MensajesCentral();

  static const intervalo = Duration(seconds: 15);

  final Avisador _avisador;
  Api? _api;
  Timer? _timer;
  bool _consultando = false;

  List<Map<String, dynamic>> _pendientes = const [];

  /// Las de Assist Pro. El servidor las manda y manda estas, pero si un día
  /// cambian allí, llegan solas.
  List<String> respuestasRapidas = const ['Voy', 'Llamo ahora', 'Necesito ayuda'];

  /// Cuándo sonó por última vez cada mensaje.
  final Map<int, DateTime> _sonado = {};

  /// Los avisos sin leer, el más antiguo primero.
  List<Map<String, dynamic>> get pendientes => _pendientes;

  bool get activo => _timer != null;

  Future<void> iniciar(Api api) async {
    _api = api;
    if (_timer != null) return;
    await _avisador.preparar();
    _timer = Timer.periodic(intervalo, (_) => consultar());
    await consultar();
  }

  /// Para las pruebas: deja la api puesta sin arrancar el Timer.
  @visibleForTesting
  Future<void> iniciarParaPruebas(Api api) async {
    _api = api;
    await _avisador.preparar();
  }

  Future<void> detener() async {
    _timer?.cancel();
    _timer = null;
    _pendientes = const [];
    _sonado.clear();
    await _avisador.quitarTodos();
    notifyListeners();
  }

  /// Una vuelta: recoge los pendientes y hace sonar lo que toque.
  Future<void> consultar({DateTime? ahora}) async {
    final api = _api;
    if (api == null || _consultando) return;
    _consultando = true;
    try {
      final r = await api.pendingMessages();
      final mensajes = ((r['mensajes'] as List?) ?? const [])
          .map((e) => (e as Map).cast<String, dynamic>())
          .toList();
      final rapidas = ((r['respuestasRapidas'] as List?) ?? const [])
          .map((e) => e.toString())
          .toList();
      if (rapidas.isNotEmpty) respuestasRapidas = rapidas;

      final momento = ahora ?? DateTime.now();
      final ids = <int>{};
      for (final m in mensajes) {
        final id = m['id'];
        if (id is! int) continue;
        ids.add(id);
        final ultimo = _sonado[id];
        final repetir = m['repetirSonido'] == true;
        // El margen de 2 s es porque el Timer no cae clavado: sin él, una
        // vuelta que llega 14,9 s después no repetiría y el urgente se
        // quedaría en silencio hasta la siguiente.
        final toca = ultimo == null ||
            (repetir && momento.difference(ultimo) >= intervalo - const Duration(seconds: 2));
        if (toca) {
          _sonado[id] = momento;
          await _avisador.sonar(m);
        }
      }
      // Los que ya no están (leídos en el hilo, asistencia cerrada): fuera.
      for (final id in _sonado.keys.where((id) => !ids.contains(id)).toList()) {
        _sonado.remove(id);
        await _avisador.quitar(id);
      }
      _pendientes = mensajes;
      notifyListeners();
    } on OfflineError {
      // Sin cobertura se queda lo que había: el aviso sigue en pantalla, que
      // es justo lo que hay que hacer con algo que nadie ha confirmado.
    } catch (e) {
      debugPrint('[mensajes] $e');
    } finally {
      _consultando = false;
    }
  }

  /// «Entendido»: ese mensaje deja de sonar y queda leído en el servidor.
  Future<void> entendido(int id, int assistanceId) async {
    _quitarLocal((m) => m['id'] == id);
    await _avisador.quitar(id);
    try {
      await _api?.markMessagesRead(assistanceId, messageId: id);
    } catch (e) {
      // Si el acuse no sale, el mensaje volverá en la siguiente vuelta y
      // sonará otra vez. Es lo correcto: sin acuse, Central no sabe que se ha
      // leído, y es peor callarlo que repetirlo.
      debugPrint('[mensajes] acuse de $id: $e');
    }
  }

  /// Contestar (rápida o escrita). Contestar cuenta como leído: quien
  /// responde «Voy» ha leído lo que le han dicho.
  ///
  /// Aquí NO se encola para más tarde, al contrario que en el hilo: si no hay
  /// cobertura, el aviso tiene que seguir en pantalla. Dar por contestado algo
  /// que no ha salido dejaría al operario creyendo que la central ya lo sabe.
  Future<bool> responder({required int assistanceId, required String texto}) async {
    final api = _api;
    if (api == null || texto.trim().isEmpty) return false;
    try {
      await api.sendMessage(assistanceId, texto.trim(), OfflineQueue.newActionId());
      await api.markMessagesRead(assistanceId);
      final quitados = _pendientes.where((m) => m['assistanceId'] == assistanceId).toList();
      _quitarLocal((m) => m['assistanceId'] == assistanceId);
      for (final m in quitados) {
        final id = m['id'];
        if (id is int) await _avisador.quitar(id);
      }
      return true;
    } catch (e) {
      debugPrint('[mensajes] respuesta: $e');
      return false;
    }
  }

  void _quitarLocal(bool Function(Map<String, dynamic>) quitar) {
    _pendientes = _pendientes.where((m) => !quitar(m)).toList();
    _sonado.removeWhere((id, _) => !_pendientes.any((m) => m['id'] == id));
    notifyListeners();
  }
}
