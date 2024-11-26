import axios from 'axios';
import pool from '../config/dbConfig.js';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { PassThrough } from 'stream';
import FormData from 'form-data';
import serviceAccount from '../../crm-android-system.json' assert { type: 'json' };
import { GoogleAuth } from 'google-auth-library';

const backendUrl = process.env.BACKEND_URL;

function getAccessToken() {
  return new Promise(async (resolve, reject) => {
    try {
      const auth = new GoogleAuth({
        credentials: serviceAccount,
        scopes: 'https://www.googleapis.com/auth/firebase.messaging',
      });

      const client = await auth.getClient();
      const accessToken = await client.getAccessToken();
      if (accessToken && accessToken.token) {
        resolve(accessToken.token);
      } else {
        reject(new Error('No se pudo obtener el token de acceso.'));
      }
    } catch (error) {
      reject(error);
    }
  });
}

const getDeviceTokenForUser = async (phone, id_usuario) => {
  
  try {
    
    const res = await pool.query('SELECT token_firebase FROM users WHERE id_usuario = $1', [id_usuario]);
    return res.rows[0] ? res.rows[0].token_firebase : null;   
  } catch (error) {
    console.log("error:", error)
  }


}

const sendNotificationToFCM = async (typeMessage, phone, messageText, id_usuario, nombre, apellido, foto) => {
  // Obtener el token del dispositivo del usuario
  const deviceToken = await getDeviceTokenForUser(phone, id_usuario);
  if (!deviceToken) {
    console.log('No se encontró el token del dispositivo para:', id_usuario);
    return;
  }

  const formatVideoDuration = (duration) => {
    if (isNaN(duration)) {
      return '';
    }
    const minutes = Math.floor(duration / 60);
    const seconds = Math.floor(duration % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  console.log("Token del usuario:", deviceToken);

  var notificationPayload = {};
  switch (typeMessage) {
    case 'audio':
       const formattedDuration = formatVideoDuration(messageText);
       notificationPayload = {
        message: {
          token: deviceToken,
          notification: {
            title: `${nombre || ''} ${apellido || ''}`,
            body: `🎙️ Mensaje de audio: ${formattedDuration}`,
          },
          android:{
            notification: {
                channel_id: String(id_usuario),
                  tag: `message_${id_usuario}_${Date.now()}`,
                  icon:  process.env.BACKEND_URL+foto,
          }
        },
          data: {
            text: "audio",
            duration: String(messageText),
            senderId: String(phone || id_usuario),
          },
        },
      };  
      break;
    case 'video':
        const formattedDuration2 = formatVideoDuration(messageText);
        notificationPayload = {
         message: {
           token: deviceToken,
           notification: {
             title: `${nombre || ''} ${apellido || ''}`,
             body: `🎥 Video: ${formattedDuration2}`,
           },
           android:{
            notification: {
                channel_id: String(id_usuario),
                  tag: `message_${id_usuario}_${Date.now()}`,
                  icon:  process.env.BACKEND_URL+foto,
          }
        },
           data: {
             text: "video",
             duration: String(messageText),
             senderId: String(phone || id_usuario),
           },
         },
       };
       break;      
    case 'text':
      notificationPayload = {
        message: {
          token: deviceToken,
          notification: {
            title: `${nombre || ''} ${apellido || ''}`,
            body: messageText,
          },
          android:{
            notification: {
               channel_id: String(id_usuario),
                  tag: `message_${id_usuario}_${Date.now()}`,
                  icon:  process.env.BACKEND_URL+foto,
          }
        },
          data: {
            text: String(messageText),
            senderId: String(phone || id_usuario), 
          },
        },
      }; 
      break;
     case 'document':
        notificationPayload = {
          message: {
            token: deviceToken,
            notification: {
              title: `${nombre || ''} ${apellido || ''}`,
              body: `📄 Documento: ${messageText}`,
            },
            android:{
              notification: {
                 channel_id: String(id_usuario),
                  tag: `message_${id_usuario}_${Date.now()}`,
                  icon:  process.env.BACKEND_URL+foto,
            }
          },
            data: {
              text: "document",  // Indicar que el tipo de mensaje es un documento
              fileName: fileName, // Nombre del archivo para uso adicional
              senderId: String(phone || id_usuario),
            },
          },
        };
        break;
      case 'image':
          notificationPayload = {
            message: {
              token: deviceToken,
              notification: {
                title: `${nombre} ${apellido}`,
                body: messageText?.mensaje ? messageText.mensaje : '📷 Foto enviada', 
                image: `${messageText.foto}`,  
              },
              android:{
                notification: {
                   channel_id: String(id_usuario),
                  tag: `message_${id_usuario}_${Date.now()}`,
                  icon:  process.env.BACKEND_URL+foto,
              }
            },
              data: {
                text: "image",
                imageUrl: `${messageText.foto}`,
                senderId: String(phone || id_usuario),
              },
            },
          };
          break;
          case 'reaction':
            notificationPayload = {
              message: {
                token: deviceToken,
                notification: {
                  title: `${nombre || ''} ${apellido || ''}`,
                  body: messageText,
                },
                android:{
                  notification: {
                     channel_id: String(id_usuario),
                      tag: `message_${id_usuario}_${Date.now()}`,
                      icon:  process.env.BACKEND_URL+foto,
                }
              },
                data: {
                  text: String(messageText),
                  senderId: String(phone || id_usuario), 
                },
              },
            };
            break;                        
    default:
      break;
  }

  try {
    // Obtener el token de acceso OAuth
    const accessToken = await getAccessToken();

    // Enviar la notificación usando el token de acceso
    const response = await axios.post(
      `https://fcm.googleapis.com/v1/projects/${process.env.FIREBASE_PROYECT_ID}/messages:send`,
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

//Funciones de tipos de mensaje:
const InternalMessageSend = async (io, res, messageText, conversationId, usuario_send, id_usuario, integration_id, phone, companyId, remitent, reply_from) => {

  if (!conversationId) {
    let isUnique = false;
  
    // Intentar generar un ID numérico único
    while (!isUnique) {
      const generatedId = Math.floor(Math.random() * 1000000000); // Genera un número aleatorio grande
      const checkQuery = await pool.query('SELECT conversation_id FROM conversations WHERE conversation_id = $1', [generatedId]);
      
      if (checkQuery.rowCount === 0) {
        conversationId = generatedId;
        isUnique = true; // Si no existe, podemos usar este ID
      }
    }
  } 

  // Verificar si la conversación existe
  const conversationCheck = await pool.query('SELECT * FROM conversations WHERE conversation_id = $1', [conversationId]);

  let newConversationId = conversationId;

  if (conversationCheck.rowCount === 0) {
    // Si la conversación no existe, crear una nueva
    const insertConversationQuery = `
    INSERT INTO conversations (
      conversation_id, 
      phone_number, 
      state, 
      last_update, 
      unread_messages, 
      id_usuario, 
      contact_user_id, 
      integration_id
    ) VALUES ($1, $2, 'active', $3, $4, $5, $6, $7) RETURNING conversation_id;
  `;

  const currentTimestamp = new Date();
  const newConversationRes = await pool.query(insertConversationQuery, [
    newConversationId,  // conversation_id
    phone,             // phone_number (asumiendo que es null)
    currentTimestamp,   // last_update
    1,                  // unread_messages
    id_usuario,         // id_usuario
    usuario_send,       // contact_id
    integration_id      // integration_id
  ]);

    newConversationId = newConversationRes.rows[0].conversation_id;
    console.log('Nueva conversación creada:', newConversationId);
  }

  // Obtener la cantidad de mensajes no leídos y el id_usuario responsable
  const unreadRes = await pool.query('SELECT unread_messages, id_usuario FROM conversations WHERE conversation_id = $1', [newConversationId]);
  const unreadMessages = unreadRes.rows[0].unread_messages;

  try {
    // Intentar insertar en la base de datos el mensaje
    const insertQuery = `
      INSERT INTO replies (
        sender_id,
        conversation_fk,
        reply_type,
        reply_text,
        reply_media_url,
        latitude,
        longitude,
        replies_id,
        created_at,
         reply_from
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *;
    `;
    const messageValues = [
      id_usuario,
      newConversationId,
      'text',
      messageText,
      null,
      null,
      null,
      Math.floor(Math.random() * 100000), // Genera un número aleatorio grande
      new Date(), // Timestamp actual
      reply_from
    ];
    const res = await pool.query(insertQuery, messageValues);
    const newMessage = res.rows[0];

     // Usando push:
     const recipients = [];
     recipients.push(id_usuario);
     recipients.push(usuario_send);

     const usuario_sending = await pool.query(
      'SELECT * FROM users WHERE id_usuario = $1', 
      [usuario_send]
    );

    const usuario_remitent = await pool.query(
      'SELECT * FROM users WHERE id_usuario = $1', 
      [id_usuario]
    );
 
    const integracionSelect = await pool.query(
      'SELECT * FROM integrations WHERE id = $1', 
      [integration_id]
    );
    
    recipients.forEach(userId => {
      io.to(`user-${userId}`).emit('internalMessage', {
      id: newMessage.id,
      conversationId: newConversationId,
      timestamp: newMessage.created_at,
      senderId: usuario_send,
      message_type: 'text',
      text: messageText || null,
      mediaUrl: null,
      thumbnailUrl: null,
      duration: null,
      latitude: null,
      longitude: null,
      type: 'reply',
      unread_messages: unreadMessages,
      responsibleUserId: id_usuario,
      reply_from: newMessage.reply_from,
      company_id: companyId,
      destino_nombre: usuario_sending.rows[0].nombre || '',
      destino_apellido: usuario_sending.rows[0].apellido || '',
      destino_foto: usuario_sending.link_foto || '',
      integracion: integracionSelect.rows[0].name || '',
    });
   }); 

    console.log('Mensaje emitido:', newMessage.id);
   console.log("usuario a enviar notificaion:", usuario_send)
   try {
     const fcmResponse = await sendNotificationToFCM('text', null, messageText, usuario_send, usuario_remitent.rows[0].nombre, usuario_remitent.rows[0].apellido, usuario_remitent.rows[0].link_foto);
     console.log('Notificación enviada:', fcmResponse);
   } catch (error) {
    console.error('Error enviando notificacion a usuario interno:', error.error);
   }
    
  } catch (error) {
    console.error('Error enviando mensaje:', error);
    res.status(500).json({ error: error.message });
  }
};

const WhatsAppMessageSend = async(io, res, phone, messageText, conversationId, integration_id, reply_from) => {
 
   // Obtén los detalles de la integración
   const integrationDetails = await getIntegrationDetailsByConversationId(conversationId);
   const { whatsapp_api_token, whatsapp_phone_number_id} = integrationDetails;
 
   // Obtén la cantidad de mensajes no leídos y el id_usuario responsable
   const unreadRes = await pool.query('SELECT unread_messages, id_usuario FROM conversations WHERE conversation_id = $1', [conversationId]);
   const unreadMessages = unreadRes.rows[0].unread_messages;
   const responsibleUserId = unreadRes.rows[0].id_usuario;
 
   try {
     var response = null;
     if (reply_from) {
       response = await axios.post(
        `https://graph.facebook.com/v13.0/${whatsapp_phone_number_id}/messages`,
        {
          messaging_product: "whatsapp",
          to: phone,
          type: "text",
          text: { body: messageText },
          context: {
            message_id: reply_from // El ID del mensaje original al que deseas responder
          }
        },
        {
          headers: {
            'Authorization': `Bearer ${whatsapp_api_token}`,
            'Content-Type': 'application/json'
          }
        }
      );
     }else{

        response = await axios.post(
         `https://graph.facebook.com/v13.0/${whatsapp_phone_number_id}/messages`,
         {
           messaging_product: "whatsapp",
           to: phone,
           type: "text",
           text: { body: messageText }
         },
         {
           headers: {
             'Authorization': `Bearer ${whatsapp_api_token}`,
             'Content-Type': 'application/json'
           }
         }
       );
     }
 
     // Intenta insertar en la base de datos
     const insertQuery = `
       INSERT INTO replies (
         sender_id,
         conversation_fk,
         reply_type,
         reply_text,
         reply_media_url,
         latitude,
         longitude,
         replies_id,
         created_at,
         reply_from
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *;
     `;
     const messageValues = [
       phone,
       conversationId,
       'text',
       messageText,
       null,
       null,
       null,
       response.data.messages[0].id, // ID del mensaje de WhatsApp
       new Date(), // Timestamp actual
       reply_from
     ];
     const res = await pool.query(insertQuery, messageValues);
     console.log('Inserted reply ID:', res.rows[0]);
     const newMessage = res.rows[0];
     
     const usuario_send = await pool.query(
      'SELECT * FROM contacts WHERE phone_number = $1', 
      [phone]
    );
    const integracionSelect = await pool.query(
      'SELECT * FROM integrations WHERE id = $1', 
      [integration_id]
    );

    console.log("remitente: ", usuario_send.rows[0])
     // Consulta para obtener los administradores
     const adminQuery = `
     SELECT id_usuario FROM users 
     WHERE company_id = $1 
       AND rol IN (SELECT id FROM roles WHERE name = 'Administrador')
   `;
   const adminResult = await pool.query(adminQuery, [integrationDetails.company_id]);


   const adminIds = adminResult.rows.map(row => row.id_usuario);

   // Emitir el mensaje al usuario responsable y a los administradores
   const recipients = adminIds.includes(responsibleUserId) 
      ? adminIds 
      : [responsibleUserId, ...adminIds];

      console.log("mensaje de whatapps", newMessage)
   recipients.forEach(userId => {
     io.to(`user-${userId}`).emit('newMessage', {
       id: newMessage.replies_id,
       conversationId: conversationId,
       timestamp: newMessage.created_at,
       senderId: phone,
       message_type: 'text',
       text: messageText || null,
       mediaUrl: null,
       thumbnailUrl: null,
       duration: null,
       latitude: null,
       longitude: null,
       type: 'reply',
       unread_messages: unreadMessages,
       responsibleUserId: responsibleUserId,
       reply_from: newMessage.reply_from,
       company_id: integrationDetails.company_id, // Añadir company_id aquí
       destino_nombre: usuario_send.rows[0].first_name,
       destino_apellido: usuario_send.rows[0].last_name,
       destino_foto: usuario_send.rows[0].profile_url
     });
    });
     console.log('Mensaje emitido:', newMessage.id);

   } catch (error) {
     console.error('Error sending message:', error);
     res.status(500).json({ error: error.message });
   }
}

//Funciones de tipo audio:
const InternalAudioSend = async(io, res, fileName, audioUrl, audioDuration, conversationId, usuario_send, id_usuario, integration_id, phone, companyId, remitent, reply_from) => {

  if (!conversationId) {
    let isUnique = false;
  
    // Intentar generar un ID numérico único
    while (!isUnique) {
      const generatedId = Math.floor(Math.random() * 1000000000); // Genera un número aleatorio grande
      const checkQuery = await pool.query('SELECT conversation_id FROM conversations WHERE conversation_id = $1', [generatedId]);
      
      if (checkQuery.rowCount === 0) {
        conversationId = generatedId;
        isUnique = true; // Si no existe, podemos usar este ID
      }
    }
  } 

  // Verificar si la conversación existe
  const conversationCheck = await pool.query('SELECT * FROM conversations WHERE conversation_id = $1', [conversationId]);

  let newConversationId = conversationId;

  if (conversationCheck.rowCount === 0) {
    // Si la conversación no existe, crear una nueva
    const insertConversationQuery = `
    INSERT INTO conversations (
      conversation_id, 
      phone_number, 
      state, 
      last_update, 
      unread_messages, 
      id_usuario, 
      contact_user_id, 
      integration_id
    ) VALUES ($1, $2, 'active', $3, $4, $5, $6, $7) RETURNING conversation_id;
  `;

  const currentTimestamp = new Date();
  const newConversationRes = await pool.query(insertConversationQuery, [
    newConversationId,  // conversation_id
    phone,             // phone_number (asumiendo que es null)
    currentTimestamp,   // last_update
    0,                  // unread_messages
    id_usuario,         // id_usuario
    usuario_send,       // contact_id
    integration_id      // integration_id
  ]);

    newConversationId = newConversationRes.rows[0].conversation_id;
    console.log('Nueva conversación creada:', newConversationId);
  }
  
  try {

    // Intenta insertar en la base de datos
    const insertQuery = `
      INSERT INTO replies (
        replies_id,
        sender_id,
        conversation_fk,
        reply_type,
        reply_text,
        reply_media_url,
        latitude,
        longitude,
        duration,
        reply_from
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *;
    `;
    const messageValues = [
      Math.floor(Math.random() * 1000000),
      id_usuario,
      conversationId,
      'audio',
      null,
      audioUrl,
      null,
      null,
      audioDuration,
      reply_from
    ];
    const result = await pool.query(insertQuery, messageValues);
    console.log('Inserted reply ID:', result.rows[0]);
    const newMessage = result.rows[0];
    const unreadMessages = result.rows[0].unread_messages;


    // Usando push:
    const recipients = [];
    recipients.push(id_usuario);
    recipients.push(usuario_send);
    
    console.log("usuarios", recipients)
    const usuario_sending = await pool.query(
      'SELECT * FROM users WHERE id_usuario = $1', 
      [usuario_send]
    );

    const usuario_remitent = await pool.query(
      'SELECT * FROM users WHERE id_usuario = $1', 
      [id_usuario]
    );
 
    const integracionSelect = await pool.query(
      'SELECT * FROM integrations WHERE id = $1', 
      [integration_id]
    );

    recipients.forEach(userId => {
    io.to(`user-${userId}`).emit('internalMessage', {
      id: newMessage.replies_id,
      conversationId: conversationId,
      timestamp: newMessage.created_at,
      senderId: usuario_send,
      type: 'reply',
      message_type: 'audio',
      text: null,
      url: audioUrl,
      duration: audioDuration,
      latitude: null,
      longitude: null,
      unread_messages: unreadMessages,
      responsibleUserId: id_usuario,
      reply_from: newMessage.reply_from,
      company_id: companyId,
      destino_nombre: usuario_sending.rows[0].nombre || '',
      destino_apellido: usuario_sending.rows[0].apellido || '',
      destino_foto: usuario_sending.link_foto || '',
      integracion: integracionSelect.rows[0].name || '',
    });
  });
    console.log('Mensaje emitido:', newMessage.replies_id);
  console.log("usuario a enviar:", usuario_send)
    try {
      const fcmResponse = await sendNotificationToFCM( 'audio', null, audioDuration, usuario_send, usuario_sending.rows[0].nombre, usuario_sending.rows[0].apellido, usuario_sending.rows[0].link_foto);
      console.log('Notificación enviada:', fcmResponse);
    } catch (error) {
      console.error('Error enviando la notificación:', error.response?.data?.error || error.message);
    }

  } catch (error) {
    console.error('Error sending WhatsApp audio:', error.response?.data || error.message);
    res.status(500).json({ error: error.message });
  }
}

const WhatAppAudioSend = async(io, res, phone, audioDuration, audioUrl, fullAudioUrl, fileName, conversationId, integration_id, reply_from) => {
  // Obtén los detalles de la integración
  const integrationDetails = await getIntegrationDetailsByConversationId(conversationId);
  const { whatsapp_api_token, whatsapp_phone_number_id } = integrationDetails;

  try {
     // Paso 1: Descargar el archivo de audio desde la URL
     const audioResponse = await axios.get(fullAudioUrl, { responseType: 'arraybuffer' });
     const audioBuffer = Buffer.from(audioResponse.data, 'binary');
 
     // Convertir el buffer a un stream
     const audioStream = new PassThrough();
     audioStream.end(audioBuffer); // Pasa el buffer directamente al stream
 
     // Paso 2: Crear un FormData para subir el archivo
       const formData = new FormData();
       formData.append('file', audioStream, {
        filename: `${fileName}`,
        contentType: 'audio/ogg; codecs=opus' // Incluye el tipo de contenido con el codec
      });
       formData.append('messaging_product', 'whatsapp');
       formData.append('type', 'audio/ogg')
 
     // Subir archivo multimedia
     const mediaUploadResponse = await axios(
      {url: `https://graph.facebook.com/v20.0/${whatsapp_phone_number_id}/media`,
        method: 'post',
       data: formData,
         headers: {
           'Authorization': `Bearer ${whatsapp_api_token}`,
           ...formData.getHeaders(),  // Obtener los headers necesarios para multipart/form-data
         },
       }
     );

     const mediaId = mediaUploadResponse.data.id;
     console.log("ID del medio:", mediaId);
 
    const messagePayload = {
      messaging_product: 'whatsapp',
      to: phone,
      type: 'audio',
      audio: {
        id: mediaId, // Usa el media_id en lugar del link
      },
    };

    const sendMessageResponse = await axios.post(
      `https://graph.facebook.com/v20.0/${whatsapp_phone_number_id}/messages`,
      messagePayload,
      {
        headers: {
          'Authorization': `Bearer ${whatsapp_api_token}`,
          'Content-Type': 'application/json',
        },
      }
    );

    console.log('Mensaje enviado correctamente:', sendMessageResponse.data);

    // Intenta insertar en la base de datos
    const insertQuery = `
      INSERT INTO replies (
        replies_id,
        sender_id,
        conversation_fk,
        reply_type,
        reply_text,
        reply_media_url,
        latitude,
        longitude,
        duration,
        reply_from
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *;
    `;
    const messageValues = [
      sendMessageResponse.data.messages[0].id,
      phone,
      conversationId,
      'audio',
      null,
      audioUrl,
      null,
      null,
      audioDuration,
      reply_from
    ];
    const result = await pool.query(insertQuery, messageValues);
    console.log('Inserted reply ID:', result.rows[0]);
    const newMessage = result.rows[0];
    const unreadMessages = result.rows[0].unread_messages;
    const responsibleUserId = result.rows[0].id_usuario;

    // Emitir el mensaje procesado a los clientes suscritos a esa conversación
    // Consulta para obtener los administradores
    const adminQuery = `
    SELECT id_usuario FROM users 
    WHERE company_id = $1 
      AND rol IN (SELECT id FROM roles WHERE name = 'Administrador')
  `;
  const adminResult = await pool.query(adminQuery, [integrationDetails.company_id]);


  const adminIds = adminResult.rows.map(row => row.id_usuario);

  // Emitir el mensaje al usuario responsable y a los administradores
  const recipients = adminIds.includes(responsibleUserId) 
      ? adminIds 
      : [responsibleUserId, ...adminIds];

  recipients.forEach(userId => {
    io.to(`user-${userId}`).emit('newMessage', {
      id: newMessage.replies_id,
      conversationId: conversationId,
      timestamp: newMessage.created_at,
      senderId: phone,
      type: 'reply',
      message_type: 'audio',
      text: null,
      url: audioUrl,
      duration: audioDuration,
      latitude: null,
      longitude: null,
      unread_messages: unreadMessages,
      responsibleUserId: responsibleUserId,
      company_id: integrationDetails.company_id, // Añadir company_id aquí
    });
  });
    console.log('Mensaje emitido:', newMessage.replies_id);

  } catch (error) {
    console.error('Error sending WhatsApp audio:', error.response?.data || error.message);
    res.status(500).json({ error: error.message });
  }
}
 
//Funciones de tipo image:
const InternalImageSend = async(io, res, imageUrl, messageText, conversationId, usuario_send, id_usuario, integration_id, phone, companyId, remitent, reply_from) => {
    if (!conversationId) {
      let isUnique = false;
    
      // Intentar generar un ID numérico único
      while (!isUnique) {
        const generatedId = Math.floor(Math.random() * 1000000000);
        const checkQuery = await pool.query('SELECT conversation_id FROM conversations WHERE conversation_id = $1', [generatedId]);
        
        if (checkQuery.rowCount === 0) {
          conversationId = generatedId;
          isUnique = true; 
        }
      }
    } 
  
    // Verificar si la conversación existe
    const conversationCheck = await pool.query('SELECT * FROM conversations WHERE conversation_id = $1', [conversationId]);
  
    let newConversationId = conversationId;
  
    if (conversationCheck.rowCount === 0) {
      // Si la conversación no existe, crear una nueva
      const insertConversationQuery = `
      INSERT INTO conversations (
        conversation_id, 
        phone_number, 
        state, 
        last_update, 
        unread_messages, 
        id_usuario, 
        contact_user_id, 
        integration_id
      ) VALUES ($1, $2, 'active', $3, $4, $5, $6, $7) RETURNING conversation_id;
    `;
  
    const currentTimestamp = new Date();
    const newConversationRes = await pool.query(insertConversationQuery, [
      newConversationId,  // conversation_id
      null,             // phone_number (asumiendo que es null)
      currentTimestamp,   // last_update
      0,                  // unread_messages
      id_usuario,         // id_usuario
      usuario_send,       // contact_id
      integration_id      // integration_id
    ]);
  
      newConversationId = newConversationRes.rows[0].conversation_id;
      console.log('Nueva conversación creada:', newConversationId);
    }

  // Obtén la cantidad de mensajes no leídos y el id_usuario responsable
  const unreadRes = await pool.query('SELECT unread_messages, id_usuario FROM conversations WHERE conversation_id = $1', [conversationId]);
  const unreadMessages = unreadRes.rows[0].unread_messages;

  try {
    // Intenta insertar en la base de datos
    const insertQuery = `
      INSERT INTO replies (
        replies_id,
        sender_id,
        conversation_fk,
        reply_type,
        reply_text,
        reply_media_url,
        latitude,
        longitude,
        reply_from
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *;
    `;
    const messageValues = [
      Math.floor(Math.random() * 1000000),
      id_usuario,           
      conversationId,
      'image',
      messageText,
      imageUrl,
      null,
      null,
      reply_from
    ];
    const result = await pool.query(insertQuery, messageValues);
    console.log('Inserted reply ID:', result.rows[0]);
    const newMessage = result.rows[0];

     // Usando push:
     const recipients = [];
     recipients.push(id_usuario);
     recipients.push(usuario_send);

     const usuario_sending = await pool.query(
      'SELECT * FROM users WHERE id_usuario = $1', 
      [usuario_send]
    );

    const usuario_remitent = await pool.query(
      'SELECT * FROM users WHERE id_usuario = $1', 
      [id_usuario]
    );
 
    const integracionSelect = await pool.query(
      'SELECT * FROM integrations WHERE id = $1', 
      [integration_id]
    );

  recipients.forEach(userId => {
    io.to(`user-${userId}`).emit('internalMessage', {
      id: newMessage.replies_id,
      conversationId: conversationId,
      timestamp: newMessage.created_at,
      senderId: usuario_send,
      type: 'reply',
      message_type: 'image',
      text: messageText || '',
      url: backendUrl+imageUrl,
      thumbnail_url: null,
      duration: null,
      latitude: null,
      longitude: null,
      unread_messages: unreadMessages,
      responsibleUserId: id_usuario,
      company_id: companyId,
      destino_nombre: usuario_sending.rows[0].nombre || '',
      destino_apellido: usuario_sending.rows[0].apellido || '',
      destino_foto: usuario_sending.link_foto || '',
      integracion: integracionSelect.rows[0].name || '',
    });
  });
    console.log('Mensaje emitido:', newMessage.replies_id);

    try {
      const messageImage = {
        foto: `${backendUrl.imageUrl}`,
        mensaje: messageText || ''
      }
      const fcmResponse = await sendNotificationToFCM( 'image', null, messageImage, usuario_send, usuario_remitent.rows[0].nombre, usuario_remitent.rows[0].apellido, usuario_remitent.rows[0].link_foto);
      console.log('Notificación enviada:', fcmResponse);
    } catch (error) {
     console.error('Error enviando notificacion a usuario interno:', error.error);
    }
  } catch (error) {
    console.error('Error sending WhatsApp image:', error.response?.data || error.message);
    res.status(500).json({ error: error.message });
  }
}

const WhatsAppImageSend = async(io, res, imageUrl, messageText, conversationId, usuario_send, id_usuario, integration_id, phone, companyId, remitent, reply_from) => {
  const fullImageUrl = `${backendUrl}${imageUrl}`; // Agregar el prefijo a la URL de la imagen
  console.log("Caption recibido:", messageText);
  // Obtén los detalles de la integración
  const integrationDetails = await getIntegrationDetailsByConversationId(conversationId);
  const { whatsapp_api_token, whatsapp_phone_number_id } = integrationDetails;

    if (!whatsapp_api_token || !whatsapp_phone_number_id) {
      throw new Error('Faltan detalles de integración necesarios para enviar el mensaje.');
    }

  const url = `https://graph.facebook.com/v19.0/${whatsapp_phone_number_id}/messages`;
  const payload = {
    messaging_product: "whatsapp",
    to: phone,
    type: "image",
    image: { 
      link: fullImageUrl,
      caption: messageText
    }
  };

  // Obtén la cantidad de mensajes no leídos y el id_usuario responsable
  const unreadRes = await pool.query('SELECT unread_messages, id_usuario FROM conversations WHERE conversation_id = $1', [conversationId]);
  const unreadMessages = unreadRes.rows[0].unread_messages;
  const responsibleUserId = unreadRes.rows[0].id_usuario;

  try {
    const response = await axios.post(url, payload, {
      headers: {
        'Authorization': `Bearer ${whatsapp_api_token}`,
        'Content-Type': 'application/json'
      }
    });
    console.log(response.data);

    // Intenta insertar en la base de datos
    const insertQuery = `
      INSERT INTO replies (
        replies_id,
        sender_id,
        conversation_fk,
        reply_type,
        reply_text,
        reply_media_url,
        latitude,
        longitude,
        reply_from
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *;
    `;
    const messageValues = [
      response.data.messages[0].id,
      phone,           
      conversationId,
      'image',
      messageText,
      imageUrl,
      null,
      null,
      reply_from
    ];
    const result = await pool.query(insertQuery, messageValues);
    console.log('Inserted reply ID:', result.rows[0]);
    const newMessage = result.rows[0];
    // Consulta para obtener los administradores
    const adminQuery = `
    SELECT id_usuario FROM users 
    WHERE company_id = $1 
      AND rol IN (SELECT id FROM roles WHERE name = 'Administrador')
  `;
  const adminResult = await pool.query(adminQuery, [integrationDetails.company_id]);


  const adminIds = adminResult.rows.map(row => row.id_usuario);

  // Emitir el mensaje al usuario responsable y a los administradores
  const recipients = adminIds.includes(responsibleUserId) 
      ? adminIds 
      : [responsibleUserId, ...adminIds];

  recipients.forEach(userId => {
    io.to(`user-${userId}`).emit('newMessage', {
      id: newMessage.replies_id,
      conversationId: conversationId,
      timestamp: newMessage.created_at,
      senderId: phone,
      type: 'reply',
      message_type: 'image',
      text: messageText,
      url: imageUrl,
      thumbnail_url: null,
      duration: null,
      latitude: null,
      longitude: null,
      unread_messages: unreadMessages,
      responsibleUserId: responsibleUserId,
      company_id: integrationDetails.company_id // Añadir company_id aquí
    });
  });
    console.log('Mensaje emitido:', newMessage.replies_id);

  } catch (error) {
    console.error('Error sending WhatsApp image:', error.response?.data || error.message);
    res.status(500).json({ error: error.message });
  }
}

//Funciones de tipo Video:
const InternalVideoSend = async(io, res, phone, videoUrl, videoThumbnail, videoDuration, conversationId, integration_name, messageText, usuario_send, id_usuario, integration_id, companyId, remitent, reply_from) => {

  const fullVideoUrl = `${backendUrl}${videoUrl}`;

  if (!conversationId) {
    let isUnique = false;
  
    // Intentar generar un ID numérico único
    while (!isUnique) {
      const generatedId = Math.floor(Math.random() * 1000000000);
      const checkQuery = await pool.query('SELECT conversation_id FROM conversations WHERE conversation_id = $1', [generatedId]);
      
      if (checkQuery.rowCount === 0) {
        conversationId = generatedId;
        isUnique = true; 
      }
    }
  } 

  // Verificar si la conversación existe
  const conversationCheck = await pool.query('SELECT * FROM conversations WHERE conversation_id = $1', [conversationId]);

  let newConversationId = conversationId;

  if (conversationCheck.rowCount === 0) {
    // Si la conversación no existe, crear una nueva
    const insertConversationQuery = `
    INSERT INTO conversations (
      conversation_id, 
      phone_number, 
      state, 
      last_update, 
      unread_messages, 
      id_usuario, 
      contact_user_id, 
      integration_id
    ) VALUES ($1, $2, 'active', $3, $4, $5, $6, $7) RETURNING conversation_id;
  `;

  const currentTimestamp = new Date();
  const newConversationRes = await pool.query(insertConversationQuery, [
    newConversationId,  // conversation_id
    null,             // phone_number (asumiendo que es null)
    currentTimestamp,   // last_update
    1,                  // unread_messages
    id_usuario,         // id_usuario
    usuario_send,       // contact_id
    integration_id      // integration_id
  ]);

    newConversationId = newConversationRes.rows[0].conversation_id;
    console.log('Nueva conversación creada:', newConversationId);
  }

  // Obtén la cantidad de mensajes no leídos y el id_usuario responsable
  const unreadRes = await pool.query('SELECT unread_messages, id_usuario FROM conversations WHERE conversation_id = $1', [conversationId]);
  const unreadMessages = unreadRes.rows[0].unread_messages;

  try {

    // Intenta insertar en la base de datos
    const insertQuery = `
      INSERT INTO replies (
        replies_id,
        sender_id,
        conversation_fk,
        reply_type,
        reply_text,
        reply_media_url,
        latitude,
        longitude,
        thumbnail_url,
        duration,
        reply_from
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *;
    `;
    const messageValues = [
      Math.floor(Math.random() * 1000000),
      id_usuario,           
      conversationId,
      'video',
      messageText,
      videoUrl,
      null,
      null,
      videoThumbnail,
      videoDuration,
      reply_from
    ];
    const result = await pool.query(insertQuery, messageValues);
    console.log('Inserted reply ID:', result.rows[0]);
    const newMessage = result.rows[0];

    // Usando push:
     const recipients = [];
     recipients.push(id_usuario);
     recipients.push(usuario_send);

     const usuario_sending = await pool.query(
      'SELECT * FROM users WHERE id_usuario = $1', 
      [usuario_send]
    );

    const usuario_remitent = await pool.query(
      'SELECT * FROM users WHERE id_usuario = $1', 
      [id_usuario]
    );
 
    const integracionSelect = await pool.query(
      'SELECT * FROM integrations WHERE id = $1', 
      [integration_id]
    );

  recipients.forEach(userId => {
    io.to(`user-${userId}`).emit('internalMessage', {
      id: newMessage.replies_id,
      conversationId: conversationId,
      timestamp: newMessage.created_at,
      senderId: usuario_send,
      type: 'reply',
      message_type: 'video',
      text: messageText,
      url: videoUrl,
      thumbnail_url: videoThumbnail,
      duration: videoDuration,
      latitude: null,
      longitude: null,
      unread_messages: unreadMessages,
      responsibleUserId: id_usuario,
      company_id: integrationDetails.company_id,
      destino_nombre: usuario_sending.rows[0].nombre || '',
      destino_apellido: usuario_sending.rows[0].apellido || '',
      destino_foto: usuario_sending.link_foto || '',
      integracion: integracionSelect.rows[0].name || '',
    });
  });
    console.log('Mensaje emitido:', newMessage.replies_id);
  
    try {
      const fcmResponse = await sendNotificationToFCM( 'video', null, videoDuration, usuario_send, usuario_remitent.rows[0].nombre, usuario_remitent.rows[0].apellido, usuario_remitent.rows[0].link_foto);
      console.log('Notificación enviada:', fcmResponse);
    } catch (error) {
     console.error('Error enviando notificación a usuario interno:', error.error);
    }

  } catch (error) {
    console.error('Error sending WhatsApp video:', error.response?.data || error.message);
    res.status(500).json({ error: error.message });
  }
}

const WhatsAppsVideoSend = async(io, res, phone, videoUrl, videoThumbnail, videoDuration, conversationId, integration_name, messageText, usuario_send, id_usuario, integration_id, companyId, remitent, reply_from) => {
  // Obtén los detalles de la integración
  const integrationDetails = await getIntegrationDetailsByConversationId(conversationId);
  const { whatsapp_api_token, whatsapp_phone_number_id } = integrationDetails;
  const fullVideoUrl = `${backendUrl}${videoUrl}`;

  const url = `https://graph.facebook.com/v19.0/${whatsapp_phone_number_id}/messages`;
  const payload = {
    messaging_product: "whatsapp",
    to: phone,
    type: "video",
    video: {
      link: fullVideoUrl,
      caption: messageText
    }
  };

  // Obtén la cantidad de mensajes no leídos y el id_usuario responsable
  const unreadRes = await pool.query('SELECT unread_messages, id_usuario FROM conversations WHERE conversation_id = $1', [conversationId]);
  const unreadMessages = unreadRes.rows[0].unread_messages;
  const responsibleUserId = unreadRes.rows[0].id_usuario;

  try {
    const response = await axios.post(url, payload, {
      headers: {
        'Authorization': `Bearer ${whatsapp_api_token}`,
        'Content-Type': 'application/json'
      }
    });
    console.log(response.data);

    // Intenta insertar en la base de datos
    const insertQuery = `
      INSERT INTO replies (
        replies_id,
        sender_id,
        conversation_fk,
        reply_type,
        reply_text,
        reply_media_url,
        latitude,
        longitude,
        thumbnail_url,
        duration, 
        reply_from
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *;
    `;
    const messageValues = [
      response.data.messages[0].id,
      phone,           
      conversationId,
      'video',
      messageText,
      videoUrl,
      null,
      null,
      videoThumbnail,
      videoDuration,
      reply_from
    ];
    const result = await pool.query(insertQuery, messageValues);
    console.log('Inserted reply ID:', result.rows[0]);
    const newMessage = result.rows[0];
    // Emitir el mensaje procesado a los clientes suscritos a esa conversación
    // Consulta para obtener los administradores
    const adminQuery = `
    SELECT id_usuario FROM users 
    WHERE company_id = $1 
      AND rol IN (SELECT id FROM roles WHERE name = 'Administrador')
  `;
  const adminResult = await pool.query(adminQuery, [integrationDetails.company_id]);


  const adminIds = adminResult.rows.map(row => row.id_usuario);

  // Emitir el mensaje al usuario responsable y a los administradores
  const recipients = adminIds.includes(responsibleUserId) 
      ? adminIds 
      : [responsibleUserId, ...adminIds];

  recipients.forEach(userId => {
    io.to(`user-${userId}`).emit('newMessage', {
      id: newMessage.replies_id,
      conversationId: conversationId,
      timestamp: newMessage.created_at,
      senderId: phone,
      type: 'reply',
      message_type: 'video',
      text: messageText,
      url: videoUrl,
      thumbnail_url: videoThumbnail,
      duration: videoDuration,
      latitude: null,
      longitude: null,
      unread_messages: unreadMessages,
      responsibleUserId: responsibleUserId,
      company_id: integrationDetails.company_id // Añadir company_id aquí
    });
  });
    console.log('Mensaje emitido:', newMessage.replies_id);

  } catch (error) {
    console.error('Error sending WhatsApp video:', error.response?.data || error.message);
    res.status(500).json({ error: error.message });
  }
}

//Funciones de tipo Document:
const InternalDocumentSend = async(io, res, phone, documentUrl, documentName, conversationId, integration_name, messageText, usuario_send, id_usuario, integration_id, companyId, remitent, reply_from) => {
  const fullDocumentUrl = `${backendUrl}${documentUrl}`; // Add the prefix to the document URL

  if (!conversationId) {
    let isUnique = false;
  
    // Intentar generar un ID numérico único
    while (!isUnique) {
      const generatedId = Math.floor(Math.random() * 1000000000);
      const checkQuery = await pool.query('SELECT conversation_id FROM conversations WHERE conversation_id = $1', [generatedId]);
      
      if (checkQuery.rowCount === 0) {
        conversationId = generatedId;
        isUnique = true; 
      }
    }
  } 

  // Verificar si la conversación existe
  const conversationCheck = await pool.query('SELECT * FROM conversations WHERE conversation_id = $1', [conversationId]);

  let newConversationId = conversationId;

  if (conversationCheck.rowCount === 0) {
    // Si la conversación no existe, crear una nueva
    const insertConversationQuery = `
    INSERT INTO conversations (
      conversation_id, 
      phone_number, 
      state, 
      last_update, 
      unread_messages, 
      id_usuario, 
      contact_user_id, 
      integration_id
    ) VALUES ($1, $2, 'active', $3, $4, $5, $6, $7) RETURNING conversation_id;
  `;

  const currentTimestamp = new Date();
  const newConversationRes = await pool.query(insertConversationQuery, [
    newConversationId,  // conversation_id
    null,             // phone_number (asumiendo que es null)
    currentTimestamp,   // last_update
    0,                  // unread_messages
    id_usuario,         // id_usuario
    usuario_send,       // contact_id
    integration_id      // integration_id
  ]);

    newConversationId = newConversationRes.rows[0].conversation_id;
    console.log('Nueva conversación creada:', newConversationId);
  }

  // Get the count of unread messages and the responsible user ID
  const unreadRes = await pool.query('SELECT unread_messages, id_usuario FROM conversations WHERE conversation_id = $1', [conversationId]);
  const unreadMessages = unreadRes.rows[0].unread_messages;

  try {
    // Try to insert into the database
    const insertQuery = `
      INSERT INTO replies (
        replies_id,
        sender_id,
        conversation_fk,
        reply_type,
        reply_text,
        reply_media_url,
        latitude,
        longitude,
        file_name,
        reply_from
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *;
    `;
    const messageValues = [
      Math.floor(Math.random() * 1000000),
      id_usuario,           
      conversationId,
      'document',
      null,
      documentUrl,
      null,
      null,
      documentName,
      reply_from
    ];
    const result = await pool.query(insertQuery, messageValues);
    console.log('Inserted reply ID:', result.rows[0]);
    const newMessage = result.rows[0];

        // Usando push:
        const recipients = [];
        recipients.push(id_usuario);
        recipients.push(usuario_send);
   
        const usuario_sending = await pool.query(
         'SELECT * FROM users WHERE id_usuario = $1', 
         [usuario_send]
       );
   
       const usuario_remitent = await pool.query(
         'SELECT * FROM users WHERE id_usuario = $1', 
         [id_usuario]
       );
    
       const integracionSelect = await pool.query(
         'SELECT * FROM integrations WHERE id = $1', 
         [integration_id]
       );

  recipients.forEach(userId => {
    io.to(`user-${userId}`).emit('internalMessage', {
      id: newMessage.replies_id,
      conversationId: conversationId,
      timestamp: newMessage.created_at,
      senderId: usuario_send,
      type: 'reply',
      message_type: 'document',
      text: null,
      url: documentUrl,
      thumbnail_url: null,
      duration: null,
      latitude: null,
      longitude: null,
      unread_messages: unreadMessages,
      responsibleUserId: id_usuario,
      file_name: documentName,
      company_id: integrationDetails.company_id,
      destino_nombre: usuario_sending.rows[0].nombre || '',
      destino_apellido: usuario_sending.rows[0].apellido || '',
      destino_foto: usuario_sending.link_foto || '',
      integracion: integracionSelect.rows[0].name || '',
    });
  });
    console.log('Message emitted:', newMessage.replies_id);

    try {
      const fcmResponse = await sendNotificationToFCM( 'video', null, documentName, usuario_send, usuario_remitent.rows[0].nombre, usuario_remitent.rows[0].apellido, usuario_remitent.rows[0].link_foto);
      console.log('Notificación enviada:', fcmResponse);
    } catch (error) {
     console.error('Error enviando notificación a usuario interno:', error.error);
    }

  } catch (error) {
    console.error('Error sending WhatsApp document:', error.response?.data || error.message);
    res.status(500).json({ error: error.message });
  }
}

const WhatsAppsDocumentSend = async(io, res, phone, documentUrl, documentName, conversationId, integration_name, messageText, usuario_send, id_usuario, integration_id, companyId, remitent, reply_from) => {
  const fullDocumentUrl = `${backendUrl}${documentUrl}`; // Add the prefix to the document URL

  console.log('caption procesado: ', messageText);

  // Obtén los detalles de la integración
  const integrationDetails = await getIntegrationDetailsByConversationId(conversationId);
  const { whatsapp_api_token, whatsapp_phone_number_id } = integrationDetails;

  const url = `https://graph.facebook.com/v19.0/${whatsapp_phone_number_id}/messages`;
  const payload = {
    messaging_product: "whatsapp",
    to: phone,
    type: "document",
    document: {
      link: fullDocumentUrl,
      filename: documentName,
      caption: messageText
    }
  };

  // Get the count of unread messages and the responsible user ID
  const unreadRes = await pool.query('SELECT unread_messages, id_usuario FROM conversations WHERE conversation_id = $1', [conversationId]);
  const unreadMessages = unreadRes.rows[0].unread_messages;
  const responsibleUserId = unreadRes.rows[0].id_usuario;

  try {
    const response = await axios.post(url, payload, {
      headers: {
        'Authorization': `Bearer ${whatsapp_api_token}`,
        'Content-Type': 'application/json'
      }
    });
    console.log(response.data);

    // Try to insert into the database
    const insertQuery = `
      INSERT INTO replies (
        replies_id,
        sender_id,
        conversation_fk,
        reply_type,
        reply_text,
        reply_media_url,
        latitude,
        longitude,
        file_name
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *;
    `;
    const messageValues = [
      response.data.messages[0].id,
      phone,           
      conversationId,
      'document',
      messageText,
      documentUrl,
      null,
      null,
      documentName
    ];
    const result = await pool.query(insertQuery, messageValues);
    console.log('Inserted reply ID:', result.rows[0]);
    const newMessage = result.rows[0];
    // Emit the processed message to clients subscribed to that conversation
    // Consulta para obtener los administradores
    const adminQuery = `
    SELECT id_usuario FROM users 
    WHERE company_id = $1 
      AND rol IN (SELECT id FROM roles WHERE name = 'Administrador')
  `;
  const adminResult = await pool.query(adminQuery, [integrationDetails.company_id]);


  const adminIds = adminResult.rows.map(row => row.id_usuario);

  // Emitir el mensaje al usuario responsable y a los administradores
  const recipients = adminIds.includes(responsibleUserId) 
      ? adminIds 
      : [responsibleUserId, ...adminIds];

  recipients.forEach(userId => {
    io.to(`user-${userId}`).emit('newMessage', {
      id: newMessage.replies_id,
      conversationId: conversationId,
      timestamp: newMessage.created_at,
      senderId: phone,
      type: 'reply',
      message_type: 'document',
      text: messageText,
      url: documentUrl,
      thumbnail_url: null,
      duration: null,
      latitude: null,
      longitude: null,
      unread_messages: unreadMessages,
      responsibleUserId: responsibleUserId,
      file_name: documentName,
      company_id: integrationDetails.company_id // Añadir company_id aquí
    });
  });
    console.log('Message emitted:', newMessage.replies_id);

  } catch (error) {
    console.error('Error sending WhatsApp document:', error.response?.data || error.message);
    res.status(500).json({ error: error.message });
  }
}

//FUnciones de tipo reaccion:
const InternalReactMessage = async(io, res, emoji, message_id, message_type, conversationId, integration_name, usuario_send, id_usuario, integration_id, companyId, remitent, reply_from) => {


  try {
     var messageReact = null;
    if (message_type === 'message') {
      const queryReact = `
        UPDATE messages
        SET reaction = $1
        WHERE id = $2
      `;
      await pool.query(queryReact, [emoji, message_id]);
      console.log(`Emoji actualizado en la tabla "messages" para el ID ${message_id}`);
    
      // Consulta para obtener el mensaje actualizado
      const updatedMessage = await pool.query('SELECT * FROM messages WHERE id = $1', [message_id]);
      messageReact = updatedMessage.rows[0];
    
    } else if (message_type === 'reply') {
      const queryReact = `
        UPDATE replies
        SET reaction = $1
        WHERE replies_id = $2
      `;
      await pool.query(queryReact, [emoji, message_id]);
      console.log(`Emoji actualizado en la tabla "replies" para el ID ${message_id}`);
    
// Consulta para obtener la respuesta actualizada
        const updatedReplyResult = await pool.query('SELECT * FROM replies WHERE replies_id = $1', [message_id]);
        messageReact = updatedReplyResult.rows[0]; // Extrae el primer elemento de rows
    
        const recipients = [];
        recipients.push(usuario_send);
   
        const usuario_sending = await pool.query(
         'SELECT * FROM users WHERE id_usuario = $1', 
         [usuario_send]
       );
   
       const usuario_remitent = await pool.query(
         'SELECT * FROM users WHERE id_usuario = $1', 
         [id_usuario]
       );
    
       const integracionSelect = await pool.query(
         'SELECT * FROM integrations WHERE id = $1', 
         [integration_id]
       );
       
       recipients.forEach(userId => {
         io.to(`user-${userId}`).emit('internalMessage', {
         conversationId,
         ...messageReact,
         responsibleUserId: id_usuario,
         companyId,
         destino_nombre: usuario_sending.rows[0].nombre || '',
         destino_apellido: usuario_sending.rows[0].apellido || '',
         destino_foto: usuario_sending.link_foto || '',
         integracion: integracionSelect.rows[0].name || '',
       });
      });
        var messageContet = null;
      
        switch (messageReact.type) {
          case 'audio':
            messageContet = 'Reacciono a: 🎙️ Mensaje de audio';
            break;
          case 'text':
            messageContet = `Reacciono a: '${messageReact.text}'`;
            break;
          case 'video':
            messageContet = 'Reacciono a: 🎥 Video';
            break;
          case 'image':
            messageContet = 'Reacciono a: 📷 Foto'
            break;
          case 'document':  
            messageContet = 'Reacciono a : 📄 Documento';
            break;  
          default:
            break;
        }
      try {
        const fcmResponse = await sendNotificationToFCM('reaction', null, messageContet, usuario_send, usuario_remitent.rows[0].nombre, usuario_remitent.rows[0].apellido, usuario_remitent.rows[0].link_foto);
        console.log('Notificación enviada:', fcmResponse);
      } catch (error) {
        console.error('Error enviando notificacion a usuario interno:', error.error);
      }
    } else {
      console.error('Tipo de mensaje no reconocido');
    }
    
     res.status(200).json({messageReact})
  } catch (error) {
    console.error('Error sending message:', error);
    res.status(500).json({ error: error.message });
  }

}

const WhatasAppReactMessage = async(io, res, phone, emoji, message_id, message_type, conversationId, integration_name, usuario_send, id_usuario, integration_id, companyId, remitent, reply_from) => {

  const integrationDetails = await getIntegrationDetailsByConversationId(conversationId);
  const { whatsapp_api_token, whatsapp_phone_number_id} = integrationDetails;


  try {
    const response = await axios.post(
      `https://graph.facebook.com/v13.0/${whatsapp_phone_number_id}/messages`,
      {
        messaging_product: "whatsapp",
        to: phone, // Número de teléfono del destinatario
        type: "reaction",
        reaction: {
          message_id: message_id, // El ID del mensaje original al que deseas reaccionar
          emoji: emoji // Emoji que deseas usar como reacción
        }
      },
      {
        headers: {
          'Authorization': `Bearer ${whatsapp_api_token}`, // Token de la API
          'Content-Type': 'application/json'
        }
      }
    );
    console.log("respuesta de reaccion:", response)

    var messageReact = null;
    if (message_type === 'message') {
      const queryReact = `
        UPDATE messages
        SET reaction = $1
        WHERE id = $2
      `;
      await pool.query(queryReact, [emoji, message_id]);
      console.log(`Emoji actualizado en la tabla "messages" para el ID ${message_id}`);
    
      // Consulta para obtener el mensaje actualizado
      const updatedMessage = await pool.query('SELECT * FROM messages WHERE id = $1', [message_id]);
      messageReact = updatedMessage.rows[0];
    
    } else if (message_type === 'reply') {
      const queryReact = `
        UPDATE replies
        SET reaction = $1
        WHERE replies_id = $2
      `;
      await pool.query(queryReact, [emoji, message_id]);
      console.log(`Emoji actualizado en la tabla "replies" para el ID ${message_id}`);
    
      // Consulta para obtener la respuesta actualizada
      const updatedReply = await pool.query('SELECT * FROM replies WHERE replies_id = $1', [message_id]);
      messageReact = updatedReply.rows[0];
    } else {
      console.error('Tipo de mensaje no reconocido');
    }
    
     res.status(200).json({messageReact})
  } catch (error) {
    console.error('Error sending message:', error);
    res.status(500).json({ error: error.message });
  }

}

//Funciones de procesamiento de mensajes:
export async function sendTextMessage(io, req, res) {
  const { phone, messageText, conversation_id, conversationId, integration_name, usuario_send, id_usuario, integration_id, companyId, remitent, reply_from } = req.body;
  console.log("datos del cuerpo del msj:", req.body)
  switch (integration_name) {
    case 'Interno':
        await InternalMessageSend(io, res, messageText, conversation_id, usuario_send, id_usuario, integration_id, phone, companyId, remitent, reply_from)
      break;
  
    default:
       await WhatsAppMessageSend(io, res, phone, messageText, conversationId || conversation_id, integration_id, reply_from)
      break;
  }
}

export async function sendImageMessage(io, req, res) {
  const { phone, imageUrl, conversationId, integration_name, messageText, usuario_send, id_usuario, integration_id, companyId, remitent, reply_from } = req.body;
  
    switch (integration_name) {
      case 'Internal':
          await InternalImageSend(io, res, imageUrl, messageText, conversationId, usuario_send, id_usuario, integration_id, phone, companyId, remitent, reply_from)
        break;
    
      default:
        await WhatsAppImageSend(io, res, imageUrl, messageText, conversationId, usuario_send, id_usuario, integration_id, phone, companyId, remitent, reply_from)
        break;
    }

}

export async function sendVideoMessage(io, req, res) {
  const { phone, videoUrl, videoThumbnail, videoDuration, conversationId, integration_name, messageText, usuario_send, id_usuario, integration_id, companyId, remitent, reply_from  } = req.body;

  switch (integration_name) {
    case 'Interno':
          await InternalVideoSend(io, res, phone, videoUrl, videoThumbnail, videoDuration, conversationId, integration_name, messageText, usuario_send, id_usuario, integration_id, companyId, remitent, reply_from)
      break;
  
    default:
      await WhatsAppsVideoSend(io, res, phone, videoUrl, videoThumbnail, videoDuration, conversationId, integration_name, messageText, usuario_send, id_usuario, integration_id, companyId, remitent, reply_from)
      break;
  }
}

export async function sendDocumentMessage(io, req, res) {
  const { phone, documentUrl, documentName, conversationId, integration_name, messageText, usuario_send, id_usuario, integration_id, companyId, remitent, reply_from  } = req.body;

  switch (integration_name) {
    case 'Interno':
        await InternalDocumentSend(io, res, phone, documentUrl, documentName, conversationId, integration_name, messageText, usuario_send, id_usuario, integration_id, companyId, remitent, reply_from)
      break;
    default:
      await WhatsAppsDocumentSend(io, res, phone, documentUrl, documentName, conversationId, integration_name, messageText, usuario_send, id_usuario, integration_id, companyId, remitent, reply_from)
      break;
  }
}

export async function sendAudioMessage(io, req, res) {
  const { phone, audioUrl, audioDuration, conversationId, usuario_send, id_usuario, companyId, remitent, reply_from, integration_name, integration_id } = req.body;
  const fullAudioUrl = `${backendUrl}${audioUrl}`;
  const fileName = audioUrl.split('/media/audios/')[1]; 
  
  
try {
    switch (integration_name) {
      case 'Interno':
         await InternalAudioSend(io, res, fileName, audioUrl, audioDuration, conversationId, usuario_send, id_usuario, integration_id, phone, companyId, remitent, reply_from)
        break;
    
      default:
        await WhatAppAudioSend(io, res, phone, audioDuration, audioUrl, fullAudioUrl, fileName, conversationId, integration_id, reply_from)
        break;
    }
} catch (error) {
   console.log("error:", error)
}

}

export async function sendLocationMessage(io, req, res) {
  const { phone, latitude, longitude, streetName, conversationId } = req.body;

  // Obtén los detalles de la integración
  const integrationDetails = await getIntegrationDetailsByConversationId(conversationId);
  const { whatsapp_api_token, whatsapp_phone_number_id } = integrationDetails;

  const url = `https://graph.facebook.com/v19.0/${whatsapp_phone_number_id}/messages`;
  const payload = {
    messaging_product: "whatsapp",
    to: phone,
    type: "location",
    location: {
      latitude: latitude.toString(),
      longitude: longitude.toString(),
      name: streetName
    }
  };

  // Obtén la cantidad de mensajes no leídos y el id_usuario responsable
  const unreadRes = await pool.query('SELECT unread_messages, id_usuario FROM conversations WHERE conversation_id = $1', [conversationId]);
  const unreadMessages = unreadRes.rows[0].unread_messages;
  const responsibleUserId = unreadRes.rows[0].id_usuario;

  try {
    const response = await axios.post(url, payload, {
      headers: {
        'Authorization': `Bearer ${whatsapp_api_token}`,
        'Content-Type': 'application/json'
      }
    });
    console.log(response.data);

    // Intenta insertar en la base de datos
    const insertQuery = `
      INSERT INTO replies (
        replies_id,
        sender_id,
        conversation_fk,
        reply_type,
        reply_text,
        reply_media_url,
        latitude,
        longitude
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *;
    `;
    const messageValues = [
      response.data.messages[0].id,
      phone,           
      conversationId,
      'location',
      streetName,
      null,
      latitude,
      longitude
    ];
    const result = await pool.query(insertQuery, messageValues);
    console.log('Inserted reply ID:', result.rows[0]);
    const newMessage = result.rows[0];
    // Emitir el mensaje procesado a los clientes suscritos a esa conversación
    // Consulta para obtener los administradores
    const adminQuery = `
    SELECT id_usuario FROM users 
    WHERE company_id = $1 
      AND rol IN (SELECT id FROM roles WHERE name = 'Administrador')
  `;
  const adminResult = await pool.query(adminQuery, [integrationDetails.company_id]);


  const adminIds = adminResult.rows.map(row => row.id_usuario);

  // Emitir el mensaje al usuario responsable y a los administradores
  const recipients = adminIds.includes(responsibleUserId) 
      ? adminIds 
      : [responsibleUserId, ...adminIds];

  recipients.forEach(userId => {
    io.to(`user-${userId}`).emit('newMessage', {
      id: newMessage.replies_id,
      conversationId: conversationId,
      timestamp: newMessage.created_at,
      senderId: phone,
      type: 'reply',
      message_type: 'location',
      text: streetName,
      url: null,
      thumbnail_url: null,
      duration: null,
      latitude: latitude,
      longitude: longitude,
      unread_messages: unreadMessages,
      responsibleUserId: responsibleUserId,
      company_id: integrationDetails.company_id // Añadir company_id aquí
    });
  });
    console.log('Mensaje emitido:', newMessage.replies_id);

  } catch (error) {
    console.error('Error sending WhatsApp location:', error.response?.data || error.message);
    res.status(500).json({ error: error.message });
  }
}

export async function sendReactMessage(io, req, res) {
  const { phone, emoji, message_id, message_type, conversationId, integration_name, usuario_send, id_usuario, integration_id, companyId, remitent, reply_from } = req.body;
  switch (integration_name) {
    case 'Interno':
         await InternalReactMessage(io, res, emoji, message_id, message_type, conversationId, integration_name, usuario_send, id_usuario, integration_id, companyId, remitent, reply_from);
      break;
  
    default:
        await WhatasAppReactMessage(io, res, phone, emoji, message_id, message_type, conversationId, integration_name, usuario_send, id_usuario, integration_id, companyId, remitent, reply_from)
      break;
  }
}

//Otros metodos:
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

const getVariableValue = async (variable, contact, responsibleUser, companyId) => {
    let value = '';
    if (variable.source === 'contacts') {
        value = contact[variable.variable] || '';
    } else if (variable.source === 'users') {
        value = responsibleUser ? responsibleUser[variable.variable] : '';
    } else if (variable.source === 'companies') {
        const companyQuery = 'SELECT * FROM companies WHERE id = $1';
        const companyResult = await pool.query(companyQuery, [companyId]);
        value = companyResult.rows[0] ? companyResult.rows[0][variable.variable] : '';
    } else if (variable.source === 'date') {
        value = getDateValue(variable.variable);
    }
    return value;
};

const replacePlaceholders = (text, parameters) => {
  if (!text) return ''; // Manejar caso donde text sea null o undefined
  return text.replace(/\{\{(\d+)\}\}/g, (_, index) => parameters[index - 1] || '');
};

const sendNewMenssageTemplate = async(io, templateID, contactID, responsibleUserId, res, whatsapp_api_token, whatsapp_phone_number_id, whatsapp_business_account_id, whatsappIntegrationID) => {

  let response;
 // Obtener la plantilla utilizada en la campaña
 const templateQuery = 'SELECT * FROM templates_wa WHERE id = $1';
 const templateResult = await pool.query(templateQuery, [templateID]);
 const template = templateResult.rows[0];

 const contactQuery = 'SELECT * FROM contacts WHERE id = $1';
 const contactsResult = await pool.query(contactQuery, [contactID])
 const contact = contactsResult.rows[0]
 if (!template) {
   return res.status(404).send({ error: 'Template not found' });
 }

 // Obtener las variables de la plantilla
 const variablesQuery = `
   SELECT * 
   FROM variable_headers 
   WHERE template_wa_id = $1
   UNION ALL
   SELECT * 
   FROM variable_body 
   WHERE template_wa_id = $1
   UNION ALL
   SELECT * 
   FROM variable_button 
   WHERE template_wa_id = $1
 `;
 const variablesResult = await pool.query(variablesQuery, [template.id]);
 const variables = variablesResult.rows;

   try {
    // Obtener la información del responsable de la campaña
    const userQuery = 'SELECT * FROM users WHERE id_usuario = $1';
    const userResult = await pool.query(userQuery, [responsibleUserId]);
    const responsibleUser = userResult.rows[0];

     // Comprobar si el contacto tiene una conversación
     const conversationQuery = 'SELECT * FROM conversations WHERE contact_id = $1';
     const conversationResult = await pool.query(conversationQuery, [contact.id]);
 
     let conversation;
     if (conversationResult.rows.length === 0) {
       // Crear nueva conversación
       const insertConversationQuery = `
         INSERT INTO conversations (phone_number, state, last_update, unread_messages, id_usuario, contact_id, integration_id)
         VALUES ($1, $2, NOW(), $3, $4, $5, $6) RETURNING *;
       `;
       const insertConversationValues = [
         contact.phone_number,
        'new',
         0,
         responsibleUserId,
         contact?.id,
         whatsappIntegrationID
       ];
       const insertConversationResult = await pool.query(insertConversationQuery, insertConversationValues);
       conversation = insertConversationResult.rows[0];
       console.log('Nueva conversación creada:', conversation.conversation_id);

     } else {
       // Actualizar la conversación existente y obtener la integración
       conversation = conversationResult.rows[0];
       const updateConversationQuery = `
         UPDATE conversations
         SET state = COALESCE($1, state), last_update = NOW(), id_usuario = $2
         WHERE contact_id = $3 RETURNING *;
       `;
       const updateConversationValues = [
         null,
         responsibleUserId,
         contact.id
       ];
       const updateConversationResult = await pool.query(updateConversationQuery, updateConversationValues);
       conversation = updateConversationResult.rows[0];
     }
 
     // Reemplazar variables en la plantilla
     const parameters = [];
     for (const variable of variables) {
       const value = await getVariableValue(variable, contact, responsibleUser, null);
       parameters.push(value);
     }
 
     console.log('Parámetros de mensaje:', parameters);
 
     // Verificar que los campos necesarios de la plantilla están presentes
     if (!template.nombre || !template.language) {
       throw new Error('Template is missing required fields');
     }

     let mediaUrl = null;
     let footer = template.footer || '';
     let response;
 
     if (template.header_type === 'TEXT') {
       response = await sendWhatsAppMessage(contact.phone_number, template.nombre, template.language, parameters, whatsapp_api_token, whatsapp_phone_number_id, whatsapp_business_account_id);
 
       // Obtener la cantidad de mensajes no leídos y el id_usuario responsable
       const unreadRes = await pool.query('SELECT unread_messages, id_usuario FROM conversations WHERE conversation_id = $1', [conversation.conversation_id]);
       const unreadMessages = unreadRes.rows[0].unread_messages;
   
       // Almacenar el mensaje con placeholders reemplazados
       await storeMessage(contact, conversation, parameters, unreadMessages, responsibleUserId, template, io, mediaUrl, response.messages[0].id, template.header_type, footer);
     } else if (template.header_type === 'IMAGE') {
       const imageUrl = `${backendUrl}${template.medio}`;
       response = await sendImageWhatsAppMessage(contact.phone_number, template.nombre, template.language, imageUrl, parameters, whatsapp_api_token, whatsapp_phone_number_id, whatsapp_business_account_id);
       mediaUrl = imageUrl;
 
       // Obtener la cantidad de mensajes no leídos y el id_usuario responsable
       const unreadRes = await pool.query('SELECT unread_messages, id_usuario FROM conversations WHERE conversation_id = $1', [conversation.conversation_id]);
       const unreadMessages = unreadRes.rows[0].unread_messages;
 
       // Almacenar el mensaje con placeholders reemplazados y la URL de la imagen
       await storeMessage(contact, conversation, parameters, unreadMessages, responsibleUserId, template, io, mediaUrl, response.messages[0].id, template.header_type, footer);
     } else if (template.header_type === 'VIDEO') {
       const videoUrl = `${backendUrl}${template.medio}`;
       response = await sendVideoWhatsAppMessage(contact.phone_number, template.nombre, template.language, videoUrl, parameters, whatsapp_api_token, whatsapp_phone_number_id, whatsapp_business_account_id);
       mediaUrl = videoUrl;
 
       // Obtener la cantidad de mensajes no leídos y el id_usuario responsable
       const unreadRes = await pool.query('SELECT unread_messages, id_usuario FROM conversations WHERE conversation_id = $1', [conversation.conversation_id]);
       const unreadMessages = unreadRes.rows[0].unread_messages;
 
       // Almacenar el mensaje con placeholders reemplazados y la URL del video
       await storeMessage(contact, conversation, parameters, unreadMessages, responsibleUserId, template, io, mediaUrl, response.messages[0].id, template.header_type, footer);
     } else if (template.header_type === 'DOCUMENT') {
       const documentUrl = `${backendUrl}${template.medio}`;
       const mediaId = await uploadDocumentToWhatsApp(documentUrl, whatsapp_api_token, whatsapp_phone_number_id);
       response = await sendDocumentWhatsAppMessage(contact.phone_number, template.nombre, template.language, mediaId, parameters, whatsapp_api_token, whatsapp_phone_number_id, whatsapp_business_account_id);
       mediaUrl = documentUrl;
 
       // Obtener la cantidad de mensajes no leídos y el id_usuario responsable
       const unreadRes = await pool.query('SELECT unread_messages, id_usuario FROM conversations WHERE conversation_id = $1', [conversation.conversation_id]);
       const unreadMessages = unreadRes.rows[0].unread_messages;
 
       // Almacenar el mensaje con placeholders reemplazados y la URL del documento
       await storeMessage(contact, conversation, parameters, unreadMessages, responsibleUserId, template, io, mediaUrl, response.messages[0].id, template.header_type, footer);
     } else {
       response = await sendWhatsAppMessage(contact.phone_number, template.nombre, template.language, parameters, whatsapp_api_token, whatsapp_phone_number_id, whatsapp_business_account_id);
 
       // Obtener la cantidad de mensajes no leídos y el id_usuario responsable
       const unreadRes = await pool.query('SELECT unread_messages, id_usuario FROM conversations WHERE conversation_id = $1', [conversation.conversation_id]);
       const unreadMessages = unreadRes.rows[0].unread_messages;
 
       // Almacenar el mensaje con placeholders reemplazados
       await storeMessage(contact, conversation, parameters, unreadMessages, responsibleUserId, template, io, mediaUrl, response.messages[0].id, template.header_type, footer);
     }
   } catch (error) {
     console.error(`Error processing contact ${contact.id}:`, error || error.data);
   }
 

 res.status(200).send({ message: 'Campaign launched successfully', response: response });

}

export async function sendTemplateMessage(io, req, res) {
  const { campaignId } = req.params;

  try {
    // Obtener los detalles de la campaña
    const campaignQuery = 'SELECT * FROM campaigns WHERE id = $1';
    const campaignResult = await pool.query(campaignQuery, [campaignId]);
    const campaign = campaignResult.rows[0];

    if (!campaign) {
      return res.status(404).send({ error: 'Campaign not found' });
    }

    // Obtener los responsables de la campaña
    const responsibleQuery = 'SELECT user_id FROM campaign_responsibles WHERE campaign_id = $1';
    const responsibleResult = await pool.query(responsibleQuery, [campaignId]);
    const responsibleUserIds = responsibleResult.rows.map(row => row.user_id);

    if (responsibleUserIds.length === 0) {
      return res.status(404).send({ error: 'No responsible users found' });
    }

    // Obtener los contactos asociados a la campaña
    const contactsQuery = `
      SELECT c.* 
      FROM contacts c
      JOIN campaign_contacts cc ON c.id = cc.contact_id
      WHERE cc.campaign_id = $1
    `;
    const contactsResult = await pool.query(contactsQuery, [campaignId]);
    const contacts = contactsResult.rows;

    // Obtener la plantilla utilizada en la campaña
    const templateQuery = 'SELECT * FROM templates_wa WHERE id = $1';
    const templateResult = await pool.query(templateQuery, [campaign.template_id]);
    const template = templateResult.rows[0];

    if (!template) {
      return res.status(404).send({ error: 'Template not found' });
    }

    // Obtener las variables de la plantilla
    const variablesQuery = `
      SELECT * 
      FROM variable_headers 
      WHERE template_wa_id = $1
      UNION ALL
      SELECT * 
      FROM variable_body 
      WHERE template_wa_id = $1
      UNION ALL
      SELECT * 
      FROM variable_button 
      WHERE template_wa_id = $1
    `;
    const variablesResult = await pool.query(variablesQuery, [template.id]);
    const variables = variablesResult.rows;

    let responsibleIndex = 0;

    // Obtener la integración de WhatsApp para la compañía
    const whatsappIntegration = await getWhatsAppIntegrationByCompanyId(template.company_id);
    const { whatsapp_api_token, whatsapp_phone_number_id, whatsapp_business_account_id } = whatsappIntegration;

    for (const contact of contacts) {
      try {
        const responsibleUserId = responsibleUserIds[responsibleIndex];
        responsibleIndex = (responsibleIndex + 1) % responsibleUserIds.length;
    
        // Obtener la información del responsable de la campaña
        const userQuery = 'SELECT * FROM users WHERE id_usuario = $1';
        const userResult = await pool.query(userQuery, [responsibleUserId]);
        const responsibleUser = userResult.rows[0];
    
        // Comprobar si el contacto tiene una conversación
        const conversationQuery = 'SELECT * FROM conversations WHERE contact_id = $1';
        const conversationResult = await pool.query(conversationQuery, [contact.id]);
    
        let conversation;
        if (conversationResult.rows.length === 0) {
          // Crear nueva conversación
          const insertConversationQuery = `
            INSERT INTO conversations (phone_number, state, last_update, unread_messages, id_usuario, contact_id, integration_id)
            VALUES ($1, $2, NOW(), $3, $4, $5, $6) RETURNING *;
          `;
          const insertConversationValues = [
            contact.phone_number,
            campaign.state_conversation || null,
            0,
            responsibleUserId,
            contact.id,
            whatsappIntegration.id
          ];
          const insertConversationResult = await pool.query(insertConversationQuery, insertConversationValues);
          conversation = insertConversationResult.rows[0];
          console.log('Nueva conversación creada:', conversation.conversation_id);
        } else {
          // Actualizar la conversación existente y obtener la integración
          conversation = conversationResult.rows[0];
          const updateConversationQuery = `
            UPDATE conversations
            SET state = COALESCE($1, state), last_update = NOW(), id_usuario = $2
            WHERE contact_id = $3 RETURNING *;
          `;
          const updateConversationValues = [
            campaign.state_conversation || null,
            responsibleUserId,
            contact.id
          ];
          const updateConversationResult = await pool.query(updateConversationQuery, updateConversationValues);
          conversation = updateConversationResult.rows[0];
        }
    
        // Reemplazar variables en la plantilla
        const parameters = [];
        for (const variable of variables) {
          const value = await getVariableValue(variable, contact, responsibleUser, campaign.company_id);
          parameters.push(value);
        }
    
        console.log('Parámetros de mensaje:', parameters);
    
        // Verificar que los campos necesarios de la plantilla están presentes
        if (!template.nombre || !template.language) {
          throw new Error('Template is missing required fields');
        }
    
        let mediaUrl = null;
        let footer = template.footer || '';
        let response;
    
        if (template.header_type === 'TEXT') {
          response = await sendWhatsAppMessage(contact.phone_number, template.nombre, template.language, parameters, whatsapp_api_token, whatsapp_phone_number_id, whatsapp_business_account_id);
    
          // Obtener la cantidad de mensajes no leídos y el id_usuario responsable
          const unreadRes = await pool.query('SELECT unread_messages, id_usuario FROM conversations WHERE conversation_id = $1', [conversation.conversation_id]);
          const unreadMessages = unreadRes.rows[0].unread_messages;
    
          // Almacenar el mensaje con placeholders reemplazados
          await storeMessage(contact, conversation, parameters, unreadMessages, responsibleUserId, template, io, mediaUrl, response.messages[0].id, template.header_type, footer);
        } else if (template.header_type === 'IMAGE') {
          const imageUrl = `${backendUrl}${template.medio}`;
          response = await sendImageWhatsAppMessage(contact.phone_number, template.nombre, template.language, imageUrl, parameters, whatsapp_api_token, whatsapp_phone_number_id, whatsapp_business_account_id);
          mediaUrl = imageUrl;
    
          // Obtener la cantidad de mensajes no leídos y el id_usuario responsable
          const unreadRes = await pool.query('SELECT unread_messages, id_usuario FROM conversations WHERE conversation_id = $1', [conversation.conversation_id]);
          const unreadMessages = unreadRes.rows[0].unread_messages;
    
          // Almacenar el mensaje con placeholders reemplazados y la URL de la imagen
          await storeMessage(contact, conversation, parameters, unreadMessages, responsibleUserId, template, io, mediaUrl, response.messages[0].id, template.header_type, footer);
        } else if (template.header_type === 'VIDEO') {
          const videoUrl = `${backendUrl}${template.medio}`;
          response = await sendVideoWhatsAppMessage(contact.phone_number, template.nombre, template.language, videoUrl, parameters, whatsapp_api_token, whatsapp_phone_number_id, whatsapp_business_account_id);
          mediaUrl = videoUrl;
    
          // Obtener la cantidad de mensajes no leídos y el id_usuario responsable
          const unreadRes = await pool.query('SELECT unread_messages, id_usuario FROM conversations WHERE conversation_id = $1', [conversation.conversation_id]);
          const unreadMessages = unreadRes.rows[0].unread_messages;
    
          // Almacenar el mensaje con placeholders reemplazados y la URL del video
          await storeMessage(contact, conversation, parameters, unreadMessages, responsibleUserId, template, io, mediaUrl, response.messages[0].id, template.header_type, footer);
        } else if (template.header_type === 'DOCUMENT') {
          const documentUrl = `${backendUrl}${template.medio}`;
          const mediaId = await uploadDocumentToWhatsApp(documentUrl, whatsapp_api_token, whatsapp_phone_number_id);
          response = await sendDocumentWhatsAppMessage(contact.phone_number, template.nombre, template.language, mediaId, parameters, whatsapp_api_token, whatsapp_phone_number_id, whatsapp_business_account_id);
          mediaUrl = documentUrl;
    
          // Obtener la cantidad de mensajes no leídos y el id_usuario responsable
          const unreadRes = await pool.query('SELECT unread_messages, id_usuario FROM conversations WHERE conversation_id = $1', [conversation.conversation_id]);
          const unreadMessages = unreadRes.rows[0].unread_messages;
    
          // Almacenar el mensaje con placeholders reemplazados y la URL del documento
          await storeMessage(contact, conversation, parameters, unreadMessages, responsibleUserId, template, io, mediaUrl, response.messages[0].id, template.header_type, footer);
        } else {
          response = await sendWhatsAppMessage(contact.phone_number, template.nombre, template.language, parameters, whatsapp_api_token, whatsapp_phone_number_id, whatsapp_business_account_id);
    
          // Obtener la cantidad de mensajes no leídos y el id_usuario responsable
          const unreadRes = await pool.query('SELECT unread_messages, id_usuario FROM conversations WHERE conversation_id = $1', [conversation.conversation_id]);
          const unreadMessages = unreadRes.rows[0].unread_messages;
    
          // Almacenar el mensaje con placeholders reemplazados
          await storeMessage(contact, conversation, parameters, unreadMessages, responsibleUserId, template, io, mediaUrl, response.messages[0].id, template.header_type, footer);
        }
      } catch (error) {
        console.error(`Error processing contact ${contact.id}:`, error);
        continue; 
      }
    } 

    res.status(200).send({ message: 'Campaign launched successfully' });
  } catch (error) {
    console.error('Error launching campaign:', error.message);
    res.status(500).send({ error: error.message });
  }
}

const sendWhatsAppMessage = async (phone, templateName, language, parameters, token, phoneNumberId, whatsappBusinessId) => {
  try {
    const payload = {
      messaging_product: "whatsapp",
      to: phone,
      type: "template",
      template: {
        namespace: whatsappBusinessId,
        name: templateName,
        language: {
          code: language,
          policy: "deterministic"
        },
        components: []
      }
    };

    // Verifica si hay un parámetro válido para el header (primer parámetro) antes de agregarlo
    if (parameters[0] && parameters[0].trim() !== "") {
      payload.template.components.push({
        type: "header",
        parameters: [
          {
            type: "text",
            text: parameters[0]
          }
        ]
      });
    }

    // Verifica si hay parámetros válidos para el body
    const bodyParameters = parameters.slice(1).filter(param => param && param.trim() !== "");
    if (bodyParameters.length > 0) {
      payload.template.components.push({
        type: "body",
        parameters: bodyParameters.map(value => ({
          type: "text",
          text: value
        }))
      });
    }

    // Si tienes botones en el template, agrégalos de manera correcta
    if (parameters.buttons && parameters.buttons.length > 0) {
      payload.template.components.push({
        type: "button",
        sub_type: "quick_reply",  // Puede ser 'quick_reply' o 'url' dependiendo de tu botón
        parameters: parameters.buttons.map(button => ({
          type: "text",
          text: button.text
        }))
      });
    }

    console.log('Payload a enviar:', JSON.stringify(payload, null, 2));

    const response = await axios.post(
      `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`,
      payload,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      }
    );
    return response.data;
  } catch (error) {
    console.error('Error sending WhatsApp message:', error.response?.data || error.message);
    throw error;
  }
};

const sendImageWhatsAppMessage = async (phone, templateName, language, imageUrl, parameters, token, phoneNumberId, whatsappBusinessId) => {
  try {
    const payload = {
      messaging_product: "whatsapp",
      to: phone,
      type: "template",
      template: {
        namespace: whatsappBusinessId,
        name: templateName,
        language: {
          code: language,
          policy: "deterministic"
        },
        components: [
          {
            type: "header",
            parameters: [{
              type: "image",
              image: { link: imageUrl }
            }]
          },
          {
            type: "body",
            parameters: parameters.map(value => ({ type: "text", text: value }))
          }
        ]
      }
    };

    console.log('Payload a enviar:', JSON.stringify(payload, null, 2));

    const response = await axios.post(
      `https://graph.facebook.com/v13.0/${phoneNumberId}/messages`,
      payload,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      }
    );
    return response.data;
  } catch (error) {
    console.error('Error sending WhatsApp message:', error);
    throw error;
  }
};

const sendVideoWhatsAppMessage = async (phone, templateName, language, videoUrl, parameters, token, phoneNumberId, whatsappBusinessId) => {
  try {
    const payload = {
      messaging_product: "whatsapp",
      to: phone,
      type: "template",
      template: {
        namespace: whatsappBusinessId,
        name: templateName,
        language: {
          code: language,
          policy: "deterministic"
        },
        components: [
          {
            type: "header",
            parameters: [{
              type: "video",
              video: { link: videoUrl }
            }]
          },
          {
            type: "body",
            parameters: parameters.map(value => ({ type: "text", text: value }))
          }
        ]
      }
    };

    console.log('Payload a enviar:', JSON.stringify(payload, null, 2));

    const response = await axios.post(
      `https://graph.facebook.com/v13.0/${phoneNumberId}/messages`,
      payload,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      }
    );
    return response.data;
  } catch (error) {
    console.error('Error sending WhatsApp message:', error);
    throw error;
  }
};

const sendDocumentWhatsAppMessage = async (phone, templateName, language, mediaId, parameters, token, phoneNumberId, whatsappBusinessId) => {
  try {
    const payload = {
      messaging_product: "whatsapp",
      to: phone,
      type: "template",
      template: {
        namespace: whatsappBusinessId,
        name: templateName,
        language: {
          code: language,
          policy: "deterministic"
        },
        components: [
          {
            type: "header",
            parameters: [{
              type: "document",
              document: { id: mediaId, filename: "ejemplo.pdf" }
            }]
          },
          {
            type: "body",
            parameters: parameters.map(value => ({ type: "text", text: value }))
          }
        ]
      }
    };

    console.log('Payload a enviar:', JSON.stringify(payload, null, 2));

    const response = await axios.post(
      `https://graph.facebook.com/v13.0/${phoneNumberId}/messages`,
      payload,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      }
    );
    return response.data;
  } catch (error) {
    console.error('Error sending WhatsApp message:', error);
    throw error;
  }
};

const uploadDocumentToWhatsApp = async (documentUrl, token, phoneNumberId) => {
  try {
    const response = await axios.post(
      `https://graph.facebook.com/v13.0/${phoneNumberId}/media`,
      {
        messaging_product: "whatsapp",
        type: "document",
        url: documentUrl
      },
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      }
    );
    return response.data.id; // Devuelve el media_id del documento
  } catch (error) {
    console.error('Error uploading document to WhatsApp:', error);
    throw error;
  }
};


