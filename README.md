# Microservicios · Asilo de Ancianos "Cabeza de Algodón"

**Eddinson Artemio Ovalle López — 3090-23-20497**
Análisis y Diseño de Sistemas II · Universidad Mariano Gálvez de Guatemala · Centro Regional de Mazatenango

Seis contenedores: tres microservicios de dominio, un **gateway con inicio de
sesión** que es la única puerta de entrada, la aplicación base que los consume
y una instancia de **MySQL 8.4** con una base separada por servicio. Todo el
conjunto se levanta con **un solo comando**.

---

## 1. Qué se construyó y por qué

El proyecto final del asilo tiene un punto que ningún módulo administrativo
cubre por sí solo: **la seguridad del medicamento** y **el control de caja**.
La ficha médica pide registrar "medicamento aplicado, cantidad y tiempo de
aplicación", y el enunciado exige un "Módulo de Entradas, Salidas y Manejo de
Caja" que cargue a cada familiar el costo de consultas, laboratorio y
farmacia con el descuento de la fundación. En un asilo, además, la población
es geriátrica, polimedicada y con psicopatologías: es justo donde ocurren los
errores de medicación, y donde una cuenta mal llevada le cuesta dinero real a
alguien.

De ahí salieron los tres microservicios de dominio, más el gateway que los
protege:

| Servicio | Responsabilidad única | Puerto interno |
|---|---|---|
| **ms-vigia** | Dictaminar si un medicamento es seguro para *ese* interno: alergias, interacciones, duplicidad terapéutica, criterios geriátricos y dosis máxima. Devuelve veredicto, puntaje de riesgo y folio. | 8081 |
| **ms-pastillero** | Convertir la indicación médica ("500 mg cada 8 horas por 3 días") en tomas con hora y turno, y registrar quién administró cada una, quién la omitió y por qué. | 8082 |
| **ms-caja** *(nuevo)* | El "Módulo de Entradas, Salidas y Manejo de Caja" del enunciado: tarifario con descuento de la fundación, cargos a la cuenta del familiar, pagos y abonos, donaciones, gastos operativos y el saldo con la fundación. | 8083 |
| **ms-gateway** *(nuevo)* | Puerta única de entrada: inicia sesión, firma un JWT, y reenvía cada petición al microservicio que corresponde solo si el rol de quien la hace lo permite. | 8080 (publicado) |

`ms-pastillero` **no programa** un tratamiento si `ms-vigia` lo dictaminó
como `BLOQUEADO`: esa llamada es el primer punto de integración entre
microservicios. El segundo es de otra naturaleza: `ms-gateway` no habla con
la base de datos de nadie, solo decide **quién puede entrar y a qué**, y le
reenvía la petición tal cual al servicio dueño de esos datos.

---

## 2. Cómo encaja con lo que ya se entregó del curso

- **Tarea de diseño arquitectónico (N-Tiers).** Los tres microservicios de
  dominio viven en la *capa de negocio*. La capa de presentación (React, en
  el proyecto final) ya no les habla directo: pasa por `ms-gateway`, que es
  el patrón *API Gateway* de un diseño de microservicios — un único punto de
  entrada, autenticación centralizada, y ningún servicio de dominio expuesto
  directamente al navegador. Cada microservicio de dominio tiene su propia
  base de datos (patrón *database per service*), lo que permite desplegarlos
  y escalarlos por separado.
- **Tarea sobre el Principio de Responsabilidad Única.** Un microservicio es
  el SRP aplicado al nivel del despliegue: `ms-vigia` tiene una sola razón
  para cambiar (que cambie el criterio clínico), `ms-pastillero` tiene otra
  (que cambie la forma de administrar y registrar tomas), `ms-caja` tiene la
  suya (que cambien las tarifas o la política de cobro) y `ms-gateway` tiene
  la suya propia y distinta a todas: que cambie la política de acceso —
  quién puede autenticarse y qué rol hace qué. Si mañana el asilo cambia de
  proveedor de farmacia o de banco, solo se toca el servicio dueño de eso.
- **Proyecto final.** `ms-pastillero` alimenta el campo "medicamento
  aplicado, cantidad y tiempo de aplicación" de la ficha médica y el
  "reporte de medicamentos aplicados por paciente". `ms-vigia` deja bitácora
  de cada dictamen, que se suma al "reporte de análisis médicos por
  paciente". `ms-caja` cubre el módulo de caja completo del enunciado: costo
  de cada cita con exámenes y medicamentos, cobros por paciente por rango de
  fecha, pagos a la fundación, y entradas de donaciones y cobros.
  `ms-gateway` es el mecanismo de control de acceso que cualquier sistema
  real necesita antes de exponerse a producción, y que el enunciado da por
  hecho al pedir "el link o la instalación del programa" en el manual de
  usuario.

---

## 3. Arquitectura del conjunto

```
                  navegador  ->  http://localhost:8090   (unico puerto que
                                      |                   abre el navegador)
                      +-----------------------------------+
                      |   estacion-web  (nginx)           |  contenedor 1
                      |   sirve la interfaz y reenvia     |
                      |   todo a ms-gateway               |
                      +----------------+------------------+
                                       |  /api /vigia /pastillero /caja
                                       v
                      +-----------------------------------+
                      |            ms-gateway             |  contenedor 2
                      |  login + JWT + revocacion +       |  puerto 8080
                      |  matriz de acceso por rol         |  (publicado)
                      +---+-------------+-------------+---+
                         /vigia      /pastillero    /caja
                          |             |             |
     +--------------------v--+  +-------v----------+  +v-------------------+
     |       ms-vigia         |  |  ms-pastillero   |  |      ms-caja       |
     |   farmacovigilancia    |  | padron + plan    |  | entradas, salidas  |
     |    Python + Flask      |  | Python + Flask   |  |  Python + Flask    |
     +---+----------------^---+  +--^-----------+---+  +--------+-----------+
         |  |             |         |           |               |
         |  |             +---------+           |               |
         |  |              (1) el dictamen      |               |
         |  +------------------------------------+              |
         |          (2) la ficha del interno                    |
         |                       |                              |
         | usr_vigia             | usr_pastillero               | usr_caja
         v                       v                              v
     +------------------------------------------------------------------+
     |                     bd-asilo   ·   MySQL 8.4                      |
     |                                                                   |
     |   asilo_vigia      asilo_pastillero        asilo_caja             |
     |   validaciones     internos, planes,       cargos, pagos,         |
     |                    tomas                   donaciones, gastos,    |
     |                                            pagos_fundacion        |
     |                                                                   |
     |   Tres bases separadas, un usuario por servicio, y ningun usuario  |
     |   con permiso sobre la base de otro.       sin puerto al host      |
     +------------------------------------------------------------------+
        contenedor 3, 4 y 5 arriba (sin puerto al host) · contenedor 6 aqui
```

Los dos puntos de integracion entre microservicios estan numerados arriba:

