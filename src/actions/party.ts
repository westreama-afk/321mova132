"use server";

import { createClient } from "@/utils/supabase/server";
import { ActionResponse, ContentType } from "@/types";

const ADJECTIVES = ["Epic", "Chill", "Wild", "Cosmic", "Neon", "Dark", "Golden", "Silent", "Rapid", "Bold"];
const NOUNS = ["Cinema", "Screen", "Reel", "Frame", "Scene", "Watch", "Night", "Room", "Crew", "Flick"];

function generateRoomCode(): string {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  const num = Math.floor(100 + Math.random() * 900);
  return `${adj}${noun}${num}`;
}

export type PartyRoom = {
  code: string;
  host_id: string | null;
  media_id: number;
  media_type: ContentType;
  media_title: string;
  media_poster: string | null;
  season: number | null;
  episode: number | null;
  created_at: string;
  expires_at: string;
};

export type PartyMessage = {
  id: number;
  room_code: string;
  user_id: string | null;
  username: string;
  content: string;
  created_at: string;
};

export const createPartyRoom = async (params: {
  mediaId: number;
  mediaType: ContentType;
  mediaTitle: string;
  mediaPoster?: string;
  season?: number;
  episode?: number;
}): ActionResponse<{ code: string }> => {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return { success: false, message: "You must be logged in to create a room." };
  }

  const code = generateRoomCode();

  const { error } = await supabase.from("party_rooms").insert({
    code,
    host_id: user.id,
    media_id: params.mediaId,
    media_type: params.mediaType,
    media_title: params.mediaTitle,
    media_poster: params.mediaPoster ?? null,
    season: params.season ?? null,
    episode: params.episode ?? null,
  });

  if (error) {
    return { success: false, message: "Failed to create room." };
  }

  return { success: true, data: { code } };
};

export const getPartyRoom = async (code: string): ActionResponse<PartyRoom> => {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("party_rooms")
    .select("*")
    .eq("code", code)
    .gt("expires_at", new Date().toISOString())
    .single();

  if (error || !data) {
    return { success: false, message: "Room not found or has expired." };
  }

  return { success: true, data: data as PartyRoom };
};

export const getPartyMessages = async (code: string): ActionResponse<PartyMessage[]> => {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("party_messages")
    .select("*")
    .eq("room_code", code)
    .order("created_at", { ascending: true })
    .limit(200);

  if (error) {
    return { success: false, message: "Failed to load messages." };
  }

  return { success: true, data: (data ?? []) as PartyMessage[] };
};

export const updatePartyRoom = async (
  code: string,
  params: { season: number; episode: number },
): ActionResponse => {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, message: "Not authenticated." };

  const { error } = await supabase
    .from("party_rooms")
    .update({ season: params.season, episode: params.episode })
    .eq("code", code)
    .eq("host_id", user.id);

  if (error) return { success: false, message: "Failed to update room." };
  return { success: true };
};

export const sendPartyMessage = async (
  roomCode: string,
  content: string,
): ActionResponse => {
  const trimmed = content.trim();
  if (!trimmed || trimmed.length > 500) {
    return { success: false, message: "Invalid message." };
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return { success: false, message: "You must be logged in to chat." };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("username")
    .eq("id", user.id)
    .single();

  const username = profile?.username ?? user.email?.split("@")[0] ?? "Anonymous";

  const { error } = await supabase.from("party_messages").insert({
    room_code: roomCode,
    user_id: user.id,
    username,
    content: trimmed,
  });

  if (error) {
    return { success: false, message: "Failed to send message." };
  }

  return { success: true };
};
