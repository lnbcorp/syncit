# STUN/TURN Server Setup

This document describes how to set up STUN/TURN servers using coturn for WebRTC NAT traversal.

## Overview

- **STUN Server**: Public STUN server for NAT discovery
- **TURN UDP**: TURN server in the same region for UDP relay
- **TURN TCP/TLS**: TURN server with TCP/TLS as fallback when UDP is blocked
- **Ephemeral Credentials**: Short-lived credentials generated via REST API

## Prerequisites

- Ubuntu/Debian server (or similar Linux distribution)
- Root or sudo access
- Domain name or IP address for TURN server
- SSL certificate for TLS (Let's Encrypt recommended)

## Installation

### 1. Install coturn

```bash
sudo apt-get update
sudo apt-get install coturn
```

### 2. Configure coturn

Edit `/etc/turnserver.conf`:

```conf
# Listening interfaces
listening-ip=0.0.0.0
listening-port=3478

# TLS listening port
tls-listening-port=5349

# Relay interfaces
relay-ip=0.0.0.0

# Domain for TURN server
server-name=turn.example.com

# Realm
realm=pulsecast.com

# Use fingerprint in TURN message
fingerprint

# Use long-term credential mechanism
lt-cred-mech

# REST API for ephemeral credentials
use-auth-secret
static-auth-secret=YOUR_TURN_SECRET_HERE

# Log file
log-file=/var/log/turnserver.log

# No CLI password
cli-password=

# No static users (using REST API instead)
# user=username:password

# Min/Max port range for relay
min-port=49152
max-port=65535

# Certificate and private key for TLS
cert=/etc/letsencrypt/live/turn.example.com/fullchain.pem
pkey=/etc/letsencrypt/live/turn.example.com/privkey.pem

# Deny access to loopback addresses
denied-peer-ip=127.0.0.1
denied-peer-ip=0.0.0.0-0.255.255.255
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.168.0.0-192.168.255.255

# Allow all IPs (or restrict as needed)
allowed-peer-ip=0.0.0.0-255.255.255.255

# No CLI
no-cli

# No stdout logging (use log file)
no-stdout-log
```

### 3. Enable and start coturn

```bash
sudo systemctl enable coturn
sudo systemctl start coturn
sudo systemctl status coturn
```

### 4. Configure firewall

```bash
# Allow STUN/TURN ports
sudo ufw allow 3478/udp
sudo ufw allow 3478/tcp
sudo ufw allow 5349/tcp
sudo ufw allow 49152:65535/udp
sudo ufw allow 49152:65535/tcp
```

## Environment Variables

Set the following environment variables in your Next.js application:

```bash
TURN_SERVER=turn:turn.example.com:3478
TURN_SERVER_TLS=turns:turn.example.com:5349
TURN_SECRET=your-secret-key-here
TURN_USERNAME_PREFIX=pulsecast
```

## Testing

### Test STUN server

```bash
# Using stunclient (install with: sudo apt-get install stun-client)
stunclient turn.example.com 3478
```

### Test TURN server

```bash
# Using turnutils_stunclient
turnutils_stunclient turn.example.com
```

### Test from browser

Use WebRTC's `getStats()` API to verify TURN server usage:

```javascript
const pc = new RTCPeerConnection({
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { 
      urls: 'turn:turn.example.com:3478',
      username: 'test-username',
      credential: 'test-password'
    }
  ]
});

// Check ICE candidate types
pc.onicecandidate = (event) => {
  if (event.candidate) {
    console.log('ICE candidate:', event.candidate.candidate);
    // Look for "relay" type candidates (TURN)
  }
};
```

## Monitoring

Monitor coturn logs:

```bash
sudo tail -f /var/log/turnserver.log
```

Check coturn status:

```bash
sudo systemctl status coturn
```

## Security Considerations

1. **Use strong TURN_SECRET**: Generate a strong random secret
2. **Restrict access**: Use firewall rules to restrict access if needed
3. **SSL/TLS**: Always use TLS for TURN TCP connections
4. **Rate limiting**: Implement rate limiting on credential generation API
5. **Ephemeral credentials**: Use short TTL (10 minutes) for credentials

## Troubleshooting

### TURN server not responding

1. Check firewall rules
2. Verify coturn is running: `sudo systemctl status coturn`
3. Check logs: `sudo tail -f /var/log/turnserver.log`
4. Test connectivity: `telnet turn.example.com 3478`

### High latency

1. Ensure TURN server is in same region as application
2. Check network latency: `ping turn.example.com`
3. Monitor server resources: `htop`

### Certificate issues

1. Verify certificate is valid: `openssl s_client -connect turn.example.com:5349`
2. Check certificate expiration: `openssl x509 -in /etc/letsencrypt/live/turn.example.com/cert.pem -noout -dates`
3. Renew if needed: `sudo certbot renew`

## Production Checklist

- [ ] coturn installed and configured
- [ ] Firewall rules configured
- [ ] SSL certificate installed and valid
- [ ] Environment variables set
- [ ] TURN server tested and working
- [ ] Monitoring and logging set up
- [ ] Backup and recovery plan in place

