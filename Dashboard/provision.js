/**
 * ProVision AI - live dashboard integration.
 *
 * Connected mode (simulator / upload / RTSP) renders only values that arrived
 * in a validated backend message. The local demo is a separate opt-in module
 * (`dashboard-demo.js`) that generates synthetic messages and never touches the
 * network.
 *
 * Rendering model
 * ---------------
 * Tracking frames are buffered on arrival. Live (socket-only) rendering follows
 * `now - 250 ms` and interpolates the two surrounding frames, extrapolating at
 * most 150 ms. When HLS video is attached the buffer is indexed by
 * `mediaTime` and the target is `video.currentTime`, so play, pause and seek
 * all follow the player. Analytics, events and commentary are applied as they
 * arrive; they never drive the interpolation clock.
 */
(function () {
  'use strict';

  var CONTRACT = window.DashContract;
  if (!CONTRACT) {
    showFatal('Dashboard contract failed to load.');
    return;
  }

  // ------------------------------------------------------------------- //
  // DOM references
  // ------------------------------------------------------------------- //
  var el = {};
  [
    'cv', 'hls', 'srcCtl', 'srcBtn', 'connDot', 'connTxt', 'srcDlg',
    'srcDlgTitle', 'dlgClose', 'apiBase', 'apiKey', 'healthBtn', 'healthTxt', 'healthMeta',
    'stopBtn', 'simId', 'simStart', 'simStop', 'upFile', 'upStart', 'upNote',
    'rtspUrl', 'rtspStart', 'rtspNote', 'srcList', 'demoStart', 'demo2Start', 'demo2Scene', 'dlgErr', 'dlgOk',
    'ogVideo', 'btnSideBySide', 'btnOgVideo', 'btn3dPitch', 'stageSplit', 'btnWatchReplay',
    'jumpKickoff', 'jumpMataGoal', 'jumpIntro',
    'gateDot', 'resumeCard', 'srcCards', 'srcDlgSub',
    'upHomeTeam', 'upAwayTeam', 'upHomeColor', 'upAwayColor',
    'upHomeColorHex', 'upAwayColorHex',
    'rtspHomeTeam', 'rtspAwayTeam', 'rtspHomeColor', 'rtspAwayColor',
    'rtspHomeColorHex', 'rtspAwayColorHex',
    'srcMeta', 'srcMetaState', 'srcMetaProgress', 'srcMetaGemini',
    'prepCard', 'prepTitle', 'prepSub', 'prepState', 'prepSteps', 'prepMeta',
    'prepErr', 'prepAction', 'prepRefresh', 'prepBack',
    'calibCard', 'calibTitle', 'calibSub', 'calibState', 'calibFrame',
    'calibImg', 'calibMarks', 'calibLandmark', 'calibHint', 'calibList',
    'calibErr', 'calibInfo', 'calibUndo', 'calibReset', 'calibPreviewBtn',
    'calibSubmit', 'calibBack',
    'calibManualPanel', 'calibSuggest', 'calibSuggestBadge', 'calibSuggestImg',
    'calibSuggestList', 'calibSuggestInfo', 'calibSuggestErr', 'calibSuggestBack',
    'calibAccept', 'calibRetry', 'calibManual',
    'calibSeek', 'calibSeekBadge', 'calibSeekTime', 'calibSeekScan',
    'calibSeekMsg', 'calibSeekErr',
    'sh', 'sa', 'tn0', 'tn1', 'clock', 'half', 'ph', 'pa', 'pb', 'q', 'mic',
    'fl', 'tabs', 'pc', 'pcv', 'pcw', 'pcb', 'ring', 'rv', 'rc', 'bn', 'callout',
    'leg', 'stage',
    'x0', 'x1', 'xb0', 'xb1', 't0', 't1', 'tb0', 'tb1', 'tstats', 'fastest',
    'w0', 'w1', 'w2', 'wp', 'wln0', 'wln1', 'xn0', 'xn1', 'xtn0', 'xtn1',
    'f0', 'f1', 'fc0', 'fc1', 'pn', 'jr', 'jn', 'pc2', 'ct', 'cts', 'ctsrc',
    'hl', 'trk', 'now', 'gl', 'glt', 'wif', 'wim', 'ar', 'cams', 'pp', 'gh', 'vr',
    'personaSelect', 'langSelect', 'arCanvas', 'toggleArOverlay', 'btnSocialHighlights',
    'socialDlg', 'socialDlgClose', 'socialCopyCaption', 'socialHeadline',
    'socialCaption', 'socialTactical', 'socialTags', 'socialClipVideo', 'socialDownloadBtn',
    'socialPosterImg', 'socialEventSelect', 'btnGenCommentary', 'btnTts', 'socialRegenerateBtn',
    'btnReasoning', 'reasoningDlg', 'reasoningDlgClose', 'reasoningReanalyzeBtn',
    'reasoningSummary', 'reasoningSpatial', 'reasoningFacts', 'reasoningCounter',
    'reasoningAdjustment', 'reasoningRating',
    'btnMeme', 'memeDlg', 'memeDlgClose', 'memeRegenerateBtn', 'memeCopyCaptionBtn',
    'memeImg', 'memeTopText', 'memeBottomText', 'memeHeadline', 'memeCaption',
    'btnHalftimeSummary', 'halftimeDlg', 'halftimeDlgClose', 'halftimeVideo',
    'halftimePlayVoiceBtn', 'halftimeTitle', 'halftimeOverview', 'halftimeMoments',
    'halftimeKeys', 'halftimeRefreshBtn'
  ].forEach(function (id) { el[id] = document.getElementById(id); });

  if (typeof THREE === 'undefined') {
    showFatal('Three.js failed to load. The 3D pitch cannot start.');
    return;
  }

  // ------------------------------------------------------------------- //
  // Constants
  // ------------------------------------------------------------------- //
  var SCHEMA_VERSION = CONTRACT.SCHEMA_VERSION;
  var PITCH_HALF_W = 52.5;
  var PITCH_HALF_H = 34;
  var PLAYOUT_DELAY_MS = 250;
  var MAX_EXTRAPOLATION_MS = 150;
  var PLAYER_HIDE_MS = 1000;
  var BALL_HIDE_MS = 300;
  var BALL_CONF_MIN = 0.3;
  var GHOST_SECONDS = 8;
  var TRACK_BUFFER_MAX = 1800;
  var TRACK_BUFFER_SPAN_MS = 180000;
  var BACKFILL_WINDOW_S = 2.5;
  var BACKFILL_MIN_MS = 600;
  var TARGET_JUMP_MS = 1000;
  var DEBUG_TICK_MS = 300;
  var UI_TICK_MS = 250;
  var HISTORY_STEP_MS = 250;
  //: Restored whenever the auto-detected panel is not on screen.
  var CALIB_HINT_DEFAULT = el.calibHint ? el.calibHint.textContent : '';

  var DEFAULT_TEAMS = { home: 'Home', away: 'Away' };
  var DEFAULT_COLORS = {
    home: CONTRACT.HOME_TEAM_COLOR,
    away: CONTRACT.AWAY_TEAM_COLOR
  };
  //: A jersey number is only shown when the backend proved it: an identity
  //: backed id (H7/A11), a real confidence and a plausible number. Track ids
  //: such as P14 carry a fabricated number and must stay unknown here.
  var IDENTITY_CONF_MIN = 0.5;
  var IDENTITY_ID_RE = /^[HA](\d{1,3})(?:-\d+)?$/;
  var DIALOG_TITLE = 'Choose your match source';
  var DIALOG_SUB = 'Pick one input below to open the analytics desk. Every connected value is validated end to end, and you can switch sources at any time.';
  // The local demo is one synthetic match: it never borrows a server identity.
  var DEMO_MATCH_ID = 'local-demo';
  var DEMO_TEAMS = { home: 'Demo Blue', away: 'Demo Orange' };

  var params = new URLSearchParams(location.search);
  var debugEnabled = params.get('debug') === '1' || params.has('debug');

  // ------------------------------------------------------------------- //
  // State
  // ------------------------------------------------------------------- //
  function defaultApiBase() {
    try {
      var stored = sessionStorage.getItem('pv.apiBase');
      if (stored) { return stored; }
    } catch (err) { /* private mode */ }
    if (location.protocol === 'http:' || location.protocol === 'https:') {
      if (location.pathname.indexOf('/dashboard') === 0 || location.port === '8000') {
        return location.origin;
      }
    }
    return 'http://localhost:8000';
  }

  function emptySource() {
    return {
      kind: null,
      sourceId: null,
      matchId: null,
      state: null,
      status: null,
      hls: null,
      teams: null,
      inference: null,
      calibrationPreview: null,
      calibrationSuggestions: null,
      pipeline: null,
      error: null
    };
  }

  function newCounters() {
    return {
      trackingIn: 0,
      trackingAccepted: 0,
      trackingRejected: 0,
      trackingStale: 0,
      trackingDuplicates: 0,
      trackingGaps: 0,
      eventsIn: 0,
      eventsAccepted: 0,
      eventsRejected: 0,
      eventsStale: 0,
      eventsUpserts: 0,
      eventsRetracted: 0,
      eventsResyncs: 0,
      commentaryIn: 0,
      commentaryAccepted: 0,
      commentaryRejected: 0,
      commentaryStale: 0,
      commentaryResyncs: 0,
      analyticsIn: 0,
      analyticsAccepted: 0,
      analyticsRejected: 0,
      analyticsStale: 0,
      snapshots: 0,
      snapshotQueued: 0,
      invalid: 0,
      errors: 0,
      resyncRequests: 0,
      backfills: 0,
      backfillFrames: 0,
      goalBanners: 0,
      hlsErrors: 0,
      lastInvalid: null,
      streamStats: null
    };
  }

  function newStreamStats() {
    return {
      lastAt: 0,
      lastSeq: 0,
      rate: 0,
      windowAt: 0,
      windowCount: 0
    };
  }

  function newStreams() {
    return {
      tracking: newStreamStats(),
      analytics: newStreamStats(),
      events: newStreamStats(),
      commentary: newStreamStats()
    };
  }

  var store = {
    mode: 'idle',
    generation: 0,
    apiBase: params.get('api') || defaultApiBase(),
    apiKey: params.get('key') || '',
    backend: 'unknown',
    health: null,
    socket: null,
    socketState: 'offline',
    joined: false,
    snapshotReceived: false,
    snapshotQueue: [],
    source: emptySource(),
    teams: {
      home: DEFAULT_TEAMS.home,
      away: DEFAULT_TEAMS.away,
      colors: { home: DEFAULT_COLORS.home, away: DEFAULT_COLORS.away }
    },
    matchStatus: null,
    score: { home: null, away: null },
    possessionPct: { home: null, away: null },
    analytics: {
      lastSeq: 0,
      latest: null,
      metrics: Object.create(null),
      history: { home: [], draw: [], away: [] },
      receivedAt: 0
    },
    tracking: {
      lastSeq: 0,
      latest: null,
      buffer: [],
      seqSet: new Set(),
      gaps: 0,
      receivedAt: 0
    },
    streams: newStreams(),
    events: {
      lastSeq: 0,
      byId: Object.create(null),
      highlighted: Object.create(null),
      resyncAt: 0,
      resyncPending: false
    },
    commentary: {
      lastSeq: 0,
      lines: [],
      bySeq: Object.create(null),
      resyncAt: 0,
      resyncPending: false
    },
    commentaryPersona: 'tactical',
    commentaryLanguage: 'en',
    arOverlayActive: true,
    clock: { period: 1, seconds: 0 },
    possessionTeam: null,
    holderId: null,
    selectedPlayerId: null,
    video: {
      hls: null,
      url: null,
      attached: false,
      active: false,
      visible: false,
      ready: false,
      error: null,
      lastBackfill: 0,
      lastBackfillTarget: null,
      backfillPending: false,
      backfillQueued: null
    },
    overlays: { pc: true, heat: true, net: true, off: true, ghost: false, video: true },
    calibration: {
      points: [],
      previewUrl: '',
      objectUrl: '',
      //: `capturedAt` of the still on screen. The sweep and a seek scan both
      //: replace the backend still behind the same URL, so the stamp - not the
      //: URL - is what tells the manual grid to refetch.
      previewStamp: null,
      natural: { width: 0, height: 0 },
      loading: false,
      submitting: false,
      token: 0,
      error: ''
    },
    //: Auto-detected points waiting for a human yes/no. `round` is the
    //: backend's generation stamp, so a fresh detection re-opens the panel.
    calibrationSuggest: {
      index: 0,
      round: 0,
      previewUrl: '',
      attemptedUrl: '',
      objectUrl: '',
      loading: false,
      accepting: false,
      error: '',
      token: 0,
      dismissed: false
    },
    //: "Skip to match footage": the operator names a timestamp, the backend
    //: seeks there and samples around it. `lastSeconds` keeps the number they
    //: tried, so a still-empty answer can say "try a different timestamp".
    calibrationSeek: {
      scanning: false,
      error: '',
      lastSeconds: null
    },
    lastLaunch: null,
    demo: null,
    timers: {
      health: null,
      status: null,
      dialog: null,
      healthAttempt: 0
    },
    counters: newCounters(),
    paused: false,
    rate: 1,
    cameraMode: 0,
    lastError: '',
    lastNotice: '',
    filter: '',
    search: '',
    dirty: { feed: true, stats: true, commentary: true, highlights: true, timeline: true }
  };

  var renderState = {
    players: Object.create(null),
    ball: null,
    holderId: null,
    possession: null,
    clock: { period: 1, seconds: 0 },
    targetKey: null,
    lastTargetKey: null,
    lastSample: null,
    lastFrameAt: 0,
    fps: 0,
    renderMs: 0,
    lagMs: 0,
    driftMs: null,
    extrapolated: false,
    visiblePlayers: 0,
    lastHeatAt: 0,
    lastPcAt: 0,
    lastNetAt: 0,
    lastGhostAt: 0,
    lastWhatIfAt: 0,
    lastFormationAt: 0,
    lastUiAt: 0,
    lastDebugAt: 0
  };

  var history = [];
  var affinity = Object.create(null);
  var heat = new Float32Array(42 * 27);
  var ballMissingSince = null;
  var speedRingUntil = 0;
  var trail = [];
  var goalLineTimer = null;
  var calloutTimer = null;

  // ------------------------------------------------------------------- //
  // Generic helpers
  // ------------------------------------------------------------------- //
  function showFatal(message) {
    var stage = document.getElementById('stage');
    if (!stage) { return; }
    var box = document.createElement('div');
    box.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;'
      + 'justify-content:center;padding:24px;text-align:center;color:#ff8fa8;'
      + 'background:rgba(4,10,21,.9);z-index:40;font:16px/1.4 system-ui';
    box.textContent = message;
    stage.appendChild(box);
  }

  function clamp(value, low, high) {
    return Math.max(low, Math.min(high, value));
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function nowMs() {
    return performance.now();
  }

  function setText(node, text) {
    if (node) { node.textContent = text == null ? '' : String(text); }
  }

  function clearNode(node) {
    while (node && node.firstChild) { node.removeChild(node.firstChild); }
  }

  function make(tag, className, text) {
    var node = document.createElement(tag);
    if (className) { node.className = className; }
    if (text !== undefined) { node.textContent = text; }
    return node;
  }

  function svgEl(tag, attrs) {
    var node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (key) {
        node.setAttribute(key, String(attrs[key]));
      });
    }
    return node;
  }

  function hexToRgb(value) {
    var hex = CONTRACT.safeColor(value, '#ffffff').replace('#', '');
    if (hex.length === 3) {
      hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    }
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16)
    };
  }

  function teamColor(team) {
    return team === 'away' ? store.teams.colors.away : store.teams.colors.home;
  }

  function teamName(team) {
    return team === 'away' ? store.teams.away : store.teams.home;
  }

  function teamThreeColor(team) {
    return new THREE.Color(hexToRgb(teamColor(team)).r / 255,
      hexToRgb(teamColor(team)).g / 255, hexToRgb(teamColor(team)).b / 255);
  }

  function formatClock(seconds) {
    var whole = Math.max(0, Math.floor(seconds || 0));
    var minutes = Math.floor(whole / 60);
    var rest = whole % 60;
    return minutes + ':' + String(rest).padStart(2, '0');
  }

  function formatMinute(seconds) {
    var whole = Math.max(0, Math.floor(seconds || 0));
    return Math.floor(whole / 60) + "'" + String(whole % 60).padStart(2, '0');
  }

  /**
   * Commentary carries `ts` (epoch ms) but no match clock, so the panel shows
   * the local time the line was produced rather than inventing a match minute.
   */
  function formatLocalTime(epochMs) {
    if (!Number.isFinite(epochMs) || epochMs <= 0) { return '--:--'; }
    var date = new Date(epochMs);
    return String(date.getHours()).padStart(2, '0')
      + ':' + String(date.getMinutes()).padStart(2, '0');
  }

  function halfLabel(period, seconds) {
    if ((seconds || 0) >= 5400) { return 'Full time'; }
    return period === 2 ? '2nd half' : '1st half';
  }

  function isRetracted(event) {
    return event && event.status === 'retracted';
  }

  function eventCategory(type) {
    if (type === 'pass') { return 'pass'; }
    if (type === 'shot' || type === 'goal') { return 'shot'; }
    if (type === 'save' || type === 'tackle' || type === 'foul'
      || type === 'card' || type === 'offside') { return 'def'; }
    return 'oth';
  }

  function eventIcon(type) {
    return ({
      pass: '↗', shot: '◎', save: '✋', goal: '⚽', tackle: '⚔',
      foul: '⚑', card: '▰', offside: '⛓', corner: '◴', throw_in: '➶',
      goal_kick: '⤒', substitution: '⇄'
    })[type] || '•';
  }

  function eventTitle(type) {
    return ({
      pass: 'Pass', shot: 'Shot', save: 'Save', goal: 'Goal', tackle: 'Tackle',
      foul: 'Foul', card: 'Card', offside: 'Offside', corner: 'Corner',
      throw_in: 'Throw-in', goal_kick: 'Goal kick', substitution: 'Substitution'
    })[type] || String(type || 'Event');
  }

  /**
   * Identity-qualified means the backend projected an identity onto this
   * track: the id is `H<number>`/`A<number>` and the combined confidence is at
   * least 0.5. A `P<track_id>` id is raw tracking with a fabricated number, so
   * nothing about it may be shown as a jersey number or a role.
   */
  function identityQualified(meta) {
    if (!meta || typeof meta.id !== 'string') { return false; }
    if (!IDENTITY_ID_RE.test(meta.id)) { return false; }
    return typeof meta.conf === 'number' && meta.conf >= IDENTITY_CONF_MIN;
  }

  function identityNumber(meta) {
    if (!identityQualified(meta)) { return null; }
    return Number.isInteger(meta.num) && meta.num >= 0 && meta.num <= 99
      ? meta.num : null;
  }

  function identityRole(meta) {
    if (!identityQualified(meta)) { return null; }
    return CONTRACT.ROLES.indexOf(meta.role) !== -1 ? meta.role : null;
  }

  /**
   * Resolve a qualified shirt number from the current tracking player map
   * first. There is deliberately no id-suffix fallback: `H7` in the demo is
   * number 8, and an opaque track id is not a shirt number.
   */
  function shirtNumber(playerId) {
    if (typeof playerId !== 'string') { return null; }
    var latest = store.tracking.latest;
    if (latest) {
      for (var i = 0; i < latest.players.length; i += 1) {
        if (latest.players[i].id === playerId) { return identityNumber(latest.players[i]); }
      }
    }
    var selected = renderState.players[playerId];
    if (selected) { return identityNumber(selected); }
    return null;
  }

  function playerMetaFor(id) {
    if (renderState.players[id]) { return renderState.players[id]; }
    var latest = store.tracking.latest;
    if (latest) {
      for (var i = 0; i < latest.players.length; i += 1) {
        if (latest.players[i].id === id) { return latest.players[i]; }
      }
    }
    return null;
  }

  function isIntoBox(event) {
    if (event.intoBox === true) { return true; }
    var point = event.end || event.start;
    if (!point) { return false; }
    var home = event.team === 'home';
    return (home ? point.x >= 36 : point.x <= -36) && Math.abs(point.y) <= 20.16;
  }

  function invalid(stream, reason) {
    store.counters.invalid += 1;
    store.counters.lastInvalid = {
      stream: stream,
      reason: String(reason || 'invalid').slice(0, 160),
      at: Date.now()
    };
  }

  function bump(name, amount) {
    store.counters[name] = (store.counters[name] || 0) + (amount === undefined ? 1 : amount);
  }

  /**
   * Per-stream diagnostics: the last accepted sequence, the time it arrived and
   * an approximate one-second rate. Only the live head is recorded; replay
   * backfill frames are counted separately so a bulk fetch does not look like a
   * burst on the live stream.
   */
  function noteStream(stream, seq) {
    var stats = store.streams[stream];
    if (!stats) { return; }
    var now = nowMs();
    stats.lastAt = now;
    stats.lastSeq = seq;
    if (!stats.windowAt) { stats.windowAt = now; }
    stats.windowCount += 1;
    var elapsed = now - stats.windowAt;
    if (elapsed >= 1000) {
      stats.rate = stats.windowCount * 1000 / elapsed;
      stats.windowAt = now;
      stats.windowCount = 0;
    }
  }

  function streamRate(stream) {
    var stats = store.streams[stream];
    if (!stats || !stats.lastAt) { return 0; }
    if (nowMs() - stats.lastAt > 2000) { return 0; }
    return stats.rate;
  }

  function setError(message) {
    store.lastError = String(message || '').slice(0, 400);
    setText(el.dlgErr, store.lastError);
  }

  function setNotice(message) {
    store.lastNotice = String(message || '').slice(0, 400);
    setText(el.dlgOk, store.lastNotice);
  }

  function clearDialogMessages() {
    setText(el.dlgErr, '');
    setText(el.dlgOk, '');
    store.lastError = '';
    store.lastNotice = '';
  }

  // ------------------------------------------------------------------- //
  // Three.js scene (layout preserved from the original dashboard)
  // ------------------------------------------------------------------- //
  var scene = new THREE.Scene();
  var camera = new THREE.PerspectiveCamera(45, 1, 0.1, 500);
  var renderer = new THREE.WebGLRenderer({ canvas: el.cv, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

  function resizeStage() {
    var width = Math.max(1, el.stage.clientWidth);
    var height = Math.max(1, el.stage.clientHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resizeStage);
  resizeStage();
  window.setTimeout(resizeStage, 100);
  window.setTimeout(resizeStage, 400);

  scene.add(new THREE.AmbientLight(0xffffff, 0.85));
  var directionLight = new THREE.DirectionalLight(0xffffff, 0.5);
  directionLight.position.set(20, 60, 30);
  scene.add(directionLight);

  (function buildPitch() {
    var canvas = document.createElement('canvas');
    canvas.width = 1050;
    canvas.height = 680;
    var context = canvas.getContext('2d');
    context.fillStyle = '#0b5a38';
    context.fillRect(0, 0, 1050, 680);
    for (var stripe = 0; stripe < 14; stripe += 1) {
      context.fillStyle = stripe % 2 ? 'rgba(255,255,255,.04)' : 'rgba(0,0,0,.07)';
      context.fillRect(stripe * 75, 0, 75, 680);
    }
    context.strokeStyle = 'rgba(255,255,255,.85)';
    context.lineWidth = 3;
    context.strokeRect(5, 5, 1040, 670);
    context.beginPath();
    context.moveTo(525, 5);
    context.lineTo(525, 675);
    context.stroke();
    context.beginPath();
    context.arc(525, 340, 91, 0, Math.PI * 2);
    context.stroke();
    [0, 1].forEach(function (side) {
      context.strokeRect(side ? 1045 - 165 : 5, 139, 165, 402);
      context.strokeRect(side ? 1045 - 55 : 5, 248, 55, 184);
    });
    var mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(105, 68),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(canvas) })
    );
    mesh.rotation.x = -Math.PI / 2;
    scene.add(mesh);
    [-1, 1].forEach(function (side) {
      var goal = new THREE.Mesh(
        new THREE.BoxGeometry(2, 2.4, 7.3),
        new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true })
      );
      goal.position.set(side * (PITCH_HALF_W + 1), 1.2, 0);
      scene.add(goal);
    });
  })();

  function makeLayer(width, height, y) {
    var canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    var texture = new THREE.CanvasTexture(canvas);
    var mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(105, 68),
      new THREE.MeshBasicMaterial({
        map: texture, transparent: true, depthWrite: false
      })
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = y;
    scene.add(mesh);
    return { canvas: canvas, ctx: canvas.getContext('2d'), texture: texture, mesh: mesh };
  }

  var heatLayer = makeLayer(42, 27, 0.03);
  var pcLayer = makeLayer(42, 27, 0.025);

  var ball = new THREE.Mesh(
    new THREE.SphereGeometry(0.5, 14, 12),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1 })
  );
  ball.visible = false;
  scene.add(ball);

  var selectRing = new THREE.Mesh(
    new THREE.RingGeometry(1.4, 1.8, 28),
    new THREE.MeshBasicMaterial({ color: 0x19e3ff, side: THREE.DoubleSide })
  );
  selectRing.rotation.x = -Math.PI / 2;
  selectRing.visible = false;
  scene.add(selectRing);

  var holderRing = new THREE.Mesh(
    new THREE.RingGeometry(1, 1.2, 28),
    new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide })
  );
  holderRing.rotation.x = -Math.PI / 2;
  holderRing.visible = false;
  scene.add(holderRing);

  var trailMax = 48;
  var trailPositions = new Float32Array(trailMax * 3);
  var trailColors = new Float32Array(trailMax * 3);
  var trailGeometry = new THREE.BufferGeometry();
  trailGeometry.setAttribute('position', new THREE.BufferAttribute(trailPositions, 3));
  trailGeometry.setAttribute('color', new THREE.BufferAttribute(trailColors, 3));
  var trailLine = new THREE.Line(
    trailGeometry,
    new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9 })
  );
  trailLine.frustumCulled = false;
  trailLine.visible = false;
  scene.add(trailLine);

  var netMax = 90;
  var netPositions = new Float32Array(netMax * 6);
  var netColors = new Float32Array(netMax * 6);
  var netGeometry = new THREE.BufferGeometry();
  netGeometry.setAttribute('position', new THREE.BufferAttribute(netPositions, 3));
  netGeometry.setAttribute('color', new THREE.BufferAttribute(netColors, 3));
  var netLines = new THREE.LineSegments(
    netGeometry,
    new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.55
    })
  );
  netLines.frustumCulled = false;
  scene.add(netLines);

  var offsideLine = new THREE.Mesh(
    new THREE.PlaneGeometry(0.3, 68),
    new THREE.MeshBasicMaterial({
      color: 0xff3e6c, transparent: true, opacity: 0.85, side: THREE.DoubleSide
    })
  );
  offsideLine.rotation.x = -Math.PI / 2;
  offsideLine.position.y = 0.06;
  offsideLine.visible = false;
  scene.add(offsideLine);

  var playerRoot = new THREE.Group();
  scene.add(playerRoot);
  var ghostRoot = new THREE.Group();
  scene.add(ghostRoot);

  var players = Object.create(null);
  var ghosts = Object.create(null);

  function createLabelTexture(meta) {
    var size = 64;
    var canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    var context = canvas.getContext('2d');
    var rgb = hexToRgb(teamColor(meta.team));
    context.fillStyle = 'rgb(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ')';
    context.beginPath();
    context.arc(32, 32, 28, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = '#ffffff';
    context.lineWidth = 3;
    context.stroke();
    context.fillStyle = '#ffffff';
    context.font = 'bold 34px sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    var number = identityNumber(meta);
    context.fillText(number === null ? '?' : String(number), 32, 34);
    return new THREE.CanvasTexture(canvas);
  }

  function removePlayerEntity(entity) {
    if (!entity) { return; }
    playerRoot.remove(entity.group);
    entity.group.traverse(function (node) {
      if (node.geometry) { node.geometry.dispose(); }
      if (node.material) {
        if (node.material.map) { node.material.map.dispose(); }
        node.material.dispose();
      }
    });
  }

  function ensurePlayer(meta) {
    if (!meta || !meta.id) { return null; }
    var entity = players[meta.id];
    var color = teamColor(meta.team);
    if (!entity) {
      var bodyMaterial = new THREE.MeshLambertMaterial({
        color: new THREE.Color().setStyle(color),
        emissive: new THREE.Color().setStyle(color).multiplyScalar(0.22),
        transparent: true,
        opacity: 0.9
      });
      var headMaterial = new THREE.MeshLambertMaterial({
        color: 0xffe0c0, transparent: true, opacity: 0.9
      });
      var body = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 2, 14), bodyMaterial);
      var head = new THREE.Mesh(new THREE.SphereGeometry(0.55, 12, 10), headMaterial);
      head.position.y = 1.5;
      var group = new THREE.Group();
      group.add(body);
      group.add(head);
      group.userData.playerId = meta.id;
      var texture = createLabelTexture(meta);
      var sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: texture, depthTest: false, transparent: true
      }));
      sprite.scale.set(2.8, 2.8, 1);
      sprite.position.y = 3.3;
      sprite.renderOrder = 10;
      group.add(sprite);
      group.position.set(0, 1, 0);
      group.visible = false;
      playerRoot.add(group);
      entity = {
        id: meta.id,
        group: group,
        body: body,
        head: head,
        sprite: sprite,
        texture: texture,
        team: meta.team,
        num: meta.num,
        shirt: identityNumber(meta),
        role: meta.role,
        color: color,
        conf: 1,
        lastSeenRender: nowMs(),
        prevX: null,
        prevZ: null,
        rotation: 0,
        visible: false
      };
      players[meta.id] = entity;
      return entity;
    }

    var shirt = identityNumber(meta);
    if (entity.team !== meta.team || entity.shirt !== shirt || entity.color !== color) {
      entity.team = meta.team;
      entity.num = meta.num;
      entity.shirt = shirt;
      entity.role = meta.role;
      entity.color = color;
      entity.body.material.color.setStyle(color);
      entity.body.material.emissive.setStyle(color).multiplyScalar(0.22);
      entity.sprite.material.map.dispose();
      entity.texture = createLabelTexture(meta);
      entity.sprite.material.map = entity.texture;
      entity.sprite.material.needsUpdate = true;
    }
    return entity;
  }

  function clearPlayers() {
    Object.keys(players).forEach(function (id) {
      removePlayerEntity(players[id]);
      delete players[id];
    });
    Object.keys(ghosts).forEach(function (id) {
      var ghost = ghosts[id];
      ghostRoot.remove(ghost);
      ghost.geometry.dispose();
      ghost.material.dispose();
      delete ghosts[id];
    });
  }

  function ensureGhost(id, color) {
    var ghost = ghosts[id];
    if (!ghost) {
      ghost = new THREE.Mesh(
        new THREE.CylinderGeometry(0.7, 0.7, 2, 8),
        new THREE.MeshBasicMaterial({
          color: color, wireframe: true, transparent: true, opacity: 0.55
        })
      );
      ghost.rotation.x = 0;
      ghostRoot.add(ghost);
      ghosts[id] = ghost;
    }
    ghost.material.color.setStyle(color);
    return ghost;
  }

  // ------------------------------------------------------------------- //
  // Camera modes
  // ------------------------------------------------------------------- //
  var cameraModes = [
    ['▣', 'Top-down'], ['🎥', 'Broadcast'], ['👤', 'Follow player'], ['⟳', 'Orbit'], ['👁️', 'Striker POV']
  ];

  function buildCameraButtons() {
    if (!el.cams) { return; }
    cameraModes.forEach(function (mode, index) {
      var button = document.createElement('button');
      var icon = make('span', null, mode[0]);
      button.appendChild(icon);
      button.appendChild(document.createTextNode(mode[1]));
      button.type = 'button';
      button.addEventListener('click', function () { setCameraMode(index); });
      if (index === 0) { button.classList.add('on'); }
      el.cams.appendChild(button);
    });
  }

  function setCameraMode(index) {
    store.cameraMode = index;
    if (!el.cams) { return; }
    Array.prototype.forEach.call(el.cams.children, function (button, position) {
      button.classList.toggle('on', position === index);
    });
  }

  buildCameraButtons();
  if (el.vr) {
    el.vr.addEventListener('click', function () { setCameraMode(4); });
  }

  // ------------------------------------------------------------------- //
  // Overlay toggles
  // ------------------------------------------------------------------- //
  var overlayButtons = {};
  [
    ['pc', 'Pitch control', '#3aa0ff'],
    ['heat', 'Heatmap', '#ffb020'],
    ['net', 'Pass network', '#19e3ff'],
    ['off', 'Offside line', '#ff3e6c']
  ].forEach(function (item) {
    var button = document.createElement('button');
    button.type = 'button';
    button.textContent = item[1];
    button.className = 'on';
    button.style.setProperty('--c', item[2]);
    button.addEventListener('click', function () {
      store.overlays[item[0]] = !store.overlays[item[0]];
      button.classList.toggle('on', !!store.overlays[item[0]]);
    });
    if (el.leg) { el.leg.appendChild(button); }
    overlayButtons[item[0]] = button;
  });

  var videoButton = document.createElement('button');
  videoButton.type = 'button';
  videoButton.textContent = 'Video';
  videoButton.className = 'on';
  videoButton.style.setProperty('--c', '#26f29a');
  videoButton.style.display = 'none';
  videoButton.addEventListener('click', function () {
    store.overlays.video = !store.overlays.video;
    videoButton.classList.toggle('on', !!store.overlays.video);
    applyVideoVisibility();
  });
  if (el.leg) { el.leg.appendChild(videoButton); }

  if (el.gh) {
    el.gh.checked = false;
    el.gh.addEventListener('change', function () {
      store.overlays.ghost = !!el.gh.checked;
    });
  }

  if (el.pp) {
    el.pp.addEventListener('click', function () {
      var isPaused = false;
      if (window.DashDemo2 && typeof window.DashDemo2.togglePause === 'function' && window.DashDemo2.isRunning()) {
        isPaused = window.DashDemo2.togglePause();
      } else if (store.video.active) {
        if (el.hls && el.hls.paused) {
          el.hls.play().catch(function () { /* autoplay policy */ });
        } else if (el.hls) {
          el.hls.pause();
        }
        isPaused = el.hls ? el.hls.paused : false;
      } else {
        store.paused = !store.paused;
        isPaused = store.paused;
      }
      store.paused = isPaused;
      if (el.ogVideo) {
        if (store.paused) { el.ogVideo.pause(); }
        else { el.ogVideo.play().catch(function () {}); }
      }
      el.pp.textContent = store.paused ? 'Play' : 'Pause';
      el.pp.classList.toggle('on', store.paused);
    });
  }

  Array.prototype.forEach.call(document.querySelectorAll('[data-r]'), function (button) {
    button.addEventListener('click', function () {
      store.rate = parseFloat(button.getAttribute('data-r')) || 1;
      if (store.video.active) {
        try { el.hls.playbackRate = store.rate; } catch (err) { /* ignore */ }
      }
      Array.prototype.forEach.call(document.querySelectorAll('[data-r]'), function (other) {
        other.classList.toggle('on', other === button);
      });
    });
  });

  // ------------------------------------------------------------------- //
  // Tracking buffer and interpolation
  // ------------------------------------------------------------------- //
  function bufferEntry(message) {
    var map = new Map();
    message.players.forEach(function (player) { map.set(player.id, player); });
    return {
      seq: message.seq,
      recvAt: nowMs(),
      mediaTime: Number(message.mediaTime) || 0,
      clock: message.clock,
      playerMap: map,
      ball: message.ball || null,
      holderId: message.holderId || null,
      possession: message.possession || null,
      msg: message
    };
  }

  function sampleKey(entry) {
    return store.video.active ? entry.mediaTime * 1000 : entry.recvAt;
  }

  function findBefore(target) {
    var buffer = store.tracking.buffer;
    if (!buffer.length) { return -1; }
    var low = 0;
    var high = buffer.length - 1;
    var answer = -1;
    while (low <= high) {
      var middle = (low + high) >> 1;
      if (sampleKey(buffer[middle]) <= target) {
        answer = middle;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }
    return answer;
  }

  function pickSample(now) {
    var buffer = store.tracking.buffer;
    if (!buffer.length) { return null; }

    var target;
    if (store.video.active && store.video.attached) {
      target = (Number(el.hls.currentTime) || 0) * 1000;
    } else {
      target = now - PLAYOUT_DELAY_MS;
    }

    if (store.paused && renderState.lastSample && !store.video.active) {
      return renderState.lastSample;
    }

    var index = findBefore(target);
    var first = buffer[0];
    var last = buffer[buffer.length - 1];

    if (index < 0) {
      if (sampleKey(first) - target > 1500) { return null; }
      return { a: first, b: null, t: 0, targetKey: target, extrapolateMs: 0 };
    }

    var a = buffer[index];
    var b = index + 1 < buffer.length ? buffer[index + 1] : null;
    var aKey = sampleKey(a);

    if (!b) {
      var gap = target - aKey;
      if (gap > 2000) { return null; }
      if (gap > 0 && gap <= MAX_EXTRAPOLATION_MS && index > 0) {
        return {
          a: a,
          b: null,
          t: 0,
          targetKey: target,
          extrapolateMs: gap,
          previous: buffer[index - 1]
        };
      }
      return { a: a, b: null, t: 0, targetKey: target, extrapolateMs: 0 };
    }

    var span = sampleKey(b) - aKey;
    var t = span > 0 ? clamp((target - aKey) / span, 0, 1) : 0;
    return { a: a, b: b, t: t, targetKey: target, extrapolateMs: 0 };
  }

  function interpolatedPositions(sample) {
    var a = sample.a;
    var b = sample.b;
    var t = sample.t;
    var result = Object.create(null);
    var ids = new Set();
    a.playerMap.forEach(function (_, id) { ids.add(id); });
    if (b) { b.playerMap.forEach(function (_, id) { ids.add(id); }); }

    ids.forEach(function (id) {
      var first = a.playerMap.get(id);
      var second = b ? b.playerMap.get(id) : null;
      if (!first && !second) { return; }
      if (!first) { first = second; }
      if (!second) { second = first; }
      var x = lerp(first.x, second.x, t);
      var y = lerp(first.y, second.y, t);
      var speed = lerp(first.speed, second.speed, t);
      var conf = lerp(first.conf, second.conf, t);
      if (sample.extrapolateMs > 0) {
        var previous = sample.previous ? sample.previous.playerMap.get(id) : null;
        if (previous) {
          var seconds = Math.max(0.001, (a.recvAt - sample.previous.recvAt) / 1000);
          if (store.video.active
            && Number.isFinite(a.mediaTime)
            && Number.isFinite(sample.previous.mediaTime)) {
            seconds = Math.max(0.001, a.mediaTime - sample.previous.mediaTime);
          }
          var step = sample.extrapolateMs / 1000;
          x += (first.x - previous.x) / seconds * step;
          y += (first.y - previous.y) / seconds * step;
        }
      }
      result[id] = {
        id: id,
        team: first.team,
        num: first.num,
        role: first.role,
        x: clamp(x, -PITCH_HALF_W, PITCH_HALF_W),
        y: clamp(y, -PITCH_HALF_H, PITCH_HALF_H),
        speed: Math.max(0, speed),
        conf: clamp(conf, 0, 1)
      };
    });
    return result;
  }

  function interpolatedBall(sample) {
    var a = sample.a;
    var b = sample.b;
    var t = sample.t;
    var first = a.ball;
    var second = b ? b.ball : null;
    if (!first && !second) { return null; }
    if (!first) { first = second; }
    if (!second) { second = first; }
    var x = lerp(first.x, second.x, t);
    var y = lerp(first.y, second.y, t);
    var z = lerp(first.z, second.z, t);
    var speed = lerp(first.speed, second.speed, t);
    var conf = lerp(first.conf, second.conf, t);
    if (sample.extrapolateMs > 0 && sample.previous && sample.previous.ball) {
      var seconds = Math.max(0.001, (a.recvAt - sample.previous.recvAt) / 1000);
      if (store.video.active
        && Number.isFinite(a.mediaTime)
        && Number.isFinite(sample.previous.mediaTime)) {
        seconds = Math.max(0.001, a.mediaTime - sample.previous.mediaTime);
      }
      var step = sample.extrapolateMs / 1000;
      x += (a.ball.x - sample.previous.ball.x) / seconds * step;
      y += (a.ball.y - sample.previous.ball.y) / seconds * step;
      z += (a.ball.z - sample.previous.ball.z) / seconds * step;
    }
    return {
      x: clamp(x, -PITCH_HALF_W, PITCH_HALF_W),
      y: clamp(y, -PITCH_HALF_H, PITCH_HALF_H),
      z: Math.max(0, z),
      speed: Math.max(0, speed),
      conf: clamp(conf, 0, 1),
      airborne: !!first.airborne
    };
  }

  /** The ball position for a sample, matching `interpolatedPositions`. */
  function extrapolatedBall(sample) {
    return interpolatedBall(sample);
  }

  function clockAt(sample) {
    var a = sample.a;
    var b = sample.b;
    if (!b) { return { period: a.clock.period, seconds: a.clock.seconds }; }
    var seconds = lerp(a.clock.seconds, b.clock.seconds, sample.t);
    if (b.clock.seconds < a.clock.seconds) { seconds = a.clock.seconds; }
    return { period: b.clock.period, seconds: Math.max(0, seconds) };
  }

  function updateHeatAndAffinity(rendered, deltaSeconds) {
    if (deltaSeconds <= 0) { return; }
    var ids = Object.keys(rendered);
    ids.forEach(function (id) {
      var player = rendered[id];
      var column = Math.floor((player.x + PITCH_HALF_W) / 105 * 42);
      var row = Math.floor((player.y + PITCH_HALF_H) / 68 * 27);
      if (column >= 0 && column < 42 && row >= 0 && row < 27) {
        heat[row * 42 + column] += deltaSeconds;
      }
    });
    for (var i = 0; i < ids.length; i += 1) {
      for (var j = i + 1; j < ids.length; j += 1) {
        var first = rendered[ids[i]];
        var second = rendered[ids[j]];
        if (first.team !== second.team) { continue; }
        var distance = Math.hypot(first.x - second.x, first.y - second.y);
        if (distance <= 14) {
          var key = ids[i] < ids[j] ? ids[i] + '|' + ids[j] : ids[j] + '|' + ids[i];
          affinity[key] = (affinity[key] || 0) + deltaSeconds * (1 - distance / 20);
        }
      }
    }
  }

  function pushHistory(rendered, targetKey) {
    var last = history[history.length - 1];
    if (last && Math.abs(targetKey - last.key) < HISTORY_STEP_MS) { return; }
    var snapshot = { key: targetKey, players: [] };
    Object.keys(rendered).forEach(function (id) {
      snapshot.players.push({ id: id, x: rendered[id].x, y: rendered[id].y, team: rendered[id].team });
    });
    history.push(snapshot);
    while (history.length > 64) { history.shift(); }
  }

  // ------------------------------------------------------------------- //
  // Rendering
  // ------------------------------------------------------------------- //
  function renderSample(sample, now) {
    var rendered = interpolatedPositions(sample);
    var ballState = extrapolatedBall(sample);
    var clock = clockAt(sample);

    renderState.players = rendered;
    renderState.ball = ballState;
    renderState.holderId = sample.a.holderId;
    renderState.possession = sample.a.possession;
    renderState.clock = clock;
    renderState.targetKey = sample.targetKey;
    renderState.extrapolated = sample.extrapolateMs > 0;
    renderState.lagMs = Math.max(0, Math.round(targetDelay(sample, now)));

    var visible = 0;
    Object.keys(rendered).forEach(function (id) {
      var player = rendered[id];
      var entity = ensurePlayer(player);
      if (!entity) { return; }
      entity.group.position.set(player.x, 1, player.y);
      if (entity.prevX !== null) {
        var dx = player.x - entity.prevX;
        var dz = player.y - entity.prevZ;
        if (dx * dx + dz * dz > 0.0004) {
          var targetRotation = Math.atan2(dx, dz);
          var difference = targetRotation - entity.rotation;
          while (difference > Math.PI) { difference -= Math.PI * 2; }
          while (difference < -Math.PI) { difference += Math.PI * 2; }
          entity.rotation += difference * 0.25;
          entity.group.rotation.y = entity.rotation;
        }
      }
      entity.prevX = player.x;
      entity.prevZ = player.y;
      entity.conf = player.conf;
      var opacity = 0.35 + 0.65 * player.conf;
      entity.body.material.opacity = opacity;
      entity.head.material.opacity = opacity;
      entity.sprite.material.opacity = 0.55 + 0.45 * player.conf;
      entity.group.visible = true;
      entity.lastSeenRender = now;
      entity.visible = true;
      visible += 1;
    });
    renderState.visiblePlayers = visible;

    Object.keys(players).forEach(function (id) {
      var entity = players[id];
      if (now - entity.lastSeenRender > PLAYER_HIDE_MS) {
        entity.group.visible = false;
        entity.visible = false;
      }
    });

    // Ball: null or low confidence is hidden after 300 ms, never instantly.
    var ballOk = ballState && ballState.conf >= BALL_CONF_MIN;
    if (ballOk) {
      ballMissingSince = null;
      ball.visible = true;
      ball.material.opacity = 0.35 + 0.65 * ballState.conf;
      ball.position.set(ballState.x, Math.max(0.3, ballState.z), ballState.y);
    } else {
      if (ballMissingSince === null) { ballMissingSince = now; }
      if (now - ballMissingSince > BALL_HIDE_MS) {
        ball.visible = false;
      }
    }

    var holder = renderState.holderId ? rendered[renderState.holderId] : null;
    if (holder) {
      holderRing.visible = true;
      holderRing.position.set(holder.x, 0.09, holder.y);
    } else {
      holderRing.visible = false;
    }

    var selected = store.selectedPlayerId ? rendered[store.selectedPlayerId] : null;
    if (selected) {
      selectRing.visible = true;
      selectRing.position.set(selected.x, 0.08, selected.y);
    } else {
      selectRing.visible = false;
    }

    if (ballOk) {
      if (!trail.length
        || Math.hypot(ball.position.x - trail[0].x, ball.position.z - trail[0].z) > 0.05) {
        trail.unshift({
          x: ball.position.x,
          y: ball.position.y,
          z: ball.position.z,
          speed: ballState.speed
        });
        if (trail.length > trailMax) { trail.pop(); }
      }
      trailLine.visible = true;
      for (var index = 0; index < trailMax; index += 1) {
        var point = trail[Math.min(index, trail.length - 1)] || { x: 0, y: 0, z: 0, speed: 0 };
        var ratio = clamp(point.speed / 130, 0, 1);
        trailPositions[index * 3] = point.x;
        trailPositions[index * 3 + 1] = point.y;
        trailPositions[index * 3 + 2] = point.z;
        trailColors[index * 3] = ratio;
        trailColors[index * 3 + 1] = 0.8 * (1 - ratio) + 0.1;
        trailColors[index * 3 + 2] = 1 - ratio;
      }
      trailGeometry.attributes.position.needsUpdate = true;
      trailGeometry.attributes.color.needsUpdate = true;
      trailGeometry.setDrawRange(0, trail.length);

      if (ballState.speed > 16) { speedRingUntil = now + 2500; }
    } else if (!ball.visible) {
      // Keep the trail through the 300 ms hide grace instead of dropping it
      // on the first null or low-confidence frame.
      trailLine.visible = false;
    }

    var speedRing = el.ring;
    if (ball.visible && ballOk && now < speedRingUntil) {
      var projected = new THREE.Vector3(ball.position.x, ball.position.y, ball.position.z)
        .project(camera);
      var width = el.stage.clientWidth;
      var height = el.stage.clientHeight;
      if (projected.z < 1) {
        speedRing.style.display = 'block';
        speedRing.style.left = ((projected.x * 0.5 + 0.5) * width) + 'px';
        speedRing.style.top = ((-projected.y * 0.5 + 0.5) * height - 50) + 'px';
        setText(el.rv, Math.round(ballState.speed));
        var arc = clamp(ballState.speed / 130, 0, 1) * 226;
        el.rc.setAttribute('stroke-dasharray', arc + ' 226');
      } else {
        speedRing.style.display = 'none';
      }
    } else {
      speedRing.style.display = 'none';
    }

    var jumped = renderState.lastTargetKey !== null
      && Math.abs(sample.targetKey - renderState.lastTargetKey) > TARGET_JUMP_MS;
    if (jumped) {
      // A seek is not play: clear the trail, the ghost history and the affinity
      // window instead of drawing a line across the pitch between two moments.
      trail.length = 0;
      history.length = 0;
      affinity = Object.create(null);
      ballMissingSince = null;
    }
    var delta = 0;
    if (!store.paused && !jumped && renderState.lastTargetKey !== null) {
      delta = (sample.targetKey - renderState.lastTargetKey) / 1000;
      if (delta < 0) { delta = 0; }
      delta = Math.min(delta, 0.5);
    }
    updateHeatAndAffinity(rendered, delta);
    pushHistory(rendered, sample.targetKey);
    renderState.lastTargetKey = sample.targetKey;
    renderState.lastSample = sample;
  }

  function targetDelay(sample, now) {
    if (store.video.active) {
      var newest = store.tracking.latest;
      if (newest && Number.isFinite(newest.mediaTime)) {
        renderState.driftMs = Math.round((el.hls.currentTime - newest.mediaTime) * 1000);
      }
      return sample.a ? Math.max(0, (el.hls.currentTime - sample.a.mediaTime) * 1000) : 0;
    }
    return now - sample.targetKey;
  }

  function drawHeat() {
    heatLayer.mesh.visible = !!store.overlays.heat;
    if (!store.overlays.heat) { return; }
    var max = 1;
    for (var i = 0; i < heat.length; i += 1) {
      if (heat[i] > max) { max = heat[i]; }
    }
    var image = heatLayer.ctx.createImageData(42, 27);
    for (var cell = 0; cell < heat.length; cell += 1) {
      var value = clamp(heat[cell] / max, 0, 1);
      image.data[cell * 4] = 255;
      image.data[cell * 4 + 1] = Math.round(200 - 170 * value);
      image.data[cell * 4 + 2] = 30;
      image.data[cell * 4 + 3] = Math.round(Math.pow(value, 0.8) * 150);
    }
    heatLayer.ctx.putImageData(image, 0, 0);
    heatLayer.texture.needsUpdate = true;
  }

  function drawPitchControl() {
    pcLayer.mesh.visible = !!store.overlays.pc;
    if (!store.overlays.pc) { return; }
    var analytics = store.analytics.latest;
    if (!analytics && !Object.keys(renderState.players).length) {
      setText(el.pcv, EN_DASH);
      setText(el.pcw, EN_DASH);
      el.pcb.style.width = '0%';
      el.pc.title = 'Waiting for analytics or tracking';
      return;
    }
    var home = hexToRgb(teamColor('home'));
    var away = hexToRgb(teamColor('away'));
    var grid = analytics ? analytics.pitchControlGrid : null;
    var image = pcLayer.ctx.createImageData(42, 27);
    var homeSum = 0;
    var cells = 0;

    for (var row = 0; row < 27; row += 1) {
      for (var column = 0; column < 42; column += 1) {
        var share;
        if (Array.isArray(grid)) {
          var gx = Math.min(20, Math.floor((column + 0.5) / 42 * 21));
          var gy = Math.min(13, Math.floor((row + 0.5) / 27 * 14));
          share = grid[gx][gy];
        } else {
          var x = (column + 0.5) / 42 * 105 - PITCH_HALF_W;
          var y = (row + 0.5) / 27 * 68 - PITCH_HALF_H;
          var homeWeight = 0;
          var awayWeight = 0;
          Object.keys(renderState.players).forEach(function (id) {
            var player = renderState.players[id];
            var weight = Math.exp(-Math.hypot(player.x - x, player.y - y) / 9);
            if (player.team === 'home') { homeWeight += weight; } else { awayWeight += weight; }
          });
          share = homeWeight / (homeWeight + awayWeight + 1e-6);
        }
        homeSum += share;
        cells += 1;
        var color = share > 0.5 ? home : away;
        var offset = (row * 42 + column) * 4;
        image.data[offset] = color.r;
        image.data[offset + 1] = color.g;
        image.data[offset + 2] = color.b;
        image.data[offset + 3] = Math.round(Math.abs(share - 0.5) * 2 * 140);
      }
    }
    pcLayer.ctx.putImageData(image, 0, 0);
    pcLayer.texture.needsUpdate = true;

    var aggregate = analytics ? analytics.pitchControl.home : null;
    var source = aggregate;
    if (!Number.isFinite(source)) { source = homeSum / Math.max(1, cells); }
    var percent = Math.round(clamp(source, 0, 1) * 100);
    setText(el.pcv, percent + '%');
    setText(el.pcw, (100 - percent) + '%');
    el.pcb.style.width = percent + '%';
    el.pc.title = Array.isArray(grid) ? 'Pitch control from analytics grid'
      : 'Pitch control estimated from tracking';
  }

  function drawNetwork() {
    netLines.visible = !!store.overlays.net;
    if (!store.overlays.net) { return; }
    var entries = [];
    Object.keys(affinity).forEach(function (key) {
      var pair = key.split('|');
      if (renderState.players[pair[0]] && renderState.players[pair[1]]) {
        entries.push({ a: pair[0], b: pair[1], weight: affinity[key] });
      }
    });
    entries.sort(function (first, second) { return second.weight - first.weight; });
    if (!entries.length) {
      var ids = Object.keys(renderState.players);
      for (var i = 0; i < ids.length; i += 1) {
        var source = renderState.players[ids[i]];
        var nearest = [];
        for (var j = 0; j < ids.length; j += 1) {
          if (i === j) { continue; }
          var target = renderState.players[ids[j]];
          if (target.team !== source.team) { continue; }
          nearest.push({
            id: ids[j],
            distance: Math.hypot(source.x - target.x, source.y - target.y)
          });
        }
        nearest.sort(function (first, second) { return first.distance - second.distance; });
        nearest.slice(0, 2).forEach(function (item) {
          entries.push({ a: ids[i], b: item.id, weight: 1 / (1 + item.distance) });
        });
      }
    }
    var count = Math.min(netMax, entries.length);
    for (var edge = 0; edge < count; edge += 1) {
      var item = entries[edge];
      var start = renderState.players[item.a];
      var end = renderState.players[item.b];
      var color = hexToRgb(teamColor(start.team));
      var offset = edge * 6;
      netPositions[offset] = start.x;
      netPositions[offset + 1] = 0.2;
      netPositions[offset + 2] = start.y;
      netPositions[offset + 3] = end.x;
      netPositions[offset + 4] = 0.2;
      netPositions[offset + 5] = end.y;
      netColors[offset] = color.r / 255;
      netColors[offset + 1] = color.g / 255;
      netColors[offset + 2] = color.b / 255;
      netColors[offset + 3] = color.r / 255;
      netColors[offset + 4] = color.g / 255;
      netColors[offset + 5] = color.b / 255;
    }
    netGeometry.attributes.position.needsUpdate = true;
    netGeometry.attributes.color.needsUpdate = true;
    netGeometry.setDrawRange(0, count * 2);
  }

  function drawGhost() {
    var enabled = !!store.overlays.ghost;
    ghostRoot.visible = enabled;
    if (!enabled || renderState.targetKey === null || !history.length) {
      return;
    }
    var wanted = renderState.targetKey - GHOST_SECONDS * 1000;
    var best = null;
    history.forEach(function (snapshot) {
      var distance = Math.abs(snapshot.key - wanted);
      if (!best || distance < best.distance) { best = { snapshot: snapshot, distance: distance }; }
    });
    if (!best || best.distance > 3000) {
      Object.keys(ghosts).forEach(function (id) { ghosts[id].visible = false; });
      return;
    }
    var seen = Object.create(null);
    best.snapshot.players.forEach(function (player) {
      var ghost = ensureGhost(player.id, teamColor(player.team));
      seen[player.id] = true;
      ghost.visible = true;
      ghost.position.set(player.x, 1, player.y);
    });
    Object.keys(ghosts).forEach(function (id) {
      if (!seen[id]) { ghosts[id].visible = false; }
    });
  }

  function drawOffside() {
    var attacking = renderState.possession
      || (renderState.holderId && renderState.players[renderState.holderId]
        ? renderState.players[renderState.holderId].team : null)
      || (!renderState.lastSample ? store.possessionTeam : null);
    if (!attacking || !store.overlays.off) {
      offsideLine.visible = false;
      return;
    }
    var direction = (attacking === 'home')
      ? (renderState.clock.period === 1 ? 1 : -1)
      : (renderState.clock.period === 1 ? -1 : 1);
    var defenders = Object.keys(renderState.players)
      .map(function (id) { return renderState.players[id]; })
      .filter(function (player) { return player.team !== attacking; });
    if (defenders.length < 2) {
      offsideLine.visible = false;
      return;
    }
    defenders.sort(function (first, second) {
      if (direction > 0) { return second.x - first.x; }
      return first.x - second.x;
    });
    offsideLine.visible = true;
    offsideLine.position.x = defenders[1].x;
  }

  // ------------------------------------------------------------------- //
  // Camera
  // ------------------------------------------------------------------- //
  var cameraPosition = new THREE.Vector3(0, 90, 40);
  var cameraLook = new THREE.Vector3();

  function updateCamera(now) {
    var focus = null;
    if (store.selectedPlayerId) {
      var selected = renderState.players[store.selectedPlayerId];
      if (selected) { focus = { x: selected.x, z: selected.y, team: selected.team }; }
    }
    if (!focus && ball.visible) {
      focus = { x: ball.position.x, z: ball.position.z, team: null };
    }
    if (!focus) {
      focus = { x: 0, z: 0, team: null };
    }

    var aspect = camera.aspect < 1.3 ? 1.5 : 1;
    var targetPosition = new THREE.Vector3();
    var targetLook = new THREE.Vector3();
    var mode = store.cameraMode;
    if (mode === 0) {
      targetPosition.set(0, 85 * aspect, 38 * aspect);
      targetLook.set(0, 0, 2);
    } else if (mode === 1) {
      targetPosition.set(focus.x * 0.4, 34 * aspect, 62 * aspect);
      targetLook.set(focus.x * 0.6, 0, 0);
    } else if (mode === 2) {
      var side = focus.team === 'away' ? -1 : 1;
      targetPosition.set(focus.x - side * 18, 14, focus.z + 22);
      targetLook.set(focus.x, 0, focus.z);
    } else if (mode === 3) {
      var angle = now / 9000;
      targetPosition.set(Math.cos(angle) * 78 * aspect, 46 * aspect, Math.sin(angle) * 78 * aspect);
      targetLook.set(0, 0, 0);
    } else if (mode === 4) {
      var attackGoalX = (focus.team === 'away' ? -52.5 : 52.5);
      var lookTargetX = (ball && ball.visible) ? ball.position.x : attackGoalX;
      var lookTargetZ = (ball && ball.visible) ? ball.position.z : 0;
      var dirX = lookTargetX - focus.x;
      var dirZ = lookTargetZ - focus.z;
      var len = Math.hypot(dirX, dirZ) || 1;
      dirX /= len; dirZ /= len;
      targetPosition.set(focus.x - dirX * 1.5, 1.75, focus.z - dirZ * 1.5);
      targetLook.set(focus.x + dirX * 30, 1.6, focus.z + dirZ * 30);
    } else {
      var facing = focus.team === 'away' ? -1 : 1;
      targetPosition.set(focus.x - facing * 1.5, 3, focus.z + 5);
      targetLook.set(focus.x, 2.5, focus.z);
    }
    cameraPosition.lerp(targetPosition, mode === 4 ? 0.2 : 0.05);
    cameraLook.lerp(targetLook, 0.1);
    camera.position.copy(cameraPosition);
    camera.lookAt(cameraLook);
  }

  // ------------------------------------------------------------------- //
  // Canvas selection
  // ------------------------------------------------------------------- //
  var raycaster = new THREE.Raycaster();
  el.cv.addEventListener('click', function (event) {
    if (store.video.active && store.video.visible) { return; }
    var rect = el.cv.getBoundingClientRect();
    var pointer = new THREE.Vector2(
      (event.clientX - rect.left) / rect.width * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    );
    raycaster.setFromCamera(pointer, camera);
    var hits = raycaster.intersectObjects(Object.keys(players).map(function (id) {
      return players[id].group;
    }), true);
    if (!hits.length) { return; }
    var node = hits[0].object;
    while (node && !node.userData.playerId) { node = node.parent; }
    if (node && node.userData.playerId) {
      store.selectedPlayerId = node.userData.playerId;
      updatePlayerCard();
    }
  });

  // ------------------------------------------------------------------- //
  // Live Broadcast AR Turf Overlay
  // ------------------------------------------------------------------- //
  function projectPitchToVideo(px, py, width, height) {
    var normX = px / 52.5;
    var normY = (py + 34.0) / 68.0;
    var span = 0.72 + normY * 0.24;
    var u = (width * 0.5) + (normX * span * width * 0.46);
    var v = height * (0.30 + normY * 0.60);
    return { x: u, y: v };
  }

  function renderArOverlay(sample, now) {
    if (!el.arCanvas || !el.ogVideo) { return; }
    if (!store.arOverlayActive) {
      if (el.arCanvas.width > 0) {
        var ctxEmpty = el.arCanvas.getContext('2d');
        if (ctxEmpty) { ctxEmpty.clearRect(0, 0, el.arCanvas.width, el.arCanvas.height); }
      }
      return;
    }
    var rect = el.ogVideo.getBoundingClientRect();
    if (!rect.width || !rect.height) { return; }
    if (el.arCanvas.width !== Math.round(rect.width) || el.arCanvas.height !== Math.round(rect.height)) {
      el.arCanvas.width = Math.round(rect.width);
      el.arCanvas.height = Math.round(rect.height);
    }
    var w = el.arCanvas.width;
    var h = el.arCanvas.height;
    var ctx = el.arCanvas.getContext('2d');
    if (!ctx) { return; }
    ctx.clearRect(0, 0, w, h);

    if (!sample || !sample.players) { return; }
    var players = sample.players;
    var ballSample = sample.ball;

    players.forEach(function (p) {
      if (!p || typeof p.x !== 'number') { return; }
      var pos = projectPitchToVideo(p.x, p.y, w, h);
      var isHome = p.team === 'home';
      var ringColor = isHome ? 'rgba(58, 160, 255, 0.45)' : 'rgba(255, 176, 32, 0.45)';
      var strokeColor = isHome ? 'rgba(58, 160, 255, 0.85)' : 'rgba(255, 176, 32, 0.85)';

      ctx.save();
      ctx.beginPath();
      ctx.ellipse(pos.x, pos.y, 14, 6, 0, 0, Math.PI * 2);
      ctx.fillStyle = ringColor;
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = strokeColor;
      ctx.stroke();

      if (p.speed > 20 || (ballSample && Math.hypot(p.x - ballSample.x, p.y - ballSample.y) < 3)) {
        ctx.fillStyle = 'rgba(5, 15, 30, 0.85)';
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = 1;
        var tagW = 44, tagH = 16;
        var tagX = pos.x - tagW / 2, tagY = pos.y - 28;
        ctx.fillRect(tagX, tagY, tagW, tagH);
        ctx.strokeRect(tagX, tagY, tagW, tagH);
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 9px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('#' + (p.num || p.id) + ' ' + Math.round(p.speed) + 'k', pos.x, tagY + 11);
      }
      ctx.restore();
    });

    if (sample.holderId && ballSample) {
      var holder = players.find(function (p) { return p.id === sample.holderId; });
      if (holder) {
        var mates = players.filter(function (p) { return p.team === holder.team && p.id !== holder.id; });
        mates.sort(function (a, b) { return (Math.abs(a.x) - Math.abs(b.x)); });
        var targetMate = mates[0];
        if (targetMate) {
          var p1 = projectPitchToVideo(holder.x, holder.y, w, h);
          var p2 = projectPitchToVideo(targetMate.x, targetMate.y, w, h);

          ctx.save();
          var pulse = (Math.sin(now / 150) + 1) * 0.5;
          ctx.beginPath();
          ctx.moveTo(p1.x, p1.y);
          ctx.lineTo(p2.x, p2.y);
          ctx.lineWidth = 2.5 + pulse;
          ctx.strokeStyle = 'rgba(38, 242, 154, 0.9)';
          ctx.setLineDash([8, 4]);
          ctx.lineDashOffset = -(now / 20) % 24;
          ctx.stroke();

          var midX = (p1.x + p2.x) / 2;
          var midY = (p1.y + p2.y) / 2 - 8;
          ctx.setLineDash([]);
          ctx.fillStyle = 'rgba(10, 30, 20, 0.9)';
          ctx.strokeStyle = '#26f29a';
          ctx.lineWidth = 1;
          ctx.fillRect(midX - 35, midY - 8, 70, 16);
          ctx.strokeRect(midX - 35, midY - 8, 70, 16);
          ctx.fillStyle = '#26f29a';
          ctx.font = 'bold 8.5px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText('⚡ 87% PASS', midX, midY + 4);
          ctx.restore();
        }
      }
    }

    if (ballSample && ballSample.speed > 35) {
      var isTowardsRight = ballSample.x > 10;
      var goalX = isTowardsRight ? 52.5 : -52.5;
      var bPos = projectPitchToVideo(ballSample.x, ballSample.y, w, h);
      var gPos = projectPitchToVideo(goalX, 0, w, h);

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(bPos.x, bPos.y);
      var ctrlX = (bPos.x + gPos.x) / 2;
      var ctrlY = Math.min(bPos.y, gPos.y) - 45;
      ctx.quadraticCurveTo(ctrlX, ctrlY, gPos.x, gPos.y);
      ctx.lineWidth = 3;
      var grad = ctx.createLinearGradient(bPos.x, bPos.y, gPos.x, gPos.y);
      grad.addColorStop(0, '#3aa0ff');
      grad.addColorStop(1, '#ff3e6c');
      ctx.strokeStyle = grad;
      ctx.stroke();

      ctx.fillStyle = 'rgba(255, 62, 108, 0.9)';
      ctx.fillRect(ctrlX - 40, ctrlY - 10, 80, 18);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 9px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(Math.round(ballSample.speed) + ' km/h · 0.38 xG', ctrlX, ctrlY + 3);
      ctx.restore();
    }
  }

  if (el.toggleArOverlay) {
    el.toggleArOverlay.addEventListener('click', function () {
      store.arOverlayActive = !store.arOverlayActive;
      el.toggleArOverlay.style.background = store.arOverlayActive ? 'rgba(38,242,154,0.18)' : 'rgba(255,255,255,0.06)';
      el.toggleArOverlay.style.color = store.arOverlayActive ? '#26f29a' : 'var(--mu)';
    });
  }

  // ------------------------------------------------------------------- //
  // Frame loop
  // ------------------------------------------------------------------- //
  var lastFrame = nowMs();

  function frame(now) {
    try {
      renderFrame(now);
    } catch (error) {
      bump('renderErrors');
      store.lastError = 'render: '
        + String(error && error.message ? error.message : error).slice(0, 200);
    }
    requestAnimationFrame(frame);
  }

  function renderFrame(now) {
    var dt = Math.min((now - lastFrame) / 1000, 0.05);
    lastFrame = now;

    var sample = pickSample(now);
    if (sample) { renderSample(sample, now); }

    updateCamera(now);
    drawGhost();
    renderArOverlay(sample, now);

    if (now - renderState.lastPcAt > 1000) {
      renderState.lastPcAt = now;
      drawPitchControl();
    }
    if (now - renderState.lastHeatAt > 1000) {
      renderState.lastHeatAt = now;
      drawHeat();
    }
    if (now - renderState.lastNetAt > 500) {
      renderState.lastNetAt = now;
      drawNetwork();
      drawOffside();
    }
    if (now - renderState.lastWhatIfAt > 500) {
      renderState.lastWhatIfAt = now;
      updateWhatIf();
    }
    if (now - renderState.lastFormationAt > 700) {
      renderState.lastFormationAt = now;
      updateFormationCanvases();
    }
    if (now - renderState.lastUiAt > UI_TICK_MS) {
      renderState.lastUiAt = now;
      updateHud();
      updatePlayerCard();
      // Initial attach and normal playback can both outrun the buffer, not
      // only an explicit seek: keep the playhead window filled.
      if (store.video.active) { maybeBackfill(); }
    }
    if (debugEnabled && now - renderState.lastDebugAt > DEBUG_TICK_MS) {
      renderState.lastDebugAt = now;
      updateDebug();
    }

    var renderStart = nowMs();
    renderer.render(scene, camera);
    renderState.renderMs = nowMs() - renderStart;
    renderState.lastFrameAt = now;
    if (dt > 0) {
      var fps = 1 / dt;
      renderState.fps = renderState.fps
        ? renderState.fps * 0.9 + fps * 0.1
        : fps;
    }
  }

  /**
   * rAF is the normal paint clock, but it is suspended in background tabs,
   * headless captures and some embedded previews. The panels must keep
   * following the data anyway, so a timer backs the HUD up and rescues the 3D
   * frame when rAF has stalled. Both paths share `lastUiAt`, so a healthy rAF
   * leaves this a no-op.
   */
  function uiHeartbeat() {
    var now = nowMs();
    if (now - renderState.lastUiAt < UI_TICK_MS) { return; }
    renderState.lastUiAt = now;
    try {
      updateHud();
      updatePlayerCard();
    } catch (error) {
      bump('renderErrors');
      store.lastError = 'render: '
        + String(error && error.message ? error.message : error).slice(0, 200);
    }
    if (store.mode === 'idle' || now - renderState.lastFrameAt < 500) { return; }
    renderState.lastFrameAt = now;
    try {
      renderFrame(now);
    } catch (error) {
      bump('renderErrors');
      store.lastError = 'render: '
        + String(error && error.message ? error.message : error).slice(0, 200);
    }
  }

  var uiHeartbeatTimer = null;

  // Function declarations from the next section are hoisted; the loop is
  // started at boot so the UI module can finish wiring first.
  window.__pvFrame = frame;

  // ------------------------------------------------------------------- //
  // Team identity, scoreboard and clocks
  // ------------------------------------------------------------------- //
  var EN_DASH = '\u2013';

  /** Apply the server-owned team names and colours from a match summary. */
  function applyTeamIdentity(summary) {
    var homeName = typeof summary.homeTeam === 'string' && summary.homeTeam
      ? summary.homeTeam : DEFAULT_TEAMS.home;
    var awayName = typeof summary.awayTeam === 'string' && summary.awayTeam
      ? summary.awayTeam : DEFAULT_TEAMS.away;
    var homeColor = CONTRACT.safeColor(
      summary.colors && summary.colors.home, DEFAULT_COLORS.home);
    var awayColor = CONTRACT.safeColor(
      summary.colors && summary.colors.away, DEFAULT_COLORS.away);

    store.teams.home = homeName;
    store.teams.away = awayName;
    store.teams.colors.home = homeColor;
    store.teams.colors.away = awayColor;

    // Only validated hex values reach a style declaration (safeColor).
    document.documentElement.style.setProperty('--h', homeColor);
    document.documentElement.style.setProperty('--a', awayColor);
    store.dirty.feed = true;
    store.dirty.highlights = true;

    setText(el.tn0, homeName);
    setText(el.tn1, awayName);
    setText(el.xn0, homeName);
    setText(el.xn1, awayName);
    setText(el.xtn0, homeName);
    setText(el.xtn1, awayName);
    setText(el.wln0, homeName);
    setText(el.wln1, awayName);
  }

  function resetTeamIdentity() {
    applyTeamIdentity({
      homeTeam: DEFAULT_TEAMS.home,
      awayTeam: DEFAULT_TEAMS.away,
      colors: { home: DEFAULT_COLORS.home, away: DEFAULT_COLORS.away }
    });
  }

  /** The live clock always comes from the tracking stream (`clock`). */
  function liveClock() {
    // In video mode the HUD must follow the frame that is on screen, not the
    // decode head, or a paused or rewound player shows the wrong minute.
    if (renderState.lastSample) {
      return { period: renderState.clock.period, seconds: renderState.clock.seconds };
    }
    if (store.tracking.latest) {
      return { period: store.clock.period, seconds: store.clock.seconds };
    }
    return { period: 1, seconds: 0 };
  }

  function updateHud() {
    setText(el.sh, store.score.home == null ? EN_DASH : String(store.score.home));
    setText(el.sa, store.score.away == null ? EN_DASH : String(store.score.away));

    var hasTracking = !!store.tracking.latest;
    var clock = liveClock();
    setText(el.clock, hasTracking ? formatClock(clock.seconds) : '0:00');
    setText(el.half, hasTracking ? halfLabel(clock.period, clock.seconds)
      : (store.matchStatus === 'live' ? 'live' : 'waiting'));

    var homePossession = store.possessionPct.home;
    var awayPossession = store.possessionPct.away;
    if (Number.isFinite(homePossession) && Number.isFinite(awayPossession)) {
      setText(el.ph, Math.round(homePossession) + '%');
      setText(el.pa, Math.round(awayPossession) + '%');
      el.pb.style.width = clamp(homePossession, 0, 100) + '%';
    } else {
      setText(el.ph, EN_DASH);
      setText(el.pa, EN_DASH);
      el.pb.style.width = '0%';
    }

    if (el.now) {
      el.now.style.left = clamp(liveClock().seconds / 5400 * 100, 0, 100) + '%';
    }
    if (store.dirty.stats) {
      store.dirty.stats = false;
      renderStatsPanels();
    }
    if (store.dirty.feed) {
      store.dirty.feed = false;
      renderFeed();
    }
    if (store.dirty.highlights) {
      store.dirty.highlights = false;
      renderHighlights();
      renderTimeline();
    }
    if (store.dirty.commentary) {
      store.dirty.commentary = false;
      renderCommentary();
    }
  }

  // ------------------------------------------------------------------- //
  // Analytics panels: xG, xT, team stats, win probability
  // ------------------------------------------------------------------- //
  var statsCells = null;

  function buildStatsPanels() {
    if (statsCells || !el.tstats) { return; }
    statsCells = {};
    [
      ['possession', 'Possession'],
      ['shots', 'Shots'],
      ['passes', 'Passes'],
      ['xg', 'Expected goals'],
      ['xt', 'Expected threat'],
      ['pc', 'Pitch control']
    ].forEach(function (definition) {
      var row = make('div', 'trow');
      var label = make('span', null, definition[1]);
      var home = make('b', null, EN_DASH);
      var away = make('b', null, EN_DASH);
      row.appendChild(label);
      row.appendChild(home);
      row.appendChild(away);
      el.tstats.appendChild(row);
      statsCells[definition[0]] = { label: label, home: home, away: away };
    });
  }

  function numberText(value, digits) {
    if (!Number.isFinite(value)) { return EN_DASH; }
    return digits === undefined ? String(Math.round(value)) : value.toFixed(digits);
  }

  function renderStatsPanels() {
    buildStatsPanels();
    var analytics = store.analytics.latest;

    var xgHome = analytics ? analytics.xg.home : null;
    var xgAway = analytics ? analytics.xg.away : null;
    setText(el.x0, numberText(xgHome, 2));
    setText(el.x1, numberText(xgAway, 2));
    var xgMax = Math.max(xgHome || 0, xgAway || 0, 0.01);
    if (el.xb0) { el.xb0.style.width = (Number.isFinite(xgHome) ? xgHome / xgMax * 100 : 0) + '%'; }
    if (el.xb1) { el.xb1.style.width = (Number.isFinite(xgAway) ? xgAway / xgMax * 100 : 0) + '%'; }

    var xtHome = analytics ? analytics.xt.home : null;
    var xtAway = analytics ? analytics.xt.away : null;
    setText(el.t0, numberText(xtHome, 2));
    setText(el.t1, numberText(xtAway, 2));
    var xtMax = Math.max(xtHome || 0, xtAway || 0, 0.01);
    if (el.tb0) { el.tb0.style.width = (Number.isFinite(xtHome) ? xtHome / xtMax * 100 : 0) + '%'; }
    if (el.tb1) { el.tb1.style.width = (Number.isFinite(xtAway) ? xtAway / xtMax * 100 : 0) + '%'; }

    if (statsCells) {
      var possession = analytics ? analytics.possessionPct : null;
      var shots = analytics ? analytics.shots : null;
      var passes = analytics ? analytics.passes : null;
      var pitchControl = analytics ? analytics.pitchControl : null;
      setText(statsCells.possession.home, possession ? numberText(possession.home) + '%' : EN_DASH);
      setText(statsCells.possession.away, possession ? numberText(possession.away) + '%' : EN_DASH);
      setText(statsCells.shots.home, shots ? numberText(shots.home) : EN_DASH);
      setText(statsCells.shots.away, shots ? numberText(shots.away) : EN_DASH);
      setText(statsCells.passes.home, passes ? numberText(passes.home) : EN_DASH);
      setText(statsCells.passes.away, passes ? numberText(passes.away) : EN_DASH);
      setText(statsCells.xg.home, numberText(xgHome, 2));
      setText(statsCells.xg.away, numberText(xgAway, 2));
      setText(statsCells.xt.home, numberText(xtHome, 2));
      setText(statsCells.xt.away, numberText(xtAway, 2));
      setText(statsCells.pc.home, pitchControl ? numberText(pitchControl.home * 100) + '%' : EN_DASH);
      setText(statsCells.pc.away, pitchControl ? numberText(pitchControl.away * 100) + '%' : EN_DASH);
      statsCells.pc.label.textContent = (analytics && Array.isArray(analytics.pitchControlGrid))
        ? 'Pitch control' : 'Pitch control (est.)';
    }

    if (analytics && analytics.fastestShot) {
      var shotSpeed = Math.round(analytics.fastestShot.speed);
      clearNode(el.fastest);
      el.fastest.appendChild(document.createTextNode('Fastest shot '));
      el.fastest.appendChild(make('b', null, playerLabel(analytics.fastestShot.playerId)));
      el.fastest.appendChild(document.createTextNode(' \u00b7 ' + shotSpeed + ' km/h'));
    } else {
      setText(el.fastest, '');
    }

    renderWinProbability();
    renderFormationLabels();
  }

  function renderWinProbability() {
    var historyWP = store.analytics.history;
    var latest = store.analytics.latest;
    if (latest) {
      setText(el.w0, Math.round(latest.winProbability.home * 100) + '%');
      setText(el.w1, Math.round(latest.winProbability.draw * 100) + '%');
      setText(el.w2, Math.round(latest.winProbability.away * 100) + '%');
    } else {
      setText(el.w0, EN_DASH);
      setText(el.w1, EN_DASH);
      setText(el.w2, EN_DASH);
    }

    if (!el.wp) { return; }
    clearNode(el.wp);
    if (!historyWP.home.length) { return; }
    var width = 220;
    var height = 80;
    var count = historyWP.home.length;
    [
      ['home', teamColor('home')],
      ['draw', '#7f97bd'],
      ['away', teamColor('away')]
    ].forEach(function (series) {
      var values = historyWP[series[0]];
      var points = [];
      for (var index = 0; index < values.length; index += 1) {
        var x = count <= 1 ? width / 2 : index / (count - 1) * width;
        var y = height - clamp(values[index], 0, 1) * height;
        points.push((index === 0 ? 'M' : 'L') + x.toFixed(1) + ' ' + y.toFixed(1));
      }
      el.wp.appendChild(svgEl('path', {
        d: points.join(' '),
        fill: 'none',
        stroke: CONTRACT.safeColor(series[1], '#7f97bd'),
        'stroke-width': series[0] === 'draw' ? 1 : 1.8,
        'stroke-dasharray': series[0] === 'draw' ? '3 3' : '0',
        'stroke-linejoin': 'round'
      }));
    });
  }

  function renderFormationLabels() {
    var analytics = store.analytics.latest;
    setText(el.f0, analytics && analytics.formation.home
      ? analytics.formation.home : EN_DASH);
    setText(el.f1, analytics && analytics.formation.away
      ? analytics.formation.away : EN_DASH);
  }

  // ------------------------------------------------------------------- //
  // Formation mini pitches (tracking positions, analytics labels)
  // ------------------------------------------------------------------- //
  function drawFormation(canvas, team, rendered) {
    if (!canvas) { return; }
    var context = canvas.getContext('2d');
    var width = canvas.width;
    var height = canvas.height;
    context.clearRect(0, 0, width, height);
    context.fillStyle = 'rgba(10,90,60,.45)';
    context.fillRect(0, 0, width, height);
    context.strokeStyle = 'rgba(255,255,255,.35)';
    context.lineWidth = 1;
    context.strokeRect(2, 2, width - 4, height - 4);

    Object.keys(rendered).forEach(function (id) {
      var player = rendered[id];
      if (player.team !== team) { return; }
      var x = (player.x + PITCH_HALF_W) / (PITCH_HALF_W * 2) * (width - 12) + 6;
      var y = (player.y + PITCH_HALF_H) / (PITCH_HALF_H * 2) * (height - 10) + 5;
      context.beginPath();
      context.arc(x, y, 3.2, 0, Math.PI * 2);
      context.fillStyle = teamColor(team);
      context.fill();
      context.strokeStyle = 'rgba(255,255,255,.8)';
      context.stroke();
    });
  }

  function updateFormationCanvases() {
    drawFormation(el.fc0, 'home', renderState.players);
    drawFormation(el.fc1, 'away', renderState.players);
  }

  // ------------------------------------------------------------------- //
  // Player card and estimated what-if
  // ------------------------------------------------------------------- //
  var cardRows = null;

  function buildCardRows() {
    if (cardRows || !el.pc2) { return; }
    cardRows = {};
    [
      ['speed', 'Speed'],
      ['role', 'Role'],
      ['distance', 'Distance'],
      ['top', 'Top speed'],
      ['sprints', 'Sprints'],
      ['fatigue', 'Fatigue'],
      ['conf', 'Tracking conf']
    ].forEach(function (definition) {
      var row = make('div', 'row');
      var label = make('span', null, definition[1]);
      var value = make('b', null, EN_DASH);
      row.appendChild(label);
      row.appendChild(value);
      el.pc2.appendChild(row);
      cardRows[definition[0]] = value;
    });
  }

  function cardPlayerId() {
    var candidates = [store.selectedPlayerId, renderState.holderId];
    for (var index = 0; index < candidates.length; index += 1) {
      if (candidates[index] && playerMetaFor(candidates[index])) { return candidates[index]; }
    }
    var ids = Object.keys(renderState.players);
    return ids.length ? ids[0] : null;
  }

  function updatePlayerCard() {
    buildCardRows();
    var id = cardPlayerId();
    var meta = id ? playerMetaFor(id) : null;
    var metric = id ? store.analytics.metrics[id] : null;

    setText(el.pn, id ? 'Player Stats \u00b7 ' + playerLabel(id) : 'Player Stats');
    var number = meta ? identityNumber(meta) : null;
    setText(el.jn, number === null ? '?' : String(number));
    if (el.jr) {
      if (meta) {
        el.jr.setAttribute('fill', CONTRACT.safeColor(teamColor(meta.team), DEFAULT_COLORS.home));
      } else {
        el.jr.setAttribute('fill', '#7f97bd');
      }
    }
    if (!cardRows) { return; }

    setText(cardRows.speed, meta ? meta.speed.toFixed(1) + ' km/h' : EN_DASH);
    var role = meta ? identityRole(meta) : null;
    setText(cardRows.role, role || (meta ? 'Unknown' : EN_DASH));
    setText(cardRows.distance, metric ? metric.distanceKm.toFixed(2) + ' km' : EN_DASH);
    setText(cardRows.top, metric ? metric.topSpeed.toFixed(1) + ' km/h' : EN_DASH);
    setText(cardRows.sprints, metric ? String(metric.sprints) : EN_DASH);
    setText(cardRows.fatigue, metric ? Math.round(metric.fatigue * 100) + '%' : EN_DASH);
    setText(cardRows.conf, meta ? Math.round(meta.conf * 100) + '%' : EN_DASH);
  }

  var whatIfCells = null;

  function buildWhatIf() {
    if (whatIfCells || !el.wif) { return; }
    whatIfCells = {};
    [
      ['line', 'Defensive line'],
      ['space', 'Space behind'],
      ['runners', 'Runners beyond']
    ].forEach(function (definition) {
      var row = make('div', 'o');
      var label = make('span', null, definition[1]);
      var value = make('b', null, EN_DASH);
      row.appendChild(label);
      row.appendChild(value);
      el.wif.appendChild(row);
      whatIfCells[definition[0]] = value;
    });
    var note = make('small', 'mu', 'Estimated from the tracking feed.');
    if (el.wim) { el.wim.appendChild(note); }
  }

  /** Second-last defender, space behind and runners beyond - all estimated. */
  function updateWhatIf() {
    buildWhatIf();
    if (!whatIfCells) { return; }
    var attacking = renderState.possession
      || (renderState.holderId && renderState.players[renderState.holderId]
        ? renderState.players[renderState.holderId].team : null)
      || (!renderState.lastSample ? store.possessionTeam : null);
    if (!attacking) {
      setText(whatIfCells.line, EN_DASH);
      setText(whatIfCells.space, EN_DASH);
      setText(whatIfCells.runners, EN_DASH);
      return;
    }
    var direction = attacking === 'home'
      ? (renderState.clock.period === 1 ? 1 : -1)
      : (renderState.clock.period === 1 ? -1 : 1);
    var defenders = [];
    var attackers = [];
    Object.keys(renderState.players).forEach(function (id) {
      var player = renderState.players[id];
      if (player.team === attacking) { attackers.push(player); } else { defenders.push(player); }
    });
    if (defenders.length < 2) {
      setText(whatIfCells.line, EN_DASH);
      setText(whatIfCells.space, EN_DASH);
      setText(whatIfCells.runners, EN_DASH);
      return;
    }
    defenders.sort(function (first, second) {
      return direction > 0 ? second.x - first.x : first.x - second.x;
    });
    var line = defenders[1].x;
    var goalLine = direction > 0 ? PITCH_HALF_W : -PITCH_HALF_W;
    var space = Math.abs(goalLine - line);
    var runners = attackers.filter(function (player) {
      return direction > 0 ? player.x > line : player.x < line;
    }).length;
    setText(whatIfCells.line, Math.round(Math.abs(line)) + ' m from centre');
    setText(whatIfCells.space, Math.round(space) + ' m');
    setText(whatIfCells.runners, String(runners));
  }

  // ------------------------------------------------------------------- //
  // Event feed, highlights and timeline
  // ------------------------------------------------------------------- //
  function playerLabel(playerId) {
    if (!playerId) { return 'Unknown player'; }
    var number = shirtNumber(playerId);
    return number === null ? 'Unknown player' : '#' + number;
  }

  /**
   * Event search covers type, team, explicit player number and box state.
   * Only an explicit player reference (`player 10`, `#10`, `number 10`, `no. 10`)
   * or a bare number counts as a shirt number - the `10` in `last 10 minutes`
   * is not a player.
   */
  function parseSearch() {
    var raw = String(store.search || '').trim().toLowerCase();
    var numbers = [];
    function addNumber(digits) {
      var value = parseInt(digits, 10);
      if (value >= 1 && value <= 99 && numbers.indexOf(value) === -1) {
        numbers.push(value);
      }
    }
    var text = raw.replace(/(?:player|number|no\.?|#)\s*#?(\d{1,3})\b/g,
      function (_match, digits) { addNumber(digits); return ' '; });
    text = text.replace(/\s+/g, ' ').trim();
    if (!numbers.length && /^\d{1,3}$/.test(text)) {
      addNumber(text);
      text = '';
    }
    return { numbers: numbers, text: text };
  }

  function eventMatches(event, search) {
    if (store.filter && eventCategory(event.type) !== store.filter) { return false; }
    if (search.numbers.length) {
      var candidates = [shirtNumber(event.playerId), shirtNumber(event.targetPlayerId)];
      var found = candidates.some(function (number) {
        return number !== null && search.numbers.indexOf(number) !== -1;
      });
      if (!found) { return false; }
    }
    if (!search.text) { return true; }

    var boxPattern = /\b(into\s*box|in\s*the\s*box|penalty\s*area|box)\b/g;
    var wantsBox = boxPattern.test(search.text);
    if (wantsBox) {
      boxPattern.lastIndex = 0;
      if (!isIntoBox(event)) { return false; }
    }
    var rest = search.text.replace(boxPattern, ' ').replace(/\s+/g, ' ').trim();
    if (!rest) { return true; }
    var haystack = (eventTitle(event.type) + ' ' + String(event.type || '') + ' '
      + teamName(event.team) + ' ' + String(event.team || '')).toLowerCase();
    return haystack.indexOf(rest) !== -1;
  }

  function drawEventMini(canvas, event) {
    var width = canvas.width;
    var height = canvas.height;
    var context = canvas.getContext('2d');
    context.fillStyle = 'rgba(10,90,60,.55)';
    context.fillRect(0, 0, width, height);
    context.strokeStyle = 'rgba(255,255,255,.35)';
    context.lineWidth = 1;
    context.strokeRect(2, 2, width - 4, height - 4);
    context.beginPath();
    context.moveTo(width / 2, 2);
    context.lineTo(width / 2, height - 2);
    context.stroke();

    function point(position) {
      return {
        x: (position.x + PITCH_HALF_W) / (PITCH_HALF_W * 2) * (width - 8) + 4,
        y: (position.y + PITCH_HALF_H) / (PITCH_HALF_H * 2) * (height - 8) + 4
      };
    }

    var start = point(event.start);
    var end = event.end ? point(event.end) : start;
    context.strokeStyle = 'rgba(255,255,255,.8)';
    context.beginPath();
    context.moveTo(start.x, start.y);
    context.lineTo(end.x, end.y);
    context.stroke();
    context.beginPath();
    context.arc(start.x, start.y, 2.6, 0, Math.PI * 2);
    context.fillStyle = teamColor(event.team);
    context.fill();
    if (event.end) {
      context.beginPath();
      context.arc(end.x, end.y, 2.2, 0, Math.PI * 2);
      context.fillStyle = '#ffffff';
      context.fill();
    }
  }

  function eventRow(event) {
    var classes = 'ev';
    if (event.status === 'provisional') { classes += ' prov'; }
    if (event.type === 'goal' && event.status === 'confirmed') { classes += ' g'; }
    var row = make('div', classes);
    row.appendChild(make('span', 'ic', eventIcon(event.type)));

    var body = document.createElement('div');
    var title = make('b', null, eventTitle(event.type));
    title.appendChild(make('span', 'ev.conf', Math.round(event.conf * 100) + '%'));
    body.appendChild(title);
    body.appendChild(make('small', null,
      teamName(event.team) + ' \u00b7 ' + playerLabel(event.playerId)
      + ' \u00b7 ' + formatMinute(event.clock.seconds)));
    row.appendChild(body);

    var canvas = document.createElement('canvas');
    canvas.className = 'mp';
    canvas.width = 76;
    canvas.height = 50;
    drawEventMini(canvas, event);
    row.appendChild(canvas);
    return row;
  }

  function sortedEvents() {
    return Object.keys(store.events.byId)
      .map(function (id) { return store.events.byId[id]; })
      .sort(function (first, second) { return second.seq - first.seq; });
  }

  function renderFeed() {
    if (!el.fl) { return; }
    var search = parseSearch();
    var rows = sortedEvents().filter(function (event) {
      return eventMatches(event, search);
    }).slice(0, 60);

    clearNode(el.fl);
    if (!rows.length) {
      el.fl.appendChild(make('p', 'mu', store.search
        ? 'No event matches that search.' : 'No events yet.'));
      return;
    }
    rows.forEach(function (event) { el.fl.appendChild(eventRow(event)); });
  }

  function renderHighlights() {
    if (!el.hl) { return; }
    var wanted = sortedEvents().filter(function (event) {
      return event.status === 'confirmed'
        && (event.type === 'goal' || event.type === 'shot' || event.type === 'save');
    }).slice(0, 4);

    clearNode(el.hl);
    if (!wanted.length) {
      el.hl.appendChild(make('p', 'mu', 'No highlights yet.'));
      return;
    }
    wanted.forEach(function (event) {
      var card = make('div', 'hc');
      var canvas = document.createElement('canvas');
      canvas.className = 'mp';
      canvas.width = 84;
      canvas.height = 54;
      drawEventMini(canvas, event);
      card.appendChild(canvas);
      var body = document.createElement('div');
      var title = make('b', null, eventTitle(event.type));
      if (event.type === 'goal') {
        title.appendChild(make('span', 'tg', 'GOAL'));
      }
      body.appendChild(title);
      body.appendChild(make('small', null, teamName(event.team) + ' \u00b7 '
        + playerLabel(event.playerId)));
      body.appendChild(make('small', 'mu', formatMinute(event.clock.seconds)
        + ' \u00b7 xG ' + (Number.isFinite(event.xg) ? event.xg.toFixed(2) : EN_DASH)));
      card.appendChild(body);
      el.hl.appendChild(card);
    });
  }

  function renderTimeline() {
    if (!el.trk) { return; }
    Array.prototype.slice.call(el.trk.querySelectorAll('i')).forEach(function (marker) {
      el.trk.removeChild(marker);
    });
    sortedEvents().forEach(function (event) {
      if (event.status !== 'confirmed') { return; }
      if (event.type !== 'goal' && event.type !== 'card') { return; }
      var marker = document.createElement('i');
      marker.style.left = clamp(event.clock.seconds / 5400 * 100, 0, 100) + '%';
      marker.style.background = event.type === 'goal'
        ? CONTRACT.safeColor(teamColor(event.team), '#26f29a')
        : '#ffb020';
      marker.title = eventTitle(event.type) + ' \u00b7 '
        + teamName(event.team) + ' \u00b7 ' + formatMinute(event.clock.seconds);
      el.trk.appendChild(marker);
    });
    if (el.now) {
      var clock = liveClock();
      el.now.style.left = clamp(clock.seconds / 5400 * 100, 0, 100) + '%';
    }
  }

  function showGoal(event) {
    var label = teamName(event.team) + ' GOAL';
    setText(el.bn, label);
    el.bn.style.display = 'block';
    window.setTimeout(function () { el.bn.style.display = 'none'; }, 4000);
    bump('goalBanners');

    el.gl.classList.add('on');
    setText(el.glt, formatMinute(event.clock.seconds) + ' \u00b7 ' + label);
    if (goalLineTimer) { window.clearTimeout(goalLineTimer); }
    goalLineTimer = window.setTimeout(function () {
      el.gl.classList.remove('on');
      setText(el.glt, 'Monitoring the line');
      goalLineTimer = null;
    }, 10000);
  }

  /**
   * Shot and long-pass callouts use the event's own ball speed. Tracking speed
   * drives the gauge; an event carries the flight peak of that pass or strike,
   * which is what the callout describes. A long pass is a completed pass of at
   * least 30 m, the same order of magnitude the backend uses for its confidence
   * falloff.
   */
  function showCallout(event) {
    if (!el.callout) { return; }
    var speed = Number(event.ballSpeed);
    if (!Number.isFinite(speed) || speed <= 0) { return; }
    var longPass = event.type === 'pass' && Number(event.distance) >= 30;
    if (event.type !== 'shot' && !longPass) { return; }
    var suffix = event.playerId ? ' \u00b7 ' + playerLabel(event.playerId) : '';
    setText(el.callout, (longPass ? 'Long pass' : 'Shot') + ' \u00b7 '
      + Math.round(speed) + ' km/h' + suffix);
    el.callout.classList.add('on');
    if (calloutTimer) { window.clearTimeout(calloutTimer); }
    calloutTimer = window.setTimeout(function () {
      el.callout.classList.remove('on');
      calloutTimer = null;
    }, 3200);
    bump('callouts');
  }

  // ------------------------------------------------------------------- //
  // Commentary
  // ------------------------------------------------------------------- //
  function renderCommentary() {
    if (!el.ct) { return; }
    var lines = store.commentary.lines;
    clearNode(el.ct);
    if (!lines.length) {
      el.ct.appendChild(make('div', 'comm-empty', 'Waiting for live match commentary...'));
      setText(el.cts, '0:00');
      setText(el.ctsrc, EN_DASH);
      if (el.ctsrc) { el.ctsrc.setAttribute('data-source', ''); }
      return;
    }
    lines.forEach(function (line) {
      var card = make('div', 'comm-card');
      var meta = make('div', 'comm-meta');

      var isGoal = /goal/i.test(line.text);
      var isShot = /shot/i.test(line.text);
      var isKickoff = /kickoff/i.test(line.text);
      var tagClass = isGoal ? 'comm-tag goal' : (isShot ? 'comm-tag shot' : (isKickoff ? 'comm-tag kickoff' : 'comm-tag'));
      var tagText = isGoal ? '⚽ GOAL' : (isShot ? '🎯 SHOT' : (isKickoff ? '⏱ KICKOFF' : '🎙 AI LIVE'));

      var tag = make('span', tagClass, tagText);
      var time = make('span', 'comm-time', formatLocalTime(line.ts));
      meta.appendChild(tag);
      meta.appendChild(time);

      if (line.audioUrl) {
        var playBtn = make('button', 'comm-audio-btn', '▶ Play Gemini Voice');
        playBtn.style.cssText = 'background:rgba(124,58,237,0.25);border:1px solid rgba(167,139,250,0.4);color:#c4b5fd;font-size:10.5px;font-weight:700;padding:2px 8px;border-radius:4px;cursor:pointer;margin-left:auto;';
        playBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          try {
            var aud = new Audio(line.audioUrl);
            aud.play().catch(function () {});
          } catch (err) {}
        });
        meta.appendChild(playBtn);
      }

      var personaKey = store.commentaryPersona || 'tactical';
      var text = (line.personas && line.personas[personaKey]) ? line.personas[personaKey] : line.text;
      var body = make('div', 'comm-text', text);
      card.appendChild(meta);
      card.appendChild(body);
      el.ct.appendChild(card);
    });
    el.ct.scrollTop = el.ct.scrollHeight;
    var latest = lines[lines.length - 1] || lines[0];
    setText(el.cts, formatLocalTime(latest.ts));
    setText(el.ctsrc, latest.source === 'gemini' ? 'AI'
      : (latest.source === 'template' ? 'auto' : EN_DASH));
    if (el.ctsrc) { el.ctsrc.setAttribute('data-source', latest.source || ''); }
  }

  function speakCommentary(text) {
    if (!window.speechSynthesis) { return; }
    try {
      window.speechSynthesis.cancel();
      var utter = new SpeechSynthesisUtterance(text);
      var langCodes = { en: 'en-US', es: 'es-ES', fr: 'fr-FR', de: 'de-DE', ar: 'ar-SA', pt: 'pt-BR', ja: 'ja-JP' };
      utter.lang = langCodes[store.commentaryLanguage] || 'en-US';
      utter.rate = (store.commentaryPersona === 'hype') ? 1.15 : 1.0;
      utter.pitch = (store.commentaryPersona === 'hype') ? 1.15 : 0.95;
      window.speechSynthesis.speak(utter);
    } catch (e) {}
  }

  async function generateGeminiCommentary() {
    if (el.btnGenCommentary) {
      el.btnGenCommentary.disabled = true;
      el.btnGenCommentary.textContent = '✨ Thinking (Gemini)...';
    }
    try {
      var minute = store.clock ? Math.floor(store.clock.seconds / 60) : 88;
      var scoreStr = (store.teams.home || 'Auckland FC') + ' ' + (store.score.home || 2) + '-' + (store.score.away || 0) + ' ' + (store.teams.away || 'Newcastle Jets');
      var personaKey = store.commentaryPersona || 'hype';
      var payload = {
        score: scoreStr,
        minute: minute || 88,
        eventType: 'goal',
        player: '#10 Max Mata',
        speed: 86.0,
        xg: 0.38,
        details: 'Max Mata cuts inside from the left wing and rifles an 86 km/h rocket into the top corner',
        withAudio: true,
        audioPersona: personaKey,
        language: store.commentaryLanguage || 'en'
      };
      var res = await apiFetch('/commentary/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (res && res.personas) {
        var newLine = {
          seq: (store.commentary.lastSeq || 0) + 1,
          ts: Date.now(),
          source: res.source || 'gemini',
          text: res.personas[personaKey] || res.personas.tactical,
          personas: res.personas,
          audioUrl: res.audioUrl
        };
        store.commentary.lines.push(newLine);
        renderCommentary();
        if (res.audioUrl) {
          try {
            var aud = new Audio(res.audioUrl);
            aud.play().catch(function () {});
          } catch (err) {}
        } else if (store.ttsEnabled) {
          speakCommentary(res.personas[store.commentaryPersona] || res.personas.tactical);
        }
      }
    } catch (err) {
      console.warn('Gemini commentary error:', err);
    } finally {
      if (el.btnGenCommentary) {
        el.btnGenCommentary.disabled = false;
        el.btnGenCommentary.textContent = '✨ Generate with Gemini AI';
      }
    }
  }

  if (el.btnGenCommentary) {
    el.btnGenCommentary.addEventListener('click', generateGeminiCommentary);
  }

  if (el.btnTts) {
    store.ttsEnabled = false;
    el.btnTts.addEventListener('click', function () {
      store.ttsEnabled = !store.ttsEnabled;
      el.btnTts.style.background = store.ttsEnabled ? 'rgba(34,197,94,0.2)' : 'rgba(255,255,255,0.06)';
      el.btnTts.style.color = store.ttsEnabled ? '#22c55e' : 'var(--tx)';
      el.btnTts.textContent = store.ttsEnabled ? '🔊 Voice ON' : '🔈 Voice';
      if (store.ttsEnabled && store.commentary.lines.length) {
        var last = store.commentary.lines[store.commentary.lines.length - 1];
        speakCommentary((last.personas && last.personas[store.commentaryPersona]) || last.text);
      }
    });
  }

  if (el.langSelect) {
    el.langSelect.value = store.commentaryLanguage || 'en';
    el.langSelect.addEventListener('change', function () {
      store.commentaryLanguage = el.langSelect.value || 'en';
      generateGeminiCommentary();
    });
  }

  if (el.personaSelect) {
    el.personaSelect.value = store.commentaryPersona || 'tactical';
    el.personaSelect.addEventListener('change', function () {
      store.commentaryPersona = el.personaSelect.value || 'tactical';
      renderCommentary();
      if (store.ttsEnabled && store.commentary.lines.length) {
        var last = store.commentary.lines[store.commentary.lines.length - 1];
        speakCommentary((last.personas && last.personas[store.commentaryPersona]) || last.text);
      }
    });
  }

  // ------------------------------------------------------------------- //
  // Stream state: every value below arrived in a validated message
  // ------------------------------------------------------------------- //
  function resetStreams() {
    store.tracking.lastSeq = 0;
    store.tracking.latest = null;
    store.tracking.buffer.length = 0;
    store.tracking.seqSet.clear();
    store.tracking.gaps = 0;
    store.tracking.receivedAt = 0;

    store.analytics.lastSeq = 0;
    store.analytics.latest = null;
    store.analytics.metrics = Object.create(null);
    store.analytics.history = { home: [], draw: [], away: [] };
    store.analytics.receivedAt = 0;

    store.events.lastSeq = 0;
    store.events.byId = Object.create(null);
    store.events.highlighted = Object.create(null);
    store.events.resyncAt = 0;
    store.events.resyncPending = false;
    if (store.events.resyncTimer) {
      window.clearTimeout(store.events.resyncTimer);
      store.events.resyncTimer = null;
    }

    store.commentary.lastSeq = 0;
    store.commentary.lines = [];
    store.commentary.bySeq = Object.create(null);
    store.commentary.resyncAt = 0;
    store.commentary.resyncPending = false;
    if (store.commentary.resyncTimer) {
      window.clearTimeout(store.commentary.resyncTimer);
      store.commentary.resyncTimer = null;
    }

    store.score = { home: null, away: null };
    store.possessionPct = { home: null, away: null };
    store.clock = { period: 1, seconds: 0 };
    store.possessionTeam = null;
    store.holderId = null;
    store.streams = newStreams();
    // Score is analytics-owned: a new source starts on en dashes until
    // `applyAnalytics` supplies a number.
    store.score = { home: null, away: null };
    store.possessionPct = { home: null, away: null };
    store.selectedPlayerId = null;
    store.matchStatus = null;
    store.snapshotReceived = false;
    store.snapshotQueue.length = 0;

    store.dirty.feed = true;
    store.dirty.stats = true;
    store.dirty.commentary = true;
    store.dirty.highlights = true;

    renderState.players = Object.create(null);
    renderState.ball = null;
    renderState.holderId = null;
    renderState.targetKey = null;
    renderState.lastTargetKey = null;
    renderState.lastSample = null;
    renderState.lagMs = 0;
    renderState.driftMs = null;

    heat.fill(0);
    affinity = Object.create(null);
    history.length = 0;
    trail.length = 0;
    ballMissingSince = null;
    speedRingUntil = 0;
    clearPlayers();
    ball.visible = false;
    holderRing.visible = false;
    selectRing.visible = false;
    trailLine.visible = false;
    netLines.visible = false;
    offsideLine.visible = false;
    Object.keys(ghosts).forEach(function (id) { ghosts[id].visible = false; });
    el.ring.style.display = 'none';
    el.bn.style.display = 'none';
    if (el.callout) { el.callout.classList.remove('on'); }
    if (calloutTimer) {
      window.clearTimeout(calloutTimer);
      calloutTimer = null;
    }
    el.gl.classList.remove('on');
    setText(el.glt, 'Monitoring the line');
    if (goalLineTimer) {
      window.clearTimeout(goalLineTimer);
      goalLineTimer = null;
    }
  }

  function insertTrack(frame) {
    if (store.tracking.seqSet.has(frame.seq)) {
      bump('trackingDuplicates');
      return;
    }
    store.tracking.seqSet.add(frame.seq);
    var buffer = store.tracking.buffer;
    var entry = bufferEntry(frame);
    var key = sampleKey(entry);
    var index = buffer.length;
    while (index > 0 && sampleKey(buffer[index - 1]) > key) { index -= 1; }
    buffer.splice(index, 0, entry);
    trimTrackBuffer();
  }

  /**
   * The buffer must hold the playhead window, not only the decode head. An
   * upload is analysed much faster than it plays, so trimming to the newest
   * span would evict exactly the frames a seek backfill just fetched.
   */
  function trackAnchorKey() {
    if (!store.video.active || !store.video.attached || !store.video.ready) { return null; }
    var playhead = (Number(el.hls.currentTime) || 0) * 1000;
    var buffer = store.tracking.buffer;
    for (var index = buffer.length - 1; index >= 0; index -= 1) {
      if (Math.abs(sampleKey(buffer[index]) - playhead) < 2000) { return playhead; }
    }
    // Nothing near the playhead yet: keep the live buffer intact until the
    // backfill response lands instead of throwing away the decode head.
    return null;
  }

  function dropFarthest(anchor) {
    var buffer = store.tracking.buffer;
    if (!buffer.length) { return; }
    var first = buffer[0];
    var last = buffer[buffer.length - 1];
    if (Math.abs(sampleKey(first) - anchor) >= Math.abs(sampleKey(last) - anchor)) {
      buffer.shift();
      store.tracking.seqSet.delete(first.seq);
    } else {
      buffer.pop();
      store.tracking.seqSet.delete(last.seq);
    }
  }

  function trimTrackBuffer() {
    var buffer = store.tracking.buffer;
    var anchor = trackAnchorKey();
    if (anchor === null) {
      while (buffer.length > TRACK_BUFFER_MAX) {
        var removed = buffer.shift();
        store.tracking.seqSet.delete(removed.seq);
      }
      if (buffer.length) {
        var newest = sampleKey(buffer[buffer.length - 1]);
        while (buffer.length && newest - sampleKey(buffer[0]) > TRACK_BUFFER_SPAN_MS) {
          var stale = buffer.shift();
          store.tracking.seqSet.delete(stale.seq);
        }
      }
      return;
    }

    while (buffer.length > TRACK_BUFFER_MAX) { dropFarthest(anchor); }
    var halfSpan = TRACK_BUFFER_SPAN_MS / 2;
    while (buffer.length > 2) {
      var firstKey = sampleKey(buffer[0]);
      var lastKey = sampleKey(buffer[buffer.length - 1]);
      if (Math.max(anchor - firstKey, lastKey - anchor) <= halfSpan) { break; }
      dropFarthest(anchor);
    }
  }

  function bufferSort() {
    store.tracking.buffer.sort(function (first, second) {
      return sampleKey(first) - sampleKey(second);
    });
  }

  function matchIdMatches(message) {
    return !store.source.matchId || message.matchId === store.source.matchId;
  }

  /**
   * Tracking accepts out-of-order frames from the replay backfill, but a live
   * frame whose seq is not newer than the last accepted one is stale and is
   * rejected. Gaps are normal (the broadcast is throttled) and tolerated.
   */
  function applyTracking(payload, options) {
    var allowOld = !!(options && options.allowOld);
    var checked = CONTRACT.validateTrackingMessage(payload);
    if (!checked.ok) {
      bump('trackingRejected');
      invalid('tracking', checked.error);
      return;
    }
    var frame = checked.value;
    if (!matchIdMatches(frame)) {
      bump('trackingRejected');
      invalid('tracking', 'matchId does not match the selected source');
      return;
    }
    if (!allowOld && frame.seq <= store.tracking.lastSeq) {
      if (store.tracking.seqSet.has(frame.seq)) { bump('trackingDuplicates'); }
      else { bump('trackingStale'); }
      bump('trackingRejected');
      return;
    }
    if (!allowOld && store.tracking.lastSeq && frame.seq > store.tracking.lastSeq + 1) {
      bump('trackingGaps');
      store.tracking.gaps += 1;
    }
    if (frame.seq > store.tracking.lastSeq) { store.tracking.lastSeq = frame.seq; }
    // Replay frames are older than the decode head: they belong in the buffer,
    // but they must never move `latest`, the clock or the possession panels
    // backwards. Only a frame that is actually the newest does that.
    var newest = !store.tracking.latest || frame.seq >= store.tracking.latest.seq;
    if (newest) {
      store.tracking.latest = frame;
      store.tracking.receivedAt = nowMs();
      store.clock = { period: frame.clock.period, seconds: frame.clock.seconds };
      store.possessionTeam = frame.possession || null;
      store.holderId = frame.holderId || null;
      noteStream('tracking', frame.seq);
    }
    bump('trackingAccepted');
    insertTrack(frame);
  }

  function applyAnalytics(payload) {
    var checked = CONTRACT.validateAnalyticsMessage(payload);
    if (!checked.ok) {
      bump('analyticsRejected');
      invalid('analytics', checked.error);
      return;
    }
    var message = checked.value;
    if (!matchIdMatches(message)) {
      bump('analyticsRejected');
      invalid('analytics', 'matchId does not match the selected source');
      return;
    }
    if (message.seq <= store.analytics.lastSeq) {
      bump('analyticsStale');
      bump('analyticsRejected');
      return;
    }
    store.analytics.lastSeq = message.seq;
    noteStream('analytics', message.seq);
    store.analytics.latest = message;
    store.analytics.receivedAt = nowMs();
    store.score = { home: message.score.home, away: message.score.away };
    store.possessionPct = {
      home: message.possessionPct.home,
      away: message.possessionPct.away
    };
    message.playerMetrics.forEach(function (metric) {
      store.analytics.metrics[metric.id] = metric;
    });
    var winHistory = store.analytics.history;
    winHistory.home.push(clamp(message.winProbability.home, 0, 1));
    winHistory.draw.push(clamp(message.winProbability.draw, 0, 1));
    winHistory.away.push(clamp(message.winProbability.away, 0, 1));
    while (winHistory.home.length > 90) {
      winHistory.home.shift();
      winHistory.draw.shift();
      winHistory.away.shift();
    }
    bump('analyticsAccepted');
    store.dirty.stats = true;
  }

  function applyEvent(payload) {
    var checked = CONTRACT.validateEventMessage(payload);
    if (!checked.ok) {
      bump('eventsRejected');
      invalid('events', checked.error);
      return;
    }
    var event = checked.value;
    if (!matchIdMatches(event)) {
      bump('eventsRejected');
      invalid('events', 'matchId does not match the selected source');
      return;
    }
    if (event.seq <= store.events.lastSeq) {
      bump('eventsStale');
      bump('eventsRejected');
      return;
    }
    var gap = store.events.lastSeq > 0 && event.seq > store.events.lastSeq + 1;
    store.events.lastSeq = event.seq;
    noteStream('events', event.seq);
    bump('eventsAccepted');

    if (event.status === 'retracted') {
      if (store.events.byId[event.eventId]) {
        delete store.events.byId[event.eventId];
        bump('eventsRetracted');
        store.dirty.feed = true;
        store.dirty.highlights = true;
      }
      if (gap) { requestResync('events'); }
      return;
    }

    var existing = store.events.byId[event.eventId];
    if (existing && existing.revision >= event.revision) {
      bump('eventsRejected');
      if (gap) { requestResync('events'); }
      return;
    }
    store.events.byId[event.eventId] = event;
    bump('eventsUpserts');
    store.dirty.feed = true;
    if (event.status === 'confirmed') {
      store.dirty.highlights = true;
      if (event.type === 'goal' && (!existing || existing.status !== 'confirmed')) {
        showGoal(event);
      }
      // Snapshot replay is history, not a live moment: it must not flash a
      // callout for a shot that happened before the dashboard connected.
      if (store.snapshotReceived) { showCallout(event); }
    }
    if (gap) { requestResync('events'); }
  }

  function applyCommentary(payload) {
    var checked = CONTRACT.validateCommentaryMessage(payload);
    if (!checked.ok) {
      bump('commentaryRejected');
      invalid('commentary', checked.error);
      return;
    }
    var line = checked.value;
    if (!matchIdMatches(line)) {
      bump('commentaryRejected');
      invalid('commentary', 'matchId does not match the selected source');
      return;
    }
    if (line.seq <= store.commentary.lastSeq) {
      bump('commentaryStale');
      bump('commentaryRejected');
      return;
    }
    var gap = store.commentary.lastSeq > 0 && line.seq > store.commentary.lastSeq + 1;
    store.commentary.lastSeq = line.seq;
    noteStream('commentary', line.seq);
    if (store.commentary.bySeq[line.seq]) {
      bump('commentaryRejected');
      return;
    }
    store.commentary.bySeq[line.seq] = line;
    store.commentary.lines.push({
      seq: line.seq,
      text: line.text,
      source: line.source,
      ts: line.ts
    });
    store.commentary.lines.sort(function (first, second) {
      return second.seq - first.seq;
    });
    while (store.commentary.lines.length > 12) {
      var dropped = store.commentary.lines.pop();
      delete store.commentary.bySeq[dropped.seq];
    }
    bump('commentaryAccepted');
    store.dirty.commentary = true;
    if (gap) { requestResync('commentary'); }
  }

  function handleStream(stream, payload) {
    if (stream === 'tracking') { applyTracking(payload); return; }
    if (stream === 'analytics') { applyAnalytics(payload); return; }
    if (stream === 'events') { applyEvent(payload); return; }
    if (stream === 'commentary') { applyCommentary(payload); return; }
  }

  /** Snapshot-first: live messages wait here until the snapshot has painted. */
  function routeLive(stream, payload) {
    bump(stream + 'In');
    if (!store.snapshotReceived) {
      if (store.snapshotQueue.length >= 900) { store.snapshotQueue.shift(); }
      store.snapshotQueue.push({ stream: stream, payload: payload });
      bump('snapshotQueued');
      return;
    }
    handleStream(stream, payload);
  }

  function applySnapshot(payload) {
    bump('snapshots');
    var checked = CONTRACT.validateSnapshot(payload);
    if (!checked.ok) {
      invalid('snapshot', checked.error);
      return;
    }
    if (checked.invalidEntries) {
      invalid('snapshot', checked.invalidEntries + ' invalid entr'
        + (checked.invalidEntries === 1 ? 'y' : 'ies'));
    }
    var snapshot = checked.value;
    if (store.source.matchId && snapshot.matchId !== store.source.matchId) {
      invalid('snapshot', 'matchId does not match the selected source');
      return;
    }

    resetStreams();
    store.matchStatus = snapshot.running ? 'live' : 'finished';
    if (snapshot.tracking) { applyTracking(snapshot.tracking); }
    if (snapshot.analytics) { applyAnalytics(snapshot.analytics); }
    snapshot.events.forEach(applyEvent);
    snapshot.commentary.forEach(applyCommentary);

    store.snapshotReceived = true;
    store.dirty.feed = true;
    store.dirty.stats = true;
    store.dirty.commentary = true;
    store.dirty.highlights = true;

    var queued = store.snapshotQueue.splice(0, store.snapshotQueue.length);
    queued.forEach(function (item) { handleStream(item.stream, item.payload); });
  }

  function requestResync(stream) {
    var group = stream === 'events' ? store.events : store.commentary;
    var now = nowMs();
    if (group.resyncPending || now - group.resyncAt < 2500) { return; }
    group.resyncAt = now;
    bump('resyncRequests');
    if (!store.socket || !store.joined) { return; }
    group.resyncPending = true;
    bump(stream === 'events' ? 'eventsResyncs' : 'commentaryResyncs');
    store.socket.emit('resync', { stream: stream, afterSeq: group.lastSeq });
    group.resyncTimer = window.setTimeout(function () {
      group.resyncPending = false;
      group.resyncTimer = null;
    }, 5000);
  }

  function handleResync(payload) {
    if (!CONTRACT.isObject(payload)) {
      invalid('resync', 'expected an object');
      return;
    }
    if (!Array.isArray(payload.messages)) {
      invalid('resync', 'messages must be an array');
      return;
    }
    if (payload.stream === 'events') {
      store.events.resyncPending = false;
      payload.messages.forEach(applyEvent);
      return;
    }
    if (payload.stream === 'commentary') {
      store.commentary.resyncPending = false;
      payload.messages.forEach(applyCommentary);
      return;
    }
    invalid('resync', 'unknown stream');
  }

  // ------------------------------------------------------------------- //
  // Socket.IO /live
  // ------------------------------------------------------------------- //
  function closeSocket() {
    if (store.socket) {
      try { store.socket.removeAllListeners(); } catch (err) { /* ignore */ }
      try { store.socket.disconnect(); } catch (err) { /* ignore */ }
    }
    store.socket = null;
    store.joined = false;
    store.socketState = 'offline';
  }

  function openSocket(matchId) {
    closeSocket();
    if (typeof io !== 'function') {
      store.socketState = 'error';
      setError('The Socket.IO client failed to load; live messages are unavailable.');
      applyConnectionState();
      return;
    }
    var generation = store.generation;
    var base = String(store.apiBase || '').replace(/\/+$/, '');
    var socket;
    try {
      socket = io(base + '/live', {
        path: '/socket.io',
        transports: ['websocket', 'polling'],
        auth: store.apiKey ? { token: store.apiKey } : {},
        reconnection: true,
        reconnectionDelay: 800,
        reconnectionDelayMax: 6000,
        timeout: 8000
      });
    } catch (err) {
      store.socketState = 'error';
      store.lastError = String(err && err.message ? err.message : err).slice(0, 200);
      applyConnectionState();
      return;
    }

    store.socket = socket;
    store.socketState = 'connecting';
    applyConnectionState();

    socket.on('connect', function () {
      if (generation !== store.generation) { return; }
      store.socketState = 'connected';
      store.joined = true;
      store.snapshotReceived = false;
      store.snapshotQueue.length = 0;
      socket.emit('join', { matchId: matchId });
      applyConnectionState();
    });

    socket.on('disconnect', function () {
      if (generation !== store.generation) { return; }
      store.socketState = 'offline';
      store.joined = false;
      applyConnectionState();
    });

    socket.on('connect_error', function (error) {
      if (generation !== store.generation) { return; }
      store.socketState = 'error';
      bump('errors');
      store.lastError = String(error && error.message ? error.message : error).slice(0, 200);
      applyConnectionState();
    });

    if (socket.io && typeof socket.io.on === 'function') {
      socket.io.on('reconnect_attempt', function () {
        if (generation !== store.generation) { return; }
        store.socketState = 'reconnecting';
        applyConnectionState();
      });
    }

    ['tracking', 'analytics', 'events', 'commentary'].forEach(function (stream) {
      socket.on(stream, function (payload) {
        if (generation !== store.generation) { return; }
        routeLive(stream, payload);
      });
    });

    socket.on('snapshot', function (payload) {
      if (generation !== store.generation) { return; }
      applySnapshot(payload);
      applyConnectionState();
    });

    socket.on('resync', function (payload) {
      if (generation !== store.generation) { return; }
      handleResync(payload);
    });

    socket.on('left', function () {
      if (generation !== store.generation) { return; }
      store.joined = false;
      applyConnectionState();
    });

    socket.on('error', function (payload) {
      if (generation !== store.generation) { return; }
      bump('errors');
      var detail = CONTRACT.isObject(payload) ? payload.detail : payload;
      store.lastError = String(detail == null ? 'socket error' : detail).slice(0, 240);
    });
  }

  function joinMatch(matchId) {
    if (store.socket && store.socketState === 'connected') {
      store.socket.emit('join', { matchId: matchId });
    }
  }

  function leaveMatch() {
    if (store.socket && store.socketState === 'connected') {
      store.socket.emit('leave', {});
    }
    store.joined = false;
  }

  // ------------------------------------------------------------------- //
  // HLS video plane
  // ------------------------------------------------------------------- //
  function absoluteUrl(path) {
    if (typeof path !== 'string' || !path) { return null; }
    if (/^https?:\/\//i.test(path)) { return path; }
    return String(store.apiBase || '').replace(/\/+$/, '') + (path[0] === '/' ? path : '/' + path);
  }

  function applyVideoVisibility() {
    if (!el.hls) { return; }
    var visible = !!(store.video.active && store.video.visible && store.overlays.video);
    el.hls.style.display = visible ? 'block' : 'none';
    if (videoButton) {
      videoButton.style.display = store.video.active ? '' : 'none';
      videoButton.classList.toggle('on', !!store.overlays.video);
    }
  }

  function stopWatchdog() {
    if (store.video.watchdog) {
      window.clearInterval(store.video.watchdog);
      store.video.watchdog = null;
    }
  }

  function startWatchdog() {
    stopWatchdog();
    var probe = { time: el.hls.currentTime || 0, at: nowMs() };
    store.video.watchdog = window.setInterval(function () {
      if (!store.video.active) { stopWatchdog(); return; }
      var time = Number(el.hls.currentTime) || 0;
      if (time > 0.05) { store.video.ready = true; }
      if (nowMs() - probe.at < 6000) { return; }
      if (!el.hls.paused && time - probe.time < 0.25) {
        // The player never started: fall back to arrival-time playout so the
        // pitch is still usable, and say so instead of drifting silently.
        store.video.error = 'HLS playback is not advancing; following arrival time.';
        store.video.active = false;
        bufferSort();
        applyVideoVisibility();
        stopWatchdog();
        return;
      }
      probe = { time: time, at: nowMs() };
    }, 1000);
  }

  function detachHls() {
    stopWatchdog();
    if (store.video.hls) {
      try { store.video.hls.destroy(); } catch (err) { /* ignore */ }
      store.video.hls = null;
    }
    if (el.hls) {
      el.hls.removeEventListener('seeking', onVideoSeek);
      el.hls.removeEventListener('seeked', onVideoSeek);
      el.hls.removeEventListener('loadedmetadata', onVideoMetadata);
      try { el.hls.pause(); } catch (err) { /* ignore */ }
      el.hls.removeAttribute('src');
      try { el.hls.load(); } catch (err) { /* ignore */ }
    }
    store.video.url = null;
    store.video.active = false;
    store.video.attached = false;
    store.video.visible = false;
    store.video.ready = false;
    store.video.error = null;
    store.video.lastBackfill = 0;
    store.video.lastBackfillTarget = null;
    store.video.backfillPending = false;
    store.video.backfillQueued = null;
    applyVideoVisibility();
    bufferSort();
  }

  function startHls(url) {
    if (!url || !el.hls) { return; }
    if (store.video.url === url && store.video.active) { return; }
    detachHls();

    store.video.url = url;
    store.video.active = true;
    store.video.attached = true;
    store.video.visible = true;
    applyVideoVisibility();
    bufferSort();

    // Attach before loading: a native player can fire loadedmetadata before
    // the asynchronous HLS.js path returns.
    el.hls.addEventListener('seeking', onVideoSeek);
    el.hls.addEventListener('seeked', onVideoSeek);
    el.hls.addEventListener('loadedmetadata', onVideoMetadata);

    var HlsCtor = window.Hls;
    if (HlsCtor && typeof HlsCtor.isSupported === 'function' && HlsCtor.isSupported()) {
      var instance = new HlsCtor({
        lowLatencyMode: false,
        liveSyncDurationCount: 3,
        maxBufferLength: 20,
        manifestLoadingTimeOut: 15000,
        // Segments live behind the API-key middleware, so every playlist and
        // segment request carries the same key the REST calls use.
        xhrSetup: function (xhr) {
          if (store.apiKey) { xhr.setRequestHeader('X-API-Key', store.apiKey); }
        }
      });
      store.video.hls = instance;
      instance.on(HlsCtor.Events.ERROR, function (_event, data) {
        if (!data) { return; }
        if (!data.fatal) {
          if (data.details) { store.video.error = String(data.details).slice(0, 160); }
          return;
        }
        bump('hlsErrors');
        store.video.error = String(data.type || 'fatal').slice(0, 160);
        if (data.type === HlsCtor.ErrorTypes.NETWORK_ERROR) {
          try { instance.startLoad(); return; } catch (err) { /* fall through */ }
        }
        if (data.type === HlsCtor.ErrorTypes.MEDIA_ERROR) {
          try { instance.recoverMediaError(); return; } catch (err) { /* fall through */ }
        }
        store.video.ready = false;
      });
      instance.on(HlsCtor.Events.MANIFEST_PARSED, function () {
        store.video.ready = true;
        el.hls.play().catch(function () { /* autoplay policy */ });
      });
      instance.loadSource(url);
      instance.attachMedia(el.hls);
    } else if (el.hls.canPlayType('application/vnd.apple.mpegurl')) {
      el.hls.src = url;
      store.video.ready = true;
      el.hls.play().catch(function () { /* autoplay policy */ });
    } else {
      bump('hlsErrors');
      store.video.error = 'HLS is not supported in this browser.';
      store.video.active = false;
      applyVideoVisibility();
      return;
    }

    startWatchdog();
  }

  function onVideoMetadata() {
    if (!store.video.active) { return; }
    store.video.ready = true;
    maybeBackfill(Number(el.hls.currentTime) || 0);
  }

  function onVideoSeek() {
    maybeBackfill(Number(el.hls.currentTime) || 0, true);
  }

  /** True when the buffer has a sample close enough to interpolate at `target`. */
  function hasBufferNear(targetSeconds) {
    var buffer = store.tracking.buffer;
    for (var index = buffer.length - 1; index >= 0; index -= 1) {
      if (Math.abs(buffer[index].mediaTime - targetSeconds) < 1.5) { return true; }
    }
    return false;
  }

  /**
   * Ask the sidecar for the media window around the playhead when the buffer
   * cannot serve it. Media time is the only durable mapping: an upload is
   * decoded much faster than it plays, so `mediaTime` and wall-clock `ts`
   * advance independently and the newest frame's `ts` cannot locate an older
   * media instant.
   */
  function maybeBackfill(targetSeconds, force) {
    if (!store.video.active || !store.video.attached || !store.video.ready) { return; }
    var target = Number.isFinite(targetSeconds)
      ? targetSeconds : (Number(el.hls.currentTime) || 0);
    if (hasBufferNear(target)) { return; }
    backfillTracking(target, { force: !!force });
  }

  function applyReplayLine(line, generation) {
    if (generation !== store.generation) { return; }
    var parsed = null;
    try { parsed = JSON.parse(line); } catch (err) { parsed = null; }
    if (!parsed) {
      invalid('tracking', 'replay line is not JSON');
      return;
    }
    bump('backfillFrames');
    applyTracking(parsed, { allowOld: true });
  }

  /** Apply replay rows as they arrive instead of after the whole body lands. */
  function consumeReplay(response, generation) {
    if (!response.body || typeof response.body.getReader !== 'function'
      || typeof TextDecoder === 'undefined') {
      return response.text().then(function (text) {
        if (generation !== store.generation) { return; }
        String(text || '').split('\n').forEach(function (line) {
          if (line.trim()) { applyReplayLine(line, generation); }
        });
      });
    }
    var reader = response.body.getReader();
    var decoder = new TextDecoder();
    var carry = '';
    function pump() {
      return reader.read().then(function (result) {
        if (generation !== store.generation) {
          try { reader.cancel(); } catch (err) { /* ignore */ }
          return;
        }
        if (result.done) {
          if (carry.trim()) { applyReplayLine(carry, generation); }
          return;
        }
        carry += decoder.decode(result.value, { stream: true });
        var lines = carry.split('\n');
        carry = lines.pop();
        lines.forEach(function (line) {
          if (line.trim()) { applyReplayLine(line, generation); }
        });
        return pump();
      });
    }
    return pump();
  }

  function backfillTracking(targetSeconds, options) {
    var matchId = store.source.matchId;
    if (!matchId) { return; }
    var target = Math.max(0, Number(targetSeconds) || 0);
    var force = !!(options && options.force);

    if (store.video.backfillPending) {
      // A newer seek wins: remember it and fetch it as soon as this one ends.
      store.video.backfillQueued = target;
      return;
    }
    var now = nowMs();
    if (!force) {
      if (now - store.video.lastBackfill < BACKFILL_MIN_MS) { return; }
      var previous = store.video.lastBackfillTarget;
      // Retry an empty window after a pause; move on immediately when playback
      // has carried the playhead away from the last request.
      if (previous !== null && Math.abs(previous - target) < 0.75
        && now - store.video.lastBackfill < 2500) { return; }
    }

    store.video.lastBackfill = now;
    store.video.lastBackfillTarget = target;
    store.video.backfillPending = true;
    bump('backfills');

    var from = Math.max(0, target - BACKFILL_WINDOW_S);
    var to = target + BACKFILL_WINDOW_S;
    var generation = store.generation;
    var path = '/matches/' + encodeURIComponent(matchId) + '/tracking'
      + '?mediaFrom=' + from.toFixed(3) + '&mediaTo=' + to.toFixed(3);

    fetch(apiUrl(path), { headers: apiHeaders() }).then(function (response) {
      if (!response.ok) { return null; }
      return consumeReplay(response, generation);
    }).catch(function () {
      if (generation === store.generation) { bump('errors'); }
    }).then(function () {
      if (generation !== store.generation) { return; }
      store.video.backfillPending = false;
      var queued = store.video.backfillQueued;
      store.video.backfillQueued = null;
      if (queued !== null) { maybeBackfill(queued, true); }
    });
  }

  // ------------------------------------------------------------------- //
  // REST helpers
  // ------------------------------------------------------------------- //
  function apiUrl(path) {
    var base = String(store.apiBase || '').replace(/\/+$/, '');
    if (!path) { return base; }
    return base + (path[0] === '/' ? path : '/' + path);
  }

  function apiHeaders(extra) {
    var headers = {};
    if (extra) {
      Object.keys(extra).forEach(function (key) { headers[key] = extra[key]; });
    }
    if (store.apiKey) { headers['X-API-Key'] = store.apiKey; }
    return headers;
  }

  function readErrorDetail(body, status) {
    if (CONTRACT.isObject(body)) {
      var detail = body.detail;
      if (CONTRACT.isObject(detail)) {
        return {
          code: typeof detail.code === 'string' ? detail.code : '',
          message: typeof detail.message === 'string' ? detail.message
            : (typeof detail.code === 'string' ? detail.code : 'HTTP ' + status)
        };
      }
      if (typeof detail === 'string') { return { code: '', message: detail }; }
    }
    return { code: '', message: 'HTTP ' + status };
  }

  async function apiFetch(path, options) {
    var settings = options || {};
    var response = await fetch(apiUrl(path), {
      method: settings.method || 'GET',
      headers: apiHeaders(settings.headers),
      body: settings.body
    });
    var text = await response.text();
    var body = null;
    if (text) {
      try { body = JSON.parse(text); } catch (err) { body = null; }
    }
    if (!response.ok) {
      var detail = readErrorDetail(body, response.status);
      var error = new Error(detail.message);
      error.status = response.status;
      error.code = detail.code;
      throw error;
    }
    return body;
  }

  function showError(error) {
    var message = error && error.message ? error.message : String(error);
    if (error && error.code) { message = error.code + ': ' + message; }
    setError(message);
    bump('errors');
  }

  function withBusy(button, task) {
    var previous = button ? button.disabled : false;
    if (button) { button.disabled = true; }
    return Promise.resolve()
      .then(task)
      .finally(function () {
        if (button) { button.disabled = previous; }
        applyConnectionState();
      });
  }

  // ------------------------------------------------------------------- //
  // Backend health with retry
  // ------------------------------------------------------------------- //
  var HEALTH_DELAYS = [0, 1000, 2500, 5000, 8000, 15000];

  async function checkHealth(options) {
    var manual = !!(options && options.manual);
    // The local demo is deliberately backend-free: probing it would only add
    // console noise and a misleading "backend unreachable" state.
    if (store.demoActive && !manual) { return; }
    if (manual) {
      store.timers.healthAttempt = 0;
      if (store.timers.health) {
        window.clearTimeout(store.timers.health);
        store.timers.health = null;
      }
    }
    var generation = store.generation;
    if (el.healthBtn) { el.healthBtn.disabled = true; }
    setText(el.healthTxt, 'Checking ' + apiUrl('/healthz') + ' ...');

    try {
      var body = await apiFetch('/healthz');
      if (generation !== store.generation) { return; }
      var checked = CONTRACT.validateHealthStatus(body);
      if (!checked.ok) {
        invalid('health', checked.error);
        store.backend = 'incompatible';
        setText(el.healthTxt, 'The backend answered with an unexpected health payload.');
        setText(el.healthMeta, checked.error);
        scheduleHealthRetry();
        return;
      }
      if (checked.invalidEntries) {
        invalid('health', checked.invalidEntries + ' invalid ingest entries');
      }
      store.health = checked.value;
      store.backend = 'online';
      store.timers.healthAttempt = 0;
      setText(el.healthTxt, 'Backend online \u00b7 pipeline ' + checked.value.pipelineMode);

      var parts = [];
      if (checked.value.sources.length) {
        parts.push('streams: ' + checked.value.sources.join(', '));
      }
      if (checked.value.ingestSources.length) {
        parts.push('ingest: ' + checked.value.ingestSources.map(function (source) {
          return source.sourceId + ' (' + source.state + ')';
        }).join(', '));
      }
      setText(el.healthMeta, parts.length ? parts.join(' \u00b7 ')
        : 'No pipeline is producing right now.');
      applyConnectionState();
      refreshSources();
      return;
    } catch (error) {
      if (generation !== store.generation) { return; }
      store.backend = 'offline';
      setText(el.healthTxt, 'Backend unreachable: ' + (error.message || error));
      setText(el.healthMeta,
        'Retrying automatically. Start it with: uvicorn app.main:app --port 8000');
      scheduleHealthRetry();
    } finally {
      if (el.healthBtn && !el.healthBtn.dataset.busy) { el.healthBtn.disabled = false; }
    }
  }

  function scheduleHealthRetry() {
    if (store.demoActive || store.timers.health) { return; }
    var attempt = store.timers.healthAttempt;
    if (attempt >= HEALTH_DELAYS.length) {
      setText(el.healthMeta, 'Gave up after ' + HEALTH_DELAYS.length
        + ' attempts. Use "Check now" to retry.');
      return;
    }
    store.timers.healthAttempt = attempt + 1;
    var delay = HEALTH_DELAYS[attempt];
    setText(el.healthMeta, 'Retry ' + store.timers.healthAttempt + '/'
      + HEALTH_DELAYS.length + ' in ' + Math.round(delay / 1000) + 's.');
    store.timers.health = window.setTimeout(function () {
      store.timers.health = null;
      checkHealth({});
    }, delay);
    applyConnectionState();
  }

  // ------------------------------------------------------------------- //
  // Ingest source list
  // ------------------------------------------------------------------- //
  function sourceStateClass(state) {
    if (state === 'live' || state === 'running') { return 'state'; }
    if (state === 'starting' || state === 'reconnecting'
      || state === 'needs_calibration' || state === 'probing' || state === 'queued') { return 'state warn'; }
    if (state === 'ended' || state === 'stopped' || state === 'completed') { return 'state muted'; }
    return 'state bad';
  }

  /** Apply the server-owned teams block without touching identical values. */
  function applySourceTeams(teams) {
    if (!teams || !teams.home || !teams.away) { return; }
    if (store.teams.home === teams.home.name
      && store.teams.away === teams.away.name
      && store.teams.colors.home === teams.home.color
      && store.teams.colors.away === teams.away.color) { return; }
    applyTeamIdentity({
      homeTeam: teams.home.name,
      awayTeam: teams.away.name,
      colors: { home: teams.home.color, away: teams.away.color }
    });
  }

  function refreshStatusNow() {
    var sourceId = store.source.sourceId;
    if (!sourceId) { checkHealth({ manual: true }); return; }
    setText(el.prepMeta, 'Checking the source\u2026');
    pollCurrentSource(store.generation);
  }

  /**
   * Ask the backend to probe the model server once. The response carries only
   * readiness, calibration and the preview descriptor: never the inference URL
   * or a session token.
   */
  function refreshInferenceDetails() {
    var sourceId = store.source.sourceId;
    if (!sourceId) { setError('Connect an ingest source before checking readiness.'); return; }
    setText(el.prepMeta, 'Asking the backend for fresh readiness\u2026');
    return apiFetch('/ingest/sources/' + encodeURIComponent(sourceId)
      + '/inference?refresh=true').then(function (body) {
      var checked = CONTRACT.validateInferenceResponse(body);
      if (!checked.ok) {
        invalid('inference', checked.error);
        setText(el.prepMeta, 'Readiness payload was not understood: ' + checked.error);
        return;
      }
      if (checked.value.calibrationPreview) {
        store.source.calibrationPreview = checked.value.calibrationPreview;
      }
      mergeCalibrationState(checked.value);
      setNotice('Readiness refreshed.');
    }).catch(function (error) {
      setText(el.prepMeta, 'Readiness check failed: '
        + String(error && error.message ? error.message : error));
    });
  }

  // ------------------------------------------------------------------- //
  // Guided calibration
  // ------------------------------------------------------------------- //
  function calibrationUsed(id) {
    return store.calibration.points.some(function (point) {
      return point.landmarkId === id;
    });
  }

  function landmarkById(id) {
    for (var i = 0; i < CONTRACT.CALIBRATION_LANDMARKS.length; i += 1) {
      if (CONTRACT.CALIBRATION_LANDMARKS[i].id === id) {
        return CONTRACT.CALIBRATION_LANDMARKS[i];
      }
    }
    return null;
  }

  function setCalibError(message) {
    store.calibration.error = String(message || '').slice(0, 400);
    setText(el.calibErr, store.calibration.error);
  }

  function releasePreviewObject() {
    if (store.calibration.objectUrl && typeof URL !== 'undefined'
      && typeof URL.revokeObjectURL === 'function') {
      try { URL.revokeObjectURL(store.calibration.objectUrl); } catch (err) { /* ignore */ }
    }
    store.calibration.objectUrl = '';
    store.calibration.previewUrl = '';
    store.calibration.previewStamp = null;
    store.calibration.natural = { width: 0, height: 0 };
    if (el.calibImg) {
      el.calibImg.onload = null;
      el.calibImg.onerror = null;
      el.calibImg.removeAttribute('src');
    }
  }

  function clearCalibrationPoints() {
    store.calibration.points = [];
    store.calibration.error = '';
    setText(el.calibErr, '');
    renderCalibration();
  }

  function resetCalibration() {
    store.calibration.token += 1;
    releasePreviewObject();
    store.calibration.loading = false;
    store.calibration.submitting = false;
    clearCalibrationPoints();
    resetSuggestions();
  }

  function loadCalibrationPreview(force) {
    var preview = store.source.calibrationPreview;
    if (!preview || !preview.available || !preview.url) {
      setCalibError('The backend has not retained a calibration frame yet.');
      return Promise.resolve();
    }
    if (!force && store.calibration.objectUrl
      && store.calibration.previewUrl === preview.url
      && store.calibration.previewStamp === preview.capturedAt) {
      return Promise.resolve();
    }
    var token = store.calibration.token + 1;
    var generation = store.generation;
    store.calibration.token = token;
    store.calibration.loading = true;
    store.calibration.error = '';
    renderCalibration();
    return fetch(apiUrl(preview.url), {
      headers: apiHeaders(),
      cache: 'no-store'
    }).then(function (response) {
      if (token !== store.calibration.token || generation !== store.generation) { return null; }
      if (!response.ok) {
        throw new Error('the backend returned HTTP ' + response.status
          + ' for the retained frame');
      }
      return response.blob();
    }).then(function (blob) {
      if (!blob || token !== store.calibration.token || generation !== store.generation) {
        return;
      }
      releasePreviewObject();
      var objectUrl = URL.createObjectURL(blob);
      store.calibration.objectUrl = objectUrl;
      store.calibration.previewUrl = preview.url;
      store.calibration.previewStamp = Number.isFinite(preview.capturedAt)
        ? preview.capturedAt : null;
      store.calibration.natural = { width: 0, height: 0 };
      if (!el.calibImg) { return; }
      el.calibImg.onload = function () {
        if (token !== store.calibration.token) { return; }
        store.calibration.natural = {
          width: el.calibImg.naturalWidth || 0,
          height: el.calibImg.naturalHeight || 0
        };
        if (!store.calibration.natural.width || !store.calibration.natural.height) {
          setCalibError('The retained frame arrived without usable pixel dimensions.');
        }
        renderCalibration();
      };
      el.calibImg.onerror = function () {
        if (token !== store.calibration.token) { return; }
        setCalibError('The retained calibration frame could not be decoded. '
          + 'Use "Reload frame" or choose another source.');
      };
      el.calibImg.src = objectUrl;
    }).catch(function (error) {
      if (token !== store.calibration.token || generation !== store.generation) { return; }
      setCalibError('Could not load the calibration frame: '
        + String(error && error.message ? error.message : error));
    }).then(function () {
      if (token !== store.calibration.token) { return; }
      store.calibration.loading = false;
      renderCalibration();
    });
  }

  function renderCalibrationOptions() {
    if (!el.calibLandmark) { return; }
    var current = el.calibLandmark.value;
    clearNode(el.calibLandmark);
    var placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Choose a landmark\u2026';
    el.calibLandmark.appendChild(placeholder);
    CONTRACT.CALIBRATION_LANDMARKS.forEach(function (landmark) {
      var option = document.createElement('option');
      var used = calibrationUsed(landmark.id);
      option.value = landmark.id;
      option.textContent = landmark.label + (used ? ' \u00b7 used' : '');
      option.disabled = used;
      el.calibLandmark.appendChild(option);
    });
    var keep = current && !calibrationUsed(current) ? current : '';
    if (!keep) {
      for (var i = 0; i < CONTRACT.CALIBRATION_LANDMARKS.length; i += 1) {
        if (!calibrationUsed(CONTRACT.CALIBRATION_LANDMARKS[i].id)) {
          keep = CONTRACT.CALIBRATION_LANDMARKS[i].id;
          break;
        }
      }
    }
    el.calibLandmark.value = keep;
  }

  function renderCalibration() {
    renderCalibrationOptions();
    var points = store.calibration.points;
    var natural = store.calibration.natural;
    if (el.calibMarks) {
      clearNode(el.calibMarks);
      if (natural.width > 0 && natural.height > 0) {
        points.forEach(function (point, index) {
          var mark = make('span', 'calib-mark');
          mark.style.left = (point.imageX / natural.width * 100) + '%';
          mark.style.top = (point.imageY / natural.height * 100) + '%';
          mark.appendChild(make('b', null, String(index + 1)));
          el.calibMarks.appendChild(mark);
        });
      }
    }
    if (el.calibList) {
      clearNode(el.calibList);
      if (!points.length) {
        el.calibList.appendChild(make('li', 'calib-empty',
          'No points yet. Pick a landmark, then click that spot in the frame.'));
      }
      points.forEach(function (point, index) {
        var row = make('li', 'calib-point');
        row.appendChild(make('b', 'calib-point-index', String(index + 1)));
        var text = make('span', 'calib-point-text');
        text.appendChild(make('strong', null, point.label));
        text.appendChild(make('small', null,
          'image ' + point.imageX.toFixed(1) + ', ' + point.imageY.toFixed(1)
          + ' \u00b7 pitch ' + point.pitchX + ', ' + point.pitchY));
        row.appendChild(text);
        el.calibList.appendChild(row);
      });
    }
    var enough = points.length >= CONTRACT.CALIBRATION_MIN_POINTS
      && natural.width > 0 && natural.height > 0;
    if (el.calibSubmit) { el.calibSubmit.disabled = !enough || store.calibration.submitting; }
    if (el.calibUndo) { el.calibUndo.disabled = !points.length || store.calibration.submitting; }
    if (el.calibReset) { el.calibReset.disabled = !points.length || store.calibration.submitting; }
    if (el.calibPreviewBtn) {
      el.calibPreviewBtn.disabled = store.calibration.loading || store.calibration.submitting;
    }
    var info;
    if (store.calibration.loading) {
      info = 'Loading the retained calibration frame\u2026';
    } else if (!natural.width || !natural.height) {
      info = 'Waiting for the backend to retain a frame\u2026';
    } else {
      info = points.length + ' of at least ' + CONTRACT.CALIBRATION_MIN_POINTS
        + ' points selected \u00b7 preview ' + natural.width + '\u00d7' + natural.height
        + ' px';
    }
    if (store.calibration.submitting) { info = 'Applying the calibration\u2026'; }
    // The retained still is now the best frame the sweep saw, which on a
    // broadcast opening may still be a promo: say so instead of trusting it.
    var retained = store.source.calibrationPreview;
    if (retained && retained.lowConfidence && natural.width > 0) {
      info += ' \u00b7 low pitch visibility: this frame may not show the match';
    }
    setText(el.calibInfo, info);
    setText(el.calibErr, store.calibration.error);
  }

  function addCalibrationPoint(clientX, clientY) {
    if (store.calibration.submitting) { return; }
    var natural = store.calibration.natural;
    if (!natural.width || !natural.height || !el.calibImg) {
      setCalibError('The calibration frame has not loaded yet.');
      return;
    }
    var landmark = landmarkById(el.calibLandmark ? el.calibLandmark.value : '');
    if (!landmark) {
      setCalibError('Choose a landmark before clicking the frame.');
      return;
    }
    if (calibrationUsed(landmark.id)) {
      setCalibError('That landmark is already selected; choose a different one.');
      return;
    }
    if (store.calibration.points.length >= CONTRACT.CALIBRATION_MAX_POINTS) {
      setCalibError('At most ' + CONTRACT.CALIBRATION_MAX_POINTS + ' points are allowed.');
      return;
    }
    var rect = el.calibImg.getBoundingClientRect();
    var point = CONTRACT.imagePointToNatural(
      clientX, clientY, rect, natural.width, natural.height);
    store.calibration.points.push({
      landmarkId: landmark.id,
      label: landmark.label,
      imageX: point.x,
      imageY: point.y,
      pitchX: landmark.pitchX,
      pitchY: landmark.pitchY
    });
    store.calibration.error = '';
    renderCalibration();
  }

  function undoCalibrationPoint() {
    if (store.calibration.submitting) { return; }
    store.calibration.points.pop();
    store.calibration.error = '';
    renderCalibration();
  }

  function mergeCalibrationState(result) {
    if (!result) { return; }
    store.source.state = result.state || store.source.state;
    if (result.teams) {
      store.source.teams = result.teams;
      applySourceTeams(result.teams);
    }
    if (result.inference) { store.source.inference = result.inference; }
    // The calibration response repeats the calibration block at the top level;
    // it is the post-submit authority for phase, source and confidence.
    if (result.calibration && store.source.inference) {
      store.source.inference.calibration = result.calibration;
    }
    if (store.source.status) {
      store.source.status.state = store.source.state;
      store.source.status.running = !!result.running;
      store.source.status.teams = result.teams || store.source.teams;
      store.source.status.inference = store.source.inference;
    }
    renderSourceMeta();
    applyConnectionState();
    syncGate();
  }

  function submitCalibration() {
    if (store.calibration.submitting) { return; }
    var sourceId = store.source.sourceId;
    if (!sourceId) {
      setCalibError('There is no ingest source to calibrate.');
      return;
    }
    var payload = store.calibration.points.map(function (point) {
      return {
        imageX: point.imageX,
        imageY: point.imageY,
        pitchX: point.pitchX,
        pitchY: point.pitchY
      };
    });
    var checked = CONTRACT.validateCalibrationPoints(payload, store.calibration.natural);
    if (!checked.ok) {
      setCalibError(checked.error);
      return;
    }
    store.calibration.submitting = true;
    store.calibration.error = '';
    renderCalibration();
    return apiFetch('/ingest/sources/' + encodeURIComponent(sourceId) + '/calibration', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ points: checked.value })
    }).then(function (body) {
      var response = CONTRACT.validateCalibrationResponse(body);
      if (!response.ok) {
        invalid('calibration', response.error);
        throw new Error('the calibration response was not understood: ' + response.error);
      }
      // A 200 whose calibration is still pending is a rejection by another
      // name: keep the placed landmarks and let the human correct one.
      var calibration = response.value.calibration
        || (response.value.inference ? response.value.inference.calibration : null);
      if (calibration && calibration.phase !== 'calibrated') {
        mergeCalibrationState(response.value);
        setCalibError('Calibration was not accepted: '
          + (calibration.reason || ('the backend kept phase '
            + String(calibration.phase || 'pending'))));
        return;
      }
      store.calibration.points = [];
      mergeCalibrationState(response.value);
      setNotice('Calibration accepted from ' + checked.value.length + ' points.');
    }).catch(function (error) {
      var message = String(error && error.message ? error.message : error);
      if (error && error.code) { message = error.code + ': ' + message; }
      var calibration = store.source.inference && store.source.inference.calibration;
      if (calibration && calibration.reason) { message += ' (' + calibration.reason + ')'; }
      setCalibError(message);
    }).then(function () {
      store.calibration.submitting = false;
      renderCalibration();
      syncGate();
    });
  }

  // ------------------------------------------------------------------- //
  // Automatic calibration: confirm the auto-detected pitch points       //
  // ------------------------------------------------------------------- //
  //: The inference service names its landmarks in snake_case; the manual
  //: picker uses different ids, so suggestions carry their own labels.
  var SUGGEST_LANDMARK_LABELS = {
    north_west_corner: 'Corner \u00b7 west end, top',
    north_east_corner: 'Corner \u00b7 east end, top',
    south_east_corner: 'Corner \u00b7 east end, bottom',
    south_west_corner: 'Corner \u00b7 west end, bottom',
    halfway_top: 'Halfway line \u00b7 top touchline',
    halfway_bottom: 'Halfway line \u00b7 bottom touchline',
    center_spot: 'Centre spot',
    left_penalty_spot: 'Penalty spot \u00b7 left',
    right_penalty_spot: 'Penalty spot \u00b7 right'
  };

  function suggestionLabel(name) {
    var key = String(name || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
    if (!key) { return 'Detected point'; }
    return SUGGEST_LANDMARK_LABELS[key] || key.replace(/_/g, ' ');
  }

  function suggestionBlock() {
    return store.source.calibrationSuggestions || null;
  }

  function suggestionItems() {
    var block = suggestionBlock();
    if (!block || !block.available || !Array.isArray(block.items)) { return []; }
    return block.items;
  }

  //: The panel also shows while the scan runs: the manual button stays there,
  //: so a slow or empty detection never traps the operator.
  function suggestionPanelOpen() {
    var block = suggestionBlock();
    if (!block || store.calibrationSuggest.dismissed) { return false; }
    return suggestionItems().length > 0 || block.state === 'sampling';
  }

  function currentSuggestion() {
    var items = suggestionItems();
    if (!items.length) { return null; }
    if (store.calibrationSuggest.index < 0
      || store.calibrationSuggest.index >= items.length) {
      store.calibrationSuggest.index = 0;
    }
    return items[store.calibrationSuggest.index];
  }

  function setSuggestError(message) {
    store.calibrationSuggest.error = String(message || '').slice(0, 400);
    if (el.calibSuggestErr) { setText(el.calibSuggestErr, store.calibrationSuggest.error); }
  }

  function releaseSuggestionPreview() {
    if (store.calibrationSuggest.objectUrl && typeof URL !== 'undefined'
      && typeof URL.revokeObjectURL === 'function') {
      try { URL.revokeObjectURL(store.calibrationSuggest.objectUrl); } catch (err) { /* ignore */ }
    }
    store.calibrationSuggest.objectUrl = '';
    store.calibrationSuggest.previewUrl = '';
    if (el.calibSuggestImg) {
      el.calibSuggestImg.onload = null;
      el.calibSuggestImg.onerror = null;
      el.calibSuggestImg.removeAttribute('src');
    }
  }

  function resetSuggestions() {
    store.calibrationSuggest.token += 1;
    releaseSuggestionPreview();
    store.calibrationSuggest.index = 0;
    store.calibrationSuggest.round = 0;
    store.calibrationSuggest.attemptedUrl = '';
    store.calibrationSuggest.loading = false;
    store.calibrationSuggest.accepting = false;
    store.calibrationSuggest.error = '';
    store.calibrationSuggest.dismissed = false;
  }

  /**
   * A fresh detection round (new `generatedAt`) re-opens the confirmation
   * panel and re-fetches its annotated frame; the same round keeps whatever
   * the human already chose, including "place points manually".
   */
  function syncSuggestionRound(block) {
    var state = store.calibrationSuggest;
    var stamp = block && block.available && block.generatedAt ? block.generatedAt : 0;
    if (stamp && stamp !== state.round) {
      state.round = stamp;
      state.index = 0;
      state.dismissed = false;
      state.attemptedUrl = '';
      state.error = '';
      releaseSuggestionPreview();
    }
    if (!block || !block.available) {
      if (state.objectUrl) { releaseSuggestionPreview(); }
      if (state.index !== 0) { state.index = 0; }
    }
  }

  function syncSuggestionPreview() {
    var suggestion = currentSuggestion();
    var state = store.calibrationSuggest;
    if (!suggestion || !suggestion.previewUrl) { return Promise.resolve(); }
    if (state.attemptedUrl === suggestion.previewUrl) { return Promise.resolve(); }
    var token = state.token + 1;
    var generation = store.generation;
    state.token = token;
    state.attemptedUrl = suggestion.previewUrl;
    state.loading = true;
    state.error = '';
    renderCalibrationSuggest();
    return fetch(apiUrl(suggestion.previewUrl), {
      headers: apiHeaders(),
      cache: 'no-store'
    }).then(function (response) {
      if (token !== state.token || generation !== store.generation) { return null; }
      if (!response.ok) {
        throw new Error('the backend returned HTTP ' + response.status
          + ' for the suggested frame');
      }
      return response.blob();
    }).then(function (blob) {
      if (!blob || token !== state.token || generation !== store.generation) { return; }
      releaseSuggestionPreview();
      state.objectUrl = URL.createObjectURL(blob);
      state.previewUrl = suggestion.previewUrl;
    }).catch(function (error) {
      if (token !== state.token || generation !== store.generation) { return; }
      setSuggestError('Could not load the suggested frame: '
        + String(error && error.message ? error.message : error));
    }).then(function () {
      if (token !== state.token) { return; }
      state.loading = false;
      renderCalibrationSuggest();
    });
  }

  // ------------------------------------------------------------------- //
  // Skip to match footage: sample a timestamp the operator names         //
  // ------------------------------------------------------------------- //
  //: The empty-state copy and the scan badge both need a clock a human
  //: reads, never a raw float of seconds.
  function formatSeekClock(seconds) {
    var value = Number(seconds);
    if (!Number.isFinite(value) || value < 0) { return '00:00'; }
    var whole = Math.floor(value);
    var minutes = Math.floor(whole / 60);
    var rest = whole % 60;
    return (minutes < 10 ? '0' : '') + minutes + ':' + (rest < 10 ? '0' : '') + rest;
  }

  /** `mm:ss`, `h:mm:ss` or plain seconds; null when the text is not a time. */
  function parseSeekClock(value) {
    var text = String(value == null ? '' : value).trim();
    if (!text) { return null; }
    if (/^\d+(?:\.\d+)?$/.test(text)) {
      var bare = Number(text);
      return Number.isFinite(bare) ? bare : null;
    }
    var parts = text.split(':');
    if (parts.length < 2 || parts.length > 3) { return null; }
    var total = 0;
    for (var index = 0; index < parts.length; index += 1) {
      var chunk = parts[index].trim();
      if (!/^\d{1,2}(?:\.\d+)?$/.test(chunk)) { return null; }
      total = total * 60 + Number(chunk);
    }
    return Number.isFinite(total) ? total : null;
  }

  function sourceDuration() {
    var status = store.source.status;
    var media = status && status.media;
    var duration = media ? Number(media.duration) : NaN;
    return Number.isFinite(duration) && duration > 0 ? duration : null;
  }

  function setSeekError(message) {
    store.calibrationSeek.error = String(message || '').slice(0, 400);
    setText(el.calibSeekErr, store.calibrationSeek.error);
  }

  function renderCalibrationSeek() {
    var block = suggestionBlock();
    var state = store.calibrationSeek;
    var items = suggestionItems();
    var scanned = block && Number.isFinite(block.scannedSeconds)
      ? block.scannedSeconds : 0;
    var badge = 'optional';
    var note;
    if (state.scanning) {
      badge = 'scanning\u2026';
      note = 'Sampling frames around '
        + formatSeekClock(state.lastSeconds || 0)
        + ' and asking the model server for pitch landmarks.';
    } else if (block && block.state === 'empty') {
      badge = 'no pitch found';
      note = scanned > 0
        ? 'No pitch frames found in the first ' + Math.round(scanned)
          + ' seconds. The video may start with pre-match content.'
        : 'No pitch frames found in the sampled frames. '
          + 'The video may start with pre-match content.';
      if (state.lastSeconds !== null && state.lastSeconds !== undefined) {
        note += ' Still no pitch detected \u2014 try a different timestamp.';
      }
    } else if (items.length) {
      badge = 'frame found';
      note = 'A pitch view was detected at '
        + formatSeekClock(scanned > 0 ? scanned : state.lastSeconds || 0)
        + '. Confirm the points above, or scan another moment.';
      if (block && block.lowConfidence) {
        note += ' Low pitch visibility: check every numbered point first.';
      }
    } else if (block && block.state === 'sampling') {
      badge = 'sampling';
      note = 'Scanning the video for a pitch view; this can take a few seconds.';
    } else {
      note = 'Broadcasts often open on idents, montages and sponsor bumpers. '
        + 'Enter where the match begins and scan that moment.';
    }
    if (el.calibSeekBadge) {
      setText(el.calibSeekBadge, badge);
      el.calibSeekBadge.setAttribute('data-state', badge);
    }
    setText(el.calibSeekMsg, note);
    if (el.calibSeekMsg) {
      var warn = !state.scanning && block && (block.state === 'empty'
        || (items.length > 0 && block.lowConfidence));
      el.calibSeekMsg.className = warn ? 'calib-seek-msg warn' : 'calib-seek-msg';
    }
    setText(el.calibSeekErr, state.error);
    if (el.calibSeekScan) {
      el.calibSeekScan.disabled = state.scanning;
      el.calibSeekScan.textContent = state.scanning ? 'Scanning\u2026' : 'Scan';
    }
    if (el.calibSeekTime) { el.calibSeekTime.disabled = state.scanning; }
  }

  /**
   * Ask the backend to jump to a timestamp and sample around it. This is the
   * escape hatch for a video that opens on pre-match graphics: the automatic
   * sweep may honestly find nothing, and the operator usually knows when the
   * match starts. The answer is stored like any other round, so the normal
   * confirm card appears when points are found and the manual grid stays
   * available either way.
   */
  function scanCalibrationSeek() {
    var state = store.calibrationSeek;
    if (state.scanning) { return; }
    var sourceId = store.source.sourceId;
    if (!sourceId) { setSeekError('There is no ingest source to scan.'); return; }
    if (store.source.kind === 'rtsp') {
      setSeekError('A live camera has no timeline to jump to; this works on an upload.');
      return;
    }
    var seconds = parseSeekClock(el.calibSeekTime ? el.calibSeekTime.value : '');
    if (seconds === null) {
      setSeekError('Enter the match start as minutes:seconds, for example 04:30.');
      return;
    }
    var duration = sourceDuration();
    if (duration !== null && seconds > duration) {
      setSeekError('That timestamp is past the end of the video ('
        + formatSeekClock(duration) + ').');
      return;
    }
    state.scanning = true;
    state.lastSeconds = seconds;
    state.error = '';
    renderCalibrationSeek();
    return apiFetch('/ingest/sources/' + encodeURIComponent(sourceId)
      + '/seek-calibration', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seekSeconds: seconds })
    }).then(function (body) {
      var payload = body && body.source ? body.source : body;
      var checked = CONTRACT.validateSourceEnvelope(payload);
      if (!checked.ok) {
        invalid('source', checked.error);
        throw new Error('the seek response was not understood: ' + checked.error);
      }
      // A scan is a fresh detection round: forget the previous decision so the
      // new answer decides between the confirm card and the manual grid.
      store.calibrationSuggest.dismissed = false;
      store.calibrationSuggest.index = 0;
      store.calibrationSuggest.attemptedUrl = '';
      releaseSuggestionPreview();
      applySourceStatus(checked.value);
      if (!suggestionItems().length) {
        setNotice('No pitch detected at ' + formatSeekClock(seconds)
          + '. Try a different timestamp, or place points manually.');
      } else {
        setNotice('Pitch view found at ' + formatSeekClock(seconds)
          + '. Confirm the auto-detected points.');
      }
    }).catch(function (error) {
      if (error && error.code) { invalid('calibration', error.code); }
      setSeekError((error && error.code ? error.code + ': ' : '')
        + String(error && error.message ? error.message : error));
    }).then(function () {
      state.scanning = false;
      renderCalibrationSeek();
      renderCalibrationSuggest();
      renderCalibration();
      syncGate();
    });
  }

  function renderCalibrationSuggest() {
    var block = suggestionBlock();
    renderCalibrationSeek();
    var items = suggestionItems();
    var suggestion = currentSuggestion();
    var state = store.calibrationSuggest;
    var open = suggestionPanelOpen();
    if (el.calibSuggest) { el.calibSuggest.hidden = !open; }
    if (el.calibManualPanel) { el.calibManualPanel.hidden = open; }
    if (!open) {
      if (block && block.state === 'empty') {
        var scanned = Number.isFinite(block.scannedSeconds) ? block.scannedSeconds : 0;
        setText(el.calibHint, 'No pitch frames found in the first '
          + Math.round(scanned) + ' seconds. The video may start with pre-match '
          + 'content: skip to the match below, or pick at least four landmarks here.');
      } else if (CALIB_HINT_DEFAULT) {
        setText(el.calibHint, CALIB_HINT_DEFAULT);
      }
      return;
    }
    var badge = 'detecting\u2026';
    if (items.length) {
      badge = 'frame ' + (state.index + 1) + ' of ' + items.length;
      if (suggestion && Number.isFinite(suggestion.confidence)) {
        badge += ' \u00b7 ' + Math.round(suggestion.confidence * 100) + '%';
      }
    }
    if (el.calibSuggestBadge) { setText(el.calibSuggestBadge, badge); }
    var showImage = !!(suggestion && state.objectUrl);
    if (el.calibSuggestImg) {
      el.calibSuggestImg.hidden = !showImage;
      if (!showImage) {
        el.calibSuggestImg.removeAttribute('src');
      } else if (el.calibSuggestImg.getAttribute('src') !== state.objectUrl) {
        el.calibSuggestImg.src = state.objectUrl;
      }
    }
    if (el.calibSuggestList) {
      clearNode(el.calibSuggestList);
      if (!suggestion) {
        el.calibSuggestList.appendChild(make('li', 'calib-empty',
          'Scanning the opening seconds of the video for a clear pitch view\u2026'));
      } else {
        var landmarks = Array.isArray(suggestion.landmarks) ? suggestion.landmarks : [];
        suggestion.points.forEach(function (point, index) {
          var row = make('li', 'calib-point');
          row.appendChild(make('b', 'calib-point-index', String(index + 1)));
          var text = make('span', 'calib-point-text');
          text.appendChild(make('strong', null, suggestionLabel(landmarks[index])));
          text.appendChild(make('small', null,
            'image ' + point.imageX.toFixed(1) + ', ' + point.imageY.toFixed(1)
            + ' \u00b7 pitch ' + point.pitchX + ', ' + point.pitchY + ' m'));
          row.appendChild(text);
          el.calibSuggestList.appendChild(row);
        });
      }
    }
    var info;
    if (state.accepting) {
      info = 'Submitting the auto-detected points\u2026';
    } else if (state.loading) {
      info = 'Loading the annotated frame\u2026';
    } else if (!suggestion) {
      info = 'The model server scans the sampled frames for green pitch and white lines.';
    } else {
      info = suggestion.points.length + ' auto-detected landmarks \u00b7 frame '
        + suggestion.frameIndex + '. Accept them, try another frame, or place points yourself.';
    }
    if (el.calibSuggestInfo) { setText(el.calibSuggestInfo, info); }
    if (el.calibSuggestErr) { setText(el.calibSuggestErr, state.error); }
    if (el.calibAccept) { el.calibAccept.disabled = !suggestion || state.accepting; }
    if (el.calibRetry) { el.calibRetry.disabled = items.length < 2 || state.accepting; }
    if (el.calibManual) { el.calibManual.disabled = state.accepting; }
    if (suggestion && suggestion.previewUrl && !state.objectUrl && !state.loading) {
      syncSuggestionPreview();
    }
  }

  function acceptCalibrationSuggestion() {
    var state = store.calibrationSuggest;
    if (state.accepting) { return; }
    var sourceId = store.source.sourceId;
    var suggestion = currentSuggestion();
    if (!sourceId) { setSuggestError('There is no ingest source to calibrate.'); return; }
    if (!suggestion) { setSuggestError('No auto-detected points are available yet.'); return; }
    var checked = CONTRACT.validateCalibrationPoints(suggestion.points, null);
    if (!checked.ok) { setSuggestError(checked.error); return; }
    state.accepting = true;
    state.error = '';
    renderCalibrationSuggest();
    return apiFetch('/ingest/sources/' + encodeURIComponent(sourceId)
      + '/calibration-accept', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ suggestionIndex: state.index })
    }).then(function (body) {
      var response = CONTRACT.validateCalibrationResponse(body);
      if (!response.ok) {
        invalid('calibration', response.error);
        throw new Error('the calibration response was not understood: ' + response.error);
      }
      // A 200 whose calibration is still pending is a rejection by another
      // name: keep the panel so the human can try the next frame.
      var calibration = response.value.calibration
        || (response.value.inference ? response.value.inference.calibration : null);
      if (calibration && calibration.phase !== 'calibrated') {
        mergeCalibrationState(response.value);
        setSuggestError('Calibration was not accepted: '
          + (calibration.reason || ('the backend kept phase '
            + String(calibration.phase || 'pending'))));
        return;
      }
      resetSuggestions();
      mergeCalibrationState(response.value);
      setNotice('Calibration accepted from ' + checked.value.length
        + ' auto-detected points.');
    }).catch(function (error) {
      var message = String(error && error.message ? error.message : error);
      if (error && error.code) { message = error.code + ': ' + message; }
      var calibration = store.source.inference && store.source.inference.calibration;
      if (calibration && calibration.reason) { message += ' (' + calibration.reason + ')'; }
      setSuggestError(message);
    }).then(function () {
      state.accepting = false;
      renderCalibrationSuggest();
      syncGate();
    });
  }

  function retryCalibrationSuggestion() {
    var state = store.calibrationSuggest;
    var items = suggestionItems();
    if (state.accepting || items.length < 2) { return; }
    state.index = (state.index + 1) % items.length;
    state.attemptedUrl = '';
    state.error = '';
    releaseSuggestionPreview();
    renderCalibrationSuggest();
  }

  function useManualCalibration() {
    store.calibrationSuggest.dismissed = true;
    store.calibrationSuggest.error = '';
    renderCalibrationSuggest();
    renderCalibration();
    if (!store.calibration.objectUrl && !store.calibration.loading) {
      loadCalibrationPreview(false);
    }
  }

  // ------------------------------------------------------------------- //
  // Mandatory gate: preparation, calibration and readiness
  // ------------------------------------------------------------------- //
  function gatePhase() {
    if (store.mode === 'demo') { return 'ready'; }
    if (!store.source.matchId) { return 'source'; }
    if (!store.source.kind || store.source.kind === 'simulator') { return 'ready'; }
    return CONTRACT.sourceGatePhase({
      matchId: store.source.matchId,
      kind: store.source.kind,
      state: store.source.state,
      inference: store.source.inference,
      calibrationPreview: store.source.calibrationPreview
    });
  }

  function showGateCard(card) {
    ['prepCard', 'calibCard'].forEach(function (id) {
      if (el[id]) { el[id].hidden = card !== id; }
    });
    if (el.srcCards) { el.srcCards.hidden = !!card; }
  }

  function renderGate() {
    if (!gateArmed || store.mode === 'demo') {
      showGateCard('');
      setText(el.srcDlgTitle, DIALOG_TITLE);
      setText(el.srcDlgSub, DIALOG_SUB);
      return;
    }
    var phase = gatePhase();
    if (gatePicker && phase !== 'source' && phase !== 'ready') {
      showGateCard('');
      setText(el.srcDlgTitle, DIALOG_TITLE);
      setText(el.srcDlgSub, 'The running source is untouched. Pick another input to '
        + 'switch, or use "Watch" on the running source to reopen its progress.');
      return;
    }
    if (phase === 'source' || phase === 'ready') {
      showGateCard('');
      setText(el.srcDlgTitle, DIALOG_TITLE);
      setText(el.srcDlgSub, DIALOG_SUB);
      return;
    }
    if (phase === 'calibration') {
      showGateCard('calibCard');
      setText(el.srcDlgTitle, 'Calibrate this camera');
      setText(el.srcDlgSub, 'The backend needs pitch correspondences before '
        + 'analytics can open. Auto-detected points are offered first.');
      renderCalibrationSuggest();
      renderCalibration();
      // The manual still is only fetched when the confirmation panel is not
      // the thing on screen; the auto path needs no clicking at all. A still
      // the backend replaced (new `capturedAt`) is always refetched, otherwise
      // the grid would keep showing the pre-match frame forever.
      var retained = store.source.calibrationPreview;
      var stale = !!(retained && retained.available
        && store.calibration.previewStamp !== retained.capturedAt);
      if (!suggestionPanelOpen() && !store.calibration.loading
        && (!store.calibration.objectUrl || stale)) {
        loadCalibrationPreview(false);
      }
      return;
    }
    showGateCard('prepCard');
    setText(el.srcDlgTitle, phase === 'failed' ? 'Source needs attention' : 'Preparing your source');
    setText(el.srcDlgSub, phase === 'failed'
      ? 'The backend reported a problem. The details below say what to fix.'
      : 'The analytics desk stays locked until this source is publishing calibrated tracking.');
    renderPrep(phase === 'failed');
  }

  function syncGate() {
    if (!gateArmed) { return; }
    if (gatePhase() === 'ready') {
      releaseGate();
      showGateCard('');
      setText(el.srcDlgTitle, DIALOG_TITLE);
      setText(el.srcDlgSub, DIALOG_SUB);
      closeDialog();
      return;
    }
    renderGate();
  }

  function renderPrepSteps(steps) {
    if (!el.prepSteps) { return; }
    clearNode(el.prepSteps);
    steps.forEach(function (step) {
      var item = make('li', 'gate-step'
        + (step.done ? ' done' : '')
        + (step.warn ? ' warn' : '')
        + (step.bad ? ' bad' : ''));
      item.appendChild(make('span', 'gate-step-dot'));
      var text = make('span', 'gate-step-text');
      text.appendChild(make('strong', null, step.label));
      if (step.detail) { text.appendChild(make('small', null, step.detail)); }
      item.appendChild(text);
      el.prepSteps.appendChild(item);
    });
  }

  function renderPrep(failed) {
    var source = store.source;
    var inference = source.inference || null;
    var pipeline = source.pipeline || null;
    var state = source.state || 'starting';
    // `live` is not the whole story: an enabled model that is still warming up
    // keeps the desk closed, so the badge names that stage explicitly.
    var badge = state.replace(/_/g, ' ');
    if (state === 'live' && inference && inference.enabled === true
      && inference.ready !== true) {
      badge = 'model loading';
    }
    setText(el.prepState, badge);
    if (el.prepState) { el.prepState.setAttribute('data-state', state); }

    var steps = [];
    steps.push({
      label: 'Source accepted',
      detail: source.sourceId || source.matchId || '',
      done: !!source.matchId
    });
    var decoded = !!(pipeline && ((pipeline.framesDecoded || 0) > 0
      || (pipeline.framesTracked || 0) > 0)) || !!(source.hls && source.hls.ready);
    steps.push({
      label: 'Video decoding',
      detail: decoded ? 'frames are arriving' : 'waiting for the first frame',
      done: decoded
    });
    var modelReady = !!(inference && inference.ready === true);
    var modelProblem = !!(inference && (inference.error || inference.reachable === false));
    steps.push({
      label: 'Inference model',
      detail: inference
        ? (modelReady ? 'ready'
          : (inference.detail || (inference.enabled ? 'loading model' : 'no session yet')))
        : 'waiting for status',
      done: modelReady,
      warn: !modelReady && !modelProblem,
      bad: modelProblem
    });
    var calibration = inference && inference.calibration;
    var calibrated = !!(calibration && calibration.phase === 'calibrated');
    var needsCalibration = !!(calibration && calibration.phase === 'needs_calibration');
    var detail = 'pending';
    if (calibrated) {
      detail = 'calibrated from ' + (calibration.source || 'auto');
      if (Number.isFinite(calibration.confidence)) {
        detail += ' \u00b7 ' + Math.round(calibration.confidence * 100) + '%';
      }
    } else if (needsCalibration) {
      detail = 'a human must place at least four landmarks';
    }
    steps.push({
      label: 'Pitch calibration',
      detail: detail,
      done: calibrated,
      warn: needsCalibration
    });
    renderPrepSteps(steps);

    var meta = ['state ' + state.replace(/_/g, ' ')];
    if (pipeline) {
      if (Number.isFinite(pipeline.framesDecoded)) { meta.push('frames ' + pipeline.framesDecoded); }
      if (Number.isFinite(pipeline.analysisFps)) {
        meta.push(pipeline.analysisFps.toFixed(1) + ' analysis fps');
      }
      if (Number.isFinite(pipeline.queueDepth)) { meta.push('queue ' + pipeline.queueDepth); }
    }
    if (inference) {
      if (inference.latency && Number.isFinite(inference.latency.lastMs)) {
        meta.push('inference ' + Math.round(inference.latency.lastMs) + ' ms');
        if (Number.isFinite(inference.latency.averageMs)) {
          meta.push('avg ' + Math.round(inference.latency.averageMs) + ' ms');
        }
      }
      if (inference.checkedAt) {
        meta.push('checked ' + new Date(inference.checkedAt).toLocaleTimeString());
      }
    }
    if (source.hls && source.hls.ready) { meta.push('HLS ' + source.hls.segments + ' segments'); }
    setText(el.prepMeta, meta.join(' \u00b7 '));

    var messages = [];
    if (source.error && source.error.message) {
      messages.push((source.error.code ? source.error.code + ': ' : '')
        + source.error.message);
      if (source.error.action) { messages.push(source.error.action); }
    }
    if (inference && inference.error && inference.error.message) {
      messages.push('Inference ' + (inference.error.code || 'error') + ': '
        + inference.error.message);
      if (inference.error.action) { messages.push(inference.error.action); }
    }
    if (failed && !messages.length) {
      messages.push('The source reported a failure. Change source, or check the '
        + 'backend log for this source id.');
    }
    setText(el.prepErr, messages.join(' '));
    if (el.prepAction) {
      el.prepAction.textContent = 'Probe model server';
      el.prepAction.hidden = false;
    }
  }

  var metaSignature = '';

  /**
   * The strip over the stage: readiness, calibration, analysis progress,
   * latency and identity/commentary counters. It renders only validated values
   * and never a backend URL, session id or prompt.
   */
  function renderSourceMeta() {
    if (!el.srcMeta) { return; }
    if (store.mode !== 'connected' || !store.source.matchId) {
      el.srcMeta.hidden = true;
      metaSignature = '';
      return;
    }
    var source = store.source;
    var inference = source.inference || null;
    var pipeline = source.pipeline || null;
    var calibration = inference && inference.calibration ? inference.calibration : null;
    var known = 0;
    var total = 0;
    Object.keys(renderState.players).forEach(function (id) {
      total += 1;
      if (identityNumber(renderState.players[id]) !== null) { known += 1; }
    });
    var gemini = inference && inference.gemini ? inference.gemini : null;
    var signature = [
      source.state,
      pipeline && pipeline.framesDecoded,
      pipeline && pipeline.analysisFps,
      inference && inference.ready,
      calibration && calibration.phase,
      calibration && calibration.source,
      calibration && calibration.confidence,
      inference && inference.latency ? inference.latency.lastMs : null,
      gemini ? [gemini.lines, gemini.geminiLines, gemini.templateLines,
        gemini.geminiErrors, gemini.mode].join('/') : null,
      known, total,
      source.hls && source.hls.segments,
      source.error && source.error.code
    ].join('|');
    if (signature === metaSignature) { return; }
    metaSignature = signature;
    el.srcMeta.hidden = false;
    var state = source.state || 'starting';
    setText(el.srcMetaState, state.replace(/_/g, ' '));
    el.srcMetaState.setAttribute('data-state', state);

    var parts = [];
    if (pipeline) {
      if (Number.isFinite(pipeline.framesDecoded)) { parts.push('frames ' + pipeline.framesDecoded); }
      if (Number.isFinite(pipeline.analysisFps)) {
        parts.push(pipeline.analysisFps.toFixed(1) + ' fps');
      }
    }
    if (inference) {
      if (inference.ready === true) { parts.push('model ready'); }
      else if (inference.ready === false) { parts.push('model not ready'); }
      else if (inference.enabled) { parts.push('model loading'); }
      if (calibration) {
        parts.push('calib ' + calibration.phase.replace(/_/g, ' ')
          + (calibration.source ? ' (' + calibration.source + ')' : '')
          + (Number.isFinite(calibration.confidence)
            ? ' ' + Math.round(calibration.confidence * 100) + '%' : ''));
      }
      if (inference.latency && Number.isFinite(inference.latency.lastMs)) {
        parts.push('latency ' + Math.round(inference.latency.lastMs) + ' ms');
      }
      if (inference.error) { parts.push('inference error'); }
    }
    if (source.hls && source.hls.ready) { parts.push('HLS ' + source.hls.segments + ' seg'); }
    if (source.error && source.error.code) { parts.push('source ' + source.error.code); }
    setText(el.srcMetaProgress, parts.length ? parts.join(' \u00b7 ') : 'waiting for status');

    var geminiParts = ['IDs ' + known + '/' + total];
    if (gemini) {
      geminiParts.push('Gemini ' + gemini.geminiLines + '/' + gemini.lines + ' lines');
      if (gemini.mode === 'template' || gemini.enabled === false) {
        geminiParts.push('template mode');
      }
      if (gemini.geminiErrors) { geminiParts.push(gemini.geminiErrors + ' errors'); }
    }
    setText(el.srcMetaGemini, geminiParts.join(' \u00b7 '));
  }

  function renderSources() {
    if (!el.srcList) { return; }
    var list = store.sources || [];
    if (el.resumeCard) { el.resumeCard.hidden = !list.length; }
    clearNode(el.srcList);
    if (!list.length) {
      el.srcList.appendChild(make('p', 'dlg-note', store.backend === 'online'
        ? 'No ingest source has run in this process yet.'
        : 'No backend connection yet.'));
      return;
    }
    list.forEach(function (source) {
      var row = make('div', 'srcrow'
        + (store.source.sourceId === source.sourceId ? ' active' : ''));
      row.appendChild(make('span', 'kind', source.kind));
      var ids = make('div', 'ids');
      ids.appendChild(make('b', null, source.sourceId));
      ids.appendChild(make('small', 'mu', source.matchId));
      row.appendChild(ids);

      var state = make('span', sourceStateClass(source.state), source.state);
      row.appendChild(state);

      var actions = make('div', 'actions');
      var watch = document.createElement('button');
      watch.type = 'button';
      watch.textContent = 'Watch';
      watch.addEventListener('click', function () {
        connectMatch(source.matchId, {
          kind: source.kind,
          sourceId: source.sourceId,
          status: source
        }).catch(showError);
      });
      actions.appendChild(watch);

      var stop = document.createElement('button');
      stop.type = 'button';
      stop.className = 'danger';
      stop.textContent = 'Stop';
      stop.addEventListener('click', function () {
        stopSourceById(source.sourceId).catch(showError);
      });
      actions.appendChild(stop);
      row.appendChild(actions);
      el.srcList.appendChild(row);
    });
  }

  function refreshSources() {
    if (store.backend !== 'online') {
      store.sources = [];
      renderSources();
      return Promise.resolve();
    }
    var token = (store.sourcesToken || 0) + 1;
    store.sourcesToken = token;
    return apiFetch('/ingest/sources').then(function (body) {
      if (store.sourcesToken !== token) { return; }
      var checked = CONTRACT.validateSourceList(body);
      if (!checked.ok) {
        invalid('sources', checked.error);
        return;
      }
      if (checked.invalidEntries) {
        invalid('sources', checked.invalidEntries + ' invalid source entries');
      }
      store.sources = checked.value.sources.slice().reverse();
      renderSources();
    }).catch(function (error) {
      if (store.sourcesToken !== token) { return; }
      bump('errors');
      store.lastError = String(error.message || error).slice(0, 200);
    });
  }

  function cacheSource(source) {
    if (!Array.isArray(store.sources)) { store.sources = []; }
    var replaced = false;
    store.sources = store.sources.map(function (item) {
      if (item.sourceId === source.sourceId) { replaced = true; return source; }
      return item;
    });
    if (!replaced) { store.sources.unshift(source); }
    renderSources();
  }

  /**
   * Merge a validated status body into the store. `needs_calibration` is a
   * running, non-terminal state: polling continues and the gate stays closed
   * until the backend proves the source is live and calibrated.
   */
  function applySourceStatus(source) {
    var previous = store.source;
    store.source.status = source;
    store.source.state = source.state || previous.state;
    store.source.hls = source.hls || previous.hls;
    store.source.kind = source.kind || previous.kind;
    store.source.sourceId = source.sourceId || previous.sourceId;
    store.source.matchId = source.matchId || previous.matchId;
    store.source.teams = source.teams || null;
    store.source.inference = source.inference || null;
    store.source.calibrationPreview = source.calibrationPreview || null;
    store.source.calibrationSuggestions = source.calibrationSuggestions || null;
    syncSuggestionRound(store.source.calibrationSuggestions);
    store.source.pipeline = source.pipeline || null;
    store.source.error = source.error || null;
    if (source.sourceId) { cacheSource(source); }
    applySourceTeams(source.teams);

    if (source.hls && source.hls.ready && source.hls.manifest) {
      var url = absoluteUrl(source.hls.manifest);
      if (url && store.video.url !== url) { startHls(url); }
    }
    if (source.error && source.error.message) {
      store.lastError = String(source.error.message).slice(0, 240);
    }
    if (CONTRACT.isSourceTerminal(store.source.state)) {
      stopStatusPolling();
    }
    renderSourceMeta();
    applyConnectionState();
    syncGate();
  }

  function startStatusPolling() {
    stopStatusPolling();
    var generation = store.generation;
    store.timers.status = window.setInterval(function () {
      if (generation !== store.generation) { stopStatusPolling(); return; }
      pollCurrentSource(generation);
    }, 2000);
  }

  function stopStatusPolling() {
    if (store.timers.status) {
      window.clearInterval(store.timers.status);
      store.timers.status = null;
    }
  }

  function pollCurrentSource(generation) {
    if (generation !== store.generation) { return Promise.resolve(); }
    var sourceId = store.source.sourceId;
    refreshHealthQuiet();
    if (!sourceId) { return Promise.resolve(); }
    return apiFetch('/ingest/sources/' + encodeURIComponent(sourceId)).then(function (body) {
      if (generation !== store.generation) { return; }
      var checked = CONTRACT.validateSourceEnvelope(body);
      if (!checked.ok) {
        invalid('source', checked.error);
        return;
      }
      applySourceStatus(checked.value);
    }).catch(function (error) {
      if (generation !== store.generation) { return; }
      bump('errors');
      if (error.status === 404) {
        // The process that owned the source is gone: the only honest option is
        // to drop back to the picker with the reason, not to fake a live desk.
        stopStatusPolling();
        clearSource({ silent: true });
        setError('The backend no longer knows source ' + sourceId
          + '. Choose a source again.');
        return;
      }
      setText(el.prepMeta, 'Status check failed: '
        + String(error && error.message ? error.message : error)
        + '. Retrying every 2 s.');
    });
  }

  function refreshHealthQuiet() {
    if (store.backend !== 'online') { return; }
    apiFetch('/healthz').then(function (body) {
      var checked = CONTRACT.validateHealthStatus(body);
      if (checked.ok) {
        store.health = checked.value;
        store.backend = 'online';
      }
    }).catch(function () {
      store.backend = 'offline';
      applyConnectionState();
    });
  }

  // ------------------------------------------------------------------- //
  // Connection lifecycle
  // ------------------------------------------------------------------- //
  async function loadMatchSummary(matchId) {
    var generation = store.generation;
    try {
      var body = await apiFetch('/matches/' + encodeURIComponent(matchId));
      if (generation !== store.generation) { return; }
      var checked = CONTRACT.validateMatchSummary(body);
      if (!checked.ok) {
        invalid('match', checked.error);
        return;
      }
      applyTeamIdentity(checked.value);
      store.matchStatus = checked.value.status;
      store.dirty.stats = true;
    } catch (error) {
      if (generation !== store.generation) { return; }
      invalid('match', String(error.message || error));
    }
  }

  async function connectMatch(matchId, meta) {
    clearDialogMessages();
    var id = String(matchId || '').trim();
    if (!id) { setError('A match id is required.'); return; }
    var details = meta || {};
    var kind = details.kind || 'simulator';
    var status = details.status || null;
    // Re-watching the same ingest source must not throw away points the human
    // already placed; every other switch starts from a clean calibration.
    var sameSource = !!(details.sourceId && details.sourceId === store.source.sourceId);

    clearSource({ silent: true, keepCalibration: sameSource });
    var generation = store.generation;
    store.mode = 'connected';
    store.source = {
      kind: kind,
      sourceId: details.sourceId || null,
      matchId: id,
      state: (status && status.state) || 'starting',
      status: status,
      hls: status ? status.hls : null,
      teams: status ? status.teams : null,
      inference: status ? status.inference : null,
      calibrationPreview: status ? status.calibrationPreview : null,
      calibrationSuggestions: status ? status.calibrationSuggestions : null,
      pipeline: status ? status.pipeline : null,
      error: status ? status.error : null
    };
    syncSuggestionRound(store.source.calibrationSuggestions);
    gatePicker = false;
    // A backend source has to prove itself before the analytics desk opens;
    // the simulator has no calibration step, so it opens straight away.
    if (kind === 'simulator') { releaseGate(); } else { armGate(); }
    if (status) { applySourceTeams(status.teams); cacheSource(status); }
    renderGate();
    renderSourceMeta();
    applyConnectionState();

    await loadMatchSummary(id);
    if (generation !== store.generation) { return; }

    openSocket(id);
    startStatusPolling();
    if (status && status.hls && status.hls.ready) {
      startHls(absoluteUrl(status.hls.manifest));
    }
    // Auto-calibration success lands on `live` and drops straight into the
    // desk; anything else keeps the guided card in front of the analytics.
    if (gateArmed) { syncGate(); } else { closeDialog(); }
  }

  /** Drop every trace of the current source, including its rendered state. */
  function clearSource(options) {
    var settings = options || {};
    leaveMatch();
    closeSocket();
    detachHls();
    stopStatusPolling();
    stopDemoWatch();
    if (window.DashDemo && typeof window.DashDemo.stop === 'function') {
      try { window.DashDemo.stop(); } catch (err) { /* ignore */ }
    }
    if (window.DashDemo2 && typeof window.DashDemo2.stop === 'function') {
      try { window.DashDemo2.stop(); } catch (err) { /* ignore */ }
    }
    if (el.ogVideo) {
      try { el.ogVideo.pause(); } catch (err) { /* ignore */ }
    }
    store.demoActive = false;
    store.demo = null;
    markSynthetic(false);
    store.generation += 1;
    store.mode = 'idle';
    store.source = emptySource();
    resetStreams();
    resetTeamIdentity();
    if (!settings.keepCalibration) { resetCalibration(); }
    gatePicker = false;
    metaSignature = '';
    store.counters = newCounters();
    store.sources = store.sources || [];
    if (!settings.silent) {
      store.lastError = '';
      store.lastNotice = '';
    }
    renderSources();
    renderSourceMeta();
    renderGate();
    applyConnectionState();
  }

  async function stopCurrentSource() {
    clearDialogMessages();
    var source = store.source;
    var isDemo = store.mode === 'demo';
    if (isDemo) {
      clearSource({ silent: true });
      setNotice('Local demo stopped. Every panel is cleared.');
      return;
    }
    if (!source.sourceId && !(source.kind === 'simulator' && source.matchId)) {
      setError('There is no active backend source to stop.');
      return;
    }
    var generation = store.generation;
    await withBusy(el.stopBtn, async function () {
      setNotice('Stopping ' + (source.sourceId || source.matchId) + ' ...');
      if (source.kind === 'simulator' && source.matchId) {
        await apiFetch('/simulator/' + encodeURIComponent(source.matchId) + '/stop',
          { method: 'POST' });
      } else if (source.sourceId) {
        await apiFetch('/ingest/sources/' + encodeURIComponent(source.sourceId) + '/stop',
          { method: 'POST' });
      }
      if (generation !== store.generation) { return; }
      clearSource({ silent: true });
      setNotice('Source stopped. The dashboard is cleared.');
      refreshSources();
    }).catch(showError);
  }

  async function stopSourceById(sourceId) {
    if (!sourceId) { return; }
    var generation = store.generation;
    await withBusy(null, async function () {
      await apiFetch('/ingest/sources/' + encodeURIComponent(sourceId) + '/stop',
        { method: 'POST' });
      if (store.source.sourceId === sourceId && generation === store.generation) {
        clearSource({ silent: true });
      }
      refreshSources();
      setNotice('Stopped ' + sourceId + '.');
    }).catch(showError);
  }

  async function stopSimulatorById(matchId) {
    var id = String(matchId || '').trim();
    if (!id) { setError('A match id is required.'); return; }
    var generation = store.generation;
    await withBusy(el.simStop, async function () {
      await apiFetch('/simulator/' + encodeURIComponent(id) + '/stop', { method: 'POST' });
      if (store.source.kind === 'simulator' && store.source.matchId === id
        && generation === store.generation) {
        clearSource({ silent: true });
      }
      setNotice('Simulator ' + id + ' stopped.');
      refreshSources();
    }).catch(showError);
  }

  // ------------------------------------------------------------------- //
  // Source actions
  // ------------------------------------------------------------------- //
  function validMatchId(value) {
    return /^[A-Za-z0-9._-]{1,64}$/.test(value);
  }

  async function startSimulator() {
    clearDialogMessages();
    var matchId = String(el.simId.value || '').trim();
    if (!validMatchId(matchId)) {
      setError('Match id must be 1-64 characters: letters, digits, dot, dash or underscore.');
      return;
    }
    await withBusy(el.simStart, async function () {
      setNotice('Starting the simulator for ' + matchId + ' ...');
      var body = await apiFetch('/simulator/' + encodeURIComponent(matchId) + '/start',
        { method: 'POST' });
      var checked = CONTRACT.validateSimulatorResponse(body);
      if (!checked.ok) {
        invalid('simulator', checked.error);
        setError('The simulator response was not understood: ' + checked.error);
        return;
      }
      await connectMatch(checked.value.matchId, { kind: 'simulator' });
      setNotice('Simulator ' + checked.value.status + ' for ' + checked.value.matchId + '.');
      refreshSources();
    }).catch(showError);
  }

  // ------------------------------------------------------------------- //
  // Team identity fields on the upload and RTSP cards (Task 19)
  // ------------------------------------------------------------------- //
  // The backend normalises these again (trim, 1..64 chars, #RRGGBB uppercase),
  // so the dashboard only has to reject what could never be accepted.
  var TEAM_FORMS = [
    {
      card: 'upload',
      homeTeam: 'upHomeTeam', awayTeam: 'upAwayTeam',
      homeColor: 'upHomeColor', awayColor: 'upAwayColor',
      homeHex: 'upHomeColorHex', awayHex: 'upAwayColorHex'
    },
    {
      card: 'rtsp',
      homeTeam: 'rtspHomeTeam', awayTeam: 'rtspAwayTeam',
      homeColor: 'rtspHomeColor', awayColor: 'rtspAwayColor',
      homeHex: 'rtspHomeColorHex', awayHex: 'rtspAwayColorHex'
    }
  ];

  function teamForm(card) {
    for (var i = 0; i < TEAM_FORMS.length; i += 1) {
      if (TEAM_FORMS[i].card === card) { return TEAM_FORMS[i]; }
    }
    return null;
  }

  /** Mirror every colour input's normalised hex into its <output>. */
  function syncColorLabels() {
    TEAM_FORMS.forEach(function (form) {
      [['homeColor', 'homeHex', DEFAULT_COLORS.home],
        ['awayColor', 'awayHex', DEFAULT_COLORS.away]].forEach(function (pair) {
        var input = el[pair[0]];
        var output = el[pair[1]];
        if (!input || !output) { return; }
        output.textContent = CONTRACT.normalizeTeamColor(input.value, pair[2]);
      });
    });
  }

  /** Fill anything the markup left blank, then make the hex labels agree. */
  function applyTeamFormDefaults() {
    TEAM_FORMS.forEach(function (form) {
      [['homeTeam', DEFAULT_TEAMS.home], ['awayTeam', DEFAULT_TEAMS.away],
        ['homeColor', DEFAULT_COLORS.home], ['awayColor', DEFAULT_COLORS.away]]
        .forEach(function (pair) {
          var input = el[pair[0]];
          if (input && !input.value) { input.value = pair[1]; }
        });
    });
    syncColorLabels();
  }

  /**
   * Read one card's identity fields. Returns `{home,away,homeColor,awayColor}`
   * or null after putting a precise, actionable message in the dialog.
   */
  function readTeamForm(card) {
    var form = teamForm(card);
    if (!form) { return null; }
    var home = String(el[form.homeTeam] ? el[form.homeTeam].value : '').trim();
    var away = String(el[form.awayTeam] ? el[form.awayTeam].value : '').trim();
    if (!home || !away) {
      setError('Both team names are required before this source can start.');
      return null;
    }
    if (home.length > CONTRACT.TEAM_NAME_MAX || away.length > CONTRACT.TEAM_NAME_MAX) {
      setError('Team names are limited to ' + CONTRACT.TEAM_NAME_MAX + ' characters.');
      return null;
    }
    if (home.toLowerCase() === away.toLowerCase()) {
      setError('Home and away team names must differ.');
      return null;
    }
    var homeColor = CONTRACT.normalizeTeamColor(
      el[form.homeColor] ? el[form.homeColor].value : '', '');
    var awayColor = CONTRACT.normalizeTeamColor(
      el[form.awayColor] ? el[form.awayColor].value : '', '');
    if (!homeColor || !awayColor) {
      setError('Both team colours must be six-digit hex colours.');
      return null;
    }
    if (homeColor === awayColor) {
      setError('Home and away colours must differ so both teams stay readable.');
      return null;
    }
    return { home: home, away: away, homeColor: homeColor, awayColor: awayColor };
  }

  async function startUpload() {
    clearDialogMessages();
    var file = el.upFile && el.upFile.files ? el.upFile.files[0] : null;
    if (!file) {
      setError('Choose a video file before uploading.');
      return;
    }
    var teams = readTeamForm('upload');
    if (!teams) { return; }
    await withBusy(el.upStart, async function () {
      setNotice('Uploading ' + file.name + ' (' + Math.round(file.size / 1024) + ' KiB) ...');
      var form = new FormData();
      form.append('file', file);
      form.append('home_team', teams.home);
      form.append('away_team', teams.away);
      form.append('home_color', teams.homeColor);
      form.append('away_color', teams.awayColor);
      var body = await apiFetch('/ingest/upload', { method: 'POST', body: form });
      var checked = CONTRACT.validateSourceEnvelope(body);
      if (!checked.ok) {
        invalid('upload', checked.error);
        setError('The upload response was not understood: ' + checked.error);
        return;
      }
      var source = checked.value;
      cacheSource(source);
      await connectMatch(source.matchId, {
        kind: source.kind,
        sourceId: source.sourceId,
        status: source
      });
      setNotice('Upload accepted as ' + source.sourceId + ' (' + source.state + ').');
    }).catch(showError);
  }

  async function startRtsp() {
    clearDialogMessages();
    var url = String(el.rtspUrl.value || '').trim();
    if (!/^rtsps?:\/\/[^\s]+$/i.test(url)) {
      setError('RTSP URL must start with rtsp:// or rtsps://.');
      return;
    }
    var teams = readTeamForm('rtsp');
    if (!teams) { return; }
    await withBusy(el.rtspStart, async function () {
      setNotice('Asking the backend to connect the camera ...');
      var body = await apiFetch('/ingest/rtsp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: url,
          homeTeam: teams.home,
          awayTeam: teams.away,
          homeColor: teams.homeColor,
          awayColor: teams.awayColor
        })
      });
      var checked = CONTRACT.validateSourceEnvelope(body);
      if (!checked.ok) {
        invalid('rtsp', checked.error);
        setError('The RTSP response was not understood: ' + checked.error);
        return;
      }
      var source = checked.value;
      cacheSource(source);
      await connectMatch(source.matchId, {
        kind: source.kind,
        sourceId: source.sourceId,
        status: source
      });
      setNotice('Camera accepted as ' + source.sourceId + ' (' + source.state + ').');
    }).catch(showError);
  }

  // ------------------------------------------------------------------- //
  // Explicit opt-in local demo (no network, no backend values)
  // ------------------------------------------------------------------- //
  // The generator ticks every 100 ms; this is the longest silence that still
  // reads as "the demo is running" before the watchdog rescues it.
  var DEMO_STALL_MS = 2500;
  var demoWatchTimer = null;

  /** Mark every screen that is showing demo or dataset data. */
  function markSynthetic(active) {
    if (document.body) {
      if (active) {
        var modeAttr = (store.source && store.source.kind === 'demo2') ? 'dataset' : 'synthetic';
        document.body.setAttribute('data-demo', modeAttr);
      } else {
        document.body.removeAttribute('data-demo');
      }
    }
    // The feed header claims "LIVE" in every mode; a demo must not.
    var badge = document.querySelector('#feed .live');
    if (badge) {
      if (!active) {
        badge.textContent = 'LIVE';
        badge.classList.remove('synth');
      } else if (store.source && store.source.kind === 'demo2') {
        badge.textContent = 'DATASET';
        badge.classList.add('synth');
      } else {
        badge.textContent = 'SYNTHETIC';
        badge.classList.add('synth');
      }
    }
  }

  function stopDemoWatch() {
    if (demoWatchTimer === null) { return; }
    window.clearInterval(demoWatchTimer);
    demoWatchTimer = null;
  }

  /**
   * A generator that quietly stops is indistinguishable from a broken
   * dashboard, so the watchdog restarts it once per session and only reports a
   * failure after that. Hidden tabs throttle timers to the point of silence,
   * so a hidden page is never judged.
   */
  function watchDemo(generation, retried) {
    stopDemoWatch();
    var misses = 0;
    demoWatchTimer = window.setInterval(function () {
      if (generation !== store.generation || !store.demoActive) { stopDemoWatch(); return; }
      if (document.visibilityState === 'hidden') { misses = 0; return; }
      var demo = store.demo;
      var isDemo2 = store.source && store.source.kind === 'demo2';
      var runner = isDemo2 ? window.DashDemo2 : window.DashDemo;
      var alive = !!demo && !!runner && runner.isRunning()
        && nowMs() - demo.lastMessageAt <= DEMO_STALL_MS;
      if (alive) { misses = 0; return; }
      misses += 1;
      if (misses < 2) { return; }
      stopDemoWatch();
      if (retried) {
        setError('The local demo stopped producing data. Run it again to restart.');
        return;
      }
      if (isDemo2) {
        launchDatasetDemo(store.demoScene || 'all', true);
      } else {
        launchDemo(true);
      }
    }, 1200);
  }

  function launchDemo(isRetry) {
    if (!window.DashDemo || typeof window.DashDemo.start !== 'function') {
      setError('The local demo module did not load.');
      return;
    }
    var restarts = isRetry && store.demo ? store.demo.restarts + 1 : 0;
    if (!isRetry) { clearDialogMessages(); }
    clearSource({ silent: true });

    var generation = store.generation;
    store.mode = 'demo';
    store.demoActive = true;
    store.source = {
      kind: 'demo',
      sourceId: null,
      matchId: DEMO_MATCH_ID,
      state: 'live',
      status: null,
      hls: null,
      teams: null,
      inference: null,
      calibrationPreview: null,
      pipeline: null,
      error: null
    };
    // A demo has no snapshot round-trip: its first frame is the snapshot, so
    // live messages must be applied immediately instead of being queued.
    store.snapshotReceived = true;
    store.matchStatus = 'live';
    store.demo = {
      startedAt: nowMs(),
      lastMessageAt: nowMs(),
      messages: 0,
      failures: 0,
      restarts: restarts
    };
    markSynthetic(true);

    var started = false;
    try {
      started = window.DashDemo.start({
        matchId: DEMO_MATCH_ID,
        homeTeam: DEMO_TEAMS.home,
        awayTeam: DEMO_TEAMS.away,
        colors: { home: DEFAULT_COLORS.home, away: DEFAULT_COLORS.away },
        onMatch: function (summary) {
          if (generation !== store.generation) { return; }
          var checked = CONTRACT.validateMatchSummary(summary);
          if (!checked.ok) { invalid('demo', checked.error); return; }
          applyTeamIdentity(checked.value);
          store.matchStatus = checked.value.status;
          store.dirty.stats = true;
          store.dirty.highlights = true;
        },
        // Same entry point as a socket message: identical validation, ordering
        // and counters, so the demo cannot take a private render path.
        onMessage: function (stream, payload) {
          if (generation !== store.generation) { return; }
          if (store.demo) {
            store.demo.messages += 1;
            store.demo.lastMessageAt = nowMs();
          }
          routeLive(stream, payload);
        },
        onError: function (error) {
          if (generation !== store.generation) { return; }
          bump('errors');
          if (store.demo) { store.demo.failures += 1; }
          store.lastError = 'demo: '
            + String(error && error.message ? error.message : error).slice(0, 200);
        },
        onEnded: function () {
          if (generation !== store.generation) { return; }
          store.matchStatus = 'finished';
          store.dirty.stats = true;
        }
      }) === true;
    } catch (error) {
      // A generator that throws on kickoff must not leave the desk hanging in
      // demo mode with nothing driving it.
      bump('errors');
      store.lastError = 'demo: '
        + String(error && error.message ? error.message : error).slice(0, 200);
      started = false;
    }

    if (!started) {
      setError('The local demo could not start.');
      clearSource({ silent: true });
      return;
    }
    applyConnectionState();
    releaseGate();
    closeDialog();
    setNotice(isRetry
      ? 'Local demo restarted after a stall. Synthetic data, never live.'
      : 'Local demo running: synthetic data, never live.');
    watchDemo(generation, isRetry === true);
  }

  function startLocalDemo() {
    launchDemo(false);
  }

  function launchDatasetDemo(scene, isRetry) {
    if (!window.DashDemo2 || typeof window.DashDemo2.start !== 'function') {
      setError('The match dataset demo module did not load.');
      return;
    }
    var restarts = isRetry && store.demo ? store.demo.restarts + 1 : 0;
    if (!isRetry) { clearDialogMessages(); }
    clearSource({ silent: true });

    var generation = store.generation;
    store.mode = 'demo';
    store.demoActive = true;
    store.demoScene = scene || 'all';
    store.source = {
      kind: 'demo2',
      sourceId: null,
      matchId: 'dataset-1886347',
      state: 'live',
      status: null,
      hls: null,
      teams: null,
      inference: null,
      calibrationPreview: null,
      pipeline: null,
      error: null
    };
    store.snapshotReceived = true;
    store.matchStatus = 'live';
    store.demo = {
      startedAt: nowMs(),
      lastMessageAt: nowMs(),
      messages: 0,
      failures: 0,
      restarts: restarts
    };
    markSynthetic(true);

    var started = false;
    try {
      started = window.DashDemo2.start({
        matchId: 'dataset-1886347',
        scene: scene || 'all',
        onMatch: function (summary) {
          if (generation !== store.generation) { return; }
          var checked = CONTRACT.validateMatchSummary(summary);
          if (!checked.ok) { invalid('demo2', checked.error); return; }
          applyTeamIdentity(checked.value);
          store.matchStatus = checked.value.status;
          store.dirty.stats = true;
          store.dirty.highlights = true;
        },
        onMessage: function (stream, payload) {
          if (generation !== store.generation) { return; }
          if (store.demo) {
            store.demo.messages += 1;
            store.demo.lastMessageAt = nowMs();
          }
          routeLive(stream, payload);
        },
        onError: function (error) {
          if (generation !== store.generation) { return; }
          bump('errors');
          if (store.demo) { store.demo.failures += 1; }
          store.lastError = 'demo2: '
            + String(error && error.message ? error.message : error).slice(0, 200);
        },
        onEnded: function () {
          if (generation !== store.generation) { return; }
          store.matchStatus = 'finished';
          store.dirty.stats = true;
        }
      }) === true;
    } catch (error) {
      bump('errors');
      store.lastError = 'demo2: '
        + String(error && error.message ? error.message : error).slice(0, 200);
      started = false;
    }

    if (!started) {
      setError('The match dataset replay could not start.');
      clearSource({ silent: true });
      return;
    }
    applyConnectionState();
    releaseGate();
    closeDialog();

    // Synchronize OG broadcast video with dataset moment
    if (el.ogVideo) {
      try {
        var videoStartTime = 281;
        if (scene === 'shot') { videoStartTime = 424; }
        else if (scene === 'goal') { videoStartTime = 6490; }
        else if (scene === 'intro') { videoStartTime = 0; }
        el.ogVideo.currentTime = videoStartTime;
        el.ogVideo.play().catch(function () { /* user gesture required for sound */ });
      } catch (videoErr) { /* ignore */ }
    }

    setNotice(isRetry
      ? 'Match dataset demo restarted after a stall.'
      : 'Replaying match dataset: Auckland FC vs Newcastle (AUS A-League).');
    watchDemo(generation, isRetry === true);
  }

  function startDatasetDemo(scene) {
    launchDatasetDemo(scene || 'all', false);
  }

  // ------------------------------------------------------------------- //
  // Connection pill and source dialog
  // ------------------------------------------------------------------- //
  function applyConnectionState() {
    var text = 'offline';
    var dotClass = 'dot';
    var live = false;

    if (store.mode === 'demo') {
      if (store.source && store.source.kind === 'demo2') {
        text = 'Auckland FC vs Newcastle \u00b7 CSV dataset';
        dotClass = 'dot ok';
      } else {
        text = 'local demo \u00b7 synthetic';
        dotClass = 'dot demo';
      }
      live = true;
    } else if (store.mode === 'connected' && store.source.matchId) {
      var kind = store.source.kind || 'source';
      var state = store.source.state
        || (store.socketState === 'connected' ? 'live' : 'starting');
      text = kind + ' \u00b7 ' + store.source.matchId + ' \u00b7 '
        + state.replace(/_/g, ' ');
      live = true;
      if (state === 'failed' || store.socketState === 'error') {
        dotClass = 'dot bad';
      } else if (state === 'needs_calibration') {
        dotClass = 'dot warn';
      } else if (state === 'ended' || state === 'stopped') {
        dotClass = 'dot';
      } else if (store.snapshotReceived) {
        dotClass = 'dot ok';
      } else {
        dotClass = 'dot warn';
      }
    } else if (store.backend === 'online') {
      text = 'backend online \u00b7 no source';
      dotClass = 'dot ok';
    } else if (store.backend === 'offline') {
      text = 'backend unreachable';
      dotClass = 'dot bad';
    } else if (store.backend === 'incompatible') {
      text = 'backend incompatible';
      dotClass = 'dot bad';
    }

    if (el.connDot) { el.connDot.className = dotClass; }
    setText(el.connTxt, text);
    if (el.srcCtl) { el.srcCtl.classList.toggle('live', live); }
    if (el.srcBtn) { el.srcBtn.classList.toggle('on', store.mode !== 'idle'); }
    if (el.stopBtn) {
      el.stopBtn.disabled = !(store.mode === 'demo'
        || (store.source.kind === 'simulator' && store.source.matchId)
        || store.source.sourceId);
    }
    if (el.gateDot) { el.gateDot.className = dotClass; }
  }

  // The first screen is a mandatory source picker. `gateArmed` stays true until
  // a source has actually been selected, so the dialog cannot be dismissed
  // while the analytics desk is still empty.
  var gateArmed = false;
  //: The gate's "change source" escape hatch. The source list is shown while
  //: the current source keeps running; the analytics desk stays locked.
  var gatePicker = false;

  function armGate() {
    gateArmed = true;
    if (document.body) { document.body.classList.add('source-gate'); }
    if (el.dlgClose) { el.dlgClose.hidden = true; }
  }

  function releaseGate() {
    if (!gateArmed) { return; }
    gateArmed = false;
    if (document.body) { document.body.classList.remove('source-gate'); }
    if (el.dlgClose) { el.dlgClose.hidden = false; }
  }

  function gateBlocked() {
    return gateArmed;
  }

  /**
   * Show the source list again without dropping the running source. Points
   * already placed are kept, so coming back to the same source resumes the
   * calibration instead of starting over.
   */
  function backToSourcePicker() {
    gatePicker = true;
    setText(el.calibErr, '');
    store.calibration.error = '';
    renderGate();
    refreshSources();
  }

  function openDialog(isGate) {
    if (!el.srcDlg) { return; }
    var gate = isGate === true;
    if (gate) { armGate(); }
    if (el.dlgClose) { el.dlgClose.hidden = gate || gateArmed; }
    if (el.apiBase && !el.apiBase.value) { el.apiBase.value = store.apiBase; }
    if (el.apiKey) { el.apiKey.value = store.apiKey; }
    if (typeof el.srcDlg.showModal === 'function' && !el.srcDlg.open) {
      el.srcDlg.showModal();
    } else if (!el.srcDlg.open) {
      el.srcDlg.setAttribute('open', '');
    }
    if (!gate) {
      refreshSources();
      if (store.backend !== 'online') { checkHealth({ manual: true }); }
    }
  }

  function closeDialog() {
    if (!el.srcDlg || !el.srcDlg.open) { return; }
    if (gateBlocked()) { return; }
    if (typeof el.srcDlg.close === 'function') { el.srcDlg.close(); }
    else { el.srcDlg.removeAttribute('open'); }
  }

  function wireUi() {
    if (el.srcBtn) {
      el.srcBtn.addEventListener('click', function () { openDialog(false); });
    }
    if (el.dlgClose) { el.dlgClose.addEventListener('click', closeDialog); }
    if (el.healthBtn) {
      el.healthBtn.addEventListener('click', function () { checkHealth({ manual: true }); });
    }
    if (el.stopBtn) {
      el.stopBtn.addEventListener('click', function () { stopCurrentSource(); });
    }
    if (el.simStart) { el.simStart.addEventListener('click', startSimulator); }
    if (el.simStop) {
      el.simStop.addEventListener('click', function () { stopSimulatorById(el.simId.value); });
    }
    if (el.upStart) { el.upStart.addEventListener('click', startUpload); }
    if (el.rtspStart) { el.rtspStart.addEventListener('click', startRtsp); }
    if (el.demoStart) { el.demoStart.addEventListener('click', startLocalDemo); }
    if (el.demo2Start) {
      el.demo2Start.addEventListener('click', function () {
        var sc = el.demo2Scene ? el.demo2Scene.value : 'all';
        startDatasetDemo(sc);
      });
    }

    // Dual Viewport Mode Toggles
    function setViewportMode(mode) {
      if (!el.stageSplit) { return; }
      el.stageSplit.classList.remove('split-5050', 'split-og-only', 'split-3d-only');
      if (mode === 'og') {
        el.stageSplit.classList.add('split-og-only');
      } else if (mode === '3d') {
        el.stageSplit.classList.add('split-3d-only');
      } else {
        el.stageSplit.classList.add('split-5050');
      }
      if (el.btnSideBySide) { el.btnSideBySide.classList.toggle('on', mode === 'split'); }
      if (el.btnOgVideo) { el.btnOgVideo.classList.toggle('on', mode === 'og'); }
      if (el.btn3dPitch) { el.btn3dPitch.classList.toggle('on', mode === '3d'); }
      window.setTimeout(resizeStage, 60);
    }

    if (el.btnSideBySide) { el.btnSideBySide.addEventListener('click', function () { setViewportMode('split'); }); }
    if (el.btnOgVideo) { el.btnOgVideo.addEventListener('click', function () { setViewportMode('og'); }); }
    if (el.btn3dPitch) { el.btn3dPitch.addEventListener('click', function () { setViewportMode('3d'); }); }

    // Right Card Tabs
    var tabButtons = document.querySelectorAll('.tab-pill-row .tab-pill');
    Array.prototype.forEach.call(tabButtons, function (btn) {
      btn.addEventListener('click', function () {
        var targetId = btn.getAttribute('data-target');
        Array.prototype.forEach.call(tabButtons, function (b) { b.classList.remove('on'); });
        btn.classList.add('on');
        var panes = document.querySelectorAll('.tab-content-area .tab-pane');
        Array.prototype.forEach.call(panes, function (p) {
          p.classList.toggle('on', p.id === targetId);
        });
      });
    });

    // Watch Replay CTA Button
    if (el.btnWatchReplay) {
      el.btnWatchReplay.addEventListener('click', function () {
        startDatasetDemo('goal');
      });
    }

    // Quick Moment Jump Buttons
    if (el.jumpKickoff) {
      el.jumpKickoff.addEventListener('click', function () {
        if (window.DashDemo2 && typeof window.DashDemo2.seekToVideoTime === 'function' && window.DashDemo2.isRunning()) {
          if (el.ogVideo) { el.ogVideo.currentTime = 281.0; }
          window.DashDemo2.seekToVideoTime(281.0);
        } else {
          startDatasetDemo('kickoff');
        }
      });
    }

    if (el.jumpMataGoal) {
      el.jumpMataGoal.addEventListener('click', function () {
        if (window.DashDemo2 && typeof window.DashDemo2.seekToVideoTime === 'function' && window.DashDemo2.isRunning()) {
          if (el.ogVideo) { el.ogVideo.currentTime = 6490.0; }
          window.DashDemo2.seekToVideoTime(6490.0);
        } else {
          startDatasetDemo('goal');
        }
        generateGeminiCommentary();
      });
    }

    if (el.jumpIntro) {
      el.jumpIntro.addEventListener('click', function () {
        if (window.DashDemo2 && typeof window.DashDemo2.seekToVideoTime === 'function' && window.DashDemo2.isRunning()) {
          if (el.ogVideo) { el.ogVideo.currentTime = 0.0; }
          window.DashDemo2.seekToVideoTime(0.0);
        } else {
          startDatasetDemo('intro');
        }
      });
    }

    function getTargetHighlightTime() {
      if (el.socialEventSelect && el.socialEventSelect.value !== 'current') {
        return parseFloat(el.socialEventSelect.value) || 6490.0;
      }
      if (el.ogVideo && el.ogVideo.currentTime > 10.0) {
        return el.ogVideo.currentTime;
      }
      return 6490.0;
    }

    async function openSocialHighlights() {
      if (!el.socialDlg) { return; }
      if (typeof el.socialDlg.showModal === 'function') {
        el.socialDlg.showModal();
      } else {
        el.socialDlg.setAttribute('open', '');
      }

      if (el.ogVideo && el.socialEventSelect) {
        var cur = el.ogVideo.currentTime;
        if (cur > 6000) { el.socialEventSelect.value = '6490'; }
        else if (cur > 5000) { el.socialEventSelect.value = '5421'; }
        else if (cur > 200 && cur < 600) { el.socialEventSelect.value = '281'; }
        else if (cur > 10) { el.socialEventSelect.value = 'current'; }
      }

      var matchId = store.source.matchId || 'live';
      var data = null;
      try {
        var res = await apiFetch('/matches/' + encodeURIComponent(matchId) + '/highlights');
        if (res && res.highlights && res.highlights.length) {
          data = res.highlights[0];
        } else {
          if (el.socialHeadline) { el.socialHeadline.textContent = '✨ Slicing Exact Event + Generating AI Music & Captions...'; }
          var gen = await apiFetch('/matches/' + encodeURIComponent(matchId) + '/highlights/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              mediaTime: getTargetHighlightTime(),
              eventType: 'goal',
              ballSpeed: 86.3,
              xg: 0.38,
              playerId: '10',
              playerName: 'Max Mata',
              homeTeam: store.teams.home || 'Auckland FC',
              awayTeam: store.teams.away || 'Newcastle Jets'
            })
          });
          if (gen && gen.headline) { data = gen; }
        }
      } catch (e) {}

      if (!data) {
        data = {
          headline: "UNSTOPPABLE! 🚀 Max Mata 86.3 km/h Rocket for Auckland FC!",
          caption: "STOP THAT! 🔥 Max Mata turns on the jets and blasts a venomous 86.3 km/h strike past the keeper! 🤯 Clocked from a tight angle with 0.38 xG. What a moment for Auckland FC! ⚽⚡ #ALeague #Golazo #PureStrike #FootballReels",
          tacticalBreakdown: "Auckland FC exploited Newcastle's high defensive line with rapid vertical progression, allowing Mata to isolate the center-back and strike with 86.3 km/h velocity into the side netting.",
          hashtags: ["#Golazo", "#PureStrike", "#FootballReels", "#ViralGoal", "#AucklandFC", "#ALeague"],
          clipUrl: "/highlights/test_mata_goal.mp4"
        };
      }

      if (el.socialHeadline) { el.socialHeadline.textContent = data.headline; }
      if (el.socialCaption) { el.socialCaption.value = data.caption; }
      if (el.socialTactical) { el.socialTactical.textContent = data.tacticalBreakdown; }
      if (el.socialPosterImg) {
        if (data.posterUrl) {
          el.socialPosterImg.src = data.posterUrl;
          el.socialPosterImg.style.display = 'block';
        } else {
          el.socialPosterImg.style.display = 'none';
        }
      }
      if (el.socialClipVideo && data.clipUrl) {
        el.socialClipVideo.src = data.clipUrl;
      }
      if (el.socialDownloadBtn && data.clipUrl) {
        el.socialDownloadBtn.href = data.clipUrl;
      }
      if (el.socialTags && data.hashtags) {
        clearNode(el.socialTags);
        data.hashtags.forEach(function (tag) {
          el.socialTags.appendChild(make('span', 'tag-pill', tag));
        });
      }
    }

    if (el.socialEventSelect) {
      el.socialEventSelect.addEventListener('change', function () {
        if (el.socialRegenerateBtn) { el.socialRegenerateBtn.click(); }
      });
    }

    if (el.btnSocialHighlights) {
      el.btnSocialHighlights.addEventListener('click', openSocialHighlights);
    }
    if (el.socialRegenerateBtn) {
      el.socialRegenerateBtn.addEventListener('click', async function () {
        el.socialRegenerateBtn.disabled = true;
        el.socialRegenerateBtn.textContent = '✨ Slicing Exact Event + AI Soundtrack (Gemini)...';
        var matchId = store.source.matchId || 'live';
        var targetTime = getTargetHighlightTime();
        var hName = store.teams.home || 'Auckland FC';
        var aName = store.teams.away || 'Newcastle Jets';
        var evType = (targetTime === 281 ? 'kickoff' : (targetTime === 1959 ? 'counter_attack' : (targetTime === 4286 ? 'shot' : 'goal')));
        var pName = (targetTime === 6490 ? 'Max Mata' : (targetTime === 1959 ? 'F. Gallegos' : (targetTime === 4286 ? 'L. Gillion' : hName)));
        var spd = (targetTime === 6490 ? 86.3 : (targetTime === 5421 ? 74.0 : (targetTime === 4286 ? 78.5 : 52.0)));
        var xgVal = (targetTime === 6490 ? 0.38 : (targetTime === 5421 ? 0.42 : 0.15));
        var descVal = (targetTime === 281 ? 'Referee blows whistle for 1st half kickoff with immediate high-press blitz' : (targetTime === 6490 ? 'Max Mata scores an 86.3 km/h rocket into the top corner' : 'Exciting match moment'));
        try {
          var res = await apiFetch('/matches/' + encodeURIComponent(matchId) + '/highlights/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              mediaTime: targetTime,
              eventType: evType,
              ballSpeed: spd,
              xg: xgVal,
              playerId: '10',
              playerName: pName,
              description: descVal,
              homeTeam: hName,
              awayTeam: aName
            })
          });
          if (res && res.headline) {
            if (el.socialHeadline) { el.socialHeadline.textContent = res.headline; }
            if (el.socialCaption) { el.socialCaption.value = res.caption; }
            if (el.socialTactical) { el.socialTactical.textContent = res.tacticalBreakdown; }
            if (el.socialPosterImg && res.posterUrl) {
              el.socialPosterImg.src = res.posterUrl;
              el.socialPosterImg.style.display = 'block';
            }
            if (el.socialTags && res.hashtags) {
              clearNode(el.socialTags);
              res.hashtags.forEach(function (tag) {
                el.socialTags.appendChild(make('span', 'tag-pill', tag));
              });
            }
            if (el.socialClipVideo && res.clipUrl) {
              el.socialClipVideo.src = res.clipUrl;
              el.socialClipVideo.load();
              el.socialClipVideo.play().catch(function () {});
            }
          }
        } catch (e) {
          console.warn('Highlights generate error:', e);
        } finally {
          el.socialRegenerateBtn.disabled = false;
          el.socialRegenerateBtn.textContent = '✨ Re-Generate with Gemini AI';
        }
      });
    }
    if (el.socialDlgClose && el.socialDlg) {
      el.socialDlgClose.addEventListener('click', function () {
        if (typeof el.socialDlg.close === 'function') {
          el.socialDlg.close();
        } else {
          el.socialDlg.removeAttribute('open');
        }
      });
    }
    if (el.socialCopyCaption && el.socialCaption) {
      el.socialCopyCaption.addEventListener('click', function () {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(el.socialCaption.value).then(function () {
            var orig = el.socialCopyCaption.textContent;
            el.socialCopyCaption.textContent = '✓ Copied!';
            setTimeout(function () { el.socialCopyCaption.textContent = orig; }, 2000);
          });
        } else {
          el.socialCaption.select();
          document.execCommand('copy');
          var orig = el.socialCopyCaption.textContent;
          el.socialCopyCaption.textContent = '✓ Copied!';
          setTimeout(function () { el.socialCopyCaption.textContent = orig; }, 2000);
        }
      });
    }

    // ----------------------------------------------------------------- //
    // Feature 8: Deep Tactical Reasoning & Historical Facts
    // ----------------------------------------------------------------- //
    async function openReasoningDialog() {
      if (!el.reasoningDlg) { return; }
      if (typeof el.reasoningDlg.showModal === 'function') {
        el.reasoningDlg.showModal();
      } else {
        el.reasoningDlg.setAttribute('open', '');
      }

      if (el.reasoningSummary) { el.reasoningSummary.textContent = '🧠 Analyzing tactical structure with Gemini 3.8 Flash...'; }
      try {
        var hName = store.teams.home || 'Auckland FC';
        var aName = store.teams.away || 'Newcastle Jets';
        var res = await apiFetch('/reasoning/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            matchId: store.source.matchId || 'live',
            type: 'goal',
            player: '#10 Max Mata',
            speed: 86.0,
            xg: 0.38,
            minute: 88,
            score: hName + ' ' + (store.score.home || 2) + '-' + (store.score.away || 0) + ' ' + aName,
            team: 'home',
            homeTeam: hName,
            awayTeam: aName
          })
        });
        if (res && res.summary) {
          if (el.reasoningSummary) { el.reasoningSummary.textContent = res.summary; }
          if (el.reasoningSpatial) { el.reasoningSpatial.textContent = res.spatialReasoning; }
          if (el.reasoningCounter) { el.reasoningCounter.textContent = res.counterfactual; }
          if (el.reasoningAdjustment) { el.reasoningAdjustment.textContent = res.tacticalAdjustment; }
          if (el.reasoningRating) { el.reasoningRating.textContent = res.analyticsRating + ' EXECUTION'; }
          if (el.reasoningFacts && res.historicalFacts) {
            clearNode(el.reasoningFacts);
            res.historicalFacts.forEach(function (fact) {
              el.reasoningFacts.appendChild(make('li', null, fact));
            });
          }
        }
      } catch (e) {
        console.warn('Reasoning error:', e);
      }
    }

    if (el.btnReasoning) { el.btnReasoning.addEventListener('click', openReasoningDialog); }
    if (el.reasoningReanalyzeBtn) { el.reasoningReanalyzeBtn.addEventListener('click', openReasoningDialog); }
    if (el.reasoningDlgClose && el.reasoningDlg) {
      el.reasoningDlgClose.addEventListener('click', function () {
        if (typeof el.reasoningDlg.close === 'function') { el.reasoningDlg.close(); }
        else { el.reasoningDlg.removeAttribute('open'); }
      });
    }

    // ----------------------------------------------------------------- //
    // Feature 9: Viral Football Meme Studio
    // ----------------------------------------------------------------- //
    async function openMemeDialog() {
      if (!el.memeDlg) { return; }
      if (typeof el.memeDlg.showModal === 'function') {
        el.memeDlg.showModal();
      } else {
        el.memeDlg.setAttribute('open', '');
      }

      if (el.memeHeadline) { el.memeHeadline.textContent = 'Generating viral meme with Gemini AI...'; }
      try {
        var hName = store.teams.home || 'Auckland FC';
        var aName = store.teams.away || 'Newcastle Jets';
        var res = await apiFetch('/meme/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            matchId: store.source.matchId || 'live',
            type: 'goal',
            player: '#10 Max Mata',
            speed: 86.0,
            minute: 88,
            score: hName + ' ' + (store.score.home || 2) + '-' + (store.score.away || 0) + ' ' + aName,
            team: 'home',
            homeTeam: hName,
            awayTeam: aName
          })
        });
        if (res && res.topText) {
          if (el.memeTopText) { el.memeTopText.textContent = res.topText; }
          if (el.memeBottomText) { el.memeBottomText.textContent = res.bottomText; }
          if (el.memeHeadline) { el.memeHeadline.textContent = res.headline; }
          if (el.memeCaption) { el.memeCaption.value = res.caption; }
          if (el.memeImg && res.imageUrl) { el.memeImg.src = res.imageUrl; }
        }
      } catch (e) {
        console.warn('Meme error:', e);
      }
    }

    if (el.btnMeme) { el.btnMeme.addEventListener('click', openMemeDialog); }
    if (el.memeRegenerateBtn) { el.memeRegenerateBtn.addEventListener('click', openMemeDialog); }
    if (el.memeDlgClose && el.memeDlg) {
      el.memeDlgClose.addEventListener('click', function () {
        if (typeof el.memeDlg.close === 'function') { el.memeDlg.close(); }
        else { el.memeDlg.removeAttribute('open'); }
      });
    }
    if (el.memeCopyCaptionBtn && el.memeCaption) {
      el.memeCopyCaptionBtn.addEventListener('click', function () {
        if (navigator.clipboard) {
          navigator.clipboard.writeText(el.memeCaption.value).then(function () {
            el.memeCopyCaptionBtn.textContent = '✓ Copied!';
            setTimeout(function () { el.memeCopyCaptionBtn.textContent = '📋 Copy Caption'; }, 2000);
          });
        }
      });
    }

    // ----------------------------------------------------------------- //
    // Feature 11: Automated First Half Video Summary & Halftime Show
    // ----------------------------------------------------------------- //
    var currentHalftimeAudio = null;
    async function openHalftimeDialog() {
      if (!el.halftimeDlg) { return; }
      if (typeof el.halftimeDlg.showModal === 'function') {
        el.halftimeDlg.showModal();
      } else {
        el.halftimeDlg.setAttribute('open', '');
      }

      var matchId = store.source.matchId || 'live';
      try {
        var hName = store.teams.home || 'Auckland FC';
        var aName = store.teams.away || 'Newcastle Jets';
        var res = await apiFetch('/matches/' + encodeURIComponent(matchId) + '/first-half-summary?home=' + encodeURIComponent(hName) + '&away=' + encodeURIComponent(aName));
        if (res && res.title) {
          if (el.halftimeTitle) { el.halftimeTitle.textContent = res.title; }
          if (el.halftimeOverview) { el.halftimeOverview.textContent = res.tacticalOverview; }
          if (el.halftimeVideo && res.videoUrl) { el.halftimeVideo.src = res.videoUrl; }
          if (el.halftimeMoments && res.keyMoments) {
            clearNode(el.halftimeMoments);
            res.keyMoments.forEach(function (m) {
              el.halftimeMoments.appendChild(make('li', null, m.minute + ' - ' + m.event + ': ' + m.description));
            });
          }
          if (el.halftimeKeys && res.secondHalfKeys) {
            clearNode(el.halftimeKeys);
            res.secondHalfKeys.forEach(function (k) {
              el.halftimeKeys.appendChild(make('li', null, k));
            });
          }
          if (el.halftimePlayVoiceBtn) {
            el.halftimePlayVoiceBtn.onclick = function () {
              if (currentHalftimeAudio) { currentHalftimeAudio.pause(); }
              if (res.voiceoverUrl) {
                currentHalftimeAudio = new Audio(res.voiceoverUrl);
                currentHalftimeAudio.play().catch(function () {});
              }
            };
            if (res.voiceoverUrl) {
              if (currentHalftimeAudio) { currentHalftimeAudio.pause(); }
              currentHalftimeAudio = new Audio(res.voiceoverUrl);
              currentHalftimeAudio.play().catch(function () {});
            }
          }
        }
      } catch (e) {
        console.warn('Halftime summary error:', e);
      }
    }

    if (el.btnHalftimeSummary) { el.btnHalftimeSummary.addEventListener('click', openHalftimeDialog); }
    if (el.halftimeRefreshBtn) { el.halftimeRefreshBtn.addEventListener('click', openHalftimeDialog); }
    if (el.halftimeDlgClose && el.halftimeDlg) {
      el.halftimeDlgClose.addEventListener('click', function () {
        if (currentHalftimeAudio) { currentHalftimeAudio.pause(); }
        if (typeof el.halftimeDlg.close === 'function') { el.halftimeDlg.close(); }
        else { el.halftimeDlg.removeAttribute('open'); }
      });
    }

    // Manual video scrubber listener: sync 3D twin when user scrubs video bar
    if (el.ogVideo) {
      el.ogVideo.addEventListener('seeked', function () {
        if (window.DashDemo2 && typeof window.DashDemo2.seekToVideoTime === 'function' && window.DashDemo2.isRunning()) {
          window.DashDemo2.seekToVideoTime(el.ogVideo.currentTime);
        }
      });
    }

    // Top Nav Feature Dialogs & Actions
    function openFeatureModal(dialogId) {
      var dlg = document.getElementById(dialogId);
      if (!dlg) { return; }
      if (typeof dlg.showModal === 'function') { dlg.showModal(); }
      else { dlg.setAttribute('open', ''); }
    }

    var navRoom = document.getElementById('navRoom');
    var navSettings = document.getElementById('navSettings');
    var navAnalytics = document.getElementById('navAnalytics');
    var navStandings = document.getElementById('navStandings');
    var navMomentum = document.getElementById('navMomentum');
    var navFixtures = document.getElementById('navFixtures');
    var navLiveBadge = document.getElementById('navLiveBadge');

    if (navSettings) { navSettings.addEventListener('click', function () { openFeatureModal('settingsDlg'); }); }
    if (navAnalytics) { navAnalytics.addEventListener('click', function () { openFeatureModal('analyticsDlg'); }); }
    if (navMomentum) { navMomentum.addEventListener('click', function () { openFeatureModal('momentumDlg'); }); }
    if (navFixtures) { navFixtures.addEventListener('click', function () { openFeatureModal('fixturesDlg'); }); }

    if (navStandings) {
      navStandings.addEventListener('click', function () {
        var stCard = document.getElementById('standingCard');
        if (stCard) {
          stCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
          stCard.classList.add('highlight');
          window.setTimeout(function () { stCard.classList.remove('highlight'); }, 2000);
        }
      });
    }

    if (navRoom) {
      navRoom.addEventListener('click', function () {
        var sidebar = document.querySelector('.sidebar-col');
        if (sidebar) { sidebar.scrollTo({ top: 0, behavior: 'smooth' }); }
        setViewportMode('split');
      });
    }

    if (navLiveBadge) {
      navLiveBadge.addEventListener('click', function () {
        openDialog(false);
      });
    }

    // Team identity: keep every hex label in sync with its colour picker.
    TEAM_FORMS.forEach(function (form) {
      [form.homeColor, form.awayColor].forEach(function (id) {
        if (el[id]) { el[id].addEventListener('input', syncColorLabels); }
      });
    });

    // Guided calibration: one named landmark per click, no duplicates.
    if (el.calibImg) {
      el.calibImg.addEventListener('click', function (event) {
        addCalibrationPoint(event.clientX, event.clientY);
      });
    }
    if (el.calibUndo) { el.calibUndo.addEventListener('click', undoCalibrationPoint); }
    if (el.calibReset) { el.calibReset.addEventListener('click', clearCalibrationPoints); }
    if (el.calibSubmit) { el.calibSubmit.addEventListener('click', submitCalibration); }
    if (el.calibPreviewBtn) {
      el.calibPreviewBtn.addEventListener('click', function () {
        loadCalibrationPreview(true);
      });
    }
    if (el.calibLandmark) {
      el.calibLandmark.addEventListener('change', function () { setCalibError(''); });
    }
    if (el.calibBack) { el.calibBack.addEventListener('click', backToSourcePicker); }
    if (el.calibSuggestBack) {
      el.calibSuggestBack.addEventListener('click', backToSourcePicker);
    }
    if (el.calibAccept) {
      el.calibAccept.addEventListener('click', acceptCalibrationSuggestion);
    }
    if (el.calibRetry) {
      el.calibRetry.addEventListener('click', retryCalibrationSuggestion);
    }
    if (el.calibManual) {
      el.calibManual.addEventListener('click', useManualCalibration);
    }
    // Skip to match footage: a time input and one scan, always available.
    if (el.calibSeekScan) {
      el.calibSeekScan.addEventListener('click', function () { scanCalibrationSeek(); });
    }
    if (el.calibSeekTime) {
      el.calibSeekTime.addEventListener('keydown', function (event) {
        if (event.key === 'Enter') {
          event.preventDefault();
          scanCalibrationSeek();
        }
      });
      el.calibSeekTime.addEventListener('input', function () { setSeekError(''); });
    }
    if (el.prepBack) { el.prepBack.addEventListener('click', backToSourcePicker); }
    if (el.prepRefresh) {
      el.prepRefresh.addEventListener('click', function () { refreshStatusNow(); });
    }
    if (el.prepAction) {
      el.prepAction.addEventListener('click', function () { refreshInferenceDetails(); });
    }

    if (el.apiBase) {
      el.apiBase.addEventListener('change', function () {
        var value = String(el.apiBase.value || '').trim().replace(/\/+$/, '');
        if (!/^https?:\/\/[^\s]+$/i.test(value)) {
          setError('API base must be an http(s) URL.');
          return;
        }
        store.apiBase = value;
        try { sessionStorage.setItem('pv.apiBase', value); } catch (err) { /* ignore */ }
        clearDialogMessages();
        checkHealth({ manual: true });
      });
    }
    if (el.apiKey) {
      el.apiKey.addEventListener('change', function () {
        store.apiKey = String(el.apiKey.value || '').trim();
        clearDialogMessages();
        checkHealth({ manual: true });
      });
    }
    if (el.q) {
      el.q.addEventListener('input', function () {
        store.search = String(el.q.value || '');
        store.dirty.feed = true;
        renderFeed();
      });
    }
    if (el.tabs) {
      var tabButtons = el.tabs.querySelectorAll('button');
      Array.prototype.forEach.call(tabButtons, function (button) {
        button.addEventListener('click', function () {
          store.filter = button.getAttribute('data-c') || '';
          Array.prototype.forEach.call(tabButtons, function (other) {
            other.classList.toggle('on', other === button);
          });
          store.dirty.feed = true;
          renderFeed();
        });
      });
    }
    if (el.srcDlg) {
      el.srcDlg.addEventListener('cancel', function (event) {
        if (gateBlocked()) { event.preventDefault(); }
      });
      el.srcDlg.addEventListener('close', function () {
        clearDialogMessages();
        if (gateBlocked()) { openDialog(true); }
      });
    }
  }

  // ------------------------------------------------------------------- //
  // Debug overlay (?debug=1)
  // ------------------------------------------------------------------- //
  var debugTable = null;
  var debugCells = null;

  function createDebugOverlay() {
    if (!debugEnabled || debugTable || !document.body) { return; }
    var box = document.createElement('div');
    box.id = 'debug';
    box.className = 'on';
    var head = document.createElement('h4');
    head.appendChild(document.createTextNode('LIVE DEBUG'));
    var hint = document.createElement('span');
    hint.textContent = '?debug=1';
    head.appendChild(hint);
    box.appendChild(head);
    var table = document.createElement('table');
    box.appendChild(table);
    document.body.appendChild(box);
    debugTable = table;
    debugCells = {};
  }

  function updateDebug() {
    if (!debugTable) { return; }
    var counters = store.counters;
    var latest = store.tracking.latest;
    var mediaTime = latest && Number.isFinite(latest.mediaTime)
      ? latest.mediaTime.toFixed(2) + 's' : EN_DASH;
    var ageMs = store.tracking.receivedAt
      ? Math.max(0, Math.round(nowMs() - store.tracking.receivedAt)) : null;
    var videoOffset = null;
    if (store.video.active && renderState.targetKey !== null) {
      var playhead = Number(el.hls.currentTime);
      if (Number.isFinite(playhead)) {
        videoOffset = playhead - renderState.targetKey / 1000;
      }
    }

    function streamCell(name) {
      var stats = store.streams[name];
      var seq = stats && stats.lastSeq ? String(stats.lastSeq) : EN_DASH;
      return streamRate(name).toFixed(1) + '/s seq ' + seq;
    }

    var rows = [
      ['mode', store.mode + (store.demoActive ? ' \u00b7 synthetic' : '')],
      ['generation', String(store.generation)],
      ['backend', store.backend],
      ['socket', store.socketState + (store.joined ? ' joined' : '')],
      ['snapshot', store.snapshotReceived ? 'received' : 'waiting'],
      ['source', (store.source.sourceId || store.source.kind || EN_DASH)
        + ' ' + (store.source.state || '')],
      ['fps', renderState.fps ? renderState.fps.toFixed(0) : EN_DASH],
      ['render', renderState.renderMs.toFixed(2) + ' ms'],
      ['lag', renderState.lagMs + ' ms'],
      ['drift', renderState.driftMs === null ? EN_DASH : renderState.driftMs + ' ms'],
      ['extrapolated', renderState.extrapolated ? 'yes' : 'no'],
      ['players drawn', String(renderState.visiblePlayers)],
      ['buffer', store.tracking.buffer.length + ' frames'],
      ['message age', ageMs === null ? EN_DASH : ageMs + ' ms'],
      ['tracking rate/seq', streamCell('tracking')],
      ['analytics rate/seq', streamCell('analytics')],
      ['events rate/seq', streamCell('events')],
      ['commentary rate/seq', streamCell('commentary')],
      ['stale drops', 'trk ' + counters.trackingStale + ' / ev ' + counters.eventsStale
        + ' / com ' + counters.commentaryStale + ' / ana ' + counters.analyticsStale],
      ['duplicate drops', String(counters.trackingDuplicates)],
      ['track in/ok/rej', counters.trackingIn + '/' + counters.trackingAccepted
        + '/' + counters.trackingRejected],
      ['tracking gaps', String(counters.trackingGaps)],
      ['events in/ok/rej', counters.eventsIn + '/' + counters.eventsAccepted
        + '/' + counters.eventsRejected],
      ['event upsert/retract', counters.eventsUpserts + '/' + counters.eventsRetracted],
      ['event resyncs', String(counters.eventsResyncs)],
      ['commentary in/ok/rej', counters.commentaryIn + '/' + counters.commentaryAccepted
        + '/' + counters.commentaryRejected],
      ['commentary resyncs', String(counters.commentaryResyncs)],
      ['analytics in/ok/rej', counters.analyticsIn + '/' + counters.analyticsAccepted
        + '/' + counters.analyticsRejected],
      ['snapshots', String(counters.snapshots)],
      ['snapshot queued', counters.snapshotQueued + ' (now ' + store.snapshotQueue.length + ')'],
      ['invalid', String(counters.invalid)],
      ['resync requests', String(counters.resyncRequests)],
      ['backfills', String(counters.backfills) + ' (' + counters.backfillFrames + ' frames)'],
      ['hls errors', String(counters.hlsErrors)],
      ['render errors', String(counters.renderErrors || 0)],
      ['video', store.video.active
        ? 'active ' + (Number(el.hls.currentTime) || 0).toFixed(2) + 's' : 'off'],
      ['mediaTime', mediaTime],
      ['video offset', videoOffset === null ? EN_DASH
        : videoOffset.toFixed(2) + ' s'],
      ['last invalid', counters.lastInvalid
        ? counters.lastInvalid.stream + ': ' + counters.lastInvalid.reason : EN_DASH],
      ['last error', store.lastError || EN_DASH]
    ];

    rows.forEach(function (row) {
      var cell = debugCells[row[0]];
      if (!cell) {
        var tr = document.createElement('tr');
        var label = document.createElement('td');
        label.textContent = row[0];
        cell = document.createElement('td');
        tr.appendChild(label);
        tr.appendChild(cell);
        debugTable.appendChild(tr);
        debugCells[row[0]] = cell;
      }
      cell.textContent = row[1];
    });
  }

  // ------------------------------------------------------------------- //
  // Playwright snapshot: a frozen copy, never a live internal
  // ------------------------------------------------------------------- //
  function dashboardSnapshot() {
    var latest = store.tracking.latest;
    var now = nowMs();
    function streamSnapshot(name) {
      var stats = store.streams[name];
      return {
        lastSeq: stats ? stats.lastSeq : 0,
        rate: stats ? Number(stats.rate.toFixed(2)) : 0,
        ageMs: stats && stats.lastAt ? Math.max(0, Math.round(now - stats.lastAt)) : null
      };
    }
    return CONTRACT.deepFreeze(CONTRACT.deepClone({
      generatedAt: Date.now(),
      mode: store.mode,
      demo: !!store.demoActive,
      debug: debugEnabled,
      generation: store.generation,
      backend: store.backend,
      health: store.health,
      gate: {
        armed: gateArmed,
        phase: gatePhase(),
        sourceId: store.source.sourceId,
        points: store.calibration.points.length,
        previewAvailable: !!(store.source.calibrationPreview
          && store.source.calibrationPreview.available)
      },
      socket: {
        state: store.socketState,
        joined: store.joined,
        snapshotReceived: store.snapshotReceived,
        queued: store.snapshotQueue.length
      },
      source: {
        kind: store.source.kind,
        sourceId: store.source.sourceId,
        matchId: store.source.matchId,
        state: store.source.state,
        running: !!(store.source.status && store.source.status.running),
        teams: store.source.teams,
        inference: store.source.inference,
        // The preview path stays out of the snapshot: the readiness flags are
        // all a test needs, and no backend URL belongs in a published object.
        calibrationPreview: store.source.calibrationPreview ? {
          available: !!store.source.calibrationPreview.available,
          capturedAt: store.source.calibrationPreview.capturedAt,
          bytes: store.source.calibrationPreview.bytes
        } : null,
        pipeline: store.source.pipeline,
        error: store.source.error,
        hls: store.source.hls ? {
          ready: !!store.source.hls.ready,
          manifest: store.source.hls.manifest || '',
          segments: store.source.hls.segments || 0
        } : null
      },
      teams: {
        home: store.teams.home,
        away: store.teams.away,
        colors: {
          home: store.teams.colors.home,
          away: store.teams.colors.away
        }
      },
      score: { home: store.score.home, away: store.score.away },
      possessionPct: {
        home: store.possessionPct.home,
        away: store.possessionPct.away
      },
      clock: { period: store.clock.period, seconds: store.clock.seconds },
      matchStatus: store.matchStatus,
      analytics: store.analytics.latest,
      sequences: {
        tracking: store.tracking.lastSeq,
        analytics: store.analytics.lastSeq,
        events: store.events.lastSeq,
        commentary: store.commentary.lastSeq
      },
      streams: {
        tracking: streamSnapshot('tracking'),
        analytics: streamSnapshot('analytics'),
        events: streamSnapshot('events'),
        commentary: streamSnapshot('commentary')
      },
      messageAgeMs: store.tracking.receivedAt
        ? Math.max(0, Math.round(now - store.tracking.receivedAt)) : null,
      tracking: latest ? {
        seq: latest.seq,
        frame: latest.frame,
        ts: latest.ts,
        clock: {
          period: latest.clock.period,
          seconds: latest.clock.seconds
        },
        mediaTime: Number.isFinite(latest.mediaTime) ? latest.mediaTime : null,
        players: latest.players.length,
        ball: latest.ball ? {
          x: latest.ball.x, y: latest.ball.y, z: latest.ball.z,
          speed: latest.ball.speed, conf: latest.ball.conf
        } : null,
        possession: latest.possession || null,
        holderId: latest.holderId || null
      } : null,
      trackingBuffer: {
        size: store.tracking.buffer.length,
        lastSeq: store.tracking.lastSeq,
        gaps: store.tracking.gaps,
        // Read-only sample keys, so a test can tell which media times the
        // renderer can actually interpolate without guessing from the clock.
        samples: store.tracking.buffer.map(function (entry) {
          return entry.mediaTime;
        })
      },
      events: sortedEvents(),
      commentary: store.commentary.lines.slice(),
      selectedPlayerId: store.selectedPlayerId,
      video: {
        active: store.video.active,
        visible: store.video.visible,
        ready: store.video.ready,
        error: store.video.error,
        currentTime: Number(el.hls.currentTime) || 0,
        mediaTime: latest && Number.isFinite(latest.mediaTime)
          ? latest.mediaTime : null,
        driftMs: renderState.driftMs,
        backfill: {
          pending: store.video.backfillPending,
          lastTarget: store.video.lastBackfillTarget
        }
      },
      render: {
        fps: Number(renderState.fps.toFixed(1)),
        renderMs: Number(renderState.renderMs.toFixed(2)),
        lagMs: renderState.lagMs,
        extrapolated: renderState.extrapolated,
        visiblePlayers: renderState.visiblePlayers,
        bufferSize: store.tracking.buffer.length,
        targetKey: renderState.targetKey,
        clock: {
          period: renderState.clock.period,
          seconds: renderState.clock.seconds
        },
        possession: renderState.possession || null,
        holderId: renderState.holderId || null,
        players: Object.keys(renderState.players).sort().map(function (id) {
          var player = renderState.players[id];
          return {
            id: player.id,
            team: player.team,
            num: player.num,
            role: player.role,
            x: player.x,
            y: player.y,
            speed: player.speed,
            conf: player.conf
          };
        }),
        ball: renderState.ball ? {
          x: renderState.ball.x,
          y: renderState.ball.y,
          z: renderState.ball.z,
          speed: renderState.ball.speed,
          conf: renderState.ball.conf,
          airborne: renderState.ball.airborne
        } : null
      },
      counters: store.counters,
      lastError: store.lastError
    }));
  }

  Object.defineProperty(window, '__dash', {
    configurable: true,
    enumerable: true,
    get: dashboardSnapshot
  });

  // ------------------------------------------------------------------- //
  // Boot
  // ------------------------------------------------------------------- //
  function boot() {
    store.sources = [];
    store.sourcesToken = 0;
    resetTeamIdentity();
    applyTeamFormDefaults();
    buildStatsPanels();
    buildCardRows();
    buildWhatIf();
    createDebugOverlay();
    wireUi();
    updateHud();
    updatePlayerCard();
    updateWhatIf();
    updateFormationCanvases();
    renderSources();
    renderGate();
    applyConnectionState();
    applyVideoVisibility();
    requestAnimationFrame(window.__pvFrame);
    // rAF is the paint clock, but it is suspended in background tabs, headless
    // captures and some embedded previews. The timer keeps the panels and the
    // pitch following the data in every one of those cases.
    uiHeartbeatTimer = window.setInterval(uiHeartbeat, UI_TICK_MS);

    if (params.get('demo') === '1') {
      startLocalDemo();
    } else if (params.get('gate') === '1') {
      openDialog(true);
      checkHealth({ manual: true });
    } else {
      // Default to the real match dataset replay so the 3D pitch and video are live immediately!
      var sc = params.get('scene') || 'all';
      startDatasetDemo(sc);
    }
  }

  boot();
})();
