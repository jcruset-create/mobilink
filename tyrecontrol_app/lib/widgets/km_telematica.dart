import 'package:flutter/material.dart';

import '../services/supabase_service.dart';
import '../theme/app_theme.dart';
import 'km_vehiculo.dart';

/// Los kilómetros del vehículo, con su procedencia a la vista.
///
/// ── Por qué se enseña la fecha de la lectura y no solo el número ────────────
///
/// Porque un número sin fecha se lee como «esto es de ahora mismo», y no
/// siempre lo es. Un autobús que lleva tres horas en el foso no ha emitido
/// nada en tres horas, y su odómetro sigue siendo bueno —lo que no se mueve no
/// suma kilómetros— pero el técnico tiene derecho a saberlo y a decidir.
///
/// ── Y por qué el técnico siempre puede teclearlos ───────────────────────────
///
/// Porque hay vehículos sin telemática, proveedores caídos y equipos que no
/// dan cuentakilómetros. La telemetría RELLENA el campo; no lo secuestra.
class KmTelematica extends StatefulWidget {
  final String vehiculoId;
  final String matricula;
  /// Lo que se confirme sube por aquí, con su origen: 'telematica' o 'manual'.
  final void Function(num? km, String origen) onConfirmado;

  const KmTelematica({
    super.key,
    required this.vehiculoId,
    required this.matricula,
    required this.onConfirmado,
  });

  @override
  State<KmTelematica> createState() => _KmTelematicaState();
}

class _KmTelematicaState extends State<KmTelematica> {
  Map<String, dynamic>? _lectura;
  bool _consultando = true;
  num? _confirmado;
  String _origen = 'manual';

  @override
  void initState() {
    super.initState();
    _consultar();
  }

  /// Se consulta al abrir, no solo en el barrido nocturno: el técnico necesita
  /// el dato de ahora, no el que dejó la sincronización de la madrugada.
  Future<void> _consultar() async {
    setState(() => _consultando = true);
    final l = await TyreControlApi.kilometrajeActual(widget.vehiculoId);
    if (!mounted) return;
    setState(() { _lectura = l; _consultando = false; });
  }

  void _confirmarTelematica() {
    final km = (_lectura?['km'] as num?);
    if (km == null) return;
    setState(() { _confirmado = km; _origen = 'telematica'; });
    widget.onConfirmado(km, 'telematica');
  }

  Future<void> _corregirAMano() async {
    final km = await pedirKmVehiculo(context,
        matricula: widget.matricula, actual: (_confirmado ?? _lectura?['km'] as num?)?.round());
    if (km == null || !mounted) return;
    setState(() { _confirmado = km; _origen = 'manual'; });
    // El dato de telemetría NO se pierde: sigue en _lectura y se sigue
    // enseñando debajo, para que quede claro qué decía el proveedor.
    widget.onConfirmado(km, 'manual');
  }

  @override
  Widget build(BuildContext context) {
    final l = _lectura;
    final estado = l?['estado'] as String?;
    final kmLectura = l?['km'] as num?;
    final aviso = l?['aviso'] as String?;

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.cardBorder),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        const Text('Kilómetros', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700,
            color: AppColors.textPrimary)),
        const SizedBox(height: 10),

        if (_consultando)
          const Row(children: [
            SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2)),
            SizedBox(width: 10),
            Text('Consultando telemetría…', style: TextStyle(color: AppColors.textSecondary)),
          ])
        else ...[
          Text(
            _confirmado != null
                ? '${_confirmado!.round()} km'
                : kmLectura != null ? '${kmLectura.round()} km' : 'Sin dato',
            style: TextStyle(fontSize: 30, fontWeight: FontWeight.w800,
                color: (_confirmado ?? kmLectura) != null ? AppColors.textPrimary : AppColors.textHint),
          ),
          const SizedBox(height: 4),
          Text(
            _confirmado != null && _origen == 'manual'
                ? 'Introducido a mano'
                : (l?['texto'] as String? ?? ''),
            style: TextStyle(
              color: estado == 'lectura_anterior' ? AppColors.warning : AppColors.textSecondary,
              fontSize: 13,
            ),
          ),
          // Si el técnico ha tecleado un valor distinto, el de telemetría NO
          // desaparece: se sigue viendo lo que decía el proveedor.
          if (_confirmado != null && _origen == 'manual' && kmLectura != null)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Text('La telemática decía ${kmLectura.round()} km.',
                  style: const TextStyle(color: AppColors.textHint, fontSize: 12)),
            ),
          if (aviso != null)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Text(aviso, style: const TextStyle(color: AppColors.warning, fontSize: 13)),
            ),
          const SizedBox(height: 14),
          Wrap(spacing: 10, runSpacing: 10, children: [
            if (kmLectura != null)
              OutlinedButton.icon(onPressed: _consultar,
                  icon: const Icon(Icons.refresh, size: 18), label: const Text('Actualizar')),
            if (kmLectura != null && _confirmado == null)
              FilledButton(onPressed: _confirmarTelematica, child: const Text('Confirmar')),
            OutlinedButton(onPressed: _corregirAMano,
                child: Text(kmLectura == null ? 'Introducir a mano' : 'Corregir a mano')),
          ]),
        ],
      ]),
    );
  }
}
