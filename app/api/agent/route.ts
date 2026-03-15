// app/api/agent/route.ts
// Browser Use API v2 implementation
// Creates a task, fetches session for liveUrl, and polls for completion

export const runtime = "nodejs";
export const maxDuration = 300;

const BROWSER_USE_API_URL = "https://api.browser-use.com/api/v2";
const BROWSER_USE_API_KEY = process.env.BROWSER_USE_API_KEY || "";

// Helper to get auth headers - uses X-Browser-Use-API-Key header
const getAuthHeaders = () => ({
  "X-Browser-Use-API-Key": BROWSER_USE_API_KEY,
  "Content-Type": "application/json",
});

// Response from POST /tasks - only returns id and sessionId
interface TaskCreatedResponse {
  id: string;
  sessionId: string;
}

// Response from GET /tasks/{id}
interface TaskView {
  id: string;
  sessionId: string;
  task: string;
  status: "created" | "started" | "finished" | "stopped";
  output?: string | null;
  isSuccess?: boolean | null;
  cost?: string | null;
  steps?: TaskStep[];
  error?: string;
}

interface TaskStep {
  number: number;
  memory: string;
  url: string;
  screenshotUrl?: string | null;
  actions: string[];
}

// Response from GET /sessions/{id}
interface SessionView {
  id: string;
  status: "active" | "stopped";
  liveUrl?: string | null;
  recordingUrl?: string | null;
  tasks: Array<{
    id: string;
    status: string;
    output?: string | null;
  }>;
}

async function createTask(task: string): Promise<TaskCreatedResponse> {
  const res = await fetch(`${BROWSER_USE_API_URL}/tasks`, {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify({ task }),
  });
  
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Failed to create task: ${res.status} - ${errText}`);
  }
  
  return res.json();
}

async function getSession(sessionId: string): Promise<SessionView> {
  const res = await fetch(`${BROWSER_USE_API_URL}/sessions/${sessionId}`, {
    method: "GET",
    headers: getAuthHeaders(),
  });
  
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Failed to get session: ${res.status} - ${errText}`);
  }
  
  return res.json();
}

async function getTask(taskId: string): Promise<TaskView> {
  const res = await fetch(`${BROWSER_USE_API_URL}/tasks/${taskId}`, {
    method: "GET",
    headers: getAuthHeaders(),
  });
  
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Failed to get task: ${res.status} - ${errText}`);
  }
  
  return res.json();
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

      try {
        // ── 1. Create Browser Use task ─────────────────────────────
        send("step", { type: "info", desc: "Creating Browser Use task..." });

        const taskResponse = await createTask(query);
        
        if (!taskResponse.id || !taskResponse.sessionId) {
          throw new Error("Invalid response: missing task id or sessionId");
        }

        const taskId = taskResponse.id;
        const sessionId = taskResponse.sessionId;

        send("step", { type: "success", desc: `Task created. ID: ${taskId}` });
        send("step", { type: "info", desc: `Session ID: ${sessionId}` });

        // ── 2. Fetch session to get liveUrl ─────────────────────────────
        send("step", { type: "info", desc: "Fetching browser session..." });
        
        // Give the session a moment to initialize
        await new Promise(r => setTimeout(r, 1000));
        
        const session = await getSession(sessionId);
        const liveUrl = session.liveUrl || null;

        // Send session info with liveUrl so iframe can display
        send("session", {
          sessionId: sessionId,
          taskId: taskId,
          liveViewUrl: liveUrl,
          interactiveLiveViewUrl: liveUrl,
          liveUrl: liveUrl,
          status: session.status,
        });

        if (liveUrl) {
          send("step", { type: "success", desc: "Live browser view ready!" });
        } else {
          send("step", { type: "info", desc: "Waiting for live view..." });
        }

        send("step", { type: "info", desc: `Task: "${query}"` });

        // ── 3. Poll for task completion ──────────────────────────────────────
        send("step", { type: "info", desc: "Browser Use agent is executing the task..." });

        const maxPolls = 180; // 3 minutes max
        let pollCount = 0;
        let lastStatus = "created";
        let lastStepCount = 0;

        while (pollCount < maxPolls) {
          await new Promise(r => setTimeout(r, 1000));
          
          const currentTask = await getTask(taskId);
          
          // Re-fetch session to check if liveUrl becomes available
          if (!liveUrl && pollCount < 10) {
            const updatedSession = await getSession(sessionId);
            if (updatedSession.liveUrl) {
              send("session", {
                sessionId: sessionId,
                taskId: taskId,
                liveViewUrl: updatedSession.liveUrl,
                interactiveLiveViewUrl: updatedSession.liveUrl,
                liveUrl: updatedSession.liveUrl,
                status: updatedSession.status,
              });
              send("step", { type: "success", desc: "Live browser view ready!" });
            }
          }

          // Send status update if changed
          if (currentTask.status !== lastStatus) {
            send("step", { 
              type: currentTask.status === "finished" ? "success" : "info", 
              desc: `Task status: ${currentTask.status}` 
            });
            lastStatus = currentTask.status;
          }

          // Send step updates
          if (currentTask.steps && currentTask.steps.length > lastStepCount) {
            const newSteps = currentTask.steps.slice(lastStepCount);
            for (const step of newSteps) {
              send("step", { 
                type: "info", 
                desc: `Step ${step.number}: ${step.memory.substring(0, 100)}...`,
                url: step.url,
                screenshotUrl: step.screenshotUrl
              });
            }
            lastStepCount = currentTask.steps.length;
          }

          // Check if task is complete
          if (currentTask.status === "finished") {
            send("step", { type: "success", desc: "Task completed!" });
            
            if (currentTask.output) {
              send("result", { 
                output: currentTask.output,
                success: currentTask.isSuccess ?? true,
                cost: currentTask.cost
              });
              
              send("summary", { text: currentTask.output });
            }
            
            break;
          }

          // Check for stopped status
          if (currentTask.status === "stopped") {
            send("step", { type: "info", desc: "Task was stopped" });
            break;
          }

          pollCount++;
          
          // Send progress indicator every 10 seconds
          if (pollCount % 10 === 0) {
            send("step", { 
              type: "info", 
              desc: `Still working... (${pollCount}s elapsed, ${lastStepCount} steps completed)` 
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
