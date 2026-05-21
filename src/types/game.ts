export type Player = {
  id: string;
  roomId?: string;
  nickname: string;
  isHost: boolean;
  joinedAt: number | string;
  lastSeenAt?: string;
};

export type RoomStatus = "LOBBY" | "QUESTION_SETUP" | "PLAYING" | "GAME_RESULT";

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

export type QuestionSetSource = "uploaded" | "community";

export type QuestionSet = {
  id: string;
  title: string;
  description?: string | null;
  createdByPlayerId: string;
  source: QuestionSetSource;
  isPublic: boolean;
  imageCount: number;
  ratingAvg: number;
  ratingCount: number;
  createdAt: string;
  questions?: Question[];
};

export type Question = {
  id: string;
  questionSetId: string;
  imageUrl: string;
  orderIndex: number;
  createdAt: string;
};

export type GameSession = {
  id: string;
  roomId: string;
  questionSetId: string;
  presenterPlayerId: string;
  status: RoomStatus;
  currentQuestionIndex: number;
  currentRevealRound: number;
  revealedBlocks: number[];
  roundStartedAt?: string | null;
  createdAt: string;
  endedAt?: string | null;
};

export type DbQuestionSet = {
  id: string;
  title: string;
  description: string | null;
  created_by_player_id: string;
  source: QuestionSetSource;
  is_public: boolean;
  image_count: number;
  rating_avg: number;
  rating_count: number;
  created_at: string;
};

export type DbQuestion = {
  id: string;
  question_set_id: string;
  image_url: string;
  order_index: number;
  created_at: string;
};

export type DbGameSession = {
  id: string;
  room_id: string;
  question_set_id: string;
  presenter_player_id: string;
  status: RoomStatus;
  current_question_index: number;
  current_reveal_round: number;
  revealed_blocks: unknown;
  round_started_at: string | null;
  created_at: string;
  ended_at: string | null;
};

export type LocalSession = {
  playerId: string;
  nickname: string;
  roomCode?: string;
  isHost?: boolean;
};
