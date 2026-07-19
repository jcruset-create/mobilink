import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'screens/login_screen.dart';

const kSupabaseUrl = 'https://qhbtpebfkckzmtdcutvv.supabase.co';
const kSupabaseAnonKey = 'sb_publishable_byCj39mPoGMOKWkjkYZxwA_HfX7PMek';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await Supabase.initialize(url: kSupabaseUrl, anonKey: kSupabaseAnonKey);
  runApp(const AlmacenApp());
}

class AlmacenApp extends StatelessWidget {
  const AlmacenApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Mobilink Almacén',
      debugShowCheckedModeBanner: false,
      theme: ThemeData.dark().copyWith(
        scaffoldBackgroundColor: const Color(0xFF1a1a2e),
        colorScheme: const ColorScheme.dark(
          primary: Colors.blue,
          surface: Color(0xFF16213e),
        ),
        useMaterial3: true,
      ),
      home: const LoginScreen(),
    );
  }
}
