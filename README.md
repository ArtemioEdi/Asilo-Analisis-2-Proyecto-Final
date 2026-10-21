# Microservicios · Asilo de Ancianos "Cabeza de Algodón"

**Eddinson Artemio Ovalle López — 3090-23-20497**
Análisis y Diseño de Sistemas II · Universidad Mariano Gálvez de Guatemala · Centro Regional de Mazatenango

Siete contenedores: cuatro microservicios de dominio, un **gateway con inicio
de sesión** que es la única puerta de entrada, la estación web que los consume
y una instancia de **MySQL 8.4** con una base separada por servicio. Todo el
conjunto se levanta con **un solo comando**.

**Si viene a calificar, la sección 2 es la tabla que busca**: cada requisito
del enunciado con el endpoint que lo cumple, la pantalla donde se ve y el
usuario con el que hay que entrar.

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

De ahí salieron los cuatro microservicios de dominio, más el gateway que los
protege:

| Servicio | Responsabilidad única | Puerto interno |
|---|---|---|
| **ms-vigia** | Dictaminar si un medicamento es seguro para *ese* interno: alergias, interacciones, duplicidad terapéutica, criterios geriátricos y dosis máxima. Devuelve veredicto, puntaje de riesgo y folio. | 8081 |
| **ms-pastillero** | Convertir la indicación médica ("500 mg cada 8 horas por 3 días") en tomas con hora y turno, y registrar quién administró cada una, quién la omitió y por qué. | 8082 |
| **ms-caja** | El "Módulo de Entradas, Salidas y Manejo de Caja" del enunciado: tarifario con descuento de la fundación, cargos a la cuenta del familiar, pagos y abonos, donaciones, gastos operativos y el saldo con la fundación. | 8083 |
| **ms-consultas** *(nuevo)* | La cadena clínica completa: el médico remite al interno a una especialidad, la fundación le asigna médico y hora, el especialista lo atiende y llena la ficha, indica exámenes y receta. Avisa por correo al familiar responsable en cuanto se crea la remisión. | 8084 |
| **ms-gateway** *(nuevo)* | Puerta única de entrada: inicia sesión, firma un JWT, gestiona las cuentas del personal y reenvía cada petición al microservicio que corresponde solo si el rol de quien la hace lo permite. | 8080 (publicado) |

`ms-pastillero` **no programa** un tratamiento si `ms-vigia` lo dictaminó
como `BLOQUEADO`: esa llamada es el primer punto de integración entre
microservicios. El segundo es de otra naturaleza: `ms-gateway` no toca la
base de ningún otro servicio —la única que tiene es la de las cuentas del
personal—, solo decide **quién puede entrar y a qué**, y le reenvía la
petición tal cual al servicio dueño de esos datos.

---

## 2. El enunciado, requisito por requisito

Esta es la tabla para calificar. Cada fila es un requisito del enunciado del
proyecto, con **el endpoint que lo cumple**, **la pantalla donde se ve** y
**con qué usuario hay que entrar para verlo**. Todos los endpoints se piden a
través del gateway, en `http://localhost:8080`, con el token de sesión.

### La ficha médica del interno

| Requisito | Endpoint | Pantalla | Usuario |
|---|---|---|---|
| Alta del interno en el padrón, con su documento de identificación | `POST /pastillero/api/v1/internos` | Padrón → **Dar de alta** | `admin` |
| Datos administrativos del interno: ubicación, ingreso, familiar responsable | `PUT /pastillero/api/v1/internos/{id}` | Padrón → **Editar** | `admin` |
| Egreso del interno, conservando su historial | `PUT /pastillero/api/v1/internos/{id}/egreso` | Padrón → **Egresar** | `admin` |
| Ficha médica completa del interno | `GET /consultas/api/v1/reportes/ficha?pacienteId=` | Consultas → **Ver ficha médica completa** | `medico` |
| Psicopatologías del interno | `PUT /pastillero/api/v1/internos/{id}/clinica`, y dentro de la ficha | Consultas → **Editar información clínica**, o el mismo botón dentro de la ficha médica completa: bloque *Psicopatologías* | `medico` (lo lee también `enfermeria`) |
| Alergias del interno | `PUT /pastillero/api/v1/internos/{id}/clinica`, y dentro de la ficha | Consultas → **Editar información clínica**, o el mismo botón dentro de la ficha médica completa: bloque *Alergias*; sin alergias se dice «Sin alergias conocidas» | `medico` (lo lee también `enfermeria`) |
| Medicinas de cajón: la medicación permanente del interno | `PUT /pastillero/api/v1/internos/{id}/clinica` | Consultas → **Editar información clínica**, o el mismo botón dentro de la ficha médica completa: bloque *Medicación permanente*, cada medicamento elegido del vademécum de ms-vigia | `medico` |
| Diagnóstico y observaciones de cada consulta | `GET /consultas/api/v1/visitas/{id}` | Ficha médica completa, *Historial de consultas* | `medico` |
| Medicamento aplicado, cantidad y tiempo de aplicación | `GET /pastillero/api/v1/turnos` · `POST /pastillero/api/v1/tomas/{id}/administrar` | Jornada de medicación | `enfermeria` |

### La cadena de la consulta

| Requisito | Endpoint | Pantalla | Usuario |
|---|---|---|---|
| Solicitar consulta con especialista | `POST /consultas/api/v1/solicitudes` | Consultas → **Remitir a especialidad** | `medico` |
| Asignar médico, fecha y hora a la solicitud | `PUT /consultas/api/v1/solicitudes/{id}/agendar` | Bandeja de remisiones → **Asignar cita** | `fundacion` |
| Atender la consulta y llenar la ficha | `POST /consultas/api/v1/visitas` · `PUT /consultas/api/v1/visitas/{id}` | Consultas → **Atender** → **Guardar la ficha** | `medico` |
| Indicar exámenes en la consulta | `POST /consultas/api/v1/visitas/{id}/examenes` | Cajón de la consulta → **Agregar examen** | `medico` |
| Cargar el resultado del examen | `PUT /consultas/api/v1/examenes/{id}/resultado` | Exámenes solicitados → **Cargar el resultado** | `laboratorio` |
| Recetar medicamentos en la consulta | `POST /consultas/api/v1/visitas/{id}/indicaciones` | Cajón de la consulta → **Recetar, si ms-vigia lo aprueba** | `medico` |
| Entregar el medicamento recetado | `PUT /consultas/api/v1/indicaciones/{id}/entregar` | Medicamentos por entregar → **Entregar** | `farmacia` |
| Cerrar la consulta | `PUT /consultas/api/v1/visitas/{id}/cerrar` | Cajón de la consulta → **Cerrar consulta** (pide confirmación: es irreversible) | `medico` |

### El aviso al familiar

| Requisito | Endpoint | Pantalla | Usuario |
|---|---|---|---|
| Avisar al familiar el estado de la solicitud y a qué especialidad se remitió | se genera solo dentro de `POST /consultas/api/v1/solicitudes` | Consultas → **Avisos a la familia** | `medico` |
| Ver los avisos generados, con asunto y cuerpo completos | `GET /consultas/api/v1/correos?pacienteId=` | Consultas → **Avisos a la familia** → *Ver el correo* | `medico` |

> El aviso sale por SMTP si hay servidor configurado (`SMTP_HOST` en `.env`) y
> queda con estado `ENVIADO`. Sin servidor configurado **no falla**: se escribe
> completo en la bitácora del contenedor, se guarda en la tabla
> `correos_enviados` con estado `REGISTRADO` y la pantalla lo muestra entero.
> Así el requisito se demuestra sin depender de un servidor de correo.

### El módulo de entradas, salidas y manejo de caja

| Requisito | Endpoint | Pantalla | Usuario |
|---|---|---|---|
| Costo de la consulta con sus exámenes y medicamentos | `GET /caja/api/v1/reportes/costo-por-visita?visitaId=` | Caja → **Costo por consulta** | `administracion` |
| Cobros a la familia con el descuento de la fundación | `POST /caja/api/v1/cargos` · `GET /caja/api/v1/cargos` | Caja → *Cargar a la cuenta del interno* | `administracion` |
| Estado de cuenta y saldo de cada interno | `GET /caja/api/v1/pacientes/{id}/cuenta` | Caja → *Cuenta del interno* | `administracion` (y `medico`, solo lectura) |
| Pagos y abonos de la familia | `POST /caja/api/v1/cargos/{id}/pagar` | Caja → botón **Pagar** de cada cargo | `administracion` |
| Cuota mensual de estadía | `POST /caja/api/v1/cuotas/generar` para todo el padrón activo, o la tarifa `cuota-mensual` en `POST /caja/api/v1/cargos` para una sola | Caja → *Cuota mensual de estadía* | `administracion` |
| Entradas por donaciones, en sus cuatro categorías: empresa internacional, empresa nacional, gobierno y particular | `POST /caja/api/v1/donaciones` · `GET /caja/api/v1/donaciones` | Caja → *Registrar una donación* | `administracion` |
| Salidas por gastos operativos | `POST /caja/api/v1/gastos` · `GET /caja/api/v1/gastos` | Caja → *Registrar un gasto* | `administracion` |
| Lo que el asilo le debe a la fundación y sus pagos | `GET /caja/api/v1/fundacion/resumen` · `POST /caja/api/v1/fundacion/pagos` | Caja → resumen superior (*Adeudado*, *Pagado* y *Saldo con la fundación*) y el formulario **Registrar un pago a la fundación**, con monto y referencia. Un pago mayor que el saldo se rechaza con `400` | `administracion` |
| Balance general de entradas y salidas | `GET /caja/api/v1/resumen` | Caja → resumen superior | `administracion` |
| Control de las citas que aún no están completamente canceladas | `GET /caja/api/v1/reportes/citas-pendientes?pacienteId=&desde=&hasta=` (todos los filtros opcionales) | Caja → resumen superior, dato **Citas con saldo pendiente**, que lleva a Reportes → *Adicional · Citas con saldo pendiente* | `administracion` |

### Reportes

El enunciado pide siete informes. Los siete están, y todos se piden desde la
misma pantalla —**Reportes**—, que le muestra a cada rol únicamente los que le
tocan y los imprime con el formato de hoja del asilo.

