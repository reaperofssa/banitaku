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

// Global state to track current playing episodes
const channelStates = {};

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
        { title: 'Blue Lock', start: 1, end: 24 }, 
        { title: 'Erased', start: 1, end: 12 } 
      ], 
      schedule: [],
      currentEpisode: null,
      currentStartTime: null,
      currentEndTime: null
    }, 
    channel2: { 
      name: 'Anitaku TV 2', 
      playlist: [ 
        { title: 'Eminence in Shadow', start: 1, end: 20 } 
      ], 
      schedule: [],
      currentEpisode: null,
      currentStartTime: null,
      currentEndTime: null
    }, 
    channel3: { 
      name: 'Anitaku TV 3', 
      playlist: [ 
        { title: 'Attack on Titan', start: 1, end: 25 } 
      ], 
      schedule: [],
      currentEpisode: null,
      currentStartTime: null,
      currentEndTime: null
    }, 
    channel4: { 
      name: 'Anitaku TV 4', 
      playlist: [ 
        { title: 'One Piece', start: 1, end: 35 } 
      ], 
      schedule: [],
      currentEpisode: null,
      currentStartTime: null,
      currentEndTime: null
    }, 
    channel5: { 
      name: 'Anitaku TV 5', 
      playlist: [ 
        { title: 'Redo Of Healer', start: 1, end: 12 } 
      ], 
      schedule: [],
      currentEpisode: null,
      currentStartTime: null,
      currentEndTime: null
    }, 
    channel6: { 
      name: 'Anitaku TV 6', 
      playlist: [ 
        { title: 'Onagaku Shoujo', start: 1, end: 13 } 
      ], 
      schedule: [],
      currentEpisode: null,
      currentStartTime: null,
      currentEndTime: null
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

// Get video duration using ffmpeg with better error handling
async function getVideoDuration(url) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      console.log(`Timeout getting duration for ${url}, using fallback`);
      resolve(22 * 60 * 1000); // 22 minutes fallback
    }, 10000); // 10 second timeout

    ffmpeg.ffprobe(url, (err, metadata) => {
      clearTimeout(timeout);
      if (err) {
        console.error(`Error probing video duration for ${url}:`, err);
        return resolve(22 * 60 * 1000); // Fallback to 22 minutes
      }
      const durationSeconds = metadata.format.duration || 22 * 60;
      resolve(durationSeconds * 1000); // Convert to milliseconds
    });
  });
}

// Generate dynamic schedule that matches current state
async function generateDynamicSchedule(channelId, channelConfig, currentEpisodeInfo) {
  const schedule = [];
  let currentTime = new Date();
  
  // If we have current episode info, start from there
  if (currentEpisodeInfo) {
    schedule.push({
      title: currentEpisodeInfo.title,
      startTime: formatWATTime(currentEpisodeInfo.startTime),
      endTime: formatWATTime(currentEpisodeInfo.endTime),
      current: true
    });
    currentTime = new Date(currentEpisodeInfo.endTime.getTime() + 1000);
  }

  // Generate next episodes in schedule
  const state = channelStates[channelId];
  if (!state) return schedule;

  let tempIndex = state.index;
  let tempEp = state.ep + 1; // Next episode
  
  // Generate next 10 episodes for schedule
  for (let i = 0; i < 10; i++) {
    const entry = channelConfig.playlist[tempIndex];
    if (!entry) break;

    if (tempEp > entry.end) {
      tempIndex++;
      if (tempIndex >= channelConfig.playlist.length) tempIndex = 0;
      tempEp = channelConfig.playlist[tempIndex].start;
      continue;
    }

    const url = await getEpisodeMp4(entry.title, tempEp);
    if (url) {
      const duration = await getVideoDuration(url);
      const startTime = new Date(currentTime);
      const endTime = new Date(currentTime.getTime() + duration);
      
      schedule.push({
        title: `${entry.title} Episode ${tempEp}`,
        startTime: formatWATTime(startTime),
        endTime: formatWATTime(endTime),
        current: false
      });
      
      currentTime = new Date(endTime.getTime() + 1000);
    }
    
    tempEp++;
  }
  
  return schedule;
}