1. **`ms-pastillero` -> `ms-vigia`**: antes de programar un tratamiento le pide
   el dictamen por folio. Si el veredicto fue `BLOQUEADO`, responde `409` y no
   programa nada.
2. **`ms-vigia` -> `ms-pastillero`**: antes de dictaminar le pide la ficha del
   interno (edad, alergias, psicopatologias y medicacion activa), porque ese
   dato no puede venir del navegador. Si no responde, `ms-vigia` devuelve `503`
   y no dictamina a ciegas.

Es una dependencia en los dos sentidos, y esta asumida a proposito: ver la
decision de diseño mas abajo, donde tambien se explica por que **no** genera un
ciclo al levantar el stack.

Red interna `asilo` de Docker. Los servicios se encuentran por **nombre de
servicio** (`http://ms-vigia:8081`), no por IP.

**Al equipo anfitrión solo se le publican dos puertos: el 8090 de la estación
web y el 8080 del gateway.** `ms-vigia`, `ms-pastillero` y `ms-caja` no tienen
bloque `ports:` en el `docker-compose.yml`: viven únicamente dentro de la red
interna. Antes sí lo tenían, y eso hacía del gateway un adorno — bastaba un
`POST` a `http://localhost:8083/api/v1/donaciones` para meter una donación
inventada en los libros del asilo sin haber iniciado sesión nunca.

### Cómo se protege cada ruta

`ms-gateway` exige una sesión iniciada (`Authorization: Bearer <token>`) para
**cualquier** ruta de los tres microservicios de dominio, y hace cumplir esta
matriz. Se controla la lectura y no solo la escritura: en un sistema de salud,
quién puede *ver* la historia clínica o el estado financiero de una familia
importa tanto como quién puede modificarlos.

| Ruta detrás del gateway | Quién puede leer (GET) | Quién puede escribir |
|---|---|---|
| `/vigia/*`      | `MEDICO`, `ENFERMERIA` | solo `MEDICO` (dictaminar una prescripción es un acto clínico) |
| `/pastillero/*` | `MEDICO`, `ENFERMERIA` | `MEDICO` o `ENFERMERIA` (programar, administrar, omitir) · **suspender: solo `MEDICO`** |
| `/caja/*`       | `ADMINISTRACION` | solo `ADMINISTRACION` (cargos, pagos, donaciones, gastos) |

**Dos excepciones, las dos documentadas y las dos solo de lectura:**

1. `GET /caja/api/v1/pacientes/{id}/cuenta` la puede leer también el `MEDICO`.
   Antes de indicar un estudio de laboratorio necesita saber si el familiar
   responsable puede costearlo; sin ese dato terminaría indicando exámenes que
   nunca se van a hacer. Alcanza solo la cuenta de un interno concreto: el
   médico no ve el resumen financiero del asilo, ni las donaciones, ni los
   gastos, ni la cuenta con la fundación.
2. `GET /pastillero/api/v1/internos` la puede leer también `ADMINISTRACION`,
   porque le cobra a la familia de cada interno y necesita saber a quién tiene
   el asilo y quién es el familiar responsable. Pero `ms-pastillero` le
   responde la ficha **sin la parte clínica**: sin psicopatologías, sin
   alergias y sin medicación. Saber que Rosalía está internada aquí es un dato
   administrativo; saber que tiene demencia mixta es un dato clínico. Y las
   tomas, los planes y la adherencia le siguen respondiendo `403`.

**Por qué suspender un tratamiento es solo del médico.** Suspender no es
registrar lo que pasó: es cambiar la indicación. Enfermería puede consignar
que una toma no se dio y por qué —para eso está *omitir*, que exige motivo—,
pero retirarle el medicamento a un interno de aquí en adelante revoca una
decisión clínica, y esa la toma quien la firmó. Antes la interfaz solo le
mostraba el botón al médico mientras la API se lo permitía a enfermería: las
dos partes decían cosas distintas, y la que mandaba era la API. Ahora la regla
está en el gateway, en `ms-pastillero` y en la interfaz, las tres iguales.

### Defensa en profundidad

La misma matriz está implementada **dos veces**: en `ms-gateway` y otra vez
dentro de cada microservicio, en un `@app.before_request` que vuelve a
verificar la firma del token con `PyJWT` usando el mismo secreto. No es
duplicación por descuido: si alguien alcanza la red interna del stack y llama
directo a `http://ms-caja:8083` saltándose el gateway, el microservicio le
vuelve a preguntar quién es. Se comprueba así:

```bash
docker run --rm --network asilo-cabeza-de-algodon_asilo curlimages/curl \
  -s -o /dev/null -w "%{http_code}\n" \
  -X POST http://ms-caja:8083/api/v1/donaciones \
  -H 'Content-Type: application/json' \
  -d '{"donante":"ATACANTE","tipo":"EMPRESA","monto":99999}'
# 401
```

La única ruta que no exige token es `/salud`, que no expone ningún dato del
asilo y la consulta Docker desde dentro del propio contenedor.

### Decisión de diseño: el dato que decide la seguridad del paciente no puede venir del cliente

Este es el error más grave que tenía el prototipo, y el que más vale la pena
explicar.

**Cómo estaba.** Las fichas de los tres internos —nombre, edad, cama,
psicopatologías, alergias y familiar responsable— estaban escritas a mano en
una constante `FICHAS` dentro de `estacion-web/app.js`. O sea: vivían en el
navegador. Cuando el médico pedía una validación, el JavaScript tomaba de ahí
la edad, las alergias y las psicopatologías y se las mandaba a `ms-vigia` en el
cuerpo de la petición.

**Por qué eso es grave.** Esos son exactamente los tres datos con los que
`ms-vigia` decide si bloquea un medicamento. Cualquiera con la aplicación
abierta podía apretar F12, escribir en la consola

```js
FICHAS["ASL-007"].alergias = [];
```

y a partir de ahí el sistema aprobaba furosemida —una sulfonamida— para
Tránsito Xicará, que está registrada como alérgica a las sulfas. El
microservicio de farmacovigilancia funcionaba perfectamente; simplemente le
estaban dando de comer datos falsos. Un control de seguridad que confía en un
dato que envía el cliente no es un control de seguridad.

**Cómo quedó.** El padrón de internos es ahora una tabla `internos` en
`ms-pastillero`, que es el servicio dueño del paciente. La estación web ya no
tiene `FICHAS`: pide el padrón a `GET /pastillero/api/v1/internos` y lo guarda
solo para pintar la pantalla. Y cuando se pide una validación, el navegador
manda **únicamente** el `pacienteId` y la propuesta:

```
navegador                ms-vigia                    ms-pastillero
    |                       |                              |
    |-- pacienteId + ------>|                              |
    |   propuesta           |-- GET /api/v1/internos/{id}->|
    |                       |<-- edad, alergias, ----------|
    |                       |    psicopatologias,          |
    |                       |    medicacion activa         |
    |                       |                              |
    |<-- dictamen ----------|  evalua con ESA ficha        |
```

