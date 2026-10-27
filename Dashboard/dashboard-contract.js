/**
 * Wire contracts and light runtime validators for the ProVision AI dashboard.
 *
 * The payloads are produced by the backend (`Backend/app/models/messages.py`)
 * and exported as JSON Schema in `contract/*.schema.json`. This file is the
 * browser-side counterpart: it documents the exact shapes as JSDoc typedefs and
 * validates just enough of each message to keep a malformed payload out of the
 * renderer. It deliberately does not re-implement JSON Schema: ranges that the
 * backend already guarantees are checked, strings are checked for type, and
 * anything unknown is ignored rather than trusted.
 *
 * Coordinate system (see `Backend/README.md` section 4.0):
 *   x -52.5 .. +52.5, origin on the centre spot, home attacks +x in period 1
 *   y -34.0 .. +34.0, the two touchlines
 *   z   0 .. ~5, ball height in metres
 *
 * Stream sequencing:
 *   tracking / analytics / commentary `seq` is monotonic per stream.
 *   events `seq` is monotonic too: every revision takes a fresh seq, so a
 *   provisional event and its confirmation are both newer than their
 *   predecessors. `eventId` is stable across revisions and `revision` grows.
 *
 * Units:
 *   speeds are km/h, distances are metres, clocks are match seconds.
 *
 * Loading: a plain script in the browser (`window.DashContract`) or
 * `require()` in Node for the lightweight tests.
 */

/* eslint-disable no-unused-vars */

/**
 * @typedef {Object} Clock
 * @property {1|2} period Match period; 2 starts at the second half.
 * @property {number} seconds Match seconds, cumulative across both halves.
 */

/**
 * @typedef {"home"|"away"} Team
 */

/**
 * @typedef {"provisional"|"confirmed"|"retracted"} EventStatus
 */

/**
 * @typedef {"pass"|"shot"|"save"|"goal"|"tackle"|"foul"|"card"|"offside"|"corner"|"throw_in"|"goal_kick"|"substitution"} EventType
 */

/**
 * @typedef {"goal"|"saved"|"off_target"|"blocked"|"complete"|"incomplete"} EventOutcome
 */

/**
 * @typedef {"GK"|"DF"|"MF"|"FW"} PlayerRole
 */

/**
 * @typedef {Object} Position
 * @property {number} x
 * @property {number} y
 */

/**
 * @typedef {Object} PlayerTrack
 * @property {string} id Stable id such as "H7" or "A11"; never an array index.
 * @property {Team} team
 * @property {number} num Shirt number.
 * @property {PlayerRole} role
 * @property {number} x Centre-origin x in metres.
 * @property {number} y Centre-origin y in metres.
 * @property {number} speed km/h.
 * @property {number} conf 0..1 tracking confidence.
 */

/**
 * @typedef {Object} BallTrack
 * @property {number} x
 * @property {number} y
 * @property {number} z Height above the pitch in metres.
 * @property {number} speed km/h.
 * @property {boolean} airborne
 * @property {number} conf 0..1.
 */

/**
 * @typedef {Object} TrackingMessage
 * @property {1} schemaVersion
 * @property {string} matchId
 * @property {number} seq Monotonic per match; a lower seq is stale.
 * @property {number} ts Epoch milliseconds.
 * @property {number} frame
 * @property {Clock} clock
 * @property {PlayerTrack[]} players
 * @property {BallTrack|null} [ball] null when the tracker lost the ball.
 * @property {number} [mediaTime] Seconds of media since kickoff; 0 = live feed.
 * @property {Team|null} [possession]
 * @property {string|null} [holderId]
 */

/**
 * @typedef {Object} EventMessage
 * @property {1} schemaVersion
 * @property {string} matchId
 * @property {number} seq Fresh per revision.
 * @property {number} ts
 * @property {string} eventId Stable across revisions.
 * @property {number} revision Starts at 1 and grows.
 * @property {EventStatus} status
 * @property {EventType} type
 * @property {Clock} clock
 * @property {Team} team
 * @property {string|null} [playerId]
 * @property {string|null} [targetPlayerId]
 * @property {Position} start
 * @property {Position|null} [end]
 * @property {number|null} [ballSpeed] km/h.
 * @property {number|null} [distance] metres.
 * @property {number|null} [xg]
 * @property {EventOutcome|null} [outcome]
 * @property {boolean|null} [intoBox]
 * @property {number} conf 0..1.
 */

/**
 * @typedef {Object} ScoreBoard
 * @property {number} home
 * @property {number} away
 */

/**
 * @typedef {Object} TeamStat
 * @property {number} home
 * @property {number} away
 */

/**
 * @typedef {Object} TeamStatInt
 * @property {number} home
 * @property {number} away
 */

/**
 * @typedef {Object} WinProbability
 * @property {number} home 0..1
 * @property {number} draw 0..1
 * @property {number} away 0..1
 */

/**
 * @typedef {Object} FormationPair
 * @property {string} home e.g. "4-3-3"
 * @property {string} away
 */

/**
 * @typedef {Object} PlayerMetric
 * @property {string} id Stable player id.
 * @property {number} distanceKm
 * @property {number} topSpeed km/h.
 * @property {number} sprints
 * @property {number} fatigue 0..1.
 */

/**
 * @typedef {Object} FastestShot
 * @property {string} playerId
 * @property {number} speed km/h.
 */

/**
 * `pitchControlGrid[column][row]` is the home share of a 21 x 14 cell grid.
 * Columns run from the -x goal line to +x, rows from the -y touchline to +y.
 * @typedef {number[][]} PitchControlGrid
 */

/**
 * @typedef {Object} AnalyticsMessage
 * @property {1} schemaVersion
 * @property {string} matchId
 * @property {number} seq
 * @property {number} ts
 * @property {ScoreBoard} score The single live score authority.
 * @property {TeamStat} possessionPct Percentages, 0..100.
 * @property {TeamStat} xg
 * @property {TeamStat} xt
 * @property {TeamStatInt} shots
 * @property {TeamStatInt} passes
 * @property {WinProbability} winProbability Fractions, 0..1.
 * @property {FormationPair} formation
 * @property {TeamStat} pitchControl Fractions, 0..1.
 * @property {PitchControlGrid|null} [pitchControlGrid]
 * @property {FastestShot|null} [fastestShot]
 * @property {PlayerMetric[]} playerMetrics
 */

/**
 * @typedef {Object} CommentaryMessage
 * @property {1} schemaVersion
 * @property {string} matchId
 * @property {number} seq
 * @property {number} ts
 * @property {string} text
 * @property {string|null} [eventId]
 * @property {"gemini"|"template"} source
 */

/**
 * @typedef {Object} Snapshot
 * @property {string} matchId
 * @property {boolean} running
 * @property {TrackingMessage|null} tracking
 * @property {AnalyticsMessage|null} analytics
 * @property {EventMessage[]} events Last 50 revisions.
 * @property {CommentaryMessage[]} commentary Last 10 lines.
 */

/**
 * @typedef {Object} TeamColors
 * @property {string} home Server-owned colour, normally #1B4DFF.
 * @property {string} away Server-owned colour, normally #FF7A1B.
 */

/**
 * @typedef {Object} MatchSummary
 * @property {string} matchId
 * @property {string} homeTeam
 * @property {string} awayTeam
 * @property {string} status
 * @property {TeamColors} colors
 * @property {ScoreBoard} score
 */

/**
 * @typedef {Object} IngestSourceHealth
 * @property {string} sourceId
 * @property {string} matchId
 * @property {"upload"|"rtsp"} kind
 * @property {"starting"|"live"|"reconnecting"|"needs_calibration"|"ended"|"failed"|"stopped"} state
 */

/**
 * @typedef {Object} HealthStatus
 * @property {"ok"} status
 * @property {"simulator"|"video"} pipelineMode
 * @property {string[]} sources
 * @property {IngestSourceHealth[]} [ingestSources]
 */

/**
 * @typedef {Object} SourceFailure
 * @property {string} code
 * @property {string} message
 * @property {string} [action] What a human should try next.
 */

/**
 * @typedef {Object} HlsStatus
 * @property {boolean} ready
 * @property {string} manifest Relative path, e.g. /ingest/sources/src_x/hls/index.m3u8
 * @property {number} segments
 * @property {SourceFailure|null} error
 */

/**
 * @typedef {Object} CalibrationPoint
 * @property {number} imageX Pixel column in the preview's natural size.
 * @property {number} imageY Pixel row in the preview's natural size.
 * @property {number} pitchX Centre-origin metres, -52.5 .. +52.5.
 * @property {number} pitchY Centre-origin metres, -34 .. +34.
 */

/**
 * @typedef {Object} CalibrationLandmark
 * @property {string} id Stable landmark id used by the dashboard only.
 * @property {string} label Human name shown in the picker.
 * @property {number} pitchX Centre-origin metres.
 * @property {number} pitchY Centre-origin metres.
 */

/**
 * @typedef {Object} TeamIdentityEntry
 * @property {string} name
 * @property {string} color CSS hex colour, normally #RRGGBB.
 */

/**
 * @typedef {Object} TeamIdentity
 * @property {TeamIdentityEntry} home
 * @property {TeamIdentityEntry} away
 */

/**
 * @typedef {Object} CalibrationInfo
 * @property {"pending"|"calibrated"|"needs_calibration"} phase
 * @property {string|null} source "auto" or "manual" once calibrated.
 * @property {number|null} confidence 0..1 when the model reports it.
 * @property {number|null} updatedAt Epoch milliseconds.
 * @property {string|null} reason Why calibration is required.
 */

