/// URL del backend Express (el mismo que el resto de APKs de Mobilink).
const String kBackendUrl = 'https://sea-tarragona.onrender.com';

/// Versión visible de la app y la que se informa a Central en cada arranque.
/// La reescribe el workflow de compilación junto con pubspec.yaml: a mano se
/// quedaba atrás (llegó a decir 0.1.0 con la 0.1.4 publicada) y Central veía a
/// todos los dispositivos en la misma versión inicial.
const String kAppVersion = '0.5.5+89';

/// Política de privacidad publicada (public/privacidad-lite.html, que Vite
/// copia a dist/ y Express sirve como estático).
///
/// Antes esto apuntaba a `/privacidad`, que no es ninguna ruta del servidor: el
/// catch-all del SPA devolvía el index.html del panel con un 200, así que el
/// enlace del perfil "funcionaba" enseñando la pantalla de login de otra
/// aplicación. Es además la URL que pide App Store Connect, y Apple la
/// comprueba a mano.
const String kPrivacyUrl = '$kBackendUrl/privacidad-lite.html';