`ms-vigia` arma la ficha del lado del servidor, preguntándole al servicio que
es dueño de ese dato y reenviando el token de quien pidió la validación. Se
puede mandar `"alergias": []` y `"edad": 30` en el cuerpo: se ignoran. El
dictamen incluye un bloque `fichaEvaluada` que deja escrito con qué datos se
evaluó y que la fuente fue `ms-pastillero`.

Si `ms-pastillero` no responde, `ms-vigia` devuelve **`503`** y no dictamina.
Prefiere no dar una respuesta antes que dar una respuesta sin fundamento: un
`APROBADO` emitido sin conocer las alergias del interno es peor que un error.

**Lo que hay que reconocer de esta decisión:** crea una dependencia cruzada
entre `ms-vigia` y `ms-pastillero`, que ya se llamaban en el sentido contrario.
Es un ciclo a nivel de servicios, y se maneja así: la llamada es en tiempo de
petición y no de arranque, así que `ms-vigia` **no** declara `depends_on` sobre
`ms-pastillero` en el `docker-compose.yml` —eso sí sería un ciclo que impediría
levantar el stack— y cada lado degrada solo si el otro no está. En un sistema
más grande el padrón de internos sería su propio microservicio (`ms-censo`) del
que los dos dependerían en una sola dirección; para tres internos y un
prototipo académico, meterlo donde ya vive el paciente es la opción honesta.

### Quién firma cada registro

Los campos `solicitadoPor`, `prescritoPor`, `enfermero` y `registradoPor` **ya
no se leen del cuerpo de la petición**: cada microservicio los toma del token
de la sesión. Antes el cliente podía mandar el nombre que se le antojara y
quedaba firmado en la bitácora clínica o en el libro de caja. La hoja de
administración de medicamentos es un documento legal: la firma quien inició
sesión, no quien escribe el JSON.

---

## 4. Cómo ejecutarlo

Requisito único: **Docker Desktop** instalado y corriendo.

**Paso previo, una sola vez por instalación:** crear el archivo `.env` con el
secreto que firma las sesiones. No hay secreto por defecto en ninguna parte
del código, a propósito: un secreto de desarrollo escrito en el repositorio es
un secreto publicado, y cualquiera que lo lea puede firmarse un token de
`MEDICO`. El archivo `.env` está en `.gitignore` y no se versiona.

```bash
cd asilo-microservicios
cp .env.ejemplo .env
openssl rand -hex 32        # pegue el resultado en GATEWAY_SECRETO=
```

Hecho eso, el stack levanta con un solo comando, siempre:

```bash
docker compose up --build
```

Si falta el `.env`, el `docker compose` se detiene con un mensaje que dice
exactamente qué hacer; y aunque se saltara ese control, ni el gateway ni los
microservicios arrancan sin secreto.

La primera vez tarda unos minutos porque descarga las imágenes base y
resuelve las dependencias de Node y de Python.

| Dirección | Qué es |
|---|---|
| <http://localhost:8090> | Estación de enfermería (la aplicación base, con login) |
| <http://localhost:8080/salud> | Estado de ms-gateway |
| <http://localhost:8080/vigia/salud> | Estado de ms-vigia (con sesión iniciada) |
| <http://localhost:8080/pastillero/salud> | Estado de ms-pastillero (con sesión iniciada) |
| <http://localhost:8080/caja/salud> | Estado de ms-caja (con sesión iniciada) |

Los puertos 8081, 8082 y 8083 **ya no responden desde el equipo anfitrión**:
los microservicios solo son alcanzables por la red interna de Docker, a través
del gateway.

Para detener: `Ctrl + C` y luego `docker compose down`.
Para borrar también los datos y volver a sembrar los internos de ejemplo:
`docker compose down -v`.

### Usuarios de prueba

`ms-gateway` trae tres usuarios para la demostración, definidos en
`ms-gateway/usuarios.json` con la clave guardada como hash **bcrypt** (nunca en
texto plano) y sesión de 8 horas. **Son credenciales de prueba de este
prototipo académico**; en un sistema real esta lista vendría de la tabla de
personal del módulo administrativo y no de un archivo del repositorio.

| Usuario | Clave | Rol |
|---|---|---|
| `medico` | `medico2026` | `MEDICO` |
| `enfermeria` | `enfermeria2026` | `ENFERMERIA` |
| `administracion` | `admin2026` | `ADMINISTRACION` |

Para dar de alta a alguien o cambiarle la clave, se genera el hash y se edita
`usuarios.json`:

```bash
docker compose run --rm --entrypoint node ms-gateway \
  -e "console.log(require('bcryptjs').hashSync('LA_CLAVE_NUEVA', 10))"
```

El acceso está endurecido: cinco intentos fallidos del mismo usuario en cinco
minutos y el gateway responde `429` con `Retry-After`. Además, un login
fallido tarda lo mismo exista o no el usuario (siempre se compara contra un
hash, incluso cuando no hay nadie con ese nombre), para que cronometrar la
respuesta no revele qué usuarios están dados de alta.

### Los dos guiones de comprobación

El proyecto trae dos, con propósitos distintos. Los dos corren en **Git Bash
sobre Windows** (y en Linux y macOS), imprimen `OK` o `FALLA` en cada línea y
salen con código distinto de cero si algo falla, así que sirven para
encadenarlos. Los dos necesitan el stack levantado.

| | `pruebas.sh` | `verificar.sh` |
|---|---|---|
| **Qué es** | Prueba de humo **funcional** | Revisión de **seguridad, base de datos y repositorio** |
| **Comprobaciones** | **64**, en 15 bloques | **54**, en 17 bloques |
| **Punto de vista** | Recorre el sistema como lo haría una persona, siempre a través del gateway | Mira el sistema desde afuera y desde el código fuente |
| **Requisitos** | `curl` y `python3` **o** `node` (usa el que encuentre) | `curl` y `docker` (consulta MySQL con `docker compose exec`) |

```bash
bash pruebas.sh   ; echo "código de salida: $?"
bash verificar.sh ; echo "código de salida: $?"
```

**`verificar.sh` corre a `pruebas.sh` dentro de su bloque 14**, así que
ejecutar el segundo cubre los dos. Correr `pruebas.sh` por separado es útil
mientras se trabaja, porque tarda mucho menos.

**Qué cubre `pruebas.sh`** — el camino funcional completo: que los puertos
8081-8083 estén cerrados, petición sin token (`401`), token manipulado
(`401`), token vencido (`401`), cada rechazo por rol de la matriz (`403`), las
dos excepciones de lectura (`200`), que el token deje de servir después del
`logout` (`401`), el límite de intentos (`429`), que `GET /` no sea un `404` y
que el `404` diga qué ruta y qué método se pidieron, que diez validaciones
simultáneas generen diez folios distintos, que un cliente que miente sobre las
alergias no cambie el dictamen, el registro y la omisión de tomas, el circuito
completo de caja, y los dos casos clínicos de siempre: ibuprofeno sobre
warfarina → `BLOQUEADO`, y `ms-pastillero` negándose a programar ese folio con
`409`.

