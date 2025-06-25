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

async function getVideoDuration(url) {
  return new Promise((resolve) => {
    const proc = spawn('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'json',
      url
    ]);
    
    let output = '';
    proc.stdout.on('data', (data) => output += data);
    proc.on('close', () => {
      try {
        const duration = parseFloat(JSON.parse(output).format.duration);
        resolve(Math.round(duration * 1000)); // Convert to milliseconds
      } catch {
        resolve(22 * 60 * 1000); // Fallback duration
      }
    });
  });
}

function generateSchedule(channelConfig) {
  const schedule = [];
  let currentTime = new Date();
  
  for (const anime of channelConfig.playlist) {
    for (let ep = anime.start; ep <= anime.end; ep++) {
      const startTime = new Date(currentTime);
      // We'll update duration later when fetching actual video
      const duration = 25 * 60 * 1000; // Placeholder
      const endTime = new Date(currentTime.getTime() + duration);
      
      schedule.push({
        title: `${anime.title} Episode ${ep}`,
        startTime: formatWATTime(startTime),
        endTime: formatWATTime(endTime),
        duration: duration
      });
      
      currentTime = new Date(endTime.getTime() + 1000);
    }
  }
  return schedule;
}

async function getEpisodeMp4(anime, ep) {
  const url = `https://txtorg-anihx.hf.space/api/episode?anime=${encodeURIComponent(anime)}&ep=${ep}`;
  const data = await axios.get(url).then(r => r.data).catch(() => null);
  const dl = data?.links?.sub?.['360p_download'];
  if (!dl) return null;
  const mp4Link = await axios.get(`https://txtorg-anihx.hf.space/resolvex?url=${dl}`)
    .then(r => r.data?.mp4Link)
    .catch(() => null);
  if (!mp4Link) return null;
  
  const duration = await getVideoDuration(mp4Link);
  return { mp4Link, duration };
}

function startFFmpeg(channelId, inputUrl, outputDir, duration, isTransition = false) {
  const args = [
    '-re', '-i', inputUrl,
    '-vf', `drawtext=text='${watermarkText}':fontcolor=white:fontsize=24:x=w-tw-20:y=20`,
    '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency',
    '-c:a', 'aac', '-b:a', '128k',
    '-g', '50', '-sc_threshold', '0',
    '-f', 'hls',
    '-hls_time', '2',
    '-hls_list_size', isTransition ? '100' : '5', // Keep more segments for looping ad
    '-hls_flags', 'delete_segments+program_date_time',
    '-hls_segment_type', 'mpegts',
    '-master_pl_name', 'master.m3u8',
    '-hls_segment_filename', path.join(outputDir, 'stream_%03d.ts'),
    path.join(outputDir, 'stream.m3u8')
  ];

  if (isTransition) {
    args.splice(2, 0, '-stream_loop', '-1'); // Infinite loop for transition
  }

  console.log(`🔴 [${channelId}] Starting FFmpeg for ${inputUrl} ${isTransition ? '(transition)' : ''}`);
  const proc = spawn('ffmpeg', args);
  proc.stderr.on('data', d => process.stderr.write(`[FFMPEG ${channelId}] ${d}`));
  return { proc, duration };
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

  channelConfig.schedule = generateSchedule(channelConfig);

  async function loop() {
    const entry = channelConfig.playlist[state.index];
    state.anime = entry.title;
    state.currentEp = state.ep;

    if (!state.isTransition) {
      const episode = await getEpisodeMp4(entry.title, state.ep);
      if (!episode) {
        console.log(`[${channelId}] ❌ Skipping ep${state.ep} (not found)`);
        state.isTransition = true;
        return loop();
      }

      // Update schedule with actual duration
      const scheduleIndex = state.ep - entry.start + channelConfig.playlist.slice(0, state.index).reduce((sum, a) => sum + (a.end - a.start + 1), 0);
      if (channelConfig.schedule[scheduleIndex]) {
        channelConfig.schedule[scheduleIndex].duration = episode.duration + 180000; // Add 3 min for ad
        const endTime = new Date(new Date(channelConfig.schedule[scheduleIndex].startTime).getTime() + channelConfig.schedule[scheduleIndex].duration);
        channelConfig.schedule[scheduleIndex].endTime = formatWATTime(endTime);
      }

      const { proc, duration } = startFFmpeg(channelId, episode.mp4Link, channelOutput, episode.duration);
      state.process = proc;

      setTimeout(() => {
        state.isTransition = true;
        loop();
      }, duration);
    } else {
      const adDuration = await getVideoDuration(transitionVideo);
      const { proc, duration } = startFFmpeg(channelId, transitionVideo, channelOutput, adDuration, true);
      state.process = proc;

      setTimeout(async () => {
        state.ep++;
        if (state.ep > entry.end) {
          state.index++;
          if (state.index >= channelConfig.playlist.length) state.index = 0;
          state.ep = channelConfig.playlist[state.index].start;
        }
        state.isTransition = false;
        await new Promise(resolve => setTimeout(resolve, 1000));
        loop();
      }, adDuration);
    }
  }

  loop();

  app.use(`/hls/${channelId}`, express.static(channelOutput));
}

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

app.get('/api/schedule/:channelId', (req, res) => {
  const channelId = req.params.channelId;
  if (!channels[channelId]) {
    return res.status(400).json({ error: 'Invalid channel ID' });
  }
  res.json(channels[channelId].schedule);
});

for (const [id, config] of Object.entries(channels)) {
  setupChannel(id, config);
}

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
