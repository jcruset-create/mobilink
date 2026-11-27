/// Filtro de lecturas de profundidad repetidas de la sonda.
///
/// Un técnico (27/11/2026): «al medir el primer surco pita 2 veces muy rápido,
/// da dos mediciones del mismo surco y salta a la otra rueda». La sonda manda
/// a veces la MISMA lectura dos veces seguidas por Bluetooth. Con la medición
/// doble, la primera se tomaba como banda interior y la segunda —el eco— como
/// exterior: la rueda se cerraba sola con las dos bandas iguales.
///
/// Nadie puede levantar la sonda, llevarla a la otra banda y volver a apoyarla
/// en menos de un segundo. Así que una profundidad que llega:
///   · a menos de [minimo] de la anterior, sea cual sea su valor, o
///   · con el MISMO valor a menos de [mismoValor] de la anterior,
/// es un rebote y se descarta. Puro, para probarlo sin sonda ni reloj real.
class FiltroRebote {
  final Duration minimo;
  final Duration mismoValor;
  DateTime? _ultimaHora;
  double? _ultimoValor;

  FiltroRebote({
    this.minimo = const Duration(milliseconds: 700),
    this.mismoValor = const Duration(milliseconds: 1500),
  });

  /// ¿Se acepta esta lectura? Si se acepta, pasa a ser la «anterior».
  bool acepta(double valor, DateTime ahora) {
    final h = _ultimaHora;
    if (h != null) {
      final dt = ahora.difference(h);
      if (dt >= Duration.zero) {
        if (dt < minimo) return false;
        if (dt < mismoValor && _ultimoValor != null && (valor - _ultimoValor!).abs() < 0.05) return false;
      }
    }
    _ultimaHora = ahora;
    _ultimoValor = valor;
    return true;
  }

  /// Olvida la anterior (al reconectar la sonda).
  void reiniciar() {
    _ultimaHora = null;
    _ultimoValor = null;
  }
}
