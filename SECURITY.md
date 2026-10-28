# Security Policy

## Supported Versions

Currently, we support the following versions with security updates:

| Version | Supported          |
| ------- | ------------------ |
| main    | :white_check_mark: |

## Reporting a Vulnerability

We take security seriously. If you discover a security vulnerability in Sports Craft Engine, please report it responsibly.

### How to Report

**Please DO NOT open a public GitHub issue for security vulnerabilities.**

Instead, please email security details to: **your-email@example.com**

Include:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)
- Your contact information

### What to Expect

1. **Acknowledgment**: We'll acknowledge receipt within 48 hours
2. **Investigation**: We'll investigate and validate the issue
3. **Fix Timeline**: Critical issues will be addressed within 7 days
4. **Updates**: We'll keep you informed of progress
5. **Credit**: With your permission, we'll credit you in the fix announcement

### Security Best Practices

When deploying Sports Craft Engine:

#### 1. API Key Security
```bash
# Generate a strong API key
python -c "import secrets; print(secrets.token_urlsafe(32))"

# Never commit API keys to version control
# Always use .env files and add them to .gitignore
```

#### 2. Authentication
- Set `API_KEY` in production
- Set `ALLOW_ANON_TOKEN=false` for production
- Use HTTPS in production environments
- Implement rate limiting for token generation

#### 3. CORS Configuration
```bash
# Restrict CORS origins in production
CORS_ORIGINS=https://yourdomain.com,https://app.yourdomain.com
```

#### 4. File Upload Security
- Enforce file size limits (`UPLOAD_MAX_MB`)
- Validate file types before processing
- Scan uploaded files for malware
- Store uploads in isolated directory
- Consider file quarantine before processing

#### 5. RTSP Stream Security
```bash
# Disable private IPs in production if not needed
RTSP_ALLOW_PRIVATE=false
RTSP_ALLOW_LOOPBACK=false

# Use allowlist for trusted sources
RTSP_ALLOWLIST=rtsp://trusted-camera-1,rtsp://trusted-camera-2
```

#### 6. Database Security
- Use proper file permissions for SQLite database
- Consider encryption at rest for sensitive data
- Regular backups with secure storage

#### 7. Network Security
- Run backend behind reverse proxy (nginx, Caddy)
- Use firewall to restrict access
- Enable HTTPS with valid certificates
- Use Content Security Policy headers

#### 8. Environment Variables
- Never expose `.env` files
- Use secrets management in production (AWS Secrets Manager, HashiCorp Vault)
- Rotate API keys regularly
- Use different keys for dev/staging/production

#### 9. Gemini API Security
- Keep `GEMINI_API_KEY` private
- Monitor API usage and costs
- Set usage quotas in Google Cloud Console
- Restrict API key to specific services

#### 10. Dependencies
```bash
# Regularly update dependencies
pip install --upgrade -r requirements.txt

# Check for vulnerabilities
pip install safety
safety check
```

### Known Security Considerations

#### Input Validation
- All user inputs are validated against JSON schemas
- File uploads checked for type and size
- SQL injection protection via parameterized queries

#### WebSocket Security
- Socket.IO connections require authentication
- Room isolation prevents cross-match data leakage
- Message validation before processing

#### Video Processing
- FFmpeg command injection prevention
- Path traversal protection
- Subprocess timeout limits

#### AI Integration
- Gemini API keys stored securely
- Rate limiting on AI requests
- Input sanitization for prompts

### Vulnerability Disclosure Timeline

1. **Day 0**: Vulnerability reported
2. **Day 1-2**: Acknowledgment sent
3. **Day 3-7**: Investigation and fix development
4. **Day 8-14**: Testing and validation
5. **Day 15**: Public disclosure (if critical) or next release

### Security Checklist for Deployment

- [ ] Change default `API_KEY`
- [ ] Set strong `GEMINI_API_KEY`
- [ ] Configure restrictive `CORS_ORIGINS`
- [ ] Set `ALLOW_ANON_TOKEN=false`
- [ ] Enable HTTPS
- [ ] Configure firewall rules
- [ ] Set up reverse proxy
- [ ] Review RTSP settings
- [ ] Limit file upload sizes
- [ ] Monitor logs for suspicious activity
- [ ] Set up automated backups
- [ ] Keep dependencies updated
- [ ] Review file permissions
- [ ] Enable security headers
- [ ] Configure rate limiting

### Security Updates

We will announce security updates through:
- GitHub Security Advisories
- Release notes in CHANGELOG.md
- Email to registered users (if applicable)

### Code of Conduct

Security researchers should:
- Act in good faith
- Not exploit vulnerabilities beyond demonstration
- Not access or modify data without permission
- Respect user privacy
- Follow responsible disclosure practices

### Bug Bounty

Currently, we do not offer a bug bounty program. However, we deeply appreciate security researchers' contributions and will acknowledge them in our release notes and documentation.

---

**Last Updated**: 2024-10-28

For security concerns, contact: **your-email@example.com**
