const { spawn } = require('child_process');
const express = require('express');
const fs = require('fs');
const cors = require('cors');
const path = require('path');
const axios = require('axios');

const PORT = 7860;
const app = express();
const baseOutputDir = path.join(__dirname, 'hls_output');
const publicDir = path.join(__dirname, 'public');
// You can have a list of ad videos to cycle through
const adVideos = ['https://files.catbox.moe/hvl1cv.mp4'];
const watermarkText = 'AnitakuX';
const channelsFile = path.join(__dirname, 'channels.json');

// --- Configuration and Initialization ---
app.use(cors());
app.use(express.json());

// In-memory state to manage each channel's process and playlist
const channelProcesses = {};

// Load channels from JSON file or create a default
let channels = {};
try {
  channels = JSON.parse(fs.readFileSync(channelsFile));
} catch (err) {
  // Initialize with default channels if file doesn't exist
  channels = {
    channel1: {
      name: 'Anitaku TV 1',
      playlist: [{ title: 'Lazarus', start: 1, end: 12 }],
    },
    channel2: {
      name: 'Anitaku TV 2',
      playlist: [{ title: 'Eminence in Shadow', start: 1, end: 20 }],
    },
     channel3: {
      name: 'Anitaku TV 3',
      playlist: [{ title: 'Attack on Titan', start: 1, end: 25 }],
    },
    channel4: {
      name: 'Anitaku TV 4',
      playlist: [{ title: 'Demon Slayer', start: 1, end: 26 }],
    },
    channel5: {
      name: 'Anitaku TV 5',
      playlist: [{ title: 'Chained Soldier', start: 1, end: 11 }],
    },
    channel6: {
      name: 'Anitaku TV 6',
      playlist: [{ title: 'Solo Leveling', start: 1, end: 13 }],
    },
  };
  fs.writeFileSync(channelsFile, JSON.stringify(channels, null, 2));
}

// --- Helper Functions ---

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Fetches the direct MP4 link for a given anime episode.
 * @param {string} anime - The title of the anime.
 * @param {number} ep - The episode number.
 * @returns {Promise<string|null>} The MP4 link or null if not found.
 */
async function getEpisodeMp4(anime, ep) {
  try {
    const url = `https://txtorg-anihx.hf.space/api/episode?anime=${encodeURIComponent(anime)}&ep=${ep}`;
    const data = await axios.get(url, { timeout: 10000 }).then(r => r.data);
    const dl = data?.links?.sub?.['360p_download'];
    if (!dl) return null;
    return await axios.get(`https://txtorg-anihx.hf.space/resolvex?url=${dl}`, { timeout: 10000 })
      .then(r => r.data?.mp4Link);
  } catch (error) {
    console.error(`Error fetching MP4 for ${anime} Ep ${ep}:`, error.message);
    return null;
  }
}

/**
 * Starts a persistent FFmpeg process for a channel using the concat protocol.
 * This process reads from a text file listing video URLs and outputs a continuous HLS stream.
 * @param {string} channelId - The ID of the channel.
 * @param {string} playlistFile - Path to the text file for ffmpeg to read from.
 * @param {string} outputDir - The directory to save HLS segments.
 */
function startPersistentFFmpeg(channelId, playlistFile, outputDir) {
  const args = [
    // Use concat protocol to read a list of files seamlessly
    '-f', 'concat',
    '-safe', '0',
    '-protocol_whitelist', 'file,http,https,tcp,tls,crypto',
    '-i', playlistFile,
    
    // Video and audio encoding settings
    '-vf', `drawtext=text='${watermarkText}':fontcolor=white:fontsize=24:x=w-tw-20:y=20`,
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-tune', 'zerolatency',
    '-c:a', 'aac',
    '-b:a', '128k',

    // HLS settings for a live stream
    '-f', 'hls',
    '-hls_time', '4',         // Segment duration
    '-hls_list_size', '10',    // Number of segments in the playlist
    '-hls_flags', 'delete_segments+program_date_time', // Keep playlist clean and add timestamps
    '-hls_segment_type', 'mpegts',
    path.join(outputDir, 'stream.m3u8'),
  ];

  console.log(`🔴 [${channelId}] Starting persistent FFmpeg stream...`);
  const proc = spawn('ffmpeg', args);

  proc.stderr.on('data', d => process.stderr.write(`[FFMPEG ${channelId}] ${d.toString()}`));
  
  proc.on('exit', (code) => {
    console.error(`[${channelId}] FFmpeg process exited with code ${code}. Restarting in 10 seconds...`);
    delete channelProcesses[channelId];
    setTimeout(() => manageChannel(channelId), 10000); // Relaunch management loop on crash
  });

  return proc;
}


/**
 * The core logic loop that manages a channel's stream.
 * It continuously fetches upcoming video URLs, appends them to a playlist file
 * that ffmpeg is reading, creating an endless, seamless stream.
 * @param {string} channelId - The ID of the channel to manage.
 */
