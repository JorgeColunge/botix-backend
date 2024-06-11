import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { Strategy as FacebookStrategy } from 'passport-facebook';
import pool from './dbConfig.js'; // Asegúrate de que este sea el camino correcto

passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: "/auth/google/callback"
},
async (accessToken, refreshToken, profile, done) => {
  try {
    const user = await pool.query('SELECT * FROM users WHERE google_id = $1', [profile.id]);
    if (user.rows.length === 0) {
      // Si el usuario no existe, crear uno nuevo
      const newUser = await pool.query(
        'INSERT INTO users (google_id, nombre, email, link_foto) VALUES ($1, $2, $3, $4) RETURNING *',
        [profile.id, profile.displayName, profile.emails[0].value, profile.photos[0].value]
      );
      return done(null, newUser.rows[0]);
    } else {
      return done(null, user.rows[0]);
    }
  } catch (err) {
    return done(err, false);
  }
}));

passport.use(new FacebookStrategy({
  clientID: process.env.FACEBOOK_CLIENT_ID,
  clientSecret: process.env.FACEBOOK_CLIENT_SECRET,
  callbackURL: "/auth/facebook/callback",
  profileFields: ['id', 'displayName', 'photos', 'email']
},
async (accessToken, refreshToken, profile, done) => {
  try {
    const user = await pool.query('SELECT * FROM users WHERE facebook_id = $1', [profile.id]);
    if (user.rows.length === 0) {
      // Si el usuario no existe, crear uno nuevo
      const newUser = await pool.query(
        'INSERT INTO users (facebook_id, nombre, email, link_foto) VALUES ($1, $2, $3, $4) RETURNING *',
        [profile.id, profile.displayName, profile.emails[0].value, profile.photos[0].value]
      );
      return done(null, newUser.rows[0]);
    } else {
      return done(null, user.rows[0]);
    }
  } catch (err) {
    return done(err, false);
  }
}));

passport.serializeUser((user, done) => {
  done(null, user.id_usuario);
});

passport.deserializeUser(async (id, done) => {
  try {
    const user = await pool.query('SELECT * FROM users WHERE id_usuario = $1', [id]);
    done(null, user.rows[0]);
  } catch (err) {
    done(err, null);
  }
});
