import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

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
          // «Iniciar revisión» y, a su lado, el botón para ir hasta el
          // vehículo: abre una hoja para elegir andando o en la unidad móvil.
          Row(
            children: [
              Expanded(
                child: SizedBox(
                  height: 46,
                  child:       dentro
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
              ),
              const SizedBox(width: 8),
              _botonComoLlegar(context),
            ],
          ),
        ],
      ),
    );
  }

  /// El botón redondo del mapa. Apagado si no hay una posición que valga; en
  /// ámbar si la posición tiene más de una hora.
  Widget _botonComoLlegar(BuildContext context) {
    final hay = posicionUtil(v.lat, v.lng);
    final vieja = posicionVieja(v.antiguedadMin);
    final color = !hay ? AppColors.textDisabled : (vieja ? AppColors.warning : AppColors.info);
    return Tooltip(
      message: hay ? 'Cómo llegar al vehículo' : 'Sin posición',
      child: SizedBox(
        width: 46,
        height: 46,
        child: IconButton(
          key: const Key('como-llegar'),
          onPressed: hay ? () => _abrirHoja(context) : null,
          style: IconButton.styleFrom(
            backgroundColor: color.withValues(alpha: 0.12),
            disabledBackgroundColor: AppColors.disabledBtn.withValues(alpha: 0.4),
            side: BorderSide(color: color.withValues(alpha: 0.7)),
            shape: const CircleBorder(),
          ),
          icon: Icon(Icons.location_on_outlined, color: color),
        ),
      ),
    );
  }

  /// La hoja de abajo: de cuándo es la posición y las dos maneras de ir.
  void _abrirHoja(BuildContext context) {
    final dentro = v.estado == enBase;
    final base = v.delegacionNombre ?? nombreDeBase[v.delegacionId ?? ''];
    final vieja = posicionVieja(v.antiguedadMin);
    final donde = v.distanciaM == null
        ? ''
        : dentro
            ? ' · a ${distanciaCorta(v.distanciaM)} del centro de la base${base != null ? ' de $base' : ''}'
            : ' · a ${distanciaCorta(v.distanciaM)} de la base más cercana';
    showModalBottomSheet<void>(
      context: context,
      backgroundColor: AppColors.surface,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(22))),
      builder: (hoja) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(18, 12, 18, 18),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Center(
                child: Container(
                  width: 40,
                  height: 4,
                  decoration: BoxDecoration(color: AppColors.cardBorder, borderRadius: BorderRadius.circular(4)),
                ),
              ),
              const SizedBox(height: 14),
              Text(
                'Ir hasta el ${v.matricula}',
                style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800, color: AppColors.textPrimary),
              ),
              const SizedBox(height: 2),
              Text(
                'Posición de hace ${minutosEnPalabras(v.antiguedadMin)}$donde',
                style: const TextStyle(fontSize: 13, color: AppColors.textSecondary),
              ),
              if (vieja) ...[
                const SizedBox(height: 6),
                const Text(
                  'La posición tiene más de una hora: puede haberse movido.',
                  style: TextStyle(fontSize: 12, color: AppColors.warning),
                ),
              ],
              const SizedBox(height: 14),
              _opcion(hoja, ModoDeIr.andando, Icons.directions_walk, 'Andando', 'Ruta a pie en Google Maps'),
              const SizedBox(height: 10),
              _opcion(hoja, ModoDeIr.enUnidadMovil, Icons.local_shipping_outlined, 'En la unidad móvil',
                  'Ruta en coche en Google Maps'),
              const SizedBox(height: 6),
              TextButton(
                onPressed: () => Navigator.of(hoja).pop(),
                child: const Text('Cancelar', style: TextStyle(color: AppColors.textSecondary, fontSize: 15)),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _opcion(BuildContext hoja, ModoDeIr modo, IconData icono, String titulo, String detalle) {
    return Material(
      color: AppColors.background.withValues(alpha: 0.6),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(14),
        side: const BorderSide(color: AppColors.cardBorder),
      ),
      child: InkWell(
        key: Key('ir-${modo.name}'),
        borderRadius: BorderRadius.circular(14),
        onTap: () async {
          final ruta = rutaHastaVehiculo(v, modo);
          final avisos = ScaffoldMessenger.maybeOf(hoja);
          Navigator.of(hoja).pop();
          if (ruta == null) return;
          // Fuera de la app: Google Maps si está instalado, si no el navegador.
          final abierta = await launchUrl(ruta, mode: LaunchMode.externalApplication);
          if (!abierta) {
            avisos?.showSnackBar(const SnackBar(content: Text('No se ha podido abrir Google Maps')));
          }
        },
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: 56),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            child: Row(
              children: [
                Icon(icono, color: AppColors.info),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        titulo,
                        style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: AppColors.textPrimary),
                      ),
                      Text(detalle, style: const TextStyle(fontSize: 12, color: AppColors.textSecondary)),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
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
