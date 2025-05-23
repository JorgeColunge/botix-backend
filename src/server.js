import dotenv from 'dotenv';
import express from 'express';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
// import { createServer as createHttpServer } from 'http';
import { createServer as createHttpsServer } from 'https';
import bodyParser from 'body-parser';
import cors from 'cors';
import { executeBotCode } from './handlers/botExecutor.js';
import upload from './handlers/upload.js';
import createRouter from './routes/routes.js';
import pool from './config/dbConfig.js';
import authRoutes from './routes/authRoutes.js'
import { verifyToken } from './middlewares/authMiddleware.js';
import axios from 'axios';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import FormData from 'form-data';
import sharp from 'sharp';
import bcrypt from 'bcrypt';
import geoip from 'geoip-lite';
import moment from 'moment-timezone';
import { processMessage, updateConversationState, getOrCreateContact, getContactInfo, updateContactName, createContact, updateContactCompany, getReverseGeocoding, getGeocoding, assignResponsibleUser } from './handlers/messageHandler.js'
import { sendTextMessage, sendImageMessage, sendVideoMessage, sendDocumentMessage, sendAudioMessage, sendTemplateMessage, sendTemplateToSingleContact, sendLocationMessage } from './handlers/repliesHandler.js';
import db from './models/index.js';
import { authorize } from './middlewares/authorizationMiddleware.js';
import jwt from 'jsonwebtoken';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config();
const app = express();
const PORT = process.env.PORT || 3001;

const privateKeyPath = '/home/ec2-user/certificates/privkey.pem';
const certificatePath = '/home/ec2-user/certificates/fullchain.pem';
const caPath = '/home/ec2-user/certificates/chain.pem';

// Leer los archivos de certificados SSL
const privateKey = fs.readFileSync(privateKeyPath, 'utf8');
const certificate = fs.readFileSync(certificatePath, 'utf8');
const ca = fs.readFileSync(caPath, 'utf8');

const credentials = { key: privateKey, cert: certificate, ca: ca };

console.log('FRONTEND_URL:', process.env.FRONTEND_URL);
console.log('BACKEND_URL:', process.env.BACKEND_URL);


// Configuración de CORS y otros middleware
app.use(cors({
  origin: [process.env.FRONTEND_URL, 'https://localhost'], // Ajusta según sea necesario para tu ambiente de producción
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true
}));
app.use(express.json({ limit: '500mb' }));
app.use(bodyParser.json({ limit: '500mb' }));
app.use((req, res, next) => {
  console.log(`Received ${req.method} request to ${req.path}`);
  next();
});

// Configuración del servidor HTTP y Socket.IO
const httpsServer = createHttpsServer(credentials, app);
const io = new SocketIOServer(httpsServer, {
  cors: {
    origin: [process.env.FRONTEND_URL, 'https://localhost'],
    methods: ['GET', 'POST'],
    credentials: true
  }
});

// app.use(cors({
//   origin: [process.env.FRONTEND_URL, 'https://localhost'], // Ajusta según sea necesario para tu ambiente de producción
//   methods: ['GET', 'POST', 'PUT', 'DELETE'],
//   credentials: true
// }));
// app.use(express.json({ limit: '1gb' })); // Aumenta el límite si es necesario
// app.use(bodyParser.json({ limit: '1gb' }));
// app.options('*', cors()); // Habilita CORS para todas las rutas  
// app.use((req, res, next) => {
//   console.log(`Received ${req.method} request to ${req.path}`);
//   next();
// });

// // Configuración del servidor HTTP y Socket.IO
// const server = createServer(app);
// const io = new SocketIOServer(server, {
//   cors: {
//     origin: [process.env.FRONTEND_URL, 'https://localhost'], // Asegúrate de que coincide con el puerto y host del cliente
//     methods: ['GET', 'POST'],
//     credentials: true
//   }
// });

io.on('connection', (socket) => {
  console.log('Un cliente se ha conectado, ID del socket:', socket.id);

  // Suponiendo que recibimos el id_usuario como parte del query al conectar
  const userId = socket.handshake.query.id_usuario;
  console.log(`id_usuario ${userId}`)
  if (userId) {
    socket.join(`user-${userId}`);  // Unir al usuario a una sala específica basada en su id_usuario
  }

  socket.on('joinConversation', conversationId => {
    console.log(`Cliente ${socket.id} se ha unido a la conversación: ${conversationId}`);
    socket.join(conversationId);
    socket.on('newMessage', (message) => {
      console.log(`Emitting newMessage to conversationId: ${conversationId}`);
      io.to(conversationId).emit('newMessage', message);
    });
  });
  socket.on('leaveConversation', conversationId => {
    console.log(`Cliente ${socket.id} ha dejado la conversación: ${conversationId}`);
    socket.leave(conversationId);
  });
  socket.on('disconnect', () => {
    console.log('Cliente desconectado:', socket.id);
  });

  socket.on('updateContact', async (contactData) => {
    console.log('Actualizando contacto:', contactData);
    try {
      const query = `
      UPDATE contacts SET
        first_name = $1, last_name = $2, email = $3, organization = $4, label = $5,
        profile_url = $6, edad_approx = $7, fecha_nacimiento = $8, nacionalidad = $9,
        ciudad_residencia = $10, direccion_completa = $11, genero = $12, pagina_web = $13,
        link_instagram = $14, link_facebook = $15, link_linkedin = $16, link_twitter = $17,
        link_tiktok = $18, link_youtube = $19, nivel_ingresos = $20, ocupacion = $21,
        nivel_educativo = $22, estado_civil = $23, cantidad_hijos = $24, estilo_de_vida = $25,
        personalidad = $26, cultura = $27, preferencias_contacto = $28, historial_compras = $29,
        historial_interacciones = $30, observaciones_agente = $31, fecha_creacion_cliente = $32
      WHERE phone_number = $33
      RETURNING *;
    `;
      const values = [
        contactData.first_name, contactData.last_name, contactData.email, contactData.organization, contactData.label,
        contactData.profile_url, contactData.edad_approx, contactData.fecha_nacimiento, contactData.nacionalidad,
        contactData.ciudad_residencia, contactData.direccion_completa, contactData.genero, contactData.pagina_web,
        contactData.link_instagram, contactData.link_facebook, contactData.link_linkedin, contactData.link_twitter,
        contactData.link_tiktok, contactData.link_youtube, contactData.nivel_ingresos, contactData.ocupacion,
        contactData.nivel_educativo, contactData.estado_civil, contactData.cantidad_hijos, contactData.estilo_de_vida,
        contactData.personalidad, contactData.cultura, contactData.preferencias_contacto, contactData.historial_compras,
        contactData.historial_interacciones, contactData.observaciones_agente, contactData.fecha_creacion_cliente,
        contactData.phone_number
      ];

      const result = await pool.query(query, values);
      if (result.rows.length > 0) {
        console.log('Contacto actualizado con éxito:', result.rows[0]);
        socket.emit('contactUpdated', result.rows[0]); // Emitir evento con los datos actualizados
      } else {
        console.log('No se encontró el contacto para actualizar');
      }
    } catch (error) {
      console.error('Error al actualizar contacto:', error);
    }
  });

  socket.on('changeResponsible', async (data) => {
    const { conversationId, newUserId, oldUserId } = data;
    console.log(`Attempting to change responsible for conversationId: ${conversationId} to newUserId: ${newUserId} from oldUserId: ${oldUserId}`);

    try {
      const updateQuery = `UPDATE conversations SET id_usuario = $1 WHERE conversation_id = $2 RETURNING *;`;
      const result = await pool.query(updateQuery, [newUserId, conversationId]);

      if (result.rows.length > 0) {
        const updatedConversation = result.rows[0];
        console.log(`Responsible changed successfully for conversationId: ${conversationId}, emitting events to new and old users.`);

        // Emitir al nuevo responsable y al antiguo si es diferente
        io.to(`user-${newUserId}`).emit('responsibleChanged', {
          conversationId,
          newUserId,
          updatedConversation
        });
        console.log(`Emitted responsibleChanged to newUserId: ${newUserId}`);

        if (oldUserId && oldUserId !== newUserId) {
          io.to(`user-${oldUserId}`).emit('responsibleRemoved', {
            conversationId
          });
          console.log(`Emitted responsibleRemoved to oldUserId: ${oldUserId}`);
        }

        // Emitir un evento general para actualizar la información en usuarios con permisos de visualización
        io.emit('updateConversationInfo', {
          conversationId,
          updatedConversation
        });
        console.log(`Emitted updateConversationInfo to all connected users for conversationId: ${conversationId}`);
      } else {
        console.log(`No conversation found with conversationId: ${conversationId}, emitting error.`);
        socket.emit('errorChangingResponsible', 'Conversation not found');
      }
    } catch (error) {
      console.error('Error changing conversation responsible:', error);
      socket.emit('errorChangingResponsible', 'Internal Server Error');
    }
  });
});

// Aplicar el middleware de verificación de token a las rutas que lo necesiten
app.use('/api/protected-route', verifyToken, (req, res) => {
  res.send('Esta es una ruta protegida.');
});


// Inicializar rutas con io
const router = createRouter(io);

const staticFileMiddleware = (folder) => {
  return async (req, res, next) => {
    try {
      const token = req.query.token || req.headers['x-token'];

      if (!token) throw new Error('Token no proporcionado');

      const decoded = jwt.verify(token, process.env.JWT_SECRET); // Ajusta tu clave secreta
      const filePath = path.join(__dirname, 'public', folder, req.path);

      // Si el token es válido, sirve el archivo estático
      res.sendFile(filePath, (err) => {
        if (err) {
          next(); // Llama a next si no se encuentra el archivo
        }
      });
    } catch (error) {
      console.error('Error al autorizar acceso a archivo:', error.message);
      res.status(403).json({ message: 'Acceso denegado' });
    }
  };
};

app.use('/api', router);
app.use('/images', staticFileMiddleware('image'), express.static('public/image'));
app.use('/media', staticFileMiddleware('media'), express.static('public/media'));
app.use('/thumbnail', staticFileMiddleware('thumbnail'), express.static('public/thumbnail'));
app.use('/api/auth', authRoutes);

