import { DataTypes } from 'sequelize';

const definePlans = (sequelize) => {
    const Plans = sequelize.define('plans', {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      plan_nombre: {
        type: DataTypes.STRING(100),
        allowNull: false,
      },
      usuarios: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      integraciones: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      contactos: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      precio: {
        type: DataTypes.BIGINT,
        allowNull: true,
      },
      ia_precio: {
        type: DataTypes.BIGINT,
        allowNull: true,
      },
      id_paypal: {
        type: DataTypes.STRING(300),
        allowNull: true,
      },
      automatizaciones_crm: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      automatizaciones_rpa: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      integracion_web: {
        type: DataTypes.BOOLEAN,
        allowNull: true,
      },
    },
    {
        tableName: 'plans',
        freezeTableName: true,
        timestamps: false,
      }
);
    
  
    return Plans;
  };
  
  export default definePlans;
  