/**
 * @typedef {Object} InferenceLatency
 * @property {number|null} lastMs
 * @property {number|null} averageMs
 * @property {number|null} maxMs
 * @property {number} samples
 */

/**
 * @typedef {Object} GeminiUsage
 * @property {boolean} enabled
 * @property {string|null} model
 * @property {string} mode "gemini" or "template".
 * @property {string|null} lastSource
 * @property {number} lines
 * @property {number} geminiLines
 * @property {number} templateLines
 * @property {number} geminiErrors
 * @property {number} eventsConsumed
 */

/**
 * @typedef {Object} InferenceStatus
 * @property {boolean} enabled Whether this source has an inference session.
 * @property {boolean|null} ready
 * @property {boolean|null} reachable
 * @property {number|null} checkedAt
 * @property {string|null} detail
 * @property {CalibrationInfo} calibration
 * @property {InferenceLatency} latency
 * @property {GeminiUsage|null} gemini
 * @property {SourceFailure|null} error
 */

/**
 * @typedef {Object} CalibrationPreview
 * @property {boolean} available
 * @property {number|null} capturedAt
 * @property {number} bytes
 * @property {string} url Same-origin preview path; fetch it with the API key.
 */

/**
 * @typedef {Object} IngestSourceStatus
 * @property {string} sourceId
 * @property {string} matchId
 * @property {"upload"|"rtsp"} kind
 * @property {"starting"|"live"|"reconnecting"|"needs_calibration"|"ended"|"failed"|"stopped"} state
 * @property {boolean} running
 * @property {HlsStatus} hls
 * @property {Object|null} [media]
 * @property {Object|null} [rtsp]
 * @property {SourceFailure|null} [error]
 * @property {Object|null} [streaming]
 * @property {Object|null} [pipeline]
 * @property {TeamIdentity|null} [teams]
 * @property {InferenceStatus|null} [inference]
 * @property {CalibrationPreview|null} [calibrationPreview]
 */

/**
 * Cumulative counters rendered by the `?debug=1` overlay. They are also the
 * cheapest way for a Playwright check to prove that an invalid payload was
 * counted rather than rendered.
 *
 * @typedef {Object} DebugCounters
 * @property {number} trackingIn
 * @property {number} trackingAccepted
 * @property {number} trackingRejected
 * @property {number} trackingGaps
 * @property {number} eventsIn
 * @property {number} eventsAccepted
 * @property {number} eventsRejected
 * @property {number} eventsUpserts
 * @property {number} eventsRetracted
 * @property {number} eventsResyncs
 * @property {number} commentaryIn
 * @property {number} commentaryAccepted
 * @property {number} commentaryRejected
 * @property {number} commentaryResyncs
 * @property {number} analyticsIn
 * @property {number} analyticsAccepted
 * @property {number} analyticsRejected
 * @property {number} snapshots
 * @property {number} snapshotQueued
 * @property {number} invalid Payloads dropped by a validator.
 * @property {number} errors
 * @property {number} resyncRequests
 * @property {number} backfills
 * @property {number} goalBanners
 * @property {number} hlsErrors
 * @property {{stream:string,reason:string,at:number}|null} lastInvalid
 * @property {Object|null} streamStats
 */

/**
 * The value of `window.__dash`. `provision.js` builds it with
 * `deepFreeze(deepClone(...))`, so a test can read it but can never mutate the
 * dashboard's internals through it. The getter recomputes the whole object on
 * every read: `await page.evaluate(() => window.__dash)` always sees the state
 * at the moment of the call.
 *
 * @typedef {Object} DashboardSnapshot
 * @property {number} generatedAt Epoch milliseconds of the read.
 * @property {"idle"|"connected"|"demo"} mode "connected" covers every backend mode.
 * @property {boolean} demo True only for the opt-in local demo.
 * @property {boolean} debug True only when the page was opened with ?debug=1.
 * @property {number} generation Async guard token; it changes on every clear.
 * @property {"unknown"|"online"|"offline"|"incompatible"} backend
 * @property {HealthStatus|null} health
 * @property {{state:string,joined:boolean,snapshotReceived:boolean,queued:number}} socket
 * @property {{kind:string|null,sourceId:string|null,matchId:string|null,state:string|null,running:boolean,teams:Object|null,inference:Object|null,calibrationPreview:{available:boolean,capturedAt:number|null,bytes:number|null}|null,pipeline:Object|null,error:Object|null,hls:{ready:boolean,manifest:string,segments:number}|null}} source
 *   Never carries an inference session id, model URL or credential.
 * @property {{home:string,away:string,colors:TeamColors}} teams Server-owned identity.
 * @property {ScoreBoard} score Analytics-owned scoreline.
 * @property {TeamStat} possessionPct
 * @property {Clock} clock From the newest tracking frame.
 * @property {string|null} matchStatus
 * @property {AnalyticsMessage|null} analytics Newest accepted analytics message.
 * @property {{tracking:number,analytics:number,events:number,commentary:number}} sequences
 *   Per-stream sequence high-water marks.
 * @property {{tracking:{lastSeq:number,rate:number,ageMs:number|null},analytics:{lastSeq:number,rate:number,ageMs:number|null},events:{lastSeq:number,rate:number,ageMs:number|null},commentary:{lastSeq:number,rate:number,ageMs:number|null}}} streams
 *   Per-stream rate and age diagnostics, in messages per second.
 * @property {number|null} messageAgeMs Age of the newest tracking frame.
 * @property {Object|null} tracking Subset of the newest frame: seq, frame, ts,
 *   clock, mediaTime, players (count), ball, possession, holderId.
 * @property {{size:number,lastSeq:number,gaps:number,samples:number[]}} trackingBuffer
 * @property {EventMessage[]} events Highest revision per eventId, newest first.
 * @property {CommentaryMessage[]} commentary Newest first, capped.
 * @property {string|null} selectedPlayerId
 * @property {{active:boolean,visible:boolean,ready:boolean,error:string|null,currentTime:number,mediaTime:number|null,driftMs:number,backfill:{pending:boolean,lastTarget:number|null}}} video
 * @property {{fps:number,renderMs:number,lagMs:number,extrapolated:boolean,visiblePlayers:number,bufferSize:number,players:Array<{id:string,team:string,num:number,role:string,x:number,y:number,speed:number,conf:number}>,ball:{x:number,y:number,z:number,speed:number,conf:number,airborne:boolean}|null}} render
 *   The interpolated frame the 3D layer is drawing right now. `players` and
 *   `ball` are read-only copies, so a test can compare them to the backend
 *   without reaching into the renderer's internals.
 * @property {DebugCounters} counters
 * @property {string} lastError
 * @property {{armed:boolean,phase:"source"|"preparing"|"calibration"|"failed"|"ready",sourceId:string|null,points:number,previewAvailable:boolean}} gate
 *   Why the analytics desk is still locked and how far calibration has got.
 */

/* eslint-enable no-unused-vars */