// Función para responder inmediatamente a WhatsApp
function respondToWhatsApp(req, res) {
  res.status(200).send({ status: 'received' });
  console.log(`Received message at ${new Date().toISOString()}`);
}



// Endpoint del webhook
app.post('/webhook', async (req, res) => {
  console.log(`Webhook received at ${new Date().toISOString()}: ${JSON.stringify(req.body, null, 2)}`);

  respondToWhatsApp(req, res);

  try {
    if (!req.body || !req.body.entry) {
      console.log('No entries in request');
      return;
    }

    const entries = req.body.entry;
    for (const entryItem of entries) {
      if (!entryItem.changes) {
        console.log('No changes in entry');
        continue;
      }

      for (const change of entryItem.changes) {
        if (change.field === 'message_template_status_update' && change.value && change.value.message_template_id) {
          const templateId = change.value.message_template_id;
          const status = change.value.event;

          io.emit('templateStatusUpdate', { templateId, status });
          console.log(`Emitted templateStatusUpdate event for templateId: ${templateId} with status: ${status}`);

          // Actualizar el estado del template en la base de datos
          try {
            const query = `
              UPDATE templates_wa
              SET state = $1
              WHERE id = $2
            `;
            await pool.query(query, [status, templateId]);
            console.log(`Template ${templateId} updated to state ${status}`);
          } catch (error) {
            console.error('Error updating template status:', error);
          }
          continue;
        }

        if (change.value && change.value.statuses && change.value.statuses.length > 0) {
          for (const statusUpdate of change.value.statuses) {
            const messageId = statusUpdate.id;
            const status = statusUpdate.status;

            const conversationFk = await updateReplyStatus(messageId, status);

            io.emit('replyStatusUpdate', { messageId, status, conversationFk });
            console.log(`Emitted replyStatusUpdate event for messageId: ${messageId} with status: ${status}`);
          }
          continue;
        }

        if (!change.value || !change.value.contacts || !change.value.contacts[0]) {
          console.log('Invalid message data structure');
          continue;
        }

        const messageData = change.value;
        const senderId = messageData.contacts[0].wa_id;
        const phone_number_id = messageData.metadata.phone_number_id;

        const integrationDetails = await getIntegrationDetails(phone_number_id);

        if (messageData.messages && messageData.messages.length > 0) {
          const firstMessage = messageData.messages[0];

          let context = null;
          if (firstMessage.context) {
            context = {
              from: firstMessage.context.id,
              type_from: 'reply'
            };
          }

          const messageId = firstMessage.id; // Extraer el ID del mensaje

          switch (firstMessage.type) {
            case 'text':
              if (firstMessage.text) {
                await processMessage(io, senderId, { id: messageId, type: 'text', text: firstMessage.text.body, context }, "no", integrationDetails, req);
              }
              break;
            case 'reaction':
              await processMessage(io, senderId, { id: messageId, type: 'reaction', reaction: firstMessage.reaction, context, senderId: firstMessage.from }, "si", integrationDetails, req);
              break;
            case 'location':
              if (firstMessage.location) {
                await processMessage(io, senderId, {
                  id: messageId,
                  type: 'location',
                  latitude: firstMessage.location.latitude,
                  longitude: firstMessage.location.longitude,
                  context
                }, null, integrationDetails, req, null);
              }
              break;
            case 'image':
              await processMessage(io, senderId, { id: messageId, type: 'image', image: firstMessage.image, context }, "no", integrationDetails, req);
              break;
            case 'audio':
              await processMessage(io, senderId, { id: messageId, type: 'audio', audio: firstMessage.audio, context }, "no", integrationDetails, req);
              break;
            case 'video':
              await processMessage(io, senderId, { id: messageId, type: 'video', video: firstMessage.video, context }, "no", integrationDetails, req);
              break;
            case 'document':
              const file_name = firstMessage.document.filename;
              await processMessage(io, senderId, { id: messageId, type: 'document', document: firstMessage.document, file_name, context }, "no", integrationDetails, req);
              break;
            case 'sticker':
              await processMessage(io, senderId, { id: messageId, type: 'sticker', sticker: firstMessage.sticker, context }, "no", integrationDetails, req);
              break;
            case 'button':
              if (firstMessage.button) {
                await processMessage(io, senderId, { id: messageId, type: 'button', text: firstMessage.button.text, context }, "no", integrationDetails, req);
              }
              break;
            default:
              console.log('Unsupported message type');
          }
        } else {
          console.log('No messages found in the change object');
        }
      }
    }
  } catch (error) {
    console.error('Error handling webhook:', error);
  }
});

const updateReplyStatus = async (messageId, status) => {
  try {
    const query = `
      UPDATE replies
      SET state = $1
      WHERE replies_id = $2
      RETURNING conversation_fk
    `;
    const result = await pool.query(query, [status, messageId]);
    console.log(`Reply ${messageId} updated to state ${status}`);
    return result.rows[0]?.conversation_fk; // Devuelve el conversation_fk
  } catch (error) {
    console.error('Error updating reply status:', error);
    throw error; // Lanza el error para manejarlo fuera si es necesario
  }
};

app.post('/upload', upload.single('image'), (req, res) => {
  console.log("solicitud", req.file)
  if (req.file) {
    const imagePath = req.file.path;
    res.json({ success: true, path: imagePath });
    console.log(imagePath)

  } else {
    res.status(400).send('No se pudo subir el archivo');
  }
});

app.post('/upload', upload.single('video'), (req, res) => {
  if (req.file) {
    const imagePath = req.file.path;
    res.json({ success: true, path: imagePath });
  } else {
    res.status(400).send('No se pudo subir el archivo');
  }
});

app.post('/upload', upload.single('document'), (req, res) => {
  if (req.file) {
    const imagePath = req.file.path;
    res.json({ success: true, path: imagePath });
  } else {
    res.status(400).send('No se pudo subir el archivo');
  }
});

// Endpoint para la verificación del webhook
app.get('/webhook',

  (req, res) => {
    const verifyToken = 'W3bh00k4APIV3rifnAut0rizad3';
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode && token) {
      if (mode === 'subscribe' && token === verifyToken) {
        console.log('Webhook verified');
        res.status(200).send(challenge);
      } else {
        console.log('Failed verification. Invalid token.');
        res.status(403).send('Failed verification. Invalid token.');
      }
    } else {
      console.log('Request missing required parameters.');
      res.status(400).send('Request missing required parameters.');
    }
  });

const templateStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const templateDir = path.join(__dirname, '..', 'public', 'media', 'templates', 'whatsapp');
    if (!fs.existsSync(templateDir)) {
      fs.mkdirSync(templateDir, { recursive: true });
    }
    cb(null, templateDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const uploadTemplateMedia = multer({
  storage: templateStorage,
  fileFilter: (req, file, cb) => {
    const filetypes = /jpeg|jpg|png|mp4|pdf/;
    const mimetype = filetypes.test(file.mimetype);
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());

    if (mimetype && extname) {
      return cb(null, true);
    }
    cb(new Error("Only .png, .jpg, .jpeg, .mp4, and .pdf format allowed!"));
  }
});

app.post('/upload-template-media',
  authorize(['ADMIN', 'SUPERADMIN'], ['CONFIG']),
  uploadTemplateMedia.single('media'), async (req, res) => {
    if (!req.file) {
      return res.status(400).send({ error: 'No file uploaded' });
    }

    const filePath = path.join(__dirname, '..', 'public', 'media', 'templates', 'whatsapp', req.file.filename);
    const fileType = req.file.mimetype.split('/')[0];

    try {
      if (fileType === 'image') {
        const compressedDir = path.join(__dirname, '..', 'public', 'media', 'templates', 'whatsapp', 'compressed');
        if (!fs.existsSync(compressedDir)) {
          fs.mkdirSync(compressedDir, { recursive: true });
        }
        const compressedFilePath = path.join(compressedDir, req.file.filename);
        await sharp(filePath)
          .resize({ width: 1024 })
          .jpeg({ quality: 80 })
          .toFile(compressedFilePath);

        res.status(200).send({ path: `/media/templates/whatsapp/compressed/${req.file.filename}` });
      } else {
        res.status(200).send({ path: `/media/templates/whatsapp/${req.file.filename}` });
      }
    } catch (error) {
      console.error('Error processing media file:', error);
      res.status(500).send(error.message);
    }
  });

