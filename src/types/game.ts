export type Player = {
  id: string;
  nickname: string;
  isHost: boolean;
  joinedAt: number;
};

export type RoomStatus = "lobby" | "selecting_question_master" | "playing" | "finished";

export type Room = {
  code: string;
  hostPlayerId: string;
  players: Player[];
  status: RoomStatus;
  createdAt: number;
};

export type LocalSession = {
  playerId: string;
  nickname: string;
  roomCode?: string;
  isHost?: boolean;
};
