// ble.js — Compatible with ESP32 BLE Server (UUIDs from your Arduino code)

const SERVICE_UUID = "4fafc201-1fb5-459e-8fcc-c5c9c331914b";
const CHARACTERISTIC_UUID = "beb5483e-36e1-4688-b7f5-ea07361b26a8";

let bleDevice = null;
let bleServer = null;
let bleCharacteristic = null;
let isConnected = false;

// 🟢 UI Elements
const logEl = document.getElementById("log");
const toggleEl = document.getElementById("toggle");
const statusDot = document.getElementById("ble-status");
const tileTemp = document.getElementById("tile-temp");
const tileThick = document.getElementById("tile-thick");
const tileSpeed = document.getElementById("tile-speed");
const tileMotor = document.getElementById("tile-motor");
const meterFill = document.getElementById("meterFill");
const leds = [document.getElementById("led1"), document.getElementById("led2"), document.getElementById("led3")];
const joystick = document.getElementById("joystick");
const stick = document.getElementById("stick");

// 🧠 Helper log function
function log(msg) {
  logEl.textContent = `log: ${msg}`;
  console.log(msg);
}

// 🧩 Connect to ESP32 BLE
async function connectBLE() {
  try {
    log("Requesting BLE device...");
    bleDevice = await navigator.bluetooth.requestDevice({
      filters: [{ namePrefix: "ESP32" }],
      optionalServices: [SERVICE_UUID]
    });

    bleDevice.addEventListener("gattserverdisconnected", onDisconnected);

    log("Connecting to GATT server...");
    bleServer = await bleDevice.gatt.connect();

    log("Getting service...");
    const service = await bleServer.getPrimaryService(SERVICE_UUID);

    log("Getting characteristic...");
    bleCharacteristic = await service.getCharacteristic(CHARACTERISTIC_UUID);

    await bleCharacteristic.startNotifications();
    bleCharacteristic.addEventListener("characteristicvaluechanged", handleNotifications);

    updateConnectionStatus(true);
    log("Connected. Listening for data...");
  } catch (error) {
    log("Connection failed: " + error);
  }
}

// 📡 Handle incoming notifications (from ESP32)
function handleNotifications(event) {
  const value = event.target.value;
  const data = value.getUint32(0, true);

  tileTemp.textContent = `Temperature: ${(data % 50) + 20} °C`;
  tileThick.textContent = `Thickness: ${(data % 10) + 2} µm`;
  tileSpeed.textContent = `Speed: ${(data * 3) % 300} RPM`;
  tileMotor.textContent = `Motor: ${data % 2 === 0 ? "ON" : "OFF"}`;

  leds.forEach((led, i) => {
    if ((data >> i) & 1) led.classList.add("on");
    else led.classList.remove("on");
  });

  meterFill.style.height = `${(data % 100)}%`;
}

// 🔴 Disconnect handler
function disconnectBLE() {
  if (!bleDevice) return;
  log("Disconnecting...");
  bleDevice.gatt.disconnect();
}

// ⚙️ When BLE disconnects
function onDisconnected() {
  log("Disconnected from device.");
  updateConnectionStatus(false);
}

// 🟢 Toggle connection
function toggleConnection() {
  if (isConnected) disconnectBLE();
  else connectBLE();
}

// 💡 Update BLE indicator + toggle switch
function updateConnectionStatus(connected) {
  isConnected = connected;
  if (connected) {
    toggleEl.classList.add("on");
    statusDot.classList.add("connected");
  } else {
    toggleEl.classList.remove("on");
    statusDot.classList.remove("connected");
  }
}

// 🎚️ Send slider (thickness) value to ESP32
document.getElementById("range").addEventListener("input", async (e) => {
  const val = parseInt(e.target.value);
  meterFill.style.height = `${val}%`;
  if (isConnected && bleCharacteristic) {
    const buffer = new Uint8Array([val]);
    await bleCharacteristic.writeValue(buffer);
    log("Sent thickness: " + val);
  }
});

// 🕹️ Joystick logic (sends small XY data)
let joyRect = joystick.getBoundingClientRect();
let center = { x: joyRect.width / 2, y: joyRect.height / 2 };

joystick.addEventListener("mousemove", (e) => {
  if (e.buttons !== 1) return;
  const dx = e.offsetX - center.x;
  const dy = e.offsetY - center.y;
  const dist = Math.min(40, Math.sqrt(dx * dx + dy * dy));
  const angle = Math.atan2(dy, dx);
  const x = dist * Math.cos(angle);
  const y = dist * Math.sin(angle);
  stick.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`;

  if (isConnected && bleCharacteristic) {
    const data = new Uint8Array([x + 50, y + 50]);
    bleCharacteristic.writeValue(data);
  }
});

joystick.addEventListener("mouseup", () => {
  stick.style.transform = "translate(-50%,-50%)";
});

// 🔘 Button actions
document.getElementById("send").onclick = async () => {
  if (isConnected && bleCharacteristic) {
    const msg = new TextEncoder().encode("SEND");
    await bleCharacteristic.writeValue(msg);
    log("Command: SEND");
  }
};
document.getElementById("start").onclick = async () => {
  if (isConnected && bleCharacteristic) {
    const msg = new TextEncoder().encode("START");
    await bleCharacteristic.writeValue(msg);
    log("Command: START");
  }
};
document.getElementById("stop").onclick = async () => {
  if (isConnected && bleCharacteristic) {
    const msg = new TextEncoder().encode("STOP");
    await bleCharacteristic.writeValue(msg);
    log("Command: STOP");
  }
};
document.getElementById("auto").onclick = async () => {
  const autoTile = document.getElementById("auto");
  const autoMode = !autoTile.classList.contains("auto-on");
  autoTile.classList.toggle("auto-on", autoMode);
  autoTile.classList.toggle("auto-anim", autoMode);
  if (isConnected && bleCharacteristic) {
    const msg = new TextEncoder().encode(autoMode ? "AUTO_ON" : "AUTO_OFF");
    await bleCharacteristic.writeValue(msg);
    log(`Command: ${autoMode ? "AUTO_ON" : "AUTO_OFF"}`);
  }
};

// ⚡ BLE toggle switch
toggleEl.addEventListener("click", toggleConnection);

// 🚀 Ready
log("ready for BLE");
