export type Player = {
  id: string;
  roomId?: string;
  nickname: string;
  isHost: boolean;
  joinedAt: number | string;
  lastSeenAt?: string;
};

export type RoomStatus = "LOBBY" | "SELECTING_PRESENTER" | "PLAYING" | "FINISHED";

export type Room = {
  id?: string;
  code: string;
  hostPlayerId: string;
  players: Player[];
  status: RoomStatus;
  currentPresenterPlayerId?: string | null;
  currentGameId?: string | null;
  createdAt: number | string;
  updatedAt?: string;
};

export type DbRoom = {
  id: string;
  room_code: string;
  host_player_id: string;
  game_status: RoomStatus;
  current_presenter_player_id: string | null;
  current_game_id: string | null;
  created_at: string;
  updated_at: string;
};

export type DbPlayer = {
  id: string;
  room_id: string;
  nickname: string;
  is_host: boolean;
  joined_at: string;
  last_seen_at: string;
};

export type LocalSession = {
  playerId: string;
  nickname: string;
  roomCode?: string;
  isHost?: boolean;
};
