import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'screens/login_screen.dart';
import 'screens/assistances_screen.dart';
import 'services/api_service.dart';

void main() {
  runApp(const SeaApp());
}

class SeaApp extends StatelessWidget {
  const SeaApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'SEA Tarragona',
      debugShowCheckedModeBanner: false,
      theme: ThemeData.dark(),
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
    final techName = prefs.getString('techName') ?? '';
    final code = prefs.getString('code') ?? '';

    if (!mounted) return;

    if (techName.isNotEmpty && code.isNotEmpty) {
      try {
        // Verify credentials are still valid
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
      } catch (_) {
        // Credentials expired or invalid, go to login
      }
    }

    if (!mounted) return;
    Navigator.of(context).pushReplacement(
      MaterialPageRoute(builder: (_) => const LoginScreen()),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF1a1a2e),
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Image.asset('assets/logo_transparent.png', width: 260),
            const SizedBox(height: 40),
            const CircularProgressIndicator(color: Colors.white54),
          ],
        ),
      ),
    );
  }
}
