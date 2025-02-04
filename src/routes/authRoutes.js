import express from 'express';
import { RegisterCompany as registerAuth, login as loginAuth, edit, registerUser, registerBot} from '../controllers/authController.js';
import { registerValidation, loginValidation } from '../validations/userValidation.js';
import passport from 'passport';
import '../config/passportConfig.js';
import pool from '../config/dbConfig.js';
import jwt from 'jsonwebtoken';
import axios from 'axios';
import { authorize } from '../middlewares/authorizationMiddleware.js';

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

        const privilegesQuery = `
        SELECT p.name 
        FROM public."Privileges" p
        JOIN public."UserPrivileges" up ON p.id = up."privilegeId"  -- Cambié privilege_id por privilegeId
        WHERE up."userId" = $1;  -- Cambié user_id por userId
      `;

        const roleQuery = `
          SELECT r.name 
          FROM public."role" r
          WHERE r.id = $1;
        `;
        const roleResult = await pool.query(roleQuery, [user.role_id]);
        if (roleResult.rows.length === 0) {
          return res.status(404).send('Rol no encontrado');
        }
        const roleName = roleResult.rows[0].name;
        
      const privilegesResult = await pool.query(privilegesQuery, [user.id_usuario]);
      const privileges = privilegesResult.rows.map(row => row.name);

      // Generar token JWT
      const newToken = jwt.sign(
        { id_usuario: user.id_usuario, email: user.email, rol: roleName, privileges },
        process.env.JWT_SECRET, // Asegúrate de tener esta variable en tu archivo .env
        { expiresIn: '12h' } // Configuración de expiración
      );

      const { contraseña: _, ...rest } = user;

      res.status(200).json({
          message: 'Token renovado con éxito',
          token: newToken,
          user: {...rest, privileges},
      });
  } catch (err) {
      console.error('Error al renovar el token:', err);
      return res.status(401).send('Token inválido o expirado');
  }
});

