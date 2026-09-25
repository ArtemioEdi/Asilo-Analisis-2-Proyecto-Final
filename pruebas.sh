#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Prueba de humo del asilo Cabeza de Algodon.
#
# TODO pasa por ms-gateway (http://localhost:8080) y con token, porque es el
# unico camino que existe: ms-vigia, ms-pastillero y ms-caja ya no publican
# puerto al host. La version anterior de este archivo hablaba directo a los
# puertos 8081-8083, que era justamente la costumbre que habia que corregir.
#
# Cada prueba imprime OK o FALLA. El script termina con codigo distinto de
# cero si algo falla, para poder usarlo como prueba de humo de verdad:
#
#     ./pruebas.sh ; echo "codigo de salida: $?"
# ---------------------------------------------------------------------------
set -u

GATEWAY=${GATEWAY:-http://localhost:8080}
ARCHIVO_ENV=${ARCHIVO_ENV:-.env}

VERDE=$'\033[1;32m'; ROJO=$'\033[1;31m'; CIAN=$'\033[1;36m'; GRIS=$'\033[0;90m'; FIN=$'\033[0m'

TOTAL=0
FALLIDAS=0
TEMPORAL=$(mktemp -d 2>/dev/null || echo "${TMPDIR:-/tmp}/pruebas-asilo-$$")
mkdir -p "$TEMPORAL"
trap 'rm -rf "$TEMPORAL"' EXIT

titulo() { printf "\n%s== %s%s\n" "$CIAN" "$1" "$FIN"; }
detalle() { printf "   %s%s%s\n" "$GRIS" "$1" "$FIN"; }

# comprobar <descripcion> <esperado> <obtenido>
comprobar() {
  TOTAL=$((TOTAL + 1))
  if [ "$2" = "$3" ]; then
    printf "   %sOK%s    %s\n" "$VERDE" "$FIN" "$1"
  else
    FALLIDAS=$((FALLIDAS + 1))
    printf "   %sFALLA%s %s (esperaba %s, obtuvo %s)\n" "$ROJO" "$FIN" "$1" "$2" "$3"
  fi
}

# ---------------------------------------------------------------------------
# Interprete para leer JSON. Se usa python3 si esta, si no node. En Windows con
# Git Bash normalmente solo hay uno de los dos, asi que se aceptan ambos.
# ---------------------------------------------------------------------------
INTERPRETE=""
if command -v python3 >/dev/null 2>&1 && python3 -c "pass" >/dev/null 2>&1; then
  INTERPRETE="python3"
elif command -v python >/dev/null 2>&1 && python -c "pass" >/dev/null 2>&1; then
  INTERPRETE="python"
elif command -v node >/dev/null 2>&1; then
  INTERPRETE="node"
else
  printf "%sNo hay python3 ni node en el equipo; este script los necesita para leer JSON.%s\n" "$ROJO" "$FIN"
  exit 2
fi

# campo <ruta.separada.por.puntos>  <  json
# Imprime el valor, o vacio si la ruta no existe.
campo() {
  if [ "$INTERPRETE" = "node" ]; then
    node -e '
      let e = ""; process.stdin.on("data", (c) => (e += c)).on("end", () => {
        let d; try { d = JSON.parse(e); } catch (_) { return; }
        for (const p of process.argv[1].split(".")) {
          if (d == null) return;
          d = d[p];
        }
        if (d == null) return;
        console.log(typeof d === "object" ? JSON.stringify(d) : d);
      });' "$1"
  else
    "$INTERPRETE" -c '
import json, sys
try:
    d = json.load(sys.stdin)
except Exception:
    sys.exit(0)
for p in sys.argv[1].split("."):
    if isinstance(d, list):
        d = d[int(p)] if p.lstrip("-").isdigit() and abs(int(p)) < len(d) else None
    elif isinstance(d, dict):
        d = d.get(p)
    else:
        d = None
    if d is None:
        sys.exit(0)
# Los booleanos se imprimen como JSON y no como Python: el guion compara
# contra "true", y "True" lo haria fallar solo porque en el equipo habia
# python en vez de node.
print(json.dumps(d, ensure_ascii=False) if isinstance(d, (dict, list, bool)) else d)
' "$1"
  fi
}

# codigo <metodo> <url> [token] [cuerpo]  -> imprime el codigo HTTP y deja el
# cuerpo de la respuesta en $TEMPORAL/respuesta.json
codigo() {
  local metodo="$1" url="$2" token="${3:-}" cuerpo="${4:-}"
  local argumentos=(-s -o "$TEMPORAL/respuesta.json" -w "%{http_code}" -X "$metodo" "$url")
  [ -n "$token" ] && argumentos+=(-H "Authorization: Bearer $token")
  [ -n "$cuerpo" ] && argumentos+=(-H "Content-Type: application/json" -d "$cuerpo")
  curl "${argumentos[@]}"
}

# cuerpo <metodo> <url> [token] [cuerpo]  -> imprime el cuerpo de la respuesta
cuerpo() {
  local metodo="$1" url="$2" token="${3:-}" datos="${4:-}"
  local argumentos=(-s -X "$metodo" "$url")
  [ -n "$token" ] && argumentos+=(-H "Authorization: Bearer $token")
  [ -n "$datos" ] && argumentos+=(-H "Content-Type: application/json" -d "$datos")
  curl "${argumentos[@]}"
}

entrar() {
  cuerpo POST "$GATEWAY/api/auth/login" "" "{\"usuario\":\"$1\",\"clave\":\"$2\"}" | campo token
}

printf "%s== Prueba de humo del asilo Cabeza de Algodon%s\n" "$CIAN" "$FIN"
detalle "gateway: $GATEWAY   interprete JSON: $INTERPRETE"

# ---------------------------------------------------------------------------
titulo "1. El gateway responde y los microservicios NO estan expuestos al host"
# ---------------------------------------------------------------------------
comprobar "GET /salud del gateway responde 200" "200" "$(codigo GET "$GATEWAY/salud")"
detalle "$(cat "$TEMPORAL/respuesta.json" | campo servicio) $(cat "$TEMPORAL/respuesta.json" | campo version)"

for puerto in 8081 8082 8083; do
  if curl -s -o /dev/null --max-time 3 "http://localhost:$puerto/salud" 2>/dev/null; then
    TOTAL=$((TOTAL + 1)); FALLIDAS=$((FALLIDAS + 1))
    printf "   %sFALLA%s el puerto %s sigue abierto al host\n" "$ROJO" "$FIN" "$puerto"
  else
    TOTAL=$((TOTAL + 1))
    printf "   %sOK%s    el puerto %s ya no responde desde el host\n" "$VERDE" "$FIN" "$puerto"
  fi
done

# ---------------------------------------------------------------------------
titulo "2. Acceso de los tres roles"
# ---------------------------------------------------------------------------
comprobar "login con clave incorrecta responde 401" "401" \
  "$(codigo POST "$GATEWAY/api/auth/login" "" '{"usuario":"medico","clave":"incorrecta"}')"

comprobar "login de un usuario inexistente responde 401" "401" \
  "$(codigo POST "$GATEWAY/api/auth/login" "" '{"usuario":"no-existe","clave":"loquesea"}')"
detalle "mismo mensaje en los dos casos: $(cat "$TEMPORAL/respuesta.json" | campo error)"

TOKEN_MEDICO=$(entrar medico medico2026)
TOKEN_ENFERMERIA=$(entrar enfermeria enfermeria2026)
TOKEN_ADMINISTRACION=$(entrar administracion admin2026)

comprobar "el medico obtiene token" "si" "$([ -n "$TOKEN_MEDICO" ] && echo si || echo no)"
comprobar "enfermeria obtiene token" "si" "$([ -n "$TOKEN_ENFERMERIA" ] && echo si || echo no)"
comprobar "administracion obtiene token" "si" "$([ -n "$TOKEN_ADMINISTRACION" ] && echo si || echo no)"

if [ -z "$TOKEN_MEDICO" ] || [ -z "$TOKEN_ENFERMERIA" ] || [ -z "$TOKEN_ADMINISTRACION" ]; then
  printf "\n%sNo se pudo iniciar sesion; el resto de las pruebas no tiene sentido.%s\n" "$ROJO" "$FIN"
  printf "Levante el stack con: docker compose up -d --build\n"
  exit 1
fi

# ---------------------------------------------------------------------------
titulo "3. Seguridad: sin token, token manipulado y token vencido"
# ---------------------------------------------------------------------------
comprobar "sin token, /vigia responde 401" "401" \
  "$(codigo GET "$GATEWAY/vigia/api/v1/vademecum")"

comprobar "sin token, POST a /caja responde 401" "401" \
  "$(codigo POST "$GATEWAY/caja/api/v1/donaciones" "" \
     '{"donante":"ATACANTE","tipo":"EMPRESA_NACIONAL","monto":99999}')"
detalle "este era el agujero: antes ese POST directo a 8083 devolvia 201"

# Se le cambia un caracter a la firma del token bueno.
ULTIMO=${TOKEN_MEDICO: -1}
if [ "$ULTIMO" = "A" ]; then SUSTITUTO="B"; else SUSTITUTO="A"; fi
TOKEN_ROTO="${TOKEN_MEDICO%?}$SUSTITUTO"
comprobar "token manipulado responde 401" "401" \
  "$(codigo GET "$GATEWAY/vigia/api/v1/vademecum" "$TOKEN_ROTO")"

# Token vencido: se firma uno a mano con el mismo secreto y exp en el pasado.
# El secreto sale del .env de esta instalacion.
if [ -f "$ARCHIVO_ENV" ]; then
  SECRETO=$(grep -E "^GATEWAY_SECRETO=" "$ARCHIVO_ENV" | head -1 | cut -d= -f2- | tr -d "\r\"'")
else
  SECRETO=""
fi

if [ -n "$SECRETO" ] && command -v openssl >/dev/null 2>&1; then
  b64url() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }
  VENCIDO_EN=$(( $(date +%s) - 3600 ))
  CABEZA=$(printf '{"alg":"HS256","typ":"JWT"}' | b64url)
  CARGA=$(printf '{"usuario":"medico","nombre":"Dr. Angel Maltez","rol":"MEDICO","iat":%s,"exp":%s}' \
          "$((VENCIDO_EN - 60))" "$VENCIDO_EN" | b64url)
  FIRMA=$(printf '%s' "$CABEZA.$CARGA" \
          | openssl dgst -sha256 -mac HMAC -macopt "key:$SECRETO" -binary | b64url)
  TOKEN_VENCIDO="$CABEZA.$CARGA.$FIRMA"
  comprobar "token vencido responde 401" "401" \
    "$(codigo GET "$GATEWAY/vigia/api/v1/vademecum" "$TOKEN_VENCIDO")"
  detalle "$(cat "$TEMPORAL/respuesta.json" | campo error)"
