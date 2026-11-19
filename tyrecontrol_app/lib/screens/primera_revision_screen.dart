import 'package:flutter/material.dart';

import '../services/alta_vehiculo.dart';
import '../services/supabase_service.dart';
import '../theme/app_theme.dart';
import 'alta_ejes_screen.dart';
import 'alta_operativa_screen.dart' show TarjetaTipoVehiculo;

/// El aviso que sale en lugar de la revisión cuando el vehículo no tiene tipo:
/// qué le falta y los cuatro pasos de su primera revisión. Lo pinta la propia
/// pantalla de revisión, que es donde se llega por «Nueva revisión».
class AvisoPrimeraRevision extends StatelessWidget {
  final String matricula;
  final String? numeroUnidad;
  final String? empresa;
  final num? km;
  final VoidCallback onEmpezar;
  final VoidCallback onAhoraNo;

  const AvisoPrimeraRevision({
    super.key,
    required this.matricula,
    required this.onEmpezar,
    required this.onAhoraNo,
    this.numeroUnidad,
    this.empresa,
    this.km,
  });

  @override
  Widget build(BuildContext context) {
    Widget paso(int n, String t) => Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
          decoration: BoxDecoration(
            color: AppColors.surface,
            borderRadius: BorderRadius.circular(10),
            border: Border.all(color: AppColors.cardBorder),
          ),
          child: Row(children: [
            CircleAvatar(
              radius: 13,
              backgroundColor: AppColors.primary,
              child: Text('$n', style: const TextStyle(color: AppColors.onPrimary, fontWeight: FontWeight.w800)),
            ),
            const SizedBox(width: 10),
            Expanded(child: Text(t, style: const TextStyle(fontSize: 15))),
          ]),
        );
    return Scaffold(
      appBar: AppBar(
        title: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Text('Primera revisión'),
          Text(
            [matricula, if ((numeroUnidad ?? '').isNotEmpty) 'unidad $numeroUnidad', if (empresa != null) empresa!]
                .join(' · '),
            style: const TextStyle(fontSize: 12, color: AppColors.textSecondary),
          ),
        ]),
      ),
      body: SafeArea(
        child: Column(children: [
          Expanded(
            child: Center(
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 620),
                child: ListView(padding: const EdgeInsets.all(20), children: [
                  Text(matricula,
                      textAlign: TextAlign.center,
                      style: const TextStyle(fontSize: 34, fontWeight: FontWeight.w900, letterSpacing: 2)),
                  const SizedBox(height: 14),
                  Container(
                    padding: const EdgeInsets.all(14),
                    decoration: BoxDecoration(
                      color: AppColors.warning.withValues(alpha: 0.12),
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(color: AppColors.warning),
                    ),
                    child: const Text(
                      'Este vehículo todavía no tiene tipo ni neumáticos apuntados. Sin tipo no hay '
                      'plano de ruedas, así que su primera revisión empieza poniéndoselo.',
                      style: TextStyle(fontSize: 15),
                    ),
                  ),
                  const SizedBox(height: 14),
                  paso(1, 'Qué vehículo es (tipo)'),
                  const SizedBox(height: 8),
                  paso(2, 'Para qué se usa'),
                  const SizedBox(height: 8),
                  paso(3, 'Sus ejes: medida, llanta y presión'),
                  const SizedBox(height: 8),
                  paso(4, 'Las ruedas que lleva ahora'),
                  const SizedBox(height: 14),
                  if (km != null && km! > 0)
                    Text('Km de hoy: $km', style: const TextStyle(color: AppColors.textSecondary, fontSize: 15)),
                ]),
              ),
            ),
          ),
          Container(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
            decoration: const BoxDecoration(
              color: AppColors.surface,
              border: Border(top: BorderSide(color: AppColors.cardBorder)),
            ),
            child: Row(children: [
              Expanded(child: SizedBox(height: 56, child: OutlinedButton(
                  onPressed: onAhoraNo, child: const Text('Ahora no', style: TextStyle(fontSize: 16))))),
              const SizedBox(width: 12),
              Expanded(flex: 2, child: SizedBox(height: 56, child: FilledButton(
                  key: const Key('empezar-primera-revision'),
                  onPressed: onEmpezar,
                  child: const Text('Empezar', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700))))),
            ]),
          ),
        ]),
      ),
    );
  }
}

/// Paso 1 de 4 de la primera revisión: qué vehículo es.
///
/// Los tipos que tienen plano, con los más usados en la flota primero. Al
/// continuar se pone el tipo (`tc_alta_operativa_tipo`, que solo lo deja si el
/// vehículo no tiene ruedas) y sigue con el uso, los ejes y las ruedas
/// ([AltaEjesScreen] → inventario inicial). Al cerrar el inventario queda hecha
/// su primera revisión con los km de hoy, y esta pantalla devuelve `true`.
class PrimeraRevisionTipoScreen extends StatefulWidget {
  final String vehiculoId;
  final String matricula;
  final String empresaId;
  final num? km;
  final String origenKm;

