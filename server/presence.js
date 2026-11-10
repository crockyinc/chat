/**
 * In-memory presence tracking (who has at least one socket open right now).
 * Presence is intentionally ephemeral — nothing here touches the disk.
 */
const socketsByDevice = new Map(); // deviceId -> Set<socketId>

export function addSocket(deviceId, socketId) {
  if (!socketsByDevice.has(deviceId)) socketsByDevice.set(deviceId, new Set());
  socketsByDevice.get(deviceId).add(socketId);
}

export function removeSocket(deviceId, socketId) {
  const set = socketsByDevice.get(deviceId);
  if (!set) return false;
  set.delete(socketId);
  if (!set.size) {
    socketsByDevice.delete(deviceId);
    return true; // fully offline now
  }
  return false;
}

export function isOnline(deviceId) {
  return socketsByDevice.has(deviceId);
}

export function onlineDeviceIds() {
  return [...socketsByDevice.keys()];
}

export function onlineCount() {
  return socketsByDevice.size;
}
