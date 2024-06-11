import axios from 'axios';
import pool from '../config/dbConfig.js';
import { processMessage } from './messageHandler.js';  // Importar la función processMessage

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


async function updateContactCompany(io, phoneNumber, organization) {
  const query = `
    UPDATE contacts SET 
    organization = $2 
    WHERE phone_number = $1
    RETURNING *;
  `;
  try {
    const result = await pool.query(query, [phoneNumber, organization]);
    const updatedContact = result.rows[0];
    io.emit('contactUpdated', updatedContact); // Emitir la actualización
  } catch (err) {
    console.error('Database error in updateContactCompany:', err);
    throw err;
  }
}


async function createContact(io, phoneNumber, firstName, lastName, organization, label) {
  const query = `
    INSERT INTO contacts (
      phone_number, 
      first_name, 
      last_name, 
      organization,
      label
    ) VALUES ($1, $2, $3, $4, $5)
    RETURNING *;
  `;
  try {
    const result = await pool.query(query, [phoneNumber, firstName, lastName, organization, label]);
    const newContact = result.rows[0];
    io.emit('contactUpdated', newContact); // Emitir la actualización
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

async function processConversationRouter(io, senderId, message, conversationId, currentState) {
  let responseText;
  const messageText = message.text ? message.text.toLowerCase() : "";

  switch (currentState) {
    case 'new':
      const contactInfo = await getContactInfo(senderId);
      if (!contactInfo || !contactInfo.first_name) {
        responseText = "Hola, soy la asistente virtual de Axioma Robotics. Para mí es un placer atenderte y guiarte en esta experiencia de conversaciones con chatbots. Para continuar me gustaría saber con quién tengo el gusto.";
        await sendWhatsAppMessage(io, senderId, responseText, conversationId);
        await updateConversationState(conversationId, 'awaiting_name');
      } else {
        const { first_name, last_name } = contactInfo;
        const nombreCompleto = last_name ? `${first_name} ${last_name}` : first_name;
        responseText = `Hola ${nombreCompleto}, soy la asistente virtual de Axioma Robotics para la prueba de funcionamiento de los Chat Bots.`;
        await sendWhatsAppMessage(io, senderId, responseText, conversationId);
        responseText = `En Axioma robotics tenemos este número para hacer una demostración del funcionamiento de los chatbots que comercializamos. A continuación te explico los ejemplos que tenemos para probar en este momento:\n1. Solicitud de taxis\n2. Hacer domicilios o reservas en un restaurante\n3. Agendar una cita en una estética\n4. Atención al cliente en una academia de idiomas (multilenguaje)`;
        await sendWhatsAppMessage(io, senderId, responseText, conversationId);
        await updateConversationState(conversationId, 'awaiting_selection');
      }
      break;

      case 'awaiting_name':
        const nombreCompleto = await obtenerRespuestaGPT(`Extrae el nombre y apellido de la siguiente respuesta del cliente, responde solo el nombre seguido del apellido ejemplo 'David Muñoz' si solo detectas el nombre solo respondes el nombre 'David': ${messageText}`);
        const [firstName, lastName] = nombreCompleto.split(' ');
        if (firstName) {
          const contactExists = await getContactInfo(senderId);
          if (contactExists) {
            // Actualizar contacto existente
            await updateContactName(io, senderId, firstName, lastName || null);
          } else {
            // Crear nuevo contacto
            await createContact(io, senderId, firstName, lastName || null, null, "Contacto inicial");
          }
          const nombreCompletoCliente = lastName ? `${firstName} ${lastName}` : firstName;
          responseText = `Un gusto ${nombreCompletoCliente}. ¿Perteneces a alguna empresa?`;
          await sendWhatsAppMessage(io, senderId, responseText, conversationId);
          await updateConversationState(conversationId, 'awaiting_organization');
        } else {
          responseText = "No pude entender tu nombre completo. ¿Podrías repetirlo?";
          await sendWhatsAppMessage(io, senderId, responseText, conversationId);
        }
        break;

    case 'awaiting_organization':
      const organizationResponse = await obtenerRespuestaGPT(`Extrae el nombre de la empresa de la siguiente respuesta del cliente, responde solo con el nombre de la empresa o compañia por ejemplo 'Fumiplagax' si el cliente responde 'no' o algo similar haciendo referencia a que no pertenece a ninguna organización solo responde 'no': ${messageText}`);
      
      if (organizationResponse.toLowerCase() !== 'no') {
        await updateContactCompany(io, senderId, organizationResponse);
      }

      responseText = "Gracias. Ahora, por favor, selecciona el chatbot que deseas probar:\n1. Solicitud de taxis\n2. Hacer domicilios o reservas en un restaurante\n3. Agendar una cita en una estética\n4. Atención al cliente en una academia de idiomas (multilenguaje)";
      await sendWhatsAppMessage(io, senderId, responseText, conversationId);
      await updateConversationState(conversationId, 'awaiting_selection');
      break;

    case 'awaiting_selection':
      let chatbotSelection;
      let newResponsibleUserId;
      
      if (messageText.includes('1')) {
        chatbotSelection = 'Has seleccionado el chatbot para solicitud de taxis. ¡Inicia tu experiencia ahora!';
        newResponsibleUserId = 1010;
      } else if (messageText.includes('2')) {
        chatbotSelection = 'Has seleccionado el chatbot para hacer domicilios o reservas en un restaurante. ¡Inicia tu experiencia ahora!';
        newResponsibleUserId = 1012;
      } else if (messageText.includes('3')) {
        chatbotSelection = 'Has seleccionado el chatbot para agendar una cita en una estética. ¡Inicia tu experiencia ahora!';
        newResponsibleUserId = 1013;
      } else if (messageText.includes('4')) {
        chatbotSelection = 'Has seleccionado el chatbot para atención al cliente en una academia de idiomas. ¡Inicia tu experiencia ahora!';
        newResponsibleUserId = 1014;
      } else {
        responseText = "No he podido identificar tu selección. Por favor, selecciona una opción válida:\n1. Solicitud de taxis\n2. Hacer domicilios o reservas en un restaurante\n3. Agendar una cita en una estética\n4. Atención al cliente en una academia de idiomas (multilenguaje)";
        await sendWhatsAppMessage(io, senderId, responseText, conversationId);
        return;
      }

      responseText = chatbotSelection;
      await sendWhatsAppMessage(io, senderId, responseText, conversationId);
      await updateConversationState(conversationId, 'new');
      await assignResponsibleUser(io, conversationId, newResponsibleUserId);

      // Llamar a processMessage para continuar el proceso con cada chatbot
      const messageData = { text: messageText, type: 'text' };
      await processMessage(io, senderId, messageData, newResponsibleUserId, "yes");

      break;

    default:
      responseText = "No se ha reconocido el estado actual de la conversación.";
      await sendWhatsAppMessage(io, senderId, responseText, conversationId);
      break;
  }
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

async function assignResponsibleUser(io, conversationId, newUserId) {
  const query = 'UPDATE conversations SET id_usuario = $2 WHERE conversation_id = $1 RETURNING *;';
  const oldUserId = "1011"; // Ajusta esto según tus necesidades

  try {
    const result = await pool.query(query, [conversationId, newUserId]);
    const updatedConversation = result.rows[0];

    // Emitir el evento para que todos los clientes lo reciban
    io.emit('responsibleChanged', {
      conversationId,
      newUserId,
      updatedConversation
    });

    // Emitir eventos específicos para el nuevo y antiguo responsable
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


async function getOrCreateConversation(phoneNumber) {
  const findQuery = 'SELECT conversation_id FROM conversations WHERE phone_number = $1';
  try {
    let result = await pool.query(findQuery, [phoneNumber]);
    if (result.rows.length > 0) {
      return result.rows[0].conversation_id;
    } else {
      const insertQuery = 'INSERT INTO conversations (phone_number, state, id_usuario) VALUES ($1, $2, $3) RETURNING conversation_id';
      result = await pool.query(insertQuery, [phoneNumber, 'new', 1011]);
      return result.rows[0].conversation_id;
    }
  } catch (err) {
    console.error('Database error in getOrCreateConversation:', err);
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
    console.error('Database error getting conversation state:', error);
    throw error;
  }
}

async function handleNewMessage(io, senderId, messageData) {
  const conversationId = await getOrCreateConversation(senderId);
  const currentState = await getConversationState(conversationId);
  await processConversationRouter(io, senderId, messageData, conversationId, currentState);
}

export { handleNewMessage, sendWhatsAppMessage, processConversationRouter };
