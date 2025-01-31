import Sequelize from 'sequelize';
import pool from '../config/dbConfig.js'; 
import defineRole from './role.js';
import definePrivilege from './privileges.js';
import defineUser from './users.js';
import defineUserPrivileges from './userPrivileges.js';
import defineTypeUser from './typeUser.js';
import defineCompanies from './companies.js';
import defineLicense from './license.js';
import definePlans from './Plans.js';

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
db.Type_user = defineTypeUser(sequelize);
db.company = defineCompanies(sequelize);
db.license = defineLicense(sequelize);
db.plans = definePlans(sequelize);

// Asociaciones
Object.values(db).forEach((model) => {
  if (model.associate) {
    model.associate(db);
  }
});

// Agregar Sequelize y la conexión al objeto `db`
db.sequelize = sequelize;

export default db;
