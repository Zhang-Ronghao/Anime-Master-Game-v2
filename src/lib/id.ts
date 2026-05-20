export function createPlayerId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `player_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function createRoomCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}
