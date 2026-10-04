# Ámbito de taller en MC Central — Entrega

Tercera fase del acceso por taller y caja. La primera cerró los agujeros de
`/api/cash`. La segunda dio a cada usuario de Mobilink Cash su taller y sus
cajas. Esta hace que **MC Central respete el taller del usuario**, en lugar
de dejar que lo elija él.

## Lo que pasaba

Central ya leía el taller del usuario (`app_usuario_modulos.centro_id`, con
módulo `central`) en `req.centralCentroId`. Sin embargo, solo lo usaba la
exportación CSV. En el resto de pantallas el taller llegaba en la URL
(`?centroId=`): un usuario limitado a Reus podía ver Tarragona cambiando un
parámetro, y la red, la posición y las incidencias salían siempre enteras.

## La regla

- **Las pantallas que se pueden recortar se recortan al taller del usuario:**
  - red: cajas, resumen y talleres;
  - posición: por caja, con el total de la suma de sus cajas y sus tránsitos;
  - desglose pieza a pieza;
  - ingresos y pendiente de ingresar;
  - jornadas;
  - exportación CSV;
  - resguardo PDF de un ingreso, que pasa por `exigirAcceso` de la caja.
- **Pedir otro taller por la URL es un 403 `TALLER_FUERA_DE_AMBITO`**, no un
  listado vacío. Un vacío haría creer que en ese taller no hay nada.
- **Lo que es de toda la red se le niega entero** (403 `SOLO_TODA_LA_RED`):
  - cambio, previsión, informes de KPIs, estado del sistema;
  - incidencias y reglas, canales;
  - integraciones, clientes de la API y webhooks;
  - extractos y conciliación;
  - organización y reemisiones.

  Son agregados de toda la red que no se pueden recortar sin reescribirlos, y
  enseñarlos a medias sería peor que no enseñarlos.

La lista que manda es la de lo **permitido** (`PARA_UN_TALLER` en
`server/central/router.ts`), no la de lo prohibido: una ruta nueva queda
cerrada para los usuarios de un taller hasta que alguien la recorte y la
añada a la lista.

En pantalla, el menú de Central esconde a esos usuarios las vistas de toda la
red. Quien tiene toda la red (`centro_id` vacío, que es lo que tiene todo el
mundo hoy) no nota ningún cambio.

## Pruebas

`server/central/ambito.http.integration.test.ts` hace las peticiones por
Express con un usuario de toda la red y otro limitado a un taller. Comprueba
cuatro cosas:

- la red y la posición, recortadas;
- el total, igual a la suma de sus cajas;
- el 403 al pedir otro taller;
- el 403 de las vistas de toda la red.
