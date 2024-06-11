import ffmpeg from 'fluent-ffmpeg';
import path from 'path';
import fs from 'fs';

export const createThumbnail = (videoPath) => new Promise((resolve, reject) => {
  const thumbnailFilename = `thumbnail-${path.basename(videoPath, path.extname(videoPath))}.png`;
  const thumbnailDir = path.join(__dirname, '..', 'public', 'thumbnails');

  if (!fs.existsSync(thumbnailDir)) {
    fs.mkdirSync(thumbnailDir, { recursive: true });
  }

  const thumbnailPath = path.join(thumbnailDir, thumbnailFilename);

  ffmpeg(videoPath)
    .on('end', () => resolve(`/thumbnails/${thumbnailFilename}`))
    .on('error', reject)
    .screenshots({
      timestamps: ['50%'],
      filename: thumbnailFilename,
      folder: thumbnailDir,
      size: '320x240'
    });
});