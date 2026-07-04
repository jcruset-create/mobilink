import 'package:flutter/material.dart';
import 'package:connectivity_plus/connectivity_plus.dart';
import 'services/offline_store.dart';
import 'services/supabase_service.dart';
import 'theme/app_theme.dart';
import 'screens/home_screen.dart';
import 'screens/login_screen.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await OfflineStore.init();
  await TyreControlApi.init();

  // En cuanto detectamos red, intentamos vaciar la cola sola.
  Connectivity().onConnectivityChanged.listen((results) {
    final sinRed = results.every((r) => r == ConnectivityResult.none);
    OfflineStore.offline.value = sinRed;
    if (!sinRed) OfflineStore.flush();
  });

  runApp(const TyreControlApp());
}

class TyreControlApp extends StatelessWidget {
  const TyreControlApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'SEA TyreControl',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.build(),
      home: TyreControlApi.hasSession ? const HomeScreen() : const LoginScreen(),
    );
  }
}
