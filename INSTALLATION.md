# 📦 Installation Guide - Sports Craft Engine

Comprehensive installation instructions for Sports Craft Engine on different platforms.

## Table of Contents
- [System Requirements](#system-requirements)
- [Ubuntu/Linux Installation](#ubuntulinux-installation)
- [macOS Installation](#macos-installation)
- [Windows Installation](#windows-installation)
- [Docker Installation](#docker-installation-optional)
- [Verification](#verification)
- [Troubleshooting](#troubleshooting)

---

## System Requirements

### Minimum Requirements
- **CPU**: Dual-core processor, 2.0 GHz
- **RAM**: 4 GB
- **Storage**: 2 GB free space (more for video uploads)
- **Python**: 3.8 or higher
- **Browser**: Modern browser (Chrome, Firefox, Safari, Edge)

### Recommended Requirements
- **CPU**: Quad-core processor, 3.0 GHz+
- **RAM**: 8 GB+ (16 GB for real video processing with YOLO)
- **GPU**: NVIDIA GPU with CUDA support (optional, for YOLO)
- **Storage**: 20 GB+ free space
- **Internet**: For Gemini AI features

---

## Ubuntu/Linux Installation

### 1. Install System Dependencies

```bash
# Update package list
sudo apt-get update

# Install Python 3 and pip
sudo apt-get install -y python3 python3-pip python3-venv

# Install FFmpeg
sudo apt-get install -y ffmpeg

# Optional: Install Git if not already installed
sudo apt-get install -y git
```

### 2. Clone Repository

```bash
git clone https://github.com/yourusername/provision-ai.git
cd provision-ai
```

### 3. Set Up Backend

```bash
cd Backend

# Create virtual environment
python3 -m venv venv

# Activate virtual environment
source venv/bin/activate

# Upgrade pip
pip install --upgrade pip

# Install Python dependencies
pip install -r requirements.txt
```

### 4. Configure Environment

```bash
# Copy example environment file
cp .env.example .env

# Edit configuration (use your preferred editor)
nano .env  # or vim, gedit, etc.
```

**Required changes in `.env`:**
- Set `GEMINI_API_KEY` (get from https://makersuite.google.com/app/apikey)
- Generate `API_KEY`: `python3 -c "import secrets; print(secrets.token_urlsafe(32))"`

### 5. Run Backend

```bash
# Make sure virtual environment is activated
uvicorn app.main:asgi --host 0.0.0.0 --port 8000
```

### 6. Access Dashboard

Open browser and navigate to:
```
http://localhost:8000/dashboard/
```

---

## macOS Installation

### 1. Install Homebrew (if not installed)

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

### 2. Install System Dependencies

```bash
# Install Python 3
brew install python@3.11

# Install FFmpeg
brew install ffmpeg

# Optional: Install Git
brew install git
```

### 3. Clone Repository

```bash
git clone https://github.com/yourusername/provision-ai.git
cd provision-ai
```

### 4. Set Up Backend

```bash
cd Backend

# Create virtual environment
python3 -m venv venv

# Activate virtual environment
source venv/bin/activate

# Upgrade pip
pip install --upgrade pip

# Install Python dependencies
pip install -r requirements.txt
```

### 5. Configure Environment

```bash
# Copy example environment file
cp .env.example .env

# Edit configuration
nano .env  # or use TextEdit, VS Code, etc.
```

**Required changes in `.env`:**
- Set `GEMINI_API_KEY`
- Generate `API_KEY`: `python3 -c "import secrets; print(secrets.token_urlsafe(32))"`

### 6. Run Backend

```bash
uvicorn app.main:asgi --host 0.0.0.0 --port 8000
```

### 7. Access Dashboard

Open browser:
```
http://localhost:8000/dashboard/
```

---

## Windows Installation

### 1. Install Python

1. Download Python 3.11+ from https://www.python.org/downloads/
2. **Important**: Check "Add Python to PATH" during installation
3. Verify installation:
   ```cmd
   python --version
   ```

### 2. Install FFmpeg

**Option A: Using Chocolatey (Recommended)**
```cmd
# Install Chocolatey first: https://chocolatey.org/install
choco install ffmpeg
```

**Option B: Manual Installation**
1. Download FFmpeg from https://ffmpeg.org/download.html
2. Extract to `C:\ffmpeg`
3. Add `C:\ffmpeg\bin` to System PATH:
   - Right-click "This PC" → Properties
   - Advanced system settings → Environment Variables
   - Edit "Path" → Add `C:\ffmpeg\bin`

### 3. Clone Repository

```cmd
git clone https://github.com/yourusername/provision-ai.git
cd provision-ai
```

### 4. Set Up Backend

```cmd
cd Backend

# Create virtual environment
python -m venv venv

# Activate virtual environment
venv\Scripts\activate

# Upgrade pip
python -m pip install --upgrade pip

# Install dependencies
pip install -r requirements.txt
```

### 5. Configure Environment

```cmd
# Copy example environment file
copy .env.example .env

# Edit .env with Notepad or your preferred editor
notepad .env
```

**Required changes in `.env`:**
- Set `GEMINI_API_KEY`
- Generate `API_KEY`:
  ```cmd
  python -c "import secrets; print(secrets.token_urlsafe(32))"
  ```

### 6. Run Backend

```cmd
# Make sure virtual environment is activated
uvicorn app.main:asgi --host 0.0.0.0 --port 8000
```

### 7. Access Dashboard

Open browser:
```
http://localhost:8000/dashboard/
```

---

## Docker Installation (Optional)

### Prerequisites
- Docker installed
- Docker Compose installed

### 1. Create Dockerfile

Create `Backend/Dockerfile`:
```dockerfile
FROM python:3.11-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy requirements and install
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application
COPY . .

# Create data directory
RUN mkdir -p /app/data

EXPOSE 8000

CMD ["uvicorn", "app.main:asgi", "--host", "0.0.0.0", "--port", "8000"]
```

### 2. Create docker-compose.yml

Create in project root:
```yaml
version: '3.8'

services:
  backend:
    build: ./Backend
    ports:
      - "8000:8000"
    volumes:
      - ./Backend:/app
      - ./Backend/data:/app/data
      - ./Dashboard:/app/dashboard
    env_file:
      - ./Backend/.env
    restart: unless-stopped
```

### 3. Run with Docker

```bash
# Build and start
docker-compose up -d

# View logs
docker-compose logs -f

# Stop
docker-compose down
```

---

## Verification

### 1. Check Backend Health

```bash
curl http://localhost:8000/health
```

Expected response:
```json
{
  "status": "ok",
  "pipelineMode": "simulator",
  "visionBackend": "mock",
  "geminiEnabled": true,
  ...
}
```

### 2. Test Dashboard

1. Open browser: `http://localhost:8000/dashboard/`
2. Click "Health Check"
3. Should see: `✓ Backend: ok`

### 3. Test Simulator

1. Click "Source Control"
2. Enter match ID: `test-match`
3. Click "Start Simulator"
4. You should see players moving on the 3D pitch

---

## Troubleshooting

### Python Version Issues

```bash
# Check Python version
python --version  # or python3 --version

# If wrong version, use python3 explicitly
python3 -m venv venv
```

### FFmpeg Not Found

**Linux:**
```bash
which ffmpeg
# If not found:
sudo apt-get install ffmpeg
```

**macOS:**
```bash
which ffmpeg
# If not found:
brew install ffmpeg
```

**Windows:**
```cmd
ffmpeg -version
# If not found, check PATH or reinstall
```

### Port Already in Use

```bash
# Find process using port 8000
# Linux/macOS:
lsof -i :8000

# Windows:
netstat -ano | findstr :8000

# Kill the process or use different port:
uvicorn app.main:asgi --host 0.0.0.0 --port 8001
```

### Module Not Found Errors

```bash
# Ensure virtual environment is activated
# Linux/macOS:
source venv/bin/activate

# Windows:
venv\Scripts\activate

# Reinstall dependencies
pip install -r requirements.txt
```

### Gemini API Errors

1. Verify API key is correct in `.env`
2. Check quota at https://makersuite.google.com/
3. Ensure billing is enabled if required
4. Try different model: `GEMINI_MODEL=gemini-1.5-flash`

### Dashboard Shows "Offline"

1. Check backend is running: `curl http://localhost:8000/health`
2. Check CORS settings in `.env`
3. Check browser console (F12) for errors
4. Verify API base URL in dashboard settings

### Upload Fails

1. Check disk space
2. Verify file format is supported
3. Check file size (default limit: 2048 MB)
4. Review backend logs for errors

---

## Next Steps

After successful installation:

1. **Configure Teams**: Edit team names and colors in `.env`
2. **Get Gemini API Key**: For AI commentary features
3. **Read Usage Guide**: See README.md for feature documentation
4. **Try Demo Mode**: Test without backend connection
5. **Upload Test Video**: Try with a sample match video

---

## Additional Resources

- **Documentation**: See README.md
- **API Reference**: http://localhost:8000/docs (when running)
- **Issue Tracker**: GitHub Issues
- **Discord/Community**: [Your community link]

---

**Need Help?** Open an issue on GitHub with:
- Your OS and Python version
- Error messages (full output)
- Steps you've tried
- Configuration (without sensitive data)
