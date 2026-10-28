# ⚽ Sports Craft Engine - Real-Time Football Analytics Platform
 
Sports Craft Engine is an advanced real-time football (soccer) match analysis platform that combines computer vision, AI, and interactive visualization to provide comprehensive match insights, live commentary, player tracking, and tactical analysis.
 
---
 
## 🎥 Project Demo
 
<div align="center">
 
### Sports Craft Engine Demo
 
<video src="./demo.mp4" controls autoplay muted loop width="900">
  Your browser does not support the video tag.
</video>
 
</div>

>
<p align="center">
  <img src="./Demo.gif" alt="Sports Craft Engine Demo" width="100%">
</p>

---
 
## 🏗️ Architecture
 
<div align="center">
 
<img src="./sportscraft_engine_architecture_detailed (1).png" alt="Sports Craft Engine Architecture" width="1000"/>
 
</div>
 
---
 
## 🌟 Features


### Core Analytics
- **Real-time Player Tracking** - Track all players on the pitch with identity recognition
- **Ball Tracking** - Monitor ball position, speed, and trajectory
- **Team Analytics** - Possession percentages, pass completion, distance covered
- **Heat Maps** - Visualize player and team movement patterns
- **Passing Networks** - Analyze team passing connections and patterns

### AI-Powered Features
- **AI Commentary Generation** - Multi-persona commentary (tactical, hype, radio) powered by Gemini AI
- **Multi-language Support** - Commentary in 8 languages (EN, ES, FR, DE, AR, PT, JA, IT)
- **Event Detection** - Automatic detection of goals, shots, saves, fouls, cards
- **xG Calculation** - Expected goals analysis for shots
- **Tactical Analysis** - AI-powered reasoning for key events
- **Meme Generator** - Auto-generate shareable match moment memes
- **Highlight Clips** - Automatic highlight generation from match footage
- **Half-time Summary** - Comprehensive AI-generated first-half analysis

### Video Processing
- **Multiple Input Sources**:
  - Video file upload (MP4, MOV, MKV, AVI, WebM, M4V, TS)
  - RTSP live streams
  - Built-in match simulator
- **HLS Streaming** - Live preview with adaptive bitrate
- **Pitch Calibration** - Manual and automatic camera calibration

### Interactive Dashboard
- **3D Pitch Visualization** - Interactive Three.js-powered field view
- **Real-time Updates** - WebSocket-based live data streaming
- **Side-by-side View** - Compare live video with analytics overlay
- **Multiple Camera Modes** - Different viewing angles and perspectives
- **AR Overlays** - Augmented reality tactical overlays

## 🏗️ Architecture

```
┌─────────────────┐
│   Dashboard     │  ← HTML/CSS/JavaScript (Three.js, WebSocket)
│   (Frontend)    │
└────────┬────────┘
         │
         ↓ WebSocket (/live) + REST API
┌─────────────────┐
│   Backend       │  ← FastAPI + Socket.IO
│  (Python)       │
└────────┬────────┘
         │
         ├─→ Computer Vision (YOLO/Mock)
         ├─→ Gemini AI (Commentary, Analysis)
         ├─→ SQLite Database
         └─→ FFmpeg (Video Processing)
```

## 📋 Prerequisites

### Backend Requirements
- Python 3.8 or higher
- FFmpeg and FFprobe
- YOLO model (for real video processing)
- Gemini API key (for AI features)

### System Dependencies
```bash
# Ubuntu/Debian
sudo apt-get update
sudo apt-get install ffmpeg python3-pip

# macOS
brew install ffmpeg python3
```

## 🚀 Quick Start

### 1. Clone the Repository
```bash
git clone https://github.com/yourusername/provision-ai.git
cd provision-ai
```

### 2. Backend Setup

#### Install Python Dependencies
```bash
cd Backend
pip install -r requirements.txt
```

#### Configure Environment
Create a `.env` file in the `Backend` directory:
```bash
# API Security
API_KEY=your-secret-key-here
ALLOW_ANON_TOKEN=true

# Gemini AI (optional but recommended)
GEMINI_API_KEY=your-gemini-api-key
GEMINI_MODEL=gemini-2.0-flash-exp

# Vision Backend
VISION_BACKEND=mock  # Use 'yolo' for real video processing

# Team Configuration
HOME_NAME=Auckland FC
AWAY_NAME=Newcastle Jets
HOME_COLOR=#3b82f6
AWAY_COLOR=#eab308

# CORS Origins
CORS_ORIGINS=http://localhost:8000,http://localhost:5173,http://127.0.0.1:8000

# Data Directory
DATA_DIR=./data

# Upload Settings
UPLOAD_MAX_MB=2048
UPLOAD_MAX_SECONDS=7200

# RTSP Settings (for live streams)
RTSP_ENABLED=true
RTSP_ALLOW_PRIVATE=true
RTSP_ALLOW_LOOPBACK=false

# Simulator Settings
SIM_CLOCK_SCALE=10.0

# Video Processing
PROC_FPS=25.0
PROC_WIDTH=1280
RESULTS_FPS=10.0
TRACKING_MAX_HZ=25.0
```

