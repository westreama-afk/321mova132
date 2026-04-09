# 321movies

321movies is a movies and TV shows web app built with Next.js, Supabase, and TMDB.

## Features

- Account auth with Supabase
- Watchlist and watch history
- Movie and TV detail pages with player sources
- Community ratings and comments
- Responsive UI and PWA support

## Tech Stack

- Next.js 15 (App Router)
- TypeScript
- Tailwind CSS + HeroUI
- TanStack Query
- Supabase
- TMDB API

## Local Setup

1. Install dependencies:

```bash
npm install
```

2. Configure environment variables in `.env.local`.

3. Run development server:

```bash
npm run dev
```

4. Open `http://localhost:3000`.

## Cloudflare Player Proxy (Optional)

If your direct `321 Player` source dies or needs proxying, you can route it through Cloudflare Worker.

1. Deploy worker:

```bash
cd cloudflare/player-proxy
npm i -g wrangler
wrangler login
cp wrangler.toml.example wrangler.toml
# edit wrangler.toml vars to your upstream templates
wrangler deploy
```

2. Add this to `.env.local` in the app:

```bash
NEXT_PUBLIC_PLAYER_PROXY_URL=https://YOUR-WORKER.your-subdomain.workers.dev
```

3. Restart app:

```bash
npm run dev
```

Routes expected by app:
- `GET /playlist/movie/:id`
- `GET /playlist/tv/:id/:season/:episode`
