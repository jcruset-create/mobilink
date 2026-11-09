/// Cómo se ordena y agrupa lo que enseña «Vehículos en bases».
///
/// Puerto a Dart de `src/modules/tyrecontrol/services/presenciaVista.ts` y de
/// `revisionPendiente.ts`, que es donde vive el criterio en el panel web. Se
/// porta y no se inventa de nuevo porque son decisiones con criterio —qué
/// cuenta como «dentro», a quién se enseña primero— y dos criterios distintos
/// para la misma pregunta son dos pantallas que se contradicen delante del
/// cliente.
///
/// Del original se trae solo lo que necesita la pantalla de la tablet. Lo que
/// queda fuera (`etiquetaBase`, `ubicacionDeVehiculo`, `coordenadasDeVehiculo`,
/// `enlaceDeMapa`, `estadoUbicacion`) es para la ficha del vehículo y los
/// enlaces a mapas del panel, que aquí no existen.
///
/// ── Una diferencia a propósito con el original ──────────────────────────────
///
/// En JavaScript `Array.prototype.sort` es estable desde ES2019, y el panel se
/// apoya en eso: a igualdad de criterio, el orden es el de entrada. `List.sort`
/// de Dart NO garantiza estabilidad, así que aquí cada comparador termina
/// desempatando por `vehiculoId`. El orden puede no ser idéntico al del panel
/// para dos vehículos empatados en todo, pero es el MISMO en cada ejecución,
/// que es lo que se puede probar y lo que evita que una lista baile al
/// refrescar.
library;

// ── Los cinco estados del barrido ──────────────────────────────────────────
// Ver `server/integration-hub/domain/presencia.ts`. Se dejan como texto, igual
// que en el panel: son lo que manda el servidor y no hay nada que ganar
// convirtiéndolos a un enum que habría que mantener en dos sitios.

const String enBase = 'IN_BASE';
const String fueraDeBases = 'OUTSIDE_BASES';
const String posicionAntigua = 'STALE_POSITION';
const String sinPosicion = 'NO_POSITION';
const String posicionNoValida = 'INVALID_POSITION';

/// Cómo se dice cada estado en la pantalla.
const Map<String, String> etiquetaPresencia = {
  enBase: 'En base',
  fueraDeBases: 'Fuera de las bases',
  posicionAntigua: 'Posición antigua',
  sinPosicion: 'Sin posición',
  posicionNoValida: 'Posición no válida',
};

/// Lo que el barrido supo de un vehículo la última vez que preguntó.
class VehiculoPresencia {
  final String vehiculoId;
  final String estado;
  final String? delegacionId;

  /// `false` = está en una base que no es la suya («de paso»).
  final bool? esSuBase;

  /// Metros al centro de SU base cuando está dentro; a la base MÁS CERCANA
  /// cuando está fuera. Son dos cosas distintas con el mismo número, y por eso
  /// la pantalla cambia también la etiqueta.
  final int? distanciaM;
  final int? antiguedadMin;
  final double? velocidadKmh;
  final String? entradaBaseAt;
  final String? calculadoAt;

  /// `sin_enlace` = falta vincularlo con la telemática;
  /// `proveedor_sin_dato` = está vinculado pero el proveedor calla.
  final String? motivo;

  final String matricula;
  final String? numeroUnidad;
  final String? delegacionNombre;

  const VehiculoPresencia({
    required this.vehiculoId,
    required this.estado,
    this.delegacionId,
    this.esSuBase,
    this.distanciaM,
    this.antiguedadMin,
    this.velocidadKmh,
    this.entradaBaseAt,
    this.calculadoAt,
    this.motivo,
    this.matricula = '—',
    this.numeroUnidad,
    this.delegacionNombre,
  });

  factory VehiculoPresencia.desdeJson(Map<String, dynamic> j) {
    final v = j['vehiculo'];
    final d = j['delegacion'];
    return VehiculoPresencia(
      vehiculoId: '${j['vehiculo_id']}',
      estado: '${j['estado']}',
      delegacionId: j['delegacion_id'] as String?,
      esSuBase: j['es_su_base'] as bool?,
      distanciaM: _entero(j['distancia_m']),
      antiguedadMin: _entero(j['antiguedad_min']),
      velocidadKmh: _decimal(j['velocidad_kmh']),
      entradaBaseAt: j['entrada_base_at'] as String?,
      calculadoAt: j['calculado_at'] as String?,
      motivo: j['motivo'] as String?,
      matricula: v is Map ? ('${v['matricula'] ?? '—'}') : '—',
      numeroUnidad: v is Map ? v['numero_unidad'] as String? : null,
      delegacionNombre: d is Map ? d['nombre'] as String? : null,
    );
  }
}

