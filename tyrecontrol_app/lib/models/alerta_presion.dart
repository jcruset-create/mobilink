/// Un aviso de presión del sensor de Goodyear, visto desde la tablet.
///
/// Puerto a Dart de `src/modules/tyrecontrol/services/alertasPresion.ts`, que
/// es donde vive el criterio en el panel web. Se porta y no se inventa de
/// nuevo por lo mismo que `presencia_vista.dart`: son decisiones de qué se
/// afirma y qué no, y dos criterios distintos para la misma pregunta son dos
/// pantallas que se contradicen delante del cliente.
///
/// ── Lo que NO es ───────────────────────────────────────────────────────────
///
/// No es una revisión. Nadie ha ido al vehículo: lo manda un sensor y llega
/// por correo. Vive en `tc_alertas_presion` y no en
/// `revisiones_neumaticos_detalle`, para que el histórico del neumático no
/// cuente como revisión lo que fue un correo.
///
/// ── Una fila por RUEDA, no por correo ──────────────────────────────────────
///
/// Mientras la alerta sigue abierta, un aviso nuevo de la misma rueda la
/// actualiza y sube `avisos`. Ese número es el dato que de verdad vale: una
/// rueda que avisa tres días seguidos no tiene poca presión, tiene una fuga.
library;

class AlertaPresion {
  final String id;
  final String vehiculoId;
  final String posicionId;

  /// `presion_baja` o `desinflado`. Se deja como texto, igual que en el panel:
  /// es lo que manda el servidor y habrá más tipos (de diez correos reales ya
  /// salieron dos).
  final String tipo;
  final String severidad;

  final double? presionBar;
  final double? presionRecomendadaBar;
  final double? desviacionPct;

  final int avisos;
  final DateTime? primerAvisoAt;
  final DateTime? ultimoAvisoAt;

  final String? codigoPosicion;
  final String? codigoNeumatico;

  const AlertaPresion({
    required this.id,
    required this.vehiculoId,
    required this.posicionId,
    required this.tipo,
    required this.severidad,
    this.presionBar,
    this.presionRecomendadaBar,
    this.desviacionPct,
    this.avisos = 1,
    this.primerAvisoAt,
    this.ultimoAvisoAt,
    this.codigoPosicion,
    this.codigoNeumatico,
  });

  factory AlertaPresion.desdeJson(Map<String, dynamic> j) {
    final pos = j['posicion'];
    final neu = j['neumatico'];
    return AlertaPresion(
      id: '${j['id']}',
      vehiculoId: '${j['vehiculo_id']}',
      posicionId: '${j['posicion_id']}',
      tipo: '${j['tipo']}',
      severidad: '${j['severidad'] ?? 'alta'}',
      presionBar: _decimal(j['presion_bar']),
      presionRecomendadaBar: _decimal(j['presion_recomendada_bar']),
      desviacionPct: _decimal(j['desviacion_pct']),
      avisos: _entero(j['avisos']) ?? 1,
      primerAvisoAt: _fecha(j['primer_aviso_at']),
      ultimoAvisoAt: _fecha(j['ultimo_aviso_at']),
      codigoPosicion: pos is Map ? pos['codigo_posicion'] as String? : null,
      codigoNeumatico: neu is Map
          ? (neu['codigo_interno'] as String?) ?? (neu['numero_serie'] as String?)
          : null,
    );
  }
}

double? _decimal(dynamic v) {
  if (v == null) return null;
  if (v is num) return v.toDouble();
  return double.tryParse('$v');
}

int? _entero(dynamic v) {
  if (v == null) return null;
  if (v is int) return v;
  if (v is num) return v.round();
  return int.tryParse('$v');
}

DateTime? _fecha(dynamic v) {
  if (v == null) return null;
  return DateTime.tryParse('$v')?.toLocal();
}

/// El nombre del tipo, tal como se enseña.
String nombreDelTipo(String tipo) =>
    tipo == 'desinflado' ? 'Neumático desinflado' : 'Presión baja';

/// «4 bar de 8 recomendados (-49.65 %)», sin inventar lo que no hay.
///
/// Sin lectura se dice que no la hay. Poner «0 bar» afirmaría que se midió
/// cero, que es distinto de que el sensor no dé un número fiable — y es
/// exactamente lo que pasa en los avisos de «neumático desinflado», donde el
/// correo trae `!!!` en vez de un número.
///
/// El porcentaje NO se calcula desde los bares: vienen redondeados a un
/// decimal y dividir da otro número (4,0 sobre 8,0 daría −50 % y el correo
/// dice −49,65 %). Si falta, no se inventa.
String textoDePresion(AlertaPresion a) {
  final partes = <String>[
    a.presionBar == null ? 'Sin lectura del sensor' : '${_num(a.presionBar!)} bar',
  ];
  if (a.presionRecomendadaBar != null) {
    partes.add('de ${_num(a.presionRecomendadaBar!)} recomendados');
  }
  final txt = partes.join(' ');
  return a.desviacionPct == null ? txt : '$txt (${_num(a.desviacionPct!)} %)';
}

/// «3 avisos desde el 08/11», o `null` cuando solo ha avisado una vez.
///
/// Es lo que distingue una presión baja de una fuga. Con un solo aviso no hay
/// nada que destacar, y decir «1 aviso» sería ruido en todas las líneas.
String? textoDeRepeticion(AlertaPresion a) {
  if (a.avisos <= 1) return null;
  final desde = fechaCorta(a.primerAvisoAt);
  return desde == null ? '${a.avisos} avisos' : '${a.avisos} avisos desde el $desde';
}

/// «08/11». `null` si no hay fecha, para no pintar un hueco raro.
String? fechaCorta(DateTime? d) =>
    d == null ? null : '${_dd(d.day)}/${_dd(d.month)}';

/// «08/11 22:30».
String? fechaYHoraCorta(DateTime? d) => d == null
    ? null
    : '${_dd(d.day)}/${_dd(d.month)} ${_dd(d.hour)}:${_dd(d.minute)}';

String _dd(int n) => n.toString().padLeft(2, '0');

/// Un decimal como lo diría una persona: «8» y no «8.0», «4.4» tal cual.
String _num(double v) {
  final r = v.toStringAsFixed(2);
  return r
      .replaceFirst(RegExp(r'0+$'), '')
      .replaceFirst(RegExp(r'\.$'), '');
}