else
  detalle "omitida la prueba de token vencido: no se encontro $ARCHIVO_ENV o falta openssl"
fi

# ---------------------------------------------------------------------------
titulo "4. Matriz de roles: quien escribe"
# ---------------------------------------------------------------------------
comprobar "enfermeria NO puede crear una validacion en /vigia (403)" "403" \
  "$(codigo POST "$GATEWAY/vigia/api/v1/validaciones" "$TOKEN_ENFERMERIA" \
     '{"pacienteId":"ASL-014","propuesta":{"principioActivo":"paracetamol","dosisMg":500,"cadaHoras":8}}')"
detalle "$(cat "$TEMPORAL/respuesta.json" | campo error)"

comprobar "administracion NO puede crear una validacion en /vigia (403)" "403" \
  "$(codigo POST "$GATEWAY/vigia/api/v1/validaciones" "$TOKEN_ADMINISTRACION" \
     '{"pacienteId":"ASL-014","propuesta":{"principioActivo":"paracetamol","dosisMg":500,"cadaHoras":8}}')"

comprobar "enfermeria NO puede registrar un gasto en /caja (403)" "403" \
  "$(codigo POST "$GATEWAY/caja/api/v1/gastos" "$TOKEN_ENFERMERIA" \
     '{"concepto":"prueba no autorizada","categoria":"OTRO","monto":10}')"

# ---------------------------------------------------------------------------
titulo "5. Matriz de roles: quien lee"
# ---------------------------------------------------------------------------
comprobar "enfermeria SI lee el vademecum de /vigia (200)" "200" \
  "$(codigo GET "$GATEWAY/vigia/api/v1/vademecum" "$TOKEN_ENFERMERIA")"
detalle "farmacos en el vademecum: $(cat "$TEMPORAL/respuesta.json" | campo total)"

comprobar "administracion NO lee la bitacora clinica de /vigia (403)" "403" \
  "$(codigo GET "$GATEWAY/vigia/api/v1/validaciones" "$TOKEN_ADMINISTRACION")"

comprobar "el medico NO lee el resumen financiero de /caja (403)" "403" \
  "$(codigo GET "$GATEWAY/caja/api/v1/resumen" "$TOKEN_MEDICO")"

comprobar "enfermeria NO lee el resumen financiero de /caja (403)" "403" \
  "$(codigo GET "$GATEWAY/caja/api/v1/resumen" "$TOKEN_ENFERMERIA")"

# La excepcion de lectura del medico.
comprobar "el medico SI lee la cuenta de un interno (200, excepcion)" "200" \
  "$(codigo GET "$GATEWAY/caja/api/v1/pacientes/ASL-014/cuenta" "$TOKEN_MEDICO")"
detalle "saldo pendiente del interno: Q $(cat "$TEMPORAL/respuesta.json" | campo saldoPendiente)"

comprobar "enfermeria NO lee la cuenta de un interno (403)" "403" \
  "$(codigo GET "$GATEWAY/caja/api/v1/pacientes/ASL-014/cuenta" "$TOKEN_ENFERMERIA")"

comprobar "administracion NO lee el pastillero (403)" "403" \
  "$(codigo GET "$GATEWAY/pastillero/api/v1/pacientes" "$TOKEN_ADMINISTRACION")"

# ---------------------------------------------------------------------------
titulo "6. La raiz del gateway y el 404 con contexto"
# ---------------------------------------------------------------------------
comprobar "GET / responde 200 y no un 404" "200" "$(codigo GET "$GATEWAY/")"
comprobar "la raiz dice donde esta la aplicacion" "si" \
  "$([ -n "$(cat "$TEMPORAL/respuesta.json" | campo aviso)" ] && echo si || echo no)"
detalle "$(cat "$TEMPORAL/respuesta.json" | campo aviso)"

comprobar "una ruta inexistente responde 404" "404" \
  "$(codigo PUT "$GATEWAY/no-existe/nada" "$TOKEN_MEDICO")"
comprobar "el 404 incluye la ruta pedida" "/no-existe/nada" \
  "$(cat "$TEMPORAL/respuesta.json" | campo ruta)"
comprobar "el 404 incluye el metodo" "PUT" \
  "$(cat "$TEMPORAL/respuesta.json" | campo metodo)"

# ---------------------------------------------------------------------------
titulo "7. El padron de internos vive en el servidor, no en el navegador"
# ---------------------------------------------------------------------------
PADRON=$(cuerpo GET "$GATEWAY/pastillero/api/v1/internos" "$TOKEN_MEDICO")
comprobar "ms-pastillero sirve los tres internos" "3" "$(printf '%s' "$PADRON" | campo total)"

FICHA=$(cuerpo GET "$GATEWAY/pastillero/api/v1/internos/ASL-007" "$TOKEN_MEDICO")
comprobar "la ficha trae la alergia del interno" '["sulfas"]' \
  "$(printf '%s' "$FICHA" | campo alergias)"
detalle "$(printf '%s' "$FICHA" | campo nombre) · $(printf '%s' "$FICHA" | campo edad) anios · $(printf '%s' "$FICHA" | campo cama)"

comprobar "un interno que no existe responde 404" "404" \
  "$(codigo GET "$GATEWAY/pastillero/api/v1/internos/ASL-999" "$TOKEN_MEDICO")"

# Administracion le cobra a la familia de cada interno, asi que si ve el
# padron; lo que no recibe es la parte clinica de la ficha.
comprobar "administracion SI lee el padron (200)" "200" \
  "$(codigo GET "$GATEWAY/pastillero/api/v1/internos" "$TOKEN_ADMINISTRACION")"
FICHA_ADMIN=$(cuerpo GET "$GATEWAY/pastillero/api/v1/internos/ASL-007" "$TOKEN_ADMINISTRACION")
comprobar "pero la ficha le llega SIN alergias" "" \
  "$(printf '%s' "$FICHA_ADMIN" | campo alergias)"
comprobar "y SIN psicopatologias" "" \
  "$(printf '%s' "$FICHA_ADMIN" | campo psicopatologias)"
comprobar "aunque si con el familiar responsable" "Julio Xicará, sobrino" \
  "$(printf '%s' "$FICHA_ADMIN" | campo responsable)"

comprobar "administracion sigue SIN poder leer las tomas (403)" "403" \
  "$(codigo GET "$GATEWAY/pastillero/api/v1/pacientes/ASL-007/tomas" "$TOKEN_ADMINISTRACION")"

