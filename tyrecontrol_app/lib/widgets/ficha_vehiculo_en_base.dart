import 'package:flutter/material.dart';

import '../models/presencia_vista.dart';
import '../theme/app_theme.dart';

/// La tarjeta de un vehículo en «Vehículos en bases».
///
/// Está en su propio fichero y no dentro de la pantalla por una razón
/// práctica: es lo único de ahí que se puede probar de verdad con un test de
/// widget, y lo que más fácil se rompe. Lleva una matrícula, un distintivo con
/// la fecha y el autor de la última revisión, cuatro recuadros de datos en una
/// fila y un botón; en la tablet eso cabe de sobra y en el móvil donde también
/// corre esta app va justo. `test/ficha_vehiculo_en_base_test.dart` la monta a
/// 360 px de ancho, que es donde desbordaría.
class FichaVehiculoEnBase extends StatelessWidget {
  final VehiculoPresencia v;
  final RevisionEstado? rev;
  final Map<String, String> nombreDeBase;
  final bool abriendo;
  final VoidCallback onRevisar;

  const FichaVehiculoEnBase({
    super.key,
    required this.v,
    required this.rev,
    required this.nombreDeBase,
    required this.abriendo,
    required this.onRevisar,
  });

  @override
  Widget build(BuildContext context) {
    final dentro = v.estado == enBase;
    final base = v.delegacionNombre ?? nombreDeBase[v.delegacionId ?? ''];
    final huerfano = sinPeriodicidad(rev);

    /*
     * Los cuatro datos cambian según dónde esté, porque las etiquetas mienten
     * si no cambian: «distancia al centro» es al centro de SU base cuando está
     * dentro, y a la base MÁS CERCANA cuando está fuera. Son dos cosas
     * distintas con el mismo número, y llamarlas igual hace que un autobús a
     * 18 km parezca uno aparcado lejos del portón.
     *
     * Y a uno que circula se le pone la velocidad en lugar del tiempo que lleva
     * en la base, que para él no existe.
     */
    final datos = dentro
        ? [
            ('Lleva en la base', desde(v.entradaBaseAt)),
            ('Posición de hace', minutosEnPalabras(v.antiguedadMin)),
            ('Estado', etiquetaPresencia[v.estado] ?? v.estado),
            ('Distancia al centro', v.distanciaM == null ? '—' : '${v.distanciaM} m'),
          ]
        : [
            ('Posición de hace', minutosEnPalabras(v.antiguedadMin)),
            ('Estado', etiquetaPresencia[v.estado] ?? v.estado),
            ('Base más cercana', distanciaCorta(v.distanciaM)),
            ('Velocidad', velocidadCorta(v.velocidadKmh)),
          ];

    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.cardBorder),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      v.matricula,
                      style: const TextStyle(fontSize: 19, fontWeight: FontWeight.w900),
                    ),
                    const SizedBox(height: 1),
                    Text(
                      // Para uno de fuera no hay base que poner, y una raya no
                      // dice nada: se pone dónde está. Y si de uno con posición
                      // vieja se sabe la base donde se le vio, se dice así, que
                      // no es lo mismo que estar allí.
                      base != null
                          ? (dentro
                              ? '$base${v.esSuBase == false ? ' · de paso' : ''}'
                              : 'Última vez en $base')
                          : (etiquetaPresencia[v.estado] ?? v.estado),
                      style: const TextStyle(fontSize: 12, color: AppColors.textSecondary),
                    ),
                  ],
                ),
              ),
              if (rev != null) _distintivo(rev!, huerfano),
            ],
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              for (final (etiqueta, valor) in datos)
                Expanded(
                  child: Padding(
                    padding: const EdgeInsets.only(right: 6),
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
                      decoration: BoxDecoration(
                        color: AppColors.background.withValues(alpha: 0.6),
                        borderRadius: BorderRadius.circular(10),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            etiqueta.toUpperCase(),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(fontSize: 9, color: AppColors.textHint),
                          ),
                          Text(
                            valor,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(fontSize: 13, color: AppColors.textPrimary),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
            ],
          ),
          const SizedBox(height: 10),
          /*
           * El botón verde solo para los que están en la base.
           *
           * No se esconde «Iniciar revisión» en los demás —si el técnico está
           * donde el autobús, puede revisarlo— pero deja de ser la acción
           * destacada: un botón verde y grande en un autobús que va por la
           * autopista invita a bajar al patio a buscarlo.
           */
          SizedBox(
            width: double.infinity,
            height: 46,
            child: dentro
                ? FilledButton.icon(
                    onPressed: abriendo ? null : onRevisar,
                    style: FilledButton.styleFrom(backgroundColor: AppColors.success),
                    icon: abriendo
                        ? const SizedBox(
                            width: 16,
                            height: 16,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Icon(Icons.play_arrow),
                    label: const Text('Iniciar revisión'),
                  )
                : OutlinedButton.icon(
                    onPressed: abriendo ? null : onRevisar,
                    icon: abriendo
                        ? const SizedBox(
                            width: 16,
                            height: 16,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Icon(Icons.play_arrow),
                    label: const Text('Iniciar revisión'),
                  ),
          ),
        ],
      ),
    );
  }

  Widget _distintivo(RevisionEstado rev, bool huerfano) {
    final color = switch (rev.estado) {
      'proxima' => AppColors.warning,
      'vencida' || 'sin_revision' => AppColors.danger,
      _ => huerfano ? AppColors.reesculturado : AppColors.textSecondary,
    };
    final etiqueta = huerfano
        ? 'Sin periodicidad'
        : switch (rev.estado) {
            'sin_revision' => 'Sin revisión',
            'vencida' => 'Vencida',
            'proxima' => 'Próxima',
            'al_dia' => 'Al día',
            _ => rev.estado,
          };
    final dias = rev.estado == 'vencida' && (rev.diasVencido ?? 0) > 0 ? ' · ${rev.diasVencido} d' : '';
    return Column(
      crossAxisAlignment: CrossAxisAlignment.end,
      children: [
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
          decoration: BoxDecoration(
            color: color.withValues(alpha: 0.15),
            borderRadius: BorderRadius.circular(20),
            border: Border.all(color: color.withValues(alpha: 0.4)),
          ),
          child: Text(
            '$etiqueta$dias',
            style: TextStyle(fontSize: 11, fontWeight: FontWeight.w800, color: color),
          ),
        ),
        const SizedBox(height: 3),
        // La fecha de la última revisión y quién la hizo: el distintivo dice en
        // qué situación está, y esto desde cuándo y por obra de quién, que es
        // lo que se mira para decidir si merece la pena cogerlo ahora que está
        // en la base.
        Text(
          'Últ. ${fechaCorta(rev.ultimaRevision)}',
          style: const TextStyle(fontSize: 10, color: AppColors.textHint),
        ),
        Text(
          quienReviso(rev),
          style: const TextStyle(fontSize: 10, color: AppColors.textHint),
        ),
      ],
    );
  }
}
