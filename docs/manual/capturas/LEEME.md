# Capturas del manual de usuario

Treinta y cinco pantallas del sistema. Todas menos la 33 las tomó Edge en
modo headless, con `docs/manual/capturar.js`, sobre un stack recién levantado
y **sin haber corrido ninguna prueba antes**: muestran el escenario sembrado,
más lo que el propio recorrido escribe en el camino (una remisión, una
consulta atendida, una cuenta nueva). La 33 es la instancia pública en
Internet.

- **Formato:** PNG, ventana de 1366 × 768 con escala 2 (2732 × 1536 píxeles).
  Las tres de teléfono son la excepción: la 29 a 375 × 812, y la 34 y la 35 a
  390 × 844, siempre con escala 2.
- **De dónde salieron:** de la interfaz del commit `a1c55b5` (*Bloque 12:
  abonos parciales desde la caja*), más el ajuste de `estacion-web/estilos.css`
  que va en el mismo commit que estas capturas (*Bloque 10B*): la tarjeta de
  «Elija su clave» ya no se corta por arriba en una pantalla de 768 px. La 29,
  la 34 y la 35 son de la interfaz adaptada al teléfono (*Bloque 14*): la 29
  se volvió a tomar entonces, y las otras dos se agregaron.
- **Solo la ventana del navegador.** Antes de cada foto se retiran los avisos
  flotantes de la acción anterior, para que no tapen la pantalla, y se emula
  `prefers-reduced-motion` para que ningún desplazamiento quede a medio camino.

## Qué muestra cada una

| # | Usuario | Qué se ve |
|---|---|---|
| 01 | — | La pantalla de acceso, vacía |
| 02 | `rgarcia` (cuenta nueva) | «Elija su clave» del primer ingreso, con la clave nueva a medio escribir: dos requisitos dicen «falta» y tres «cumple». La cuenta la da de alta el administrador antes de la foto |
| 03 | `enfermeria` | «Cambiar mi clave» en modo voluntario, vacío |
| 04 | `enfermeria` | La jornada de medicación de Rosalía Menchú (ASL-014) |
| 05 | `enfermeria` | La confirmación de «Registrar administración» de una toma pendiente (se cancela después) |
| 06 | `medico` | El recetario con dictamen **APROBADO**: paracetamol 500 mg cada 8 h por 5 días a ASL-014 |
| 07 | `medico` | El mismo recetario con dictamen **BLOQUEADO**: quetiapina a Rosalía Menchú (FV-GER-04) |
| 08 | `medico` | «Consultas y ficha médica» de ASL-014 |
| 09 | `medico` | «Remitir a especialidad» lleno: Neurología, con motivo y enfermera acompañante (se envía después) |
| 10 | `medico` | El aviso a la familia de esa remisión, abierto con «Ver el correo» |
| 11 | `fundacion` | La bandeja de remisiones con el formulario «Asignar cita» de DEMO0007 abierto y lleno (se confirma después) |
| 12 | `medico` | La consulta de DEMO0014 con diagnóstico y observaciones, un examen y una receta aprobada de paracetamol |
| 13 | `laboratorio` | Exámenes solicitados, con el resultado del examen de la 12 escrito sin guardar (se guarda después) |
| 14 | `farmacia` | Medicamentos por entregar, con el paracetamol de la 12 |
| 15 | `medico` | La ficha médica completa de Bernardo Puac (ASL-022) |
| 16 | `medico` | «Cuenta del interno» de ASL-022: solo los cargos y el saldo |
| 17 | `administracion` | «Caja y donaciones»: el resumen superior con lo de la fundación y la cuenta del interno |
| 18 | `administracion` | El bloque «Costo por consulta» de Bernardo Puac |
| 19 | `administracion` | Reportes, con la lista de informes abierta |
| 20 | `administracion` | «Cobros por paciente» de ASL-022 en el último mes, en pantalla |
| 21 | `administracion` | El mismo informe como sale impreso (emulando `print`) |
| 22 | `administracion` | El informe adicional «Citas con saldo pendiente», sin filtros |
| 23 | `admin` | El padrón de internos |
| 24 | `admin` | «Dar de alta a un interno» lleno con datos realistas, sin guardar |
| 25 | `admin` | Las cuentas del personal, con `rgarcia` y su clave temporal pendiente |
| 26 | `admin` | «Dar de alta una cuenta» lleno: `jlopez`, «Lic. Julio López», Administración |
| 27 | `admin` | El cuadro de la clave temporal de `jlopez` |
| 28 | `administracion` | La caja con `ms-caja` detenido: el error del servicio con «Reintentar» |
| 29 | `enfermeria` | La jornada a 375 × 812, con la línea de tiempo vertical y la barra superior en dos renglones |
| 30 | `medico` | «Editar información clínica» de ASL-014, con la lista del vademécum abierta en una fila de medicación permanente, sin guardar |
| 31 | `administracion` | «Registrar un pago a la fundación» lleno, con el saldo con la fundación en la nota del formulario, sin guardar |
| 32 | `administracion` | El diálogo de «Pagar» de un cargo de ASL-022, con el monto bajado a un abono parcial, sin confirmar |
| 33 | — | La pantalla de acceso de la instancia pública, <https://saaca-asilo.northcentralus.cloudapp.azure.com>, con la dirección anotada arriba |
| 34 | `administracion` | «Caja y donaciones» a 390 × 844: la tira de internos, las pestañas y el resumen en dos columnas |
| 35 | `administracion` | «Cobros por paciente» de ASL-022 a 390 × 844: la tabla hecha tarjetas, cada dato con su rótulo |

