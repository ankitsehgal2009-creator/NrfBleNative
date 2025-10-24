// ble.js — for Cryostat Microtome (nRF51822 BLE JSON parser)

const UART_SERVICE = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
const UART_RX = "6e400002-b5a3-f393-e0a9-e50e24dcca9e";
const UART_TX = "6e400003-b5a3-f393-e0a9-e50e24dcca9e";

let bleDevice, bleServer, rxChar, txChar;
let rxBuffer = "";

window.addEventListener("DOMContentLoaded", () => {
  const logEl = document.getElementById("log");
  const connectBtn = document.getElementById("connectTransport");
  const sendBtn = document.getElementById("send");
  const startBtn = document.getElementById("start");
  const stopBtn = document.getElementById("stop");

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

  function setLEDs(on) {
    leds.forEach(l => l.classList.toggle("on", on));
  }

  // Connect to BLE
  connectBtn.onclick = async () => {
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

      log("✅ Connected to", bleDevice.name);
      setLEDs(true);
    } catch (err) {
      log("❌ BLE error:", err.message);
    }
  };

  // Disconnect
  function onDisconnect() {
    setLEDs(false);
    log("⚠️ Device disconnected");
  }

  // Parse incoming JSON data
  function handleNotification(event) {
    const chunk = new TextDecoder().decode(event.target.value);
    rxBuffer += chunk;

    let endIdx;
    while ((endIdx = rxBuffer.indexOf("}")) !== -1) {
      const jsonStr = rxBuffer.slice(0, endIdx + 1);
      rxBuffer = rxBuffer.slice(endIdx + 1);
      try {
        const data = JSON.parse(jsonStr);
        log("📥 RX:", jsonStr);
        updateUI(data);
      } catch (e) {
        // ignore incomplete fragments
      }
    }
  }

  // Update UI elements
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
      const slice = bytes.slice(i, i + MTU);
      await rxChar.writeValue(slice);
    }
    log("📤 TX:", text);
  }

  // Buttons
  sendBtn.onclick = async () => {
    const val = document.getElementById("range").value;
    await writeToRx(`THICKNESS:${val}`);
    log(`📤 Sent thickness: ${val}`);
  };

  startBtn.onclick = async () => {
    await writeToRx("START");
    setLEDs(true);
  };

  stopBtn.onclick = async () => {
    await writeToRx("STOP");
    setLEDs(false);
  };
});
