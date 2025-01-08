import dotenv from 'dotenv';
import 'dotenv/config';
import pg from 'pg';

dotenv.config();
const { Pool } = pg;

// Imprimir las variables de entorno utilizadas para la conexión a la base de datos
console.log({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASS,
  port: process.env.DB_PORT,
});

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASS,
  port: process.env.DB_PORT,
  dialect: 'postgres',
});

export default pool;