| # | Requisito | Endpoint | Quién lo ve |
|---|---|---|---|
| 1 | Costos de cada cita por paciente | `GET /caja/api/v1/reportes/costo-por-visita?visitaId=` | `administracion` |
| 2 | Análisis médicos por paciente | `GET /consultas/api/v1/reportes/ficha?pacienteId=` | `medico` |
| 3 | Cobros por paciente y rango de fecha | `GET /caja/api/v1/cargos?pacienteId=&desde=&hasta=` | `administracion` |
| 4 | Pagos realizados a la fundación | `GET /caja/api/v1/reportes/pagos-fundacion?desde=&hasta=` | `administracion` |
| 5 | Entradas: donaciones y cobros | `GET /caja/api/v1/reportes/entradas?desde=&hasta=` | `administracion` |
| 6 | Exámenes médicos realizados por paciente | `GET /consultas/api/v1/reportes/examenes?pacienteId=` | `medico` |
| 7 | Medicamentos aplicados por paciente | `GET /pastillero/api/v1/pacientes/{id}/adherencia?desde=&hasta=` | `enfermeria`, `medico` |

Los siete llevan al pie **quién los generó y cuándo**, y ese nombre sale del
token en el servidor, no del navegador: un informe impreso lleva el nombre de
quien tenía la sesión abierta. Enfermería entra a la pantalla y ve **solo el
séptimo**, que es el único que le corresponde.

| Otro reporte, fuera de los siete | Endpoint | Pantalla | Usuario |
|---|---|---|---|
| **Citas con saldo pendiente**: cada consulta que la familia aún no termina de pagar, con sus cargos por categoría, neto, pagado, saldo y estado (*sin pagar* o *abono parcial*), y los totales | `GET /caja/api/v1/reportes/citas-pendientes?pacienteId=&desde=&hasta=` | Reportes → *Adicional · Citas con saldo pendiente*, con hoja e impresión como los siete | `administracion` |
| Bitácora de dictámenes de farmacovigilancia | `GET /vigia/api/v1/validaciones` | Recetario, tras cada validación | `medico` |

### Lo que el enunciado no pide y el sistema hace igual

Estas cuatro no salen del enunciado; están porque sin ellas el prototipo no
resistiría una pregunta incómoda en la defensa.

| | Qué hace | Dónde se ve |
|---|---|---|
| **Farmacovigilancia** (`ms-vigia`) | Antes de guardar una receta comprueba alergias, interacciones, duplicidad terapéutica, criterios geriátricos y dosis máxima. Si el veredicto es `BLOQUEADO` la receta **no se guarda** y responde `409` con el motivo. | Recetario, y al recetar dentro de una consulta |
| **Control de acceso** (`ms-gateway`) | Inicio de sesión, JWT firmado, revocación al cerrar sesión, límite de intentos y una matriz de acceso por rol y por ruta. | Pantalla de acceso, y los `403` de cada rol |
| **Separación de datos** | Una base por microservicio, un usuario de MySQL por base, y ningún usuario con permiso sobre la base de otro. Lo comprueba `verificar.sh` en sus bloques 16, 19 y 21. | `bash verificar.sh` |
| **Administración de cuentas** (`ms-gateway`) | El `ADMINISTRADOR` da de alta al personal con una clave temporal que se muestra una sola vez y vence a las 72 horas; quien la recibe tiene que cambiarla en su primer ingreso. Restablecer, desactivar o cambiar el rol cierra al instante las sesiones abiertas de esa persona. Las cuentas **no se borran**: se desactivan, y el usuario de MySQL del gateway ni siquiera tiene permiso de `DELETE`. Cada acción queda en una bitácora firmada con el token. | `/api/usuarios`, y el bloque 24 de `pruebas.sh` |

---

## 3. Cómo encaja con lo que ya se entregó del curso

- **Tarea de diseño arquitectónico (N-Tiers).** Los cuatro microservicios de
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

## 4. Arquitectura del conjunto

```
                  navegador  ->  http://localhost:8090   (unico puerto que
                                      |                   abre el navegador)
                  +---------------------------------------------+
                  |   estacion-web  (nginx)                     | contenedor 1
                  |   sirve la interfaz y reenvia todo          |
                  |   a ms-gateway                              |
                  +----------------------+----------------------+
                                         |  /api /vigia /pastillero
                                         |  /caja /consultas
                                         v
                  +---------------------------------------------+
                  |                 ms-gateway                  | contenedor 2
                  |   login + JWT + revocacion + limite de       | puerto 8080
                  |   intentos + matriz de acceso por rol        | (publicado)
                  +--+----------+-------------+--------------+---+
                 /vigia    /pastillero      /caja       /consultas
                    |          |              |              |
      +-------------v-+  +-----v---------+  +-v-----------+  +v----------------+
      |   ms-vigia    |  | ms-pastillero |  |   ms-caja   |  |  ms-consultas   |
      | farmacovigi-  |  | padron, plan  |  | entradas,   |  | remision, cita, |
      | lancia        |  | y tomas       |  | salidas y   |  | consulta, ficha |
      | Python+Flask  |  | Python+Flask  |  | caja        |  | y aviso al      |
      |               |  |               |  | Python+Flask|  | familiar        |
      |               |  |               |  |             |  | Python+Flask    |
      +--^---------^--+  +--^---------^--+  +------^------+  +--+---+---+------+
         |         |        |         |            |            |   |   |
         |         +--------+         |            |            |   |   |
         |          (1) el dictamen   |            |            |   |   |
         |                            |            |            |   |   |
         +----------------------------+            |            |   |   |
                  (2) la ficha del interno         |            |   |   |
         |                                         |            |   |   |
         +-----------------------------------------|------------+   |   |
                  (4) el dictamen de la receta     |                |   |
                                    |              |                |   |
                                    +--------------|----------------+   |
                                     (3) el padron |                    |
                                                   +--------------------+
                                        (5) el cobro, con token de servicio

         | usr_vigia    | usr_pastillero   | usr_caja      | usr_consultas
         v              v                  v               v
   +---------------------------------------------------------------------+
   |                      bd-asilo   ·   MySQL 8.4                        | cont. 7
   |                                                                      |
   |  asilo_vigia    asilo_pastillero   asilo_caja      asilo_consultas   |
   |  validaciones   internos, planes,  cargos, pagos,  solicitudes,      |
   |                 tomas              donaciones,     visitas, examenes,|
   |                                    gastos,         indicaciones,     |
   |                                    pagos_fundacion correos_enviados  |
   |                                                                      |
   |  asilo_acceso (de ms-gateway, con usr_acceso): usuarios y            |
   |  bitacora_usuarios, las cuentas del personal                         |
   |                                                                      |
   |  Cinco bases separadas, un usuario por servicio, y ningun usuario    |
   |  con permiso sobre la base de otro.            sin puerto al host    |
   +---------------------------------------------------------------------+
      contenedores 3, 4, 5 y 6 arriba (sin puerto al host)
```

Los cinco puntos de integracion entre microservicios estan numerados arriba:

1. **`ms-pastillero` -> `ms-vigia`**: antes de programar un tratamiento le pide
   el dictamen por folio. Si el veredicto fue `BLOQUEADO`, responde `409` y no
   programa nada.
2. **`ms-vigia` -> `ms-pastillero`**: antes de dictaminar le pide la ficha del
   interno (edad, alergias, psicopatologias y medicacion activa), porque ese
   dato no puede venir del navegador. Si no responde, `ms-vigia` devuelve `503`
   y no dictamina a ciegas.
3. **`ms-consultas` -> `ms-pastillero`**: antes de remitir comprueba que el
   interno exista en el padron, y de paso saca el correo de su familiar
   responsable para avisarle. Si el padron no responde, devuelve `503` y no
   registra la remision a ciegas.
4. **`ms-consultas` -> `ms-vigia`**: cada receta que el especialista escribe
   dentro de una consulta pasa por la misma farmacovigilancia. Si sale
   `BLOQUEADO`, la receta **no se guarda** y responde `409`.
5. **`ms-consultas` -> `ms-caja`**: al abrir la consulta, indicar un examen o
   entregar un medicamento, el cobro queda asentado en la caja, con la consulta
   de la que salió y el nombre del interno. Quien dispara la accion es
   un MEDICO o FARMACIA, y ninguno de los dos puede escribir en la caja: el
   cobro viaja con un **token de servicio** de un minuto, firmado con el mismo
   secreto compartido, que lleva el nombre real de la persona para que el cargo
   quede firmado por ella y no por un robot. `ms-caja` acepta ese token
   UNICAMENTE para crear cargos: no puede pagar, ni donar, ni leer nada.

   Si `ms-caja` no responde, el dato clinico **se guarda igual** y el cargo
   queda nulo, para conciliarse despues. No se pierde un examen ni una receta
   por un fallo de facturacion.

Es una dependencia en los dos sentidos, y esta asumida a proposito: ver la
decision de diseño mas abajo, donde tambien se explica por que **no** genera un
ciclo al levantar el stack.

Red interna `asilo` de Docker. Los servicios se encuentran por **nombre de
servicio** (`http://ms-vigia:8081`), no por IP.

**Al equipo anfitrión solo se le publican dos puertos: el 8090 de la estación
web y el 8080 del gateway.** `ms-vigia`, `ms-pastillero`, `ms-caja` y
`ms-consultas` no tienen
bloque `ports:` en el `docker-compose.yml`: viven únicamente dentro de la red
interna. Antes sí lo tenían, y eso hacía del gateway un adorno — bastaba un
`POST` a `http://localhost:8083/api/v1/donaciones` para meter una donación
inventada en los libros del asilo sin haber iniciado sesión nunca.

### Cómo se protege cada ruta

`ms-gateway` exige una sesión iniciada (`Authorization: Bearer <token>`) para
**cualquier** ruta de los cuatro microservicios de dominio, y hace cumplir esta
matriz. Se controla la lectura y no solo la escritura: en un sistema de salud,
quién puede *ver* la historia clínica o el estado financiero de una familia
importa tanto como quién puede modificarlos.

| Ruta detrás del gateway | Quién puede leer (GET) | Quién puede escribir |
|---|---|---|
| `/vigia/*`      | `MEDICO`, `ENFERMERIA` | solo `MEDICO` (dictaminar una prescripción es un acto clínico) |
| `/pastillero/*` | `MEDICO`, `ENFERMERIA` | `MEDICO` o `ENFERMERIA` (programar, administrar, omitir) · **suspender: solo `MEDICO`** |
| `/pastillero/api/v1/internos*` | `MEDICO`, `ENFERMERIA`, `ADMINISTRACION`, `ADMINISTRADOR` | solo `ADMINISTRADOR` (alta, datos administrativos, egreso) |
| `/pastillero/api/v1/internos/{id}/clinica` | — | solo `MEDICO` |
| `/caja/*`       | `ADMINISTRACION` | solo `ADMINISTRACION` (cargos, pagos, donaciones, gastos, cuotas) |
| `/api/usuarios*` (propia del gateway) | `ADMINISTRADOR` | solo `ADMINISTRADOR` (alta, edición, restablecer, desactivar, reactivar; no existe borrar) |

