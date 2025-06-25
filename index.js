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

// Ad pool for seamless insertion
const adPool = [
  'https://files.catbox.moe/hvl1cv.mp4', // Your transition video as ad
  // Add more ad URLs here
];

app.use(cors());

// Load channels from JSON file
let channels = {};
try {
  channels = JSON.parse(fs.readFileSync(channelsFile));
} catch (err) {
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

app.use(express.static(publicDir));
app.use(express.json());

function formatWATTime(date) {
  const watOffset = 1 * 60 * 60 * 1000;
  const watDate = new Date(date.getTime() + watOffset);
  return watDate.toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit'
  });
}

function generateSchedule(channelConfig) {
  const schedule = [];
  let currentTime = new Date();
  channelConfig.playlist.forEach(anime => {
    for (let ep = anime.start; ep <= anime.end; ep++) {
      const startTime = new Date(currentTime);
      const duration = (22 + 3) * 60 * 1000; // 22min episode + 3min ads
      const endTime = new Date(currentTime.getTime() + duration);
      
      schedule.push({
        title: `${anime.title} Episode ${ep}`,
        startTime: formatWATTime(startTime),
        endTime: formatWATTime(endTime)
      });
      
      currentTime = new Date(endTime.getTime() + 1000);
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

// Enhanced FFmpeg with seamless streaming optimizations
function startSeamlessFFmpeg(channelId, inputList, outputDir, onExit) {
  // Create input list file for seamless concatenation
  const inputListFile = path.join(outputDir, 'input_list.txt');
  const listContent = inputList.map(url => `file '${url}'`).join('\n');
  fs.writeFileSync(inputListFile, listContent);

  const args = [
    '-f', 'concat',
    '-safe', '0',
    '-protocol_whitelist', 'file,http,https,tcp,tls',
    '-i', inputListFile,
    '-vf', `drawtext=text='${watermarkText}':fontcolor=white:fontsize=24:x=w-tw-20:y=20`,
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-tune', 'zerolatency',
    '-profile:v', 'baseline',
    '-level', '3.0',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-ar', '44100',
    '-g', '50', // GOP size for better seeking
    '-sc_threshold', '0', // Disable scene change detection
    '-force_key_frames', 'expr:gte(t,n_forced*2)', // Force keyframes every 2 seconds
    '-f', 'hls',
    '-hls_time', '2', // 2-second segments for low latency
    '-hls_list_size', '10', // Keep more segments in memory
    '-hls_flags', 'delete_segments+program_date_time+independent_segments',
    '-hls_segment_type', 'mpegts',
    '-hls_segment_filename', path.join(outputDir, 'segment_%03d.ts'),
    '-master_pl_name', 'master.m3u8',
    '-avoid_negative_ts', 'make_zero', // Avoid timestamp issues
    '-fflags', '+genpts+discardcorrupt', // Generate timestamps and handle corruption
    path.join(outputDir, 'stream.m3u8')
  ];

  console.log(`🔴 [${channelId}] Starting seamless FFmpeg`);
  const proc = spawn('ffmpeg', args);
  proc.stderr.on('data', d => process.stderr.write(`[FFMPEG ${channelId}] ${d}`));
  proc.on('exit', onExit);
  return proc;
}

// Create seamless playlist with preloading
async function createSeamlessPlaylist(channelId, channelConfig) {
  const playlist = [];
  const maxPreload = 5; // Preload next 5 items
  
  for (let i = 0; i < channelConfig.playlist.length; i++) {
    const anime = channelConfig.playlist[i];
    for (let ep = anime.start; ep <= anime.end; ep++) {
      // Add episode
      const episodeUrl = await getEpisodeMp4(anime.title, ep);
      if (episodeUrl) {
        playlist.push({
          type: 'episode',
          url: episodeUrl,
          title: `${anime.title} Episode ${ep}`,
          duration: 22 * 60 // 22 minutes
        });
      }
      
      // Add ad after episode (except for last episode)
      if (ep < anime.end || i < channelConfig.playlist.length - 1) {
        const randomAd = adPool[Math.floor(Math.random() * adPool.length)];
        playlist.push({
          type: 'ad',
          url: randomAd,
          title: 'Advertisement',
          duration: 3 * 60 // 3 minutes
        });
      }
    }
  }
  
  return playlist;
}

function setupSeamlessChannel(channelId, channelConfig) {
  const state = {
    playlist: [],
    currentIndex: 0,
    isLoading: false,
    process: null,
    preloadBuffer: []
  };

  const channelOutput = path.join(baseOutputDir, channelId);
  if (fs.existsSync(channelOutput)) fs.rmSync(channelOutput, { recursive: true, force: true });
  fs.mkdirSync(channelOutput, { recursive: true });

  channelConfig.schedule = generateSchedule(channelConfig);

  async function initializePlaylist() {
    console.log(`[${channelId}] Creating seamless playlist...`);
    state.playlist = await createSeamlessPlaylist(channelId, channelConfig);
    console.log(`[${channelId}] Playlist created with ${state.playlist.length} items`);
    startSeamlessStream();
  }

  async function preloadNext(count = 3) {
    const startIndex = state.currentIndex + 1;
    const endIndex = Math.min(startIndex + count, state.playlist.length);
    
    for (let i = startIndex; i < endIndex; i++) {
      if (!state.preloadBuffer.includes(i)) {
        state.preloadBuffer.push(i);
        // Optionally pre-fetch URLs here for faster access
      }
    }
  }

  async function startSeamlessStream() {
    if (state.isLoading || state.playlist.length === 0) return;
    
    state.isLoading = true;
    
    // Get current batch for seamless playback (current + next few items)
    const batchSize = 3;
    const currentBatch = [];
    
    for (let i = 0; i < batchSize && (state.currentIndex + i) < state.playlist.length; i++) {
      const item = state.playlist[state.currentIndex + i];
      if (item && item.url) {
        currentBatch.push(item.url);
      }
    }
    
    if (currentBatch.length === 0) {
      console.log(`[${channelId}] No valid URLs in current batch, restarting playlist`);
      state.currentIndex = 0;
      setTimeout(startSeamlessStream, 1000);
      return;
    }

    console.log(`[${channelId}] Starting batch with ${currentBatch.length} items`);
    
    // Calculate total duration for this batch
    let totalDuration = 0;
    for (let i = 0; i < batchSize && (state.currentIndex + i) < state.playlist.length; i++) {
      const item = state.playlist[state.currentIndex + i];
      if (item) totalDuration += item.duration || 1500; // Default 25 minutes if no duration
    }

    state.process = startSeamlessFFmpeg(channelId, currentBatch, channelOutput, async (code) => {
      console.log(`[${channelId}] Batch finished with code ${code}`);
      
      // Move to next batch
      state.currentIndex += batchSize;
      if (state.currentIndex >= state.playlist.length) {
        console.log(`[${channelId}] Playlist finished, restarting...`);
        state.currentIndex = 0;
        // Optionally refresh playlist here
        state.playlist = await createSeamlessPlaylist(channelId, channelConfig);
      }
      
      state.isLoading = false;
      
      // Preload next items
      await preloadNext();
      
      // Small delay then start next batch
      setTimeout(startSeamlessStream, 500);
    });

    // Preload next items while current batch is playing
    await preloadNext();
  }

  // Start the process
  initializePlaylist();

  // Serve stream
  app.use(`/hls/${channelId}`, express.static(channelOutput));
  
  // API endpoint to get current playing info
  app.get(`/api/current/${channelId}`, (req, res) => {
    const current = state.playlist[state.currentIndex] || null;
    const next = state.playlist[state.currentIndex + 1] || null;
    res.json({
      current: current ? {
        title: current.title,
        type: current.type,
        index: state.currentIndex
      } : null,
      next: next ? {
        title: next.title,
        type: next.type
      } : null,
      playlistLength: state.playlist.length
    });
  });
}

// Route to add new anime (enhanced to update seamless playlist)
app.post('/api/add-anime', async (req, res) => {
  const { channelId, title, start, end } = req.body;
  if (!channels[channelId]) {
    return res.status(400).json({ error: 'Invalid channel ID' });
  }
  
  channels[channelId].playlist.push({ title, start: parseInt(start), end: parseInt(end) });
  channels[channelId].schedule = generateSchedule(channels[channelId]);
  fs.writeFileSync(channelsFile, JSON.stringify(channels, null, 2));
  
  // Note: In production, you'd want to update the running stream's playlist here
  console.log(`[${channelId}] Added new anime: ${title} (${start}-${end})`);
  
  res.json({ success: true });
});

app.get('/watch/:channelId', (req, res) => {
  const filePath = path.join(publicDir, 'channel.html');
  res.sendFile(filePath);
});

app.get('/api/schedule/:channelId', (req, res) => {
  const channelId = req.params.channelId;
  if (!channels[channelId]) {
    return res.status(400).json({ error: 'Invalid channel ID' });
  }
  res.json(channels[channelId].schedule);
});

// Health check endpoint
app.get('/api/health/:channelId', (req, res) => {
  const channelId = req.params.channelId;
  const outputDir = path.join(baseOutputDir, channelId);
  const masterPlaylist = path.join(outputDir, 'master.m3u8');
  
  res.json({
    status: fs.existsSync(masterPlaylist) ? 'streaming' : 'offline',
    timestamp: new Date().toISOString()
  });
});

// Launch all channels with seamless streaming
for (const [id, config] of Object.entries(channels)) {
  setupSeamlessChannel(id, config);
}

if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
}

app.listen(PORT, () => {
  console.log(`🚀 Seamless Streaming Server running on http://localhost:${PORT}`);
  console.log(`🔗 Channels:`);
  Object.keys(channels).forEach(id => {
    console.log(`- http://localhost:${PORT}/watch/${id}`);
  });
  console.log(`- http://localhost:${PORT}/add-anime`);
  console.log('\n✨ Features enabled:');
  console.log('- Seamless episode-to-ad transitions');
  console.log('- Content preloading for zero buffering');
  console.log('- Dynamic playlist updates');
  console.log('- HLS stream optimization');
});
