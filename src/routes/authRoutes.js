import express from 'express';
import { register as registerAuth, login as loginAuth, edit, registerUser, registerBot} from '../controllers/authController.js';
import { registerValidation, loginValidation } from '../validations/userValidation.js';
import passport from 'passport';
import '../config/passportConfig.js';
import pool from '../config/dbConfig.js';
// import pool from '../config/dbConfig.js';

const authRoutes = express.Router();

authRoutes.post('/register', registerAuth);

authRoutes.post('/register-user', 
  async(req, res) => {
    const { id_usuario, nombre, apellido, telefono, email, link_foto, rol, contraseña, company_id, department_id } = req.body;
  
    // Validación de los datos de registro
    const { error } = registerValidation(req.body);
    if (error) return res.status(400).send({ error: error.details[0].message });
  
    try {
      // Verificar si el usuario ya existe
      const userExists = await pool.query('SELECT * FROM users WHERE id_usuario = $1;', [id_usuario]);
      if (userExists.rows.length > 0) {
        return res.status(409).send('El ID de usuario ya está registrado.');
      }
  
      // Encriptar la contraseña
      const salt = await bcrypt.genSalt(10);
      const contraseñaHash = await bcrypt.hash(contraseña, salt);
  
      // Crear el usuario con el rol proporcionado
      await pool.query(
        'INSERT INTO users (id_usuario, nombre, apellido, telefono, email, link_foto, rol, contraseña, company_id, department_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10);',
        [id_usuario, nombre, apellido, telefono, email, link_foto, rol, contraseñaHash, company_id, department_id]
      );
  
      res.status(201).json({ message: "Usuario creado exitosamente", nombre });
    } catch (err) {
      console.error(err);
      res.status(500).send('Error al registrar al usuario: ' + err.message);
    }
  }
);

authRoutes.post('/register-bot', registerBot);

authRoutes.post('/login', (req, res) => {
  const { error } = loginValidation(req.body);
  if (error) return res.status(400).send(error.details[0].message);
  loginAuth(req, res);
});

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
