import axios from 'axios';
import pool from '../config/dbConfig.js';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

const backendUrl = process.env.BACKEND_URL;

export async function sendTextMessage(io, req, res) {
  const { phone, messageText, conversationId } = req.body;

  // Obtén los detalles de la integración
  const integrationDetails = await getIntegrationDetailsByConversationId(conversationId);
  const { WHATSAPP_API_TOKEN, WHATSAPP_PHONE_NUMBER_ID } = integrationDetails;

  // Obtén la cantidad de mensajes no leídos y el id_usuario responsable
  const unreadRes = await pool.query('SELECT unread_messages, id_usuario FROM conversations WHERE conversation_id = $1', [conversationId]);
  const unreadMessages = unreadRes.rows[0].unread_messages;
  const responsibleUserId = unreadRes.rows[0].id_usuario;

  try {
    // Enviar mensaje via WhatsApp
    const response = await axios.post(
      `https://graph.facebook.com/v13.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to: phone,
        type: "text",
        text: { body: messageText }
      },
      {
        headers: {
          'Authorization': `Bearer ${WHATSAPP_API_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );

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
        created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *;
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
      new Date() // Timestamp actual
    ];
    const res = await pool.query(insertQuery, messageValues);
    console.log('Inserted reply ID:', res.rows[0]);
    const newMessage = res.rows[0];
    
    // Emitir el mensaje procesado a los clientes suscritos a esa conversación
    io.emit('newMessage', {
      id: newMessage.id,
      conversationId: conversationId,
      timestamp: newMessage.received_at,
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
      reply_from: newMessage.reply_from
    });
    console.log('Mensaje emitido:', newMessage.id);
  } catch (error) {
    console.error('Error sending message:', error);
    res.status(500).json({ error: error.message });
  }
}


export async function sendImageMessage(io, req, res) {
  const { phone, imageUrl, conversationId } = req.body;
  const fullImageUrl = `${backendUrl}${imageUrl}`; // Agregar el prefijo a la URL de la imagen
  console.log(fullImageUrl);

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
    image: { link: fullImageUrl }
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
      'image',
      null,
      imageUrl,
      null,
      null
    ];
    const result = await pool.query(insertQuery, messageValues);
    console.log('Inserted reply ID:', result.rows[0]);
    const newMessage = result.rows[0];
    // Emitir el mensaje procesado a los clientes suscritos a esa conversación
    io.emit('newMessage', {
      id: newMessage.replies_id,
      conversationId: conversationId,
      timestamp: newMessage.created_at,
      senderId: phone,
      type: 'reply',
      message_type: 'image',
      text: null,
      url: imageUrl,
      thumbnail_url: null,
      duration: null,
      latitude: null,
      longitude: null,
      unread_messages: unreadMessages,
      responsibleUserId: responsibleUserId
    });
    console.log('Mensaje emitido:', newMessage.replies_id);

  } catch (error) {
    console.error('Error sending WhatsApp image:', error.response?.data || error.message);
    res.status(500).json({ error: error.message });
  }
}



