// ble.js — improved Web Bluetooth handling + robust notification decode & reconnect

const UART_SERVICE = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
const UART_RX = "6e400002-b5a3-f393-e0a9-e50e24dcca9e"; // write to this
const UART_TX = "6e400003-b5a3-f393-e0a9-e50e24dcca9e"; // notify from this

document.addEventListener("DOMContentLoaded", () => {
  const statusDot = document.getElementById("status-dot");
  const statusText = document.getElementById("status-text");
  const logs = document.getElementById("logs");
  const tempEl = document.getElementById("param-temp");
  const thickEl = document.getElementById("param-thick");
  const speedEl = document.getElementById("param-speed");
  const motorEl = document.getElementById("param-motor");

  const connectBtn = document.getElementById("connect-btn");
  const disconnectBtn = document.getElementById("disconnect-btn");
  const sendBtn = document.getElementById("send-btn");
  const startBtn = document.getElementById("start-btn");
  const stopBtn = document.getElementById("stop-btn");
  const resetBtn = document.getElementById("reset-btn");
  const incBtn = document.getElementById("inc-btn");
  const decBtn = document.getElementById("dec-btn");
  const input = document.getElementById("thickness-input");

  let bleDevice = null, bleServer = null, rxChar = null, txChar = null;
  let reconnectTimer = null;
  let isWriting = false;
  const writeQueue = [];
  let rxBuffer = "";
  let sawOpenBrace = false;

  function log(...msg) {
    const line = document.createElement("div");
    line.textContent = `[${new Date().toLocaleTimeString()}] ${msg.join(" ")}`;
    logs.appendChild(line);
    logs.scrollTop = logs.scrollHeight;
    console.log(...msg);
  }

  function setStatus(connected) {
    statusText.textContent = connected ? "Connected" : "Disconnected";
    statusDot.classList.toggle("connected", connected);
  }

  async function connectBLE() {
    try {
      // optional: use filters to reduce device list, e.g.
      // const device = await navigator.bluetooth.requestDevice({ filters: [{ namePrefix: 'Cryostat' }], optionalServices: [UART_SERVICE] });
      bleDevice = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: [UART_SERVICE],
      });

      bleDevice.addEventListener("gattserverdisconnected", handleDisconnect);

      log("⏳ Connecting to", bleDevice.name || bleDevice.id, "...");
      bleServer = await bleDevice.gatt.connect();

      const service = await bleServer.getPrimaryService(UART_SERVICE);

      // RX = device characteristic we WRITE to (peripheral's RX)
      rxChar = await service.getCharacteristic(UART_RX);
      // TX = device characteristic we NOTIFY from (peripheral's TX)
      txChar = await service.getCharacteristic(UART_TX);

      await txChar.startNotifications();
      txChar.addEventListener("characteristicvaluechanged", handleNotification);

      setStatus(true);
      log("✅ Connected to", bleDevice.name || bleDevice.id);
    } catch (err) {
      log("❌ Connection failed:", err && err.message ? err.message : err);
    }
  }

  function enqueueWrite(bytes) {
    writeQueue.push(bytes);
    processQueue();
  }

  async function processQueue() {
    if (isWriting || writeQueue.length === 0) return;
    isWriting = true;
    const data = writeQueue.shift();
    try {
      // Web Bluetooth accepts ArrayBuffer or TypedArray
      await rxChar.writeValue(data);
      log("📤 TX:", new TextDecoder().decode(data));
    } catch (err) {
      log("❌ Write failed:", err && err.message ? err.message : err);
    } finally {
      isWriting = false;
      setTimeout(processQueue, 30);
    }
  }

  // Robust notification handling
  function handleNotification(event) {
    // event.target.value is a DataView. Convert to Uint8Array to decode
    const dv = event.target.value;
    const arr = new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength);
    const chunk = new TextDecoder().decode(arr);

    // Append and look for complete JSON object(s)
    rxBuffer += chunk;

    // Mark we saw an opening brace. This helps ignore stray bytes before JSON starts.
    if (!sawOpenBrace && rxBuffer.indexOf("{") !== -1) {
      sawOpenBrace = true;
      // Trim leading junk before first '{'
      rxBuffer = rxBuffer.slice(rxBuffer.indexOf("{"));
    }

    let endIdx;
    while (sawOpenBrace && (endIdx = rxBuffer.indexOf("}")) !== -1) {
      const jsonStr = rxBuffer.slice(0, endIdx + 1);
      rxBuffer = rxBuffer.slice(endIdx + 1);
      // After extracting one full object, ensure we reset sawOpenBrace if buffer empty
      if (rxBuffer.indexOf("{") === -1) sawOpenBrace = false;
      log("📥 RX:", jsonStr);
      try {
        const data = JSON.parse(jsonStr);
        if (data.temp !== undefined) tempEl.textContent = `${Number(data.temp).toFixed(1)} °C`;
        if (data.thickness !== undefined) thickEl.textContent = `${Number(data.thickness).toFixed(1)} µm`;
        if (data.speed !== undefined) speedEl.textContent = `${Number(data.speed).toFixed(0)} RPM`;
        if (data.motor !== undefined) motorEl.textContent = data.motor ? "ON" : "OFF";
      } catch (err) {
        log("⚠️ JSON parse error:", err.message);
      }
    }
  }

  function handleDisconnect() {
    log("⚠️ Disconnected from BLE device");
    setStatus(false);

    // clear local references
    rxChar = null;
    txChar = null;

    // start auto-reconnect attempts if device object available
    if (bleDevice && !reconnectTimer) {
      reconnectTimer = setInterval(async () => {
        try {
          if (!bleDevice.gatt.connected) {
            log("🔄 Attempting auto-reconnect...");
            const server = await bleDevice.gatt.connect();
            const service = await server.getPrimaryService(UART_SERVICE);
            rxChar = await service.getCharacteristic(UART_RX);
            txChar = await service.getCharacteristic(UART_TX);
            await txChar.startNotifications();
            txChar.addEventListener("characteristicvaluechanged", handleNotification);
            setStatus(true);
            log("✅ Auto-reconnected successfully");
            clearInterval(reconnectTimer);
            reconnectTimer = null;
          }
        } catch (err) {
          log("⏳ Reconnect attempt failed");
        }
      }, 4000);
    }
  }

  async function writeToRx(text) {
    if (!rxChar) return log("⚠️ Not connected or RX characteristic missing");
    const encoder = new TextEncoder();
    const bytes = encoder.encode(text);
    // split into <= 20-byte chunks to match common ATT MTU default
    const MTU = 20;
    for (let i = 0; i < bytes.length; i += MTU) {
      const slice = bytes.slice(i, i + MTU);
      enqueueWrite(slice);
    }
  }

  // --- UI Controls ---
  connectBtn.onclick = connectBLE;
  disconnectBtn.onclick = () => {
    if (bleDevice?.gatt?.connected) {
      bleDevice.gatt.disconnect();
      log("🛑 Manual disconnect requested");
    }
    setStatus(false);
  };

  sendBtn.onclick = () => writeToRx(`THICKNESS:${input.value}`);
  incBtn.onclick = () => input.stepUp();
  decBtn.onclick = () => input.stepDown();
  startBtn.onclick = () => writeToRx("START");
  stopBtn.onclick = () => writeToRx("STOP");
  resetBtn.onclick = () => writeToRx("RESET");

  setStatus(false);
});
