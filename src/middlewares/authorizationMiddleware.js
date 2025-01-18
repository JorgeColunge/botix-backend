import jwt from 'jsonwebtoken';
import pool from '../config/dbConfig.js';

// Asegúrate de importar correctamente la conexión a tu base de datos.

export const authorize = (allowedRoles = [], allowedPrivileges = []) => {
    return async (req, res, next) => {
      const token = req.headers['x-token'];
      if (!token) {
        return res.status(401).send('No se proporcionó un token válido');
      }
  
      try {
        // Verificar y decodificar el token JWT
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
  
        // Validar rol primero
        if (allowedRoles.length && !allowedRoles.includes(decoded.rol)) {
          // Si el rol no es válido, entonces validamos los privilegios
          if (allowedPrivileges.length) {
            const privilegesQuery = `
              SELECT p.name 
              FROM public."Privileges" p
              JOIN public."UserPrivileges" up ON p.id = up."privilegeId"
              WHERE up."userId" = $1;
            `;
            const { rows } = await pool.query(privilegesQuery, [decoded.id_usuario]);
  
            const userPrivileges = rows.map(row => row.name);
  
            console.log("privilegios:", userPrivileges)
            // Verificar si el usuario tiene al menos uno de los privilegios requeridos
            const hasRequiredPrivilege = allowedPrivileges.some(privilege =>
              userPrivileges.includes(privilege)
            );
  
            if (!hasRequiredPrivilege) {
              return res.status(403).send('Acceso denegado: Privilegios insuficientes');
            }
          }          
        }
  
        // Si el rol es válido, pasamos directamente al siguiente middleware
        req.user = decoded;
  
        // Validación de privilegios solo se realiza si el rol no es válido
        next();
  
      } catch (err) {
        console.error(err);
        return res.status(401).send('Token inválido o expirado');
      }
    };
  };
  