/// Una base con geo-zona configurada.
class BaseGeo {
  final String id;
  final String nombre;

  const BaseGeo({required this.id, required this.nombre});

  factory BaseGeo.desdeJson(Map<String, dynamic> j) =>
      BaseGeo(id: '${j['id']}', nombre: '${j['nombre'] ?? '—'}');
}

/// Una cuenta de telemática del cliente, tal como está dada de alta en el Hub.
///
/// Está aquí solo para poder explicar una pantalla vacía: sin ninguna cuenta,
/// el barrido no tiene a quién preguntar, y ese es el motivo más frecuente.
class CuentaTelematica {
  final String proveedor;
  final String cuenta;
  final String? nombre;
  final bool activa;

  const CuentaTelematica({
    required this.proveedor,
    required this.cuenta,
    this.nombre,
    required this.activa,
  });

  factory CuentaTelematica.desdeJson(Map<String, dynamic> j) => CuentaTelematica(
        proveedor: '${j['proveedor']}',
        cuenta: '${j['cuenta']}',
        nombre: j['nombre'] as String?,
        activa: j['activa'] == true,
      );
}

/// La respuesta entera del endpoint de presencia.
class PresenciaBases {
  final List<VehiculoPresencia> vehiculos;
  final List<BaseGeo> bases;
  final List<CuentaTelematica> cuentas;
  final Map<String, int> porEstado;

  /// Cuántos vehículos se han dejado fuera por estar fuera del mantenimiento
  /// integral.
  ///
  /// Hay que decirlo: esos vehículos siguen saliendo en la lista de vehículos
  /// y en la telemática, así que sin este número el «N dentro» de una base no
  /// cuadra con lo que se ve en otro sitio y nadie sabe por qué. Los dados de
  /// baja no se cuentan aquí: que uno de baja no salga no sorprende a nadie.
  final int sinSeguimiento;

  /// Cuándo se barrió. NO es «ahora»: la pantalla lo enseña siempre porque un
  /// estado de hace media hora es útil y presentado como actual es engañoso.
  final String? calculadoAt;

  const PresenciaBases({
    this.vehiculos = const [],
    this.bases = const [],
    this.cuentas = const [],
    this.porEstado = const {},
    this.sinSeguimiento = 0,
    this.calculadoAt,
  });

  factory PresenciaBases.desdeJson(Map<String, dynamic> j) {
    final estados = <String, int>{};
    final pe = j['porEstado'];
    if (pe is Map) {
      pe.forEach((k, v) => estados['$k'] = _entero(v) ?? 0);
    }
    return PresenciaBases(
      vehiculos: _lista(j['vehiculos']).map(VehiculoPresencia.desdeJson).toList(),
      bases: _lista(j['bases']).map(BaseGeo.desdeJson).toList(),
      cuentas: _lista(j['cuentas']).map(CuentaTelematica.desdeJson).toList(),
      porEstado: estados,
      sinSeguimiento: _entero(j['sinSeguimiento']) ?? 0,
      calculadoAt: j['calculadoAt'] as String?,
    );
  }
}

/// El estado de la periodicidad de un vehículo, tal como lo da
/// `tc_revision_estado`.
class RevisionEstado {
  final String vehiculoId;
  final String estado; // sin_revision | vencida | proxima | al_dia
  final String? ultimaRevision;
  final int? intervaloDias;
  final int? diasVencido;
  final String? ultimaRevisionPor;
  final String? ultimaRevisionOrigen; // tecnico | checkpoint

  const RevisionEstado({
    required this.vehiculoId,
    required this.estado,
    this.ultimaRevision,
    this.intervaloDias,
    this.diasVencido,
    this.ultimaRevisionPor,
    this.ultimaRevisionOrigen,
  });

