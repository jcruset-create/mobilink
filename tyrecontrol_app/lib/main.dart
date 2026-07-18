import 'dart:async';
import 'package:flutter/material.dart';
import 'package:connectivity_plus/connectivity_plus.dart';
import 'services/offline_store.dart';
import 'services/supabase_service.dart';
import 'models/incidencias.dart';
import 'theme/app_theme.dart';
import 'screens/home_screen.dart';
import 'screens/login_screen.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await OfflineStore.init();
  await TyreControlApi.init();

  // Catálogos de incidencia (tipos y motivos): primero lo cacheado (sirve sin
  // red), luego se refresca en segundo plano desde el servidor.
  final cacheTipos = OfflineStore.cachedJson('tipos_incidencia');
  if (cacheTipos is List) {
    aplicarCatalogoDesdeJson(cacheTipos.map((e) => Map<String, dynamic>.from(e)).toList());
  }
  final cacheMotivos = OfflineStore.cachedJson('motivos_pendiente');
  if (cacheMotivos is List) {
    aplicarMotivosDesdeJson(cacheMotivos.map((e) => Map<String, dynamic>.from(e)).toList());
  }
  unawaited(TyreControlApi.fetchTiposIncidencia().then((filas) {
    OfflineStore.cacheJson('tipos_incidencia', filas);
    aplicarCatalogoDesdeJson(filas);
  }).catchError((_) {/* sin red: se conserva lo cacheado o la semilla */}));
  unawaited(TyreControlApi.fetchMotivosPendiente().then((filas) {
    OfflineStore.cacheJson('motivos_pendiente', filas);
    aplicarMotivosDesdeJson(filas);
  }).catchError((_) {/* sin red: se conserva lo cacheado o la semilla */}));

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
