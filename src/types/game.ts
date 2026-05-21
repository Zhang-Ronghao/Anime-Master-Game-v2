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
  imageUrlsText?: string | null;
  imageCount: number;
  ratingAvg: number;
  ratingCount: number;
  createdAt: string;
  updatedAt?: string | null;
  questions?: Question[];
};

export type Question = {
  id: string;
  questionSetId: string;
  imageUrl: string;
  orderIndex: number;
  labelText?: string | null;
  labelSource?: "manual" | "answer" | null;
  labelSourceAnswerId?: string | null;
  labelUpdatedByPlayerId?: string | null;
  labelUpdatedAt?: string | null;
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
  maxRevealRounds: number;
  roundSeconds: number;
  roundScores: number[];
  roundStartedAt?: string | null;
  createdAt: string;
  endedAt?: string | null;
};

export type Answer = {
  id: string;
  gameSessionId: string;
  questionIndex: number;
  revealRound: number;
  playerId: string;
  answerText: string;
  submittedAt: string;
};

export type PlayerScore = {
  id: string;
  gameSessionId: string;
  playerId: string;
  score: number;
  correctCount: number;
};

export type LeaderboardEntry = {
  playerId: string;
  nickname: string;
  rank: number;
  score: number;
  correctCount: number;
};

export type QuestionResult = {
  id: string;
  gameSessionId: string;
  questionIndex: number;
  playerId: string;
  scoredRound: number;
  scoreAwarded: number;
  judgedByPlayerId: string;
  judgedAt: string;
};

export type DbQuestionSet = {
  id: string;
  title: string;
  description: string | null;
  created_by_player_id: string;
  source: QuestionSetSource;
  is_public: boolean;
  image_urls_text?: string | null;
  image_count: number;
  rating_avg: number;
  rating_count: number;
  created_at: string;
  updated_at?: string | null;
};

export type DbQuestion = {
  id: string;
  question_set_id: string;
  image_url: string;
  order_index: number;
  label_text?: string | null;
  label_source?: "manual" | "answer" | null;
  label_source_answer_id?: string | null;
  label_updated_by_player_id?: string | null;
  label_updated_at?: string | null;
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
  max_reveal_rounds?: number;
  round_seconds?: number;
  round_scores?: unknown;
  round_started_at: string | null;
  created_at: string;
  ended_at: string | null;
};

export type DbAnswer = {
  id: string;
  game_session_id: string;
  question_index: number;
  reveal_round: number;
  player_id: string;
  answer_text: string;
  submitted_at: string;
};

export type DbPlayerScore = {
  id: string;
  game_session_id: string;
  player_id: string;
  score: number;
  correct_count: number;
};

export type DbQuestionResult = {
  id: string;
  game_session_id: string;
  question_index: number;
  player_id: string;
  scored_round: number;
  score_awarded: number;
  judged_by_player_id: string;
  judged_at: string;
};

export type LocalSession = {
  playerId: string;
  nickname: string;
  roomCode?: string;
  isHost?: boolean;
};
