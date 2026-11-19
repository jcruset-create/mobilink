import 'package:flutter/material.dart';
import 'services/api_service.dart';
import 'services/biometria.dart';
import 'services/offline_store.dart';
import 'services/preferencias.dart';
import 'screens/bloqueo_screen.dart';
import 'screens/login_screen.dart';
import 'screens/home_screen.dart';
import 'theme.dart';
import 'widgets/aviso_actualizacion.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await OfflineStore.init();
  runApp(const TallerApp());
}

class TallerApp extends StatelessWidget {
  const TallerApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'WorkPlanner Taller',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.build(),
      // Versión nueva publicada: franja arriba, en cualquier pantalla.
      builder: (context, child) =>
          AvisoActualizacion(app: 'taller', child: child ?? const SizedBox.shrink()),
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
    _checkSession();
  }

  Future<void> _checkSession() async {
    final sesion = await Preferencias.sesionGuardada();

    if (sesion != null) {
      // Candado biométrico, si el operario lo activó en este dispositivo. Se
      // comprueba que siga habiendo sensor y cara o huella dada de alta: si
      // se borró del móvil, se entra como siempre.
      if (await Preferencias.biometriaActivada() && await Biometria.disponible()) {
        if (!mounted) return;
        final ok = await Navigator.of(context).push<bool>(
              MaterialPageRoute(builder: (_) => const BloqueoScreen()),
            ) ??
            false;
        if (!mounted) return;
        if (!ok) {
          // No se identifica: al login. La sesión no se borra; un login
          // correcto la sustituye.
          Navigator.of(context).pushReplacement(
            MaterialPageRoute(builder: (_) => const LoginScreen()),
          );
          return;
        }
      }
      final techName = sesion.techName;
      final code = sesion.code;
      try {
        await ApiService.login(techName, code);
        final api = ApiService(techName: techName, code: code);
        final esSup = await api.esSupervisor();
        if (!mounted) return;
        Navigator.of(context).pushReplacement(MaterialPageRoute(
          builder: (_) => HomeScreen(api: api, esSupervisor: esSup),
        ));
        return;
      } catch (_) {/* sesión no válida → login */}
    }

    if (!mounted) return;
    Navigator.of(context).pushReplacement(
      MaterialPageRoute(builder: (_) => const LoginScreen()),
    );
  }

  @override
  Widget build(BuildContext context) {
    return const Scaffold(
      body: Center(child: CircularProgressIndicator(color: AppColors.primary)),
    );
  }
}