Las dos filas del padrón son la misma regla vista por sus dos lados, y el
orden en que se comprueban importa: `/clinica` se mira **antes** que el resto
del padrón, y la regla del padrón no la abarca. Si fuera al revés, quien
gestiona el padrón podría escribir alergias por el camino de los datos
administrativos, y son los datos con los que `ms-vigia` decide si un
medicamento es seguro.

**Dos excepciones, las dos documentadas y las dos solo de lectura:**

1. `GET /caja/api/v1/pacientes/{id}/cuenta` la puede leer también el `MEDICO`.
   Antes de indicar un estudio de laboratorio necesita saber si el familiar
   responsable puede costearlo; sin ese dato terminaría indicando exámenes que
   nunca se van a hacer. Alcanza solo la cuenta de un interno concreto: el
   médico no ve el resumen financiero del asilo, ni las donaciones, ni los
   gastos, ni la cuenta con la fundación.
2. `GET /pastillero/api/v1/internos` la pueden leer también `ADMINISTRACION` y
   `ADMINISTRADOR`: la primera porque le cobra a la familia de cada interno, el
   segundo porque el padrón es su pantalla. Pero `ms-pastillero` les responde
   la ficha **sin la parte clínica**: sin psicopatologías, sin alergias y sin
   medicación. Saber que Rosalía está internada aquí es un dato administrativo;
   saber que tiene demencia mixta es un dato clínico. Y las tomas, los planes y
   la adherencia les siguen respondiendo `403`.

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
  -d '{"donante":"ATACANTE","tipo":"EMPRESA_NACIONAL","monto":99999}'
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

### Lo que queda en pantalla al cerrar sesión

El servidor nunca le entregó a un rol lo que no le toca, pero la pantalla sí
lo mostraba. La estación es una sola página: las vistas siguen en el DOM
aunque estén ocultas, y cada una se repinta solo cuando se entra a ella. Al
cerrar sesión no se borraba lo pintado, y el siguiente usuario veía lo que
había dejado el anterior. Administración veía la hoja «Medicamentos aplicados
por paciente» que generó el médico. El médico veía en la cuenta del interno el
bloque «Costo por consulta» que armó administración, y la hoja «Costos de cada
cita por paciente».

Ahora, al cerrar sesión o cuando la sesión expira, `vaciarPantallas()` deja la
estación en blanco antes de volver al acceso:

- vacía los paneles de todas las vistas: informes, caja, ficha, consultas,
  padrón y bandejas;
- cierra los cajones y cancela una confirmación que haya quedado abierta;
- limpia los formularios a medio llenar y quita los avisos;
- olvida el padrón que había cargado. Si no, una bandeja de un rol que no lee
  el padrón pondría nombres que ese rol no debería ver;
- cierra el cuadro de la **clave temporal** y la borra del DOM. Una clave
  recién emitida que se queda en pantalla para el siguiente es la misma fuga,
  con algo más grave adentro. Esa clave tampoco vive en ninguna variable ni se
  escribe nunca en `sessionStorage`: existe solo mientras el cuadro está
  abierto.

Una respuesta que llega después de cerrar sesión tampoco se pinta: `pedir()`
la descarta si el token cambió mientras venía en camino. Al cambiar de informe
en el selector, la hoja anterior se vacía, no solo se oculta.

---

## 5. Cómo ejecutarlo

Requisito único: **Docker Desktop** instalado y corriendo.

**Paso previo, una sola vez por instalación:** crear el archivo `.env` con el
secreto que firma las sesiones. No hay secreto por defecto en ninguna parte
del código, a propósito: un secreto de desarrollo escrito en el repositorio es
un secreto publicado, y cualquiera que lo lea puede firmarse un token de
`MEDICO`. El archivo `.env` está en `.gitignore` y no se versiona.

```bash
git clone https://github.com/ArtemioEdi/Asilo-Analisis-2-Proyecto-Final.git
cd Asilo-Analisis-2-Proyecto-Final
cp .env.ejemplo .env
for v in GATEWAY_SECRETO BD_CLAVE_ROOT BD_CLAVE_VIGIA BD_CLAVE_PASTILLERO \
         BD_CLAVE_CAJA BD_CLAVE_CONSULTAS BD_CLAVE_ACCESO; do
  sed -i "s|^$v=$|$v=$(openssl rand -hex 24)|" .env
done
```

Además del secreto de las sesiones, el `.env` lleva la clave de `root` y la de
cada uno de los cinco usuarios de MySQL; el ciclo de arriba, que es el mismo
del encabezado de `.env.ejemplo`, las genera todas.

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
| <http://localhost:8090> | La estación web: la interfaz de todo el sistema, con login |
| <http://localhost:8080/salud> | Estado de ms-gateway |
| <http://localhost:8080/vigia/salud> | Estado de ms-vigia (con sesión iniciada) |
| <http://localhost:8080/pastillero/salud> | Estado de ms-pastillero (con sesión iniciada) |
| <http://localhost:8080/caja/salud> | Estado de ms-caja (con sesión iniciada) |
| <http://localhost:8080/consultas/salud> | Estado de ms-consultas (con sesión iniciada) |

Los puertos 8081, 8082, 8083 y 8084 **ya no responden desde el equipo anfitrión**:
los microservicios solo son alcanzables por la red interna de Docker, a través
del gateway.

Para detener: `Ctrl + C` y luego `docker compose down`.
Para borrar también los datos y volver a sembrar los internos de ejemplo:
`docker compose down -v`.

### Usuarios de prueba

Las cuentas del personal viven en la base `asilo_acceso`, que gestiona
`ms-gateway`. La primera vez que MySQL arranca, `sql/06-esquema-acceso.sql`
**siembra siete cuentas** para la demostración, con la clave guardada como hash
**bcrypt** (nunca en texto plano), clave definitiva —no piden cambiarla— y
sesión de 8 horas. **Son credenciales de prueba de este prototipo académico.**
A partir de ahí, el `ADMINISTRADOR` da de alta, edita, restablece y desactiva
cuentas desde `/api/usuarios`, sin tocar ningún archivo.

Los cuatro primeros son **personal del asilo**. Los tres últimos son la
**fundación que presta el servicio médico** y sus dos proveedores: no son
empleados del asilo, y por eso no alcanzan el padrón de internos, ni la
farmacovigilancia, ni la caja.

| Usuario | Clave | Rol | Quién es y qué hace |
|---|---|---|---|
| `medico` | `medico2026` | `MEDICO` | Dr. Angel Maltez. Receta, remite a especialidad y atiende consultas. |
| `enfermeria` | `enfermeria2026` | `ENFERMERIA` | Administra las tomas del día y registra omisiones. |
| `administracion` | `admin2026` | `ADMINISTRACION` | Marta Solís. Lleva la caja: cobros, pagos, donaciones y gastos. |
| `admin` | `admin2026x` | `ADMINISTRADOR` | Ing. Dolores Ramírez. Gestiona el padrón —alta, datos administrativos y egreso de los internos— y las cuentas del personal. |
| `fundacion` | `fundacion2026` | `FUNDACION` | Fundación Manos Unidas. Recibe las remisiones y les asigna médico, fecha y hora. |
| `laboratorio` | `laboratorio2026` | `LABORATORIO` | Lab. Clínico Central. Carga el resultado de los exámenes indicados. |
| `farmacia` | `farmacia2026` | `FARMACIA` | Farmacia de la Fundación. Entrega los medicamentos recetados. |

`ADMINISTRADOR` y `ADMINISTRACION` se parecen en el nombre y no en lo que
pueden hacer, y conviene tenerlo claro antes de la defensa. El primero **da de
alta y egresa internos** y **administra las cuentas del personal**, y no toca la
caja; la segunda **cobra** y puede leer
el padrón para saber a quién le cobra, pero no lo modifica. Ninguno de los dos
escribe la parte clínica de la ficha: las psicopatologías, las alergias y la
medicación permanente las firma el médico, porque son los datos con los que
`ms-vigia` decide si un medicamento es seguro.

**El ciclo de una cuenta nueva.** El administrador la da de alta con usuario,
nombre y rol, y el gateway responde con una **clave temporal** de 10
caracteres —sin `0 O o 1 l I`, que se confunden al dictarla—, **esta única
vez**: no se guarda en ningún lado salvo como hash. Vence a las 72 horas. Con
ella la persona entra, pero solo a elegir su clave definitiva: el token que
recibe tiene el rol `CAMBIO_DE_CLAVE`, que no existe en ninguna matriz, así que
ni el gateway ni ningún microservicio lo dejan pasar a otra cosa. La clave
nueva necesita al menos 8 caracteres, con una letra y un dígito, distinta de la
actual y del nombre de usuario. Al guardarla recibe un token normal y sigue
trabajando.

**Cuándo se cierra una sesión abierta.** Cada cuenta lleva un número de
versión que viaja dentro del token, y el gateway lo compara en cada petición
con el de la base. Restablecer la clave, desactivar, reactivar, cambiar el rol
o cambiar la propia clave lo incrementan: todos los tokens anteriores de esa
persona dejan de servir **al instante**, sin esperar a que venzan.

Si la base de cuentas no responde, el login devuelve `503` y no deja entrar a
nadie: nunca se da acceso porque no se pudo comprobar quién es.

El acceso está endurecido: cinco intentos fallidos del mismo usuario en cinco
minutos y el gateway responde `429` con `Retry-After`. Además, un login
fallido tarda lo mismo exista o no el usuario (siempre se compara contra un
hash, incluso cuando no hay nadie con ese nombre), para que cronometrar la
respuesta no revele qué usuarios están dados de alta.

### El escenario sembrado

La primera vez que arranca el stack —o después de `docker compose down -v`—
`ms-consultas` deja la cadena clínica en un estado desde el que se puede
recorrer todo el sistema **sin crear nada a mano**. Se apaga con `SEMBRAR=0`
en el `.env`.

| Estado | Interno | Para qué sirve |
|---|---|---|
| `PENDIENTE` · `SOL-2026-DEMO0007` | Tránsito Xicará (ASL-007) | La fundación la agenda **en vivo**. Cardiología, por presión elevada pese al enalapril que ya toma. |
| `AGENDADA` · `SOL-2026-DEMO0014` | Rosalía Menchú (ASL-014) | El médico la atiende **en vivo**. Psiquiatría, mañana a las 09:00. |
| `ATENDIDA` → visita `CERRADA` · `VM-2026-DEMO0022` | Bernardo Puac (ASL-022) | La consulta que **llena la ficha médica**: diagnóstico, observaciones, dos exámenes con resultado y warfarina entregada. |

