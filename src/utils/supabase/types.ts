export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      app_downloads: {
        Row: {
          id: number;
          count: number;
          updated_at: string;
        };
        Insert: {
          id?: number;
          count?: number;
          updated_at?: string;
        };
        Update: {
          id?: number;
          count?: number;
          updated_at?: string;
        };
        Relationships: [];
      };
      comments: {
        Row: {
          content: string;
          created_at: string;
          id: number;
          media_id: number;
          media_type: "movie" | "tv";
          updated_at: string;
          user_id: string;
        };
        Insert: {
          content: string;
          created_at?: string;
          id?: never;
          media_id: number;
          media_type: "movie" | "tv";
          updated_at?: string;
          user_id: string;
        };
        Update: {
          content?: string;
          created_at?: string;
          id?: never;
          media_id?: number;
          media_type?: "movie" | "tv";
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "comments_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      histories: {
        Row: {
          adult: boolean;
          backdrop_path: string | null;
          completed: boolean;
          created_at: string;
          duration: number;
          episode: number;
          id: number;
          last_position: number;
          media_id: number;
          poster_path: string | null;
          release_date: string;
          season: number;
          title: string;
          type: "movie" | "tv";
          updated_at: string;
          user_id: string;
          vote_average: number;
        };
        Insert: {
          adult: boolean;
          backdrop_path?: string | null;
          completed?: boolean;
          created_at?: string;
          duration?: number;
          episode?: number;
          id?: never;
          last_position?: number;
          media_id: number;
          poster_path?: string | null;
          release_date: string;
          season?: number;
          title: string;
          type: "movie" | "tv";
          updated_at?: string;
          user_id: string;
          vote_average: number;
        };
        Update: {
          adult?: boolean;
          backdrop_path?: string | null;
          completed?: boolean;
          created_at?: string;
          duration?: number;
          episode?: number;
          id?: never;
          last_position?: number;
          media_id?: number;
          poster_path?: string | null;
          release_date?: string;
          season?: number;
          title?: string;
          type?: "movie" | "tv";
          updated_at?: string;
          user_id?: string;
          vote_average?: number;
        };
        Relationships: [
          {
            foreignKeyName: "histories_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          created_at: string | null;
          id: string;
          username: string;
        };
        Insert: {
          created_at?: string | null;
          id: string;
          username: string;
        };
        Update: {
          created_at?: string | null;
          id?: string;
          username?: string;
        };
        Relationships: [
          {
            foreignKeyName: "profiles_id_fkey";
            columns: ["id"];
            isOneToOne: true;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      premium_code_redemptions: {
        Row: {
          applied_days: number;
          applied_plan: "monthly" | "yearly";
          code_id: number;
          id: number;
          redeemed_at: string;
          user_id: string;
        };
        Insert: {
          applied_days: number;
          applied_plan: "monthly" | "yearly";
          code_id: number;
          id?: never;
          redeemed_at?: string;
          user_id: string;
        };
        Update: {
          applied_days?: number;
          applied_plan?: "monthly" | "yearly";
          code_id?: number;
          id?: never;
          redeemed_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "premium_code_redemptions_code_id_fkey";
            columns: ["code_id"];
            isOneToOne: false;
            referencedRelation: "premium_codes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "premium_code_redemptions_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      premium_codes: {
        Row: {
          active: boolean;
          code: string;
          created_at: string;
          created_by: string | null;
          duration_days: number;
          expires_at: string | null;
          id: number;
          last_redeemed_at: string | null;
          last_redeemed_by: string | null;
          max_redemptions: number;
          metadata: Json;
          plan: "monthly" | "yearly";
          redemption_count: number;
          updated_at: string;
        };
        Insert: {
          active?: boolean;
          code: string;
          created_at?: string;
          created_by?: string | null;
          duration_days: number;
          expires_at?: string | null;
          id?: never;
          last_redeemed_at?: string | null;
          last_redeemed_by?: string | null;
          max_redemptions?: number;
          metadata?: Json;
          plan: "monthly" | "yearly";
          redemption_count?: number;
          updated_at?: string;
        };
        Update: {
          active?: boolean;
          code?: string;
          created_at?: string;
          created_by?: string | null;
          duration_days?: number;
          expires_at?: string | null;
          id?: never;
          last_redeemed_at?: string | null;
          last_redeemed_by?: string | null;
          max_redemptions?: number;
          metadata?: Json;
          plan?: "monthly" | "yearly";
          redemption_count?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "premium_codes_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "premium_codes_last_redeemed_by_fkey";
            columns: ["last_redeemed_by"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      ratings: {
        Row: {
          created_at: string;
          media_id: number;
          media_type: "movie" | "tv";
          rating: number;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          media_id: number;
          media_type: "movie" | "tv";
          rating: number;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          media_id?: number;
          media_type?: "movie" | "tv";
          rating?: number;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "ratings_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      party_messages: {
        Row: {
          id: number;
          room_code: string;
          user_id: string | null;
          username: string;
          content: string;
          created_at: string;
        };
        Insert: {
          id?: never;
          room_code: string;
          user_id?: string | null;
          username: string;
          content: string;
          created_at?: string;
        };
        Update: {
          id?: never;
          room_code?: string;
          user_id?: string | null;
          username?: string;
          content?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "party_messages_room_code_fkey";
            columns: ["room_code"];
            isOneToOne: false;
            referencedRelation: "party_rooms";
            referencedColumns: ["code"];
          },
        ];
      };
      party_rooms: {
        Row: {
          code: string;
          host_id: string | null;
          media_id: number;
          media_type: "movie" | "tv";
          media_title: string;
          media_poster: string | null;
          season: number | null;
          episode: number | null;
          created_at: string;
          expires_at: string;
        };
        Insert: {
          code: string;
          host_id?: string | null;
          media_id: number;
          media_type: "movie" | "tv";
          media_title: string;
          media_poster?: string | null;
          season?: number | null;
          episode?: number | null;
          created_at?: string;
          expires_at?: string;
        };
        Update: {
          code?: string;
          host_id?: string | null;
          media_id?: number;
          media_type?: "movie" | "tv";
          media_title?: string;
          media_poster?: string | null;
          season?: number | null;
          episode?: number | null;
          created_at?: string;
          expires_at?: string;
        };
        Relationships: [];
      };
      watchlist: {
        Row: {
          adult: boolean;
          backdrop_path: string | null;
          created_at: string;
          id: number;
          poster_path: string | null;
          release_date: string;
          title: string;
          type: "movie" | "tv";
          user_id: string;
          vote_average: number;
        };
        Insert: {
          adult: boolean;
          backdrop_path?: string | null;
          created_at?: string;
          id: number;
          poster_path?: string | null;
          release_date: string;
          title: string;
          type: "movie" | "tv";
          user_id: string;
          vote_average: number;
        };
        Update: {
          adult?: boolean;
          backdrop_path?: string | null;
          created_at?: string;
          id?: number;
          poster_path?: string | null;
          release_date?: string;
          title?: string;
          type?: "movie" | "tv";
          user_id?: string;
          vote_average?: number;
        };
        Relationships: [
          {
            foreignKeyName: "watchlist_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      increment_download_count: {
        Args: Record<PropertyKey, never>;
        Returns: number;
      };
      get_media_rating_stats: {
        Args: {
          p_media_id: number;
          p_media_type: string;
        };
        Returns: {
          average_rating: number;
          ratings_count: number;
        }[];
      };
      redeem_premium_code: {
        Args: {
          p_code: string;
          p_user_id: string;
        };
        Returns: {
          code_id: number;
          duration_days: number;
          plan: string;
        }[];
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};
