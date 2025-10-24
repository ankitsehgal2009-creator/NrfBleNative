// ble.js — Cryostat BLE Dashboard

const UART_SERVICE = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
const UART_RX = "6e400002-b5a3-f393-e0a9-e50e24dcca9e";
const UART_TX = "6e400003-b5a3-f393-e0a9-e50e24dcca9e";

let bleDevice, bleServer, rxChar, txChar;
let rxBuffer = "";
let reconnectTimer = null;

document.addEventListener("DOMContentLoaded", () => {
  const connectBtn = document.getElementById("connect-btn");
  const disconnectBtn = document.getElementById("disconnect-btn");
  const sendBtn = document.getElementById("send-btn");
  const startBtn = document.getElementById("start-btn");
  const stopBtn = document.getElementById("stop-btn");
  const resetBtn = document.getElementById("reset-btn");
  const input = document.getElementById("thickness-input");
  const logs = document.getElementById("logs");
  const statusText = document.getElementById("status-text");
  const statusDot = document.getElementById("status-dot");

  const tempVal = document.getElementById("val-temp");
  const thickVal = document.getElementById("val-thickness");
  const speedVal = document.getElementById("val-speed");
  const motorVal = document.getElementById("val-motor");

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
      bleDevice = await navigator.bluetooth.requestDevice({
        filters: [{ namePrefix: "Cryostat" }],
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
        try {
          if (!bleDevice) return;
          if (!bleDevice.gatt.connected) {
            log("🔄 Trying to reconnect...");
            bleServer = await bleDevice.gatt.connect();
            const service = await bleServer.getPrimaryService(UART_SERVICE);
            rxChar = await service.getCharacteristic(UART_RX);
            txChar = await service.getCharacteristic(UART_TX);
            await txChar.startNotifications();
            txChar.addEventListener("characteristicvaluechanged", handleNotification);
            setStatus(true);
            clearInterval(reconnectTimer);
            reconnectTimer = null;
            log("✅ Reconnected successfully");
          }
        } catch (err) {
          log("⏳ Reconnect failed:", err.message);
        }
      }, 4000);
    }
  }

  function handleNotification(event) {
    const value = event.target.value;
    const arr = new Uint8Array(value.buffer);
    const chunk = new TextDecoder().decode(arr);
    rxBuffer += chunk;

    let endIdx;
    while ((endIdx = rxBuffer.indexOf("}")) !== -1) {
      const jsonStr = rxBuffer.slice(0, endIdx + 1);
      rxBuffer = rxBuffer.slice(endIdx + 1);

      try {
        const data = JSON.parse(jsonStr);
        log("📥 RX:", jsonStr);

        if (data.temp !== undefined) tempVal.textContent = `${data.temp.toFixed(1)} °C`;
        if (data.thickness !== undefined) thickVal.textContent = `${data.thickness.toFixed(1)} µm`;
        if (data.speed !== undefined) speedVal.textContent = `${data.speed.toFixed(0)} RPM`;
        if (data.motor !== undefined)
          motorVal.textContent = data.motor ? "ON 🟢" : "OFF 🔴";
      } catch (err) {
        log("⚠️ JSON parse error:", err.message);
      }
    }
  }

  async function writeToRx(text) {
    if (!rxChar) return log("⚠️ Not connected");
    const encoder = new TextEncoder();
    const bytes = encoder.encode(text);
    const MTU = 20;
    for (let i = 0; i < bytes.length; i += MTU) {
      const slice = bytes.slice(i, i + MTU);
      await rxChar.writeValue(slice);
    }
    log("📤 TX:", text);
  }

  // UI Button Handlers
  connectBtn.onclick = connectBLE;
  disconnectBtn.onclick = () => bleDevice?.gatt?.disconnect();
  sendBtn.onclick = () => writeToRx(`THICKNESS:${input.value}`);
  startBtn.onclick = () => writeToRx("START");
  stopBtn.onclick = () => writeToRx("STOP");
  resetBtn.onclick = () => writeToRx("RESET");

  setStatus(false);
});
