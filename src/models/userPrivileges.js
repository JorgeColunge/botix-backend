import { DataTypes } from 'sequelize';

const defineUserPrivileges = (sequelize) => {
    const UserPrivileges = sequelize.define('UserPrivileges', {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      userId: {
        type: DataTypes.DOUBLE,
        allowNull: false,
        references: {
          model: 'users',
          key: 'id',
        },
      },
      privilegeId: {
        type: DataTypes.INTEGER,
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
  