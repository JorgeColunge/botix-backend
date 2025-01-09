import { DataTypes } from 'sequelize';

const defineTypeUser = (sequelize) => {
    const Type_user = sequelize.define('Type_user', {
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
      tableName: 'Type_user', // Especifica el nombre de la tabla
      timestamps: false, // Si no quieres que Sequelize maneje los campos createdAt y updatedAt
    });
  
    Type_user.associate = (models) => {
        Type_user.hasMany(models.User, { foreignKey: 'type_user_id', as: 'users' });
    };  
  
    return Type_user;
  };
  
  export default defineTypeUser;
  