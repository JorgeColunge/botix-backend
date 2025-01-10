import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import pool from '../config/dbConfig.js';
import { newRegisterValidation, registerValidation, botRegisterValidation } from '../validations/userValidation.js';
import { authorize } from '../middlewares/authorizationMiddleware.js';
import db from '../models/index.js';

const {User, Privilege, Type_user} = db;
// Función para registrar un nuevo usuario
export const register = [
  authorize(['ADMIN', 'SUPERADMIN'], ['USER_WRITE', 'CONFIG']),
  async (req, res) => {
  const { id_usuario, nombre, apellido, telefono, email, link_foto, rol, contraseña, empresa, plan } = req.body;

  // Validación de los datos de registro
  const { error } = newRegisterValidation(req.body);
  if (error) return res.status(400).send({error: error.details[0].message});

  try {
    // Verificar si la empresa ya existe
    const companyExists = await pool.query('SELECT * FROM companies WHERE document_number = $1;', [empresa.document_number]);
    if (companyExists.rows.length > 0) {
      return res.status(409).send('El número de documento de la empresa ya está registrado.');
    }

    // Crear la empresa si no existe
    const result = await pool.query(
      'INSERT INTO companies (name, document_type, document_number, address, city, country, postal_code, email, phone, logo) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id;',
      [empresa.name, empresa.document_type, empresa.document_number, empresa.address, empresa.city, empresa.country, empresa.postal_code, empresa.email, empresa.phone, empresa.logo]
    );
    const createdCompanyId = result.rows[0].id;

    // Crear una licencia con las características recibidas en el cuerpo de la solicitud
    await pool.query(
      'INSERT INTO licenses (type, contacts, users, ai_messages, ai_analysis, company_id, integrations, automations, bot_messages, state) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10);',
      [plan.type, plan.contacts, plan.users, plan.ai_messages, plan.ai_analysis, createdCompanyId, plan.integrations, plan.automations, plan.bot_messages, 'pendiente']
    );

    // Crear el rol con el nombre indicado por el usuario
    const roleResult = await pool.query(
      'INSERT INTO roles (name, company_id, type) VALUES ($1, $2, $3) RETURNING id;',
      [rol, createdCompanyId, 'Humano']
    );
    const createdRoleId = roleResult.rows[0].id;

    // Crear el privilegio "Admin" para el rol creado
    await pool.query(
      'INSERT INTO privileges_roles (name, role_id) VALUES ($1, $2);',
      ['Admin', createdRoleId]
    );

    // Verificar si el usuario ya existe
    const userExists = await pool.query('SELECT * FROM users WHERE id_usuario = $1;', [id_usuario]);
    if (userExists.rows.length > 0) {
      return res.status(409).send('El ID de usuario ya está registrado.');
    }

    // Encriptar la contraseña
    const salt = await bcrypt.genSalt(10);
    const contraseñaHash = await bcrypt.hash(contraseña, salt);

    // Crear el usuario con el rol creado
    await pool.query(
      'INSERT INTO users (id_usuario, nombre, apellido, telefono, email, link_foto, rol, contraseña, company_id, department_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10);',
      [id_usuario, nombre, apellido, telefono, email, link_foto, createdRoleId, contraseñaHash, createdCompanyId, null]
    );

    res.status(201).json({ message: "Usuario, empresa, licencia, rol y privilegio creados exitosamente", nombre });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error al registrar al usuario, la empresa, la licencia, el rol y el privilegio: ' + err.message);
  }
 }
];

