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

// Get video duration using ffprobe
async function getVideoDuration(url) {
  return new Promise((resolve) => {
    const ffprobe = spawn('ffprobe', [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      url
    ]);

    let output = '';
    ffprobe.stdout.on('data', (data) => {
      output += data.toString();
    });

    ffprobe.on('close', (code) => {
      try {
        if (code === 0) {
          const info = JSON.parse(output);
          const duration = parseFloat(info.format.duration);
          resolve(duration * 1000); // Convert to milliseconds
        } else {
          console.log(`Failed to get duration for ${url}, using default 22 minutes`);
          resolve(22 * 60 * 1000); // Default to 22 minutes
        }
      } catch (err) {
        console.log(`Error parsing duration for ${url}, using default 22 minutes`);
        resolve(22 * 60 * 1000); // Default to 22 minutes
      }
    });

    ffprobe.on('error', () => {
      console.log(`ffprobe error for ${url}, using default 22 minutes`);
      resolve(22 * 60 * 1000); // Default to 22 minutes
    });
  });
}

// Generate schedule for a channel (now with dynamic durations)
async function generateSchedule(channelConfig) {
  const schedule = [];
  let currentTime = new Date();
  
  for (const anime of channelConfig.playlist) {
    for (let ep = anime.start; ep <= anime.end; ep++) {
      const startTime = new Date(currentTime);
      
      // Try to get actual episode duration
      let duration = 22 * 60 * 1000; // Default 22 minutes
      try {
        const mp4 = await getEpisodeMp4(anime.title, ep);
        if (mp4) {
          duration = await getVideoDuration(mp4);
        }
      } catch (err) {
        console.log(`Could not get duration for ${anime.title} Episode ${ep}, using default`);
      }
      
      // Add 3 minutes buffer for transitions/ads
      const totalDuration = duration + (3 * 60 * 1000);
      const endTime = new Date(currentTime.getTime() + totalDuration);
      
      schedule.push({
        title: `${anime.title} Episode ${ep}`,
        startTime: formatWATTime(startTime),
        endTime: formatWATTime(endTime),
        duration: Math.round(duration / (60 * 1000)) // Duration in minutes for display
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

function startFFmpeg(channelId, inputUrl, outputDir, onExit, isLoop = false) {
  const baseArgs = [
    '-re'
  ];

  // Add loop input for transition videos
  if (isLoop) {
    baseArgs.push('-stream_loop', '-1');
  }

  const args = [
    ...baseArgs,
    '-i', inputUrl,
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

  console.log(`🔴 [${channelId}] Starting FFmpeg for ${inputUrl}${isLoop ? ' (LOOP)' : ''}`);
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
    currentEp: 1,
    nextEpisodeReady: false,
    nextEpisodeUrl: null,
    transitionStartTime: null
  };

  const channelOutput = path.join(baseOutputDir, channelId);
  if (fs.existsSync(channelOutput)) fs.rmSync(channelOutput, { recursive: true, force: true });
  fs.mkdirSync(channelOutput, { recursive: true });

  // Generate initial schedule with dynamic durations
  generateSchedule(channelConfig).then(schedule => {
    channelConfig.schedule = schedule;
  });

  // Preload next episode
  async function preloadNextEpisode() {
    const currentEntry = channelConfig.playlist[state.index];
    let nextEp = state.ep + 1;
    let nextIndex = state.index;

    if (nextEp > currentEntry.end) {
      nextIndex++;
      if (nextIndex >= channelConfig.playlist.length) nextIndex = 0;
      nextEp = channelConfig.playlist[nextIndex].start;
    }

    const nextEntry = channelConfig.playlist[nextIndex];
    console.log(`[${channelId}] 🔄 Preloading: ${nextEntry.title} Episode ${nextEp}`);
    
    try {
      const nextUrl = await getEpisodeMp4(nextEntry.title, nextEp);
      if (nextUrl) {
        state.nextEpisodeUrl = nextUrl;
        state.nextEpisodeReady = true;
        console.log(`[${channelId}] ✅ Next episode ready: ${nextEntry.title} Episode ${nextEp}`);
      } else {
        console.log(`[${channelId}] ❌ Next episode not found: ${nextEntry.title} Episode ${nextEp}`);
        state.nextEpisodeReady = false;
      }
    } catch (err) {
      console.log(`[${channelId}] ❌ Error preloading next episode:`, err.message);
      state.nextEpisodeReady = false;
    }
  }

  async function loop() {
    const entry = channelConfig.playlist[state.index];
    state.anime = entry.title;
    state.currentEp = state.ep;

    if (!state.isTransition) {
      // Playing actual episode
      const mp4 = await getEpisodeMp4(entry.title, state.ep);
      if (!mp4) {
        console.log(`[${channelId}] ❌ Skipping ep${state.ep} (not found)`);
        state.isTransition = true;
        return loop();
      }

      // Start preloading next episode
      preloadNextEpisode();

      state.process = startFFmpeg(channelId, mp4, channelOutput, async () => {
        console.log(`[${channelId}] ✅ Finished: ${entry.title} Ep${state.ep}`);
        state.isTransition = true;
        state.transitionStartTime = Date.now();
        loop();
      });

    } else {
      // Playing transition/ad video
      console.log(`[${channelId}] 🔄 Playing transition video...`);
      
      // Start transition with loop
      state.process = startFFmpeg(channelId, transitionVideo, channelOutput, () => {
        // This callback will be called when ffmpeg exits
        // We'll handle the transition logic in checkTransitionStatus
      }, true); // Enable loop for transition

      // Check if next episode is ready periodically
      const checkTransitionStatus = setInterval(async () => {
        const transitionDuration = Date.now() - state.transitionStartTime;
        
        // Minimum transition time of 10 seconds, maximum of 60 seconds
        const minTransitionTime = 10000;
        const maxTransitionTime = 60000;
        
        if (state.nextEpisodeReady && transitionDuration >= minTransitionTime) {
          // Next episode is ready and minimum transition time has passed
          clearInterval(checkTransitionStatus);
          
          if (state.process) {
            state.process.kill('SIGTERM');
          }
          
          // Move to next episode
          state.ep++;
          if (state.ep > entry.end) {
            state.index++;
            if (state.index >= channelConfig.playlist.length) state.index = 0;
            state.ep = channelConfig.playlist[state.index].start;
          }
          
          state.isTransition = false;
          state.nextEpisodeReady = false;
          state.nextEpisodeUrl = null;
          
          await wait(2000); // Brief pause for smooth transition
          loop();
          
        } else if (transitionDuration >= maxTransitionTime) {
          // Maximum transition time reached, move on regardless
          console.log(`[${channelId}] ⏰ Maximum transition time reached, moving to next episode`);
          clearInterval(checkTransitionStatus);
          
          if (state.process) {
            state.process.kill('SIGTERM');
          }
          
          // Move to next episode
          state.ep++;
          if (state.ep > entry.end) {
            state.index++;
            if (state.index >= channelConfig.playlist.length) state.index = 0;
            state.ep = channelConfig.playlist[state.index].start;
          }
          
          state.isTransition = false;
          state.nextEpisodeReady = false;
          state.nextEpisodeUrl = null;
          
          await wait(2000);
          loop();
        }
      }, 2000); // Check every 2 seconds
    }
  }

  loop();

  // Serve stream
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

// Route to get current playing info
app.get('/api/current/:channelId', (req, res) => {
  const channelId = req.params.channelId;
  if (!channels[channelId]) {
    return res.status(400).json({ error: 'Invalid channel ID' });
  }
  
  // This would need to be enhanced to track actual current state
  // For now, return basic channel info
  res.json({
    channelName: channels[channelId].name,
    status: 'live'
  });
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
    console.log(`- http://localhost:${PORT}/watch/${id}`);
  });
  console.log(`- http://localhost:${PORT}/add-anime`);
});
