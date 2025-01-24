import { DataTypes } from 'sequelize';

const defineLicense = (sequelize) => {
    const License = sequelize.define('license', {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        unique: true,
      },
      type: {
        type: DataTypes.STRING(50),
        allowNull: false,
      },
      contacts: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      users: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      ai_messages: {
        type: DataTypes.INTEGER,
      },
      ai_analysis: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      company_id: {
        type: DataTypes.INTEGER,
        allowNull: true,  // Asegúrate de que este campo esté permitido para null si es necesario
        references: {
          model: 'companies', // El nombre de la tabla referenciada
          key: 'id', // La columna que estamos referenciando
        },
        unique: true, 
      },
      integrations: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      automations_crm: {
        type: DataTypes.INTEGER,
      },
      automations_rpa: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      bot_messages: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      status: {
        type: DataTypes.STRING(50),
      },
      transaction_id: {
        type: DataTypes.STRING(200),
      },
    }, {
      tableName: 'licenses',
      freezeTableName: true,
      timestamps: false,
    });
   
    License.associate = (models) => {
        License.belongsTo(models.company, {
          foreignKey: 'company_id',
          as: 'company',
          onDelete: 'CASCADE',
          onUpdate: 'CASCADE',
        });
      };

    return License;
};

  
  export default defineLicense;
  