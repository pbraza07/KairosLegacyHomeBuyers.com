CREATE TABLE IF NOT EXISTS image_assets (id UUID PRIMARY KEY, bytes BYTEA NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS inquiries_hash ON inquiries(payload_hash);