**Tres licencias, dichas para que nadie se lleve una sorpresa:**

- **19 y 30, las listas abiertas.** La lista desplegada de un `<select>` la
  dibuja el sistema operativo, fuera de la página, y no sale en una captura de
  la ventana. Para que se vea, el script muestra la lista abierta dentro de la
  página (`size`), con el mismo contenido; en la 30 además le da todo el ancho
  de la fila.
- **31, el resumen de la fundación.** En una ventana de 768 px de alto, el
  resumen superior de la caja y el formulario del pago, que está al final de la
  vista, no caben juntos. La captura muestra el formulario lleno con la nota
  que dice el saldo con la fundación; el resumen completo, con adeudado, pagado
  y saldo, se ve en la 17.
- **33, la barra de direcciones.** Edge en modo headless no dibuja la barra
  del navegador. La franja oscura de arriba es una anotación que el recorrido
  agrega a la página antes de la foto: la dirección sale de `location.href` y
  el estado («secure», emisor `YE1` de Let's Encrypt), de lo que el propio Edge
  informa sobre la conexión. No la toma `capturar.js`, que trabaja contra
  `localhost`: salió del recorrido de verificación de la instancia pública del
  bloque 13.

## Cómo regenerarlas

Desde la raíz del proyecto, con Edge o Chrome instalados (o la ruta en
`NAVEGADOR`) y Node 22:

```bash
docker compose down -v && docker compose up -d     # esperar a que todo esté sano
node docs/manual/capturar.js
docker compose down -v && docker compose up -d     # dejar la base limpia
```

No corra `pruebas.sh` ni `verificar.sh` antes: dejarían datos de prueba en
pantalla. El script usa solo las cuentas de demostración del README y no lee
el `.env`. La captura 28 detiene `ms-caja` un momento y lo vuelve a levantar.

Para repetir capturas sueltas que solo miran, `SOLO=19,20 node
docs/manual/capturar.js`. Las que guardan algo (09, 11, 12, 13 y 27) cambian
los datos: para repetirlas, el stack desde cero y el recorrido entero. Las tres
de teléfono entran solas con la cuenta que necesitan, así que
`SOLO=29,34,35` las repite sin depender de las demás.

## La auditoría del teléfono

`docs/manual/auditar-telefono.js` recorre todas las vistas de los siete roles,
los cajones, los diálogos, el cuadro de la clave temporal, «Elija su clave» y
los ocho informes, a 360 × 800 y a 390 × 844, con escala 3 y emulación táctil.
En cada pantalla mide si la página se desplaza a lo ancho, qué elementos se
salen o quedan recortados, la letra de menos de 12 px, los botones de menos de
40 × 40, los campos que iOS amplía al enfocarlos y lo que queda debajo de una
barra al traerlo a la vista:

```bash
docker compose down -v && docker compose up -d     # esperar a que todo esté sano
node docs/manual/auditar-telefono.js               # sale con 1 si encuentra algo
docker compose down -v && docker compose up -d     # deja datos: atiende una consulta
```

No es parte de `pruebas-interfaz/`: el DOM mínimo de ese recorrido no tiene
motor de diseño, y `scrollWidth` o `getBoundingClientRect` darían cero. Por eso
maneja un Edge de verdad, como `capturar.js`. Tiene tres excepciones
declaradas, que solo valen mientras el elemento se desplace dentro de su propia
franja: la tira de internos, la barra de servicios y las pestañas.
