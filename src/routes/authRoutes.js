import express from 'express';
import { register as registerAuth, login as loginAuth, edit } from '../controllers/authController.js';
import { registerValidation, newRegisterValidation, loginValidation } from '../validations/userValidation.js';
import passport from 'passport';
import '../config/passportConfig.js';

const router = express.Router();

router.post('/register', registerAuth);

router.post('/login', (req, res) => {
  const { error } = loginValidation(req.body);
  if (error) return res.status(400).send(error.details[0].message);
  loginAuth(req, res);
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