app.post('/create-template',
  authorize(['ADMIN', 'SUPERADMIN'], ['CONFIG']),
  async (req, res) => {
    const { name, language, category, components, componentsWithSourceAndVariable, company_id } = req.body;
    const integrationDetails = await getIntegrationDetailsByCompanyId(company_id);
    const { whatsapp_api_token, whatsapp_business_account_id } = integrationDetails;
    const whatsappApiToken = whatsapp_api_token;
    const whatsappBusinessAccountId = whatsapp_business_account_id;

    const token = req.headers['x-token'];

    const validName = name.toLowerCase().replace(/[^a-z0-9_]/g, '_');

    const decoded = jwt.verify(token, process.env.JWT_SECRET); // Usa la clave secreta de tu servidor

    const userQuery = await pool.query(
      'SELECT * FROM users WHERE id_usuario = $1;',
      [decoded.id_usuario]
    );

    if (userQuery.rows.length === 0) {
      return res.status(404).send('Usuario no encontrado');
    }

    const user = userQuery.rows[0];

    if (!Array.isArray(components)) {
      return res.status(400).send({ error: 'The parameter components must be an array.' });
    }

    let headerType = null;
    let typeMedio = null;
    let medio = null;
    let bodyText = null;
    let headerText = null;
    let footer = null;
    let buttons = null; // Nueva variable para almacenar los botones
    let headerExample = null; // Ejemplo para el HEADER
    let bodyExample = null; // Ejemplo para el BODY

    componentsWithSourceAndVariable.forEach(component => {
      if (component.type === 'HEADER') {
        headerType = component.format;
        if (['IMAGE', 'VIDEO', 'DOCUMENT'].includes(headerType)) {
          typeMedio = component.format;
          medio = component.example?.header_handle[0] || null;
          headerExample = component.example?.header_handle[0] || null;
        } else if (headerType === 'TEXT') {
          headerText = component.text;
          if (headerText.includes('{{')) {
            headerExample = { "header_text": component.example.header_text }; // Añadir ejemplo para HEADER si contiene variables
          }
        }
      } else if (component.type === 'BODY') {
        bodyText = component.text;
        if (bodyText.includes('{{')) {
          bodyExample = { "body_text": component.example.body_text }; // Añadir ejemplo para BODY si contiene variables
        }
      } else if (component.type === 'FOOTER') {
        footer = component.text;
      } else if (component.type === 'BUTTONS') {
        buttons = component.buttons; // Asignar los botones
      }
    });

    const isMediaTemplate = ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(headerType);

    const templateData = {
      name: validName,
      language,
      category,
      components: componentsWithSourceAndVariable.map(component => {
        if (component.type === 'HEADER' && headerExample) {
          return { ...component, example: headerExample };
        } else if (component.type === 'BODY' && bodyExample) {
          return { ...component, example: bodyExample };
        }
        return component;
      })
    };

    // Mostrar la estructura que se enviaría a la API
    console.log('Template data to send to API:', JSON.stringify(templateData, null, 2));
    const newToken = jwt.sign(
      { id_usuario: user.id_usuario, email: user.email, rol: decoded.rol, privileges: decoded.privileges },
      process.env.JWT_SECRET,
    );
    if (isMediaTemplate) {
      try {
        let imageUrl = null;
        let headerHandle = null;
        let templateId = null
        if (headerType === 'IMAGE' && headerExample) {

          const fileName = path.basename(headerExample);
          const fileExtension = path?.extname(fileName)?.toLowerCase();



          const dd = path.resolve(__dirname, '../public/media/templates/whatsapp/compressed', fileName);
          const filePath = `${process.env.BACKEND_URL}/media/templates/whatsapp/compressed/${fileName}?token=${newToken}`;


          const fileStats = fs.statSync(dd);

          // Paso 1: Iniciar una sesión de subida
          let uploadResponse = null;
          switch (fileExtension) {
            case '.png':
              uploadResponse = await axios.post(
                `https://graph.facebook.com/v20.0/${process.env.APP_ID}/uploads`,
                null, // Sin datos en el cuerpo
                {
                  params: {
                    file_name: fileName,
                    file_length: fileStats.size,
                    file_type: 'image/png',
                    access_token: whatsapp_api_token,
                  },
                }
              );
              break;

            case '.jpeg':
            case '.jpg':
              uploadResponse = await axios.post(
                `https://graph.facebook.com/v20.0/${process.env.APP_ID}/uploads`,
                null, // Sin datos en el cuerpo
                {
                  params: {
                    file_name: fileName,
                    file_length: fileStats.size,
                    file_type: 'image/jpeg',
                    access_token: whatsapp_api_token,
                  },
                }
              );
              break;

            default:
              throw new Error(`Unsupported file type: ${fileExtension}`);
          }

          headerHandle = uploadResponse.data.id;

          // Paso 2: Comenzar la subida del archivo
          const imageResponse = await axios.get(filePath, { responseType: 'arraybuffer' });
          const imageBuffer = Buffer.from(imageResponse.data, 'binary');

          if (imageBuffer.length === 0) {
            throw new Error('El archivo descargado está vacío.');
          }

          // Crear FormData y añadir el archivo
          const formData = new FormData();
          formData.append('file', imageBuffer, { filename: fileName, contentType: 'image/jpeg' });


          const uploadFileResponse = await axios.post(
            `https://graph.facebook.com/v20.0/${headerHandle}`,
            imageBuffer,
            {
              headers: {
                'Authorization': `OAuth ${process.env.WHATSAPP_API_TOKEN}`,
                'file_offset': 0,
                ...formData.getHeaders(),
              },
            }
          );

          imageUrl = uploadFileResponse.data.h;

          // Paso 3: Actualizar la plantilla en Meta
          templateData.components = templateData.components.map((component) => {
            if (component.type === 'BODY') {
              // Extraer y eliminar propiedades innecesarias
              const { source, variable, ...rest } = component;
              let example = rest.example;

              // Si existe 'example.body_text' y es un arreglo, verificar si es anidado
              if (example && Array.isArray(example.body_text)) {
                // Si el primer elemento es un arreglo, aplanarlo
                if (example.body_text.length > 0 && Array.isArray(example.body_text[0])) {
                  example = {
                    ...example,
                    body_text: example.body_text.flat(), // Asegura que sea un array plano
                  };
                }
              }
              return {
                ...rest,
                example,
              };
            }

            if (component.type === 'HEADER' && component.format === 'IMAGE') {
              return {
                ...component,
                example: {
                  header_handle: [imageUrl],
                },
              };
            }
            return component;
          });


          console.log("Plantilla con datos a enviar:", JSON.stringify(templateData, null, 2))
          const response = await axios.post(
            `https://graph.facebook.com/v20.0/${whatsappBusinessAccountId}/message_templates`,
            templateData,
            {
              headers: {
                Authorization: `Bearer ${whatsappApiToken}`,
                'Content-Type': 'application/json'
              }
            }
          );

          console.log("Plantilla multimedia actualizada en Meta", response.data);
          templateId = response.data.id;

          const query = `
          INSERT INTO templates_wa (id, type, nombre, language, header_type, type_medio, medio, body_text, header_text, footer, buttons, state, company_id)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        `;
          const values = [
            templateId,
            category,
            validName,
            language,
            headerType,
            typeMedio,
            medio,
            bodyText,
            headerText,
            footer,
            JSON.stringify(buttons), // Convertir los botones a JSON
            'PENDING',
            company_id
          ];
          await pool.query(query, values);

          if (Array.isArray(componentsWithSourceAndVariable)) {
            // Almacenar variables del cuerpo
            const bodyComponent = componentsWithSourceAndVariable.find(c => c.type === 'BODY');
            if (bodyComponent) {
              const bodyVariables = bodyComponent.example?.body_text[0] || [];
              const bodySources = bodyComponent.source || [];
              const bodyVariableNames = bodyComponent.variable || [];
              for (let i = 0; i < bodyVariables.length; i++) {
                const queryBody = `
                  INSERT INTO variable_body (name, example, template_wa_id, source, variable)
                  VALUES ($1, $2, $3, $4, $5)
                `;
                const valuesBody = [
                  `{{${i + 1}}}`,
                  bodyVariables[i],
                  templateId,
                  bodySources[i],
                  bodyVariableNames[i]
                ];
                await pool.query(queryBody, valuesBody);
              }
            }

            // Almacenar variables del encabezado
            const headerComponent = componentsWithSourceAndVariable.find(c => c.type === 'HEADER');
            if (headerComponent) {
              const headerVariables = headerComponent.example?.header_text || [];
              const headerSources = headerComponent.source || [];
              const headerVariableNames = headerComponent.variable || [];
              for (let i = 0; i < headerVariables.length; i++) {
                const queryHeader = `
                  INSERT INTO variable_headers (name, example, template_wa_id, source, variable)
                  VALUES ($1, $2, $3, $4, $5)
                `;
                const valuesHeader = [
                  `{{${i + 1}}}`,
                  headerVariables[i],
                  templateId,
                  headerSources[i],
                  headerVariableNames[i]
                ];
                await pool.query(queryHeader, valuesHeader);
              }
            }

            // Almacenar variables del botón
            const buttonComponent = componentsWithSourceAndVariable.find(c => c.type === 'BUTTONS');

            if (buttonComponent && Array.isArray(buttonComponent.buttons)) {
              // Iterar sobre todos los botones del componente BUTTONS
              for (const button of buttonComponent.buttons) {
                let name, example, source, variable;

                // Condicionales para cada tipo de botón
                if (button.type === 'QUICK_REPLY') {
                  name = button.text;
                  example = null; // No hay example en QUICK_REPLY
                  source = null; // No hay source en QUICK_REPLY
                  variable = button.type; // No hay variable en QUICK_REPLY
                } else if (button.type === 'PHONE_NUMBER') {
                  name = button.text;
                  example = button.phone_number;
                  source = null; // No hay source en PHONE_NUMBER
                  variable = button.type; // No hay variable en PHONE_NUMBER
                } else if (button.type === 'URL') {
                  name = button.text;
                  example = button.url;
                  source = null; // No hay source en URL
                  variable = button.type; // No hay variable en URL
                }

                // Asegurarse de que 'name' tiene valor antes de intentar guardar
                if (name) {
                  const queryButton = `
                    INSERT INTO variable_button (name, example, template_wa_id, source, variable)
                    VALUES ($1, $2, $3, $4, $5)
                  `;
                  const valuesButton = [
                    name,
                    example,
                    templateId,
                    source,
                    variable
                  ];
                  await pool.query(queryButton, valuesButton);
                }
              }
            }
          }
        }
        if (headerType === 'VIDEO' && headerExample) {
          const fileName = path.basename(headerExample);
          const fileExtension = path?.extname(fileName)?.toLowerCase();

          const dd = path.resolve(__dirname, '../public/media/templates/whatsapp', fileName);
          const filePath = `${process.env.BACKEND_URL}/media/templates/whatsapp/${fileName}?token=${newToken}`;

          const fileStats = fs.statSync(dd);

          // Paso 1: Iniciar una sesión de subida
          let uploadResponse = null;
          switch (fileExtension) {
            case '.mp4':
              uploadResponse = await axios.post(
                `https://graph.facebook.com/v20.0/${process.env.APP_ID}/uploads`,
                null,
                {
                  params: {
                    file_name: fileName,
                    file_length: fileStats.size,
                    file_type: 'video/mp4',
                    access_token: whatsapp_api_token,
                  },
                }
              );
              break;

            case '.3gpp':
              uploadResponse = await axios.post(
                `https://graph.facebook.com/v20.0/${process.env.APP_ID}/uploads`,
                null,
                {
                  params: {
                    file_name: fileName,
                    file_length: fileStats.size,
                    file_type: 'video/3gpp',
                    access_token: whatsapp_api_token,
                  },
                }
              );
              break;

            default:
              throw new Error(`Unsupported file type: ${fileExtension}`);
          }

          headerHandle = uploadResponse.data.id;

          // Paso 2: Comenzar la subida del archivo
          const imageResponse = await axios.get(filePath, { responseType: 'arraybuffer' });
          const imageBuffer = Buffer.from(imageResponse.data, 'binary');

          if (imageBuffer.length === 0) {
            throw new Error('El archivo descargado está vacío.');
          }
          // Crear FormData y añadir el archivo
          const formData = new FormData();
          formData.append('file', imageBuffer, { filename: fileName, contentType: `video/${fileExtension.slice(1)}` });

          const uploadFileResponse = await axios.post(
            `https://graph.facebook.com/v20.0/${headerHandle}`,
            imageBuffer,
            {
              headers: {
                'Authorization': `OAuth ${process.env.WHATSAPP_API_TOKEN}`,
                'file_offset': 0,
                ...formData.getHeaders(),
              },
            }
          );

          imageUrl = uploadFileResponse.data.h;

          // Paso 3: Actualizar la plantilla en Meta
          templateData.components = templateData.components.map((component) => {
            if (component.type === 'BODY') {
              // Extraer y eliminar propiedades innecesarias
              const { source, variable, ...rest } = component;
              let example = rest.example;

              // Si existe 'example.body_text' y es un arreglo, verificar si es anidado
              if (example && Array.isArray(example.body_text)) {
                // Si el primer elemento es un arreglo, aplanarlo
                if (example.body_text.length > 0 && Array.isArray(example.body_text[0])) {
                  example = {
                    ...example,
                    body_text: example.body_text.flat(), // Asegura que sea un array plano
                  };
                }
              }
              return {
                ...rest,
                example,
              };
            }
            // Actualiza el componente si es de tipo 'HEADER' y formato 'IMAGE'
            if (component.type === 'HEADER' && component.format === 'VIDEO') {
              return {
                ...component,
                example: {
                  header_handle: [imageUrl],
                },
              };
            }
            return component;
          });

          console.log("Plantilla con datos a enviar:", JSON.stringify(templateData, null, 2))
          const response = await axios.post(
            `https://graph.facebook.com/v20.0/${whatsappBusinessAccountId}/message_templates`,
            templateData,
            {
              headers: {
                Authorization: `Bearer ${whatsappApiToken}`,
                'Content-Type': 'application/json'
              }
            }
          );

          console.log("Plantilla multimedia actualizada en Meta", response.data);

          templateId = response.data.id;

          const query = `
          INSERT INTO templates_wa (id, type, nombre, language, header_type, type_medio, medio, body_text, header_text, footer, buttons, state, company_id)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        `;
          const values = [
            templateId,
            category,
            validName,
            language,
            headerType,
            typeMedio,
            medio,
            bodyText,
            headerText,
            footer,
            JSON.stringify(buttons), // Convertir los botones a JSON
            'PENDING',
            company_id
          ];
          await pool.query(query, values);

          if (Array.isArray(componentsWithSourceAndVariable)) {
            // Almacenar variables del cuerpo
            const bodyComponent = componentsWithSourceAndVariable.find(c => c.type === 'BODY');
            if (bodyComponent) {
              const bodyVariables = bodyComponent.example?.body_text[0] || [];
              const bodySources = bodyComponent.source || [];
              const bodyVariableNames = bodyComponent.variable || [];
              for (let i = 0; i < bodyVariables.length; i++) {
                const queryBody = `
                  INSERT INTO variable_body (name, example, template_wa_id, source, variable)
                  VALUES ($1, $2, $3, $4, $5)
                `;
                const valuesBody = [
                  `{{${i + 1}}}`,
                  bodyVariables[i],
                  templateId,
                  bodySources[i],
                  bodyVariableNames[i]
                ];
                await pool.query(queryBody, valuesBody);
              }
            }

            // Almacenar variables del encabezado
            const headerComponent = componentsWithSourceAndVariable.find(c => c.type === 'HEADER');
            if (headerComponent) {
              const headerVariables = headerComponent.example?.header_text || [];
              const headerSources = headerComponent.source || [];
              const headerVariableNames = headerComponent.variable || [];
              for (let i = 0; i < headerVariables.length; i++) {
                const queryHeader = `
                  INSERT INTO variable_headers (name, example, template_wa_id, source, variable)
                  VALUES ($1, $2, $3, $4, $5)
                `;
                const valuesHeader = [
                  `{{${i + 1}}}`,
                  headerVariables[i],
                  templateId,
                  headerSources[i],
                  headerVariableNames[i]
                ];
                await pool.query(queryHeader, valuesHeader);
              }
            }

            // Almacenar variables del botón
            const buttonComponent = componentsWithSourceAndVariable.find(c => c.type === 'BUTTONS');

            if (buttonComponent && Array.isArray(buttonComponent.buttons)) {
              // Iterar sobre todos los botones del componente BUTTONS
              for (const button of buttonComponent.buttons) {
                let name, example, source, variable;

                // Condicionales para cada tipo de botón
                if (button.type === 'QUICK_REPLY') {
                  name = button.text;
                  example = null; // No hay example en QUICK_REPLY
                  source = null; // No hay source en QUICK_REPLY
                  variable = button.type; // No hay variable en QUICK_REPLY
                } else if (button.type === 'PHONE_NUMBER') {
                  name = button.text;
                  example = button.phone_number;
                  source = null; // No hay source en PHONE_NUMBER
                  variable = button.type; // No hay variable en PHONE_NUMBER
                } else if (button.type === 'URL') {
                  name = button.text;
                  example = button.url;
                  source = null; // No hay source en URL
                  variable = button.type; // No hay variable en URL
                }

                // Asegurarse de que 'name' tiene valor antes de intentar guardar
                if (name) {
                  const queryButton = `
                    INSERT INTO variable_button (name, example, template_wa_id, source, variable)
                    VALUES ($1, $2, $3, $4, $5)
                  `;
                  const valuesButton = [
                    name,
                    example,
                    templateId,
                    source,
                    variable
                  ];
                  await pool.query(queryButton, valuesButton);
                }
              }
            }
          }
        }
        if (headerType === 'DOCUMENT' && headerExample) {
          const fileName = path.basename(headerExample);
          const fileExtension = path?.extname(fileName)?.toLowerCase();

          const dd = path.resolve(__dirname, '../public/media/templates/whatsapp', fileName);
          const filePath = `${process.env.BACKEND_URL}/media/templates/whatsapp/${fileName}?token=${newToken}`;

          const fileStats = fs.statSync(dd);

          // Paso 1: Iniciar una sesión de subida
          let uploadResponse = null;
          switch (fileExtension) {
            case '.pdf':
              uploadResponse = await axios.post(
                `https://graph.facebook.com/v20.0/${process.env.APP_ID}/uploads`,
                null, // Sin datos en el cuerpo
                {
                  params: {
                    file_name: fileName,
                    file_length: fileStats.size,
                    file_type: 'application/pdf',
                    access_token: whatsapp_api_token,
                  },
                }
              );
              break;

            default:
              throw new Error(`Unsupported file type: ${fileExtension}`);
          }

          headerHandle = uploadResponse.data.id;

          // Paso 2: Comenzar la subida del archivo
          const imageResponse = await axios.get(filePath, { responseType: 'arraybuffer' });
          const imageBuffer = Buffer.from(imageResponse.data, 'binary');

          if (imageBuffer.length === 0) {
            throw new Error('El archivo descargado está vacío.');
          }
          // Crear FormData y añadir el archivo
          const formData = new FormData();
          formData.append('file', imageBuffer, { filename: fileName, contentType: `document/${fileExtension.slice(1)}` });

          const uploadFileResponse = await axios.post(
            `https://graph.facebook.com/v20.0/${headerHandle}`,
            imageBuffer,
            {
              headers: {
                'Authorization': `OAuth ${process.env.WHATSAPP_API_TOKEN}`,
                'file_offset': 0,
                ...formData.getHeaders(),
              },
            }
          );

          imageUrl = uploadFileResponse.data.h;

          // Paso 3: Actualizar la plantilla en Meta
          templateData.components = templateData.components.map((component) => {
            if (component.type === 'BODY') {
              // Extraer y eliminar propiedades innecesarias
              const { source, variable, ...rest } = component;
              let example = rest.example;

              // Si existe 'example.body_text' y es un arreglo, verificar si es anidado
              if (example && Array.isArray(example.body_text)) {
                // Si el primer elemento es un arreglo, aplanarlo
                if (example.body_text.length > 0 && Array.isArray(example.body_text[0])) {
                  example = {
                    ...example,
                    body_text: example.body_text.flat(), // Asegura que sea un array plano
                  };
                }
              }
              return {
                ...rest,
                example,
              };
            }
            // Actualiza el componente si es de tipo 'HEADER' y formato 'IMAGE'
            if (component.type === 'HEADER' && component.format === 'DOCUMENT') {
              return {
                ...component,
                example: {
                  header_handle: [imageUrl],
                },
              };
            }
            return component;
          });

          console.log("Plantilla con datos a enviar:", JSON.stringify(templateData, null, 2))
          const response = await axios.post(
            `https://graph.facebook.com/v20.0/${whatsappBusinessAccountId}/message_templates`,
            templateData,
            {
              headers: {
                Authorization: `Bearer ${whatsappApiToken}`,
                'Content-Type': 'application/json'
              }
            }
          );

          console.log("Plantilla multimedia actualizada en Meta", response.data);

          templateId = response.data.id;

          const query = `
          INSERT INTO templates_wa (id, type, nombre, language, header_type, type_medio, medio, body_text, header_text, footer, buttons, state, company_id)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        `;
          const values = [
            templateId,
            category,
            validName,
            language,
            headerType,
            typeMedio,
            medio,
            bodyText,
            headerText,
            footer,
            JSON.stringify(buttons), // Convertir los botones a JSON
            'PENDING',
            company_id
          ];
          await pool.query(query, values);

          if (Array.isArray(componentsWithSourceAndVariable)) {
            // Almacenar variables del cuerpo
            const bodyComponent = componentsWithSourceAndVariable.find(c => c.type === 'BODY');
            if (bodyComponent) {
              const bodyVariables = bodyComponent.example?.body_text[0] || [];
              const bodySources = bodyComponent.source || [];
              const bodyVariableNames = bodyComponent.variable || [];
              for (let i = 0; i < bodyVariables.length; i++) {
                const queryBody = `
                  INSERT INTO variable_body (name, example, template_wa_id, source, variable)
                  VALUES ($1, $2, $3, $4, $5)
                `;
                const valuesBody = [
                  `{{${i + 1}}}`,
                  bodyVariables[i],
                  templateId,
                  bodySources[i],
                  bodyVariableNames[i]
                ];
                await pool.query(queryBody, valuesBody);
              }
            }

            // Almacenar variables del encabezado
            const headerComponent = componentsWithSourceAndVariable.find(c => c.type === 'HEADER');
            if (headerComponent) {
              const headerVariables = headerComponent.example?.header_text || [];
              const headerSources = headerComponent.source || [];
              const headerVariableNames = headerComponent.variable || [];
              for (let i = 0; i < headerVariables.length; i++) {
                const queryHeader = `
                  INSERT INTO variable_headers (name, example, template_wa_id, source, variable)
                  VALUES ($1, $2, $3, $4, $5)
                `;
                const valuesHeader = [
                  `{{${i + 1}}}`,
                  headerVariables[i],
                  templateId,
                  headerSources[i],
                  headerVariableNames[i]
                ];
                await pool.query(queryHeader, valuesHeader);
              }
            }

            // Almacenar variables del botón
            const buttonComponent = componentsWithSourceAndVariable.find(c => c.type === 'BUTTONS');

            if (buttonComponent && Array.isArray(buttonComponent.buttons)) {
              // Iterar sobre todos los botones del componente BUTTONS
              for (const button of buttonComponent.buttons) {
                let name, example, source, variable;

                // Condicionales para cada tipo de botón
                if (button.type === 'QUICK_REPLY') {
                  name = button.text;
                  example = null; // No hay example en QUICK_REPLY
                  source = null; // No hay source en QUICK_REPLY
                  variable = button.type; // No hay variable en QUICK_REPLY
                } else if (button.type === 'PHONE_NUMBER') {
                  name = button.text;
                  example = button.phone_number;
                  source = null; // No hay source en PHONE_NUMBER
                  variable = button.type; // No hay variable en PHONE_NUMBER
                } else if (button.type === 'URL') {
                  name = button.text;
                  example = button.url;
                  source = null; // No hay source en URL
                  variable = button.type; // No hay variable en URL
                }

                // Asegurarse de que 'name' tiene valor antes de intentar guardar
                if (name) {
                  const queryButton = `
                    INSERT INTO variable_button (name, example, template_wa_id, source, variable)
                    VALUES ($1, $2, $3, $4, $5)
                  `;
                  const valuesButton = [
                    name,
                    example,
                    templateId,
                    source,
                    variable
                  ];
                  await pool.query(queryButton, valuesButton);
                }
              }
            }
          }
        }

        res.status(200).send({ id: templateId, message: 'Template stored successfully without sending to WhatsApp.' });
      } catch (error) {
        console.error('Error storing template:', error.message);
        res.status(500).send({ error: error.message });
      }
    } else {
      try {

        const { ...rest } = templateData;

        rest.components = rest.components.map((component) => {
          // Verifica si el componente tiene una clave no válida y elimínala
          const { source, variable, ...cleanedComponent } = component;
          return cleanedComponent;
        });

        console.log('Datos a enviar a la API de Facebook:', JSON.stringify(rest, null, 2));

        // Realizar la llamada a la API de Facebook
        const response = await axios.post(
          `https://graph.facebook.com/v20.0/${whatsappBusinessAccountId}/message_templates`,
          rest,
          {
            headers: {
              Authorization: `Bearer ${whatsappApiToken}`,
              'Content-Type': 'application/json'
            }
          }
        );

        console.log('Template creation successful:', response.data);

        const templateId = response.data.id;

        const query = `
      INSERT INTO templates_wa (id, type, nombre, language, header_type, type_medio, medio, body_text, header_text, footer, buttons, state, company_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    `;
        const values = [
          templateId,
          category,
          validName,
          language,
          headerType,
          typeMedio,
          medio,
          bodyText,
          headerText,
          footer,
          JSON.stringify(buttons), // Convertir los botones a JSON
          'PENDING',
          company_id
        ];
        const plantilla = await pool.query(query, values);

        if (Array.isArray(componentsWithSourceAndVariable)) {
          // Almacenar variables del cuerpo
          const bodyComponent = componentsWithSourceAndVariable.find(c => c.type === 'BODY');
          if (bodyComponent) {
            const bodyVariables = bodyComponent.example?.body_text[0] || [];
            const bodySources = bodyComponent.source || [];
            const bodyVariableNames = bodyComponent.variable || [];
            for (let i = 0; i < bodyVariables.length; i++) {
              const queryBody = `
            INSERT INTO variable_body (name, example, template_wa_id, source, variable)
            VALUES ($1, $2, $3, $4, $5)
          `;
              const valuesBody = [
                `{{${i + 1}}}`,
                bodyVariables[i],
                templateId,
                bodySources[i],
                bodyVariableNames[i]
              ];
              await pool.query(queryBody, valuesBody);
            }
          }

          // Almacenar variables del encabezado
          const headerComponent = componentsWithSourceAndVariable.find(c => c.type === 'HEADER');
          if (headerComponent) {
            const headerVariables = headerComponent.example?.header_text || [];
            const headerSources = headerComponent.source || [];
            const headerVariableNames = headerComponent.variable || [];
            for (let i = 0; i < headerVariables.length; i++) {
              const queryHeader = `
            INSERT INTO variable_headers (name, example, template_wa_id, source, variable)
            VALUES ($1, $2, $3, $4, $5)
          `;
              const valuesHeader = [
                `{{${i + 1}}}`,
                headerVariables[i],
                templateId,
                headerSources[i],
                headerVariableNames[i]
              ];
              await pool.query(queryHeader, valuesHeader);
            }
          }

          // Almacenar variables del botón
          const buttonComponent = componentsWithSourceAndVariable.find(c => c.type === 'BUTTONS');
          if (buttonComponent && Array.isArray(buttonComponent.buttons)) {
            // Iterar sobre todos los botones del componente BUTTONS
            for (const button of buttonComponent.buttons) {
              let name, example, source, variable;

              // Condicionales para cada tipo de botón
              if (button.type === 'QUICK_REPLY') {
                name = button.text;
                example = null; // No hay example en QUICK_REPLY
                source = null; // No hay source en QUICK_REPLY
                variable = button.type; // No hay variable en QUICK_REPLY
              } else if (button.type === 'PHONE_NUMBER') {
                name = button.text;
                example = button.phone_number;
                source = null; // No hay source en PHONE_NUMBER
                variable = button.type; // No hay variable en PHONE_NUMBER
              } else if (button.type === 'URL') {
                name = button.text;
                example = button.url;
                source = null; // No hay source en URL
                variable = button.type; // No hay variable en URL
              }

              // Asegurarse de que 'name' tiene valor antes de intentar guardar
              if (name) {
                const queryButton = `
              INSERT INTO variable_button (name, example, template_wa_id, source, variable)
              VALUES ($1, $2, $3, $4, $5)
            `;
                const valuesButton = [
                  name,
                  example,
                  templateId,
                  source,
                  variable
                ];
                await pool.query(queryButton, valuesButton);
              }
            }
          }
        }

        res.status(200).send(response.data);
      } catch (error) {
        console.error('Error creating template:', error.response ? error.response.data : error.message);
        res.status(500).send(error.response ? error.response.data : error.message);
      }
    }
  });

