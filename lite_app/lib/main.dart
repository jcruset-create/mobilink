import 'package:flutter/material.dart';
import 'screens/login_screen.dart';
import 'screens/inbox_screen.dart';
import 'services/api.dart';
import 'services/push.dart';
import 'services/queue.dart';
import 'services/session.dart';
import 'theme.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await OfflineQueue.init();
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
    if (session == null) {
      Navigator.of(context).pushReplacement(
        MaterialPageRoute(builder: (_) => const LoginScreen()),
      );
      return;
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
    return const Scaffold(
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.build_circle, size: 64, color: AppColors.primary),
            SizedBox(height: 16),
            Text('Mobilink Assist Lite',
                style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold)),
            SizedBox(height: 24),
            CircularProgressIndicator(),
          ],
        ),
      ),
    );
  }
}
