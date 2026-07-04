import 'package:flutter/material.dart';
import '../models/models.dart';
import '../services/offline_store.dart';
import '../services/supabase_service.dart';
import '../theme/app_theme.dart';
import '../widgets/vehicle_schema.dart';
import 'tire_detail_screen.dart';

/// Pantalla 4: revision. Modo asistente automatico: el tecnico no
/// decide que rueda toca ahora, simplemente avanza.
class ReviewScreen extends StatefulWidget {
  final Vehiculo vehiculo;
  final RevisionVehiculo? revisionExistente;
  const ReviewScreen({super.key, required this.vehiculo, this.revisionExistente});

  @override
  State<ReviewScreen> createState() => _ReviewScreenState();
}

class _ReviewScreenState extends State<ReviewScreen> {
  bool _cargando = true;
  String? _error;

  List<PosicionVehiculo> _posiciones = [];
  final Map<String, MontajeActual> _montajePorPosicion = {};
  final Map<String, RevisionDetalleDraft> _detalles = {};
  RevisionVehiculo? _revision;
  int _index = 0;
  bool _finalizando = false;

  @override
  void initState() {
    super.initState();
    _cargar();
  }

  Future<void> _cargar() async {
    setState(() {
      _cargando = true;
      _error = null;
    });
    try {
      final tipoId = widget.vehiculo.tipoVehiculoId;
      if (tipoId == null) {
        setState(() => _error = 'Este vehículo no tiene un tipo con posiciones configuradas.');
        return;
      }
      final posiciones = await TyreControlApi.listarPosiciones(tipoId);
      final montajes = await TyreControlApi.listarMontajesVehiculo(widget.vehiculo.id);
      _montajePorPosicion.clear();
      for (final m in montajes) {
        _montajePorPosicion[m.posicionId] = m;
      }

      _revision = widget.revisionExistente ??
          await TyreControlApi.crearRevision(
            empresaId: widget.vehiculo.empresaId,
            vehiculoId: widget.vehiculo.id,
            kmVehiculo: widget.vehiculo.kmActual,
          );

      for (final p in posiciones) {
        _detalles[p.id] = RevisionDetalleDraft(posicionId: p.id, neumaticoId: _montajePorPosicion[p.id]?.neumaticoId);
      }

      if (!mounted) return;
      setState(() => _posiciones = posiciones);
    } catch (e) {
      setState(() => _error = 'No se pudo cargar el vehículo. Comprueba la conexión e inténtalo de nuevo.');
    } finally {
      if (mounted) setState(() => _cargando = false);
    }
  }

  TireStatus _statusDe(PosicionVehiculo p) {
    final montado = _montajePorPosicion.containsKey(p.id);
    final d = _detalles[p.id];
    if (p.id == _posiciones.elementAtOrNull(_index)?.id) return TireStatus.seleccionado;
    if (!montado) return d != null && d.medido ? TireStatus.revisado : TireStatus.pendiente;
    if (d == null || !d.medido) return TireStatus.pendiente;
    if (d.noAccesible) return TireStatus.noAccesible;
    if (d.estadoVisual != null && _esGrave(d.estadoVisual!)) return TireStatus.grave;
    if (d.estadoVisual != null && d.estadoVisual != 'correcto') return TireStatus.advertencia;
    return TireStatus.revisado;
  }

  bool _esGrave(String estado) => ['pinchazo', 'corte', 'objeto_clavado'].contains(estado);

  bool get _todoRevisado => _posiciones.every((p) => _detalles[p.id]?.medido ?? false);

  Future<void> _abrirNeumatico(PosicionVehiculo p) async {
    final idx = _posiciones.indexOf(p);
    setState(() => _index = idx);
    final montaje = _montajePorPosicion[p.id];
    final draft = _detalles[p.id]!;
    final resultado = await Navigator.of(context).push<RevisionDetalleDraft>(
      MaterialPageRoute(
        builder: (_) => TireDetailScreen(
          posicion: p,
          neumatico: montaje?.neumatico,
          draft: draft,
          revision: _revision!,
          vehiculo: widget.vehiculo,
        ),
      ),
    );
    if (resultado != null) {
      setState(() => _detalles[p.id] = resultado);
      if (_index < _posiciones.length - 1) setState(() => _index++);
    }
  }

  Future<void> _finalizar() async {
    setState(() => _finalizando = true);
    try {
      if (OfflineStore.offline.value) {
        await OfflineStore.enqueueCompletar(_revision!.id);
      } else {
        try {
          await TyreControlApi.completarRevision(_revision!.id);
        } catch (_) {
          await OfflineStore.enqueueCompletar(_revision!.id);
        }
      }
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Revisión finalizada')));
      Navigator.of(context).popUntil((r) => r.isFirst);
    } finally {
      if (mounted) setState(() => _finalizando = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_cargando) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }
    if (_error != null) {
      return Scaffold(
        appBar: AppBar(title: const Text('Revisión')),
        body: Center(child: Padding(padding: const EdgeInsets.all(24), child: Text(_error!, textAlign: TextAlign.center))),
      );
    }

    final estados = {for (final p in _posiciones) p.id: _statusDe(p)};
    final actual = _posiciones.isEmpty ? null : _posiciones[_index];

    return Scaffold(
      appBar: AppBar(
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(widget.vehiculo.matricula, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
            Text('${widget.vehiculo.empresa?.nombre ?? ''} · ${widget.vehiculo.kmActual} km', style: const TextStyle(fontSize: 12, color: AppColors.textSecondary)),
          ],
        ),
      ),
      body: Column(
        children: [
          Expanded(
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(16),
              child: VehicleSchema(
                posiciones: _posiciones,
                estados: estados,
                seleccionadaId: actual?.id,
                onTap: _abrirNeumatico,
              ),
            ),
          ),
          Container(
            padding: const EdgeInsets.all(16),
            decoration: const BoxDecoration(border: Border(top: BorderSide(color: AppColors.cardBorder))),
            child: Column(
              children: [
                if (actual != null)
                  Text('${actual.nombre ?? actual.codigoPosicion} (${_index + 1} de ${_posiciones.length})',
                      style: const TextStyle(color: AppColors.textSecondary, fontSize: 13)),
                const SizedBox(height: 10),
                Row(
                  children: [
                    Expanded(
                      child: OutlinedButton.icon(
                        onPressed: _index > 0 ? () => setState(() => _index--) : null,
                        icon: const Icon(Icons.arrow_back),
                        label: const Text('Anterior'),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: ElevatedButton.icon(
                        onPressed: actual == null ? null : () => _abrirNeumatico(actual),
                        icon: const Icon(Icons.build_circle_outlined),
                        label: const Text('Revisar'),
                      ),
                    ),
                  ],
                ),
                if (_todoRevisado) ...[
                  const SizedBox(height: 10),
                  ElevatedButton.icon(
                    onPressed: _finalizando ? null : _finalizar,
                    style: ElevatedButton.styleFrom(backgroundColor: AppColors.success, foregroundColor: Colors.white),
                    icon: _finalizando
                        ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                        : const Icon(Icons.check_circle),
                    label: const Text('Finalizar revisión'),
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}