export async function sendVideoMessage(io, req, res) {
  const { phone, videoUrl, videoThumbnail, videoDuration, conversationId } = req.body;
  const fullVideoUrl = `${backendUrl}${videoUrl}`;
  console.log(fullVideoUrl);

  // Obtén los detalles de la integración
  const integrationDetails = await getIntegrationDetailsByConversationId(conversationId);
  const { WHATSAPP_API_TOKEN, WHATSAPP_PHONE_NUMBER_ID } = integrationDetails;

  const url = `https://graph.facebook.com/v19.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`;
  const payload = {
    messaging_product: "whatsapp",
    to: phone,
    type: "video",
    video: {
      link: fullVideoUrl
    }
  };

  // Obtén la cantidad de mensajes no leídos y el id_usuario responsable
  const unreadRes = await pool.query('SELECT unread_messages, id_usuario FROM conversations WHERE conversation_id = $1', [conversationId]);
  const unreadMessages = unreadRes.rows[0].unread_messages;
  const responsibleUserId = unreadRes.rows[0].id_usuario;

  try {
    const response = await axios.post(url, payload, {
      headers: {
        'Authorization': `Bearer ${WHATSAPP_API_TOKEN}`,
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
        duration
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9) RETURNING *;
    `;
    const messageValues = [
      response.data.messages[0].id,
      phone,           
      conversationId,
      'video',
      null,
      videoUrl,
      null,
      null,
      videoThumbnail,
      videoDuration
    ];
    const result = await pool.query(insertQuery, messageValues);
    console.log('Inserted reply ID:', result.rows[0]);
    const newMessage = result.rows[0];
    // Emitir el mensaje procesado a los clientes suscritos a esa conversación
    io.emit('newMessage', {
      id: newMessage.replies_id,
      conversationId: conversationId,
      timestamp: newMessage.created_at,
      senderId: phone,
      type: 'reply',
      message_type: 'video',
      text: null,
      url: videoUrl,
      thumbnail_url: videoThumbnail,
      duration: videoDuration,
      latitude: null,
      longitude: null,
      unread_messages: unreadMessages,
      responsibleUserId: responsibleUserId
    });
    console.log('Mensaje emitido:', newMessage.replies_id);

  } catch (error) {
    console.error('Error sending WhatsApp video:', error.response?.data || error.message);
    res.status(500).json({ error: error.message });
  }
}



// Función para enviar un documento por WhatsApp
export async function sendDocumentMessage(io, req, res) {
  const { phone, documentUrl, documentName, conversationId } = req.body;
  const fullDocumentUrl = `${backendUrl}${documentUrl}`; // Add the prefix to the document URL

  // Obtén los detalles de la integración
  const integrationDetails = await getIntegrationDetailsByConversationId(conversationId);
  const { WHATSAPP_API_TOKEN, WHATSAPP_PHONE_NUMBER_ID } = integrationDetails;

  const url = `https://graph.facebook.com/v19.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`;
  const payload = {
    messaging_product: "whatsapp",
    to: phone,
    type: "document",
    document: {
      link: fullDocumentUrl,
      filename: documentName
    }
  };

  // Get the count of unread messages and the responsible user ID
  const unreadRes = await pool.query('SELECT unread_messages, id_usuario FROM conversations WHERE conversation_id = $1', [conversationId]);
  const unreadMessages = unreadRes.rows[0].unread_messages;
  const responsibleUserId = unreadRes.rows[0].id_usuario;

  try {
    const response = await axios.post(url, payload, {
      headers: {
        'Authorization': `Bearer ${WHATSAPP_API_TOKEN}`,
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
      null,
      documentUrl,
      null,
      null,
      documentName
    ];
    const result = await pool.query(insertQuery, messageValues);
    console.log('Inserted reply ID:', result.rows[0]);
    const newMessage = result.rows[0];
    // Emit the processed message to clients subscribed to that conversation
    io.emit('newMessage', {
      id: newMessage.replies_id,
      conversationId: conversationId,
      timestamp: newMessage.created_at,
      senderId: phone,
      type: 'reply',
      message_type: 'document',
      text: null,
      url: documentUrl,
      thumbnail_url: null,
      duration: null,
      latitude: null,
      longitude: null,
      unread_messages: unreadMessages,
      responsibleUserId: responsibleUserId,
      file_name: documentName
    });
    console.log('Message emitted:', newMessage.replies_id);

  } catch (error) {
    console.error('Error sending WhatsApp document:', error.response?.data || error.message);
    res.status(500).json({ error: error.message });
  }
}


export async function sendAudioMessage(io, req, res) {
  const { phone, audioUrl, audioDuration, conversationId } = req.body;
  const fullAudioUrl = `${backendUrl}${audioUrl}`;

  // Obtén los detalles de la integración
  const integrationDetails = await getIntegrationDetailsByConversationId(conversationId);
  const { WHATSAPP_API_TOKEN, WHATSAPP_PHONE_NUMBER_ID } = integrationDetails;

  const url = `https://graph.facebook.com/v19.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`;
  const payload = {
    messaging_product: "whatsapp",
    to: phone,
    type: "audio",
    audio: {
      link: fullAudioUrl
    }
  };

  // Obtén la cantidad de mensajes no leídos y el id_usuario responsable
  const unreadRes = await pool.query('SELECT unread_messages, id_usuario FROM conversations WHERE conversation_id = $1', [conversationId]);
  const unreadMessages = unreadRes.rows[0].unread_messages;
  const responsibleUserId = unreadRes.rows[0].id_usuario;

  try {
    const response = await axios.post(url, payload, {
      headers: {
        'Authorization': `Bearer ${WHATSAPP_API_TOKEN}`,
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
        duration
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *;
    `;
    const messageValues = [
      response.data.messages[0].id,
      phone,           
      conversationId,
      'audio',
      null,
      audioUrl,
      null,
      null,
      audioDuration
    ];
    const result = await pool.query(insertQuery, messageValues);
    console.log('Inserted reply ID:', result.rows[0]);
    const newMessage = result.rows[0];
    // Emitir el mensaje procesado a los clientes suscritos a esa conversación
    io.emit('newMessage', {
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
      responsibleUserId: responsibleUserId
    });
    console.log('Mensaje emitido:', newMessage.replies_id);

  } catch (error) {
    console.error('Error sending WhatsApp audio:', error.response?.data || error.message);
    res.status(500).json({ error: error.message });
  }
}














 
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
    const { WHATSAPP_API_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_BUSINESS_ACCOUNT_ID } = whatsappIntegration;

    for (const contact of contacts) {
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

        // Obtener los detalles de la integración usando `integration_id`
        const conversationIntegration = await getIntegrationDetailsById(conversation.integration_id);
        WHATSAPP_API_TOKEN = conversationIntegration.WHATSAPP_API_TOKEN;
        WHATSAPP_PHONE_NUMBER_ID = conversationIntegration.WHATSAPP_PHONE_NUMBER_ID;
        WHATSAPP_BUSINESS_ACCOUNT_ID = conversationIntegration.WHATSAPP_BUSINESS_ACCOUNT_ID;
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
        console.error('Error: faltan campos necesarios en la plantilla');
        return res.status(500).send({ error: 'Template is missing required fields' });
      }

      let mediaUrl = null;
      let footer = template.footer || '';
      let response;

      if (template.header_type === 'TEXT') {
        response = await sendWhatsAppMessage(contact.phone_number, template.nombre, template.language, parameters, WHATSAPP_API_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_BUSINESS_ACCOUNT_ID);

        // Obtener la cantidad de mensajes no leídos y el id_usuario responsable
        const unreadRes = await pool.query('SELECT unread_messages, id_usuario FROM conversations WHERE conversation_id = $1', [conversation.conversation_id]);
        const unreadMessages = unreadRes.rows[0].unread_messages;

        // Almacenar el mensaje con placeholders reemplazados
        await storeMessage(contact, conversation, parameters, unreadMessages, responsibleUserId, template, io, mediaUrl, response.messages[0].id, template.header_type, footer);
      } else if (template.header_type === 'IMAGE') {
        const imageUrl = 'https://upload.wikimedia.org/wikipedia/commons/1/13/ChatGPT-Logo.png'; // Línea para pruebas
        response = await sendImageWhatsAppMessage(contact.phone_number, template.nombre, template.language, imageUrl, parameters, WHATSAPP_API_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_BUSINESS_ACCOUNT_ID);
        mediaUrl = imageUrl;

        // Obtener la cantidad de mensajes no leídos y el id_usuario responsable
        const unreadRes = await pool.query('SELECT unread_messages, id_usuario FROM conversations WHERE conversation_id = $1', [conversation.conversation_id]);
        const unreadMessages = unreadRes.rows[0].unread_messages;

        // Almacenar el mensaje con placeholders reemplazados y la URL de la imagen
        await storeMessage(contact, conversation, parameters, unreadMessages, responsibleUserId, template, io, mediaUrl, response.messages[0].id, template.header_type, footer);
      } else if (template.header_type === 'VIDEO') {
        const videoUrl = 'https://cdn.pixabay.com/video/2020/09/08/49375-459436752_small.mp4'; // Línea para pruebas
        response = await sendVideoWhatsAppMessage(contact.phone_number, template.nombre, template.language, videoUrl, parameters, WHATSAPP_API_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_BUSINESS_ACCOUNT_ID);
        mediaUrl = videoUrl;

        // Obtener la cantidad de mensajes no leídos y el id_usuario responsable
        const unreadRes = await pool.query('SELECT unread_messages, id_usuario FROM conversations WHERE conversation_id = $1', [conversation.conversation_id]);
        const unreadMessages = unreadRes.rows[0].unread_messages;

        // Almacenar el mensaje con placeholders reemplazados y la URL del video
        await storeMessage(contact, conversation, parameters, unreadMessages, responsibleUserId, template, io, mediaUrl, response.messages[0].id, template.header_type, footer);
      } else if (template.header_type === 'DOCUMENT') {
        const documentUrl = 'https://www.turnerlibros.com/wp-content/uploads/2021/02/ejemplo.pdf'; // Línea para pruebas
        const mediaId = await uploadDocumentToWhatsApp(documentUrl, WHATSAPP_API_TOKEN, WHATSAPP_PHONE_NUMBER_ID);
        response = await sendDocumentWhatsAppMessage(contact.phone_number, template.nombre, template.language, mediaId, parameters, WHATSAPP_API_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_BUSINESS_ACCOUNT_ID);
        mediaUrl = documentUrl;

        // Obtener la cantidad de mensajes no leídos y el id_usuario responsable
        const unreadRes = await pool.query('SELECT unread_messages, id_usuario FROM conversations WHERE conversation_id = $1', [conversation.conversation_id]);
        const unreadMessages = unreadRes.rows[0].unread_messages;

        // Almacenar el mensaje con placeholders reemplazados y la URL del documento
        await storeMessage(contact, conversation, parameters, unreadMessages, responsibleUserId, template, io, mediaUrl, response.messages[0].id, template.header_type, footer);
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
        components: [
          {
            type: "header",
            parameters: parameters.filter((_, index) => index === 0).map(value => ({ type: "text", text: value }))
          },
          {
            type: "body",
            parameters: parameters.filter((_, index) => index !== 0).map(value => ({ type: "text", text: value }))
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
      io.emit('newMessage', {
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
          footer: footerTextReplaced
      });
      console.log('Mensaje emitido:', newMessage.replies_id);
  } catch (error) {
      console.error('Error storing message:', error.message);
      throw error;
  }
};



export async function sendTemplateToSingleContact(io, req, res) {
  const { conversation, template, parameters } = req.body;

  try {
    const phoneNumber = conversation.phone_number;
    let response;
    let mediaUrl = null;

    if (template.header_type === 'TEXT') {
      response = await sendWhatsAppMessage(phoneNumber, template.nombre, template.language, parameters);
    } else if (template.header_type === 'IMAGE') {
      const imageUrl = 'https://upload.wikimedia.org/wikipedia/commons/1/13/ChatGPT-Logo.png'; // Línea para pruebas
      response = await sendImageWhatsAppMessage(phoneNumber, template.nombre, template.language, imageUrl, parameters);
      mediaUrl = imageUrl;
    } else if (template.header_type === 'VIDEO') {
      const videoUrl = 'https://cdn.pixabay.com/video/2020/09/08/49375-459436752_small.mp4'; // Línea para pruebas
      response = await sendVideoWhatsAppMessage(phoneNumber, template.nombre, template.language, videoUrl, parameters);
      mediaUrl = videoUrl;
    } else if (template.header_type === 'DOCUMENT') {
      const documentUrl = 'https://www.turnerlibros.com/wp-content/uploads/2021/02/ejemplo.pdf'; // Línea para pruebas
      const mediaId = await uploadDocumentToWhatsApp(documentUrl);
      response = await sendDocumentWhatsAppMessage(phoneNumber, template.nombre, template.language, mediaId, parameters);
      mediaUrl = documentUrl;
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
        response.messages[0].id, // ID del mensaje de WhatsApp
        template.header_type
      );
    }

    return res.status(200).json({ message: 'Plantilla enviada exitosamente' });
  } catch (error) {
    console.error('Error sending template:', error);
    return res.status(500).json({ error: 'Error interno del servidor' });
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