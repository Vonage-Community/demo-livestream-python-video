// app.js
// Single-page app managing three views:
//   1. Home       — choose broadcast or view
//   2. Broadcaster — capture camera, go live
//   3. Viewer list — browse live broadcasts
//   4. Watch       — play a selected broadcast

// Shared state
let otSession   = null;   // Vonage session object
let otPublisher = null;   // Vonage publisher object
let pollInterval = null;  // setInterval handle for status polling
let broadcastId = null;   // broadcastId for polling, joining, and stopping a broadcast     

// Get the #app div
const appEl = () => document.getElementById('app');

// VIEW 1 — Home
function renderHome() {

    console.log('Rendering index page ...');
  if (otSession) {
    otSession.disconnect();
    otSession   = null;
    otPublisher = null;
  }
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }

  appEl().innerHTML = `
    <div class="home-options">
      <div class="option-card" onclick="renderBroadcaster()">
        <div class="icon">🎥</div>
        <h3>Broadcast a Livestream</h3>
      </div>
      <div class="option-card" onclick="renderBroadcastList()">
        <div class="icon">📺</div>
        <h3>View a Livestream</h3>
      </div>
    </div>
  `;
}

// VIEW 2 — Broadcaster
function renderBroadcaster() {
    console.log('[broadcaster] Rendering broadcaster page');
  appEl().innerHTML = `
    <div id="video-container"></div>
    <p id="status">Connecting to session ...</p>
    <div class="controls">
      <input id="broadcast-name" type="text" placeholder="Name your broadcast" />
    </div>
    
    <!-- RTMP section — optional -->
    <details style="margin-top:1rem; color:#aaa;">
      <summary style="cursor:pointer;">+ Stream to YouTube / Twitch (optional)</summary>
      <div class="controls" style="margin-top:1rem; flex-direction:column; align-items:flex-start;">
        <input id="rtmp-url"    type="text" placeholder="RTMP server URL e.g. rtmp://a.rtmp.youtube.com/live2" />
        <input id="rtmp-key"   type="text" placeholder="Stream key" />
      </div>
    </details>

    <div class="controls">
      <button id="go-live-btn" class="btn-live" disabled>Go Live</button>
      <button id="stop-btn"    class="btn-stop" disabled>Stop</button>
    </div>
    <div class="controls">
      <button class="btn-back" onclick="renderHome()">← Back</button>
    </div>
  `;

  initBroadcaster();
}

async function initBroadcaster() {
  const statusEl  = document.getElementById('status');
  const goLiveBtn = document.getElementById('go-live-btn');
  const stopBtn   = document.getElementById('stop-btn');

  // Fetch the token
  let credentials;
  try {
    console.log('[broadcaster] Fetching token');
    const res = await fetch('/token');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    credentials = await res.json();
  } catch (err) {
    statusEl.textContent = `❌ Failed to fetch token: ${err.message}`;
    return;
  }

  const { apiKey, sessionId, token } = credentials;

  // Initialize session
  otSession = OT.initSession(apiKey, sessionId);
  console.log('[broadcaster] Initializing session ...');

  otSession.on('sessionDisconnected', (event) => {
    statusEl.textContent = `⚠️ Disconnected: ${event.reason}`;
    goLiveBtn.disabled = true;
  });

  otSession.on('exception', (event) => {
    console.error('[broadcaster] OT exception:', event.message);
  });

  // Initialize publisher (camera preview)
  otPublisher = OT.initPublisher('video-container', {
    insertMode: 'append',
    width: '100%',
    height: '100%',
    name: 'Broadcaster',
    publishAudio: true,
    publishVideo: true,
  }, (err) => {
    console.log('[broadcaster] Initializing publisher ...');
    if (err) {
      statusEl.textContent = `❌ Camera/mic error: ${err.message}`;
    }
  });

  // Connect and publish
  otSession.connect(token, (err) => {
    if (err) {
      statusEl.textContent = `❌ Connection error: ${err.message}`;
      return;
    }

    otSession.publish(otPublisher, (pubErr) => {
      if (pubErr) {
        console.error('[broadcaster] publish error:', pubErr);
        return;
      }
      statusEl.textContent = '✅ Connected. Ready to go live.';
      goLiveBtn.disabled = false;
    });
  });

  // Go Live button 
  goLiveBtn.addEventListener('click', async () => {
    const name = document.getElementById('broadcast-name').value.trim()
                 || 'Untitled Broadcast';
    const rtmpUrl    = document.getElementById('rtmp-url').value.trim();
    const rtmpKey    = document.getElementById('rtmp-key').value.trim();

    // Include rtmp in the payload only if both fields are filled in
    const rtmp = rtmpUrl && rtmpKey
        ? { server_url: rtmpUrl, stream_name: rtmpKey }
        : null;

    goLiveBtn.disabled = true;
    statusEl.textContent = '⏳ Starting broadcast ...';
        
    try {
      const res = await fetch('/broadcast/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, rtmp }),
      });
      console.log('[broadcaster] Starting broadcast ...');
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || `HTTP ${res.status}`);
      }
      const data = await res.json();
      broadcastId = data.broadcastId;
      console.log('[broadcaster] broadcast started:', data);
      console.log('[broadcaster] broadcast started with broadcastId:', broadcastId);
    } catch (err) {
      statusEl.textContent = `❌ Failed to start broadcast: ${err.message}`;
      goLiveBtn.disabled = false;
      return;
    }

    // Poll for hlsStatus === "ready"
    pollInterval = setInterval(async () => {
      try {
        const res  = await fetch(`/broadcast/status/${broadcastId}`);
        const data = await res.json();
        console.log('[broadcaster] poll status:', data.hlsStatus);

        if (data.hlsStatus === 'ready') {
            console.log('[broadcaster] status is ready!');
          clearInterval(pollInterval);
          pollInterval = null;

          statusEl.textContent = '🔴 Live';
          statusEl.classList.add('live');
          stopBtn.disabled = false;
        }
      } catch (err) {
        console.error('[broadcaster] poll error:', err);
      }
    }, 3000);
  });

  // Stop button
  stopBtn.addEventListener('click', async () => {
    stopBtn.disabled = true;

    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }

    try {
      await fetch(`/broadcast/stop/${broadcastId}`, { method: 'POST' });
      console.log('[broadcaster] stopping broadcastId:', broadcastId);
    } catch (err) {
      console.error('[broadcaster] stop error:', err);
    }
    console.log('[broadcaster] broadcast stopped');

    statusEl.textContent = '⏹ Broadcast stopped.';
    statusEl.classList.remove('live');
    goLiveBtn.disabled = false;
  });
}

