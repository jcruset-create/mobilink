import 'dart:async';
import 'dart:typed_data';
import 'package:flutter/material.dart';
import '../services/fotos.dart';
import '../models/models.dart';
import '../services/ocr_service.dart';
import '../services/offline_store.dart';
import '../services/supabase_service.dart';
import '../theme/app_theme.dart';
import '../services/matricula.dart';
import 'alta_desde_revision_screen.dart';
import 'cambio_neumatico_screen.dart';
import 'confirm_vehicle_screen.dart';

/// Qué se va a hacer con el vehículo una vez identificado.
enum DestinoVehiculo { revision, operaciones }

/// Pantalla 3: identificar vehiculo. Cuatro metodos, priorizando el
/// mas rapido (foto) sin esconder los demas.
class IdentifyVehicleScreen extends StatefulWidget {
  /// A dónde se va tras elegir el vehículo.
  ///
  /// `revision` (lo de siempre) pasa por la pantalla de confirmación, donde se
  /// piden kilómetros y si se verifican presiones. `operaciones` entra directo
  /// a Cambios: no hay nada que preguntar antes, y abrir esa pantalla no
  /// escribe nada — solo Finalizar guarda —, así que equivocarse de camión y
  /// salir no deja rastro.
  final DestinoVehiculo destino;

  const IdentifyVehicleScreen({super.key, this.destino = DestinoVehiculo.revision});

  @override
  State<IdentifyVehicleScreen> createState() => _IdentifyVehicleScreenState();
}

class _IdentifyVehicleScreenState extends State<IdentifyVehicleScreen> {
  final _searchController = TextEditingController();
  List<Vehiculo> _resultados = [];
  Timer? _debounce;
  bool _buscando = false;
  bool _escaneando = false;
  String? _error;
  /// Fotos de matrícula que no han servido (no se leyó, o el técnico dijo que
  /// no era la del camión). Al llegar a [fotosFallidasParaTeclear] se deja dar
  /// de alta con la matrícula escrita.
  int _fotosFallidas = 0;
  /// La última foto leída que no encontró un vehículo exacto: con ella se
  /// ofrece el alta.
  LecturaMatricula? _lectura;
  Uint8List? _fotoBytes;

  /// El alta solo desde «Nueva revisión»: Operaciones trabaja sobre vehículos
  /// que ya existen.
  bool get _puedeDarDeAlta => widget.destino == DestinoVehiculo.revision;

  @override
  void dispose() {
    _searchController.dispose();
    _debounce?.cancel();
    super.dispose();
  }

  void _onSearchChanged(String value) {
    _debounce?.cancel();
    if (_lectura != null && normalizarMatricula(value) != _lectura!.matricula) {
      setState(() => _lectura = null);
    }
    _debounce = Timer(const Duration(milliseconds: 300), () => _buscar(value));
  }

  Future<void> _buscar(String texto) async {
    if (texto.trim().length < 2) {
      setState(() => _resultados = []);
      return;
    }
    setState(() => _buscando = true);
    try {
      final res = await TyreControlApi.buscarVehiculos(texto);
      if (!mounted) return;
      setState(() => _resultados = res);
    } catch (e) {
      if (mounted) setState(() => _error = 'Sin conexión: busca por matrícula exacta o elige un vehículo reciente');
    } finally {
      if (mounted) setState(() => _buscando = false);
    }
  }

