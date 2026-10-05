# Snake Zen · multijugador cooperativo

Juego de Snake para dos personas, con salas privadas por código y modo Zen como modo predeterminado. El servidor es autoritativo: calcula movimientos, manzanas, colisiones, reconexiones y el final de la partida.

## Incluye

- Crear una sala privada y compartir un código de seis caracteres, o unirse con ese código.
- Partidas cooperativas para dos. Cada serpiente crece al comer; si una choca, la ronda termina. Si llenáis todas las casillas, ganáis en equipo.
- Las paredes conectan: se sale por un borde y se reaparece por el opuesto.
- Controles con flechas o WASD, más cruceta táctil en móvil.
- Pausa breve y reanudación si alguien pierde la conexión; el servidor conserva la sala durante la ventana de reconexión.
- Tienda cosmética: se gana una semilla por cada manzana y se desbloquean skins. Semillas y skins se guardan en el navegador de cada jugador.
- Revancha en la misma sala mientras sigan conectados los dos jugadores.

## Ejecutar en local

Requiere Node.js 20 o posterior.

```bash
npm install
npm start
```

Abre `http://localhost:3000` en dos ventanas o dispositivos. Una persona crea la sala y comparte el código con la otra.

## Publicar en Render

Render no despliega un servidor Node subiendo un ZIP directamente: el Web Service normal se conecta a un repositorio Git, o puedes construir un contenedor Docker y publicar la imagen en un registro. Elige una de estas rutas:

### Sin GitHub: publicar una imagen Docker

El proyecto incluye `Dockerfile` y `.dockerignore`. Esta ruta no necesita GitHub, pero sí Docker y un registro de imágenes como Docker Hub.

1. Descarga y descomprime el ZIP del proyecto; instala Docker Desktop y crea/inicia sesión en Docker Hub.
2. En la carpeta del proyecto, abre una terminal e inicia sesión:

   ```bash
   docker login
   ```

3. Sustituye `TU_USUARIO` por tu usuario de Docker Hub y crea/sube la imagen para Linux AMD64:

   ```bash
   docker buildx build --platform linux/amd64 -t TU_USUARIO/snake-zen:1.0 --push .
   ```

   En Docker Hub, deja el repositorio como **Public** para que Render pueda descargarlo sin credenciales.

4. En Render, pulsa **New → Web Service**. En **Source Code**, elige **Existing Image** y conecta `docker.io/TU_USUARIO/snake-zen:1.0`.
5. Elige el plan y región; en **Advanced**, pon `/health` como **Health Check Path**. Pulsa **Deploy Web Service**.
6. Al terminar, abre la URL HTTPS de Render. El servidor lee el puerto que Render inyecta automáticamente y Socket.IO funciona en el mismo dominio.

Para una actualización, vuelve a crear/subir una etiqueta de imagen nueva y lanza un deploy de esa imagen desde Render.

### Con Git (Blueprint)

El proyecto incluye `render.yaml` como configuración de Blueprint. Render admite repositorios conectados de GitHub, GitLab, Bitbucket y Cursor Origin; si no quieres GitHub, puedes usar otro proveedor compatible.

1. Sube el proyecto a un repositorio de un proveedor admitido.
2. En Render, elige **New → Blueprint** y conecta el repositorio.
3. Revisa el servicio `snake-zen` y confirma el despliegue. Render instalará dependencias con `npm install` y arrancará con `npm start`.

También puedes crear un **Web Service** manualmente con runtime Node, `npm install` como Build Command y `npm start` como Start Command. `/health` sirve como comprobación de salud.

### Notas de despliegue

- Las salas y partidas viven en la memoria del proceso. Un reinicio o redeploy cierra las salas activas; esto mantiene el proyecto sencillo y no requiere base de datos.
- Para este diseño, usa una sola instancia del servidor. Si más adelante escalas a varias instancias, habrá que añadir un adaptador compartido de Socket.IO (por ejemplo, Redis) y estado compartido de salas.
- En el plan gratuito de Render el servicio puede suspenderse cuando está inactivo; una partida activa depende de que la instancia siga ejecutándose. Para disponibilidad continua, elige un plan siempre activo.
- La moneda y las skins son cosméticas y se guardan localmente en el dispositivo, no en una cuenta del servidor.

## Comprobaciones rápidas

```bash
npm run check
curl http://localhost:3000/health
```

Después, prueba en dos navegadores: crear sala, unirse con el código, iniciar, girar en ambos lados, atravesar los bordes, comer manzanas, chocar y probar la reconexión/revancha.
