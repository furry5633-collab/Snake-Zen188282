# Snake Zen — multijugador cooperativo

Snake para dos personas con salas privadas por código. El modo Zen es el modo predeterminado: comed manzanas, atravesad los bordes y llenad el tablero en equipo. Si una serpiente choca, pierde la ronda.

## Qué incluye

- Menú sencillo con **Jugar**, **Tienda** y **Cómo se juega**.
- En **Jugar**: crear una sala o unirse con un código de seis caracteres.
- Sala de espera con nombres, código para compartir y botón para empezar.
- Tablero y controles táctiles separados en móvil; teclado con flechas o WASD en ordenador.
- Actualizaciones en tiempo real con Socket.IO y reanudación breve si alguien pierde la conexión.
- Tienda cosmética: una semilla por manzana; las semillas se guardan en ese dispositivo.

## Probar en local

Requiere Node.js 20 o posterior.

```bash
npm install
npm start
```

Abre `http://localhost:3000` en dos navegadores. Una persona crea la sala y la otra introduce su código. El servidor también responde en `/health`.

## Publicar en Render con GitHub

1. Sube los archivos de este proyecto a la raíz de un repositorio de GitHub.
2. En Render, elige **New → Blueprint**, conecta el repositorio y confirma.
3. Render usará `render.yaml`: instalará con `npm install` y arrancará con `npm start`.
4. Cuando el servicio indique **Live**, abre su dirección `.onrender.com` y comparte esa dirección con tu compañero.

Los archivos del juego (`index.html`, `app.js` y `styles.css`) pueden estar en la raíz o dentro de `public/`; el servidor detecta ambas formas. Así se evita el error de pantalla blanca si la subida deja los archivos en la raíz.

## Notas importantes

- Las salas viven en la memoria del servidor. Un reinicio o redeploy cierra las partidas activas.
- Render Free puede dormir cuando no se usa; la primera carga después de un rato puede tardar bastante.
- Mantén una sola instancia. Para escalar a varias hacen falta estado compartido y un adaptador Socket.IO.
- Tienda, semillas y skins son locales al navegador; no hace falta crear cuentas.
