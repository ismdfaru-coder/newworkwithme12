// app/api/agent/route.ts
// Browser Use API v3 implementation
// Creates a session with a task and polls for completion with streaming updates

export const runtime = "nodejs";
export const maxDuration = 300;

const BROWSER_USE_API_URL = "https://api.browser-use.com/api/v3";
const BROWSER_USE_API_KEY = process.env.BROWSER_USE_API_KEY || "bu_7DCoBFfKI2IaGqA8S6tHOA2fLQmk0UghmERu8RTzXyg";

interface BrowserUseSession {
  id: string;
  status: "created" | "idle" | "running" | "stopped" | "timed_out" | "error";
  model: "bu-mini" | "bu-max";
  title?: string | null;
  output?: unknown;
  liveUrl?: string | null;
  totalCostUsd?: string;
  createdAt: string;
  updatedAt: string;
}

interface BrowserUseMessage {
  role: string;
  content: string;
  timestamp?: string;
}

async function createSessionWithTask(task: string, model: "bu-mini" | "bu-max" = "bu-mini"): Promise<BrowserUseSession> {
  const res = await fetch(`${BROWSER_USE_API_URL}/sessions`, {
    method: "POST",
    headers: { 
      "x-api-key": BROWSER_USE_API_KEY, 
      "Content-Type": "application/json" 
    },
    body: JSON.stringify({
      task,
      model,
      keepAlive: false, // Auto-stop when task finishes
      proxyCountryCode: "us",
    }),
  });
  
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Failed to create session: ${res.status} - ${errText}`);
  }
  
  return res.json();
}

async function getSession(sessionId: string): Promise<BrowserUseSession> {
  const res = await fetch(`${BROWSER_USE_API_URL}/sessions/${sessionId}`, {
    method: "GET",
    headers: { "x-api-key": BROWSER_USE_API_KEY },
  });
  
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Failed to get session: ${res.status} - ${errText}`);
  }
  
  return res.json();
}

async function getSessionMessages(sessionId: string): Promise<BrowserUseMessage[]> {
  const res = await fetch(`${BROWSER_USE_API_URL}/sessions/${sessionId}/messages`, {
    method: "GET",
    headers: { "x-api-key": BROWSER_USE_API_KEY },
  });
  
  if (!res.ok) {
    // Messages endpoint may not be available yet
    return [];
  }
  
  return res.json();
}

