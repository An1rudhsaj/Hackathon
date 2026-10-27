/**
 * ProVision AI - Full Match Dataset Player (Demo 2: Pure Live).
 *
 * Uses the complete match dataset from start to end (43,458 tracking frames,
 * 852 passes, 27 shots, 2 goals, 77 turnovers) from `dashboard-full-dataset.js`.
 *
 * Synchronizes frame-by-frame with the broadcast match video:
 *   - Video time < 281.0s (04:41): Pre-match TV intro, 3D pitch shows starting lineups in formation.
 *   - Video time >= 281.0s: Whistle blows, 1st half kickoff, 10 FPS tracking matching video.
 *   - Video time 3904.0s (65:04): 2nd half kickoff.
 *   - Video time 6490.0s (01:48:10): Max Mata's 86.3 km/h goal.
 *
 * Strictly adheres to `dashboard-contract.js` validation rules.
 */
(function (root) {
  'use strict';

  var SCHEMA_VERSION = 1;
  var TICK_MS = 100; // 10 FPS native rate

  var MATCH_SUMMARY = {
    matchId: 'dataset-1886347',
    homeTeam: 'Auckland FC',
    awayTeam: 'Newcastle Jets',
    status: 'live',
    colors: { home: '#2800f0', away: '#e5a823' },
    score: { home: 0, away: 0 }
  };

  var state = null;
  var timer = null;

  function nowIso() {
    return Date.now();
  }

  function round(val) {
    return Math.round(val * 100) / 100;
  }

  function buildPitchGrid() {
    var grid = [];
    for (var col = 0; col < 21; col += 1) {
      var column = [];
      for (var row = 0; row < 14; row += 1) {
        var homeBias = 0.58 + (10 - col) * 0.015 - Math.abs(row - 6.5) * 0.01;
        column.push(Math.round(Math.max(0.2, Math.min(0.85, homeBias)) * 100) / 100);
      }
      grid.push(column);
    }
    return grid;
  }

  function send(stream, payload) {
    if (!state || typeof state.options.onMessage !== 'function') { return; }
    try {
      state.options.onMessage(stream, payload);
    } catch (error) {
      if (typeof state.options.onError === 'function') {
        state.options.onError(error);
      }
    }
  }

  function emitTracking(frameData) {
    var payload = {
      schemaVersion: SCHEMA_VERSION,
      matchId: state.options.matchId,
      seq: ++state.seq.tracking,
      ts: nowIso(),
      frame: frameData.frame,
      clock: {
        period: frameData.period,
        seconds: round(frameData.clock_s)
      },
      players: frameData.players.map(function (p) {
        return {
          id: p.id,
          team: p.team,
          num: p.num,
          role: p.role,
          x: round(p.x),
          y: round(p.y),
          speed: round(p.speed),
          conf: 0.95
        };
      }),
      ball: {
        x: round(frameData.ball.x),
        y: round(frameData.ball.y),
        z: round(frameData.ball.z),
        speed: round(frameData.ball.speed),
        airborne: frameData.ball.airborne,
        conf: 0.95
      },
      possession: frameData.possession,
      holderId: frameData.carrier
    };
    send('tracking', payload);
  }

  function emitAnalytics(score) {
    var ds = root.FullMatchDataset;
    var metrics = ds ? ds.PLAYER_METRICS : [];
    var payload = {
      schemaVersion: SCHEMA_VERSION,
      matchId: state.options.matchId,
      seq: ++state.seq.analytics,
      ts: nowIso(),
      score: score || state.currentScore,
      possessionPct: { home: 57.3, away: 42.7 },
      xg: { home: 1.82, away: 0.45 },
      xt: { home: 1.44, away: 0.62 },
      shots: { home: 18, away: 6 },
      passes: { home: 466, away: 348 },
      winProbability: { home: 0.78, draw: 0.15, away: 0.07 },
      formation: { home: '4-3-3', away: '4-2-3-1' },
      pitchControl: { home: 0.58, away: 0.42 },
      pitchControlGrid: buildPitchGrid(),
      fastestShot: { playerId: 'H9', speed: 86.3 },
      playerMetrics: metrics
    };
    send('analytics', payload);
  }

  function emitCommentary(text, source) {
    var payload = {
      schemaVersion: SCHEMA_VERSION,
      matchId: state.options.matchId,
      seq: ++state.seq.commentary,
      ts: nowIso(),
      text: text,
      eventId: null,
      source: source || 'gemini'
    };
    send('commentary', payload);
  }

  function emitEvent(ev, clock) {
    var payload = {
      schemaVersion: SCHEMA_VERSION,
      matchId: state.options.matchId,
      seq: ++state.seq.events,
      ts: nowIso(),
      eventId: ev.eventId,
      revision: 1,
      status: 'confirmed',
      type: ev.type,
      clock: clock,
      team: ev.team,
      playerId: ev.playerId,
      targetPlayerId: ev.targetPlayerId || null,
      start: ev.start,
      end: ev.end || null,
      ballSpeed: ev.ballSpeed || null,
      distance: ev.distance || null,
      xg: ev.xg || null,
      outcome: ev.outcome || null,
      intoBox: ev.intoBox || false,
      conf: ev.conf || 0.95
    };
    send('events', payload);
  }

  function checkEventsAtFrame(currentFrame, lastFrame) {
    var ds = root.FullMatchDataset;
    if (!ds || !ds.EVENTS) { return; }
    var events = ds.EVENTS;
    var minF = Math.min(currentFrame, lastFrame);
    var maxF = Math.max(currentFrame, lastFrame);

    for (var i = 0; i < events.length; i += 1) {
      var ev = events[i];
      if (ev.frame >= minF && ev.frame <= maxF) {
        if (!state.emittedEvents[ev.eventId]) {
          state.emittedEvents[ev.eventId] = true;
          var clock = { period: ev.period, seconds: ev.clock_s };
          emitEvent(ev, clock);

          if (ev.type === 'goal') {
            state.currentScore = { home: state.currentScore.home + 1, away: state.currentScore.away };
            emitAnalytics(state.currentScore);
            emitCommentary('GOAL! Auckland FC score! ' + ev.playerName + ' strikes into the net!', 'gemini');
          } else if (ev.type === 'shot') {
            emitCommentary('Shot attempt! ' + ev.playerName + ' strikes from ' + (ev.distance || 20) + 'm at ' + (ev.ballSpeed || 75) + ' km/h!', 'gemini');
          }
        }
      }
    }
  }

  function step() {
    if (!state || state.paused) { return; }
    var ds = root.FullMatchDataset;
    if (!ds) { return; }

    var videoTime = 0;
    var ogVideo = typeof document !== 'undefined' ? document.getElementById('ogVideo') : null;

    if (ogVideo && !isNaN(ogVideo.currentTime) && ogVideo.currentTime > 0) {
      // Sync with video currentTime
      videoTime = ogVideo.currentTime;
      state.currentTime = videoTime;
    } else {
      // Internal playback clock
      state.currentTime += 0.1;
      videoTime = state.currentTime;
      if (ogVideo && Math.abs(ogVideo.currentTime - videoTime) > 0.5) {
        try { ogVideo.currentTime = videoTime; } catch (e) { /* ignore */ }
      }
    }

    var frameData = ds.getFrameForVideoTime(videoTime);
    if (!frameData) { return; }

    var lastFrame = state.lastFrameNumber;
    state.lastFrameNumber = frameData.frame;

    // Handle pre-match vs live transition
    if (frameData.isPreMatch) {
      if (!state.wasPreMatch) {
        state.wasPreMatch = true;
        emitCommentary('Pre-match walkout at Go Media Stadium. Auckland FC host Newcastle Jets. Kickoff at 04:41.', 'template');
      }
      emitTracking(frameData);
      return;
    }

    if (state.wasPreMatch) {
      state.wasPreMatch = false;
      emitCommentary('Whistle blows! Kickoff in Auckland! The Isuzu UTE A-League round 6 match is underway!', 'gemini');
    }

    // Check score from tracking header
    if (frameData.score) {
      state.currentScore = frameData.score;
    }

    // Emit live tracking
    emitTracking(frameData);

    // Check events
    if (lastFrame !== -1) {
      checkEventsAtFrame(frameData.frame, lastFrame);
    }

    // Periodic analytics
    if (state.tickCount % 20 === 0) {
      emitAnalytics();
    }
    state.tickCount += 1;
  }

  function tick() {
    if (!state) { return; }
    try {
      step();
    } catch (error) {
      state.failures += 1;
      if (typeof state.options.onError === 'function') {
        try { state.options.onError(error); } catch (e) { /* ignore */ }
      }
    }
  }

  function reset() {
    if (timer) { clearInterval(timer); timer = null; }
    state = null;
  }

  function start(options) {
    if (!options || typeof options.onMessage !== 'function') {
      return false;
    }
    if (state) { reset(); }

    var ds = root.FullMatchDataset;
    var startVideoTime = ds ? ds.TIMINGS.kickoff1_video_s : 281.0; // Default to Kickoff!

    if (options.scene === 'intro') {
      startVideoTime = 0.0;
    } else if (options.scene === 'kickoff') {
      startVideoTime = 281.0;
    } else if (options.scene === 'shot') {
      startVideoTime = 424.0;
    } else if (options.scene === 'goal') {
      startVideoTime = 6490.0;
    } else if (options.videoTime !== undefined) {
      startVideoTime = Number(options.videoTime) || 281.0;
    }

    state = {
      options: options,
      seq: { tracking: 0, analytics: 0, events: 0, commentary: 0 },
      currentTime: startVideoTime,
      lastFrameNumber: -1,
      wasPreMatch: startVideoTime < 281.0,
      tickCount: 0,
      failures: 0,
      paused: false,
      emittedEvents: {},
      currentScore: { home: 0, away: 0 }
    };

    var summary = {
      matchId: options.matchId || MATCH_SUMMARY.matchId,
      homeTeam: MATCH_SUMMARY.homeTeam,
      awayTeam: MATCH_SUMMARY.awayTeam,
      status: 'live',
      colors: MATCH_SUMMARY.colors,
      score: state.currentScore
    };

    if (typeof options.onMatch === 'function') {
      try { options.onMatch(summary); } catch (error) { /* ignore */ }
    }

    var ogVideo = typeof document !== 'undefined' ? document.getElementById('ogVideo') : null;
    if (ogVideo) {
      try {
        ogVideo.currentTime = startVideoTime;
        ogVideo.play().catch(function () { /* user gesture required */ });
      } catch (e) { /* ignore */ }
    }

    emitAnalytics();

    if (startVideoTime < 281.0) {
      emitCommentary('Loaded full match broadcast: pre-match walkout. Match kicks off at 04:41.', 'template');
    } else {
      emitCommentary('Loaded pure live match dataset: Auckland FC vs Newcastle Jets (43,458 frames, start to end).', 'template');
    }

    if (ds) {
      var initialFrame = ds.getFrameForVideoTime(startVideoTime);
      if (initialFrame) {
        emitTracking(initialFrame);
      }
    }

    timer = setInterval(tick, TICK_MS);
    return true;
  }

  var SCENES = [
    { id: 'kickoff', title: '1st Half Kickoff (04:41)', start: 281.0 },
    { id: 'intro', title: 'Pre-Match Broadcast Intro (00:00)', start: 0.0 },
    { id: 'shot', title: 'Newcastle Counter & Gibson Strike (07:04)', start: 424.0 },
    { id: 'goal', title: 'Auckland FC Goal 2: Max Mata (01:48:10)', start: 6490.0 }
  ];

  function stop() {
    reset();
  }

  function isRunning() {
    return !!state;
  }

  function togglePause() {
    if (!state) { return false; }
    state.paused = !state.paused;
    return state.paused;
  }

  function seekToVideoTime(seconds) {
    if (!state) { return; }
    state.currentTime = seconds;
    var ds = root.FullMatchDataset;
    if (ds) {
      var f = ds.getFrameForVideoTime(seconds);
      if (f) {
        emitTracking(f);
      }
    }
  }

  root.DashDemo2 = Object.freeze({
    start: start,
    stop: stop,
    tick: tick,
    seekToVideoTime: seekToVideoTime,
    togglePause: togglePause,
    isPaused: function () { return !!(state && state.paused); },
    isRunning: isRunning,
    SCENES: SCENES
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
