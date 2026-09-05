/// URL del backend Express (el mismo que el resto de APKs de Mobilink).
const String kBackendUrl = 'https://sea-tarragona.onrender.com';

/// Versión visible de la app y la que se informa a Central en cada arranque.
/// La reescribe el workflow de compilación junto con pubspec.yaml: a mano se
/// quedaba atrás (llegó a decir 0.1.0 con la 0.1.4 publicada) y Central veía a
/// todos los dispositivos en la misma versión inicial.
const String kAppVersion = '0.4.0+73';
