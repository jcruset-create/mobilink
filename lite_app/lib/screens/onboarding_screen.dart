import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../config.dart';
import '../services/preferencias.dart';
import '../services/tracker.dart';
import '../theme.dart';
import 'login_screen.dart';

/// Condiciones de uso, una sola vez, en la primera apertura.
///
/// Su razón de ser no es legal, es práctica: el permiso de ubicación se pedía
/// en mitad del login, cuando el operario está escribiendo su PIN y lo único
/// que quiere es entrar. Un diálogo del sistema ahí se contesta que no sin
/// leerlo, y en iOS **no hay segunda oportunidad**: la única salida es
/// Ajustes. Aquí se le cuenta antes qué se comparte y cuándo, y el diálogo
/// sale justo después de que diga que sí.
///
/// Un "no" no bloquea nada: se sigue al login igual y la app funciona sin
/// seguimiento, avisando donde toca.
class OnboardingScreen extends StatefulWidget {
  const OnboardingScreen({super.key});

  @override
  State<OnboardingScreen> createState() => _OnboardingScreenState();
}

class _OnboardingScreenState extends State<OnboardingScreen> {
  bool _busy = false;

  Future<void> _aceptar() async {
    setState(() => _busy = true);
    // Se marca ANTES de pedir el permiso: si el operario cierra la app con el
    // diálogo del sistema abierto, no vuelve a empezar desde las condiciones.
    await Preferencias.marcarOnboarding();
    // El diálogo oficial de iOS/Android. Solo «mientras se usa la app»: es lo
    // que necesita el seguimiento (ver tracker.dart) y pedir «siempre» obliga
    // a una revisión aparte sin ganar nada.
    await Tracker.ensurePermission();
    if (!mounted) return;
    Navigator.of(context).pushReplacement(
      MaterialPageRoute(builder: (_) => const LoginScreen()),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 460),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Center(
                    child: ConstrainedBox(
                      constraints: const BoxConstraints(maxWidth: 320),
                      child: Image.asset(
                        'assets/logo_horizontal.png',
                        fit: BoxFit.contain,
                        semanticLabel: 'Mobilink Assist Lite',
                      ),
                    ),
                  ),
                  const SizedBox(height: 28),
                  const _Punto(
                    icono: Icons.assignment_turned_in,
                    titulo: 'Las asistencias de la central, en el móvil',
                    texto: 'Recibes el servicio, lo trabajas y lo cierras con '
                        'sus fotos y la firma del cliente. Sin cobertura sigue '
                        'funcionando y se envía solo al recuperarla.',
                  ),
                  const _Punto(
                    icono: Icons.my_location,
                    titulo: 'Tu ubicación, solo durante el servicio',
                    texto: 'Se comparte cuando marcas "En camino" y deja de '
                        'compartirse al cerrar la asistencia o volver al '
                        'taller. Nunca fuera de un servicio, y mientras dura '
                        'lo ves en la pantalla del móvil.',
                  ),
                  const _Punto(
                    icono: Icons.photo_camera,
                    titulo: 'Cámara para las evidencias',
                    texto: 'Las fotos del vehículo y de la avería se envían a '
                        'la central como prueba del trabajo hecho.',
                  ),
                  const SizedBox(height: 8),
                  TextButton.icon(
                    onPressed: () => launchUrl(
                      Uri.parse(kPrivacyUrl),
                      mode: LaunchMode.externalApplication,
                    ),
                    icon: const Icon(Icons.description, size: 18),
                    label: const Text('Leer la política de privacidad'),
                  ),
                  const SizedBox(height: 12),
                  FilledButton(
                    onPressed: _busy ? null : _aceptar,
                    child: _busy
                        ? const SizedBox(
                            height: 22,
                            width: 22,
                            child: CircularProgressIndicator(
                                strokeWidth: 2, color: Colors.white))
                        : const Text('Aceptar y continuar'),
                  ),
                  const SizedBox(height: 12),
                  const Text(
                    'A continuación el móvil te pedirá permiso para la '
                    'ubicación. Es el aviso del sistema, no de la app.',
                    textAlign: TextAlign.center,
                    style: TextStyle(color: AppColors.textMuted, fontSize: 12),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _Punto extends StatelessWidget {
  const _Punto({required this.icono, required this.titulo, required this.texto});
  final IconData icono;
  final String titulo;
  final String texto;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 18),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icono, color: AppColors.primary),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(titulo,
                    style: const TextStyle(fontWeight: FontWeight.bold)),
                const SizedBox(height: 2),
                Text(texto,
                    style: const TextStyle(
                        color: AppColors.textMuted, fontSize: 13, height: 1.35)),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
