import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:image_picker/image_picker.dart';
import 'package:url_launcher/url_launcher.dart';
import '../models/models.dart';
import '../services/offline_store.dart';
import '../services/ocr_service.dart';
import '../services/supabase_service.dart';
import '../theme/app_theme.dart';
import '../widgets/firma_pad.dart';
import '../widgets/vehicle_layout_image.dart';

/// Realizar operación: el parte de servicio, paso a paso, desde la tablet.
///
/// Sigue el orden del formulario en papel, no el de las pantallas de Mobilink,
/// porque quien lo rellena tiene el papel delante. Pero las tablas de
/// desmontados y montados NO se rellenan como listas: se rellenan tocando la
/// rueda en el plano. Copiar el papel literalmente produciría filas sin
/// posición, y una fila sin posición no alimenta el histórico, que es para lo
/// que sirve todo esto.
///
/// NADA SE ESCRIBE HASTA EL ÚLTIMO PASO. El borrador vive en la tablet, y al
/// confirmar se manda entero a tc_guardar_parte_guiado, que lo escribe en una
/// sola transacción: si algo falla, no queda nada a medias.
enum _Paso { vehiculo, cabecera, ruedas, servicios, firmas, revision, hecho }

const _titulos = <_Paso, String>{
  _Paso.vehiculo:  'Vehículo',
  _Paso.cabecera:  'Datos del servicio',
  _Paso.ruedas:    'Las ruedas',
  _Paso.servicios: 'Servicios',
  _Paso.firmas:    'Firmas',
  _Paso.revision:  'Repasar',
  _Paso.hecho:     'Hecho',
};

/// Qué se le hace a una rueda. Son las operaciones que ya existen; aquí no se
/// inventa ninguna.
enum _Accion { ninguna, desmontar, cambiarPosicion, reparar, montar }

const _accionTexto = <_Accion, String>{
  _Accion.ninguna:         'Solo revisar',
  _Accion.desmontar:       'Desmontar',
  _Accion.cambiarPosicion: 'Mover a otra posición',
  _Accion.reparar:         'Reparar',
  _Accion.montar:          'Montar uno',
};

/// Qué acciones tienen sentido según lo que haya en la posición. Enseñar
/// "Desmontar" en un hueco vacío, o "Montar" donde ya hay goma, es ofrecer un
/// camino que la base de datos va a rechazar al final del parte.
List<_Accion> _accionesPara({required bool hayNeumatico}) => hayNeumatico
    ? const [_Accion.ninguna, _Accion.desmontar, _Accion.cambiarPosicion, _Accion.reparar]
    : const [_Accion.ninguna, _Accion.montar];

/// Lo apuntado para una posición: lo medido y lo que se le hace.
class _Rueda {
  double? profundidad;
  double? presion;
  String? estadoVisual;
  String? observaciones;
  _Accion accion = _Accion.ninguna;
  String? destinoPosicionId; // solo para cambiarPosicion

  /// Razón de sustitución y destino: CÓDIGOS de tc_cat_motivos y
  /// tc_cat_destinos, no texto libre. Nacen vacíos a propósito: si trajeran un
  /// valor por defecto, el parte saldría con "desgaste / almacén" cada vez que
  /// al operario se le pasara elegirlos, y eso es peor que no tener el dato.
  String? motivo;
  String? destino;

  /// Las fotos del neumático que se retira. La del número de serie es
  /// OBLIGATORIA: es lo que ata la goma que sale a la ficha que hay en el
  /// sistema. Las otras dos ayudan pero no bloquean.
  String? fotoSerie;
  String? fotoNeumatico;
  String? fotoDot;

  // Montaje en una posición vacía.
  String? referenciaId;
  String? referenciaTexto;   // solo para pintarlo; el id es lo que viaja
  String condicion = 'nuevo';

  bool get tocada =>
      profundidad != null || presion != null || accion != _Accion.ninguna ||
      (observaciones?.isNotEmpty ?? false);

  Map<String, dynamic> aJson() => {
        'profundidad': profundidad, 'presion': presion,
        'estadoVisual': estadoVisual, 'observaciones': observaciones,
        'accion': accion.name, 'destinoPosicionId': destinoPosicionId,
        'motivo': motivo, 'destino': destino,
        'fotoSerie': fotoSerie, 'fotoNeumatico': fotoNeumatico, 'fotoDot': fotoDot,
        'referenciaId': referenciaId, 'referenciaTexto': referenciaTexto,
        'condicion': condicion,
      };

  static _Rueda deJson(Map<String, dynamic> j) => _Rueda()
    ..profundidad = (j['profundidad'] as num?)?.toDouble()
    ..presion = (j['presion'] as num?)?.toDouble()
    ..estadoVisual = j['estadoVisual'] as String?
    ..observaciones = j['observaciones'] as String?
    ..accion = _Accion.values.firstWhere(
        (a) => a.name == j['accion'], orElse: () => _Accion.ninguna)
    ..destinoPosicionId = j['destinoPosicionId'] as String?
    ..motivo = j['motivo'] as String?
    ..destino = j['destino'] as String?
    ..fotoSerie = j['fotoSerie'] as String?
    ..fotoNeumatico = j['fotoNeumatico'] as String?
    ..fotoDot = j['fotoDot'] as String?
    ..referenciaId = j['referenciaId'] as String?
    ..referenciaTexto = j['referenciaTexto'] as String?
    ..condicion = (j['condicion'] as String?) ?? 'nuevo';
}

class RealizarOperacionScreen extends StatefulWidget {
  const RealizarOperacionScreen({super.key});

  @override
  State<RealizarOperacionScreen> createState() => _RealizarOperacionScreenState();
}

class _RealizarOperacionScreenState extends State<RealizarOperacionScreen> {
  static const _claveBorrador = 'tc_parte_guiado_borrador';

  _Paso _paso = _Paso.vehiculo;
  bool _trabajando = false;
  String? _error;
  List<String> _avisos = [];

  /// La clave de idempotencia. Se genera AL ABRIR y viaja con el borrador: si
  /// se pulsa Guardar dos veces, o se reintenta tras un corte de red, el
  /// servidor reconoce la clave y devuelve el mismo parte en vez de crear otro.
  late String _clave;

  // Vehículo
  final _matricula = TextEditingController();
  /// ¿Hay lectura por fotografías? Si el servidor no tiene IA configurada el
  /// botón NO se enseña: uno que falla es peor que uno que no está.
  bool _hayIA = false;
  final _carpetaFotos = DateTime.now().millisecondsSinceEpoch.toString();
  Vehiculo? _vehiculo;
  List<PosicionVehiculo> _posiciones = [];
  Map<String, MontajeActual> _montajes = {};
  String? _imagenChasis;

  // Cabecera
  final _km = TextEditingController();
  final _ordenFlota = TextEditingController();
  String? _lugar;

  // Ruedas
  final Map<String, _Rueda> _ruedas = {};
  String? _posicionActiva;

  /// Los catálogos que rellenan los desplegables. NO son listas escritas aquí:
  /// vienen de tc_cat_motivos y tc_cat_destinos, los mismos que usa el panel.
  /// Se guardan en la tablet porque cambian una vez al año y el arcén no
  /// siempre tiene cobertura; sin esta caché, sin red no habría desplegables.
  List<Map<String, dynamic>> _catMotivos = [];
  List<Map<String, dynamic>> _catDestinos = [];
  List<Map<String, dynamic>> _catReferencias = [];

  // Servicios
  List<Map<String, dynamic>> _catServicios = [];
  final Map<String, num> _cantidades = {};

  // Firmas
  final _nombreCliente = TextEditingController();
  final _dniCliente = TextEditingController();
  final _nombreTecnico = TextEditingController();
  Uint8List? _firmaCliente;
  Uint8List? _firmaTecnico;

  // Resultado
  String? _intervencionId;
  String? _numeroParte;

  @override
  void initState() {
    super.initState();
    _clave = _uuid();
    _recuperarBorrador();
    TyreControlApi.parteDisponible()
        .then((v) { if (mounted) setState(() => _hayIA = v); });
    TyreControlApi.listarServiciosCatalogo()
        .then((v) { if (mounted) setState(() => _catServicios = v); })
        .catchError((_) {/* se puede seguir sin catálogo */});
    _cargarCatalogos();
  }