**Qué cubre `verificar.sh`** — lo que no se ve desde la interfaz: la matriz de
acceso rol por rol y ruta por ruta; la defensa en profundidad, comprobando que
un microservicio rechace por su cuenta a quien se salte el gateway desde la red
interna; que la bitácora se firme con el token y no con el cuerpo de la
petición; **el aislamiento entre las bases**, verificando que `usr_caja` no
pueda leer `asilo_vigia`; que los nombres con tilde sobrevivan el viaje a MySQL
y de vuelta; y una **auditoría estática del repositorio**: sin claves en texto
plano, sin rastros de SQLite, con `.env` ignorado, el dinero en `DECIMAL` y el
puerto de MySQL sin publicar.

Para partir de datos limpios (los internos y cargos de ejemplo recién
sembrados), borre los volúmenes antes. **La primera vez tarda entre 60 y 90
segundos**: MySQL crea su directorio de datos y ejecuta los archivos de `sql/`
antes de aceptar conexiones, y los microservicios esperan a que eso termine.

```bash
docker compose down -v && docker compose up -d --build
bash verificar.sh
```

> El recorrido de la interfaz en un navegador de verdad —acceso, rutas,
> confirmaciones, foco, teléfono— se hizo durante el desarrollo con un script
> aparte de Puppeteer. **No se incluye en el repositorio a propósito**: metería
> `node_modules` y un navegador descargable en un proyecto cuyo único requisito
> debe seguir siendo Docker. `pruebas.sh` cubre los servicios, que es lo que se
> puede verificar sin dependencias extra.

---

## 5. Endpoints

### ms-gateway — `http://localhost:8080`

| Método | Ruta | Para qué |
|---|---|---|
| GET | `/salud` | Sonda de vida propia (no exige sesión) |
| POST | `/api/auth/login` | `{ usuario, clave }` → `{ token, usuario, nombre, rol }` |
| GET | `/api/auth/me` | Devuelve el usuario dueño del token vigente |
| POST | `/api/auth/logout` | Revoca el token vigente: deja de servir aunque no haya vencido |
| * | `/vigia/*`, `/pastillero/*`, `/caja/*` | Reenvía la petición al microservicio correspondiente, ya autenticada |

### ms-vigia — detrás del gateway en `/vigia` (no tiene puerto propio en el anfitrión)

| Método | Ruta | Para qué |
|---|---|---|
| GET | `/salud` | Sonda de vida |
| GET | `/api/v1/vademecum` | Catálogo de principios activos de la fundación |
| POST | `/api/v1/validaciones` | **Dictamina una prescripción** (rol `MEDICO`) |
| GET | `/api/v1/validaciones/{folio}` | Recupera un dictamen |
| GET | `/api/v1/validaciones?pacienteId=` | Bitácora por interno |

Ejemplo de petición. **Se manda solo a quién se le va a recetar y qué**; la
edad, las alergias, las psicopatologías y la medicación activa las busca
`ms-vigia` por su cuenta en `ms-pastillero` (ver la decisión de diseño más
abajo). `solicitadoPor` tampoco se manda: sale del token.

```json
{
  "pacienteId": "ASL-022",
  "propuesta": {
    "principioActivo": "ibuprofeno",
    "dosisMg": 400,
    "cadaHoras": 8,
    "viaAdministracion": "oral"
  }
}
```

Respuesta: `veredicto` (`APROBADO` / `ADVERTENCIA` / `BLOQUEADO`), `puntajeRiesgo` de 0 a
100, `folio`, la lista de `hallazgos` —cada uno con código, severidad, qué pasa
y qué hacer— y `fichaEvaluada`, que deja escrito **con qué datos y de qué
fuente** se dictaminó, para poder auditar después por qué se bloqueó o se
aprobó un medicamento.

Si `ms-pastillero` no responde, `ms-vigia` devuelve **`503`** y no dictamina:
sin ficha no se evalúa a ciegas. Si el interno no existe en el padrón,
devuelve `404`.

### ms-pastillero — detrás del gateway en `/pastillero` (no tiene puerto propio en el anfitrión)

| Método | Ruta | Para qué |
|---|---|---|
| GET | `/salud` · `/api/v1/turnos` | Estado y turno de enfermería vigente |
| GET | `/api/v1/internos` | **Padrón de internos del asilo** con su ficha |
| GET | `/api/v1/internos/{id}` | Ficha de un interno: edad, cama, ingreso, psicopatologías, alergias, familiar responsable y medicación activa |
| GET | `/api/v1/pacientes` | Internos con tratamiento activo |
| GET | `/api/v1/pacientes/{id}/medicacion-activa` | Lo que ya recibe el interno |
| POST | `/api/v1/planes` | **Programa un tratamiento** y genera las tomas (rol `MEDICO`/`ENFERMERIA`) |
| GET | `/api/v1/planes/{id}` | Plan con todas sus tomas |
| POST | `/api/v1/planes/{id}/suspender` | Suspende el plan y anula las tomas futuras |
| GET | `/api/v1/pacientes/{id}/tomas?fecha=&turno=` | Hoja de trabajo del turno |
| POST | `/api/v1/tomas/{id}/administrar` | Registra la administración (rol `MEDICO`/`ENFERMERIA`) |
| POST | `/api/v1/tomas/{id}/omitir` | Registra la omisión, exige motivo (rol `MEDICO`/`ENFERMERIA`) |
| GET | `/api/v1/pacientes/{id}/adherencia` | Indicador para el reporte |

### ms-caja — detrás del gateway en `/caja` (no tiene puerto propio en el anfitrión)

| Método | Ruta | Para qué |
|---|---|---|
| GET | `/salud` | Sonda de vida |
| GET | `/api/v1/tarifas` | Tarifario de la fundación (consulta, laboratorio, farmacia, cuota) |
| POST | `/api/v1/cargos` | Carga un cobro a la cuenta del interno, ya con el descuento (rol `ADMINISTRACION`) |
| GET | `/api/v1/cargos?pacienteId=&desde=&hasta=&estado=` | Reporte de cobros por paciente y rango de fecha |
| GET | `/api/v1/pacientes/{id}/cuenta` | Estado de cuenta: cargos, pagos y saldo pendiente |
| POST | `/api/v1/cargos/{id}/pagar` | Registra un pago o abono sobre un cargo (rol `ADMINISTRACION`) |
| GET / POST | `/api/v1/donaciones` | Lista o registra una donación (empresa, gobierno, particular) |
| GET / POST | `/api/v1/gastos` | Lista o registra un gasto operativo del asilo |
| GET | `/api/v1/fundacion/resumen` | Adeudo con la fundación por consultas, laboratorio y farmacia |
| POST | `/api/v1/fundacion/pagos` | Registra un pago del asilo a la fundación |
| GET | `/api/v1/resumen` | Panel general: entradas, salidas, saldo pendiente y balance |

