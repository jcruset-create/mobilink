import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'screens/login_screen.dart';
import 'screens/assistances_screen.dart';
import 'services/api_service.dart';
import 'services/offline_store.dart';
import 'theme/app_theme.dart';

// Notifier global accesible desde cualquier pantalla
final exteriorMode = ValueNotifier<bool>(false);

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
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
          title: 'SEA Tarragona',
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
    final prefs = await SharedPreferences.getInstance();
    final techName = prefs.getString('techName') ?? '';
    final code = prefs.getString('code') ?? '';

    if (!mounted) return;

    if (techName.isNotEmpty && code.isNotEmpty) {
      try {
        await ApiService.login(techName, code);
        if (!mounted) return;
        Navigator.of(context).pushReplacement(
          MaterialPageRoute(
            builder: (_) => AssistancesScreen(
              api: ApiService(techName: techName, code: code),
            ),
          ),
        );
        return;
      } catch (_) {}
    }

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
            Image.asset('assets/logo_transparent.png', width: 260),
            const SizedBox(height: 40),
            CircularProgressIndicator(color: AppColors.primary),
          ],
        ),
      ),
    );
  }
}
