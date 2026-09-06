import 'package:flutter/material.dart';
import 'screens/bloqueo_screen.dart';
import 'screens/login_screen.dart';
import 'screens/inbox_screen.dart';
import 'screens/onboarding_screen.dart';
import 'services/api.dart';
import 'services/biometria.dart';
import 'services/file_queue.dart';
import 'services/preferencias.dart';
import 'services/push.dart';
import 'services/queue.dart';
import 'services/session.dart';
import 'theme.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await OfflineQueue.init();
  await FileQueue.init();
  // No bloquea el arranque: si Firebase no está configurado, Push.init() lo
  // registra y la app se queda con el sondeo de la bandeja.
  await Push.init();
  runApp(const LiteApp());
}

class LiteApp extends StatelessWidget {
  const LiteApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Mobilink Assist Lite',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.build(),
      home: const SplashScreen(),
    );
  }
}

class SplashScreen extends StatefulWidget {
  const SplashScreen({super.key});

  @override
  State<SplashScreen> createState() => _SplashScreenState();
}

class _SplashScreenState extends State<SplashScreen> {
  @override
  void initState() {
    super.initState();
    _restore();
  }

  Future<void> _restore() async {
    final session = await Session.restore();
    if (!mounted) return;

    // Sin sesión: primera apertura → condiciones (que es donde se pide la
    // ubicación); si ya se aceptaron, directo al login.
    if (session == null) {
      final aceptado = await Preferencias.onboardingHecho();
      if (!mounted) return;
      Navigator.of(context).pushReplacement(MaterialPageRoute(
        builder: (_) => aceptado ? const LoginScreen() : const OnboardingScreen(),
      ));
      return;
    }

    // Quien ya tenía sesión abierta antes de que existiera esta pantalla no
    // tiene que pasar por ella: aceptó y concedió el permiso en su día.
    if (!await Preferencias.onboardingHecho()) {
      await Preferencias.marcarOnboarding();
    }

    // Candado biométrico, si el operario lo activó en este dispositivo. Se
    // comprueba que siga habiendo sensor y huella dada de alta: si se borró
    // la huella del móvil, se entra como siempre en vez de dejar la app
    // inservible.
    if (await Preferencias.biometriaActivada() && await Biometria.disponible()) {
      if (!mounted) return;
      final ok = await Navigator.of(context).push<bool>(
            MaterialPageRoute(builder: (_) => const BloqueoScreen()),
          ) ??
          false;
      if (!mounted) return;
      if (!ok) {
        // No se identifica: al login. La sesión NO se borra —el token sigue
        // válido y las operaciones pendientes con él— y un login correcto la
        // sustituye sin más.
        Navigator.of(context).pushReplacement(
          MaterialPageRoute(builder: (_) => const LoginScreen()),
        );
        return;
      }
    }
    // La sesión se valida contra el servidor: si el taller ha revocado el
    // dispositivo o cambiado el PIN, se vuelve al login.
    try {
      final api = Api(session.token);
      final me = await api.me();
      session.config = (me['config'] as Map).cast<String, dynamic>();
      session.user = (me['user'] as Map).cast<String, dynamic>();
      if (me['workshop'] != null) {
        session.workshop = (me['workshop'] as Map).cast<String, dynamic>();
      }
      await session.save();
      if (!mounted) return;
      Navigator.of(context).pushReplacement(
        MaterialPageRoute(builder: (_) => InboxScreen(session: session)),
      );
    } on ApiError catch (e) {
      if (!mounted) return;
      if (e.isAuth) await Session.clear();
      Navigator.of(context).pushReplacement(
        MaterialPageRoute(builder: (_) => const LoginScreen()),
      );
    } catch (_) {
      // Sin conexión: se entra igualmente con los datos guardados y la app
      // trabaja en modo offline hasta que vuelva la cobertura.
      if (!mounted) return;
      Navigator.of(context).pushReplacement(
        MaterialPageRoute(builder: (_) => InboxScreen(session: session)),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            // La misma portada que el login: el logotipo, sin repetir el
            // nombre debajo en texto.
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 32),
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 340),
                child: Image.asset(
                  'assets/logo_horizontal.png',
                  fit: BoxFit.contain,
                  semanticLabel: 'Mobilink Assist Lite',
                ),
              ),
            ),
            const SizedBox(height: 28),
            const CircularProgressIndicator(),
          ],
        ),
      ),
    );
  }
}
