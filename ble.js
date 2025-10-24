// ble.js — Cryostat BLE with AUTO mode support

const UART_SERVICE = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
const UART_RX = "6e400002-b5a3-f393-e0a9-e50e24dcca9e";
const UART_TX = "6e400003-b5a3-f393-e0a9-e50e24dcca9e";

let bleDevice = null, bleServer = null, rxChar = null, txChar = null;
let connected = false;
let rxBuffer = "";
let lastSend = 0;

window.addEventListener("DOMContentLoaded", () => {
  const logEl = document.getElementById("log");
  const bleStatus = document.getElementById("ble-status");
  const toggle = document.getElementById("toggle");
  const range = document.getElementById("range");
  const meter = document.getElementById("meterFill");
  const stick = document.getElementById("stick");
  const joystick = document.getElementById("joystick");

  const sendBtn = document.getElementById("send");
  const startBtn = document.getElementById("start");
  const stopBtn = document.getElementById("stop");
  const autoBtn = document.getElementById("auto");

  const tileTemp = document.getElementById("tile-temp");
  const tileThick = document.getElementById("tile-thick");
  const tileSpeed = document.getElementById("tile-speed");
  const tileMotor = document.getElementById("tile-motor");

  const leds = [document.getElementById("led1"), document.getElementById("led2"), document.getElementById("led3")];

  function log(...msg) {
    const line = `[${new Date().toLocaleTimeString()}] ${msg.join(" ")}`;
    logEl.textContent = line + "\n" + logEl.textContent;
  }

  function setStatus(isConnected) {
    connected = isConnected;
    bleStatus.classList.toggle("connected", isConnected);
    leds.forEach(l => l.classList.toggle("on", isConnected));
  }

  async function connectBLE() {
    try {
      log("🔗 Scanning BLE...");
      bleDevice = await navigator.bluetooth.requestDevice({
        filters: [{ namePrefix: "Cryostat" }],
        optionalServices: [UART_SERVICE],
      });
      bleDevice.addEventListener("gattserverdisconnected", onDisconnect);

      bleServer = await bleDevice.gatt.connect();
      const service = await bleServer.getPrimaryService(UART_SERVICE);
      rxChar = await service.getCharacteristic(UART_RX);
      txChar = await service.getCharacteristic(UART_TX);
      await txChar.startNotifications();
      txChar.addEventListener("characteristicvaluechanged", handleNotification);

      setStatus(true);
      log("✅ Connected to", bleDevice.name);
    } catch (err) {
      log("❌ BLE connect error:", err.message);
      setStatus(false);
      toggle.classList.remove("on");
    }
  }

  async function disconnectBLE() {
    if (bleDevice && bleDevice.gatt.connected) {
      log("🔴 Disconnecting...");
      await bleDevice.gatt.disconnect();
    }
    setStatus(false);
  }

  function onDisconnect() {
    log("⚠️ BLE disconnected");
    setStatus(false);
    toggle.classList.remove("on");
  }

  function handleNotification(event) {
    const chunk = new TextDecoder().decode(event.target.value);
    rxBuffer += chunk;
    let endIdx;
    while ((endIdx = rxBuffer.indexOf("}")) !== -1) {
      const jsonStr = rxBuffer.slice(0, endIdx + 1);
      rxBuffer = rxBuffer.slice(endIdx + 1);
      try {
        const data = JSON.parse(jsonStr);
        updateUI(data);
      } catch (err) {}
    }
  }

  function updateUI(data) {
    if (data.temp !== undefined) tileTemp.textContent = `Temperature: ${data.temp.toFixed(1)} °C`;
    if (data.thickness !== undefined) tileThick.textContent = `Thickness: ${data.thickness.toFixed(1)} µm`;
    if (data.speed !== undefined) tileSpeed.textContent = `Speed: ${data.speed} RPM`;
    if (data.motor !== undefined) tileMotor.textContent = `Motor: ${data.motor ? "ON 🟢" : "OFF 🔴"}`;
    if (data.auto !== undefined) {
      const autoTile = tileMotor; // reuse motor tile to reflect Auto
      if (data.auto) {
        autoTile.textContent = "Auto Mode: ON 🔁";
        autoTile.classList.add("auto-on");
      } else {
        autoTile.textContent = `Motor: ${data.motor ? "ON 🟢" : "OFF 🔴"}`;
        autoTile.classList.remove("auto-on");
      }
    }
  }

  async function writeToRx(text) {
    if (!rxChar) return log("⚠️ Not connected");
    const data = new TextEncoder().encode(text);
    for (let i = 0; i < data.length; i += 20) {
      await rxChar.writeValue(data.slice(i, i + 20));
    }
    log("📤 TX:", text);
  }

  // Buttons
  sendBtn.onclick = async () => { if (connected) await writeToRx(`THICKNESS:${range.value}`); };
  startBtn.onclick = async () => { if (connected) await writeToRx("START"); };
  stopBtn.onclick = async () => { if (connected) await writeToRx("STOP"); };
  autoBtn.onclick = async () => { if (connected) await writeToRx("AUTO"); };

  // BLE toggle
  toggle.addEventListener("click", async () => {
    toggle.classList.toggle("on");
    if (toggle.classList.contains("on")) await connectBLE();
    else await disconnectBLE();
  });

  // Range meter
  range.addEventListener("input", e => {
    meter.style.height = e.target.value + "%";
  });

  // Joystick control
  let activePointer = null, lastSend = 0;
  joystick.addEventListener("pointerdown", ev => { if (!connected) return; joystick.setPointerCapture(ev.pointerId); activePointer = ev.pointerId; onMove(ev); });
  joystick.addEventListener("pointermove", ev => { if (activePointer === ev.pointerId) onMove(ev); });
  joystick.addEventListener("pointerup", () => { activePointer = null; stick.style.transform = "translate(-50%,-50%)"; if (connected) writeToRx(JSON.stringify({ motor: 0, speed: 0 })); });

  function onMove(ev) {
    const rect = joystick.getBoundingClientRect();
    const x = ev.clientX - rect.left - rect.width / 2;
    const y = ev.clientY - rect.top - rect.height / 2;
    const max = rect.width / 3;
    const dx = Math.max(-max, Math.min(max, x));
    const dy = Math.max(-max, Math.min(max, y));
    stick.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    const nx = dx / max, ny = dy / max;
    const speed = Math.round(Math.abs(ny) * 300);
    const motor = ny !== 0 ? 1 : 0;
    const angle = Math.round(nx * 45);
    const now = performance.now();
    if (connected && rxChar && now - lastSend >= 100) {
      lastSend = now;
      writeToRx(JSON.stringify({ motor, speed, angle }));
    }
  }
});