#### Run the Backend
```bash
# From the Backend directory
uvicorn app.main:asgi --host 0.0.0.0 --port 8000
```

The API will be available at `http://localhost:8000`

### 3. Dashboard Setup

#### Option 1: Serve via Backend (Recommended)
If the Dashboard directory is at `../Dashboard` relative to Backend, it will be automatically served at:
```
http://localhost:8000/dashboard/
```

#### Option 2: Use a Separate Web Server
```bash
cd Dashboard
python3 -m http.server 5173
# Dashboard available at http://localhost:5173
```

### 4. Access the Application

1. Open your browser and navigate to:
   - `http://localhost:8000/dashboard/` (if using backend serving)
   - `http://localhost:5173` (if using separate server)

2. The dashboard will prompt you to configure the API endpoint (default: `http://localhost:8000`)

3. Get an authentication token:
   - Click "Health Check" to verify backend connectivity
   - The system will automatically create a read token

4. Choose your match source:
   - **Simulator**: Start a synthetic match for testing
   - **Upload Video**: Analyze a recorded match
   - **RTSP Stream**: Connect to a live camera feed
   - **Demo Mode**: Try the offline demo with no backend

## 📖 Usage Guide

### Starting a Simulated Match
1. Click "Source Control" in the dashboard
2. Enter a match ID (e.g., `demo-match`)
3. Click "Start Simulator"
4. Watch real-time analytics appear on the 3D pitch

### Uploading a Video
1. Click "Source Control" → "Upload Video"
2. Select your video file (supported: MP4, MOV, MKV, AVI, WebM)
3. Configure team names and colors (optional)
4. Click "Start Upload"
5. Wait for processing to complete
6. Analytics will stream as the video is processed

### Using RTSP Live Stream
1. Click "Source Control" → "RTSP Stream"
2. Enter your RTSP URL (e.g., `rtsp://camera-ip:554/stream`)
3. Configure team names and colors
4. Click "Connect"
5. Calibrate the camera view if needed

### Generating AI Commentary
1. During a live match, click the "🎤 Commentary" button on any event
2. Select your preferred persona (Tactical, Hype, Radio)
3. Choose language (English, Spanish, French, German, Arabic, Portuguese, Japanese, Italian)
4. Enable "With Audio" for text-to-speech commentary
5. Click "Generate"

### Creating Highlights
1. Click "🎬 Social Highlights" during or after a match
2. Select an event from the timeline
3. The system will generate a short video clip with captions
4. Download and share on social media

### Viewing Tactical Analysis
1. Click "🧠 Reasoning" on key events (goals, shots)
2. View AI-powered analysis including:
   - Tactical summary
   - Spatial analysis
   - Counter-attacking assessment
   - Performance rating

## 🔌 API Documentation

### REST Endpoints

#### Health Check
```bash
GET /health
```
Returns system status and active sources.

#### Create Match
```bash
POST /matches
Authorization: Bearer <token>
Content-Type: application/json

{
  "home": "Team A",
  "away": "Team B"
}
```

#### Start Simulator
```bash
POST /simulator/{match_id}/start
Authorization: Bearer <token>
```

#### Upload Video
```bash
POST /sources/upload
Authorization: Bearer <token>
Content-Type: multipart/form-data

file=@video.mp4
```

#### Connect RTSP Stream
```bash
POST /sources/rtsp
Authorization: Bearer <token>
Content-Type: application/json

{
  "url": "rtsp://camera-ip:554/stream"
}
```

#### Generate Commentary
```bash
POST /commentary/generate
Content-Type: application/json

{
  "matchId": "match123",
  "score": "Home 2-1 Away",
  "minute": 45,
  "eventType": "goal",
  "player": "#10 Player Name",
  "speed": 85.0,
  "xg": 0.35,
  "language": "en",
  "withAudio": true,
  "audioPersona": "hype"
}
```

