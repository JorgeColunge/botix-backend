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
        key: 'id_usuario',
      },
      onDelete: 'CASCADE', // Eliminar solo la relación si el usuario es eliminado
      onUpdate: 'CASCADE', // Si se actualiza el usuario, actualizar la relación también
    },
    privilegeId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'Privileges',
        key: 'id',
      },
      onDelete: 'RESTRICT', // No se eliminará el privilegio si el usuario se elimina, solo se elimina la relación
      onUpdate: 'CASCADE', // Si se actualiza el privilegio, actualizar la relación también
    },
  });

  return UserPrivileges;
};

export default defineUserPrivileges;
