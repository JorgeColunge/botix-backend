import express from 'express';
import { register as registerAuth, login as loginAuth, edit, registerUser, registerBot} from '../controllers/authController.js';
import { registerValidation, loginValidation } from '../validations/userValidation.js';
import passport from 'passport';
import '../config/passportConfig.js';
import pool from '../config/dbConfig.js';
// import pool from '../config/dbConfig.js';

const router = express.Router();

router.post('/register', registerAuth);

router.post('/register-user', registerUser);

router.post('/register-bot', registerBot);

router.post('/login', (req, res) => {
  const { error } = loginValidation(req.body);
  if (error) return res.status(400).send(error.details[0].message);
  loginAuth(req, res);
});

router.get('/get_token_firebase', async (req, res) => {
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

router.post('/set_token_firebase', async (req, res) => {
  const { id_usuario, token } = req.body; // Obtener el id_usuario y el token del cuerpo de la solicitud

  console.log("id de usuario", id_usuario);
  console.log("token", token); // Opcional: Para depuración

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
router.put('/users/:id', (req, res) => {
  const { error } = registerValidation(req.body);
  if (error) return res.status(400).send(error.details[0].message);
  edit(req, res);
});

// Ruta para autenticación con Google
router.get('/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

// Callback de Google
router.get('/google/callback', passport.authenticate('google', { failureRedirect: '/' }),
  (req, res) => {
    res.redirect('/home');
  }
);

// Ruta para autenticación con Facebook
router.get('/facebook', passport.authenticate('facebook', { scope: ['email'] }));

// Callback de Facebook
router.get('/facebook/callback', passport.authenticate('facebook', { failureRedirect: '/' }),
  (req, res) => {
    res.redirect('/home');
  }
);

export default router;
