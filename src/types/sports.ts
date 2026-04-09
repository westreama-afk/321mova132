export interface StreamedSport {
  id: string;
  name: string;
}

export interface StreamedTeam {
  name: string;
  badge?: string;
}

export interface StreamedMatchSource {
  source: string;
  id: string;
}

export interface StreamedMatch {
  id: string;
  title: string;
  category: string;
  date: number;
  poster?: string;
  popular?: boolean;
  teams?: {
    home?: StreamedTeam;
    away?: StreamedTeam;
  };
  sources: StreamedMatchSource[];
}

export interface StreamedStream {
  id: string;
  streamNo: number;
  language?: string;
  hd?: boolean;
  embedUrl: string;
  source: string;
  viewers?: number;
}
