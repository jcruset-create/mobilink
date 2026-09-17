/// La configuración de ejes de un tipo de vehículo, leída de delante a atrás.
///
/// «2x2x4» son tres ejes: 2 ruedas en el primero, 2 en el segundo y 4 en el
/// tercero. Siempre de la parte delantera hacia la trasera, que es como se
/// mira un camión y como lo escribe el taller.
///
/// Mismo criterio que `ruedasPorEje()` del servidor
/// (server/tyrecontrol/posicionesDesdeConfig.ts), y a propósito: si la APK
/// dibujara un plano con otras reglas que las que generaron las posiciones, el
/// técnico vería un camión que no es el suyo. Solo 2 (rueda simple) y 4
/// (gemela) son válidos; cualquier otra cosa es una etiqueta mal escrita y es
/// mejor no dibujar nada que dibujar algo inventado.
class ConfiguracionEjes {
  /// Ruedas de cada eje, de delante a atrás. Vacío si la etiqueta no vale.
  final List<int> ruedasPorEje;

  const ConfiguracionEjes(this.ruedasPorEje);

  static const ConfiguracionEjes invalida = ConfiguracionEjes(<int>[]);

  /// `"2x2x4"` → `[2, 2, 4]`.
  factory ConfiguracionEjes.desdeTexto(String? texto) {
    if (texto == null || texto.trim().isEmpty) return invalida;
    final partes = texto.split(RegExp(r'[xX]')).map((p) => int.tryParse(p.trim())).toList();
    if (partes.isEmpty || partes.any((n) => n != 2 && n != 4)) return invalida;
    return ConfiguracionEjes(partes.cast<int>());
  }

  bool get esValida => ruedasPorEje.isNotEmpty;
  int get numeroEjes => ruedasPorEje.length;
  int get totalPosiciones => ruedasPorEje.fold(0, (a, b) => a + b);
  /// Un eje de 4 ruedas es gemelo: dos por lado, interior y exterior.
  bool ejeGemelo(int eje) => eje >= 1 && eje <= numeroEjes && ruedasPorEje[eje - 1] == 4;

  /// Cómo se lee en voz alta: «3 ejes · 2+2+4 · 8 neumáticos».
  String get resumen =>
      esValida ? '$numeroEjes ejes · ${ruedasPorEje.join('+')} · $totalPosiciones neumáticos' : 'Configuración no válida';
}
