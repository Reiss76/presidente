CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS groups (
  id SERIAL PRIMARY KEY,
  key TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  color_hex CHAR(7) NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO groups(key,name,color_hex) VALUES
 ('2000','2000','#2E7D32'),
 ('500','500','#66BB6A'),
 ('especial_interno','Especial interno','#1E88E5'),
 ('especial_externo','Especial externo','#8E24AA'),
 ('universo','Universo','#E53935')
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS codes (
  id BIGSERIAL PRIMARY KEY,
  code CITEXT UNIQUE NOT NULL,
  estado TEXT NOT NULL,
  municipio TEXT NOT NULL,
  direccion TEXT NOT NULL,
  lat DOUBLE PRECISION,
  lon DOUBLE PRECISION,
  place_id TEXT,
  formatted_address TEXT,
  grupo_id INTEGER REFERENCES groups(id),
  encargado_actual TEXT,
  encargado_anterior TEXT,
  m13 BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Legacy deployments may already have "codes" without m13; ensure it exists.
ALTER TABLE codes
  ADD COLUMN IF NOT EXISTS m13 BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS notes (
  id BIGSERIAL PRIMARY KEY,
  code_id BIGINT NOT NULL REFERENCES codes(id) ON DELETE CASCADE,
  author TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS files (
  id BIGSERIAL PRIMARY KEY,
  code_id BIGINT NOT NULL REFERENCES codes(id) ON DELETE CASCADE,
  file_key TEXT NOT NULL,
  file_name TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  content_type TEXT NOT NULL,
  uploaded_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_log (
  id BIGSERIAL PRIMARY KEY,
  table_name TEXT NOT NULL,
  record_id BIGINT NOT NULL,
  column_name TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  changed_by TEXT,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS geocode_cache (
  id BIGSERIAL PRIMARY KEY,
  address_hash TEXT UNIQUE NOT NULL,
  address_str TEXT NOT NULL,
  lat DOUBLE PRECISION,
  lon DOUBLE PRECISION,
  place_id TEXT,
  formatted_address TEXT,
  status TEXT,
  provider TEXT NOT NULL DEFAULT 'google',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  refreshed_at TIMESTAMPTZ
);

-- Índices
CREATE UNIQUE INDEX IF NOT EXISTS ux_codes_code ON codes(code);
CREATE INDEX IF NOT EXISTS ix_codes_grupo ON codes(grupo_id);
CREATE INDEX IF NOT EXISTS ix_codes_code_trgm ON codes USING GIN (code gin_trgm_ops);
CREATE INDEX IF NOT EXISTS ix_codes_dir_trgm ON codes USING GIN (direccion gin_trgm_ops);
