/**
 * ProVision AI - local demo generator.
 *
 * This module is deliberately isolated: it never touches the network, never
 * reads `window.__dash` and never writes to the dashboard DOM. It produces
 * messages shaped exactly like the backend contract
 * (`Dashboard/dashboard-contract.js`) and hands them to the callbacks the
 * dashboard passes in when - and only when - the user asks for the demo.
 *
 * Everything it emits is marked `matchId: <demo match id>` so it can never be
 * confused with a live source, and the dashboard validates every message with
 * the same runtime validators it uses for backend traffic. A bug here can
 * therefore produce an ignored message, but it cannot bypass validation.
 *
 * Usage (browser):
 *   window.DashDemo.start({
 *     matchId: 'local-demo',
 *     homeTeam: 'Demo Blue',
 *     awayTeam: 'Demo Orange',
 *     colors: { home: '#1B4DFF', away: '#FF7A1B' },
 *     onMatch: function (summary) {},
 *     onMessage: function (stream, payload) {}
 *   });
 *   window.DashDemo.stop();
 */
(function (root) {
  'use strict';

  var SCHEMA_VERSION = 1;
  var TICK_MS = 100;
  var PITCH_HALF_W = 52.5;
  var PITCH_HALF_H = 34;
  var HALF_SECONDS = 2700;
  var FULL_SECONDS = 5400;

  var HOME_SHAPE = [
    { id: 'H1', num: 1, role: 'GK', x: -46, y: 0 },
    { id: 'H2', num: 2, role: 'DF', x: -32, y: -22 },
    { id: 'H3', num: 4, role: 'DF', x: -34, y: -7 },
    { id: 'H4', num: 5, role: 'DF', x: -34, y: 7 },
    { id: 'H5', num: 3, role: 'DF', x: -32, y: 22 },
    { id: 'H6', num: 6, role: 'MF', x: -14, y: -16 },
    { id: 'H7', num: 8, role: 'MF', x: -16, y: 0 },
    { id: 'H8', num: 10, role: 'MF', x: -14, y: 16 },
    { id: 'H9', num: 7, role: 'FW', x: 10, y: -20 },
    { id: 'H10', num: 9, role: 'FW', x: 18, y: 0 },
    { id: 'H11', num: 11, role: 'FW', x: 10, y: 20 }
  ];

  var AWAY_SHAPE = [
    { id: 'A1', num: 1, role: 'GK', x: 46, y: 0 },
    { id: 'A2', num: 2, role: 'DF', x: 32, y: -22 },
    { id: 'A3', num: 4, role: 'DF', x: 34, y: -7 },
    { id: 'A4', num: 5, role: 'DF', x: 34, y: 7 },
    { id: 'A5', num: 3, role: 'DF', x: 32, y: 22 },
    { id: 'A6', num: 6, role: 'MF', x: 14, y: -16 },
    { id: 'A7', num: 8, role: 'MF', x: 16, y: 0 },
    { id: 'A8', num: 10, role: 'MF', x: 14, y: 16 },
    { id: 'A9', num: 7, role: 'FW', x: -10, y: -20 },
    { id: 'A10', num: 9, role: 'FW', x: -18, y: 0 },
    { id: 'A11', num: 11, role: 'FW', x: -10, y: 20 }
  ];

  var COMMENTARY = [
    'The ball is worked wide and the full-back overlaps.',
    'A compact block in the middle third; space is hard to find.',
    'That switch of play found the far-side winger in stride.',
    'The goalkeeper is playing very high, almost as a sweeper.',
    'Pressure is building on the edge of the box.',
    'A quick counter starts after a turnover in midfield.',
    'The defensive line steps up to squeeze the space.',
    'A shot from range is blocked at the edge of the area.'
  ];

  var state = null;
  var timer = null;

  function clamp(value, low, high) {
    return Math.max(low, Math.min(high, value));
  }

  function round(value) {
    return Math.round(value * 100) / 100;
  }

  function nowIso() {
    return Date.now();
  }

  function teamOf(player) {
    return player.team;
  }

  function createPlayers() {
    var players = [];
    HOME_SHAPE.forEach(function (shape, index) {
      players.push({
        id: shape.id,
        team: 'home',
        num: shape.num,
        role: shape.role,
        baseX: shape.x,
        baseY: shape.y,
        x: shape.x,
        y: shape.y,
        speed: 0,
        conf: 0.94,
        phase: index * 0.7,
        distance: 0,
        topSpeed: 0,
        sprints: 0,
        fatigue: 0.08 + index * 0.01
      });
    });
    AWAY_SHAPE.forEach(function (shape, index) {
      players.push({
        id: shape.id,
        team: 'away',
        num: shape.num,
        role: shape.role,
        baseX: shape.x,
        baseY: shape.y,
        x: shape.x,
        y: shape.y,
        speed: 0,
        conf: 0.94,
        phase: index * 0.9 + 1.4,
        distance: 0,
        topSpeed: 0,
        sprints: 0,
        fatigue: 0.08 + index * 0.01
      });
    });
    return players;
  }

  function reset() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    state = null;
  }

  function send(stream, payload) {
    if (!state) { return; }
    try {
      state.options.onMessage(stream, payload);
    } catch (error) {
      // The dashboard owns its own error handling; a demo callback must never
      // take the generator down.
    }
  }

  function matchClock() {
    return {
      period: state.clock >= HALF_SECONDS ? 2 : 1,
      seconds: Math.floor(state.clock)
    };
  }

  /**
   * Whole percentages, so the two panel values always add up to exactly 100:
   * rounding each half independently can otherwise print 99% + 2%.
   */
  function possessionShare() {
    var total = state.homeTicks + state.awayTicks;
    if (!total) { return { home: 50, away: 50 }; }
    var home = Math.round(state.homeTicks / total * 100);
    return { home: home, away: 100 - home };
  }

  function buildPitchGrid() {
    var columns = 21;
    var rows = 14;
    var grid = [];
    var lean = state.possession === 'home' ? 1 : -1;
    for (var column = 0; column < columns; column += 1) {
      var cells = [];
      var x = (column + 0.5) / columns * (PITCH_HALF_W * 2) - PITCH_HALF_W;
      for (var row = 0; row < rows; row += 1) {
        var y = (row + 0.5) / rows * (PITCH_HALF_H * 2) - PITCH_HALF_H;
        var wave = Math.sin(column * 0.6 + row * 0.4) * 0.05;
        cells.push(clamp(0.5 + lean * x / (PITCH_HALF_W * 2.4) + wave, 0, 1));
      }
      grid.push(cells);
    }
    return grid;
  }

  function emitTracking() {
    var players = state.players.filter(function (player) {
      if (state.omit && state.omit.id === player.id && state.clock < state.omit.until) {
        return false;
      }
      return true;
    });

    var quiet = state.quietBallUntil && state.clock < state.quietBallUntil;
    var payload = {
      schemaVersion: SCHEMA_VERSION,
      matchId: state.options.matchId,
      seq: ++state.seq.tracking,
      ts: nowIso(),
      // Elapsed source time, the same media clock a live camera would use.
      // The dashboard only indexes by mediaTime in video mode, but every
      // tracking message on the wire carries it.
      mediaTime: round(state.clock),
      frame: ++state.frame,
      clock: matchClock(),
      players: players.map(function (player) {
        return {
          id: player.id,
          team: player.team,
          num: player.num,
          role: player.role,
          x: round(player.x),
          y: round(player.y),
          speed: round(player.speed),
          conf: round(player.conf)
        };
      }),
      ball: {
        x: round(state.ball.x),
        y: round(state.ball.y),
        z: round(state.ball.z),
        speed: round(state.ball.speed),
        airborne: state.ball.z > 0.4,
        conf: quiet ? 0.12 : round(state.ball.conf)
      },
      possession: state.possession,
      holderId: state.holder ? state.holder.id : null
    };
    send('tracking', payload);
  }

  function emitAnalytics() {
    var share = possessionShare();
    var diff = state.score.home - state.score.away;
    var progress = clamp(state.clock / FULL_SECONDS, 0, 1);
    var homeWin = clamp(0.34 + diff * 0.12 + (0.5 - progress) * 0.1, 0.02, 0.96);
    var draw = clamp(0.28 - Math.abs(diff) * 0.03, 0.06, 0.32);
    var awayWin = clamp(1 - homeWin - draw, 0.02, 0.96);
    var homePitch = clamp(0.5 + (share.home - 50) / 120, 0.2, 0.8);

    var metrics = state.players.map(function (player) {
      return {
        id: player.id,
        distanceKm: Math.round(player.distance / 10) / 100,
        topSpeed: Math.round(player.topSpeed * 10) / 10,
        sprints: player.sprints,
        fatigue: Math.round(player.fatigue * 100) / 100
      };
    });

    var payload = {
      schemaVersion: SCHEMA_VERSION,
      matchId: state.options.matchId,
      seq: ++state.seq.analytics,
      ts: nowIso(),
      score: { home: state.score.home, away: state.score.away },
      possessionPct: share,
      xg: {
        home: Math.round(state.xg.home * 100) / 100,
        away: Math.round(state.xg.away * 100) / 100
      },
      xt: {
        home: Math.round(state.xt.home * 100) / 100,
        away: Math.round(state.xt.away * 100) / 100
      },
      shots: { home: state.shots.home, away: state.shots.away },
      passes: { home: state.passes.home, away: state.passes.away },
      winProbability: {
        home: Math.round(homeWin * 1000) / 1000,
        draw: Math.round(draw * 1000) / 1000,
        away: Math.round(awayWin * 1000) / 1000
      },
      formation: { home: '4-3-3', away: '4-2-3-1' },
      pitchControl: {
        home: Math.round(homePitch * 1000) / 1000,
        away: Math.round((1 - homePitch) * 1000) / 1000
      },
      pitchControlGrid: buildPitchGrid(),
      fastestShot: state.fastestShot,
      playerMetrics: metrics
    };
    send('analytics', payload);
  }

  function emitCommentary() {
    var text = COMMENTARY[state.commentaryIndex % COMMENTARY.length];
    state.commentaryIndex += 1;
    var payload = {
      schemaVersion: SCHEMA_VERSION,
      matchId: state.options.matchId,
      seq: ++state.seq.commentary,
      ts: nowIso(),
      text: text,
      eventId: null,
      source: state.commentaryIndex % 2 === 0 ? 'gemini' : 'template'
    };
    send('commentary', payload);
  }

  function replayRevision(item, status, confidence) {
    var revised = {
      schemaVersion: SCHEMA_VERSION,
      matchId: state.options.matchId,
      seq: ++state.seq.events,
      ts: nowIso(),
      eventId: item.event.eventId,
      revision: item.event.revision + 1,
      status: status,
      type: item.event.type,
      clock: matchClock(),
      team: item.event.team,
      playerId: item.event.playerId,
      targetPlayerId: item.event.targetPlayerId,
      start: item.event.start,
      end: item.event.end,
      ballSpeed: item.event.ballSpeed,
      distance: item.event.distance,
      xg: item.event.xg,
      outcome: status === 'retracted' ? null : item.outcome,
      intoBox: item.event.intoBox,
      conf: confidence
    };
    send('events', revised);

    if (status === 'confirmed' && item.event.type === 'goal') {
      state.score[item.event.team] += 1;
      state.dirtyAnalytics = true;
    }
  }

  function createEvent(type, player) {
    var team = teamOf(player);
    var attacking = team === 'home' ? 1 : -1;
    var shot = type === 'shot' || type === 'goal';
    var start = { x: round(player.x), y: round(player.y) };
    var end = shot
      ? { x: round(clamp(player.x + attacking * 12, -PITCH_HALF_W, PITCH_HALF_W)), y: round(player.y * 0.4) }
      : { x: round(clamp(player.x + attacking * 14, -PITCH_HALF_W, PITCH_HALF_W)),
        y: round(clamp(player.y + (Math.random() - 0.5) * 18, -PITCH_HALF_H, PITCH_HALF_H)) };

    var event = {
      schemaVersion: SCHEMA_VERSION,
      matchId: state.options.matchId,
      seq: ++state.seq.events,
      ts: nowIso(),
      eventId: state.options.matchId + '-ev-' + String(++state.eventCounter).padStart(4, '0'),
      revision: 1,
      status: 'provisional',
      type: type,
      clock: matchClock(),
      team: team,
      playerId: player.id,
      targetPlayerId: null,
      start: start,
      end: end,
      ballSpeed: shot ? round(70 + Math.random() * 45) : round(18 + Math.random() * 22),
      distance: round(Math.hypot(end.x - start.x, end.y - start.y)),
      xg: shot ? round(0.04 + Math.random() * 0.28) : null,
      outcome: null,
      intoBox: shot ? Math.abs(end.x) > 36 : false,
      conf: 0.52
    };

    send('events', event);
    if (shot) {
      state.shots[team] += 1;
      state.xg[team] += event.xg;
      state.xt[team] += 0.06 + Math.random() * 0.1;
      var speed = event.ballSpeed;
      if (!state.fastestShot || speed > state.fastestShot.speed) {
        state.fastestShot = { playerId: player.id, speed: speed };
      }
    } else {
      state.xt[team] += 0.02;
    }

    if (type === 'goal') {
      state.pending.push({
        at: state.clock + 1.4,
        event: event,
        status: 'confirmed',
        outcome: 'goal',
        confidence: 0.96
      });
      return;
    }
    if (shot) {
      state.pending.push({
        at: state.clock + 1.1,
        event: event,
        status: 'confirmed',
        outcome: Math.random() > 0.5 ? 'saved' : 'blocked',
        confidence: 0.88
      });
      return;
    }
    if (type === 'pass' && Math.random() > 0.65) {
      state.pending.push({
        at: state.clock + 1.2,
        event: event,
        status: 'retracted',
        outcome: null,
        confidence: 0.18
      });
      return;
    }
    state.pending.push({
      at: state.clock + 0.9,
      event: event,
      status: 'confirmed',
      outcome: 'complete',
      confidence: 0.9
    });
  }

  function pickPlayer() {
    var candidates = state.players.filter(function (player) {
      return player.role !== 'GK';
    });
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  function stepBall(dt) {
    var target = state.ballTarget;
    var dx = target.x - state.ball.x;
    var dy = target.y - state.ball.y;
    var distance = Math.hypot(dx, dy);
    var speed = clamp(distance * 1.8, 0, 24);
    if (distance > 0.05) {
      var step = Math.min(distance, speed * dt);
      state.ball.x += dx / distance * step;
      state.ball.y += dy / distance * step;
    }
    state.ball.speed = speed * 3.6;
    state.ball.z = Math.max(0, state.ball.z + (Math.random() - 0.5) * 0.08 * dt * 60);
    if (state.ball.z > 2.5) { state.ball.z = 2.5; }

    if (distance < 1.2) {
      var receiver = pickPlayer();
      // Every completed ball movement is a pass in the synthetic stats; the
      // event stream only samples a few of them.
      state.passes[receiver.team] += 1;
      state.ballTarget = {
        x: clamp(receiver.x + (Math.random() - 0.5) * 8, -PITCH_HALF_W, PITCH_HALF_W),
        y: clamp(receiver.y + (Math.random() - 0.5) * 8, -PITCH_HALF_H, PITCH_HALF_H)
      };
    }

    var nearest = null;
    state.players.forEach(function (player) {
      var gap = Math.hypot(player.x - state.ball.x, player.y - state.ball.y);
      if (!nearest || gap < nearest.gap) { nearest = { player: player, gap: gap }; }
    });
    state.holder = nearest && nearest.gap < 2.6 ? nearest.player : null;
    state.possession = state.holder ? state.holder.team : state.possession;
    if (state.possession === 'home') { state.homeTicks += 1; } else { state.awayTicks += 1; }
  }

  function stepPlayers(dt) {
    state.players.forEach(function (player) {
      var targetX = player.baseX + (state.ball.x - player.baseX) * 0.16
        + Math.sin(state.clock * 0.25 + player.phase) * 3.2;
      var targetY = player.baseY + (state.ball.y - player.baseY) * 0.22
        + Math.cos(state.clock * 0.21 + player.phase) * 2.4;
      targetX = clamp(targetX, -PITCH_HALF_W + 2, PITCH_HALF_W - 2);
      targetY = clamp(targetY, -PITCH_HALF_H + 2, PITCH_HALF_H - 2);
      var beforeX = player.x;
      var beforeY = player.y;
      var dx = targetX - player.x;
      var dy = targetY - player.y;
      var distance = Math.hypot(dx, dy);
      var step = Math.min(distance, 7.5 * dt);
      if (distance > 0.01) {
        player.x += dx / distance * step;
        player.y += dy / distance * step;
      }
      var moved = Math.hypot(player.x - beforeX, player.y - beforeY);
      player.speed = dt > 0 ? moved / dt * 3.6 : 0;
      player.distance += moved;
      if (player.speed > player.topSpeed) { player.topSpeed = player.speed; }
      if (player.speed > 25 && !player.sprinting) {
        player.sprints += 1;
        player.sprinting = true;
      } else if (player.speed < 20) {
        player.sprinting = false;
      }
      player.fatigue = clamp(player.fatigue + player.speed * dt * 0.00012, 0, 1);
      player.conf = clamp(0.9 + Math.sin(state.clock * 0.7 + player.phase) * 0.05, 0.5, 1);
    });
  }

  /**
   * One simulation step. `dt` only drives the physics: the match clock is
   * derived from the wall clock, so it advances at exactly 1x even when the
   * browser throttles timers (background tab, low power mode, embedded
   * preview) and resumes on the true match minute instead of drifting behind.
   */
  function step() {
    var now = performance.now();
    var previous = state.clock;
    state.clock = Math.min(FULL_SECONDS, (now - state.clockBase) / 1000);
    var dt = clamp(state.clock - previous, 0, 0.5);
    state.last = now;

    stepBall(dt);
    stepPlayers(dt);

    state.pending = state.pending.filter(function (item) {
      if (state.clock < item.at) { return true; }
      replayRevision(item, item.status, item.confidence);
      return false;
    });

    emitTracking();

    if (state.clock >= state.nextAnalyticsAt) {
      state.nextAnalyticsAt = state.clock + 2;
      emitAnalytics();
    }
    if (state.clock >= state.nextEventAt) {
      state.nextEventAt = state.clock + 4 + Math.random() * 6;
      var roll = Math.random();
      var type = roll > 0.86 ? 'goal' : (roll > 0.6 ? 'shot' : 'pass');
      createEvent(type, pickPlayer());
    }
    if (state.clock >= state.nextCommentaryAt) {
      state.nextCommentaryAt = state.clock + 6 + Math.random() * 5;
      emitCommentary();
    }
    if (state.clock >= state.nextOmitAt) {
      state.nextOmitAt = state.clock + 14 + Math.random() * 10;
      var missing = state.players[Math.floor(Math.random() * state.players.length)];
      state.omit = { id: missing.id, until: state.clock + 1.6 };
    }
    if (state.clock >= state.nextQuietAt) {
      state.nextQuietAt = state.clock + 22 + Math.random() * 8;
      state.quietBallUntil = state.clock + 1.1;
    }
    if (state.clock >= FULL_SECONDS && !state.ended) {
      state.ended = true;
      if (typeof state.options.onEnded === 'function') { state.options.onEnded(); }
    }
  }

  /**
   * A timer callback must never take the generator down: one malformed frame
   * would leave the dashboard on dashes with no visible reason. Failures are
   * counted and reported, and the next tick runs normally.
   */
  function tick() {
    if (!state) { return; }
    try {
      step();
    } catch (error) {
      state.failures += 1;
      if (typeof state.options.onError === 'function') {
        try { state.options.onError(error); } catch (ignored) { /* ignore */ }
      }
    }
  }

  function start(options) {
    if (!options || typeof options.onMessage !== 'function') {
      return false;
    }
    if (state) { reset(); }

    state = {
      options: options,
      seq: { tracking: 0, analytics: 0, events: 0, commentary: 0 },
      frame: 0,
      last: performance.now(),
      // Wall-clock origin of kickoff: the match clock is a function of it.
      clockBase: performance.now(),
      clock: 0,
      failures: 0,
      players: createPlayers(),
      ball: { x: 0, y: 0, z: 0, speed: 0, conf: 0.96 },
      ballTarget: { x: 18, y: -6 },
      holder: null,
      possession: 'home',
      // A flat possession prior keeps the first seconds from swinging between
      // 99% and 1% while the sample is still tiny.
      homeTicks: 12,
      awayTicks: 12,
      score: { home: 0, away: 0 },
      shots: { home: 0, away: 0 },
      passes: { home: 0, away: 0 },
      xg: { home: 0, away: 0 },
      xt: { home: 0, away: 0 },
      fastestShot: null,
      eventCounter: 0,
      commentaryIndex: 0,
      pending: [],
      omit: null,
      quietBallUntil: 0,
      nextEventAt: 1.6,
      nextAnalyticsAt: 0,
      nextCommentaryAt: 2.4,
      nextOmitAt: 9,
      nextQuietAt: 15,
      dirtyAnalytics: false
    };

    var summary = {
      matchId: options.matchId,
      homeTeam: options.homeTeam || 'Demo Home',
      awayTeam: options.awayTeam || 'Demo Away',
      status: 'live',
      colors: {
        home: options.colors && options.colors.home ? options.colors.home : '#1B4DFF',
        away: options.colors && options.colors.away ? options.colors.away : '#FF7A1B'
      },
      score: { home: 0, away: 0 }
    };
    if (typeof options.onMatch === 'function') {
      try { options.onMatch(summary); } catch (error) { /* ignore */ }
    }

    emitAnalytics();
    emitCommentary();
    // Paint the kickoff frame before the first interval fires: an empty pitch
    // for the first 100 ms reads as "the demo is broken".
    emitTracking();
    timer = setInterval(tick, TICK_MS);
    return true;
  }

  function stop() {
    reset();
  }

  function isRunning() {
    return !!state;
  }

  root.DashDemo = Object.freeze({
    start: start,
    stop: stop,
    isRunning: isRunning
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
