import 'package:flutter/material.dart';

import '../models/alerta_presion.dart';
import '../services/supabase_service.dart';
import '../theme/app_theme.dart';

/// Los avisos de presión abiertos de un vehículo, en una banda roja.
///
/// ── Dónde va y por qué ─────────────────────────────────────────────────────
///
/// En la pantalla de confirmar el vehículo, que es la última antes de empezar
/// la revisión, y en su ficha. La idea es que el técnico lo vea ANTES de
/// ponerse: si una rueda está a media presión, eso cambia lo que va a hacer.
///
/// ── Cuando no hay nada, no pinta nada ──────────────────────────────────────
///
/// Ni un hueco ni una banda verde diciendo «sin avisos». Esa banda saldría en
/// todas las fichas de la flota y acabaría consiguiendo que tampoco se leyera
/// la roja. Aquí el silencio es la buena noticia.
///
/// ── El botón de resolver ───────────────────────────────────────────────────
///
/// Goodyear avisa de que la presión está baja, pero NO avisa de que se haya
/// arreglado. Así que lo cierra quien infla la rueda. Cerrarlo solo porque
/// pase el tiempo sería dar por buena una rueda que nadie ha tocado.
class BandaAvisosPresion extends StatefulWidget {
  final String vehiculoId;

  /// Si se deja cerrar los avisos desde aquí. En la pantalla de confirmar,
  /// antes de la revisión, no: ahí el técnico viene a revisar y el aviso es
  /// información, no una tarea que despachar de un toque.
  final bool permitirResolver;

  const BandaAvisosPresion({
    super.key,
    required this.vehiculoId,
    this.permitirResolver = false,
  });

  @override
  State<BandaAvisosPresion> createState() => _BandaAvisosPresionState();
}

class _BandaAvisosPresionState extends State<BandaAvisosPresion> {
  List<AlertaPresion> _avisos = const [];
  String? _resolviendo;

  @override
  void initState() {
    super.initState();
    _cargar();
  }

  Future<void> _cargar() async {
    // El servicio nunca lanza: devuelve vacío si algo falla.
    final r = await TyreControlApi.listarAlertasPresionVehiculo(widget.vehiculoId);
    if (!mounted) return;
    setState(() => _avisos = r);
  }

  Future<void> _resolver(AlertaPresion a) async {
    setState(() => _resolviendo = a.id);
    final err = await TyreControlApi.resolverAlertaPresion(
      a.id,
      nota: 'Resuelto desde la tablet',
    );
    if (!mounted) return;
    setState(() {
      _resolviendo = null;
      if (err == null) _avisos = _avisos.where((x) => x.id != a.id).toList();
    });
    if (err != null && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('No se ha podido cerrar el aviso: $err')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_avisos.isEmpty) return const SizedBox.shrink();

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.danger.withValues(alpha: 0.12),
        border: Border.all(color: AppColors.danger.withValues(alpha: 0.5)),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.warning_amber_rounded, size: 18, color: AppColors.danger),
              const SizedBox(width: 6),
              Text(
                _avisos.length == 1
                    ? 'Aviso de presión'
                    : '${_avisos.length} avisos de presión',
                style: const TextStyle(
                  fontSize: 12, fontWeight: FontWeight.w800,
                  letterSpacing: 0.5, color: AppColors.danger,
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          for (final a in _avisos) _fila(a),
          const SizedBox(height: 6),
          const Text(
            'Los manda el sensor de Goodyear, no salen de una revisión.',
            style: TextStyle(fontSize: 11, color: AppColors.textSecondary),
          ),
        ],
      ),
    );
  }

  Widget _fila(AlertaPresion a) {
    final repeticion = textoDeRepeticion(a);
    final ultimo = fechaYHoraCorta(a.ultimoAvisoAt);

    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Wrap(
        crossAxisAlignment: WrapCrossAlignment.center,
        spacing: 8,
        runSpacing: 4,
        children: [
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
            decoration: BoxDecoration(
              color: AppColors.danger.withValues(alpha: 0.22),
              borderRadius: BorderRadius.circular(4),
            ),
            child: Text(
              a.codigoPosicion ?? 'Posición desconocida',
              style: const TextStyle(
                fontSize: 12, fontWeight: FontWeight.w800, color: AppColors.textPrimary,
              ),
            ),
          ),
          Text(
            nombreDelTipo(a.tipo),
            style: const TextStyle(
              fontSize: 13, fontWeight: FontWeight.w700, color: AppColors.textPrimary,
            ),
          ),
          Text(
            textoDePresion(a),
            style: const TextStyle(fontSize: 13, color: AppColors.textPrimary),
          ),
          // Que una rueda lleve días avisando es el dato que de verdad vale:
          // eso ya no es poca presión, es una fuga.
          if (repeticion != null)
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
              decoration: BoxDecoration(
                color: AppColors.warning.withValues(alpha: 0.22),
                borderRadius: BorderRadius.circular(4),
              ),
              child: Text(
                repeticion,
                style: const TextStyle(
                  fontSize: 11, fontWeight: FontWeight.w800, color: AppColors.warning,
                ),
              ),
            ),
          if (ultimo != null)
            Text(
              'último: $ultimo',
              style: const TextStyle(fontSize: 11, color: AppColors.textSecondary),
            ),
          if (a.codigoNeumatico != null)
            Text(
              '· ${a.codigoNeumatico}',
              style: const TextStyle(fontSize: 11, color: AppColors.textSecondary),
            ),
          if (widget.permitirResolver)
            TextButton(
              onPressed: _resolviendo == a.id ? null : () => _resolver(a),
              style: TextButton.styleFrom(
                minimumSize: const Size(0, 32),
                padding: const EdgeInsets.symmetric(horizontal: 10),
              ),
              child: Text(
                _resolviendo == a.id ? 'Cerrando…' : 'Dar por resuelto',
                style: const TextStyle(fontSize: 12),
              ),
            ),
        ],
      ),
    );
  }
}