  /// Motivos, destinos y referencias: de la base de datos si hay red, de la
  /// última copia guardada si no. Lo que NO se hace es inventar una lista de
  /// respaldo en la APK: sería un catálogo paralelo que se desincronizaría del
  /// de verdad sin que nadie se enterara.
  Future<void> _cargarCatalogos() async {
    void poner(String clave, List<Map<String, dynamic>> v) {
      switch (clave) {
        case 'motivos':     _catMotivos = v; break;
        case 'destinos':    _catDestinos = v; break;
        case 'referencias': _catReferencias = v; break;
      }
    }

    // Primero lo guardado: la pantalla se pinta ya, sin esperar a la red.
    for (final c in ['motivos', 'destinos', 'referencias']) {
      final j = OfflineStore.cachedJson('tc_cat_$c');
      if (j is List) {
        poner(c, j.map((e) => Map<String, dynamic>.from(e as Map)).toList());
      }
    }
    if (mounted) setState(() {});

    Future<void> refrescar(
        String clave, Future<List<Map<String, dynamic>>> Function() traer) async {
      try {
        final v = await traer();
        await OfflineStore.cacheJson('tc_cat_$clave', v);
        if (mounted) setState(() => poner(clave, v));
      } catch (_) {
        // Sin red se sigue con la copia guardada.
      }
    }

    await Future.wait([
      refrescar('motivos', TyreControlApi.listarMotivosDesmontaje),
      refrescar('destinos', TyreControlApi.listarDestinosNeumatico),
      refrescar('referencias', TyreControlApi.listarCatalogoReferencias),
    ]);
  }

  /// Una foto: cámara, subida y URL. Se sube EN EL MOMENTO, no al guardar: si
  /// se acumularan para el final, un parte con doce fotos tardaría un minuto
  /// en cerrarse con el cliente delante, y un corte de red lo perdería todo.
  Future<String?> _hacerFoto() async {
    final foto = await ImagePicker().pickImage(
        source: ImageSource.camera, imageQuality: 85);
    if (foto == null) return null;
    setState(() { _trabajando = true; _error = null; });
    try {
      return await TyreControlApi.subirFotoParte(
          File(foto.path), carpeta: _carpetaFotos);
    } catch (e) {
      if (mounted) setState(() => _error = 'No se ha podido subir la foto: $e');
      return null;
    } finally {
      if (mounted) setState(() => _trabajando = false);
    }
  }

  @override
  void dispose() {
    for (final c in [_matricula, _km, _ordenFlota,
                     _nombreCliente, _dniCliente, _nombreTecnico]) {
      c.dispose();
    }
    super.dispose();
  }

  /// UUID v4 con el generador del propio Dart. No se añade una dependencia
  /// para cuatro líneas, y no hace falta que sea criptográfico: solo tiene que
  /// no repetirse entre dos partes.
  String _uuid() {
    final r = DateTime.now().microsecondsSinceEpoch;
    final h = Object.hash(r, identityHashCode(this)).toUnsigned(32);
    String hex(int v, int n) => v.toRadixString(16).padLeft(n, '0').substring(0, n);
    return '${hex(r, 8)}-${hex(h, 4)}-4${hex(h >> 4, 3)}-a${hex(r >> 8, 3)}-${hex(h ^ r, 12)}';
  }

  // ── Borrador ───────────────────────────────────────────────────────────────
  // Se guarda en la tablet a cada paso: el operario puede salir, atender otra
  // cosa y volver. Lo que NO se hace es encolar el guardado final sin red —
  // ver la nota en _guardar().
  Future<void> _guardarBorrador() async {
    if (_vehiculo == null) return;
    await OfflineStore.cacheJson(_claveBorrador, {
      'clave': _clave,
      'paso': _paso.name,
      'vehiculo_id': _vehiculo!.id,
      'matricula': _vehiculo!.matricula,
      'km': _km.text,
      'orden_flota': _ordenFlota.text,
      'lugar': _lugar,
      'ruedas': _ruedas.map((k, v) => MapEntry(k, v.aJson())),
      'cantidades': _cantidades.map((k, v) => MapEntry(k, v)),
      'nombre_cliente': _nombreCliente.text,
      'dni_cliente': _dniCliente.text,
      'nombre_tecnico': _nombreTecnico.text,
    });
  }

