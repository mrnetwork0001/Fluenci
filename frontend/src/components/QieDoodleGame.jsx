import React, { useState, useEffect, useRef, useCallback } from "react";
import { FluenciAIChat } from "./FluenciAIChat";

// Grid config
const COLS = 20;
const ROWS = 25;
const CELL = 16;
const CANVAS_W = COLS * CELL; // 320
const CANVAS_H = ROWS * CELL; // 400

const DIR = { UP: [0, -1], DOWN: [0, 1], LEFT: [-1, 0], RIGHT: [1, 0] };

export function QieDoodleGame({ account, subscriberStreams, createSubscription, terminateStream, contracts }) {
  const [activeTab, setActiveTab] = useState("snake"); // snake | chat
  const [gameState, setGameState] = useState("locked"); // locked | ready | playing | gameover
  const [hasActiveStream, setHasActiveStream] = useState(false);
  const [score, setScore] = useState(0);
  const [bestScore, setBestScore] = useState(() => {
    try { return parseInt(localStorage.getItem("fluenci_snake_best") || "0"); } catch { return 0; }
  });
  const [sessionTime, setSessionTime] = useState(0);
  const [doodleStream, setDoodleStream] = useState(null);

  const canvasRef = useRef(null);
  const gameLoopRef = useRef(null);
  const timerRef = useRef(null);
  const stateRef = useRef(null); // mutable game state for the loop

  const ARCADE_MERCHANT = "0xfe5f1d13a31a5b86833adf4486720331d6e4a6bb";

  // Check stream status
  useEffect(() => {
    const stream = subscriberStreams.find(
      (s) => s.merchant.toLowerCase() === ARCADE_MERCHANT.toLowerCase() && s.active && !s.pausedByAI
    );
    setHasActiveStream(!!stream);
    setDoodleStream(stream || null);
    if (stream && gameState === "locked") setGameState("ready");
    if (!stream && gameState !== "locked") setGameState("locked");
  }, [subscriberStreams]);

  const handleStartStream = async () => {
    try {
      await createSubscription(ARCADE_MERCHANT, "QUSDC", "100", 0, 0);
    } catch (err) {
      console.error("Failed to start Fluenci Snake stream", err);
    }
  };

  const handleStopStream = async () => {
    if (!doodleStream) return;
    try {
      await terminateStream(doodleStream.id);
    } catch (err) {
      console.error("Failed to stop stream", err);
    }
  };

  // Spawn food not on snake
  const spawnFood = (snake) => {
    let pos;
    do {
      pos = { x: Math.floor(Math.random() * COLS), y: Math.floor(Math.random() * ROWS) };
    } while (snake.some(s => s.x === pos.x && s.y === pos.y));
    return pos;
  };

  // Start game
  const startGame = useCallback(() => {
    const initialSnake = [
      { x: Math.floor(COLS / 2), y: Math.floor(ROWS / 2) },
      { x: Math.floor(COLS / 2) - 1, y: Math.floor(ROWS / 2) },
      { x: Math.floor(COLS / 2) - 2, y: Math.floor(ROWS / 2) },
    ];

    stateRef.current = {
      snake: initialSnake,
      dir: DIR.RIGHT,
      nextDir: DIR.RIGHT,
      food: spawnFood(initialSnake),
      score: 0,
      speed: 220,
      eaten: 0,
      foodPulse: 0,
    };

    setScore(0);
    setSessionTime(0);
    setGameState("playing");
  }, []);

  // Session timer
  useEffect(() => {
    if (gameState === "playing") {
      timerRef.current = setInterval(() => setSessionTime(t => t + 1), 1000);
    } else {
      clearInterval(timerRef.current);
    }
    return () => clearInterval(timerRef.current);
  }, [gameState]);

  // Keyboard controls
  useEffect(() => {
    const handleKey = (e) => {
      if (!stateRef.current || gameState !== "playing") return;
      const s = stateRef.current;
      const [dx, dy] = s.dir;
      switch (e.key) {
        case "ArrowUp": case "w": case "W":
          if (dy !== 1) s.nextDir = DIR.UP; break;
        case "ArrowDown": case "s": case "S":
          if (dy !== -1) s.nextDir = DIR.DOWN; break;
        case "ArrowLeft": case "a": case "A":
          if (dx !== 1) s.nextDir = DIR.LEFT; break;
        case "ArrowRight": case "d": case "D":
          if (dx !== -1) s.nextDir = DIR.RIGHT; break;
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [gameState]);

  // Touch/swipe controls
  useEffect(() => {
    if (gameState !== "playing" || !canvasRef.current) return;
    const canvas = canvasRef.current;
    let touchStart = null;

    const onTouchStart = (e) => {
      const t = e.touches[0];
      touchStart = { x: t.clientX, y: t.clientY };
    };
    const onTouchEnd = (e) => {
      if (!touchStart || !stateRef.current) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - touchStart.x;
      const dy = t.clientY - touchStart.y;
      const s = stateRef.current;
      if (Math.abs(dx) > Math.abs(dy)) {
        if (dx > 20 && s.dir[0] !== -1) s.nextDir = DIR.RIGHT;
        else if (dx < -20 && s.dir[0] !== 1) s.nextDir = DIR.LEFT;
      } else {
        if (dy > 20 && s.dir[1] !== -1) s.nextDir = DIR.DOWN;
        else if (dy < -20 && s.dir[1] !== 1) s.nextDir = DIR.UP;
      }
      touchStart = null;
    };

    canvas.addEventListener("touchstart", onTouchStart, { passive: true });
    canvas.addEventListener("touchend", onTouchEnd, { passive: true });
    return () => {
      canvas.removeEventListener("touchstart", onTouchStart);
      canvas.removeEventListener("touchend", onTouchEnd);
    };
  }, [gameState]);

  // Game loop
  useEffect(() => {
    if (gameState !== "playing" || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    let lastTick = 0;
    let animFrame;

    const tick = (timestamp) => {
      const s = stateRef.current;
      if (!s) return;

      // Animate food pulse
      s.foodPulse = (s.foodPulse + 0.05) % (Math.PI * 2);

      // Speed-gated movement
      if (timestamp - lastTick >= s.speed) {
        lastTick = timestamp;
        s.dir = s.nextDir;

        // Move head
        const head = { x: s.snake[0].x + s.dir[0], y: s.snake[0].y + s.dir[1] };

        // Wall collision
        if (head.x < 0 || head.x >= COLS || head.y < 0 || head.y >= ROWS) {
          endGame(s);
          return;
        }

        // Self collision
        if (s.snake.some(seg => seg.x === head.x && seg.y === head.y)) {
          endGame(s);
          return;
        }

        s.snake.unshift(head);

        // Eat food
        if (head.x === s.food.x && head.y === s.food.y) {
          s.eaten++;
          s.score += 10;
          setScore(s.score);
          s.food = spawnFood(s.snake);
          // Increase speed every 5 food
          if (s.eaten % 5 === 0 && s.speed > 90) {
            s.speed -= 8;
          }
        } else {
          s.snake.pop();
        }
      }

      // --- RENDER ---
      // Background
      ctx.fillStyle = "#f8f8f8";
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

      // Grid lines
      ctx.strokeStyle = "rgba(0,0,0,0.04)";
      ctx.lineWidth = 0.5;
      for (let x = 0; x <= COLS; x++) {
        ctx.beginPath();
        ctx.moveTo(x * CELL, 0);
        ctx.lineTo(x * CELL, CANVAS_H);
        ctx.stroke();
      }
      for (let y = 0; y <= ROWS; y++) {
        ctx.beginPath();
        ctx.moveTo(0, y * CELL);
        ctx.lineTo(CANVAS_W, y * CELL);
        ctx.stroke();
      }

      // Food (pulsing red circle)
      const pulseScale = 1 + Math.sin(s.foodPulse) * 0.15;
      const foodCx = s.food.x * CELL + CELL / 2;
      const foodCy = s.food.y * CELL + CELL / 2;
      const foodR = (CELL / 2 - 2) * pulseScale;

      // Food glow
      ctx.shadowColor = "rgba(204, 51, 51, 0.4)";
      ctx.shadowBlur = 8;
      ctx.fillStyle = "#cc3333";
      ctx.beginPath();
      ctx.arc(foodCx, foodCy, foodR, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;

      // Snake
      const len = s.snake.length;
      s.snake.forEach((seg, i) => {
        const t = i / Math.max(len - 1, 1); // 0 = head, 1 = tail
        const shade = Math.round(17 + t * 119); // #111 → #888
        ctx.fillStyle = `rgb(${shade},${shade},${shade})`;

        const x = seg.x * CELL + 1;
        const y = seg.y * CELL + 1;
        const w = CELL - 2;
        const h = CELL - 2;
        const r = i === 0 ? 5 : 3; // rounder head

        // Rounded rect
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + r);
        ctx.lineTo(x + w, y + h - r);
        ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        ctx.lineTo(x + r, y + h);
        ctx.quadraticCurveTo(x, y + h, x, y + h - r);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.fill();

        // Eyes on head
        if (i === 0) {
          ctx.fillStyle = "#f8f8f8";
          const [dx, dy] = s.dir;
          if (dx === 1 || dx === -1) {
            // Horizontal movement
            ctx.beginPath();
            ctx.arc(seg.x * CELL + CELL / 2 + dx * 2, seg.y * CELL + 5, 2, 0, Math.PI * 2);
            ctx.arc(seg.x * CELL + CELL / 2 + dx * 2, seg.y * CELL + 11, 2, 0, Math.PI * 2);
            ctx.fill();
          } else {
            // Vertical movement
            ctx.beginPath();
            ctx.arc(seg.x * CELL + 5, seg.y * CELL + CELL / 2 + dy * 2, 2, 0, Math.PI * 2);
            ctx.arc(seg.x * CELL + 11, seg.y * CELL + CELL / 2 + dy * 2, 2, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      });

      // Score overlay on canvas
      ctx.fillStyle = "rgba(0,0,0,0.5)";
      ctx.font = "bold 12px 'Montserrat', sans-serif";
      ctx.textAlign = "left";
      ctx.fillText(`Score: ${s.score}`, 8, 18);

      animFrame = requestAnimationFrame(tick);
    };

    animFrame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animFrame);
  }, [gameState]);

  const endGame = (s) => {
    const finalScore = s.score;
    setScore(finalScore);
    if (finalScore > bestScore) {
      setBestScore(finalScore);
      try { localStorage.setItem("fluenci_snake_best", String(finalScore)); } catch {}
    }
    setGameState("gameover");
  };

  // Calculate QUSDC streamed this session
  const qusdcStreamed = (sessionTime * 0.0001).toFixed(4);

  // Format time
  const fmtTime = (s) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

  return (
    <div className="glass-card" style={{ marginTop: "24px", padding: "24px" }}>
      {/* Header + Toggle Tabs */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px", flexWrap: "wrap", gap: "12px" }}>
        <div>
          <h2 style={{ margin: 0, fontSize: "1.4rem", color: "#111111", fontWeight: "bold" }}>Fluenci Arcade</h2>
          <p style={{ margin: "4px 0 0 0", color: "#666666", fontSize: "0.9rem" }}>
            Pay-as-you-use apps. Stream QUSDC while you play or chat — stop anytime.
          </p>
        </div>
        <div style={{ display: "flex", gap: "4px", background: "#f0f0f0", borderRadius: "10px", padding: "3px" }}>
          <button
            onClick={() => setActiveTab("snake")}
            style={{
              padding: "6px 16px", borderRadius: "8px", border: "none",
              background: activeTab === "snake" ? "#111" : "transparent",
              color: activeTab === "snake" ? "#fff" : "#666",
              fontSize: "0.8rem", fontWeight: "bold", cursor: "pointer",
              transition: "all 0.2s"
            }}
          >
            🐍 Snake
          </button>
          <button
            onClick={() => setActiveTab("chat")}
            style={{
              padding: "6px 16px", borderRadius: "8px", border: "none",
              background: activeTab === "chat" ? "#111" : "transparent",
              color: activeTab === "chat" ? "#fff" : "#666",
              fontSize: "0.8rem", fontWeight: "bold", cursor: "pointer",
              transition: "all 0.2s"
            }}
          >
            �- AI Chat
          </button>
        </div>
      </div>

      {/* Tab Content */}
      {activeTab === "chat" ? (
        <FluenciAIChat
          subscriberStreams={subscriberStreams}
          createSubscription={createSubscription}
          terminateStream={terminateStream}
        />
      ) : (
      <>

      {/* Game Area */}
      <div style={{ display: "flex", gap: "24px", flexWrap: "wrap" }}>

        {/* Canvas */}
        <div style={{
          flex: "0 0 auto",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          background: gameState === "playing" ? "#f0f0f0" : "#0a0e1a",
          borderRadius: "16px",
          width: CANVAS_W + 24 + "px",
          minHeight: CANVAS_H + 24 + "px",
          padding: "12px",
          border: "1px solid #e0e0e0",
          position: "relative"
        }}>
          {gameState === "playing" || gameState === "gameover" ? (
            <>
              <canvas
                ref={canvasRef}
                width={CANVAS_W}
                height={CANVAS_H}
                style={{ borderRadius: "8px", display: "block", touchAction: "none" }}
              />
              {gameState === "gameover" && (
                <div style={{
                  position: "absolute",
                  inset: 0,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  background: "rgba(0,0,0,0.7)",
                  borderRadius: "16px",
                  color: "#fff"
                }}>
                  <div style={{ fontSize: "2.5rem", marginBottom: "8px" }}>💀</div>
                  <div style={{ fontSize: "1.4rem", fontWeight: "bold", marginBottom: "4px" }}>Game Over</div>
                  <div style={{ fontSize: "2rem", fontWeight: "bold", margin: "8px 0" }}>{score} pts</div>
                  <div style={{ fontSize: "0.85rem", color: "#ccc", marginBottom: "4px" }}>
                    Session: {fmtTime(sessionTime)} · Streamed: {qusdcStreamed} QUSDC
                  </div>
                  {score >= bestScore && score > 0 && (
                    <div style={{ fontSize: "0.8rem", color: "#fbbf24", fontWeight: "bold", marginBottom: "12px" }}>
                      🏆 NEW BEST SCORE!
                    </div>
                  )}
                  <div style={{ display: "flex", gap: "10px", marginTop: "4px" }}>
                    <button
                      onClick={startGame}
                      className="btn btn-primary"
                      style={{ padding: "8px 24px", justifyContent: "center" }}
                    >
                      Play Again
                    </button>
                    <button
                      onClick={handleStopStream}
                      style={{
                        padding: "8px 18px",
                        background: "rgba(255,255,255,0.12)",
                        border: "1px solid rgba(255,255,255,0.3)",
                        borderRadius: "8px",
                        color: "#ff6b6b",
                        fontSize: "0.85rem",
                        fontWeight: "bold",
                        cursor: "pointer",
                        transition: "all 0.2s"
                      }}
                    >
                      Stop Streaming
                    </button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div style={{ textAlign: "center", padding: "20px" }}>
              <div style={{ fontSize: "3.5rem", marginBottom: "12px" }}>🐍</div>
              {hasActiveStream ? (
                <>
                  <p style={{ color: "#aaa", fontWeight: "bold", margin: "0 0 6px 0", fontSize: "1.1rem" }}>
                    Stream Active!
                  </p>
                  {bestScore > 0 && (
                    <p style={{ color: "#888", fontSize: "0.8rem", margin: "0 0 16px 0" }}>
                      Best: {bestScore} pts
                    </p>
                  )}
                  <button
                    onClick={startGame}
                    className="btn btn-primary"
                    style={{ padding: "10px 24px", justifyContent: "center" }}
                  >
                    Start Game
                  </button>
                  <p style={{ color: "#666", fontSize: "0.7rem", marginTop: "12px" }}>
                    Arrow keys or WASD · Swipe on mobile
                  </p>
                </>
              ) : (
                <>
                  <p style={{ color: "#888", maxWidth: "260px", margin: "0 auto 20px auto", fontSize: "0.85rem" }}>
                    Start a micro-payment stream to unlock the Fluenci Snake Arcade.
                  </p>
                  <button
                    onClick={handleStartStream}
                    className="btn btn-primary"
                    style={{ padding: "10px 24px", justifyContent: "center" }}
                  >
                    Subscribe & Play
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        {/* Telemetry Panel */}
        <div style={{ flex: 1, minWidth: "240px", display: "flex", flexDirection: "column", gap: "12px" }}>
          <div className="glass-card" style={{ background: "#f8f8f8", border: "1px solid #e8e8e8", padding: "16px" }}>
            <h4 style={{ margin: "0 0 12px 0", fontSize: "1rem", color: "#111111" }}>Stream Telemetry</h4>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "16px" }}>
              <div style={{ background: "rgba(0,0,0,0.03)", padding: "10px 12px", borderRadius: "8px" }}>
                <div style={{ fontSize: "0.7rem", color: "#888", textTransform: "uppercase", letterSpacing: "0.05em" }}>Score</div>
                <div style={{ fontSize: "1.3rem", color: "#111", fontWeight: "bold" }}>{score}</div>
              </div>
              <div style={{ background: "rgba(0,0,0,0.03)", padding: "10px 12px", borderRadius: "8px" }}>
                <div style={{ fontSize: "0.7rem", color: "#888", textTransform: "uppercase", letterSpacing: "0.05em" }}>Best</div>
                <div style={{ fontSize: "1.3rem", color: "#111", fontWeight: "bold" }}>{bestScore}</div>
              </div>
              <div style={{ background: "rgba(0,0,0,0.03)", padding: "10px 12px", borderRadius: "8px" }}>
                <div style={{ fontSize: "0.7rem", color: "#888", textTransform: "uppercase", letterSpacing: "0.05em" }}>Session</div>
                <div style={{ fontSize: "1.1rem", color: "#111", fontWeight: "bold", fontFamily: "monospace" }}>{fmtTime(sessionTime)}</div>
              </div>
              <div style={{ background: "rgba(0,0,0,0.03)", padding: "10px 12px", borderRadius: "8px" }}>
                <div style={{ fontSize: "0.7rem", color: "#888", textTransform: "uppercase", letterSpacing: "0.05em" }}>Streamed</div>
                <div style={{ fontSize: "0.95rem", color: "#111", fontWeight: "bold" }}>{qusdcStreamed} <span style={{ fontSize: "0.7rem", color: "#888" }}>QUSDC</span></div>
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px" }}>
              <div style={{
                width: "8px", height: "8px", borderRadius: "50%",
                background: gameState === "playing" ? "#16a34a" : gameState === "gameover" ? "#cc3333" : "#d4d4d4",
                boxShadow: gameState === "playing" ? "0 0 6px #16a34a" : "none"
              }} />
              <span style={{ fontSize: "0.8rem", color: "#666", fontWeight: "600" }}>
                {gameState === "playing" ? "PLAYING" : gameState === "gameover" ? "GAME OVER" : "IDLE"}
              </span>
            </div>

            <div style={{
              background: "rgba(0,0,0,0.03)", padding: "10px 12px", borderRadius: "8px",
              display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "0.75rem"
            }}>
              <span style={{ color: "#888" }}>Stream Rate</span>
              <span style={{ color: "#111", fontWeight: "bold" }}>0.0001 QUSDC/sec</span>
            </div>
          </div>

          <div style={{ fontSize: "0.8rem", color: "#888", lineHeight: "1.5", padding: "0 4px" }}>
            💡 <strong style={{ color: "#555" }}>How it works:</strong> The Fluenci Snake Arcade opens a micro-payment stream at 0.0001 QUSDC/sec. You only pay while playing — pause or terminate the stream anytime from your Subscriber Panel. No upfront costs, no monthly fees.
          </div>
        </div>
      </div>
      </>
      )}
    </div>
  );
}
