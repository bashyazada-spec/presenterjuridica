(function () {
  'use strict';

  const connectView = document.getElementById('connectView');
  const remoteView = document.getElementById('remoteView');
  const joinForm = document.getElementById('joinForm');
  const roomInput = document.getElementById('roomInput');
  const joinBtn = document.getElementById('joinBtn');
  const connectStatus = document.getElementById('connectStatus');
  const connectError = document.getElementById('connectError');

  const connDot = document.getElementById('connDot');
  const connLabel = document.getElementById('connLabel');
  const activeRoomBadge = document.getElementById('activeRoomBadge');
  const reconnectBtn = document.getElementById('reconnectBtn');
  const disconnectBtn = document.getElementById('disconnectBtn');

  const timerDisplay = document.getElementById('timerDisplay');
  const timerToggleBtn = document.getElementById('timerToggleBtn');
  const timerResetBtn = document.getElementById('timerResetBtn');

  const slideJumpBtn = document.getElementById('slideJumpBtn');
  const remoteSlideCounter = document.getElementById('remoteSlideCounter');
  const previewContainer = document.getElementById('previewContainer');
  const remoteSlideImg = document.getElementById('remoteSlideImg');
  const noSlidePlaceholder = document.getElementById('noSlidePlaceholder');
  const blackoutBanner = document.getElementById('blackoutBanner');
  const laserBadge = document.getElementById('laserBadge');
  const laserIndicator = document.getElementById('laserIndicator');

  const remoteNotes = document.getElementById('remoteNotes');
  const remoteBlackoutBtn = document.getElementById('remoteBlackoutBtn');
  const remoteLaserBtn = document.getElementById('remoteLaserBtn');
  const remoteFullscreenBtn = document.getElementById('remoteFullscreenBtn');
  const remotePrevBtn = document.getElementById('remotePrevBtn');
  const remoteNextBtn = document.getElementById('remoteNextBtn');

  const jumpModal = document.getElementById('jumpModal');
  const jumpGrid = document.getElementById('jumpGrid');
  const closeJumpBtn = document.getElementById('closeJumpBtn');

  const PEER_PREFIX = 'slidesync-';
  const ICE_CONFIG = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun.cloudflare.com:3478' }
    ]
  };

  let peer = null;
  let activeConn = null;
  let peerReady = false;
  let pendingRoomCode = '';
  let currentRoomCode = '';
  let connectTimeoutId = null;

  let deckState = {
    currentSlide: 0,
    totalSlides: 0,
    blackout: false,
    notes: '',
    previewDataUrl: null
  };
  let laserMode = false;
  let wakeLock = null;

  // --- Screen Wake Lock (works automatically on Vercel HTTPS) ---
  async function requestWakeLock() {
    try {
      if ('wakeLock' in navigator && !wakeLock) {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => {
          wakeLock = null;
        });
      }
    } catch {
      // Ignore if device is in battery saver mode
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && currentRoomCode) {
      requestWakeLock();
      if (!activeConn || !activeConn.open) {
        connectToRoom(currentRoomCode);
      }
    }
  });

  function haptic(ms = 20) {
    if (navigator.vibrate) navigator.vibrate(ms);
  }

  // --- PeerJS Initialization ---
  function initPeer() {
    if (peer && !peer.destroyed) return;
    peerReady = false;
    peer = new window.Peer({ debug: 1, config: ICE_CONFIG });

    peer.on('open', () => {
      peerReady = true;
      if (pendingRoomCode) {
        const code = pendingRoomCode;
        pendingRoomCode = '';
        connectToRoom(code);
      }
    });

    peer.on('disconnected', () => {
      peerReady = false;
      if (peer && !peer.destroyed) {
        try { peer.reconnect(); } catch {}
      }
    });

    peer.on('error', (err) => {
      clearTimeout(connectTimeoutId);
      joinBtn.disabled = false;
      connectStatus.classList.add('hidden');

      if (err.type === 'peer-unavailable') {
        showConnectError(
          `Room "${currentRoomCode || roomInput.value.toUpperCase()}" was not found. Make sure the desktop presenter tab is open.`
        );
      } else {
        showConnectError('Connection error (' + err.type + '). Please try again.');
      }
    });
  }

  function showConnectError(msg) {
    connectError.textContent = msg;
    connectError.classList.remove('hidden');
    connectView.classList.remove('hidden');
    remoteView.classList.add('hidden');
  }

  function connectToRoom(rawCode) {
    const clean = String(rawCode || '').toUpperCase().replace(/[^A-Z0-9]/g, '').trim();
    if (!clean) return;

    currentRoomCode = clean;
    connectError.classList.add('hidden');
    connectStatus.textContent = `Connecting to room ${clean}...`;
    connectStatus.classList.remove('hidden');
    joinBtn.disabled = true;

    if (!peer || peer.destroyed) {
      pendingRoomCode = clean;
      initPeer();
      return;
    }

    if (!peerReady) {
      pendingRoomCode = clean;
      if (peer.disconnected) {
        try { peer.reconnect(); } catch {}
      }
      return;
    }

    if (activeConn) {
      try { activeConn.close(); } catch {}
      activeConn = null;
    }

    const conn = peer.connect(PEER_PREFIX + clean, { reliable: true });
    activeConn = conn;

    clearTimeout(connectTimeoutId);
    connectTimeoutId = setTimeout(() => {
      if (!conn.open) {
        try { conn.close(); } catch {}
        joinBtn.disabled = false;
        connectStatus.classList.add('hidden');
        showConnectError('Connection timed out. Verify the room code and reload if needed.');
      }
    }, 12000);

    conn.on('open', () => {
      clearTimeout(connectTimeoutId);
      joinBtn.disabled = false;
      connectStatus.classList.add('hidden');

      activeRoomBadge.textContent = `ROOM ${clean}`;
      connectView.classList.add('hidden');
      remoteView.classList.remove('hidden');

      setConnectionStatus(true);
      requestWakeLock();
    });

    conn.on('data', (msg) => {
      if (msg && msg.type === 'state') {
        applyDeckState(msg.state);
      }
    });

    conn.on('close', () => {
      if (activeConn === conn) {
        setConnectionStatus(false);
      }
    });

    conn.on('error', () => {
      if (activeConn === conn) {
        setConnectionStatus(false);
      }
    });
  }

  function setConnectionStatus(online) {
    connDot.classList.toggle('offline', !online);
    connLabel.textContent = online ? 'Connected' : 'Disconnected';
    reconnectBtn.classList.toggle('hidden', online);
  }

  function applyDeckState(state) {
    if (!state) return;
    deckState = { ...deckState, ...state };

    if (deckState.totalSlides > 0) {
      remoteSlideCounter.textContent = `Slide ${deckState.currentSlide + 1} / ${deckState.totalSlides}`;
      remotePrevBtn.disabled = deckState.currentSlide <= 0;
      remoteNextBtn.disabled = deckState.currentSlide >= deckState.totalSlides - 1;
    } else {
      remoteSlideCounter.textContent = 'No Deck';
      remotePrevBtn.disabled = true;
      remoteNextBtn.disabled = true;
    }

    if (deckState.previewDataUrl) {
      remoteSlideImg.src = deckState.previewDataUrl;
      remoteSlideImg.classList.remove('hidden');
      noSlidePlaceholder.classList.add('hidden');
    } else {
      remoteSlideImg.classList.add('hidden');
      noSlidePlaceholder.classList.remove('hidden');
    }

    blackoutBanner.classList.toggle('hidden', !deckState.blackout);
    remoteBlackoutBtn.classList.toggle('active', Boolean(deckState.blackout));

    remoteNotes.textContent = deckState.notes || 'No speaker notes for this slide.';
  }

  function sendCommand(action, payload) {
    if (!activeConn || !activeConn.open) {
      setConnectionStatus(false);
      return;
    }
    try {
      activeConn.send({ type: 'command', action, payload });
    } catch {
      setConnectionStatus(false);
    }
  }

  // --- Form & Header Actions ---
  joinForm.addEventListener('submit', (e) => {
    e.preventDefault();
    connectToRoom(roomInput.value);
  });

  reconnectBtn.addEventListener('click', () => {
    if (currentRoomCode) connectToRoom(currentRoomCode);
  });

  disconnectBtn.addEventListener('click', () => {
    clearTimeout(connectTimeoutId);
    if (activeConn) {
      try { activeConn.close(); } catch {}
      activeConn = null;
    }
    currentRoomCode = '';
    setLaserMode(false);
    remoteView.classList.add('hidden');
    connectView.classList.remove('hidden');
  });

  // --- Primary Slide Controls ---
  remotePrevBtn.addEventListener('click', () => {
    haptic(20);
    sendCommand('prev');
  });

  remoteNextBtn.addEventListener('click', () => {
    haptic(25);
    sendCommand('next');
  });

  remoteBlackoutBtn.addEventListener('click', () => {
    haptic(30);
    sendCommand('blackout');
  });

  remoteFullscreenBtn.addEventListener('click', () => {
    haptic(20);
    sendCommand('fullscreen');
  });

  // --- Laser Pointer & Swipe Gestures ---
  function setLaserMode(active) {
    laserMode = active;
    remoteLaserBtn.classList.toggle('active', active);
    previewContainer.classList.toggle('laser-active', active);
    laserBadge.classList.toggle('hidden', !active);
    if (!active) {
      laserIndicator.classList.add('hidden');
      sendCommand('laser-end');
    }
  }

  remoteLaserBtn.addEventListener('click', () => {
    haptic(25);
    setLaserMode(!laserMode);
  });

  let lastLaserSent = 0;
  let pointerDown = false;
  let touchStartX = 0;
  let touchStartY = 0;

  previewContainer.addEventListener('pointerdown', (e) => {
    if (laserMode) {
      pointerDown = true;
      previewContainer.setPointerCapture(e.pointerId);
      emitLaserCoords(e);
    } else {
      touchStartX = e.clientX;
      touchStartY = e.clientY;
    }
  });

  previewContainer.addEventListener('pointermove', (e) => {
    if (!laserMode || !pointerDown) return;
    emitLaserCoords(e);
  });

  function stopLaser() {
    if (!laserMode || !pointerDown) return;
    pointerDown = false;
    laserIndicator.classList.add('hidden');
    sendCommand('laser-end');
  }

  previewContainer.addEventListener('pointerup', (e) => {
    if (laserMode) {
      stopLaser();
    } else if (deckState.totalSlides > 0) {
      const dx = e.clientX - touchStartX;
      const dy = e.clientY - touchStartY;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.4) {
        haptic(20);
        sendCommand(dx < 0 ? 'next' : 'prev');
      }
    }
  });

  previewContainer.addEventListener('pointercancel', stopLaser);

  function emitLaserCoords(e) {
    const rect = previewContainer.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));

    laserIndicator.classList.remove('hidden');
    laserIndicator.style.left = `${x * 100}%`;
    laserIndicator.style.top = `${y * 100}%`;

    const now = performance.now();
    if (now - lastLaserSent >= 28) {
      lastLaserSent = now;
      sendCommand('laser-move', { x, y });
    }
  }

  // --- Presentation Stopwatch ---
  let elapsedSec = 0;
  let timerId = null;

  function renderTimer() {
    const mins = String(Math.floor(elapsedSec / 60)).padStart(2, '0');
    const secs = String(elapsedSec % 60).padStart(2, '0');
    timerDisplay.textContent = `${mins}:${secs}`;
  }

  timerToggleBtn.addEventListener('click', () => {
    if (timerId) {
      clearInterval(timerId);
      timerId = null;
      timerToggleBtn.textContent = 'Start';
    } else {
      timerId = setInterval(() => {
        elapsedSec++;
        renderTimer();
      }, 1000);
      timerToggleBtn.textContent = 'Pause';
    }
  });

  timerResetBtn.addEventListener('click', () => {
    clearInterval(timerId);
    timerId = null;
    elapsedSec = 0;
    timerToggleBtn.textContent = 'Start';
    renderTimer();
  });

  // --- Slide Jump Modal ---
  slideJumpBtn.addEventListener('click', () => {
    if (!deckState.totalSlides) return;
    jumpGrid.innerHTML = '';
    for (let i = 0; i < deckState.totalSlides; i++) {
      const btn = document.createElement('button');
      btn.className = 'jump-item' + (i === deckState.currentSlide ? ' active' : '');
      btn.textContent = i + 1;
      btn.addEventListener('click', () => {
        haptic(20);
        sendCommand('goto', { index: i });
        jumpModal.classList.add('hidden');
      });
      jumpGrid.appendChild(btn);
    }
    jumpModal.classList.remove('hidden');
  });

  closeJumpBtn.addEventListener('click', () => jumpModal.classList.add('hidden'));
  jumpModal.addEventListener('click', (e) => {
    if (e.target === jumpModal) jumpModal.classList.add('hidden');
  });

  // --- Boot & Auto-Join from ?room=XXXXXX ---
  initPeer();
  const urlParams = new URLSearchParams(window.location.search);
  const initialRoom = (urlParams.get('room') || '').toUpperCase().trim();
  if (initialRoom) {
    roomInput.value = initialRoom;
    connectToRoom(initialRoom);
  }
})();