# ---------------------------------------------------------------------------
titulo "8. El cliente ya no puede mentir sobre las alergias"
# ---------------------------------------------------------------------------
# Furosemida para Transito Xicara, que es alergica a las sulfas, mintiendo en
# el cuerpo: sin alergias y con 30 anios. ms-vigia arma la ficha preguntandole
# a ms-pastillero, asi que la mentira no cambia nada.
MENTIRA=$(cuerpo POST "$GATEWAY/vigia/api/v1/validaciones" "$TOKEN_MEDICO" '{
  "pacienteId":"ASL-007","edad":30,"alergias":[],"psicopatologias":[],"medicacionActual":[],
  "propuesta":{"principioActivo":"furosemida","dosisMg":40,"cadaHoras":24}}')
comprobar "furosemida a la paciente alergica a sulfas sigue BLOQUEADA" "BLOQUEADO" \
  "$(printf '%s' "$MENTIRA" | campo veredicto)"
comprobar "el servidor evaluo con la alergia real" '["sulfas"]' \
  "$(printf '%s' "$MENTIRA" | campo fichaEvaluada.alergias)"
comprobar "el servidor evaluo con la edad real, no con la mentida" "79" \
  "$(printf '%s' "$MENTIRA" | campo fichaEvaluada.edad)"
comprobar "la ficha la puso ms-pastillero" "ms-pastillero" \
  "$(printf '%s' "$MENTIRA" | campo fichaEvaluada.fuente)"
detalle "$(printf '%s' "$MENTIRA" | campo hallazgos.0.mensaje)"

comprobar "validar a un interno inexistente responde 404" "404" \
  "$(codigo POST "$GATEWAY/vigia/api/v1/validaciones" "$TOKEN_MEDICO" \
     '{"pacienteId":"ASL-999","propuesta":{"principioActivo":"paracetamol","dosisMg":500,"cadaHoras":8}}')"
detalle "$(cat "$TEMPORAL/respuesta.json" | campo error)"

# ---------------------------------------------------------------------------
titulo "8b. La medicacion permanente pesa igual que un plan de tomas"
# ---------------------------------------------------------------------------
# Las "medicinas de cajon" —lo que el interno ya tomaba antes de entrar y nadie
# le programa— tienen que entrar en el dictamen igual que un plan activo. Si no
# entran, la ficha muestra un farmaco que el motor no mira, y eso es peor que no
# registrarlo: parece que protege.
#
# Rosalia no tiene sertralina en ningun plan. El tramadol se le aprueba. En
# cuanto el medico le registra la sertralina como permanente, el mismo tramadol
# tiene que quedar BLOQUEADO por sindrome serotoninergico.
#
# El bloque fija su punto de partida y lo restaura al final, para que correr
# pruebas.sh dos veces seguidas de el mismo resultado: si se limitara a dar por
# sentado el estado sembrado, la segunda corrida empezaria con la sertralina ya
# puesta y el primer comprobar fallaria.
PERMANENTE_BASE='{"medicacionPermanente":[{"principioActivo":"donepecilo","farmaco":"Donepecilo","dosisMg":10,"cadaHoras":24,"via":"oral"}]}'
codigo PUT "$GATEWAY/pastillero/api/v1/internos/ASL-014/clinica" "$TOKEN_MEDICO" \
  "$PERMANENTE_BASE" > /dev/null

ANTES=$(cuerpo POST "$GATEWAY/vigia/api/v1/validaciones" "$TOKEN_MEDICO" \
  '{"pacienteId":"ASL-014","propuesta":{"principioActivo":"tramadol","dosisMg":50,"cadaHoras":8}}')
comprobar "sin sertralina registrada, el tramadol se aprueba" "APROBADO" \
  "$(printf '%s' "$ANTES" | campo veredicto)"

comprobar "el medico registra la sertralina como permanente (200)" "200" \
  "$(codigo PUT "$GATEWAY/pastillero/api/v1/internos/ASL-014/clinica" "$TOKEN_MEDICO" \
     '{"medicacionPermanente":[{"principioActivo":"donepecilo","farmaco":"Donepecilo","dosisMg":10,"cadaHoras":24},{"principioActivo":"sertralina","farmaco":"Sertralina","dosisMg":50,"cadaHoras":24,"nota":"La toma desde antes de ingresar."}]}')"

comprobar "aparece en la medicacion actual con origen PERMANENTE" "PERMANENTE" \
  "$(cuerpo GET "$GATEWAY/pastillero/api/v1/pacientes/ASL-014/medicacion-activa" "$TOKEN_MEDICO" \
     | tr '{' '\n' | grep sertralina | sed -n 's/.*"origen":"\([A-Z]*\)".*/\1/p')"

DESPUES=$(cuerpo POST "$GATEWAY/vigia/api/v1/validaciones" "$TOKEN_MEDICO" \
  '{"pacienteId":"ASL-014","propuesta":{"principioActivo":"tramadol","dosisMg":50,"cadaHoras":8}}')
comprobar "ahora el mismo tramadol queda BLOQUEADO" "BLOQUEADO" \
  "$(printf '%s' "$DESPUES" | campo veredicto)"
comprobar "y lo bloquea la interaccion, no otra regla" "FV-INT-01" \
  "$(printf '%s' "$DESPUES" | campo hallazgos.0.codigo)"
detalle "$(printf '%s' "$DESPUES" | campo hallazgos.0.mensaje)"

# Un principio activo que ms-vigia no conoce no se guarda: quedaria en la
# ficha sin proteger de nada, que es justo el fallo que esto vino a cerrar.
comprobar "un principio activo inventado se rechaza (400)" "400" \
  "$(codigo PUT "$GATEWAY/pastillero/api/v1/internos/ASL-014/clinica" "$TOKEN_MEDICO" \
     '{"medicacionPermanente":[{"principioActivo":"aguadepanela"}]}')"
detalle "$(cat "$TEMPORAL/respuesta.json" | campo detalles.0)"

# Lo que ya viene de un plan no se cuenta dos veces.
comprobar "un farmaco que ya esta en plan no se duplica" "1" \
  "$(cuerpo GET "$GATEWAY/pastillero/api/v1/pacientes/ASL-007/medicacion-activa" "$TOKEN_MEDICO" \
     | grep -o '"principioActivo":"enalapril"' | wc -l | tr -d ' ')"

# Se devuelve el padron a como quedo sembrado: el escenario de la demostracion
# no tiene por que arrastrar lo que dejo una corrida de pruebas.
codigo PUT "$GATEWAY/pastillero/api/v1/internos/ASL-014/clinica" "$TOKEN_MEDICO" \
  "$PERMANENTE_BASE" > /dev/null
comprobar "el padron queda como estaba al empezar" "APROBADO" \
  "$(cuerpo POST "$GATEWAY/vigia/api/v1/validaciones" "$TOKEN_MEDICO" \
     '{"pacienteId":"ASL-014","propuesta":{"principioActivo":"tramadol","dosisMg":50,"cadaHoras":8}}' \
     | campo veredicto)"


# ---------------------------------------------------------------------------
titulo "9. Folios unicos bajo concurrencia"
# ---------------------------------------------------------------------------
# Diez validaciones a la vez: ninguna puede repetir folio.
#
# Cada peticion escribe su propio archivo porque en Git Bash sobre Windows diez
# procesos agregando al mismo archivo con >> se pisan y se pierden lineas.
mkdir -p "$TEMPORAL/folios"
for i in $(seq 10); do
  cuerpo POST "$GATEWAY/vigia/api/v1/validaciones" "$TOKEN_MEDICO" \
    '{"pacienteId":"ASL-022","propuesta":{"principioActivo":"paracetamol","dosisMg":500,"cadaHoras":8}}' \
    | campo folio > "$TEMPORAL/folios/$i.txt" &
