// Cryostat BLE Dashboard — Fixed JSON Assembly + Auto-Reconnect

const UART_SERVICE = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
const UART_RX = "6e400002-b5a3-f393-e0a9-e50e24dcca9e";
const UART_TX = "6e400003-b5a3-f393-e0a9-e50e24dcca9e";

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

  let bleDevice, bleServer, rxChar, txChar;
  let reconnectTimer = null;
  let isWriting = false;
  const writeQueue = [];
  let rxBuffer = ""; // 🧠 Buffer for assembling JSON fragments

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

  async function ensureLocationPermission() {
    if (!("geolocation" in navigator)) return true;
    try {
      const st = await navigator.permissions.query({ name: "geolocation" });
      if (st.state === "granted") return true;
      if (st.state === "prompt") {
        await new Promise((res, rej) =>
          navigator.geolocation.getCurrentPosition(() => res(true), rej)
        );
        return true;
      }
      alert("Please enable location access for BLE scanning.");
      return false;
    } catch {
      return false;
    }
  }

  async function connectBLE() {
    try {
      const allowed = await ensureLocationPermission();
      if (!allowed) return;

      bleDevice = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: [UART_SERVICE],
      });
      bleDevice.addEventListener("gattserverdisconnected", handleDisconnect);

      log("⏳ Connecting to", bleDevice.name, "...");
      bleServer = await bleDevice.gatt.connect();

      const service = await bleServer.getPrimaryService(UART_SERVICE);
      rxChar = await service.getCharacteristic(UART_RX);
      txChar = await service.getCharacteristic(UART_TX);

      await txChar.startNotifications();
      txChar.addEventListener("characteristicvaluechanged", handleNotification);

      setStatus(true);
      log("✅ Connected to", bleDevice.name);
    } catch (err) {
      log("❌ Connection failed:", err.message);
    }
  }

  function handleDisconnect() {
    log("⚠️ Disconnected from BLE device");
    setStatus(false);

    if (!reconnectTimer) {
      reconnectTimer = setInterval(async () => {
        if (!bleDevice) return;
        try {
          if (!bleDevice.gatt.connected) {
            log("🔄 Attempting auto-reconnect...");
            await bleDevice.gatt.connect();
            const service = await bleDevice.gatt.getPrimaryService(UART_SERVICE);
            rxChar = await service.getCharacteristic(UART_RX);
            txChar = await service.getCharacteristic(UART_TX);
            await txChar.startNotifications();
            txChar.addEventListener("characteristicvaluechanged", handleNotification);
            clearInterval(reconnectTimer);
            reconnectTimer = null;
            setStatus(true);
            log("✅ Auto-reconnected successfully");
          }
        } catch {
          log("⏳ Reconnect attempt failed");
        }
      }, 5000);
    }
  }

  async function writeToRx(data) {
    if (!rxChar) return log("⚠️ Not connected");
    const bytes = new TextEncoder().encode(data);
    writeQueue.push(bytes);
    processQueue();
  }

  async function processQueue() {
    if (isWriting || writeQueue.length === 0) return;
    isWriting = true;
    const data = writeQueue.shift();
    try {
      await rxChar.writeValue(data);
      log("📤 TX:", new TextDecoder().decode(data));
    } catch (err) {
      log("❌ Write failed:", err.message);
    } finally {
      isWriting = false;
      setTimeout(processQueue, 50);
    }
  }

  // ✅ FIXED: Reassemble JSON before parsing
  function handleNotification(event) {
    const chunk = new TextDecoder().decode(event.target.value);
    rxBuffer += chunk;

    // Process each complete JSON object
    let endIdx;
    while ((endIdx = rxBuffer.indexOf("}")) !== -1) {
      const jsonStr = rxBuffer.slice(0, endIdx + 1);
      rxBuffer = rxBuffer.slice(endIdx + 1);
      log("📥 RX:", jsonStr);
      try {
        const data = JSON.parse(jsonStr);
        if (data.temp !== undefined) tempEl.textContent = `${data.temp.toFixed(1)} °C`;
        if (data.thickness !== undefined)
          thickEl.textContent = `${data.thickness.toFixed(1)} µm`;
        if (data.speed !== undefined)
          speedEl.textContent = `${data.speed.toFixed(0)} RPM`;
        if (data.motor !== undefined)
          motorEl.textContent = data.motor ? "ON" : "OFF";
      } catch (err) {
        // Ignore incomplete JSON fragments
      }
    }
  }

  // --- UI Controls ---
  connectBtn.onclick = connectBLE;
  disconnectBtn.onclick = () => {
    if (bleDevice?.gatt?.connected) bleDevice.gatt.disconnect();
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
