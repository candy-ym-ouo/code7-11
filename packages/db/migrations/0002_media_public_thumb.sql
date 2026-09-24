ALTER TABLE media_assets
  ADD COLUMN public_thumbnail_object_key text;

ALTER TABLE outbox_events
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
