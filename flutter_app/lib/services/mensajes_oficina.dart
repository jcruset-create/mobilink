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
///
/// Los mensajes pueden ser de una asistencia (`assistanceId`) o de una OTF
/// (`otfId`). Y en la misma consulta llegan las OTF que el operario aún no ha
/// abierto: suenan una vez, se avisan a pantalla completa y cuentan en la
/// pestaña OTF hasta que las abre.
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

  List<Map<String, dynamic>> _otfNuevas = const [];
  final Set<int> _otfAvisadas = {};
  final Set<int> _otfPospuestas = {};

  /// Las OTF asignadas que el operario aún no ha abierto (para la insignia).
  List<Map<String, dynamic>> get otfNuevas => _otfNuevas;

  /// Las que toca avisar a pantalla completa: nuevas y no pospuestas.
  List<Map<String, dynamic>> get otfParaAvisar =>
      _otfNuevas.where((o) => !_otfPospuestas.contains(o['id'])).toList();

  /// La api con la que se trabaja, para abrir pantallas desde el aviso.
  ApiService? get api => _api;

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
    _otfNuevas = const [];
    _otfAvisadas.clear();
    _otfPospuestas.clear();
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
      // OTF nuevas: suenan una vez cada una.
      for (final o in r.otfNuevas) {
        final id = o['id'];
        if (id is int && _otfAvisadas.add(id)) await _avisador.sonarOtf(o);
      }
      _otfNuevas = r.otfNuevas;
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

  /// Contestar (rápida o escrita) en una asistencia o en una OTF. En el
  /// servidor cuenta como leído todo lo de esa asistencia u OTF.
  Future<bool> responder({int? assistanceId, int? otfId, required String texto}) async {
    final api = _api;
    if (api == null || (assistanceId == null && otfId == null)) return false;
    final ok = otfId != null
        ? await api.enviarMensajeOtf(otfId, texto)
        : await api.enviarMensajeOperario(assistanceId!, texto);
    if (ok) {
      bool deAqui(Map<String, dynamic> m) =>
          otfId != null ? m['otfId'] == otfId : m['assistanceId'] == assistanceId;
      final quitados = _pendientes.where(deAqui).toList();
      _quitarLocal(deAqui);
      for (final m in quitados) {
        final id = m['id'];
        if (id is int) await _avisador.quitar(id);
      }
    }
    return ok;
  }

  /// «Ver la OTF»: deja de ser nueva aquí y en el servidor.
  Future<void> otfVista(int otfId) async {
    _otfNuevas = _otfNuevas.where((o) => o['id'] != otfId).toList();
    notifyListeners();
    await _avisador.quitarOtf(otfId);
    await _api?.marcarOtfVista(otfId);
  }

  /// «Más tarde»: no vuelve a salir a pantalla completa, pero sigue contando
  /// en la pestaña hasta que la abra.
  void otfPosponer(int otfId) {
    _otfPospuestas.add(otfId);
    notifyListeners();
  }

  void _quitarLocal(bool Function(Map<String, dynamic>) quitar) {
    _pendientes = _pendientes.where((m) => !quitar(m)).toList();
    _sonado.removeWhere((id, _) => !_pendientes.any((m) => m['id'] == id));
    notifyListeners();
  }
}
