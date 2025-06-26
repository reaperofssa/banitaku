const { spawn } = require('child_process'); 
const express = require('express'); 
const fs = require('fs'); 
const cors = require('cors'); 
const path = require('path'); 
const axios = require('axios'); 
const ffmpeg = require('fluent-ffmpeg');

const PORT = 7860; 
const app = express(); 
const baseOutputDir = path.join(__dirname, 'hls_output'); 
const publicDir = path.join(__dirname, 'public'); 
const watermarkText = 'AnitakuX'; 
const channelsFile = path.join(__dirname, 'channels.json'); 
app.use(cors()); 

// Load channels from JSON file 
let channels = {}; 
try { 
  channels = JSON.parse(fs.readFileSync(channelsFile)); 
} catch (err) { 
  // Initialize with default channels if file doesn't exist 
  channels = { 
    channel1: { 
      name: 'Anitaku TV 1', 
      playlist: [ 
        { title: 'Lazarus', start: 1, end: 12 }, 
        { title: 'Erased', start: 1, end: 12 } 
      ], 
      schedule: [] 
    }, 
    channel2: { 
      name: 'Anitaku TV 2', 
      playlist: [ 
        { title: 'Eminence in Shadow', start: 1, end: 20 } 
      ], 
      schedule: [] 
    }, 
    channel3: { 
      name: 'Anitaku TV 3', 
      playlist: [ 
        { title: 'Attack on Titan', start: 1, end: 25 } 
      ], 
      schedule: [] 
    }, 
    channel4: { 
      name: 'Anitaku TV 4', 
      playlist: [ 
        { title: 'Demon Slayer', start: 1, end: 26 } 
      ], 
      schedule: [] 
    }, 
    channel5: { 
      name: 'Anitaku TV 5', 
      playlist: [ 
        { title: 'Chained Soldier', start: 1, end: 11 } 
      ], 
      schedule: [] 
    }, 
    channel6: { 
      name: 'Anitaku TV 6', 
      playlist: [ 
        { title: 'Solo Leveling', start: 1, end: 13 } 
      ], 
      schedule: [] 
    } 
  }; 
  fs.writeFileSync(channelsFile, JSON.stringify(channels, null, 2)); 
} 

// Serve static files from public directory 
app.use(express.static(publicDir)); 
app.use(express.json()); 

// Helper function to format time in WAT (UTC+1) 
function formatWATTime(date) { 
  const watOffset = 1 * 60 * 60 * 1000; // WAT is UTC+1 
  const watDate = new Date(date.getTime() + watOffset); 
  return watDate.toLocaleTimeString('en-US', {  
    hour12: false, 
    hour: '2-digit', 
    minute: '2-digit' 
  }); 
} 

// Get video duration using ffmpeg
async function getVideoDuration(url) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(url, (err, metadata) => {
      if (err) {
        console.error(`Error probing video duration for ${url}:`, err);
        return resolve(22 * 60 * 1000); // Fallback to 22 minutes
      }
      const durationSeconds = metadata.format.duration || 22 * 60;
      resolve(durationSeconds * 1000); // Convert to milliseconds
    });
  });
}

// Generate schedule for a channel 
async function generateSchedule(channelConfig) { 
  const schedule = []; 
  let currentTime = new Date(); 

  for (const anime of channelConfig.playlist) { 
    for (let ep = anime.start; ep <= anime.end; ep++) { 
      const url = await getEpisodeMp4(anime.title, ep);
      if (!url) {
        console.error(`Failed to get URL for ${anime.title} Episode ${ep}`);
        continue;
      }
      const duration = await getVideoDuration(url); 
      const startTime = new Date(currentTime); 
      const endTime = new Date(currentTime.getTime() + duration); 
      
      schedule.push({ 
        title: `${anime.title} Episode ${ep}`, 
        startTime: formatWATTime(startTime), 
        endTime: formatWATTime(endTime) 
      }); 
      
      currentTime = new Date(endTime.getTime() + 1000); // 1 second gap
    } 
  } 
  return schedule; 
} 

function wait(ms) { 
  return new Promise(resolve => setTimeout(resolve, ms)); 
} 

async function getEpisodeMp4(anime, ep) { 
  const url = `https://txtorg-anihx.hf.space/api/episode?anime=${encodeURIComponent(anime)}&ep=${ep}`; 
  const data = await axios.get(url).then(r => r.data).catch(() => null); 
  const dl = data?.links?.sub?.['360p_download']; 
  if (!dl) return null; 
  return await axios.get(`https://txtorg-anihx.hf.space/resolvex?url=${dl}`) 
    .then(r => r.data?.mp4Link) 
    .catch(() => null); 
} 

