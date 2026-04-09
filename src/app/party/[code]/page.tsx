"use client";

import { getPartyRoom, getPartyMessages, sendPartyMessage, updatePartyRoom, PartyRoom, PartyMessage } from "@/actions/party";
import useSupabaseUser from "@/hooks/useSupabaseUser";
import { createClient } from "@/utils/supabase/client";
import { Button, Input, Spinner, Avatar, Chip, Tooltip } from "@heroui/react";
import { use, useEffect, useRef, useState, useCallback } from "react";
import { notFound } from "next/navigation";
import { Params } from "@/types";
import { getMoviePlayers, getTvShowPlayers } from "@/utils/players";
import Link from "next/link";
import { useClipboard } from "@mantine/hooks";
import dynamic from "next/dynamic";

const HlsJsonPlayer = dynamic(() => import("@/components/ui/player/HlsJsonPlayer"));
const NetflixPlayer = dynamic(() => import("@/components/ui/player/NetflixPlayer"));

type SyncSignal = { action: "play" | "pause" | "seek"; time?: number; version: number };
type Member = { username: string; user_id: string };

export default function PartyRoomPage({ params }: Params<{ code: string }>) {
  const { code } = use(params);
  const { data: user } = useSupabaseUser();
  const [room, setRoom] = useState<PartyRoom | null>(null);
  const [notFoundRoom, setNotFoundRoom] = useState(false);
  const [messages, setMessages] = useState<PartyMessage[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [sourceIndex, setSourceIndex] = useState(0);
  const [editSeason, setEditSeason] = useState("1");
  const [editEpisode, setEditEpisode] = useState("1");
  const [updatingEp, setUpdatingEp] = useState(false);
  const [syncSignal, setSyncSignal] = useState<SyncSignal>({ action: "play", version: 0 });
  const syncVersionRef = useRef(0);
  const chatRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabaseSyncChannelRef = useRef<any>(null);
  const { copy, copied } = useClipboard({ timeout: 2000 });

  const isHost = !!user && !!room && user.id === room.host_id;
  const username =
    (user as any)?.user_metadata?.username ??
    user?.email?.split("@")[0] ??
    "Guest";

  // Load room + messages
  useEffect(() => {
    (async () => {
      const [roomRes, msgsRes] = await Promise.all([
        getPartyRoom(code),
        getPartyMessages(code),
      ]);
      if (!roomRes.success || !roomRes.data) { setNotFoundRoom(true); return; }
      setRoom(roomRes.data);
      setEditSeason(String(roomRes.data.season ?? 1));
      setEditEpisode(String(roomRes.data.episode ?? 1));
      setMessages(msgsRes.data ?? []);
    })();
  }, [code]);

  // Setup Realtime broadcast channel for player sync
  useEffect(() => {
    if (!room) return;
    const supabase = createClient();
    const channel = supabase
      .channel(`party-sync:${code}`)
      .on(
        "broadcast",
        { event: "sync" },
        ({ payload }: { payload: { action: string; time?: number } }) => {
          // Guests apply incoming sync events; host ignores its own
          if (user && room.host_id === user.id) return;
          syncVersionRef.current += 1;
          setSyncSignal({
            action: payload.action as SyncSignal["action"],
            time: payload.time,
            version: syncVersionRef.current,
          });
        },
      )
      .on(
        "broadcast",
        { event: "chat" },
        ({ payload }: { payload: PartyMessage }) => {
          setMessages((prev) => {
            // Deduplicate by id (sender already optimistically added)
            if (prev.some((m) => m.id === payload.id)) return prev;
            return [...prev, payload];
          });
        },
      )
      .subscribe();
    supabaseSyncChannelRef.current = channel;
    return () => {
      supabase.removeChannel(channel);
      supabaseSyncChannelRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room?.code, code]);

  // Host: capture LOCAL_PLAYER_EVENT from the player and broadcast to guests
  useEffect(() => {
    if (!isHost) return;
    const handleMessage = (event: MessageEvent) => {
      if (!event.data || event.data.type !== "LOCAL_PLAYER_EVENT") return;
      const data = event.data.data as { event?: string; currentTime?: number } | undefined;
      if (!data) return;
      const evtName = data.event;
      if (evtName !== "play" && evtName !== "pause" && evtName !== "seeked") return;
      supabaseSyncChannelRef.current?.send({
        type: "broadcast",
        event: "sync",
        payload: {
          action: evtName === "seeked" ? "seek" : evtName,
          time: data.currentTime ?? 0,
        },
      });
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [isHost]);

  // Realtime: room UPDATE (host changes episode, all guests follow)
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`party-room-meta:${code}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "party_rooms", filter: `code=eq.${code}` },
        (payload) => {
          const updated = payload.new as PartyRoom;
          setRoom(updated);
          setEditSeason(String(updated.season ?? 1));
          setEditEpisode(String(updated.episode ?? 1));
          setSourceIndex(0);
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [code]);

  // Supabase Realtime: new messages + presence
  useEffect(() => {
    if (!room || !user) return;
    const supabase = createClient();

    const username: string =
      (user as any).user_metadata?.username ??
      user.email?.split("@")[0] ??
      "Guest";

    const channel = supabase
      .channel(`party:${code}`, { config: { presence: { key: user.id } } })
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState<{ username: string }>();
        const list: Member[] = Object.entries(state).map(([uid, data]) => ({
          user_id: uid,
          username: (data as any)[0]?.username ?? "Guest",
        }));
        setMembers(list);
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await channel.track({ username });
        }
      });

    return () => { supabase.removeChannel(channel); };
  }, [room, user, code, username]);

  // Auto-scroll chat
  useEffect(() => {
    if (chatRef.current) {
      chatRef.current.scrollTop = chatRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || sending || !user) return;
    setSending(true);
    setInput("");
    const optimisticMsg: PartyMessage = {
      id: `opt-${Date.now()}` as any,
      room_code: code,
      user_id: user.id,
      username,
      content: text,
      created_at: new Date().toISOString(),
    };
    // Optimistically show sender's own message immediately
    setMessages((prev) => [...prev, optimisticMsg]);
    await sendPartyMessage(code, text);
    // Broadcast to all other members via the sync channel
    supabaseSyncChannelRef.current?.send({
      type: "broadcast",
      event: "chat",
      payload: optimisticMsg,
    });
    setSending(false);
  }, [input, sending, code, user, username]);

  const handleChangeEpisode = useCallback(async () => {
    if (!isHost || updatingEp) return;
    setUpdatingEp(true);
    await updatePartyRoom(code, {
      season: parseInt(editSeason) || 1,
      episode: parseInt(editEpisode) || 1,
    });
    setUpdatingEp(false);
  }, [code, editSeason, editEpisode, isHost, updatingEp]);

  if (notFoundRoom) return notFound();
  if (!room) return <Spinner size="lg" className="absolute-center" variant="simple" />;

  // Only 321 player sources in party room
  const allPlayers = room.media_type === "movie"
    ? getMoviePlayers(room.media_id)
    : getTvShowPlayers(room.media_id, room.season ?? 1, room.episode ?? 1);
  const players = allPlayers.filter(p => p.mode === "playlist_json" || p.mode === "native_hls");
  const player = players[sourceIndex] ?? players[0];

  return (
    <div className="flex flex-col h-[100dvh] overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-default-200 flex-shrink-0">
        <Link href="/" className="text-default-400 hover:text-default-700 text-sm">← Home</Link>
        <div className="flex-1 min-w-0">
          <p className="font-semibold truncate text-sm">{room.media_title}</p>
          {room.media_type === "tv" && (
            <p className="text-xs text-default-400">S{room.season ?? 1} E{room.episode ?? 1}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {members.slice(0, 4).map((m) => (
            <Tooltip key={m.user_id} content={m.username}>
              <Avatar name={m.username} size="sm" />
            </Tooltip>
          ))}
          {members.length > 4 && (
            <Chip size="sm" variant="flat">+{members.length - 4}</Chip>
          )}
          <Tooltip content={copied ? "Copied!" : "Copy invite link"}>
            <Button
              size="sm"
              variant="flat"
              onPress={() => copy(window.location.href)}
            >
              {copied ? "Copied!" : "Invite"}
            </Button>
          </Tooltip>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Player area */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Host episode controls — TV only, host only */}
          {isHost && room.media_type === "tv" && (
            <div className="flex items-center gap-2 px-3 py-2 border-b border-default-200 flex-shrink-0 bg-default-50">
              <span className="text-xs text-default-500 font-medium">Change episode:</span>
              <span className="text-xs text-default-400">S</span>
              <Input
                size="sm"
                type="number"
                min="1"
                value={editSeason}
                onValueChange={setEditSeason}
                className="w-16"
              />
              <span className="text-xs text-default-400">E</span>
              <Input
                size="sm"
                type="number"
                min="1"
                value={editEpisode}
                onValueChange={setEditEpisode}
                className="w-16"
                onKeyDown={(e) => { if (e.key === "Enter") handleChangeEpisode(); }}
              />
              <Button
                size="sm"
                color="primary"
                isLoading={updatingEp}
                onPress={handleChangeEpisode}
              >
                Go
              </Button>
            </div>
          )}

          <div className="relative flex-1">
            {player?.mode === "playlist_json" ? (
              <HlsJsonPlayer
                key={player.source}
                playlistUrl={player.source}
                mediaId={room.media_id}
                mediaType={room.media_type as "movie" | "tv"}
                season={room.season ?? undefined}
                episode={room.episode ?? undefined}
                disableVastAds
                className="absolute inset-0 w-full h-full"
                syncSignal={isHost ? undefined : syncSignal}
              />
            ) : player?.mode === "native_hls" ? (
              <NetflixPlayer
                key={player.source}
                playlistUrl={player.source}
                mediaId={room.media_id}
                mediaType={room.media_type as "movie" | "tv"}
                season={room.season ?? undefined}
                episode={room.episode ?? undefined}
                className="absolute inset-0 w-full h-full"
                syncSignal={isHost ? undefined : syncSignal}
              />
            ) : (
              <div className="flex items-center justify-center h-full text-default-400 text-sm">
                No 321 player available for this title.
              </div>
            )}
          </div>

          {/* Source selector — only if multiple 321 sources */}
          {players.length > 1 && (
            <div className="flex gap-2 flex-wrap px-3 py-2 overflow-x-auto flex-shrink-0">
              {players.map((p, i) => (
                <Button
                  key={i}
                  size="sm"
                  variant={sourceIndex === i ? "solid" : "flat"}
                  color={sourceIndex === i ? "primary" : "default"}
                  onPress={() => setSourceIndex(i)}
                >
                  {p.title}
                </Button>
              ))}
            </div>
          )}
        </div>

        {/* Chat sidebar */}
        <div className="w-72 flex-shrink-0 flex flex-col border-l border-default-200 overflow-hidden">
          <div className="px-3 py-2 border-b border-default-200 flex-shrink-0">
            <p className="font-semibold text-sm">Live Chat</p>
            <p className="text-xs text-default-400">{members.length} watching</p>
          </div>

          {/* Messages */}
          <div ref={chatRef} className="flex-1 overflow-y-auto px-3 py-2 flex flex-col gap-2">
            {messages.length === 0 && (
              <p className="text-xs text-default-400 text-center mt-4">No messages yet. Say hi!</p>
            )}
            {messages.map((m) => (
              <div key={m.id} className="flex flex-col gap-0.5">
                <div className="flex items-baseline gap-1.5">
                  <span className="text-xs font-semibold text-primary-500 truncate max-w-[120px]">
                    {m.username}
                  </span>
                  <span className="text-[10px] text-default-400 flex-shrink-0">
                    {new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
                <p className="text-xs text-default-800 break-words">{m.content}</p>
              </div>
            ))}
          </div>

          {/* Input */}
          <div className="px-3 py-2 border-t border-default-200 flex-shrink-0">
            {user ? (
              <div className="flex gap-2">
                <Input
                  size="sm"
                  placeholder="Say something..."
                  value={input}
                  onValueChange={setInput}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                  maxLength={500}
                  disabled={sending}
                />
                <Button
                  size="sm"
                  color="primary"
                  isDisabled={!input.trim() || sending}
                  onPress={handleSend}
                  isIconOnly
                >
                  →
                </Button>
              </div>
            ) : (
              <p className="text-xs text-default-400 text-center">
                <Link href="/auth" className="text-primary-500 underline">Sign in</Link> to chat
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
