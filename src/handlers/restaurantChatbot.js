import axios from 'axios';
import pool from '../config/dbConfig.js';

const token = process.env.WHATSAPP_API_TOKEN;
const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

// Función para enviar un mensaje de WhatsApp y registrar el mensaje en la base de datos
async function sendWhatsAppMessage(io, phone, messageText, conversationId) {
  const url = `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`;
  const payload = {
    messaging_product: "whatsapp",
    to: phone,
    type: "text",
    text: { body: messageText }
  };

  // Obtener la cantidad de mensajes no leídos y el id_usuario responsable
  const unreadRes = await pool.query('SELECT unread_messages, id_usuario FROM conversations WHERE conversation_id = $1', [conversationId]);
  const unreadMessages = unreadRes.rows[0].unread_messages;
  const responsibleUserId = unreadRes.rows[0].id_usuario;

  try {
    const response = await axios.post(url, payload, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    console.log('WhatsApp message sent:', response.data);

    // Insertar en la base de datos
    const insertQuery = `
      INSERT INTO replies (
        sender_id,
        conversation_fk,
        reply_type,
        reply_text,
        reply_media_url,
        latitude,
        longitude
      ) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *;
    `;
    const messageValues = [
      phone,           
      conversationId,
      'text',
      messageText,
      null,
      null,
      null
    ];
    const res = await pool.query(insertQuery, messageValues);
    console.log('Inserted reply ID:', res.rows[0]);
    const newMessage = res.rows[0];
    // Emitir el mensaje procesado a los clientes suscritos a esa conversación
    io.emit('newMessage', {
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
      responsibleUserId: responsibleUserId
    });
    console.log('Mensaje emitido:', newMessage.replies_id);
  } catch (error) {
    console.error('Error:', error.response?.data || error.message || error);
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
      { role: "system", content: "Eres Juliana, una asistente virtual del Restaurante San Telmo, una parrilla Argentina ubicada en el centro de la ciudad de Pasto. Proporciona información sobre los platos y ayuda a los clientes a hacer reservas o pedidos a domicilio. Usa un tono profesional, amigable y natural. Mantén la conversación fluida y personalizada. Tienes libertad para inventar los platos y sus precios, así como los horarios disponibles para reservas. Proporciona precios en pesos colombianos. Una empanada cuesta $3.000, una hamburguesa $19.000 y un churrasco $35.000. Atendemos de martes a sábado de 6pm a 12 medianoche. Mantén la coherencia de la conversación y responde solo con el mensaje para enviar al cliente, puedes usar emoticones y manten respuestas cortas claras y concisas." },
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

async function processRestauranteConversation(io, senderId, message, conversationId, currentState) {
    const getLastMessagesQuery = `
    (SELECT message_text AS text, received_at AS created_at FROM messages WHERE sender_id = $1 ORDER BY received_at DESC LIMIT 3)
    UNION ALL
    (SELECT reply_text AS text, created_at FROM replies WHERE sender_id = $1 ORDER BY created_at DESC LIMIT 2)
    ORDER BY created_at ASC
  `;
  
  const messagesRes = await pool.query(getLastMessagesQuery, [senderId]);
  const lastMessages = messagesRes.rows.map(row => row.text);
  console.log(lastMessages);

  const contactInfo = await getContactInfo(senderId);
  const { first_name: firstName, last_name: lastName } = contactInfo;
  const customerName = firstName ? `${firstName} ${lastName || ''}` : 'Cliente';

  let prompt;
  if (currentState === 'new') {
    prompt = `Hola ${customerName}, soy Juliana del Restaurante San Telmo. Un gusto atenderte nuevamente. ¿En qué te puedo ayudar el día de hoy?`;
    await updateConversationState(conversationId, 'active');
  } else {
    prompt = `Aquí tienes los últimos mensajes del cliente:\n${lastMessages.join('\n')}\nResponde de manera amable y profesional, manteniendo la conversación fluida y natural.`;
  }

  const responseText = await obtenerRespuestaGPT(prompt);

  await sendWhatsAppMessage(io, senderId, responseText, conversationId);
}

// Utilidad para obtener la información de contacto
async function getContactInfo(phoneNumber) {
  const query = 'SELECT first_name, last_name FROM contacts WHERE phone_number = $1';
  try {
    const result = await pool.query(query, [phoneNumber]);
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

// Utilidad para actualizar el estado de la conversación
async function updateConversationState(conversationId, newState) {
  const query = 'UPDATE conversations SET state = $2 WHERE conversation_id = $1';
  try {
    await pool.query(query, [conversationId, newState]);
  } catch (error) {
    console.error('Database error updating conversation state:', error);
    throw error;
  }
}

export { processRestauranteConversation };
