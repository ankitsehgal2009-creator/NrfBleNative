// Ble.js — compatible with ESP32 BLE Server

const SERVICE_UUID = "4fafc201-1fb5-459e-8fcc-c5c9c331914b";
const CHARACTERISTIC_UUID = "beb5483e-36e1-4688-b7f5-ea07361b26a8";

let bleDevice = null;
let bleServer = null;
let bleCharacteristic = null;
let isConnected = false;

async function connectBLE() {
  try {
    console.log("Requesting BLE device...");
    bleDevice = await navigator.bluetooth.requestDevice({
      filters: [{ namePrefix: "ESP32" }],
      optionalServices: [SERVICE_UUID]
    });

    bleDevice.addEventListener('gattserverdisconnected', onDisconnected);

    console.log("Connecting to GATT server...");
    bleServer = await bleDevice.gatt.connect();

    console.log("Getting service...");
    const service = await bleServer.getPrimaryService(SERVICE_UUID);

    console.log("Getting characteristic...");
    bleCharacteristic = await service.getCharacteristic(CHARACTERISTIC_UUID);

    await bleCharacteristic.startNotifications();
    bleCharacteristic.addEventListener('characteristicvaluechanged', handleNotifications);

    isConnected = true;
    updateConnectionStatus(true);
    console.log("Connected to ESP32 and listening for notifications.");
  } catch (error) {
    console.error("BLE Connection failed:", error);
  }
}

function handleNotifications(event) {
  const value = event.target.value;
  const uint32Val = value.getUint32(0, true);
  document.getElementById("bleData").innerText = `Data: ${uint32Val}`;
}

function disconnectBLE() {
  if (!bleDevice) return;
  console.log("Disconnecting from device...");
  bleDevice.gatt.disconnect();
}

function onDisconnected() {
  console.log("Device disconnected.");
  updateConnectionStatus(false);
}

function toggleConnection() {
  if (isConnected) {
    disconnectBLE();
  } else {
    connectBLE();
  }
}

function updateConnectionStatus(status) {
  isConnected = status;
  const btn = document.getElementById("connectBtn");
  const statusText = document.getElementById("statusText");

  if (status) {
    btn.innerText = "Disconnect";
    statusText.innerText = "Connected to ESP32";
    statusText.style.color = "green";
  } else {
    btn.innerText = "Connect";
    statusText.innerText = "Disconnected";
    statusText.style.color = "red";
  }
}
