# Contributing to ProVision AI

Thank you for your interest in contributing to ProVision AI! This document provides guidelines and instructions for contributing.

## 🤝 How to Contribute

### Reporting Bugs

If you find a bug, please create an issue with:
- Clear title and description
- Steps to reproduce the issue
- Expected vs actual behavior
- Screenshots if applicable
- System information (OS, Python version, browser)

### Suggesting Enhancements

We welcome feature suggestions! Please:
- Check if the feature has already been requested
- Provide a clear use case
- Explain the expected behavior
- Consider implementation complexity

### Code Contributions

1. **Fork the Repository**
   ```bash
   git clone https://github.com/yourusername/provision-ai.git
   cd provision-ai
   ```

2. **Create a Branch**
   ```bash
   git checkout -b feature/your-feature-name
   ```
   Branch naming conventions:
   - `feature/` - New features
   - `fix/` - Bug fixes
   - `docs/` - Documentation updates
   - `refactor/` - Code refactoring
   - `test/` - Test additions/modifications

3. **Make Your Changes**
   - Write clear, readable code
   - Follow existing code style
   - Add comments for complex logic
   - Update documentation as needed

4. **Test Your Changes**
   ```bash
   cd Backend
   pytest tests/
   ```

5. **Commit Your Changes**
   ```bash
   git add .
   git commit -m "feat: add new feature description"
   ```
   
   Commit message format:
   - `feat:` - New feature
   - `fix:` - Bug fix
   - `docs:` - Documentation
   - `style:` - Formatting, no code change
   - `refactor:` - Code restructuring
   - `test:` - Adding tests
   - `chore:` - Maintenance

6. **Push to Your Fork**
   ```bash
   git push origin feature/your-feature-name
   ```

7. **Open a Pull Request**
   - Provide a clear description
   - Reference related issues
   - List changes made
   - Include screenshots for UI changes

## 💻 Development Setup

### Backend Development

```bash
cd Backend

# Create virtual environment
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Install development dependencies
pip install pytest pytest-asyncio black flake8

# Run in development mode
uvicorn app.main:asgi --reload --host 0.0.0.0 --port 8000
```

### Frontend Development

```bash
cd Dashboard

# Serve locally
python -m http.server 5173

# Or use any other static server
```

## 📝 Code Style Guidelines

### Python (Backend)

- Follow PEP 8 style guide
- Use type hints where possible
- Maximum line length: 120 characters
- Use meaningful variable and function names

```python
# Good
def calculate_possession_percentage(team_touches: int, total_touches: int) -> float:
    """Calculate team possession as a percentage."""
    if total_touches == 0:
        return 0.0
    return (team_touches / total_touches) * 100

# Bad
def calc_poss(t, tt):
    return (t/tt)*100 if tt else 0
```

**Formatting:**
```bash
# Format code
black app/

# Check linting
flake8 app/
```

### JavaScript (Frontend)

- Use consistent indentation (2 spaces)
- Use meaningful variable names
- Add comments for complex logic
- Use ES6+ features where appropriate

```javascript
// Good
function updatePlayerPosition(playerId, x, y) {
  const player = players[playerId];
  if (!player) return;
  
  player.position.set(x, 0, y);
  player.lastSeenAt = Date.now();
}

// Bad
function upd(p,x,y){
  players[p].position.set(x,0,y);
}
```

## 🧪 Testing

### Backend Tests

```bash
cd Backend

# Run all tests
pytest

# Run specific test file
pytest tests/test_analytics.py

# Run with coverage
pytest --cov=app tests/
```

### Test Structure
```python
import pytest
from app.analytics import calculate_xg

def test_xg_calculation():
    """Test expected goals calculation."""
    shot = {
        'distance': 15.0,
        'angle': 30.0,
        'foot': 'right'
    }
    xg = calculate_xg(shot)
    assert 0 <= xg <= 1
    assert isinstance(xg, float)
```

## 📚 Documentation

- Update README.md for user-facing changes
- Add docstrings to Python functions
- Comment complex algorithms
- Update API documentation for new endpoints
- Include examples for new features

### Docstring Format
```python
def process_tracking_frame(frame: dict) -> dict:
    """
    Process a single tracking frame.
    
    Args:
        frame: Raw tracking data containing player positions
        
    Returns:
        Processed frame with normalized coordinates
        
    Raises:
        ValueError: If frame format is invalid
    """
    pass
```

## 🎯 Feature Areas

We welcome contributions in these areas:

### High Priority
- Additional language support for commentary
- Performance optimizations
- Better error handling and recovery
- Mobile-responsive dashboard
- Real YOLO integration testing

### Medium Priority
- Additional event types detection
- More visualization options
- Export functionality (CSV, JSON, PDF reports)
- Match replay system
- User authentication and match history

### Ideas Welcome
- Integration with other sports
- Machine learning model improvements
- Advanced tactical analysis
- Social media integrations
- REST API client libraries

## 🔍 Code Review Process

All contributions go through code review:

1. Automated checks must pass (if available)
2. Code must follow style guidelines
3. Tests must pass
4. At least one maintainer approval required
5. No merge conflicts with main branch

## ❓ Questions?

- Open an issue for technical questions
- Join discussions in existing issues
- Check existing documentation first
- Be respectful and constructive

## 📜 Code of Conduct

- Be respectful and inclusive
- Welcome newcomers
- Focus on constructive feedback
- Respect different viewpoints
- No harassment or discrimination

## 🎉 Recognition

Contributors will be:
- Listed in README acknowledgments
- Credited in release notes for their contributions
- Appreciated in our community!

---

Thank you for contributing to ProVision AI! 🚀⚽
