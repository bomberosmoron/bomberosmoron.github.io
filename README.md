# Plataforma de Bomberos Voluntarios de Morón

Web única del cuartel. Se entra una sola vez con **legajo y clave**, y desde la pantalla de inicio se elige la app:

- **Guardias**: carga de guardias diurnas y nocturnas del mes siguiente, calendario imprimible, encargado y ayudante.
- **Guardias de Fiestas**: anotarse en Nochebuena, Navidad, Fin de Año y Año Nuevo con la cantidad de familiares; la jefatura ve totales y detalle, exporta y abre o cierra la anotación.
- **HidraMap**: relevamiento de hidrantes con foto y GPS, mapa de todos los hidrantes y "Mis cargas". Los administradores importan el historial y exportan a Google My Maps.

Funciona sobre **GitHub Pages** (la web) y **Supabase** (login, base de datos, fotos y tiempo real), todo en planes gratis.

## Cuentas y permisos

1. Cada persona toca **Crear cuenta** y carga nombre, apellido, legajo (147/…), dependencia, mail de contacto y clave.
2. La cuenta queda **pendiente**. La persona ve un aviso y no puede usar ninguna app.
3. Un **administrador de la plataforma** entra a **Usuarios y permisos**, abre la cuenta, elige el permiso en cada app (**Sin acceso**, **Usuario** o **Admin**) y toca **Aprobar cuenta**.
4. Desde ese momento, la persona entra con su **legajo y clave** y ve solo las apps habilitadas.

| Rol en la plataforma | Qué puede hacer |
|---|---|
| Usuario | Usar las apps que tiene habilitadas |
| Administrador | Además aprobar, rechazar, dar de baja y reactivar cuentas, y asignar los permisos de cada app |
| Superusuario | Además nombrar administradores; tiene acceso de administrador a todas las apps |

- **Admin dentro de una app** es otra cosa: por ejemplo, el admin de Guardias ve el calendario y asigna encargados.
- Nadie puede cambiar su propia cuenta desde la pantalla Usuarios, y solo un superusuario puede tocar a otro superusuario.
- Después de 5 claves incorrectas seguidas, el legajo queda bloqueado 15 minutos.

## Puesta en marcha

Se usa el **mismo proyecto de Supabase que ya tiene Guardias** ("Guardias BVM"). Los usuarios y las guardias actuales se conservan.

### 1. Base de datos
En Supabase, **SQL Editor**, ejecutá en orden (las migraciones 001 a 005 ya están ejecutadas):
1. `supabase/migrations/006_plataforma.sql`: login único y permisos por app.
2. `supabase/migrations/007_hidramap.sql`: HidraMap (tabla de hidrantes y carpeta de fotos "hidrantes").
3. `supabase/migrations/008_fiestas.sql`: Guardias de Fiestas, temporada 2026/2027. Para el año siguiente, cambiá las fechas al principio del archivo y vaciá la tabla `fiestas_reservas`.

La migración hace esto:
- Las cuentas que ya existían quedan **activas** y con acceso a **Guardias**.
- Quien era admin de Guardias sigue siéndolo en Guardias.
- El superusuario sigue siendo superusuario.
- Las cuentas nuevas arrancan **pendientes**.

Conviene ejecutarla el mismo día que se publica la plataforma (paso 2). Las cuentas que se creen en la web vieja de Guardias después de la migración quedan pendientes, y esa web no lo explica.

### 2. Repositorio y publicación
1. En GitHub, con la cuenta **bomberomoron**, creá un repositorio **público** llamado exactamente `bomberomoron.github.io`. Ese nombre hace que la web quede en `https://bomberomoron.github.io/`.
2. Subí todo el contenido de esta carpeta, **incluida la carpeta oculta `.github`**.
3. En **Settings > Pages > Source**, elegí **GitHub Actions**.
4. En **Settings > Secrets and variables > Actions > Variables**, cargá las mismas dos variables que en el repo de Guardias:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
5. En **Actions**, abrí **Publicar en GitHub Pages** y tocá **Run workflow**.

La página vieja `bomberomoron.github.io/hidramap` sigue funcionando hasta que la cambies (ver paso 5).