(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.DashContract = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var SCHEMA_VERSION = 1;
  var PITCH_CONTROL_COLS = 21;
  var PITCH_CONTROL_ROWS = 14;
  var HOME_TEAM_COLOR = '#1B4DFF';
  var AWAY_TEAM_COLOR = '#FF7A1B';

  //: Centre-origin pitch extents, in metres (the backend clamps to the same).
  var PITCH_HALF_LENGTH = 52.5;
  var PITCH_HALF_WIDTH = 34.0;

  //: Four correspondences is the minimum that defines a homography.
  var CALIBRATION_MIN_POINTS = 4;
  var CALIBRATION_MAX_POINTS = 64;
  var TEAM_NAME_MAX = 64;

  //: Auto-detected calibration suggestions travel on the source status.
  var SUGGESTION_STATES = Object.freeze(['idle', 'sampling', 'ready', 'empty']);
  var SUGGESTION_MAX_ITEMS = 8;
  var SUGGESTION_PREVIEW_RE = /^\/ingest\/sources\/[A-Za-z0-9._-]+\/calibration-suggestions\/\d+\/preview$/;

  /**
   * Canonical pitch landmarks for guided calibration. The dashboard picks one
   * by name and derives the metres; a human never types pitch coordinates.
   * Every value is inside x -52.5 .. +52.5 and y -34 .. +34, and the list is
   * deliberately spread across the pitch so four choices can never be collinear.
   */
  var CALIBRATION_LANDMARKS = Object.freeze([
    Object.freeze({ id: 'centre-spot', label: 'Centre spot (0, 0)', pitchX: 0, pitchY: 0 }),
    Object.freeze({ id: 'halfway-north', label: 'Halfway line / north touchline (0, +34)', pitchX: 0, pitchY: 34 }),
    Object.freeze({ id: 'halfway-south', label: 'Halfway line / south touchline (0, -34)', pitchX: 0, pitchY: -34 }),
    Object.freeze({ id: 'centre-circle-home', label: 'Centre circle / home side (+9.15, 0)', pitchX: 9.15, pitchY: 0 }),
    Object.freeze({ id: 'centre-circle-away', label: 'Centre circle / away side (-9.15, 0)', pitchX: -9.15, pitchY: 0 }),
    Object.freeze({ id: 'centre-circle-north', label: 'Centre circle / north (+0, +9.15)', pitchX: 0, pitchY: 9.15 }),
    Object.freeze({ id: 'centre-circle-south', label: 'Centre circle / south (+0, -9.15)', pitchX: 0, pitchY: -9.15 }),
    Object.freeze({ id: 'home-penalty-spot', label: 'Home penalty spot (+41.5, 0)', pitchX: 41.5, pitchY: 0 }),
    Object.freeze({ id: 'away-penalty-spot', label: 'Away penalty spot (-41.5, 0)', pitchX: -41.5, pitchY: 0 }),
    Object.freeze({ id: 'home-goal-centre', label: 'Home goal centre (+52.5, 0)', pitchX: 52.5, pitchY: 0 }),
    Object.freeze({ id: 'away-goal-centre', label: 'Away goal centre (-52.5, 0)', pitchX: -52.5, pitchY: 0 }),
    Object.freeze({ id: 'home-goal-post-north', label: 'Home goal post / north (+52.5, +3.66)', pitchX: 52.5, pitchY: 3.66 }),
    Object.freeze({ id: 'home-goal-post-south', label: 'Home goal post / south (+52.5, -3.66)', pitchX: 52.5, pitchY: -3.66 }),
    Object.freeze({ id: 'away-goal-post-north', label: 'Away goal post / north (-52.5, +3.66)', pitchX: -52.5, pitchY: 3.66 }),
    Object.freeze({ id: 'away-goal-post-south', label: 'Away goal post / south (-52.5, -3.66)', pitchX: -52.5, pitchY: -3.66 }),
    Object.freeze({ id: 'home-penalty-area-north', label: 'Home penalty area / north corner (+36, +20.16)', pitchX: 36, pitchY: 20.16 }),
    Object.freeze({ id: 'home-penalty-area-south', label: 'Home penalty area / south corner (+36, -20.16)', pitchX: 36, pitchY: -20.16 }),
    Object.freeze({ id: 'away-penalty-area-north', label: 'Away penalty area / north corner (-36, +20.16)', pitchX: -36, pitchY: 20.16 }),
    Object.freeze({ id: 'away-penalty-area-south', label: 'Away penalty area / south corner (-36, -20.16)', pitchX: -36, pitchY: -20.16 }),
    Object.freeze({ id: 'home-six-yard-north', label: 'Home six-yard box / north corner (+47, +9.16)', pitchX: 47, pitchY: 9.16 }),
    Object.freeze({ id: 'home-six-yard-south', label: 'Home six-yard box / south corner (+47, -9.16)', pitchX: 47, pitchY: -9.16 }),
    Object.freeze({ id: 'away-six-yard-north', label: 'Away six-yard box / north corner (-47, +9.16)', pitchX: -47, pitchY: 9.16 }),
    Object.freeze({ id: 'away-six-yard-south', label: 'Away six-yard box / south corner (-47, -9.16)', pitchX: -47, pitchY: -9.16 }),
    Object.freeze({ id: 'corner-home-north', label: 'Corner / home end, north touchline (+52.5, +34)', pitchX: 52.5, pitchY: 34 }),
    Object.freeze({ id: 'corner-home-south', label: 'Corner / home end, south touchline (+52.5, -34)', pitchX: 52.5, pitchY: -34 }),
    Object.freeze({ id: 'corner-away-north', label: 'Corner / away end, north touchline (-52.5, +34)', pitchX: -52.5, pitchY: 34 }),
    Object.freeze({ id: 'corner-away-south', label: 'Corner / away end, south touchline (-52.5, -34)', pitchX: -52.5, pitchY: -34 })
  ]);

  /** Required top-level fields, kept in sync with contract/*.schema.json. */
  var REQUIRED_FIELDS = Object.freeze({
    tracking: Object.freeze([
      'schemaVersion', 'matchId', 'seq', 'ts', 'frame', 'clock', 'players'
    ]),
    event: Object.freeze([
      'schemaVersion', 'matchId', 'seq', 'ts', 'eventId', 'revision',
      'status', 'type', 'clock', 'team', 'start', 'conf'
    ]),
    analytics: Object.freeze([
      'schemaVersion', 'matchId', 'seq', 'ts', 'score', 'possessionPct',
      'xg', 'xt', 'shots', 'passes', 'winProbability', 'formation',
      'pitchControl', 'playerMetrics'
    ]),
    commentary: Object.freeze([
      'schemaVersion', 'matchId', 'seq', 'ts', 'text', 'source'
    ])
  });

  var TEAMS = Object.freeze(['home', 'away']);
  var ROLES = Object.freeze(['GK', 'DF', 'MF', 'FW']);
  var EVENT_STATUSES = Object.freeze(['provisional', 'confirmed', 'retracted']);
  var EVENT_TYPES = Object.freeze([
    'pass', 'shot', 'save', 'goal', 'tackle', 'foul', 'card', 'offside',
    'corner', 'throw_in', 'goal_kick', 'substitution'
  ]);
  var EVENT_OUTCOMES = Object.freeze([
    'goal', 'saved', 'off_target', 'blocked', 'complete', 'incomplete'
  ]);
  var SOURCE_KINDS = Object.freeze(['upload', 'rtsp']);
  var SOURCE_STATES = Object.freeze([
    'starting', 'live', 'reconnecting', 'needs_calibration', 'ended', 'failed',
    'stopped', 'queued', 'probing', 'running', 'completed'
  ]);
  var RUNNING_SOURCE_STATES = Object.freeze([
    'starting', 'live', 'reconnecting', 'needs_calibration', 'queued', 'probing', 'running'
  ]);
  var TERMINAL_SOURCE_STATES = Object.freeze(['ended', 'failed', 'stopped', 'completed']);
  var CALIBRATION_PHASES = Object.freeze([
    'pending', 'calibrated', 'needs_calibration'
  ]);
  var COMMENTARY_SOURCES = Object.freeze(['gemini', 'template']);

  // --------------------------------------------------------------------- //
  // Small helpers
  // --------------------------------------------------------------------- //
  function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
  }

  function isInt(value) {
    return isFiniteNumber(value) && Math.floor(value) === value;
  }

  function isNonEmptyString(value) {
    return typeof value === 'string' && value.length > 0;
  }

  /** A 0..1 score, or null when the backend did not measure one. */
  function ratioOrNull(value) {
    if (!isFiniteNumber(value)) { return null; }
    if (value < 0) { return 0; }
    if (value > 1) { return 1; }
    return value;
  }

  function inList(value, list) {
    return list.indexOf(value) !== -1;
  }

  function ok(value, extra) {
    var result = { ok: true, value: value };
    if (extra) {
      Object.keys(extra).forEach(function (key) { result[key] = extra[key]; });
    }
    return result;
  }

  function fail(path, message) {
    return { ok: false, error: String(path) + ': ' + String(message) };
  }

  function joined(errors) {
    return { ok: false, error: errors.slice(0, 6).join('; ') };
  }

  function isClock(value) {
    return isObject(value)
      && (value.period === 1 || value.period === 2)
      && isFiniteNumber(value.seconds)
      && value.seconds >= 0;
  }

  function isPosition(value) {
    return isObject(value) && isFiniteNumber(value.x) && isFiniteNumber(value.y);
  }

  function isConfidence(value) {
    return isFiniteNumber(value) && value >= 0 && value <= 1;
  }

  /**
   * The inference service accepts exactly ``#RRGGBB`` (no short form), so the
   * dashboard validates the stricter shape instead of relying on `safeColor`.
   */
  function isTeamColor(value) {
    return typeof value === 'string' && /^#[0-9A-Fa-f]{6}$/.test(value);
  }

  function normalizeTeamColor(value, fallback) {
    return isTeamColor(value) ? '#' + value.slice(1).toUpperCase() : fallback;
  }

  function clampNumber(value, low, high) {
    return Math.min(Math.max(value, low), high);
  }

  /**
   * Whether a point set is two-dimensional. Mirrors the backend's tolerance so
   * the dashboard can reject an obviously collinear selection before the round
   * trip; the backend remains the authority.
   */
  function hasSpread(points) {
    var scale = 0;
    points.forEach(function (pair) {
      scale = Math.max(scale, Math.abs(pair[0]), Math.abs(pair[1]));
    });
    var epsilon = Math.max(1e-6, scale * 1e-4);
    var origin = points[0];
    var direction = null;
    for (var index = 1; index < points.length; index += 1) {
      var dx = points[index][0] - origin[0];
      var dy = points[index][1] - origin[1];
      var length = Math.sqrt(dx * dx + dy * dy);
      if (length > epsilon) {
        direction = [dx / length, dy / length];
        break;
      }
    }
    if (!direction) { return false; }
    for (var cursor = 0; cursor < points.length; cursor += 1) {
      var offsetX = points[cursor][0] - origin[0];
      var offsetY = points[cursor][1] - origin[1];
      if (Math.abs(offsetX * direction[1] - offsetY * direction[0]) > epsilon) {
        return true;
      }
    }
    return false;
  }

  function calibrationPreviewAvailable(source) {
    return !!(source && isObject(source.calibrationPreview)
      && source.calibrationPreview.available === true
      && isNonEmptyString(source.calibrationPreview.url));
  }

  function isSourceRunning(state) {
    return inList(state, RUNNING_SOURCE_STATES);
  }

  function isSourceTerminal(state) {
    return inList(state, TERMINAL_SOURCE_STATES);
  }

  function isTeamStat(value) {
    return isObject(value) && isFiniteNumber(value.home) && isFiniteNumber(value.away);
  }

  function isTeamStatInt(value) {
    return isObject(value) && isInt(value.home) && isInt(value.away);
  }

  // --------------------------------------------------------------------- //
  // Stream validators
  // --------------------------------------------------------------------- //
  function validatePlayerTrack(value, index, errors) {
    var path = 'players[' + index + ']';
    if (!isObject(value)) { errors.push(path + ' must be an object'); return; }
    if (!isNonEmptyString(value.id)) { errors.push(path + '.id must be a string'); }
    if (!inList(value.team, TEAMS)) { errors.push(path + '.team must be home/away'); }
    if (!isInt(value.num)) { errors.push(path + '.num must be an integer'); }
    if (!inList(value.role, ROLES)) { errors.push(path + '.role must be GK/DF/MF/FW'); }
    if (!isFiniteNumber(value.x)) { errors.push(path + '.x must be finite'); }
    if (!isFiniteNumber(value.y)) { errors.push(path + '.y must be finite'); }
    if (!isFiniteNumber(value.speed) || value.speed < 0) {
      errors.push(path + '.speed must be a non-negative number');
    }
    if (!isConfidence(value.conf)) { errors.push(path + '.conf must be 0..1'); }
  }

  function validateBallTrack(value, errors) {
    if (value === null || value === undefined) { return; }
    if (!isObject(value)) { errors.push('ball must be an object or null'); return; }
    ['x', 'y', 'z', 'speed'].forEach(function (key) {
      if (!isFiniteNumber(value[key])) { errors.push('ball.' + key + ' must be finite'); }
    });
    if (typeof value.airborne !== 'boolean') {
      errors.push('ball.airborne must be a boolean');
    }
    if (!isConfidence(value.conf)) { errors.push('ball.conf must be 0..1'); }
  }

  /**
   * @param {unknown} value
   * @returns {{ok:boolean,value?:TrackingMessage,error?:string}}
   */
  function validateTrackingMessage(value) {
    if (!isObject(value)) { return fail('$', 'expected a tracking object'); }
    var errors = [];
    if (value.schemaVersion !== SCHEMA_VERSION) {
      errors.push('schemaVersion must be ' + SCHEMA_VERSION);
    }
    if (!isNonEmptyString(value.matchId)) { errors.push('matchId must be a string'); }
    if (!isInt(value.seq)) { errors.push('seq must be an integer'); }
    if (!isInt(value.ts)) { errors.push('ts must be an integer'); }
    if (!isInt(value.frame)) { errors.push('frame must be an integer'); }
    if (!isClock(value.clock)) { errors.push('clock must be {period 1|2, seconds >= 0}'); }
    if (!Array.isArray(value.players)) {
      errors.push('players must be an array');
    } else {
      for (var i = 0; i < value.players.length; i += 1) {
        validatePlayerTrack(value.players[i], i, errors);
      }
    }
    validateBallTrack(value.ball, errors);
    if (value.mediaTime !== undefined && value.mediaTime !== null) {
      if (!isFiniteNumber(value.mediaTime) || value.mediaTime < 0) {
        errors.push('mediaTime must be a non-negative number');
      }
    }
    if (value.possession !== undefined && value.possession !== null) {
      if (!inList(value.possession, TEAMS)) { errors.push('possession must be home/away/null'); }
    }
    if (value.holderId !== undefined && value.holderId !== null) {
      if (typeof value.holderId !== 'string') { errors.push('holderId must be a string/null'); }
    }
    if (errors.length) { return joined(errors); }
    return ok(value);
  }

  /**
   * @param {unknown} value
   * @returns {{ok:boolean,value?:EventMessage,error?:string}}
   */
  function validateEventMessage(value) {
    if (!isObject(value)) { return fail('$', 'expected an event object'); }
    var errors = [];
    if (value.schemaVersion !== SCHEMA_VERSION) {
      errors.push('schemaVersion must be ' + SCHEMA_VERSION);
    }
    if (!isNonEmptyString(value.matchId)) { errors.push('matchId must be a string'); }
    if (!isInt(value.seq)) { errors.push('seq must be an integer'); }
    if (!isInt(value.ts)) { errors.push('ts must be an integer'); }
    if (!isNonEmptyString(value.eventId)) { errors.push('eventId must be a string'); }
    if (!isInt(value.revision) || value.revision < 1) {
      errors.push('revision must be a positive integer');
    }
    if (!inList(value.status, EVENT_STATUSES)) { errors.push('status is not valid'); }
    if (!inList(value.type, EVENT_TYPES)) { errors.push('type is not valid'); }
    if (!isClock(value.clock)) { errors.push('clock must be {period 1|2, seconds >= 0}'); }
    if (!inList(value.team, TEAMS)) { errors.push('team must be home/away'); }
    if (!isPosition(value.start)) { errors.push('start must be {x,y}'); }
    if (value.end !== undefined && value.end !== null && !isPosition(value.end)) {
      errors.push('end must be {x,y}/null');
    }
    if (value.playerId !== undefined && value.playerId !== null
      && typeof value.playerId !== 'string') {
      errors.push('playerId must be a string/null');
    }
    if (value.targetPlayerId !== undefined && value.targetPlayerId !== null
      && typeof value.targetPlayerId !== 'string') {
      errors.push('targetPlayerId must be a string/null');
    }
    ['ballSpeed', 'distance', 'xg'].forEach(function (key) {
      if (value[key] !== undefined && value[key] !== null && !isFiniteNumber(value[key])) {
        errors.push(key + ' must be a number/null');
      }
    });
    if (value.outcome !== undefined && value.outcome !== null
      && !inList(value.outcome, EVENT_OUTCOMES)) {
      errors.push('outcome is not valid');
    }
    if (value.intoBox !== undefined && value.intoBox !== null
      && typeof value.intoBox !== 'boolean') {
      errors.push('intoBox must be a boolean/null');
    }
    if (!isConfidence(value.conf)) { errors.push('conf must be 0..1'); }
    if (errors.length) { return joined(errors); }
    return ok(value);
  }

  function validatePlayerMetric(value, index, errors) {
    var path = 'playerMetrics[' + index + ']';
    if (!isObject(value)) { errors.push(path + ' must be an object'); return; }
    if (!isNonEmptyString(value.id)) { errors.push(path + '.id must be a string'); }
    if (!isFiniteNumber(value.distanceKm) || value.distanceKm < 0) {
      errors.push(path + '.distanceKm must be non-negative');
    }
    if (!isFiniteNumber(value.topSpeed) || value.topSpeed < 0) {
      errors.push(path + '.topSpeed must be non-negative');
    }
    if (!isInt(value.sprints) || value.sprints < 0) {
      errors.push(path + '.sprints must be a non-negative integer');
    }
    if (!isConfidence(value.fatigue)) { errors.push(path + '.fatigue must be 0..1'); }
  }

  function validateGrid(value, errors) {
    if (value === null || value === undefined) { return; }
    if (!Array.isArray(value) || value.length !== PITCH_CONTROL_COLS) {
      errors.push('pitchControlGrid must be ' + PITCH_CONTROL_COLS + ' columns');
      return;
    }
    for (var col = 0; col < value.length; col += 1) {
      var column = value[col];
      if (!Array.isArray(column) || column.length !== PITCH_CONTROL_ROWS) {
        errors.push('pitchControlGrid[' + col + '] must be ' + PITCH_CONTROL_ROWS + ' rows');
        return;
      }
      for (var row = 0; row < column.length; row += 1) {
        var cell = column[row];
        if (!isFiniteNumber(cell) || cell < 0 || cell > 1) {
          errors.push('pitchControlGrid[' + col + '][' + row + '] must be 0..1');
          return;
        }
      }
    }
  }

  /**
   * @param {unknown} value
   * @returns {{ok:boolean,value?:AnalyticsMessage,error?:string}}
   */
  function validateAnalyticsMessage(value) {
    if (!isObject(value)) { return fail('$', 'expected an analytics object'); }
    var errors = [];
    if (value.schemaVersion !== SCHEMA_VERSION) {
      errors.push('schemaVersion must be ' + SCHEMA_VERSION);
    }
    if (!isNonEmptyString(value.matchId)) { errors.push('matchId must be a string'); }
    if (!isInt(value.seq)) { errors.push('seq must be an integer'); }
    if (!isInt(value.ts)) { errors.push('ts must be an integer'); }
    if (!isObject(value.score) || !isInt(value.score.home) || !isInt(value.score.away)) {
      errors.push('score must be {home,away} integers');
    }
    if (!isTeamStat(value.possessionPct)) { errors.push('possessionPct must be {home,away}'); }
    if (!isTeamStat(value.xg)) { errors.push('xg must be {home,away}'); }
    if (!isTeamStat(value.xt)) { errors.push('xt must be {home,away}'); }
    if (!isTeamStatInt(value.shots)) { errors.push('shots must be {home,away} integers'); }
    if (!isTeamStatInt(value.passes)) { errors.push('passes must be {home,away} integers'); }
    if (!isObject(value.winProbability)
      || !isFiniteNumber(value.winProbability.home)
      || !isFiniteNumber(value.winProbability.draw)
      || !isFiniteNumber(value.winProbability.away)) {
      errors.push('winProbability must be {home,draw,away}');
    }
    if (!isObject(value.formation)
      || typeof value.formation.home !== 'string'
      || typeof value.formation.away !== 'string') {
      errors.push('formation must be {home,away} strings');
    }
    if (!isTeamStat(value.pitchControl)) { errors.push('pitchControl must be {home,away}'); }
    validateGrid(value.pitchControlGrid, errors);
    if (value.fastestShot !== undefined && value.fastestShot !== null) {
      if (!isObject(value.fastestShot)
        || !isNonEmptyString(value.fastestShot.playerId)
        || !isFiniteNumber(value.fastestShot.speed)) {
        errors.push('fastestShot must be {playerId,speed}/null');
      }
    }
    if (!Array.isArray(value.playerMetrics)) {
      errors.push('playerMetrics must be an array');
    } else {
      for (var i = 0; i < value.playerMetrics.length; i += 1) {
        validatePlayerMetric(value.playerMetrics[i], i, errors);
      }
    }
    if (errors.length) { return joined(errors); }
    return ok(value);
  }

  /**
   * @param {unknown} value
   * @returns {{ok:boolean,value?:CommentaryMessage,error?:string}}
   */
  function validateCommentaryMessage(value) {
    if (!isObject(value)) { return fail('$', 'expected a commentary object'); }
    var errors = [];
    if (value.schemaVersion !== SCHEMA_VERSION) {
      errors.push('schemaVersion must be ' + SCHEMA_VERSION);
    }
    if (!isNonEmptyString(value.matchId)) { errors.push('matchId must be a string'); }
    if (!isInt(value.seq)) { errors.push('seq must be an integer'); }
    if (!isInt(value.ts)) { errors.push('ts must be an integer'); }
    if (typeof value.text !== 'string') { errors.push('text must be a string'); }
    if (!inList(value.source, COMMENTARY_SOURCES)) { errors.push('source is not valid'); }
    if (value.eventId !== undefined && value.eventId !== null
      && typeof value.eventId !== 'string') {
      errors.push('eventId must be a string/null');
    }
    if (errors.length) { return joined(errors); }
    return ok(value);
  }

  // --------------------------------------------------------------------- //
  // Composite payloads
  // --------------------------------------------------------------------- //
  /**
   * Validate a `snapshot` payload, dropping only the invalid list entries.
   * A malformed tracking/analytics block becomes null and is counted.
   *
   * @param {unknown} value
   * @returns {{ok:boolean,value?:Snapshot,error?:string,invalidEntries?:number}}
   */
  function validateSnapshot(value) {
    if (!isObject(value)) { return fail('$', 'expected a snapshot object'); }
    var errors = [];
    if (!isNonEmptyString(value.matchId)) { errors.push('matchId must be a string'); }
    if (typeof value.running !== 'boolean') { errors.push('running must be a boolean'); }
    if (!Array.isArray(value.events)) { errors.push('events must be an array'); }
    if (!Array.isArray(value.commentary)) { errors.push('commentary must be an array'); }
    if (errors.length) { return joined(errors); }

    var invalidEntries = 0;
    var tracking = null;
    if (value.tracking !== null && value.tracking !== undefined) {
      var checkedTracking = validateTrackingMessage(value.tracking);
      if (checkedTracking.ok) { tracking = checkedTracking.value; } else { invalidEntries += 1; }
    }
    var analytics = null;
    if (value.analytics !== null && value.analytics !== undefined) {
      var checkedAnalytics = validateAnalyticsMessage(value.analytics);
      if (checkedAnalytics.ok) { analytics = checkedAnalytics.value; } else { invalidEntries += 1; }
    }

    var events = [];
    for (var i = 0; i < value.events.length; i += 1) {
      var checkedEvent = validateEventMessage(value.events[i]);
      if (checkedEvent.ok) { events.push(checkedEvent.value); } else { invalidEntries += 1; }
    }

    var commentary = [];
    for (var j = 0; j < value.commentary.length; j += 1) {
      var checkedLine = validateCommentaryMessage(value.commentary[j]);
      if (checkedLine.ok) { commentary.push(checkedLine.value); } else { invalidEntries += 1; }
    }

    return ok({
      matchId: value.matchId,
      running: value.running,
      tracking: tracking,
      analytics: analytics,
      events: events,
      commentary: commentary
    }, { invalidEntries: invalidEntries });
  }

  /**
   * @param {unknown} value
   * @returns {{ok:boolean,value?:MatchSummary,error?:string}}
   */
  function validateMatchSummary(value) {
    if (!isObject(value)) { return fail('$', 'expected a match summary'); }
    var errors = [];
    ['matchId', 'homeTeam', 'awayTeam', 'status'].forEach(function (key) {
      if (typeof value[key] !== 'string') { errors.push(key + ' must be a string'); }
    });
    if (!isObject(value.colors)
      || typeof value.colors.home !== 'string'
      || typeof value.colors.away !== 'string') {
      errors.push('colors must be {home,away} strings');
    }
    if (!isObject(value.score) || !isInt(value.score.home) || !isInt(value.score.away)) {
      errors.push('score must be {home,away} integers');
    }
    if (errors.length) { return joined(errors); }
    return ok(value);
  }

  /**
   * @param {unknown} value
   * @returns {{ok:boolean,value?:HealthStatus,error?:string,invalidEntries?:number}}
   */
  function validateHealthStatus(value) {
    if (!isObject(value)) { return fail('$', 'expected a health payload'); }
    var errors = [];
    if (value.status !== 'ok') { errors.push('status must be "ok"'); }
    if (value.pipelineMode !== 'simulator' && value.pipelineMode !== 'video') {
      errors.push('pipelineMode must be simulator/video');
    }
    if (!Array.isArray(value.sources)
      || value.sources.some(function (item) { return typeof item !== 'string'; })) {
      errors.push('sources must be an array of match id strings');
    }
    if (errors.length) { return joined(errors); }

    var ingest = [];
    var invalidEntries = 0;
    if (value.ingestSources !== undefined && value.ingestSources !== null) {
      if (!Array.isArray(value.ingestSources)) {
        return fail('ingestSources', 'must be an array');
      }
      value.ingestSources.forEach(function (entry) {
        if (isObject(entry)
          && isNonEmptyString(entry.sourceId)
          && isNonEmptyString(entry.matchId)
          && inList(entry.kind, SOURCE_KINDS)
          && inList(entry.state, SOURCE_STATES)) {
          ingest.push(entry);
        } else {
          invalidEntries += 1;
        }
      });
    }
    return ok({
      status: 'ok',
      pipelineMode: value.pipelineMode,
      sources: value.sources.slice(),
      ingestSources: ingest
    }, { invalidEntries: invalidEntries });
  }

  /**
   * The backend's `TeamMetadata.to_dict()`: two named, coloured sides. Names are
   * trimmed and capped; colours are the strict `#RRGGBB` the model server
   * accepts, so a malformed value never reaches a CSS custom property.
   *
   * @param {unknown} value
   * @returns {{ok:boolean,value?:TeamIdentity,error?:string}}
   */
  function validateTeamIdentity(value) {
    if (!isObject(value)) { return fail('teams', 'must be {home,away}'); }
    var errors = [];
    var out = {};
    TEAMS.forEach(function (side) {
      var entry = value[side];
      var path = 'teams.' + side;
      if (!isObject(entry)) { errors.push(path + ' must be an object'); return; }
      var name = typeof entry.name === 'string' ? entry.name.trim() : '';
      if (!name) { errors.push(path + '.name must be a non-empty string'); }
      if (name.length > TEAM_NAME_MAX) {
        errors.push(path + '.name must be at most ' + TEAM_NAME_MAX + ' characters');
      }
      if (!isTeamColor(entry.color)) {
        errors.push(path + '.color must be #RRGGBB');
      }
      out[side] = {
        name: name.slice(0, TEAM_NAME_MAX),
        color: normalizeTeamColor(
          entry.color,
          side === 'home' ? HOME_TEAM_COLOR : AWAY_TEAM_COLOR
        )
      };
    });
    if (errors.length) { return joined(errors); }
    return ok(out);
  }

  /**
   * A typed, client-safe failure. `action` is what a human should try next; it
   * is optional because older payloads only carried code and message.
   *
   * @param {unknown} value
   * @returns {{ok:boolean,value?:SourceFailure|null,error?:string}}
   */
  function validateSourceFailure(value) {
    if (value === null || value === undefined) { return ok(null); }
    if (!isObject(value)) { return fail('error', 'must be an object or null'); }
    if (!isNonEmptyString(value.code)) { return fail('error.code', 'must be a string'); }
    if (typeof value.message !== 'string') {
      return fail('error.message', 'must be a string');
    }
    if (value.action !== undefined && value.action !== null
      && typeof value.action !== 'string') {
      return fail('error.action', 'must be a string or null');
    }
    return ok({
      code: value.code.slice(0, 80),
      message: value.message.slice(0, 300),
      action: typeof value.action === 'string' ? value.action.slice(0, 300) : null
    });
  }

  /**
   * `inference.calibration`: phase plus, once calibrated, who did it and how
   * confident the model was. A manual submission reports source "manual".
   *
   * @param {unknown} value
   * @returns {{ok:boolean,value?:CalibrationInfo,error?:string}}
   */
  function validateCalibrationInfo(value) {
    if (!isObject(value)) { return fail('calibration', 'must be an object'); }
    if (!inList(value.phase, CALIBRATION_PHASES)) {
      return fail('calibration.phase', 'must be pending/calibrated/needs_calibration');
    }
    var source = null;
    if (value.source !== null && value.source !== undefined) {
      if (value.source !== 'auto' && value.source !== 'manual') {
        return fail('calibration.source', 'must be auto/manual or null');
      }
      source = value.source;
    }
    var confidence = null;
    if (value.confidence !== null && value.confidence !== undefined) {
      if (!isConfidence(value.confidence)) {
        return fail('calibration.confidence', 'must be 0..1 or null');
      }
      confidence = value.confidence;
    }
    var updatedAt = null;
    if (value.updatedAt !== null && value.updatedAt !== undefined) {
      if (!isFiniteNumber(value.updatedAt)) {
        return fail('calibration.updatedAt', 'must be a number or null');
      }
      updatedAt = value.updatedAt;
    }
    var reason = null;
    if (value.reason !== null && value.reason !== undefined) {
      if (typeof value.reason !== 'string') {
        return fail('calibration.reason', 'must be a string or null');
      }
      reason = value.reason.slice(0, 300);
    }
    return ok({
      phase: value.phase,
      source: source,
      confidence: confidence,
      updatedAt: updatedAt,
      reason: reason
    });
  }

  /**
   * @param {unknown} value
   * @returns {{ok:boolean,value?:InferenceLatency,error?:string}}
   */
  function validateInferenceLatency(value) {
    if (!isObject(value)) { return fail('inference.latency', 'must be an object'); }
    var errors = [];
    ['lastMs', 'averageMs', 'maxMs'].forEach(function (key) {
      var current = value[key];
      if (current !== null && current !== undefined
        && (!isFiniteNumber(current) || current < 0)) {
        errors.push('inference.latency.' + key + ' must be a non-negative number or null');
      }
    });
    if (!isInt(value.samples) || value.samples < 0) {
      errors.push('inference.latency.samples must be a non-negative integer');
    }
    if (errors.length) { return joined(errors); }
    return ok({
      lastMs: isFiniteNumber(value.lastMs) ? value.lastMs : null,
      averageMs: isFiniteNumber(value.averageMs) ? value.averageMs : null,
      maxMs: isFiniteNumber(value.maxMs) ? value.maxMs : null,
      samples: value.samples
    });
  }

  /**
   * Commentary usage, counting how many lines Gemini produced versus the
   * template fallback. No prompt, key or URL is ever part of this block.
   *
   * @param {unknown} value
   * @returns {{ok:boolean,value?:GeminiUsage|null,error?:string}}
   */
  function validateGeminiUsage(value) {
    if (value === null || value === undefined) { return ok(null); }
    if (!isObject(value)) { return fail('inference.gemini', 'must be an object or null'); }
    var errors = [];
    if (typeof value.enabled !== 'boolean') {
      errors.push('inference.gemini.enabled must be a boolean');
    }
    if (value.model !== null && value.model !== undefined
      && typeof value.model !== 'string') {
      errors.push('inference.gemini.model must be a string or null');
    }
    if (value.mode !== 'gemini' && value.mode !== 'template') {
      errors.push('inference.gemini.mode must be gemini/template');
    }
    if (value.lastSource !== null && value.lastSource !== undefined
      && value.lastSource !== 'gemini' && value.lastSource !== 'template') {
      errors.push('inference.gemini.lastSource must be gemini/template or null');
    }
    ['lines', 'geminiLines', 'templateLines', 'geminiErrors', 'eventsConsumed']
      .forEach(function (key) {
        if (!isInt(value[key]) || value[key] < 0) {
          errors.push('inference.gemini.' + key + ' must be a non-negative integer');
        }
      });
    if (errors.length) { return joined(errors); }
    return ok({
      enabled: value.enabled,
      model: typeof value.model === 'string' ? value.model : null,
      mode: value.mode,
      lastSource: (value.lastSource === 'gemini' || value.lastSource === 'template')
        ? value.lastSource : null,
      lines: value.lines,
      geminiLines: value.geminiLines,
      templateLines: value.templateLines,
      geminiErrors: value.geminiErrors,
      eventsConsumed: value.eventsConsumed
    });
  }

  /**
   * `inference`: readiness, calibration and latency for one source. The model
   * server's URL and session token are deliberately absent from the wire, so
   * there is nothing to validate for them here.
   *
   * @param {unknown} value
   * @returns {{ok:boolean,value?:InferenceStatus,error?:string}}
   */
  function validateInferenceStatus(value) {
    if (!isObject(value)) { return fail('inference', 'must be an object'); }
    var errors = [];
    if (typeof value.enabled !== 'boolean') {
      errors.push('inference.enabled must be a boolean');
    }
    ['ready', 'reachable'].forEach(function (key) {
      if (value[key] !== null && value[key] !== undefined
        && typeof value[key] !== 'boolean') {
        errors.push('inference.' + key + ' must be a boolean or null');
      }
    });
    if (value.checkedAt !== null && value.checkedAt !== undefined
      && !isFiniteNumber(value.checkedAt)) {
      errors.push('inference.checkedAt must be a number or null');
    }
    if (value.detail !== null && value.detail !== undefined
      && typeof value.detail !== 'string') {
      errors.push('inference.detail must be a string or null');
    }
    if (errors.length) { return joined(errors); }
    var calibration = validateCalibrationInfo(value.calibration);
    if (!calibration.ok) { return calibration; }
    var latency = validateInferenceLatency(value.latency);
    if (!latency.ok) { return latency; }
    var gemini = validateGeminiUsage(value.gemini);
    if (!gemini.ok) { return gemini; }
    var failure = validateSourceFailure(value.error);
    if (!failure.ok) { return failure; }
    return ok({
      enabled: value.enabled,
      ready: typeof value.ready === 'boolean' ? value.ready : null,
      reachable: typeof value.reachable === 'boolean' ? value.reachable : null,
      checkedAt: isFiniteNumber(value.checkedAt) ? value.checkedAt : null,
      detail: typeof value.detail === 'string' ? value.detail.slice(0, 300) : null,
      calibration: calibration.value,
      latency: latency.value,
      gemini: gemini.value,
      error: failure.value
    });
  }

  /**
   * The retained first frame. Only a same-origin path under this source may be
   * fetched; the dashboard never accepts an absolute or protocol-relative URL.
   *
   * @param {unknown} value
   * @returns {{ok:boolean,value?:CalibrationPreview,error?:string}}
   */
  function validateCalibrationPreview(value) {
    if (!isObject(value)) { return fail('calibrationPreview', 'must be an object'); }
    if (typeof value.available !== 'boolean') {
      return fail('calibrationPreview.available', 'must be a boolean');
    }
    if (value.bytes !== undefined && value.bytes !== null
      && (!isInt(value.bytes) || value.bytes < 0)) {
      return fail('calibrationPreview.bytes', 'must be a non-negative integer');
    }
    if (value.capturedAt !== null && value.capturedAt !== undefined
      && !isFiniteNumber(value.capturedAt)) {
      return fail('calibrationPreview.capturedAt', 'must be a number or null');
    }
    var url = typeof value.url === 'string' ? value.url : '';
    if (url && !/^\/ingest\/sources\/[A-Za-z0-9._-]+\/calibration-preview$/.test(url)) {
      return fail('calibrationPreview.url', 'must be a same-origin preview path');
    }
    return ok({
      available: value.available,
      capturedAt: isFiniteNumber(value.capturedAt) ? value.capturedAt : null,
      bytes: isInt(value.bytes) ? value.bytes : 0,
      url: value.available ? url : '',
      // Frame quality from the model server: the best available still may be a
      // pre-match graphic, and the card has to say so instead of pretending.
      quality: ratioOrNull(value.quality),
      lowConfidence: value.lowConfidence === true
    });
  }

  /**
   * `calibrationSuggestions`: auto-detected pitch points for a source that is
   * waiting for a human decision. Items are leniently filtered: a suggestion
   * whose points would not define a homography is dropped here, so the
   * confirmation UI can never offer points the backend would reject.
   *
   * @param {unknown} value
   * @returns {{ok:boolean,value?:CalibrationSuggestions,error?:string}}
   */
  function validateCalibrationSuggestions(value) {
    if (value === undefined || value === null) { return ok(null); }
    if (!isObject(value)) { return fail('calibrationSuggestions', 'must be an object'); }
    if (!inList(value.state, SUGGESTION_STATES)) {
      return fail('calibrationSuggestions.state', 'is not a known suggestion state');
    }
    if (typeof value.available !== 'boolean') {
      return fail('calibrationSuggestions.available', 'must be a boolean');
    }
    if (value.count !== undefined && value.count !== null
      && (!isInt(value.count) || value.count < 0)) {
      return fail('calibrationSuggestions.count', 'must be a non-negative integer');
    }
    if (value.generatedAt !== null && value.generatedAt !== undefined
      && !isFiniteNumber(value.generatedAt)) {
      return fail('calibrationSuggestions.generatedAt', 'must be a number or null');
    }
    var items = [];
    if (Array.isArray(value.items)) {
      value.items.forEach(function (item) {
        if (items.length >= SUGGESTION_MAX_ITEMS || !isObject(item)) { return; }
        if (!isInt(item.index) || item.index < 0) { return; }
        if (!isInt(item.frameIndex) || item.frameIndex < 0) { return; }
        if (!isFiniteNumber(item.confidence) || item.confidence < 0
          || item.confidence > 1) { return; }
        var points = validateCalibrationPoints(item.points, null);
        if (!points.ok) { return; }
        var url = typeof item.previewUrl === 'string' ? item.previewUrl : '';
        if (url && !SUGGESTION_PREVIEW_RE.test(url)) { return; }
        var landmarks = [];
        if (Array.isArray(item.landmarks)) {
          item.landmarks.forEach(function (name) {
            landmarks.push(typeof name === 'string' ? name.slice(0, 60) : '');
          });
        }
        items.push({
          index: item.index,
          frameIndex: item.frameIndex,
          confidence: item.confidence,
          points: points.value,
          landmarks: landmarks,
          previewUrl: item.previewAvailable === false ? '' : url,
          message: typeof item.message === 'string' ? item.message.slice(0, 240) : '',
          quality: ratioOrNull(item.quality),
          lowVisibility: item.lowVisibility === true
        });
      });
    }
    return ok({
      state: value.state,
      available: value.available && items.length > 0,
      count: items.length,
      generatedAt: isFiniteNumber(value.generatedAt) ? value.generatedAt : null,
      // How many media seconds the last sweep or seek scan actually looked at,
      // and how good the best sampled frame was: the empty-state copy needs both.
      scannedSeconds: isFiniteNumber(value.scannedSeconds) && value.scannedSeconds >= 0
        ? value.scannedSeconds
        : 0,
      quality: ratioOrNull(value.quality),
      lowConfidence: value.lowConfidence === true,
      items: items
    });
  }

  /**
   * @param {unknown} value
   * @returns {{ok:boolean,value?:IngestSourceStatus,error?:string}}
   */
  function validateSourceStatus(value) {
    if (!isObject(value)) { return fail('$', 'expected a source status'); }
    var errors = [];
    if (!isNonEmptyString(value.sourceId)) { errors.push('sourceId must be a string'); }
    if (!isNonEmptyString(value.matchId)) { errors.push('matchId must be a string'); }
    if (!inList(value.kind, SOURCE_KINDS)) { errors.push('kind must be upload/rtsp'); }
    if (!inList(value.state, SOURCE_STATES)) { errors.push('state is not valid'); }
    if (typeof value.running !== 'boolean') { errors.push('running must be a boolean'); }
    if (!isObject(value.hls)) {
      errors.push('hls must be an object');
    } else {
      if (typeof value.hls.ready !== 'boolean') { errors.push('hls.ready must be a boolean'); }
      if (typeof value.hls.manifest !== 'string') {
        errors.push('hls.manifest must be a string');
      }
      if (!isInt(value.hls.segments) || value.hls.segments < 0) {
        errors.push('hls.segments must be a non-negative integer');
      }
      if (value.hls.error !== undefined && value.hls.error !== null
        && !isObject(value.hls.error)) {
        errors.push('hls.error must be an object or null');
      }
    }
    if (errors.length) { return joined(errors); }

    var teams = null;
    if (value.teams !== undefined && value.teams !== null) {
      var checkedTeams = validateTeamIdentity(value.teams);
      if (!checkedTeams.ok) { return checkedTeams; }
      teams = checkedTeams.value;
    }
    var inference = null;
    if (value.inference !== undefined && value.inference !== null) {
      var checkedInference = validateInferenceStatus(value.inference);
      if (!checkedInference.ok) { return checkedInference; }
      inference = checkedInference.value;
    }
    var preview = null;
    if (value.calibrationPreview !== undefined && value.calibrationPreview !== null) {
      var checkedPreview = validateCalibrationPreview(value.calibrationPreview);
      if (!checkedPreview.ok) { return checkedPreview; }
      preview = checkedPreview.value;
    }
    var suggestions = validateCalibrationSuggestions(value.calibrationSuggestions);
    if (!suggestions.ok) { return suggestions; }
    var failure = validateSourceFailure(value.error);
    if (!failure.ok) { return failure; }
    var hlsFailure = isObject(value.hls) ? validateSourceFailure(value.hls.error) : ok(null);
    if (!hlsFailure.ok) { return hlsFailure; }
    var history = [];
    if (Array.isArray(value.stateHistory)) {
      value.stateHistory.forEach(function (entry) {
        if (typeof entry === 'string' && inList(entry, SOURCE_STATES)) {
          history.push(entry);
        }
      });
    }
    return ok({
      sourceId: value.sourceId,
      matchId: value.matchId,
      kind: value.kind,
      state: value.state,
      running: value.running,
      createdAt: isFiniteNumber(value.createdAt) ? value.createdAt : null,
      startedAt: isFiniteNumber(value.startedAt) ? value.startedAt : null,
      endedAt: isFiniteNumber(value.endedAt) ? value.endedAt : null,
      stateHistory: history,
      media: isObject(value.media) ? value.media : null,
      rtsp: isObject(value.rtsp) ? value.rtsp : null,
      hls: {
        ready: value.hls.ready,
        manifest: value.hls.manifest,
        segments: value.hls.segments,
        error: hlsFailure.value
      },
      pipeline: isObject(value.pipeline) ? value.pipeline : null,
      teams: teams,
      inference: inference,
      calibrationPreview: preview,
      calibrationSuggestions: suggestions.value,
      error: failure.value,
      streaming: isObject(value.streaming) ? value.streaming : null
    });
  }

  /**
   * `GET /ingest/sources/{id}/inference`: the same source projection without
   * counters, HLS or media. Never contains a session token or model URL.
   *
   * @param {unknown} value
   * @returns {{ok:boolean,value?:Object,error?:string}}
   */
  function validateInferenceResponse(value) {
    if (!isObject(value)) { return fail('$', 'expected an inference response'); }
    var errors = [];
    if (!isNonEmptyString(value.sourceId)) { errors.push('sourceId must be a string'); }
    if (!isNonEmptyString(value.matchId)) { errors.push('matchId must be a string'); }
    if (!inList(value.state, SOURCE_STATES)) { errors.push('state is not valid'); }
    if (typeof value.running !== 'boolean') { errors.push('running must be a boolean'); }
    if (errors.length) { return joined(errors); }
    var teams = validateTeamIdentity(value.teams);
    if (!teams.ok) { return teams; }
    var inference = validateInferenceStatus(value.inference);
    if (!inference.ok) { return inference; }
    var preview = validateCalibrationPreview(value.calibrationPreview);
    if (!preview.ok) { return preview; }
    return ok({
      sourceId: value.sourceId,
      matchId: value.matchId,
      state: value.state,
      running: value.running,
      teams: teams.value,
      inference: inference.value,
      calibrationPreview: preview.value
    });
  }

  /**
   * `POST /ingest/sources/{id}/calibration`: the updated calibration and
   * inference state. Absent `calibration`/`inference` blocks are an error, not
   * a silent success, because this call is the one that unlocks analytics.
   *
   * @param {unknown} value
   * @returns {{ok:boolean,value?:Object,error?:string}}
   */
  function validateCalibrationResponse(value) {
    if (!isObject(value)) { return fail('$', 'expected a calibration response'); }
    var errors = [];
    if (!isNonEmptyString(value.sourceId)) { errors.push('sourceId must be a string'); }
    if (!isNonEmptyString(value.matchId)) { errors.push('matchId must be a string'); }
    if (!inList(value.state, SOURCE_STATES)) { errors.push('state is not valid'); }
    if (typeof value.running !== 'boolean') { errors.push('running must be a boolean'); }
    if (errors.length) { return joined(errors); }
    var teams = validateTeamIdentity(value.teams);
    if (!teams.ok) { return teams; }
    var calibration = validateCalibrationInfo(value.calibration);
    if (!calibration.ok) { return calibration; }
    var inference = validateInferenceStatus(value.inference);
    if (!inference.ok) { return inference; }
    return ok({
      sourceId: value.sourceId,
      matchId: value.matchId,
      state: value.state,
      running: value.running,
      teams: teams.value,
      calibration: calibration.value,
      inference: inference.value
    });
  }

  /**
   * Validate manual correspondences before they leave the browser. The backend
   * remains the authority; this only stops a selection that cannot possibly be
   * accepted (too few, duplicate, outlier or collinear) from a round trip.
   *
   * @param {unknown} points
   * @param {{width:number,height:number}} [image] Natural preview size.
   * @returns {{ok:boolean,value?:CalibrationPoint[],error?:string}}
   */
  function validateCalibrationPoints(points, image) {
    if (!Array.isArray(points)) { return fail('points', 'must be an array'); }
    if (points.length < CALIBRATION_MIN_POINTS) {
      return fail('points', 'select at least ' + CALIBRATION_MIN_POINTS + ' landmarks');
    }
    if (points.length > CALIBRATION_MAX_POINTS) {
      return fail('points', 'select at most ' + CALIBRATION_MAX_POINTS + ' landmarks');
    }
    var width = image && isFiniteNumber(image.width) ? image.width : null;
    var height = image && isFiniteNumber(image.height) ? image.height : null;
    var out = [];
    var imagePairs = [];
    var pitchPairs = [];
    for (var index = 0; index < points.length; index += 1) {
      var point = points[index];
      var path = 'points[' + index + ']';
      if (!isObject(point)) { return fail(path, 'must be an object'); }
      if (!isFiniteNumber(point.imageX) || !isFiniteNumber(point.imageY)) {
        return fail(path, 'imageX/imageY must be finite');
      }
      if (width !== null && (point.imageX < 0 || point.imageX > width)) {
        return fail(path, 'imageX is outside the preview');
      }
      if (height !== null && (point.imageY < 0 || point.imageY > height)) {
        return fail(path, 'imageY is outside the preview');
      }
      if (!isFiniteNumber(point.pitchX) || !isFiniteNumber(point.pitchY)) {
        return fail(path, 'pitchX/pitchY must be finite');
      }
      if (Math.abs(point.pitchX) > PITCH_HALF_LENGTH
        || Math.abs(point.pitchY) > PITCH_HALF_WIDTH) {
        return fail(path, 'pitch point is outside the pitch');
      }
      out.push({
        imageX: Math.round(point.imageX * 100) / 100,
        imageY: Math.round(point.imageY * 100) / 100,
        pitchX: Math.round(point.pitchX * 100) / 100,
        pitchY: Math.round(point.pitchY * 100) / 100
      });
      imagePairs.push([point.imageX, point.imageY]);
      pitchPairs.push([point.pitchX, point.pitchY]);
    }
    if (!hasSpread(imagePairs)) { return fail('points', 'image points are collinear'); }
    if (!hasSpread(pitchPairs)) { return fail('points', 'pitch landmarks are collinear'); }
    return ok(out);
  }

  /**
   * Convert a pointer position on the responsive preview into the JPEG's
   * natural pixel space. The rendered box and the natural size differ as soon
   * as CSS scales the image, so the ratio is applied before anything is sent
   * to the backend.
   *
   * @param {number} clientX
   * @param {number} clientY
   * @param {{left:number,top:number,width:number,height:number}} rect
   * @param {number} naturalWidth
   * @param {number} naturalHeight
   * @returns {{x:number,y:number}}
   */
  function imagePointToNatural(clientX, clientY, rect, naturalWidth, naturalHeight) {
    if (!rect || !isFiniteNumber(rect.left) || !isFiniteNumber(rect.top)
      || !isFiniteNumber(rect.width) || !isFiniteNumber(rect.height)
      || rect.width <= 0 || rect.height <= 0
      || !isFiniteNumber(naturalWidth) || !isFiniteNumber(naturalHeight)
      || naturalWidth <= 0 || naturalHeight <= 0) {
      return { x: 0, y: 0 };
    }
    var x = (clientX - rect.left) / rect.width * naturalWidth;
    var y = (clientY - rect.top) / rect.height * naturalHeight;
    return {
      x: Math.round(clampNumber(x, 0, naturalWidth) * 100) / 100,
      y: Math.round(clampNumber(y, 0, naturalHeight) * 100) / 100
    };
  }

  /**
   * Which gate card the dashboard shows for one source. `needs_calibration` is
   * running and non-terminal: with a retained preview it becomes the guided
   * calibration step, without one the source is still preparing. A live source
   * stays in `preparing` while its configured model is loading, so the analytics
   * desk never opens on tracking that has no inference behind it. Terminal
   * sources are viewable after the fact even if the model never became ready.
   * A source with a match but no ingest state is a simulator, and it is ready
   * immediately.
   *
   * @param {IngestSourceStatus|null|undefined} source
   * @returns {"source"|"preparing"|"calibration"|"failed"|"ready"}
   */
  function sourceGatePhase(source) {
    if (!source || !isNonEmptyString(source.matchId)) { return 'source'; }
    if (source.state === 'failed') { return 'failed'; }
    if (!isNonEmptyString(source.state)) { return 'ready'; }
    if (source.state === 'ended' || source.state === 'stopped') { return 'ready'; }
    var inference = isObject(source.inference) ? source.inference : null;
    var calibration = inference && isObject(inference.calibration)
      ? inference.calibration : null;
    // The source state is authoritative; a stale calibration phase only gates
    // while a model is actually configured.
    if (source.state === 'needs_calibration'
      || (inference && inference.enabled === true && calibration
        && calibration.phase === 'needs_calibration')) {
      return calibrationPreviewAvailable(source) ? 'calibration' : 'preparing';
    }
    if (source.state === 'live') {
      // Model-loading is not a source state, so it is read from readiness: an
      // enabled model that is not ready yet keeps the desk closed.
      if (inference && inference.enabled === true && inference.ready !== true) {
        return 'preparing';
      }
      return 'ready';
    }
    return 'preparing';
  }

  /**
   * @param {unknown} value
   * @returns {{ok:boolean,value?:IngestSourceStatus,error?:string}}
   */
  function validateSourceEnvelope(value) {
    if (!isObject(value)) { return fail('$', 'expected an object'); }
    return validateSourceStatus(value.source);
  }

  /**
   * @param {unknown} value
   * @returns {{ok:boolean,value?:{sources:IngestSourceStatus[]},error?:string,invalidEntries?:number}}
   */
  function validateSourceList(value) {
    if (!isObject(value) || !Array.isArray(value.sources)) {
      return fail('$', 'expected {sources: []}');
    }
    var sources = [];
    var invalidEntries = 0;
    value.sources.forEach(function (entry) {
      var checked = validateSourceStatus(entry);
      if (checked.ok) { sources.push(checked.value); } else { invalidEntries += 1; }
    });
    return ok({ sources: sources }, { invalidEntries: invalidEntries });
  }

  /**
   * @param {unknown} value
   * @returns {{ok:boolean,value?:{matchId:string,status:string},error?:string}}
   */
  function validateSimulatorResponse(value) {
    if (!isObject(value)) { return fail('$', 'expected a simulator response'); }
    if (!isNonEmptyString(value.matchId)) { return fail('matchId', 'must be a string'); }
    if (typeof value.status !== 'string') { return fail('status', 'must be a string'); }
    return ok(value);
  }

  // --------------------------------------------------------------------- //
  // Copy helpers
  // --------------------------------------------------------------------- //
  function deepClone(value) {
    if (value === null || typeof value !== 'object') { return value; }
    if (Array.isArray(value)) { return value.map(deepClone); }
    var out = {};
    Object.keys(value).forEach(function (key) { out[key] = deepClone(value[key]); });
    return out;
  }

  function deepFreeze(value) {
    if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
      return value;
    }
    Object.keys(value).forEach(function (key) { deepFreeze(value[key]); });
    return Object.freeze(value);
  }

  /**
   * A CSS-safe colour: only #rgb/#rrggbb/#rrggbbaa survive. The backend owns
   * the palette, but a malformed value must never reach a style attribute.
   *
   * @param {unknown} value
   * @param {string} fallback
   * @returns {string}
   */
  function safeColor(value, fallback) {
    if (typeof value === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(value)) {
      return value;
    }
    return fallback;
  }

  return Object.freeze({
    SCHEMA_VERSION: SCHEMA_VERSION,
    PITCH_CONTROL_COLS: PITCH_CONTROL_COLS,
    PITCH_CONTROL_ROWS: PITCH_CONTROL_ROWS,
    HOME_TEAM_COLOR: HOME_TEAM_COLOR,
    AWAY_TEAM_COLOR: AWAY_TEAM_COLOR,
    PITCH_HALF_LENGTH: PITCH_HALF_LENGTH,
    PITCH_HALF_WIDTH: PITCH_HALF_WIDTH,
    CALIBRATION_MIN_POINTS: CALIBRATION_MIN_POINTS,
    CALIBRATION_MAX_POINTS: CALIBRATION_MAX_POINTS,
    validateCalibrationSuggestions: validateCalibrationSuggestions,
    TEAM_NAME_MAX: TEAM_NAME_MAX,
    CALIBRATION_LANDMARKS: CALIBRATION_LANDMARKS,
    REQUIRED_FIELDS: REQUIRED_FIELDS,
    TEAMS: TEAMS,
    ROLES: ROLES,
    EVENT_STATUSES: EVENT_STATUSES,
    EVENT_TYPES: EVENT_TYPES,
    EVENT_OUTCOMES: EVENT_OUTCOMES,
    SOURCE_KINDS: SOURCE_KINDS,
    SOURCE_STATES: SOURCE_STATES,
    RUNNING_SOURCE_STATES: RUNNING_SOURCE_STATES,
    TERMINAL_SOURCE_STATES: TERMINAL_SOURCE_STATES,
    CALIBRATION_PHASES: CALIBRATION_PHASES,
    validateTrackingMessage: validateTrackingMessage,
    validateEventMessage: validateEventMessage,
    validateAnalyticsMessage: validateAnalyticsMessage,
    validateCommentaryMessage: validateCommentaryMessage,
    validateSnapshot: validateSnapshot,
    validateMatchSummary: validateMatchSummary,
    validateHealthStatus: validateHealthStatus,
    validateTeamIdentity: validateTeamIdentity,
    validateSourceFailure: validateSourceFailure,
    validateCalibrationInfo: validateCalibrationInfo,
    validateInferenceStatus: validateInferenceStatus,
    validateCalibrationPreview: validateCalibrationPreview,
    validateSourceStatus: validateSourceStatus,
    validateSourceEnvelope: validateSourceEnvelope,
    validateSourceList: validateSourceList,
    validateSimulatorResponse: validateSimulatorResponse,
    validateInferenceResponse: validateInferenceResponse,
    validateCalibrationResponse: validateCalibrationResponse,
    validateCalibrationPoints: validateCalibrationPoints,
    imagePointToNatural: imagePointToNatural,
    sourceGatePhase: sourceGatePhase,
    calibrationPreviewAvailable: calibrationPreviewAvailable,
    isSourceRunning: isSourceRunning,
    isSourceTerminal: isSourceTerminal,
    isTeamColor: isTeamColor,
    normalizeTeamColor: normalizeTeamColor,
    deepClone: deepClone,
    deepFreeze: deepFreeze,
    safeColor: safeColor,
    isObject: isObject,
    isFiniteNumber: isFiniteNumber,
    isInt: isInt
  });
});
