import fetch from 'node-fetch';
import fs from 'fs/promises';
import path from 'path';
 
async function downloadMedia(mediaId, accessToken) {
    const url = `https://graph.facebook.com/v13.0/${mediaId}?access_token=${accessToken}`;

    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to download media: ${response.statusText}`);
    }
    const data = await response.json();
    if (!data.url) {
        throw new Error('URL not found in media response');
    }

    const mediaUrl = data.url;
    const filename = path.basename(new URL(mediaUrl).pathname);
    const filepath = path.join('public', 'images', filename);

    const mediaResponse = await fetch(mediaUrl);
    const mediaBuffer = await mediaResponse.arrayBuffer();
    await fs.writeFile(filepath, Buffer.from(mediaBuffer));

    // Aquí devolvemos la ruta donde se guardó el archivo para almacenarla en la base de datos
    return path.join('images', filename);
}

export { downloadMedia };