app.put('/edit-template',
  authorize(['ADMIN', 'SUPERADMIN'], ['CONFIG']),
  async (req, res) => {
    const { name, language, category, components, componentsWithSourceAndVariable, company_id, id_plantilla } = req.body;
    const integrationDetails = await getIntegrationDetailsByCompanyId(company_id);
    const { whatsapp_api_token, whatsapp_business_account_id } = integrationDetails;

    const token = req.headers['x-token'];

    const validName = name.toLowerCase().replace(/[^a-z0-9_]/g, '_');

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const userQuery = await pool.query(
      'SELECT * FROM users WHERE id_usuario = $1;',
      [decoded.id_usuario]
    );

    if (userQuery.rows.length === 0) {
      return res.status(404).send('Usuario no encontrado');
    }

    const user = userQuery.rows[0];

    if (!Array.isArray(components)) {
      return res.status(400).send({ error: 'The parameter components must be an array.' });
    }

    let headerType = null;
    let typeMedio = null;
    let medio = null;
    let bodyText = null;
    let headerText = null;
    let footer = null;
    let buttons = null; // Nueva variable para almacenar los botones
    let headerExample = null; // Ejemplo para el HEADER
    let bodyExample = null; // Ejemplo para el BODY

    componentsWithSourceAndVariable.forEach(component => {
      if (component.type === 'HEADER') {
        headerType = component.format;
        if (['IMAGE', 'VIDEO', 'DOCUMENT'].includes(headerType)) {
          typeMedio = component.format;
          headerExample = component.example?.header_handle[0] || null;
          medio = component.example?.header_handle[0] || null;
        } else if (headerType === 'TEXT') {
          headerText = component.text;
          if (headerText.includes('{{')) {
            headerExample = { "header_text": component.example.header_text };
          }
        }
      } else if (component.type === 'BODY') {
        bodyText = component.text;
        if (bodyText.includes('{{')) {
          bodyExample = { "body_text": component.example.body_text };

          console.log("informacion del body: ", bodyExample)
        }
      } else if (component.type === 'FOOTER') {
        footer = component.text;
      } else if (component.type === 'BUTTONS') {
        buttons = component.buttons;
      }
    });

    const isMediaTemplate = ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(headerType);

    var templateData = {
      name: validName,
      language,
      category: category,
      components: componentsWithSourceAndVariable.map(component => {
        if (component.type === 'HEADER' && headerExample) {
          return {
            ...component,
            example: {
              header_handle: [headerExample]
            }
          };
        } else if (component.type === 'BODY' && typeof bodyExample === 'string') {
          return {
            ...component,
            example: {
              body_text: [bodyExample]
            }
          };
        }
        return component;
      })
    };

    if (isMediaTemplate) {
      try {
        let imageUrl = null;
        let headerHandle = null;

        const newToken = jwt.sign(
          { id_usuario: user.id_usuario, email: user.email, rol: decoded.rol, privileges: decoded.privileges },
          process.env.JWT_SECRET, // Asegúrate de tener esta variable en tu archivo .env
        );

        if (headerType === 'IMAGE' && headerExample) {

          const fileName = path.basename(headerExample);
          const fileExtension = path?.extname(fileName)?.toLowerCase();

          const dd = path.resolve(__dirname, '../public/media/templates/whatsapp/compressed', fileName);
          const filePath = `${process.env.BACKEND_URL}/media/templates/whatsapp/compressed/${fileName}?token=${newToken}`;

          const fileStats = fs.statSync(dd);

          // Paso 1: Iniciar una sesión de subida
          let uploadResponse = null;
          switch (fileExtension) {
            case '.png':
              uploadResponse = await axios.post(
                `https://graph.facebook.com/v20.0/${process.env.APP_ID}/uploads`,
                null, // Sin datos en el cuerpo
                {
                  params: {
                    file_name: fileName,
                    file_length: fileStats.size,
                    file_type: 'image/png',
                    access_token: whatsapp_api_token,
                  },
                }
              );
              break;

            case '.jpeg':
            case '.jpg':
              uploadResponse = await axios.post(
                `https://graph.facebook.com/v20.0/${process.env.APP_ID}/uploads`,
                null, // Sin datos en el cuerpo
                {
                  params: {
                    file_name: fileName,
                    file_length: fileStats.size,
                    file_type: 'image/jpeg',
                    access_token: whatsapp_api_token,
                  },
                }
              );
              break;

            default:
              throw new Error(`Unsupported file type: ${fileExtension}`);
          }

          headerHandle = uploadResponse.data.id;

          // Paso 2: Comenzar la subida del archivo
          const imageResponse = await axios.get(filePath, { responseType: 'arraybuffer' });
          const imageBuffer = Buffer.from(imageResponse.data, 'binary');

          if (imageBuffer.length === 0) {
            throw new Error('El archivo descargado está vacío.');
          }
          // Crear FormData y añadir el archivo
          const formData = new FormData();
          formData.append('file', imageBuffer, { filename: fileName, contentType: `image/${fileExtension.slice(1)}` });


          const uploadFileResponse = await axios.post(
            `https://graph.facebook.com/v20.0/${headerHandle}`,
            imageBuffer,
            {
              headers: {
                'Authorization': `OAuth ${whatsapp_api_token}`,
                'file_offset': 0,
                ...formData.getHeaders(),
              },
            }
          );

          imageUrl = uploadFileResponse.data.h;

          // Paso 3: Actualizar la plantilla en Meta
          templateData.components = templateData.components.map((component) => {
            // Desestructura y elimina 'source' y 'variable' del objeto 'example', si existen
            if (component.type === 'BODY') {
              const { source, variable, ...rest } = component;
              return {
                ...rest
              }
            }

            // Actualiza el componente si es de tipo 'HEADER' y formato 'IMAGE'
            if (component.type === 'HEADER' && component.format === 'IMAGE') {
              return {
                ...component,
                example: {
                  ...component.example,
                  header_handle: [imageUrl],
                },
              };
            }
            return component;
          });

          const { language, name, category, ...rest } = templateData;

          console.log("Plantilla con datos a enviar:", JSON.stringify(rest, null, 2))
          const response = await axios.post(
            `https://graph.facebook.com/v20.0/${id_plantilla}`,
            rest,
            {
              headers: {
                Authorization: `Bearer ${whatsapp_api_token}`,
                'Content-Type': 'application/json',
              },
            }
          );
          console.log("Plantilla multimedia actualizada en Meta", response.data);
        } else if (headerType === 'VIDEO' && headerExample) {

          const fileName = path.basename(headerExample);
          const fileExtension = path?.extname(fileName)?.toLowerCase();

          const dd = path.resolve(__dirname, '../public/media/templates/whatsapp', fileName);
          const filePath = `${process.env.BACKEND_URL}/media/templates/whatsapp/${fileName}?token=${newToken}`;

          const fileStats = fs.statSync(dd);

          // Paso 1: Iniciar una sesión de subida
          let uploadResponse = null;
          switch (fileExtension) {
            case '.mp4':
              uploadResponse = await axios.post(
                `https://graph.facebook.com/v20.0/${process.env.APP_ID}/uploads`,
                null, // Sin datos en el cuerpo
                {
                  params: {
                    file_name: fileName,
                    file_length: fileStats.size,
                    file_type: 'video/mp4',
                    access_token: whatsapp_api_token,
                  },
                }
              );
              break;

            case '.3gpp':
              uploadResponse = await axios.post(
                `https://graph.facebook.com/v20.0/${process.env.APP_ID}/uploads`,
                null, // Sin datos en el cuerpo
                {
                  params: {
                    file_name: fileName,
                    file_length: fileStats.size,
                    file_type: 'video/3gpp',
                    access_token: whatsapp_api_token,
                  },
                }
              );
              break;

            default:
              throw new Error(`Unsupported file type: ${fileExtension}`);
          }

          headerHandle = uploadResponse.data.id;

          // Paso 2: Comenzar la subida del archivo
          const imageResponse = await axios.get(filePath, { responseType: 'arraybuffer' });
          const imageBuffer = Buffer.from(imageResponse.data, 'binary');

          if (imageBuffer.length === 0) {
            throw new Error('El archivo descargado está vacío.');
          }
          // Crear FormData y añadir el archivo
          const formData = new FormData();
          formData.append('file', imageBuffer, { filename: fileName, contentType: `image/${fileExtension.slice(1)}` });


          const uploadFileResponse = await axios.post(
            `https://graph.facebook.com/v20.0/${headerHandle}`,
            imageBuffer,
            {
              headers: {
                'Authorization': `OAuth ${whatsapp_api_token}`,
                'file_offset': 0,
                ...formData.getHeaders(),
              },
            }
          );

          imageUrl = uploadFileResponse.data.h;

          // Paso 3: Actualizar la plantilla en Meta
          templateData.components = templateData.components.map((component) => {
            // Desestructura y elimina 'source' y 'variable' del objeto 'example', si existen
            if (component.type === 'BODY') {
              const { source, variable, ...rest } = component;
              return {
                ...rest
              }
            }

            // Actualiza el componente si es de tipo 'HEADER' y formato 'IMAGE'
            if (component.type === 'HEADER' && component.format === 'VIDEO') {
              return {
                ...component,
                example: {
                  ...component.example,
                  header_handle: [imageUrl],
                },
              };
            }
            return component;
          });

          const { language, name, category, ...rest } = templateData;

          console.log("Plantilla con datos a enviar:", JSON.stringify(rest, null, 2))
          const response = await axios.post(
            `https://graph.facebook.com/v20.0/${id_plantilla}`,
            rest,
            {
              headers: {
                Authorization: `Bearer ${whatsapp_api_token}`,
                'Content-Type': 'application/json',
              },
            }
          );
          console.log("Plantilla multimedia actualizada en Meta", response.data);
        } else if (headerType === 'DOCUMENT' && headerExample) {

          const fileName = path.basename(headerExample);
          const fileExtension = path?.extname(fileName)?.toLowerCase();

          const dd = path.resolve(__dirname, '../public/media/templates/whatsapp', fileName);
          const filePath = `${process.env.BACKEND_URL}/media/templates/whatsapp/${fileName}?token=${newToken}`;

          const fileStats = fs.statSync(dd);

          // Paso 1: Iniciar una sesión de subida
          let uploadResponse = null;
          switch (fileExtension) {
            case '.pdf':
              uploadResponse = await axios.post(
                `https://graph.facebook.com/v20.0/${process.env.APP_ID}/uploads`,
                null, // Sin datos en el cuerpo
                {
                  params: {
                    file_name: fileName,
                    file_length: fileStats.size,
                    file_type: 'application/pdf',
                    access_token: whatsapp_api_token,
                  },
                }
              );
              break;

            default:
              throw new Error(`Unsupported file type: ${fileExtension}`);
          }

          headerHandle = uploadResponse.data.id;

          // Paso 2: Comenzar la subida del archivo
          const imageResponse = await axios.get(filePath, { responseType: 'arraybuffer' });
          const imageBuffer = Buffer.from(imageResponse.data, 'binary');

          if (imageBuffer.length === 0) {
            throw new Error('El archivo descargado está vacío.');
          }
          // Crear FormData y añadir el archivo
          const formData = new FormData();
          formData.append('file', imageBuffer, { filename: fileName, contentType: `application/pdf` });


          const uploadFileResponse = await axios.post(
            `https://graph.facebook.com/v20.0/${headerHandle}`,
            imageBuffer,
            {
              headers: {
                'Authorization': `OAuth ${whatsapp_api_token}`,
                'file_offset': 0,
                ...formData.getHeaders(),
              },
            }
          );

          imageUrl = uploadFileResponse.data.h;

          // Paso 3: Actualizar la plantilla en Meta
          templateData.components = templateData.components.map((component) => {
            // Desestructura y elimina 'source' y 'variable' del objeto 'example', si existen
            if (component.type === 'BODY') {
              const { source, variable, ...rest } = component;
              return {
                ...rest
              }
            }

            // Actualiza el componente si es de tipo 'HEADER' y formato 'IMAGE'
            if (component.type === 'HEADER' && component.format === 'VIDEO') {
              return {
                ...component,
                example: {
                  ...component.example,
                  header_handle: [imageUrl],
                },
              };
            }
            return component;
          });

          const { language, name, category, ...rest } = templateData;

          console.log("Plantilla con datos a enviar:", JSON.stringify(rest, null, 2))
          const response = await axios.post(
            `https://graph.facebook.com/v20.0/${id_plantilla}`,
            rest,
            {
              headers: {
                Authorization: `Bearer ${whatsapp_api_token}`,
                'Content-Type': 'application/json',
              },
            }
          );
          console.log("Plantilla multimedia actualizada en Meta", response.data);
        }

        // Actualizar los datos en la base de datos
        const query = `
        UPDATE templates_wa
        SET type = $1, nombre = $2, language = $3, header_type = $4, type_medio = $5, medio = $6,
            body_text = $7, header_text = $8, footer = $9, buttons = $10, state = $11, company_id = $12
        WHERE id = $13
        RETURNING id
      `;
        const values = [
          category,
          validName,
          language,
          headerType,
          typeMedio,
          medio,
          bodyText,
          headerText,
          footer,
          JSON.stringify(buttons),
          'PENDING',
          company_id,
          id_plantilla,
        ];
        const result = await pool.query(query, values);
        console.log("Actualizando datos en la base de datos", result);

        const templateId = result.rows[0].id;

        if (!res.headersSent) {
          return res.send({ message: 'Template updated successfully', templateId });
        }
      } catch (error) {
        console.error('Error al procesar la plantilla:', error.response?.data || error.message);

        if (!res.headersSent) {
          if (error.response?.data) {
            return res.status(500).send(error.response.data);
          } else {
            return res.status(500).send({ ...error.message });
          }
        } else {
          return res.status(500).send({ error: 'Unknown error occurred' });
        }
      }
    } else {
      try {

        const { language, name, category, ...rest } = templateData;

        rest.components = rest.components.map((component) => {
          // Verifica si el componente tiene una clave no válida y elimínala
          const { source, variable, ...cleanedComponent } = component;
          return cleanedComponent;
        });

        console.log('Datos a enviar a la API de Facebookdddd:', JSON.stringify(rest, null, 2));

        // Realizar la llamada a la API de Facebook
        const response = await axios.post(
          `https://graph.facebook.com/v20.0/${id_plantilla}`,
          rest,
          {
            headers: {
              Authorization: `Bearer ${process.env.WHATSAPP_API_TOKEN}`,
              'Content-Type': 'application/json',
            },
          }
        );

        console.log('Template creation successful:', response.data);

        const templateId = response.data.id;

        const query = `
        UPDATE templates_wa
        SET type = $2, nombre = $3, language = $4, header_type = $5, type_medio = $6, medio = $7, body_text = $8, 
            header_text = $9, footer = $10, buttons = $11, state = $12, company_id = $13
        WHERE id = $1
      `;
        const values = [
          id_plantilla,
          category,
          validName,
          language,
          headerType,
          typeMedio,
          medio,
          bodyText,
          headerText,
          footer,
          JSON.stringify(buttons), // Convertir los botones a JSON
          'PENDING',
          company_id
        ];
        await pool.query(query, values);

        if (Array.isArray(componentsWithSourceAndVariable)) {
          // Almacenar variables del cuerpo
          const bodyComponent = componentsWithSourceAndVariable.find(c => c.type === 'BODY');
          if (bodyComponent) {
            const bodyVariables = bodyComponent.example?.body_text[0] || [];
            const bodySources = bodyComponent.source || [];
            const bodyVariableNames = bodyComponent.variable || [];

            // Eliminar variables del cuerpo anteriores
            const deleteBodyVariablesQuery = `DELETE FROM variable_body WHERE template_wa_id = $1`;
            await pool.query(deleteBodyVariablesQuery, [id_plantilla]);

            for (let i = 0; i < bodyVariables.length; i++) {
              const queryBody = `
              INSERT INTO variable_body (name, example, template_wa_id, source, variable)
              VALUES ($1, $2, $3, $4, $5)
            `;
              const valuesBody = [
                `{{${i + 1}}}`,
                bodyVariables[i],
                id_plantilla,
                bodySources[i],
                bodyVariableNames[i]
              ];
              await pool.query(queryBody, valuesBody);
            }
          }

          // Almacenar variables del encabezado
          const headerComponent = componentsWithSourceAndVariable.find(c => c.type === 'HEADER');
          if (headerComponent) {
            const headerVariables = headerComponent.example?.header_text || [];
            const headerSources = headerComponent.source || [];
            const headerVariableNames = headerComponent.variable || [];

            // Eliminar variables del encabezado anteriores
            const deleteHeaderVariablesQuery = `DELETE FROM variable_headers WHERE template_wa_id = $1`;
            await pool.query(deleteHeaderVariablesQuery, [id_plantilla]);

            for (let i = 0; i < headerVariables.length; i++) {
              const queryHeader = `
              INSERT INTO variable_headers (name, example, template_wa_id, source, variable)
              VALUES ($1, $2, $3, $4, $5)
            `;
              const valuesHeader = [
                `{{${i + 1}}}`,
                headerVariables[i],
                id_plantilla,
                headerSources[i],
                headerVariableNames[i]
              ];
              await pool.query(queryHeader, valuesHeader);
            }
          }

          // Almacenar variables del botón
          const buttonComponent = componentsWithSourceAndVariable.find(c => c.type === 'BUTTONS');
          if (buttonComponent && Array.isArray(buttonComponent.buttons)) {

            // Eliminar variables del botón anteriores
            const deleteButtonVariablesQuery = `DELETE FROM variable_button WHERE template_wa_id = $1`;
            await pool.query(deleteButtonVariablesQuery, [templateId]);

            if (buttonComponent && Array.isArray(buttonComponent.buttons)) {

              for (const button of buttonComponent.buttons) {
                let name, example, source, variable;


                if (button.type === 'QUICK_REPLY') {
                  name = button.text;
                  example = null;
                  source = null;
                  variable = button.type;
                } else if (button.type === 'PHONE_NUMBER') {
                  name = button.text;
                  example = button.phone_number;
                  source = null;
                  variable = button.type;
                } else if (button.type === 'URL') {
                  name = button.text;
                  example = button.url;
                  source = null;
                  variable = button.type;
                }

                // Asegurarse de que 'name' tiene valor antes de intentar guardar
                if (name) {
                  const queryButton = `
                  INSERT INTO variable_button (name, example, template_wa_id, source, variable)
                  VALUES ($1, $2, $3, $4, $5)
                `;
                  const valuesButton = [
                    name,
                    example,
                    templateId,
                    source,
                    variable
                  ];
                  await pool.query(queryButton, valuesButton);
                }
              }
            }
          }
        }

        res.status(200).send(response.data);
      } catch (error) {
        console.error('Error creating template:', error.response ? error.response.data : error.message);
        res.status(500).send(error.response ? error.response.data : error.message);
      }
    }
  });