  Future<void> _recuperarBorrador() async {
    final j = OfflineStore.cachedJson(_claveBorrador);
    if (j is! Map || j['vehiculo_id'] == null) return;
    if (!mounted) return;
    final seguir = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        title: const Text('Hay un parte a medias'),
        content: Text('Empezaste el parte de ${j['matricula'] ?? 'un vehículo'} '
                      'y no lo terminaste. ¿Lo sigues?'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false),
                     child: const Text('Empezar uno nuevo')),
          FilledButton(onPressed: () => Navigator.pop(context, true),
                       child: const Text('Seguir')),
        ],
      ),
    );
    if (seguir != true) {
      await OfflineStore.cacheJson(_claveBorrador, null);
      return;
    }
    _clave = (j['clave'] as String?) ?? _clave;
    _km.text = (j['km'] as String?) ?? '';
    _ordenFlota.text = (j['orden_flota'] as String?) ?? '';
    _lugar = j['lugar'] as String?;
    _nombreCliente.text = (j['nombre_cliente'] as String?) ?? '';
    _dniCliente.text = (j['dni_cliente'] as String?) ?? '';
    _nombreTecnico.text = (j['nombre_tecnico'] as String?) ?? '';
    (j['ruedas'] as Map?)?.forEach((k, v) {
      _ruedas[k as String] = _Rueda.deJson(Map<String, dynamic>.from(v as Map));
    });
    (j['cantidades'] as Map?)?.forEach((k, v) {
      if (v is num) _cantidades[k as String] = v;
    });
    await _cargarVehiculoPorId(j['vehiculo_id'] as String);
    if (mounted) {
      setState(() => _paso = _Paso.values.firstWhere(
          (p) => p.name == j['paso'], orElse: () => _Paso.cabecera));
    }
  }

  // ── Paso 1: el vehículo ────────────────────────────────────────────────────
  Future<void> _cargarVehiculoPorId(String id) async {
    try {
      final v = await TyreControlApi.obtenerVehiculo(id);
      if (v != null) await _fijarVehiculo(v);
    } catch (_) {
      // Sin red no se puede recuperar el borrador entero; el vehículo se
      // vuelve a elegir y lo apuntado sigue ahí.
    }
  }

  Future<void> _fijarVehiculo(Vehiculo v) async {
    setState(() { _trabajando = true; _error = null; });
    try {
      final pos = await TyreControlApi.listarPosiciones(v.tipo?.id ?? '');
      final mon = await TyreControlApi.listarMontajesVehiculo(v.id);
      final img = await TyreControlApi.obtenerImagenChasis(v);
      if (!mounted) return;
      setState(() {
        _vehiculo = v;
        _posiciones = pos;
        _montajes = { for (final m in mon) m.posicionId: m };
        _imagenChasis = img;
        if (_km.text.isEmpty && v.kmActual > 0) _km.text = v.kmActual.toStringAsFixed(0);
      });
    } catch (e) {
      if (mounted) setState(() => _error = 'No se ha podido cargar el vehículo: $e');
    } finally {
      if (mounted) setState(() => _trabajando = false);
    }
  }

  Future<void> _buscarMatricula() async {
    final texto = _matricula.text.trim();
    if (texto.length < 2) return;
    setState(() { _trabajando = true; _error = null; });
    try {
      final r = await TyreControlApi.buscarVehiculos(texto);
      if (!mounted) return;
      if (r.isEmpty) {
        setState(() => _trabajando = false);
        await _ofrecerAlta(texto);
        return;
      }
      if (r.length == 1) { await _fijarVehiculo(r.first); return; }
      final elegido = await showDialog<Vehiculo>(
        context: context,
        builder: (_) => SimpleDialog(
          title: const Text('¿Cuál de estos?'),
          children: [
            for (final v in r)
              SimpleDialogOption(
                onPressed: () => Navigator.pop(context, v),
                child: Padding(
                  padding: const EdgeInsets.symmetric(vertical: 10),
                  child: Text('${v.matricula} · ${v.empresa?.nombre ?? ''}',
                              style: const TextStyle(fontSize: 16)),
                ),
              ),
          ],
        ),
      );
      if (elegido != null) await _fijarVehiculo(elegido);
    } catch (e) {
      if (mounted) setState(() => _error = 'No se ha podido buscar: $e');
    } finally {
      if (mounted) setState(() => _trabajando = false);
    }
  }

  Future<void> _escanearMatricula() async {
    final foto = await ImagePicker().pickImage(source: ImageSource.camera, imageQuality: 85);
    if (foto == null) return;
    setState(() { _trabajando = true; _error = null; });
    try {
      final leida = await OcrService.reconocerMatricula(File(foto.path));
      if (!mounted) return;
      // La lectura SE ENSEÑA, no se da por buena: el operario la confirma o la
      // corrige antes de que se busque nada.
      if (leida != null && leida.isNotEmpty) {
        _matricula.text = leida;
        setState(() => _error = null);
      } else {
        setState(() => _error = 'No se ha podido leer la matrícula. Escríbela.');
      }
    } catch (e) {
      if (mounted) setState(() => _error = 'No se ha podido leer la foto: $e');
    } finally {
      if (mounted) setState(() => _trabajando = false);
    }
  }

  /// El atajo por fotografías.
  ///
  /// NO es un camino aparte: rellena ESTE formulario y el operario sigue por
  /// los mismos pasos, confirmando o corrigiendo. Dos botones que hacen lo
  /// mismo de dos maneras acaban en partes hechos de dos formas distintas.
  Future<void> _rellenarConFotos() async {
    final fotos = await ImagePicker().pickMultiImage(imageQuality: 85);
    if (fotos.isEmpty) return;
    setState(() { _trabajando = true; _error = null; });
    try {
      final urls = <String>[];
      for (final f in fotos) {
        urls.add(await TyreControlApi.subirFotoParte(File(f.path), carpeta: _carpetaFotos));
      }
      final r = await TyreControlApi.leerParte(urls);
      if (!mounted) return;

      final matricula = (r['plate'] as String?)?.trim() ?? '';
      final km = (r['kilometers'] as String?)?.trim() ?? '';
      setState(() {
        // Lo leído SE ENSEÑA para que se confirme. Nada se da por bueno solo.
        if (matricula.isNotEmpty) _matricula.text = matricula;
        if (km.isNotEmpty && _km.text.isEmpty) {
          _km.text = km.replaceAll(RegExp(r'[^0-9]'), '');
        }
        _avisos = ((r['warnings'] as List?) ?? const []).map((e) => e.toString()).toList();
        _error = matricula.isEmpty
            ? 'No se ha podido leer la matrícula en las fotos. Escríbela tú.'
            : null;
      });

      // Con matrícula leída se busca sola, pero el operario ve la ficha del
      // vehículo y la confirma antes de seguir: no se salta ningún paso.
      if (matricula.isNotEmpty) await _buscarMatricula();
    } catch (e) {
      if (mounted) setState(() => _error = 'No se han podido leer las fotos: $e');
    } finally {
      if (mounted) setState(() => _trabajando = false);
    }
  }

  /// La matrícula no está fichada: parametrización corta y seguimos.
  Future<void> _ofrecerAlta(String matricula) async {
    final alta = await showModalBottomSheet<Vehiculo>(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppColors.surface,
      builder: (_) => _AltaVehiculo(matricula: matricula.toUpperCase()),
    );
    if (alta != null) await _fijarVehiculo(alta);
  }

  // ── Guardar ────────────────────────────────────────────────────────────────
  /// Arma las acciones en el formato que espera tc_guardar_parte_guiado: el
  /// nombre de la RPC que ya existe y sus argumentos. Aquí no se decide nada
  /// de negocio; las reglas siguen en la base de datos.
  List<Map<String, dynamic>> _acciones() {
    final km = num.tryParse(_km.text.trim());
    final out = <Map<String, dynamic>>[];
    _ruedas.forEach((posId, r) {
      final montaje = _montajes[posId];
      switch (r.accion) {
        case _Accion.ninguna:
          break;
        case _Accion.montar:
          // Montar SÍ vale en una posición vacía: es justamente para eso.
          if (montaje != null || r.referenciaId == null) break;
          out.add({'rpc': 'tc_montar_desde_catalogo', 'args': {
            'p_vehiculo': _vehiculo!.id, 'p_posicion': posId,
            'p_referencia': r.referenciaId, 'p_control_individual': null,
            'p_datos': <String, dynamic>{
              if (r.condicion == 'usado' && r.profundidad != null)
                'profundidad_actual_mm': r.profundidad!.toString(),
            },
            'p_km': km, 'p_fecha': null,
            'p_obs': r.observaciones ?? 'Montaje desde el parte (tablet)',
            'p_forzar_medida': false, 'p_condicion': r.condicion,
          }});
          break;
        case _Accion.desmontar:
          if (montaje == null) break; // sin goma montada no hay nada que quitar
          out.add({
            'rpc': 'tc_desmontar_neumatico',
            'args': {
              'p_montaje': montaje.id, 'p_km': km, 'p_motivo': r.motivo,
              // El estado en que queda la goma lo decide el DESTINO, y esa
              // traducción la hace la base de datos con tc_cat_destinos: aquí
              // no se copia la tabla, solo se manda el código elegido.
              'p_obs': r.observaciones,
            },
            'destino_codigo': r.destino,
            'adjuntos': [
              if (r.fotoSerie != null)
                {'url': r.fotoSerie, 'descripcion': 'Número de serie'},
              if (r.fotoNeumatico != null)
                {'url': r.fotoNeumatico, 'descripcion': 'Neumático'},
              if (r.fotoDot != null)
                {'url': r.fotoDot, 'descripcion': 'DOT'},
            ],
          });
          break;
        case _Accion.cambiarPosicion:
          if (montaje == null || r.destinoPosicionId == null) break;
          out.add({'rpc': 'tc_cambiar_posicion', 'args': {
            'p_montaje': montaje.id, 'p_posicion_destino': r.destinoPosicionId,
            'p_km': km, 'p_obs': r.observaciones,
          }});
          break;
        case _Accion.reparar:
          if (montaje?.neumatico == null) break;
          out.add({'rpc': 'tc_registrar_reparacion', 'args': {
            'p_neumatico': montaje!.neumatico!.id, 'p_tipo_reparacion': 'pinchazo',
            'p_resultado': 'reparado', 'p_km': km, 'p_obs': r.observaciones,
          }});
          break;
      }
    });
    return out;
  }

  /// Qué le falta al paso de las ruedas para poder seguir. Devuelve el texto
  /// que se le enseña al operario: un botón apagado sin explicación es la
  /// forma más rápida de que alguien acabe apuntándolo en un papel.
  String? get _faltaEnRuedas {
    final pendientes = <String>[];
    _ruedas.forEach((posId, r) {
      final nombre = _posiciones
          .where((p) => p.id == posId)
          .map((p) => p.codigoPosicion)
          .followedBy(const ['?']).first;
      if (r.accion == _Accion.desmontar && _montajes[posId] != null) {
        final falta = <String>[
          if (r.motivo == null) 'la razón',
          if (r.destino == null) 'el destino',
          if (r.fotoSerie == null) 'la foto del número de serie',
        ];
        if (falta.isNotEmpty) pendientes.add('$nombre: falta ${falta.join(', ')}');
      }
      if (r.accion == _Accion.montar && _montajes[posId] == null &&
          r.referenciaId == null) {
        pendientes.add('$nombre: falta elegir el neumático del catálogo');
      }
      if (r.accion == _Accion.cambiarPosicion && r.destinoPosicionId == null) {
        pendientes.add('$nombre: falta a qué posición se mueve');
      }
    });
    return pendientes.isEmpty ? null : pendientes.join('\n');
  }

  List<Map<String, dynamic>> _mediciones() {
    final out = <Map<String, dynamic>>[];
    _ruedas.forEach((posId, r) {
      if (r.profundidad == null && r.presion == null && r.estadoVisual == null) return;
      out.add({
        'posicion_id': posId,
        'neumatico_id': _montajes[posId]?.neumatico?.id,
        'profundidad_mm': r.profundidad,
        'presion_bar': r.presion,
        'estado_visual': r.estadoVisual,
        'observaciones': r.observaciones,
      });
    });
    return out;
  }

  Future<void> _guardar() async {
    if (_vehiculo == null) return;
    setState(() { _trabajando = true; _error = null; _avisos = []; });
    try {
      // Las firmas se suben antes: son ficheros, no caben en la llamada.
      String? urlCliente, urlTecnico;
      if (_firmaCliente != null) {
        urlCliente = await TyreControlApi.subirFirma(
            _firmaCliente!, intervencionId: _clave, quien: 'cliente');
      }
      if (_firmaTecnico != null) {
        urlTecnico = await TyreControlApi.subirFirma(
            _firmaTecnico!, intervencionId: _clave, quien: 'tecnico');
      }

      final r = await TyreControlApi.guardarParteGuiado({
        'clave': _clave,
        'vehiculo_id': _vehiculo!.id,
        'km': num.tryParse(_km.text.trim()),
        'lugar_servicio': _lugar,
        'orden_flota': _ordenFlota.text.trim().isEmpty ? null : _ordenFlota.text.trim(),
        'mediciones': _mediciones(),
        'acciones': _acciones(),
        'servicios': _cantidades.entries
            .map((e) => {'servicio': e.key, 'cantidad': e.value}).toList(),
        'firma_cliente_url': urlCliente,
        'firma_cliente_nombre': _nombreCliente.text.trim(),
        'firma_cliente_dni': _dniCliente.text.trim(),
        'firma_tecnico_url': urlTecnico,
        'firma_tecnico_nombre': _nombreTecnico.text.trim(),
      });

      if (!mounted) return;
      _intervencionId = r['intervencion_id'] as String?;
      _numeroParte = r['numero'] as String?;
      _avisos = ((r['avisos'] as List?) ?? const []).map((e) => e.toString()).toList();

      // El parte ya está escrito. El cierre —resumen, número de parte y foto
      // del stock— lo hace el servidor y es repetible, así que si falla no se
      // bloquea al técnico: el parte no se pierde.
      if (_intervencionId != null) {
        final num_ = await TyreControlApi.cerrarIntervencion(
            _vehiculo!.id, DateTime.now(), intervencionId: _intervencionId);
        if (num_ != null) _numeroParte = num_;
      }

      await OfflineStore.cacheJson(_claveBorrador, null);
      if (mounted) setState(() => _paso = _Paso.hecho);
    } catch (e) {
      if (mounted) {
        setState(() => _error = 'No se ha podido guardar: $e\n\n'
            'No se ha escrito nada a medias: puedes volver a intentarlo y no '
            'se duplicará el parte.');
      }
    } finally {
      if (mounted) setState(() => _trabajando = false);
    }
  }

  Future<void> _abrirPdf() async {
    final id = _intervencionId;
    if (id == null) return;
    setState(() { _trabajando = true; _error = null; });
    try {
      final u = Uri.parse(await TyreControlApi.enlacePdfParte(id));
      if (!await launchUrl(u, mode: LaunchMode.externalApplication)) {
        if (mounted) setState(() => _error = 'No se ha podido abrir el PDF');
      }
    } catch (e) {
      if (mounted) setState(() => _error = 'No se ha podido generar el PDF: $e');
    } finally {
      if (mounted) setState(() => _trabajando = false);
    }
  }

  // ── Pintado ────────────────────────────────────────────────────────────────
  bool get _puedeContinuar {
    switch (_paso) {
      case _Paso.vehiculo:  return _vehiculo != null;
      case _Paso.cabecera:  return num.tryParse(_km.text.trim()) != null;
      // Un parte sin tocar ruedas es válido; uno con una rueda a medias no.
      case _Paso.ruedas:    return _faltaEnRuedas == null;
      case _Paso.servicios: return true;
      case _Paso.firmas:    return true;
      case _Paso.revision:  return true;
      case _Paso.hecho:     return false;
    }
  }

  void _avanzar() {
    final i = _Paso.values.indexOf(_paso);
    if (i < _Paso.values.length - 1) {
      setState(() => _paso = _Paso.values[i + 1]);
      _guardarBorrador();
    }
  }

  void _retroceder() {
    final i = _Paso.values.indexOf(_paso);
    if (i > 0) setState(() => _paso = _Paso.values[i - 1]);
  }

  @override
  Widget build(BuildContext context) {
    final total = _Paso.values.length - 1; // 'hecho' no es un paso que se rellene
    final actual = _Paso.values.indexOf(_paso) + 1;
    return Scaffold(
      appBar: AppBar(
        title: Text(_titulos[_paso] ?? 'Realizar operación'),
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(26),
          child: Column(children: [
            if (_paso != _Paso.hecho)
              Padding(
                padding: const EdgeInsets.only(bottom: 6),
                child: Text('Paso $actual de $total',
                    style: const TextStyle(fontSize: 13, color: AppColors.textSecondary)),
              ),
            LinearProgressIndicator(value: actual / _Paso.values.length, minHeight: 4),
          ]),
        ),
      ),
      body: AbsorbPointer(
        absorbing: _trabajando,
        child: Column(children: [
          if (_trabajando) const LinearProgressIndicator(),
          Expanded(
            child: ListView(padding: const EdgeInsets.all(16), children: [
              if (_error != null)
                Container(
                  margin: const EdgeInsets.only(bottom: 12),
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: AppColors.danger.withValues(alpha: 0.12),
                    border: Border.all(color: AppColors.danger),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Text(_error!, style: const TextStyle(color: AppColors.danger)),
                ),
              ..._contenido(),
              const SizedBox(height: 24),
            ]),
          ),
          if (_paso != _Paso.hecho) _barraInferior(),
        ]),
      ),
    );
  }

  /// Anterior y Continuar SIEMPRE visibles y grandes: el técnico lleva
  /// guantes y la tablet en una mano.
  Widget _barraInferior() {
    final ultimo = _paso == _Paso.revision;
    return SafeArea(
      top: false,
      child: Container(
        padding: const EdgeInsets.all(12),
        decoration: const BoxDecoration(
          color: AppColors.surface,
          border: Border(top: BorderSide(color: AppColors.surfaceVariant)),
        ),
        child: Row(children: [
          if (_paso != _Paso.vehiculo)
            Expanded(
              child: OutlinedButton(
                onPressed: _retroceder,
                style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(52)),
                child: const Text('Anterior', style: TextStyle(fontSize: 16)),
              ),
            ),
          if (_paso != _Paso.vehiculo) const SizedBox(width: 12),
          Expanded(
            flex: 2,
            child: FilledButton(
              onPressed: !_puedeContinuar ? null : (ultimo ? _guardar : _avanzar),
              style: FilledButton.styleFrom(
                minimumSize: const Size.fromHeight(52),
                backgroundColor: ultimo ? AppColors.success : null,
              ),
              child: Text(ultimo ? 'Guardar el parte' : 'Continuar',
                  style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700)),
            ),
          ),
        ]),
      ),
    );
  }

  List<Widget> _contenido() {
    switch (_paso) {
      case _Paso.vehiculo:  return _pasoVehiculo();
      case _Paso.cabecera:  return _pasoCabecera();
      case _Paso.ruedas:    return _pasoRuedas();
      case _Paso.servicios: return _pasoServicios();
      case _Paso.firmas:    return _pasoFirmas();
      case _Paso.revision:  return _pasoRevision();
      case _Paso.hecho:     return _pasoHecho();
    }
  }

  Widget _rotulo(String t) => Padding(
    padding: const EdgeInsets.only(bottom: 6),
    child: Text(t, style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800)),
  );

  List<Widget> _pasoVehiculo() => [
    _rotulo('¿Qué vehículo?'),
    const Text('Escribe la matrícula o hazle una foto.',
        style: TextStyle(color: AppColors.textSecondary)),
    const SizedBox(height: 14),
    Row(children: [
      Expanded(
        child: TextField(
          controller: _matricula,
          textCapitalization: TextCapitalization.characters,
          style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w700, letterSpacing: 2),
          decoration: const InputDecoration(labelText: 'Matrícula', hintText: '1234ABC'),
          onSubmitted: (_) => _buscarMatricula(),
        ),
      ),
      const SizedBox(width: 10),
      SizedBox(
        height: 56, width: 56,
        child: IconButton.filledTonal(
          onPressed: _escanearMatricula,
          icon: const Icon(Icons.photo_camera_outlined),
          tooltip: 'Leer con la cámara',
        ),
      ),
    ]),
    const SizedBox(height: 12),
    FilledButton.icon(
      onPressed: _buscarMatricula,
      style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(52)),
      icon: const Icon(Icons.search),
      label: const Text('Buscar', style: TextStyle(fontSize: 16)),
    ),
    if (_hayIA) ...[
      const SizedBox(height: 10),
      OutlinedButton.icon(
        onPressed: _rellenarConFotos,
        style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(52)),
        icon: const Icon(Icons.auto_awesome),
        label: const Text('Rellenar con fotos', style: TextStyle(fontSize: 16)),
      ),
      const Padding(
        padding: EdgeInsets.only(top: 6),
        child: Text('Matrícula, cuentakilómetros y flancos. Lo que se lea sale '
                    'aquí para que lo confirmes: no se guarda nada solo.',
            style: TextStyle(fontSize: 12, color: AppColors.textSecondary)),
      ),
    ],
    // Los avisos de la lectura van donde se lee, no escondidos al final.
    for (final a in _avisos)
      Padding(
        padding: const EdgeInsets.only(top: 8),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Icon(Icons.warning_amber_rounded, size: 16, color: AppColors.warning),
          const SizedBox(width: 6),
          Expanded(child: Text(a,
              style: const TextStyle(fontSize: 12, color: AppColors.warning))),
        ]),
      ),
    if (_vehiculo != null) ...[
      const SizedBox(height: 20),
      // Ficha resumen para confirmar que es el camión. No se editan datos
      // maestros desde aquí: eso se hace en la ficha del vehículo.
      Card(
        color: AppColors.surface,
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              const Icon(Icons.check_circle, color: AppColors.success),
              const SizedBox(width: 8),
              Text(_vehiculo!.matricula,
                  style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800)),
            ]),
            const SizedBox(height: 8),
            _dato('Cliente', _vehiculo!.empresa?.nombre),
            _dato('Tipo', _vehiculo!.tipo?.nombre),
            _dato('Nº de unidad', _vehiculo!.numeroUnidad),
            _dato('Kilómetros', _vehiculo!.kmActual > 0
                ? _vehiculo!.kmActual.toStringAsFixed(0) : null),
            _dato('Ruedas', '${_posiciones.length} posiciones'),
            if (_vehiculo!.pendienteValidar)
              const Padding(
                padding: EdgeInsets.only(top: 8),
                child: Text('Este vehículo se dio de alta desde una tablet y está '
                            'pendiente de que un administrador lo complete.',
                    style: TextStyle(fontSize: 12, color: AppColors.warning)),
              ),
          ]),
        ),
      ),
    ],
  ];

  Widget _dato(String etiqueta, String? valor) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 3),
    child: Row(children: [
      SizedBox(width: 110,
          child: Text(etiqueta, style: const TextStyle(fontSize: 13, color: AppColors.textSecondary))),
      Expanded(child: Text(valor?.isNotEmpty == true ? valor! : '—',
          style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600))),
    ]),
  );

  List<Widget> _pasoCabecera() => [
    _rotulo('Kilómetros'),
    TextField(
      controller: _km,
      keyboardType: const TextInputType.numberWithOptions(decimal: false),
      inputFormatters: [FilteringTextInputFormatter.digitsOnly],
      style: const TextStyle(fontSize: 26, fontWeight: FontWeight.w700),
      decoration: const InputDecoration(suffixText: 'km'),
      onChanged: (_) => setState(() {}),
    ),
    const SizedBox(height: 24),
    _rotulo('¿Dónde se hace?'),
    // Botones grandes en vez de un desplegable: son tres opciones y el dedo
    // con guante no acierta en una lista.
    Row(children: [
      for (final l in const [
        ('taller', 'Taller', Icons.home_repair_service_outlined),
        ('flota', 'En la flota', Icons.business_outlined),
        ('carretera', 'Carretera', Icons.emergency_outlined),
      ])
        Expanded(
          child: Padding(
            padding: const EdgeInsets.only(right: 8),
            child: OutlinedButton(
              onPressed: () => setState(() => _lugar = l.$1),
              style: OutlinedButton.styleFrom(
                minimumSize: const Size.fromHeight(84),
                backgroundColor: _lugar == l.$1
                    ? AppColors.primary.withValues(alpha: 0.18) : null,
                side: BorderSide(
                    color: _lugar == l.$1 ? AppColors.primary : AppColors.surfaceVariant,
                    width: _lugar == l.$1 ? 2 : 1),
              ),
              child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
                Icon(l.$3, size: 26),
                const SizedBox(height: 6),
                Text(l.$2, style: const TextStyle(fontSize: 13), textAlign: TextAlign.center),
              ]),
            ),
          ),
        ),
    ]),
    const SizedBox(height: 24),
    _rotulo('Orden de flota'),
    TextField(
      controller: _ordenFlota,
      decoration: const InputDecoration(hintText: 'Opcional'),
    ),
  ];

  List<Widget> _pasoRuedas() {
    final activa = _posicionActiva;
    return [
      _rotulo('Toca una rueda'),
      const Text('Apunta lo que midas y lo que le hagas. Las que ya has tocado '
                 'quedan marcadas.',
          style: TextStyle(color: AppColors.textSecondary)),
      const SizedBox(height: 12),
      if (_imagenChasis != null && _imagenChasis!.isNotEmpty)
        SizedBox(
          height: 320,
          child: VehicleLayoutImage(
            imagenUrl: _imagenChasis!,
            posiciones: _posiciones,
            montajePorPosicion: _montajes,
            detalles: const {},
            estados: {
              for (final p in _posiciones)
                p.id: p.id == activa
                    ? TireStatus.seleccionado
                    : (_ruedas[p.id]?.tocada ?? false)
                        ? TireStatus.revisado
                        : TireStatus.pendiente,
            },
            valores: {
              for (final e in _ruedas.entries)
                e.key: (prof: e.value.profundidad, pres: e.value.presion),
            },
            seleccionadaId: activa,
            liveProf: null,
            livePres: null,
            onTap: (p) => setState(() => _posicionActiva = p.id),
          ),
        )
      else
        // Sin plano calibrado no se deja al operario sin pantalla: lista.
        Wrap(spacing: 8, runSpacing: 8, children: [
          for (final p in _posiciones)
            ChoiceChip(
              label: Text(p.codigoPosicion),
              selected: p.id == activa,
              onSelected: (_) => setState(() => _posicionActiva = p.id),
              backgroundColor: (_ruedas[p.id]?.tocada ?? false)
                  ? AppColors.success.withValues(alpha: 0.2) : null,
            ),
        ]),
      const SizedBox(height: 16),
      if (activa == null)
        const Text('Elige una rueda para empezar.',
            style: TextStyle(color: AppColors.textHint))
      else
        _fichaRueda(activa),
      if (_faltaEnRuedas != null) ...[
        const SizedBox(height: 14),
        Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: AppColors.warning.withValues(alpha: 0.12),
            borderRadius: BorderRadius.circular(10),
            border: Border.all(color: AppColors.warning.withValues(alpha: 0.5)),
          ),
          child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            const Icon(Icons.info_outline, size: 18, color: AppColors.warning),
            const SizedBox(width: 8),
            Expanded(
              child: Text('Para seguir falta:\n$_faltaEnRuedas',
                  style: const TextStyle(fontSize: 13, color: AppColors.warning)),
            ),
          ]),
        ),
      ],
    ];
  }

  Widget _fichaRueda(String posId) {
    final r = _ruedas.putIfAbsent(posId, () => _Rueda());
    final pos = _posiciones.firstWhere((p) => p.id == posId);
    final montaje = _montajes[posId];
    final neu = montaje?.neumatico;

    return Card(
      color: AppColors.surface,
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(pos.codigoPosicion,
              style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
          const SizedBox(height: 2),
          Text(neu == null
                  ? 'Posición vacía'
                  : [neu.marca, neu.modelo, neu.medida]
                      .whereType<String>().where((x) => x.isNotEmpty).join(' · '),
              style: const TextStyle(fontSize: 13, color: AppColors.textSecondary)),
          const SizedBox(height: 14),

          _numero('Profundidad', 'mm', r.profundidad,
              (v) => setState(() => r.profundidad = v),
              sugeridos: const [3, 5, 7, 9, 11, 13]),
          const SizedBox(height: 12),
          _numero('Presión', 'bar', r.presion,
              (v) => setState(() => r.presion = v),
              sugeridos: const [7, 7.5, 8, 8.5, 9]),

          const SizedBox(height: 18),
          const Text('¿Qué se le hace?',
              style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700)),
          const SizedBox(height: 8),
          Wrap(spacing: 8, runSpacing: 8, children: [
            for (final a in _accionesPara(hayNeumatico: neu != null))
              ChoiceChip(
                label: Text(_accionTexto[a]!),
                selected: r.accion == a,
                onSelected: (_) => setState(() => r.accion = a),
              ),
          ]),

          // ── Montar en un hueco vacío ──
          if (r.accion == _Accion.montar) ...[
            const SizedBox(height: 12),
            OutlinedButton.icon(
              onPressed: () async {
                final ref = await showModalBottomSheet<Map<String, dynamic>>(
                  context: context,
                  isScrollControlled: true,
                  backgroundColor: AppColors.surface,
                  builder: (_) => _ElegirReferencia(referencias: _catReferencias),
                );
                if (ref == null) return;
                setState(() {
                  r.referenciaId = ref['id'] as String?;
                  r.referenciaTexto = [ref['marca'], ref['modelo'], ref['medida']]
                      .whereType<String>().where((x) => x.isNotEmpty).join(' · ');
                });
                _guardarBorrador();
              },
              style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(52)),
              icon: const Icon(Icons.search),
              label: Text(r.referenciaTexto ?? 'Elegir del catálogo'),
            ),
            const SizedBox(height: 10),
            Wrap(spacing: 8, children: [
              for (final c in const ['nuevo', 'usado'])
                ChoiceChip(
                  label: Text(c == 'nuevo' ? 'Nuevo' : 'Usado'),
                  selected: r.condicion == c,
                  onSelected: (_) => setState(() => r.condicion = c),
                ),
            ]),
            if (r.condicion == 'usado')
              const Padding(
                padding: EdgeInsets.only(top: 6),
                child: Text('De un usado hace falta la profundidad de arriba: es '
                            'la que se guarda como mm reales.',
                    style: TextStyle(fontSize: 12, color: AppColors.textSecondary)),
              ),
          ],

          if (r.accion == _Accion.cambiarPosicion) ...[
            const SizedBox(height: 12),
            DropdownButtonFormField<String>(
              initialValue: r.destinoPosicionId,
              decoration: const InputDecoration(labelText: '¿A qué posición?'),
              items: [
                for (final p in _posiciones)
                  if (p.id != posId && _montajes[p.id] == null)
                    DropdownMenuItem(value: p.id, child: Text(p.codigoPosicion)),
              ],
              onChanged: (v) => setState(() => r.destinoPosicionId = v),
            ),
          ],

          // ── Desmontar: razón, destino y las fotos ──
          if (r.accion == _Accion.desmontar) ...[
            const SizedBox(height: 12),
            _catalogo(
              etiqueta: 'Razón de sustitución',
              valor: r.motivo,
              opciones: _catMotivos,
              onChanged: (v) { setState(() => r.motivo = v); _guardarBorrador(); },
            ),
            const SizedBox(height: 12),
            _catalogo(
              etiqueta: 'Destino del neumático',
              valor: r.destino,
              opciones: _catDestinos,
              onChanged: (v) { setState(() => r.destino = v); _guardarBorrador(); },
            ),
            const SizedBox(height: 16),
            const Text('Fotos del neumático que sale',
                style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700)),
            const SizedBox(height: 2),
            const Text('La del número de serie es obligatoria: es lo que ata la '
                       'goma que sale a su ficha. Las otras dos, si dan tiempo.',
                style: TextStyle(fontSize: 12, color: AppColors.textSecondary)),
            const SizedBox(height: 8),
            _foto('Nº de serie', r.fotoSerie, obligatoria: true,
                onHecha: (u) => r.fotoSerie = u),
            const SizedBox(height: 8),
            _foto('Neumático', r.fotoNeumatico, obligatoria: false,
                onHecha: (u) => r.fotoNeumatico = u),
            const SizedBox(height: 8),
            _foto('DOT', r.fotoDot, obligatoria: false,
                onHecha: (u) => r.fotoDot = u),
          ],

          const SizedBox(height: 12),
          TextFormField(
            initialValue: r.observaciones,
            decoration: const InputDecoration(labelText: 'Observaciones', isDense: true),
            onChanged: (v) => r.observaciones = v,
          ),
          const SizedBox(height: 12),
          FilledButton.tonal(
            onPressed: () { _guardarBorrador(); setState(() => _posicionActiva = null); },
            style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(48)),
            child: const Text('Hecho con esta rueda'),
          ),
        ]),
      ),
    );
  }

  /// Un desplegable alimentado por un CATÁLOGO de la base de datos. Si el
  /// catálogo no ha llegado (primera vez sin red) se dice, en vez de enseñar
  /// un desplegable vacío que parece roto.
  Widget _catalogo({
    required String etiqueta,
    required String? valor,
    required List<Map<String, dynamic>> opciones,
    required void Function(String?) onChanged,
  }) {
    if (opciones.isEmpty) {
      return Text('No se ha podido cargar «$etiqueta». Conecta una vez a la red '
                  'y la lista queda guardada en la tablet.',
          style: const TextStyle(fontSize: 12, color: AppColors.warning));
    }
    final codigos = opciones.map((o) => o['codigo'] as String?).toSet();
    return DropdownButtonFormField<String>(
      initialValue: codigos.contains(valor) ? valor : null,
      isExpanded: true,
      decoration: InputDecoration(labelText: etiqueta, isDense: true),
      items: [
        for (final o in opciones)
          DropdownMenuItem(
            value: o['codigo'] as String?,
            child: Text((o['nombre'] ?? o['codigo'] ?? '') as String,
                overflow: TextOverflow.ellipsis),
          ),
      ],
      onChanged: onChanged,
    );
  }

  /// Una foto: el botón, y cuando ya está hecha, que se vea que está hecha y
  /// se pueda repetir. Con guantes y a contraluz, la primera sale movida más
  /// veces de las que parece.
  Widget _foto(String etiqueta, String? url,
      {required bool obligatoria, required void Function(String?) onHecha}) {
    final hecha = url != null;
    return Row(children: [
      Icon(hecha ? Icons.check_circle : Icons.photo_camera_outlined,
          color: hecha
              ? AppColors.success
              : (obligatoria ? AppColors.warning : AppColors.textSecondary)),
      const SizedBox(width: 10),
      Expanded(
        child: Text(obligatoria && !hecha ? '$etiqueta (obligatoria)' : etiqueta,
            style: const TextStyle(fontSize: 14)),
      ),
      TextButton(
        onPressed: _trabajando
            ? null
            : () async {
                final u = await _hacerFoto();
                if (u == null) return;
                setState(() => onHecha(u));
                _guardarBorrador();
              },
        child: Text(hecha ? 'Repetir' : 'Hacer foto'),
      ),
      if (hecha)
        IconButton(
          tooltip: 'Quitar la foto',
          onPressed: () { setState(() => onHecha(null)); _guardarBorrador(); },
          icon: const Icon(Icons.close, size: 18),
        ),
    ]);
  }

  /// Un número con teclado numérico Y botones de los valores de siempre. En el
  /// arcén, tocar "8,5" es más rápido y falla menos que teclearlo.
  Widget _numero(String etiqueta, String unidad, double? valor,
      void Function(double?) onChanged, {required List<double> sugeridos}) {
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Text('$etiqueta ($unidad)',
          style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700)),
      const SizedBox(height: 6),
      Row(children: [
        SizedBox(
          width: 110,
          child: TextFormField(
            initialValue: valor?.toString() ?? '',
            key: ValueKey('$etiqueta-$_posicionActiva'),
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w700),
            decoration: InputDecoration(isDense: true, suffixText: unidad),
            onChanged: (v) => onChanged(double.tryParse(v.replaceAll(',', '.'))),
          ),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: Wrap(spacing: 6, children: [
            for (final s in sugeridos)
              ActionChip(
                label: Text(s.toString().replaceAll('.', ',')),
                onPressed: () => onChanged(s),
                backgroundColor: valor == s
                    ? AppColors.primary.withValues(alpha: 0.25) : null,
              ),
          ]),
        ),
      ]),
    ]);
  }

  List<Widget> _pasoServicios() => [
    _rotulo('¿Qué se factura?'),
    const Text('Deja en blanco lo que no se haya hecho.',
        style: TextStyle(color: AppColors.textSecondary)),
    const SizedBox(height: 12),
    if (_catServicios.isEmpty)
      const Text('No se ha podido cargar la lista de servicios. Se puede seguir sin ella.',
          style: TextStyle(color: AppColors.warning)),
    for (final s in _catServicios)
      Padding(
        padding: const EdgeInsets.only(bottom: 10),
        child: Row(children: [
          Expanded(child: Text((s['nombre'] ?? '') as String? ?? '',
              style: const TextStyle(fontSize: 15))),
          SizedBox(
            width: 96,
            child: TextFormField(
              initialValue: _cantidades[s['codigo']]?.toString() ?? '',
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              textAlign: TextAlign.right,
              style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700),
              decoration: InputDecoration(
                  isDense: true, suffixText: (s['unidad'] ?? '') as String? ?? ''),
              onChanged: (v) {
                final n = num.tryParse(v.replaceAll(',', '.'));
                setState(() {
                  if (n == null || n <= 0) {
                    _cantidades.remove(s['codigo']);
                  } else {
                    _cantidades[s['codigo'] as String] = n;
                  }
                });
              },
            ),
          ),
        ]),
      ),
  ];

  List<Widget> _pasoFirmas() => [
    _rotulo('El cliente'),
    TextField(controller: _nombreCliente,
        decoration: const InputDecoration(labelText: 'Nombre')),
    TextField(controller: _dniCliente,
        decoration: const InputDecoration(labelText: 'DNI')),
    const SizedBox(height: 12),
    FirmaPad(titulo: 'Firma del cliente', onFirma: (b) => _firmaCliente = b),
    const SizedBox(height: 26),
    _rotulo('El técnico'),
    TextField(controller: _nombreTecnico,
        decoration: const InputDecoration(labelText: 'Nombre')),
    const SizedBox(height: 12),
    FirmaPad(titulo: 'Firma del técnico', onFirma: (b) => _firmaTecnico = b),
  ];

  List<Widget> _pasoRevision() {
    final tocadas = _ruedas.entries.where((e) => e.value.tocada).toList();
    Widget bloque(String titulo, _Paso destino, List<Widget> hijos) => Card(
      color: AppColors.surface,
      margin: const EdgeInsets.only(bottom: 10),
      child: InkWell(
        // Cada apartado vuelve a su paso: repasar sin poder corregir no sirve.
        onTap: () => setState(() => _paso = destino),
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              Expanded(child: Text(titulo,
                  style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w800))),
              const Icon(Icons.edit_outlined, size: 18, color: AppColors.textHint),
            ]),
            const SizedBox(height: 8),
            ...hijos,
          ]),
        ),
      ),
    );

    return [
      _rotulo('Repasa antes de guardar'),
      const Text('Toca cualquier apartado para corregirlo.',
          style: TextStyle(color: AppColors.textSecondary)),
      const SizedBox(height: 12),
      bloque('Vehículo', _Paso.vehiculo, [
        _dato('Matrícula', _vehiculo?.matricula),
        _dato('Cliente', _vehiculo?.empresa?.nombre),
      ]),
      bloque('Servicio', _Paso.cabecera, [
        _dato('Kilómetros', _km.text),
        _dato('Lugar', _lugar),
        _dato('Orden', _ordenFlota.text),
      ]),
      bloque('Ruedas', _Paso.ruedas, [
        if (tocadas.isEmpty)
          const Text('Ninguna rueda tocada', style: TextStyle(color: AppColors.textHint))
        else
          for (final e in tocadas)
            _dato(
              _posiciones.firstWhere((p) => p.id == e.key).codigoPosicion,
              [
                if (e.value.profundidad != null) '${e.value.profundidad} mm',
                if (e.value.presion != null) '${e.value.presion} bar',
                if (e.value.accion != _Accion.ninguna) _accionTexto[e.value.accion],
              ].whereType<String>().join(' · '),
            ),
      ]),
      bloque('Servicios', _Paso.servicios, [
        if (_cantidades.isEmpty)
          const Text('Ninguno', style: TextStyle(color: AppColors.textHint))
        else
          for (final e in _cantidades.entries)
            _dato(
              (_catServicios.firstWhere((s) => s['codigo'] == e.key,
                  orElse: () => {'nombre': e.key})['nombre'] as String?) ?? e.key,
              e.value.toString(),
            ),
      ]),
      bloque('Firmas', _Paso.firmas, [
        _dato('Cliente', _nombreCliente.text),
        _dato('Firmado', _firmaCliente != null ? 'Sí' : 'No'),
        _dato('Técnico', _nombreTecnico.text),
      ]),
      const SizedBox(height: 8),
      const Text('Al guardar se escribe todo de una vez. Si algo falla, no se '
                 'queda nada a medias y puedes reintentarlo sin duplicar el parte.',
          style: TextStyle(fontSize: 12, color: AppColors.textSecondary)),
    ];
  }

  List<Widget> _pasoHecho() => [
    const SizedBox(height: 24),
    const Icon(Icons.check_circle_outline, size: 64, color: AppColors.success),
    const SizedBox(height: 12),
    Center(child: Text(_numeroParte ?? 'Parte guardado',
        style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800))),
    const SizedBox(height: 6),
    const Center(child: Text('El parte está guardado en Mobilink.',
        style: TextStyle(color: AppColors.textSecondary))),
    for (final a in _avisos)
      Padding(
        padding: const EdgeInsets.only(top: 12),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Icon(Icons.warning_amber_rounded, size: 18, color: AppColors.warning),
          const SizedBox(width: 6),
          Expanded(child: Text(a, style: const TextStyle(color: AppColors.warning))),
        ]),
      ),
    const SizedBox(height: 26),
    if (_intervencionId != null)
      FilledButton.icon(
        onPressed: _abrirPdf,
        style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(52)),
        icon: const Icon(Icons.picture_as_pdf_outlined),
        label: const Text('Ver el PDF', style: TextStyle(fontSize: 16)),
      ),
    const SizedBox(height: 10),
    OutlinedButton(
      onPressed: () => Navigator.of(context).pop(true),
      style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(52)),
      child: const Text('Terminar', style: TextStyle(fontSize: 16)),
    ),
  ];
}

