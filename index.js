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
const tempDir = path.join(__dirname, 'temp');
const transitionVideo = 'https://files.catbox.moe/hvl1cv.mp4';
const adVideo = 'https://files.catbox.moe/hvl1cv.mp4';
const watermarkText = 'AnitakuX';
const channelsFile = path.join(__dirname, 'channels.json');
const EPISODE_SLOT_DURATION = 25 * 60 * 1000; // 25 minutes per slot
const TRANSITION_DURATION = 10 * 1000; // 10 seconds for transition video

app.use(cors());

// Create necessary directories
[baseOutputDir, publicDir, tempDir].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

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

function getVideoDuration(url) {
  return new Promise((resolve) => {
    const ffprobe = spawn('ffprobe', [
      '-v', 'quiet',
      '-show_entries', 'format=duration',
      '-of', 'csv=p=0',
      url
    ]);

    let output = '';
    ffprobe.stdout.on('data', (data) => {
      output += data.toString();
    });

    ffprobe.on('close', (code) => {
      if (code === 0) {
        const duration = parseFloat(output.trim());
        resolve(duration * 1000);
      } else {
        console.log(`Failed to get duration for ${url}, using default 22 minutes`);
        resolve(22 * 60 * 1000);
      }
    });

    ffprobe.on('error', () => {
      console.log(`Error getting duration for ${url}, using default 22 minutes`);
      resolve(22 * 60 * 1000);
    });
  });
}