### WebSocket API

Connect to `ws://localhost:8000/socket.io/?EIO=4&transport=websocket`

#### Join Match
```javascript
socket.emit('join', { matchId: 'match123' });
```

#### Events
- `snapshot` - Initial match state
- `tracking` - Player and ball positions (25 Hz)
- `analytics` - Team statistics (10 Hz)
- `events` - Match events (goals, fouls, etc.)
- `commentary` - AI-generated commentary lines
- `source` - Source status updates

## 🛠️ Development

### Project Structure
```
Hackathon-main/
├── Backend/
│   ├── app/
│   │   ├── main.py              # FastAPI application
│   │   ├── config.py            # Configuration management
│   │   ├── db.py                # Database operations
│   │   ├── hub.py               # Match session management
│   │   ├── simulator.py         # Match simulator
│   │   ├── gemini_service.py    # AI commentary service
│   │   ├── highlighter.py       # Highlight generation
│   │   ├── reasoning.py         # Tactical analysis
│   │   ├── meme_generator.py    # Meme creation
│   │   ├── halftime_summary.py  # Half-time reports
│   │   ├── analytics.py         # Statistics engine
│   │   ├── events.py            # Event detection
│   │   ├── geometry.py          # Pitch geometry
│   │   ├── models.py            # Data models
│   │   ├── security.py          # Authentication
│   │   └── sources.py           # Video source management
│   ├── contract/                # JSON schemas
│   ├── examples/                # Example clients
│   └── requirements.txt         # Python dependencies
├── Dashboard/
│   ├── provision.js             # Main dashboard logic
│   ├── provision.css            # Styles
│   ├── dashboard-contract.js    # Data validation
│   ├── dashboard-demo.js        # Offline demo mode
│   └── Sports Craft Engine – Live Match.html  # Main HTML
└── README.md
```

### Running Tests
```bash
cd Backend
pytest tests/
```

### Code Style
```bash
# Format code
black app/

# Lint
flake8 app/
```

## 🔒 Security

- **API Key Authentication**: Secure master key for admin operations
- **JWT Tokens**: Time-limited tokens for client access
- **CORS Protection**: Configurable allowed origins
- **Input Validation**: All inputs validated against JSON schemas
- **File Upload Limits**: Configurable size and duration limits
- **RTSP Filtering**: IP allowlisting for stream sources

## 🐛 Troubleshooting

### Backend won't start
- Check Python version: `python --version` (must be 3.8+)
- Verify all dependencies: `pip install -r requirements.txt`
- Check FFmpeg installation: `ffmpeg -version`
- Review logs in console

### Dashboard shows "Offline"
- Verify backend is running on port 8000
- Check CORS settings in `.env`
- Inspect browser console for errors
- Confirm API base URL in dashboard settings

### Video upload fails
- Check file size (default limit: 2048 MB)
- Verify file format is supported
- Ensure sufficient disk space in `DATA_DIR`
- Check FFmpeg can process the file: `ffprobe video.mp4`

### No AI commentary generated
- Verify `GEMINI_API_KEY` is set in `.env`
- Check Gemini API quota and billing
- Review backend logs for API errors
- Ensure model name is correct (`gemini-2.0-flash-exp`)

### RTSP stream won't connect
- Verify RTSP URL is accessible: `ffplay rtsp://...`
- Check firewall settings
- Enable RTSP in `.env`: `RTSP_ENABLED=true`
- Review IP filtering settings

## 📊 Performance

- **Tracking Rate**: Up to 25 Hz
- **Analytics Rate**: 10 Hz
- **Event Detection**: Real-time (<100ms latency)
- **Commentary Generation**: 1-3 seconds
- **Video Processing**: Real-time to 2x speed (depends on hardware)
- **Concurrent Matches**: Limited by CPU/GPU

## 🤝 Contributing

Contributions are welcome! Please follow these steps:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

Please ensure:
- Code follows project style guidelines
- All tests pass
- Documentation is updated
- Commit messages are clear

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 👏 Acknowledgments

- **Three.js** - 3D visualization
- **FastAPI** - Modern web framework
- **Socket.IO** - Real-time communication
- **Google Gemini** - AI commentary and analysis
- **YOLO** - Object detection (optional)
- **FFmpeg** - Video processing

## 📧 Contact

For questions, issues, or collaboration:
- Open an issue on GitHub
- Email: your-email@example.com
- Project Link: https://github.com/yourusername/provision-ai

---

**Made with ⚽ and 💻 for football analytics enthusiasts**