Los folios llevan la palabra `DEMO` a propósito. Los que genera el sistema son
aleatorios (`SOL-2026-584C9650`), así que en la defensa se distingue de un
vistazo lo que venía sembrado de lo que se acaba de crear.

Tres cosas del sembrado que conviene saber antes de grabar:

- **Las bandejas de laboratorio y farmacia arrancan vacías**, y está bien: lo
  sembrado ya tiene resultado y ya fue entregado. Se llenan en vivo, en el paso
  4 y en el 6 del recorrido.
- **El medicamento sembrado se eligió preguntándole a `ms-vigia`.** Warfarina
  5 mg cada 24 h sale `APROBADO` y sin hallazgos para ese interno. Sembrar algo
  que la propia farmacovigilancia del sistema marcaría sería contradecirse en la
  demostración.
- **Los tres internos ya traen la cuota del mes en curso**, con su mes sellado.
  Si en la demostración se generan las cuotas de ese mismo mes, la pantalla
  dirá *«no hubo nada que generar: los 3 internos activos ya tenían su cuota»*,
  que es la respuesta correcta y no un error. Para ver el otro lado, elija el
  mes siguiente o genere después de dar de alta a un interno nuevo.

### El recorrido de la demostración, paso por paso

Cada paso es un usuario distinto. Hay que **cerrar sesión** (botón *Salir*)
entre uno y otro. Las acciones que dejan registro piden confirmación antes de
ejecutarse: aparece un diálogo con el resumen de lo que se va a hacer y hay que
aceptarlo.

| # | Usuario | Dónde | Qué se hace | Qué se muestra |
|---|---|---|---|---|
| 1 | `medico` | Consultas → **Remitir a especialidad** | Remitir a Rosalía Menchú (ASL-014) a una especialidad | Aparece en *Remisiones* como `PENDIENTE`, y en **Avisos a la familia** el correo recién generado. Abrir *Ver el correo*: sale entero, con destinatario y cuerpo. |
| 2 | `fundacion` | Bandeja de remisiones → **Asignar cita** | Agendar la remisión `DEMO0007` de Tránsito Xicará | Pasa a `AGENDADA` con médico, fecha y hora. La fundación **no ve** el padrón, ni la farmacovigilancia, ni la caja. |
| 3 | `medico` | Consultas → **Atender** | Abrir la consulta de la remisión `DEMO0014`, ya agendada. Pide confirmación: **Sí, atender** | Se abre el cajón de la consulta con el diagnóstico por llenar |
| 4 | `medico` | Cajón de la consulta → **Agregar examen** | Indicar un examen | Queda `SOLICITADO`. **El cobro se creó solo** en la caja, aunque el médico no pueda escribir en ella. |
| 5 | `laboratorio` | Exámenes solicitados → **Cargar el resultado** | Escribir el resultado del examen del paso 4 | Pasa a `RESULTADO_LISTO`, firmado por el laboratorio. **No ve las recetas.** |
| 6 | `medico` | Cajón de la consulta → **Recetar, si ms-vigia lo aprueba** | **Recetar quetiapina** (un antipsicótico) | **`ms-vigia` lo bloquea con `409`**: `FV-GER-04`, severidad `CRITICA`, "antipsicótico indicado a un paciente con demencia". La receta **no se guarda**. Este es el momento más fuerte de la demostración. |
| 7 | `medico` | Cajón de la consulta → **Recetar, si ms-vigia lo aprueba** | Recetar paracetamol 500 mg | Pasa el dictamen y queda recetado |
| 8 | `farmacia` | Medicamentos por entregar → **Entregar** | Entregar el paracetamol | Queda entregado y **se cobra solo**. **No ve los resultados de laboratorio.** |
| 9 | `medico` | Cajón de la consulta → **Guardar la ficha** y luego **Cerrar consulta** | Escribir diagnóstico y observaciones, guardar y cerrar. Pide confirmación, y avisa de que es irreversible | La consulta pasa a `CERRADA`. A partir de ahí **el servidor rechaza con `409`** agregarle exámenes, recetas o cambios de ficha: una consulta firmada es un documento. |
| 10 | `medico` | Elegir a Bernardo Puac (ASL-022) → **Ver ficha médica completa** | Abrir la ficha | Psicopatologías, alergias, y el historial con diagnóstico, exámenes con resultado y medicamentos. Junta **dos microservicios** en un documento. |
| 11 | `administracion` | Caja → **Costo por consulta** | Elegir a Bernardo Puac | El costo de la consulta cerrada, con su laboratorio y su farmacia sumados y el descuento de la fundación aplicado |
| 12 | `admin` | **Padrón** → *Dar de alta* | Registrar a un interno nuevo con su documento de identificación | Aparece en el padrón activo con su edad calculada. Si se repite el documento, el alta se rechaza con `409`: la unicidad la impone el motor, no una consulta previa. |
| 13 | `medico` | Consultas → elegir al interno nuevo → **Editar información clínica** | Agregar un medicamento permanente, elegir **warfarina** en la lista del vademécum, poner dosis y frecuencia, y guardar. Pide confirmación | El aviso dice qué cambió, y al pie del cajón queda «Última actualización: Dr. Angel Maltez» con la hora, tomados de la sesión. Es el único sitio donde se escribe la parte clínica: enfermería la lee pero no ve el botón, y el administrador **no puede** ni verla. |
| 14 | `medico` | Recetario → elegir al interno nuevo | Recetarle **ibuprofeno** | **`ms-vigia` lo bloquea**: la warfarina que se anotó en el paso 13 pesa en el dictamen igual que un plan de tomas activo. La medicación permanente no es un dato decorativo de la ficha. |
| 15 | `administracion` | Caja → **Cuota mensual de estadía** | Elegir el mes y generar | Se crea la cuota de una vez para todo el padrón activo. **Volver a pulsarlo no cobra dos veces**: lo impide un índice único sobre (interno, mes), y el aviso dice cuántas se crearon y cuántas ya existían. |
| 16 | `administracion` | **Reportes** | Recorrer los cinco informes que le tocan: los cuatro del enunciado y el adicional de citas con saldo pendiente | Cada uno sale con filtros, totales al pie y el sello de **quién lo generó y cuándo**, tomado del token. Con el botón *Imprimir* sale una hoja limpia, sin menús. |
| 17 | `enfermeria` | **Reportes** | Abrir la pantalla | Ve **un solo informe**, el séptimo: medicamentos aplicados por paciente. Los otros seis no están en su lista, y pedirlos a mano devuelve `403`. |
| 18 | `admin` | Padrón → interno nuevo → **Egresar** | Egresar al interno del paso 12 | Sale del padrón activo y **conserva su historial**: un interno nunca se borra. Sus planes quedan `FINALIZADO`, sus tomas futuras `OMITIDA`, y si debe dinero el egreso lo avisa —la deuda no impide irse, pero la cuenta sigue siendo exigible al familiar—. En las cuotas del mes siguiente ya no aparece. |

Si además quiere mostrar el aislamiento de datos, sin salir de la terminal:

```bash
bash verificar.sh          # 115 comprobaciones, entre ellas las 21 puertas
                           # cerradas de los tres roles nuevos, la matriz
                           # completa del ADMINISTRADOR y el aislamiento de
                           # usr_consultas y de usr_acceso
```

### Los dos guiones de comprobación

El proyecto trae dos, con propósitos distintos. Los dos corren en **Git Bash
sobre Windows** (y en Linux y macOS), imprimen `OK` o `FALLA` en cada línea y
salen con código distinto de cero si algo falla, así que sirven para
encadenarlos. Los dos necesitan el stack levantado.

| | `pruebas.sh` | `verificar.sh` |
|---|---|---|
| **Qué es** | Prueba de humo **funcional** | Revisión de **seguridad, base de datos y repositorio** |
| **Comprobaciones** | **273**, en 27 bloques | **115**, en 21 bloques |
| **Punto de vista** | Recorre el sistema como lo haría una persona, siempre a través del gateway | Mira el sistema desde afuera y desde el código fuente |
| **Requisitos** | `curl` y `python3` **o** `node` (usa el que encuentre); el bloque 23 corre en el `node` de `ms-gateway` con `docker compose exec`, o en el del equipo si no hay `docker` | `curl` y `docker` (consulta MySQL con `docker compose exec`) |

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

Su bloque 16 recorre **la cadena clínica entera**, con un rol distinto en cada
paso, que es justo lo que hace valer la separación: el médico remite, la
fundación agenda, el médico atiende e indica un examen, el laboratorio carga el
resultado, el médico receta, la farmacia entrega y el médico cierra. Después de
cada paso comprueba que **ningún otro rol podía haberlo hecho**. En medio está
el caso que más se defiende solo: el médico receta un antipsicótico a la interna
con demencia mixta y `ms-vigia` lo **bloquea con `409`**, con el código del
hallazgo (`FV-GER-04`), su severidad (`CRITICA`) y la comprobación de que la
receta **no quedó guardada**. El bloque 17 pide los tres reportes sobre esa
consulta recién hecha.

Los bloques 18 a 22 y del 24 en adelante cubren lo que se agregó después, y todos parten de la
consulta del bloque 16 o de lo que ellos mismos dan de alta, para que el
guion se pueda correr dos veces seguidas sin limpiar la base:

- **18** — una consulta cerrada rechaza con `409` que le agreguen un examen,
  una receta o un cambio de ficha, y no se puede cerrar dos veces.
- **19** — los siete informes, cada uno pedido con su rol (`200`) y con el rol
  equivocado (`403`), más el sello del servidor con quién los generó.
- **20** — el padrón: alta con documento único, el documento repetido
  rechazado con `409`, la modificación que no toca la identidad, y la parte
  clínica que el administrador no puede escribir y el médico sí. Termina
  recetándole ibuprofeno al interno nuevo para comprobar que la **medicación
  permanente** que se le acaba de anotar pesa en el dictamen.
- **21** — la cuota del mes generada dos veces sin duplicar, contada en la base
  y no solo en la respuesta, y los dos caminos por los que nace una cuota: sin
  el mes se rechaza, con el mes se registra, y repetirla da `409`.
- **22** — el egreso: sale del padrón activo, sigue en el de egresados,
  conserva su historial clínico, avisa de la deuda, no se puede egresar dos
  veces y ya no entra en las cuotas del mes siguiente.
- **24** — la administración de cuentas, con una cuenta de nombre único en
  cada corrida (las cuentas no se borran, así que se acumulan desactivadas).
  Solo el `ADMINISTRADOR` las ve; el alta devuelve la clave temporal; con ella
  se entra solo a cambiarla, y ese token no pasa ni por el gateway ni directo
  a `ms-pastillero` desde la red interna; la clave débil y la repetida se
  rechazan; restablecer y desactivar cierran la sesión viva al instante; la
  desactivada no entra pero sigue en la lista; reactivar emite otra clave
  temporal; el administrador no puede desactivarse a sí mismo; `DELETE` da
  `405`; el usuario repetido, `409`; cada acción queda en la bitácora firmada
  con el token, y **ninguna respuesta lleva un hash bcrypt**.
