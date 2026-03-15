// app/api/agent/route.ts
// Browser Use API v2 implementation
// Creates a task and polls for completion with streaming updates

export const runtime = "nodejs";
export const maxDuration = 300;

const BROWSER_USE_API_URL = "https://api.browser-use.com/api/v2";
const BROWSER_USE_API_KEY = process.env.BROWSER_USE_API_KEY || "";

// Helper to get auth headers - uses X-Browser-Use-API-Key header
const getAuthHeaders = () => ({
  "X-Browser-Use-API-Key": BROWSER_USE_API_KEY,
  "Content-Type": "application/json",
});

interface BrowserUseTaskResponse {
  id: string;
  status: "pending" | "running" | "finished" | "failed" | "stopped";
  output?: unknown;
  liveUrl?: string;
  live_url?: string;
  createdAt?: string;
  finishedAt?: string;
  error?: string;
}

async function createTask(task: string): Promise<BrowserUseTaskResponse> {
  console.log("[v0] Creating task with Browser Use API v2...");
  console.log("[v0] API URL:", `${BROWSER_USE_API_URL}/tasks`);
  console.log("[v0] API Key present:", !!BROWSER_USE_API_KEY);
  
  const res = await fetch(`${BROWSER_USE_API_URL}/tasks`, {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify({ task }),
  });
  
  console.log("[v0] Response status:", res.status);
  
  if (!res.ok) {
    const errText = await res.text();
    console.log("[v0] Error response:", errText);
    throw new Error(`Failed to create task: ${res.status} - ${errText}`);
  }
  
  const data = await res.json();
  console.log("[v0] Task created response:", JSON.stringify(data, null, 2));
  return data;
}

async function getTask(taskId: string): Promise<BrowserUseTaskResponse> {
  const res = await fetch(`${BROWSER_USE_API_URL}/tasks/${taskId}`, {
    method: "GET",
    headers: getAuthHeaders(),
  });
  
  if (!res.ok) {
    const errText = await res.text();
    console.log("[v0] Get task error:", errText);
    throw new Error(`Failed to get task: ${res.status} - ${errText}`);
  }
  
  const data = await res.json();
  console.log("[v0] Get task response:", JSON.stringify(data, null, 2));
  return data;
}

async function stopTask(taskId: string): Promise<void> {
  await fetch(`${BROWSER_USE_API_URL}/tasks/${taskId}/stop`, {
    method: "PUT",
    headers: getAuthHeaders(),
  }).catch(() => {});
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const query = searchParams.get("query") ?? "";

  if (!query) {
    return new Response(JSON.stringify({ error: "Missing query" }), { status: 400 });
  }

  if (!BROWSER_USE_API_KEY) {
    return new Response(JSON.stringify({ error: "BROWSER_USE_API_KEY environment variable is not set" }), { status: 500 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: object) =>
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));

      let taskId: string | null = null;

      try {
        // ── 1. Create Browser Use task ─────────────────────────────
        send("step", { type: "info", desc: "Creating Browser Use task..." });

        const taskResponse = await createTask(query);
        
        if (!taskResponse.id) {
          throw new Error("Invalid response: missing task id");
        }

        taskId = taskResponse.id;
        const liveUrl = taskResponse.liveUrl || taskResponse.live_url || null;

        // Send session info immediately so iframe can appear
        send("session", {
          sessionId: taskId,
          liveViewUrl: liveUrl,
          interactiveLiveViewUrl: liveUrl,
          liveUrl: liveUrl,
          status: taskResponse.status || "running",
        });

        send("step", { type: "success", desc: `Task created. ID: ${taskId}` });
        send("step", { type: "info", desc: `Task: "${query}"` });

        if (liveUrl) {
          send("step", { type: "info", desc: `Live view available` });
        }

        // ── 2. Poll for task completion ──────────────────────────────────────
        send("step", { type: "info", desc: "Browser Use agent is executing the task..." });

        const maxPolls = 180; // 3 minutes max (1 second intervals)
        let pollCount = 0;
        let lastStatus = taskResponse.status || "running";

        while (pollCount < maxPolls) {
          await new Promise(r => setTimeout(r, 1000)); // Poll every 1 second
          
          const currentTask = await getTask(taskId);
          const currentLiveUrl = currentTask.liveUrl || currentTask.live_url || null;
          
          // Update live URL if it becomes available
          if (currentLiveUrl) {
            send("session", {
              sessionId: currentTask.id,
              liveViewUrl: currentLiveUrl,
              interactiveLiveViewUrl: currentLiveUrl,
              liveUrl: currentLiveUrl,
              status: currentTask.status,
            });
          }

          // Send status update if changed
          if (currentTask.status !== lastStatus) {
            send("step", { 
              type: currentTask.status === "failed" ? "error" : "info", 
              desc: `Task status: ${currentTask.status}` 
            });
            lastStatus = currentTask.status;
          }

          // Check if task is complete
          if (currentTask.status === "finished") {
            send("step", { type: "success", desc: "Task completed successfully!" });
            
            // Get final output
            if (currentTask.output) {
              send("result", { 
                output: currentTask.output,
                success: true 
              });
              
              const outputStr = typeof currentTask.output === 'string' 
                ? currentTask.output 
                : JSON.stringify(currentTask.output, null, 2);
              
              send("summary", { text: outputStr });
            }
            
            break;
          }

          // Check for failed status
          if (currentTask.status === "failed") {
            send("step", { type: "error", desc: `Task failed: ${currentTask.error || "Unknown error"}` });
            
            if (currentTask.output) {
              send("result", { 
                output: currentTask.output,
                success: false 
              });
            }
            break;
          }

          // Check for stopped status
          if (currentTask.status === "stopped") {
            send("step", { type: "info", desc: "Task was stopped" });
            break;
          }

          pollCount++;
          
          // Send progress indicator every 15 seconds
          if (pollCount % 15 === 0) {
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
        if (errorMessage.includes("401") || errorMessage.includes("403") || errorMessage.includes("Unauthorized") || errorMessage.includes("unauthorized")) {
          send("agent_error", { 
            message: "Invalid API key. Please check your BROWSER_USE_API_KEY environment variable." 
          });
        } else if (errorMessage.includes("402") || errorMessage.includes("quota") || errorMessage.includes("limit")) {
          send("agent_error", { 
            message: "API quota exceeded. Please check your Browser Use account at cloud.browser-use.com" 
          });
        } else {
          send("agent_error", { message: errorMessage });
        }
      } finally {
        controller.close();
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
  const { query } = body;

  if (!query) {
    return new Response(JSON.stringify({ error: "Missing query" }), { status: 400 });
  }

  const url = new URL(req.url);
  url.searchParams.set("query", query);
  
  return GET(new Request(url.toString()));
}
