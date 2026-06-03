import React, { useState, useEffect, useRef } from "react";

export function QieDoodleGame({ account, subscriberStreams, createSubscription, contracts }) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [hasActiveStream, setHasActiveStream] = useState(false);
  const [score, setScore] = useState(0);
  const [doodleStream, setDoodleStream] = useState(null);
  
  const canvasRef = useRef(null);
  const animationRef = useRef(null);

  // Check if subscriber has an active stream to the QieDoodle merchant (0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC)
  const DOODLE_MERCHANT = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";

  useEffect(() => {
    const stream = subscriberStreams.find(
      (s) => s.merchant.toLowerCase() === DOODLE_MERCHANT.toLowerCase() && s.active && !s.pausedByAI
    );
    setHasActiveStream(!!stream);
    setDoodleStream(stream || null);
  }, [subscriberStreams]);

  const handleStartStream = async () => {
    // Start a cheap stream (e.g., 100 units of qUSDC per second, representing micro-cent gaming fee)
    try {
      await createSubscription(
        DOODLE_MERCHANT,
        "qUSDC",
        "100", // 0.0001 qUSDC per second
        0, // no cliff
        0  // infinite
      );
    } catch (err) {
      console.error("Failed to start QieDoodle stream", err);
    }
  };

  // Game Engine logic inside Canvas
  useEffect(() => {
    if (!isPlaying || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    
    let doodle = {
      x: canvas.width / 2 - 15,
      y: canvas.height - 60,
      width: 30,
      height: 30,
      vy: 0,
      speed: 4,
      jumpForce: -9,
      gravity: 0.35
    };

    let platforms = [
      { x: canvas.width / 2 - 40, y: canvas.height - 20, width: 80, height: 10 },
      { x: 50, y: 250, width: 80, height: 10 },
      { x: 180, y: 170, width: 80, height: 10 },
      { x: 80, y: 90, width: 80, height: 10 }
    ];

    let keys = {};
    const handleKeyDown = (e) => { keys[e.code] = true; };
    const handleKeyUp = (e) => { keys[e.code] = false; };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    let localScore = 0;
    
    const updateGame = () => {
      // Clear
      ctx.fillStyle = "#0c1020";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Movement
      if (keys["ArrowLeft"] || keys["KeyA"]) doodle.x -= doodle.speed;
      if (keys["ArrowRight"] || keys["KeyD"]) doodle.x += doodle.speed;

      // Screen wrapping
      if (doodle.x < -doodle.width) doodle.x = canvas.width;
      if (doodle.x > canvas.width) doodle.x = -doodle.width;

      // Apply Gravity
      doodle.vy += doodle.gravity;
      doodle.y += doodle.vy;

      // Collide with platforms
      platforms.forEach((plat) => {
        if (
          doodle.vy > 0 &&
          doodle.x + doodle.width > plat.x &&
          doodle.x < plat.x + plat.width &&
          doodle.y + doodle.height >= plat.y &&
          doodle.y + doodle.height <= plat.y + plat.height + 4
        ) {
          doodle.vy = doodle.jumpForce;
          localScore += 10;
          setScore(localScore);
          // Shift platforms downward
          plat.y = Math.random() * 50 + 50;
          plat.x = Math.random() * (canvas.width - plat.width);
        }
      });

      // Death condition (fall off screen)
      if (doodle.y > canvas.height) {
        setIsPlaying(false);
      }

      // Draw Platforms
      ctx.fillStyle = "rgba(0, 230, 118, 0.85)";
      platforms.forEach((plat) => {
        ctx.fillRect(plat.x, plat.y, plat.width, plat.height);
        // Draw platform glow
        ctx.shadowColor = "#00e676";
        ctx.shadowBlur = 10;
        ctx.strokeStyle = "#00e676";
        ctx.strokeRect(plat.x, plat.y, plat.width, plat.height);
        ctx.shadowBlur = 0;
      });

      // Draw Doodle character
      ctx.fillStyle = "rgba(0, 229, 255, 1)";
      ctx.shadowColor = "#00e5ff";
      ctx.shadowBlur = 15;
      ctx.beginPath();
      ctx.arc(doodle.x + 15, doodle.y + 15, 15, 0, Math.PI * 2);
      ctx.fill();
      
      // Face
      ctx.fillStyle = "#0c1020";
      ctx.beginPath();
      ctx.arc(doodle.x + 10, doodle.y + 12, 2, 0, Math.PI * 2);
      ctx.arc(doodle.x + 20, doodle.y + 12, 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;

      animationRef.current = requestAnimationFrame(updateGame);
    };

    animationRef.current = requestAnimationFrame(updateGame);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      cancelAnimationFrame(animationRef.current);
    };
  }, [isPlaying]);

  return (
    <div className="glass-card doodle-portal-container" style={{ marginTop: "24px", padding: "24px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
        <div>
          <h2 style={{ margin: 0, fontSize: "1.4rem", color: "#00e5ff", fontWeight: "bold" }}>👾 QieDoodle Micro-Stream Arcade</h2>
          <p style={{ margin: "4px 0 0 0", color: "#8a9fc4", fontSize: "0.9rem" }}>
            Experience real-time gaming payment streams. Powered by continuous micro-fees.
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <span style={{
            padding: "4px 10px",
            borderRadius: "12px",
            fontSize: "0.8rem",
            fontWeight: "bold",
            background: hasActiveStream ? "rgba(0, 230, 118, 0.15)" : "rgba(255, 23, 68, 0.15)",
            color: hasActiveStream ? "#00e676" : "#ff1744",
            border: `1px solid ${hasActiveStream ? "#00e676" : "#ff1744"}`
          }}>
            {hasActiveStream ? "STREAM ACTIVE" : "STREAM REQUIRED"}
          </span>
        </div>
      </div>

      <div style={{ display: "flex", gap: "24px", flexDirection: window.innerWidth < 800 ? "column" : "row" }}>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", background: "#060914", borderRadius: "16px", minHeight: "350px", border: "1px solid rgba(255,255,255,0.05)" }}>
          {isPlaying ? (
            <canvas ref={canvasRef} width="320" height="350" style={{ borderRadius: "12px", background: "#0c1020" }} />
          ) : (
            <div style={{ textAlign: "center", padding: "20px" }}>
              <div style={{ fontSize: "3.5rem", marginBottom: "12px" }}>🛸</div>
              {hasActiveStream ? (
                <>
                  <p style={{ color: "#fff", fontWeight: "bold", margin: "0 0 16px 0" }}>Steam is Active! Ready to launch Doodle.</p>
                  <button 
                    onClick={() => { setScore(0); setIsPlaying(true); }}
                    className="gradient-btn"
                    style={{ padding: "10px 24px" }}
                  >
                    PLAY GAME
                  </button>
                </>
              ) : (
                <>
                  <p style={{ color: "#8a9fc4", maxWidth: "260px", margin: "0 auto 20px auto", fontSize: "0.85rem" }}>
                    To unlock this arcade doodle session, you must start a micro-transaction payment stream to <strong>qiedoodle.qie</strong>.
                  </p>
                  <button 
                    onClick={handleStartStream}
                    className="gradient-btn"
                    style={{ padding: "10px 24px" }}
                  >
                    SUBSCRIBE & PLAY
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        <div style={{ flex: 1.2, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
          <div className="glass-card" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)", padding: "16px" }}>
            <h4 style={{ margin: "0 0 12px 0", fontSize: "1rem", color: "#fff" }}>Stream Telemetry Logs</h4>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "16px" }}>
              <div style={{ background: "rgba(0,0,0,0.2)", padding: "8px 12px", borderRadius: "8px" }}>
                <div style={{ fontSize: "0.75rem", color: "#8a9fc4" }}>TARGET MERCHANT</div>
                <div style={{ fontSize: "0.8rem", color: "#00e5ff", fontWeight: "bold", textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap" }}>
                  qiedoodle.qie
                </div>
              </div>
              <div style={{ background: "rgba(0,0,0,0.2)", padding: "8px 12px", borderRadius: "8px" }}>
                <div style={{ fontSize: "0.75rem", color: "#8a9fc4" }}>STREAM RATE</div>
                <div style={{ fontSize: "0.85rem", color: "#fff", fontWeight: "bold" }}>
                  0.0001 qUSDC / sec
                </div>
              </div>
              <div style={{ background: "rgba(0,0,0,0.2)", padding: "8px 12px", borderRadius: "8px" }}>
                <div style={{ fontSize: "0.75rem", color: "#8a9fc4" }}>GAME SCORE</div>
                <div style={{ fontSize: "1.2rem", color: "#00e676", fontWeight: "bold" }}>
                  {score} pts
                </div>
              </div>
              <div style={{ background: "rgba(0,0,0,0.2)", padding: "8px 12px", borderRadius: "8px" }}>
                <div style={{ fontSize: "0.75rem", color: "#8a9fc4" }}>ESTIMATED SPEND</div>
                <div style={{ fontSize: "0.85rem", color: "#ff1744", fontWeight: "bold" }}>
                  {doodleStream ? "ACTIVE" : "0.0000 qUSDC"}
                </div>
              </div>
            </div>
            
            <div style={{ fontSize: "0.8rem", color: "#8a9fc4", lineHeight: "1.4" }}>
              💡 <strong>How it works:</strong> The QieDoodle Arcade operates by opening a micro-fee payment stream. Unlike web2 subscriptions, there are no upfront monthly costs. The moment you stop playing, you can pause or terminate the stream in your Subscriber Panel, ensuring you are billed only for what you use.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