  Future<void> _escanearMatricula() async {
    final foto = await elegirFoto(context);
    if (foto == null) return;
    setState(() {
      _escaneando = true;
      _error = null;
      _lectura = null;
    });
    try {
      final bytes = await foto.readAsBytes();
      final lectura = await OcrService.leerMatricula(foto);
      final plate = lectura.matricula;
      if (plate == null) {
        _fotosFallidas++;
        setState(() => _error = 'No se ha podido leer la matrícula. Prueba de nuevo o escríbela a mano.');
        return;
      }
      final res = await TyreControlApi.buscarVehiculos(plate);
      final exactos = res.where((v) => normalizarMatricula(v.matricula) == plate).toList();
      if (exactos.length == 1) {
        _irAConfirmar(exactos.first);
        return;
      }
      _searchController.text = plate;
      setState(() {
        _resultados = res;
        _lectura = lectura;
        _fotoBytes = bytes;
      });
      // Nada que se le parezca en la flota: directo a comprobar y dar de alta.
      if (res.isEmpty) {
        if (_puedeDarDeAlta) {
          await _abrirAlta();
        } else {
          setState(() => _error = 'Matrícula leída: $plate. No se encontró ningún vehículo con ella.');
        }
      }
    } catch (e) {
      setState(() => _error = 'No se pudo escanear (¿sin conexión?). Escribe la matrícula a mano.');
    } finally {
      if (mounted) setState(() => _escaneando = false);
    }
  }

  /// Alta desde la foto ([_lectura]) o, tras varias fotos fallidas, con la
  /// matrícula escrita en el buscador.
  Future<void> _abrirAlta({bool tecleada = false}) async {
    final lectura = _lectura;
    final matricula = tecleada ? normalizarMatricula(_searchController.text) : lectura?.matricula;
    if (matricula == null || matricula.isEmpty) return;
    final r = await Navigator.of(context).push<SalidaAltaDesdeRevision>(MaterialPageRoute(
      builder: (_) => AltaDesdeRevisionScreen(
        matricula: matricula,
        dudososIa: tecleada ? const [] : (lectura?.dudosos ?? const []),
        fotoBytes: tecleada ? null : _fotoBytes,
        fotoPath: tecleada ? null : lectura?.fotoPath,
        tecleada: tecleada,
      ),
    ));
    if (!mounted) return;
    switch (r) {
      case RepetirFoto():
        _fotosFallidas++;
        setState(() => _lectura = null);
        await _escanearMatricula();
      case UsarVehiculo(:final vehiculo):
        await _irAConfirmar(vehiculo);
      case AltaTerminada():
        Navigator.of(context).pop(true);
      case null:
        break;
    }
  }

  Future<void> _irAConfirmar(Vehiculo v) async {
    if (widget.destino == DestinoVehiculo.operaciones) {
      // Se abre Cambios y, al cerrarse, se cierra TAMBIÉN esta pantalla: el
      // técnico vuelve a Inicio y no a la búsqueda que ya usó.
      //
      // Con pushReplacement se llegaría al mismo sitio, pero mal: esa llamada
      // completa al instante el `await` de quien nos abrió, así que Inicio
      // refrescaría el contador de incidencias ANTES de que la operación
      // hubiera empezado siquiera.
      final r = await Navigator.of(context)
          .push(MaterialPageRoute(builder: (_) => CambioNeumaticoScreen(vehiculoId: v.id)));
      if (!mounted) return;
      Navigator.of(context).pop(r);
      return;
    }
    Navigator.of(context).push(MaterialPageRoute(builder: (_) => ConfirmVehicleScreen(vehiculo: v)));
  }

  @override
  Widget build(BuildContext context) {
    final recientes = OfflineStore.vehiculosRecientes();
    return Scaffold(
      appBar: AppBar(
        title: Text(widget.destino == DestinoVehiculo.operaciones
            ? 'Operaciones · elige el vehículo'
            : 'Identificar vehículo'),
      ),
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // Metodo 1: foto + IA (el mas rapido)
            ElevatedButton.icon(
              onPressed: _escaneando ? null : _escanearMatricula,
              icon: _escaneando
                  ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: AppColors.onPrimary))
                  : const Icon(Icons.camera_alt),
              label: Text(_escaneando ? 'Leyendo matrícula…' : 'Escanear matrícula con la cámara'),
            ),
            const SizedBox(height: 16),

            // Metodo 2: manual
            TextField(
              controller: _searchController,
              textCapitalization: TextCapitalization.characters,
              onChanged: _onSearchChanged,
              decoration: InputDecoration(
                labelText: 'Matrícula o nº de unidad',
                prefixIcon: const Icon(Icons.search, color: AppColors.textSecondary),
                suffixIcon: _buscando ? const Padding(padding: EdgeInsets.all(14), child: CircularProgressIndicator(strokeWidth: 2)) : null,
              ),
            ),