const storeMessage = async (contact, conversation, parameters, unreadMessages, responsibleUserId, template, io, mediaUrl = null, whatsappMessageId, headerType, footerText = null) => {

  // Obtén los detalles de la integración
  const integrationDetails = await getIntegrationDetailsByConversationId(conversation.conversation_id);

  // Dividir parámetros en header, body y button
  const headerParameters = parameters.slice(0, 1);
  const bodyParameters = parameters.slice(1, 4); // Ajusta el rango según la cantidad de variables del cuerpo
  const buttonParameters = parameters.slice(4); // Ajusta según la cantidad de variables del botón

  // Reemplazar los placeholders en cada componente
  const headerText = replacePlaceholders(template.header_text, headerParameters);
  const bodyText = replacePlaceholders(template.body_text, bodyParameters);
  const buttonText = replacePlaceholders(template.button_text, buttonParameters);

  // Agregar el valor del footer si lo tiene
  const footerTextReplaced = footerText ? replacePlaceholders(footerText, parameters) : null;

  try {
      const insertQuery = `
      INSERT INTO replies (
        sender_id,
        conversation_fk,
        reply_type,
        reply_text,
        reply_media_url,
        latitude,
        longitude,
        reply_header,
        reply_button,
        reply_type_header,
        footer,
        replies_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *;
    `;
      const messageValues = [
          contact?.phone_number || 'unknown', // Manejar caso donde contact sea undefined
          conversation.conversation_id,
          'template',
          bodyText,
          mediaUrl,
          null,
          null,
          headerText,
          buttonText,
          headerType,
          footerTextReplaced,
          whatsappMessageId
      ];
      const messageRes = await pool.query(insertQuery, messageValues);
      const newMessage = messageRes.rows[0];

      // Emitir el mensaje procesado a los clientes suscritos a esa conversación
      // Consulta para obtener los administradores
     const adminQuery = `
     SELECT id_usuario FROM users 
     WHERE company_id = $1 
       AND rol IN (SELECT id FROM roles WHERE name = 'Administrador')
   `;
   const adminResult = await pool.query(adminQuery, [integrationDetails.company_id]);


   const adminIds = adminResult.rows.map(row => row.id_usuario);

   // Emitir el mensaje al usuario responsable y a los administradores
   const recipients = adminIds.includes(responsibleUserId) 
      ? adminIds 
      : [responsibleUserId, ...adminIds];
      
   recipients.forEach(userId => {
     io.to(`user-${userId}`).emit('newMessage', {
          id: newMessage.replies_id,
          conversationId: conversation.conversation_id,
          timestamp: newMessage.created_at,
          senderId: contact?.phone_number || 'unknown',
          message_type: 'template',
          text: bodyText,
          mediaUrl: mediaUrl,
          thumbnailUrl: null,
          duration: null,
          latitude: null,
          longitude: null,
          type: 'reply',
          unread_messages: unreadMessages,
          responsibleUserId: responsibleUserId,
          reply_type_header: headerType,
          footer: footerTextReplaced,
          company_id: integrationDetails.company_id // Añadir company_id aquí
      });
    });
      console.log('Mensaje emitido:', newMessage.replies_id);
  } catch (error) {
      console.error('Error storing message:', error.message);
      throw error;
  }
};

