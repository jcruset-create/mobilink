import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'screens/login_screen.dart';
import 'screens/assistances_screen.dart';
import 'services/api_service.dart';
import 'services/biometria.dart';
import 'services/offline_store.dart';
import 'services/sesion_segura.dart';
import 'theme/app_theme.dart';

// Notifier global accesible desde cualquier pantalla
final exteriorMode = ValueNotifier<bool>(false);

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  // La app funciona siempre en vertical (nunca horizontal). portraitDown
  // incluido porque en algunos soportes la tablet va invertida.
  await SystemChrome.setPreferredOrientations([
    DeviceOrientation.portraitUp,
    DeviceOrientation.portraitDown,
  ]);
  await OfflineStore.init(); // base de datos local (modo offline)
  final prefs = await SharedPreferences.getInstance();
  exteriorMode.value = prefs.getBool('exteriorMode') ?? false;
  runApp(const SeaApp());
}

class SeaApp extends StatelessWidget {
  const SeaApp({super.key});

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<bool>(
      valueListenable: exteriorMode,
      builder: (_, exterior, __) {
        return MaterialApp(
          title: 'Mobilink Assist',
          debugShowCheckedModeBanner: false,
          theme: AppTheme.build(exterior: exterior),
          home: const SplashScreen(),
        );
      },
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
    // Primero de todo: sacar el PIN de SharedPreferences y meterlo en el
    // Llavero. Es idempotente y en el segundo arranque no hace nada.
    await SesionSegura.migrarDesdePrefs();

    final cred = await SesionSegura.leer();
    if (cred == null) {
      _irALogin();
      return;
    }

    // ── La puerta biométrica ─────────────────────────────────────────
    //
    // Sólo se levanta si el operario la ha activado. Quien no la use entra
    // igual que antes: esto no cambia el comportamiento de nadie por sorpresa.
    if (await SesionSegura.biometriaActivada()) {
      if (!await Biometria.disponible()) {
        // La biometría se ha ido: desactivada en Ajustes, cara borrada,
        // teléfono nuevo restaurado desde copia. El interruptor se queda
        // apuntando a algo que ya no existe, así que se apaga y se pide el
        // PIN. Dejarlo puesto sería ofrecer un botón que no puede funcionar.
        await SesionSegura.desactivarBiometria();
        _irALogin();
        return;
      }

      final r = await Biometria.autenticar(
        'Accede a Mobilink Assist con tu cara o tu huella',
      );
      if (r != ResultadoBiometria.ok) {
        // Cancelado o fallido: NO se cierra la sesión ni se borra nada. Se
        // manda al operario a la pantalla de acceso, donde puede volver a
        // intentarlo con el botón o entrar con su PIN de siempre.
        _irALogin();
        return;
      }
    }

    // ── Y aquí manda el backend, con o sin biometría ─────────────────
    //
    // La cara desbloquea la credencial guardada; NO sustituye al login. Si el
    // PIN ha cambiado o el operario está dado de baja, esto falla y se acaba
    // en la pantalla de acceso, que es lo correcto: Face ID no puede saltarse
    // la autenticación del servidor.
    try {
      await ApiService.login(cred.techName, cred.code);
      if (!mounted) return;
      Navigator.of(context).pushReplacement(
        MaterialPageRoute(
          builder: (_) => AssistancesScreen(
            api: ApiService(techName: cred.techName, code: cred.code),
          ),
        ),
      );
      return;
    } catch (_) {}

    _irALogin();
  }

  void _irALogin() {
    if (!mounted) return;
    Navigator.of(context).pushReplacement(
      MaterialPageRoute(builder: (_) => const LoginScreen()),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 24),
              child: FittedBox(
                fit: BoxFit.scaleDown,
                child: Image.asset('assets/logo_horizontal2.png', width: 330),
              ),
            ),
            const SizedBox(height: 40),
            CircularProgressIndicator(color: AppColors.primary),
          ],
        ),
      ),
    );
  }
}
