# Snake Zen — cooperativo para hasta 4 personas

Juego de serpientes en equipo con salas privadas por código. En el lobby se puede esperar hasta 4 participantes o **Empezar solo**. Todas las personas comparten el mismo marcador: cada manzana suma un punto común. Las paredes conectan; si una serpiente choca, termina la ronda para el equipo.

## Incluye

- Menú de juego con **Jugar**, **Tienda** y **Cómo se juega**.
- Crear sala o unirse con un código de seis caracteres; hasta 4 personas.
- Empezar una partida con el grupo que haya o jugar en modo solitario.
- Tablero vertical más grande en móvil, a pantalla completa; controles táctiles grandes y separados debajo del tablero, sin desplazamiento accidental.
- Flechas/WASD en ordenador, WebSocket prioritario y reconexión breve.
- Una semilla para quien come cada manzana; las skins y semillas son cosméticas y locales al navegador.

## Probar en local

Requiere Node.js 20 o posterior.

```bash
npm install
npm start
```

Abre `http://localhost:3000` en varios navegadores. El primero crea la sala; los demás escriben el código. Para probar el modo solitario, crea una sala y pulsa **Empezar solo**. `/health` comprueba que el servidor está encendido.

## Publicar en Render con GitHub

1. Sube los archivos del ZIP a la raíz del repositorio de GitHub.
2. En Render, elige **New → Blueprint**, conecta el repositorio y confirma.
3. Render usará `render.yaml`, instalará con `npm install` y arrancará con `npm start`.
4. Cuando el servicio indique **Live**, comparte la dirección `.onrender.com`.

Los archivos del juego (`index.html`, `app.js` y `styles.css`) pueden estar en la raíz o dentro de `public/`; el servidor detecta ambas formas. No los metas en una carpeta adicional.

## Notas

- Las salas viven en la memoria del servidor. Un reinicio o redeploy cierra las partidas activas.
- Render Free puede dormir cuando no se usa; la primera carga tras un rato puede tardar.
- Mantén una sola instancia del servidor. Para escalar a varias hacen falta estado compartido y un adaptador Socket.IO.
