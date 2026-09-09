/**
 * Adaptador para desplegar este backend en Vercel.
 *
 * ESTE ARCHIVO ES DE ENSAYO Y NO SE USA EN LA VM. Allá el servidor arranca por
 * systemd con `node src/server.js`, que es un proceso largo y normal; aquí en
 * cambio Vercel invoca una función por petición. Sirve para probar la
 * aplicación sobre HTTPS real —el login de Google, la cookie Secure, Neon— sin
 * depender todavía de nginx, SELinux ni el cortafuegos.
 *
 * Diferencias que conviene tener presentes al leer los resultados:
 *
 *  - Cada instancia fría arranca vacía, así que cualquier caché en memoria
 *    rinde mucho menos que en la VM y el horario tarda más en aparecer.
 *  - El límite de peticiones de @fastify/rate-limit guarda su cuenta en
 *    memoria: con varias instancias, el tope efectivo se multiplica.
 *
 * O sea: si algo funciona aquí, en la VM funcionará mejor. Al revés no.
 */

let promesaApp;

function obtenerApp() {
  if (!promesaApp) {
    promesaApp = (async () => {
      // La URL pública tiene que coincidir EXACTAMENTE con la registrada en
      // Google Cloud Console, porque de ella se deriva el callback de OAuth.
      // Si no se define a mano, se usa la URL estable del proyecto (y no la de
      // cada despliegue, que cambia y no serviría para el login).
      if (!process.env.PUBLIC_BASE_URL && process.env.VERCEL_PROJECT_PRODUCTION_URL) {
        process.env.PUBLIC_BASE_URL = `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
      }

      const { buildServer } = await import('../src/server.js');
      const { validateConfig } = await import('../src/config.js');

      // start() aborta el proceso si la configuración es inválida, pero aquí no
      // pasa por start(). Sin esta comprobación, una variable de entorno que
      // falte se manifestaría como un 500 opaco en la primera petición.
      const estado = validateConfig();
      if (estado.errors.length > 0) {
        throw new Error(
          'Configuración incompleta en Vercel:\n  - ' + estado.errors.join('\n  - ')
        );
      }

      const app = await buildServer();
      await app.ready();
      return app;
    })();
  }

  return promesaApp;
}

export default async function handler(peticion, respuesta) {
  const app = await obtenerApp();
  app.server.emit('request', peticion, respuesta);
}