// VIEW 3 — Broadcast list
async function renderBroadcastList() {
    console.log('[broadcast list] Rendering list');
  appEl().innerHTML = `<p id="status">Loading broadcasts ... </p>`;

  let broadcasts;

  try {
    const res = await fetch('/broadcast/list');
    const data = await res.json();
    broadcasts = data.broadcasts;
  } catch (err) {
    appEl().innerHTML = `<p>❌ Failed to load broadcasts: ${err.message}</p>`;
    return;
  }

  if (!broadcasts.length) {
    appEl().innerHTML = `
      <p class="empty-state">No live broadcasts right now.</p>
      <div class="controls">
        <button class="btn-back" onclick="renderHome()">← Back</button>
      </div>
    `;
    return;
  }

  appEl().innerHTML = `
    <h2>Live Now</h2>
    <div class="broadcast-list">
      ${broadcasts.map(b => `
        <div class="broadcast-card" onclick="renderWatch('${b.broadcastId}', '${b.name}')">
          <h3>${b.name}</h3>
          <span class="live-badge">🔴 Live</span>
        </div>
      `).join('')}
    </div>
    <div class="controls" style="margin-top:1.5rem">
      <button class="btn-back" onclick="renderHome()">← Back</button>
    </div>
  `;
}

// VIEW 4 — Watch a broadcast
function renderWatch(broadcastId, name) {
    console.log('[viewer] Rendering viewer');
  appEl().innerHTML = `
    <h2>${name}</h2>
    <div id="video-container">
      <video id="video" controls autoplay playsinline muted></video>
    </div>
    <p id="status">⏳ Loading stream ...</p>
    <div class="controls">
      <button class="btn-back" onclick="renderViewerList()">← Back to list</button>
    </div>
  `;

  initViewer(broadcastId);
}

async function initViewer(broadcastId) {
  const video    = document.getElementById('video');
  const statusEl = document.getElementById('status');

  pollInterval = setInterval(async () => {
    try {
      const res  = await fetch(`/broadcast/status/${broadcastId}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      console.log('[viewer] poll:', data);

      if (data.hlsStatus === 'ready') {
        clearInterval(pollInterval);
        pollInterval = null;

        statusEl.textContent = '🔴 Live';
        statusEl.classList.add('live');

        if (Hls.isSupported()) {
          const hls = new Hls();
          hls.loadSource(data.hlsUrl);
          hls.attachMedia(video);
          hls.on(Hls.Events.ERROR, (event, data) => {
            console.error('[viewer] hls.js error:', data);
          });
        } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
          video.src = data.hlsUrl;
        } else {
          statusEl.textContent = '❌ HLS not supported in this browser.';
        }
      }
    } catch (err) {
      console.error('[viewer] poll error:', err);
    }
  }, 3000);

  video.addEventListener('playing', () => {
    statusEl.style.display = 'none';
  });
}

// Init — render home on load
async function init() {
    await fetch('/session', { method: 'POST' });
    renderHome();
}

init();
