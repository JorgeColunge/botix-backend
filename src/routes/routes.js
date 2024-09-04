import express from 'express';
import pool from '../config/dbConfig.js';
import { processMessage } from '../handlers/messageHandler.js';
import { sendTextMessage, sendImageMessage, sendVideoMessage, sendDocumentMessage, sendAudioMessage, sendTemplateMessage, sendTemplateToSingleContact } from '../handlers/repliesHandler.js';
import multer from 'multer';
import csv from 'csv-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import fs from 'fs';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';

import ffmpeg from 'fluent-ffmpeg';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// Configurar ffmpeg
ffmpeg.setFfmpegPath(ffmpegInstaller.path);
// Definimos la función que acepta 'io' como parámetro y devuelve el router configurado
export default function createRouter(io) {
const router = express.Router();


  router.post('/new-message', async (req, res) => {
  const { senderId, messageData } = req.body;
  try {
    await processMessage(io, senderId, messageData);
    io.emit('new-message', { senderId, messageData }); // El servidor emite el evento
    console.log('Emitido yeees')
    res.status(200).send('Mensaje recibido y emitido');
  } catch (error) {
    console.error('Error processing message:', error);
    res.status(500).send('Hubo un error al procesar el mensaje');
  }
});
 
router.post('/reset-unread/:conversationId', async (req, res) => {
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

router.get('/conversations/:conversationId', async (req, res) => {
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
      last_message_info.message_type
    FROM 
      conversations c
    LEFT JOIN users u ON c.id_usuario = u.id_usuario
    LEFT JOIN contacts ct ON c.contact_id = ct.id
    LEFT JOIN department_phases dp ON ct.label = dp.id
    LEFT JOIN LATERAL (
      SELECT
        sub.last_message,
        sub.last_message_time,
        sub.message_type
      FROM (
        SELECT
          message_text AS last_message,
          received_at AS last_message_time,
          message_type
        FROM messages
        WHERE conversation_fk = c.conversation_id
        UNION
        SELECT
          reply_text AS last_message,
          created_at AS last_message_time,
          reply_type AS message_type
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

router.get('/conversations', async (req, res) => {
  const userId = req.query.id_usuario;
  const userRole = req.query.rol;
  const companyId = req.query.company_id;

  const getUserPrivileges = async (roleId) => {
    const query = `
      SELECT pr.name
      FROM privileges_roles pr
      JOIN roles r ON pr.role_id = r.id
      WHERE r.id = $1
    `;
    const { rows } = await pool.query(query, [roleId]);
    return rows.map(row => row.name);
  };

  try {
    const privileges = await getUserPrivileges(userRole);
    let query = `
      SELECT
        c.conversation_id,
        c.contact_id,
        c.phone_number,
        c.state,
        c.last_update,
        c.unread_messages,
        c.id_usuario,
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
        last_message_info.last_message,
        last_message_info.last_message_time,
        last_message_info.message_type
      FROM 
        conversations c
      LEFT JOIN users u ON c.id_usuario = u.id_usuario
      LEFT JOIN contacts ct ON c.contact_id = ct.id
      LEFT JOIN LATERAL (
        SELECT
          sub.last_message,
          sub.last_message_time,
          sub.message_type
        FROM (
          SELECT
            message_text AS last_message,
            received_at AS last_message_time,
            message_type
          FROM messages
          WHERE conversation_fk = c.conversation_id
          UNION
          SELECT
            reply_text AS last_message,
            created_at AS last_message_time,
            reply_type AS message_type
          FROM replies
          WHERE conversation_fk = c.conversation_id
        ) sub
        ORDER BY sub.last_message_time DESC
        LIMIT 1
      ) last_message_info ON true
    `;

    if (privileges.includes('SuperAdmin')) {
      // No additional filtering needed for SuperAdmin
    } else if (privileges.includes('Admin') || privileges.includes('Show All Conversations')) {
      query += ` WHERE u.company_id = $1`;
      const { rows } = await pool.query(query, [companyId]);
      res.json(rows);
    } else {
      query += ` WHERE c.id_usuario = $1`;
      const { rows } = await pool.query(query, [userId]);
      res.json(rows);
    }
  } catch (error) {
    console.error('Error fetching conversations:', error);
    res.status(500).send('Internal Server Error');
  }
});

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

router.get('/messages/:id', async (req, res) => {
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
        NULL as state
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
        state
      FROM replies
      WHERE conversation_fk = $1
    ) AS combined
    ORDER BY timestamp DESC
    OFFSET $2
    LIMIT 50;
  `;

  try {
    const result = await pool.query(query, [id, offset]);
    const messagesWithMedia = result.rows.map(row => ({
      ...row,
      url: getMediaUrl(row.message_type, row.media_url, row.latitude, row.longitude),
      thumbnail_url: getThumbnailUrl(row.message_type, row.thumbnail_url)
    }));
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

router.get('/contacts/:phoneNumber', async (req, res) => {
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

// Ruta para actualizar los datos de contacto
router.put('/contacts/:phoneNumber', async (req, res) => {
  const { phoneNumber } = req.params;
  const { first_name, last_name, organization, label } = req.body;
  try {
    const updateResult = await pool.query('UPDATE contacts SET first_name = $1, last_name = $2, organization = $3, label = $4 WHERE phone_number = $5',
    [first_name, last_name, organization, label, phoneNumber]);
    if (updateResult.rowCount > 0) {
      res.json({ message: 'Contact updated successfully' });
    } else {
      res.status(404).send('Contact not found');
    }
  } catch (err) {
    console.error('Error updating contact:', err);
    res.status(500).send('Internal Server Error');
  }
});

router.get('/users', async (req, res) => {
  const { company_id } = req.query;
  try {
    const query = 'SELECT * FROM users WHERE company_id = $1';
    const result = await pool.query(query, [company_id]);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).send('Internal Server Error');
  }
});

router.get('/roles/:companyId', async (req, res) => {
  const { companyId } = req.params;
  try {
    const query = 'SELECT * FROM roles WHERE company_id = $1';
    const result = await pool.query(query, [companyId]);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching roles:', error);
    res.status(500).send('Internal Server Error');
  }
});

router.get('/departments/:companyId', async (req, res) => {
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

router.post('/api/users', async (req, res) => {
  const { nombre, apellido, telefono, email, rol, department_id, company_id } = req.body;

  try {
    const result = await pool.query(
      'INSERT INTO users (nombre, apellido, telefono, email, rol, department_id, company_id) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
      [nombre, apellido, telefono, email, rol, department_id, company_id]
    );
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error creating new user:', error);
    res.status(500).send('Internal Server Error');
  }
});

router.put('/users/:id', async (req, res) => {
  const { id } = req.params;
  const { nombre, apellido, telefono, email, link_foto, rol, department_id } = req.body;

  try {
    const updateQuery = `
      UPDATE users
      SET nombre = $1, apellido = $2, telefono = $3, email = $4, link_foto = $5, rol = $6, department_id = $7
      WHERE id_usuario = $8
      RETURNING *;
    `;

    const result = await pool.query(updateQuery, [nombre, apellido, telefono, email, link_foto, rol, department_id, id]);
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating user data:', error);
    res.status(500).send('Internal Server Error');
  }
});


router.delete('/users/:id', async (req, res) => {
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

router.post('/upload-profile', uploadProfile.single('profile'), (req, res) => {
  if (!req.file) {
    return res.status(400).send('No file uploaded');
  }
  res.json({ profileUrl: `/media/users/profile/${req.file.filename}` });
});

router.post('/upload-profileContact', uploadProfileContact.single('profile'), (req, res) => {
  if (!req.file) {
    return res.status(400).send('No file uploaded');
  }
  res.json({ profileUrl: `/media/contacts/profile/${req.file.filename}` });
});


router.post('/messages/send-text', (req, res) => {
  sendTextMessage(io, req, res);
});

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
    const mimeTypes = ['audio/wav'];
    if (mimeTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only WAV audio is allowed.'));
    }
  }
});

// Ruta para manejar la subida de imágenes
router.post('/upload-image', uploadImage.single('image'), (req, res) => {
  try {
    const imageUrl = '/media/images/' + req.file.filename;
    res.json({ imageUrl: imageUrl });
  } catch (error) {
    console.error('Error uploading image:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Ruta para manejar la subida de videos
router.post('/upload-video', uploadVideo.single('video'), async (req, res) => {
  try {
    const videoUrl = '/media/videos/' + req.file.filename;
    const videoDuration = await getVideoDurationInSeconds(req.file.path);
    const videoThumbnail = await createThumbnail(req.file.path);
    res.json({ videoUrl, videoDuration, videoThumbnail });
    console.log(`duración: ${videoDuration}`)
    console.log(`miniatura: ${videoThumbnail}`)
  } catch (error) {
    console.error('Error uploading video:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

const createThumbnail = (videoPath) => new Promise((resolve, reject) => {
  const thumbnailFilename = `thumbnail-${path.basename(videoPath, path.extname(videoPath))}.png`;
  const thumbnailDir = path.join(__dirname, '..', '..', 'public','media', 'thumbnails');

  if (!fs.existsSync(thumbnailDir)) {
    fs.mkdirSync(thumbnailDir, { recursive: true });
  }

  ffmpeg(videoPath)
    .on('end', () => resolve(`/media/thumbnails/${thumbnailFilename}`))
    .on('error', (err) => reject(err))
    .output(thumbnailPath)
    .outputOptions([
      '-vf', 'crop=min(iw\\,ih):min(iw\\,ih),scale=290:290', // Crop to square then scale
      '-frames:v', '1' // Only output one frame
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
router.post('/upload-document', uploadDocument.single('document'), (req, res) => {
  try {
    const documentUrl = '/media/documents/' + req.file.filename;
    res.json({ documentUrl });
  } catch (error) {
    console.error('Error uploading document:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Ruta para manejar la subida de audios
router.post('/upload-audio', uploadAudio.single('audio'), (req, res) => {
  const tempFilePath = req.file.path;
  const processedFilePath = path.join('public', 'media', 'audios', req.file.filename.replace('.wav', '.ogg'));

  ffmpeg(tempFilePath)
    .audioChannels(1) // Convertir a mono
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
      res.json({ audioUrl: '/media/audios/' + req.file.filename.replace('.wav', '.ogg') });
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

router.post('/messages/send-image', (req, res) => {
  sendImageMessage(io, req, res);
});

router.post('/messages/send-video', (req, res) => {
  sendVideoMessage(io, req, res);
});

router.post('/messages/send-document', (req, res) => {
  sendDocumentMessage(io, req, res);
});

router.post('/messages/send-audio', (req, res) => {
  sendAudioMessage(io, req, res);
});

// Ruta para obtener los datos del usuario
router.get('/user/:id_usuario', async (req, res) => {
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
router.get('/company/:id', async (req, res) => {
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

router.put('/company/:id', async (req, res) => {
  const { id } = req.params;
  const { name, document_type, document_number, address, city, country, postal_code, email, phone, logo, web, instagram, facebook, twiter, tiktok, youtube } = req.body;

  try {
    const updateQuery = `
      UPDATE companies
      SET name = $1, document_type = $2, document_number = $3, address = $4, city = $5, country = $6,
          postal_code = $7, email = $8, phone = $9, web = $10, instagram = $11, facebook = $12,
          twiter = $13, tiktok =$14, youtube = $15, logo = $16
      WHERE id = $17
      RETURNING *;
    `;

    const result = await pool.query(updateQuery, [name, document_type, document_number, address, city, country, postal_code, email, phone, web, instagram, facebook, twiter, tiktok, youtube, logo, id]);
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

router.post('/upload-logo', uploadLogo.single('logo'), (req, res) => {
  if (!req.file) {
    return res.status(400).send('No file uploaded');
  }
  res.json({ logoUrl: `/media/companies/logos/${req.file.filename}` });
});

router.get('/privileges/:userId', async (req, res) => {
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
router.get('/role/:roleId', async (req, res) => {
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
router.get('/license/:companyId', async (req, res) => {
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
router.get('/integrations/:licenseId', async (req, res) => {
  const { licenseId } = req.params;
  try {
    const query = 'SELECT * FROM integrations WHERE license_id = $1';
    const result = await pool.query(query, [licenseId]);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching integrations:', error);
    res.status(500).send('Internal Server Error');
  }
});

// Ruta para obtener las automatizacioness de la empresa
router.get('/automations/:licenseId', async (req, res) => {
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
router.get('/contacts/count/:companyId', async (req, res) => {
  const { companyId } = req.params;
  try {
    const query = 'SELECT COUNT(*) as count FROM contacts WHERE company_id = $1';
    const result = await pool.query(query, [companyId]);
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching contacts count:', error);
    res.status(500).send('Internal Server Error');
  }
});

// Ruta para agregar automatización
router.post('/automations', async (req, res) => {
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

router.post('/create-contact', uploadProfileContact.single('profile'), async (req, res) => {
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
    cb(null, path.join(__dirname, '..', '..', 'upload', 'contacts'));
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + '-' + file.originalname);
  }
});

const upload = multer({ storage: storageCSV });

// Ruta para cargar un archivo CSV con contactos
router.post('/contacts/upload-csv', upload.single('csv'), async (req, res) => {
  if (!req.file) {
    return res.status(400).send('No file uploaded');
  }

  const contacts = [];
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
        const query = 'INSERT INTO contacts (phone_number, first_name, last_name, organization, label, email, company_id) VALUES ($1, $2, $3, $4, $5, $6, $7)';
        for (const contact of contacts) {
          await pool.query(query, [contact.phone_number, contact.first_name, contact.last_name, contact.organization, contact.label, contact.email, contact.company_id]);
        }
        fs.unlinkSync(req.file.path); // Eliminar el archivo CSV después de procesarlo
        res.status(200).send('CSV file processed successfully');
      } catch (error) {
        console.error('Error processing CSV file:', error);
        res.status(500).send('Internal Server Error');
      }
    });
});

// Ruta para obtener la cantidad de roles por ID de la empresa
router.get('/roles/count/:companyId', async (req, res) => {
  const { companyId } = req.params;
  try {
    const query = 'SELECT COUNT(*) as count FROM roles WHERE company_id = $1';
    const result = await pool.query(query, [companyId]);
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching roles count:', error);
    res.status(500).send('Internal Server Error');
  }
});

// Ruta para obtener la cantidad de organizaciones por ID de la empresa
router.get('/organizations/count/:companyId', async (req, res) => {
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

router.post('/organizations', async (req, res) => {
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

router.post('/roles', async (req, res) => {
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
router.get('/departments/:departmentId/phases', async (req, res) => {
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
router.post('/departments/:departmentId/phases', async (req, res) => {
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
router.put('/departments/phases/:id', async (req, res) => {
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

router.post('/integrations', async (req, res) => {
  const { type, name, license_id, company_id, WHATSAPP_API_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_APP_ID, WHATSAPP_BUSINESS_ACCOUNT_ID } = req.body;

  try {
    const query = 'INSERT INTO integrations (type, name, license_id, company_id, WHATSAPP_API_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_APP_ID, WHATSAPP_BUSINESS_ACCOUNT_ID) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *';
    const result = await pool.query(query, [type, name, license_id, company_id, WHATSAPP_API_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_APP_ID, WHATSAPP_BUSINESS_ACCOUNT_ID]);
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error creating integration:', error);
    res.status(500).send('Internal Server Error');
  }
});

router.put('/edit-contact/:id', uploadProfileContact.single('profile'), async (req, res) => {
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

router.get('/company/:companyId/phases', async (req, res) => {
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

router.get('/users/conversation-stats/:companyId', async (req, res) => {
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

router.get('/contacts', async (req, res) => {
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

router.get('/templates', async (req, res) => {
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

router.get('/campaigns', async (req, res) => {
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
router.post('/campaigns', async (req, res) => {
  const { name, objective, type, template_id, scheduled_launch, state_conversation, company_id } = req.body;

  try {
    const query = `
      INSERT INTO campaigns (name, objective, type, template_id, scheduled_launch, state_conversation, company_id) 
      VALUES ($1, $2, $3, $4, $5, $6, $7) 
      RETURNING *
    `;
    const values = [name, objective, type, template_id, scheduled_launch || null, state_conversation, company_id];
    const result = await pool.query(query, values);
    res.status(201).send(result.rows[0]);
  } catch (error) {
    console.error('Error creating campaign:', error.message);
    res.status(500).send({ error: error.message });
  }
});

// Asociar responsables a una campaña
router.post('/campaigns/:campaignId/responsibles', async (req, res) => {
  const { campaignId } = req.params;
  const { responsible_ids } = req.body;

  try {
    const query = 'INSERT INTO campaign_responsibles (campaign_id, user_id) VALUES ($1, $2)';
    for (let userId of responsible_ids) {
      await pool.query(query, [campaignId, userId]);
    }
    res.status(200).send({ message: 'Responsibles associated with campaign successfully.' });
  } catch (error) {
    console.error('Error associating responsibles with campaign:', error.message);
    res.status(500).send({ error: error.message });
  }
});

// Actualizar una campaña
router.put('/campaigns/:id', async (req, res) => {
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
router.delete('/campaigns/:id', async (req, res) => {
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
router.post('/campaigns/:campaignId/contacts', async (req, res) => {
  const { campaignId } = req.params;
  const { contact_ids } = req.body;

  try {
    const query = 'INSERT INTO campaign_contacts (campaign_id, contact_id) VALUES ($1, $2)';
    for (let contactId of contact_ids) {
      await pool.query(query, [campaignId, contactId]);
    }
    res.status(200).send({ message: 'Contacts associated with campaign successfully.' });
  } catch (error) {
    console.error('Error associating contacts with campaign:', error.message);
    res.status(500).send({ error: error.message });
  }
});

router.put('/campaigns/:campaignId/contacts', async (req, res) => {
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
      WHERE campaign_id = $1 
      AND contact_id = ANY($2::int[])
    `;
    await pool.query(deleteContactsQuery, [campaignId, existingContacts]);

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

router.put('/campaigns/:campaignId/responsibles', async (req, res) => {
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
router.get('/contactsCampaign', async (req, res) => {
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

router.get('/phases/:companyId', async (req, res) => {
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

router.post('/launch-campaign/:campaignId', async (req, res) => {
  sendTemplateMessage(io, req, res);
});

router.post('/send-template', async (req, res) => {
  sendTemplateToSingleContact(io, req, res);
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

router.get('/conversation-variable-values/:templateId/:conversationId', async (req, res) => {
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
router.get('/default-user/:companyId', async (req, res) => {
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
router.put('/change-default-user', async (req, res) => {
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

router.get('/bots/:id', async (req, res) => {
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

router.put('/bots/:id', async (req, res) => {
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

router.post('/end-conversation', async (req, res) => {
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

return router;
}