app.delete('/api/templates/:id/:templateName/:company_id',
  authorize(['ADMIN', 'SUPERADMIN'], ['CONFIG']),
  async (req, res) => {
    const { id, company_id, templateName } = req.params;
    const integrationDetails = await getIntegrationDetailsByCompanyId(company_id);
    const { whatsapp_api_token, whatsapp_business_account_id } = integrationDetails;
    const whatsappApiToken = whatsapp_api_token;
    const whatsappBusinessAccountId = whatsapp_business_account_id;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Actualizar registros en campaigns
      await client.query('UPDATE campaigns SET template_id = NULL WHERE template_id = $1', [id]);

      // Actualizar registros en variable_body
      await client.query('UPDATE variable_body SET template_wa_id = NULL WHERE template_wa_id = $1', [id]);

      // Eliminar registros en variable_headers
      await client.query('DELETE FROM variable_headers WHERE template_wa_id = $1', [id]);

      await client.query('DELETE FROM variable_button WHERE template_wa_id = $1', [id]);

      // Eliminar la plantilla
      const result = await client.query('DELETE FROM templates_wa WHERE id = $1 RETURNING *', [id]);

      if (result.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).send({ error: 'Template not found in database' });
      }

      // Intentar eliminar la plantilla en Meta
      try {
        const response = await axios.delete(
          `https://graph.facebook.com/v20.0/${whatsappBusinessAccountId}/message_templates?hsm_id=${id}&name=${templateName}`,
          { headers: { Authorization: `Bearer ${whatsappApiToken}` } }
        );

        if (response.data.success) {
          await client.query('COMMIT');
          return res.status(200).send({ message: 'Template deleted successfully from database and Meta' });
        }
      } catch (apiError) {
        console.warn('Meta API error:', apiError.response?.data || apiError.message);
        // Si Meta devuelve error, ignoramos y continuamos
      }

      await client.query('COMMIT');
      return res.status(200).send({ message: 'Template deleted from database, but was not found in Meta' });

    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error deleting template:', error.message);
      res.status(500).send({ error: error.message });
    } finally {
      client.release();
    }
  });

