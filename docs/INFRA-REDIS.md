# Redis Setup

This document describes how to set up Redis for ephemeral room and presence storage.

## Overview

Redis is used for:
- Room storage with TTL (2 hours)
- Participant presence tracking
- Rate limiting data
- Code enumeration tracking
- Temporary session data

## Prerequisites

- Ubuntu/Debian server (or similar Linux distribution)
- Root or sudo access
- Network access to Redis server

## Installation

### 1. Install Redis

```bash
sudo apt-get update
sudo apt-get install redis-server
```

### 2. Configure Redis

Edit `/etc/redis/redis.conf`:

```conf
# Bind to localhost (or specific IP for remote access)
bind 127.0.0.1

# Port
port 6379

# Password (recommended for production)
requirepass YOUR_REDIS_PASSWORD

# Max memory (adjust based on needs)
maxmemory 256mb
maxmemory-policy allkeys-lru

# Persistence (optional, for development)
# For production, consider AOF or RDB snapshots
save 900 1
save 300 10
save 60 10000

# Logging
loglevel notice
logfile /var/log/redis/redis-server.log

# Disable dangerous commands in production
rename-command FLUSHDB ""
rename-command FLUSHALL ""
rename-command CONFIG ""
```

### 3. Enable and start Redis

```bash
sudo systemctl enable redis-server
sudo systemctl start redis-server
sudo systemctl status redis-server
```

### 4. Configure firewall (if remote access needed)

```bash
# Allow Redis port (only if needed for remote access)
sudo ufw allow from TRUSTED_IP to any port 6379
```

## Environment Variables

Set the following environment variables in your Next.js application:

```bash
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=your-redis-password
REDIS_TLS=false  # Set to true if using TLS
```

## Redis Client Setup

### Install Redis client library

```bash
npm install ioredis
npm install --save-dev @types/ioredis
```

### Create Redis client utility

Create `app/lib/redis-client.ts`:

```typescript
import Redis from 'ioredis';

const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
  password: process.env.REDIS_PASSWORD,
  tls: process.env.REDIS_TLS === 'true' ? {} : undefined,
  retryStrategy: (times) => {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
  maxRetriesPerRequest: 3,
});

redis.on('error', (err) => {
  console.error('Redis error:', err);
});

redis.on('connect', () => {
  console.log('Redis connected');
});

export default redis;
```

## Migration from In-Memory Store

### Update room-store.ts

Replace in-memory Map with Redis:

```typescript
import redis from './redis-client';
import { generateRoomCode } from './room-code';

const ROOM_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours
const ROOM_KEY_PREFIX = 'room:';
const PARTICIPANT_KEY_PREFIX = 'participant:';

export async function createRoom(region: string = 'us-east'): Promise<Room> {
  let code: string;
  let attempts = 0;
  const maxAttempts = 10;

  do {
    code = generateRoomCode();
    attempts++;

    if (attempts > maxAttempts) {
      throw new Error('Failed to generate unique room code after multiple attempts');
    }

    // Check if code exists in Redis
    const exists = await redis.exists(`${ROOM_KEY_PREFIX}${code}`);
    if (exists === 0) {
      break;
    }
  } while (true);

  const now = Date.now();
  const room: Room = {
    code,
    createdAt: now,
    region,
    capacity: 27,
    hostPeerId: null,
    listeners: [],
    participants: new Map(),
    status: 'active',
    expiresAt: now + ROOM_TTL_MS,
  };

  // Store room in Redis with TTL
  await redis.setex(
    `${ROOM_KEY_PREFIX}${code}`,
    Math.floor(ROOM_TTL_MS / 1000),
    JSON.stringify(room)
  );

  return room;
}

export async function getRoom(code: string): Promise<Room | undefined> {
  const data = await redis.get(`${ROOM_KEY_PREFIX}${code}`);
  if (!data) {
    return undefined;
  }

  const room = JSON.parse(data) as Room;
  
  // Check if room has expired
  if (Date.now() > room.expiresAt) {
    await redis.del(`${ROOM_KEY_PREFIX}${code}`);
    return undefined;
  }

  return room;
}
```

## Connection Pooling

For high-traffic scenarios, use connection pooling:

```typescript
import Redis from 'ioredis';

const redisPool = new Redis.Cluster([
  {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
  },
], {
  redisOptions: {
    password: process.env.REDIS_PASSWORD,
  },
  enableReadyCheck: true,
  maxRetriesPerRequest: 3,
});
```

## Region-Aware Setup

For multi-region deployments:

```typescript
const region = process.env.REGION || 'us-east';
const redis = new Redis({
  host: `${region}-redis.example.com`,
  port: 6379,
  password: process.env.REDIS_PASSWORD,
});
```

## Monitoring

### Check Redis status

```bash
redis-cli ping
# Should return: PONG
```

### Monitor Redis

```bash
redis-cli --stat
```

### Check memory usage

```bash
redis-cli info memory
```

### View keys

```bash
redis-cli keys "room:*"
```

## Testing

### Test Redis connection

```typescript
import redis from './redis-client';

async function testRedis() {
  await redis.set('test', 'value');
  const value = await redis.get('test');
  console.log('Redis test:', value);
  await redis.del('test');
}
```

## Security Considerations

1. **Password protection**: Always use a strong password
2. **Network isolation**: Bind to localhost or use VPN/firewall
3. **TLS encryption**: Use TLS for remote connections
4. **Key expiration**: Always set TTL on temporary data
5. **Access control**: Use Redis ACLs if available

## Production Checklist

- [ ] Redis installed and configured
- [ ] Password set and secure
- [ ] Firewall rules configured
- [ ] TLS enabled (if remote access)
- [ ] Connection pooling configured
- [ ] Monitoring and alerting set up
- [ ] Backup strategy in place
- [ ] Memory limits configured
- [ ] Persistence configured (if needed)

## Troubleshooting

### Connection refused

1. Check Redis is running: `sudo systemctl status redis-server`
2. Check bind address in config
3. Check firewall rules

### Memory issues

1. Check memory usage: `redis-cli info memory`
2. Adjust `maxmemory` and `maxmemory-policy`
3. Monitor key expiration

### Performance issues

1. Check connection pooling
2. Monitor slow queries: `redis-cli slowlog get 10`
3. Consider Redis Cluster for scaling