async function stopSession(sessionId: string): Promise<void> {
  await fetch(`${BROWSER_USE_API_URL}/sessions/${sessionId}/stop`, {
    method: "POST",
    headers: { 
      "x-api-key": BROWSER_USE_API_KEY,
      "Content-Type": "application/json" 
    },
    body: JSON.stringify({ strategy: "session" }),
  });
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const query = searchParams.get("query") ?? "";
  const model = (searchParams.get("model") as "bu-mini" | "bu-max") ?? "bu-mini";

  if (!query) {
    return new Response(JSON.stringify({ error: "Missing query" }), { status: 400 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: object) =>
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));

      let sessionId: string | null = null;
      let lastMessageCount = 0;

      try {
        // ── 1. Create Browser Use session with task ─────────────────────────────
        send("step", { type: "info", desc: "Creating Browser Use session..." });

        const session = await createSessionWithTask(query, model);
        
        if (!session.id) {
          throw new Error("Invalid session response: missing id");
        }

        sessionId = session.id;

        // Send session info immediately so iframe can appear
        send("session", {
          sessionId: session.id,
          liveViewUrl: session.liveUrl || null,
          interactiveLiveViewUrl: session.liveUrl || null,
          status: session.status,
          model: session.model,
        });

        send("step", { type: "success", desc: `Session created. ID: ${session.id}` });
        send("step", { type: "info", desc: `Task submitted: "${query}"` });
        send("step", { type: "info", desc: `Using model: ${session.model}` });

        // ── 2. Poll for task completion ──────────────────────────────────────
        // Browser Use handles all browser commands automatically from natural language
        send("step", { type: "info", desc: "Browser Use agent is executing the task..." });

        const maxPolls = 120; // 2 minutes max (1 second intervals)
        let pollCount = 0;
        let lastStatus = session.status;

        while (pollCount < maxPolls) {
          await new Promise(r => setTimeout(r, 1000)); // Poll every 1 second
          
          const currentSession = await getSession(sessionId);
          
          // Send status update if changed
          if (currentSession.status !== lastStatus) {
            send("step", { 
              type: currentSession.status === "error" ? "error" : "info", 
              desc: `Session status: ${currentSession.status}` 
            });
            lastStatus = currentSession.status;
          }

          // Update live URL if it becomes available
          if (currentSession.liveUrl) {
            send("session", {
              sessionId: currentSession.id,
              liveViewUrl: currentSession.liveUrl,
              interactiveLiveViewUrl: currentSession.liveUrl,
              status: currentSession.status,
              model: currentSession.model,
            });
          }

          // Try to get messages for progress updates
          try {
            const messages = await getSessionMessages(sessionId);
            if (messages.length > lastMessageCount) {
              const newMessages = messages.slice(lastMessageCount);
              for (const msg of newMessages) {
                send("message", { 
                  role: msg.role, 
                  content: msg.content,
                  timestamp: msg.timestamp 
                });
                
                // Send as step for visibility
                if (msg.content && msg.content.length < 500) {
                  send("step", { 
                    type: "info", 
                    desc: `${msg.role}: ${msg.content.substring(0, 200)}${msg.content.length > 200 ? '...' : ''}` 
                  });
                }
              }
              lastMessageCount = messages.length;
            }
          } catch {
            // Messages endpoint may not be available - continue polling
          }

          // Check if task is complete
          if (currentSession.status === "idle" || currentSession.status === "stopped") {
            send("step", { type: "success", desc: "Task completed successfully!" });
            
            // Get final output
            if (currentSession.output) {
              send("result", { 
                output: currentSession.output,
                success: true 
              });
              
              const outputStr = typeof currentSession.output === 'string' 
                ? currentSession.output 
                : JSON.stringify(currentSession.output, null, 2);
              
              send("summary", { text: outputStr });
            }
            
            // Send cost info
            if (currentSession.totalCostUsd) {
              send("step", { 
                type: "info", 
                desc: `Total cost: $${currentSession.totalCostUsd}` 
              });
            }
            
            break;
          }

          // Check for error status
          if (currentSession.status === "error") {
            send("step", { type: "error", desc: "Task encountered an error" });
            
            if (currentSession.output) {
              send("result", { 
                output: currentSession.output,
                success: false 
              });
            }
            break;
          }

          // Check for timeout
          if (currentSession.status === "timed_out") {
            send("step", { type: "error", desc: "Task timed out" });
            break;
          }

          pollCount++;
          
          // Send progress indicator every 10 seconds
          if (pollCount % 10 === 0) {
            send("step", { 
              type: "info", 
              desc: `Still working... (${pollCount}s elapsed)` 
            });
          }
        }

        if (pollCount >= maxPolls) {
          send("step", { type: "error", desc: "Polling timeout reached. Task may still be running." });
        }

        send("done", { message: "Agent finished. See browser panel for results." });

      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        
        // Handle specific errors
        if (errorMessage.includes("quota") || errorMessage.includes("limit")) {
          send("agent_error", { 
            message: "API quota exceeded. Please check your Browser Use account at cloud.browser-use.com" 
          });
        } else if (errorMessage.includes("401") || errorMessage.includes("unauthorized")) {
          send("agent_error", { 
            message: "Invalid API key. Please check your BROWSER_USE_API_KEY environment variable." 
          });
        } else {
          send("agent_error", { message: errorMessage });
        }
      } finally {
        controller.close();
        // Don't immediately stop the session - let user view results
        // Session will auto-stop when keepAlive is false
        if (sessionId) {
          // Stop session after 5 minutes to clean up
          setTimeout(() => stopSession(sessionId!), 300_000);
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

// POST endpoint for more complex requests
export async function POST(req: Request) {
  const body = await req.json();
  const { query, model } = body;

  if (!query) {
    return new Response(JSON.stringify({ error: "Missing query" }), { status: 400 });
  }

  const url = new URL(req.url);
  url.searchParams.set("query", query);
  if (model) url.searchParams.set("model", model);
  
  return GET(new Request(url.toString()));
}
