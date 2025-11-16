# Deployment Configuration

This document describes the deployment architecture for PulseCast, including Next.js edge deployment and Node.js WebSocket/SFU servers.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    Edge Network (CDN)                    │
│  ┌──────────────────────────────────────────────────┐   │
│  │         Next.js Edge (Static/SSR)                │   │
│  │  - Landing page, Join page                       │   │
│  │  - API routes (room creation, joining)           │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
                          │
                          │ HTTPS/WSS
                          ▼
┌─────────────────────────────────────────────────────────┐
│              Regional Node.js Servers                    │
│  ┌──────────────────┐  ┌──────────────────┐          │
│  │  WebSocket Server │  │   SFU Server     │          │
│  │  - Signaling      │  │   - mediasoup    │          │
│  │  - Presence       │  │   - Audio routing│          │
│  └──────────────────┘  └──────────────────┘          │
└─────────────────────────────────────────────────────────┘
```

## Deployment Options

### Option 1: Vercel (Recommended for Next.js)

#### Next.js Edge Deployment

1. **Connect repository to Vercel**
   ```bash
   vercel login
   vercel link
   ```

2. **Configure environment variables**
   ```bash
   vercel env add TURN_SERVER
   vercel env add TURN_SECRET
   vercel env add REDIS_HOST
   vercel env add REDIS_PASSWORD
   vercel env add JWT_SECRET
   ```

3. **Deploy**
   ```bash
   vercel --prod
   ```

#### Custom Server Deployment (WebSocket/SFU)

For WebSocket and SFU servers, deploy to a dedicated Node.js server:

**Dockerfile for Node.js server:**

```dockerfile
FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./
RUN npm ci --only=production

# Copy application files
COPY . .

# Expose ports
EXPOSE 3000

# Start server
CMD ["npm", "start"]
```

**docker-compose.yml:**

```yaml
version: '3.8'

services:
  websocket-sfu:
    build: .
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - PORT=3000
      - REDIS_HOST=redis
      - REDIS_PASSWORD=${REDIS_PASSWORD}
      - TURN_SERVER=${TURN_SERVER}
      - TURN_SECRET=${TURN_SECRET}
      - JWT_SECRET=${JWT_SECRET}
    depends_on:
      - redis
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    command: redis-server --requirepass ${REDIS_PASSWORD}
    volumes:
      - redis-data:/data
    restart: unless-stopped

volumes:
  redis-data:
```

### Option 2: AWS Deployment

#### Next.js on AWS Amplify

1. **Connect repository to Amplify**
   - Go to AWS Amplify Console
   - Connect GitHub repository
   - Configure build settings

2. **Environment variables**
   - Set in Amplify Console → App settings → Environment variables

#### WebSocket/SFU on AWS ECS/Fargate

**Task Definition:**

```json
{
  "family": "pulsecast-websocket-sfu",
  "networkMode": "awsvpc",
  "containerDefinitions": [
    {
      "name": "websocket-sfu",
      "image": "your-ecr-repo/websocket-sfu:latest",
      "portMappings": [
        {
          "containerPort": 3000,
          "protocol": "tcp"
        }
      ],
      "environment": [
        {
          "name": "NODE_ENV",
          "value": "production"
        },
        {
          "name": "REDIS_HOST",
          "value": "your-redis-endpoint"
        }
      ],
      "secrets": [
        {
          "name": "REDIS_PASSWORD",
          "valueFrom": "arn:aws:secretsmanager:region:account:secret:redis-password"
        }
      ]
    }
  ],
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "1024",
  "memory": "2048"
}
```

### Option 3: Self-Hosted

#### Next.js Deployment

1. **Build application**
   ```bash
   npm run build
   ```

2. **Start production server**
   ```bash
   npm start
   ```

3. **Use PM2 for process management**
   ```bash
   npm install -g pm2
   pm2 start npm --name "pulsecast" -- start
   pm2 save
   pm2 startup
   ```

#### WebSocket/SFU Server

1. **Build and start**
   ```bash
   npm run build
   npm start
   ```

2. **Use systemd service**

Create `/etc/systemd/system/pulsecast.service`:

```ini
[Unit]
Description=PulseCast WebSocket/SFU Server
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/var/www/pulsecast
Environment=NODE_ENV=production
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
sudo systemctl enable pulsecast
sudo systemctl start pulsecast
```

## Environment Configuration

### Required Environment Variables

```bash
# Application
NODE_ENV=production
PORT=3000
HOSTNAME=0.0.0.0