---

## 6. Las cinco reglas de ms-vigia

| Código | Regla | Ejemplo que la dispara |
|---|---|---|
| `FV-ALG-01/02` | Alergia directa o cruzada de familia | Furosemida a alguien alérgico a sulfas |
| `FV-INT-01` | Interacción con la medicación activa | Ibuprofeno a alguien que toma warfarina |
| `FV-DUP-01` | Duplicidad terapéutica (mismo grupo) | Dos AINE a la vez |
| `FV-GER-01..04` | Criterios de prescripción en el adulto mayor | Antipsicótico a un interno con demencia |
| `FV-DOS-01/02` | Dosis diaria por encima del tope | Paracetamol 1 g cada 4 horas |

Cada hallazgo suma puntos según su severidad, y la suma decide el veredicto:

| Severidad del hallazgo | Puntos |
|---|---|
| `CRITICA` | 40 |
| `ALTA` | 20 |
| `MEDIA` | 8 |
| `INFORMATIVA` | 2 |

| Puntaje | Veredicto | Con qué se llega |
|---|---|---|
| cualquier hallazgo `CRITICA` | **`BLOQUEADO`** | Alergia directa o cruzada, dosis sobre el tope, antipsicótico en demencia |
| ≥ 8 | **`ADVERTENCIA`** | Una `ALTA` (20) o una `MEDIA` (8). Se puede administrar con las precauciones indicadas |
| < 8 | **`APROBADO`** | Sin hallazgos, o solo `INFORMATIVA` (2) |

El umbral de advertencia es **8**, o sea un solo hallazgo de severidad media:
si el sistema detectó algo de severidad media, quien administra tiene que
enterarse. Este README decía antes que el umbral era 20, pero el código ya se
comportaba como 8 —tenía dos condiciones encadenadas y la del 20 nunca llegaba
a decidir nada porque la siguiente cubría el mismo caso—. Se dejó el 8, que es
el comportamiento correcto, y ahora el código y el README dicen lo mismo.

### Casos listos para la demostración

| Interno | Medicamento a probar | Resultado esperado |
|---|---|---|
| Bernardo Puac (ASL-022) | Ibuprofeno 400 mg / 8 h | **BLOQUEADO** — interacción con warfarina + criterio geriátrico |
| Rosalía Menchú (ASL-014) | Quetiapina 25 mg / 12 h | **BLOQUEADO** — antipsicótico en demencia |
| Tránsito Xicará (ASL-007) | Furosemida 40 mg / 24 h | **BLOQUEADO** — alergia cruzada a sulfas |
| Rosalía Menchú (ASL-014) | Lorazepam 1 mg / 12 h | **ADVERTENCIA** — riesgo de caída; se puede programar |
| Bernardo Puac (ASL-022) | Paracetamol 500 mg / 8 h | **APROBADO** — se programa sin observaciones |

### Casos listos para demostrar el control de acceso

| Con la sesión de… | Al intentar… | Resultado esperado |
|---|---|---|
| nadie (sin token) | cualquier ruta detrás del gateway | `401` — falta iniciar sesión |
| nadie | `POST` directo a `localhost:8083` | la conexión ni siquiera se establece: el puerto está cerrado |
| cualquiera | usar un token con un carácter cambiado | `401` — la firma no cuadra |
| cualquiera | usar un token vencido | `401` — la sesión expiró |
| cualquiera | usar su token después de `POST /api/auth/logout` | `401` — el token quedó revocado |
| cualquiera | seis intentos de acceso fallidos seguidos | `429` con `Retry-After` |
| `enfermeria` | crear una validación en `/vigia` | `403` — solo `MEDICO` dictamina |
| `administracion` | administrar una toma en `/pastillero` | `403` — solo `MEDICO`/`ENFERMERIA` |
| `administracion` | leer la bitácora clínica de `/vigia` | `403` — no es información suya |
| `medico` o `enfermeria` | registrar una donación en `/caja` | `403` — solo `ADMINISTRACION` |
| `medico` o `enfermeria` | leer `/caja/api/v1/resumen` | `403` — el estado financiero es de administración |
| `medico` | leer `/caja/api/v1/pacientes/{id}/cuenta` | `200` — **excepción documentada 1** |
| `enfermeria` | leer esa misma cuenta | `403` — la excepción es solo del médico |
| `administracion` | leer `/pastillero/api/v1/internos` | `200` — **excepción documentada 2**, pero la ficha llega sin alergias ni psicopatologías |
| `administracion` | leer las tomas de un interno | `403` — eso sí es clínico |
| `administracion` | registrar una donación o un gasto | `201` — se crea sin problema |
| `medico` | mandar `"alergias": []` en el cuerpo de una validación | se ignora: `ms-vigia` usa la ficha real de `ms-pastillero` |

Todos estos casos están automatizados en `pruebas.sh`.

---

## 7. La estación de enfermería

La interfaz no es un tablero genérico: la usa alguien **de pie, apurado, en un
turno de noche**, frente a un monitor que puede ser viejo. Todo lo visual está
decidido en ese orden de prioridades:

1. La hora y el estado de cada toma se leen de un vistazo, de lejos.
2. `pendiente` y `vencida` no se pueden confundir.
3. El veredicto de `ms-vigia` domina la pantalla cuando aparece.

### La paleta y las tipografías

Seis colores, con el contraste medido contra el fondo. Los dos que había antes
para estado —el ocre y el gris— no llegaban al mínimo de accesibilidad (4.21:1
y 4.46:1 sobre el fondo hueso) y se oscurecieron.

| Token | Hex | Para qué | Contraste |
|---|---|---|---|
| `--papel` | `#f2f1ed` | Fondo. Hueso cálido, no blanco: menos deslumbre de madrugada | — |
| `--tinta` | `#14161a` | Texto principal | 16.03:1 |
| `--cobalto` | `#1f3a9e` | Toma administrada, veredicto aprobado, acción primaria | 8.61:1 |
| `--alerta` | `#a32414` | Toma vencida, veredicto bloqueado | 6.59:1 |
| `--ambar` | `#7a5200` | Toma omitida, veredicto advertencia | 6.12:1 |
| `--pizarra` | `#4a5058` | Texto secundario y rótulos | 7.20:1 |

**Space Grotesk** para lo que se lee (nombres, fármacos, títulos) y
**JetBrains Mono** para lo que se compara: horas, folios, códigos de interno y
montos. La monoespaciada no es decoración — alinea los dígitos en columna, así
que `06:00 / 14:00 / 22:00` se escanean verticalmente igual que en una hoja de
administración de medicamentos en papel. La hora de cada toma va a 22px, que es
el dato que se busca primero.

### El estado nunca se codifica solo con color

Alrededor del 8% de los hombres no distingue el rojo del verde, y en un monitor
gastado los colores mienten. Cada estado lleva **forma, palabra y color**, así
que se lee igual en escala de grises:

```
▌ 06:00   Donepecilo 10 mg     ●✓ administrada     disco lleno, cobalto
▌ 14:00   Paracetamol 500 mg   ▲ VENCIDA   [Dar]   triángulo, VERSALITAS, barra roja
  22:00   Omeprazol 20 mg      ○ pendiente [Dar]   anillo hueco, sin barra
  08:00   Sertralina 50 mg     ⊘ omitida           anillo tachado, ámbar
```

`pendiente` y `vencida`, que es el par que no se puede confundir, se separan
por **tres** señales a la vez: anillo hueco contra triángulo lleno, minúscula
contra VERSALITAS, y una barra de 4px al costado de la fila que solo lleva la
vencida.

Y el dictamen de `ms-vigia` deja de ser un texto más: es una banda de ancho
completo con la palabra a 38px, en rojo sólido con texto blanco cuando el
veredicto es `BLOQUEADO`.

### Navegación y rutas

Las vistas son **enlazables** y el botón de atrás del navegador funciona:

| Ruta | A dónde lleva |
|---|---|
| `#/jornada` · `#/jornada/ASL-014` | Jornada de medicación |
| `#/caja` · `#/caja/ASL-014` | Caja y donaciones |
| `#/interno/ASL-014` | La jornada de ese interno |

El acceso ocupa la pantalla completa, sin nada detrás. Al entrar, la aplicación
arranca arriba y en la vista que le toca al rol: medicina y enfermería en la
jornada, administración en la caja. Y solo se muestran las pestañas que el rol
puede usar — **con el nombre de lo que ese rol de verdad puede hacer**:

| Rol | Segunda pestaña | Qué ve dentro |
|---|---|---|
| `ADMINISTRACION` | «Caja y donaciones» | Módulo completo: balance de entradas y salidas, estado de cuenta y formularios de cargo, donación y gasto |
| `MEDICO` | «Cuenta del interno» | Solo los cargos y el saldo del interno seleccionado, que es su excepción de lectura. Sin balance y sin formularios |
| `ENFERMERIA` | no aparece | — |

El médico veía antes una pestaña llamada «Caja y donaciones» que prometía más
de lo que su rol puede leer. **La interfaz no pide lo que el rol no puede
leer**: con sesión de médico no se llega a hacer ni una petición que el gateway
vaya a responder con `403`. Si alguien pidió `#/caja` antes de iniciar sesión, se le guarda esa
intención y se le lleva ahí después de entrar.

**Al vencerse la sesión no se expulsa de golpe:** se avisa en la pantalla de
acceso, se conserva el usuario escrito y se recuerda en qué vista estaba, para
devolverlo exactamente ahí al reingresar.

### Carga, vacío y error

- **Carga:** cada bloque muestra un esqueleto mientras llega la respuesta. La
  pantalla ya no queda en blanco pareciendo colgada.
- **Vacío:** dice qué hacer, no solo que no hay datos. Si el interno no tiene
  tomas, explica que el médico debe indicar un medicamento y que `ms-vigia`
  debe aprobarlo — y pone el botón para hacerlo, si el rol alcanza.
- **Error:** nunca se muestra el mensaje crudo del servidor. Se distingue *el
  servicio no responde* de *la petición fue rechazada*:

| Situación | Lo que lee la persona |
|---|---|
| `403` | «Su rol no tiene acceso a esto. La sesión de medicina no está autorizada al consultar el resumen financiero. Se necesita una sesión de administración.» |
| `502` | «El servicio ms-caja no respondió. El contenedor puede estar reiniciándose.» + botón **Reintentar** |
| `503` | «El servicio ms-vigia no está disponible… No se muestra información incompleta a propósito.» + **Reintentar** |
| sin red | «No hay conexión con la estación… Revise que el stack esté levantado.» |

Los avisos de error **se quedan hasta que la persona los cierre**; los demás se
van solos a los seis segundos.

### Confirmaciones

Registrar la administración de un medicamento es un acto clínico irreversible
que antes se disparaba con un clic. Ahora pide confirmación mostrando interno,
fármaco, dosis y hora, y advierte que queda firmado a nombre de quien inició
sesión. Lo mismo para **registrar un pago** y para **suspender un tratamiento**.
Después de cada acción se dice qué cambió y la fila afectada queda resaltada,
en vez de repintar todo en silencio.

### Accesibilidad

- Foco visible en todo lo enfocable, con anillo de 3px.
- El recetario y el diálogo de confirmación **atrapan el foco**, se cierran con
  `Escape` y **devuelven el foco al botón que los abrió**.
- Los avisos viven en una región `aria-live="polite"`; el diálogo de
  confirmación es un `alertdialog` modal.
- Todo el contenido que viene del servidor se pinta con `textContent` y nodos,
  nunca concatenando `innerHTML`. Antes `pintarDictamen` insertaba `codigo`,
  `tipo` y `severidad` sin escapar.
- Se respeta `prefers-reduced-motion`: sin animaciones ni desplazamiento suave.

### Teléfono

Por debajo de 720px la regla de 24 horas **no se achica: se reemplaza**. Pasa a
ser una línea de tiempo vertical con la hora en monoespaciada a la izquierda, la
marca de estado sobre el eje y el fármaco a la derecha — la misma información
con el eje girado 90°, que es lo que funciona en pantalla angosta.

---

## 8. La base de datos

Motor: **MySQL 8.4**, en el contenedor `bd-asilo`. El enunciado exige MySQL,
SQL Server u Oracle; el prototipo empezó con SQLite y se migró.

### Una instancia, tres bases separadas

Se conserva el patrón **database per service**: cada microservicio tiene su
propia base, su propio usuario y sus propios permisos.

| Base | Usuario | Servicio | Tablas |
|---|---|---|---|
| `asilo_vigia` | `usr_vigia` | ms-vigia | `validaciones` |
| `asilo_pastillero` | `usr_pastillero` | ms-pastillero | `internos`, `planes`, `tomas` |
| `asilo_caja` | `usr_caja` | ms-caja | `cargos`, `pagos`, `donaciones`, `gastos`, `pagos_fundacion` |

Cada usuario recibe `SELECT, INSERT, UPDATE, DELETE` **solo sobre su propia
base**, y nada más: ni `CREATE`, ni `DROP`, ni `ALTER`. Un servicio no puede
leer ni escribir la base de otro, y eso se comprueba en `verificar.sh`:

```bash
docker compose exec bd-asilo mysql -u usr_caja -p"$BD_CLAVE_CAJA" \
  -e "SELECT COUNT(*) FROM asilo_vigia.validaciones;"
# ERROR 1142 (42000): SELECT command denied to user 'usr_caja'@'...'
```

### Por qué una sola instancia, y qué se sacrificó