  const PrimeraRevisionTipoScreen({
    super.key,
    required this.vehiculoId,
    required this.matricula,
    required this.empresaId,
    this.km,
    this.origenKm = 'manual',
  });

  @override
  State<PrimeraRevisionTipoScreen> createState() => _PrimeraRevisionTipoScreenState();
}

class _PrimeraRevisionTipoScreenState extends State<PrimeraRevisionTipoScreen> {
  List<Map<String, dynamic>> _tipos = const [];
  Map<String, int> _cuantos = const {};
  String? _tipoId;
  bool _cargando = true;
  bool _guardando = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _cargar();
  }

  Future<void> _cargar() async {
    setState(() { _cargando = true; _error = null; });
    try {
      final r = await Future.wait([
        TyreControlApi.tiposVehiculoParaAlta(),
        TyreControlApi.vehiculosPorTipo(widget.empresaId),
      ]);
      if (!mounted) return;
      final cuantos = r[1] as Map<String, int>;
      setState(() {
        _cuantos = cuantos;
        _tipos = ordenarTiposPorUso((r[0] as List).cast<Map<String, dynamic>>(), cuantos);
        _cargando = false;
      });
    } catch (e) {
      if (mounted) setState(() { _error = '$e'; _cargando = false; });
    }
  }

  Future<void> _continuar() async {
    setState(() { _guardando = true; _error = null; });
    try {
      await TyreControlApi.guardarFichaDeAlta(vehiculoId: widget.vehiculoId, tipoId: _tipoId!);
      if (!mounted) return;
      final terminado = await Navigator.of(context).push<bool>(MaterialPageRoute(
        builder: (_) => AltaEjesScreen(
          vehiculoId: widget.vehiculoId,
          matricula: widget.matricula,
          tipoVehiculoId: _tipoId!,
          pasoUso: 2,
          totalPasos: 4,
          titulo: 'Primera revisión',
          kmIniciales: widget.km,
          origenKm: widget.origenKm,
        ),
      ));
      if (mounted && terminado == true) Navigator.of(context).pop(true);
    } catch (e) {
      // El mensaje de la base ya está escrito para una persona.
      if (mounted) setState(() => _error = '$e'.replaceFirst('Exception: ', ''));
    } finally {
      if (mounted) setState(() => _guardando = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('Primera revisión · ${widget.matricula}'),
          const Text('Paso 1 de 4 · qué vehículo es',
              style: TextStyle(fontSize: 12, color: AppColors.textSecondary)),
        ]),
        bottom: const PreferredSize(
          preferredSize: Size.fromHeight(4),
          child: LinearProgressIndicator(value: 1 / 4, minHeight: 4),
        ),
      ),
      body: SafeArea(
        child: _cargando
            ? const Center(child: CircularProgressIndicator())
            : Column(children: [
                if (_error != null)
                  Container(
                    width: double.infinity,
                    color: AppColors.danger.withValues(alpha: 0.15),
                    padding: const EdgeInsets.all(14),
                    child: Text(_error!, style: const TextStyle(color: AppColors.danger)),
                  ),
                Expanded(
                  child: Center(
                    child: ConstrainedBox(
                      constraints: const BoxConstraints(maxWidth: 680),
                      child: ListView(padding: const EdgeInsets.all(20), children: [
                        if (_tipos.isEmpty)
                          const Text('No hay ningún tipo de vehículo con plano. Tiene que crearlos oficina.',
                              style: TextStyle(color: AppColors.warning)),
                        for (final t in _tipos) ...[
                          Stack(children: [
                            TarjetaTipoVehiculo(
                              tipo: t,
                              elegido: t['id'] == _tipoId,
                              onTap: () => setState(() => _tipoId = t['id'] as String?),
                            ),
                            if ((_cuantos[t['id']] ?? 0) > 0)
                              Positioned(
                                right: 52, top: 10,
                                child: Text('${_cuantos[t['id']]} en la flota',
                                    style: const TextStyle(color: AppColors.textSecondary, fontSize: 12)),
                              ),
                          ]),
                          const SizedBox(height: 10),
                        ],
                      ]),
                    ),
                  ),
                ),
                Container(
                  padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
                  decoration: const BoxDecoration(
                    color: AppColors.surface,
                    border: Border(top: BorderSide(color: AppColors.cardBorder)),
                  ),
                  child: SizedBox(
                    height: 56,
                    width: double.infinity,
                    child: FilledButton(
                      onPressed: _tipoId == null || _guardando ? null : _continuar,
                      child: Text(_guardando ? 'Guardando…' : 'Continuar',
                          style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
                    ),
                  ),
                ),
              ]),
      ),
    );
  }
}
