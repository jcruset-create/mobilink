import 'dart:async';

import 'package:flutter/foundation.dart';

import 'api_service.dart';
import 'avisador_mensajes.dart';

/// Los mensajes de la oficina para el operario, mientras está en una
/// asistencia.
///
/// Pregunta al servidor cada 15 s (también con la pantalla apagada: el
/// servicio de ubicación mantiene viva la app). Cuando llega uno nuevo, suena
/// y la app lo enseña a pantalla completa (`AvisoMensajes`) hasta que el
/// operario pulsa «Entendido» o contesta.
///
/// Normal: suena una vez. Urgente, o normal con más de 3 min sin leer: vuelve
/// a sonar cada 15 s. Quién es qué lo decide el servidor (`repetirSonido`), no
/// la tablet: así la regla está en un solo sitio.
class MensajesOficina extends ChangeNotifier {
  MensajesOficina({Avisador? avisador}) : _avisador = avisador ?? AvisadorNotificaciones();

  static final MensajesOficina instancia = MensajesOficina();

  static const intervalo = Duration(seconds: 15);

  final Avisador _avisador;
  ApiService? _api;
  Timer? _timer;
  bool _consultando = false;

  List<Map<String, dynamic>> _pendientes = const [];
  List<String> respuestasRapidas = const ['Voy', 'Llamo ahora', 'Necesito ayuda'];

  /// Cuándo sonó por última vez cada mensaje.
  final Map<int, DateTime> _sonado = {};

  /// Los mensajes sin leer, el más antiguo primero.
  List<Map<String, dynamic>> get pendientes => _pendientes;

  bool get activo => _timer != null;

  Future<void> iniciar(ApiService api) async {
    _api = api;
    if (_timer != null) return;
    await _avisador.preparar();
    _timer = Timer.periodic(intervalo, (_) => consultar());
    await consultar();
  }

  /// Para las pruebas: la api sin el Timer.
  @visibleForTesting
  Future<void> iniciarParaPruebas(ApiService api) async {
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
      final r = await api.getMensajesPendientes();
      if (r == null) return; // sin red: se queda lo que había
      respuestasRapidas = r.respuestasRapidas.isNotEmpty ? r.respuestasRapidas : respuestasRapidas;
      final momento = ahora ?? DateTime.now();
      final ids = <int>{};
      for (final m in r.mensajes) {
        final id = m['id'];
        if (id is! int) continue;
        ids.add(id);
        final ultimo = _sonado[id];
        final repetir = m['repetirSonido'] == true;
        final toca = ultimo == null ||
            (repetir && momento.difference(ultimo) >= intervalo - const Duration(seconds: 2));
        if (toca) {
          _sonado[id] = momento;
          await _avisador.sonar(m);
        }
      }
      // Los que ya no están (leídos en otro sitio, asistencia cerrada): fuera.
      for (final id in _sonado.keys.where((id) => !ids.contains(id)).toList()) {
        _sonado.remove(id);
        await _avisador.quitar(id);
      }
      _pendientes = r.mensajes;
      notifyListeners();
    } catch (e) {
      debugPrint('Mensajes de la oficina: $e');
    } finally {
      _consultando = false;
    }
  }

  /// «Entendido».
  Future<void> entendido(int id) async {
    _quitarLocal((m) => m['id'] == id);
    await _avisador.quitar(id);
    await _api?.marcarMensajeLeido(id);
  }

  /// Contestar (rápida o escrita). En el servidor cuenta como leído todo lo
  /// de esa asistencia.
  Future<bool> responder(int assistanceId, String texto) async {
    final ok = await _api?.enviarMensajeOperario(assistanceId, texto) ?? false;
    if (ok) {
      final quitados = _pendientes.where((m) => m['assistanceId'] == assistanceId).toList();
      _quitarLocal((m) => m['assistanceId'] == assistanceId);
      for (final m in quitados) {
        final id = m['id'];
        if (id is int) await _avisador.quitar(id);
      }
    }
    return ok;
  }

  void _quitarLocal(bool Function(Map<String, dynamic>) quitar) {
    _pendientes = _pendientes.where((m) => !quitar(m)).toList();
    _sonado.removeWhere((id, _) => !_pendientes.any((m) => m['id'] == id));
    notifyListeners();
  }
}
