'use strict';

// Local web server that streams frames over WebSocket to a browser-canvas
// page (host/display/simpage/), which draws chunky LED-style pixels. Runs
// on any machine, with no panel attached.

const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const { Display } = require('./Display');

const SIMPAGE_DIR = path.join(__dirname, 'simpage');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

class SimDisplay extends Display {
  constructor({ port = 8080, width = 64, height = 64 } = {}) {
    super();
    this.port = port;
    this.width = width;
    this.height = height;
    this.server = null;
    this.wss = null;
    this.clients = new Set();
    this.buttonHandler = null;
  }

  async init() {
    this.server = http.createServer((req, res) => this._handleRequest(req, res));
    this.wss = new WebSocketServer({ server: this.server });

    this.wss.on('connection', (ws) => {
      this.clients.add(ws);
      ws.send(JSON.stringify({ type: 'hello', width: this.width, height: this.height }));
      ws.on('close', () => this.clients.delete(ws));
      ws.on('error', () => this.clients.delete(ws));
      ws.on('message', (data, isBinary) => {
        if (isBinary) return;
        this._handleClientMessage(data);
      });
    });

    await new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(this.port, () => resolve());
    });

    console.log(`[SimDisplay] serving http://localhost:${this.port}`);
  }

  _handleClientMessage(data) {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }
    if (msg.type === 'button' && this.buttonHandler) {
      this.buttonHandler(!!msg.down);
    }
  }

  // See Display.onButtonEvent — the sim page's on-screen button sends
  // {type:'button', down} over the same WebSocket used for frames.
  onButtonEvent(handler) {
    this.buttonHandler = handler;
  }

  _handleRequest(req, res) {
    const urlPath = req.url === '/' ? '/index.html' : req.url.split('?')[0];
    const filePath = path.join(SIMPAGE_DIR, urlPath);

    // Refuse anything that escapes the simpage directory.
    if (!filePath.startsWith(SIMPAGE_DIR)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      const ext = path.extname(filePath);
      res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
      res.end(data);
    });
  }

  // buffer: Uint8Array of width*height*3 RGB bytes. Broadcast as a single
  // binary WebSocket frame; the client page knows the fixed dimensions
  // from the 'hello' message sent at connect time.
  pushFrame(buffer) {
    for (const ws of this.clients) {
      if (ws.readyState === ws.OPEN) ws.send(buffer, { binary: true });
    }
  }

  async close() {
    for (const ws of this.clients) ws.terminate();
    this.clients.clear();
    if (this.wss) await new Promise((resolve) => this.wss.close(() => resolve()));
    if (this.server) await new Promise((resolve) => this.server.close(() => resolve()));
  }
}

module.exports = { SimDisplay };