- **25** — las citas con saldo pendiente, sobre dos internos y dos consultas
  inventados en cada corrida: sin pagar aparece como `PENDIENTE` con su saldo
  y sus cargos por categoría; tras un abono parcial, `PARCIAL` con el saldo
  correcto; pagada completa ya no aparece; los filtros por interno y por fecha
  funcionan y una fecha mal escrita da `400`; el conteo del resumen de la caja
  coincide con el informe; `medico`, `enfermeria` y el administrador del padrón
  reciben `403`. Al final salda lo que creó, y comprueba que los tres cargos
  que dejó la consulta del bloque 16 llevan el nombre del interno, en la lista
  de cargos y en el informe.
- **26** — la información clínica, sobre un interno dado de alta en cada
  corrida: nace sin autor de la parte clínica; el médico registra warfarina
  permanente y el cambio queda firmado con su sesión aunque el cuerpo traiga
  otro autor; con esa ficha el ibuprofeno sale `BLOQUEADO` y el paracetamol
  `APROBADO`; enfermería y el administrador reciben `403` al escribir;
  enfermería lee la ficha con su autor y el administrador no ve ni una cosa ni
  la otra.
- **27** — los pagos a la fundación: un pago baja el saldo en lo justo, aparece
  en el informe 4 firmado por quien lo registró, y un pago mayor que el saldo,
  con más de dos decimales o sin referencia se rechaza con `400` sin mover el
  saldo; `medico` recibe `403`.

**Qué cubre `verificar.sh`** — lo que no se ve desde la interfaz: la matriz de
acceso rol por rol y ruta por ruta; la defensa en profundidad, comprobando que
un microservicio rechace por su cuenta a quien se salte el gateway desde la red
interna; que la bitácora se firme con el token y no con el cuerpo de la
petición; **la matriz de los tres roles nuevos** —21 puertas probadas, entre
ellas que ninguno de los tres alcance el padrón, la farmacovigilancia ni la
caja, y que dentro de la cadena clínica el laboratorio no lea recetas ni la
farmacia resultados—; **la matriz completa del rol `ADMINISTRADOR`**, que es
el bloque 20: lo que sí le toca —leer el padrón, dar de alta, modificar y
egresar— y lo que no —la parte clínica, la jornada de enfermería, la
farmacovigilancia, la caja y la cadena clínica—, más la simétrica, que es la
que suele quedar abierta: que `ADMINISTRACION` lea el padrón pero no lo
gestione; **el aislamiento entre las bases**, verificando que
`usr_caja` no pueda leer `asilo_vigia` y que `usr_consultas` no alcance
ninguna de las otras tres ni pueda alterar su propio esquema; **la base de
cuentas**, en el bloque 21: que `usr_acceso` lea la suya pero el motor le
niegue el `DELETE`, que no lea las bases de los otros servicios y que ninguno
de ellos lea la suya; que los nombres con tilde sobrevivan el viaje a MySQL y
de vuelta; y una **auditoría estática del repositorio**: sin claves de
demostración en texto plano en el código, sin `usuarios.json`, con la instancia
de la base completa y sin claves, sin rastros de SQLite, con `.env` ignorado, el dinero en `DECIMAL` y el puerto de MySQL sin
publicar.

Para partir de datos limpios (los internos y cargos de ejemplo recién
sembrados), borre los volúmenes antes. **La primera vez tarda entre 60 y 90
segundos**: MySQL crea su directorio de datos y ejecuta los archivos de `sql/`
antes de aceptar conexiones, y los microservicios esperan a que eso termine.

```bash
docker compose down -v && docker compose up -d --build
bash verificar.sh
```

> El recorrido de la interfaz en un navegador de verdad —acceso, rutas,
> confirmaciones, foco, portapapeles, teléfono e impresión— se hizo durante el
> desarrollo con scripts aparte: primero con Puppeteer, y desde el Bloque 7 con
> Edge en modo headless, manejado por su protocolo de depuración. **No se
> incluyen en el repositorio a propósito**: meterían `node_modules` o dependerían
> de un navegador instalado, en un proyecto cuyo único requisito debe seguir
> siendo Docker. `pruebas.sh` cubre los servicios, que es lo que se
> puede verificar sin dependencias extra.
>
> Con una excepción: el cambio de sesión. **El bloque 23 de `pruebas.sh`**
> corre `pruebas-interfaz/cambio-de-sesion.js`, que carga el `index.html` y el
> `app.js` que sirve `estacion-web` en un DOM mínimo escrito a mano, sin
> dependencias. Con ese DOM entra como médico, genera un informe, cierra
> sesión, entra como administración y comprueba que no quede nada del
> anterior. También hace el camino inverso. Y recorre las cuentas: el
> administrador da de alta una, ve la clave temporal y cierra sesión con el
> cuadro abierto; entra el médico y **no queda rastro de la clave** en ningún
> nodo, campo ni atributo, ni en `sessionStorage`. Después la cuenta nueva
> entra con esa clave, cae en la pantalla de cambio y no en la aplicación,
> sigue ahí al recargar, y al guardar su clave propia entra. No reemplaza a un navegador: el
> DOM cubre solo lo que `app.js` usa. Pero si `app.js` empieza a usar algo que
> ese DOM no tiene, el recorrido falla en lugar de pasar en falso.

---

## 6. Endpoints

### ms-gateway — `http://localhost:8080`

| Método | Ruta | Para qué |
|---|---|---|
| GET | `/salud` | Sonda de vida propia (no exige sesión) |
| POST | `/api/auth/login` | `{ usuario, clave }` → `{ token, usuario, nombre, rol }`. Con clave temporal → `{ token, usuario, nombre, debeCambiarClave: true }`, un token de 15 minutos que solo sirve para las tres rutas siguientes. `403` si la cuenta está desactivada, `401` si la clave temporal venció, `503` si la base de cuentas no responde |
| GET | `/api/auth/me` | Devuelve el usuario dueño del token vigente |
| POST | `/api/auth/logout` | Revoca el token vigente: deja de servir aunque no haya vencido |
| POST | `/api/auth/cambiar-clave` | `{ claveActual, claveNueva }`. Para el cambio obligatorio y el voluntario; exige la clave actual en los dos. Devuelve un token normal nuevo y el anterior deja de servir |
| GET | `/api/usuarios` | **Solo `ADMINISTRADOR`.** Las cuentas, activas y desactivadas, sin el hash de la clave |
| POST | `/api/usuarios` | `{ usuario, nombre, rol }` → `201` con la cuenta y la `claveTemporal`, esta única vez. `409` si el usuario ya existe, aunque esté desactivado |
| PUT | `/api/usuarios/{usuario}` | `{ nombre, rol }`. Cambiar el rol cierra las sesiones abiertas de esa persona |
| POST | `/api/usuarios/{usuario}/restablecer` | Clave temporal nueva, devuelta una sola vez; cierra sus sesiones abiertas |
| POST | `/api/usuarios/{usuario}/desactivar` | `{ motivo }`, obligatorio. Cierra sus sesiones abiertas |
| POST | `/api/usuarios/{usuario}/reactivar` | Activa la cuenta **con una clave temporal nueva**: la anterior ya no se da por segura |
| GET | `/api/usuarios/{usuario}/bitacora` | Historial de la cuenta: qué se hizo, quién y cuándo |
| DELETE | `/api/usuarios/{usuario}` | **No existe**: `405`, «Las cuentas no se borran: se desactivan.» |
| * | `/vigia/*`, `/pastillero/*`, `/caja/*`, `/consultas/*` | Reenvía la petición al microservicio correspondiente, ya autenticada |

El administrador no puede desactivarse ni cambiarse el rol a sí mismo, y nadie
puede dejar al sistema sin un `ADMINISTRADOR` activo: las dos salvaguardas
responden `409` con su motivo.

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
| GET | `/api/v1/internos?estado=ACTIVO\|EGRESADO\|TODOS` | **Padrón de internos del asilo** con su ficha. Sin el parámetro, solo los activos |
| GET | `/api/v1/internos/{id}` | Ficha de un interno: edad, cama, ingreso, psicopatologías, alergias, familiar responsable y medicación activa |
| POST | `/api/v1/internos` | **Alta de un interno.** Exige documento de identificación único (rol `ADMINISTRADOR`) |
| PUT | `/api/v1/internos/{id}` | Datos administrativos: nombre, ubicación, responsable. No toca documento, nacimiento ni sexo, que son la identidad (rol `ADMINISTRADOR`) |
| PUT | `/api/v1/internos/{id}/clinica` | Psicopatologías, alergias y medicación permanente (rol `MEDICO` y solo él) |
| PUT | `/api/v1/internos/{id}/egreso` | **Egresa al interno**: sale del padrón activo, sus planes quedan `FINALIZADO` y sus tomas futuras `OMITIDA`, en una sola transacción (rol `ADMINISTRADOR`) |
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
| POST | `/api/v1/cargos` | Carga un cobro a la cuenta del interno, ya con el descuento. Si la categoría es `CUOTA` exige además el mes que cubre (rol `ADMINISTRACION`) |
| GET | `/api/v1/cargos?pacienteId=&desde=&hasta=&estado=` | **Informe 3**: cobros por paciente y rango de fecha |
| GET | `/api/v1/pacientes/{id}/cuenta` | Estado de cuenta: cargos, pagos y saldo pendiente |
| POST | `/api/v1/cargos/{id}/pagar` | Registra un pago o abono sobre un cargo (rol `ADMINISTRACION`) |
| POST | `/api/v1/cuotas/generar` | **Genera la cuota del mes** para todo el padrón activo. Idempotente: repetirlo no cobra dos veces (rol `ADMINISTRACION`) |
| GET / POST | `/api/v1/donaciones` | Lista o registra una donación (empresa internacional, empresa nacional, gobierno, particular) |
| GET / POST | `/api/v1/gastos` | Lista o registra un gasto operativo del asilo |
| GET | `/api/v1/fundacion/resumen` | Adeudo con la fundación por consultas, laboratorio y farmacia |
| POST | `/api/v1/fundacion/pagos` | Registra un pago del asilo a la fundación |
| GET | `/api/v1/reportes/costo-por-visita?visitaId=` | **Informe 1**: costo de una cita, sumando consulta, laboratorio y farmacia |
| GET | `/api/v1/reportes/pagos-fundacion?desde=&hasta=` | **Informe 4**: pagos realizados a la fundación |
| GET | `/api/v1/reportes/entradas?desde=&hasta=` | **Informe 5**: entradas por donaciones y cobros |
| GET | `/api/v1/reportes/citas-pendientes?pacienteId=&desde=&hasta=` | **Citas con saldo pendiente**: las visitas con saldo mayor que cero, agrupando los cargos por `visita_id` en la base de la caja, sin preguntarle a ms-consultas. `PENDIENTE` si no se pagó nada, `PARCIAL` si una parte; las sumas las hace MySQL sobre `DECIMAL`. Las fechas filtran por el primer cargo de cada visita. Filtros opcionales |
| GET | `/api/v1/resumen` | Panel general: entradas, salidas, saldo pendiente, balance y cuántas citas tienen saldo |