function startFFmpeg(channelId, inputUrl, outputDir, episodeNumber, onExit) { 
  const args = [ 
    '-re', '-i', inputUrl, 
    '-vf', `drawtext=text='${watermarkText}':fontcolor=white:fontsize=24:x=w-tw-20:y=20,drawtext=text='Ep ${episodeNumber}':fontcolor=white:fontsize=20:x=w-tw-20:y=h-th-20`, 
    '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency', 
    '-c:a', 'aac', '-b:a', '128k', 
    '-g', '50', '-sc_threshold', '0', 
    '-f', 'hls', 
    '-hls_time', '2', 
    '-hls_list_size', '5', 
    '-hls_flags', 'delete_segments+program_date_time', 
    '-hls_segment_type', 'mpegts', 
    '-master_pl_name', 'master.m3u8', 
    path.join(outputDir, 'stream_%v.m3u8') 
  ]; 

  console.log(`🔴 [${channelId}] Starting FFmpeg for ${inputUrl}`); 
  const proc = spawn('ffmpeg', args); 
  proc.stderr.on('data', d => process.stderr.write(`[FFMPEG ${channelId}] ${d}`)); 
  proc.on('exit', onExit); 
  return proc; 
} 

async function setupChannel(channelId, channelConfig) {
  const state = {
    index: 0,
    ep: channelConfig.playlist[0].start,
    process: null,
    anime: channelConfig.playlist[0].title,
    preloadNextUrl: null,
    nextEpisode: null
  };

  const channelOutput = path.join(baseOutputDir, channelId);
  if (fs.existsSync(channelOutput)) fs.rmSync(channelOutput, { recursive: true, force: true });
  fs.mkdirSync(channelOutput, { recursive: true });

  channelConfig.schedule = await generateSchedule(channelConfig);

  async function preloadNext() {
    const entry = channelConfig.playlist[state.index];
    const nextUrl = await getEpisodeMp4(entry.title, state.ep);
    state.preloadNextUrl = nextUrl;
    state.nextEpisode = state.ep;
    if (nextUrl) {
      // Start preloading by probing the video
      ffmpeg.ffprobe(nextUrl, (err) => {
        if (err) console.error(`Error preloading ${entry.title} Episode ${state.ep}:`, err);
      });
    }
  }

  async function play(url, episodeNumber, onEnd) {
    state.process = startFFmpeg(channelId, url, channelOutput, episodeNumber, async () => {
      onEnd();
    });
  }

  async function loop() {
    const entry = channelConfig.playlist[state.index];

    // Step 1: Preload next episode
    await preloadNext();

    // Step 2: Play current episode
    const currentUrl = state.preloadNextUrl;
    if (!currentUrl) {
      console.log(`[${channelId}] ❌ Failed to preload next episode.`);
      setTimeout(loop, 3000); // Retry after a short delay
      return;
    }

    // Step 3: Play it and prepare the next in background
    play(currentUrl, state.nextEpisode, async () => {
      state.ep++;
      if (state.ep > entry.end) {
        state.index++;
        if (state.index >= channelConfig.playlist.length) state.index = 0;
        state.ep = channelConfig.playlist[state.index].start;
      }

      // Update schedule if there's a significant delay
      const now = new Date();
      const lastScheduled = channelConfig.schedule[channelConfig.schedule.length - 1];
      if (lastScheduled && new Date(`1970-01-01T${lastScheduled.endTime}:00Z`) < now) {
        channelConfig.schedule = await generateSchedule(channelConfig);
      }

      loop(); // Go to next
    });
  }

  loop();
  app.use(`/hls/${channelId}`, express.static(channelOutput));
} 

// Route to add new anime 
app.post('/api/add-anime', async (req, res) => { 
  const { channelId, title, start, end } = req.body; 
  if (!channels[channelId]) { 
    return res.status(400).json({ error: 'Invalid channel ID' }); 
  } 
  channels[channelId].playlist.push({ title, start: parseInt(start), end: parseInt(end) }); 
  channels[channelId].schedule = await generateSchedule(channels[channelId]); 
  fs.writeFileSync(channelsFile, JSON.stringify(channels, null, 2)); 
  res.json({ success: true }); 
}); 

app.get('/watch/:channelId', (req, res) => { 
  const filePath = path.join(publicDir, 'channel.html'); 
  res.sendFile(filePath); 
}); 

// Route to get channel schedule 
app.get('/api/schedule/:channelId', (req, res) => { 
  const channelId = req.params.channelId; 
  if (!channels[channelId]) { 
    return res.status(400).json({ error: 'Invalid channel ID' }); 
  } 
  res.json(channels[channelId].schedule); 
}); 

// Launch all channels 
for (const [id, config] of Object.entries(channels)) { 
  setupChannel(id, config); 
} 

// Create public directory if it doesn't exist 
if (!fs.existsSync(publicDir)) { 
  fs.mkdirSync(publicDir, { recursive: true }); 
} 

app.listen(PORT, () => { 
  console.log(`🚀 Server running on http://localhost:${PORT}`); 
  console.log(`🔗 Channels:`); 
  Object.keys(channels).forEach(id => { 
    console.log(`- http://localhost:${PORT}/${id}`); 
  }); 
  console.log(`- http://localhost:${PORT}/add-anime`); 
});
