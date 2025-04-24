import express from 'express';
import axios from 'axios';
import pool from '../config/dbConfig.js';
import { processMessage } from '../handlers/messageHandler.js';
import { sendTextMessage, sendImageMessage, sendVideoMessage, sendDocumentMessage, sendAudioMessage, sendTemplateMessage, sendTemplateToSingleContact, sendReactMessage } from '../handlers/repliesHandler.js';
import multer from 'multer';
import csv from 'csv-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import fs from 'fs';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import ffprobeInstaller from '@ffprobe-installer/ffprobe';
import moment from 'moment-timezone';
import ffmpeg from 'fluent-ffmpeg';
import { authorize } from '../middlewares/authorizationMiddleware.js';
import db from '../models/index.js';
import jwt from 'jsonwebtoken';
import { Sequelize } from 'sequelize';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const { User, Type_user, Privilege, Role } = db;
// Configurar ffmpeg y ffprobe
ffmpeg.setFfmpegPath(ffmpegInstaller.path);
ffmpeg.setFfprobePath(ffprobeInstaller.path);

// Definimos la función que acepta 'io' como parámetro y devuelve el router configurado
export default function createRouter(io) {
const router = express.Router();


router.post('/new-message', 
  authorize(['ADMIN', 'SUPERADMIN'], ['READ_USERS_CONTACTS']),
  async (req, res) => {
  const { senderId, messageData } = req.body;
  try {
    await processMessage(io, senderId, messageData, null);
    io.emit('new-message', { senderId, messageData }); // El servidor emite el evento
    console.log('Emitido yeees')
    res.status(200).send('Mensaje recibido y emitido');
  } catch (error) {
    console.error('Error processing message:', error);
    res.status(500).send('Hubo un error al procesar el mensaje');
  }
});
 
router.post('/reset-unread/:conversationId', 
  authorize(['ADMIN', 'SUPERADMIN'], ['CONTACT_UPDATE', 'CONTACT_WRITE', 'READ_USERS_CONTACTS', 'CONFIG', 'USER_WRITE', 'USER_UPDATE', 'USER_DELETE']),
  async (req, res) => {
  const { conversationId } = req.params;
  try {
      const resetUnread = `UPDATE conversations SET unread_messages = 0 WHERE conversation_id = $1`;
      await pool.query(resetUnread, [conversationId]);
      res.send('Unread messages counter reset successfully.');
  } catch (error) {
      console.error('Error resetting unread messages:', error);
      res.status(500).send('Internal Server Error');
  }
});

router.get('/conversations/:conversationId', 
  authorize(['ADMIN', 'SUPERADMIN'], ['READ_USERS_CONTACTS', 'USER_WRITE', 'USER_UPDATE', 'USER_DELETE', 'CONTACT_WRITE', 'CONTACT_UPDATE', 'CONTACT_DELETE']),
  async (req, res) => {
  const { conversationId } = req.params;
  console.log(`Solicitud de conversación con id ${conversationId}`);
  try {
    const query = `
    SELECT
      c.conversation_id,
      c.contact_id,
      c.state,
      c.last_update,
      c.unread_messages,
      c.id_usuario,
      c.integration_id,
      c.contact_user_id,
      ct.id,
      ct.phone_number,
      ct.first_name,
      ct.last_name,
      ct.organization,
      ct.profile_url,
      ct.label,
      ct.edad_approx,
      ct.fecha_nacimiento,
      ct.nacionalidad,
      ct.ciudad_residencia,
      ct.direccion_completa,
      ct.email,
      ct.genero,
      ct.orientacion_sexual,
      ct.pagina_web,
      ct.link_instagram,
      ct.link_facebook,
      ct.link_linkedin,
      ct.link_twitter,
      ct.link_tiktok,
      ct.link_youtube,
      ct.nivel_ingresos,
      ct.ocupacion,
      ct.nivel_educativo,
      ct.estado_civil,
      ct.cantidad_hijos,
      ct.estilo_de_vida,
      ct.personalidad,
      ct.cultura,
      ct.preferencias_contacto,
      ct.historial_compras,
      ct.historial_interacciones,
      ct.observaciones_agente,
      ct.fecha_creacion_cliente,
      u.nombre as responsable_nombre,
      u.apellido as responsable_apellido,
      dp.id as phase_id,
      dp.name as phase_name,
      dp.color as phase_color,
      last_message_info.last_message,
      last_message_info.last_message_time,
      last_message_info.message_type,
      last_message_info.duration
    FROM 
      conversations c
    LEFT JOIN users u ON c.id_usuario = u.id_usuario
    LEFT JOIN contacts ct ON c.contact_id = ct.id
    LEFT JOIN department_phases dp ON ct.label = dp.id
    LEFT JOIN LATERAL (
    SELECT
      sub.last_message,
      sub.last_message_time,
      sub.message_type,
      sub.duration
    FROM (
      SELECT
        message_text AS last_message,
        received_at AS last_message_time,
        message_type,
        duration
      FROM messages
      WHERE conversation_fk = c.conversation_id
      UNION
      SELECT
        reply_text AS last_message,
        created_at AS last_message_time,
        reply_type AS message_type,
        duration
      FROM replies
      WHERE conversation_fk = c.conversation_id
    ) sub
    ORDER BY sub.last_message_time DESC
    LIMIT 1
     ) last_message_info ON true

    WHERE c.conversation_id = $1;
    `;
    const { rows } = await pool.query(query, [conversationId]);
    if (rows.length > 0) {
      res.json(rows[0]);
    } else {
      res.status(404).send('Conversation not found');
    }
  } catch (err) {
    console.error('Error fetching conversation details:', err);
    res.status(500).send('Internal Server Error');
  }
});

router.get('/conversations',
  authorize(['ADMIN', 'SUPERADMIN'], ['READ_USERS_CONTACTS', 'CONFIG', 'USER_WRITE', 'USER_UPDATE', 'USER_DELETE', 'CONTACT_WRITE', 'CONTACT_UPDATE', 'CONTACT_DELETE']),
  async (req, res) => {
    const userId = req.query.id_usuario;
    const userRole = req.query.rol;
    const companyId = req.query.company_id;

    try {
      // Obtener la integración de tipo "Interno"
      const integrationResult = await pool.query('SELECT id FROM integrations WHERE type = $1 LIMIT 1', ['Interno']);
      const integration = integrationResult.rows[0];

      if (!integration) {
        return res.status(400).json({ error: "No se encontró la integración de tipo 'Interno'" });
      }

      const integrationId = integration.id;

      // Función para obtener el nombre del rol
      const getUserRole = async (roleId) => {
        const { rows } = await pool.query('SELECT name FROM role WHERE id = $1', [roleId]);
        return rows.length > 0 ? rows[0].name : null;
      };

      const privileges = await getUserRole(userRole);
      console.log("Este es el privilegio:", privileges);

      let query = `
        SELECT
          c.conversation_id,
          c.contact_id,
          c.phone_number,
          c.state,
          c.last_update,
          c.unread_messages,
          c.id_usuario,
          c.integration_id,
          c.contact_user_id,
          ct.*,
          u.nombre as responsable_nombre,
          u.apellido as responsable_apellido,
          last_message_info.last_message,
          last_message_info.last_message_time,
          last_message_info.message_type,
          last_message_info.duration
        FROM conversations c
        LEFT JOIN users u ON c.id_usuario = u.id_usuario
        LEFT JOIN contacts ct ON c.contact_id = ct.id
        LEFT JOIN LATERAL (
          SELECT
            sub.last_message,
            sub.last_message_time,
            sub.message_type,
            sub.duration
          FROM (
            SELECT
              message_text AS last_message,
              received_at AS last_message_time,
              message_type,
              duration
            FROM messages
            WHERE conversation_fk = c.conversation_id
            UNION
            SELECT
              reply_text AS last_message,
              created_at AS last_message_time,
              reply_type AS message_type,
              duration
            FROM replies
            WHERE conversation_fk = c.conversation_id
          ) sub
          ORDER BY sub.last_message_time DESC
          LIMIT 1
        ) last_message_info ON true
      `;

      // Aplicar filtro por integración para TODOS los roles
      query += `
        WHERE (
          (c.integration_id = $1 AND (c.id_usuario = $2 OR c.contact_user_id = $2))
        ) OR (
          (c.integration_id != $1)
        )
      `;

      console.log("datos imporntaes", integrationId, userId, companyId)
      const queryParams = [integrationId, userId];

      // Filtrar por compañía si es ADMIN
      if (privileges === "ADMIN") {
        query += ` AND u.company_id = $3`;
        queryParams.push(companyId);
      }
      if (privileges === "REGULAR") {
        query += ` AND u.company_id = $3 AND c.id_usuario = $4`;
        queryParams.push(companyId, userId);
      }
      const { rows } = await pool.query(query, queryParams);
      res.json(rows);

    } catch (error) {
      console.error('Error fetching conversations:', error);
      res.status(500).send('Internal Server Error');
    }
  }
);

router.get('/privileges-role/:roleId', async (req, res) => {
  const { roleId } = req.params;
  try {
    const query = `
      SELECT *
      FROM privileges_roles 
      WHERE role_id = $1
    `;
    const result = await pool.query(query, [roleId]);
    console.log('Fetched privileges:', result.rows.map(row => row.name)); // Log de los privilegios obtenidos
    res.json(result.rows.map(row => row.name));
  } catch (error) {
    console.error('Error fetching privileges:', error);
    res.status(500).send('Internal Server Error');
  }
});

router.get("/privileges-all", 
  authorize(['ADMIN', 'SUPERADMIN'], ["ADMIN_ROLES", 'CONFIG']),
  async (req, res) => {
    
    try {
      // Usamos Sequelize para obtener todos los privilegios
      const privileges = await Privilege.findAll();

      // Convertir los resultados en formato JSON
      res.json(privileges);
    } catch (error) {
      console.error('Error fetching privileges:', error);
      res.status(500).send('Internal Server Error');
    }
  });

router.get('/messages/:id', 
  authorize(['ADMIN', 'SUPERADMIN'], ['READ_USERS_CONTACTS', 'USER_WRITE', 'USER_UPDATE', 'USER_DELETE', 'CONTACT_WRITE', 'CONTACT_UPDATE', 'CONTACT_DELETE']),
  async (req, res) => {
  const { id } = req.params;
  const { offset = 0 } = req.query; // offset indica desde qué mensaje empezar

  const query = `
    SELECT * FROM (
      SELECT 
        'message' as type, 
        id, 
        sender_id, 
        conversation_fk, 
        message_text as text, 
        message_media_url as media_url,
        file_name, 
        thumbnail_url,
        duration,
        latitude, 
        longitude, 
        received_at as timestamp,
        message_type,
        NULL as reply_header,
        NULL as reply_button,
        NULL as reply_type_header,
        reply_from,
        NULL as footer,
        NULL as state,
        reaction
      FROM messages
      WHERE conversation_fk = $1
      UNION ALL
      SELECT 
        'reply' as type, 
        replies_id as id, 
        sender_id, 
        conversation_fk, 
        reply_text as text, 
        reply_media_url as media_url, 
        file_name,
        thumbnail_url,
        duration,
        latitude, 
        longitude, 
        created_at as timestamp,
        reply_type as message_type,
        reply_header,
        reply_button,
        reply_type_header,
        reply_from,
        footer,
        state,
        reaction
      FROM replies
      WHERE conversation_fk = $1
    ) AS combined
    ORDER BY timestamp DESC
    OFFSET $2
    LIMIT 50;
  `;

  try {
    const result = await pool.query(query, [id, offset]);
    const messagesWithMedia = result.rows.map(row => {
      let parsedReplyButton = null;
      try {
        console.log('Raw reply_button:', row?.reply_button);
    
        // Verifica si el valor de reply_button es un JSON válido
        parsedReplyButton = (typeof row?.reply_button === 'string' && row.reply_button.startsWith('[')) ? JSON.parse(row.reply_button) : row.reply_button;
      } catch (e) {
        console.error('Error parsing reply_button:', e);
        console.error('Problematic reply_button value:', row?.reply_button);
    
        // Devuelve el valor original de reply_button en caso de error
        parsedReplyButton = row?.reply_button;
      }
    
      return {
        ...row,
        reply_button: parsedReplyButton,
        url: getMediaUrl(row.message_type, row.media_url, row.latitude, row.longitude),
        thumbnail_url: getThumbnailUrl(row.message_type, row.thumbnail_url)
      };
    });    
    
    res.json(messagesWithMedia);
  } catch (err) {
    console.error('Error fetching messages:', err);
    res.status(500).send('Internal Server Error');
  }
  
});

function getMediaUrl(type, mediaUrl, latitude, longitude) {
  if (!mediaUrl) return null; // Manejar mediaUrl nulo o indefinido
  const host = process.env.BACKEND_URL || 'https://botix.axiomarobotics.com:10000'; 
  switch (type) {
    case 'image':
    case 'audio':
    case 'video':
    case 'document':
    case 'sticker':
      return `${host}${mediaUrl}`; 
    case 'location':
      return `https://maps.google.com/?q=${latitude},${longitude}`; 
    default:
      return null; 
  }}

function getThumbnailUrl(type, thumbnailUrl) {
  if (!thumbnailUrl) return null; // Manejar thumbnailUrl nulo o indefinido
  const host = process.env.BACKEND_URL || 'https://botix.axiomarobotics.com:10000';
  switch (type) {
    case 'image':
    case 'audio':
    case 'video':
    case 'sticker':
      return `${host}${thumbnailUrl}`; 
    default:
      return null; 
  }
}

router.get('/contacts/:phoneNumber', 
  authorize(['ADMIN', 'SUPERADMIN'], ['READ_USERS_CONTACTS', 'CONTACT_WRITE', 'CONTACT_UPDATE']),
  async (req, res) => {
  const { phoneNumber } = req.params;
  try {
    const contactResult = await pool.query('SELECT * FROM contacts WHERE phone_number = $1', [phoneNumber]);
    if (contactResult.rows.length > 0) {
      res.json(contactResult.rows[0]);
    } else {
      res.status(404).send('Contact not found');
    }
  } catch (err) {
    console.error('Error fetching contact:', err);
    res.status(500).send('Internal Server Error');
  }
});

router.delete('/contacts/:id', 
  authorize(['ADMIN', 'SUPERADMIN'], ['READ_USERS_CONTACTS', 'CONTACT_WRITE', 'CONTACT_UPDATE']),
  async (req, res) => {
    const { id } = req.params;

    try {
      // Iniciar una transacción para garantizar consistencia
      await pool.query('BEGIN');

      // Eliminar las relaciones del contacto en campaign_contacts
      await pool.query('DELETE FROM campaign_contacts WHERE contact_id = $1', [id]);

      // Eliminar el contacto de la tabla contacts
      const deleteResult = await pool.query('DELETE FROM contacts WHERE id = $1 RETURNING *', [id]);

      if (deleteResult.rowCount > 0) {
        // Confirmar la transacción
        await pool.query('COMMIT');
        res.json({ message: 'Contact deleted successfully', deletedContact: deleteResult.rows[0] });
      } else {
        // Revertir la transacción en caso de que el contacto no exista
        await pool.query('ROLLBACK');
        res.status(404).send('Contact not found');
      }
    } catch (err) {
      // Revertir la transacción en caso de error
      await pool.query('ROLLBACK');
      console.error('Error deleting contact:', err);
      res.status(500).send('Internal Server Error');
    }
  }
);

// Ruta para actualizar los datos de contacto
router.put('/contacts/:id', 
  authorize(['ADMIN', 'SUPERADMIN'], ['CONTACT_UPDATE', 'CONFIG']),
  async (req, res) => {
    const { id } = req.params;
    const {
      first_name,
      last_name,
      phone_number,
      organization,
      label,
      email,
      direccion_completa,
      ciudad_residencia,
      nacionalidad
    } = req.body;

    try {
      // Actualizar el contacto y devolver los datos actualizados
      const updateResult = await pool.query(
        `UPDATE contacts 
         SET first_name = $1, 
             last_name = $2, 
             phone_number = $3, 
             organization = $4, 
             label = $5, 
             email = $6, 
             direccion_completa = $7, 
             ciudad_residencia = $8, 
             nacionalidad = $9
         WHERE id = $10
         RETURNING *`,
        [
          first_name,
          last_name,
          phone_number,
          organization,
          label,
          email,
          direccion_completa,
          ciudad_residencia,
          nacionalidad,
          id
        ]
      );

      if (updateResult.rowCount > 0) {
        res.json(updateResult.rows[0]); // Devuelve todos los datos del contacto actualizado
      } else {
        res.status(404).send('Contact not found');
      }
    } catch (err) {
      console.error('Error updating contact:', err);
      res.status(500).send('Internal Server Error');
    }
  }
);

router.get(
  '/users',
  authorize(
    ['ADMIN', 'SUPERADMIN'],
    ['USER_UPDATE', 'USER_WRITE', 'READ_USERS_CONTACTS', 'CONFIG']
  ),
  async (req, res) => {
    const { company_id } = req.query;
    const token = req.headers['x-token'];

    if (!token) {
      return res.status(401).send('No se proporcionó un token');
    }

    try {
      const users = await User.findAll({
        where: { company_id }, // Filtra por company_id
        attributes: { exclude: ['contraseña'] }, // Excluye el atributo contraseña
        include: [
          {
            model: Type_user, // Incluye Type_user
            as: 'Type_user', // Alias definido en la asociación
          },
          {
            model: Privilege, // Incluye los privilegios
            as: 'Privileges', // Alias definido en la asociación
            through: { attributes: [] }, // Excluye la tabla intermedia
            attributes: ['id'], // Selecciona solo el ID del privilegio
          },
        ],
      });

      // Mapear los privilegios para devolver un array de IDs
      const usersWithMappedPrivileges = users.map(user => ({
        ...user.toJSON(),
        Privileges: user.Privileges.map(privilege => privilege.id), // Extraer solo los IDs
      }));

      res.json(usersWithMappedPrivileges);
    } catch (error) {
      console.error('Error fetching users:', error);
      res.status(500).send('Internal Server Error');
    }
  }
);

router.get('/colaboradores', 
  authorize(['ADMIN', 'SUPERADMIN',], ['USER_WRITE', 'USER_UPDATE', 'READ_USERS_CONTACTS', 'CONFIG']),
  async (req, res) => {
  const { company_id } = req.query;
  try {
    const query = 'SELECT * FROM colaboradores WHERE company_id = $1';
    const result = await pool.query(query, [company_id]);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching colaboradores:', error);
    res.status(500).send('Internal Server Error');
  }
});

router.get('/instalaciones', 
  authorize(['ADMIN', 'SUPERADMIN'], ['CONFIG']),
  async (req, res) => {
  const { company_id } = req.query;
  try {
    const query = 'SELECT * FROM instalaciones WHERE company_id = $1';
    const result = await pool.query(query, [company_id]);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching instalaciones:', error);
    res.status(500).send('Internal Server Error');
  }
});

router.get('/roles',
  authorize(['ADMIN', 'SUPERADMIN', 'REGULAR'], ['CONFIG', 'ADMIN_ROLES', 'CONFIG']),
  async (req, res) => {
    const token = req.headers['x-token'];
    if (!token) {
      return res.status(401).send('No se proporcionó un token válido');
    }

    try {
      // Decodificar el token
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      // Obtener el rol del usuario
      const userRole = decoded.rol; // Suponiendo que el rol esté en el token

      // Si el usuario es 'SUPERADMIN', devolver todos los roles
      if (userRole === 'SUPERADMIN') {
        const roles = await Role.findAll();  // Obtener todos los roles si el usuario es SUPERADMIN
        return res.json(roles);
      }

      // Si el usuario no es SUPERADMIN, devolver todos los roles excepto SUPERADMIN
      const roles = await Role.findAll({
        where: {
          name: {
            [Sequelize.Op.ne]: 'SUPERADMIN',  // Excluir el rol 'SUPERADMIN'
          }
        }
      });

      res.json(roles);

    } catch (error) {
      console.error('Error fetching roles:', error);
      res.status(500).send('Internal Server Error');
    }
 });

router.get('/departments/:companyId', 
  authorize(['ADMIN', 'SUPERADMIN'], ['CONFIG', 'USER_WRITE', 'USER_UPDATE', 'CONFIG']),
  async (req, res) => {
  const { companyId } = req.params;
  try {
    const query = 'SELECT id, name FROM departments WHERE company_id = $1';
    const result = await pool.query(query, [companyId]);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching departments:', error);
    res.status(500).send('Internal Server Error');
  }
});

router.post('/api/users', 
  authorize(['ADMIN', 'SUPERADMIN'], ['CONFIG', 'USER_WRITE', 'CONFIG']),
  async (req, res) => {
  const {
    nombre,
    apellido,
    telefono,
    email,
    rol,
    department_id,
    company_id,
    privileges // Lista de privilegios a asignar
  } = req.body;

  try {
    // Crear el usuario
    const newUser = await User.create({
      nombre,
      apellido,
      telefono,
      email,
      rol,
      department_id,
      company_id,
    });

    // Asignar privilegios al usuario si se proporcionan
    if (privileges && Array.isArray(privileges)) {
      const privilegeRecords = await Privilege.findAll({
        where: {
          name: privileges, // Buscar los privilegios por nombre
        },
      });

      await newUser.addPrivileges(privilegeRecords); // Asocia los privilegios al usuario
    }

    // Obtener al usuario con sus privilegios actualizados
    const userWithPrivileges = await User.findByPk(newUser.id, {
      include: [
        {
          model: Privilege,
          as: 'Privileges',
          through: { attributes: [] }, // Excluir datos de la tabla intermedia
          attributes: ['name'],
        },
      ],
    });

    const usersWithMappedPrivilegesUp = {
        ...userWithPrivileges,
        Privileges: userWithPrivileges.Privileges.map(privilege => privilege.id),
      }


    res.status(201).json(usersWithMappedPrivilegesUp);
  } catch (error) {
    console.error('Error creating new user:', error);
    res.status(500).send('Internal Server Error');
  }
});

router.post('/colaboradores', 
  authorize(['ADMIN', 'SUPERADMIN'], ['CONFIG', 'USER_WRITE', 'CONFIG']),
  async (req, res) => {
  const { nombre, apellido, telefono, email, link_foto, rol, department_id, company_id } = req.body;

  try {
    const result = await pool.query(
      'INSERT INTO colaboradores (nombre, apellido, telefono, email, link_foto, rol, department_id, company_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *',
      [nombre, apellido, telefono, email, link_foto, rol, department_id, company_id]
    );
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error creating new collaborator:', error);
    res.status(500).send('Internal Server Error');
  }
});

router.delete('/colaboradores/:id', 
  authorize(['ADMIN', 'SUPERADMIN'], ['CONFIG', 'USER_DELETE', 'CONFIG']),
  async (req, res) => {
  const { id } = req.params;

  try {
    // Comenzar una transacción
    await pool.query('BEGIN');

    // Eliminar el colaborador
    const deleteColaboradorQuery = 'DELETE FROM colaboradores WHERE id_colaborador = $1';
    await pool.query(deleteColaboradorQuery, [id]);

    // Finalizar la transacción
    await pool.query('COMMIT');

    res.send('Collaborator deleted successfully');
  } catch (error) {
    // En caso de error, revertir la transacción
    await pool.query('ROLLBACK');
    console.error('Error deleting collaborator:', error);
    res.status(500).send('Internal Server Error');
  }
});

router.put('/colaboradores/:id', 
  authorize(['ADMIN', 'SUPERADMIN'], ['CONFIG', 'USER_UPDATE', 'CONFIG']),
  async (req, res) => {
  const { id } = req.params;
  const { nombre, apellido, telefono, email, link_foto, rol, department_id, company_id } = req.body;

  try {
    const updateColaboradorQuery = `
      UPDATE colaboradores 
      SET nombre = $1, apellido = $2, telefono = $3, email = $4, link_foto = $5, rol = $6, department_id = $7, company_id = $8 
      WHERE id_colaborador = $9
      RETURNING *
    `;
    const result = await pool.query(updateColaboradorQuery, [nombre, apellido, telefono, email, link_foto, rol, department_id, company_id, id]);

    if (result.rows.length === 0) {
      return res.status(404).send('Collaborator not found');
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating collaborator:', error);
    res.status(500).send('Internal Server Error');
  }
});


router.put('/users/:id', authorize(['ADMIN', 'SUPERADMIN'], ['USER_UPDATE', 'BOT_UPDATE', 'CONFIG']),
async (req, res) => {
  const { id } = req.params;
  const { nombre, apellido, telefono, email, link_foto, role, department_id, identificacion } = req.body;
console.log("nunca se llama")
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
    user.identificacion = identificacion || user.identificacion;
    user.apellido = apellido || user.apellido;
    user.telefono = telefono || user.telefono;
    user.email = email || user.email;
    user.link_foto = link_foto || user.link_foto;
    user.role = role || user.role;
    user.department_id = department_id || user.department_id;

    // Guardar los cambios
    await user.save();

    // Devolver el usuario actualizado (sin la contraseña)
    const userWithType = await User.findOne({
      where: { id_usuario: user.id_usuario },
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
      attributes: { exclude: ['contraseña'] }, // Excluimos la contraseña
    });

    res.json({
      message: 'Usuario actualizado exitosamente',
      user: userWithType,
    });
  } catch (err) {
    console.error('Error al actualizar el usuario:', err);
    res.status(500).json({ message: 'Error al actualizar al usuario', error: err.message });
   }
 })

router.delete('/users/:id', authorize(['ADMIN', 'SUPERADMIN'], ['USER_DELETE', 'BOT_DELETE', 'CONFIG']),
  async (req, res) => {
  const { id } = req.params;

  try {
    // Comenzar una transacción
    await pool.query('BEGIN');

    // Eliminar cualquier registro en la tabla bots que haga referencia al usuario
    const deleteBotsQuery = 'DELETE FROM bots WHERE id_usuario = $1';
    await pool.query(deleteBotsQuery, [id]);

    // Ahora eliminar el usuario
    const deleteUserQuery = 'DELETE FROM users WHERE id_usuario = $1';
    await pool.query(deleteUserQuery, [id]);

    // Finalizar la transacción
    await pool.query('COMMIT');

    res.send('User and associated bot(s) deleted successfully');
  } catch (error) {
    // En caso de error, revertir la transacción
    await pool.query('ROLLBACK');
    console.error('Error deleting user and bot(s):', error);
    res.status(500).send('Internal Server Error');
  }
});

const profileStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    const profileDir = path.join(__dirname, '..', '..', 'public', 'media', 'users', 'profile');
    if (!fs.existsSync(profileDir)) {
      fs.mkdirSync(profileDir, { recursive: true });
    }
    cb(null, profileDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const uploadProfile = multer({ storage: profileStorage });

// Configuración de Multer para el almacenamiento de imágenes de perfil de contactos
const profileStorageContact = multer.diskStorage({
  destination: function (req, file, cb) {
    const profileDir = path.join(__dirname, '..', '..', 'public', 'media', 'contacts', 'profile');
    if (!fs.existsSync(profileDir)) {
      fs.mkdirSync(profileDir, { recursive: true });
    }
    cb(null, profileDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

  const uploadProfileContact = multer({ storage: profileStorageContact });

  router.post('/upload-profile', 
  authorize(['ADMIN', 'SUPERADMIN'], ['USER_WRITE', 'USER_UPDATE', 'CONFIG']),
  uploadProfile.single('profile'),
  async (req, res) => {
    try {
      // Acceso al archivo subido
      console.log("datos", req.file, req.files);
      
      if (!req.file) {
        return res.status(400).send('No file uploaded');
      }

      const profileFile = req.file; // Obtén el archivo de req.file
      const { id_usuario, company_id } = req.body;

      if (!id_usuario || !company_id) {
        return res.status(400).json({ message: 'Missing user or company ID' });
      }

      // Verificar si el usuario ya tiene una foto de perfil
      const result = await pool.query(
        'SELECT link_foto FROM users WHERE id_usuario = $1 AND company_id = $2',
        [id_usuario, company_id]
      );

      const existingPhoto = result.rows[0]?.link_foto;

      // Eliminar foto existente si existe
      if (existingPhoto) {
        const existingPhotoPath = path.join(__dirname, '..', '..', 'public', existingPhoto);
        if (fs.existsSync(existingPhotoPath)) {
          fs.unlinkSync(existingPhotoPath); // Elimina la foto existente
          console.log(`Foto eliminada: ${existingPhotoPath}`);
        }
      }

      // Crear directorio si no existe
      const profileDir = path.join(__dirname, '..', '..', 'public', 'media', 'users', 'profile');
      if (!fs.existsSync(profileDir)) {
        fs.mkdirSync(profileDir, { recursive: true });
      }

      // Generar nombre de archivo único
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
      const fileExtension = path.extname(profileFile.originalname); // Usar originalname para la extensión
      const newFileName = `${uniqueSuffix}${fileExtension}`;
      const newFilePath = path.join(profileDir, newFileName);

      // Mover el archivo a la nueva ubicación
      fs.renameSync(profileFile.path, newFilePath); // Usar renameSync para mover el archivo

      const newPhotoUrl = `/media/users/profile/${newFileName}`;

      // Actualizar la base de datos con la nueva URL de la foto
      await pool.query(
        'UPDATE users SET link_foto = $1 WHERE id_usuario = $2 AND company_id = $3',
        [newPhotoUrl, id_usuario, company_id]
      );

      res.json({ profileUrl: newPhotoUrl });
    } catch (error) {
      console.error('Error handling profile upload:', error);
      res.status(500).json({ message: 'Error processing profile upload', error: error.message });
    }
  });

  router.post('/upload-profileCollaborator',
    authorize(['ADMIN', 'SUPERADMIN'], ['USER_WRITE', 'USER_UPDATE', 'CONFIG']),
    uploadProfile.single('profile'),
    async (req, res) => {
      try {
        const profileFile = req.file;
        const { id_colaborador, company_id } = req.body;
  
        if (!profileFile || !id_colaborador || !company_id) {
          return res.status(400).json({ message: 'Missing file, collaborator ID or company ID' });
        }
  
        // Buscar foto existente
        const result = await pool.query(
          'SELECT link_foto FROM colaboradores WHERE id_colaborador = $1 AND company_id = $2',
          [id_colaborador, company_id]
        );
  
        const existingPhoto = result.rows[0]?.link_foto;
  
        // Eliminar foto anterior si existe
        if (existingPhoto) {
          const existingPhotoPath = path.join(__dirname, '..', '..', 'public', existingPhoto);
          if (fs.existsSync(existingPhotoPath)) {
            fs.unlinkSync(existingPhotoPath);
            console.log(`Foto de colaborador eliminada: ${existingPhotoPath}`);
          }
        }
  
        // Crear carpeta si no existe
        const profileDir = path.join(__dirname, '..', '..', 'public', 'media', 'users', 'profile');
        if (!fs.existsSync(profileDir)) {
          fs.mkdirSync(profileDir, { recursive: true });
        }
  
        // Crear nombre único para la nueva imagen
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
        const fileExtension = path.extname(profileFile.originalname);
        const newFileName = `${uniqueSuffix}${fileExtension}`;
        const newFilePath = path.join(profileDir, newFileName);
  
        // Mover archivo a su nueva ubicación
        fs.renameSync(profileFile.path, newFilePath);
  
        const newPhotoUrl = `/media/users/profile/${newFileName}`;
  
        // Actualizar base de datos
        await pool.query(
          'UPDATE colaboradores SET link_foto = $1 WHERE id_colaborador = $2 AND company_id = $3',
          [newPhotoUrl, id_colaborador, company_id]
        );
  
        res.json({ profileUrl: newPhotoUrl });
      } catch (error) {
        console.error('Error al subir foto del colaborador:', error);
        res.status(500).json({ message: 'Error procesando imagen del colaborador', error: error.message });
      }
    }
  );

router.post('/upload-profileContact',
  authorize(['ADMIN', 'SUPERADMIN'], ['CONTACT_UPDATE', 'CONFIG']), 
  uploadProfileContact.single('profile'), 
  async(req, res) => {
  if (!req.file) {
    return res.status(400).send('No file uploaded');
  }
  res.json({ profileUrl: `/media/contacts/profile/${req.file.filename}` });
});

router.post('/messages/send-text', 
  authorize(['ADMIN', 'SUPERADMIN'], ['CONTACT_UPDATE', 'CONTACT_WRITE', 'READ_USERS_CONTACTS', 'CONFIG', 'USER_WRITE', 'USER_UPDATE', 'USER_DELETE']), 
  async(req, res) => {
  sendTextMessage(io, req, res);
});

router.post('/messages/react-message', 
  authorize(['ADMIN', 'SUPERADMIN'], ['CONTACT_UPDATE', 'CONTACT_WRITE', 'READ_USERS_CONTACTS', 'CONFIG']),
  async(req, res) => {
  sendReactMessage(io, req, res)
})
// Configuración de Multer para el almacenamiento de imágenes
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, path.join(__dirname, '..', '..', 'public', 'media', 'images'));
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});
const uploadImage = multer({ storage: storage });

const videoStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    const videoDir = path.join(__dirname, '..', '..', 'public', 'media', 'videos');
    if (!fs.existsSync(videoDir)) {
      fs.mkdirSync(videoDir, { recursive: true });
    }
    cb(null, videoDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const uploadVideo = multer({ storage: videoStorage });

const documentStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    const documentDir = path.join(__dirname, '..', '..', 'public', 'media', 'documents');
    if (!fs.existsSync(documentDir)) {
      fs.mkdirSync(documentDir, { recursive: true });
    }
    cb(null, documentDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});
const uploadDocument = multer({ storage: documentStorage });

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

// Configuración de almacenamiento para multer
const audioStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    const audioDir = path.join(__dirname, '..', '..', 'public', 'media', 'audios');
    if (!fs.existsSync(audioDir)) {
      fs.mkdirSync(audioDir, { recursive: true });
    }
    cb(null, audioDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + '.wav');  
  }
});

