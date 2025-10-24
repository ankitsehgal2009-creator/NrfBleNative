// ble.js — Cryostat Microtome BLE + Joystick + Telemetry + Toggle Connect
// Designed for nRF51822 (Nordic UART Service)

const UART_SERVICE = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
const UART_RX = "6e400002-b5a3-f393-e0a9-e50e24dcca9e";
const UART_TX = "6e400003-b5a3-f393-e0a9-e50e24dcca9e";

let bleDevice = null, bleServer = null, rxChar = null, txChar = null;
let rxBuffer = "";
let connected = false;
let lastSend = 0;
const SEND_INTERVAL = 100; // ms between joystick sends

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

  const tileTemp = document.getElementById("tile-temp");
  const tileThick = document.getElementById("tile-thick");
  const tileSpeed = document.getElementById("tile-speed");
  const tileMotor = document.getElementById("tile-motor");
  const leds = [document.getElementById("led1"), document.getElementById("led2"), document.getElementById("led3")];

  // 🧠 Helper: Logging function
  function log(...msg) {
    const line = `[${new Date().toLocaleTimeString()}] ${msg.join(" ")}`;
    logEl.textContent = line + "\n" + logEl.textContent;
    console.log(...msg);
  }

  // 🟢 Update BLE connection status (dot + LEDs)
  function setStatus(isConnected) {
    connected = isConnected;
    bleStatus.classList.toggle("connected", isConnected);
    leds.forEach(l => l.classList.toggle("on", isConnected));
  }

  // 🔄 BLE Connect
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
      log("✅ Connected to", bleDevice.name);
    } catch (err) {
      log("❌ BLE error:", err.message);
      setStatus(false);
      toggle.classList.remove("on");
    }
  }

  // 🔌 Disconnect BLE
  async function disconnectBLE() {
    if (bleDevice && bleDevice.gatt.connected) {
      log("🔴 Disconnecting from BLE...");
      await bleDevice.gatt.disconnect();
      setStatus(false);
    } else {
      setStatus(false);
    }
  }

  // ⚠️ Handle Disconnect Event
  function onDisconnect() {
    log("⚠️ Device disconnected");
    setStatus(false);
    toggle.classList.remove("on");
  }

  // 📥 Handle incoming BLE data (JSON fragments)
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
        log("📥 RX:", jsonStr);
      } catch (err) {
        // ignore partial or invalid fragments
      }
    }
  }

  // 🖥️ Update UI based on incoming JSON telemetry
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

  // ✉️ Write text/JSON to BLE RX characteristic
  async function writeToRx(text) {
    if (!rxChar) return log("⚠️ Not connected");
    const encoder = new TextEncoder();
    const bytes = encoder.encode(text);
    for (let i = 0; i < bytes.length; i += 20) {
      await rxChar.writeValue(bytes.slice(i, i + 20));
    }
    log("📤 TX:", text);
  }

  // 🎛️ Button Actions
  sendBtn.onclick = async () => {
    if (!connected) return log("⚠️ BLE not connected");
    await writeToRx(`THICKNESS:${range.value}`);
  };
  startBtn.onclick = async () => {
    if (!connected) return log("⚠️ BLE not connected");
    await writeToRx("START");
  };
  stopBtn.onclick = async () => {
    if (!connected) return log("⚠️ BLE not connected");
    await writeToRx("STOP");
  };

  // 📊 Thickness range control
  range.addEventListener("input", e => {
    meter.style.height = e.target.value + "%";
  });

  // 🎮 Joystick handling (motor control)
  let activePointer = null;
  joystick.addEventListener("pointerdown", ev => {
    if (!connected) return;
    joystick.setPointerCapture(ev.pointerId);
    activePointer = ev.pointerId;
    onPointerMove(ev);
  });
  joystick.addEventListener("pointermove", ev => {
    if (activePointer === ev.pointerId) onPointerMove(ev);
  });
  joystick.addEventListener("pointerup", () => {
    activePointer = null;
    stick.style.transform = "translate(-50%,-50%)";
    if (connected) writeToRx(JSON.stringify({ motor: 0, speed: 0 }));
  });

  function onPointerMove(ev) {
    const rect = joystick.getBoundingClientRect();
    const x = ev.clientX - rect.left - rect.width / 2;
    const y = ev.clientY - rect.top - rect.height / 2;
    const max = rect.width / 3;
    const dx = Math.max(-max, Math.min(max, x));
    const dy = Math.max(-max, Math.min(max, y));
    stick.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;

    const nx = dx / max;
    const ny = dy / max;
    const speed = Math.round(Math.abs(ny) * 300);
    const motor = ny !== 0 ? 1 : 0;
    const angle = Math.round(nx * 45);

    const now = performance.now();
    if (connected && rxChar && now - lastSend >= SEND_INTERVAL) {
      lastSend = now;
      writeToRx(JSON.stringify({ motor, speed, angle }));
    }
  }

  // 🟣 BLE Toggle Switch
  toggle.addEventListener("click", async () => {
    toggle.classList.toggle("on");
    if (toggle.classList.contains("on")) {
      await connectBLE();
    } else {
      await disconnectBLE();
    }
  });
});
