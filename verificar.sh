#!/usr/bin/env bash
# ===========================================================================
#  Asilo de Ancianos "Cabeza de Algodon"
#  verificar.sh · Revision de seguridad, base de datos y estado del repositorio
# ---------------------------------------------------------------------------
#  QUE VERIFICA (81 comprobaciones, 19 bloques)
#
#    0-1  Que el stack este arriba y que ms-vigia, ms-pastillero y ms-caja NO
#         publiquen puerto al equipo anfitrion: solo el 8080 y el 8090.
#    2-3  Que sin sesion no se entre a nada, y que el login funcione con los
#         tres roles y rechace las credenciales malas.
#    4    La matriz de acceso completa, rol por rol y ruta por ruta, con sus
#         dos excepciones de lectura documentadas.
#    5    Defensa en profundidad: que el microservicio rechace por su cuenta a
#         quien se salte el gateway desde la red interna.
#    6    Que la bitacora se firme con el nombre del token y no con lo que
#         mande el cliente en el cuerpo.
#    7-9  Los arreglos funcionales: la cuota mensual en Q450.00 y no en cero,
#         que el cliente no pueda mentir sobre las alergias de un interno, y
#         que seis validaciones simultaneas den seis folios distintos.
#    11   Que la raiz del gateway no sea un 404 y que el 404 diga que ruta se
#         pidio.
#    12   Que las fichas de los internos las sirva el backend y no el
#         navegador.
#    13   Auditoria estatica del repositorio: sin claves en texto plano, sin
#         rastros de SQLite, con .env ignorado, con el dinero en DECIMAL y sin
#         el puerto de MySQL publicado.
#    14   Corre pruebas.sh entera y exige que pase.
#    16   Aislamiento entre bases: que usr_caja NO pueda leer asilo_vigia.
#    17   Que los nombres con tildes sobrevivan el viaje a MySQL y de vuelta.
#    18   La matriz de los tres roles nuevos —fundacion, laboratorio y
#         farmacia—: lo que si le toca a cada uno, que ninguno alcance el
#         padron, la farmacovigilancia ni la caja, y que dentro de la cadena
#         clinica el laboratorio no lea recetas ni la farmacia resultados.
#    19   Que usr_consultas no pueda leer asilo_vigia, asilo_pastillero ni
#         asilo_caja, ni alterar su propio esquema.
#    15   El limite de intentos de login. Va al final a proposito: deja al
#         usuario 'medico' bloqueado unos minutos.
#
#  EN QUE SE DIFERENCIA DE pruebas.sh
#    pruebas.sh es la prueba de humo funcional: recorre el sistema como lo
#    haria una persona y comprueba que cada operacion clinica y de caja
#    responda lo que debe. verificar.sh mira el sistema desde afuera y desde
#    el repositorio: seguridad, permisos de base de datos y auditoria del
#    codigo. Este guion CORRE a pruebas.sh dentro de su bloque 14, asi que
#    ejecutarlo cubre las dos cosas.
#
#  COMO SE CORRE
#    Desde Git Bash en Windows (tambien sirve en Linux y macOS). No necesita
#    Python ni jq: lee el JSON con grep y sed. Necesita el stack levantado y
#    docker disponible, porque consulta MySQL con "docker compose exec".
#
#      docker compose up -d
#      bash verificar.sh
#
#    Para partir de datos limpios, borre los volumenes antes. La primera vez
#    tarda entre 60 y 90 segundos, mientras MySQL crea su directorio de datos
#    y ejecuta los archivos de sql/:
#
#      docker compose down -v && docker compose up -d
#
#    Termina con un resumen "N OK, M FALLA" y sale con codigo distinto de cero
#    si algo fallo, para poder encadenarlo en otro guion.
# ===========================================================================
set -u

