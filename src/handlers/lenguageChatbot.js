import axios from 'axios';
import pool from '../config/dbConfig.js';

const token = process.env.WHATSAPP_API_TOKEN;
const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

// Function to send a WhatsApp message and log the message in the database
async function sendWhatsAppMessage(io, phone, messageText, conversationId) {
  const url = `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`;
  const payload = {
    messaging_product: "whatsapp",
    to: phone,
    type: "text",
    text: { body: messageText }
  };

  // Get the number of unread messages and the responsible user ID
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

    // Insert into the database
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
    // Emit the processed message to clients subscribed to that conversation
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
    console.log('Message emitted:', newMessage.replies_id);
  } catch (error) {
    console.error('Error:', error.response?.data || error.message || error);
  }
}

async function obtenerRespuestaGPT(prompt, languageContext) {
  const apiKey = process.env.OPENAI_API_KEY;
  const url = "https://api.openai.com/v1/chat/completions";

  const headers = {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json'
  };

  const payload = {
    model: "gpt-4",
    messages: [
      { role: "system", content: `You are a language tutor named Juliana from Natural Languages Academy. You help clients practice and improve their language skills. Identify the language context and respond accordingly, providing corrections and engaging in conversations on any topic. Use the appropriate language tone and structure to match the client's proficiency and needs.` },
      { role: "user", content: prompt }
    ]
  };

  try {
    const response = await axios.post(url, payload, { headers });
    return response.data.choices[0].message.content.trim();
  } catch (error) {
    console.error("Error obtaining response from GPT-4:", error);
    return "Error obtaining the response";
  }
}

async function processLanguageConversation(io, senderId, message, conversationId, currentState) {
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
  const customerName = firstName ? `${firstName} ${lastName || ''}` : 'Client';

  let prompt;
  if (currentState === 'new') {
    prompt = `Este primer mensaje respondelo en español, presentate y pregunta el idioma que el estudiante quiere practicar, algo similar al siguiente mensaje "Hola ${customerName}, soy Juliana de Natural Languages Academy. Estoy aquí para asistirte en la práctica de cualquier idioma. ¿Cuál idioma te gustaría practicar hoy?"`;
    await updateConversationState(conversationId, 'waiting_language');
  } else if (currentState === 'waiting_language') {
    const selectedLanguage = message; // Assume the message contains the language they want to practice
    prompt = `Great! Let's practice ${selectedLanguage}. What would you like to talk about today?`;
    await updateConversationState(conversationId, 'active');
  } else {
    prompt = `Here are the last messages from the client:\n${lastMessages.join('\n')}\nPlease respond politely and professionally, keeping the conversation flowing naturally. Correct any mistakes and engage in a conversation on the given topics.`;
  }

  const responseText = await obtenerRespuestaGPT(prompt);

  await sendWhatsAppMessage(io, senderId, responseText, conversationId);
}

// Utility to get contact information
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

// Utility to update the conversation state
async function updateConversationState(conversationId, newState) {
  const query = 'UPDATE conversations SET state = $2 WHERE conversation_id = $1';
  try {
    await pool.query(query, [conversationId, newState]);
  } catch (error) {
    console.error('Database error updating conversation state:', error);
    throw error;
  }
}

export { processLanguageConversation };