app.post('/create-flow',
  authorize(['ADMIN', 'SUPERADMIN'], ['CONFIG']),
  async (req, res) => {
    try {
      const { name, categories } = req.body;

      const response = await axios.post(`https://graph.facebook.com/v20.0/${process.env.WHATSAPP_BUSINESS_ACCOUNT_ID}/flows`, {
        name,
        categories,
      }, {
        headers: {
          'Authorization': `Bearer ${process.env.WHATSAPP_API_TOKEN}`,
          'Content-Type': 'application/json'
        }
      });

      res.json(response.data);
    } catch (error) {
      console.error('Error creating flow:', error);
      res.status(500).json({ error: 'Failed to create flow' });
    }
  });

async function getIntegrationDetails(phoneNumberId) {
  const query = `
    SELECT * FROM integrations
    WHERE WHATSAPP_PHONE_NUMBER_ID = $1
  `;
  const result = await pool.query(query, [phoneNumberId]);

  if (result.rows.length > 0) {
    return result.rows[0];
  } else {
    throw new Error(`Integration details not found for phone_number_id: ${phoneNumberId}`);
  }
}

async function getIntegrationDetailsByCompanyId(companyId) {
  const query = `
    SELECT * FROM integrations
    WHERE company_id = $1 AND type = 'whatsapp'
    LIMIT 1;
  `;
  const result = await pool.query(query, [companyId]);

  if (result.rows.length > 0) {
    return result.rows[0];
  } else {
    throw new Error(`Integration details not found for company_id: ${companyId} and type: 'whatsapp'`);
  }
}

