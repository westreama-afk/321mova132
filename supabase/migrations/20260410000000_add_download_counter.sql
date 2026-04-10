-- Singleton row tracking total APK download clicks
CREATE TABLE public.app_downloads (
  id   int  PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  count bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.app_downloads (id, count) VALUES (1, 0);

-- RLS: anyone can read; nobody can UPDATE directly (use RPC below)
ALTER TABLE public.app_downloads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public read download count"
  ON public.app_downloads
  FOR SELECT
  USING (true);

-- Atomic increment callable by anonymous/authenticated users
CREATE OR REPLACE FUNCTION public.increment_download_count()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_count bigint;
BEGIN
  UPDATE public.app_downloads
  SET count = count + 1,
      updated_at = now()
  WHERE id = 1
  RETURNING count INTO new_count;

  RETURN new_count;
END;
$$;

-- Grant execute to anon and authenticated roles
GRANT EXECUTE ON FUNCTION public.increment_download_count() TO anon, authenticated;

-- Enable realtime so clients see live count changes
ALTER PUBLICATION supabase_realtime ADD TABLE public.app_downloads;
