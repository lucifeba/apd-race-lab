-- APD Race Lab: esquema de la base de datos D1 (SQLite).
-- Aplicar con: npx wrangler d1 execute apd-race-lab-db --local --file schema.sql
-- Fechas de calendario en texto YYYY-MM-DD; marcas de tiempo en milisegundos (epoch).

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  pass_salt TEXT NOT NULL,          -- 16 bytes en hex
  pass_hash TEXT NOT NULL,          -- PBKDF2-SHA256, 100 000 iteraciones, 32 bytes en hex
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,      -- SHA-256 del token (el token en claro solo lo tiene el navegador)
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS login_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_login_attempts_email_at ON login_attempts(email, at);

CREATE TABLE IF NOT EXISTS ai_usage (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day TEXT NOT NULL,                -- YYYY-MM-DD (UTC)
  calls INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);

CREATE TABLE IF NOT EXISTS athletes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sport TEXT NOT NULL CHECK (sport IN ('run', 'bike', 'tri')),
  ftp INTEGER,                      -- W
  run_pace_sec INTEGER,             -- ritmo umbral, segundos por km
  vdot REAL,
  swim_css_sec INTEGER,             -- CSS, segundos por 100 m
  lthr INTEGER,                     -- ppm
  weight REAL,                      -- kg
  notes TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_athletes_user ON athletes(user_id);

CREATE TABLE IF NOT EXISTS workouts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  athlete_id INTEGER NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  sport TEXT NOT NULL CHECK (sport IN ('run', 'bike', 'swim', 'strength', 'other')),
  title TEXT,
  duration_h REAL,                  -- realizado
  planned_h REAL,                   -- planificado
  distance_km REAL,
  tss REAL,
  rpe INTEGER,
  feeling INTEGER,
  comments TEXT,
  completed INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'manual',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_workouts_athlete_date ON workouts(athlete_id, date);

CREATE TABLE IF NOT EXISTS race_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  athlete_id INTEGER REFERENCES athletes(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  race_date TEXT,
  sport TEXT NOT NULL CHECK (sport IN ('run', 'bike', 'tri')),
  form_json TEXT NOT NULL,          -- estado del formulario y recorrido ya convertido (tramos + perfil)
  summary TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_race_plans_user ON race_plans(user_id, updated_at);

CREATE TABLE IF NOT EXISTS feedbacks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  athlete_id INTEGER NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  escrito TEXT NOT NULL,
  audio TEXT,
  mejorado_json TEXT NOT NULL DEFAULT '[]',
  mejorar_json TEXT NOT NULL DEFAULT '[]',
  pasos_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_feedbacks_athlete ON feedbacks(athlete_id, end_date);
