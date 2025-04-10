import { DataTypes } from 'sequelize';

const defineCollaborator = (sequelize) => {
    const collaborator = sequelize.define('colaboradores', {
      id_usuario: {
        type: DataTypes.DOUBLE,
        primaryKey: true,
        autoIncrement: true,
      },
      nombre: {
        type: DataTypes.STRING(100),
        allowNull: false,
      },
      apellido: {
        type: DataTypes.STRING(100),
        allowNull: false,
      },
      telefono: {
        type: DataTypes.STRING(15),
      },
      email: {
        type: DataTypes.STRING(255),
        allowNull: false,
        unique: true,
      },
      link_foto: {
        type: DataTypes.STRING(255),
      },
      type_user_id: {
        type: DataTypes.INTEGER,
        allowNull: true,  // Asegúrate de que este campo esté permitido para null si es necesario
        references: {
          model: 'Type_user', // El nombre de la tabla referenciada
          key: 'id', // La columna que estamos referenciando
        }
      },
      contraseña: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      socket_id: {
        type: DataTypes.STRING(255),
      },
      company_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      department_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      token_firebase: {
        type: DataTypes.STRING(400),
      },
      role: {
        type: DataTypes.INTEGER,
        field: 'role_id', // Renombra el campo en la base de datos
      }
    }, {
      tableName: 'users',
      freezeTableName: true,
      timestamps: false, // Esto evitará la creación de las columnas createdAt y updatedAt
    });
  
    collaborator.associate = (models) => {
      // Relación con Role
      collaborator.belongsTo(models.Role, { foreignKey: 'role', as: 'roleAssociation' });
      
      // Relación muchos a muchos con Privilege
      collaborator.belongsToMany(models.Privilege, {
        through: models.UserPrivileges,
        foreignKey: 'userId',
        otherKey: 'privilegeId',
      });
      // Relación con Type_user
      collaborator.belongsTo(models.Type_user, { 
        foreignKey: 'type_user_id', 
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE'
      });
    }; 
    return collaborator;
};

  
  export default defineCollaborator;
  