  factory RevisionEstado.desdeJson(Map<String, dynamic> j) => RevisionEstado(
        vehiculoId: '${j['vehiculo_id']}',
        estado: '${j['estado'] ?? ''}',
        ultimaRevision: j['ultima_revision'] as String?,
        intervaloDias: _entero(j['intervalo_dias']),
        diasVencido: _entero(j['dias_vencido']),
        ultimaRevisionPor: j['ultima_revision_por'] as String?,
        ultimaRevisionOrigen: j['ultima_revision_origen'] as String?,
      );
}

// ── El criterio de «pendiente» ─────────────────────────────────────────────

/// Prioridad de una revisión: cuanto menor, más arriba.
///
/// Nunca revisado va antes que vencida, y vencida antes que próxima. El nunca
/// revisado primero no es un capricho: de ese no se sabe ni cómo está, y es el
/// que más se arriesga a irse de la base sin que nadie le haya mirado nada.
int prioridadRevision(String? estado) {
  if (estado == 'sin_revision') return 0;
  if (estado == 'vencida') return 1;
  if (estado == 'proxima') return 2;
  return 3;
}

/// ¿Tiene este vehículo algo pendiente que justifique cogerlo ahora?
bool tieneRevisionPendiente(RevisionEstado? rev) =>
    rev != null &&
    (rev.estado == 'sin_revision' || rev.estado == 'vencida' || rev.estado == 'proxima');

// ── Agrupaciones ───────────────────────────────────────────────────────────

/// Los que están DENTRO de una base con posición reciente, por base.
///
/// `STALE_POSITION` no entra, y es la decisión importante de este módulo: su
/// última posición cae dentro de la base y probablemente sigan ahí, pero
/// «probablemente» no es a quien se manda buscar al patio. Se cuentan aparte
/// con [dormidosPorBase].
Map<String, List<VehiculoPresencia>> agruparPorBase(
  List<VehiculoPresencia> vehiculos,
  Map<String, RevisionEstado> revisiones,
) {
  final m = <String, List<VehiculoPresencia>>{};
  for (final v in vehiculos) {
    final base = v.delegacionId;
    if (v.estado != enBase || base == null) continue;
    m.putIfAbsent(base, () => <VehiculoPresencia>[]).add(v);
  }
  for (final lista in m.values) {
    lista.sort((a, b) {
      final pa = prioridadRevision(revisiones[a.vehiculoId]?.estado);
      final pb = prioridadRevision(revisiones[b.vehiculoId]?.estado);
      if (pa != pb) return pa - pb;
      // A igualdad, el que lleva más tiempo en la base: ese ya está aparcado,
      // no acabando de entrar.
      final ea = a.entradaBaseAt ?? '';
      final eb = b.entradaBaseAt ?? '';
      if (ea != eb) return ea.compareTo(eb);
      return a.vehiculoId.compareTo(b.vehiculoId);
    });
  }
  return m;
}

/// Cuántos, por base, están dentro AHORA y con revisión pendiente.
///
/// Es el número que decide a qué patio bajar: «155 dentro» dice cuántos hay,
/// pero no a cuántos hay algo que hacerles.
Map<String, int> revisablesPorBase(
  List<VehiculoPresencia> vehiculos,
  Map<String, RevisionEstado> revisiones,
) {
  final m = <String, int>{};
  for (final v in vehiculos) {
    final base = v.delegacionId;
    if (v.estado != enBase || base == null) continue;
    if (!tieneRevisionPendiente(revisiones[v.vehiculoId])) continue;
    m[base] = (m[base] ?? 0) + 1;
  }
  return m;
}

/// Cuántos, por base, tienen la última posición dentro pero ya vieja.
Map<String, int> dormidosPorBase(List<VehiculoPresencia> vehiculos) {
  final m = <String, int>{};
  for (final v in vehiculos) {
    final base = v.delegacionId;
    if (v.estado != posicionAntigua || base == null) continue;
    m[base] = (m[base] ?? 0) + 1;
  }
  return m;
}

