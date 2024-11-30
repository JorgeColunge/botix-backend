import Joi from 'joi';

const newRegisterValidation = (data) => {
  const schema = Joi.object({
    id_usuario: Joi.number().required().messages({
      'any.required': 'El campo ID de usuario es obligatorio.',
      'number.base': 'El campo ID de usuario debe ser un número.'
    }),
    nombre: Joi.string().min(3).required().messages({
      'any.required': 'El campo nombre es obligatorio.',
      'string.min': 'El campo nombre debe tener al menos 3 caracteres.',
      'string.base': 'El campo nombre debe ser una cadena de texto.'
    }),
    apellido: Joi.string().min(3).required().messages({
      'any.required': 'El campo apellido es obligatorio.',
      'string.min': 'El campo apellido debe tener al menos 3 caracteres.',
      'string.base': 'El campo apellido debe ser una cadena de texto.'
    }),
    telefono: Joi.string().max(15).optional().allow('').messages({
      'string.max': 'El campo teléfono no debe exceder los 15 caracteres.',
      'string.base': 'El campo teléfono debe ser una cadena de texto.'
    }),
    email: Joi.string().email().required().messages({
      'any.required': 'El campo email de usuario es obligatorio.',
      'string.email': 'El campo email de usuario debe ser un correo electrónico válido.',
      'string.base': 'El campo email de usuario debe ser una cadena de texto.'
    }),
    rol: Joi.string().required().messages({
      'any.required': 'El campo rol es obligatorio.',
      'string.base': 'El campo rol debe ser una cadena de texto.'
    }),
    contraseña: Joi.string().min(6).required().messages({
      'any.required': 'El campo contraseña es obligatorio.',
      'string.min': 'El campo contraseña debe tener al menos 6 caracteres.',
      'string.base': 'El campo contraseña debe ser una cadena de texto.'
    }),
    link_de_la_foto: Joi.string().optional().allow('').messages({
      'string.base': 'El campo link_foto debe ser una cadena de texto.'
    }),
    empresa: Joi.object({
      name: Joi.string().min(3).required().messages({
        'any.required': 'El campo nombre de la empresa es obligatorio.',
        'string.min': 'El campo nombre de la empresa debe tener al menos 3 caracteres.',
        'string.base': 'El campo nombre de la empresa debe ser una cadena de texto.'
      }),
      document_type: Joi.string().required().messages({
        'any.required': 'El campo tipo de documento es obligatorio.',
        'string.base': 'El campo tipo de documento debe ser una cadena de texto.'
      }),
      document_number: Joi.string().required().messages({
        'any.required': 'El campo número de documento es obligatorio.',
        'string.base': 'El campo número de documento debe ser una cadena de texto.'
      }),
      address: Joi.string().required().messages({
        'any.required': 'El campo dirección es obligatorio.',
        'string.base': 'El campo dirección debe ser una cadena de texto.'
      }),
      city: Joi.string().required().messages({
        'any.required': 'El campo ciudad es obligatorio.',
        'string.base': 'El campo ciudad debe ser una cadena de texto.'
      }),
      country: Joi.string().required().messages({
        'any.required': 'El campo país es obligatorio.',
        'string.base': 'El campo país debe ser una cadena de texto.'
      }),
      postal_code: Joi.string().required().messages({
        'any.required': 'El campo código postal es obligatorio.',
        'string.base': 'El campo código postal debe ser una cadena de texto.'
      }),
      email: Joi.string().email().required().messages({
        'any.required': 'El campo email de la empresa es obligatorio.',
        'string.email': 'El campo email de la empresa debe ser un correo electrónico válido.',
        'string.base': 'El campo email de la empresa debe ser una cadena de texto.'
      }),
      phone: Joi.string().max(15).required().messages({
        'any.required': 'El campo teléfono de la empresa es obligatorio.',
        'string.max': 'El campo teléfono de la empresa no debe exceder los 15 caracteres.',
        'string.base': 'El campo teléfono de la empresa debe ser una cadena de texto.'
      }),
      logo: Joi.string().optional().allow('').messages({
        'string.base': 'El campo logo debe ser una cadena de texto.'
      })
    }).required().messages({
      'any.required': 'El campo empresa es obligatorio.'
    }),
    plan: Joi.object({
      type: Joi.string().required().messages({
        'any.required': 'El campo tipo de plan es obligatorio.',
        'string.base': 'El campo tipo de plan debe ser una cadena de texto.'
      }),
      contacts: Joi.number().required().messages({
        'any.required': 'El campo contactos es obligatorio.',
        'number.base': 'El campo contactos debe ser un número.'
      }),
      users: Joi.number().required().messages({
        'any.required': 'El campo usuarios es obligatorio.',
        'number.base': 'El campo usuarios debe ser un número.'
      }),
      ai_messages: Joi.number().required().messages({
        'any.required': 'El campo mensajes de IA es obligatorio.',
        'number.base': 'El campo mensajes de IA debe ser un número.'
      }),
      ai_analysis: Joi.number().required().messages({
        'any.required': 'El campo análisis de IA es obligatorio.',
        'number.base': 'El campo análisis de IA debe ser un número.'
      }),
      integrations: Joi.number().required().messages({
        'any.required': 'El campo integraciones es obligatorio.',
        'number.base': 'El campo integraciones debe ser un número.'
      }),
      automations: Joi.number().required().messages({
        'any.required': 'El campo automatizaciones es obligatorio.',
        'number.base': 'El campo automatizaciones debe ser un número.'
      }),
      bot_messages: Joi.number().required().messages({
        'any.required': 'El campo mensajes de bot es obligatorio.',
        'number.base': 'El campo mensajes de bot debe ser un número.'
      })
    }).required().unknown(false).messages({
      'any.required': 'El campo plan es obligatorio.',
      'object.unknown': 'El campo plan contiene propiedades no permitidas.'
    })
  });
  return schema.validate(data, { abortEarly: false });
};