//METODOS DE PAYPAL
authRoutes.post("/create-product-paypal", 
  authorize(['SUPERADMIN'], []),
  async (req, res) => {
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

authRoutes.get("/products-paypal", 
  authorize(['SUPERADMIN'], []),
  async (req, res) => {
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
          interval_unit: billing_cycles.interval_unit || "MONTH", // Predeterminado a "MONTH"
          interval_count: parseInt(billing_cycles.interval_count, 10) || 1, // Predeterminado a 1
        },
        pricing_scheme: {
          fixed_price: {
            value: parseFloat(billing_cycles.pricing_value) > 0 ? parseFloat(billing_cycles.pricing_value).toFixed(2) : "1.00", // Asegura que el valor sea mayor a 0
            currency_code: billing_cycles.currency_code || "USD", // Predeterminado a "USD"
          },
        },
        tenure_type: "REGULAR", // Tipo de tenencia
        sequence: 1, // Número de secuencia
        total_cycles: parseInt(billing_cycles.total_cycles, 10) || 0, // Predeterminado a 0
      },
    ];
    
    // Validación adicional antes de enviar
    if (parseFloat(billing_cycles.pricing_value) <= 0 || isNaN(billing_cycles.pricing_value)) {
      throw new Error("El valor de pricing_value debe ser mayor a 0.");
    }
       

    const paymentPreferencesFormatted = {
      auto_bill_outstanding: payment_preferences.auto_bill_outstanding === "yes", // Asegurarse de que sea booleano
      setup_fee: {
        value: payment_preferences.setup_fee.value && !isNaN(payment_preferences.setup_fee.value) ? payment_preferences.setup_fee.value : "0", // Validación de setup_fee
        currency_code: payment_preferences.setup_fee.currency_code || "USD", // Asignar moneda, por defecto USD
      },
      setup_fee_failure_action: payment_preferences.setup_fee_failure_action || "CONTINUE", // Asegúrate de que setup_fee_failure_action tenga un valor
      payment_failure_threshold: payment_preferences.payment_failure_threshold && !isNaN(payment_preferences.payment_failure_threshold) ? parseInt(payment_preferences.payment_failure_threshold, 10) : 1, // Predeterminado a 1
    
      // Agregar el campo adicional para el cargo extra
      additional_fee: payment_preferences.additional_fee ? {
        value: payment_preferences.additional_fee.value && !isNaN(payment_preferences.additional_fee.value) ? payment_preferences.additional_fee.value : "0", // Validación de value
        currency_code: payment_preferences.additional_fee.currency_code || "USD", // Moneda, predeterminado a USD si no se pasa
      } : undefined, // Si no se pasa additional_fee, se asigna undefined
    };
    
    console.log("Datos a enviar",JSON.stringify({
      product_id,
      name,
      description,
      billing_cycles: billingCyclesFormatted, // Ciclos de facturación formateados
      payment_preferences: paymentPreferencesFormatted, // Preferencias de pago formateadas
    }, null, 2))
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
    INSERT INTO plans (
      plan_nombre, contactos, usuarios, integraciones, integracion_web, automatizaciones_crm, automatizaciones_rpa, id_paypal, ia_precio, precio
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
    )
    RETURNING id;
  `;

  const values = [
    db_licence_db.name,
    db_licence_db.contacts,
    db_licence_db.users,
    db_licence_db.integrations,
    db_licence_db.integracion_web,
    db_licence_db.automatizaciones_crm,
    db_licence_db.automatizaciones_rpa,
    db_licence_db.id_plan_paypal,
    db_licence_db.ia_precio,
    db_licence_db.precio,
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
//No proteger
authRoutes.post("/create-plan-paypal-personalized", async (req, res) => {
  const { name, billing_cycles, payment_preferences, old_id_paypal } = req.body;

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

    const planResponse = await axios.get(
      `${process.env.PAYPAL_API}/v1/billing/plans/${old_id_paypal}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    // Paso 3: Extraer el product_id
    const product_id = planResponse.data.product_id;

    // Preparar los datos para enviar a PayPal
    const billingCyclesFormatted = [
      {
        frequency: {
          interval_unit: billing_cycles.interval_unit || "MONTH", // Predeterminado a "MONTH"
          interval_count: parseInt(billing_cycles.interval_count, 10) || 1, // Predeterminado a 1
        },
        pricing_scheme: {
          fixed_price: {
            value: parseFloat(billing_cycles.pricing_value) > 0 ? parseFloat(billing_cycles.pricing_value).toFixed(2) : "1.00", // Asegura que el valor sea mayor a 0
            currency_code: billing_cycles.currency_code || "USD", // Predeterminado a "USD"
          },
        },
        tenure_type: "REGULAR", // Tipo de tenencia
        sequence: 1, // Número de secuencia
        total_cycles: parseInt(billing_cycles.total_cycles, 10) || 0, // Predeterminado a 0
      },
    ];
    
    // Validación adicional antes de enviar
    if (parseFloat(billing_cycles.pricing_value) <= 0 || isNaN(billing_cycles.pricing_value)) {
      throw new Error("El valor de pricing_value debe ser mayor a 0.");
    }
       

    const paymentPreferencesFormatted = {
      auto_bill_outstanding: payment_preferences.auto_bill_outstanding === "yes", // Asegurarse de que sea booleano
      setup_fee: {
        value: payment_preferences.setup_fee.value && !isNaN(payment_preferences.setup_fee.value) ? payment_preferences.setup_fee.value : "0", // Validación de setup_fee
        currency_code: payment_preferences.setup_fee.currency_code || "USD", // Asignar moneda, por defecto USD
      },
      setup_fee_failure_action: payment_preferences.setup_fee_failure_action || "CONTINUE", // Asegúrate de que setup_fee_failure_action tenga un valor
      payment_failure_threshold: payment_preferences.payment_failure_threshold && !isNaN(payment_preferences.payment_failure_threshold) ? parseInt(payment_preferences.payment_failure_threshold, 10) : 1, // Predeterminado a 1
    
      // Agregar el campo adicional para el cargo extra
      additional_fee: payment_preferences.additional_fee ? {
        value: payment_preferences.additional_fee.value && !isNaN(payment_preferences.additional_fee.value) ? payment_preferences.additional_fee.value : "0", // Validación de value
        currency_code: payment_preferences.additional_fee.currency_code || "USD", // Moneda, predeterminado a USD si no se pasa
      } : undefined, // Si no se pasa additional_fee, se asigna undefined
    };

    // Llamada a la API de PayPal para crear el plan de facturación
    const response = await axios.post(
      `${process.env.PAYPAL_API}/v1/billing/plans`,
      {
        product_id,
        name,
        description: name,
        billing_cycles: billingCyclesFormatted, // Ciclos de facturación formateados
        payment_preferences: paymentPreferencesFormatted, // Preferencias de pago formateadas
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );
 
    // Enviar la respuesta de PayPal de vuelta al frontend
    res.json(response.data);
  } catch (error) {
    console.error("Error al crear plan:", error.response?.data || error);
    res.status(500).send("Hubo un problema al crear el plan.");
  }
});
//No proteger
authRoutes.post("/create-subscription", async (req, res) => {
  const { plan_id } = req.body; 

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
          brand_name: "AXIOMA ROBOTICS",
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
//No proteger
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
//No proteger
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
//No proteger
authRoutes.get('/get_plans', async (req, res) => {
  try {
    const query = 'SELECT * FROM plans';
    const result = await pool.query(query);

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching planes:', error);
    res.status(500).send('Internal Server Error', error);
  }
})
//METODOS DE PLANES

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
authRoutes.put('/users/:id',
  authorize(['ADMIN', 'SUPERADMIN'], ['USER_UPDATE', 'CONFIG']),
 async (req, res) => {
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

authRoutes.delete('/deleteToken/:id', 
  authorize(['ADMIN', 'SUPERADMIN'], ['USER_UPDATE', 'CONFIG']),
  async (req, res) => {
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