Tres microservicios con database per service «de libro» tendrían **tres
instancias** de motor, una por servicio. Aquí hay una sola, y es una decisión
consciente: el proyecto tiene que seguir levantando con un comando en la
máquina de un estudiante, y tres contenedores de MySQL en un portátil son
entre 1.2 y 1.5 GB de memoria y más de un minuto de arranque.

**Lo que se conserva** con esta decisión: el aislamiento *lógico* de los datos,
que es lo que sostiene el patrón. Ningún servicio conoce ni puede alcanzar el
esquema de otro; si mañana `ms-caja` se lleva a su propio motor, no hay una
sola consulta que reescribir, porque no existe ni un `JOIN` entre bases.

**Lo que se sacrifica**, y hay que decirlo:

- **Aislamiento de fallos.** Si el contenedor `bd-asilo` cae, caen los tres
  servicios a la vez. Con instancias separadas, una caída de la base de caja
  dejaría el pastillero funcionando: la enfermera podría seguir registrando
  tomas aunque administración no pudiera cobrar.
- **Aislamiento de recursos.** Una consulta pesada de reportes en `asilo_caja`
  compite por CPU, memoria y buffer pool con las lecturas clínicas de
  `asilo_pastillero`. No hay forma de ponerle un límite a una sola base.
- **Escalar por separado.** No se puede darle más memoria, más réplicas o un
  disco más rápido solo a la base que lo necesita.
- **Mantenimiento independiente.** Una actualización de versión, un backup o
  una restauración afectan a los tres servicios al mismo tiempo.

Migrar a tres instancias no exige tocar el código: son tres bloques más en el
`docker-compose.yml` y tres valores distintos en `BD_HOST`.

### El esquema está en archivos SQL legibles

No lo crea la aplicación al arrancar: vive en `sql/`, y MySQL lo ejecuta la
primera vez que se levanta el volumen.

| Archivo | Qué hace |
|---|---|
| `01-bases-y-usuarios.sh` | Crea las tres bases, los tres usuarios y sus permisos. **Es un `.sh` y no un `.sql` a propósito:** MySQL ejecuta los `.sql` literalmente, sin expandir variables, así que un `.sql` obligaría a escribir las tres claves dentro y versionarlas. El script las toma del entorno del contenedor, que el compose llena desde el `.env` |
| `01-bases-y-usuarios.ejemplo.sql` | **No se ejecuta.** Las mismas sentencias `CREATE USER` y `GRANT`, con claves de marcador, para poder leer el modelo de permisos sin leer shell |
| `02-esquema-vigia.sql` | Tabla de la bitácora de farmacovigilancia |
| `03-esquema-pastillero.sql` | Padrón de internos, planes y tomas |
| `04-esquema-caja.sql` | Cargos, pagos, donaciones, gastos y pagos a la fundación |

**Estos archivos son la entrega del modelo de datos** que pide el enunciado:
se leen de arriba abajo, con las claves, los tipos, las restricciones y los
índices a la vista.

Los cuatro que sí se ejecutan se montan **uno por uno** en el
`docker-compose.yml`, y no montando el directorio `sql/` completo. Si se
montara entero, MySQL ejecutaría también `01-bases-y-usuarios.ejemplo.sql`
—termina en `.sql`— y crearía los usuarios con las claves de marcador antes
de que el `.sh` alcanzara a crearlos bien.

Los servicios sí conservan el **sembrado de datos de demostración**,
condicionado a `SEMBRAR=1` y solo si la tabla está vacía.

### Decisiones de tipos

| Qué | Tipo | Por qué |
|---|---|---|
| Dinero | `DECIMAL(10,2)` | Antes era `REAL`. Sumar centavos en coma flotante da totales de Q 449.99 donde debe decir Q 450.00, y un libro de caja no puede explicar esa diferencia |
| Fechas y horas | `DATETIME` / `DATE` | Antes eran texto ISO. Ahora los filtros por rango usan `DATE(creado_en) BETWEEN …` y el motor entiende lo que ordena |
| Identificadores y folios | `VARCHAR` con largo definido | Con su `PRIMARY KEY`; el folio de `ms-vigia` lleva además un `UNIQUE` explícito |
| Estados y categorías | `VARCHAR` con `CHECK` | Se eligió `CHECK` sobre `ENUM` porque es portable a SQL Server y Oracle, que el enunciado también admite. La misma convención en los tres servicios |
| Listas cortas | `JSON` | Psicopatologías y alergias del interno, y el dictamen completo de `ms-vigia` |
| Motor | `InnoDB` | Con claves foráneas declaradas de verdad e índices sobre lo que de verdad se consulta |

Y **transacciones**: crear un plan con sus tomas, o registrar un pago que
además cambia el estado del cargo, van en una sola transacción con `rollback()`
si algo falla. Con SQLite podían quedar a medias.

### Cómo revisarla con MySQL Workbench

El contenedor **no publica el puerto 3306** a propósito. Para inspeccionarla,
descomente estas dos líneas en el `docker-compose.yml`:

```yaml
    # ports:
    #   - "3306:3306"
```

y vuelva a levantar (`docker compose up -d`). Luego, en MySQL Workbench:

| Campo | Valor |
|---|---|
| Hostname | `127.0.0.1` |
| Port | `3306` |
| Username | `root` (o `usr_vigia` / `usr_pastillero` / `usr_caja`) |
| Password | el valor de `BD_CLAVE_ROOT` en su archivo `.env` |

Con `root` se ven las tres bases; con cada usuario de servicio se ve solo la
suya, que es justamente lo que conviene enseñar en la defensa. **Vuelva a
comentar las dos líneas** cuando termine.

Sin abrir el puerto, también se puede consultar desde la línea de comandos:

```bash
docker compose exec bd-asilo mysql -u root -p"$BD_CLAVE_ROOT" \
  -e "SELECT * FROM asilo_pastillero.internos\G"
```

---

## 9. Estructura de archivos

```
asilo-microservicios/
├── docker-compose.yml          orquesta los seis contenedores
├── sql/                        el modelo de datos, como entrega legible
│   ├── 01-bases-y-usuarios.sh    tres bases, tres usuarios y sus permisos
│   │                             (toma las claves del entorno · SE VERSIONA)
│   ├── 01-bases-y-usuarios.ejemplo.sql  el mismo modelo de permisos, legible,
│   │                             con claves de marcador · NO se ejecuta
│   ├── 02-esquema-vigia.sql      bitacora de farmacovigilancia
│   ├── 03-esquema-pastillero.sql padron de internos, planes y tomas
│   └── 04-esquema-caja.sql       cargos, pagos, donaciones y gastos
├── .env.ejemplo                plantilla de configuración (se copia a .env)
├── .env                        secreto de esta instalación · NO se versiona
├── pruebas.sh                  prueba de humo por consola, toda vía el gateway
├── README.md
├── ms-vigia/
│   ├── app.py                  API, motor de reglas y verificación del token
│   ├── vademecum.py            base de conocimiento clínico (datos, no lógica)
│   ├── requirements.txt
│   └── Dockerfile
├── ms-pastillero/
│   ├── app.py                  padrón de internos, generación de tomas y llamada a ms-vigia
│   ├── requirements.txt
│   └── Dockerfile
├── ms-caja/
│   ├── app.py                  API del módulo de entradas, salidas y caja
│   ├── requirements.txt
│   └── Dockerfile
├── ms-gateway/
│   ├── server.js               login, JWT, revocación y proxy autorizado por rol
│   ├── usuarios.json           personal de demostración, con hash bcrypt
│   ├── package.json
│   ├── package-lock.json       versiones exactas · lo usa npm ci
│   ├── .dockerignore           deja node_modules y .env fuera de la imagen
│   └── Dockerfile
└── estacion-web/
    ├── index.html               acceso + jornada de medicación + caja y donaciones
    ├── estilos.css              paleta, estados por forma y diseño para pantalla angosta
    ├── app.js                   enrutado, estados de carga/vacío/error y consumo de la API
    ├── nginx.conf                sirve la interfaz y reenvia /api /vigia /pastillero /caja a ms-gateway
    └── Dockerfile
```