GW=${GW:-http://localhost:8080}
WEB=${WEB:-http://localhost:8090}
OK=0; FALLA=0

verde()  { printf "  \033[0;32mOK\033[0m    %s\n" "$1"; OK=$((OK+1)); }
rojo()   { printf "  \033[0;31mFALLA\033[0m %s\n" "$1"; FALLA=$((FALLA+1)); }
aviso()  { printf "  \033[0;33m?\033[0m     %s\n" "$1"; }
titulo() { printf "\n\033[1;36m== %s\033[0m\n" "$1"; }

# --- lectura de JSON sin Python ---------------------------------------------
# texto(campo, archivo) -> valor de un campo de tipo cadena
texto() { grep -o "\"$1\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" "${2:-/tmp/v_cuerpo.json}" 2>/dev/null \
          | head -1 | sed 's/.*:[[:space:]]*"//; s/"$//'; }
# numero(campo, archivo) -> valor de un campo numerico
numero() { grep -o "\"$1\"[[:space:]]*:[[:space:]]*-\?[0-9.]*" "${2:-/tmp/v_cuerpo.json}" 2>/dev/null \
           | head -1 | sed 's/.*:[[:space:]]*//'; }

codigo() { # codigo(metodo, url, token, cuerpo) -> imprime el codigo HTTP
  local m=$1 u=$2 t=${3:-} d=${4:-}
  local args=(-s -o /tmp/v_cuerpo.json -w "%{http_code}" -m 15 -X "$m" "$u")
  [ -n "$t" ] && args+=(-H "Authorization: Bearer $t")
  [ -n "$d" ] && args+=(-H "Content-Type: application/json" -d "$d")
  curl "${args[@]}"
}

espera() { # espera(descripcion, esperado, obtenido)
  if [ "$2" = "$3" ]; then verde "$1 ($3)"; else rojo "$1 — esperaba $2, obtuvo $3"; fi
}

login() { # login(usuario, clave) -> imprime el token
  curl -s -m 15 -o /tmp/v_login.json -X POST "$GW/api/auth/login" \
    -H 'Content-Type: application/json' \
    -d "{\"usuario\":\"$1\",\"clave\":\"$2\"}" >/dev/null
  texto token /tmp/v_login.json
}

# ---------------------------------------------------------------------------
titulo "0. El stack esta arriba"
espera "gateway responde en /salud" 200 "$(codigo GET "$GW/salud")"
espera "estacion web responde"      200 "$(codigo GET "$WEB/")"

titulo "1. Los microservicios ya NO estan expuestos al host"
for p in 8081 8082 8083; do
  if curl -s -m 3 -o /dev/null "http://localhost:$p/salud" 2>/dev/null; then
    rojo "el puerto $p sigue publicado — falta quitar 'ports:' del compose"
  else
    verde "el puerto $p ya no responde desde el host"
  fi
done
if grep -qE '^[[:space:]]*-[[:space:]]*"?808[123]:' docker-compose.yml 2>/dev/null; then
  rojo "docker-compose.yml todavia tiene 'ports:' para 8081/8082/8083"
else
  verde "docker-compose.yml no publica 8081/8082/8083"
fi

titulo "2. Sin sesion no se entra a nada"
espera "GET /vigia/salud sin token"         401 "$(codigo GET "$GW/vigia/salud")"
espera "GET /pastillero/salud sin token"    401 "$(codigo GET "$GW/pastillero/salud")"
espera "GET /caja/api/v1/resumen sin token" 401 "$(codigo GET "$GW/caja/api/v1/resumen")"
espera "POST donacion sin token (el agujero original)" 401 \
  "$(codigo POST "$GW/caja/api/v1/donaciones" "" '{"donante":"ATACANTE","tipo":"EMPRESA_NACIONAL","monto":99999}')"

titulo "3. Login"
TOK_MED=$(login medico medico2026)
TOK_ENF=$(login enfermeria enfermeria2026)
TOK_ADM=$(login administracion admin2026)
for par in "medico:$TOK_MED" "enfermeria:$TOK_ENF" "administracion:$TOK_ADM"; do
  u=${par%%:*}; t=${par#*:}
  if [ -n "$t" ]; then verde "login $u"; else rojo "login $u no devolvio token"; fi
done
if [ -z "$TOK_MED" ] || [ -z "$TOK_ENF" ] || [ -z "$TOK_ADM" ]; then
  printf "\n\033[0;31mSin token no tiene sentido seguir.\033[0m\n"
  printf "Si ya corriste este script antes, el limite de intentos pudo bloquear al usuario.\n"
  printf "Reinicia el gateway y volve a correrlo:  docker compose restart ms-gateway\n\n"
  exit 1
fi
espera "clave incorrecta" 401 "$(codigo POST "$GW/api/auth/login" "" '{"usuario":"medico","clave":"xxx"}')"
espera "token manipulado" 401 "$(codigo GET "$GW/vigia/salud" "${TOK_MED}x")"
espera "token con basura" 401 "$(codigo GET "$GW/vigia/salud" "no.es.un.token")"

titulo "4. Matriz de acceso por rol"
espera "medico lee /vigia"                 200 "$(codigo GET "$GW/vigia/api/v1/vademecum" "$TOK_MED")"
espera "enfermeria lee /vigia"             200 "$(codigo GET "$GW/vigia/api/v1/vademecum" "$TOK_ENF")"
espera "administracion NO lee /vigia"      403 "$(codigo GET "$GW/vigia/api/v1/vademecum" "$TOK_ADM")"
espera "enfermeria NO escribe en /vigia"   403 "$(codigo POST "$GW/vigia/api/v1/validaciones" "$TOK_ENF" '{}')"
espera "enfermeria lee /pastillero"        200 "$(codigo GET "$GW/pastillero/api/v1/turnos" "$TOK_ENF")"
espera "administracion NO lee /pastillero" 403 "$(codigo GET "$GW/pastillero/api/v1/turnos" "$TOK_ADM")"
espera "administracion lee /caja"          200 "$(codigo GET "$GW/caja/api/v1/resumen" "$TOK_ADM")"
espera "medico NO lee el resumen de caja"  403 "$(codigo GET "$GW/caja/api/v1/resumen" "$TOK_MED")"
espera "medico SI lee la cuenta de un interno (la excepcion)" 200 \
  "$(codigo GET "$GW/caja/api/v1/pacientes/ASL-014/cuenta" "$TOK_MED")"
espera "enfermeria NO escribe en /caja"    403 \
  "$(codigo POST "$GW/caja/api/v1/donaciones" "$TOK_ENF" '{"donante":"X","tipo":"EMPRESA_NACIONAL","monto":10}')"

titulo "5. Defensa en profundidad: el microservicio tambien valida"
if command -v docker >/dev/null 2>&1; then
  R=$(docker exec ms-caja python3 -c "
import urllib.request,urllib.error
req=urllib.request.Request('http://localhost:8083/api/v1/donaciones',
    data=b'{\"donante\":\"INTERNO\",\"tipo\":\"EMPRESA_NACIONAL\",\"monto\":1}',
    headers={'Content-Type':'application/json'}, method='POST')
try:
    urllib.request.urlopen(req); print(201)
except urllib.error.HTTPError as e: print(e.code)
except Exception: print('err')" 2>/dev/null | tr -d '\r')
  espera "desde dentro de la red, sin token, ms-caja rechaza" 401 "$R"
else
  aviso "docker no disponible, salteo esta prueba"
fi

titulo "6. La bitacora se firma con el token, no con lo que manda el cliente"
C=$(codigo POST "$GW/caja/api/v1/cargos" "$TOK_ADM" \
  '{"pacienteId":"ASL-014","categoria":"CONSULTA","concepto":"prueba de firma","tarifa":"consulta-general","registradoPor":"YO SOY OTRO"}')
FIRMA=$(texto registradoPor)
if [ "$C" != "201" ]; then
  rojo "no se pudo crear el cargo de prueba (HTTP $C)"
elif echo "$FIRMA" | grep -qi "OTRO"; then
  rojo "el cargo quedo firmado como '$FIRMA' — el cliente puede mentir"
elif [ -z "$FIRMA" ]; then
  aviso "el cargo se creo pero la respuesta no trae 'registradoPor'; revisalo a mano"
else
  verde "el cargo quedo firmado como '$FIRMA' (viene del token)"
fi

titulo "7. Cuota mensual ya no sale en Q0.00"
C=$(codigo POST "$GW/caja/api/v1/cargos" "$TOK_ADM" \
  '{"pacienteId":"ASL-014","categoria":"CUOTA","concepto":"prueba cuota","tarifa":"cuota-mensual"}')
NETO=$(numero montoNeto)
if [ "$C" != "201" ]; then
  rojo "no se pudo crear el cargo de cuota (HTTP $C)"
elif [ -z "$NETO" ] || [ "$NETO" = "0" ] || [ "$NETO" = "0.0" ]; then
  rojo "la cuota mensual sigue en '$NETO'"
else
  verde "la cuota mensual se cobra en Q $NETO"
fi

titulo "8. El cliente ya no puede mentir sobre las alergias"
# ASL-007 es alergica a sulfas y la furosemida es una sulfa.
# Mando "alergias: []" a proposito: si el servidor consulta la ficha real,
# tiene que bloquear igual.
C=$(codigo POST "$GW/vigia/api/v1/validaciones" "$TOK_MED" \
  '{"pacienteId":"ASL-007","alergias":[],"edad":20,"psicopatologias":[],"medicacionActual":[],"propuesta":{"principioActivo":"furosemida","dosisMg":40,"cadaHoras":24}}')
VER=$(texto veredicto)
if [ "$VER" = "BLOQUEADO" ]; then
  verde "bloqueo la furosemida pese a que el cliente dijo 'sin alergias'"
else
  rojo "HTTP $C, veredicto '$VER' — ms-vigia sigue creyendole al navegador"
fi

titulo "9. Folios unicos bajo concurrencia"
rm -rf /tmp/v_folios; mkdir -p /tmp/v_folios
for i in 1 2 3 4 5 6; do
  curl -s -m 15 -o "/tmp/v_folios/$i.json" -X POST "$GW/vigia/api/v1/validaciones" \
    -H "Authorization: Bearer $TOK_MED" -H 'Content-Type: application/json' \
    -d '{"pacienteId":"ASL-022","propuesta":{"principioActivo":"paracetamol","dosisMg":500,"cadaHoras":8}}' &
done
wait
N=$(cat /tmp/v_folios/*.json 2>/dev/null | grep -o '"folio"[[:space:]]*:[[:space:]]*"[^"]*"' | sort -u | wc -l | tr -d ' ')
espera "6 validaciones simultaneas dieron 6 folios distintos" 6 "$N"
rm -rf /tmp/v_folios

titulo "11. Rutas del gateway"
espera "GET / devuelve indice de rutas" 200 "$(codigo GET "$GW/")"
codigo GET "$GW/no-existe-esta-ruta" >/dev/null
if grep -q "no-existe-esta-ruta" /tmp/v_cuerpo.json 2>/dev/null; then
  verde "el 404 dice cual fue la ruta pedida"
else
  rojo "el 404 sigue sin decir que ruta se pidio"
fi

titulo "12. Fichas de internos servidas por el backend"
C=$(codigo GET "$GW/pastillero/api/v1/internos" "$TOK_ENF")
espera "GET /pastillero/api/v1/internos" 200 "$C"
if [ "$C" = "200" ] && grep -q "ASL-007" /tmp/v_cuerpo.json 2>/dev/null; then
  verde "la ficha de ASL-007 viene del backend"
elif [ "$C" = "200" ]; then
  aviso "responde 200 pero no encontre ASL-007 en la respuesta"
fi

titulo "13. Auditoria estatica del repositorio"
grep -rqi "medico2026\|admin2026\|enfermeria2026" --include="*.js" --include="*.py" --include="*.yml" . 2>/dev/null \
  && rojo "hay claves en texto plano en el codigo" \
  || verde "no hay claves en texto plano en el codigo"
grep -q 'GATEWAY_SECRETO: *"' docker-compose.yml 2>/dev/null \
  && rojo "el secreto sigue escrito en docker-compose.yml" \
  || verde "el secreto no esta en docker-compose.yml"
grep -q "^\.env$" .gitignore 2>/dev/null \
  && verde ".env esta en .gitignore" || rojo ".env NO esta en .gitignore"
[ -f .env.ejemplo ] && verde "existe .env.ejemplo" || rojo "falta .env.ejemplo"
grep -q "FICHAS *= *{" estacion-web/app.js 2>/dev/null \
  && rojo "las fichas siguen quemadas en el navegador" \
  || verde "FICHAS ya no esta en el frontend"
grep -rq "Access-Control-Allow-Origin.*\*" ms-vigia ms-pastillero ms-caja 2>/dev/null \
  && rojo "algun microservicio sigue con CORS abierto (*)" \
  || verde "los microservicios ya no abren CORS"
# No debe quedar rastro de SQLite: ni WAL, ni archivos .db.
grep -rq "sqlite3" ms-vigia ms-pastillero ms-caja 2>/dev/null \
  && rojo "todavia queda codigo de SQLite en algun microservicio" \
  || verde "no queda rastro de SQLite en los microservicios"
grep -q "PyMySQL" ms-caja/requirements.txt 2>/dev/null \
  && verde "PyMySQL en los requirements" || rojo "falta PyMySQL en los requirements"
grep -q "DECIMAL(10,2)" sql/04-esquema-caja.sql 2>/dev/null \
  && verde "el dinero va en DECIMAL(10,2), no en coma flotante" \
  || rojo "los montos de ms-caja no estan en DECIMAL"
grep -qE '^[[:space:]]*-[[:space:]]*"?3306:' docker-compose.yml 2>/dev/null \
  && rojo "el puerto 3306 de MySQL esta publicado al host" \
  || verde "MySQL no publica el puerto 3306 al host"
grep -q "PyJWT" ms-caja/requirements.txt 2>/dev/null \
  && verde "PyJWT en los requirements" || rojo "falta PyJWT en los requirements"

titulo "14. La suite propia del proyecto"
if [ -f pruebas.sh ]; then
  if bash pruebas.sh > /tmp/v_pruebas.log 2>&1; then
    verde "pruebas.sh paso completo"
  else
    rojo "pruebas.sh salio con error — revisá /tmp/v_pruebas.log"
    aviso "si el log dice 'no se encontro Python', le falta a pruebas.sh, no a tu codigo"
  fi
  grep -q "localhost:808[123]" pruebas.sh \
    && rojo "pruebas.sh sigue pegandole directo a los microservicios" \
    || verde "pruebas.sh entra solo por el gateway"
else
  rojo "no existe pruebas.sh"
fi

titulo "16. Aislamiento entre las bases de cada microservicio"
# "database per service" no es solo tener un esquema por servicio: es que
# ninguno alcance al del otro.
CLAVE_CAJA=${BD_CLAVE_CAJA:-$(grep -E '^BD_CLAVE_CAJA=' .env 2>/dev/null | cut -d= -f2-)}
FUGA=$(docker compose exec -T bd-asilo mysql -u usr_caja -p"$CLAVE_CAJA" \
       -e "SELECT COUNT(*) FROM asilo_vigia.validaciones;" 2>&1)
if printf "%s" "$FUGA" | grep -qiE "denied|Unknown database"; then
  verde "usr_caja NO puede leer asilo_vigia (el motor le niega el permiso)"
else
  rojo "usr_caja pudo leer asilo_vigia — revisa los GRANT de sql/01"
fi
# Control positivo: sobre su propia base si tiene que poder.
PROPIA=$(docker compose exec -T bd-asilo mysql -u usr_caja -p"$CLAVE_CAJA" \
         -e "SELECT COUNT(*) FROM asilo_caja.cargos;" 2>&1)
if printf "%s" "$PROPIA" | grep -qi "denied"; then
  rojo "usr_caja tampoco puede leer su propia base asilo_caja"
else
  verde "usr_caja SI puede leer su propia base asilo_caja"
fi

titulo "17. Los nombres con tilde se guardan y se leen intactos"
TOK_ADM=$(login administracion admin2026)
# El cuerpo va en un archivo y no en la linea de comandos a proposito: el curl
# de Windows reescribe los argumentos con acentos segun la pagina de codigos
# de la consola y manda bytes que no son UTF-8. Leido de un archivo, curl los
# envia tal cual. Es una limitacion del curl de Windows, no del sistema.
printf '%s' '{"donante":"Fundación Amigos del Adulto Mayor","tipo":"EMPRESA_NACIONAL","monto":100}' \
  > /tmp/v_tildes.json
CODIGO_TILDES=$(curl -s -o /tmp/v_cuerpo.json -w "%{http_code}" -m 15 \
  -X POST "$GW/caja/api/v1/donaciones" \
  -H "Authorization: Bearer $TOK_ADM" -H 'Content-Type: application/json' \
  --data-binary @/tmp/v_tildes.json)
espera "se registra una donacion con tildes" 201 "$CODIGO_TILDES"
codigo GET "$GW/caja/api/v1/donaciones" "$TOK_ADM" > /dev/null
if grep -q "Fundación Amigos del Adulto Mayor" /tmp/v_cuerpo.json; then
  verde "vuelve identica desde la base: 'Fundación Amigos del Adulto Mayor'"
else
  rojo "el nombre con tildes volvio roto — revisa la codificacion utf8mb4"
fi
# El interno sembrado tambien lleva tildes.
TOK_MED=$(login medico medico2026)
codigo GET "$GW/pastillero/api/v1/internos/ASL-007" "$TOK_MED" > /dev/null
if grep -q "Tránsito Xicará Tzoc" /tmp/v_cuerpo.json; then
  verde "el interno sembrado conserva sus tildes: 'Tránsito Xicará Tzoc'"
else
  rojo "el nombre del interno volvio roto — revisa la codificacion utf8mb4"
fi

# El limite de intentos va al final a proposito: deja al usuario bloqueado
# unos minutos y arruinaria las pruebas que vienen despues.

titulo "18. Matriz de acceso de los tres roles nuevos"
# Los tres son externos al asilo: no tienen nada que hacer en el padron, ni en
# la farmacovigilancia, ni en la caja. Cada linea es una puerta cerrada.
TOK_FUN=$(login fundacion fundacion2026)
TOK_LAB=$(login laboratorio laboratorio2026)
TOK_FAR=$(login farmacia farmacia2026)

if [ -z "$TOK_FUN" ] || [ -z "$TOK_LAB" ] || [ -z "$TOK_FAR" ]; then
  rojo "alguno de los tres roles nuevos no pudo iniciar sesion"
else
  verde "los tres roles nuevos inician sesion"
fi

# --- Lo que SI le toca a cada uno ------------------------------------------
espera "fundacion lee las remisiones por agendar"  200 \
  "$(codigo GET "$GW/consultas/api/v1/solicitudes?estado=PENDIENTE" "$TOK_FUN")"
espera "laboratorio lee los examenes"              200 \
  "$(codigo GET "$GW/consultas/api/v1/examenes" "$TOK_LAB")"
espera "farmacia lee las visitas para ver que entregar" 200 \
  "$(codigo GET "$GW/consultas/api/v1/visitas" "$TOK_FAR")"

# --- Ninguno de los tres toca los otros microservicios ----------------------
for par in "fundacion:$TOK_FUN" "laboratorio:$TOK_LAB" "farmacia:$TOK_FAR"; do
  ROL=${par%%:*}; TK=${par#*:}
  espera "$ROL NO lee /pastillero (el padron del asilo)" 403 \
    "$(codigo GET "$GW/pastillero/api/v1/internos" "$TK")"
  espera "$ROL NO lee /vigia (la farmacovigilancia)"     403 \
    "$(codigo GET "$GW/vigia/api/v1/vademecum" "$TK")"
  espera "$ROL NO lee /caja (el dinero del asilo)"       403 \
    "$(codigo GET "$GW/caja/api/v1/resumen" "$TK")"
done

# --- Y dentro de /consultas, cada uno solo lo suyo --------------------------
# Una visita trae examenes e indicaciones juntos: sin el filtro por bloque el
# laboratorio leeria las recetas y la farmacia los resultados.
espera "laboratorio NO lee las indicaciones (recetas)"  403 \
  "$(codigo GET "$GW/consultas/api/v1/indicaciones" "$TOK_LAB")"
espera "farmacia NO lee los examenes (resultados de laboratorio)" 403 \
  "$(codigo GET "$GW/consultas/api/v1/examenes" "$TOK_FAR")"
espera "fundacion NO lee la ficha medica completa"      403 \
  "$(codigo GET "$GW/consultas/api/v1/reportes/ficha?pacienteId=ASL-014" "$TOK_FUN")"
espera "laboratorio NO lee la ficha medica completa"    403 \
  "$(codigo GET "$GW/consultas/api/v1/reportes/ficha?pacienteId=ASL-014" "$TOK_LAB")"
espera "farmacia NO lee la bitacora de avisos a la familia" 403 \
  "$(codigo GET "$GW/consultas/api/v1/correos" "$TOK_FAR")"

# --- Ni pueden hacer el paso del otro ---------------------------------------
espera "laboratorio NO puede recetar"        403 \
  "$(codigo POST "$GW/consultas/api/v1/visitas/VM-INVENTADA/indicaciones" "$TOK_LAB" \
     '{"principioActivo":"paracetamol","dosisMg":500,"cadaHoras":8,"duracionDias":3}')"
espera "farmacia NO puede indicar examenes"  403 \
  "$(codigo POST "$GW/consultas/api/v1/visitas/VM-INVENTADA/examenes" "$TOK_FAR" \
     '{"nombre":"El que yo quiera"}')"
espera "fundacion NO puede atender consultas" 403 \
  "$(codigo POST "$GW/consultas/api/v1/visitas" "$TOK_FUN" '{"solicitudId":"SOL-INVENTADA"}')"

# --- Defensa en profundidad: sin el gateway adelante ------------------------
# Que el gateway diga 403 no basta: el propio servicio tiene que negarse a
# quien lo alcance desde la red interna.
if command -v docker >/dev/null 2>&1; then
  R=$(docker exec ms-gateway sh -c \
      "wget -qS -O /dev/null --header='Authorization: Bearer $TOK_LAB' \
       'http://ms-consultas:8084/api/v1/reportes/ficha?pacienteId=ASL-014' 2>&1 \
       | grep -o 'HTTP/1.1 [0-9]*' | head -1 | awk '{print \$2}'" 2>/dev/null | tr -d '\r')
  espera "saltandose el gateway, ms-consultas rechaza al laboratorio" 403 "$R"
else
  aviso "docker no disponible, salteo esta prueba"
fi

titulo "19. usr_consultas no alcanza las bases de los otros microservicios"
# ms-consultas habla con los otros tres por HTTP y con token. En la base no
# tiene nada: si pudiera leer asilo_caja se saltaria la matriz de ms-caja por
# debajo, sin pasar por su codigo.
CLAVE_CONSULTAS=${BD_CLAVE_CONSULTAS:-$(grep -E '^BD_CLAVE_CONSULTAS=' .env 2>/dev/null | cut -d= -f2-)}
if [ -z "$CLAVE_CONSULTAS" ]; then
  rojo "no encontre BD_CLAVE_CONSULTAS en .env; no puedo probar el aislamiento"
else
  # base:tabla — se nombra una tabla real de cada base, porque un error de
  # "tabla inexistente" no probaria nada sobre los permisos.
  for par in asilo_vigia:validaciones asilo_pastillero:internos asilo_caja:cargos; do
    BASE=${par%%:*}; TABLA=${par#*:}
    FUGA=$(docker compose exec -T bd-asilo mysql -u usr_consultas -p"$CLAVE_CONSULTAS" \
           -e "SELECT COUNT(*) FROM $BASE.$TABLA;" 2>&1)
    if printf "%s" "$FUGA" | grep -qiE "denied|Unknown database"; then
      verde "usr_consultas NO puede leer $BASE (el motor le niega el permiso)"
    else
      rojo "usr_consultas pudo leer $BASE — revisa los GRANT de sql/01"
    fi
  done

  # Control positivo: sobre su propia base si tiene que poder, porque si no
  # las tres lineas de arriba pasarian tambien con una clave equivocada.
  PROPIA=$(docker compose exec -T bd-asilo mysql -u usr_consultas -p"$CLAVE_CONSULTAS" \
           -e "SELECT COUNT(*) FROM asilo_consultas.solicitudes;" 2>&1)
  if printf "%s" "$PROPIA" | grep -qi "denied"; then
    rojo "usr_consultas tampoco puede leer su propia base asilo_consultas"
  else
    verde "usr_consultas SI puede leer su propia base asilo_consultas"
  fi

  # Y tampoco puede cambiar la forma de sus tablas: el esquema lo define
  # sql/, no el servicio en caliente.
  DDL=$(docker compose exec -T bd-asilo mysql -u usr_consultas -p"$CLAVE_CONSULTAS" \
        -e "ALTER TABLE asilo_consultas.solicitudes ADD COLUMN colada_por_la_prueba INT NULL;" 2>&1)
  if printf "%s" "$DDL" | grep -qi "denied"; then
    verde "usr_consultas NO puede alterar su propio esquema (no tiene ALTER)"
  else
    rojo "usr_consultas pudo hacer ALTER TABLE — revisa los GRANT de sql/01"
    docker compose exec -T bd-asilo mysql -u root \
      -p"${BD_CLAVE_ROOT:-$(grep -E '^BD_CLAVE_ROOT=' .env | cut -d= -f2-)}" \
      -e "ALTER TABLE asilo_consultas.solicitudes DROP COLUMN colada_por_la_prueba;" 2>/dev/null
  fi
fi

titulo "15. Limite de intentos de login (deja 'medico' bloqueado un rato)"
ULT=""
for i in 1 2 3 4 5 6 7; do
  ULT=$(codigo POST "$GW/api/auth/login" "" '{"usuario":"medico","clave":"malaclave"}')
done
espera "al septimo intento fallido" 429 "$ULT"

printf "\n\033[1m== Resultado: %s OK, %s FALLA\033[0m\n" "$OK" "$FALLA"
printf "\nPara volver a correrlo o antes de grabar el video, limpia los datos de prueba:\n"
printf "  docker compose down -v\n  docker compose up -d\n"
[ "$FALLA" -eq 0 ] || exit 1