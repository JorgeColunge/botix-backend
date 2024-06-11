import dotenv from 'dotenv';
import express from 'express';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import bodyParser from 'body-parser';
import cors from 'cors';
import { processMessage } from './handlers/messageHandler.js';
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

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config();
const app = express();
const PORT = process.env.PORT || 3001;

// Configuración de CORS y otros middleware
app.use(cors({
  origin: process.env.FRONTEND_URL, // Ajusta según sea necesario para tu ambiente de producción
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true
}));
app.use(express.json());
app.use(bodyParser.json());
app.use((req, res, next) => {
  console.log(`Received ${req.method} request to ${req.path}`);
  next();
});

// Configuración del servidor HTTP y Socket.IO
const server = createServer(app);
const io = new SocketIOServer(server, {
  cors: {
    origin: process.env.FRONTEND_URL, // Asegúrate de que coincide con el puerto y host del cliente
    methods: ['GET', 'POST'],
    credentials: true
  }
});

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
app.use('/api', router);
app.use('/images', express.static('public/image'));
app.use('/media', express.static('public/media'));
app.use('/thumbnail', express.static('public/thumbnail'));
app.use('/api/auth', authRoutes);

// Función para responder inmediatamente a WhatsApp
function respondToWhatsApp(req, res) {
  res.status(200).send({ status: 'received' });
  console.log(`Received message at ${new Date().toISOString()}`);
}



