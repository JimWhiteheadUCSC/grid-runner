(function () {
  const SCALE = 10; // px per LED
  const GAP = 2; // px gap between LEDs, for the chunky-panel look

  const canvas = document.getElementById('panel');
  const ctx = canvas.getContext('2d');
  const statusEl = document.getElementById('status');
  const buttonEl = document.getElementById('button');

  let width = 64;
  let height = 64;
  let ws = null;

  function resizeCanvas() {
    canvas.width = width * SCALE;
    canvas.height = height * SCALE;
  }
  resizeCanvas();

  function draw(buffer) {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const size = SCALE - GAP;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 3;
        const r = buffer[idx];
        const g = buffer[idx + 1];
        const b = buffer[idx + 2];
        if (r === 0 && g === 0 && b === 0) continue; // skip drawing black LEDs
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.fillRect(x * SCALE + GAP / 2, y * SCALE + GAP / 2, size, size);
      }
    }
  }

  function connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}`);
    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
      statusEl.textContent = 'connected';
    };
    ws.onclose = () => {
      statusEl.textContent = 'disconnected — retrying…';
      setTimeout(connect, 1000);
    };
    ws.onerror = () => ws.close();

    ws.onmessage = (ev) => {
      if (typeof ev.data === 'string') {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'hello') {
          width = msg.width;
          height = msg.height;
          resizeCanvas();
        }
        return;
      }
      draw(new Uint8Array(ev.data));
    };
  }

  function sendButton(down) {
    buttonEl.classList.toggle('pressed', down);
    if (ws && ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: 'button', down }));
    }
  }

  buttonEl.addEventListener('pointerdown', (ev) => {
    ev.preventDefault();
    buttonEl.setPointerCapture(ev.pointerId);
    sendButton(true);
  });
  buttonEl.addEventListener('pointerup', () => sendButton(false));
  buttonEl.addEventListener('pointercancel', () => sendButton(false));
  buttonEl.addEventListener('pointerleave', () => sendButton(false));

  connect();
})();