export async function sendTemplateToSingleContact(io, req, res) {
  const { conversation, template, parameters, company_id } = req.body;

if (!company_id) {
  return res.status(400).json({ error: 'Company ID is required' });
}

// Obtener la integración de WhatsApp para la compañía
const whatsappIntegration = await getWhatsAppIntegrationByCompanyId(company_id);
const { whatsapp_api_token, whatsapp_phone_number_id, whatsapp_business_account_id } = whatsappIntegration;

if (conversation.conversation_id) {  
  try {
    const phoneNumber = conversation.phone_number;
    let response;
    let mediaUrl = null;

    if (template.header_type === 'TEXT') {
      response = await sendWhatsAppMessage(phoneNumber, template.nombre, template.language, parameters, whatsapp_api_token, whatsapp_phone_number_id, whatsapp_business_account_id);
    } else if (template.header_type === 'IMAGE') {
      const imageUrl = `${backendUrl}${template.medio}`
      response = await sendImageWhatsAppMessage(phoneNumber, template.nombre, template.language, imageUrl, parameters, whatsapp_api_token, whatsapp_phone_number_id, whatsapp_business_account_id);
      mediaUrl = imageUrl;
    } else if (template.header_type === 'VIDEO') {
      const videoUrl = `${backendUrl}${template.medio}`
      response = await sendVideoWhatsAppMessage(phoneNumber, template.nombre, template.language, videoUrl, parameters, whatsapp_api_token, whatsapp_phone_number_id, whatsapp_business_account_id);
      mediaUrl = videoUrl;
    } else if (template.header_type === 'DOCUMENT') {
      const documentUrl = `${backendUrl}${template.medio}`
      const mediaId = await uploadDocumentToWhatsApp(documentUrl);
      response = await sendDocumentWhatsAppMessage(phoneNumber, template.nombre, template.language, mediaId, parameters, whatsapp_api_token, whatsapp_phone_number_id, whatsapp_business_account_id);
      mediaUrl = documentUrl;
    }else{
      response = await sendWhatsAppMessage(phoneNumber, template.nombre, template.language, parameters, whatsapp_api_token, whatsapp_phone_number_id, whatsapp_business_account_id);
    }

    if (response) {
      const unreadRes = await pool.query('SELECT unread_messages, id_usuario FROM conversations WHERE conversation_id = $1', [conversation.conversation_id]);
      const unreadMessages = unreadRes.rows[0].unread_messages;

      await storeMessage(
        conversation.contact,
        conversation,
        parameters,
        unreadMessages,
        conversation.responsible_user_id,
        template,
        io,
        mediaUrl,
        response.messages[0].id, 
        template.header_type
      );
    }

    return res.status(200).json({ message: 'Plantilla enviada exitosamente' });
  } catch (error) {
    console.error('Error sending template:', error.data);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
}else{
  let response;
   console.log("ingresando para enviar platilla")
   try {
    if (!res.headersSent) {
      response = await sendNewMenssageTemplate(io, template.id, conversation.id, conversation.id_usuario, res, whatsapp_api_token, whatsapp_phone_number_id, whatsapp_business_account_id, whatsappIntegration.id);
      return res.status(200).json({ message: 'Plantilla enviada exitosamente', res: response });
    }
  } catch (error) {
    if (!res.headersSent) {
      console.error('Error sending template:', error.data || error);
      return res.status(500).json({ error: 'Error interno del servidor' });
    }
  }
}
};

async function getIntegrationDetailsByConversationId(conversationId) {
  const query = `
    SELECT i.* FROM integrations i
    JOIN conversations c ON i.id = c.integration_id
    WHERE c.conversation_id = $1
  `;
  const result = await pool.query(query, [conversationId]);

  if (result.rows.length > 0) {
    return result.rows[0];
  } else {
    throw new Error(`Integration details not found for conversation_id: ${conversationId}`);
  }
}

// Función para obtener los detalles de integración usando el `integration_id`
async function getIntegrationDetailsById(integrationId) {
  const query = 'SELECT * FROM integrations WHERE id = $1';
  const result = await pool.query(query, [integrationId]);
  if (result.rows.length > 0) {
    return result.rows[0];
  } else {
    throw new Error(`Integration details not found for id: ${integrationId}`);
  }
}

// Función para obtener la integración de WhatsApp usando el `company_id`
async function getWhatsAppIntegrationByCompanyId(companyId) {
  const query = `
    SELECT * FROM integrations 
    WHERE company_id = $1 AND type = 'whatsapp'
    LIMIT 1
  `;
  const result = await pool.query(query, [companyId]);
  if (result.rows.length > 0) {
    return result.rows[0];
  } else {
    throw new Error(`WhatsApp integration not found for company_id: ${companyId}`);
  }
}