const registerValidation = (data) => {
  const schema = Joi.object({
    id_usuario: Joi.number().required(),
    nombre: Joi.string().min(3).required(),
    apellido: Joi.string().min(3).required(),
    telefono: Joi.string().max(15).optional().allow(''),
    email: Joi.string().email().required(),
    rol: Joi.number().required(),
    contraseña: Joi.string().min(6).allow(''),
    socket_id: Joi.optional().allow(''),
    link_foto: Joi.string().optional().allow(''),
    department_id: Joi.number().allow(null),
    company_id: Joi.number().required(),
  });

  const result = schema.validate(data, { abortEarly: false });

  if (result.error) {
    // Log detallado para la consola
    console.error('Errores de validación:', result.error.details.map((e) => e.message));
  }

  return result;
};

const loginValidation = (data) => {
  const schema = Joi.object({
    email: Joi.string().email().required(),
    contraseña: Joi.string().required()
  });
  return schema.validate(data);
};

const botRegisterValidation = (data) => {
  const schema = Joi.object({
    id_usuario: Joi.number().required().messages({
      'any.required': 'El campo ID de usuario es obligatorio.',
      'number.base': 'El campo ID de usuario debe ser un número.'
    }),
    nombre: Joi.string().min(3).required().messages({
      'any.required': 'El campo nombre es obligatorio.',
      'string.min': 'El campo nombre debe tener al menos 3 caracteres.',
      'string.base': 'El campo nombre debe ser una cadena de texto.'
    }),
    apellido: Joi.string().min(3).required().messages({
      'any.required': 'El campo apellido es obligatorio.',
      'string.min': 'El campo apellido debe tener al menos 3 caracteres.',
      'string.base': 'El campo apellido debe ser una cadena de texto.'
    }),
    email: Joi.string().email({ tlds: { allow: false } }).required().messages({
      'any.required': 'El campo email de usuario es obligatorio.',
      'string.email': 'El campo email de usuario debe ser un correo electrónico válido.',
      'string.base': 'El campo email de usuario debe ser una cadena de texto.'
    }),
    contraseña: Joi.string().min(6).required().messages({
      'any.required': 'El campo contraseña es obligatorio.',
      'string.min': 'El campo contraseña debe tener al menos 6 caracteres.',
      'string.base': 'El campo contraseña debe ser una cadena de texto.'
    }),
    company_id: Joi.number().required().messages({
      'any.required': 'El campo company_id es obligatorio.',
      'number.base': 'El campo company_id debe ser un número.'
    }),
    department_id: Joi.number().allow(null).messages({
      'number.base': 'El campo department_id debe ser un número.'
    }),
    tipoBot: Joi.string().valid('Bot de Chat', 'Bot de Chat IA', 'Bot de Gestión').required().messages({
      'any.required': 'El campo tipo de bot es obligatorio.',
      'string.valid': 'El campo tipo de bot debe ser uno de los valores permitidos.'
    })
  });
  return schema.validate(data, { abortEarly: false });
};

export { newRegisterValidation, registerValidation, loginValidation, botRegisterValidation };
