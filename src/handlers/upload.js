import multer from 'multer';
import path from 'path';

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'public/images'); // Asegúrate de que este directorio exista
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname)); // Nombra el archivo con un timestamp para evitar nombres duplicados
  }
});

const upload = multer({ storage: storage });

export default upload;