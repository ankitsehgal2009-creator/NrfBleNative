// ble.js — Cryostat Microtome BLE Controller + Telemetry Parser (nRF51822)

const UART_SERVICE = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
const UART_RX = "6e400002-b5a3-f393-e0a9-e50e24dcca9e";
const UART_TX = "6e400003-b5a3-f393-e0a9-e50e24dcca9e";

let bleDevice, bleServer, rxChar, txChar;
let rxBuffer = "";
let joystickActive = false;

window.addEventListener("DOMContentLoaded", () => {
  const logEl = document.getElementById("log");
  const bleStatus = document.getElementById("ble-status");
  const sendBtn = document.getElementById("send");
  const startBtn = document.getElementById("start");
  const stopBtn = document.getElementById("stop");
  const range = document.getElementById("range");
  const meter = document.getElementById("meterFill");
  const stick = document.getElementById("stick");
  const joystick = document.getElementById("joystick");

  const tileTemp = document.getElementById("tile-temp");
  const tileThick = document.getElementById("tile-thick");
  const tileSpeed = document.getElementById("tile-speed");
  const tileMotor = document.getElementById("tile-motor");
  const leds = [document.getElementById("led1"), document.getElementById("led2"), document.getElementById("led3")];

  function log(...msg) {
    const line = `[${new Date().toLocaleTimeString()}] ${msg.join(" ")}`;
    logEl.textContent = line + "\n" + logEl.textContent;
    console.log(...msg);
  }

  function setStatus(connected) {
    bleStatus.classList.toggle("connected", connected);
    leds.forEach(l => l.classList.toggle("on", connected));
  }

  // BLE Connect
  async function connectBLE() {
    try {
      log("🔗 Requesting Cryostat BLE device...");
      bleDevice = await navigator.bluetooth.requestDevice({
        filters: [{ namePrefix: "Cryostat" }],
        optionalServices: [UART_SERVICE],
      });
      bleDevice.addEventListener("gattserverdisconnected", onDisconnect);
      log("⏳ Connecting...");
      bleServer = await bleDevice.gatt.connect();
      const service = await bleServer.getPrimaryService(UART_SERVICE);
      rxChar = await service.getCharacteristic(UART_RX);
      txChar = await service.getCharacteristic(UART_TX);
      await txChar.startNotifications();
      txChar.addEventListener("characteristicvaluechanged", handleNotification);
      setStatus(true);
      log("✅ Connected to " + bleDevice.name);
    } catch (e) {
      log("❌ BLE error:", e.message);
    }
  }

  function onDisconnect() {
    setStatus(false);
    log("⚠️ BLE device disconnected");
  }

  // Handle BLE Notifications
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
        log("📥 RX: " + jsonStr);
      } catch (err) {
        // Ignore partial fragments
      }
    }
  }

  function updateUI(data) {
    if (data.temp !== undefined)
      tileTemp.textContent = `Temperature: ${data.temp.toFixed(1)} °C`;
    if (data.thickness !== undefined)
      tileThick.textContent = `Thickness: ${data.thickness.toFixed(1)} µm`;
    if (data.speed !== undefined)
      tileSpeed.textContent = `Speed: ${data.speed.toFixed(0)} RPM`;
    if (data.motor !== undefined)
      tileMotor.textContent = `Motor: ${data.motor ? "ON 🟢" : "OFF 🔴"}`;
  }

  async function writeToRx(text) {
    if (!rxChar) return log("⚠️ Not connected");
    const encoder = new TextEncoder();
    const bytes = encoder.encode(text);
    const MTU = 20;
    for (let i = 0; i < bytes.length; i += MTU) {
      await rxChar.writeValue(bytes.slice(i, i + MTU));
    }
    log("📤 TX: " + text);
  }

  // Button handlers
  sendBtn.onclick = async () => {
    await writeToRx(`THICKNESS:${range.value}`);
  };
  startBtn.onclick = async () => writeToRx("START");
  stopBtn.onclick = async () => writeToRx("STOP");

  // Connect automatically on load
  connectBLE();

  // Range updates
  range.addEventListener("input", e => {
    meter.style.height = e.target.value + "%";
  });

  // Joystick handling
  let activePointer = null;
  let lastSend = 0;
  const SEND_INTERVAL = 100; // ms between BLE sends

  joystick.addEventListener("pointerdown", ev => {
    joystick.setPointerCapture(ev.pointerId);
    activePointer = ev.pointerId;
    joystickActive = true;
    onPointerMove(ev);
  });

  joystick.addEventListener("pointermove", ev => {
    if (activePointer === ev.pointerId) onPointerMove(ev);
  });

  joystick.addEventListener("pointerup", () => {
    activePointer = null;
    joystickActive = false;
    stick.style.transform = "translate(-50%,-50%)";
    writeToRx(JSON.stringify({ x: 0, y: 0 })); // send stop
  });

  function onPointerMove(ev) {
    const rect = joystick.getBoundingClientRect();
    const x = ev.clientX - rect.left - rect.width / 2;
    const y = ev.clientY - rect.top - rect.height / 2;
    const max = rect.width / 3;
    const dx = Math.max(-max, Math.min(max, x));
    const dy = Math.max(-max, Math.min(max, y));
    stick.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    const nx = (dx / max).toFixed(2);
    const ny = (dy / max).toFixed(2);
    const now = performance.now();
    if (txChar && now - lastSend >= SEND_INTERVAL) {
      lastSend = now;
      writeToRx(JSON.stringify({ x: nx, y: ny }));
    }
  }
});
