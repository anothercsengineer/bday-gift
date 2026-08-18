const fs = require('fs');
const path = require('path');
const NodeID3 = require('node-id3');
const mp3Duration = require('mp3-duration');
const { execSync } = require('child_process');

const publicDir = path.join(__dirname, '../public');
const musicDir = path.join(publicDir, 'music');
const playlistPath = path.join(publicDir, 'playlist.json');

(async () => {
  let playlist = [];
  if (fs.existsSync(playlistPath)) {
    playlist = JSON.parse(fs.readFileSync(playlistPath, 'utf8'));
  }

  // Find the highest existing track ID
  let nextId = 1;
  for (let track of playlist) {
    const idNum = parseInt(track.id, 10);
    if (!isNaN(idNum) && idNum >= nextId) {
      nextId = idNum + 1;
    }
  }

  if (!fs.existsSync(musicDir)) {
    console.error("Music directory not found!");
    process.exit(1);
  }

  const files = fs.readdirSync(musicDir);
  let added = false;

  for (let file of files) {
    if (!file.toLowerCase().endsWith('.mp3')) continue;
    
    // skip already formatted tracks like "track1.mp3", "track2.mp3", etc.
    if (/^track\d+\.mp3$/i.test(file)) continue;

    const oldPath = path.join(musicDir, file);
    const newFilename = `track${nextId}.mp3`;
    const newPath = path.join(musicDir, newFilename);

    console.log(`\nProcessing new track: "${file}"...`);
    
    // Read tags
    const tags = NodeID3.read(oldPath);
    const title = tags.title || file.replace(/\.mp3$/i, '');
    
    // Read duration
    let durationSec = 0;
    try {
      durationSec = Math.round(await mp3Duration(oldPath));
    } catch (e) {
      console.log(`Warning: Could not read duration for ${file}. Defaulting to 0.`);
    }

    // Rename file
    fs.renameSync(oldPath, newPath);
    console.log(`-> Renamed to ${newFilename}`);

    // Add to playlist
    const newTrack = {
      id: nextId.toString(),
      title: title,
      url: `/music/${newFilename}`,
      duration: durationSec,
      cover: "" // will be filled by extract-covers.js
    };

    playlist.push(newTrack);
    added = true;
    nextId++;
  }

  if (added) {
    fs.writeFileSync(playlistPath, JSON.stringify(playlist, null, 4));
    console.log("\nUpdated playlist.json with new tracks!");
    
    // Run extract-covers.js to fetch the album art for the new songs
    console.log("Running extract-covers.js to fetch new album art...\n");
    execSync('node ' + path.join(__dirname, 'extract-covers.js'), { stdio: 'inherit' });
    console.log("\nDone! New tracks are ready to play.");
  } else {
    console.log("No new unformatted tracks found in the music folder.");
  }
})();
