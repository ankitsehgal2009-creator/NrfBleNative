// Revised ble.js — with Web Bluetooth support detection and fallback notice

const UART_SERVICE = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
const UART_RX = "6e400002-b5a3-f393-e0a9-e50e24dcca9e";
const UART_TX = "6e400003-b5a3-f393-e0a9-e50e24dcca9e";

let bleDevice = null, bleServer = null, rxChar = null, txChar = null;
let connected = false, rxBuffer = "", lastSend = 0;

window.addEventListener("DOMContentLoaded", () => {
  const logEl = document.getElementById("log");
  const bleStatus = document.getElementById("ble-status");
  const toggle = document.getElementById("toggle");
  const autoBtn = document.getElementById("auto");
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

  function setStatus(isConn) {
    connected = isConn;
    bleStatus.classList.toggle("connected", isConn);
    leds.forEach(l => l.classList.toggle("on", isConn));
  }

  function isWebBluetoothSupported() {
    return navigator.bluetooth !== undefined;
  }

  async function connectBLE() {
    if (!isWebBluetoothSupported()) {
      log("❌ Web Bluetooth not supported by this browser.");
      alert("This browser does not support BLE. Please use a compatible browser (e.g., Chrome on Android) or a native app for iOS.");
      toggle.classList.remove("on");
      return;
    }
    try {
      log("🔗 Scanning for Cryostat BLE device...");
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
    } catch (error) {
      log("❌ BLE connection error:", error.message);
      setStatus(false);
      toggle.classList.remove("on");
    }
  }

  async function disconnectBLE() {
    if (bleDevice && bleDevice.gatt.connected) {
      log("🔴 Disconnecting BLE...");
      await bleDevice.gatt.disconnect();
    }
    setStatus(false);
  }

  function onDisconnect() {
    log("⚠️ BLE device disconnected");
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
      } catch (e) {
        log("⚠️ JSON parse error:", e);
      }
    }
  }

  function updateUI(data) {
    if (data.temp !== undefined) tileTemp.textContent = `Temperature: ${data.temp.toFixed(1)} °C`;
    if (data.thickness !== undefined) tileThick.textContent = `Thickness: ${data.thickness.toFixed(1)} µm`;
    if (data.speed !== undefined) tileSpeed.textContent = `Speed: ${data.speed} RPM`;
    if (data.motor !== undefined) tileMotor.textContent = `Motor: ${data.motor ? "ON 🟢" : "OFF 🔴"}`;
    if (data.auto !== undefined) {
      if (data.auto) {
        tileMotor.textContent = "Auto Mode: ON 🔁";
        tileMotor.classList.add("auto-on", "auto-anim");
      } else {
        tileMotor.textContent = `Motor: ${data.motor ? "ON 🟢" : "OFF 🔴"}`;
        tileMotor.classList.remove("auto-on", "auto-anim");
      }
    }
  }

  async function writeToRx(text) {
    if (!rxChar) {
      log("⚠️ Cannot write: Not connected.");
      return;
    }
    const encoder = new TextEncoder();
    const bytes = encoder.encode(text);
    for (let i = 0; i < bytes.length; i += 20) {
      await rxChar.writeValue(bytes.slice(i, i + 20));
    }
    log("📤 TX:", text);
  }

  // Button handlers
  sendBtn.onclick = () => { if (connected) writeToRx(`THICKNESS:${range.value}`); else log("⚠️ Not connected."); };
  startBtn.onclick = () => { if (connected) writeToRx("START"); else log("⚠️ Not connected."); };
  stopBtn.onclick = () => { if (connected) writeToRx("STOP"); else log("⚠️ Not connected."); };
  autoBtn.onclick = () => { if (connected) writeToRx("AUTO"); else log("⚠️ Not connected."); };

  // Toggle connect/disconnect
  toggle.addEventListener("click", async () => {
    toggle.classList.toggle("on");
    if (toggle.classList.contains("on")) {
      await connectBLE();
    } else {
      await disconnectBLE();
    }
  });

  // Range slider updates
  range.addEventListener("input", e => meter.style.height = e.target.value + "%");

  // Joystick logic
  let activePointer = null;
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
    const speedVal = Math.round(Math.abs(ny) * 300);
    const motorVal = ny !== 0 ? 1 : 0;
    const angleVal = Math.round(nx * 45);
    const now = performance.now();
    if (connected && rxChar && now - lastSend >= 100) {
      lastSend = now;
      writeToRx(JSON.stringify({ motor: motorVal, speed: speedVal, angle: angleVal }));
    }
  }

});
