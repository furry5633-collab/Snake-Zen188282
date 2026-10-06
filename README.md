# Snake Zen v5

Snake Zen cooperativo online para hasta **seis personas**, con modo solitario, salas por código, controles móviles y tablero vertical. Las manzanas suman un marcador compartido; los bordes conectan y un choque termina la ronda.

## Novedades

- Cuentas con correo y contraseña; perfil con nombre y skin.
- Solicitudes de amistad, avisos e invitaciones a salas.
- Clasificación persistente con un récord independiente por cada equipo y por partida solitaria.
- Al acabar una ronda se guarda el resultado en el perfil y se actualiza el récord solo si mejora.
- **12 skins**. Con sesión iniciada, nombre, skin, semillas y desbloqueos se sincronizan entre dispositivos.
- Los iconos de jugadores abren su perfil con estadísticas e historial.

## Probar el juego

Requiere Node.js 20 o posterior.

```bash
npm install
npm start
```

Abre `http://localhost:3000`. Si no se configura Supabase, el juego sigue funcionando como invitado; las cuentas, amistades y récords compartidos muestran que necesitan configuración.

## Activar cuentas y datos compartidos con Supabase

1. Crea un proyecto gratuito en Supabase.
2. Abre **SQL Editor** y ejecuta todo el archivo `supabase/setup.sql`.
3. En **Project Settings → API**, copia la URL del proyecto y la clave **anon/public**.
4. En local, crea `.env` a partir de `.env.example` y rellena `SUPABASE_URL` y `SUPABASE_ANON_KEY`.
5. En Render, añade esas mismas variables en **Environment** y vuelve a desplegar. **No uses ni compartas `service_role`**: el juego no la necesita.
6. En **Authentication → URL Configuration**, configura `Site URL` con la dirección pública del juego (y añade la dirección local si vas a probar en tu ordenador).
7. En Authentication, revisa la opción de confirmación por correo. Si está activada, quien se registre debe confirmar el mensaje; al volver al juego, la sesión se abrirá automáticamente o podrá iniciar sesión.

La app solo entrega al navegador la clave pública `anon`; las tablas usan RLS y el SQL reserva la escritura de partidas para la función segura `record_game_result`. No subas tu `.env` a GitHub.

### Plan gratuito

El plan gratuito de Supabase puede pausar proyectos tras una semana sin actividad. Si se pausa, se reanuda desde el panel de Supabase; no se pierden las partidas guardadas. Render Free también puede dormir cuando no se usa.

## Publicar en Render

1. Descomprime el ZIP y copia el contenido de `snake-zen-coop-v5/` a la raíz de un repositorio.
2. En Render, crea un **Blueprint** con el repositorio y revisa `render.yaml`.
3. Añade `SUPABASE_URL` y `SUPABASE_ANON_KEY` en **Environment** antes de usar cuentas; sin ellas funciona el modo invitado.

Las salas activas viven en memoria y terminan si Render reinicia el servidor; las cuentas, amistades y récords quedan en Supabase. Mantén una sola instancia de este servidor. Los archivos del cliente (`index.html`, `app.js`, `social.js` y `styles.css`) pueden estar en la raíz o dentro de `public/`.
