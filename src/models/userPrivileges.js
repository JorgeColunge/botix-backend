import { DataTypes } from 'sequelize';

const defineUserPrivileges = (sequelize) => {
    const UserPrivileges = sequelize.define('UserPrivileges', {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      userId: {
        type: DataTypes.BIGINT,
        allowNull: false,
        references: {
          model: 'users',
          key: 'id_usuario',
        },
      },
      privilegeId: {
        type: DataTypes.BIGINT,
        allowNull: false,
        references: {
          model: 'Privileges',
          key: 'id',
        },
      },
    });
  
    return UserPrivileges;
  };
  
  export default defineUserPrivileges;
  