---

### ms-consultas — detrás del gateway en `/consultas` (no tiene puerto propio en el anfitrión)

La cadena clínica va en un solo servicio porque es una sola historia: una
remisión produce una cita, la cita produce una consulta, y la consulta produce
exámenes y recetas. Partirla en cuatro servicios habría repartido una
transacción entre cuatro bases sin ganar nada.

| Método | Ruta | Para qué | Rol |
|---|---|---|---|
| GET | `/salud` | Sonda de vida | — |
| POST | `/api/v1/solicitudes` | **Remite** al interno a una especialidad. Comprueba el padrón y **avisa al familiar** por correo. | `MEDICO` |
| GET | `/api/v1/solicitudes` | Remisiones, filtrables por `pacienteId` y `estado` | `MEDICO`, `ENFERMERIA`, `FUNDACION` |
| GET | `/api/v1/solicitudes/{id}` | Una remisión | `MEDICO`, `ENFERMERIA`, `FUNDACION` |
| PUT | `/api/v1/solicitudes/{id}/agendar` | **Asigna** médico, especialidad, fecha y hora | `FUNDACION` |
| GET | `/api/v1/correos` | Bitácora de avisos al familiar, con asunto y cuerpo completos | `MEDICO`, `ENFERMERIA` |
| POST | `/api/v1/visitas` | **Abre la consulta** desde una remisión agendada, y cobra la consulta en `ms-caja` | `MEDICO` |
| GET | `/api/v1/visitas` | Consultas, con sus exámenes e indicaciones | `MEDICO`, `ENFERMERIA`, `LABORATORIO`, `FARMACIA` |
| GET | `/api/v1/visitas/{id}` | Una consulta con su ficha | igual que arriba |
| PUT | `/api/v1/visitas/{id}` | Llena diagnóstico y observaciones | `MEDICO` |
| PUT | `/api/v1/visitas/{id}/cerrar` | Cierra la consulta | `MEDICO` |
| POST | `/api/v1/visitas/{id}/examenes` | **Indica un examen** y lo cobra en `ms-caja` | `MEDICO` |
| GET | `/api/v1/examenes` | Exámenes, filtrables por `pacienteId` y `estado` | `MEDICO`, `ENFERMERIA`, `LABORATORIO` |
| PUT | `/api/v1/examenes/{id}/resultado` | **Carga el resultado** | `LABORATORIO` |
| POST | `/api/v1/visitas/{id}/indicaciones` | **Receta**, previo dictamen de `ms-vigia` | `MEDICO` |
| PUT | `/api/v1/indicaciones/{id}/entregar` | **Entrega** y lo cobra en `ms-caja` | `FARMACIA` |
| GET | `/api/v1/reportes/examenes` | Exámenes de un interno, con cuántos siguen pendientes | `MEDICO`, `ENFERMERIA`, `LABORATORIO` |
| GET | `/api/v1/reportes/ficha` | **Ficha médica completa**: psicopatologías, alergias e historial | `MEDICO`, `ENFERMERIA` |

Dos detalles del reparto que valen la pena:

- Una visita trae la ficha entera. Sin filtrar por bloque, el laboratorio
  leería las recetas y la farmacia los resultados de laboratorio con solo pedir
  la visita. Por eso `GET /api/v1/visitas` **recorta** el bloque que no le toca
  a quien pregunta, aunque los cuatro roles puedan abrir la visita.
- La **ficha médica completa** se queda en manos clínicas. Al laboratorio y a
  la farmacia darles la ficha entera desharía ese recorte por otra puerta.

Y uno de `ms-caja`, que apareció con este servicio:

| Método | Ruta | Para qué | Rol |
|---|---|---|---|
| GET | `/api/v1/reportes/costo-por-visita` | **Cuánto costó una consulta**, sumando su laboratorio y su farmacia | `ADMINISTRACION` |

---

## 7. Las cinco reglas de ms-vigia

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

El primer caso vale la pena mirarlo de cerca: la warfarina de Bernardo **no
viene de un plan de tomas**, sino de su medicación permanente —las "medicinas
de cajón" que el enunciado pide registrar—. `ms-pastillero` la suma a la
medicación actual antes de que `ms-vigia` dictamine, sin duplicar lo que ya
viene de un plan activo. Un campo que se muestra en la ficha pero que el motor
no mira sería peor que no tenerlo: aprobaría el ibuprofeno con toda
naturalidad. `pruebas.sh` cubre el caso a propósito, con un interno cuyo único
anticoagulante está en ese campo.

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
| `administracion` | dar de alta o egresar a un interno | `403` — lee el padrón porque cobra, pero no lo gestiona |
| `admin` (`ADMINISTRADOR`) | dar de alta, corregir o egresar a un interno | `201`/`200` — es exactamente su trabajo |
| `admin` | escribir alergias o medicación permanente | `403` — la parte clínica la firma el médico |
| `admin` | leer la caja, la farmacovigilancia o la jornada de enfermería | `403` — gestiona el padrón y nada más |
| `medico` | dar de alta o egresar a un interno | `403` — atiende internos, no los administra |
| `medico` | mandar `"alergias": []` en el cuerpo de una validación | se ignora: `ms-vigia` usa la ficha real de `ms-pastillero` |
| `medico` | agregar un examen o una receta a una consulta ya cerrada | `409` — una consulta firmada es un documento |
| `administracion` | generar las cuotas del mes dos veces | la segunda no cobra nada: lo impide el índice único sobre (interno, mes) |

Todos estos casos están automatizados en `pruebas.sh`.

---

## 8. La estación de enfermería

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
| `#/consultas` | La cadena clínica: remisiones, avisos a la familia, exámenes e historial |
| `#/reportes` | Los siete informes, y el adicional de citas con saldo pendiente, filtrados por lo que el rol puede ver |
| `#/padron` | Padrón de internos: alta, modificación y egreso |
| `#/usuarios` | Cuentas del personal: alta, edición, restablecimiento, desactivación y bitácora |
| `#/agenda` · `#/laboratorio` · `#/farmacia` | Las bandejas de la fundación, el laboratorio y la farmacia |

El acceso ocupa la pantalla completa, sin nada detrás. Al entrar, la aplicación
arranca arriba y en la vista que le toca al rol: medicina y enfermería en la
jornada, administración en la caja, el administrador en el padrón, y la
fundación, el laboratorio y la farmacia cada uno en su bandeja. Y solo se muestran las pestañas que el rol
puede usar — **con el nombre de lo que ese rol de verdad puede hacer**:

| Rol | Pestañas | Qué ve dentro |
|---|---|---|
| `MEDICO` | Jornada · Consultas · «Cuenta del interno» · Reportes | De la caja, solo los cargos y el saldo del interno seleccionado, que es su excepción de lectura. Sin balance y sin formularios. En Reportes, los informes 2, 6 y 7 |
| `ENFERMERIA` | Jornada · Consultas · Reportes | Sin pestaña de caja. En Reportes, **un solo informe**: el 7 |
| `ADMINISTRACION` | «Caja y donaciones» · Reportes | Módulo de caja completo: balance de entradas y salidas, estado de cuenta, formularios de cargo, donación, gasto y la cuota mensual, y el dato de citas con saldo pendiente. En Reportes, los informes 1, 3, 4 y 5, y el adicional de citas con saldo pendiente |
| `ADMINISTRADOR` | Padrón · Usuarios | El padrón —alta, edición y egreso— y las cuentas del personal. Ni caja, ni farmacovigilancia, ni jornada |
| `FUNDACION` | una sola vista, sin pestañas | La bandeja de remisiones por agendar. Sin lateral de internos: trabaja con el código del interno |
| `LABORATORIO` | una sola vista, sin pestañas | Los exámenes solicitados, para cargar el resultado. No ve las recetas |
| `FARMACIA` | una sola vista, sin pestañas | Los medicamentos por entregar. No ve los resultados de laboratorio |

El médico veía antes una pestaña llamada «Caja y donaciones» que prometía más
de lo que su rol puede leer. **La interfaz no pide lo que el rol no puede
leer**: con sesión de médico no se llega a hacer ni una petición que el gateway
vaya a responder con `403`, y la pantalla de reportes solo ofrece los informes
que ese rol puede pedir. Si alguien pidió `#/caja` antes de iniciar sesión, se
le guarda esa intención y se le lleva ahí después de entrar.

**Al vencerse la sesión no se expulsa de golpe:** se avisa en la pantalla de
acceso, se conserva el usuario escrito y se recuerda en qué vista estaba, para
devolverlo exactamente ahí al reingresar.

**El acceso dice por qué no se entra.** Una clave equivocada sigue siendo
«Usuario o clave incorrectos», pero la cuenta desactivada, la clave temporal
vencida y la base de cuentas caída muestran el mensaje del gateway, porque cada
una se resuelve distinto: las dos primeras con el administrador, la tercera
esperando. Antes las tres se leían como «clave incorrecta» y mandaban a la
persona a probar otra clave.

**Con una clave temporal no se entra a la aplicación.** Se entra a la pantalla
*Elija su clave*, al nivel del acceso y sin nada detrás: saluda por nombre,
explica por qué hay que cambiarla y pide la temporal, la nueva y su
repetición. Los requisitos están escritos y cada uno dice **«cumple» o
«falta»** en texto, no solo con color. Recargar la página no la saltea: la
estación le pregunta al gateway y, si el token es de cambio, vuelve ahí. Tiene
un botón *Salir*. El mismo formulario se abre desde **«Cambiar mi clave»**, en
la barra superior de todos los roles, para el cambio voluntario: ahí pide la
clave actual y se puede cancelar.