/// El orden de las tres listas de pendientes: primero el que más falta hace.
///
/// Por prioridad y, a igualdad, por lo vencido que esté: el de 40 días de
/// retraso antes que el de 3. Está extraído para que la lista de los que están
/// en base, la de los que andan por ahí y la de los que no se sabe se ordenen
/// igual. Tres criterios distintos para la misma pregunta serían tres órdenes
/// que nadie podría explicar.
List<VehiculoPresencia> _ordenarPorUrgencia(
  Iterable<VehiculoPresencia> vehiculos,
  Map<String, RevisionEstado> revisiones,
) {
  final out = vehiculos.toList();
  out.sort((a, b) {
    final pa = prioridadRevision(revisiones[a.vehiculoId]?.estado);
    final pb = prioridadRevision(revisiones[b.vehiculoId]?.estado);
    if (pa != pb) return pa - pb;
    final da = revisiones[a.vehiculoId]?.diasVencido ?? 0;
    final db = revisiones[b.vehiculoId]?.diasVencido ?? 0;
    if (da != db) return db - da;
    return a.vehiculoId.compareTo(b.vehiculoId);
  });
  return out;
}

/// En base AHORA y con revisión pendiente: la lista que justifica la pantalla.
List<VehiculoPresencia> revisablesEnBase(
  List<VehiculoPresencia> vehiculos,
  Map<String, RevisionEstado> revisiones,
) =>
    _ordenarPorUrgencia(
      vehiculos.where(
        (v) => v.estado == enBase && tieneRevisionPendiente(revisiones[v.vehiculoId]),
      ),
      revisiones,
    );

/// Pendientes de revisar que están FUERA de todas las bases.
///
/// La otra mitad de la pregunta: «¿cuánto trabajo pendiente tengo que NO puedo
/// hacer hoy porque el autobús está por ahí?». Solo `OUTSIDE_BASES`, que es
/// posición RECIENTE y fuera de todas: uno con la posición vieja no está aquí
/// aunque su última posición fuera una carretera, porque de ese no se sabe
/// dónde está.
List<VehiculoPresencia> revisablesFueraDeBase(
  List<VehiculoPresencia> vehiculos,
  Map<String, RevisionEstado> revisiones,
) =>
    _ordenarPorUrgencia(
      vehiculos.where(
        (v) => v.estado == fueraDeBases && tieneRevisionPendiente(revisiones[v.vehiculoId]),
      ),
      revisiones,
    );

/// Pendientes de revisar de los que no se sabe dónde están.
///
/// Los tres estados que no afirman nada: posición vieja —esté donde esté—, sin
/// posición y posición no válida.
///
/// Existe para que las cuentas cuadren. Con solo «en base» y «fuera de base» la
/// suma no da el total de pendientes y la diferencia desaparece sin que nadie
/// la vea; en esta flota una quinta parte de los equipos lleva más de un día
/// sin emitir. Un pendiente escondido en una resta es un pendiente que no se
/// revisa nunca.
List<VehiculoPresencia> revisablesSinUbicacion(
  List<VehiculoPresencia> vehiculos,
  Map<String, RevisionEstado> revisiones,
) {
  const inciertos = {posicionAntigua, sinPosicion, posicionNoValida};
  return _ordenarPorUrgencia(
    vehiculos.where(
      (v) => inciertos.contains(v.estado) && tieneRevisionPendiente(revisiones[v.vehiculoId]),
    ),
    revisiones,
  );
}

/// ¿Es este «Al día» un «al día» de verdad?
///
/// El estado sale de comparar la última revisión con la periodicidad del
/// vehículo o de su tipo. Cuando no hay ninguna de las dos, no hay con qué
/// comparar y el cálculo se queda en «al día» por descarte: no porque la
/// revisión esté en plazo, sino porque nadie ha dicho cuál es el plazo.
///
/// Pasa con los vehículos dados de alta desde esta misma tablet, que nacen sin
/// tipo: en cuanto se les hace la primera revisión salen «Al día» para siempre
/// y no vuelven a aparecer como pendientes.
bool sinPeriodicidad(RevisionEstado? rev) =>
    rev != null && rev.estado == 'al_dia' && rev.intervaloDias == null;

/// Los que están en base ahora y arrastran ese «al día» que no dice nada.
List<VehiculoPresencia> sinPeriodicidadEnBase(
  List<VehiculoPresencia> vehiculos,
  Map<String, RevisionEstado> revisiones,
) =>
    vehiculos
        .where((v) => v.estado == enBase && sinPeriodicidad(revisiones[v.vehiculoId]))
        .toList();

// ── Cómo se dicen los números ──────────────────────────────────────────────

