import express from 'express';
import { register as registerAuth, login as loginAuth, edit, registerUser, registerBot} from '../controllers/authController.js';
import { registerValidation, loginValidation } from '../validations/userValidation.js';
import passport from 'passport';
import '../config/passportConfig.js';
import pool from '../config/dbConfig.js';
import jwt from 'jsonwebtoken';
import axios from 'axios';

const authRoutes = express.Router();

authRoutes.post('/register', registerAuth);

authRoutes.post('/register-user', registerUser);

authRoutes.post('/register-bot', registerBot);

authRoutes.post('/login', (req, res) => {
  const { error } = loginValidation(req.body);
  if (error) return res.status(400).send(error.details[0].message);
  loginAuth(req, res);
});

authRoutes.get('/renew', async (req, res) => {
  const token = req.headers['x-token'];
  
  if (!token) {
      return res.status(401).send('No se proporcionó un token');
  }

  try {
      // Verificar el token actual
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      
      // Consultar el usuario en la base de datos para asegurar que exista
      const userQuery = await pool.query(
          'SELECT * FROM users WHERE id_usuario = $1;',
          [decoded.id_usuario]
      );

      if (userQuery.rows.length === 0) {
          return res.status(404).send('Usuario no encontrado');
      }

      const user = userQuery.rows[0];

      // Generar un nuevo token JWT
      const newToken = jwt.sign(
          { id_usuario: user.id_usuario, email: user.email, rol: user.rol },
          process.env.JWT_SECRET,
          { expiresIn: '1h' }
      );

      const { contraseña: _, ...rest } = user;

      res.status(200).json({
          message: 'Token renovado con éxito',
          token: newToken,
          user: rest
      });
  } catch (err) {
      console.error('Error al renovar el token:', err);
      return res.status(401).send('Token inválido o expirado');
  }
});

