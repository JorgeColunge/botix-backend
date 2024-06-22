import axios from 'axios';
import fs from 'fs';
import path from 'path';
import pool from '../config/dbConfig.js';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { processConversation } from './chatbot.js';
import { processConversationRouter } from './routerChatbot.js';
import { processEsteticaConversation } from './routerEstetica.js';
import { processRestauranteConversation } from './restaurantChatbot.js';
import { processLanguageConversation } from './lenguageChatbot.js';
import ffmpeg from 'fluent-ffmpeg';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = process.env.PORT || 3001;

async function processMessage(io, senderId, messageData, oldMessage, integrationDetails) {
  console.log('Procesando mensaje del remitente:', senderId);
  console.log('Datos del mensaje:', messageData);

  const { whatsapp_api_token, company_id, id: integration_id, whatsapp_phone_number_id } = integrationDetails;

  const conversationId = await getOrCreateConversation(senderId, integration_id);

  const lastMessageQuery = `
    SELECT received_at FROM messages
    WHERE conversation_fk = $1
    ORDER BY received_at DESC
    LIMIT 1;
  `;
  const lastMessageRes = await pool.query(lastMessageQuery, [conversationId]);

  if (lastMessageRes.rows.length > 0) {
    const lastMessageTime = new Date(lastMessageRes.rows[0].received_at);
    const currentTime = new Date();
    const timeDifference = (currentTime - lastMessageTime) / (1000 * 60); 

    if (whatsapp_phone_number_id === '245093422023458' && timeDifference > 5) {
      await assignResponsibleUser(conversationId, 1011);
      await processConversationRouter(io, senderId, messageData, conversationId, 'new', integrationDetails);
    } else if (whatsapp_phone_number_id === '356027174259293' && timeDifference > 5) {
      await assignResponsibleUser(conversationId, 654321);
    } 
  }

  const incrementUnread = `UPDATE conversations SET unread_messages = unread_messages + 1 WHERE conversation_id = $1`;
  await pool.query(incrementUnread, [conversationId]);

  const unreadRes = await pool.query('SELECT unread_messages, id_usuario FROM conversations WHERE conversation_id = $1', [conversationId]);
  const unreadMessages = unreadRes.rows[0].unread_messages;
  const responsibleUserId = unreadRes.rows[0].id_usuario;

  let mediaUrl = null;
  let messageText = messageData.text || null; 
  let replyFrom = messageData.context?.from || null;

  if (messageData.type === 'image' || messageData.type === 'audio' || messageData.type === 'video' || messageData.type === 'document' || messageData.type === 'sticker') {
    const mediaType = messageData.type;
    const mediaData = messageData[mediaType];
    if (mediaData && mediaData.id && mediaData.mime_type) {
      mediaUrl = await downloadMedia(mediaData.id, mediaData.mime_type, whatsapp_api_token);
      if ((mediaType === 'image' || mediaType === 'video' || mediaType === 'document') && mediaData.caption) {
        messageText = mediaData.caption;
      }
    }
  } 

  console.log('Responder desde ID:', replyFrom);

  let thumbnailUrl = null;
  let mediaDuration = null;

  if ((messageData.type === 'video' || messageData.type === 'audio') && mediaUrl) {
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
  const state = await getConversationState(conversationId);

  if (oldMessage == "no") {
    try {
      const res = await pool.query(insertQuery, values);
      console.log('Mensaje insertado con ID de conversación:', conversationId, 'Detalles del mensaje:', res.rows[0]);
      const newMessage = res.rows[0];

      io.emit('newMessage', {
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
        state: newMessage.state
      });

      console.log('Mensaje emitido:', newMessage.id);
    } catch (error) {
      console.error('Error insertando mensaje en la base de datos:', error);
    }
  }

  if (whatsapp_phone_number_id === '245093422023458') {
    const lastMessageTime = new Date(lastMessageRes.rows[0].received_at);
    const currentTime = new Date();
    const timeDifference = (currentTime - lastMessageTime) / (1000 * 60);

    if (timeDifference > 5) {
      await assignResponsibleUser(conversationId, 1011);
      await processConversationRouter(io, senderId, messageData, conversationId, state, integrationDetails);
    } else {
      if (responsibleUserId === 1010) {
        await processConversation(io, senderId, messageData, conversationId, state, integrationDetails);
      } else if (responsibleUserId === 1011) {
        await processConversationRouter(io, senderId, messageData, conversationId, state, integrationDetails);
      } else if (responsibleUserId === 1013) {
        await processEsteticaConversation(io, senderId, messageData, conversationId, state, integrationDetails);
      } else if (responsibleUserId === 1012) {
        await processRestauranteConversation(io, senderId, messageData, conversationId, state, integrationDetails);
      } else if (responsibleUserId === 1014) {
        await processLanguageConversation(io, senderId, messageData, conversationId, state, integrationDetails);
      }
    }
  } else if (whatsapp_phone_number_id === '356027174259293') {
    if (oldMessage == "no") {
      await assignResponsibleUser(conversationId, 654321);
    }
  }
}

async function assignResponsibleUser(conversationId, userId) {
  const query = 'UPDATE conversations SET id_usuario = $2 WHERE conversation_id = $1';
  try {
    await pool.query(query, [conversationId, userId]);
  } catch (error) {
    console.error('Error de base de datos asignando usuario responsable:', error);
    throw error;
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

async function downloadMedia(mediaId, mimeType, whatsappApiToken) {
  console.log('ID de medio recibido para descargar:', mediaId);
  const getUrl = `https://graph.facebook.com/v19.0/${mediaId}`;

  try {
    const getUrlResponse = await axios.get(getUrl, {
      headers: {
        'Authorization': `Bearer ${whatsappApiToken}`,
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
        'Authorization': `Bearer ${whatsappApiToken}`,
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

async function getOrCreateConversation(phoneNumber, integrationId) {
  const findQuery = 'SELECT conversation_id FROM conversations WHERE phone_number = $1';
  try {
    let result = await pool.query(findQuery, [phoneNumber]);
    if (result.rows.length > 0) {
      return result.rows[0].conversation_id;
    } else {
      const contactQuery = 'INSERT INTO contacts (phone_number, label) VALUES ($1, $2) RETURNING id';
      const contactResult = await pool.query(contactQuery, [phoneNumber, 1]);
      const contactId = contactResult.rows[0].id; 

      console.log(`ID del contacto: ${contactId}`);

      const insertQuery = 'INSERT INTO conversations (phone_number, state, id_usuario, contact_id, integration_id) VALUES ($1, $2, $3, $4, $5) RETURNING conversation_id';
      const conversationResult = await pool.query(insertQuery, [phoneNumber, 'new', 1011, contactId, integrationId]); 
      const conversationId = conversationResult.rows[0].conversation_id;

      return conversationId; 
    }
  } catch (err) {
    console.error('Error de base de datos en getOrCreateConversation:', err);
    throw err;
  }
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
    console.error('Error de base de datos obteniendo estado de conversación:', error);
    throw error;
  }
}

export { processMessage, updateConversationState };