/// Cuánto lleva desde un instante, en palabras. `—` si no hay instante.
String desde(String? iso, {DateTime? ahora}) {
  if (iso == null || iso.isEmpty) return '—';
  final t = DateTime.tryParse(iso);
  if (t == null) return '—';
  final ms = (ahora ?? DateTime.now()).difference(t).inMilliseconds;
  if (ms < 0) return '—';
  final min = ms ~/ 60000;
  if (min < 60) return '$min min';
  final h = min ~/ 60;
  return h < 24 ? '$h h ${min % 60} min' : '${h ~/ 24} d ${h % 24} h';
}

/// Una antigüedad en minutos, redondeada a la unidad que se lee mejor.
String minutosEnPalabras(int? min) {
  if (min == null) return '—';
  if (min < 60) return '$min min';
  final h = min ~/ 60;
  return h < 24 ? '$h h' : '${h ~/ 24} d';
}

/// Una distancia en metros, dicha como la diría una persona.
///
/// Por debajo del kilómetro, metros: «420 m» se entiende de un vistazo y «0,4
/// km» no. Por encima, kilómetros, con un decimal hasta 100 y redondo a partir
/// de ahí: a 127 km el centenar de metros no cambia ninguna decisión.
String distanciaCorta(num? m) {
  if (m == null || !m.isFinite) return '—';
  if (m < 1000) return '${m.round()} m';
  final km = m / 1000;
  return km < 100 ? '${km.toStringAsFixed(1).replaceAll('.', ',')} km' : '${km.round()} km';
}

/// La velocidad, para saber si el autobús está haciendo algo o aparcado.
///
/// Por debajo de 3 km/h se dice «Parado» en vez de «1 km/h»: un GPS quieto
/// nunca da cero limpio, y enseñar «2 km/h» de un autobús aparcado hace dudar
/// de si se está moviendo despacio. A 3 km/h ya se va andando, así que el
/// umbral no esconde ningún movimiento real.
String velocidadCorta(num? kmh) {
  if (kmh == null || !kmh.isFinite) return '—';
  return kmh < 3 ? 'Parado' : '${kmh.round()} km/h';
}

/// Una fecha de revisión, corta y en castellano. `—` si no hay ninguna.
///
/// La ausencia se enseña como raya y no como «nunca»: el distintivo de al lado
/// ya dice «Sin revisión», y repetirlo con otras palabras no añade nada.
String fechaCorta(String? iso) {
  if (iso == null || iso.isEmpty) return '—';
  final d = DateTime.tryParse(iso);
  if (d == null) return '—';
  final dd = d.day.toString().padLeft(2, '0');
  final mm = d.month.toString().padLeft(2, '0');
  return '$dd/$mm/${d.year}';
}

/// Quién hizo la última revisión, para enseñarlo debajo de la fecha.
///
/// Un nombre y una máquina no dicen lo mismo: «David» es alguien que miró la
/// rueda, y «CheckPoint» es el arco de la entrada, que mide al pasar y no
/// levanta el vehículo. Quien decide a cuál coger ahora que está en la base
/// quiere saber cuál de las dos fue.
///
/// Una revisión de técnico sin nombre —porque los permisos no dejan ver ese
/// usuario— se queda en «Técnico» genérico, que es verdad, en vez de en una
/// raya que haría pensar que no la hizo nadie.
String quienReviso(RevisionEstado? rev) {
  if (rev == null) return '—';
  if (rev.ultimaRevisionOrigen == 'checkpoint') return 'CheckPoint';
  if (rev.ultimaRevisionOrigen == 'tecnico') {
    final por = rev.ultimaRevisionPor;
    return (por == null || por.isEmpty) ? 'Técnico' : por;
  }
  return '—';
}

// ── Ayudas de lectura del JSON ─────────────────────────────────────────────

List<Map<String, dynamic>> _lista(dynamic v) => v is List
    ? v.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList()
    : const <Map<String, dynamic>>[];

int? _entero(dynamic v) {
  if (v == null) return null;
  if (v is int) return v;
  if (v is num) return v.round();
  return int.tryParse('$v');
}

double? _decimal(dynamic v) {
  if (v == null) return null;
  if (v is num) return v.toDouble();
  return double.tryParse('$v');
}
