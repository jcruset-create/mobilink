// Modelos minimos que reflejan las tablas de TyreControl en Supabase.
// Se leen con select() tal cual, sin duplicar logica de negocio: toda
// la logica compleja (montar, desmontar, sustituir) vive en RPCs de
// Postgres que ya usa el panel web y que esta app reutiliza igual.

/// Clave normalizada "marca|modelo" para casar un neumatico (texto libre)
/// con su modelo del catalogo. Mismo criterio que el panel web (ignora
/// mayusculas y espacios).
String claveModeloCatalogo(String? marca, String? modelo) =>
    '${marca ?? ''}|${modelo ?? ''}'.toLowerCase().replaceAll(RegExp(r'\s+'), '');

class Empresa {
  final String id;
  final String nombre;
  Empresa({required this.id, required this.nombre});
  factory Empresa.fromJson(Map<String, dynamic> j) => Empresa(id: j['id'], nombre: j['nombre'] ?? '');
}

class TipoVehiculo {
  final String id;
  final String nombre;
  final String? descripcion;
  final int numeroEjes;
  final int numeroRuedas;
  final String? configuracionEjes;
  final String? imagenChasisUrl; // plano/foto del vehículo (heredable)

  TipoVehiculo({
    required this.id,
    required this.nombre,
    this.descripcion,
    required this.numeroEjes,
    required this.numeroRuedas,
    this.configuracionEjes,
    this.imagenChasisUrl,
  });

  factory TipoVehiculo.fromJson(Map<String, dynamic> j) => TipoVehiculo(
        id: j['id'],
        nombre: j['nombre'] ?? '',
        descripcion: j['descripcion'],
        numeroEjes: j['numero_ejes'] ?? 2,
        numeroRuedas: j['numero_ruedas'] ?? 4,
        configuracionEjes: j['configuracion_ejes'],
        imagenChasisUrl: j['imagen_chasis_url'],
      );
}

class Vehiculo {
  final String id;
  final String empresaId;
  final String? delegacionId;
  final String? tipoVehiculoId;
  final String matricula;
  final String? numeroUnidad;
  final String? marca;
  final String? modelo;
  final num kmActual;
  final bool activo;
  final String? webfleetVehicleId; // objeto Webfleet enlazado (para km automáticos)
  // Relaciones embebidas opcionales (segun el select usado)
  final Empresa? empresa;
  final TipoVehiculo? tipo;

  Vehiculo({
    required this.id,
    required this.empresaId,
    this.delegacionId,
    this.tipoVehiculoId,
    required this.matricula,
    this.numeroUnidad,
    this.marca,
    this.modelo,
    required this.kmActual,
    required this.activo,
    this.webfleetVehicleId,
    this.empresa,
    this.tipo,
  });

  factory Vehiculo.fromJson(Map<String, dynamic> j) => Vehiculo(
        id: j['id'],
        empresaId: j['empresa_id'],
        delegacionId: j['delegacion_id'],
        tipoVehiculoId: j['tipo_vehiculo_id'],
        matricula: j['matricula'] ?? '',
        numeroUnidad: j['numero_unidad'],
        marca: j['marca'],
        modelo: j['modelo'],
        kmActual: j['km_actual'] ?? 0,
        activo: j['activo'] ?? true,
        webfleetVehicleId: j['webfleet_vehicle_id'],
        empresa: j['empresa'] is Map ? Empresa.fromJson(Map<String, dynamic>.from(j['empresa'])) : null,
        tipo: j['tipo'] is Map ? TipoVehiculo.fromJson(Map<String, dynamic>.from(j['tipo'])) : null,
      );
}

class PosicionVehiculo {
  final String id;
  final String tipoVehiculoId;
  final String codigoPosicion;
  final String? nombre;
  final int? eje;
  final String? lado; // 'izq' | 'der'
  final String? interiorExterior; // 'int' | 'ext' | null
  final int ordenVisual;
  final int? ordenRevision; // orden de revisión configurado (null = recorrido por defecto)
  // Coordenadas del plano (en % del contenedor) calibradas en el panel web.
  final double? posX;
  final double? posY;
  final double? posW;
  final double? posH;

  PosicionVehiculo({
    required this.id,
    required this.tipoVehiculoId,
    required this.codigoPosicion,
    this.nombre,
    this.eje,
    this.lado,
    this.interiorExterior,
    required this.ordenVisual,
    this.ordenRevision,
    this.posX,
    this.posY,
    this.posW,
    this.posH,
  });

  static double? _d(dynamic v) => v == null ? null : (v as num).toDouble();

  factory PosicionVehiculo.fromJson(Map<String, dynamic> j) => PosicionVehiculo(
        id: j['id'],
        tipoVehiculoId: j['tipo_vehiculo_id'],
        codigoPosicion: j['codigo_posicion'] ?? '',
        nombre: j['nombre'],
        eje: j['eje'],
        lado: j['lado'],
        interiorExterior: j['interior_exterior'],
        ordenVisual: j['orden_visual'] ?? 0,
        ordenRevision: j['orden_revision'],
        posX: _d(j['pos_x']),
        posY: _d(j['pos_y']),
        posW: _d(j['pos_w']),
        posH: _d(j['pos_h']),
      );
}