async function manageChannel(channelId) {
    console.log(`[${channelId}] Initializing channel manager.`);
    
    // --- State Initialization ---
    const channelOutput = path.join(baseOutputDir, channelId);
    const playlistFile = path.join(channelOutput, 'playlist.txt');

    if (fs.existsSync(channelOutput)) {
        fs.rmSync(channelOutput, { recursive: true, force: true });
    }
    fs.mkdirSync(channelOutput, { recursive: true });
    fs.writeFileSync(playlistFile, ''); // Create empty playlist file

    let { playlist } = JSON.parse(fs.readFileSync(channelsFile))[channelId];
    
    const state = {
        playlistIndex: 0,
        episode: playlist.length > 0 ? playlist[0].start : 1,
        isAdNext: false,
        adIndex: 0,
    };

    // Start the single, persistent ffmpeg process for this channel
    channelProcesses[channelId] = startPersistentFFmpeg(channelId, playlistFile, channelOutput);

    // --- Main Management Loop ---
    while (true) {
        try {
            // Reload playlist from file to allow for dynamic updates
            const currentChannelConfig = JSON.parse(fs.readFileSync(channelsFile))[channelId];
            playlist = currentChannelConfig.playlist;

            if (!playlist || playlist.length === 0) {
                console.log(`[${channelId}] Playlist is empty. Waiting...`);
                await wait(30000);
                continue;
            }
            
            // Wrap around playlist if needed
            if(state.playlistIndex >= playlist.length) state.playlistIndex = 0;

            const series = playlist[state.playlistIndex];
            
            let nextVideoUrl = null;
            let currentItemDuration = 3 * 60 * 1000; // Default to 3 min for ads

            if (state.isAdNext) {
                // --- Queue an Ad ---
                console.log(`[${channelId}] Preparing Ad...`);
                nextVideoUrl = adVideos[state.adIndex % adVideos.length];
                state.isAdNext = false; // Next up is an episode
                state.adIndex++;
            } else {
                // --- Queue an Episode ---
                 if (state.episode > series.end) {
                    state.playlistIndex++;
                    if (state.playlistIndex >= playlist.length) {
                        state.playlistIndex = 0;
                    }
                    state.episode = playlist[state.playlistIndex].start;
                    // Loop again to process the new series correctly
                    continue; 
                }
                
                console.log(`[${channelId}] Preparing ${series.title} - Episode ${state.episode}`);
                nextVideoUrl = await getEpisodeMp4(series.title, state.episode);
                currentItemDuration = 22 * 60 * 1000; // Assume 22 mins for episodes
                state.isAdNext = true; // Next up is an ad
                state.episode++;
            }

            if (nextVideoUrl) {
                console.log(`[${channelId}] ✅ Queued: ${nextVideoUrl}`);
                fs.appendFileSync(playlistFile, `file '${nextVideoUrl}'\n`);
            } else {
                console.log(`[${channelId}] ❌ Video not found. Skipping.`);
                // If a video is skipped, don't wait, just try the next one immediately.
                continue;
            }
            
            // Wait for roughly the duration of the item we just queued before adding the next one.
            // This prevents fetching everything at once. We subtract a buffer to ensure
            // ffmpeg's playlist never runs dry.
            await wait(currentItemDuration - 10000); // 10-second buffer

        } catch (error) {
            console.error(`[${channelId}] Error in management loop:`, error);
            await wait(10000); // Wait before retrying on error
        }
    }
}


// --- API Routes and Server Start ---

app.use('/hls', express.static(baseOutputDir));

// Endpoint to dynamically add a new anime series to a channel
app.post('/api/add-anime', (req, res) => {
    const { channelId, title, start, end } = req.body;
    if (!channels[channelId] || !title || !start || !end) {
        return res.status(400).json({ error: 'Invalid request. Provide channelId, title, start, and end.' });
    }
    
    // Read the latest channels file, update it, and write back
    const currentChannels = JSON.parse(fs.readFileSync(channelsFile));
    currentChannels[channelId].playlist.push({ title, start: parseInt(start), end: parseInt(end) });
    fs.writeFileSync(channelsFile, JSON.stringify(currentChannels, null, 2));

    channels = currentChannels; // Update in-memory copy
    console.log(`[${channelId}] New series added to playlist: ${title}`);
    res.json({ success: true, message: `${title} added to ${channels[channelId].name}` });
});

// Main entry point
function main() {
    if (!fs.existsSync(publicDir)) {
        fs.mkdirSync(publicDir, { recursive: true });
    }
    
    // Launch management loops for all configured channels
    for (const channelId in channels) {
        manageChannel(channelId).catch(err => {
            console.error(`[${channelId}] Channel manager crashed permanently:`, err);
        });
    }

    app.listen(PORT, () => {
        console.log(`🚀 Server running on http://localhost:${PORT}`);
        console.log("📺 Live HLS Streams:");
        Object.keys(channels).forEach(id => {
            console.log(`   - ${channels[id].name}: http://localhost:${PORT}/hls/${id}/stream.m3u8`);
        });
    });
}

main();
