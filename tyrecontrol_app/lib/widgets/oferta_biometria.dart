import 'package:flutter/material.dart';

import '../services/biometria.dart';
import '../theme/app_theme.dart';

/// Ofrece Face ID / huella **una sola vez** por dispositivo, como en Assist
/// Lite y en Assist.
///
/// Se llama en dos sitios: al entrar con nombre y PIN, que es cuando el
/// técnico acaba de demostrar quién es, y al abrir Inicio, para quien ya
/// tenía la sesión abierta antes de que existiera esto y nunca pasa por el
/// login. La primera que llegue la marca como ofrecida y la otra ya no sale.
///
/// Si dice que no, no se vuelve a preguntar: se activa cuando quiera desde
/// Perfil.
Future<void> ofrecerBiometria(BuildContext context) async {
  if (await Biometria.activada()) return;
  if (await Biometria.ofrecida()) return;
  if (!await Biometria.disponible()) return;
  await Biometria.marcarOfrecida();
  final nombre = await Biometria.nombre();
  if (!context.mounted) return;
  final activar = await showDialog<bool>(
    context: context,
    builder: (ctx) => AlertDialog(
      icon: const Icon(Icons.fingerprint, color: AppColors.primary),
      title: Text('¿Entrar con $nombre?'),
      content: Text('La próxima vez que abras la app entrarás con $nombre, '
          'sin escribir tu nombre ni el PIN. Se puede quitar cuando quieras '
          'desde Perfil.'),
      actions: [
        TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Ahora no')),
        FilledButton(onPressed: () => Navigator.pop(ctx, true), child: Text('Activar $nombre')),
      ],
    ),
  );
  if (activar != true) return;
  // Se comprueba en el momento: activar algo que luego no funciona deja al
  // técnico en la pantalla de candado sin poder pasar.
  if (await Biometria.autenticar('Activa el acceso con $nombre')) {
    await Biometria.activar(true);
  }
}