function wait(ms) { 
  return new Promise(resolve => setTimeout(resolve, ms)); 
} 

async function getEpisodeMp4(anime, ep) { 
  try {
    const url = `https://txtorg-anihx.hf.space/api/episode?anime=${encodeURIComponent(anime)}&ep=${ep}`; 
    const data = await axios.get(url, { timeout: 15000 }).then(r => r.data); 
    const dl = data?.links?.sub?.['360p_download']; 
    if (!dl) return null; 
    
    const response = await axios.get(`https://txtorg-anihx.hf.space/resolvex?url=${dl}`, { timeout: 15000 });
    return response.data?.mp4Link || null;
  } catch (error) {
    console.error(`Error getting episode ${anime} ${ep}:`, error.message);
    return null;
  }
} 

function startFFmpeg(channelId, inputUrl, outputDir, episodeNumber, slotId, onExit, onReady) { 
  const args = [ 
    '-re', '-i', inputUrl, 
    '-vf', `drawtext=text='${watermarkText}':fontcolor=white:fontsize=24:x=w-tw-20:y=20,drawtext=text='Ep ${episodeNumber}':fontcolor=white:fontsize=20:x=w-tw-20:y=h-th-20`, 
    '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency', 
    '-c:a', 'aac', '-b:a', '128k', 
    '-g', '50', '-sc_threshold', '0', 
    '-f', 'hls', 
    '-hls_time', '4', 
    '-hls_list_size', '6', 
    '-hls_flags', 'delete_segments+program_date_time+independent_segments', 
    '-hls_segment_type', 'mpegts', 
    '-hls_segment_filename', path.join(outputDir, `segment_${slotId}_%03d.ts`),
    '-master_pl_name', `master_${slotId}.m3u8`, 
    '-y', // Overwrite output files
    path.join(outputDir, `stream_${slotId}.m3u8`) 
  ]; 

  console.log(`🔴 [${channelId}] Starting FFmpeg slot ${slotId} for Episode ${episodeNumber}`); 
  const proc = spawn('ffmpeg', args, {
    stdio: ['ignore', 'pipe', 'pipe']
  }); 
  
  let isReady = false;
  proc.stderr.on('data', data => {
    const output = data.toString();
    
    // Check if HLS is ready (first segments created)
    if (!isReady && output.includes('Opening') && output.includes('.ts')) {
      isReady = true;
      if (onReady) onReady();
    }
    
    // Reduced logging
    if (output.includes('frame=')) {
      const frameMatch = output.match(/frame=\s*(\d+)/);
      if (frameMatch && frameMatch[1] % 200 === 0) {
        process.stderr.write(`[${channelId}-${slotId}] Frame ${frameMatch[1]}\n`);
      }
    } else if (!output.includes('frame=')) {
      process.stderr.write(`[${channelId}-${slotId}] ${output}`);
    }
  });
  
  proc.on('exit', (code) => {
    console.log(`🔴 [${channelId}] FFmpeg slot ${slotId} exited with code ${code}`);
    onExit(code);
  }); 
  
  return proc; 
} 

// Create symbolic link to switch active stream
function switchActiveStream(channelOutput, fromSlot, toSlot) {
  const masterLink = path.join(channelOutput, 'master.m3u8');
  const streamLink = path.join(channelOutput, 'stream.m3u8');
  const newMaster = path.join(channelOutput, `master_${toSlot}.m3u8`);
  const newStream = path.join(channelOutput, `stream_${toSlot}.m3u8`);
  
  try {
    // Remove old links
    if (fs.existsSync(masterLink)) fs.unlinkSync(masterLink);
    if (fs.existsSync(streamLink)) fs.unlinkSync(streamLink);
    
    // Create new symbolic links
    fs.symlinkSync(`master_${toSlot}.m3u8`, masterLink);
    fs.symlinkSync(`stream_${toSlot}.m3u8`, streamLink);
    
    console.log(`🔄 [Channel] Switched from slot ${fromSlot} to slot ${toSlot}`);
    return true;
  } catch (error) {
    console.error(`Error switching streams:`, error);
    return false;
  }
}