// Función para iniciar sesión
export const login = async (req, res) => {
  const { email, contraseña } = req.body;

  try {
    // Buscar usuario por correo electrónico
    const userQuery = await pool.query('SELECT * FROM users WHERE email = $1;', [email]);
    if (userQuery.rows.length === 0) {
      return res.status(404).send('Usuario no encontrado');
    }

    const user = userQuery.rows[0]; // Mover la declaración de la variable 'user' aquí

    // Comparar contraseñas
    const validPassword = await bcrypt.compare(contraseña, user.contraseña);
    if (!validPassword) {
      return res.status(401).send('Contraseña incorrecta');
    }

    // Corregir el nombre de la tabla de Users_Privileges a UserPrivileges
    const privilegesQuery = `
      SELECT p.name 
      FROM public."Privileges" p
      JOIN public."UserPrivileges" up ON p.id = up."privilegeId"  -- Cambié privilege_id por privilegeId
      WHERE up."userId" = $1;  -- Cambié user_id por userId
    `;

      const roleQuery = `
        SELECT r.name 
        FROM public."role" r
        WHERE r.id = $1;
      `;
      const roleResult = await pool.query(roleQuery, [user.role_id]);
      if (roleResult.rows.length === 0) {
        return res.status(404).send('Rol no encontrado');
      }
      const roleName = roleResult.rows[0].name;
      
    const privilegesResult = await pool.query(privilegesQuery, [user.id_usuario]);
    const privileges = privilegesResult.rows.map(row => row.name);

    // Generar token JWT
    const token = jwt.sign(
      { id_usuario: user.id_usuario, email: user.email, rol: roleName, privileges },
      process.env.JWT_SECRET, // Asegúrate de tener esta variable en tu archivo .env
      { expiresIn: '1h' } // Configuración de expiración
    );

    // Excluir la contraseña antes de enviar al cliente
    const { contraseña: _, ...userWithoutPassword } = user;

    // Responder con éxito
    res.status(200).json({
      message: 'Inicio de sesión exitoso',
      token,
      user: {...userWithoutPassword, privileges},
    });
  } catch (err) {
    console.error('Error al iniciar sesión:', err);
    res.status(500).send('Error al iniciar sesión');
  }
};

// Función para editar usuario
export const edit = async (req, res) => {
  const { id } = req.params; // ID del usuario a editar
  const { nombre, apellido, telefono, email, link_foto, rol, department_id, Privileges } = req.body;

  try {
    // Buscar al usuario por su ID
    const user = await User.findOne({
      where: { id_usuario: id },
      include: [
        {
          model: Type_user, // Incluye Type_user
          as: 'Type_user',
        },
        {
          model: Privilege, // Incluye Privileges
          as: 'Privileges',
        },
      ],
    });

    if (!user) {
      return res.status(404).json({ message: 'Usuario no encontrado' });
    }

    // Actualizar los campos proporcionados
    user.nombre = nombre || user.nombre;
    user.apellido = apellido || user.apellido;
    user.telefono = telefono || user.telefono;
    user.email = email || user.email;
    user.link_foto = link_foto || user.link_foto;
    user.role = rol || user.role;
    user.department_id = department_id || user.department_id;

    // Guardar los cambios del usuario
    await user.save();

    // Actualizar los privilegios
    if (Privileges && Privileges.length > 0) {
      // Buscar los privilegios por sus IDs
      const privilegesToAdd = await Privilege.findAll({
        where: {
          id: Privileges,
        },
      });

      if (Privileges.length > 0) {
        // Establecer los nuevos privilegios (reemplaza los existentes)
        await user.setPrivileges(privilegesToAdd);
      }
    }

    // Recuperar el usuario actualizado con sus privilegios mapeados
    const updatedUser = await User.findOne({
      where: { id_usuario: user.id_usuario },
      attributes: { exclude: ['contraseña'] }, // Excluye la contraseña
      include: [
        {
          model: Type_user,
          as: 'Type_user',
        },
        {
          model: Privilege,
          as: 'Privileges',
        },
      ],
    });

    const usersWithMappedPrivilegesUp = {
      ...updatedUser.toJSON(),
      Privileges: updatedUser.Privileges.map(privilege => privilege.id),
    };

    res.json({
      message: 'Usuario actualizado exitosamente',
      user: usersWithMappedPrivilegesUp,
    });
  } catch (err) {
    console.error('Error al actualizar el usuario:', err);
    res.status(500).json({ message: 'Error al actualizar al usuario', error: err.message });
  }
};

