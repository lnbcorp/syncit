import { createServer } from 'http';
import { parse } from 'url';
import next from 'next';
import { wsManager } from './server/websocket';
import { sfuServer } from './server/sfu';

const dev = process.env.NODE_ENV !== 'production';
const hostname = process.env.HOSTNAME || 'localhost';
const port = parseInt(process.env.PORT || '3000', 10);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(async () => {
  // Initialize SFU server
  try {
    await sfuServer.initialize();
    console.log('> SFU server initialized');
  } catch (error) {
    console.error('Failed to initialize SFU server:', error);
    process.exit(1);
  }

  const server = createServer(async (req, res) => {
    try {
      const parsedUrl = parse(req.url!, true);
      await handle(req, res, parsedUrl);
    } catch (err) {
      console.error('Error occurred handling', req.url, err);
      res.statusCode = 500;
      res.end('internal server error');
    }
  });

  // Initialize WebSocket server
  wsManager.initialize(server);

  // Graceful shutdown
  process.on('SIGTERM', async () => {
    console.log('SIGTERM received, closing servers...');
    await sfuServer.close();
    server.close();
    process.exit(0);
  });

  process.on('SIGINT', async () => {
    console.log('SIGINT received, closing servers...');
    await sfuServer.close();
    server.close();
    process.exit(0);
  });

  server
    .once('error', (err) => {
      console.error(err);
      process.exit(1);
    })
    .listen(port, () => {
      console.log(`> Ready on http://${hostname}:${port}`);
      console.log(`> WebSocket server ready on ws://${hostname}:${port}/ws`);
      console.log(`> SFU server ready`);
    });
});