async function setupChannel(channelId, channelConfig) {
  const state = {
    index: 0,
    ep: channelConfig.playlist[0].start,
    currentProcess: null,
    nextProcess: null,
    anime: channelConfig.playlist[0].title,
    activeSlot: 'A', // A or B
    nextSlot: 'B',
    isPlaying: false,
    retryCount: 0,
    preloadReady: false
  };

  channelStates[channelId] = state;

  const channelOutput = path.join(baseOutputDir, channelId);
  if (fs.existsSync(channelOutput)) fs.rmSync(channelOutput, { recursive: true, force: true });
  fs.mkdirSync(channelOutput, { recursive: true });

  function getNextEpisodeInfo() {
    const entry = channelConfig.playlist[state.index];
    let nextEp = state.ep + 1;
    let nextIndex = state.index;
    
    if (nextEp > entry.end) {
      nextIndex++;
      if (nextIndex >= channelConfig.playlist.length) nextIndex = 0;
      nextEp = channelConfig.playlist[nextIndex].start;
    }
    
    return {
      index: nextIndex,
      ep: nextEp,
      anime: channelConfig.playlist[nextIndex].title
    };
  }

  async function preloadNextEpisode() {
    const nextInfo = getNextEpisodeInfo();
    const url = await getEpisodeMp4(nextInfo.anime, nextInfo.ep);
    
    if (!url) {
      console.log(`[${channelId}] ❌ Failed to preload ${nextInfo.anime} Episode ${nextInfo.ep}`);
      return false;
    }

    console.log(`🔄 [${channelId}] Preloading ${nextInfo.anime} Episode ${nextInfo.ep} in slot ${state.nextSlot}`);
    
    // Kill existing next process if any
    if (state.nextProcess) {
      state.nextProcess.kill('SIGKILL');
    }

    state.preloadReady = false;
    state.nextProcess = startFFmpeg(
      channelId, 
      url, 
      channelOutput, 
      nextInfo.ep, 
      state.nextSlot,
      (exitCode) => {
        console.log(`✅ [${channelId}] Next episode process ended (${exitCode})`);
        state.nextProcess = null;
      },
      () => {
        console.log(`🟢 [${channelId}] Next episode slot ${state.nextSlot} ready!`);
        state.preloadReady = true;
      }
    );

    return true;
  }

  async function playEpisode() {
    if (state.isPlaying) {
      console.log(`[${channelId}] Already playing, skipping...`);
      return;
    }

    const entry = channelConfig.playlist[state.index];
    console.log(`🎬 [${channelId}] Playing ${entry.title} Episode ${state.ep} in slot ${state.activeSlot}`);

    const url = await getEpisodeMp4(entry.title, state.ep);
    if (!url) {
      console.log(`[${channelId}] ❌ Failed to get URL for ${entry.title} Episode ${state.ep}`);
      state.retryCount++;
      if (state.retryCount < 3) {
        console.log(`[${channelId}] Retrying in 5 seconds... (${state.retryCount}/3)`);
        setTimeout(playEpisode, 5000);
        return;
      } else {
        console.log(`[${channelId}] Max retries reached, skipping to next episode`);
        moveToNextEpisode();
        return;
      }
    }

    state.retryCount = 0;
    state.isPlaying = true;

    // Get duration and set current episode info
    const duration = await getVideoDuration(url);
    const startTime = new Date();
    const endTime = new Date(startTime.getTime() + duration);
    
    // Update channel current episode info
    channelConfig.currentEpisode = `${entry.title} Episode ${state.ep}`;
    channelConfig.currentStartTime = startTime;
    channelConfig.currentEndTime = endTime;

    // Generate updated schedule
    channelConfig.schedule = await generateDynamicSchedule(channelId, channelConfig, {
      title: channelConfig.currentEpisode,
      startTime: startTime,
      endTime: endTime
    });

    // Save updated channel info
    fs.writeFileSync(channelsFile, JSON.stringify(channels, null, 2));

    console.log(`▶️  [${channelId}] Playing ${entry.title} Episode ${state.ep} (${Math.round(duration/60000)}min) in slot ${state.activeSlot}`);

    // Kill existing current process if any
    if (state.currentProcess) {
      state.currentProcess.kill('SIGKILL');
    }

    state.currentProcess = startFFmpeg(
      channelId, 
      url, 
      channelOutput, 
      state.ep, 
      state.activeSlot,
      (exitCode) => {
        state.isPlaying = false;
        console.log(`✅ [${channelId}] Episode ${state.ep} finished (exit code: ${exitCode})`);
        
        if (exitCode === 0 || exitCode === null) {
          switchToNextEpisode();
        } else {
          console.log(`[${channelId}] Unexpected exit, retrying...`);
          setTimeout(playEpisode, 3000);
        }
      },
      () => {
        // Current episode is ready, create initial symlinks
        switchActiveStream(channelOutput, null, state.activeSlot);
        
        // Start preloading next episode after 10 seconds
        setTimeout(() => {
          preloadNextEpisode();
        }, 10000);
        
        // Schedule switch to next episode 30 seconds before current ends
        const switchTime = Math.max(duration - 30000, duration * 0.8);
        setTimeout(() => {
          if (state.preloadReady && state.nextProcess) {
            console.log(`🔄 [${channelId}] Preparing to switch in 30 seconds...`);
          }
        }, switchTime);
      }
    );
  }

  function switchToNextEpisode() {
    // Switch the streams
    const oldSlot = state.activeSlot;
    state.activeSlot = state.nextSlot;
    state.nextSlot = oldSlot;
    
    // Swap processes
    if (state.currentProcess) {
      state.currentProcess.kill('SIGTERM');
    }
    state.currentProcess = state.nextProcess;
    state.nextProcess = null;
    
    // Switch active stream symlinks
    switchActiveStream(channelOutput, oldSlot, state.activeSlot);
    
    moveToNextEpisode();
  }

  function moveToNextEpisode() {
    const entry = channelConfig.playlist[state.index];
    state.ep++;
    
    if (state.ep > entry.end) {
      state.index++;
      if (state.index >= channelConfig.playlist.length) {
        state.index = 0;
      }
      state.ep = channelConfig.playlist[state.index].start;
      console.log(`📺 [${channelId}] Moving to next anime: ${channelConfig.playlist[state.index].title}`);
    }

    // Update state and continue
    state.isPlaying = false;
    setTimeout(playEpisode, 1000);
  }

  // Initial schedule generation
  channelConfig.schedule = await generateDynamicSchedule(channelId, channelConfig, null);
  
  // Start the first episode
  playEpisode();
  
  // Serve HLS files
  app.use(`/hls/${channelId}`, express.static(channelOutput));
} 