// Middleware para obtener la IP del cliente
app.use((req, res, next) => {
  const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
  const geo = geoip.lookup(ip);

  if (geo) {
    const timezone = geo.timezone;
    req.clientTimezone = timezone;
  } else {
    req.clientTimezone = 'UTC'; // Valor por defecto
  }

  next();
});

// Ejemplo de uso en una ruta
app.get('/calculate-time', (req, res) => {
  const clientTimezone = req.clientTimezone || 'America/Bogota';
  const currentTime = moment().tz(clientTimezone).format();

  res.send(`La hora actual en tu zona horaria (${clientTimezone}) es: ${currentTime}`);
});

app.post('/scheduling-events', async (req, res) => {
  console.log('✅ Solicitud recibida en /scheduling-events');
  console.log('📝 Headers:', req.headers);
  console.log('📦 Body:', req.body);

  const authHeader = req.headers['authorization'];
  const companyId = req.headers['x-company-id'];

  if (!authHeader || !companyId) {
    console.error('❌ Faltan Authorization o X-Company-ID en los headers');
    return res.status(400).json({ message: 'Faltan headers de Authorization o X-Company-ID' });
  }

  const token = authHeader.replace('Bearer ', '');

  try {
    const result = await pool.query(
      'SELECT botix_api_token FROM integrations WHERE company_id = $1 AND type = \'botix_calendar\'',
      [companyId]
    );

    console.log('🔍 Resultado de la consulta:', result.rows);

    if (result.rows.length === 0) {
      console.error('❌ No se encontró integración para el company_id:', companyId);
      return res.status(404).json({ message: 'Integración no encontrada para este company_id' });
    }

    const tokens = result.rows.map(row => row.botix_api_token).filter(t => t);
    console.log('🔐 Tokens encontrados:', tokens);

    if (!tokens.includes(token)) {
      console.error('❌ El token recibido no coincide con ninguno de los almacenados');
      return res.status(401).json({ message: 'Token no autorizado' });
    }

    console.log('✅ Token validado correctamente');

    const { id_event, title, description, start_date, start_time, end_date, end_time, all_day, assignment_type, assignment_id, action } = req.body;

    const clientTimezone = 'America/Bogota';

    if (action === 'create') {
      // Validar campos requeridos
      if (!title || !start_date || !end_date || !assignment_type || !assignment_id) {
        console.error('❌ Faltan parámetros necesarios en el body');
        return res.status(400).json({ message: 'Faltan parámetros necesarios' });
      }

      const fecha_inicio = moment.tz(`${start_date} ${start_time}`, 'YYYY-MM-DD HH:mm', clientTimezone).format();
      const fecha_fin = moment.tz(`${end_date} ${end_time}`, 'YYYY-MM-DD HH:mm', clientTimezone).format();

      console.log('🗓️ Fechas formateadas:', { fecha_inicio, fecha_fin });

      const insertQuery = `
        INSERT INTO eventos (titulo, descripcion, fecha_inicio, fecha_fin, all_day, tipo_asignacion, id_asignacion, company_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING *
      `;
      const insertValues = [title, description, fecha_inicio, fecha_fin, all_day, assignment_type, assignment_id, companyId];

      const insertResult = await pool.query(insertQuery, insertValues);
      console.log('✅ Evento creado:', insertResult.rows[0]);

      return res.status(201).json({ message: 'Evento creado correctamente', event: insertResult.rows[0] });

    } else if (action === 'update') {
      if (!id_event) {
        return res.status(400).json({ message: 'Falta el id_event para actualizar' });
      }

      const fecha_inicio = moment.tz(`${start_date} ${start_time}`, 'YYYY-MM-DD HH:mm', clientTimezone).format();
      const fecha_fin = moment.tz(`${end_date} ${end_time}`, 'YYYY-MM-DD HH:mm', clientTimezone).format();

      const updateQuery = `
        UPDATE eventos
        SET titulo = $1, descripcion = $2, fecha_inicio = $3, fecha_fin = $4, all_day = $5, tipo_asignacion = $6, id_asignacion = $7
        WHERE id_evento = $8 AND company_id = $9
        RETURNING *
      `;
      const updateValues = [title, description, fecha_inicio, fecha_fin, all_day, assignment_type, assignment_id, id_event, companyId];

      const updateResult = await pool.query(updateQuery, updateValues);

      if (updateResult.rows.length === 0) {
        return res.status(404).json({ message: 'Evento no encontrado para actualizar' });
      }

      console.log('✅ Evento actualizado:', updateResult.rows[0]);
      return res.status(200).json({ message: 'Evento actualizado correctamente', event: updateResult.rows[0] });

    } else if (action === 'delete') {
      if (!id_event) {
        return res.status(400).json({ message: 'Falta el id_event para eliminar' });
      }

      const deleteQuery = `
        DELETE FROM eventos
        WHERE id_evento = $1 AND company_id = $2
        RETURNING *
      `;
      const deleteResult = await pool.query(deleteQuery, [id_event, companyId]);

      if (deleteResult.rows.length === 0) {
        return res.status(404).json({ message: 'Evento no encontrado para eliminar' });
      }

      console.log('✅ Evento eliminado:', deleteResult.rows[0]);
      return res.status(200).json({ message: 'Evento eliminado correctamente', event: deleteResult.rows[0] });

    } else {
      return res.status(400).json({ message: 'Acción no reconocida' });
    }

  } catch (error) {
    console.error('❌ Error al procesar:', error);
    return res.status(500).json({ message: 'Error interno del servidor' });
  }
});

