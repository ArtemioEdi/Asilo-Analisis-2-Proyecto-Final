"""Validacion de las entradas y errores internos en JSON.

El mismo archivo vive en los cuatro servicios de Python (ms-vigia,
ms-pastillero, ms-caja y ms-consultas), copiado a proposito: cada
microservicio es su propia imagen y no comparten bibliotecas. Si se cambia
uno, se cambian los cuatro.

Lo que resuelve (P02, P03, P06 y P07 del SQA): un dato con el tipo
equivocado o mas largo que su columna terminaba en un 500 de MySQL o de
Python, en vez de un 400 que le dijera al cliente que corregir. Ahora:

  - texto() rechaza lo que no sea cadena y lo que pase del largo de su
    columna en sql/. Las columnas TEXT se miden en bytes UTF-8, que es como
    las mide MySQL (65535); las VARCHAR, en caracteres.
  - finito() rechaza NaN e Infinity, que Python acepta como float y que
    pasaban todas las comparaciones (NaN <= 0 es falso) hasta reventar en la
    base.
  - Un 500 se responde en JSON y se registra con la ruta y el tipo de la
    excepcion: ni el cuerpo de la peticion ni el mensaje, que puede llevar
    datos del interno.
"""
import logging
import math

from flask import jsonify, request
from werkzeug.exceptions import InternalServerError, RequestEntityTooLarge

# Largo de una columna TEXT de MySQL, en bytes.
TEXTO = 65535

# Un cuerpo de mas de 1 MB no es una peticion de este sistema. Sin tope, una
# lista enorme en una columna JSON terminaba en un error de MySQL.
TAMANO_MAXIMO = 1024 * 1024


class EntradaInvalida(ValueError):
    """Un dato del cuerpo no sirve. El servicio responde 400 con el mensaje.

    Hereda de ValueError a proposito: los endpoints que ya convertian numeros
    dentro de un try/except ValueError siguen dando su propio mensaje.
    """


def cuerpo_json(req=None):
    """El cuerpo como objeto. Vacio si no vino nada; 400 si no es un objeto."""
    cuerpo = (req or request).get_json(silent=True)
    if cuerpo is None:
        return {}
    if not isinstance(cuerpo, dict):
        raise EntradaInvalida("El cuerpo de la peticion debe ser un objeto JSON.")
    return cuerpo


def texto(valor, campo, maximo):
    """Devuelve el valor si es texto y cabe en su columna. None pasa tal cual:
    lo obligatorio lo decide cada endpoint. Con maximo None solo se revisa el
    tipo: es para lo que no se guarda en una columna de texto (una fecha que
    se convierte, una clave que se busca en una lista)."""
    if valor is None:
        return None
    if not isinstance(valor, str):
        raise EntradaInvalida("%s debe ser texto." % campo)
    if maximo is None:
        return valor
    if maximo == TEXTO:
        if len(valor.encode("utf-8")) > TEXTO:
            raise EntradaInvalida("%s es demasiado largo (maximo %d bytes)." % (campo, TEXTO))
    elif len(valor) > maximo:
        raise EntradaInvalida("%s no puede pasar de %d caracteres." % (campo, maximo))
    return valor


def textos(cuerpo, largos):
    """Revisa de una vez los campos de texto de un cuerpo: {campo: largo}."""
    for campo, maximo in largos.items():
        texto(cuerpo.get(campo), campo, maximo)


def finito(valor):
    """float que no sea NaN ni Infinity. Los booleanos tampoco son numeros."""
    if isinstance(valor, bool):
        raise EntradaInvalida("Se esperaba un numero.")
    numero = float(valor)
    if not math.isfinite(numero):
        raise EntradaInvalida("Se esperaba un numero finito.")
    return numero


def entero(valor):
    """int a partir de un numero finito."""
    return int(finito(valor))


def instalar(app, servicio):
    """Registra en la app el 400 de las entradas, el 413 y el 500 en JSON."""
    app.config["MAX_CONTENT_LENGTH"] = TAMANO_MAXIMO
    logging.basicConfig(level=logging.INFO,
                        format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    registro = logging.getLogger(servicio)

    def registrar_excepcion(exc_info):
        # Flask registraria la traza completa con el mensaje de la
        # excepcion, que puede traer valores de la peticion. Aqui va solo
        # que ruta fallo y con que tipo de error.
        registro.error("Error interno en %s %s: %s",
                       request.method, request.path, exc_info[0].__name__)

    app.log_exception = registrar_excepcion

    @app.errorhandler(EntradaInvalida)
    def entrada_invalida(error):
        return jsonify({"error": "Peticion invalida", "detalles": [str(error)]}), 400

    @app.errorhandler(RequestEntityTooLarge)
    def demasiado_grande(_):
        return jsonify({"error": "La peticion es demasiado grande."}), 413

    @app.errorhandler(InternalServerError)
    def error_interno(_):
        return jsonify({"error": "Error interno del servicio."}), 500
