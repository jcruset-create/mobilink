import 'package:flutter/foundation.dart';
import 'supabase_service.dart';

/// Motivos de pausa (obligatorio elegir uno). Claves = las del check de
/// tc_pausas_trabajo; etiquetas para la UI.
const Map<String, String> kMotivosPausa = {
  'esperando_cliente': 'Esperando al cliente',
  'esperando_autorizacion': 'Esperando autorización',
  'esperando_neumaticos': 'Esperando neumáticos',
  'esperando_material': 'Esperando material',
  'esperando_operario': 'Esperando otro operario',
  'averia_maquinaria': 'Avería de maquinaria',
  'descanso': 'Descanso',
  'otro': 'Otro',
};

class PausaRegistro {
  final DateTime inicio;
  final String motivo;
  final String? observaciones;
  DateTime? fin;
  PausaRegistro({required this.inicio, required this.motivo, this.observaciones});

  int get duracionSeg => fin == null ? 0 : fin!.difference(inicio).inSeconds;
}

/// Pausas de una sesión de trabajo (una revisión o un cambio de neumáticos).
///
/// Todo son MARCAS DE TIEMPO, no cronómetros: pausar guarda la hora de
/// inicio y reanudar la de fin, así que segundo plano, pantalla bloqueada o
/// incluso un reinicio de la app no descuadran nada. Cada pausa se sube a
/// tc_pausas_trabajo al reanudar (best-effort) y los totales se denormalizan
/// en la fila padre al finalizar la sesión.
class PausaController extends ChangeNotifier {
  final String contexto; // 'revision' | 'operacion'
  final String empresaId;
  final String? vehiculoId;
  final String? revisionId;

  PausaController({
    required this.contexto,
    required this.empresaId,
    this.vehiculoId,
    this.revisionId,
  });

  final List<PausaRegistro> _pausas = [];
  PausaRegistro? _activa;

  bool get enPausa => _activa != null;
  PausaRegistro? get pausaActiva => _activa;
  int get numPausas => _pausas.length + (_activa != null ? 1 : 0);

  /// Segundos de inactividad acumulados (las cerradas + la activa si la hay).
  int get pausaSeg {
    var s = _pausas.fold(0, (a, p) => a + p.duracionSeg);
    if (_activa != null) s += DateTime.now().difference(_activa!.inicio).inSeconds;
    return s;
  }

  void pausar(String motivo, {String? observaciones}) {
    if (_activa != null) return;
    _activa = PausaRegistro(inicio: DateTime.now(), motivo: motivo, observaciones: observaciones);
    notifyListeners();
  }

  Future<void> reanudar() async {
    final p = _activa;
    if (p == null) return;
    p.fin = DateTime.now();
    _pausas.add(p);
    _activa = null;
    notifyListeners();
    await TyreControlApi.registrarPausa(
      contexto: contexto,
      empresaId: empresaId,
      vehiculoId: vehiculoId,
      revisionId: revisionId,
      motivo: p.motivo,
      observaciones: p.observaciones,
      inicio: p.inicio,
      fin: p.fin!,
    );
  }

  /// Cierra la pausa activa si el técnico finaliza sin reanudar: la sesión
  /// acaba y la pausa con ella.
  Future<void> cerrarSiActiva() async {
    if (_activa != null) await reanudar();
  }
}