app.post('/webhook', async (req, res) => {
  respondToWhatsApp(req, res); // Envía la respuesta inmediata

  console.log(`Webhook received at ${new Date().toISOString()}: ${JSON.stringify(req.body, null, 2)}`);

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
          continue;
        }

        if (change.value && change.value.statuses && change.value.statuses.length > 0) {
          for (const statusUpdate of change.value.statuses) {
            const messageId = statusUpdate.id;
            const status = statusUpdate.status;

            // Actualizar estado del mensaje en la tabla replies
            await updateReplyStatus(messageId, status);

            // Emitir evento a través de socket.io
            io.emit('replyStatusUpdate', { messageId, status });
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
                await processMessage(io, senderId, { id: messageId, type: 'text', text: firstMessage.text.body, context }, "no");
              }
              break;
            case 'location':
              if (firstMessage.location) {
                await processMessage(io, senderId, {
                  id: messageId,
                  type: 'location',
                  latitude: firstMessage.location.latitude,
                  longitude: firstMessage.location.longitude,
                  context
                });
              }
              break;
            case 'image':
              await processMessage(io, senderId, { id: messageId, type: 'image', image: firstMessage.image, context }, "no");
              break;
            case 'audio':
              await processMessage(io, senderId, { id: messageId, type: 'audio', audio: firstMessage.audio, context }, "no");
              break;
            case 'video':
              await processMessage(io, senderId, { id: messageId, type: 'video', video: firstMessage.video, context }, "no");
              break;
            case 'document':
              const file_name = firstMessage.document.filename;
              await processMessage(io, senderId, { id: messageId, type: 'document', document: firstMessage.document, file_name, context }, "no");
              break;
            case 'sticker':
              await processMessage(io, senderId, { id: messageId, type: 'sticker', sticker: firstMessage.sticker, context }, "no");
              break;
            case 'button':
              if (firstMessage.button) {
                await processMessage(io, senderId, { id: messageId, type: 'button', text: firstMessage.button.text, context }, "no");
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
    `;
    await pool.query(query, [status, messageId]);
    console.log(`Reply ${messageId} updated to state ${status}`);
  } catch (error) {
    console.error('Error updating reply status:', error);
  }
};

app.post('/upload', upload.single('image'), (req, res) => {
  if (req.file) {
    const imagePath = req.file.path;
    res.json({ success: true, path: imagePath });
  } else {
    res.status(400).send('No se pudo subir el archivo');
  }
});


app.post('/upload', upload.single('image'), (req, res) => {
  if (req.file) {
    const imagePath = req.file.path;
    res.json({ success: true, path: imagePath });
  } else {
    res.status(400).send('No se pudo subir el archivo');
  }
});

// Endpoint para la verificación del webhook
app.get('/webhook', (req, res) => {
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

app.post('/upload-template-media', uploadTemplateMedia.single('media'), async (req, res) => {
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

      res.status(200).send({ mediaUrl: `/media/templates/whatsapp/compressed/${req.file.filename}` });
    } else {
      res.status(200).send({ mediaUrl: `/media/templates/whatsapp/${req.file.filename}` });
    }
  } catch (error) {
    console.error('Error processing media file:', error);
    res.status(500).send(error.message);
  }
});

app.post('/create-template', async (req, res) => {
  const { name, language, category, components, componentsWithSourceAndVariable, company_id } = req.body;
  const whatsappApiToken = process.env.WHATSAPP_API_TOKEN;
  const whatsappBusinessAccountId = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;

  const validName = name.toLowerCase().replace(/[^a-z0-9_]/g, '_');

  if (!Array.isArray(components)) {
    return res.status(400).send({ error: 'The parameter components must be an array.' });
  }

  let headerType = null;
  let typeMedio = null;
  let medio = null;
  let bodyText = null;
  let typeButton = null;
  let buttonText = null;
  let headerText = null;
  let footer = null;

  components.forEach(component => {
    if (component.type === 'HEADER') {
      headerType = component.format;
      if (['IMAGE', 'VIDEO', 'DOCUMENT'].includes(headerType)) {
        typeMedio = component.format;
        medio = component.example?.header_handle[0] || null;
      } else if (headerType === 'TEXT') {
        headerText = component.text;
      }
    } else if (component.type === 'BODY') {
      bodyText = component.text;
    } else if (component.type === 'FOOTER') {
      footer = component.text;
    } else if (component.type === 'BUTTONS') {
      typeButton = component.buttons[0]?.type;
      buttonText = component.buttons[0]?.text;
    }
  });

  const isMediaTemplate = ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(headerType);

  if (isMediaTemplate) {
    try {
      const query = `
        INSERT INTO templates_wa (type, nombre, language, header_type, type_medio, medio, body_text, type_button, button_text, header_text, footer, state, company_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
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
        typeButton,
        buttonText,
        headerText,
        footer,
        'PENDING',
        company_id
      ];
      const result = await pool.query(query, values);
      const templateId = result.rows[0].id;

      // Almacenar variables del cuerpo
      const bodyVariables = componentsWithSourceAndVariable.find(c => c.type === 'BODY')?.example?.body_text[0] || [];
      const bodySources = componentsWithSourceAndVariable.find(c => c.type === 'BODY')?.source || [];
      const bodyVariableNames = componentsWithSourceAndVariable.find(c => c.type === 'BODY')?.variable || [];
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

      // Almacenar variables del encabezado
      const headerVariables = componentsWithSourceAndVariable.find(c => c.type === 'HEADER')?.example?.header_text || [];
      const headerSources = componentsWithSourceAndVariable.find(c => c.type === 'HEADER')?.source || [];
      const headerVariableNames = componentsWithSourceAndVariable.find(c => c.type === 'HEADER')?.variable || [];
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

      // Almacenar variables del botón
      const buttonVariables = componentsWithSourceAndVariable.find(c => c.type === 'BUTTONS')?.buttons[0]?.example?.url_text || [];
      const buttonSources = componentsWithSourceAndVariable.find(c => c.type === 'BUTTONS')?.source || [];
      const buttonVariableNames = componentsWithSourceAndVariable.find(c => c.type === 'BUTTONS')?.variable || [];
      if (Array.isArray(buttonVariables) && buttonVariables.length > 0) {
        const queryButton = `
          INSERT INTO variable_button (name, example, template_wa_id, source, variable)
          VALUES ($1, $2, $3, $4, $5)
        `;
        const valuesButton = [
          `{{1}}`, 
          buttonVariables.join(''), 
          templateId,
          buttonSources[0],
          buttonVariableNames[0]
        ];
        await pool.query(queryButton, valuesButton);
      }

      res.status(200).send({ id: templateId, message: 'Template stored successfully without sending to WhatsApp.' });
    } catch (error) {
      console.error('Error storing template:', error.message);
      res.status(500).send({ error: error.message });
    }
  } else {
    try {
      const response = await axios.post(
        `https://graph.facebook.com/v20.0/${whatsappBusinessAccountId}/message_templates`,
        {
          name: validName,
          language,
          category,
          components
        },
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
        INSERT INTO templates_wa (id, type, nombre, language, header_type, type_medio, medio, body_text, type_button, button_text, header_text, footer, state, company_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
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
        typeButton,
        buttonText,
        headerText,
        footer,
        'PENDING',
        company_id
      ];
      await pool.query(query, values);

      // Almacenar variables del cuerpo
      const bodyVariables = componentsWithSourceAndVariable.find(c => c.type === 'BODY')?.example?.body_text[0] || [];
      const bodySources = componentsWithSourceAndVariable.find(c => c.type === 'BODY')?.source || [];
      const bodyVariableNames = componentsWithSourceAndVariable.find(c => c.type === 'BODY')?.variable || [];
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

      // Almacenar variables del encabezado
      const headerVariables = componentsWithSourceAndVariable.find(c => c.type === 'HEADER')?.example?.header_text || [];
      const headerSources = componentsWithSourceAndVariable.find(c => c.type === 'HEADER')?.source || [];
      const headerVariableNames = componentsWithSourceAndVariable.find(c => c.type === 'HEADER')?.variable || [];
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

      // Almacenar variables del botón
      const buttonVariables = componentsWithSourceAndVariable.find(c => c.type === 'BUTTONS')?.buttons[0]?.example?.url_text || [];
      const buttonSources = componentsWithSourceAndVariable.find(c => c.type === 'BUTTONS')?.source || [];
      const buttonVariableNames = componentsWithSourceAndVariable.find(c => c.type === 'BUTTONS')?.variable || [];
      if (Array.isArray(buttonVariables) && buttonVariables.length > 0) {
        const queryButton = `
          INSERT INTO variable_button (name, example, template_wa_id, source, variable)
          VALUES ($1, $2, $3, $4, $5)
        `;
        const valuesButton = [
          `{{1}}`, 
          buttonVariables.join(''), 
          templateId,
          buttonSources[0],
          buttonVariableNames[0]
        ];
        await pool.query(queryButton, valuesButton);
      }

      res.status(200).send(response.data);
    } catch (error) {
      console.error('Error creating template:', error.response ? error.response.data : error.message);
      res.status(500).send(error.response ? error.response.data : error.message);
    }
  }
});




app.post('/create-flow', async (req, res) => {
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






// Iniciar el servidor HTTP y WebSocket
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// Asegúrate de exportar `io` si lo necesitas en otros módulos
export { io };