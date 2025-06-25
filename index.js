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
const transitionVideo = 'https://files.catbox.moe/hvl1cv.mp4';
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

// Generate schedule for a channel
function generateSchedule(channelConfig) {
  const schedule = [];
  let currentTime = new Date();
  channelConfig.playlist.forEach(anime => {
    for (let ep = anime.start; ep <= anime.end; ep++) {
      const startTime = new Date(currentTime);
      // 22 minutes for episode + 3 minutes for ads = 25 minutes total
      const duration = (22 + 3) * 60 * 1000; // 25 minutes per episode slot
      const endTime = new Date(currentTime.getTime() + duration);
      
      schedule.push({
        title: `${anime.title} Episode ${ep}`,
        startTime: formatWATTime(startTime),
        endTime: formatWATTime(endTime)
      });
      
      currentTime = new Date(endTime.getTime() + 1000); // 1 second gap for transition
    }
  });
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

function startFFmpeg(channelId, inputUrl, outputDir, onExit) {
  const args = [
    '-re', '-i', inputUrl,
    '-vf', `drawtext=text='${watermarkText}':fontcolor=white:fontsize=24:x=w-tw-20:y=20`,
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

function setupChannel(channelId, channelConfig) {
  const state = {
    index: 0,
    ep: channelConfig.playlist[0].start,
    isTransition: false,
    process: null,
    anime: channelConfig.playlist[0].title,
    currentEp: 1
  };

  const channelOutput = path.join(baseOutputDir, channelId);
  if (fs.existsSync(channelOutput)) fs.rmSync(channelOutput, { recursive: true, force: true });
  fs.mkdirSync(channelOutput, { recursive: true });

  // Generate initial schedule
  channelConfig.schedule = generateSchedule(channelConfig);

  async function loop() {
    const entry = channelConfig.playlist[state.index];
    state.anime = entry.title;
    state.currentEp = state.ep;

    if (!state.isTransition) {
      const mp4 = await getEpisodeMp4(entry.title, state.ep);
      if (!mp4) {
        console.log(`[${channelId}] ❌ Skipping ep${state.ep} (not found)`);
        state.isTransition = true;
        return loop();
      }

      state.process = startFFmpeg(channelId, mp4, channelOutput, async () => {
        console.log(`[${channelId}] ✅ Finished: ${entry.title} Ep${state.ep}`);
        state.isTransition = true;
        loop();
      });
    } else {
      state.process = startFFmpeg(channelId, transitionVideo, channelOutput, async () => {
        state.ep++;
        if (state.ep > entry.end) {
          state.index++;
          if (state.index >= channelConfig.playlist.length) state.index = 0;
          state.ep = channelConfig.playlist[state.index].start;
        }
        state.isTransition = false;
        await wait(1000);
        loop();
      });
    }
  }

  loop();

  // Serve stream
  app.use(`/hls/${channelId}`, express.static(channelOutput));
}

// Route to add new anime
app.post('/api/add-anime', (req, res) => {
  const { channelId, title, start, end } = req.body;
  if (!channels[channelId]) {
    return res.status(400).json({ error: 'Invalid channel ID' });
  }
  channels[channelId].playlist.push({ title, start: parseInt(start), end: parseInt(end) });
  channels[channelId].schedule = generateSchedule(channels[channelId]);
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
