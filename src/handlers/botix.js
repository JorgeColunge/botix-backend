import axios from 'axios';
import pool from '../config/dbConfig.js';

const token = process.env.WHATSAPP_API_TOKEN;
const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
const apiKey_openai = process.env.OPENAI_API_KEY;

const estados = {
  'new': ['saludar', 'agendar_cita', 'consultar_servicios'],
  'saludar': ['agendar_cita', 'consultar_servicios'],
  'agendar_cita': ['consultar_disponibilidad', 'confirmar_cita'],
  'consultar_servicios': ['consultar_valor', 'confirmar_cita'],
  'confirmar_cita': []
};

async function obtenerIntencion(prompt) {
  const url = "https://api.openai.com/v1/chat/completions";
  console.log(`La ApiKey es: ${apiKey_openai}`);

  const headers = {
    'Authorization': `Bearer ${apiKey_openai}`,
    'Content-Type': 'application/json'
  };

  const payload = {
    model: "gpt-4",
    messages: [
      {role: "system", content: "Eres un bot para identificar intenciones, tu función es responder solo el numero de la intención que identificas en el mensaje"},
      {role: "user", content: prompt}
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

async function obtenerRespuesta(prompt) {
  const url = "https://api.openai.com/v1/chat/completions";
  console.log(`La ApiKey es: ${apiKey_openai}`);

  const headers = {
    'Authorization': `Bearer ${apiKey_openai}`,
    'Content-Type': 'application/json'
  };

  const payload = {
    model: "gpt-4",
    messages: [
      {role: "system", content: "Eres Lia la asistente virtual de Axioma Robotics y tu función es responder de forma amable a los clientes, usas emóticones para hacer más amigable la conversación pero sin saturarla, mantienes respuestas cortas y concisas para responder a la solicitud del cliente, eres una mujer joven y moderna, pero a la vez muy elegante y profesional."},
      {role: "user", content: prompt}
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

async function sendWhatsAppMessage(io, phone, messageText, conversationId) {
  const url = `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`;
  const payload = {
    messaging_product: "whatsapp",
    to: phone,
    type: "text",
    text: { body: messageText }
  };

  try {
    const response = await axios.post(url, payload, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    console.log('WhatsApp message sent:', response.data);
    const whatsappMessageId = response.data.messages[0].id;

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
      whatsappMessageId,
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
    io.emit('newMessage', res.rows[0]);
  } catch (error) {
    console.error('Error:', error.response?.data || error.message || error);
  }
}

async function getContactInfo(phoneNumber) {
  const query = 'SELECT first_name, last_name, organization, id FROM contacts WHERE phone_number = $1';
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

async function updateContactName(io, phoneNumber, firstName, lastName) {
  const query = `
    UPDATE contacts SET 
    first_name = $2, 
    last_name = $3
    WHERE phone_number = $1
    RETURNING *;
  `;
  try {
    const result = await pool.query(query, [phoneNumber, firstName, lastName]);
    const updatedContact = result.rows[0];
    io.emit('contactUpdated', updatedContact); // Emitir la actualización
  } catch (err) {
    console.error('Database error in updateContactName:', err);
    throw err;
  }
}

async function processConversation(io, senderId, message, conversationId, currentState) {
  const messageText = message.text ? message.text.toLowerCase() : "";
  const contactInfo = await getContactInfo(senderId);

  const intencion = await obtenerIntencion(`Responde unica y exclusivamente el numero de esta opciones segun la intención que detectes en el mensaje (1 Saludar, 2 Agendaar cita, 3 Conocer servicios, 4 Solicitar sopote técnico, 5 Hablar con gerencia o Maria Jose, 6 Hablar con ventas o Daniel, 7 Probar nuestros modelos de chatbots). El mensaje es: ${message.text}`);
  let responseText;

  switch (intencion) {
    case "1":
      if(currentState==='new'){
        if(!contactInfo.firstName){
          responseText = await obtenerRespuesta(`Responde algo similar a "¡Hola! 👋 Bienvenido a Axioma Robotics, soy Lia una asistente virtual con Inteligencia Artificial ¿Con quien tengo el gusto de hablar?"`);
          await updateConversationState(conversationId, 'Saludar - esperandoNombre');
        }else{
          responseText = await obtenerRespuesta(`Responde algo similar a "¡Que gusto ${contactInfo.firstName} tenerte de nuevo por aqui! 👋 ¿En que puedo ayudarte el día de hoy?"`);
          await updateConversationState(conversationId, 'Saludar - esperandoIntencion');
        }
      }else if(currentState==='Saludar - esperandoNombre'){
          
        }
      
      break;
    case "2":
    case "3":
    case "4":
    case "5":
    case "6":
    case "7":
      responseText = intencion;
      await updateConversationState(conversationId, 'action_specific_intent');
      break;
    default:
      responseText = "Lo siento, no entendí tu solicitud. ¿Puedes reformularla?";
      break;
  }

  await sendWhatsAppMessage(io, senderId, responseText, conversationId);
}

async function updateConversationState(conversationId, newState) {
  const query = 'UPDATE conversations SET state = $2 WHERE conversation_id = $1';
  try {
      await pool.query(query, [conversationId, newState]);
  } catch (error) {
      console.error('Database error updating conversation state:', error);
      throw error;
  }
}

export { processConversation };
