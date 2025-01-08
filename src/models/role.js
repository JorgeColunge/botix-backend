import { DataTypes } from 'sequelize';

const defineRole = (sequelize) => {
    const Role = sequelize.define('Role', {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      name: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true, // Para asegurarnos de que no haya duplicados
      },
    }, 
    {
      tableName: 'role',
      freezeTableName: true,
      timestamps: false, // Esto evitará la creación de las columnas createdAt y updatedAt
    });
  
    Role.associate = (models) => {
      Role.hasMany(models.User, { foreignKey: 'role', as: 'users' });
    };  
  
    return Role;
  };
  
  export default defineRole;
  