### 3. Supabase: dirección de la web
En **Authentication > URL Configuration**:
- **Site URL**: `https://bomberomoron.github.io/`
- **Redirect URLs**: agregá `https://bomberomoron.github.io/**`

Sin esto, el enlace de "Me olvidé la clave" vuelve a la web vieja.

### 4. Web vieja de Guardias
Cuando la plataforma esté funcionando, conviene que `bomberomoron.github.io/guardias` redirija a la plataforma: en el repo `guardias`, reemplazá el contenido por un `index.html` que redirija a `https://bomberomoron.github.io/#guardias`. Si querés, lo preparo.

### 5. Pasar HidraMap a la plataforma
1. Dale permiso de **HidraMap** a cada persona desde **Usuarios y permisos**: **Usuario** para cargar y ver el mapa, **Admin** para importar y exportar.
2. **Importá el historial:** en la planilla "BDD HidraMap BVM", abrí la hoja **Hidrantes** y elegí **Archivo > Descargar > Valores separados por comas (.csv)**. Después, en la plataforma, entrá a **HidraMap > Mapa > Importar el historial** y elegí ese archivo.
   - Se respetan el código, la ubicación, el tipo, el estado, la fecha, quién lo cargó y la precisión de cada hidrante.
   - La foto queda como link a Drive, así que esas fotos tienen que seguir compartidas como "cualquiera con el link".
   - Si importás dos veces el mismo archivo, no se duplica nada.
3. Avisá al personal que desde ahora se carga en la plataforma. Después, en el repo `hidramap`, reemplazá la página por una redirección a `https://bomberomoron.github.io/#hidramap`, y dejá de usar la Web App de Apps Script y AppSheet.
4. **Mapa público:** en **HidraMap > Mapa > Descargar KML**, y en Google My Maps, importá ese archivo en una capa nueva.

Las fotos nuevas se guardan en Supabase Storage. El plan gratis tiene 1 GB, y cada foto pesa unos 150 a 300 KB, así que alcanza para varios miles.

### 6. Guardias de Fiestas
1. En **Guardias de Fiestas > Resumen de la jefatura**, un administrador de la plataforma toca **Habilitar a todas las cuentas activas**. Así todos la ven sin tener que darla persona por persona.
2. A quienes van a ver el detalle, darles **Admin** en Guardias de Fiestas desde **Usuarios y permisos**.
3. Cuando cierre la anotación, tocar **Cerrar la anotación**: desde ese momento nadie puede anotarse, cambiar ni cancelar.
4. La Web App vieja de Apps Script y su planilla se pueden dejar de usar.

## Accesos directos
La dirección admite `#guardias`, `#calendario`, `#fiestas`, `#fiestas-resumen`, `#hidramap`, `#hidramap-mapa`, `#hidramap-mias`, `#usuarios` y `#cuenta`. Por ejemplo, `https://bomberomoron.github.io/#guardias` abre Guardias directamente después de ingresar.

## Instalar en el celular
Abrí la web en el celular y elegí **Agregar a la pantalla de inicio**. Queda con el escudo como ícono y el nombre "Bomberos Morón".

## Probar en tu computadora
```bash
npm install
npm run dev
```
Sin el archivo `.env` arranca en **modo demostración**: entrás con cualquier legajo, como superusuario, y nada se guarda.

## Estructura
```
src/
  App.tsx            sesión, estado de la cuenta y navegación (#hash)
  Login.tsx          ingresar con legajo, crear cuenta, recuperar clave
  Home.tsx           inicio con las apps habilitadas; aviso de cuenta pendiente
  apps.ts            lista de apps de la plataforma
  Users.tsx          usuarios: aprobación, permisos por app, rol en la plataforma
  MyData.tsx         mi cuenta: datos, permisos, cambio de clave
  Roster.tsx         Guardias: carga del mes y resumen
  Calendar.tsx       Guardias: calendario imprimible, encargado y ayudante
  hidramap/          HidraMap: cargar (GPS, foto), mapa, mis cargas, importar y exportar
  fiestas/           Guardias de Fiestas: anotarme, resumen de la jefatura
  lib/api.ts         conexión con Supabase (y modo demostración)
supabase/
  migrations/        001 a 008
  functions/         envío del mail de Guardias (pendiente de configurar con Brevo)
```
