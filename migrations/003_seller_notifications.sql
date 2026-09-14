-- A separate outbox keeps seller acknowledgements independent from the
-- internal business notification. Existing inquiries are not backfilled, so
-- deploying this feature does not unexpectedly email older sellers.
CREATE TABLE IF NOT EXISTS seller_notifications (
 inquiry_id UUID PRIMARY KEY REFERENCES inquiries(id) ON DELETE CASCADE,
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','sending','sent','disabled','failed')),
 attempts INTEGER NOT NULL DEFAULT 0,
 next_attempt TIMESTAMPTZ NOT NULL DEFAULT now(),
 last_code TEXT,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
