import Sequelize from 'sequelize';
import pool from '../config/dbConfig.js'; // Importa `pool` de `dbConfig.js`
import defineRole from './role.js';
import definePrivilege from './privileges.js';
import defineUser from './users.js';
import defineUserPrivileges from './userPrivileges.js';

// Extraer las configuraciones de conexión desde el pool
const config = {
  username: pool.options.user,
  password: pool.options.password,
  database: pool.options.database,
  host: pool.options.host,
  port: pool.options.port,
  dialect: 'postgres', // Configuración necesaria para Sequelize
};

const sequelize = new Sequelize(config.database, config.username, config.password, config);

const db = {};

// Definir los modelos
db.Role = defineRole(sequelize);
db.Privilege = definePrivilege(sequelize);
db.User = defineUser(sequelize);
db.UserPrivileges = defineUserPrivileges(sequelize);

// Asociaciones
Object.values(db).forEach((model) => {
  if (model.associate) {
    model.associate(db);
  }
});

// Agregar Sequelize y la conexión al objeto `db`
db.sequelize = sequelize;
db.Sequelize = Sequelize;

export default db;
