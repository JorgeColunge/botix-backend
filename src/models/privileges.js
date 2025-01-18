import { DataTypes } from 'sequelize';

const definePrivilege = (sequelize) => {
    const Privilege = sequelize.define('Privilege', {
      id: {
        type: DataTypes.BIGINT,
        autoIncrement: true,
        primaryKey: true,
      },
      name: {
        type: DataTypes.STRING(500),
        allowNull: false,
        unique: true,
      },
      description: {
        type: DataTypes.STRING(500),
        allowNull: false,
      },
      createdAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      updatedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    });

    Privilege.associate = (models) => {
        Privilege.belongsToMany(models.User, {
          through: models.UserPrivileges,
          foreignKey: 'privilegeId',
          otherKey: 'userId',
        });
      };      
  
    return Privilege;
  };
  
  export default definePrivilege;
  