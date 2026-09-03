FARMACOS = {
    "ibuprofeno":      {"nombre": "Ibuprofeno",      "grupo": "AINE",            "dosis_max_dia_mg": 1200, "familias": ["aine"]},
    "naproxeno":       {"nombre": "Naproxeno",       "grupo": "AINE",            "dosis_max_dia_mg": 1000, "familias": ["aine"]},
    "acido_acetilsalicilico": {"nombre": "Acido acetilsalicilico", "grupo": "AINE", "dosis_max_dia_mg": 300, "familias": ["aine", "salicilatos"]},
    "paracetamol":     {"nombre": "Paracetamol",     "grupo": "ANALGESICO",      "dosis_max_dia_mg": 3000, "familias": []},
    "warfarina":       {"nombre": "Warfarina",       "grupo": "ANTICOAGULANTE",  "dosis_max_dia_mg": 10,   "familias": []},
    "enalapril":       {"nombre": "Enalapril",       "grupo": "IECA",            "dosis_max_dia_mg": 40,   "familias": []},
    "espironolactona": {"nombre": "Espironolactona", "grupo": "DIURETICO_AHORRADOR_K", "dosis_max_dia_mg": 100, "familias": []},
    "furosemida":      {"nombre": "Furosemida",      "grupo": "DIURETICO_ASA",   "dosis_max_dia_mg": 80,   "familias": ["sulfas"]},
    "digoxina":        {"nombre": "Digoxina",        "grupo": "DIGITALICO",      "dosis_max_dia_mg": 0.25, "familias": []},
    "metformina":      {"nombre": "Metformina",      "grupo": "BIGUANIDA",       "dosis_max_dia_mg": 2000, "familias": []},
    "clonazepam":      {"nombre": "Clonazepam",      "grupo": "BENZODIACEPINA",  "dosis_max_dia_mg": 2,    "familias": []},
    "diazepam":        {"nombre": "Diazepam",        "grupo": "BENZODIACEPINA",  "dosis_max_dia_mg": 10,   "familias": []},
    "lorazepam":       {"nombre": "Lorazepam",       "grupo": "BENZODIACEPINA",  "dosis_max_dia_mg": 3,    "familias": []},
    "haloperidol":     {"nombre": "Haloperidol",     "grupo": "ANTIPSICOTICO",   "dosis_max_dia_mg": 5,    "familias": []},
    "quetiapina":      {"nombre": "Quetiapina",      "grupo": "ANTIPSICOTICO",   "dosis_max_dia_mg": 300,  "familias": []},
    "risperidona":     {"nombre": "Risperidona",     "grupo": "ANTIPSICOTICO",   "dosis_max_dia_mg": 2,    "familias": []},
    "sertralina":      {"nombre": "Sertralina",      "grupo": "ISRS",            "dosis_max_dia_mg": 200,  "familias": []},
    "fluoxetina":      {"nombre": "Fluoxetina",      "grupo": "ISRS",            "dosis_max_dia_mg": 60,   "familias": []},
    "amitriptilina":   {"nombre": "Amitriptilina",   "grupo": "TRICICLICO",      "dosis_max_dia_mg": 75,   "familias": []},
    "tramadol":        {"nombre": "Tramadol",        "grupo": "OPIOIDE",         "dosis_max_dia_mg": 300,  "familias": []},
    "morfina":         {"nombre": "Morfina",         "grupo": "OPIOIDE",         "dosis_max_dia_mg": 60,   "familias": []},
    "difenhidramina":  {"nombre": "Difenhidramina",  "grupo": "ANTIHISTAMINICO_1G", "dosis_max_dia_mg": 50, "familias": []},
    "donepecilo":      {"nombre": "Donepecilo",      "grupo": "ANTIDEMENCIA",    "dosis_max_dia_mg": 10,   "familias": []},
    "omeprazol":       {"nombre": "Omeprazol",       "grupo": "IBP",             "dosis_max_dia_mg": 40,   "familias": []},
    "atorvastatina":   {"nombre": "Atorvastatina",   "grupo": "ESTATINA",        "dosis_max_dia_mg": 80,   "familias": []},
    "levotiroxina":    {"nombre": "Levotiroxina",    "grupo": "HORMONA_TIROIDEA","dosis_max_dia_mg": 0.2,  "familias": []},
    "amoxicilina":     {"nombre": "Amoxicilina",     "grupo": "BETALACTAMICO",   "dosis_max_dia_mg": 3000, "familias": ["penicilina"]},
    "ciprofloxacino":  {"nombre": "Ciprofloxacino",  "grupo": "QUINOLONA",       "dosis_max_dia_mg": 1000, "familias": []},
}

GRUPOS_ANTICOLINERGICOS = {"ANTIHISTAMINICO_1G", "TRICICLICO"}


