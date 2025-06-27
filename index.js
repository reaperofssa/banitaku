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
        {
          title: 'Blue Lock',
          episodes: [
            { episode: 1, mp4Link: 'https://vault-99.kwik.cx/mp4/99/01/9e4bf99fca838799307e409c951b3cb10023abffa71b075f681059b33485218d?file=AnimePahe_Your_Forma_-_13_360p_B-Global.mp4' },
            { episode: 2, mp4Link: 'https://vault-99.kwik.cx/mp4/99/01/9e4bf99fca838799307e409c951b3cb10023abffa71b075f681059b33485218d?file=AnimePahe_Your_Forma_-_13_360p_B-Global.mp4' },
            { episode: 3, mp4Link: 'https://vault-99.kwik.cx/mp4/99/01/9e4bf99fca838799307e409c951b3cb10023abffa71b075f681059b33485218d?file=AnimePahe_Your_Forma_-_13_360p_B-Global.mp4' }
          ]
        },
        {
          title: 'Erased',
          episodes: [
            { episode: 1, mp4Link: 'https://vault-99.kwik.cx/mp4/99/01/9e4bf99fca838799307e409c951b3cb10023abffa71b075f681059b33485218d?file=AnimePahe_Your_Forma_-_13_360p_B-Global.mp4' },
            { episode: 2, mp4Link: 'https://vault-99.kwik.cx/mp4/99/01/9e4bf99fca838799307e409c951b3cb10023abffa71b075f681059b33485218d?file=AnimePahe_Your_Forma_-_13_360p_B-Global.mp4' }
          ]
        }
      ],
      schedule: [],
      currentEpisode: null,
      currentStartTime: null,
      currentEndTime: null
    },
    channel2: {
      name: 'Anitaku TV 2',
      playlist: [
        {
          title: 'Eminence in Shadow',
          episodes: [
            { episode: 1, mp4Link: 'https://vault-99.kwik.cx/mp4/99/01/9e4bf99fca838799307e409c951b3cb10023abffa71b075f681059b33485218d?file=AnimePahe_Your_Forma_-_13_360p_B-Global.mp4' },
            { episode: 2, mp4Link: 'https://vault-99.kwik.cx/mp4/99/01/9e4bf99fca838799307e409c951b3cb10023abffa71b075f681059b33485218d?file=AnimePahe_Your_Forma_-_13_360p_B-Global.mp4' }
          ]
        }
      ],
      schedule: [],
      currentEpisode: null,
      currentStartTime: null,
      currentEndTime: null
    },
    channel3: {
      name: 'Anitaku TV 3',
      playlist: [
        {
          title: 'Attack on Titan',
          episodes: [
            { episode: 1, mp4Link: 'https://vault-99.kwik.cx/mp4/99/01/9e4bf99fca838799307e409c951b3cb10023abffa71b075f681059b33485218d?file=AnimePahe_Your_Forma_-_13_360p_B-Global.mp4' },
            { episode: 2, mp4Link: 'https://vault-99.kwik.cx/mp4/99/01/9e4bf99fca838799307e409c951b3cb10023abffa71b075f681059b33485218d?file=AnimePahe_Your_Forma_-_13_360p_B-Global.mp4' }
          ]
        }
      ],
      schedule: [],
      currentEpisode: null,
      currentStartTime: null,
      currentEndTime: null
    },
    channel4: {
      name: 'Anitaku TV 4',
      playlist: [
        {
          title: 'Squid Game',
          episodes: [
            { episode: 1, mp4Link: 'https://valiw.hakunaymatata.com/resource/1c2360141004ae7653dae900a2b5abed.mp4?auth_key=1751011264-0-0-ea0da19233216cf088a2a542d8cee173' },
            { episode: 2, mp4Link: 'https://vault-99.kwik.cx/mp4/99/01/61f1515945c0f7daddfc174b8561fe2bc3e6179e4ef26c51425e5efdccc3b332?file=AnimePahe_Your_Forma_-_12_360p_B-Global.mp4' }
          ]
        }
      ],
      schedule: [],
      currentEpisode: null,
      currentStartTime: null,
      currentEndTime: null
    },
    channel5: {
      name: 'Anitaku TV 5',
      playlist: [
        {
          title: 'Redo Of Healer',
          episodes: [
            { episode: 1, mp4Link: 'https://vault-99.kwik.cx/mp4/99/01/9e4bf99fca838799307e409c951b3cb10023abffa71b075f681059b33485218d?file=AnimePahe_Your_Forma_-_13_360p_B-Global.mp4' },
            { episode: 2, mp4Link: 'https://vault-99.kwik.cx/mp4/99/01/9e4bf99fca838799307e409c951b3cb10023abffa71b075f681059b33485218d?file=AnimePahe_Your_Forma_-_13_360p_B-Global.mp4' }
          ]
        }
      ],
      schedule: [],
      currentEpisode: null,
      currentStartTime: null,
      currentEndTime: null
    },
    channel6: {
      name: 'Anitaku TV 6',
      playlist: [
        {
          title: 'Onagaku Shoujo',
          episodes: [
            { episode: 1, mp4Link: 'https://vault-99.kwik.cx/mp4/99/01/9e4bf99fca838799307e409c951b3cb10023abffa71b075f681059b33485218d?file=AnimePahe_Your_Forma_-_13_360p_B-Global.mp4' },
            { episode: 2, mp4Link: 'https://vault-99.kwik.cx/mp4/99/01/9e4bf99fca838799307e409c951b3cb10023abffa71b075f681059b33485218d?file=AnimePahe_Your_Forma_-_13_360p_B-Global.mp4' }
          ]
        }
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

// Get episode MP4 link from playlist
function getEpisodeMp4(animeEntry, episodeNumber) {
  const episode = animeEntry.episodes.find(ep => ep.episode === episodeNumber);
  return episode ? episode.mp4Link : null;
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
    const animeEntry = channelConfig.playlist[tempIndex];
    if (!animeEntry) break;

    // Check if episode exists
    if (tempEp > animeEntry.episodes.length) {
      tempIndex++;
      if (tempIndex >= channelConfig.playlist.length) break;
      tempEp = 1; // Start from episode 1 of next anime
      continue;
    }

    const url = getEpisodeMp4(animeEntry, tempEp);
    if (url) {
      const duration = await getVideoDuration(url);
      const startTime = new Date(currentTime);
      const endTime = new Date(currentTime.getTime() + duration);

      schedule.push({
        title: `${animeEntry.title} Episode ${tempEp}`,
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
    ep: 1, // Start from episode 1
    currentProcess: null,
    nextProcess: null,
    anime: channelConfig.playlist[0]?.title || '',
    activeSlot: 'A', // A or B
    nextSlot: 'B',
    isPlaying: false,
    retryCount: 0,
    preloadReady: false,
    isFinished: false // Track if playlist is finished
  };

  channelStates[channelId] = state;

  const channelOutput = path.join(baseOutputDir, channelId);
  if (fs.existsSync(channelOutput)) fs.rmSync(channelOutput, { recursive: true, force: true });
  fs.mkdirSync(channelOutput, { recursive: true });

  function getNextEpisodeInfo() {
    const animeEntry = channelConfig.playlist[state.index];
    let nextEp = state.ep + 1;
    let nextIndex = state.index;

    if (nextEp > animeEntry.episodes.length) {
      nextIndex++;
      if (nextIndex >= channelConfig.playlist.length) {
        return null; // Playlist finished
      }
      nextEp = 1; // Start from episode 1 of next anime
    }

    return {
      index: nextIndex,
      ep: nextEp,
      anime: channelConfig.playlist[nextIndex].title
    };
  }

  async function preloadNextEpisode() {
    if (state.isFinished) return false;

    const nextInfo = getNextEpisodeInfo();
    if (!nextInfo) {
      console.log(`[${channelId}] ❌ Playlist finished, waiting for new episodes`);
      state.isFinished = true;
      return false;
    }

    const animeEntry = channelConfig.playlist[nextInfo.index];
    const url = getEpisodeMp4(animeEntry, nextInfo.ep);

    if (!url) {
      console.log(`[${channelId}] ❌ Failed to preload ${nextInfo.anime} Episode ${nextInfo.ep} - no MP4 link found`);
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

    if (state.isFinished) {
      console.log(`[${channelId}] Playlist finished, waiting for new episodes`);
      return;
    }

    const animeEntry = channelConfig.playlist[state.index];
    if (!animeEntry) {
      console.log(`[${channelId}] No anime available in playlist`);
      state.isFinished = true;
      return;
    }

    console.log(`🎬 [${channelId}] Playing ${animeEntry.title} Episode ${state.ep} in slot ${state.activeSlot}`);

    const url = getEpisodeMp4(animeEntry, state.ep);
    if (!url) {
      console.log(`[${channelId}] ❌ No MP4 link found for ${animeEntry.title} Episode ${state.ep}`);
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
    channelConfig.currentEpisode = `${animeEntry.title} Episode ${state.ep}`;
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

    console.log(`▶️  [${channelId}] Playing ${animeEntry.title} Episode ${state.ep} (${Math.round(duration/60000)}min) in slot ${state.activeSlot}`);

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
    const animeEntry = channelConfig.playlist[state.index];
    if (!animeEntry) {
      state.isFinished = true;
      return;
    }

    state.ep++;

    if (state.ep > animeEntry.episodes.length) {
      state.index++;
      if (state.index >= channelConfig.playlist.length) {
        state.isFinished = true;
        console.log(`[${channelId}] Playlist finished, waiting for new episodes`);
        return;
      }
      state.ep = 1; // Start from episode 1 of next anime
      console.log(`📺 [${channelId}] Moving to next anime: ${channelConfig.playlist[state.index].title}`);
    }

    // Update state and continue
    state.isPlaying = false;
    setTimeout(playEpisode, 1000);
  }

  // Initial schedule generation
  channelConfig.schedule = await generateDynamicSchedule(channelId, channelConfig, null);

  // Start the first episode if playlist exists
  if (channelConfig.playlist.length > 0) {
    playEpisode();
  }

  // Serve HLS files
  app.use(`/hls/${channelId}`, express.static(channelOutput));
}

// Route to play playlist again
app.post('/api/play-again/:channelId', async (req, res) => {
  try {
    const channelId = req.params.channelId;
    if (!channels[channelId]) {
      return res.status(400).json({ error: 'Invalid channel ID' });
    }

    const state = channelStates[channelId];
    state.index = 0;
    state.ep = 1;
    state.isFinished = false;
    state.isPlaying = false;
    state.anime = channels[channelId].playlist[0]?.title || '';
    
    // Stop current playback
    if (state.currentProcess) {
      state.currentProcess.kill('SIGTERM');
    }
    if (state.nextProcess) {
      state.nextProcess.kill('SIGTERM');
    }

    // Reset current episode info
    channels[channelId].currentEpisode = null;
    channels[channelId].currentStartTime = null;
    channels[channelId].currentEndTime = null;

    // Regenerate schedule
    channels[channelId].schedule = await generateDynamicSchedule(channelId, channels[channelId], null);
    
    // Save changes
    fs.writeFileSync(channelsFile, JSON.stringify(channels, null, 2));

    // Start playing from beginning
    setTimeout(() => playEpisode(), 1000);

    res.json({
      success: true,
      message: `Restarted playlist for ${channels[channelId].name}`
    });
  } catch (error) {
    console.error('Error restarting playlist:', error);
    res.status(500).json({ error: 'Internal server error while restarting playlist' });
  }
});

// Route to add new anime
app.get('/add-anime', (req, res) => {
  const filePath = path.join(publicDir, 'add-anime.html');
  res.sendFile(filePath);
});

// Modified route to add new anime with priority options
app.post('/api/add-anime', async (req, res) => {
  try {
    const { channelId, title, episodes, playImmediately, playAfterCurrentAnime } = req.body;

    // Validate channel
    if (!channels[channelId]) {
      return res.status(400).json({ error: 'Invalid channel ID' });
    }

    // Validate required fields
    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'Anime title is required' });
    }

    // Validate episodes format
    if (!Array.isArray(episodes) || episodes.length === 0) {
      return res.status(400).json({ error: 'Episodes must be an array with at least one episode' });
    }

    // Validate each episode has required fields
    for (const ep of episodes) {
      if (!ep.episode || !ep.mp4Link || !ep.mp4Link.trim()) {
        return res.status(400).json({
          error: 'Each episode must have episode number and valid mp4Link'
        });
      }

      // Ensure episode number is valid
      if (isNaN(parseInt(ep.episode)) || parseInt(ep.episode) < 1) {
        return res.status(400).json({
          error: 'Episode numbers must be positive integers'
        });
      }
    }

    // Validate mutually exclusive flags
    if (playImmediately && playAfterCurrentAnime) {
      return res.status(400).json({
        error: 'Cannot set both playImmediately and playAfterCurrentAnime'
      });
    }

    // Sort episodes by episode number and ensure proper format
    const sortedEpisodes = episodes
      .map(ep => ({
        episode: parseInt(ep.episode),
        mp4Link: ep.mp4Link.trim()
      }))
      .sort((a, b) => a.episode - b.episode);

    // Add anime to playlist
    const newAnime = {
      title: title.trim(),
      episodes: sortedEpisodes
    };

    const state = channelStates[channelId];
    let queuePosition;

    if (playImmediately) {
      // Insert at next position (after current anime) and play immediately
      const insertIndex = state.index + 1 >= channels[channelId].playlist.length ? 0 : state.index + 1;
      channels[channelId].playlist.splice(insertIndex, 0, newAnime);

      // Update state to play this anime next
      state.index = insertIndex;
      state.ep = 1;
      state.anime = title.trim();
      state.isPlaying = false; // Trigger immediate playback
      state.isFinished = false;
      console.log(`📺 [${channelId}] Prioritizing "${title}" to play immediately`);

      // Stop current playback to switch to new anime
      if (state.currentProcess) {
        state.currentProcess.kill('SIGTERM');
      }
      setTimeout(() => playEpisode(), 1000);
      queuePosition = insertIndex + 1;
    } else if (playAfterCurrentAnime) {
      // Insert after current anime, but don't interrupt current playback
      const insertIndex = state.index + 1 >= channels[channelId].playlist.length ? 0 : state.index + 1;
      channels[channelId].playlist.splice(insertIndex, 0, newAnime);
      console.log(`📺 [${channelId}] Queued "${title}" to play after current anime`);
      queuePosition = insertIndex + 1;
    } else {
      // Add to end of playlist
      channels[channelId].playlist.push(newAnime);
      console.log(`📺 [${channelId}] Added anime "${title}" with ${sortedEpisodes.length} episodes to end of queue`);
      queuePosition = channels[channelId].playlist.length;
    }

    // If channel was finished, restart playback
    if (state.isFinished) {
      state.isFinished = false;
      state.isPlaying = false;
      setTimeout(() => playEpisode(), 1000);
    }

    // Regenerate schedule with proper async handling
    const currentInfo = channels[channelId].currentStartTime ? {
      title: channels[channelId].currentEpisode,
      startTime: new Date(channels[channelId].currentStartTime),
      endTime: new Date(channels[channelId].currentEndTime)
    } : null;

    channels[channelId].schedule = await generateDynamicSchedule(channelId, channels[channelId], currentInfo);

    // Save to file
    fs.writeFileSync(channelsFile, JSON.stringify(channels, null, 2));

    res.json({
      success: true,
      message: `Added "${title}" to ${channels[channelId].name} ${playImmediately ? 'playing immediately' : playAfterCurrentAnime ? 'playing after current anime' : 'queue'}`,
      queuePosition: queuePosition
    });

  } catch (error) {
    console.error('Error adding anime:', error);
    res.status(500).json({ error: 'Internal server error while adding anime' });
  }
});

// Modified route to add episode to existing anime with priority option
app.post('/api/add-episode', async (req, res) => {
  try {
    const { channelId, animeTitle, episode, mp4Link, playImmediately } = req.body;

    // Validate inputs
    if (!channelId || !animeTitle || !episode || !mp4Link) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    if (!channels[channelId]) {
      return res.status(400).json({ error: 'Invalid channel ID' });
    }

    // Validate episode number
    const episodeNum = parseInt(episode);
    if (isNaN(episodeNum) || episodeNum < 1) {
      return res.status(400).json({ error: 'Episode number must be a positive integer' });
    }

    // Validate MP4 link
    if (!mp4Link.trim()) {
      return res.status(400).json({ error: 'MP4 link cannot be empty' });
    }

    const animeEntry = channels[channelId].playlist.find(
      anime => anime.title.toLowerCase() === animeTitle.toLowerCase().trim()
    );

    if (!animeEntry) {
      return res.status(400).json({ error: 'Anime not found in channel playlist' });
    }

    // Check if episode already exists
    const existingEpisode = animeEntry.episodes.find(ep => ep.episode === episodeNum);
    if (existingEpisode) {
      return res.status(400).json({ error: `Episode ${episodeNum} already exists` });
    }

    // Add new episode
    animeEntry.episodes.push({
      episode: episodeNum,
      mp4Link: mp4Link.trim()
    });

    // Sort episodes by episode number
    animeEntry.episodes.sort((a, b) => a.episode - b.episode);

    console.log(`📺 [${channelId}] Added Episode ${episodeNum} to "${animeTitle}"`);

    const state = channelStates[channelId];
    if (playImmediately && state.anime.toLowerCase() === animeTitle.toLowerCase()) {
      // If adding to current anime and playImmediately is true, set to play this episode next
      state.ep = episodeNum - 1; // Set to play this episode next
      state.isPlaying = false; // Trigger immediate playback
      state.isFinished = false;
      console.log(`📺 [${channelId}] Prioritizing Episode ${episodeNum} of "${animeTitle}" to play next`);

      // Stop current playback to switch to new episode
      if (state.currentProcess) {
        state.currentProcess.kill('SIGTERM');
      }
      setTimeout(() => playEpisode(), 1000);
    }

    // If channel was finished, restart playback
    if (state.isFinished) {
      state.isFinished = false;
      state.isPlaying = false;
      setTimeout(() => playEpisode(), 1000);
    }

    // Regenerate schedule with proper async handling
    const currentInfo = channels[channelId].currentStartTime ? {
      title: channels[channelId].currentEpisode,
      startTime: new Date(channels[channelId].currentStartTime),
      endTime: new Date(channels[channelId].currentEndTime)
    } : null;

    channels[channelId].schedule = await generateDynamicSchedule(channelId, channels[channelId], currentInfo);

    // Save to file
    fs.writeFileSync(channelsFile, JSON.stringify(channels, null, 2));

    res.json({
      success: true,
      message: `Added Episode ${episodeNum} to "${animeTitle}" ${playImmediately && state.anime.toLowerCase() === animeTitle.toLowerCase() ? 'playing next' : ''}`,
      totalEpisodes: animeEntry.episodes.length
    });

  } catch (error) {
    console.error('Error adding episode:', error);
    res.status(500).json({ error: 'Internal server error while adding episode' });
  }
});

// Route to get queue status for a channel
app.get('/api/queue/:channelId', (req, res) => {
  const channelId = req.params.channelId;

  if (!channels[channelId]) {
    return res.status(400).json({ error: 'Invalid channel ID' });
  }

  const state = channelStates[channelId];
  const playlist = channels[channelId].playlist;

  // Calculate queue - what's coming up
  const currentIndex = state?.index || 0;
  const queue = playlist.slice(currentIndex).map((anime, index) => ({
    position: index + 1,
    title: anime.title,
    episodeCount: anime.episodes.length,
    status: index === 0 ? 'currently_playing' : 'queued'
  }));

  res.json({
    channelName: channels[channelId].name,
    totalAnime: playlist.length,
    currentlyPlaying: state?.anime || 'None',
    currentEpisode: state?.ep || 0,
    isFinished: state?.isFinished || false,
    queue: queue
  });
});

// Route to reorder anime in queue
app.post('/api/reorder-queue', async (req, res) => {
  try {
    const { channelId, animeTitle, newPosition } = req.body;

    if (!channels[channelId]) {
      return res.status(400).json({ error: 'Invalid channel ID' });
    }

    const playlist = channels[channelId].playlist;
    const currentIndex = playlist.findIndex(
      anime => anime.title.toLowerCase() === animeTitle.toLowerCase()
    );

    if (currentIndex === -1) {
      return res.status(400).json({ error: 'Anime not found' });
    }

    const targetIndex = parseInt(newPosition) - 1;
    if (targetIndex < 0 || targetIndex >= playlist.length) {
      return res.status(400).json({ error: 'Invalid position' });
    }

    // Don't allow moving currently playing anime
    const state = channelStates[channelId];
    if (state && currentIndex === state.index) {
      return res.status(400).json({ error: 'Cannot move currently playing anime' });
    }

    // Move anime to new position
    const [movedAnime] = playlist.splice(currentIndex, 1);
    playlist.splice(targetIndex, 0, movedAnime);

    // Save changes
    fs.writeFileSync(channelsFile, JSON.stringify(channels, null, 2));

    res.json({
      success: true,
      message: `Moved "${animeTitle}" to position ${newPosition}`
    });

  } catch (error) {
    console.error('Error reordering queue:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
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
      preloadReady: state?.preloadReady,
      isFinished: state?.isFinished || false
    };
  }
  res.json(status);
});

// Route to get all channels and their playlists
app.get('/api/channels', (req, res) => {
  const channelData = {};
  for (const [channelId, config] of Object.entries(channels)) {
    channelData[channelId] = {
      name: config.name,
      playlist: config.playlist.map(anime => ({
        title: anime.title,
        episodeCount: anime.episodes.length,
        episodes: anime.episodes
      }))
    };
  }
  res.json(channelData);
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
  console.log(`- http://localhost:${PORT}/api/channels`);
});
