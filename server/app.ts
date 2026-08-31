// core depedencies
import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import path from 'path';
//const path = require('path');
import * as geoipLite from 'geoip-lite';
import { MongoService } from './src/services/mongo.service';
import { SocketService } from './src/services/socket.service';
import { EmailService } from './src/services/email.service';
import { BookingService } from './src/services/booking.service';
import { OfferService } from './src/services/offer.service';

// Function to detect crawlers
function isCrawler(userAgent) {
  if (!userAgent) return false;
  const bots = ['Googlebot', 'Bingbot', 'Slurp', 'DuckDuckBot', 'Baiduspider'];
  return bots.some((bot) => userAgent.includes(bot));
}

// core init
const app = express();

app.get('/', (req, res) => {
  //console.log('bis', req.path, req.headers['user-agent'], isCrawler(req.headers['user-agent']));
  if (isCrawler(req.headers['user-agent'])) {
    console.log('bot detected on home page');
    res.sendFile(path.join(process.cwd(), '..', 'client', 'dist', 'frontend', 'prerendered', 'index.html'));
  } else {
    res.sendFile(path.join(process.cwd(), '..', 'client', 'dist', 'frontend', 'browser', 'index.html'));
  }
});

app.get('/robots.txt', (req, res) => {
  res.type('text/plain');
  res.sendFile(path.join(process.cwd(), 'src', 'robots.txt'));
});

app.get('/sitemap.xml', (req, res) => {
  res.type('application/xml');
  res.sendFile(path.join(process.cwd(), 'src', 'sitemap.xml'));
});

// Files that must never be cached so clients always get the latest version on deploy
const noCacheFiles = /^(index\.html|ngsw\.json|ngsw-worker\.js)$/;
app.use((req, res, next) => {
  const filename = path.basename(req.path);
  if (noCacheFiles.test(filename)) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  next();
});

app.set('trust proxy', true);
const server = createServer(app);

// disable server cache in dev
// app.use((req, res, next) => {
//   if (process.env.development) {
//     console.log('no cache');
//     res.set('Cache-Control', 'no-store');
//   }
//   next();
// });

// services init
MongoService.init();
EmailService.init();
SocketService.init(server);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(express.static(process.cwd() + '/../client/dist/frontend/browser/'));
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    // 🚫 no console.error
    return res.status(400).json({ error: 'Invalid JSON body' });
  }
  next(err);
});
//app.use(express.text({ type: '*/*' }));

// app.get('/download/*', function (req, res) {
//   var reqpath = req.url.toString().split('?')[0].split('/').slice(2).join('/');
//   res.sendFile(path.join(process.cwd(), 'assets', reqpath));
// });

app.get('/assets/*', function (req, res) {
  const requestedPath = req.params[0];
  // Sanitize path to prevent path traversal attacks
  const safePath = path.normalize(requestedPath).replace(/^(\.\.(\/|\\|$))+/, '');
  const fullPath = path.resolve(process.cwd(), '../assets', safePath);
  const assetsDir = path.resolve(process.cwd(), '../assets');

  // Ensure the resolved path is within the assets directory
  if (!fullPath.startsWith(assetsDir + path.sep) && fullPath !== assetsDir) {
    return res.status(403).send('Forbidden');
  }
  res.sendFile(fullPath);
});

app.get('*', function (req, res) {
  // ignore maps logs
  if (!req.url.endsWith('.map')) {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    // try to log origin of call
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const geo = geoipLite.lookup(ip);
    if (geo) {
      console.log('New connexion from : ' + ip + ' in ' + geo.country);
    } else {
      console.log('New connexion from : ' + ip);
    }
  }
  // serve the application
  //console.log(req.path, req.headers['user-agent'], isCrawler(req.headers['user-agent']));
  if (isCrawler(req.headers['user-agent'])) {
    let route: string;
    if (req.path === '/') {
      route = 'index.html';
    } else if (req.path.startsWith('/item/')) {
      route = 'item.html';
    } else {
      route = `${req.path}.html`;
    }
    console.log('bot detected on ' + route);
    res.sendFile(path.join(process.cwd(), '..', 'client', 'dist', 'frontend', 'prerendered', route));
  } else {
    res.sendFile(path.join(process.cwd(), '..', 'client', 'dist', 'frontend', 'browser', 'index.html'));
  }
});

const PORT = +process.env.serverPort || 3027;
server.listen(PORT, function () {
  console.log('');
  console.log('╔═════════════════════════╗');
  console.log('║   CLICKANGE SERVER      ║');
  console.log('╚═╦═════════════════════╦═╝');
  console.log('  ║ ' + new Date().toISOString().substring(0, 19) + ' ║');
  console.log('  ║ listening port ' + PORT + ' ║');
  console.log('  ╚══════ V0.2.0 ═══════╝  ');
  console.log('');
});