export const registerUser = [
  authorize(['ADMIN', 'SUPERADMIN'], ['USER_WRITE', 'CONFIG']),
  async (req, res) => {
    const { nombre, apellido, telefono, email, link_foto, rol, contraseña, company_id, department_id, privileges } = req.body;

    // Validación de los datos de registro
    const { error } = registerValidation(req.body);

    if (error) {
      const errorMessages = error.details.map((e) => e.message); // Mapeamos todos los errores
      return res.status(400).json({
        message: 'Errores en los datos enviados',
        errors: errorMessages,
      });
    }

    try {
      // Encriptar la contraseña
      const salt = await bcrypt.genSalt(10);
      const contraseñaHash = await bcrypt.hash(contraseña, salt);

      // Buscar el type_user con el nombre "HUMANO"
      const humanoType = await Type_user.findOne({
        where: { name: 'HUMANO' }
      });

      if (!humanoType) {
        return res.status(400).json({
          message: 'Tipo de usuario "HUMANO" no encontrado',
        });
      }

      // Crear el usuario con el rol proporcionado y asignar el type_user_id como "HUMANO"
      const newUser = await User.create({
        nombre,
        apellido,
        telefono,
        email,
        link_foto,
        role: rol,
        contraseña: contraseñaHash,
        company_id,
        department_id,
        type_user_id: humanoType.id, // Asignamos el ID de "HUMANO"
      });

      // Verificar que los privilegios se hayan enviado
      if (privileges && privileges.length > 0) {
        // Buscar los privilegios por sus ids
        const privilegesToAdd = await Privilege.findAll({
          where: {
            id: privileges, // Filtramos los privilegios que coinciden con los IDs enviados
          },
        });

        if (privilegesToAdd.length > 0) {
          // Asociar los privilegios al usuario en la tabla intermedia 'UserPrivileges'
          await newUser.setPrivileges(privilegesToAdd); // Usamos Sequelize para establecer la relación
        }
      }
      const userWithType = await User.findOne({
        where: { id_usuario: newUser.id_usuario },
        attributes: { exclude: ['contraseña'] },
        include: [
          {
            model: Type_user, // Incluye Type_user
            as: 'Type_user',
          },
        ],
      });

      const usersWithMappedPrivilegesUp = {
        ...userWithType,
        Privileges: userWithType.Privileges.map(privilege => privilege.id),
      }

      res.status(201).json({
        message: 'Usuario creado exitosamente',
        user: usersWithMappedPrivilegesUp,
      });
    } catch (err) {
      console.error('Error al registrar usuario:', err);
      res.status(500).json({ message: 'Error al registrar al usuario', error: err.message });
    }
  },
];

// Función para registrar un bot
export const registerBot = [
  authorize(['ADMIN', 'SUPERADMIN'], ['BOT_WRITE', 'CONFIG']),
  async (req, res) => {
  const { id_usuario, nombre, apellido, telefono, email, link_foto, contraseña, company_id, department_id, tipoBot } = req.body;
  console.log(`Bot a registrar de tipo ${tipoBot}`);

  // Validación de los datos de registro
  const { error } = botRegisterValidation(req.body);
  if (error) return res.status(400).send({ error: error.details[0].message });

  try {
    // Verificar si el rol del tipo correspondiente ya existe para la empresa
    let roleResult = await pool.query('SELECT * FROM roles WHERE company_id = $1 AND type = $2;', [company_id, tipoBot]);

    // Si no existe, crear el rol
    if (roleResult.rows.length === 0) {
      roleResult = await pool.query(
        'INSERT INTO roles (name, company_id, type) VALUES ($1, $2, $3) RETURNING id;',
        [tipoBot, company_id, tipoBot]
      );
    }
    const roleId = roleResult.rows[0].id;

    // Encriptar la contraseña
    const salt = await bcrypt.genSalt(10);
    const contraseñaHash = await bcrypt.hash(contraseña, salt);

    // Registrar el bot como usuario en la tabla `users`
    const userResult = await pool.query(
      'INSERT INTO users (id_usuario, nombre, apellido, telefono, email, link_foto, rol, contraseña, company_id, department_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id_usuario;',
      [id_usuario, nombre, apellido, telefono, email, link_foto, roleId, contraseñaHash, company_id, department_id]
    );
    const botUserId = userResult.rows[0].id_usuario;

    // Registrar la información del bot en la tabla `bots`
    const botCode = `(async function(
        sendTextMessage, 
        sendImageMessage, 
        sendVideoMessage, 
        sendDocumentMessage, 
        sendAudioMessage, 
        sendTemplateMessage, 
        sendTemplateToSingleContact, 
        sendLocationMessage,
        io, 
        senderId, 
        messageData, 
        conversationId, 
        pool,
        axios,
        getContactInfo,
        updateContactName,
        createContact,
        updateContactCompany,
        updateConversationState,
        assignResponsibleUser,
        processMessage,
        getReverseGeocoding,
        getGeocoding,
        integrationDetails,
        externalData
      ) 


    )(sendTextMessage, sendImageMessage, sendVideoMessage, sendDocumentMessage, sendAudioMessage, sendTemplateMessage, sendTemplateToSingleContact, sendLocationMessage, io, senderId, messageData, conversationId, pool, axios, getContactInfo, updateContactName, createContact, updateContactCompany, updateConversationState, assignResponsibleUser, processMessage, getReverseGeocoding, getGeocoding, integrationDetails, externalData);`;

    await pool.query(
      'INSERT INTO bots (tipo_bot, id_usuario, codigo) VALUES ($1, $2, $3);',
      [tipoBot, botUserId, botCode]
    );

    res.status(201).json({ message: "Bot creado exitosamente", nombre });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error al registrar al bot: ' + err.message);
  }
 }
];