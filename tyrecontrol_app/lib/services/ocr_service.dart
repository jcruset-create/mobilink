import 'dart:convert';
import 'package:image_picker/image_picker.dart';
import 'package:http/http.dart' as http;
import '../config.dart';
import 'supabase_service.dart';

/// Reconocimiento de matricula por foto. Pasa por el backend Node
/// (server/) porque necesita la clave de OpenAI, que no puede vivir en
/// el movil. Todo lo demas de esta app habla directo con Supabase.
/// Lo que devuelve la foto de una matrícula: lo leído, qué caracteres ha
/// leído con duda la IA y dónde ha quedado guardada la foto (el alta la guarda
/// en el vehículo como prueba).
class LecturaMatricula {
  final String? matricula;
  final List<int> dudosos;
  final String? fotoPath;
  const LecturaMatricula({this.matricula, this.dudosos = const [], this.fotoPath});
}

class OcrService {
  static Future<String?> reconocerMatricula(XFile foto) async =>
      (await leerMatricula(foto)).matricula;

  static Future<LecturaMatricula> leerMatricula(XFile foto) async {
    final token = TyreControlApi.currentSessionToken;
    if (token == null) throw Exception('Sesión no válida');

    final req = http.MultipartRequest('POST', Uri.parse('$kBackendUrl/api/tyrecontrol/scan-plate'));
    req.headers['Authorization'] = 'Bearer $token';
    req.files.add(http.MultipartFile.fromBytes('file', await foto.readAsBytes(), filename: foto.name.isEmpty ? 'matricula.jpg' : foto.name));
    final streamed = await req.send().timeout(const Duration(seconds: 40));
    final body = await streamed.stream.bytesToString();
    if (streamed.statusCode != 200) throw Exception('Error reconociendo matrícula');
    final data = jsonDecode(body) as Map<String, dynamic>;
    return LecturaMatricula(
      matricula: data['plate'] as String?,
      dudosos: [for (final d in (data['dudosos'] as List? ?? const [])) if (d is int) d],
      fotoPath: data['fotoPath'] as String?,
    );
  }
}
