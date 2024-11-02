import axios from 'axios';
import https from 'https';
import fs from 'fs';
import path from 'path';
import pool from '../config/dbConfig.js';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import ffmpeg from 'fluent-ffmpeg';
import moment from 'moment-timezone';
import { sendTextMessage, sendImageMessage, sendVideoMessage, sendDocumentMessage, sendAudioMessage, sendTemplateMessage, sendTemplateToSingleContact, sendLocationMessage } from '../handlers/repliesHandler.js';
// import { google } from 'googleapis'; 
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const httpsAgent = new https.Agent({
  rejectUnauthorized: false,
});

const axiosInstance = axios.create({
  httpsAgent,
});

const externalData = '';

import serviceAccount from '../../crm-android-system.json' assert { type: 'json' };

// Crear cliente de autenticación
// const authClient = new google.auth.GoogleAuth({
//   credentials: serviceAccount,
//   scopes: ['https://www.googleapis.com/auth/firebase.messaging'],
// });


const getDeviceTokenForUser = async (phone, id_usuario) => {
  // Implementa la lógica para recuperar el token del dispositivo desde la base de datos
  // o donde sea que estés almacenando los tokens de los usuarios
  if (phone) {
    const res = await pool.query('SELECT token_firebase FROM users WHERE id_usuario = $1', [id_usuario]);
    return res.rows[0] ? res.rows[0].token_firebase : null;   
  } else if (id_usuario) {
    
    const res = await pool.query('SELECT token_firebase FROM users WHERE id_usuario = $1', [id_usuario]);
    return res.rows[0] ? res.rows[0].token_firebase : null;
  }
}