// ══════════════════════════════════════════════════════════════════════════
/// Alta rápida cuando la matrícula no está fichada.
///
/// Cuatro preguntas y a seguir. Marca, modelo, delegación y llanta NO se
/// preguntan: son nulables y las completa un administrador desde el panel.
/// Pedírselas al operario en el arcén es la forma de que abandone y lo apunte
/// en papel, que es lo que hace hoy.
class _AltaVehiculo extends StatefulWidget {
  final String matricula;
  const _AltaVehiculo({required this.matricula});

  @override
  State<_AltaVehiculo> createState() => _AltaVehiculoState();
}

class _AltaVehiculoState extends State<_AltaVehiculo> {
  List<Map<String, dynamic>> _tipos = [];
  List<Map<String, dynamic>> _empresas = [];
  List<Map<String, dynamic>> _medidas = [];
  String? _empresaId;
  String? _tipoId;
  String? _medidaId;
  /// La medida de cada eje, cuando no todos llevan la misma. La clave es el
  /// número de eje (1, 2, 3…), que es como lo guarda tc_vehiculo_ejes.
  final Map<int, String> _medidaEje = {};
  bool _porEje = false;
  final _numeroUnidad = TextEditingController();
  bool _cargando = true;
  bool _guardando = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _cargar();
  }

  @override
  void dispose() { _numeroUnidad.dispose(); super.dispose(); }

  /// Cuántos ejes tiene el tipo elegido. Sale del propio tipo (numero_ejes);
  /// si no lo trae, se deduce de la configuración («2x2x4» son tres ejes).
  int get _numeroEjes {
    final t = _tipos.where((t) => t['id'] == _tipoId);
    if (t.isEmpty) return 0;
    final n = t.first['numero_ejes'];
    if (n is int && n > 0) return n;
    final cfg = (t.first['configuracion_ejes'] ?? '') as String? ?? '';
    final trozos = cfg.split(RegExp(r'[xX]')).where((c) => c.trim().isNotEmpty);
    return trozos.isEmpty ? 0 : trozos.length;
  }

  Future<void> _cargar() async {
    try {
      final r = await Future.wait([
        TyreControlApi.tiposVehiculoParaAlta(),
        TyreControlApi.empresasDelOperario(),
        TyreControlApi.listarMedidasVehiculo(),
      ]);
      if (!mounted) return;
      setState(() {
        _tipos = r[0];
        _empresas = r[1];
        _medidas = r[2];
        // Con una sola empresa no se pregunta.
        if (_empresas.length == 1) _empresaId = _empresas.first['id'] as String;
        _cargando = false;
      });
    } catch (e) {
      if (mounted) setState(() { _error = 'No se ha podido cargar: $e'; _cargando = false; });
    }
  }

  Future<void> _crear() async {
    if (_empresaId == null || _tipoId == null) return;
    setState(() { _guardando = true; _error = null; });
    try {
      final r = await TyreControlApi.altaVehiculoDesdeParte(
        empresaId: _empresaId!,
        matricula: widget.matricula,
        tipoVehiculoId: _tipoId!,
        // Con medidas por eje, la del vehículo es la del primero: es la que
        // sale en los listados, y dejarla vacía haría parecer que no se sabe.
        medidaId: _porEje ? (_medidaEje[1] ?? _medidaId) : _medidaId,
        ejes: _porEje
            ? [for (final e in _medidaEje.entries)
                {'eje': e.key, 'medida_id': e.value}]
            : null,
        numeroUnidad: _numeroUnidad.text.trim().isEmpty ? null : _numeroUnidad.text.trim(),
      );
      final id = r['vehiculo_id'] as String?;
      if (id == null) throw Exception('El servidor no ha devuelto el vehículo');
      final v = await TyreControlApi.obtenerVehiculo(id);
      if (!mounted) return;
      Navigator.pop(context, v);
    } catch (e) {
      if (mounted) setState(() => _error = '$e');
    } finally {
      if (mounted) setState(() => _guardando = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(
        left: 16, right: 16, top: 16,
        bottom: MediaQuery.of(context).viewInsets.bottom + 16,
      ),
      child: SingleChildScrollView(
        child: Column(mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Text('Este vehículo todavía no está en TyreControl',
              style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
          const SizedBox(height: 4),
          Text('Cuatro preguntas y seguimos con el parte. La marca y el modelo '
               'los completa un administrador después.',
              style: const TextStyle(fontSize: 13, color: AppColors.textSecondary)),
          const SizedBox(height: 16),
          Text(widget.matricula,
              style: const TextStyle(fontSize: 26, fontWeight: FontWeight.w800, letterSpacing: 2)),
          const SizedBox(height: 16),

          if (_cargando) const Center(child: CircularProgressIndicator()) else ...[
            if (_empresas.length > 1) ...[
              const Text('¿De qué flota es?', style: TextStyle(fontWeight: FontWeight.w700)),
              const SizedBox(height: 6),
              DropdownButtonFormField<String>(
                initialValue: _empresaId,
                items: [for (final e in _empresas)
                  DropdownMenuItem(value: e['id'] as String,
                      child: Text((e['nombre'] ?? '') as String? ?? ''))],
                onChanged: (v) => setState(() => _empresaId = v),
              ),
              const SizedBox(height: 16),
            ],

            const Text('¿Cómo son los ejes?', style: TextStyle(fontWeight: FontWeight.w700)),
            const SizedBox(height: 2),
            const Text('El operario reconoce el camión de un vistazo; «2x2x4» no '
                       'lo dice nadie en un taller.',
                style: TextStyle(fontSize: 12, color: AppColors.textSecondary)),
            const SizedBox(height: 8),
            if (_tipos.isEmpty)
              const Text('No hay ningún tipo de vehículo con posiciones generadas. '
                         'Tiene que crearlo un administrador desde el panel.',
                  style: TextStyle(color: AppColors.warning))
            else
              // Con su dibujo cuando lo hay: es lo que de verdad se reconoce.
              Column(children: [
                for (final t in _tipos)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 8),
                    child: InkWell(
                      onTap: () => setState(() {
                        _tipoId = t['id'] as String;
                        // Otro tipo, otros ejes: lo elegido para ejes que ya no
                        // existen se cae, en vez de viajar de tapadillo.
                        _medidaEje.removeWhere((e, _) => e > _numeroEjes);
                      }),
                      child: Container(
                        padding: const EdgeInsets.all(10),
                        decoration: BoxDecoration(
                          border: Border.all(
                              color: _tipoId == t['id']
                                  ? AppColors.primary : AppColors.surfaceVariant,
                              width: _tipoId == t['id'] ? 2 : 1),
                          borderRadius: BorderRadius.circular(10),
                        ),
                        child: Row(children: [
                          if ((t['imagen_chasis_url'] as String?)?.isNotEmpty == true)
                            Padding(
                              padding: const EdgeInsets.only(right: 12),
                              child: Image.network(t['imagen_chasis_url'] as String,
                                  width: 92, height: 52, fit: BoxFit.contain,
                                  errorBuilder: (_, __, ___) => const SizedBox(width: 92)),
                            ),
                          Expanded(
                            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                              Text((t['nombre'] ?? '') as String? ?? '',
                                  style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700)),
                              Text([
                                if (t['configuracion_ejes'] != null) '${t['configuracion_ejes']}',
                                if (t['numero_ruedas'] != null) '${t['numero_ruedas']} ruedas',
                              ].join(' · '),
                                  style: const TextStyle(fontSize: 12, color: AppColors.textSecondary)),
                            ]),
                          ),
                          if (_tipoId == t['id'])
                            const Icon(Icons.check_circle, color: AppColors.primary),
                        ]),
                      ),
                    ),
                  ),
              ]),
            const SizedBox(height: 16),

            const Text('¿Qué medida lleva?', style: TextStyle(fontWeight: FontWeight.w700)),
            const SizedBox(height: 6),
            // Lo normal es que todos los ejes lleven la misma; el caso raro
            // —una tractora con la directriz distinta— se pide aparte en vez
            // de obligar a rellenar cuatro desplegables siempre.
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              dense: true,
              value: _porEje,
              onChanged: _numeroEjes == 0
                  ? null
                  : (v) => setState(() {
                        _porEje = v;
                        if (v && _medidaId != null) {
                          // Al abrirlo, lo ya elegido se propone en el primer eje.
                          _medidaEje.putIfAbsent(1, () => _medidaId!);
                        }
                      }),
              title: const Text('Cada eje lleva una medida distinta',
                  style: TextStyle(fontSize: 14)),
            ),
            if (!_porEje)
              DropdownButtonFormField<String>(
                initialValue: _medidaId,
                isExpanded: true,
                decoration: const InputDecoration(hintText: 'Opcional'),
                items: [for (final m in _medidas)
                  DropdownMenuItem(value: m['id'] as String,
                      child: Text((m['valor'] ?? '') as String? ?? ''))],
                onChanged: (v) => setState(() => _medidaId = v),
              )
            else ...[
              for (int eje = 1; eje <= _numeroEjes; eje++) ...[
                Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: DropdownButtonFormField<String>(
                    initialValue: _medidaEje[eje],
                    isExpanded: true,
                    decoration: InputDecoration(
                        labelText: 'Eje $eje', isDense: true),
                    items: [for (final m in _medidas)
                      DropdownMenuItem(value: m['id'] as String,
                          child: Text((m['valor'] ?? '') as String? ?? '',
                              overflow: TextOverflow.ellipsis))],
                    onChanged: (v) => setState(() {
                      if (v == null) { _medidaEje.remove(eje); } else { _medidaEje[eje] = v; }
                    }),
                  ),
                ),
              ],
              if (_numeroEjes > 1)
                OutlinedButton.icon(
                  onPressed: _medidaEje[1] == null
                      ? null
                      : () => setState(() {
                            for (int e = 2; e <= _numeroEjes; e++) {
                              _medidaEje[e] = _medidaEje[1]!;
                            }
                          }),
                  icon: const Icon(Icons.content_copy, size: 18),
                  label: const Text('Copiar la del eje 1 a todos'),
                ),
            ],
            const SizedBox(height: 16),
            TextField(controller: _numeroUnidad,
                decoration: const InputDecoration(labelText: 'Nº de unidad (opcional)')),
          ],

          if (_error != null) ...[
            const SizedBox(height: 12),
            Text(_error!, style: const TextStyle(color: AppColors.danger)),
          ],
          const SizedBox(height: 20),
          FilledButton(
            onPressed: (_guardando || _empresaId == null || _tipoId == null) ? null : _crear,
            style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(52)),
            child: Text(_guardando ? 'Dando de alta…' : 'Dar de alta y seguir',
                style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
          ),
          TextButton(onPressed: () => Navigator.pop(context),
              child: const Text('Cancelar')),
        ]),
      ),
    );
  }
}