class Neumatico {
  final String id;
  final String? numeroInterno;
  final String? codigoInterno;
  final String? marca;
  final String? modelo;
  final String? medida;
  final String? indiceCarga;
  final String? indiceVelocidad;
  final String? dot;
  final String? rfidEpc;
  final String estado;
  final num? profundidadActualMm;

  Neumatico({
    required this.id,
    this.numeroInterno,
    this.codigoInterno,
    this.marca,
    this.modelo,
    this.medida,
    this.indiceCarga,
    this.indiceVelocidad,
    this.dot,
    this.rfidEpc,
    required this.estado,
    this.profundidadActualMm,
  });

  factory Neumatico.fromJson(Map<String, dynamic> j) => Neumatico(
        id: j['id'],
        numeroInterno: j['numero_interno'],
        codigoInterno: j['codigo_interno'],
        marca: j['marca'],
        modelo: j['modelo'],
        medida: j['medida'],
        indiceCarga: j['indice_carga'],
        indiceVelocidad: j['indice_velocidad'],
        dot: j['dot'],
        rfidEpc: j['rfid_epc'],
        estado: j['estado'] ?? 'almacen',
        profundidadActualMm: j['profundidad_actual_mm'],
      );

  String get medidaCompleta {
    final idx = [indiceCarga, indiceVelocidad].where((e) => e != null && e.isNotEmpty).join('');
    return [medida, idx].where((e) => e != null && e.isNotEmpty).join(' ');
  }
}

class MontajeActual {
  final String id;
  final String vehiculoId;
  final String posicionId;
  final String neumaticoId;
  final String fechaMontaje;
  final num? kmMontaje;
  final Neumatico? neumatico;

  MontajeActual({
    required this.id,
    required this.vehiculoId,
    required this.posicionId,
    required this.neumaticoId,
    required this.fechaMontaje,
    this.kmMontaje,
    this.neumatico,
  });

  factory MontajeActual.fromJson(Map<String, dynamic> j) => MontajeActual(
        id: j['id'],
        vehiculoId: j['vehiculo_id'],
        posicionId: j['posicion_id'],
        neumaticoId: j['neumatico_id'],
        fechaMontaje: j['fecha_montaje'] ?? '',
        kmMontaje: j['km_montaje'],
        neumatico: j['neumatico'] is Map ? Neumatico.fromJson(Map<String, dynamic>.from(j['neumatico'])) : null,
      );
}

class RevisionVehiculo {
  final String id;
  final String empresaId;
  final String vehiculoId;
  final num? kmVehiculo;
  final String fechaRevision;
  final String estadoRevision; // borrador | completada | enviada | anulada
  final String? observaciones;
  final String? createdAt; // marca de tiempo real (para la hora en el historial)
  final String? matricula; // del vehículo, si viene en el join

  RevisionVehiculo({
    required this.id,
    required this.empresaId,
    required this.vehiculoId,
    this.kmVehiculo,
    required this.fechaRevision,
    required this.estadoRevision,
    this.observaciones,
    this.createdAt,
    this.matricula,
  });

  factory RevisionVehiculo.fromJson(Map<String, dynamic> j) => RevisionVehiculo(
        id: j['id'],
        empresaId: j['empresa_id'],
        vehiculoId: j['vehiculo_id'],
        kmVehiculo: j['km_vehiculo'],
        fechaRevision: j['fecha_revision'] ?? '',
        estadoRevision: j['estado_revision'] ?? 'borrador',
        observaciones: j['observaciones'],
        createdAt: j['created_at'],
        matricula: j['vehiculo'] is Map ? j['vehiculo']['matricula'] : null,
      );
}

/// Detalle de revision por posicion. No usa un id de servidor hasta que
/// se guarda; en el flujo local se identifica por posicionId.
class RevisionDetalleDraft {
  final String posicionId;
  String? neumaticoId;
  double? profundidadMm;
  double? presionBar;
  String? metodoProfundidad; // 'sonda' | 'manual'
  String? metodoPresion;     // 'sonda' | 'manual'
  String? estadoVisual;
  String? observaciones;
  bool noAccesible;
  bool neumaticoAusente;
  List<String> fotoPaths; // rutas locales, se suben al guardar/sincronizar

  RevisionDetalleDraft({
    required this.posicionId,
    this.neumaticoId,
    this.profundidadMm,
    this.presionBar,
    this.metodoProfundidad,
    this.metodoPresion,
    this.estadoVisual,
    this.observaciones,
    this.noAccesible = false,
    this.neumaticoAusente = false,
    List<String>? fotoPaths,
  }) : fotoPaths = fotoPaths ?? [];

  bool get medido => noAccesible || neumaticoAusente || (profundidadMm != null || presionBar != null);

  Map<String, dynamic> toJson({required String revisionId, required String empresaId, required String vehiculoId}) => {
        'revision_id': revisionId,
        'empresa_id': empresaId,
        'vehiculo_id': vehiculoId,
        'posicion_id': posicionId,
        'neumatico_id': neumaticoId,
        'profundidad_mm': profundidadMm,
        'presion_bar': presionBar,
        'metodo_profundidad': profundidadMm != null ? (metodoProfundidad ?? 'manual') : null,
        'metodo_presion': presionBar != null ? (metodoPresion ?? 'manual') : null,
        'estado_visual': estadoVisual,
        'observaciones': observaciones,
        'no_accesible': noAccesible,
        'neumatico_ausente': neumaticoAusente,
      };
}
