import 'package:flutter/material.dart';
import '../models/models.dart';
import '../services/offline_store.dart';
import '../services/supabase_service.dart';
import '../theme/app_theme.dart';
import 'review_screen.dart';

/// Ficha de confirmacion tras identificar el vehiculo. Un solo boton
/// de accion: no hay nada mas que decidir aqui.
class ConfirmVehicleScreen extends StatefulWidget {
  final Vehiculo vehiculo;
  const ConfirmVehicleScreen({super.key, required this.vehiculo});

  @override
  State<ConfirmVehicleScreen> createState() => _ConfirmVehicleScreenState();
}

class _ConfirmVehicleScreenState extends State<ConfirmVehicleScreen> {
  bool _cargando = false;
  RevisionVehiculo? _ultimaRevision;
  int _numNeumaticos = 0;
  bool _verificarPresiones = true;

  @override
  void initState() {
    super.initState();
    _cargarContexto();
  }

  Future<void> _cargarContexto() async {
    try {
      final ultima = await TyreControlApi.obtenerUltimaRevision(widget.vehiculo.id);
      int n = 0;
      if (widget.vehiculo.tipoVehiculoId != null) {
        final pos = await TyreControlApi.listarPosiciones(widget.vehiculo.tipoVehiculoId!);
        n = pos.length;
      }
      if (!mounted) return;
      setState(() {
        _ultimaRevision = ultima;
        _numNeumaticos = n;
      });
    } catch (_) {
      // Sin red: seguimos, la ficha basica ya la tenemos
    }
  }

  Future<void> _confirmar() async {
    setState(() => _cargando = true);
    try {
      await OfflineStore.agregarVehiculoReciente({
        'id': widget.vehiculo.id,
        'matricula': widget.vehiculo.matricula,
        'numero_unidad': widget.vehiculo.numeroUnidad,
        'empresa_id': widget.vehiculo.empresaId,
        'km_actual': widget.vehiculo.kmActual,
        'activo': true,
      });
      if (!mounted) return;
      Navigator.of(context).push(MaterialPageRoute(
          builder: (_) => ReviewScreen(vehiculo: widget.vehiculo, verificarPresiones: _verificarPresiones)));
    } finally {
      if (mounted) setState(() => _cargando = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final v = widget.vehiculo;
    return Scaffold(
      appBar: AppBar(title: const Text('Confirmar vehículo')),
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Container(
              height: 140,
              decoration: BoxDecoration(color: AppColors.surfaceVariant, borderRadius: BorderRadius.circular(16)),
              child: const Center(child: Icon(Icons.local_shipping, size: 56, color: AppColors.textSecondary)),
            ),
            const SizedBox(height: 16),
            Text(v.matricula, style: Theme.of(context).textTheme.displayLarge, textAlign: TextAlign.center),
            if (v.numeroUnidad != null)
              Center(child: Text('Unidad ${v.numeroUnidad}', style: const TextStyle(color: AppColors.textSecondary, fontSize: 16))),
            const SizedBox(height: 20),
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    _Fila('Cliente', v.empresa?.nombre),
                    _Fila('Marca / Modelo', [v.marca, v.modelo].where((e) => e != null && e.isNotEmpty).join(' ')),
                    _Fila('Tipo', v.tipo?.descripcion ?? v.tipo?.nombre),
                    _Fila('Configuración de ejes', v.tipo?.configuracionEjes),
                    _Fila('Nº de neumáticos', _numNeumaticos > 0 ? '$_numNeumaticos' : null),
                    _Fila('Km actuales', '${v.kmActual}'),
                    _Fila('Última revisión', _ultimaRevision?.fechaRevision),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 12),
            Card(
              child: SwitchListTile(
                value: _verificarPresiones,
                onChanged: (v) => setState(() => _verificarPresiones = v),
                title: const Text('Verificar presiones', style: TextStyle(fontWeight: FontWeight.w700)),
                subtitle: const Text(
                    'Si está activo, cada rueda necesita profundidad Y presión para avanzar automáticamente a la siguiente.',
                    style: TextStyle(color: AppColors.textSecondary, fontSize: 12)),
                secondary: const Icon(Icons.speed, color: AppColors.primary),
                activeColor: AppColors.primary,
              ),
            ),
            const Spacer(),
            ElevatedButton.icon(
              onPressed: _cargando ? null : _confirmar,
              icon: const Icon(Icons.check_circle),
              label: const Text('Confirmar vehículo'),
            ),
          ],
        ),
      ),
    );
  }
}

class _Fila extends StatelessWidget {
  final String label;
  final String? value;
  const _Fila(this.label, this.value);

  @override
  Widget build(BuildContext context) {
    final v = value;
    final texto = (v == null || v.isEmpty) ? '—' : v;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 5),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(width: 150, child: Text(label, style: const TextStyle(color: AppColors.textSecondary, fontSize: 13))),
          Expanded(child: Text(texto, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600))),
        ],
      ),
    );
  }
}
