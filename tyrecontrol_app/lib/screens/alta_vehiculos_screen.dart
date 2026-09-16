import 'package:flutter/material.dart';

import '../services/supabase_service.dart';
import '../theme/app_theme.dart';
import 'alta_operativa_screen.dart';
import 'inventario_inicial_screen.dart';

/// Los vehículos con los que todavía no se puede trabajar.
///
/// «Pendiente» aquí es SOLO lo operativo: sin tipo no hay plano, sin plano no
/// hay posiciones y sin posiciones no hay dónde colgar una medición. Un
/// vehículo sin marca, sin modelo o sin bastidor NO sale: esos datos los pone
/// oficina y no impiden medir una goma. Si salieran, el técnico encontraría en
/// la cola vehículos que no puede arreglar y dejaría de mirarla.
///
/// Quién decide qué está pendiente es el servidor (`estadoDeAlta`), no esta
/// pantalla: el contador del menú y esta lista salen de la MISMA respuesta,
/// así que no pueden contradecirse.
class AltaVehiculosScreen extends StatefulWidget {
  const AltaVehiculosScreen({super.key});

  @override
  State<AltaVehiculosScreen> createState() => _AltaVehiculosScreenState();
}

class _AltaVehiculosScreenState extends State<AltaVehiculosScreen> {
  List<Map<String, dynamic>> _todos = const [];
  bool _cargando = true;
  String? _error;
  String _busqueda = '';

  @override
  void initState() {
    super.initState();
    _cargar();
  }

  Future<void> _cargar() async {
    setState(() { _cargando = true; _error = null; });
    try {
      final v = await TyreControlApi.vehiculosPendientesDeAlta();
      if (mounted) setState(() { _todos = v; _cargando = false; });
    } catch (e) {
      if (mounted) setState(() { _error = '$e'; _cargando = false; });
    }
  }

  /// Buscador por matrícula y por número de unidad: en el patio se conoce el
  /// camión por cualquiera de los dos.
  List<Map<String, dynamic>> get _visibles {
    final q = _busqueda.trim().toUpperCase();
    if (q.isEmpty) return _todos;
    return _todos.where((v) {
      final mat = (v['matricula'] as String? ?? '').toUpperCase();
      final uni = (v['numeroUnidad'] as String? ?? '').toUpperCase();
      return mat.contains(q) || uni.contains(q);
    }).toList();
  }