---

## 10. Limitaciones conocidas del prototipo

Esto es un **prototipo académico**, no un sistema en producción. Lo que sigue
son decisiones tomadas a conciencia, no descuidos: enumerarlas es parte del
trabajo, porque un sistema de salud que no sabe dónde están sus límites es más
peligroso que uno que sí.

### Seguridad

- **Los tres usuarios son de demostración.** Viven en
  `ms-gateway/usuarios.json` con la clave en hash bcrypt (nunca en texto
  plano), pero las credenciales están publicadas en este mismo README. En un
  sistema real la lista vendría de la tabla de personal del módulo
  administrativo, con altas, bajas y cambio de clave obligatorio al primer
  ingreso. **No use estas credenciales fuera de la demostración.**
- **Las credenciales ya no se imprimen en la pantalla de acceso.** Tenerlas
  escritas en el login era cómodo para grabar el video y contradecía todo lo
  demás. Ahora dependen de la bandera `MOSTRAR_USUARIOS_DEMO`, **apagada por
  defecto**. Para encenderla solo mientras se graba, ponga `MOSTRAR_USUARIOS_DEMO=1`
  en el `.env` y reinicie el gateway. Como la estación web es HTML estático
  servido por nginx y no puede leer variables de entorno, la consulta en
  `GET /api/config`, que es público y no devuelve ninguna credencial: solo el
  sí o el no. Si el gateway no responde, el bloque se queda oculto — el valor
  seguro por defecto.
- **No hay HTTPS.** Todo viaja en HTTP plano dentro de `localhost` y de la red
  interna de Docker. En una red real, el token de sesión se puede leer en
  tránsito: haría falta TLS terminado en nginx (o un proxy inverso delante) con
  certificados, `Strict-Transport-Security` y las cookies/tokens marcados en
  consecuencia.
- **El límite de intentos y la lista de revocación viven en la memoria del
  proceso.** Con una sola instancia del gateway funcionan; con varias, cada una
  llevaría su propia cuenta y el límite se multiplicaría, y un token revocado en
  una seguiría sirviendo en las otras. En producción ambas cosas van en Redis.
  Está anotado en el código, donde toca.
- **No hay refresco de sesión ni expiración por inactividad.** El token dura 8
  horas fijas desde el ingreso.
- **No hay bitácora de auditoría persistente.** Se sabe quién firmó cada
  dictamen, cada toma y cada movimiento de caja —eso sí queda en la base—, pero
  no hay un registro aparte de *quién consultó qué*, que es lo que exigiría una
  normativa de datos de salud.

### Datos y persistencia

- **Una sola instancia de MySQL para las tres bases.** Se explica y se
  cuantifica en la sección 8: se conserva el aislamiento lógico de los datos,
  pero se pierde el aislamiento de fallos y de recursos, y la posibilidad de
  escalar cada base por separado.
- **No hay migraciones de esquema.** El esquema se crea una sola vez, cuando
  MySQL arranca con el volumen vacío. Un cambio de columna exige recrear el
  volumen (`docker compose down -v`), lo que borra los datos. Un sistema real
  usaría una herramienta de migraciones versionadas.
- **Ninguna clave de MySQL está en un archivo versionado.** Viven solo en el
  `.env`, que no se versiona, y `sql/01-bases-y-usuarios.sh` las toma de las
  variables de entorno del contenedor al crear los usuarios. Ese script sí se
  versiona —es parte del despliegue— y no contiene ninguna clave: solo
  referencias a `${BD_CLAVE_VIGIA}`, `${BD_CLAVE_PASTILLERO}` y
  `${BD_CLAVE_CAJA}`. En producción vendrían de un gestor de secretos en vez
  de un archivo en el disco.
- **Los usuarios de MySQL se crean una sola vez**, cuando el volumen de datos
  está vacío. Cambiar una clave en el `.env` después no surte efecto: hay que
  recrear el volumen con `docker compose down -v`, lo que borra los datos.
- **Sin copias de seguridad ni réplica.** El volumen `bd-datos` es el único
  lugar donde viven los datos.
- **Los datos de ejemplo se siembran solos** (`SEMBRAR=1`) la primera vez. Los
  tres internos, sus tratamientos y los movimientos de caja son inventados para
  la demostración.

### Alcance funcional

- **No hay módulo de visita médica.** El sistema cubre la seguridad del
  medicamento, el plan de tomas y la caja; no registra la consulta en sí:
  motivo, exploración, diagnóstico ni evolución. `ms-vigia` deja bitácora de
  cada dictamen, que alimenta el reporte de análisis médicos, pero eso no es
  una nota de evolución clínica.
- **No hay alta, baja ni edición de internos desde la interfaz.** El padrón se
  lee (`GET /api/v1/internos`); se siembra al arrancar y se modifica en la base.
- **El vademécum y las reglas de farmacovigilancia son un recorte docente.** 28
  principios activos y cinco familias de reglas, suficientes para demostrar el
  mecanismo. Un vademécum real tiene miles de fármacos, y las reglas deberían
  venir de una fuente clínica mantenida y auditada, no de un archivo del
  repositorio. **Este sistema no sustituye el criterio del médico.**
- **El buscador de internos aparece cuando hay más de seis.** Con los tres
  sembrados no se muestra, por diseño.
- **La interfaz es la estación de enfermería, no la aplicación completa** del
  proyecto final: es HTML, CSS y JavaScript sin framework, para que se pueda
  leer entera y defender línea por línea.

### Operación

- **Un solo entorno.** No hay separación de desarrollo, pruebas y producción,
  ni integración continua, ni despliegue automatizado.
- **Sin límites de recursos ni política de reinicio afinada** en los
  contenedores más allá de `restart: unless-stopped`.
- **Los relojes son la hora local del contenedor** (`TZ=America/Guatemala`). Un
  cambio de zona horaria o de horario de verano afectaría el cálculo de turnos
  y de tomas vencidas.
