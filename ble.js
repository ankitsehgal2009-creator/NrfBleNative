// ble.js — Cryostat Microtome BLE link for nRF51822 (Web Bluetooth)

const UART_SERVICE = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
const UART_RX = "6e400002-b5a3-f393-e0a9-e50e24dcca9e"; // write
const UART_TX = "6e400003-b5a3-f393-e0a9-e50e24dcca9e"; // notify

let bleDevice = null, bleServer = null, rxChar = null, txChar = null;
let reconnectTimer = null;
let rxBuffer = "";

document.addEventListener("DOMContentLoaded", () => {
  const statusText = document.getElementById("status-text");
  const statusDot = document.getElementById("status-dot");
  const logs = document.getElementById("logs");

  const tempEl = document.getElementById("param-temp");
  const thickEl = document.getElementById("param-thick");
  const speedEl = document.getElementById("param-speed");
  const motorEl = document.getElementById("param-motor");

  const connectBtn = document.getElementById("connect-btn");
  const disconnectBtn = document.getElementById("disconnect-btn");
  const startBtn = document.getElementById("start-btn");
  const stopBtn = document.getElementById("stop-btn");
  const resetBtn = document.getElementById("reset-btn");

  function log(msg) {
    const line = document.createElement("div");
    line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
    logs.appendChild(line);
    logs.scrollTop = logs.scrollHeight;
    console.log(msg);
  }

  function setStatus(connected) {
    statusText.textContent = connected ? "Connected" : "Disconnected";
    statusDot.classList.toggle("connected", connected);
  }

  async function connectBLE() {
    try {
      bleDevice = await navigator.bluetooth.requestDevice({
        filters: [{ namePrefix: "Cryostat" }],
        optionalServices: [UART_SERVICE],
      });

      bleDevice.addEventListener("gattserverdisconnected", handleDisconnect);
      log("⏳ Connecting to " + bleDevice.name + "...");
      bleServer = await bleDevice.gatt.connect();

      const service = await bleServer.getPrimaryService(UART_SERVICE);
      rxChar = await service.getCharacteristic(UART_RX);
      txChar = await service.getCharacteristic(UART_TX);

      await txChar.startNotifications();
      txChar.addEventListener("characteristicvaluechanged", handleNotification);

      setStatus(true);
      log("✅ Connected to " + bleDevice.name);
    } catch (err) {
      log("❌ Connection failed: " + err.message);
    }
  }

  function handleDisconnect() {
    log("⚠️ Disconnected from BLE device");
    setStatus(false);
    rxChar = null;
    txChar = null;

    if (!reconnectTimer && bleDevice) {
      reconnectTimer = setInterval(async () => {
        try {
          if (!bleDevice.gatt.connected) {
            log("🔄 Attempting auto-reconnect...");
            bleServer = await bleDevice.gatt.connect();
            const service = await bleServer.getPrimaryService(UART_SERVICE);
            rxChar = await service.getCharacteristic(UART_RX);
            txChar = await service.getCharacteristic(UART_TX);
            await txChar.startNotifications();
            txChar.addEventListener("characteristicvaluechanged", handleNotification);
            setStatus(true);
            clearInterval(reconnectTimer);
            reconnectTimer = null;
            log("✅ Auto-reconnected successfully");
          }
        } catch (e) {
          log("Reconnect attempt failed: " + e.message);
        }
      }, 5000);
    }
  }

  // JSON reassembly + parsing
  function handleNotification(event) {
    const val = new TextDecoder().decode(event.target.value);
    rxBuffer += val;

    let endIdx;
    while ((endIdx = rxBuffer.indexOf("}")) !== -1) {
      const jsonStr = rxBuffer.slice(0, endIdx + 1);
      rxBuffer = rxBuffer.slice(endIdx + 1);

      try {
        const data = JSON.parse(jsonStr);
        log("📥 RX: " + jsonStr);

        if (data.temp !== undefined) tempEl.textContent = data.temp.toFixed(1) + " °C";
        if (data.thickness !== undefined) thickEl.textContent = data.thickness.toFixed(1) + " µm";
        if (data.speed !== undefined) speedEl.textContent = data.speed.toFixed(0) + " RPM";
        if (data.motor !== undefined)
          motorEl.textContent = data.motor ? "ON 🟢" : "OFF 🔴";
      } catch (e) {
        // ignore incomplete fragments
      }
    }
  }

  async function writeToRx(text) {
    if (!rxChar) {
      log("⚠️ Not connected.");
      return;
    }
    const encoder = new TextEncoder();
    const bytes = encoder.encode(text);
    const MTU = 20;
    for (let i = 0; i < bytes.length; i += MTU) {
      const slice = bytes.slice(i, i + MTU);
      await rxChar.writeValue(slice);
    }
    log("📤 TX: " + text);
  }

  // Make writeToRx globally available (used by index.html inline script)
  window.writeToRx = writeToRx;

  // Buttons
  connectBtn.onclick = connectBLE;
  disconnectBtn.onclick = () => bleDevice?.gatt?.disconnect();
  startBtn.onclick = () => writeToRx("START");
  stopBtn.onclick = () => writeToRx("STOP");
  resetBtn.onclick = () => writeToRx("RESET");

  setStatus(false);
});