const sendNotificationToFCM = async (phone, messageText, id_usuario, nombre, apellido, foto) => {
  // Obtener el token del dispositivo del usuario
  const deviceToken = await getDeviceTokenForUser(phone, id_usuario);
  if (!deviceToken) {
    console.log('No se encontró el token del dispositivo para:', id_usuario);
    return;
  }

  console.log("Token del usuario:", deviceToken);

  const notificationPayload = {
    message: {
      token: deviceToken,
      notification: {
        title: `${nombre} ${apellido}`,
        body: messageText,
        image: `${process.env.BACKEND_URL}${foto}`,
      },
      data: {
        text: messageText,
        senderId: phone || id_usuario,
      },
    },
  };

  try {
    // Obtener el token de acceso OAuth
    const accessToken = await authClient.getAccessToken();

    // Enviar la notificación usando el token de acceso
    const response = await axios.post(
      `https://fcm.googleapis.com/v1/projects/${process.env.FIREBASE_PROJECT_ID}/messages:send`,
      notificationPayload,
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`, // Aquí va el token de acceso OAuth
        },
      }
    );

    return response.data;
  } catch (error) {
    console.error('Error enviando la notificación:', error.response ? error.response.data : error.message);
    throw error;
  }
};

async function processMessage(io, senderId, messageData, oldMessage, integrationDetails, req) {
  console.log('Procesando mensaje del remitente:', senderId);
  console.log('Datos del mensaje:', messageData);

  const { whatsapp_api_token, company_id, id: integration_id, whatsapp_phone_number_id } = integrationDetails;

  // Usar req.clientTimezone directamente
  const clientTimezone = req.clientTimezone || 'America/Bogota';

  console.log(`Zona horaria del cliente: ${clientTimezone}`);

  const contactId = await getOrCreateContact(senderId, company_id);
  const conversationId = await getOrCreateConversation(contactId, senderId, integration_id, company_id);

  if (oldMessage !== "Si") {
    const incrementUnread = `UPDATE conversations SET unread_messages = unread_messages + 1 WHERE conversation_id = $1`;
    await pool.query(incrementUnread, [conversationId]);

    const unreadRes = await pool.query('SELECT unread_messages, id_usuario FROM conversations WHERE conversation_id = $1', [conversationId]);
    const unreadMessages = unreadRes.rows[0].unread_messages;
    const responsibleUserId = unreadRes.rows[0].id_usuario;

    let mediaUrl = null;
    let messageText = messageData.text || null;
    let replyFrom = messageData.context?.from || null;

    if (['image', 'audio', 'video', 'document', 'sticker'].includes(messageData.type)) {
      const mediaData = messageData[messageData.type];
      if (mediaData && mediaData.id && mediaData.mime_type) {
        mediaUrl = await downloadMedia(mediaData.id, mediaData.mime_type, whatsapp_api_token);
        if (['image', 'video', 'document'].includes(messageData.type) && mediaData.caption) {
          messageText = mediaData.caption;
        }
      }
    }

    console.log('Responder desde ID:', replyFrom);

    let thumbnailUrl = null;
    let mediaDuration = null;

    if (['video', 'audio'].includes(messageData.type) && mediaUrl) {
      const mediaPath = path.join(__dirname, '..', '..', 'public', mediaUrl);
      if (fs.existsSync(mediaPath)) {
        try {
          mediaDuration = await getVideoDurationInSeconds(mediaPath);
          if (messageData.type === 'video') {
            const thumbnailPath = await createThumbnail(mediaPath);
            thumbnailUrl = thumbnailPath.replace('public', '');
          }
        } catch (err) {
          console.error('Error obteniendo la duración del medio o generando miniatura:', err);
        }
      }
    }

    const insertQuery = `
      INSERT INTO messages (
        id,
        sender_id,
        conversation_fk,
        message_type,
        message_text,
        message_media_url,
        thumbnail_url,
        duration,
        latitude,
        longitude,
        file_name,
        reply_from
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *;
    `;

    const values = [
      messageData.id,
      senderId,
      conversationId,
      messageData.type,
      messageText,
      mediaUrl,
      thumbnailUrl,
      mediaDuration,
      messageData.latitude || null,
      messageData.longitude || null,
      messageData.file_name || null,
      replyFrom
    ];

    try {
      const res = await pool.query(insertQuery, values);
      console.log('Mensaje insertado con ID de conversación:', conversationId, 'Detalles del mensaje:', res.rows[0]);
      const newMessage = res.rows[0];

      const usuario_send = await pool.query(
        'SELECT * FROM contacts WHERE phone_number = $1', 
        [senderId]
      );

      const integracionSelect = await pool.query(
        'SELECT * FROM integrations WHERE id = $1', 
        [integration_id]
      );
      
      // Consulta para obtener los administradores
      const adminQuery = `
        SELECT id_usuario FROM users 
        WHERE company_id = $1 
          AND rol IN (SELECT id FROM roles WHERE name = 'Administrador')
      `;
      const adminResult = await pool.query(adminQuery, [company_id]);


      const adminIds = adminResult.rows.map(row => row.id_usuario);

      // Emitir el mensaje al usuario responsable y a los administradores
      const recipients = [responsibleUserId, ...adminIds];
      recipients.forEach(userId => {
        io.to(`user-${userId}`).emit('newMessage', {
          id: newMessage.id,
          conversationId: conversationId,
          timestamp: newMessage.received_at,
          senderId: senderId,
          message_type: messageData.type,
          text: newMessage.message_text,
          url: newMessage.message_media_url,
          thumbnail_url: newMessage.thumbnail_url,
          duration: mediaDuration,
          latitude: messageData.latitude || null,
          longitude: messageData.longitude || null,
          type: 'message',
          unread_messages: unreadMessages,
          responsibleUserId: responsibleUserId,
          file_name: messageData.file_name,
          reply_from: newMessage.reply_from,
          state: newMessage.state,
          company_id: integrationDetails.company_id,
        destino_nombre: usuario_send.rows[0].first_name || '',
        destino_apellido: usuario_send.rows[0].last_name || '',
        destino_foto: usuario_send.profile_url || '',
        integracion: integracionSelect.rows[0].name || '',
        });
      });


      console.log('Mensaje emitido:', newMessage.id);

      // Obtener el rol del usuario responsable y procesar según su tipo
      const roleQuery = 'SELECT rol FROM users WHERE id_usuario = $1';
      const roleResult = await pool.query(roleQuery, [responsibleUserId]);
      if (roleResult.rows.length > 0) {
        const userRole = roleResult.rows[0].rol;

        const typeQuery = 'SELECT type FROM roles WHERE id = $1';
        const typeResult = await pool.query(typeQuery, [userRole]);
        if (typeResult.rows.length > 0) {
          const roleType = typeResult.rows[0].type;

          if (roleType.includes('Bot')) {
            // Obtener y ejecutar el código del bot
            const botQuery = 'SELECT codigo FROM bots WHERE id_usuario = $1';
            const botResult = await pool.query(botQuery, [responsibleUserId]);
            if (botResult.rows.length > 0) {
              const botCode = botResult.rows[0].codigo;

              // Ejecutar el código del bot (esto depende de cómo esté estructurado el código de los bots)
              await executeBotCode(botCode, {
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
                axios: axiosInstance,
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
              });
            } else {
              console.error('No se encontró código del bot para el usuario:', responsibleUserId);
            }
          }
        } else {
          console.error('No se encontró tipo de rol para el rol:', userRole);
        }
      } else {
        console.error('No se encontró rol para el usuario:', responsibleUserId);
      }
    } catch (error) {
      console.error('Error insertando mensaje en la base de datos:', error);
    }
  } else {
    console.log('Mensaje redirigido, no se almacena ni se emite');
  }
}


async function getOrCreateConversation(contactId, phoneNumber, integrationId, companyId) {
  const findQuery = 'SELECT conversation_id, id_usuario FROM conversations WHERE contact_id = $1';
  try {
    let result = await pool.query(findQuery, [contactId]);
    if (result.rows.length > 0) {
      return result.rows[0].conversation_id;
    } else {
      // Obtener el usuario predeterminado para la empresa
      const defaultUserQuery = `
        SELECT id_usuario 
        FROM default_users 
        WHERE company_id = $1
      `;
      const defaultUserResult = await pool.query(defaultUserQuery, [companyId]);
      const defaultUserId = defaultUserResult.rows[0].id_usuario;

      const insertQuery = 'INSERT INTO conversations (phone_number, state, id_usuario, contact_id, integration_id) VALUES ($1, $2, $3, $4, $5) RETURNING conversation_id';
      const conversationResult = await pool.query(insertQuery, [phoneNumber, 'new', defaultUserId, contactId, integrationId]);
      const conversationId = conversationResult.rows[0].conversation_id;
      return conversationId;
    }
  } catch (err) {
    console.error('Error de base de datos en getOrCreateConversation:', err);
    throw err;
  }
}

async function executeBotCode(botCode, context) {
  const {
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

  try {
    const botFunction = new Function(
      'sendTextMessage',
      'sendImageMessage',
      'sendVideoMessage',
      'sendDocumentMessage',
      'sendAudioMessage',
      'sendTemplateMessage',
      'sendTemplateToSingleContact',
      'sendLocationMessage',
      'io',
      'senderId',
      'messageData',
      'conversationId',
      'pool',
      'axios',
      'getContactInfo',
      'updateContactName',
      'createContact',
      'updateContactCompany',
      'updateConversationState',
      'assignResponsibleUser',
      'processMessage',
      'getReverseGeocoding',
      'getGeocoding',
      'integrationDetails',
      'externalData',
      'clientTimezone',
      'moment',
      botCode
    );

    await botFunction(
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
    );
  } catch (error) {
    console.error('Error ejecutando el código del bot:', error);
  }
}

async function updateConversationState(conversationId, newState) {
  const query = 'UPDATE conversations SET state = $2 WHERE conversation_id = $1';
  try {
    await pool.query(query, [conversationId, newState]);
  } catch (error) {
    console.error('Error de base de datos actualizando estado de conversación:', error);
    throw error;
  }
}

const getVideoDurationInSeconds = (videoPath) => new Promise((resolve, reject) => {
  ffmpeg.ffprobe(videoPath, (err, metadata) => {
    if (err) {
      reject(err);
    } else {
      resolve(metadata.format.duration);
    }
  });
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

async function downloadMedia(mediaId, mimeType, whatsapp_api_token) {
  console.log('ID de medio recibido para descargar:', mediaId);
  const getUrl = `https://graph.facebook.com/v19.0/${mediaId}`;

  try {
    const getUrlResponse = await axios.get(getUrl, {
      headers: {
        'Authorization': `Bearer ${whatsapp_api_token}`,
      },
    });

    const mediaUrl = getUrlResponse.data.url;
    if (!mediaUrl) {
      console.error('URL de medio no encontrada en la respuesta:', getUrlResponse.data);
      return null;
    }

    const mediaResponse = await axios.get(mediaUrl, {
      responseType: 'arraybuffer',
      headers: {
        'Authorization': `Bearer ${whatsapp_api_token}`,
      },
    });

    const extension = mimeType.split('/')[1];
    let mediaDir;
    switch (mimeType.split('/')[0]) {
      case 'image':
        mediaDir = path.join(__dirname, '..', '..', 'public', 'media', 'images');
        break;
      case 'audio':
        mediaDir = path.join(__dirname, '..', '..', 'public', 'media', 'audios');
        break;
      case 'video':
        mediaDir = path.join(__dirname, '..', '..', 'public', 'media', 'videos');
        break;
      case 'application':
        mediaDir = path.join(__dirname, '..', '..', 'public', 'media', 'documents');
        break;
      default:
        mediaDir = path.join(__dirname, '..', '..', 'public', 'media', 'documents');
        break;
    }

    if (!fs.existsSync(mediaDir)) {
      fs.mkdirSync(mediaDir, { recursive: true });
    }

    const mediaPath = path.join(mediaDir, `${mediaId}.${extension}`);
    fs.writeFileSync(mediaPath, mediaResponse.data);
    console.log('Medio almacenado en:', mediaPath);

    const mediaServerUrl = `/media/${mimeType.split('/')[0] === 'application' ? 'documents' : mimeType.split('/')[0] + 's'}/${mediaId}.${extension}`;
    return mediaServerUrl;
  } catch (error) {
    console.error('Error al descargar medio:', error.message);
    return null;
  }
}

async function getOrCreateContact(phoneNumber, companyId) {
  const findQuery = 'SELECT id FROM contacts WHERE phone_number = $1 AND company_id = $2';
  try {
    let result = await pool.query(findQuery, [phoneNumber, companyId]);
    if (result.rows.length > 0) {
      return result.rows[0].id;
    } else {
      const contactQuery = 'INSERT INTO contacts (phone_number, company_id) VALUES ($1, $2) RETURNING id';
      const contactResult = await pool.query(contactQuery, [phoneNumber, companyId]);
      const contactId = contactResult.rows[0].id;
      console.log(`ID del contacto: ${contactId}`);
      return contactId;
    }
  } catch (err) {
    console.error('Error de base de datos en getOrCreateContact:', err);
    throw err;
  }
}

async function getContactInfo(phoneNumber, companyId) {
  const query = 'SELECT first_name, last_name, organization, id FROM contacts WHERE phone_number = $1 AND company_id = $2';
  try {
    const result = await pool.query(query, [phoneNumber, companyId]);
    if (result.rows.length > 0) {
      return result.rows[0];
    } else {
      return null;
    }
  } catch (err) {
    console.error('Database error in getContactInfo:', err);
    throw err;
  }
}

async function updateContactName(io, phoneNumber, companyId, firstName, lastName) {
  const query = `
    UPDATE contacts SET 
    first_name = $3, 
    last_name = $4
    WHERE phone_number = $1 AND company_id = $2
    RETURNING *;
  `;
  try {
    const result = await pool.query(query, [phoneNumber, companyId, firstName, lastName]);
    if (result.rows.length > 0) {
      const updatedContact = result.rows[0];
      io.emit('contactUpdated', updatedContact);
    } else {
      console.log('No contact found for the given phone number and company ID.');
    }
  } catch (err) {
    console.error('Database error in updateContactName:', err);
    throw err;
  }
}

async function updateContactCompany(io, phoneNumber, companyId, organization) {
  const query = `
    UPDATE contacts SET 
    organization = $3 
    WHERE phone_number = $1 AND company_id = $2
    RETURNING *;
  `;
  try {
    const result = await pool.query(query, [phoneNumber, companyId, organization]);
    if (result.rows.length > 0) {
      const updatedContact = result.rows[0];
      io.emit('contactUpdated', updatedContact);
    } else {
      console.log('No contact found for the given phone number and company ID.');
    }
  } catch (err) {
    console.error('Database error in updateContactCompany:', err);
    throw err;
  }
}

async function createContact(io, phoneNumber, companyId, firstName, lastName, organization, label) {
  const query = `
    INSERT INTO contacts (
      phone_number, 
      company_id,
      first_name, 
      last_name, 
      organization,
      label
    ) VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING *;
  `;
  try {
    const result = await pool.query(query, [phoneNumber, companyId, firstName, lastName, organization, label]);
    const newContact = result.rows[0];
    io.emit('contactUpdated', newContact);
  } catch (err) {
    console.error('Database error in createContact:', err);
    throw err;
  }
}

async function obtenerRespuestaGPT(prompt) {
  const apiKey = process.env.OPENAI_API_KEY;
  const url = "https://api.openai.com/v1/chat/completions";

  const headers = {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json'
  };

  const payload = {
    model: "gpt-4",
    messages: [
      { role: "system", content: "Eres un asistente virtual de Axioma Robotics para la prueba de funcionamiento de los Chat Bots." },
      { role: "user", content: prompt }
    ]
  };

  try {
    const response = await axios.post(url, payload, { headers });
    return response.data.choices[0].message.content.trim();
  } catch (error) {
    console.error("Error al obtener respuesta de GPT-4:", error);
    return "Error al obtener la respuesta";
  }
}

async function getReverseGeocoding(latitude, longitude) {
  try {
    const api = process.env.GOOGLE_MAPS_API_KEY
    const response = await axios.get(`https://maps.googleapis.com/maps/api/geocode/json?latlng=${latitude},${longitude}&key=${api}`);
    console.log(api);
    console.log(response);
    const data = response.data;

    if (data.status !== 'OK' || !data.results[0]) {
      console.error('Geocoding error:', data.status);
      return null;
    }

    const addressComponents = data.results[0].address_components;
    const road = addressComponents.find(comp => comp.types.includes('route'))?.long_name;
    const house_number = addressComponents.find(comp => comp.types.includes('street_number'))?.long_name;
    const city = addressComponents.find(comp => comp.types.includes('locality'))?.long_name;
    const state = addressComponents.find(comp => comp.types.includes('administrative_area_level_1'))?.long_name;
    const country = addressComponents.find(comp => comp.types.includes('country'))?.long_name;

    // Construye la dirección en el formato deseado
    let formattedAddress = `${road || ''} #${house_number || ''}, ${city || ''}, ${country || ''}`;
    formattedAddress = formattedAddress.replace(/\s{2,}/g, ' ').replace(/^,\s*|,\s*$/g, '');

    return formattedAddress;
  } catch (error) {
    console.error('Error during reverse geocoding:', error.response.data || error.message);
    return null;
}
}

async function getGeocoding(address) {
  try {
    const response = await axios.get(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${process.env.GOOGLE_MAPS_API_KEY}`);
    if (response.data.status !== 'OK') {
      console.error('Geocoding error:', response.data.status);
      return null;
    }

    const { lat, lng } = response.data.results[0].geometry.location;
    return { latitude: lat, longitude: lng };
  } catch (error) {
    console.error('Error during geocoding:', error);
    return null;
  }
}

async function assignResponsibleUser(io, conversationId, oldUserId, newUserId) {
  const query = 'UPDATE conversations SET id_usuario = $2 WHERE conversation_id = $1 RETURNING *;';

  try {
    const result = await pool.query(query, [conversationId, newUserId]);
    const updatedConversation = result.rows[0];

    io.emit('responsibleChanged', {
      conversationId,
      newUserId,
      updatedConversation
    });

    if (oldUserId && oldUserId !== newUserId) {
      io.to(`user-${newUserId}`).emit('responsibleChanged', {
        conversationId,
        newUserId,
        updatedConversation
      });
      io.to(`user-${oldUserId}`).emit('responsibleRemoved', {
        conversationId
      });
      console.log(`Emitted responsibleRemoved to oldUserId: ${oldUserId}`);
    }

    io.emit('updateConversationInfo', {
      conversationId,
      updatedConversation
    });
  } catch (error) {
    console.error('Database error assigning responsible user:', error);
    throw error;
  }
}

async function handleNewMessage(io, senderId, messageData) {
  const conversationId = await getOrCreateConversation(senderId);
  const currentState = await getConversationState(conversationId);
  await processConversationRouter(io, senderId, messageData, conversationId, currentState);
}

async function getConversationState(conversationId) {
  const query = 'SELECT state FROM conversations WHERE conversation_id = $1';
  try {
    const result = await pool.query(query, [conversationId]);
    if (result.rows.length > 0) {
      return result.rows[0].state;
    } else {
      return 'new';
    }
  } catch (error) {
    console.error('Database error getting conversation state:', error);
    throw error;
  }
}

export { processMessage, updateConversationState, getOrCreateContact, getContactInfo, updateContactName, createContact, updateContactCompany, getReverseGeocoding, getGeocoding, assignResponsibleUser };
