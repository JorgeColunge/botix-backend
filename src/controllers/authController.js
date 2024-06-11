import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import pool from '../config/dbConfig.js';

// Función para registrar un nuevo usuario
export const register = async (req, res) => {
    const { id_usuario, nombre, apellido, telefono, email, link_foto, rol, contraseña, socket_id, company_id, department_id } = req.body;
    try {
      const userExists = await pool.query('SELECT * FROM users WHERE id_usuario = $1;', [id_usuario]);
      if (userExists.rows.length > 0) {
        return res.status(409).send('El ID de usuario ya está registrado.');
      }
  
      const salt = await bcrypt.genSalt(10);
      const contraseñaHash = await bcrypt.hash(contraseña, salt);
  
      await pool.query(
        'INSERT INTO users (id_usuario, nombre, apellido, telefono, email, link_foto, rol, contraseña, socket_id, company_id, department_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11);',
        [id_usuario, nombre, apellido, telefono, email, link_foto, rol, contraseñaHash, socket_id, company_id, department_id]
      );
  
      res.status(201).json({ message: "Usuario creado", nombre });
    } catch (err) {
      console.error(err);
      res.status(500).send('Error al registrar al usuario: ' + err.message);
    }
};

// Función para iniciar sesión
export const login = async (req, res) => {
  const { email, contraseña } = req.body;
  if (!email || !contraseña) {
    return res.status(400).send('Se requieren el correo electrónico y la contraseña');
  }

  try {
    const userQuery = await pool.query(
      'SELECT * FROM users WHERE email = $1;',
      [email]
    );

    if (userQuery.rows.length === 0) {
      return res.status(404).send('Usuario no encontrado');
    }

    const user = userQuery.rows[0];
    const validPassword = await bcrypt.compare(contraseña, user.contraseña);
    if (!validPassword) {
      return res.status(401).send('Contraseña incorrecta');
    }

    // Generar el token JWT
    const token = jwt.sign(
      { id_usuario: user.id_usuario, email: user.email, rol: user.rol },
      process.env.JWT_SECRET, // Debe ser una variable de entorno segura
      { expiresIn: '1h' } // El token expirará en 1 hora
    );

    res.status(200).json({
      message: "Inicio de sesión exitoso",
      token,
      user: user
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error al iniciar sesión');
  }
};

// Función para editar usuario
export const edit = async (req, res) => {
  const { id } = req.params;
  const { nombre, apellido, telefono, email, link_foto, rol, department_id, contraseña } = req.body;

  try {
    // Construir la consulta de actualización
    const updateFields = [];
    const updateValues = [];
    let index = 1;

    if (nombre) {
      updateFields.push(`nombre = $${index++}`);
      updateValues.push(nombre);
    }
    if (apellido) {
      updateFields.push(`apellido = $${index++}`);
      updateValues.push(apellido);
    }
    if (telefono) {
      updateFields.push(`telefono = $${index++}`);
      updateValues.push(telefono);
    }
    if (email) {
      updateFields.push(`email = $${index++}`);
      updateValues.push(email);
    }
    if (link_foto) {
      updateFields.push(`link_foto = $${index++}`);
      updateValues.push(link_foto);
    }
    if (rol) {
      updateFields.push(`rol = $${index++}`);
      updateValues.push(rol);
    }
    if (department_id) {
      updateFields.push(`department_id = $${index++}`);
      updateValues.push(department_id);
    }
    if (contraseña) {
      const hashedPassword = await bcrypt.hash(contraseña, 10);
      updateFields.push(`contraseña = $${index++}`);
      updateValues.push(hashedPassword);
    }

    updateValues.push(id);

    const updateQuery = `
      UPDATE users
      SET ${updateFields.join(', ')}
      WHERE id_usuario = $${index}
      RETURNING *;
    `;

    const result = await pool.query(updateQuery, updateValues);
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating user data:', error);
    res.status(500).send('Internal Server Error');
  }
};