done
wait
FOLIOS_TOTAL=$(cat "$TEMPORAL"/folios/*.txt 2>/dev/null | grep -c . || echo 0)
FOLIOS_UNICOS=$(cat "$TEMPORAL"/folios/*.txt 2>/dev/null | sort -u | grep -c . || echo 0)
comprobar "las 10 validaciones simultaneas se crearon" "10" "$FOLIOS_TOTAL"
comprobar "los 10 folios son distintos" "10" "$FOLIOS_UNICOS"
detalle "ejemplo de folio: $(cat "$TEMPORAL/folios/1.txt")"

# ---------------------------------------------------------------------------
titulo "10. Farmacovigilancia: ibuprofeno a un interno anticoagulado con warfarina"
# ---------------------------------------------------------------------------
# En el cuerpo solo van a quien y que. La warfarina que dispara la interaccion
# la encuentra ms-vigia en la medicacion que le reporta ms-pastillero.
BLOQUEADO=$(cuerpo POST "$GATEWAY/vigia/api/v1/validaciones" "$TOKEN_MEDICO" '{
  "pacienteId":"ASL-022",
  "propuesta":{"principioActivo":"ibuprofeno","dosisMg":400,"cadaHoras":8,"viaAdministracion":"oral"}}')

VEREDICTO=$(printf '%s' "$BLOQUEADO" | campo veredicto)
FOLIO_BLOQUEADO=$(printf '%s' "$BLOQUEADO" | campo folio)
comprobar "ms-vigia dictamina BLOQUEADO" "BLOQUEADO" "$VEREDICTO"
detalle "folio $FOLIO_BLOQUEADO · $(printf '%s' "$BLOQUEADO" | campo resumen)"
detalle "$(printf '%s' "$BLOQUEADO" | campo hallazgos.0.mensaje)"

# El dictamen se firma con el nombre del token, no con el del cuerpo.
comprobar "el dictamen lo firma quien inicio sesion" "Dr. Angel Maltez" \
  "$(printf '%s' "$BLOQUEADO" | campo solicitadoPor)"

comprobar "ms-pastillero se niega a programar ese folio (409)" "409" \
  "$(codigo POST "$GATEWAY/pastillero/api/v1/planes" "$TOKEN_MEDICO" \
     "{\"pacienteId\":\"ASL-022\",\"principioActivo\":\"ibuprofeno\",\"farmaco\":\"Ibuprofeno\",
       \"dosisMg\":400,\"cadaHoras\":8,\"dias\":3,\"folioValidacion\":\"$FOLIO_BLOQUEADO\"}")"
detalle "$(cat "$TEMPORAL/respuesta.json" | campo error)"

# ---------------------------------------------------------------------------
titulo "11. Farmacovigilancia: paracetamol al mismo interno, y se programa"
# ---------------------------------------------------------------------------
APROBADO=$(cuerpo POST "$GATEWAY/vigia/api/v1/validaciones" "$TOKEN_MEDICO" '{
  "pacienteId":"ASL-022","edad":88,"alergias":[],
  "psicopatologias":["Deterioro cognitivo leve"],
  "medicacionActual":[{"principioActivo":"warfarina"}],
  "propuesta":{"principioActivo":"paracetamol","dosisMg":500,"cadaHoras":8,"viaAdministracion":"oral"}}')

FOLIO_APROBADO=$(printf '%s' "$APROBADO" | campo folio)
comprobar "ms-vigia no bloquea el paracetamol" "no" \
  "$([ "$(printf '%s' "$APROBADO" | campo veredicto)" = "BLOQUEADO" ] && echo si || echo no)"
detalle "folio $FOLIO_APROBADO · veredicto $(printf '%s' "$APROBADO" | campo veredicto)"

PLAN=$(cuerpo POST "$GATEWAY/pastillero/api/v1/planes" "$TOKEN_MEDICO" "{
  \"pacienteId\":\"ASL-022\",\"pacienteNombre\":\"Bernardo Puac Ixcoy\",
  \"principioActivo\":\"paracetamol\",\"farmaco\":\"Paracetamol\",
  \"dosisMg\":500,\"cadaHoras\":8,\"dias\":3,\"via\":\"oral\",
  \"indicacion\":\"Dolor lumbar\",\"folioValidacion\":\"$FOLIO_APROBADO\"}")

PLAN_ID=$(printf '%s' "$PLAN" | campo planId)
comprobar "ms-pastillero programa el plan" "si" \
  "$([ -n "$PLAN_ID" ] && echo si || echo no)"
detalle "plan $PLAN_ID · $(printf '%s' "$PLAN" | campo tomasProgramadas) tomas · primera $(printf '%s' "$PLAN" | campo primeraToma)"

# ---------------------------------------------------------------------------
titulo "12. Registro de una toma por enfermeria"
# ---------------------------------------------------------------------------
TOMA=$(cuerpo GET "$GATEWAY/pastillero/api/v1/planes/$PLAN_ID" "$TOKEN_ENFERMERIA" | campo tomas.0.id)
comprobar "enfermeria ve las tomas del plan" "si" "$([ -n "$TOMA" ] && echo si || echo no)"

comprobar "administracion NO puede administrar una toma (403)" "403" \
  "$(codigo POST "$GATEWAY/pastillero/api/v1/tomas/$TOMA/administrar" "$TOKEN_ADMINISTRACION" '{}')"

comprobar "enfermeria SI registra la toma (200)" "200" \
  "$(codigo POST "$GATEWAY/pastillero/api/v1/tomas/$TOMA/administrar" "$TOKEN_ENFERMERIA" \
     '{"observacion":"Tolero bien la toma"}')"
comprobar "la toma queda firmada por quien inicio sesion" "Enf. Lucia Cabrera" \
  "$(cat "$TEMPORAL/respuesta.json" | campo enfermero)"

comprobar "la misma toma no se registra dos veces (409)" "409" \
  "$(codigo POST "$GATEWAY/pastillero/api/v1/tomas/$TOMA/administrar" "$TOKEN_ENFERMERIA" '{}')"
detalle "$(cat "$TEMPORAL/respuesta.json" | campo error)"

# ---------------------------------------------------------------------------
titulo "13. Caja: cobro, pago, donacion y gasto (solo administracion)"
# ---------------------------------------------------------------------------
CARGO=$(cuerpo POST "$GATEWAY/caja/api/v1/cargos" "$TOKEN_ADMINISTRACION" '{
  "pacienteId":"ASL-014","pacienteNombre":"Rosalia Menchu Coy","categoria":"CONSULTA",
  "concepto":"Consulta de control","tarifa":"consulta-general"}')
CARGO_ID=$(printf '%s' "$CARGO" | campo id)
comprobar "administracion registra un cargo" "si" "$([ -n "$CARGO_ID" ] && echo si || echo no)"
comprobar "el cargo lo firma quien inicio sesion" "Marta Solis" \
  "$(printf '%s' "$CARGO" | campo registradoPor)"
detalle "cargo $CARGO_ID · neto Q $(printf '%s' "$CARGO" | campo montoNeto) con descuento de la fundacion"

comprobar "se registra un abono al cargo (201)" "201" \
  "$(codigo POST "$GATEWAY/caja/api/v1/cargos/$CARGO_ID/pagar" "$TOKEN_ADMINISTRACION" \
     '{"monto":30,"metodo":"efectivo"}')"

comprobar "se registra una donacion (201)" "201" \
  "$(codigo POST "$GATEWAY/caja/api/v1/donaciones" "$TOKEN_ADMINISTRACION" \
     '{"donante":"Prueba SA","tipo":"EMPRESA_NACIONAL","monto":250}')"

comprobar "se registra un gasto (201)" "201" \
  "$(codigo POST "$GATEWAY/caja/api/v1/gastos" "$TOKEN_ADMINISTRACION" \
     '{"concepto":"Prueba de gasto","categoria":"OTRO","monto":40}')"

comprobar "administracion lee el resumen general (200)" "200" \
  "$(codigo GET "$GATEWAY/caja/api/v1/resumen" "$TOKEN_ADMINISTRACION")"
detalle "entradas Q $(cat "$TEMPORAL/respuesta.json" | campo entradas.total) · salidas Q $(cat "$TEMPORAL/respuesta.json" | campo salidas.total)"

# ---------------------------------------------------------------------------
titulo "14. Cierre de sesion: el token deja de servir"
# ---------------------------------------------------------------------------
TOKEN_DESECHABLE=$(entrar enfermeria enfermeria2026)
comprobar "antes de cerrar sesion el token sirve (200)" "200" \
  "$(codigo GET "$GATEWAY/vigia/api/v1/vademecum" "$TOKEN_DESECHABLE")"

comprobar "POST /api/auth/logout responde 200" "200" \
  "$(codigo POST "$GATEWAY/api/auth/logout" "$TOKEN_DESECHABLE")"

comprobar "despues del logout el mismo token responde 401" "401" \
  "$(codigo GET "$GATEWAY/vigia/api/v1/vademecum" "$TOKEN_DESECHABLE")"
detalle "$(cat "$TEMPORAL/respuesta.json" | campo error)"

# ---------------------------------------------------------------------------
titulo "15. Limite de intentos de acceso"
# ---------------------------------------------------------------------------
# El usuario de esta prueba no existe, para no dejar bloqueada una cuenta real
# durante los cinco minutos de la ventana.
USUARIO_CEBO="cebo-$RANDOM"
for _ in 1 2 3 4 5; do
  codigo POST "$GATEWAY/api/auth/login" "" \
    "{\"usuario\":\"$USUARIO_CEBO\",\"clave\":\"mala\"}" >/dev/null
done
comprobar "al sexto intento fallido responde 429" "429" \
  "$(codigo POST "$GATEWAY/api/auth/login" "" "{\"usuario\":\"$USUARIO_CEBO\",\"clave\":\"mala\"}")"
detalle "$(cat "$TEMPORAL/respuesta.json" | campo error)"

RETRY=$(curl -s -o /dev/null -D - -X POST "$GATEWAY/api/auth/login" \
  -H 'Content-Type: application/json' -d "{\"usuario\":\"$USUARIO_CEBO\",\"clave\":\"mala\"}" \
  | grep -i "^retry-after:" | tr -d '\r' | awk '{print $2}')
comprobar "la respuesta 429 trae encabezado Retry-After" "si" \
  "$([ -n "$RETRY" ] && echo si || echo no)"
detalle "Retry-After: ${RETRY:-ninguno} segundos"

# ---------------------------------------------------------------------------
titulo "16. La cadena clinica completa, de la remision a la entrega"
# ---------------------------------------------------------------------------
# El recorrido entero, con un rol distinto en cada paso, que es justo lo que
# hace valer la separacion: ninguno de los cinco puede hacer el paso del otro.
#
#   MEDICO       remite al interno a una especialidad
#   FUNDACION    le asigna medico, fecha y hora
#   MEDICO       abre la consulta e indica un examen
#   LABORATORIO  carga el resultado
#   MEDICO       receta (y ms-vigia lo puede frenar)
#   FARMACIA     entrega y se carga a la cuenta
#   MEDICO       cierra la consulta
#
# Se usa ASL-014 a proposito: es la interna con demencia mixta, y es lo que
# permite comprobar el bloqueo de ms-vigia mas abajo con un caso real y no
# con una receta inventada para que falle.
TOKEN_FUNDACION=$(entrar fundacion fundacion2026)
TOKEN_LABORATORIO=$(entrar laboratorio laboratorio2026)
TOKEN_FARMACIA=$(entrar farmacia farmacia2026)

comprobar "los tres roles nuevos obtienen token" "si" \
  "$([ -n "$TOKEN_FUNDACION" ] && [ -n "$TOKEN_LABORATORIO" ] && [ -n "$TOKEN_FARMACIA" ] && echo si || echo no)"

# --- 1. El medico remite --------------------------------------------------
SOLICITUD=$(cuerpo POST "$GATEWAY/consultas/api/v1/solicitudes" "$TOKEN_MEDICO" '{
  "pacienteId":"ASL-014",
  "motivo":"Prueba de humo: remision de la cadena clinica.",
  "especialidadSolicitada":"Psiquiatria",
  "enfermeroAcompanante":"Enf. Lucia Tzoc"}')
SOLICITUD_ID=$(printf '%s' "$SOLICITUD" | campo id)
comprobar "1. el medico remite al interno" "si" \
  "$([ -n "$SOLICITUD_ID" ] && echo si || echo no)"
comprobar "la remision nace PENDIENTE" "PENDIENTE" "$(printf '%s' "$SOLICITUD" | campo estado)"
comprobar "la firma quien inicio sesion, no el cuerpo" "Dr. Angel Maltez" \
  "$(printf '%s' "$SOLICITUD" | campo solicitadoPor)"
detalle "$SOLICITUD_ID · aviso al familiar: $(printf '%s' "$SOLICITUD" | campo avisoFamiliar.estado) a $(printf '%s' "$SOLICITUD" | campo avisoFamiliar.destinatario)"

comprobar "la fundacion NO puede remitir (eso es del medico)" "403" \
  "$(codigo POST "$GATEWAY/consultas/api/v1/solicitudes" "$TOKEN_FUNDACION" \
     '{"pacienteId":"ASL-014","motivo":"x","especialidadSolicitada":"Psiquiatria"}')"

# --- 2. La fundacion agenda -----------------------------------------------
AGENDA=$(cuerpo PUT "$GATEWAY/consultas/api/v1/solicitudes/$SOLICITUD_ID/agendar" "$TOKEN_FUNDACION" '{
  "medicoAsignado":"Dra. Silvia Racancoj",
  "especialidadAsignada":"Psiquiatria",
  "agendadaPara":"2026-09-20T09:00:00"}')
comprobar "2. la fundacion agenda la cita" "AGENDADA" "$(printf '%s' "$AGENDA" | campo estado)"
detalle "asignada a $(printf '%s' "$AGENDA" | campo medicoAsignado) para $(printf '%s' "$AGENDA" | campo agendadaPara)"

comprobar "el medico NO puede agendar (eso es de la fundacion)" "403" \
  "$(codigo PUT "$GATEWAY/consultas/api/v1/solicitudes/$SOLICITUD_ID/agendar" "$TOKEN_MEDICO" \
     '{"medicoAsignado":"Yo mismo","agendadaPara":"2026-09-20T09:00:00"}')"

# --- 3. El medico atiende -------------------------------------------------
VISITA=$(cuerpo POST "$GATEWAY/consultas/api/v1/visitas" "$TOKEN_MEDICO" \
  "{\"solicitudId\":\"$SOLICITUD_ID\"}")
VISITA_ID=$(printf '%s' "$VISITA" | campo id)
comprobar "3. el medico abre la consulta" "si" "$([ -n "$VISITA_ID" ] && echo si || echo no)"
comprobar "la consulta nace ABIERTA" "ABIERTA" "$(printf '%s' "$VISITA" | campo estado)"
detalle "$VISITA_ID"

# Una solicitud produce UNA visita, y lo garantiza el motor con un UNIQUE, no
# una comprobacion en Python: dos peticiones simultaneas pasarian las dos.
comprobar "la misma remision no produce dos consultas (409)" "409" \
  "$(codigo POST "$GATEWAY/consultas/api/v1/visitas" "$TOKEN_MEDICO" \
     "{\"solicitudId\":\"$SOLICITUD_ID\"}")"

# --- 4. El medico indica un examen ----------------------------------------
EXAMEN=$(cuerpo POST "$GATEWAY/consultas/api/v1/visitas/$VISITA_ID/examenes" "$TOKEN_MEDICO" '{
  "nombre":"Perfil tiroideo","tarifa":"laboratorio-basico"}')
EXAMEN_ID=$(printf '%s' "$EXAMEN" | campo id)
CARGO_EXAMEN=$(printf '%s' "$EXAMEN" | campo cargoId)
comprobar "4. el medico indica un examen" "si" "$([ -n "$EXAMEN_ID" ] && echo si || echo no)"
comprobar "el examen nace SOLICITADO" "SOLICITADO" "$(printf '%s' "$EXAMEN" | campo estado)"
# El medico no puede escribir en la caja, pero el cobro tiene que quedar: lo
# crea ms-consultas con su token de servicio, firmado con el nombre del medico.
comprobar "el examen se cobro solo en ms-caja" "si" \
  "$([ -n "$CARGO_EXAMEN" ] && echo si || echo no)"
detalle "$EXAMEN_ID · cargo $CARGO_EXAMEN creado por el token de servicio"

comprobar "el laboratorio NO puede indicar examenes" "403" \
  "$(codigo POST "$GATEWAY/consultas/api/v1/visitas/$VISITA_ID/examenes" "$TOKEN_LABORATORIO" \
     '{"nombre":"El que yo quiera"}')"

# --- 5. El laboratorio carga el resultado ---------------------------------
RESULTADO=$(cuerpo PUT "$GATEWAY/consultas/api/v1/examenes/$EXAMEN_ID/resultado" "$TOKEN_LABORATORIO" '{
  "resultado":"TSH 3.1 mUI/L, dentro de rango. Sin hallazgos."}')
comprobar "5. el laboratorio carga el resultado" "RESULTADO_LISTO" \
  "$(printf '%s' "$RESULTADO" | campo estado)"
comprobar "el resultado queda firmado por el laboratorio" "Lab. Clínico Central" \
  "$(printf '%s' "$RESULTADO" | campo registradoPor)"

comprobar "el medico NO puede cargar resultados de laboratorio" "403" \
  "$(codigo PUT "$GATEWAY/consultas/api/v1/examenes/$EXAMEN_ID/resultado" "$TOKEN_MEDICO" \
     '{"resultado":"lo que a mi me parezca"}')"

# --- 6. El medico receta, y ms-vigia lo frena -----------------------------
# Este es el corazon del sistema. ASL-014 tiene demencia mixta: recetarle un
# antipsicotico es un criterio geriatrico de severidad CRITICA. La receta NO
# se guarda, y el 409 trae el dictamen con el codigo del hallazgo.
BLOQUEADA=$(cuerpo POST "$GATEWAY/consultas/api/v1/visitas/$VISITA_ID/indicaciones" "$TOKEN_MEDICO" '{
  "principioActivo":"quetiapina","nombre":"Quetiapina",
  "dosisMg":25,"cadaHoras":24,"duracionDias":30}')
comprobar "6. ms-vigia BLOQUEA el antipsicotico en la paciente con demencia (409)" "409" \
  "$(codigo POST "$GATEWAY/consultas/api/v1/visitas/$VISITA_ID/indicaciones" "$TOKEN_MEDICO" \
     '{"principioActivo":"quetiapina","nombre":"Quetiapina","dosisMg":25,"cadaHoras":24,"duracionDias":30}')"
comprobar "el 409 explica por que, con el codigo del hallazgo" "FV-GER-04" \
  "$(printf '%s' "$BLOQUEADA" | campo dictamen.hallazgos.0.codigo)"
comprobar "y con su severidad" "CRITICA" \
  "$(printf '%s' "$BLOQUEADA" | campo dictamen.hallazgos.0.severidad)"
detalle "$(printf '%s' "$BLOQUEADA" | campo dictamen.hallazgos.0.mensaje)"

# La receta rechazada no se guardo: la consulta sigue sin ninguna indicacion.
comprobar "la receta bloqueada NO quedo guardada" "[]" \
  "$(cuerpo GET "$GATEWAY/consultas/api/v1/visitas/$VISITA_ID" "$TOKEN_MEDICO" | campo indicaciones)"

# --- 7. El medico receta una alternativa ----------------------------------
INDICACION=$(cuerpo POST "$GATEWAY/consultas/api/v1/visitas/$VISITA_ID/indicaciones" "$TOKEN_MEDICO" '{
  "principioActivo":"paracetamol","nombre":"Paracetamol",
  "dosisMg":500,"cadaHoras":8,"duracionDias":5,
  "comoTomarlo":"Con alimento."}')
INDICACION_ID=$(printf '%s' "$INDICACION" | campo id)
comprobar "7. el medico receta una alternativa y ms-vigia la aprueba" "si" \
  "$([ -n "$INDICACION_ID" ] && echo si || echo no)"
detalle "$INDICACION_ID · ms-vigia dictamino $(printf '%s' "$INDICACION" | campo veredictoVigia) con folio $(printf '%s' "$INDICACION" | campo folioValidacion)"

# --- 8. Farmacia entrega --------------------------------------------------
ENTREGA=$(cuerpo PUT "$GATEWAY/consultas/api/v1/indicaciones/$INDICACION_ID/entregar" "$TOKEN_FARMACIA" '{
  "tarifa":"farmacia-generico"}')
CARGO_FARMACIA=$(printf '%s' "$ENTREGA" | campo cargoId)
comprobar "8. farmacia entrega el medicamento" "true" \
  "$(printf '%s' "$ENTREGA" | campo entregado)"
comprobar "la entrega se cobro sola en ms-caja" "si" \
  "$([ -n "$CARGO_FARMACIA" ] && echo si || echo no)"
detalle "entregado por $(printf '%s' "$ENTREGA" | campo entregadoPor) · cargo $CARGO_FARMACIA"

comprobar "una entrega no se registra dos veces (409)" "409" \
  "$(codigo PUT "$GATEWAY/consultas/api/v1/indicaciones/$INDICACION_ID/entregar" "$TOKEN_FARMACIA" '{}')"

# --- 9. El medico cierra --------------------------------------------------
CIERRE=$(cuerpo PUT "$GATEWAY/consultas/api/v1/visitas/$VISITA_ID/cerrar" "$TOKEN_MEDICO" '{
  "diagnostico":"Insomnio cronico sin causa organica nueva.",
  "observaciones":"Se refuerza la higiene del sueño y se revalora en un mes."}')
comprobar "9. el medico cierra la consulta" "CERRADA" "$(printf '%s' "$CIERRE" | campo estado)"

# ---------------------------------------------------------------------------
titulo "17. Los tres reportes, sobre la consulta recien hecha"
# ---------------------------------------------------------------------------
comprobar "reporte de examenes del interno (200)" "200" \
  "$(codigo GET "$GATEWAY/consultas/api/v1/reportes/examenes?pacienteId=ASL-014" "$TOKEN_MEDICO")"
detalle "$(cat "$TEMPORAL/respuesta.json" | campo total) examenes · $(cat "$TEMPORAL/respuesta.json" | campo conResultado) con resultado"

comprobar "ficha medica completa del interno (200)" "200" \
  "$(codigo GET "$GATEWAY/consultas/api/v1/reportes/ficha?pacienteId=ASL-014" "$TOKEN_MEDICO")"
# La ficha junta dos microservicios: el padron pone psicopatologias y alergias,
# esta base pone el historial. Si el padron no contesta, no vendrian.
comprobar "la ficha trae la parte clinica del padron" "si" \
  "$([ -n "$(cat "$TEMPORAL/respuesta.json" | campo psicopatologias)" ] && echo si || echo no)"
detalle "$(cat "$TEMPORAL/respuesta.json" | campo resumen.visitas) consultas · $(cat "$TEMPORAL/respuesta.json" | campo resumen.examenes) examenes · $(cat "$TEMPORAL/respuesta.json" | campo resumen.medicamentosIndicados) medicamentos"

comprobar "costo de esa consulta, sumando consulta, laboratorio y farmacia (200)" "200" \
  "$(codigo GET "$GATEWAY/caja/api/v1/reportes/costo-por-visita?visitaId=$VISITA_ID" "$TOKEN_ADMINISTRACION")"
comprobar "la caja encontro los tres cargos de la consulta" "3" \
  "$(cat "$TEMPORAL/respuesta.json" | campo total)"
detalle "neto Q $(cat "$TEMPORAL/respuesta.json" | campo totales.montoNeto) · la fundacion descuenta Q $(cat "$TEMPORAL/respuesta.json" | campo totales.descuento)"
detalle "de ese total, la consulta en si aporta Q $(cat "$TEMPORAL/respuesta.json" | campo porCategoria.CONSULTA.montoNeto)"

comprobar "el aviso al familiar quedo asentado" "200" \
  "$(codigo GET "$GATEWAY/consultas/api/v1/correos?pacienteId=ASL-014" "$TOKEN_MEDICO")"
detalle "$(cat "$TEMPORAL/respuesta.json" | campo total) avisos · servidor de correo configurado: $(cat "$TEMPORAL/respuesta.json" | campo smtpConfigurado)"

# ---------------------------------------------------------------------------
titulo "18. La consulta cerrada no admite nada mas"
# ---------------------------------------------------------------------------
# La visita del paso 16 quedo CERRADA. Lo que sigue no es una restriccion de
# pantalla sino del servidor: una consulta firmada es un documento, y agregarle
# un examen despues cambiaria lo que el medico ya firmo.
comprobar "no se le puede agregar un examen (409)" "409" \
  "$(codigo POST "$GATEWAY/consultas/api/v1/visitas/$VISITA_ID/examenes" "$TOKEN_MEDICO" \
     '{"nombre":"Hemograma tardio","tarifa":"laboratorio-basico"}')"
detalle "$(cat "$TEMPORAL/respuesta.json" | campo error)"

comprobar "no se le puede agregar una receta (409)" "409" \
  "$(codigo POST "$GATEWAY/consultas/api/v1/visitas/$VISITA_ID/indicaciones" "$TOKEN_MEDICO" \
     '{"principioActivo":"paracetamol","nombre":"Paracetamol","dosisMg":500,"cadaHoras":8,"duracionDias":3}')"

comprobar "no se le puede cambiar la ficha (409)" "409" \
  "$(codigo PUT "$GATEWAY/consultas/api/v1/visitas/$VISITA_ID" "$TOKEN_MEDICO" \
     '{"motivoConsulta":"Otra cosa"}')"

comprobar "no se puede cerrar dos veces (409)" "409" \
  "$(codigo PUT "$GATEWAY/consultas/api/v1/visitas/$VISITA_ID/cerrar" "$TOKEN_MEDICO" \
     '{"diagnostico":"Otro","observaciones":"Otra"}')"

# ---------------------------------------------------------------------------
titulo "19. Los siete informes, cada uno con su rol y con el rol equivocado"
# ---------------------------------------------------------------------------
# El rango se abre de par en par: lo que se comprueba aqui es quien puede leer
# cada informe, no cuanto suma, que ya se comprueba en otras secciones.
DESDE=2000-01-01
HASTA="$(date +%Y)-12-31"

# informe <numero> <descripcion> <url> <token correcto> <token equivocado>
informe() {
  comprobar "informe $1 - $2 (200)" "200" "$(codigo GET "$3" "$4")"
  comprobar "informe $1 - con el rol equivocado (403)" "403" "$(codigo GET "$3" "$5")"
}

informe 1 "costos de cada cita" \
  "$GATEWAY/caja/api/v1/reportes/costo-por-visita?visitaId=$VISITA_ID" \
  "$TOKEN_ADMINISTRACION" "$TOKEN_MEDICO"

informe 2 "analisis medicos por paciente" \
  "$GATEWAY/consultas/api/v1/reportes/ficha?pacienteId=ASL-014" \
  "$TOKEN_MEDICO" "$TOKEN_ADMINISTRACION"

informe 3 "cobros por paciente" \
  "$GATEWAY/caja/api/v1/cargos?pacienteId=ASL-014&desde=$DESDE&hasta=$HASTA" \
  "$TOKEN_ADMINISTRACION" "$TOKEN_ENFERMERIA"

informe 4 "pagos realizados a la fundacion" \
  "$GATEWAY/caja/api/v1/reportes/pagos-fundacion?desde=$DESDE&hasta=$HASTA" \
  "$TOKEN_ADMINISTRACION" "$TOKEN_MEDICO"

informe 5 "entradas: donaciones y cobros" \
  "$GATEWAY/caja/api/v1/reportes/entradas?desde=$DESDE&hasta=$HASTA" \
  "$TOKEN_ADMINISTRACION" "$TOKEN_MEDICO"

informe 6 "examenes realizados por paciente" \
  "$GATEWAY/consultas/api/v1/reportes/examenes?pacienteId=ASL-014" \
  "$TOKEN_MEDICO" "$TOKEN_ADMINISTRACION"

informe 7 "medicamentos aplicados por paciente" \
  "$GATEWAY/pastillero/api/v1/pacientes/ASL-014/adherencia?desde=$DESDE&hasta=$HASTA" \
  "$TOKEN_ENFERMERIA" "$TOKEN_ADMINISTRACION"

# El septimo es el unico que enfermeria ve, y el medico lo ve tambien.
comprobar "el informe 7 tambien lo lee el medico (200)" "200" \
  "$(codigo GET "$GATEWAY/pastillero/api/v1/pacientes/ASL-014/adherencia?desde=$DESDE&hasta=$HASTA" "$TOKEN_MEDICO")"

# Los siete llevan sello del servidor: quien lo genero sale del token y no del
# navegador, por la misma razon que la bitacora.
SELLO=$(cuerpo GET "$GATEWAY/caja/api/v1/reportes/entradas?desde=$DESDE&hasta=$HASTA" "$TOKEN_ADMINISTRACION")
comprobar "el informe dice quien lo genero, desde el token" "Marta Solis" \
  "$(printf '%s' "$SELLO" | campo generadoPor)"
comprobar "y cuando se genero" "si" \
  "$([ -n "$(printf '%s' "$SELLO" | campo generadoEn)" ] && echo si || echo no)"

# ---------------------------------------------------------------------------
titulo "20. Padron de internos: alta, modificacion y parte clinica"
# ---------------------------------------------------------------------------
TOKEN_ADMINISTRADOR=$(entrar admin admin2026x)
comprobar "el administrador del padron obtiene token" "si" \
  "$([ -n "$TOKEN_ADMINISTRADOR" ] && echo si || echo no)"

# El documento lleva la hora de la corrida: es unico, y con eso esta seccion se
# puede repetir sin limpiar la base.
DOCUMENTO="PRUEBA-$(date +%Y%m%d%H%M%S)"
ALTA=$(cuerpo POST "$GATEWAY/pastillero/api/v1/internos" "$TOKEN_ADMINISTRADOR" "{
  \"nombre\":\"Candelaria Sacalxot Perez\",
  \"documento\":\"$DOCUMENTO\",
  \"fechaNacimiento\":\"1941-03-08\",
  \"sexo\":\"FEMENINO\",
  \"ingreso\":\"$(date +%F)\",
  \"motivoIngreso\":\"Prueba de humo del padron.\",
  \"pabellon\":\"Pabellon C\",\"cama\":\"7\",
  \"responsable\":\"Elena Sacalxot\",
  \"correoResponsable\":\"elena@example.com\"}")
NUEVO=$(printf '%s' "$ALTA" | campo pacienteId)
comprobar "el administrador da de alta a un interno" "si" \
  "$([ -n "$NUEVO" ] && echo si || echo no)"
comprobar "el interno nace ACTIVO" "ACTIVO" "$(printf '%s' "$ALTA" | campo estado)"
comprobar "la edad se calcula y viene en la ficha" "si" \
  "$([ -n "$(printf '%s' "$ALTA" | campo edad)" ] && echo si || echo no)"
detalle "$NUEVO - documento $DOCUMENTO - edad $(printf '%s' "$ALTA" | campo edad)"

comprobar "el mismo documento otra vez se rechaza (409)" "409" \
  "$(codigo POST "$GATEWAY/pastillero/api/v1/internos" "$TOKEN_ADMINISTRADOR" "{
     \"nombre\":\"Otra persona distinta\",
     \"documento\":\"$DOCUMENTO\",
     \"fechaNacimiento\":\"1950-01-01\",\"sexo\":\"MASCULINO\"}")"
detalle "$(cat "$TEMPORAL/respuesta.json" | campo error)"

comprobar "el medico NO puede dar de alta (403)" "403" \
  "$(codigo POST "$GATEWAY/pastillero/api/v1/internos" "$TOKEN_MEDICO" \
     '{"nombre":"Quien sea","documento":"NO-DEBE-ENTRAR","fechaNacimiento":"1950-01-01","sexo":"OTRO"}')"

MODIFICADO=$(cuerpo PUT "$GATEWAY/pastillero/api/v1/internos/$NUEVO" "$TOKEN_ADMINISTRADOR" '{
  "nombre":"Candelaria Sacalxot Perez",
  "pabellon":"Pabellon A","cama":"12",
  "responsable":"Elena Sacalxot de Lopez"}')
comprobar "el administrador cambia los datos administrativos" "Pabellon A, cama 12" \
  "$(printf '%s' "$MODIFICADO" | campo ubicacion)"
comprobar "y el documento no se toca al modificar" "$DOCUMENTO" \
  "$(printf '%s' "$MODIFICADO" | campo documento)"

# La parte clinica es del medico y no del administrador: con ella decide
# ms-vigia si un medicamento es seguro para este interno.
comprobar "el administrador NO escribe la parte clinica (403)" "403" \
  "$(codigo PUT "$GATEWAY/pastillero/api/v1/internos/$NUEVO/clinica" "$TOKEN_ADMINISTRADOR" \
     '{"alergias":["penicilina"]}')"

CLINICA=$(cuerpo PUT "$GATEWAY/pastillero/api/v1/internos/$NUEVO/clinica" "$TOKEN_MEDICO" '{
  "psicopatologias":["Depresion mayor"],
  "alergias":["penicilina"],
  "medicacionPermanente":[{"principioActivo":"warfarina","nombre":"Warfarina","dosisMg":5,"cadaHoras":24}]}')
comprobar "el medico si escribe la parte clinica" "penicilina" \
  "$(printf '%s' "$CLINICA" | campo alergias.0)"

# Y esa medicacion permanente pesa en los dictamenes igual que un plan activo.
comprobar "el ibuprofeno a este interno queda BLOQUEADO por la warfarina" "BLOQUEADO" \
  "$(cuerpo POST "$GATEWAY/vigia/api/v1/validaciones" "$TOKEN_MEDICO" "{
     \"pacienteId\":\"$NUEVO\",
     \"propuesta\":{\"principioActivo\":\"ibuprofeno\",\"dosisMg\":400,\"cadaHoras\":8,\"duracionDias\":3}}" \
     | campo veredicto)"

# ---------------------------------------------------------------------------
titulo "21. Cuota mensual: generarla dos veces no la cobra dos veces"
# ---------------------------------------------------------------------------
# Mes fijo y lejano a proposito: no se cruza con la cuota que trae el sembrado
# ni con la que alguien genere durante la demostracion.
MES_CUOTA=2030-06

PRIMERA=$(cuerpo POST "$GATEWAY/caja/api/v1/cuotas/generar" "$TOKEN_ADMINISTRACION" \
  "{\"mes\":\"$MES_CUOTA\"}")
ACTIVOS=$(printf '%s' "$PRIMERA" | campo internosActivos)
CREADAS=$(printf '%s' "$PRIMERA" | campo creadas)
EXISTIAN=$(printf '%s' "$PRIMERA" | campo yaExistian)
comprobar "a cada interno activo le toca su cuota" "$ACTIVOS" "$((CREADAS + EXISTIAN))"
comprobar "el interno recien dado de alta tambien entra" "si" \
  "$(printf '%s' "$PRIMERA" | grep -q "$NUEVO" && echo si || echo no)"
detalle "$ACTIVOS activos - $CREADAS creadas - $EXISTIAN ya existian - Q $(printf '%s' "$PRIMERA" | campo montoUnitario) cada una"

SEGUNDA=$(cuerpo POST "$GATEWAY/caja/api/v1/cuotas/generar" "$TOKEN_ADMINISTRACION" \
  "{\"mes\":\"$MES_CUOTA\"}")
comprobar "la segunda vez no crea ninguna" "0" "$(printf '%s' "$SEGUNDA" | campo creadas)"
comprobar "y reconoce las que ya estaban" "$ACTIVOS" "$(printf '%s' "$SEGUNDA" | campo yaExistian)"

# La prueba de fondo: en la cuenta de un interno hay UNA cuota de ese mes y no
# dos. Quien lo impide es el indice unico sobre (paciente_id, periodo_cuota).
#
# Se cuenta interno por interno y no en el total del mes a proposito: si una
# corrida anterior dejo internos egresados con su cuota, el total del mes es
# mayor que el numero de activos sin que nada este duplicado. Lo que importa no
# es cuantas cuotas hay, sino que ninguna familia tenga dos.
cuotas_de() {
  cuerpo GET "$GATEWAY/caja/api/v1/cargos?pacienteId=$1&desde=$DESDE&hasta=2099-12-31" \
    "$TOKEN_ADMINISTRACION" | grep -o "\"periodoCuota\":\"$MES_CUOTA\"" | wc -l | tr -d ' '
}
comprobar "el interno nuevo tiene una sola cuota del mes, no dos" "1" "$(cuotas_de "$NUEVO")"
comprobar "y un interno del sembrado, tambien una sola" "1" "$(cuotas_de ASL-014)"

comprobar "el mes mal escrito se rechaza (400)" "400" \
  "$(codigo POST "$GATEWAY/caja/api/v1/cuotas/generar" "$TOKEN_ADMINISTRACION" '{"mes":"junio"}')"
comprobar "el medico NO puede generar cuotas (403)" "403" \
  "$(codigo POST "$GATEWAY/caja/api/v1/cuotas/generar" "$TOKEN_MEDICO" "{\"mes\":\"$MES_CUOTA\"}")"

# El otro camino por el que nace una cuota es el cargo a mano. Tiene que pedir
# el mes igual que la generacion: sin el queda invisible para ella y la familia
# terminaria pagando la misma estadia dos veces.
comprobar "una cuota a mano sin el mes se rechaza (400)" "400" \
  "$(codigo POST "$GATEWAY/caja/api/v1/cargos" "$TOKEN_ADMINISTRACION" "{
     \"pacienteId\":\"$NUEVO\",\"categoria\":\"CUOTA\",
     \"concepto\":\"Cuota atrasada\",\"tarifa\":\"cuota-mensual\"}")"
detalle "$(cat "$TEMPORAL/respuesta.json" | campo detalles.0)"

comprobar "con el mes, la cuota a mano se registra (201)" "201" \
  "$(codigo POST "$GATEWAY/caja/api/v1/cargos" "$TOKEN_ADMINISTRACION" "{
     \"pacienteId\":\"$NUEVO\",\"categoria\":\"CUOTA\",\"mes\":\"2030-07\",
     \"concepto\":\"Cuota atrasada de 2030-07\",\"tarifa\":\"cuota-mensual\"}")"

comprobar "la misma cuota a mano otra vez se rechaza (409)" "409" \
  "$(codigo POST "$GATEWAY/caja/api/v1/cargos" "$TOKEN_ADMINISTRACION" "{
     \"pacienteId\":\"$NUEVO\",\"categoria\":\"CUOTA\",\"mes\":\"2030-07\",
     \"concepto\":\"Cuota atrasada de 2030-07, otra vez\",\"tarifa\":\"cuota-mensual\"}")"
detalle "$(cat "$TEMPORAL/respuesta.json" | campo error)"

# Y la generacion tampoco la vuelve a cobrar: ve la que se registro a mano.
comprobar "la generacion de ese mes respeta la cuota hecha a mano" "0" \
  "$(cuerpo POST "$GATEWAY/caja/api/v1/cuotas/generar" "$TOKEN_ADMINISTRACION" '{"mes":"2030-07"}' \
     | campo cargos | grep -o "$NUEVO" | wc -l | tr -d ' ')"

# ---------------------------------------------------------------------------
titulo "22. Egreso: sale del padron activo y conserva su historial"
# ---------------------------------------------------------------------------
comprobar "el medico NO puede egresar (403)" "403" \
  "$(codigo PUT "$GATEWAY/pastillero/api/v1/internos/$NUEVO/egreso" "$TOKEN_MEDICO" \
     "{\"fecha\":\"$(date +%F)\",\"motivo\":\"No deberia poder\"}")"

EGRESO=$(cuerpo PUT "$GATEWAY/pastillero/api/v1/internos/$NUEVO/egreso" "$TOKEN_ADMINISTRADOR" \
  "{\"fecha\":\"$(date +%F)\",\"motivo\":\"Traslado a casa de un familiar.\"}")
comprobar "el administrador egresa al interno" "EGRESADO" "$(printf '%s' "$EGRESO" | campo estado)"
# Irse debiendo no lo impide, pero que nadie lo diga seria peor: la cuenta
# sigue siendo exigible al familiar responsable.
comprobar "el egreso avisa de la deuda pendiente" "si" \
  "$([ -n "$(printf '%s' "$EGRESO" | campo advertencia)" ] && echo si || echo no)"
detalle "$(printf '%s' "$EGRESO" | campo advertencia)"

comprobar "ya no esta en el padron activo" "0" \
  "$(cuerpo GET "$GATEWAY/pastillero/api/v1/internos?estado=ACTIVO" "$TOKEN_ADMINISTRADOR" \
     | grep -o "\"$NUEVO\"" | wc -l | tr -d ' ')"
comprobar "pero si en el padron de egresados" "1" \
  "$(cuerpo GET "$GATEWAY/pastillero/api/v1/internos?estado=EGRESADO" "$TOKEN_ADMINISTRADOR" \
     | grep -o "\"$NUEVO\"" | wc -l | tr -d ' ')"

# Un interno NUNCA se borra: su ficha y su parte clinica siguen ahi.
FICHA_EGRESADA=$(cuerpo GET "$GATEWAY/pastillero/api/v1/internos/$NUEVO" "$TOKEN_MEDICO")
comprobar "su historial clinico sigue intacto" "penicilina" \
  "$(printf '%s' "$FICHA_EGRESADA" | campo alergias.0)"

comprobar "egresarlo dos veces se rechaza (409)" "409" \
  "$(codigo PUT "$GATEWAY/pastillero/api/v1/internos/$NUEVO/egreso" "$TOKEN_ADMINISTRADOR" \
     "{\"fecha\":\"$(date +%F)\",\"motivo\":\"Otra vez\"}")"

# Ya egresado, deja de entrar en la generacion de cuotas de los meses
# siguientes: no se le cobra la estadia a quien ya no esta.
comprobar "un egresado ya no entra en las cuotas del mes" "0" \
  "$(cuerpo POST "$GATEWAY/caja/api/v1/cuotas/generar" "$TOKEN_ADMINISTRACION" '{"mes":"2030-08"}' \
     | grep -o "$NUEVO" | wc -l | tr -d ' ')"


# ---------------------------------------------------------------------------
printf "\n%s== Resultado%s\n" "$CIAN" "$FIN"
if [ "$FALLIDAS" -eq 0 ]; then
  printf "%sTodo pasa: %s de %s pruebas.%s\n\n" "$VERDE" "$TOTAL" "$TOTAL" "$FIN"
  exit 0
fi
printf "%s%s de %s pruebas fallaron.%s\n\n" "$ROJO" "$FALLIDAS" "$TOTAL" "$FIN"
exit 1