/// Elegir un neumático del CATÁLOGO para montarlo en una posición vacía.
///
/// Es el catálogo que ya existe (tc_referencias_neumatico), el mismo que ve el
/// panel. Aquí no se da de alta nada: si la referencia no está, la da de alta
/// la pantalla de montaje de siempre, que ya sabe hacerlo (provisional y
/// pendiente de validar). Duplicar eso aquí sería un segundo catálogo.
class _ElegirReferencia extends StatefulWidget {
  final List<Map<String, dynamic>> referencias;
  const _ElegirReferencia({required this.referencias});

  @override
  State<_ElegirReferencia> createState() => _ElegirReferenciaState();
}

class _ElegirReferenciaState extends State<_ElegirReferencia> {
  final _busca = TextEditingController();

  @override
  void dispose() { _busca.dispose(); super.dispose(); }

  List<Map<String, dynamic>> get _filtradas {
    final q = _busca.text.trim().toLowerCase();
    final todas = widget.referencias;
    if (q.isEmpty) return todas.take(60).toList();
    final palabras = q.split(RegExp(r'\s+'));
    return todas.where((r) {
      final texto = [r['marca'], r['modelo'], r['medida']]
          .whereType<String>().join(' ').toLowerCase();
      return palabras.every(texto.contains);
    }).take(60).toList();
  }

