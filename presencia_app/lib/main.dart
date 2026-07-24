import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'services/api_service.dart';
import 'screens/login_screen.dart';
import 'screens/home_screen.dart';
import 'theme.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const PresenciaApp());
}

class PresenciaApp extends StatelessWidget {
  const PresenciaApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Mobilink Presencia',
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
    _checkSession();
  }

  Future<void> _checkSession() async {
    final prefs = await SharedPreferences.getInstance();
    final employeeId = prefs.getString('employeeId') ?? '';
    final pin = prefs.getString('pin') ?? '';
    final nombre = prefs.getString('nombre') ?? '';

    if (employeeId.isNotEmpty && pin.isNotEmpty) {
      try {
        final emp = await ApiService.login(employeeId, pin);
        if (!mounted) return;
        Navigator.of(context).pushReplacement(MaterialPageRoute(
          builder: (_) => HomeScreen(
            api: ApiService(employeeId: employeeId, pin: pin),
            nombre: emp.nombreCompleto.isNotEmpty ? emp.nombreCompleto : nombre,
          ),
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