const uploadAudio = multer({
  storage: audioStorage,
  fileFilter: function (req, file, cb) {
    console.log("formato de audio", file.mimetype)
    const mimeTypes = ['audio/wav', 'audio/ogg; codecs=opus','audio/ogg'];
    if (mimeTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only WAV audio is allowed.'));
    }
  }
});

// Ruta para manejar la subida de imágenes
router.post('/upload-image', 
  authorize(['ADMIN', 'SUPERADMIN'], ['CONTACT_UPDATE', 'CONTACT_WRITE', 'READ_USERS_CONTACTS', 'CONFIG', 'USER_WRITE', 'USER_UPDATE', 'USER_DELETE']), 
  uploadImage.single('image'), (req, res) => {
  try {
    const imageUrl = '/media/images/' + req.file.filename;
    res.json({ imageUrl: imageUrl });
  } catch (error) {
    console.error('Error uploading image:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Ruta para manejar la subida de videos
router.post('/upload-video', uploadVideo.single('video'), 
authorize(['ADMIN', 'SUPERADMIN'], ['CONTACT_UPDATE', 'CONTACT_WRITE', 'READ_USERS_CONTACTS', 'CONFIG', 'USER_WRITE', 'USER_UPDATE', 'USER_DELETE']), 
async (req, res) => {
  try {
    const inputPath = req.file.path;
    const outputFileName = `converted-${req.file.filename}`;
    const outputPath = path.join(req.file.destination, outputFileName);

    // Convertir el video a H.264
    ffmpeg(inputPath)
      .videoCodec('libx264')
      .audioCodec('aac')
      .outputOptions(['-strict -2'])
      .save(outputPath)
      .on('end', async () => {
        const videoUrl = '/media/videos/' + outputFileName;
        const videoDuration = await getVideoDurationInSeconds(outputPath);
        const videoThumbnail = await createThumbnail(outputPath);
        res.json({ videoUrl, videoDuration, videoThumbnail });
        console.log(`Duración: ${videoDuration}`);
        console.log(`Miniatura: ${videoThumbnail}`);
      })
      .on('error', (error) => {
        console.error('Error converting video:', error);
        res.status(500).json({ error: 'Internal server error' });
      });
  } catch (error) {
    console.error('Error uploading video:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

const createThumbnail = (videoPath) => new Promise((resolve, reject) => {
  const thumbnailFilename = `thumbnail-${path.basename(videoPath, path.extname(videoPath))}.png`;
  const thumbnailDir = path.join(__dirname, '..', '..', 'public', 'thumbnail');

  if (!fs.existsSync(thumbnailDir)) {
    fs.mkdirSync(thumbnailDir, { recursive: true });
  }

  const thumbnailPath = path.join(thumbnailDir, thumbnailFilename);

  ffmpeg(videoPath)
    .on('end', () => resolve(`/thumbnail/${thumbnailFilename}`))
    .on('error', (err) => reject(err))
    .output(thumbnailPath)
    .outputOptions([
      '-vf', 'crop=min(iw\\,ih):min(iw\\,ih),scale=290:290',
      '-frames:v', '1'
    ])
    .run();
});

const getVideoDurationInSeconds = (videoPath) => new Promise((resolve, reject) => {
  ffmpeg.ffprobe(videoPath, (err, metadata) => {
    if (err) {
      reject(err);
    } else {
      resolve(metadata.format.duration);
    }
  });
});

// Ruta para manejar la subida de documentos
router.post('/upload-document', 
  authorize(['ADMIN', 'SUPERADMIN'], ['CONTACT_UPDATE', 'CONTACT_WRITE', 'READ_USERS_CONTACTS', 'CONFIG', 'USER_WRITE', 'USER_UPDATE', 'USER_DELETE']), 
  uploadDocument.single('document'), (req, res) => {
  try {
    const documentUrl = '/media/documents/' + req.file.filename;
    res.json({ documentUrl });
  } catch (error) {
    console.error('Error uploading document:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Ruta para manejar la subida de audios
router.post('/upload-audio', 
  authorize(['ADMIN', 'SUPERADMIN'], ['CONTACT_UPDATE', 'CONTACT_WRITE', 'READ_USERS_CONTACTS', 'CONFIG', 'USER_WRITE', 'USER_UPDATE', 'USER_DELETE']), 
  uploadAudio.single('audio'), (req, res) => {
  const tempFilePath = req.file.path;
  const duration = req.body.duration;
  const fileExtension = path.extname(req.file.filename); 

  if (fileExtension === '.ogg') {
    return res.json({ audioUrl: '/media/audios/' + req.file.filename.replace('.wav', '.ogg'), duration });
  }

  const processedFilePath = path.join('public', 'media', 'audios', req.file.filename.replace('.wav', '.ogg'));

  ffmpeg(tempFilePath)
    .audioChannels(1) 
    .audioCodec('libopus')
    .toFormat('ogg')
    .on('end', () => {
      // El archivo procesado está listo, eliminar el archivo temporal WAV
      fs.unlink(tempFilePath, (err) => {
        if (err) {
          console.error('Error deleting temporary file:', err);
        }
      });

      // Devolver la URL del archivo procesado OGG
      res.json({ audioUrl: '/media/audios/' + req.file.filename.replace('.wav', '.ogg'), duration });
    })
    .on('error', (err) => {
      console.error('Error processing audio:', err);
      // Asegurarse de eliminar el archivo temporal en caso de error
      fs.unlink(tempFilePath, (unlinkErr) => {
        if (unlinkErr) {
          console.error('Error deleting temporary file:', unlinkErr);
        }
        res.status(500).json({ error: 'Internal server error' });
      });
    })
    .save(processedFilePath);
});

router.post('/messages/send-image', 
  authorize(['ADMIN', 'SUPERADMIN'], ['CONTACT_UPDATE', 'CONTACT_WRITE', 'READ_USERS_CONTACTS', 'CONFIG', 'USER_WRITE', 'USER_UPDATE', 'USER_DELETE']), 
  async(req, res) => {
  sendImageMessage(io, req, res);
});

router.post('/messages/send-video', 
  authorize(['ADMIN', 'SUPERADMIN'], ['CONTACT_UPDATE', 'CONTACT_WRITE', 'READ_USERS_CONTACTS', 'CONFIG', 'USER_WRITE', 'USER_UPDATE', 'USER_DELETE']), 
  async(req, res) => {
  sendVideoMessage(io, req, res);
});

router.post('/messages/send-document', 
  authorize(['ADMIN', 'SUPERADMIN'], ['CONTACT_UPDATE', 'CONTACT_WRITE', 'READ_USERS_CONTACTS', 'CONFIG', 'USER_WRITE', 'USER_UPDATE', 'USER_DELETE']), 
  async(req, res) => {
  sendDocumentMessage(io, req, res);
});

router.post('/messages/send-audio', 
  authorize(['ADMIN', 'SUPERADMIN'], ['CONTACT_UPDATE', 'CONTACT_WRITE', 'READ_USERS_CONTACTS', 'CONFIG', 'USER_WRITE', 'USER_UPDATE', 'USER_DELETE']), 
  async(req, res) => {
  sendAudioMessage(io, req, res);
});

// Ruta para obtener los datos del usuario
router.get('/user/:id_usuario', 
  authorize(['ADMIN', 'SUPERADMIN'], ['USER_UPDATE', 'USER_WRITE', 'READ_USERS_CONTACTS', 'CONFIG']),
  async (req, res) => {
  const { id_usuario } = req.params;
  try {
    const query = 'SELECT * FROM users WHERE id_usuario = $1';
    const result = await pool.query(query, [id_usuario]);
    if (result.rows.length > 0) {
      res.json(result.rows[0]);
    } else {
      res.status(404).send('User not found');
    }
  } catch (error) {
    console.error('Error fetching user data:', error);
    res.status(500).send('Internal Server Error');
  }
});

// Ruta para obtener los datos de la empresa
router.get('/company/:id', 
  authorize(['ADMIN', 'SUPERADMIN'], ['CONFIG']),
  async (req, res) => {
  const { id } = req.params;
  try {
    const query = 'SELECT * FROM companies WHERE id = $1';
    const result = await pool.query(query, [id]);
    if (result.rows.length > 0) {
      res.json(result.rows[0]);
    } else {
      res.status(404).send('Company not found');
    }
  } catch (error) {
    console.error('Error fetching company data:', error);
    res.status(500).send('Internal Server Error');
  }
});

router.put('/company/:id', 
  authorize(['ADMIN', 'SUPERADMIN'], ['CONFIG']),
  async (req, res) => {
  const { id } = req.params;
  const { name, document_type, document_number, address, city, country, postal_code, email, phone, logo, web, instagram, facebook, twitter, tictok, youtube } = req.body;

  try {
    const updateQuery = `
      UPDATE companies
      SET name = $1, document_type = $2, document_number = $3, address = $4, city = $5, country = $6,
          postal_code = $7, email = $8, phone = $9, web = $10, instagram = $11, facebook = $12,
          twitter = $13, tictok =$14, youtube = $15, logo = $16
      WHERE id = $17
      RETURNING *;
    `;

    const result = await pool.query(updateQuery, [name, document_type, document_number, address, city, country, postal_code, email, phone, web, instagram, facebook, twitter || null, tictok, youtube, logo, id]);
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating company data:', error);
    res.status(500).send('Internal Server Error');
  }
});


const logoStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    const logoDir = path.join(__dirname, '..', '..', 'public', 'media', 'companies', 'logos');
    if (!fs.existsSync(logoDir)) {
      fs.mkdirSync(logoDir, { recursive: true });
    }
    cb(null, logoDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const uploadLogo = multer({ storage: logoStorage });

router.post('/upload-logo', 
  authorize(['ADMIN', 'SUPERADMIN'], ['CONFIG']),
  uploadLogo.single('logo'), 
  async(req, res) => {
  if (!req.file) {
    return res.status(400).send('No file uploaded');
  }
  res.json({ logoUrl: `/media/companies/logos/${req.file.filename}` });
});

router.get('/privileges/:userId', 
  authorize(['ADMIN', 'SUPERADMIN'], ['ADMIN_ROLES', 'CONFIG']),
  async (req, res) => {
  const { userId } = req.params;
  try {
    const query = `
      SELECT p.name
      FROM privileges_roles p
      JOIN roles r ON p.role_id = r.id
      JOIN users u ON u.rol = r.id
      WHERE u.id_usuario = $1
    `;
    const result = await pool.query(query, [userId]);
    console.log('Fetched privileges:', result.rows.map(row => row.name)); // Log de los privilegios obtenidos
    res.json(result.rows.map(row => row.name));
  } catch (error) {
    console.error('Error fetching privileges:', error);
    res.status(500).send('Internal Server Error');
  }
});

// Ruta para obtener datos del rol basado en el ID del rol
router.get('/role/:roleId', 
  authorize(['ADMIN', 'SUPERADMIN'], ['ADMIN_ROLES', 'CONFIG']),
  async (req, res) => {
  const { roleId } = req.params;
  try {
    const query = 'SELECT * FROM roles WHERE id = $1';
    const result = await pool.query(query, [roleId]);
    if (result.rows.length > 0) {
      res.json(result.rows[0]);
      console.log(result.rows[0])
    } else {
      res.status(404).send('Role not found');
    }
  } catch (error) {
    console.error('Error fetching role:', error);
    res.status(500).send('Internal Server Error');
  }
});

// Ruta para obtener los datos de la licencia de la empresa
router.get('/license/:companyId', 
  authorize(['ADMIN', 'SUPERADMIN', 'REGULAR'], ['CONFIG']),
  async (req, res) => {
  const { companyId } = req.params;
  try {
    const query = 'SELECT * FROM licenses WHERE company_id = $1';
    const result = await pool.query(query, [companyId]);
    if (result.rows.length > 0) {
      res.json(result.rows[0]);
    } else {
      res.status(404).send('License not found');
    }
  } catch (error) {
    console.error('Error fetching license data:', error);
    res.status(500).send('Internal Server Error');
  }
});

// Ruta para obtener las integraciones de la empresa
router.get('/integrations/:licenseId', 
  authorize(['ADMIN', 'SUPERADMIN', 'REGULAR'], ['CONTACT_UPDATE', 'CONTACT_WRITE', 'READ_USERS_CONTACTS', 'CONFIG']),
  async(req, res) => {
  const { licenseId } = req.params;
  try {
    // Consulta para obtener integraciones con licenseId y aquellas de tipo "Interno"
    const query = 'SELECT * FROM integrations WHERE license_id = $1 OR type = $2';
    
    // Ejecutar la consulta con licenseId y el tipo 'Interno'
    const result = await pool.query(query, [licenseId, 'Interno']);
    
    // Devolver los resultados
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching integrations:', error);
    res.status(500).send('Internal Server Error');
  }
});

// Ruta para obtener las automatizacioness de la empresa
router.get('/automations/:licenseId', 
  authorize(['ADMIN', 'SUPERADMIN'], ['CONTACT_UPDATE', 'CONTACT_WRITE', 'READ_USERS_CONTACTS', 'CONFIG']),
  async (req, res) => {
  const { licenseId } = req.params;
  try {
    const query = 'SELECT * FROM automations WHERE license_id = $1';
    const result = await pool.query(query, [licenseId]);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching automations:', error);
    res.status(500).send('Internal Server Error');
  }
});

// Ruta para obtener la cantidad de contactos por ID de la empresa
// router.get('/contacts/count/:companyId', async (req, res) => {
//   const { companyId } = req.params;
//   try {
//     const query = 'SELECT COUNT(*) as count FROM contacts WHERE company_id = $1';
//     const result = await pool.query(query, [companyId]);
//     res.json(result.rows[0]);
//   } catch (error) {
//     console.error('Error fetching contacts count:', error);
//     res.status(500).send('Internal Server Error');
//   }
// });

// Ruta para agregar automatización
router.post('/automations', 
  authorize(['ADMIN', 'SUPERADMIN'], ['CONFIG']),
  async (req, res) => {
  const { name, license_id } = req.body;
  try {
    const query = 'INSERT INTO automations (name, license_id) VALUES ($1, $2) RETURNING *';
    const result = await pool.query(query, [name, license_id]);
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error adding automation:', error);
    res.status(500).send('Internal Server Error');
  }
});

router.post('/create-contact', 
  authorize(['ADMIN', 'SUPERADMIN'], ['CONTACT_WRITE', 'CONFIG']),
  uploadProfileContact.single('profile'), 
  async (req, res) => {
  const {
    phone_number, first_name, last_name, organization, label, edad_approx, fecha_nacimiento,
    nacionalidad, ciudad_residencia, direccion_completa, email, genero, pagina_web,
    link_instagram, link_facebook, link_linkedin, link_twitter, link_tiktok, link_youtube,
    nivel_ingresos, ocupacion, nivel_educativo, estado_civil, cantidad_hijos, estilo_de_vida,
    personalidad, cultura, preferencias_contacto, historial_compras, historial_interacciones,
    observaciones_agente, orientacion_sexual, company_id
  } = req.body;

  const profile_url = req.file ? `/media/contacts/profile/${req.file.filename}` : null;

  // Convertir cadenas vacías a null o valores por defecto para campos enteros
  const convertToIntegerOrNull = (value) => {
    // Verificar si el valor es un número válido antes de convertirlo
    const parsed = parseInt(value, 10);
    return isNaN(parsed) ? null : parsed;
  };

  // Convertir cadenas vacías a null para fechas
  const convertToDateOrNull = (value) => {
    // Verificar si el valor puede ser convertido en una fecha válida
    const date = new Date(value);
    return isNaN(date.getTime()) ? null : value;
  };

  // Construir dinámicamente la consulta INSERT y la lista de valores
  const fields = [
    'phone_number', 'first_name', 'last_name', 'organization', 'label', 'profile_url', 'edad_approx', 'fecha_nacimiento',
    'nacionalidad', 'ciudad_residencia', 'direccion_completa', 'email', 'genero', 'pagina_web',
    'link_instagram', 'link_facebook', 'link_linkedin', 'link_twitter', 'link_tiktok', 'link_youtube',
    'nivel_ingresos', 'ocupacion', 'nivel_educativo', 'estado_civil', 'cantidad_hijos', 'estilo_de_vida',
    'personalidad', 'cultura', 'preferencias_contacto', 'historial_compras', 'historial_interacciones',
    'observaciones_agente', 'fecha_creacion_cliente', 'orientacion_sexual', 'company_id'
  ];

  const values = [
    phone_number || null, first_name || null, last_name || null, organization || null, label || null, profile_url,
    convertToIntegerOrNull(edad_approx), convertToDateOrNull(fecha_nacimiento),
    nacionalidad || null, ciudad_residencia || null, direccion_completa || null, email || null, genero || null, pagina_web || null,
    link_instagram || null, link_facebook || null, link_linkedin || null, link_twitter || null, link_tiktok || null, link_youtube || null,
    nivel_ingresos || null, ocupacion || null, nivel_educativo || null, estado_civil || null, convertToIntegerOrNull(cantidad_hijos), estilo_de_vida || null,
    personalidad || null, cultura || null, preferencias_contacto || null, historial_compras || null, historial_interacciones || null,
    observaciones_agente || null, new Date(), orientacion_sexual || null, convertToIntegerOrNull(company_id)
  ];

  // Filtrar campos y valores para eliminar nulos
  const nonNullFields = fields.filter((_, index) => values[index] !== null);
  const nonNullValues = values.filter(value => value !== null);

  const query = `
    INSERT INTO contacts (${nonNullFields.join(', ')})
    VALUES (${nonNullFields.map((_, index) => `$${index + 1}`).join(', ')})
    RETURNING *;
  `;

  try {
    const result = await pool.query(query, nonNullValues);
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error creating contact:', error);
    res.status(500).send('Internal Server Error');
  }
});


// Configuración de Multer para la carga de archivos CSV
const storageCSV = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadPath = path.join(__dirname, '..', '..', 'upload', 'contacts');

    // Verificar si el directorio existe, si no, crearlo
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }

    cb(null, uploadPath);
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + '-' + file.originalname);
  }
});

const upload = multer({ storage: storageCSV });

// Ruta para cargar un archivo CSV con contactos
router.post('/contacts/upload-csv',
  authorize(['ADMIN', 'SUPERADMIN'], ['CONTACT_WRITE', 'CONFIG']),
  upload.single('csv'), async (req, res) => {

  // Verifica si se recibió un archivo
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  // Verifica si el archivo realmente existe
  if (!fs.existsSync(req.file.path)) {
    return res.status(404).json({ error: 'Uploaded file not found' });
  }

  const contacts = [];
  const uploadDir = path.dirname(req.file.path); // Directorio de la subida

  // Asegurar que la carpeta de upload existe
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }

  fs.createReadStream(req.file.path)
    .pipe(csv())
    .on('data', (row) => {
      contacts.push({
        phone_number: row.phone_number,
        first_name: row.first_name,
        last_name: row.last_name,
        organization: row.organization,
        label: row.label,
        email: row.email,
        company_id: req.body.company_id
      });
    })
    .on('end', async () => {
      try {
        if (contacts.length === 0) {
          return res.status(400).json({ error: 'CSV file is empty or has invalid format' });
        }

        const query = `
          INSERT INTO contacts (phone_number, first_name, last_name, organization, label, email, company_id)
          VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`;
        
        const insertedContacts = [];
        for (const contact of contacts) {
          const { rows } = await pool.query(query, [
            contact.phone_number,
            contact.first_name,
            contact.last_name,
            contact.organization,
            contact.label,
            contact.email,
            contact.company_id
          ]);
          insertedContacts.push(rows[0]);
        }

        // Eliminar el archivo CSV solo si existe
        if (fs.existsSync(req.file.path)) {
          fs.unlinkSync(req.file.path);
        }

        res.status(200).json({ message: 'CSV file processed successfully', contacts: insertedContacts });
      } catch (error) {
        console.error('Error processing CSV file:', error);
        res.status(500).json({ error: 'Internal Server Error' });
      }
    })
    .on('error', (err) => {
      console.error('Error reading CSV file:', err);
      res.status(500).json({ error: 'Error reading CSV file' });
    });
});

// Ruta para obtener la cantidad de roles por ID de la empresa
// router.get('/roles/count/:companyId', async (req, res) => {
//   const { companyId } = req.params;
//   try {
//     const query = 'SELECT COUNT(*) as count FROM roles WHERE company_id = $1';
//     const result = await pool.query(query, [companyId]);
//     res.json(result.rows[0]);
//   } catch (error) {
//     console.error('Error fetching roles count:', error);
//     res.status(500).send('Internal Server Error');
//   }
// });

// Ruta para obtener la cantidad de organizaciones por ID de la empresa
router.get('/organizations/count/:companyId', 
  authorize(['SUPERADMIN'], []),
  async (req, res) => {
  const { companyId } = req.params;
  try {
    const query = 'SELECT COUNT(*) as count FROM organizations WHERE company_id = $1';
    const result = await pool.query(query, [companyId]);
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching organizations count:', error);
    res.status(500).send('Internal Server Error');
  }
});

router.post('/organizations', 
  authorize(['SUPERADMIN'], []), 
  async (req, res) => {
  const {
    name, document_type, document_number, address, city, country,
    postal_code, email, phone, company_id
  } = req.body;

  try {
    const query = `
      INSERT INTO organizations (name, document_type, document_number, address, city, country,
                                 postal_code, email, phone, company_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *;
    `;

    const values = [name, document_type, document_number, address, city, country, postal_code, email, phone, company_id];
    const result = await pool.query(query, values);
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error creating organization:', error);
    res.status(500).send('Internal Server Error');
  }
});

router.post('/roles', 
  authorize(['SUPERADMIN'], []),
  async (req, res) => {
  const { name, type, company_id, privileges } = req.body;

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const roleQuery = 'INSERT INTO roles (name, type, company_id) VALUES ($1, $2, $3) RETURNING id';
    const roleResult = await client.query(roleQuery, [name, type, company_id]);
    const roleId = roleResult.rows[0].id;

    const privilegeQueries = privileges.map(privilege => {
      return client.query('INSERT INTO privileges_roles (name, role_id) VALUES ($1, $2)', [privilege, roleId]);
    });

    await Promise.all(privilegeQueries);

    await client.query('COMMIT');

    res.json({ id: roleId, name, type, company_id, privileges });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error creating role:', error);
    res.status(500).send('Internal Server Error');
  } finally {
    client.release();
  }
});

  //router.post('/departments',
  //authorize(['ADMIN', 'SUPERADMIN'], ['CONFIG']),
  //async (req, res) => {
router.post('/departments', async (req, res) => {
  const { name, description, company_id } = req.body;

  try {
    const query = 'INSERT INTO departments (name, description, company_id) VALUES ($1, $2, $3) RETURNING *';
    const result = await pool.query(query, [name, description, company_id]);
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error creating department:', error);
    res.status(500).send('Internal Server Error');
  }
});

// Ruta para obtener las fases de un departamento
router.get('/departments/:departmentId/phases', 
  authorize(['ADMIN', 'SUPERADMIN'], ['CONTACT_UPDATE', 'CONTACT_WRITE', 'READ_USERS_CONTACTS', 'CONFIG']),
  async (req, res) => {
  const { departmentId } = req.params;
  try {
    const query = 'SELECT * FROM department_phases WHERE department_id = $1 ORDER BY "order"';
    const result = await pool.query(query, [departmentId]);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching department phases:', error);
    res.status(500).send('Internal Server Error');
  }
});

// Ruta para agregar una fase a un departamento
router.post('/departments/:departmentId/phases', 
  authorize(['ADMIN', 'SUPERADMIN'], ['CONFIG']),
  async (req, res) => {
  const { name, order, color, department_id } = req.body;
  try {
    const query = 'INSERT INTO department_phases (name, department_id, "order", color) VALUES ($1, $2, $3, $4) RETURNING *';
    const result = await pool.query(query, [name, department_id, order, color]);
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error adding department phase:', error);
    res.status(500).send('Internal Server Error');
  }
});

// Ruta para actualizar una fase de un departamento
router.put('/departments/phases/:id', 
  authorize(['ADMIN', 'SUPERADMIN'], ['CONFIG']),
  async (req, res) => {
  const { id } = req.params;
  const { name, order, color } = req.body;
  try {
    const query = 'UPDATE department_phases SET name = $1, "order" = $2, color = $3 WHERE id = $4 RETURNING *';
    const result = await pool.query(query, [name, order, color, id]);
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating department phase:', error);
    res.status(500).send('Internal Server Error');
  }
});

  //router.post('/integrations',
  //authorize(['ADMIN', 'SUPERADMIN'], ['CONFIG']), 
  //async (req, res) => {
router.post('/integrations', async (req, res) => {
  const { type, name, license_id, company_id, WHATSAPP_API_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_APP_ID, WHATSAPP_BUSINESS_ACCOUNT_ID, botix_api_token } = req.body;

  try {
    const query = 'INSERT INTO integrations (type, name, license_id, company_id, WHATSAPP_API_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_APP_ID, WHATSAPP_BUSINESS_ACCOUNT_ID, botix_api_token) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *';
    const result = await pool.query(query, [type, name, license_id, company_id, WHATSAPP_API_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_APP_ID, WHATSAPP_BUSINESS_ACCOUNT_ID, botix_api_token]);
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error creating integration:', error);
    res.status(500).send('Internal Server Error');
  }
});

router.put('/edit-contact/:id', 
   authorize(['ADMIN', 'SUPERADMIN'], ['USER_UPDATE', 'CONFIG']),
   uploadProfileContact.single('profile'), 
   async (req, res) => {
  const { id } = req.params;
  const contactData = req.body;

  try {
    // Fetch current contact data
    const currentContactResult = await pool.query('SELECT * FROM contacts WHERE id = $1', [id]);
    if (currentContactResult.rows.length === 0) {
      return res.status(404).json({ error: 'Contacto no encontrado' });
    }

    const currentContact = currentContactResult.rows[0];
    const profile_url = req.file ? `/media/contacts/profile/${req.file.filename}` : contactData.profile_url || currentContact.profile_url;

    // Merge current contact data with new data
    const updatedContact = {
      ...currentContact,
      ...contactData,
      profile_url
    };

    const query = `
      UPDATE contacts SET
        first_name = $1, last_name = $2, email = $3, organization = $4, label = $5,
        profile_url = $6, edad_approx = $7, fecha_nacimiento = $8, nacionalidad = $9,
        ciudad_residencia = $10, direccion_completa = $11, genero = $12, pagina_web = $13,
        link_instagram = $14, link_facebook = $15, link_linkedin = $16, link_twitter = $17,
        link_tiktok = $18, link_youtube = $19, nivel_ingresos = $20, ocupacion = $21,
        nivel_educativo = $22, estado_civil = $23, cantidad_hijos = $24, estilo_de_vida = $25,
        personalidad = $26, cultura = $27, preferencias_contacto = $28, historial_compras = $29,
        historial_interacciones = $30, observaciones_agente = $31, fecha_creacion_cliente = $32,
        orientacion_sexual = $33, phone_number = $34
      WHERE id = $35
      RETURNING *;
    `;

    const values = [
      updatedContact.first_name, updatedContact.last_name, updatedContact.email, updatedContact.organization, updatedContact.label,
      updatedContact.profile_url, updatedContact.edad_approx, updatedContact.fecha_nacimiento, updatedContact.nacionalidad,
      updatedContact.ciudad_residencia, updatedContact.direccion_completa, updatedContact.genero, updatedContact.pagina_web,
      updatedContact.link_instagram, updatedContact.link_facebook, updatedContact.link_linkedin, updatedContact.link_twitter,
      updatedContact.link_tiktok, updatedContact.link_youtube, updatedContact.nivel_ingresos, updatedContact.ocupacion,
      updatedContact.nivel_educativo, updatedContact.estado_civil, updatedContact.cantidad_hijos, updatedContact.estilo_de_vida,
      updatedContact.personalidad, updatedContact.cultura, updatedContact.preferencias_contacto, updatedContact.historial_compras,
      updatedContact.historial_interacciones, updatedContact.observaciones_agente, updatedContact.fecha_creacion_cliente,
      updatedContact.orientacion_sexual, updatedContact.phone_number, id
    ];

    const result = await pool.query(query, values);
    if (result.rows.length > 0) {
      console.log('Contacto actualizado con éxito:', result.rows[0]);
      io.emit('contactUpdated', result.rows[0]); // Emitir evento con los datos actualizados usando io
      res.json(result.rows[0]);
    } else {
      res.status(404).json({ error: 'Contacto no encontrado' });
    }
  } catch (error) {
    console.error('Error al actualizar contacto:', error);
    res.status(500).json({ error: 'Error al actualizar contacto' });
  }
});

router.get('/company/:companyId/phases', 
  authorize(['ADMIN', 'SUPERADMIN'], ['CONTACT_UPDATE', 'CONTACT_WRITE', 'READ_USERS_CONTACTS', 'CONFIG']),
  async(req, res) => {
  const { companyId } = req.params;
  try {
    const query = `
      SELECT dp.*
      FROM department_phases dp
      JOIN departments d ON dp.department_id = d.id
      WHERE d.company_id = $1
      ORDER BY dp."order"
    `;
    const result = await pool.query(query, [companyId]);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching phases for company:', error);
    res.status(500).send('Internal Server Error');
  }
});

router.get('/users/conversation-stats/:companyId', 
  authorize(['ADMIN', 'SUPERADMIN'], ['CONTACT_UPDATE', 'CONTACT_WRITE', 'READ_USERS_CONTACTS', 'CONFIG']),
  async (req, res) => {
  const { companyId } = req.params;

  try {
    const query = `
      SELECT 
        u.id_usuario, 
        COUNT(c.conversation_id) AS total_conversations, 
        SUM(CASE WHEN c.unread_messages > 0 THEN 1 ELSE 0 END) AS pending_conversations,
        SUM(CASE WHEN c.unread_messages = 0 THEN 1 ELSE 0 END) AS attended_conversations
      FROM users u
      LEFT JOIN conversations c ON u.id_usuario = c.id_usuario
      WHERE u.company_id = $1
      GROUP BY u.id_usuario
    `;
    const result = await pool.query(query, [companyId]);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching conversation stats:', error);
    res.status(500).send('Internal Server Error');
  }
});

router.get('/contacts', 
  authorize(['ADMIN', 'SUPERADMIN'], ['CONTACT_UPDATE', 'CONTACT_WRITE', 'READ_USERS_CONTACTS', 'CONFIG']),
  async (req, res) => {
  const companyId = req.query.company_id;

  try {
    const query = `
      SELECT 
        ct.*,
        dp.name as phase_name,
        dp.color as phase_color,
        last_message_info.last_message_time,
        EXTRACT(EPOCH FROM (NOW() - last_message_info.last_message_time)) AS time_since_last_message,
        EXISTS(SELECT 1 FROM conversations WHERE contact_id = ct.id) AS has_conversation
      FROM contacts ct
      LEFT JOIN department_phases dp ON ct.label = dp.id
      LEFT JOIN LATERAL (
        SELECT 
          MAX(msg.received_at) as last_message_time
        FROM (
          SELECT received_at FROM messages WHERE conversation_fk IN (
            SELECT conversation_id FROM conversations WHERE contact_id = ct.id
          )
          UNION ALL
          SELECT created_at FROM replies WHERE conversation_fk IN (
            SELECT conversation_id FROM conversations WHERE contact_id = ct.id
          )
        ) msg
      ) last_message_info ON true
      WHERE ct.company_id = $1
    `;
    const result = await pool.query(query, [companyId]);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching contacts:', error);
    res.status(500).send('Internal Server Error');
  }
});

router.get('/templates', 
  authorize(['ADMIN', 'SUPERADMIN'], ['CONTACT_UPDATE', 'CONTACT_WRITE', 'READ_USERS_CONTACTS', 'CONFIG']),
  async (req, res) => {
  const companyId = req.query.company_id;
  if (!companyId) {
    console.error('company_id is required');
    return res.status(400).send({ error: 'company_id is required' });
  }

  try {
    console.log('Fetching templates for company ID:', companyId);
    const query = 'SELECT * FROM templates_wa WHERE company_id = $1';
    const values = [companyId];
    const result = await pool.query(query, values);
    
    const templates = result.rows;

    // Fetch variables for each template
    for (const template of templates) {
      const headerVariablesQuery = 'SELECT * FROM variable_headers WHERE template_wa_id = $1';
      const bodyVariablesQuery = 'SELECT * FROM variable_body WHERE template_wa_id = $1';
      const buttonVariablesQuery = 'SELECT * FROM variable_button WHERE template_wa_id = $1';

      const headerVariablesResult = await pool.query(headerVariablesQuery, [template.id]);
      const bodyVariablesResult = await pool.query(bodyVariablesQuery, [template.id]);
      const buttonVariablesResult = await pool.query(buttonVariablesQuery, [template.id]);

      template.headerVariables = headerVariablesResult.rows;
      template.bodyVariables = bodyVariablesResult.rows;
      template.buttonVariables = buttonVariablesResult.rows;
    }

    res.status(200).send(templates);
  } catch (error) {
    console.error('Error fetching templates:', error.message);
    res.status(500).send({ error: error.message });
  }
});

router.get('/template/:id', 
  authorize(['ADMIN', 'SUPERADMIN'], ['CONTACT_UPDATE', 'CONTACT_WRITE', 'READ_USERS_CONTACTS', 'CONFIG']),
  async (req, res) => {
  const templateId = req.params.id; // Obteniendo el ID del template desde los parámetros de la URL
  if (!templateId) {
    console.error('template_id is required');
    return res.status(400).send({ error: 'template_id is required' });
  }

  try {
    console.log('Fetching template for template ID:', templateId);
    
    // Consulta para obtener un solo template por su ID
    const query = 'SELECT * FROM templates_wa WHERE id = $1';
    const values = [templateId];
    const result = await pool.query(query, values);

    if (result.rows.length === 0) {
      return res.status(404).send({ error: 'Template not found' });
    }

    const template = result.rows[0];

    // Fetch variables for the template
    const headerVariablesQuery = 'SELECT * FROM variable_headers WHERE template_wa_id = $1';
    const bodyVariablesQuery = 'SELECT * FROM variable_body WHERE template_wa_id = $1';
    const buttonVariablesQuery = 'SELECT * FROM variable_button WHERE template_wa_id = $1';

    const headerVariablesResult = await pool.query(headerVariablesQuery, [template.id]);
    const bodyVariablesResult = await pool.query(bodyVariablesQuery, [template.id]);
    const buttonVariablesResult = await pool.query(buttonVariablesQuery, [template.id]);

    // Agregando las variables al template
    template.headerVariables = headerVariablesResult.rows;
    template.bodyVariables = bodyVariablesResult.rows;
    template.buttonVariables = buttonVariablesResult.rows;

    // Enviar el template con sus variables
    res.status(200).send(template);
  } catch (error) {
    console.error('Error fetching template:', error.message);
    res.status(500).send({ error: error.message });
  }
});

router.get('/campaigns', 
  authorize(['ADMIN', 'SUPERADMIN'], ['CONTACT_UPDATE', 'CONTACT_WRITE', 'READ_USERS_CONTACTS', 'CONFIG']),
  async (req, res) => {
  const companyId = req.query.company_id; // Usar query param en lugar de params
  if (!companyId) {
    console.error('company_id is required');
    return res.status(400).send({ error: 'company_id is required' });
  }
  try {
    const query = `
      SELECT campaigns.*, templates_wa.nombre AS template_name 
      FROM campaigns 
      JOIN templates_wa ON campaigns.template_id = templates_wa.id 
      WHERE campaigns.company_id = $1
    `;
    const values = [companyId];
    const result = await pool.query(query, values);
    res.status(200).send(result.rows);
  } catch (error) {
    console.error('Error fetching campaigns:', error.message);
    res.status(500).send({ error: error.message });
  }
});

// Crear una nueva campaña
router.post('/campaigns', 
  authorize(['ADMIN', 'SUPERADMIN'], ['CONFIG']),
  async (req, res) => {
  const { name, objective, type, template_id, scheduled_launch, state_conversation, company_id, type_responsible } = req.body;

  try {
    const query = `
      INSERT INTO campaigns (name, objective, type, template_id, scheduled_launch, state_conversation, company_id, type_responsible) 
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8) 
      RETURNING *
    `;
    const values = [name, objective, type, template_id, scheduled_launch || null, state_conversation, company_id, type_responsible];
    const result = await pool.query(query, values);
    res.status(201).send(result.rows[0]);
  } catch (error) {
    console.error('Error creating campaign:', error.message);
    res.status(500).send({ error: error.message });
  }
});

// Asociar responsables a una campaña
router.post('/campaigns/:campaignId/responsibles', 
  authorize(['ADMIN', 'SUPERADMIN'], ['CONFIG']),
  async (req, res) => {
  const { campaignId } = req.params;
  const { responsible_ids } = req.body;

  try {
    // Eliminar los responsables actuales de la campaña
    await pool.query('DELETE FROM campaign_responsibles WHERE campaign_id = $1', [campaignId]);

    // Insertar los nuevos responsables
    const query = 'INSERT INTO campaign_responsibles (campaign_id, user_id) VALUES ($1, $2)';
    for (let userId of responsible_ids) {
      await pool.query(query, [campaignId, userId]);
    }

    res.status(200).send({ message: 'Responsibles updated successfully.' });
  } catch (error) {
    console.error('Error updating responsibles:', error.message);
    res.status(500).send({ error: error.message });
  }
});

// Actualizar una campaña
router.put('/campaigns/:id', 
  authorize(['ADMIN', 'SUPERADMIN'], ['CONFIG']),
  async (req, res) => {
  const { id } = req.params;
  const { name, objective, type, template_id, scheduled_launch, state_conversation, type_responsible } = req.body;

  try {
    const query = `
      UPDATE campaigns
      SET
        name = $1,
        objective = $2,
        type = $3,
        template_id = $4,
        scheduled_launch = $5,
        state_conversation = $6,
        type_responsible = $7,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $8
      RETURNING *;
    `;
    const values = [name, objective, type, template_id, scheduled_launch, state_conversation, type_responsible, id];
    const result = await pool.query(query, values);

    if (result.rows.length === 0) {
      return res.status(404).send({ error: 'Campaign not found' });
    }

    res.status(200).send(result.rows[0]);
  } catch (error) {
    console.error('Error updating campaign:', error.message);
    res.status(500).send({ error: error.message });
  }
});

// Eliminar una campaña
router.delete('/campaigns/:id', 
  authorize(['ADMIN', 'SUPERADMIN'], ['CONFIG']),
  async (req, res) => {
  const { id } = req.params;

  try {
    await pool.query('BEGIN');

    const deleteContactsQuery = 'DELETE FROM campaign_contacts WHERE campaign_id = $1';
    await pool.query(deleteContactsQuery, [id]);

    // Eliminar la campaña
    const deleteCampaignQuery = 'DELETE FROM campaigns WHERE id = $1 RETURNING *';
    const result = await pool.query(deleteCampaignQuery, [id]);

    await pool.query('COMMIT');

    res.status(200).send(result.rows[0]);
  } catch (error) {
    console.error('Error deleting campaign and associated contacts:', error.message);

    // Revertir la transacción en caso de error
    await pool.query('ROLLBACK');

    res.status(500).send({ error: error.message });
  }
});

// Asociar contactos a una campaña
router.post('/campaigns/:campaignId/contacts', 
  authorize(['ADMIN', 'SUPERADMIN'], ['CONFIG']),
  async (req, res) => {
  const { campaignId } = req.params;
  const { contact_ids } = req.body;

  const insertedIds = [];

  try {
    const query = 'INSERT INTO campaign_contacts (campaign_id, contact_id) VALUES ($1, $2)';
    for (let contactId of contact_ids) {
      await pool.query(query, [campaignId, contactId]);
      insertedIds.push(contactId);
    }
    res.status(200).send({ message: 'Contacts associated with campaign successfully.', insertedIds });
  } catch (error) {
    console.error('Error associating contacts with campaign:', error.message);
    res.status(500).send({ error: error.message });
  }
});

router.put('/campaigns/:campaignId/contacts', 
  authorize(['ADMIN', 'SUPERADMIN'], ['CONFIG']),
  async(req, res) => {
  const { campaignId } = req.params;
  const { contact_ids } = req.body;

  try {
    // Iniciar una transacción
    await pool.query('BEGIN');

    // Verificar qué contact_ids existen en la tabla contacts
    const checkContactsQuery = 'SELECT id FROM contacts WHERE id = ANY($1::int[])';
    const result = await pool.query(checkContactsQuery, [contact_ids]);

    // Obtener solo los contactos válidos que existen
    const existingContacts = result.rows.map(row => row.id);
     
    // Si no hay contactos válidos, cancelar la operación
    if (existingContacts.length === 0) {
      throw new Error('No valid contacts found to update.');
    }

    // Eliminar los contactos existentes para la campaña que están en la lista de contactos válidos
    const deleteContactsQuery = `
      DELETE FROM campaign_contacts 
      WHERE campaign_id = $1`;
    await pool.query(deleteContactsQuery, [campaignId]);

    // Insertar los contactos válidos
    const insertContactsQuery = 'INSERT INTO campaign_contacts (campaign_id, contact_id) VALUES ($1, $2)';
    for (let contactId of existingContacts) {
      await pool.query(insertContactsQuery, [campaignId, contactId]);
    }

    // Confirmar la transacción
    await pool.query('COMMIT');

    res.status(200).send(existingContacts);
  } catch (error) {
    console.error('Error updating contacts for campaign:', error.message);

    // Revertir la transacción en caso de error
    await pool.query('ROLLBACK');

    res.status(500).send({ error: error.message });
  }
});

router.put('/campaigns/:campaignId/responsibles', 
  authorize(['ADMIN', 'SUPERADMIN'], [ 'CONFIG']),
  async(req, res) => {
  const { campaignId } = req.params;
  const { responsible_ids } = req.body;

  try {
    // Iniciar una transacción
    await pool.query('BEGIN');

    // Eliminar los responsables actuales asociados con la campaña
    await pool.query('DELETE FROM campaign_responsibles WHERE campaign_id = $1', [campaignId]);

    // Insertar los nuevos responsables
    const query = 'INSERT INTO campaign_responsibles (campaign_id, user_id) VALUES ($1, $2)';
    for (let userId of responsible_ids) {
      await pool.query(query, [campaignId, userId]);
    }

    // Confirmar la transacción
    await pool.query('COMMIT');
    res.status(200).send({ message: 'Responsibles updated successfully.' });
  } catch (error) {
    // Revertir la transacción en caso de error
    await pool.query('ROLLBACK');
    console.error('Error updating responsibles:', error.message);
    res.status(500).send({ error: error.message });
  }
});

// Obtener todos los contactos de la tabla campaign_contacts
router.get('/contactsCampaign', 
  authorize(['ADMIN', 'SUPERADMIN'], ['CONFIG']),
  async(req, res) => {
  try {
    const query = 'SELECT * FROM campaign_contacts';
    const result = await pool.query(query);

    if (result.rows.length === 0) {
      return res.status(200).send({ message: 'No contacts found.', contacts: [] });
    }

    res.status(200).send(result.rows);
  } catch (error) {
    console.error('Error fetching all contacts:', error.message);
    res.status(500).send({ error: error.message });
  }
});

router.get('/phases/:companyId', 
  authorize(['ADMIN', 'SUPERADMIN'], ['CONTACT_UPDATE', 'CONTACT_WRITE', 'READ_USERS_CONTACTS', 'READ_INFO_AUDIT', 'CONFIG']),
  async(req, res) => {
  const { companyId } = req.params;
  try {
    const query = `
      SELECT dp.id, dp.name
      FROM department_phases dp
      JOIN departments d ON dp.department_id = d.id
      WHERE d.company_id = $1
      ORDER BY dp."order"
    `;
    const result = await pool.query(query, [companyId]);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching phases:', error);
    res.status(500).send('Internal Server Error');
  }
});

router.post('/launch-campaign/:campaignId', 
  authorize(['ADMIN', 'SUPERADMIN'], ['CONFIG']),
  async (req, res) => {
  sendTemplateMessage(io, req, res);
});

router.post('/send-template', 
  authorize(['ADMIN', 'SUPERADMIN'], ['CONTACT_UPDATE', 'CONTACT_WRITE', 'READ_USERS_CONTACTS', 'READ_INFO_AUDIT', 'CONFIG']),
  async (req, res) => {
  sendTemplateToSingleContact(io, null, req, res);
});

const getDateValue = (type) => {
  const now = new Date();
  switch (type) {
      case 'today':
          return format(now, 'dd/MM/yy', { locale: es });
      case 'yesterday':
          const yesterday = new Date(now);
          yesterday.setDate(now.getDate() - 1);
          return `ayer ${format(yesterday, 'EEEE', { locale: es })}`;
      case 'tomorrow':
          const tomorrow = new Date(now);
          tomorrow.setDate(now.getDate() + 1);
          return `mañana ${format(tomorrow, 'EEEE', { locale: es })}`;
      case 'weekend':
          const nextSaturday = new Date(now);
          nextSaturday.setDate(now.getDate() + ((6 - now.getDay()) % 7));
          return `este fin de semana ${format(nextSaturday, 'dd/MM', { locale: es })}`;
      case 'this_month':
          return format(now, 'MMMM', { locale: es });
      case 'working day':
          const hour = now.getHours();
          if (hour >= 6 && hour < 12) return 'dias';
          if (hour >= 12 && hour < 18) return 'tardes';
          return 'noches';
      case 'hour':
          return format(now, 'HH:mm', { locale: es });
      case 'day_name':
          return format(now, 'EEEE', { locale: es });
      default:
          return '';
  }
};

const getVariableValue = async (variable, contactId, userId, companyId) => {
  let value = '';
  if (variable.source === 'contacts') {
      const contactQuery = 'SELECT * FROM contacts WHERE id = $1';
      const contactResult = await pool.query(contactQuery, [contactId]);
      const contactData = contactResult.rows[0];
      value = contactData ? contactData[variable.variable] : '';
      console.log('Contact value:', value);
  } else if (variable.source === 'users') {
      const userQuery = 'SELECT * FROM users WHERE id_usuario = $1';
      const userResult = await pool.query(userQuery, [userId]);
      const userData = userResult.rows[0];
      value = userData ? userData[variable.variable] : '';
      console.log('User value:', value);
  } else if (variable.source === 'companies') {
      const companyQuery = 'SELECT * FROM companies WHERE id = $1';
      const companyResult = await pool.query(companyQuery, [companyId]);
      const companyData = companyResult.rows[0];
      value = companyData ? companyData[variable.variable] : '';
      console.log('Company value:', value);
  } else if (variable.source === 'date') {
      value = getDateValue(variable.variable);
      console.log('Date value:', value);
  }
  return value;
};

router.get('/conversation-variable-values/:templateId/:conversationId', 
  authorize(['ADMIN', 'SUPERADMIN'], ['CONTACT_UPDATE', 'CONTACT_WRITE', 'READ_USERS_CONTACTS', 'READ_INFO_AUDIT', 'CONFIG']),
  async (req, res) => {
  const { templateId, conversationId } = req.params;

  try {
      // Obtener la información de la conversación
      const conversationQuery = `
          SELECT c.*, u.*, comp.id AS company_id
          FROM conversations c
          JOIN users u ON c.id_usuario = u.id_usuario
          JOIN companies comp ON u.company_id = comp.id
          WHERE c.conversation_id = $1
      `;
      const conversationResult = await pool.query(conversationQuery, [conversationId]);
      const conversation = conversationResult.rows[0];

      if (!conversation) {
          console.error('Conversation not found');
          return res.status(404).json({ error: 'Conversation not found' });
      }

      console.log('Conversation data:', conversation);

      // Obtener las variables de la plantilla con la distinción de su tipo
      const variablesQuery = `
          SELECT 'header' AS scope, * 
          FROM variable_headers 
          WHERE template_wa_id = $1
          UNION ALL
          SELECT 'body' AS scope, * 
          FROM variable_body 
          WHERE template_wa_id = $1
          UNION ALL
          SELECT 'button' AS scope, * 
          FROM variable_button 
          WHERE template_wa_id = $1
      `;
      const variablesResult = await pool.query(variablesQuery, [templateId]);
      const variables = variablesResult.rows;

      console.log('Template variables:', variables);

      const variableValues = {};
      for (const variable of variables) {
          const variableName = `${variable.scope}_${variable.name.replace(/{{|}}/g, '')}`; // Diferenciar por scope
          variableValues[variableName] = await getVariableValue(variable, conversation.contact_id, conversation.id_usuario, conversation.company_id);
      }

      console.log('Variable values:', variableValues);

      res.json(variableValues);
  } catch (error) {
      console.error('Error fetching variable values:', error.message);
      res.status(500).json({ error: 'Internal server error' });
  }
});

// Ruta para obtener el ID del usuario predefinido para una empresa específica
router.get('/default-user/:companyId', 
  authorize(['ADMIN', 'SUPERADMIN'], ['USER_UPDATE', 'USER_WRITE', 'READ_USERS_CONTACTS', 'READ_INFO_AUDIT', 'CONFIG']),
  async (req, res) => {
  const { companyId } = req.params;
  try {
    const query = `
      SELECT id_usuario 
      FROM default_users 
      WHERE company_id = $1
    `;
    const result = await pool.query(query, [companyId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Default user not found for this company' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching default user:', error);
    res.status(500).send('Internal Server Error');
  }
});

// Ruta para cambiar el usuario predefinido de una empresa
router.put('/change-default-user', 
  authorize(['ADMIN', 'SUPERADMIN'], ['CONFIG']),
  async (req, res) => {
  const { companyId, userId } = req.body;
  console.log(`Request received with companyId: ${companyId} and userId: ${userId}`);
  
  if (!companyId || !userId) {
    console.error('Missing companyId or userId');
    return res.status(400).json({ error: 'Missing companyId or userId' });
  }

  try {
    const query = `
      INSERT INTO default_users (company_id, id_usuario, created_at, updated_at)
      VALUES ($1, $2, NOW(), NOW())
      ON CONFLICT (company_id)
      DO UPDATE SET id_usuario = EXCLUDED.id_usuario, updated_at = NOW()
      RETURNING *
    `;
    const result = await pool.query(query, [companyId, userId]);
    if (result.rows.length === 0) {
      console.log('Company not found');
      return res.status(404).json({ error: 'Company not found' });
    }
    console.log('Default user updated:', result.rows[0]);
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating or inserting default user:', error);
    res.status(500).send('Internal Server Error');
  }
});

router.get('/bots/:id', 
  authorize(['ADMIN', 'SUPERADMIN'], ['READ_BOTS', 'BOT_WHRITE', 'BOT_DELETE', 'CONFIG']),
  async (req, res) => {
  const { id } = req.params;
  try {
    const botQuery = 'SELECT * FROM bots WHERE id_usuario = $1';
    const botResult = await pool.query(botQuery, [id]);
    if (botResult.rows.length === 0) {
      return res.status(404).send('Bot not found');
    }
    res.json(botResult.rows[0]);
  } catch (error) {
    console.error('Error fetching bot:', error);
    res.status(500).send('Internal Server Error');
  }
});

router.put('/bots/:id', 
  authorize(['ADMIN', 'SUPERADMIN'], ['BOT_WHRITE', 'CONFIG']),
  async (req, res) => {
  const { id } = req.params;
  const { codigo, react_flow } = req.body;

  if (!codigo || !react_flow) {
    return res.status(400).send('Codigo and reactflow are required');
  }

  try {
    const updateQuery = 'UPDATE bots SET codigo = $1, react_flow = $2 WHERE id_usuario = $3';
    const updateResult = await pool.query(updateQuery, [codigo, react_flow, id]);

    if (updateResult.rowCount === 0) {
      return res.status(404).send('Bot not found');
    }

    res.send('Bot updated successfully');
  } catch (error) {
    console.error('Error updating bot:', error);
    res.status(500).send('Internal Server Error');
  }
});

router.post('/end-conversation', 
  authorize(['ADMIN', 'SUPERADMIN'], ['CONTACT_UPDATE', 'CONTACT_WRITE', 'READ_USERS_CONTACTS', 'READ_INFO_AUDIT', 'CONFIG']),
  async (req, res) => {
  const { conversationId, companyId } = req.body;

  try {
    // Actualizar el estado de la conversación
    const updateQuery = `
      UPDATE conversations
      SET state = 'new'
      WHERE conversation_id = $1
      RETURNING *;
    `;
    const result = await pool.query(updateQuery, [conversationId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    res.json({ message: 'Conversation state updated successfully', conversation: result.rows[0] });
  } catch (error) {
    console.error('Error updating conversation state:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/consumptions', 
  // authorize(['ADMIN', 'SUPERADMIN'], ['CONFIG']),
  async (req, res) => {
  console.log("Calculando costos");
  const { api_name, model, unit_type, unit_count, query_details, company_id, user_id, conversationId } = req.body;

  if (!api_name || !model || !unit_type || !unit_count || !query_details) {
    return res.status(400).send('Campos obligatorios faltantes');
  }

  try {
    // Obtener el precio unitario de la tabla api_pricing_models
    const pricingQuery = `
      SELECT cost_per_unit 
      FROM api_pricing_models 
      WHERE api_name = $1 AND model = $2 AND unit_type = $3
    `;
    const pricingResult = await pool.query(pricingQuery, [api_name, model, unit_type]);

    if (pricingResult.rows.length === 0) {
      return res.status(404).send('No se encontró el precio unitario para esta API, modelo y tipo de unidad');
    }

    const cost_per_unit = pricingResult.rows[0].cost_per_unit;

    // Calcular el costo total basado en los tokens usados (unit_count)
    const query_cost = cost_per_unit * unit_count;
    const sales_value = query_cost * 1.2;

    // Insertar el consumo en la tabla api_consumptions con query_date y query_time separados
    const insertQuery = `
      INSERT INTO api_consumptions (company_id, user_id, api_name, query_details, query_cost, sales_value, model, unit_count, conversation, query_date, query_time)
      VALUES ($1, $2, $3, $4, $5, $7, $6, $8, $9, CURRENT_DATE, CURRENT_TIME) RETURNING *;
    `;

    const insertResult = await pool.query(insertQuery, [
      company_id, 
      user_id || null, 
      api_name, 
      query_details, 
      query_cost, 
      model,
      sales_value,
      unit_count,
      conversationId
    ]);

    // Enviar la respuesta con el registro insertado
    res.status(201).json({ message: 'Consumo de API registrado exitosamente', consumption: insertResult.rows[0] });

  } catch (error) {
    console.error('Error al registrar el consumo de API:', error);
    res.status(500).send('Error interno del servidor');
  }
});


router.put('/consumptionsCompany',
  authorize(['ADMIN', 'SUPERADMIN'], ['READ_INFO_AUDIT','CONFIG']),
  async (req, res) => {
  const { company_id, month, year } = req.body;

  if (!company_id || !month || !year) {
      return res.status(400).json({ error: 'company_id, month y year son requeridos' });
  }

  try {
      const startDate = new Date(year, month - 1, 1);  // Primer día del mes
      const endDate = new Date(year, month, 0, 23, 59, 59, 999); // Último día del mes con hora máxima

      const query = `
          SELECT 
              query_date AS query_day,
              model,
              SUM(sales_value) AS total_sales_value
          FROM api_consumptions
          WHERE company_id = $1
            AND query_date BETWEEN $2 AND $3
          GROUP BY query_day, model
          ORDER BY query_day;
      `;

      const result = await pool.query(query, [company_id, startDate, endDate]);

      if (result.rows.length === 0) {
          // Responder con un objeto vacío que tenga la misma estructura que los datos válidos
          return res.status(200).json({
              message: 'No se encontraron consumos para este mes', 
              data: [
                {
                  query_day: null,
                  model: null,
                  total_sales_value: 0
                }
              ]
          });
      }

      res.status(200).json(result.rows);
  } catch (error) {
      console.error('Error al obtener los consumos:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
  }
});


// Ruta para obtener la tasa de cambio de una moneda
router.get('/currency/:currencyCode', 
  async (req, res) => {
  const { currencyCode } = req.params;

  try {
    const query = `
      SELECT exchange_rate 
      FROM currencies 
      WHERE currency_code = $1
    `;
    const result = await pool.query(query, [currencyCode.toUpperCase()]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Moneda no encontrada' });
    }

    res.status(200).json({ exchangeRate: result.rows[0].exchange_rate });
  } catch (error) {
    console.error('Error al obtener la tasa de cambio:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Ruta para obtener eventos por tipo de asignación e ID de asignación
router.get('/events', 
  authorize(['ADMIN', 'SUPERADMIN'], ['READ_INFO_AUDIT', 'CONFIG']),
  async (req, res) => {
  const { tipo_asignacion, id_asignacion, company_id } = req.query;

  console.log('Received parameters:', { tipo_asignacion, id_asignacion, company_id }); // Log de los parámetros recibidos

  if (!tipo_asignacion || !id_asignacion || !company_id) {
    console.error('Missing parameters:', { tipo_asignacion, id_asignacion, company_id }); // Log de parámetros faltantes
    return res.status(400).send('Faltan parámetros necesarios.');
  }

  try {
    const query = `
      SELECT * FROM eventos 
      WHERE tipo_asignacion = $1 AND id_asignacion = $2 AND company_id = $3
    `;
    console.log('Executing query:', query, [tipo_asignacion, id_asignacion, company_id]); // Log de la consulta y parámetros

    const result = await pool.query(query, [tipo_asignacion, id_asignacion, company_id]);
    console.log('Query result:', result.rows); // Log de los resultados obtenidos
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching events:', error); // Log del error
    res.status(500).send('Internal Server Error');
  }
});

// Ruta para crear un nuevo evento
router.post('/events', 
  authorize(['ADMIN', 'SUPERADMIN'], ['CONFIG']),
  async (req, res) => {
  const { titulo, descripcion, all_day, tipo_asignacion, id_asignacion, company_id } = req.body;
  const clientTimezone = req.body.timezone || 'America/Bogota'; // Usa la zona horaria proporcionada o una predeterminada

  // Validar y formatear las fechas con la zona horaria
  if (!req.body.fecha_inicio || !req.body.fecha_fin) {
    return res.status(400).send('Faltan fechas de inicio o fin.');
  }
  const fecha_inicio = moment.tz(req.body.fecha_inicio, clientTimezone).format();
  const fecha_fin = moment.tz(req.body.fecha_fin, clientTimezone).format();

  console.log('Received body:', { titulo, descripcion, fecha_inicio, fecha_fin, all_day, tipo_asignacion, id_asignacion, company_id });

  // Validar parámetros requeridos
  if (!titulo || !tipo_asignacion || !id_asignacion || !company_id) {
    console.error('Missing parameters in body:', { titulo, descripcion, fecha_inicio, fecha_fin, all_day, tipo_asignacion, id_asignacion, company_id });
    return res.status(400).send('Faltan parámetros necesarios.');
  }

  try {
    const query = `
      INSERT INTO eventos (titulo, descripcion, fecha_inicio, fecha_fin, all_day, tipo_asignacion, id_asignacion, company_id) 
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *
    `;
    console.log('Executing query:', query, [titulo, descripcion, fecha_inicio, fecha_fin, all_day, tipo_asignacion, id_asignacion, company_id]);

    const result = await pool.query(query, [titulo, descripcion, fecha_inicio, fecha_fin, all_day, tipo_asignacion, id_asignacion, company_id]);
    const createdEvent = result.rows[0];
    console.log('✔️ Evento creado:', createdEvent);

    // Consultar solicitudes externas de tipo 'crear'
    const requestQuery = `
      SELECT * FROM scheduling_requests
      WHERE assignment_type = $1 AND assignment_id = $2 AND company_id = $3 AND action = 'crear'
    `;
    const requestsResult = await pool.query(requestQuery, [tipo_asignacion, id_asignacion, company_id]);
    const requests = requestsResult.rows;
    console.log(`✔️ Solicitudes externas encontradas: ${requests.length}`);

    // Ejecutar cada solicitud
    for (const req of requests) {
      try {
        const payload = JSON.parse(req.request_payload);

        // Reemplazar {{campos}} en el body con datos del evento
        const bodyStr = JSON.stringify(payload.body);
        const replacedBodyStr = bodyStr.replace(/{{(.*?)}}/g, (_, field) => {
          return createdEvent[field] !== undefined ? createdEvent[field] : '';
        });
        payload.body = JSON.parse(replacedBodyStr);

        console.log(`🚀 Ejecutando solicitud a ${payload.url} con body:`, payload.body);

        // Hacer la solicitud externa
        await axios({
          method: payload.method,
          url: payload.url,
          headers: payload.headers,
          data: payload.body,
        });

        console.log(`✅ Solicitud ejecutada correctamente para ${payload.url}`);
      } catch (error) {
        console.error(`❌ Error ejecutando solicitud externa:`, error.message);
      }
    }

    res.status(201).json(createdEvent);
  } catch (error) {
    console.error('Error creating event:', error);
    res.status(500).send('Internal Server Error');
  }
});

// Ruta para editar un evento existente
router.put('/events/:id', 
  authorize(['ADMIN', 'SUPERADMIN'], ['CONFIG']),
  async (req, res) => {
  const { id } = req.params;
  const { titulo, descripcion, all_day, tipo_asignacion, id_asignacion, company_id } = req.body;
  const clientTimezone = req.body.timezone || 'America/Bogota';

  // Validar fechas
  if (!req.body.fecha_inicio || !req.body.fecha_fin) {
    return res.status(400).send('Faltan fechas de inicio o fin.');
  }
  const fecha_inicio = moment.tz(req.body.fecha_inicio, clientTimezone).format();
  const fecha_fin = moment.tz(req.body.fecha_fin, clientTimezone).format();

  console.log('Received body for update:', { id, titulo, descripcion, fecha_inicio, fecha_fin, all_day, tipo_asignacion, id_asignacion, company_id });

  // Validar parámetros requeridos
  if (!titulo || !tipo_asignacion || !id_asignacion || !company_id) {
    console.error('Missing parameters in body:', { titulo, descripcion, fecha_inicio, fecha_fin, all_day, tipo_asignacion, id_asignacion, company_id });
    return res.status(400).send('Faltan parámetros necesarios.');
  }

  try {
    const query = `
      UPDATE eventos
      SET titulo = $1, descripcion = $2, fecha_inicio = $3, fecha_fin = $4, all_day = $5, tipo_asignacion = $6, id_asignacion = $7, company_id = $8
      WHERE id_evento = $9
      RETURNING *
    `;
    console.log('Executing update query:', query, [titulo, descripcion, fecha_inicio, fecha_fin, all_day, tipo_asignacion, id_asignacion, company_id, id]);

    const result = await pool.query(query, [titulo, descripcion, fecha_inicio, fecha_fin, all_day, tipo_asignacion, id_asignacion, company_id, id]);

    if (result.rows.length === 0) {
      return res.status(404).send('Evento no encontrado.');
    }

    const updatedEvent = result.rows[0]; // ✅ Aquí es donde usas updatedEvent en lugar de createdEvent
    console.log('Updated event:', updatedEvent);

    // 🔍 Buscar solicitudes externas tipo 'editar'
    const extQuery = `
      SELECT * FROM scheduling_requests
      WHERE assignment_type = $1 AND assignment_id = $2 AND company_id = $3 AND action = 'editar'
    `;
    const extRequests = await pool.query(extQuery, [tipo_asignacion, id_asignacion, company_id]);

    // 🔄 Ejecutar las solicitudes externas si existen
    for (const reqConfig of extRequests.rows) {
      try {
        const payload = JSON.parse(reqConfig.request_payload);

        // Reemplazar campos en todo el payload
        const replacedPayloadStr = JSON.stringify(payload).replace(/{{(.*?)}}/g, (_, field) => {
          return updatedEvent[field] !== undefined ? updatedEvent[field] : '';
        });
        const replacedPayload = JSON.parse(replacedPayloadStr);

        console.log('Ejecutando solicitud externa (editar):', replacedPayload.method, replacedPayload.url);

        await axios({
          method: replacedPayload.method,
          url: replacedPayload.url,
          headers: replacedPayload.headers,
          data: replacedPayload.body
        });
      } catch (error) {
        console.error('❌ Error ejecutando solicitud externa (editar):', error.message);
      }
    }

    // ✅ Mover la respuesta aquí después de ejecutar las solicitudes externas
    res.status(200).json(updatedEvent);
  } catch (error) {
    console.error('Error updating event:', error);
    res.status(500).send('Internal Server Error');
  }
});

// Ruta para eliminar un evento
router.delete('/events/:id', 
  authorize(['ADMIN', 'SUPERADMIN'], ['CONFIG']),
  async (req, res) => {
  const { id } = req.params;

  console.log('Received request to delete event with id:', id);

  try {
    const query = 'DELETE FROM eventos WHERE id_evento = $1 RETURNING *';
    console.log('Executing delete query:', query, [id]);

    const result = await pool.query(query, [id]);

    if (result.rows.length === 0) {
      return res.status(404).send('Evento no encontrado.');
    }

    console.log('Deleted event:', result.rows[0]);
    res.status(200).json({ message: 'Evento eliminado correctamente.', evento: result.rows[0] });

    // 🔍 Buscar solicitudes externas tipo 'eliminar'
    const extQuery = `
      SELECT * FROM scheduling_requests
      WHERE assignment_type = $1 AND assignment_id = $2 AND company_id = $3 AND action = 'eliminar'
    `;
    const extRequests = await pool.query(extQuery, [deletedEvent.tipo_asignacion, deletedEvent.id_asignacion, deletedEvent.company_id]);

    // 🔄 Ejecutar cada solicitud externa
    for (const reqConfig of extRequests.rows) {
      try {
        const payload = JSON.parse(reqConfig.request_payload);

        // Reemplazo genérico en todo el payload
        const replacedPayloadStr = JSON.stringify(payload).replace(/{{(.*?)}}/g, (_, field) => {
          return deletedEvent[field] !== undefined ? deletedEvent[field] : '';
        });
        const replacedPayload = JSON.parse(replacedPayloadStr);

        console.log('Ejecutando solicitud externa (eliminar):', replacedPayload.method, replacedPayload.url);
        await axios({
          method: replacedPayload.method,
          url: replacedPayload.url,
          headers: replacedPayload.headers,
          data: replacedPayload.body
        });
      } catch (error) {
        console.error('❌ Error ejecutando solicitud externa (eliminar):', error.message);
      }
    }
  } catch (error) {
    console.error('Error deleting event:', error);
    res.status(500).send('Internal Server Error');
  }
});

router.post('/scheduling-requests',
  authorize(['ADMIN', 'SUPERADMIN'], ['CONFIG']),
  async (req, res) => {
    const { assignment_type, assignment_id, company_id, action, request_payload } = req.body;

    // Validar campos obligatorios
    if (!assignment_type || !assignment_id || !company_id || !action || !request_payload) {
      return res.status(400).json({ message: 'Faltan parámetros necesarios.' });
    }

    try {
      const query = `
        INSERT INTO scheduling_requests (assignment_type, assignment_id, company_id, action, request_payload)
        VALUES ($1, $2, $3, $4, $5) RETURNING *
      `;
      const values = [assignment_type, assignment_id, company_id, action, request_payload];

      const result = await pool.query(query, values);
      res.status(201).json(result.rows[0]);
    } catch (error) {
      console.error('Error creating scheduling request:', error);
      res.status(500).send('Internal Server Error');
    }
  }
);

router.get('/scheduling-requests/:assignment_type/:assignment_id',
  authorize(['ADMIN', 'SUPERADMIN'], ['CONFIG']),
  async (req, res) => {
    const { assignment_type, assignment_id } = req.params;

    try {
      const query = `
        SELECT * FROM scheduling_requests
        WHERE assignment_type = $1 AND assignment_id = $2
        ORDER BY created_at DESC
      `;
      const result = await pool.query(query, [assignment_type, assignment_id]);

      res.status(200).json(result.rows);
    } catch (error) {
      console.error('Error fetching scheduling requests:', error);
      res.status(500).send('Internal Server Error');
    }
  }
);

router.delete('/scheduling-requests/:id',
  authorize(['ADMIN', 'SUPERADMIN'], ['CONFIG']),
  async (req, res) => {
    const { id } = req.params;

    try {
      const query = `DELETE FROM scheduling_requests WHERE id = $1 RETURNING *`;
      const result = await pool.query(query, [id]);

      if (result.rows.length === 0) {
        return res.status(404).json({ message: 'Registro no encontrado.' });
      }

      res.status(200).json({ message: 'Registro eliminado.', data: result.rows[0] });
    } catch (error) {
      console.error('Error deleting scheduling request:', error);
      res.status(500).send('Internal Server Error');
    }
  }
);

// Ruta para obtener horarios por tipo de asignación e ID de asignación
router.get('/schedules', 
  authorize(['ADMIN', 'SUPERADMIN'], ['READ_INFO_AUDIT','CONFIG']),
  async (req, res) => {
  const { tipo_asignacion, id_asignacion, company_id } = req.query;

  console.log('Received parameters:', { tipo_asignacion, id_asignacion, company_id }); // Log de los parámetros recibidos

  if (!tipo_asignacion || !id_asignacion || !company_id) {
    console.error('Missing parameters:', { tipo_asignacion, id_asignacion, company_id }); // Log de parámetros faltantes
    return res.status(400).send('Faltan parámetros necesarios.');
  }

  try {
    const query = `
      SELECT * FROM horarios 
      WHERE tipo_asignacion = $1 AND id_asignacion = $2 AND company_id = $3
    `;
    console.log('Executing query:', query, [tipo_asignacion, id_asignacion, company_id]); // Log de la consulta y parámetros

    const result = await pool.query(query, [tipo_asignacion, id_asignacion, company_id]);
    console.log('Query result:', result.rows); // Log de los resultados obtenidos
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching schedules:', error); // Log del error
    res.status(500).send('Internal Server Error');
  }
});

// Ruta para crear un nuevo horario
router.post('/schedules', 
  authorize(['ADMIN', 'SUPERADMIN'], ['CONFIG']),
  async(req, res) => {
  const { dia, hora_inicio, hora_fin, tipo_asignacion, id_asignacion, company_id } = req.body;

  console.log('Received body:', { dia, hora_inicio, hora_fin, tipo_asignacion, id_asignacion, company_id }); // Log del cuerpo recibido

  if (!dia || !hora_inicio || !hora_fin || !tipo_asignacion || !id_asignacion || !company_id) {
    console.error('Missing parameters in body:', { dia, hora_inicio, hora_fin, tipo_asignacion, id_asignacion, company_id }); // Log de parámetros faltantes
    return res.status(400).send('Faltan parámetros necesarios.');
  }

  try {
    const query = `
      INSERT INTO horarios (dia, hora_inicio, hora_fin, tipo_asignacion, id_asignacion, company_id) 
      VALUES ($1, $2, $3, $4, $5, $6) RETURNING *
    `;
    console.log('Executing query:', query, [dia, hora_inicio, hora_fin, tipo_asignacion, id_asignacion, company_id]); // Log de la consulta y parámetros

    const result = await pool.query(query, [dia, hora_inicio, hora_fin, tipo_asignacion, id_asignacion, company_id]);
    console.log('Created schedule:', result.rows[0]); // Log del horario creado
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating schedule:', error); // Log del error
    res.status(500).send('Internal Server Error');
  }
});


return router;
}