  @override
  Widget build(BuildContext context) {
    final lista = _filtradas;
    return Padding(
      padding: EdgeInsets.only(
        left: 16, right: 16, top: 16,
        bottom: MediaQuery.of(context).viewInsets.bottom + 16,
      ),
      child: SizedBox(
        height: MediaQuery.of(context).size.height * 0.75,
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Text('¿Qué neumático se monta?',
              style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
          const SizedBox(height: 10),
          TextField(
            controller: _busca,
            autofocus: true,
            decoration: const InputDecoration(
              prefixIcon: Icon(Icons.search),
              hintText: 'Marca, modelo o medida',
            ),
            onChanged: (_) => setState(() {}),
          ),
          const SizedBox(height: 10),
          if (widget.referencias.isEmpty)
            const Text('El catálogo no se ha podido cargar. Conecta una vez a la '
                       'red y queda guardado en la tablet.',
                style: TextStyle(color: AppColors.warning))
          else if (lista.isEmpty)
            const Text('Nada con esa búsqueda.',
                style: TextStyle(color: AppColors.textHint)),
          Expanded(
            child: ListView.separated(
              itemCount: lista.length,
              separatorBuilder: (_, __) => const Divider(height: 1),
              itemBuilder: (_, i) {
                final r = lista[i];
                final medida = (r['medida'] ?? '') as String? ?? '';
                final idx = [r['indice_carga'], r['codigo_vel']]
                    .where((x) => x != null && '$x'.isNotEmpty).join('');
                return ListTile(
                  contentPadding: EdgeInsets.zero,
                  title: Text([r['marca'], r['modelo']]
                      .whereType<String>().where((x) => x.isNotEmpty).join(' ')),
                  subtitle: Text([medida, idx].where((x) => x.isNotEmpty).join(' · ')),
                  onTap: () => Navigator.pop(context, r),
                );
              },
            ),
          ),
          TextButton(onPressed: () => Navigator.pop(context),
              child: const Text('Cancelar')),
        ]),
      ),
    );
  }
}