async function generateAccurateSchedule(channelConfig) {
  const schedule = [];
  let currentTime = new Date();
  
  for (const anime of channelConfig.playlist) {
    for (let ep = anime.start; ep <= anime.end; ep++) {
      const startTime = new Date(currentTime);
      
      try {
        const mp4Url = await getEpisodeMp4(anime.title, ep);
        let episodeDuration = EPISODE_SLOT_DURATION - TRANSITION_DURATION;
        
        if (mp4Url) {
          const actualDuration = await getVideoDuration(mp4Url);
          episodeDuration = actualDuration;
        }
        
        const adDuration = Math.max(0, EPISODE_SLOT_DURATION - episodeDuration - TRANSITION_DURATION);
        const totalDuration = episodeDuration + adDuration + TRANSITION_DURATION;
        
        const endTime = new Date(currentTime.getTime() + totalDuration);
        
        schedule.push({
          title: `${anime.title} Episode ${ep}`,
          startTime: formatWATTime(startTime),
          endTime: formatWATTime(endTime),
          episodeDuration: Math.round(episodeDuration / 1000 / 60),
          adDuration: Math.round(adDuration / 1000 / 60),
          transitionDuration: Math.round(TRANSITION_DURATION / 1000)
        });
        
        currentTime = endTime;
      } catch (error) {
        console.log(`Error scheduling ${anime.title} Episode ${ep}:`, error.message);
        const endTime = new Date(currentTime.getTime() + EPISODE_SLOT_DURATION);
        schedule.push({
          title: `${anime.title} Episode ${ep}`,
          startTime: formatWATTime(startTime),
          endTime: formatWATTime(endTime),
          episodeDuration: 22,
          adDuration: 3,
          transitionDuration: 10
        });
        currentTime = endTime;
      }
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

// Create a seamless concat playlist for continuous streaming
async function createConcatPlaylist(channelId, episodeUrl, adDuration, transitionUrl, outputPath) {
  const concatContent = [];
  
  // Add episode
  concatContent.push(`file '${episodeUrl}'`);
  
  // Add ads if needed (repeat ad video to fill duration)
  if (adDuration > 0) {
    const adRepeats = Math.ceil(adDuration / 30); // Assuming 30s ad
    for (let i = 0; i < adRepeats; i++) {
      concatContent.push(`file '${adVideo}'`);
    }
  }
  
  // Add transition
  concatContent.push(`file '${transitionUrl}'`);
  
  fs.writeFileSync(outputPath, concatContent.join('\n'));
  return outputPath;
}

// Start seamless FFmpeg stream with concat demuxer
function startSeamlessFFmpeg(channelId, outputDir, onRestart) {
  const args = [
    '-f', 'concat',
    '-safe', '0',
    '-re',
    '-i', 'pipe:0', // Read concat list from stdin
    '-vf', `drawtext=text='${watermarkText}':fontcolor=white:fontsize=24:x=w-tw-20:y=20`,
    '-c:v', 'libx264', 
    '-preset', 'veryfast', 
    '-tune', 'zerolatency',
    '-c:a', 'aac', 
    '-b:a', '128k',
    '-g', '50', 
    '-sc_threshold', '0',
    '-f', 'hls',
    '-hls_time', '2',
    '-hls_list_size', '10',
    '-hls_flags', 'delete_segments+program_date_time+omit_endlist',
    '-hls_segment_type', 'mpegts',
    '-master_pl_name', 'master.m3u8',
    '-reconnect', '1',
    '-reconnect_streamed', '1',
    '-reconnect_delay_max', '2',
    path.join(outputDir, 'stream_%v.m3u8')
  ];

  console.log(`🔴 [${channelId}] Starting seamless FFmpeg stream`);
  const proc = spawn('ffmpeg', args);
  
  proc.stderr.on('data', d => {
    const msg = d.toString();
    if (!msg.includes('frame=') && !msg.includes('bitrate=')) {
      process.stderr.write(`[FFMPEG ${channelId}] ${msg}`);
    }
  });
  
  proc.on('exit', (code) => {
    console.log(`[${channelId}] FFmpeg exited with code ${code}, restarting...`);
    setTimeout(onRestart, 1000);
  });
  
  return proc;
}

function setupSeamlessChannel(channelId, channelConfig) {
  const state = {
    index: 0,
    ep: channelConfig.playlist[0].start,
    process: null,
    isRunning: false
  };

  const channelOutput = path.join(baseOutputDir, channelId);
  const channelTemp = path.join(tempDir, channelId);
  
  [channelOutput, channelTemp].forEach(dir => {
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
  });

  // Generate schedule
  generateAccurateSchedule(channelConfig).then(schedule => {
    channelConfig.schedule = schedule;
    fs.writeFileSync(channelsFile, JSON.stringify(channels, null, 2));
  });

  async function createNextSegment() {
    const entry = channelConfig.playlist[state.index];
    
    try {
      const mp4 = await getEpisodeMp4(entry.title, state.ep);
      if (!mp4) {
        console.log(`[${channelId}] ❌ Skipping ep${state.ep} (not found)`);
        advanceToNext();
        return await createNextSegment();
      }

      // Calculate ad duration needed
      const episodeDuration = await getVideoDuration(mp4);
      const adDuration = Math.max(0, (EPISODE_SLOT_DURATION - episodeDuration - TRANSITION_DURATION) / 1000);
      
      console.log(`[${channelId}] 📺 Preparing: ${entry.title} Ep${state.ep} (${Math.round(episodeDuration/1000/60)}min + ${Math.round(adDuration)}s ads)`);
      
      // Create concat list for this segment
      const concatList = [];
      concatList.push(`file '${mp4}'`);
      
      // Add ads
      if (adDuration > 5) {
        const adRepeats = Math.ceil(adDuration / 30);
        for (let i = 0; i < adRepeats; i++) {
          concatList.push(`file '${adVideo}'`);
        }
      }
      
      // Add transition
      concatList.push(`file '${transitionVideo}'`);
      
      advanceToNext();
      return concatList.join('\n') + '\n';
      
    } catch (error) {
      console.log(`[${channelId}] Error preparing segment:`, error.message);
      advanceToNext();
      return await createNextSegment();
    }
  }

  function advanceToNext() {
    state.ep++;
    const entry = channelConfig.playlist[state.index];
    if (state.ep > entry.end) {
      state.index++;
      if (state.index >= channelConfig.playlist.length) state.index = 0;
      state.ep = channelConfig.playlist[state.index].start;
    }
  }

  async function startStream() {
    if (state.isRunning) return;
    state.isRunning = true;

    const restart = () => {
      state.isRunning = false;
      setTimeout(startStream, 2000);
    };

    state.process = startSeamlessFFmpeg(channelId, channelOutput, restart);

    // Continuously feed concat lists to FFmpeg
    async function feedContent() {
      while (state.isRunning && state.process && !state.process.killed) {
        try {
          const concatContent = await createNextSegment();
          if (state.process && state.process.stdin && !state.process.stdin.destroyed) {
            state.process.stdin.write(concatContent);
          }
          
          // Wait for the segment duration before preparing next
          await wait(EPISODE_SLOT_DURATION);
        } catch (error) {
          console.log(`[${channelId}] Error in content feed:`, error.message);
          await wait(5000);
        }
      }
    }

    feedContent();
  }

  startStream();
  app.use(`/hls/${channelId}`, express.static(channelOutput));
}

// Alternative approach: Pre-generate seamless segments
function setupPreGeneratedChannel(channelId, channelConfig) {
  const state = {
    index: 0,
    ep: channelConfig.playlist[0].start,
    process: null,
    segmentQueue: [],
    isGenerating: false
  };

  const channelOutput = path.join(baseOutputDir, channelId);
  if (fs.existsSync(channelOutput)) fs.rmSync(channelOutput, { recursive: true, force: true });
  fs.mkdirSync(channelOutput, { recursive: true });

  generateAccurateSchedule(channelConfig).then(schedule => {
    channelConfig.schedule = schedule;
    fs.writeFileSync(channelsFile, JSON.stringify(channels, null, 2));
  });

  async function generateSegment() {
    if (state.isGenerating) return;
    state.isGenerating = true;

    const entry = channelConfig.playlist[state.index];
    
    try {
      const mp4 = await getEpisodeMp4(entry.title, state.ep);
      if (!mp4) {
        console.log(`[${channelId}] ❌ Skipping ep${state.ep} (not found)`);
        advanceToNext();
        state.isGenerating = false;
        return;
      }

      const episodeDuration = await getVideoDuration(mp4);
      const adDuration = Math.max(5, (EPISODE_SLOT_DURATION - episodeDuration - TRANSITION_DURATION) / 1000);
      
      const segmentFile = path.join(tempDir, `${channelId}_segment_${Date.now()}.txt`);
      const concatContent = [
        `file '${mp4}'`,
        ...Array(Math.ceil(adDuration / 30)).fill(`file '${adVideo}'`),
        `file '${transitionVideo}'`
      ].join('\n');
      
      fs.writeFileSync(segmentFile, concatContent);
      state.segmentQueue.push(segmentFile);
      
      console.log(`[${channelId}] ✅ Generated segment: ${entry.title} Ep${state.ep}`);
      advanceToNext();
      
    } catch (error) {
      console.log(`[${channelId}] Error generating segment:`, error.message);
      advanceToNext();
    }
    
    state.isGenerating = false;
  }

  function advanceToNext() {
    state.ep++;
    const entry = channelConfig.playlist[state.index];
    if (state.ep > entry.end) {
      state.index++;
      if (state.index >= channelConfig.playlist.length) state.index = 0;
      state.ep = channelConfig.playlist[state.index].start;
    }
  }

  async function startContinuousStream() {
    // Pre-generate first few segments
    for (let i = 0; i < 3; i++) {
      await generateSegment();
      await wait(1000);
    }

    function playNextSegment() {
      if (state.segmentQueue.length === 0) {
        console.log(`[${channelId}] No segments available, waiting...`);
        setTimeout(playNextSegment, 5000);
        return;
      }

      const segmentFile = state.segmentQueue.shift();
      
      const args = [
        '-f', 'concat',
        '-safe', '0',
        '-re',
        '-i', segmentFile,
        '-vf', `drawtext=text='${watermarkText}':fontcolor=white:fontsize=24:x=w-tw-20:y=20`,
        '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency',
        '-c:a', 'aac', '-b:a', '128k',
        '-g', '50', '-sc_threshold', '0',
        '-f', 'hls',
        '-hls_time', '2',
        '-hls_list_size', '10',
        '-hls_flags', 'delete_segments+program_date_time',
        '-hls_segment_type', 'mpegts',
        '-master_pl_name', 'master.m3u8',
        path.join(channelOutput, 'stream_%v.m3u8')
      ];

      console.log(`🔴 [${channelId}] Starting segment playback`);
      const proc = spawn('ffmpeg', args);
      
      proc.stderr.on('data', d => {
        const msg = d.toString();
        if (!msg.includes('frame=') && !msg.includes('bitrate=')) {
          process.stderr.write(`[FFMPEG ${channelId}] ${msg}`);
        }
      });
      
      proc.on('exit', () => {
        fs.unlinkSync(segmentFile).catch(() => {});
        
        // Generate next segment while current one plays
        if (state.segmentQueue.length < 2) {
          generateSegment();
        }
        
        // Play next segment immediately for seamless transition
        setTimeout(playNextSegment, 100);
      });
      
      state.process = proc;
    }

    playNextSegment();

    // Keep generating segments in background
    setInterval(() => {
      if (state.segmentQueue.length < 3) {
        generateSegment();
      }
    }, 30000);
  }

  startContinuousStream();
  app.use(`/hls/${channelId}`, express.static(channelOutput));
}

// API Routes
app.post('/api/add-anime', async (req, res) => {
  const { channelId, title, start, end } = req.body;
  if (!channels[channelId]) {
    return res.status(400).json({ error: 'Invalid channel ID' });
  }
  channels[channelId].playlist.push({ title, start: parseInt(start), end: parseInt(end) });
  
  channels[channelId].schedule = await generateAccurateSchedule(channels[channelId]);
  fs.writeFileSync(channelsFile, JSON.stringify(channels, null, 2));
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

app.get('/api/current/:channelId', (req, res) => {
  const channelId = req.params.channelId;
  if (!channels[channelId]) {
    return res.status(400).json({ error: 'Invalid channel ID' });
  }
  
  const now = new Date();
  const schedule = channels[channelId].schedule;
  const current = schedule.find(item => {
    const start = new Date(now.toDateString() + ' ' + item.startTime);
    const end = new Date(now.toDateString() + ' ' + item.endTime);
    return now >= start && now <= end;
  });
  
  res.json(current || { title: 'No current program', startTime: '', endTime: '' });
});

// Launch all channels with seamless streaming
for (const [id, config] of Object.entries(channels)) {
  // Use the pre-generated approach for most reliable seamless experience
  setupPreGeneratedChannel(id, config);
}

app.listen(PORT, () => {
  console.log(`🚀 Seamless Live TV Server running on http://localhost:${PORT}`);
  console.log(`🔗 Channels:`);
  Object.keys(channels).forEach(id => {
    console.log(`- http://localhost:${PORT}/watch/${id}`);
  });
  console.log(`- http://localhost:${PORT}/add-anime`);
});
