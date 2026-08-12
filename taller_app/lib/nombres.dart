/// Comparación de nombres de técnico.
///
/// El nombre del técnico viaja por tres sitios —la columna `techs.name`, la
/// lista `assignedNames` del trabajo y lo que se teclea al entrar— y basta un
/// acento, una mayúscula o un espacio de más para que una comparación exacta
/// falle. Cuando eso pasa, el técnico ve "no tienes tareas" teniendo trabajo
/// asignado, sin ningún error que lo explique.
///
/// El backend aplica esta misma normalización (`mismoNombreTecnico` en
/// server/index.ts); aquí se repite porque la app vuelve a filtrar en local.
String normalizaNombre(String valor) {
  const conAcento = 'áàäâãéèëêíìïîóòöôõúùüûñç';
  const sinAcento = 'aaaaaeeeeiiiiooooouuuunc';

  var texto = valor.trim().toLowerCase();
  for (var i = 0; i < conAcento.length; i++) {
    texto = texto.replaceAll(conAcento[i], sinAcento[i]);
  }
  return texto;
}

bool mismoNombre(String a, String b) {
  final na = normalizaNombre(a);
  return na.isNotEmpty && na == normalizaNombre(b);
}

/// ¿Está este técnico entre los asignados al trabajo?
bool estaAsignado(List<String> asignados, String techName) =>
    asignados.any((n) => mismoNombre(n, techName));