// Route to add new anime 
app.post('/api/add-anime', async (req, res) => { 
  const { channelId, title, start, end } = req.body; 
  if (!channels[channelId]) { 
    return res.status(400).json({ error: 'Invalid channel ID' }); 
  } 
  channels[channelId].playlist.push({ title, start: parseInt(start), end: parseInt(end) }); 
  
  // Regenerate schedule
  const currentInfo = channels[channelId].currentStartTime ? {
    title: channels[channelId].currentEpisode,
    startTime: channels[channelId].currentStartTime,
    endTime: channels[channelId].currentEndTime
  } : null;
  
  channels[channelId].schedule = await generateDynamicSchedule(channelId, channels[channelId], currentInfo);
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
  
  // Return fresh schedule with current episode info
  res.json({
    schedule: channels[channelId].schedule,
    currentEpisode: channels[channelId].currentEpisode,
    currentStartTime: channels[channelId].currentStartTime,
    currentEndTime: channels[channelId].currentEndTime
  }); 
}); 

// Route to get current status of all channels
app.get('/api/status', (req, res) => {
  const status = {};
  for (const [channelId, config] of Object.entries(channels)) {
    const state = channelStates[channelId];
    status[channelId] = {
      name: config.name,
      currentEpisode: config.currentEpisode,
      isPlaying: state?.isPlaying || false,
      currentAnime: state?.anime,
      currentEp: state?.ep,
      activeSlot: state?.activeSlot,
      preloadReady: state?.preloadReady
    };
  }
  res.json(status);
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
  console.log(`- http://localhost:${PORT}/api/status`); 
});
