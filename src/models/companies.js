import { DataTypes } from 'sequelize';

const defineCompanies = (sequelize) => {
    const Company = sequelize.define('companies', {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        unique: true,
      },
      name: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      document_type: {
        type: DataTypes.STRING(50),
        allowNull: false,
      },
      document_number: {
        type: DataTypes.STRING(50),
        allowNull: false,
      },
      andress: {
        type: DataTypes.STRING(255),
      },
      city: {
        type: DataTypes.STRING(100),
        allowNull: true,
        unique: false,
      },
      country: {
        type: DataTypes.STRING(100),
        allowNull: true,
        unique: false,
      },
      postal_code: {
        type: DataTypes.STRING(20),
        unique: false,
      },
      email: {
        type: DataTypes.STRING(100),
        allowNull: true,
        unique: false,
      },
      phone: {
        type: DataTypes.STRING(100),
        allowNull: false,
      },
      logo: {
        type: DataTypes.STRING(100),
      },
      web: {
        type: DataTypes.STRING(255),
      },
      instagram: {
        type: DataTypes.STRING(255),
      },
      facebook: {
        type: DataTypes.STRING(255),
      },
      twitter: {
        type: DataTypes.STRING(255),
      },
      linkedin: {
        type: DataTypes.STRING(255),
      },
      tictok: {
        type: DataTypes.STRING(255),
      },
      youtube: {
        type: DataTypes.STRING(255),
      },
    },
     {
      tableName: 'companies',
      freezeTableName: true,
      timestamps: false, // Esto evitará la creación de las columnas createdAt y updatedAt
    });
   
      // Definir las asociaciones
  Company.associate = (models) => {
    Company.hasOne(models.license, {
      foreignKey: 'company_id',
      as: 'license',
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    });
  };

    return Company;
};

  
  export default defineCompanies;
  