app.post('/bot', async (req, res) => {
  console.log(`Solicitud recibida a las ${new Date().toISOString()}:`, req.body);
  const externalData = req.body;
  const { botCredentials } = req.body;
  const { email, password } = botCredentials;

  try {
    // Verificar las credenciales del bot
    const userResult = await pool.query(
      'SELECT id_usuario, contraseña, company_id FROM users WHERE email = $1',
      [email]
    );

    if (userResult.rowCount === 0) {
      console.log('Usuario no encontrado');
      return res.status(401).json({ error: 'Usuario no encontrado' });
    }

    const user = userResult.rows[0];

    const privilegesQuery = `
      SELECT p.name 
      FROM public."Privileges" p
      JOIN public."UserPrivileges" up ON p.id = up."privilegeId"
      WHERE up."userId" = $1;
    `;

    const privilegesResult = await pool.query(privilegesQuery, [user.id_usuario]);
    const privileges = privilegesResult.rows.map(row => row.name);

    const isPasswordCorrect = await bcrypt.compare(password, user.contraseña);
    if (!isPasswordCorrect) {
      console.log('Contraseña incorrecta');
      return res.status(401).json({ error: 'Contraseña incorrecta' });
    }

    const id_usuario = user.id_usuario;
    const company_id = user.company_id;
    const integrationDetails = await getIntegrationDetailsByCompanyId(company_id);
    const clientTimezone = req.clientTimezone || 'America/Bogota';

    // Consultar el código del bot
    const botResult = await pool.query('SELECT codigo FROM bots WHERE id_usuario = $1', [id_usuario]);
    if (botResult.rowCount === 0) {
      console.log('Bot no encontrado');
      return res.status(404).json({ error: 'Bot no encontrado' });
    }

    const botCode = botResult.rows[0].codigo;
    console.log("=========== Código del bot recibido ===========");
    console.log(botCode);
    console.log("============= FIN DEL CÓDIGO =============");

    // Crear JWT
    const newToken = jwt.sign(
      { id_usuario: user.id_usuario, email: email, privileges },
      process.env.JWT_SECRET,
    );

    // Armar el contexto
    const context = {
      newToken,
      sendTextMessage,
      sendImageMessage,
      sendVideoMessage,
      sendDocumentMessage,
      sendAudioMessage,
      sendTemplateMessage,
      sendTemplateToSingleContact: (io, req, res) => sendTemplateToSingleContact(io, newToken, req, res),
      sendLocationMessage,
      io,
      senderId: null,
      messageData: {},
      conversationId: null,
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
      externalData,
      clientTimezone,
      moment
    };

    // Ejecutar el código del bot usando eval
    try {
      // Desestructura variables para que eval las pueda ver
      const {
        newToken,
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
        externalData,
        clientTimezone,
        moment
      } = context;

      console.log("ejecutando el bot++++++++++");
      eval(botCode);

      res.status(200).json({ status: 'Bot ejecutado correctamente' });
    } catch (error) {
      console.error('Error ejecutando el código del bot:', error);
      res.status(500).json({ error: 'Error en el código del bot' });
    }

  } catch (error) {
    console.error('Error al verificar las credenciales o consultar el bot:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

//Iniciar el servidor HTTP y WebSocket
// db.sequelize.sync({ alter: true }) // Usa `alter: true` para ajustar las tablas existentes sin perder datos
//   .then(() => {
//     console.log('Modelos sincronizados correctamente.');
//    // Iniciar el servidor solo después de que la base de datos esté lista
//     server.listen(PORT, () => {
//       console.log(`Servidor escuchando en el puerto ${PORT}`);
//     });
//   })
//   .catch((error) => {
//     console.error('Error al sincronizar los modelos:', error);
//   });

db.sequelize.sync({ alter: true }) // Usa `alter: true` para ajustar las tablas existentes sin perder datos
  .then(() => {
    console.log('Modelos sincronizados correctamente.');
    // Iniciar el servidor solo después de que la base de datos esté lista
    httpsServer.listen(PORT, () => {
      console.log(`Servidor escuchando en el puerto ${PORT}`);
    });
  })
  .catch((error) => {
    console.error('Error al sincronizar los modelos:', error);
  })
// Asegúrate de exportar `io` si lo necesitas en otros módulos
export { io };