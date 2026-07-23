PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS questions (
  id TEXT NOT NULL,
  id_key TEXT PRIMARY KEY,
  enunciado TEXT NOT NULL,
  alternatives_json TEXT NOT NULL,
  correta TEXT NOT NULL,
  quantidade_alternativas INTEGER NOT NULL DEFAULT 5,
  dificuldade TEXT NOT NULL DEFAULT 'Médio',
  tema TEXT DEFAULT '',
  competencia TEXT DEFAULT '',
  capacidade TEXT DEFAULT '',
  habilidade TEXT DEFAULT '',
  unidade_curricular TEXT DEFAULT '',
  codigo_matriz TEXT DEFAULT '',
  justificativa TEXT DEFAULT '',
  fonte TEXT DEFAULT '',
  tempo INTEGER,
  images_json TEXT NOT NULL DEFAULT '[]',
  alternative_images_json TEXT NOT NULL DEFAULT '{}',
  thumbnail_url TEXT DEFAULT '',
  arquivo_origem TEXT DEFAULT '',
  pagina_origem TEXT DEFAULT '',
  status_gabarito TEXT DEFAULT '',
  observacao TEXT DEFAULT '',
  approved_by TEXT DEFAULT '',
  ai_model TEXT DEFAULT '',
  ai_confidence REAL DEFAULT 0,
  ai_classification_json TEXT NOT NULL DEFAULT '{}',
  content_hash TEXT NOT NULL UNIQUE,
  search_text TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);


CREATE TABLE IF NOT EXISTS question_revisions (
  revision_id TEXT PRIMARY KEY,
  question_id_key TEXT NOT NULL,
  question_id TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  approved_by TEXT DEFAULT '',
  ai_model TEXT DEFAULT '',
  ai_confidence REAL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_question_revisions_question ON question_revisions(question_id_key, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_question_revisions_hash ON question_revisions(content_hash);

CREATE INDEX IF NOT EXISTS idx_questions_status_updated ON questions(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_questions_difficulty ON questions(dificuldade);
CREATE INDEX IF NOT EXISTS idx_questions_theme ON questions(tema);
CREATE INDEX IF NOT EXISTS idx_questions_unit ON questions(unidade_curricular);
CREATE INDEX IF NOT EXISTS idx_questions_content_hash ON questions(content_hash);