INTERACCIONES = [
    ("warfarina", "ibuprofeno", "CRITICA",
     "Riesgo alto de hemorragia digestiva por desplazamiento de union a proteinas.",
     "Sustituir el AINE por paracetamol y controlar INR."),
    ("warfarina", "naproxeno", "CRITICA",
     "Riesgo alto de hemorragia digestiva.",
     "Sustituir el AINE por paracetamol y controlar INR."),
    ("warfarina", "acido_acetilsalicilico", "CRITICA",
     "Doble efecto antiagregante y anticoagulante.",
     "Requiere indicacion cardiologica expresa y control de INR semanal."),
    ("warfarina", "ciprofloxacino", "ALTA",
     "El antibiotico eleva el INR y potencia el efecto anticoagulante.",
     "Solicitar INR a las 72 horas de iniciado el antibiotico."),
    ("tramadol", "sertralina", "CRITICA",
     "Riesgo de sindrome serotoninergico.",
     "Preferir analgesico no opioide o cambiar el antidepresivo."),
    ("tramadol", "fluoxetina", "CRITICA",
     "Riesgo de sindrome serotoninergico.",
     "Preferir analgesico no opioide o cambiar el antidepresivo."),
    ("morfina", "clonazepam", "CRITICA",
     "Depresion respiratoria y sedacion profunda por sinergia.",
     "Evitar la combinacion; si es inevitable, monitoreo de saturacion por turno."),
    ("morfina", "diazepam", "CRITICA",
     "Depresion respiratoria y sedacion profunda por sinergia.",
     "Evitar la combinacion; si es inevitable, monitoreo de saturacion por turno."),
    ("tramadol", "diazepam", "ALTA",
     "Sedacion aditiva y aumento del riesgo de caidas.",
     "Reducir dosis de la benzodiacepina y vigilar estado de alerta."),
    ("enalapril", "espironolactona", "ALTA",
     "Hiperpotasemia por doble retencion de potasio.",
     "Control de potasio serico y creatinina cada 15 dias."),
    ("digoxina", "furosemida", "ALTA",
     "La hipokalemia inducida por el diuretico favorece la toxicidad digitalica.",
     "Vigilar potasio y signos de intoxicacion (nauseas, bradicardia, vision borrosa)."),
    ("haloperidol", "quetiapina", "ALTA",
     "Prolongacion aditiva del intervalo QT y sedacion excesiva.",
     "Mantener un solo antipsicotico; solicitar electrocardiograma."),
    ("haloperidol", "risperidona", "ALTA",
     "Prolongacion aditiva del intervalo QT y riesgo extrapiramidal.",
     "Mantener un solo antipsicotico."),
    ("sertralina", "acido_acetilsalicilico", "ALTA",
     "Aumento del riesgo de sangrado digestivo.",
     "Valorar proteccion gastrica con inhibidor de bomba."),
    ("sertralina", "ibuprofeno", "ALTA",
     "Aumento del riesgo de sangrado digestivo.",
     "Valorar proteccion gastrica con inhibidor de bomba."),
    ("amitriptilina", "difenhidramina", "ALTA",
     "Carga anticolinergica sumada: confusion, retencion urinaria y estrenimiento.",
     "Retirar uno de los dos farmacos."),
    ("levotiroxina", "omeprazol", "MEDIA",
     "El inhibidor de bomba reduce la absorcion de la hormona tiroidea.",
     "Separar la administracion al menos 4 horas."),
    ("metformina", "furosemida", "MEDIA",
     "Riesgo de deterioro de la funcion renal y acumulacion de metformina.",
     "Control de creatinina cada mes."),
]


SINONIMOS_ALERGIA = {
    "penicilina": "penicilina",
    "penicilinas": "penicilina",
    "amoxicilina": "penicilina",
    "betalactamicos": "penicilina",
    "sulfa": "sulfas",
    "sulfas": "sulfas",
    "aines": "aine",
    "aine": "aine",
    "aspirina": "salicilatos",
    "salicilatos": "salicilatos",
}


PUNTAJE = {"CRITICA": 40, "ALTA": 20, "MEDIA": 8, "INFORMATIVA": 2}


def buscar_interaccion(a, b):
    """Devuelve la interaccion entre dos principios activos, si existe."""
    for f1, f2, severidad, efecto, recomendacion in INTERACCIONES:
        if {f1, f2} == {a, b}:
            return {
                "severidad": severidad,
                "efecto": efecto,
                "recomendacion": recomendacion,
            }
    return None


def normalizar_alergia(texto):
    """Convierte lo declarado por el familiar en una familia alergenica."""
    clave = (texto or "").strip().lower()
    return SINONIMOS_ALERGIA.get(clave, clave)