**La vista de cuentas del administrador** sigue el patrón del padrón:
encabezado con conteo, filtro (arranca en *activas*), la lista y los
formularios en cajón, con los mismos estados de carga, vacío y error. El estado
de cada cuenta va en palabras —*Activa*, *Desactivada*, *Clave temporal
pendiente*— además de su color y su forma. No hay botón de eliminar. Las
desactivadas se ven pero no se editan: solo se reactivan. Lo que el gateway va
a rechazar —desactivarse a sí mismo, quitarse el rol, restablecer la propia
clave, que cerraría la sesión antes de que la clave nueva se llegara a ver—
aparece deshabilitado **con el motivo escrito al lado**; el servidor decide
igual. La clave temporal sale en un cuadro aparte, en monoespaciada, con un
botón *Copiar*, la fecha de vencimiento y el aviso de que no se volverá a
mostrar. Ese cuadro no se cierra tocando fuera ni con Escape: cerrarlo por
descuido obligaría a restablecerla.

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

## 9. La base de datos

Motor: **MySQL 8.4**, en el contenedor `bd-asilo`. El enunciado exige MySQL,
SQL Server u Oracle; el prototipo empezó con SQLite y se migró.

### Una instancia, cinco bases separadas

Se conserva el patrón **database per service**: cada microservicio tiene su
propia base, su propio usuario y sus propios permisos. La quinta es la del
gateway, que guarda las cuentas del personal: autenticar ya era su trabajo, así
que no hizo falta otro microservicio.

| Base | Usuario | Servicio | Tablas |
|---|---|---|---|
| `asilo_vigia` | `usr_vigia` | ms-vigia | `validaciones` |
| `asilo_pastillero` | `usr_pastillero` | ms-pastillero | `internos`, `planes`, `tomas` |
| `asilo_caja` | `usr_caja` | ms-caja | `cargos`, `pagos`, `donaciones`, `gastos`, `pagos_fundacion` |
| `asilo_consultas` | `usr_consultas` | ms-consultas | `solicitudes`, `visitas`, `examenes`, `indicaciones`, `correos_enviados` |
| `asilo_acceso` | `usr_acceso` | ms-gateway | `usuarios`, `bitacora_usuarios` |

Cada usuario recibe `SELECT, INSERT, UPDATE, DELETE` **solo sobre su propia
base**, y nada más: ni `CREATE`, ni `DROP`, ni `ALTER`. Un servicio no puede
leer ni escribir la base de otro, y eso se comprueba en `verificar.sh`:

```bash
docker compose exec bd-asilo mysql -u usr_caja -p"$BD_CLAVE_CAJA" \
  -e "SELECT COUNT(*) FROM asilo_vigia.validaciones;"
# ERROR 1142 (42000): SELECT command denied to user 'usr_caja'@'...'
```

**`usr_acceso` tampoco tiene `DELETE`.** Solo `SELECT, INSERT, UPDATE` sobre
`asilo_acceso`. Una cuenta del personal no se borra nunca, se desactiva:
borrarla dejaría su bitácora sin dueño y permitiría volver a crear el mismo
nombre de usuario para firmar como otra persona, en una base donde las tomas,
los dictámenes y los cobros llevan ese nombre como firma. Que eso no pase no
depende de la buena voluntad del código del gateway: lo prohíbe el motor. Por
eso mismo la bitácora puede colgar de `usuarios` con una clave foránea sin
miedo a quedar huérfana. `verificar.sh` lo comprueba en su bloque 21:

```bash
docker compose exec bd-asilo mysql -u usr_acceso -p"$BD_CLAVE_ACCESO" \
  -e "DELETE FROM asilo_acceso.usuarios WHERE usuario = 'no-existe-nunca';"
# ERROR 1142 (42000): DELETE command denied to user 'usr_acceso'@'...'
```

### Por qué una sola instancia, y qué se sacrificó

Cinco servicios con database per service «de libro» tendrían **cinco
instancias** de motor, una por servicio. Aquí hay una sola, y es una decisión
consciente: el proyecto tiene que seguir levantando con un comando en la
máquina de un estudiante, y cinco contenedores de MySQL en un portátil son
más de 2 GB de memoria y varios minutos de arranque.

**Lo que se conserva** con esta decisión: el aislamiento *lógico* de los datos,
que es lo que sostiene el patrón. Ningún servicio conoce ni puede alcanzar el
esquema de otro; si mañana `ms-caja` se lleva a su propio motor, no hay una
sola consulta que reescribir, porque no existe ni un `JOIN` entre bases.

**Lo que se sacrifica**, y hay que decirlo:

- **Aislamiento de fallos.** Si el contenedor `bd-asilo` cae, caen los cinco
  servicios a la vez, y nadie puede iniciar sesión. Con instancias separadas, una caída de la base de caja
  dejaría el pastillero funcionando: la enfermera podría seguir registrando
  tomas aunque administración no pudiera cobrar.
- **Aislamiento de recursos.** Una consulta pesada de reportes en `asilo_caja`
  compite por CPU, memoria y buffer pool con las lecturas clínicas de
  `asilo_pastillero`. No hay forma de ponerle un límite a una sola base.
- **Escalar por separado.** No se puede darle más memoria, más réplicas o un
  disco más rápido solo a la base que lo necesita.
- **Mantenimiento independiente.** Una actualización de versión, un backup o
  una restauración afectan a los cinco servicios al mismo tiempo.

Migrar a una instancia por servicio no exige tocar el código: son cuatro
bloques más en el `docker-compose.yml` y un valor distinto de `BD_HOST` para
cada servicio.

### El esquema está en archivos SQL legibles

No lo crea la aplicación al arrancar: vive en `sql/`, y MySQL lo ejecuta la
primera vez que se levanta el volumen.

| Archivo | Qué hace |
|---|---|
| `01-bases-y-usuarios.sh` | Crea las cinco bases, los cinco usuarios y sus permisos. **Es un `.sh` y no un `.sql` a propósito:** MySQL ejecuta los `.sql` literalmente, sin expandir variables, así que un `.sql` obligaría a escribir las cinco claves dentro y versionarlas. El script las toma del entorno del contenedor, que el compose llena desde el `.env` |
| `01-bases-y-usuarios.ejemplo.sql` | **No se ejecuta.** Las mismas sentencias `CREATE USER` y `GRANT`, con claves de marcador, para poder leer el modelo de permisos sin leer shell |
| `02-esquema-vigia.sql` | Tabla de la bitácora de farmacovigilancia |
| `03-esquema-pastillero.sql` | Padrón de internos, planes y tomas |
| `04-esquema-caja.sql` | Cargos, pagos, donaciones, gastos y pagos a la fundación |
| `05-esquema-consultas.sql` | Remisiones, citas, visitas, exámenes, indicaciones y avisos al familiar |
| `06-esquema-acceso.sql` | Cuentas del personal y su bitácora, con la siembra de las siete cuentas de demostración. Es el único esquema que siembra desde SQL, y por eso abre con `SET NAMES utf8mb4`: sin él, el cliente del entrypoint lee el archivo como latin1 y «Fundación» se guarda con la codificación rota |

**Estos archivos son la entrega del modelo de datos** que pide el enunciado:
se leen de arriba abajo, con las claves, los tipos, las restricciones y los
índices a la vista.

Los seis que sí se ejecutan se montan **uno por uno** en el
`docker-compose.yml`, y no montando el directorio `sql/` completo. Si se
montara entero, MySQL ejecutaría también `01-bases-y-usuarios.ejemplo.sql`
—termina en `.sql`— y crearía los usuarios con las claves de marcador antes
de que el `.sh` alcanzara a crearlos bien.

Los servicios sí conservan el **sembrado de datos de demostración**,
condicionado a `SEMBRAR=1` y solo si la tabla está vacía. La excepción son las
siete cuentas del personal, que las siembra `06-esquema-acceso.sql`.

### Decisiones de tipos

| Qué | Tipo | Por qué |
|---|---|---|
| Dinero | `DECIMAL(10,2)` | Antes era `REAL`. Sumar centavos en coma flotante da totales de Q 449.99 donde debe decir Q 450.00, y un libro de caja no puede explicar esa diferencia |
| Fechas y horas | `DATETIME` / `DATE` | Antes eran texto ISO. Ahora los filtros por rango usan `DATE(creado_en) BETWEEN …` y el motor entiende lo que ordena |
| Identificadores y folios | `VARCHAR` con largo definido | Con su `PRIMARY KEY`; el folio de `ms-vigia` lleva además un `UNIQUE` explícito |
| Estados y categorías | `VARCHAR` con `CHECK` | Se eligió `CHECK` sobre `ENUM` porque es portable a SQL Server y Oracle, que el enunciado también admite. La misma convención en las cinco bases |
| Listas cortas | `JSON` | Psicopatologías, alergias y medicación permanente del interno, y el dictamen completo de `ms-vigia` |
| Motor | `InnoDB` | Con claves foráneas declaradas de verdad e índices sobre lo que de verdad se consulta |

Dos restricciones que hacen trabajo de verdad y no de adorno:

- **`UNIQUE (documento)` en `internos`.** Dos fichas para la misma persona son
  dos historiales clínicos incompletos. La unicidad la impone el motor y no una
  consulta previa, porque entre el `SELECT` y el `INSERT` cabe otra alta.
- **`UNIQUE (paciente_id, periodo_cuota)` en `cargos`.** Es lo que impide
  cobrarle dos veces la estadía del mismo mes a una familia, la haya registrado
  alguien a mano o la generación mensual. Los cargos que no son cuota llevan ese
  campo en `NULL`, y MySQL no hace chocar los `NULL` entre sí, así que el resto
  de la caja queda igual.

La edad del interno, en cambio, **no se guarda**: se calcula de la fecha de
nacimiento cada vez que se pide. Un número guardado envejece mal —el día del
cumpleaños empieza a mentir— y aquí la edad entra en los criterios geriátricos
con los que `ms-vigia` decide.

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
| Username | `root` (o `usr_vigia` / `usr_pastillero` / `usr_caja` / `usr_consultas` / `usr_acceso`) |
| Password | el valor de `BD_CLAVE_ROOT` en su archivo `.env` |

Con `root` se ven las cinco bases; con cada usuario de servicio se ve solo la
suya, que es justamente lo que conviene enseñar en la defensa. **Vuelva a
comentar las dos líneas** cuando termine.

Sin abrir el puerto, también se puede consultar desde la línea de comandos:

```bash
docker compose exec bd-asilo mysql -u root -p"$BD_CLAVE_ROOT" \
  -e "SELECT * FROM asilo_pastillero.internos\G"
```

### La instancia de la base, para la entrega

La fase de implementación pide entregar una instancia de la base de datos. Es
**`sql/instancia/asilo-instancia.sql`**: el volcado de las cinco bases tal como
quedan recién levantado el stack, con el escenario de demostración sembrado y
sin ningún registro de prueba. Lo hace `mysqldump` con `--databases` y las
cinco bases nombradas, nunca con `--all-databases`, así que **no trae los
usuarios de MySQL ni sus claves**; las únicas claves que contiene son los hashes
bcrypt de las siete cuentas de demostración, los mismos de
`06-esquema-acceso.sql`. La cabecera del archivo dice de qué commit salió.