  @override
  Widget build(BuildContext context) {
    final lista = _visibles;
    return Scaffold(
      appBar: AppBar(
        title: ValueListenableBuilder<int>(
          valueListenable: TyreControlApi.altaPendienteCount,
          builder: (_, n, __) => Text(n > 0 ? 'Alta de vehículos ($n)' : 'Alta de vehículos'),
        ),
      ),
      body: SafeArea(
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
              child: TextField(
                onChanged: (v) => setState(() => _busqueda = v),
                textCapitalization: TextCapitalization.characters,
                decoration: const InputDecoration(
                  prefixIcon: Icon(Icons.search),
                  hintText: 'Buscar matrícula o nº de unidad',
                ),
              ),
            ),
            Expanded(
              child: _cargando
                  ? const Center(child: CircularProgressIndicator())
                  : _error != null
                      ? _vistaError()
                      : lista.isEmpty
                          ? _vistaVacia()
                          : RefreshIndicator(
                              onRefresh: _cargar,
                              child: ListView.separated(
                                padding: const EdgeInsets.fromLTRB(16, 4, 16, 24),
                                itemCount: lista.length,
                                separatorBuilder: (_, __) => const SizedBox(height: 12),
                                itemBuilder: (_, i) => _Tarjeta(vehiculo: lista[i], alVolver: _cargar),
                              ),
                            ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _vistaVacia() => RefreshIndicator(
        onRefresh: _cargar,
        child: ListView(children: [
          const SizedBox(height: 80),
          const Icon(Icons.check_circle_outline, size: 48, color: AppColors.textSecondary),
          const SizedBox(height: 12),
          Center(
            child: Text(
              _busqueda.trim().isEmpty
                  ? 'No hay vehículos pendientes de alta'
                  : 'Ningún vehículo pendiente con esa matrícula',
              style: const TextStyle(color: AppColors.textSecondary),
            ),
          ),
        ]),
      );

  /// El error se enseña en cristiano y con el detalle técnico en pequeño: el
  /// técnico necesita saber si es la red o es otra cosa, sin leer un stack.
  Widget _vistaError() => RefreshIndicator(
        onRefresh: _cargar,
        child: ListView(children: [
          const SizedBox(height: 80),
          const Icon(Icons.cloud_off, size: 48, color: AppColors.textSecondary),
          const SizedBox(height: 12),
          const Center(
            child: Text('No se han podido cargar los vehículos pendientes',
                style: TextStyle(color: AppColors.textSecondary)),
          ),
          const SizedBox(height: 6),
          Center(
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 24),
              child: Text(_error ?? '', textAlign: TextAlign.center,
                  style: const TextStyle(color: AppColors.textHint, fontSize: 12)),
            ),
          ),
          const SizedBox(height: 16),
          Center(child: FilledButton(onPressed: _cargar, child: const Text('Reintentar'))),
        ]),
      );
}

/// Una tarjeta: solo lo que hace falta para decidir si se coge ese vehículo.
class _Tarjeta extends StatelessWidget {
  final Map<String, dynamic> vehiculo;
  /// Se llama al volver del asistente: la lista y el contador tienen que
  /// reflejar lo que se acaba de hacer sin que el técnico tire de recargar.
  final Future<void> Function() alVolver;
  const _Tarjeta({required this.vehiculo, required this.alVolver});

  @override
  Widget build(BuildContext context) {
    final motivo = vehiculo['motivo'] as String?;
    final progreso = vehiculo['progreso'] as Map<String, dynamic>?;
    final unidad = vehiculo['numeroUnidad'] as String?;
    final tipo = vehiculo['tipoNombre'] as String?;

    // El tipo sin plano es el único que el técnico NO puede desbloquear: las
    // posiciones cuelgan del tipo y las comparten todos sus vehículos. Se
    // pinta distinto y el botón no promete lo que no puede cumplir.
    final bloqueadoEnOficina = motivo == 'TIPO_SIN_PLANO';

    return Container(
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: bloqueadoEnOficina ? AppColors.warning : AppColors.cardBorder),
      ),
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(children: [
            Text(vehiculo['matricula'] as String? ?? '',
                style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800, color: AppColors.textPrimary)),
            if (unidad != null && unidad.isNotEmpty) ...[
              const SizedBox(width: 10),
              Text('· Unidad $unidad', style: const TextStyle(color: AppColors.textSecondary)),
            ],
          ]),
          if (tipo != null && tipo.isNotEmpty) ...[
            const SizedBox(height: 4),
            Text(tipo, style: const TextStyle(color: AppColors.textSecondary, fontSize: 13)),
          ],
          const SizedBox(height: 10),
          Text(
            vehiculo['texto'] as String? ?? '',
            style: TextStyle(
              color: bloqueadoEnOficina ? AppColors.warning : AppColors.textPrimary,
              fontWeight: FontWeight.w600,
            ),
          ),
          if (progreso != null) ...[
            const SizedBox(height: 10),
            ClipRRect(
              borderRadius: BorderRadius.circular(4),
              child: LinearProgressIndicator(
                value: ((progreso['total'] as num?)?.toDouble() ?? 0) == 0
                    ? 0
                    : (progreso['hechas'] as num).toDouble() / (progreso['total'] as num).toDouble(),
                minHeight: 8,
                backgroundColor: AppColors.surfaceVariant,
              ),
            ),
          ],
          const SizedBox(height: 14),
          SizedBox(
            width: double.infinity,
            height: 52, // botón grande: esto se usa de pie y con guantes
            child: FilledButton(
              onPressed: bloqueadoEnOficina
                  ? null
                  : () async {
                      final tipoId = vehiculo['tipoId'] as String?;
                      // Con el tipo ya puesto, lo que falta son gomas: se va
                      // derecho al inventario en vez de hacerle repasar unos
                      // pasos que ya contestó.
                      final aInventario = tipoId != null &&
                          (motivo == 'INVENTARIO_INCOMPLETO' || motivo == 'SIN_MEDICION_INICIAL');
                      await Navigator.of(context).push(MaterialPageRoute(
                        builder: (_) => aInventario
                            ? InventarioInicialScreen(
                                vehiculoId: vehiculo['id'] as String,
                                matricula: vehiculo['matricula'] as String? ?? '',
                                tipoVehiculoId: tipoId,
                              )
                            : AltaOperativaScreen(
                                vehiculoId: vehiculo['id'] as String,
                                matricula: vehiculo['matricula'] as String? ?? '',
                                tipoIdActual: tipoId,
                              ),
                      ));
                      await alVolver();
                    },
              child: Text(
                motivo == 'SIN_TIPO'
                    ? 'Completar alta'
                    : bloqueadoEnOficina
                        ? 'Lo resuelve oficina'
                        : 'Continuar inventario',
                style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