            if (_error != null) ...[
              const SizedBox(height: 10),
              Text(_error!, style: const TextStyle(color: AppColors.warning, fontSize: 13)),
            ],

            const SizedBox(height: 8),
            Expanded(
              child: ListView(
                children: [
                  if (_resultados.isNotEmpty) ...[
                    const _SeccionTitulo('Resultados'),
                    for (final v in _resultados) _VehiculoTile(v: v, onTap: () => _irAConfirmar(v)),
                  ],
                  if (_puedeDarDeAlta && _lectura != null && _resultados.isNotEmpty)
                    _OfertaAlta(
                      texto: '¿No es ninguno? ${_lectura!.matricula} se puede dar de alta.',
                      boton: 'Dar de alta ${_lectura!.matricula}',
                      icono: Icons.add_circle_outline,
                      onTap: () => _abrirAlta(),
                    ),
                  if (_puedeDarDeAlta && _lectura == null && !_buscando &&
                      _resultados.isEmpty && normalizarMatricula(_searchController.text).length >= 4) ...[
                    _OfertaAlta(
                      texto: 'No hay ningún vehículo con «${_searchController.text.trim().toUpperCase()}». '
                          'Para darlo de alta, haz una foto de la matrícula: así no hay errores al escribirla.',
                      boton: 'Foto de la matrícula para darlo de alta',
                      icono: Icons.camera_alt,
                      onTap: _escaneando ? null : _escanearMatricula,
                    ),
                    if (_fotosFallidas >= fotosFallidasParaTeclear)
                      _OfertaAlta(
                        texto: 'La foto no ha funcionado. Puedes darlo de alta con la matrícula escrita; '
                            'oficina la revisará al validarlo.',
                        boton: 'Dar de alta ${normalizarMatricula(_searchController.text)} escrita a mano',
                        icono: Icons.keyboard,
                        onTap: () => _abrirAlta(tecleada: true),
                      ),
                  ],
                  if (_resultados.isEmpty && _searchController.text.isEmpty && recientes.isNotEmpty) ...[
                    const _SeccionTitulo('Vehículos recientes'),
                    for (final j in recientes)
                      _VehiculoTile(
                        v: Vehiculo.fromJson(j),
                        onTap: () async {
                          final v = await TyreControlApi.obtenerVehiculo(j['id'] as String);
                          if (v != null) _irAConfirmar(v);
                        },
                      ),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _SeccionTitulo extends StatelessWidget {
  final String texto;
  const _SeccionTitulo(this.texto);
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 8),
        child: Text(texto.toUpperCase(), style: const TextStyle(color: AppColors.textSecondary, fontSize: 12, fontWeight: FontWeight.w700, letterSpacing: 0.5)),
      );
}

class _VehiculoTile extends StatelessWidget {
  final Vehiculo v;
  final VoidCallback onTap;
  const _VehiculoTile({required this.v, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return Card(
      child: ListTile(
        leading: const Icon(Icons.directions_car, color: AppColors.primary),
        title: Text(v.matricula, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 18)),
        subtitle: Text([if (v.numeroUnidad != null) 'Unidad ${v.numeroUnidad}', v.empresa?.nombre ?? ''].where((e) => e.isNotEmpty).join(' · ')),
        trailing: const Icon(Icons.chevron_right),
        onTap: onTap,
      ),
    );
  }
}

/// Tarjeta que ofrece el alta desde la búsqueda.
class _OfertaAlta extends StatelessWidget {
  final String texto;
  final String boton;
  final IconData icono;
  final VoidCallback? onTap;
  const _OfertaAlta({required this.texto, required this.boton, required this.icono, this.onTap});

  @override
  Widget build(BuildContext context) => Card(
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Text(texto, style: const TextStyle(color: AppColors.textSecondary)),
            const SizedBox(height: 10),
            OutlinedButton.icon(onPressed: onTap, icon: Icon(icono), label: Text(boton)),
          ]),
        ),
      );
}