No se ejecuta al arrancar: el stack sigue creando el esquema desde `sql/01` a
`sql/06`. Para restaurarla, con cualquier MySQL 8:

```bash
mysql -u root -p --default-character-set=utf8mb4 < sql/instancia/asilo-instancia.sql
```

o en MySQL Workbench: *Server → Data Import → Import from Self-Contained File*,
elegir el archivo y *Start Import*. Crea las cinco bases si no existen, y si
existen **reemplaza sus tablas**. Se comprobó restaurándola en un MySQL 8.4
vacío y aparte: las dieciséis tablas tienen las mismas filas que el original y
los nombres con tilde llegan intactos.

**Se regenera** si cambia el esquema o la siembra: `docker compose down -v &&
docker compose up -d`, esperar a que todo esté sano y, antes de correr ninguna
prueba, volver a volcar con los mismos parámetros. `verificar.sh` comprueba en
su bloque 13 que el archivo exista, que traiga las cinco bases y que no
contenga el valor de ninguna clave del `.env`.

---

## 10. Estructura de archivos

```
Asilo-Analisis-2-Proyecto-Final/
├── docker-compose.yml          orquesta los siete contenedores
├── sql/                        el modelo de datos, como entrega legible
│   ├── 01-bases-y-usuarios.sh    cinco bases, cinco usuarios y sus permisos
│   │                             (toma las claves del entorno · SE VERSIONA)
│   ├── 01-bases-y-usuarios.ejemplo.sql  el mismo modelo de permisos, legible,
│   │                             con claves de marcador · NO se ejecuta
│   ├── 02-esquema-vigia.sql      bitacora de farmacovigilancia
│   ├── 03-esquema-pastillero.sql padron de internos, planes y tomas
│   ├── 04-esquema-caja.sql       cargos, pagos, donaciones y gastos
│   ├── 05-esquema-consultas.sql  remisiones, consultas, examenes, recetas
│   │                             y la bitacora de avisos al familiar
│   ├── 06-esquema-acceso.sql     cuentas del personal y su bitacora, con la
│   │                             siembra de las siete de demostracion
│   └── instancia/
│       └── asilo-instancia.sql   la instancia de entrega: las cinco bases con
│                                 el escenario sembrado · NO se ejecuta
├── .env.ejemplo                plantilla de configuración (se copia a .env)
├── .env                        secreto de esta instalación · NO se versiona
├── pruebas.sh                  prueba de humo funcional, toda vía el gateway
├── pruebas-interfaz/
│   └── cambio-de-sesion.js     recorrido de la estación en un DOM mínimo (bloque 23)
├── verificar.sh                revisión de seguridad, permisos y repositorio
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
├── ms-consultas/
│   ├── app.py                  remisión, cita, consulta, ficha, exámenes,
│   │                           recetas y el aviso por correo al familiar
│   ├── requirements.txt
│   └── Dockerfile
├── ms-gateway/
│   ├── server.js               login, JWT, revocación, cuentas del personal
│   │                           (en asilo_acceso) y proxy autorizado por rol
│   ├── package.json
│   ├── package-lock.json       versiones exactas · lo usa npm ci
│   ├── .dockerignore           deja node_modules y .env fuera de la imagen
│   └── Dockerfile
└── estacion-web/
    ├── index.html               acceso + cambio de clave + jornada + consultas
    │                            + caja + reportes + padron + usuarios + las tres
    │                            bandejas de la fundación
    ├── estilos.css              paleta, estados por forma y diseño para pantalla angosta
    ├── app.js                   enrutado, estados de carga/vacío/error y consumo de la API
    ├── nginx.conf                sirve la interfaz y reenvia /api /vigia /pastillero /caja /consultas a ms-gateway
    └── Dockerfile
```

---

## 11. Limitaciones conocidas del prototipo

Esto es un **prototipo académico**, no un sistema en producción. Lo que sigue
son decisiones tomadas a conciencia, no descuidos: enumerarlas es parte del
trabajo, porque un sistema de salud que no sabe dónde están sus límites es más
peligroso que uno que sí.

### Seguridad

- **Las siete cuentas sembradas son de demostración.** Viven en la base
  `asilo_acceso` con la clave en hash bcrypt (nunca en texto plano), pero sus
  credenciales están publicadas en este mismo README, y se siembran con clave
  definitiva para que la demostración no tropiece con el cambio obligatorio.
  Las cuentas que da de alta el administrador sí nacen con clave temporal y
  cambio obligatorio al primer ingreso. En una instalación real, lo primero
  sería restablecer o desactivar las siete. **No use estas credenciales fuera
  de la demostración.**
- **Una cuenta desactivada se corta en el gateway, no dentro de cada
  microservicio.** El gateway consulta la cuenta en cada petición, y desactivar
  a alguien o restablecerle la clave le cierra las sesiones al instante. Los
  microservicios, en cambio, siguen validando solo la firma y el rol del token:
  no tienen acceso a `asilo_acceso`, a propósito. Alcanza porque el gateway es
  la única entrada publicada; pero alguien que ya estuviera dentro de la red de
  Docker con un token vigente de una cuenta recién desactivada podría seguir
  usándolo contra un microservicio hasta que venza, como mucho 8 horas.
- **No hay HTTPS.** Todo viaja en HTTP plano dentro de `localhost` y de la red
  interna de Docker. En una red real, el token de sesión se puede leer en
  tránsito: haría falta TLS terminado en nginx (o un proxy inverso delante) con
  certificados, `Strict-Transport-Security` y las cookies/tokens marcados en
  consecuencia.
- **El límite de intentos y la lista de revocación del `logout` viven en la
  memoria del proceso.** Con una sola instancia del gateway funcionan; con varias, cada una
  llevaría su propia cuenta y el límite se multiplicaría, y un token revocado en
  una seguiría sirviendo en las otras. En producción ambas cosas van en Redis.
  Está anotado en el código, donde toca.
- **No hay refresco de sesión ni expiración por inactividad.** El token dura 8
  horas fijas desde el ingreso.
- **No hay bitácora de auditoría de lecturas.** Se sabe quién firmó cada
  dictamen, cada toma y cada movimiento de caja, y quién hizo qué con cada
  cuenta del personal —eso sí queda en la base—, pero no hay un registro aparte
  de *quién consultó qué*, que es lo que exigiría una
  normativa de datos de salud.

### Datos y persistencia

- **Una sola instancia de MySQL para las cinco bases.** Se explica y se
  cuantifica en la sección 9: se conserva el aislamiento lógico de los datos,
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
  referencias a `${BD_CLAVE_VIGIA}`, `${BD_CLAVE_PASTILLERO}`,
  `${BD_CLAVE_CAJA}`, `${BD_CLAVE_CONSULTAS}` y `${BD_CLAVE_ACCESO}`. En producción vendrían de un gestor de secretos en vez
  de un archivo en el disco.
- **Los usuarios de MySQL se crean una sola vez**, cuando el volumen de datos
  está vacío. Cambiar una clave en el `.env` después no surte efecto: hay que
  recrear el volumen con `docker compose down -v`, lo que borra los datos.
- **Sin copias de seguridad ni réplica.** El volumen `bd-datos` es el único
  lugar donde viven los datos. La instancia de `sql/instancia/` no es una copia
  de seguridad: es una foto del escenario sembrado, para la entrega, y no trae
  nada de lo que se registre después.
- **Los datos de ejemplo se siembran solos** (`SEMBRAR=1`) la primera vez. Los
  tres internos, sus tratamientos y los movimientos de caja son inventados para
  la demostración.

### Alcance funcional

- **La visita médica se registra, pero sin exploración estructurada ni notas
  de evolución.** Desde que existe `ms-consultas`, el sistema sí cubre la
  cadena completa: remisión, asignación de médico y hora, consulta con motivo,
  diagnóstico y observaciones, exámenes indicados, receta y cierre. Lo que no
  existe es una exploración física con signos vitales en campos propios, ni
  notas de evolución seriadas: cada visita es un episodio que se abre y se
  cierra, no un seguimiento longitudinal del interno. Tampoco hay codificación
  diagnóstica (CIE-10): el diagnóstico es texto libre.
- **El padrón se gestiona desde la interfaz, pero un interno nunca se borra.**
  El rol `ADMINISTRADOR` da de alta, corrige los datos administrativos y
  egresa; lo que no existe es el borrado, y es deliberado: las tomas y los
  planes que firmó enfermería son documentos, y no pueden desaparecer porque
  la persona se haya ido. Tampoco existe el reingreso de un egresado, que en
  el sistema actual se resuelve dándolo de alta otra vez con otro documento.
- **La cuota mensual se genera, pero nadie la genera sola.** Hay que entrar y
  pulsar el botón cada mes: no hay tarea programada. Un sistema real tendría
  un proceso que la corre el día 1, y la idempotencia que ya está —el índice
  único sobre (interno, mes)— es justamente lo que haría seguro reintentarlo.
- **El vademécum y las reglas de farmacovigilancia son un recorte docente.** 28
  principios activos y cinco familias de reglas, suficientes para demostrar el
  mecanismo. Un vademécum real tiene miles de fármacos, y las reglas deberían
  venir de una fuente clínica mantenida y auditada, no de un archivo del
  repositorio. **Este sistema no sustituye el criterio del médico.**
- **El buscador de internos aparece cuando hay más de seis.** Con los tres
  sembrados no se muestra, por diseño.
- **La interfaz es una sola página para los siete roles, hecha en HTML, CSS y
  JavaScript sin framework.** Empezó como la estación de enfermería y hoy es la
  interfaz de todo el sistema: jornada, consultas, caja, reportes, padrón,
  cuentas del personal y las bandejas de la fundación, el laboratorio y la
  farmacia. No usa React ni ninguna biblioteca a propósito, para que se pueda
  leer entera y defender línea por línea; el costo es que `app.js` es un solo
  archivo largo, y que no hay componentes reutilizables más allá de unas
  cuantas funciones de pintado.

### Operación

- **Un solo entorno.** No hay separación de desarrollo, pruebas y producción,
  ni integración continua, ni despliegue automatizado.
- **Sin límites de recursos ni política de reinicio afinada** en los
  contenedores más allá de `restart: unless-stopped`.
- **Los relojes son la hora local del contenedor** (`TZ=America/Guatemala`). Un
  cambio de zona horaria o de horario de verano afectaría el cálculo de turnos
  y de tomas vencidas.
