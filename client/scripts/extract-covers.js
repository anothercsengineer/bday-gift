const fs = require('fs');
const path = require('path');
const NodeID3 = require('node-id3');

const publicDir = path.join(__dirname, '../public');
const imagesDir = path.join(publicDir, 'images');
const playlistPath = path.join(publicDir, 'playlist.json');

if (!fs.existsSync(imagesDir)) {
  fs.mkdirSync(imagesDir);
}

let playlist = JSON.parse(fs.readFileSync(playlistPath, 'utf8'));

let updated = false;

for (let track of playlist) {
  if (!track.url.endsWith('.mp3')) continue;

  const mp3Path = path.join(publicDir, track.url);
  if (!fs.existsSync(mp3Path)) {
    console.log(`File not found: ${mp3Path}`);
    continue;
  }

  const tags = NodeID3.read(mp3Path);
  
  if (tags.image && tags.image.imageBuffer) {
    const ext = tags.image.mime === 'image/png' ? 'png' : 'jpg';
    const coverFilename = `cover${track.id}.${ext}`;
    const coverPath = path.join(imagesDir, coverFilename);
    
    fs.writeFileSync(coverPath, tags.image.imageBuffer);
    console.log(`Extracted cover for track ${track.title} -> ${coverFilename}`);
    
    track.cover = `/images/${coverFilename}`;
    updated = true;
  } else {
    console.log(`No embedded cover found for track ${track.title}`);
  }
}

if (updated) {
  fs.writeFileSync(playlistPath, JSON.stringify(playlist, null, 4));
  console.log("Updated playlist.json with cover art paths!");
} else {
  console.log("No new covers extracted.");
}
