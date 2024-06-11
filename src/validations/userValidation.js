import Joi from 'joi';

const registerValidation = (data) => {
  const schema = Joi.object({
    id_usuario: Joi.number().required(),
    nombre: Joi.string().min(3).required(),
    apellido: Joi.string().min(3).required(),
    telefono: Joi.string().max(15).optional().allow(''),
    email: Joi.string().email().required(),
    rol: Joi.number().required(),
    contraseña: Joi.string().min(6).required(),
    socket_id: Joi.optional().allow(''),
    link_foto: Joi.string().optional().allow(''),
    department_id: Joi.number().required(),
    company_id: Joi.number().required()
  });
  return schema.validate(data, { abortEarly: false });
};



const loginValidation = (data) => {
  const schema = Joi.object({
    email: Joi.string().email().required(),
    contraseña: Joi.string().required()
  });
  return schema.validate(data);
};

export { registerValidation, loginValidation };