//METODOS DE PAYPAL
authRoutes.post("/create-product-paypal", async (req, res) => {
  const { name, description, type, category } = req.body;

  try {
    // Autenticación con PayPal
    const auth = await axios.post(
      `${process.env.PAYPAL_API}/v1/oauth2/token`,
      "grant_type=client_credentials",
      {
        auth: {
          username: process.env.PAYPAL_CLIENT_ID,
          password: process.env.PAYPAL_SECRET,
        },
      }
    );
    const accessToken = auth.data.access_token;

    // Crear producto
    const response = await axios.post(
      `${process.env.PAYPAL_API}/v1/catalogs/products`,
      {
        name,
        description,
        type, // Ejemplo: "SERVICE"
        category, // Ejemplo: "SOFTWARE"
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );
  
    res.json(response.data);
  } catch (error) {
    console.error("Error al crear producto:", error.response?.data || error);
    res.status(500).send("Hubo un problema al crear el producto.");
  }
});

authRoutes.get("/products-paypal", async (req, res) => {
  try {
    // Obtener el token de acceso de PayPal
    const auth = await axios.post(
      `${process.env.PAYPAL_API}/v1/oauth2/token`,
      "grant_type=client_credentials",
      {
        auth: {
          username: process.env.PAYPAL_CLIENT_ID,
          password: process.env.PAYPAL_SECRET,
        },
      }
    );
    const accessToken = auth.data.access_token;

    // Obtener los productos de PayPal
    const productsResponse = await axios.get(
      `${process.env.PAYPAL_API}/v1/catalogs/products`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    // Obtener los planes para cada producto
    const productsWithPlans = await Promise.all(
      productsResponse.data.products.map(async (product) => {
        try {
          const plansResponse = await axios.get(
            `${process.env.PAYPAL_API}/v1/billing/plans`,
            {
              params: { product_id: product.id },
              headers: {
                Authorization: `Bearer ${accessToken}`,
              },
            }
          );
          // Añadir los planes al producto
          return {
            ...product,
            plans: plansResponse.data.plans,
          };
        } catch (planError) {
          console.error(`Error al obtener planes para el producto ${product.id}:`, planError.response?.data || planError);
          return {
            ...product,
            plans: [], 
          };
        }
      })
    );

    // Enviar la respuesta con los productos y sus planes
    res.json(productsWithPlans);
  } catch (error) {
    console.error("Error al obtener productos:", error.response?.data || error);
    res.status(500).send("Hubo un problema al obtener los productos.");
  }
});

authRoutes.post("/create-plan-paypal", async (req, res) => {
  const { product_id, name, description, billing_cycles, payment_preferences, db_licence } = req.body;

  try {
    // Obtener el token de acceso de PayPal
    const auth = await axios.post(
      `${process.env.PAYPAL_API}/v1/oauth2/token`,
      "grant_type=client_credentials",
      {
        auth: {
          username: process.env.PAYPAL_CLIENT_ID,
          password: process.env.PAYPAL_SECRET,
        },
      }
    );
    const accessToken = auth.data.access_token;

    // Preparar los datos para enviar a PayPal
    const billingCyclesFormatted = [
      {
        frequency: {
          interval_unit: billing_cycles.interval_unit, // Ejemplo: "MONTH"
          interval_count: parseInt(billing_cycles.interval_count, 10), // Convertir a número
        },
        pricing_scheme: {
          fixed_price: {
            value: billing_cycles.pricing_value, // Ejemplo: "250"
            currency_code: "USD", // Puedes cambiar la moneda si es necesario
          },
        },
        tenure_type: "REGULAR", // Tipo de tenencia (puedes personalizar según lo que necesites)
        sequence: 1, // El número de secuencia de este ciclo
        total_cycles: parseInt(billing_cycles.total_cycles, 10), // Convertir a número
      },
    ];

    const paymentPreferencesFormatted = {
      auto_bill_outstanding: payment_preferences.auto_bill_outstanding === "yes", // Asegurarse de que sea booleano
      setup_fee: {
        value: payment_preferences.setup_fee.value, // Ejemplo: "10"
        currency_code: payment_preferences.setup_fee.currency_code || "USD", // Asignar moneda, por defecto USD
      },
      setup_fee_failure_action: payment_preferences.setup_fee_failure_action, // Ejemplo: "CONTINUE"
      payment_failure_threshold: parseInt(payment_preferences.payment_failure_threshold, 10), // Convertir a número
    };

    // Llamada a la API de PayPal para crear el plan de facturación
    const response = await axios.post(
      `${process.env.PAYPAL_API}/v1/billing/plans`,
      {
        product_id,
        name,
        description,
        billing_cycles: billingCyclesFormatted, // Ciclos de facturación formateados
        payment_preferences: paymentPreferencesFormatted, // Preferencias de pago formateadas
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );
 
    const id_licence = response.data.id

   let db_licence_db = {
      ...db_licence,
      id_plan_paypal: id_licence
    };
    
    const query = `
    INSERT INTO licenses (
      type, contacts, users, ai_messages, ai_analysis, integrations, automations, bot_messages, id_plan_paypal
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9
    )
    RETURNING id;
  `;

  const values = [
    db_licence_db.type,
    db_licence_db.contacts,
    db_licence_db.users,
    db_licence_db.ai_messages,
    db_licence_db.ai_analysis,
    db_licence_db.integrations,
    db_licence_db.automations,
    db_licence_db.bot_messages,
    db_licence_db.id_plan_paypal,
  ];

    const result = await pool.query(query, values);
    console.log("Licencia insertada con ID:", result.rows[0].id);
 
    // Enviar la respuesta de PayPal de vuelta al frontend
    res.json(response.data);
  } catch (error) {
    console.error("Error al crear plan:", error.response?.data || error);
    res.status(500).send("Hubo un problema al crear el plan.");
  }
});

authRoutes.post("/create-subscription", async (req, res) => {
  const { plan_id } = req.body; // El cliente enviará el ID del plan creado en PayPal

  try {
    // Autenticación con PayPal
    const auth = await axios.post(
      `${process.env.PAYPAL_API}/v1/oauth2/token`,
      "grant_type=client_credentials",
      {
        auth: {
          username: process.env.PAYPAL_CLIENT_ID,
          password: process.env.PAYPAL_SECRET,
        },
      }
    );

    const accessToken = auth.data.access_token;

    // Crear la suscripción
    const response = await axios.post(
      `${process.env.PAYPAL_API}/v1/billing/subscriptions`,
      {
        plan_id: plan_id, // Este ID viene del cliente (se genera en PayPal)
        application_context: {
          brand_name: "Tu Empresa",
          locale: "en-US",
          user_action: "SUBSCRIBE_NOW",
          return_url: "https://tuapp.com/success", // Redirigir a esta URL tras la suscripción
          cancel_url: "https://tuapp.com/cancel", // Redirigir aquí si cancelan
        },
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    // Enviar el link de aprobación al cliente
    const approveLink = response.data.links.find((link) => link.rel === "approve").href;
    res.json({ id: response.data.id, approve_link: approveLink });
  } catch (error) {
    console.error("Error al crear la suscripción:", error.response?.data || error);
    res.status(500).send("Hubo un problema al crear la suscripción.");
  }
});

authRoutes.post("/capture-subscription", async (req, res) => {
  const { subscription_id } = req.body; // ID de la suscripción creada

  try {
    // Autenticación con PayPal
    const auth = await axios.post(
      `${process.env.PAYPAL_API}/v1/oauth2/token`,
      "grant_type=client_credentials",
      {
        auth: {
          username: process.env.PAYPAL_CLIENT_ID,
          password: process.env.PAYPAL_SECRET,
        },
      }
    );

    const accessToken = auth.data.access_token;

    // Obtener detalles de la suscripción
    const response = await axios.get(
      `${process.env.PAYPAL_API}/v1/billing/subscriptions/${subscription_id}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    // Verificar el estado de la suscripción
    if (response.data.status === "ACTIVE") {
      res.json({
        message: "Suscripción activada exitosamente",
        data: response.data,
      });
    } else {
      res.status(400).json({
        message: "La suscripción no está activa",
        data: response.data,
      });
    }
  } catch (error) {
    console.error("Error al capturar la suscripción:", error.response?.data || error);
    res.status(500).send("Hubo un problema al capturar la suscripción.");
  }
});

authRoutes.post("/cancel-subscription", async (req, res) => {
  const { subscription_id } = req.body;

  try {
    // Autenticación con PayPal
    const auth = await axios.post(
      `${process.env.PAYPAL_API}/v1/oauth2/token`,
      "grant_type=client_credentials",
      {
        auth: {
          username: process.env.PAYPAL_CLIENT_ID,
          password: process.env.PAYPAL_SECRET,
        },
      }
    );

    const accessToken = auth.data.access_token;

    // Cancelar la suscripción
    await axios.post(
      `${process.env.PAYPAL_API}/v1/billing/subscriptions/${subscription_id}/cancel`,
      { reason: "Cancelación solicitada por el cliente." },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    res.json({ message: "Suscripción cancelada exitosamente." });
  } catch (error) {
    console.error("Error al cancelar la suscripción:", error.response?.data || error);
    res.status(500).send("Hubo un problema al cancelar la suscripción.");
  }
});
//FIN DE METODOS DE PAYPAL

authRoutes.get('/get_token_firebase', async (req, res) => {
  const { id_usuario } = req.query; // Cambiado de req.params a req.query
  console.log("id de usuario", id_usuario)
  try {
      const result = await pool.query('SELECT token_firebase FROM users WHERE id_usuario = $1', [id_usuario]);
      if (result.rows.length > 0) {
          res.json(result.rows[0].token_firebase);
      } else {
          res.status(400).send('Usuario no encontrado');
      }
  } catch (error) {
      console.error('Error al obtener token de firebase:', error);
      res.status(500).send('Internal Server Error');
  }
});

authRoutes.post('/set_token_firebase', async (req, res) => {
  const { id_usuario, token } = req.body; // Obtener el id_usuario y el token del cuerpo de la solicitud

  console.log("id de usuario", id_usuario);
  console.log("token", token); // Opcional: Para depuración
 
  console.log("informacion del body", req.body)
  try {
      // Verificar si el usuario existe
      const userResult = await pool.query('SELECT * FROM users WHERE id_usuario = $1', [id_usuario]);

      if (userResult.rows.length === 0) {
          return res.status(400).send('Usuario no encontrado'); // Usuario no existe
      }

      // Actualizar el token_firebase del usuario
      await pool.query('UPDATE users SET token_firebase = $1 WHERE id_usuario = $2', [token, id_usuario]);

      res.status(200).send('Token de Firebase actualizado correctamente'); // Confirmación de éxito
  } catch (error) {
      console.error('Error al actualizar el token de firebase:', error);
      res.status(500).send('Internal Server Error'); // Manejo de errores
  }
});

// Ruta para actualizar un usuario
authRoutes.put('/users/:id', (req, res) => {
  const { error } = registerValidation(req.body);
  if (error) return res.status(400).send(error.details[0].message);
  edit(req, res);
});

// Ruta para autenticación con Google
authRoutes.get('/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

// Callback de Google
authRoutes.get('/google/callback', passport.authenticate('google', { failureRedirect: '/' }),
  (req, res) => {
    res.redirect('/home');
  }
);

// Ruta para autenticación con Facebook
authRoutes.get('/facebook', passport.authenticate('facebook', { scope: ['email'] }));

// Callback de Facebook
authRoutes.get('/facebook/callback', passport.authenticate('facebook', { failureRedirect: '/' }),
  (req, res) => {
    res.redirect('/home');
  }
);

authRoutes.delete('/deleteToken/:id', async (req, res) => {
  const { id } = req.params;

  try {
    // Verificar si el usuario existe
    const userResult = await pool.query('SELECT * FROM users WHERE id_usuario = $1', [id]);

    if (userResult.rowCount === 0) {
      return res.status(404).json({ message: 'Usuario no encontrado' });
    }

    // Eliminar el firebase_token del usuario
    await pool.query('UPDATE users SET token_firebase = NULL WHERE id_usuario = $1', [id]);

    res.status(200).json({ message: 'Firebase token eliminado con éxito' });
  } catch (error) {
    console.error('Error eliminando el token:', error);
    res.status(500).json({ message: 'Error eliminando el token', error: error.message });
  }
});
export default authRoutes;
