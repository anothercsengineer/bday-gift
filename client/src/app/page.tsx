"use client";

import { useState, useEffect, useRef } from "react";

interface Track {
  id: string;
  title: string;
  url: string;
  duration: number;
  cover: string;
}

export default function Home() {
  const [connections, setConnections] = useState(1);
  const [cursors, setCursors] = useState<{ [id: string]: { x: number; y: number } }>({});
  const [progress, setProgress] = useState(0);
  const [barHeights, setBarHeights] = useState<number[]>([]);
  const [currentTrack, setCurrentTrack] = useState<Track | null>(null);
  const [totalTracks, setTotalTracks] = useState(4);
  const [isNightMode, setIsNightMode] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const serverTrackStartedAtRef = useRef<number | null>(null);
  // assigning client ID
  const myIdRef = useRef(Math.random().toString(36).substring(7));

  // night mode
  useEffect(() => {
    const checkNightMode = () => {
      const date = new Date();
      const formatter = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', hour: 'numeric', hour12: false });
      const hourIST = parseInt(formatter.format(date), 10);
      
      // 6 PM (18) to 5 AM
      setIsNightMode(hourIST >= 18 || hourIST < 5);
    };

    checkNightMode();
    const interval = setInterval(checkNightMode, 60000); // synchronises every minute
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    let reconnectTimer: NodeJS.Timeout;
    let pingInterval: NodeJS.Timeout;

    const connect = () => {
      // connection to the cloudflare websockets
      const wsUrl = process.env.NEXT_PUBLIC_WS_URL || "ws://127.0.0.1:8787";
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);

        if (data.type === "init") {
          setConnections(data.connections);
          serverTrackStartedAtRef.current = data.trackStartedAt;
          
          if (audioRef.current) {
            // fetching static playlist
            fetch("/playlist.json")
              .then(res => res.json())
              .then(playlist => {
                setTotalTracks(playlist.length); // save the true length

                // locating the track currently playing
                const track = playlist.find((t: Track) => t.id === data.trackId) || playlist[0];
                
                if (audioRef.current) {
                  audioRef.current.src = track.url;
                  setCurrentTrack(track);
                  
                  // generate random visualizer bars for this specific song
                  setBarHeights(Array.from({ length: 60 }, () => 15 + Math.random() * 85));
                  
                  /**
                   * browser often resets currentTime to 0 when it finishes loading a new src.
                   * must wait for 'loadedmetadata' before setting the timestamp to ensure it sticks
                   */
                  const handleLoad = () => {
                    const now = Date.now();
                    const offsetMs = Math.max(0, now - data.trackStartedAt);
                    
                    if (audioRef.current) {
                      audioRef.current.currentTime = offsetMs / 1000;
                      audioRef.current.play().catch(() => {
                        // autoplay is blocked if user hasn't interacted with the page
                      });
                      audioRef.current.removeEventListener('loadedmetadata', handleLoad);
                    }
                  };

                  audioRef.current.addEventListener('loadedmetadata', handleLoad);
                }
              });
          }
        } else if (data.type === "presence") {
          // joined or left
          setConnections(data.connections);
        } else if (data.type === "cursor") {
          // prevent prototype pollution attacks
          if (data.id === "__proto__" || data.id === "constructor") return;

          // receive someone's mouse position, update their silhouette
          setCursors((prev) => ({
            ...prev,
            [data.id]: { x: data.x, y: data.y }
          }));
        }
      };

      ws.onopen = () => {
        // pings in intervals to prevent server's idle timeout
        pingInterval = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "ping" }));
          }
        }, 30000);
      };

      ws.onclose = () => {
        // cleanup and attempt to reconnect after 3 seconds
        clearInterval(pingInterval);
        reconnectTimer = setTimeout(connect, 3000);
      };
    };

    // initial connection
    connect();

    return () => {
      clearInterval(pingInterval);
      clearTimeout(reconnectTimer);
      if (wsRef.current) {
        // avoid triggering reconnect on component unmount
        wsRef.current.onclose = null;
        wsRef.current.close();
      }
    };
  }, []);

  // track and broadcast active user's cursor
  useEffect(() => {
    let lastSend = 0;

    const handleMouseMove = (e: MouseEvent) => {
      const now = Date.now();
      // throttle to 20 msg/s max
      if (now - lastSend < 50) return;
      lastSend = now;

      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: "cursor",
          id: myIdRef.current,
          x: e.clientX,
          y: e.clientY
        }));
      }
    };
    
    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, []);

  // handling auto-play policies (specifically for mobile browsers)
  const handleInteraction = () => {
    if (audioRef.current && audioRef.current.paused) {
      const audio = audioRef.current;
      // wait for the play() promise to resolve before seeking
      audio.play().then(() => {
        if (serverTrackStartedAtRef.current) {
          const offsetMs = Math.max(0, Date.now() - serverTrackStartedAtRef.current);
          audio.currentTime = offsetMs / 1000;
        }
      }).catch(() => {});
    }
  };

  // garbage collector
  useEffect(() => {
    const gc = setInterval(() => setCursors({}), 10000);
    return () => clearInterval(gc);
  }, []);

  // standalone visualizer progress loop (works even if audio is blocked by autoplay)
  useEffect(() => {
    let animationFrameId: number;

    const updateProgress = () => {
      if (currentTrack && serverTrackStartedAtRef.current) {
        const timeElapsedMs = Date.now() - serverTrackStartedAtRef.current;
        const totalDurationMs = currentTrack.duration * 1000;
        
        if (totalDurationMs > 0) {
          // calculate visual percentage and cap at 100%
          const p = Math.min(100, Math.max(0, (timeElapsedMs / totalDurationMs) * 100));
          setProgress(p);
        }
      }
      animationFrameId = requestAnimationFrame(updateProgress);
    };

    animationFrameId = requestAnimationFrame(updateProgress);
    return () => cancelAnimationFrame(animationFrameId);
  }, [currentTrack]);

  return (
    <main 
      onClick={handleInteraction}
      className={`relative min-h-screen bg-cover bg-center overflow-hidden font-comfortaa transition-all duration-1000 bg-[url('/bday-bg.png')]`}
    >
      {/* cursors layer (faint blobs for other users) */}
      {Object.entries(cursors).map(([id, pos]) => (
        <div
          key={id}
          className="absolute w-24 h-24 rounded-full bg-amber-500/20 blur-2xl pointer-events-none transition-all duration-100 ease-linear mix-blend-screen"
          style={{ transform: `translate(${pos.x - 48}px, ${pos.y - 48}px)` }}
        />
      ))}



      {/* music player area */}
      <div className="absolute bottom-[5%] right-[10%] z-20 w-[180px] h-[180px] md:w-[220px] md:h-[220px] lg:w-[260px] lg:h-[260px] lg:bottom-[10%] lg:right-[20%] -rotate-6 hover:rotate-0 transition-transform duration-500">
        {/* exported Figma asset acts as the physical container layer */}
        <img src="/player-bg.png" alt="Player Background" className="w-full h-full object-cover drop-shadow-[0_15px_30px_rgba(0,0,0,0.5)] pointer-events-none" />
        
        {/* Content Overlay */}
        <div className="absolute inset-0 flex items-center justify-center">
          {/* album art */}
          <div className="w-[82%] h-[82%] rounded-full overflow-hidden flex-shrink-0 relative z-10">
            {currentTrack?.cover ? (
              <img 
                src={currentTrack.cover} 
                alt="Album Art" 
                className="w-full h-full object-cover animate-[spin_15s_linear_infinite]" 
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-[10px] text-white/30 text-center px-2 font-comfortaa bg-black/40">
                {currentTrack?.title || "No Art"}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* hidden audio element */}
      <audio 
        ref={audioRef} 
        id="radio-player" 
        preload="auto" 
        onEnded={() => {
          // pinging the server when one song ends
          if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({
              type: "track_ended",
              finishedTrackId: currentTrack?.id,
              totalTracks: totalTracks
            }));
          }
        }}
      />
    </main>
  );
}