(function () {
  'use strict';

  // Configure PDF.js worker via same-origin Blob to prevent cross-origin worker issues
  if (window.pdfjsLib) {
    const workerUrl = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    const workerBlob = new Blob([`importScripts("${workerUrl}");`], {
      type: 'application/javascript'
    });
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(workerBlob);
  }

  // DOM References
  const fileBadge = document.getElementById('fileBadge');
  const fileInput = document.getElementById('fileInput');
  const uploadTriggerBtn = document.getElementById('uploadTriggerBtn');
  const browseBtn = document.getElementById('browseBtn');
  const loadSampleBtn = document.getElementById('loadSampleBtn');
  const dropZone = document.getElementById('dropZone');
  const stageWrapper = document.getElementById('stageWrapper');
  const slideCanvas = document.getElementById('slideCanvas');
  const blackoutOverlay = document.getElementById('blackoutOverlay');
  const laserDot = document.getElementById('laserDot');

  const prevSlideBtn = document.getElementById('prevSlideBtn');
  const nextSlideBtn = document.getElementById('nextSlideBtn');
  const slideCounter = document.getElementById('slideCounter');
  const blackoutBtn = document.getElementById('blackoutBtn');
  const stageBlackoutBtn = document.getElementById('stageBlackoutBtn');
  const fullscreenBtn = document.getElementById('fullscreenBtn');
  const stageFullscreenBtn = document.getElementById('stageFullscreenBtn');
  const fullscreenToast = document.getElementById('fullscreenToast');

  const roomCodeBadge = document.getElementById('roomCodeBadge');
  const roomCodeBig = document.getElementById('roomCodeBig');
  const newCodeBtn = document.getElementById('newCodeBtn');
  const remoteStatusPill = document.getElementById('remoteStatusPill');
  const remoteStatusText = document.getElementById('remoteStatusText');
  const qrContainer = document.getElementById('qrcode');
  const pairingUrlText = document.getElementById('pairingUrlText');
  const copyUrlBtn = document.getElementById('copyUrlBtn');
  const notesDisplay = document.getElementById('notesDisplay');
  const slideSelectList = document.getElementById('slideSelectList');
  const sidebar = document.getElementById('sidebar');
  const toggleSidebarBtn = document.getElementById('toggleSidebarBtn');

  const PEER_PREFIX = 'slidesync-';
  const ICE_CONFIG = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun.cloudflare.com:3478' }
    ]
  };

  // Application State
  const state = {
    roomCode: getOrCreateRoomCode(),
    deckType: null,
    fileName: null,
    currentSlide: 0,
    totalSlides: 0,
    blackout: false,
    notes: [],
    pptxViewer: null,
    pdfDoc: null,
    imageSlides: [],
    demoSlides: [],
    isRendering: false
  };

  let peer = null;
  let signalingReady = false;
  const remoteConnections = new Map();

  function generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
    sessionStorage.setItem('slidesync_room_v2', code);
    return code;
  }

  function getOrCreateRoomCode() {
    const saved = sessionStorage.getItem('slidesync_room_v2');
    if (saved && /^[A-Z0-9]{6}$/.test(saved)) return saved;
    return generateRoomCode();
  }

  // --- PeerJS WebRTC Host Setup (Zero Backend Needed on Vercel) ---
  function initPeerHost() {
    if (peer) {
      try { peer.destroy(); } catch {}
      peer = null;
    }
    remoteConnections.clear();
    signalingReady = false;
    updateRemoteStatus();
    renderPairingQR();

    peer = new window.Peer(PEER_PREFIX + state.roomCode, {
      debug: 1,
      config: ICE_CONFIG
    });

    peer.on('open', () => {
      signalingReady = true;
      updateRemoteStatus();
    });

    peer.on('connection', (conn) => {
      conn.on('open', () => {
        remoteConnections.set(conn.peer, conn);
        updateRemoteStatus();
        // Send current deck state immediately upon pairing
        conn.send({ type: 'state', state: buildSerializableState(true) });
      });

      conn.on('data', (msg) => {
        if (msg && msg.type === 'command') {
          handleRemoteCommand(msg.action, msg.payload);
        }
      });

      const cleanupConn = () => {
        remoteConnections.delete(conn.peer);
        updateRemoteStatus();
      };

      conn.on('close', cleanupConn);
      conn.on('error', cleanupConn);
    });

    peer.on('disconnected', () => {
      signalingReady = false;
      updateRemoteStatus();
      // Automatically restore signaling socket if browser was idle
      if (peer && !peer.destroyed) {
        setTimeout(() => {
          try { peer.reconnect(); } catch {}
        }, 1500);
      }
    });

    peer.on('error', (err) => {
      console.warn('PeerJS Host Error:', err.type, err);
      if (err.type === 'unavailable-id') {
        // Room ID collision or recent refresh; pick a fresh room code automatically
        state.roomCode = generateRoomCode();
        initPeerHost();
      }
    });
  }

  window.addEventListener('beforeunload', () => {
    if (peer && !peer.destroyed) {
      try { peer.destroy(); } catch {}
    }
  });

  function handleRemoteCommand(action, payload) {
    switch (action) {
      case 'next':
        goToSlide(state.currentSlide + 1);
        break;
      case 'prev':
        goToSlide(state.currentSlide - 1);
        break;
      case 'goto':
        if (typeof payload?.index === 'number') {
          goToSlide(payload.index);
        }
        break;
      case 'blackout':
        toggleBlackout(typeof payload?.active === 'boolean' ? payload.active : undefined);
        break;
      case 'fullscreen':
        requestStageFullscreen(true);
        break;
      case 'laser-move':
        if (payload && typeof payload.x === 'number' && typeof payload.y === 'number') {
          laserDot.classList.remove('hidden');
          laserDot.style.left = `${Math.max(0, Math.min(1, payload.x)) * 100}%`;
          laserDot.style.top = `${Math.max(0, Math.min(1, payload.y)) * 100}%`;
        }
        break;
      case 'laser-end':
        laserDot.classList.add('hidden');
        break;
    }
  }

  function updateRemoteStatus() {
    const count = remoteConnections.size;
    remoteStatusPill.classList.remove('ready', 'connected');

    if (count > 0) {
      remoteStatusPill.classList.add('connected');
      remoteStatusText.textContent = `${count} Remote${count > 1 ? 's' : ''} Connected`;
    } else if (signalingReady) {
      remoteStatusPill.classList.add('ready');
      remoteStatusText.textContent = 'Waiting for Remote';
    } else {
      remoteStatusText.textContent = 'Connecting Cloud...';
    }
  }

  function renderPairingQR() {
    roomCodeBadge.textContent = `ROOM: ${state.roomCode}`;
    roomCodeBig.textContent = state.roomCode;

    // On Vercel, window.location.origin is automatically the live HTTPS domain!
    const url = `${window.location.origin}/?room=${state.roomCode}`;
    pairingUrlText.value = url;
    qrContainer.innerHTML = '';

    if (window.QRCode) {
      new window.QRCode(qrContainer, {
        text: url,
        width: 168,
        height: 168,
        colorDark: '#0f172a',
        colorLight: '#ffffff',
        correctLevel: window.QRCode.CorrectLevel.M
      });
    }
  }

  newCodeBtn.addEventListener('click', () => {
    state.roomCode = generateRoomCode();
    initPeerHost();
  });

  copyUrlBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(pairingUrlText.value);
      copyUrlBtn.textContent = 'Copied!';
      setTimeout(() => (copyUrlBtn.textContent = 'Copy'), 1500);
    } catch {
      pairingUrlText.select();
      document.execCommand('copy');
    }
  });

  // --- File Upload & Drag-and-Drop ---
  uploadTriggerBtn.addEventListener('click', () => fileInput.click());
  browseBtn.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFiles(Array.from(e.target.files));
      fileInput.value = '';
    }
  });

  ['dragenter', 'dragover'].forEach((evt) => {
    dropZone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropZone.classList.add('drag-over');
    });
  });

  ['dragleave', 'drop'].forEach((evt) => {
    dropZone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropZone.classList.remove('drag-over');
    });
  });

  dropZone.addEventListener('drop', (e) => {
    const files = Array.from(e.dataTransfer?.files || []);
    if (files.length > 0) handleFiles(files);
  });

  async function handleFiles(files) {
    const first = files[0];
    const ext = first.name.split('.').pop().toLowerCase();

    if (ext === 'ppt') {
      alert(
        'Legacy binary .ppt (PowerPoint 97-2003) files cannot be decoded directly in a browser.\n\nPlease Save As .pptx or Export as .pdf first.'
      );
      return;
    }

    if (ext === 'pptx') {
      await loadPptxFile(first);
    } else if (ext === 'pdf') {
      await loadPdfFile(first);
    } else if (['png', 'jpg', 'jpeg', 'webp'].includes(ext)) {
      await loadImageFiles(files);
    } else {
      alert('Unsupported file type. Please upload .pptx, .pdf, or image slides (.png/.jpg/.webp).');
    }
  }

  // --- Loader 1: PPTX ---
  async function loadPptxFile(file) {
    if (!window.PptxViewJS) {
      alert('PptxViewJS library did not load. Please refresh and try again.');
      return;
    }

    resetDeck();
    fileBadge.textContent = `Loading ${file.name}...`;

    try {
      const buffer = await file.arrayBuffer();
      state.notes = await extractPptxNotes(buffer);

      slideCanvas.width = 1280;
      slideCanvas.height = 720;

      const viewer = new window.PptxViewJS.PPTXViewer({ canvas: slideCanvas });
      await viewer.loadFile(file);

      state.deckType = 'pptx';
      state.pptxViewer = viewer;
      state.fileName = file.name;
      state.totalSlides = viewer.getSlideCount();
      state.currentSlide = 0;

      showStage();
      await viewer.render();
      syncAfterRender();
    } catch (err) {
      console.error('Error loading PPTX:', err);
      fileBadge.textContent = 'Load failed';
      alert('Could not parse this .pptx file. Try exporting it to .pdf as an alternative.');
    }
  }

  async function extractPptxNotes(arrayBuffer) {
    if (!window.JSZip) return [];
    try {
      const zip = await window.JSZip.loadAsync(arrayBuffer);
      const parser = new DOMParser();

      const getLocal = (root, name) =>
        Array.from(root.getElementsByTagName('*')).filter((el) => el.localName === name);

      const presXml = await zip.file('ppt/presentation.xml')?.async('string');
      const presRelsXml = await zip.file('ppt/_rels/presentation.xml.rels')?.async('string');
      if (!presXml || !presRelsXml) return [];

      const presDoc = parser.parseFromString(presXml, 'application/xml');
      const relsDoc = parser.parseFromString(presRelsXml, 'application/xml');

      const relMap = new Map();
      getLocal(relsDoc, 'Relationship').forEach((rel) => {
        relMap.set(rel.getAttribute('Id'), rel.getAttribute('Target'));
      });

      const sldIds = getLocal(presDoc, 'sldId');
      const notesList = [];

      for (const sldId of sldIds) {
        const rId =
          sldId.getAttribute('r:id') ||
          sldId.getAttributeNS(
            'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
            'id'
          );
        let slideTarget = relMap.get(rId) || '';
        slideTarget = slideTarget.replace(/^\/?ppt\//, '');

        const slideFileName = slideTarget.split('/').pop();
        const slideRelsXml = await zip.file(`ppt/slides/_rels/${slideFileName}.rels`)?.async('string');

        let noteText = '';
        if (slideRelsXml) {
          const slideRelsDoc = parser.parseFromString(slideRelsXml, 'application/xml');
          const notesRel = getLocal(slideRelsDoc, 'Relationship').find((r) =>
            (r.getAttribute('Type') || '').endsWith('/notesSlide')
          );

          if (notesRel) {
            const notesFileName = (notesRel.getAttribute('Target') || '').split('/').pop();
            const notesXml = await zip.file(`ppt/notesSlides/${notesFileName}`)?.async('string');
            if (notesXml) {
              const notesDoc = parser.parseFromString(notesXml, 'application/xml');
              const paragraphs = [];

              getLocal(notesDoc, 'sp').forEach((shape) => {
                const isSlideNum = getLocal(shape, 'fld').some(
                  (f) => f.getAttribute('type') === 'slidenum'
                );
                if (isSlideNum) return;

                getLocal(shape, 'p').forEach((p) => {
                  const text = getLocal(p, 't')
                    .map((t) => t.textContent)
                    .join('');
                  if (text.trim()) paragraphs.push(text.trim());
                });
              });

              noteText = paragraphs.join('\n');
            }
          }
        }
        notesList.push(noteText);
      }

      return notesList;
    } catch {
      return [];
    }
  }

  // --- Loader 2: PDF ---
  async function loadPdfFile(file) {
    if (!window.pdfjsLib) {
      alert('PDF.js failed to load. Please refresh.');
      return;
    }

    resetDeck();
    fileBadge.textContent = `Loading ${file.name}...`;

    try {
      const buffer = await file.arrayBuffer();
      const pdfDoc = await window.pdfjsLib.getDocument({ data: buffer }).promise;

      state.deckType = 'pdf';
      state.pdfDoc = pdfDoc;
      state.fileName = file.name;
      state.totalSlides = pdfDoc.numPages;
      state.currentSlide = 0;
      state.notes = [];

      showStage();
      await renderCurrentSlide();
    } catch (err) {
      console.error('Error loading PDF:', err);
      fileBadge.textContent = 'Load failed';
      alert('Could not open this PDF file.');
    }
  }

  // --- Loader 3: Images ---
  async function loadImageFiles(files) {
    resetDeck();
    const sorted = files
      .filter((f) => /\.(png|jpe?g|webp)$/i.test(f.name))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

    if (sorted.length === 0) return;

    state.deckType = 'images';
    state.fileName = sorted.length === 1 ? sorted[0].name : `${sorted.length} Image Slides`;
    state.imageSlides = sorted.map((f) => URL.createObjectURL(f));
    state.totalSlides = state.imageSlides.length;
    state.currentSlide = 0;
    state.notes = [];

    showStage();
    await renderCurrentSlide();
  }

  // --- Loader 4: Built-in Sample Deck ---
  loadSampleBtn.addEventListener('click', async () => {
    resetDeck();
    state.deckType = 'demo';
    state.fileName = 'Sample_Presentation.pptx';
    state.demoSlides = [
      {
        bg: ['#1e1b4b', '#312e81'],
        tag: 'SLIDE 01 • INTRO',
        title: 'Welcome to SlideSync',
        bullets: [
          'Hosted on Vercel with direct WebRTC P2P remote control',
          'Scan the QR code on the right from anywhere (Wi-Fi or 5G)',
          'Drop any .pptx, .pdf, or slide images to start presenting'
        ],
        note: 'Welcome! Mention that no local server is needed—everything runs directly in the browser.'
      },
      {
        bg: ['#0f172a', '#1e293b'],
        tag: 'SLIDE 02 • AUTO DETECTION',
        title: 'Platform Detection Routing',
        bullets: [
          'Desktop visitors automatically land on the Upload & Present view',
          'Mobile visitors automatically land on the Touch Remote view',
          'Query params like ?room=XXXXXX carry seamlessly across redirects'
        ],
        note: 'Point out that scanning the QR code routes phones straight into the paired remote!'
      },
      {
        bg: ['#064e3b', '#065f46'],
        tag: 'SLIDE 03 • REMOTE TOOLS',
        title: 'Wireless Control & Laser',
        bullets: [
          'Live slide thumbnail & speaker notes synced straight to your phone',
          'Touch-drag Red Laser Pointer with zero backend lag',
          'Black Screen mode, slide jump grid, and built-in stopwatch'
        ],
        note: 'Try enabling Laser Pointer on your phone and dragging across the slide preview.'
      },
      {
        bg: ['#4c1d95', '#6d28d9'],
        tag: 'SLIDE 04 • READY',
        title: 'Ready to Present!',
        bullets: [
          'Click "Upload PPT / PDF" above to load your own deck',
          'Press F on keyboard for Fullscreen presentation stage',
          'Press B anytime to toggle Black Screen'
        ],
        note: 'Wrap up and open the floor for Q&A.'
      }
    ];
    state.notes = state.demoSlides.map((s) => s.note);
    state.totalSlides = state.demoSlides.length;
    state.currentSlide = 0;

    showStage();
    await renderCurrentSlide();
  });

  function resetDeck() {
    state.imageSlides.forEach((url) => URL.revokeObjectURL(url));
    state.imageSlides = [];
    state.pdfDoc = null;
    state.pptxViewer = null;
    state.demoSlides = [];
    state.notes = [];
    state.currentSlide = 0;
    state.totalSlides = 0;
    toggleBlackout(false);
  }

  function showStage() {
    dropZone.classList.add('hidden');
    stageWrapper.classList.remove('hidden');
    fileBadge.textContent = state.fileName;
    blackoutBtn.disabled = false;
    fullscreenBtn.disabled = false;
    buildSlideJumpGrid();
  }

  function buildSlideJumpGrid() {
    slideSelectList.innerHTML = '';
    for (let i = 0; i < state.totalSlides; i++) {
      const btn = document.createElement('button');
      btn.className = 'jump-pill';
      btn.textContent = i + 1;
      btn.addEventListener('click', () => goToSlide(i));
      slideSelectList.appendChild(btn);
    }
  }

  async function goToSlide(targetIndex) {
    if (state.totalSlides === 0 || state.isRendering) return;
    const clamped = Math.max(0, Math.min(state.totalSlides - 1, targetIndex));
    if (clamped === state.currentSlide) return;

    state.isRendering = true;
    try {
      if (state.deckType === 'pptx' && state.pptxViewer) {
        const v = state.pptxViewer;
        if (clamped === state.currentSlide + 1 && typeof v.nextSlide === 'function') {
          await v.nextSlide();
        } else if (clamped === state.currentSlide - 1 && typeof v.previousSlide === 'function') {
          await v.previousSlide();
        } else if (typeof v.goToSlide === 'function') {
          await v.goToSlide(clamped);
        } else if (typeof v.renderSlide === 'function') {
          await v.renderSlide(clamped, slideCanvas);
        }
        state.currentSlide =
          typeof v.getCurrentSlideIndex === 'function' ? v.getCurrentSlideIndex() : clamped;
        syncAfterRender();
      } else {
        state.currentSlide = clamped;
        await renderCurrentSlide();
      }
    } catch (err) {
      console.error('Slide navigation error:', err);
    } finally {
      state.isRendering = false;
    }
  }

  async function renderCurrentSlide() {
    const ctx = slideCanvas.getContext('2d');

    if (state.deckType === 'pdf' && state.pdfDoc) {
      const page = await state.pdfDoc.getPage(state.currentSlide + 1);
      const baseViewport = page.getViewport({ scale: 1 });
      const scale = 1600 / baseViewport.width;
      const viewport = page.getViewport({ scale });

      slideCanvas.width = viewport.width;
      slideCanvas.height = viewport.height;

      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, slideCanvas.width, slideCanvas.height);
      await page.render({ canvasContext: ctx, viewport }).promise;
    } else if (state.deckType === 'images') {
      const img = await loadImage(state.imageSlides[state.currentSlide]);
      slideCanvas.width = 1280;
      slideCanvas.height = 720;
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, 1280, 720);

      const scale = Math.min(1280 / img.width, 720 / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      ctx.drawImage(img, (1280 - w) / 2, (720 - h) / 2, w, h);
    } else if (state.deckType === 'demo') {
      drawDemoSlide(ctx, state.demoSlides[state.currentSlide], state.currentSlide + 1);
    }

    syncAfterRender();
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  function drawDemoSlide(ctx, slide, num) {
    slideCanvas.width = 1280;
    slideCanvas.height = 720;

    const grad = ctx.createLinearGradient(0, 0, 1280, 720);
    grad.addColorStop(0, slide.bg[0]);
    grad.addColorStop(1, slide.bg[1]);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 1280, 720);

    ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.beginPath();
    ctx.arc(1120, 140, 220, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#a5b4fc';
    ctx.font = 'bold 22px system-ui, sans-serif';
    ctx.fillText(slide.tag, 96, 118);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 58px system-ui, sans-serif';
    ctx.fillText(slide.title, 96, 196);

    ctx.fillStyle = '#38bdf8';
    ctx.fillRect(96, 224, 96, 6);

    ctx.font = '32px system-ui, sans-serif';
    slide.bullets.forEach((line, idx) => {
      const y = 320 + idx * 78;
      ctx.fillStyle = '#38bdf8';
      ctx.beginPath();
      ctx.arc(110, y - 10, 7, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#f1f5f9';
      ctx.fillText(line, 138, y);
    });

    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.font = '600 20px system-ui, sans-serif';
    ctx.fillText(`Slide ${num} of ${state.totalSlides}`, 96, 650);
  }

  function syncAfterRender() {
    slideCounter.textContent = `${state.currentSlide + 1} / ${state.totalSlides}`;
    prevSlideBtn.disabled = state.currentSlide <= 0;
    nextSlideBtn.disabled = state.currentSlide >= state.totalSlides - 1;

    Array.from(slideSelectList.children).forEach((btn, idx) => {
      btn.classList.toggle('active', idx === state.currentSlide);
    });

    const currentNote = state.notes[state.currentSlide] || '';
    notesDisplay.textContent = currentNote || 'No speaker notes for this slide.';

    broadcastState();
  }

  function capturePreviewDataUrl() {
    if (!state.totalSlides || slideCanvas.width === 0 || slideCanvas.height === 0) return null;
    try {
      const thumbW = 480;
      const thumbH = Math.max(120, Math.round(thumbW * (slideCanvas.height / slideCanvas.width)));
      const offscreen = document.createElement('canvas');
      offscreen.width = thumbW;
      offscreen.height = thumbH;
      const octx = offscreen.getContext('2d');
      octx.drawImage(slideCanvas, 0, 0, thumbW, thumbH);
      return offscreen.toDataURL('image/jpeg', 0.65);
    } catch {
      return null;
    }
  }

  function buildSerializableState(includePreview) {
    return {
      fileName: state.fileName,
      currentSlide: state.currentSlide,
      totalSlides: state.totalSlides,
      blackout: state.blackout,
      notes: state.notes[state.currentSlide] || '',
      previewDataUrl: includePreview ? capturePreviewDataUrl() : null
    };
  }

  function broadcastState() {
    if (remoteConnections.size === 0) return;
    const payload = { type: 'state', state: buildSerializableState(true) };
    remoteConnections.forEach((conn) => {
      if (conn.open) {
        try { conn.send(payload); } catch {}
      }
    });
  }

  // Controls & Shortcuts
  prevSlideBtn.addEventListener('click', () => goToSlide(state.currentSlide - 1));
  nextSlideBtn.addEventListener('click', () => goToSlide(state.currentSlide + 1));

  function toggleBlackout(forceState) {
    state.blackout = typeof forceState === 'boolean' ? forceState : !state.blackout;
    blackoutOverlay.classList.toggle('hidden', !state.blackout);
    blackoutBtn.classList.toggle('active', state.blackout);
    stageBlackoutBtn.classList.toggle('active', state.blackout);
    broadcastState();
  }

  blackoutBtn.addEventListener('click', () => toggleBlackout());
  stageBlackoutBtn.addEventListener('click', () => toggleBlackout());

  async function requestStageFullscreen(fromRemote = false) {
    if (!state.totalSlides) return;
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await stageWrapper.requestFullscreen();
      }
    } catch {
      if (fromRemote) {
        showToast('Remote requested Fullscreen — press F or click "Present Fullscreen".');
      }
    }
  }

  function showToast(msg) {
    fullscreenToast.textContent = msg;
    fullscreenToast.classList.remove('hidden');
    setTimeout(() => fullscreenToast.classList.add('hidden'), 3500);
  }

  fullscreenBtn.addEventListener('click', () => requestStageFullscreen(false));
  stageFullscreenBtn.addEventListener('click', () => requestStageFullscreen(false));

  toggleSidebarBtn.addEventListener('click', () => {
    sidebar.classList.toggle('collapsed');
  });

  document.addEventListener('keydown', (e) => {
    if (!state.totalSlides) return;
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;

    if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') {
      e.preventDefault();
      goToSlide(state.currentSlide + 1);
    } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
      e.preventDefault();
      goToSlide(state.currentSlide - 1);
    } else if (e.key.toLowerCase() === 'f') {
      e.preventDefault();
      requestStageFullscreen(false);
    } else if (e.key.toLowerCase() === 'b') {
      e.preventDefault();
      toggleBlackout();
    }
  });

  // Boot
  initPeerHost();
})();