# JWT
JWT_SECRET=your-strong-secret-here
JWT_EXPIRY=1h

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=your-redis-password
REDIS_TLS=false

# TURN Server
TURN_SERVER=turn:turn.example.com:3478
TURN_SERVER_TLS=turns:turn.example.com:5349
TURN_SECRET=your-turn-secret
TURN_USERNAME_PREFIX=pulsecast

# SFU
SFU_ENDPOINT=wss://sfu.example.com

# Region (for multi-region deployments)
REGION=us-east
```

### Environment-Specific Configs

**Development (.env.local):**
```bash
NODE_ENV=development
REDIS_HOST=localhost
TURN_SERVER=turn:localhost:3478
```

**Production (.env.production):**
```bash
NODE_ENV=production
REDIS_HOST=prod-redis.example.com
TURN_SERVER=turn:prod-turn.example.com:3478
```

## HTTPS/WSS Configuration

### SSL/TLS Certificates

1. **Obtain certificates** (Let's Encrypt recommended)
   ```bash
   sudo certbot certonly --standalone -d your-domain.com
   ```

2. **Configure reverse proxy** (Nginx example)

**nginx.conf:**
```nginx
upstream websocket {
    server localhost:3000;
}

server {
    listen 443 ssl http2;
    server_name your-domain.com;

    ssl_certificate /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;

    # WebSocket upgrade
    location /ws {
        proxy_pass http://websocket;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Next.js API routes
    location /api {
        proxy_pass http://websocket;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Next.js static/SSR
    location / {
        proxy_pass http://websocket;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

## Monitoring and Logging

### Application Logging

Use structured logging:

```typescript
import winston from 'winston';

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' }),
  ],
});

if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.simple(),
  }));
}
```

### Health Checks

Create `/api/health` endpoint:

```typescript
export async function GET() {
  const health = {
    status: 'ok',
    timestamp: Date.now(),
    uptime: process.uptime(),
    redis: await checkRedis(),
    turn: await checkTURN(),
  };

  return NextResponse.json(health);
}
```

## Scaling Considerations

### Horizontal Scaling

1. **Load balancing**: Use load balancer for multiple WebSocket servers
2. **Sticky sessions**: Required for WebSocket connections
3. **Redis cluster**: For shared state across instances
4. **SFU scaling**: Deploy multiple SFU instances per region

### Vertical Scaling

1. **CPU**: WebRTC processing is CPU-intensive
2. **Memory**: Each connection uses ~1-2MB
3. **Network**: High bandwidth for audio streaming

## Production Checklist

- [ ] Environment variables configured
- [ ] SSL/TLS certificates installed
- [ ] HTTPS/WSS enabled
- [ ] Reverse proxy configured
- [ ] Redis connected and tested
- [ ] TURN server configured
- [ ] Monitoring and logging set up
- [ ] Health checks implemented
- [ ] Backup strategy in place
- [ ] Disaster recovery plan
- [ ] Load testing completed
- [ ] Security audit performed

## Troubleshooting

### WebSocket connection issues

1. Check firewall rules
2. Verify WSS (not WS) in production
3. Check reverse proxy configuration
4. Verify certificate validity

### High latency

1. Check server region proximity
2. Monitor network latency
3. Check TURN server location
4. Review SFU configuration

### Memory leaks

1. Monitor memory usage
2. Check for connection leaks
3. Review cleanup logic
4. Use heap profiling

