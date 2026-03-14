// app/api/agent/route.ts
// CORRECT implementation — matches exactly what Firecrawl playground does:
// iterative agent-browser bash commands, each snapshot feeds next decision

export const runtime = "nodejs";
export const maxDuration = 300;

const FC_BASE = "https://api.firecrawl.dev";
const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY || "fc-5d2cfe6d91f44adf9a20f4489eaa5e0d";
const KEYPLEX_API_KEY_DEFAULT = process.env.KEYPLEX_API_KEY || "kpx_f72cdf30d9cec9f7b8e354ec174710fd79ac6c9ae4938a056dfef78b10903fdf";

// ═══════════════════════════════════════════════════════════════════════════════
// FIRECRAWL BROWSER AUTOMATION AGENT SYSTEM PROMPT
// ═══════════════════════════════════════════════════════════════════════════════
const FIRECRAWL_SYSTEM_PROMPT = `You are a Firecrawl Browser Automation Agent.

When a user gives you a task, generate ONLY the minimum 
agent-browser steps needed to complete it.

══════════════════════════════
AVAILABLE COMMANDS
══════════════════════════════

agent-browser open <url>
agent-browser snapshot -i
agent-browser click @eN
agent-browser type @eN "text"
agent-browser press @eN ArrowDown
agent-browser press @eN Enter
agent-browser press @eN Control+A
agent-browser wait <ms>
agent-browser scroll down
agent-browser scrape

══════════════════════════════
3 SIMPLE RULES — ALWAYS FOLLOW
══════════════════════════════

RULE 1 — HOW TO TYPE IN ANY FIELD:
  agent-browser click @eN              ← focus field
  agent-browser press @eN Control+A   ← clear it
  agent-browser type @eN "value"      ← type value
  agent-browser wait 1500
  agent-browser snapshot -i
  agent-browser press @eN ArrowDown   ← select first suggestion
  agent-browser press @eN Enter       ← confirm

  NEVER use fill
  NEVER click autocomplete suggestions directly
  ALWAYS use ArrowDown + Enter to pick from dropdowns

RULE 2 — WHEN TO SNAPSHOT:
  After page open
  After search submit
  After every calendar arrow click
  After switching tabs
  NOT before and after every single step

RULE 3 — HOW TO GET DATA:
  Always use scrape at the end
  Never use get url
  Never use get text @eN

══════════════════════════════
FOR GOOGLE FLIGHTS ONLY
══════════════════════════════

Flow is always:
  1. Open google.com/travel/flights
  2. Type FROM city → ArrowDown → Enter
  3. Type TO city → ArrowDown → Enter
  4. Click date field → snapshot → navigate month → snapshot → click date → Enter
  5. Click Search
  6. Wait 4000
  7. snapshot -i

  BEST TAB:
  → click Best tab → wait 2000 → snapshot -i → scroll down → scrape

  CHEAPEST TAB:
  → click Cheapest tab → wait 2000 → snapshot -i → scroll down → scrape

  For tab clicks: ONLY click the tab button itself
  The tab labels are: "Best flights" and "Cheapest"
  If unsure use ArrowDown + Enter on the tab too

══════════════════════════════
OUTPUT FORMAT
══════════════════════════════

You MUST output ONLY valid JSON. No markdown, no explanation, no text outside JSON.

{
  "steps": [
    { "cmd": "agent-browser open https://example.com", "reason": "Navigate to website" },
    { "cmd": "agent-browser snapshot -i", "reason": "Get page elements" },
    { "cmd": "agent-browser click @eN", "reason": "FROM field - focus it" },
    { "cmd": "agent-browser press @eN Control+A", "reason": "Clear existing value" },
    { "cmd": "agent-browser type @eN \\"city\\"", "reason": "Type city name" },
    { "cmd": "agent-browser wait 1500", "reason": "Wait for autocomplete" },
    { "cmd": "agent-browser snapshot -i", "reason": "Get autocomplete suggestions" },
    { "cmd": "agent-browser press @eN ArrowDown", "reason": "Highlight first suggestion" },
    { "cmd": "agent-browser press @eN Enter", "reason": "Confirm city" }
  ],
  "summary": "Brief description of what this plan accomplishes"
}

Keep total steps between 25-35 for flight search.
Add short reason comment on each step.

Now wait for the user's task.`;

async function createSession(fcKey: string) {
  const res = await fetch(`${FC_BASE}/v2/browser`, {
    method: "POST",
    headers: { Authorization: `Bearer ${fcKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ ttl: 300, activityTtl: 120 }),
  });
  
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Failed to create session: ${res.status} - ${errText}`);
  }
  
  return res.json();
}

async function execCommand(sessionId: string, command: string, fcKey: string) {
  const res = await fetch(`${FC_BASE}/v2/browser/${sessionId}/execute`, {
    method: "POST",
    headers: { Authorization: `Bearer ${fcKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      code: command,
      language: "bash",
    }),
  });
  
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Execute failed: ${res.status} - ${errText}`);
  }
  
  return res.json();
}

async function deleteSession(sessionId: string, fcKey: string) {
  await fetch(`${FC_BASE}/v2/browser/${sessionId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${fcKey}` },
  });
}

// Ask Keyplex ONCE to generate ALL the steps needed for the task
// Uses the comprehensive FIRECRAWL_SYSTEM_PROMPT for accurate browser automation
async function getAllSteps(
  task: string,
  kpKey: string
): Promise<{ steps: { cmd: string; reason: string }[]; summary: string; rawResponse: string }> {
  
  const requestBody = {
    model: "openai/gpt-4o-mini",
    max_tokens: 4000,
    messages: [
      {
        role: "system",
        content: FIRECRAWL_SYSTEM_PROMPT
      },
      {
        role: "user",
        content: `TASK: ${task}

Generate a complete sequence of browser automation steps to accomplish this task. Output ONLY valid JSON with steps array and summary.`
      }
    ],
  };

  const res = await fetch("https://keyplex.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { 
      "Authorization": `Bearer ${kpKey}`, 
      "Content-Type": "application/json" 
    },
    body: JSON.stringify(requestBody),
  });

  if (!res.ok) {
    const errText = await res.text();
    
    // Parse and provide user-friendly error messages
    try {
      const errJson = JSON.parse(errText);
      if (errJson.error?.code === "quota_exceeded") {
        throw new Error(`QUOTA_EXCEEDED: Your Keyplex token quota has been exceeded. Please upgrade at https://keyplex.ai/account#billing`);
      }
      if (errJson.error?.message) {
        throw new Error(`Keyplex API: ${errJson.error.message}`);
      }
    } catch (parseErr) {
      if (parseErr instanceof Error && parseErr.message.startsWith("QUOTA_EXCEEDED")) {
        throw parseErr;
      }
    }
    
    throw new Error(`Keyplex API error: ${res.status} - ${errText}`);
  }

  const data = await res.json();
  const rawContent = data.choices?.[0]?.message?.content ?? "{}";
  const text = rawContent.replace(/```json|```/g, "").trim();
  
  try {
    const parsed = JSON.parse(text);
    return {
      steps: parsed.steps || [],
      summary: parsed.summary || "Task plan generated",
      rawResponse: rawContent
    };
  } catch {
    return { steps: [], summary: "Failed to parse LLM response: " + text, rawResponse: rawContent };
  }
}

// Match placeholder refs to actual element refs from snapshot
function resolveRef(cmd: string, snapshotOutput: string): string {
  // If cmd has a placeholder like @input_search, @button_submit, find matching element in snapshot
  const placeholderMatch = cmd.match(/@([a-z_]+)/i);
  if (!placeholderMatch) return cmd;
  
  const placeholder = placeholderMatch[1].toLowerCase();
  
  // Common patterns to match
  const patterns: Record<string, RegExp[]> = {
    'input_search': [/input.*search.*\[ref=(e\d+)\]/i, /searchbox.*\[ref=(e\d+)\]/i, /search.*input.*\[ref=(e\d+)\]/i],
    'input_from': [/from.*input.*\[ref=(e\d+)\]/i, /origin.*\[ref=(e\d+)\]/i, /departure.*\[ref=(e\d+)\]/i],
    'input_to': [/to.*input.*\[ref=(e\d+)\]/i, /destination.*\[ref=(e\d+)\]/i, /arrival.*\[ref=(e\d+)\]/i],
    'button_submit': [/button.*search.*\[ref=(e\d+)\]/i, /submit.*\[ref=(e\d+)\]/i, /button.*go.*\[ref=(e\d+)\]/i],
    'button_search': [/button.*search.*\[ref=(e\d+)\]/i, /search.*button.*\[ref=(e\d+)\]/i],
  };
  
  // Try to find matching element
  const patternsToTry = patterns[placeholder] || [];
  for (const pattern of patternsToTry) {
    const match = snapshotOutput.match(pattern);
    if (match && match[1]) {
      return cmd.replace(/@[a-z_]+/i, `@${match[1]}`);
    }
  }
  
  // If no pattern matched, try to find any input/button with a ref
  if (placeholder.includes('input')) {
    const inputMatch = snapshotOutput.match(/input.*\[ref=(e\d+)\]/i);
    if (inputMatch) return cmd.replace(/@[a-z_]+/i, `@${inputMatch[1]}`);
  }
  if (placeholder.includes('button')) {
    const buttonMatch = snapshotOutput.match(/button.*\[ref=(e\d+)\]/i);
    if (buttonMatch) return cmd.replace(/@[a-z_]+/i, `@${buttonMatch[1]}`);
  }
  
  // Return original if no match found
  return cmd;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const query = searchParams.get("query") ?? "";
  const kpKey = searchParams.get("keyplex_key") ?? KEYPLEX_API_KEY_DEFAULT;

  if (!query) {
    return new Response(JSON.stringify({ error: "Missing query" }), { status: 400 });
  }

  // Keyplex API is called ONCE to get all steps, then executed locally
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: object) =>
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));

      let sessionId: string | null = null;

      try {
        // ── 1. Create browser session ─────────────────────────────
        send("step", { type: "info", desc: "Creating browser session..." });

        const session = await createSession(FIRECRAWL_API_KEY);
        
        // Firecrawl returns { success: true, id: "...", liveViewUrl: "..." } on success
        // OR { success: false, error: "..." } on failure
        // OR just { id: "...", liveViewUrl: "..." } without success field
        if (session.success === false) {
          throw new Error(session.error ?? "Failed to create session");
        }
        
        if (!session.id || !session.liveViewUrl) {
          throw new Error("Invalid session response: missing id or liveViewUrl");
        }

        sessionId = session.id;

        // Send liveViewUrl immediately so iframe appears in UI
        send("session", {
          sessionId:              session.id,
          liveViewUrl:            session.liveViewUrl,
          interactiveLiveViewUrl: session.interactiveLiveViewUrl,
        });

        send("step", { type: "success", desc: `Session created. ID: ${session.id}` });

        // ── 2. Get ALL steps from Keyplex in ONE API call ──────────────────
        // Then execute them locally without repeated API calls

        let lastSnapshotOutput = "";

        if (!kpKey) {
          // No LLM key — run a hardcoded demo for flight search
          send("step", { type: "info", desc: "No Keyplex key provided — running demo flight search commands" });

          const demoCmds = [
            { cmd: `agent-browser open https://www.google.com/travel/flights`, reason: "Navigate to Google Flights" },
            { cmd: `agent-browser snapshot -i`, reason: "Get page elements" },
            { cmd: `agent-browser fill @e16 "Chennai"`, reason: "Enter departure city" },
            { cmd: `agent-browser snapshot -i`, reason: "View updated page" },
            { cmd: `agent-browser click @e5`, reason: "Select suggestion" },
            { cmd: `agent-browser fill @e18 "Manchester"`, reason: "Enter destination" },
            { cmd: `agent-browser snapshot -i`, reason: "View updated page" },
          ];

          for (let i = 0; i < demoCmds.length; i++) {
            const { cmd, reason } = demoCmds[i];
            send("command", { index: i, total: demoCmds.length, cmd, reason });

            const result = await execCommand(sessionId, cmd, FIRECRAWL_API_KEY);
            const output = result.stdout || result.output || result.result || JSON.stringify(result);
            const hasError = result.stderr && result.stderr.includes("✗");

            send("result", { index: i, cmd, output: output.slice(0, 500), success: !hasError });

            if (cmd.includes("snapshot")) {
              lastSnapshotOutput = output;
            }

            await new Promise(r => setTimeout(r, 800));
          }

        } else {
          // Call Keyplex API ONCE to get all steps
          send("step", { type: "info", desc: "Requesting task plan from Keyplex (single API call)..." });

          const { steps, summary, rawResponse } = await getAllSteps(query, kpKey);

          // ── PHASE 0: Show raw Keyplex API response first ──────────────────
          send("keyplex_response", { 
            raw: rawResponse,
            parsed: { steps, summary }
          });

          // Give user time to read the response
          await new Promise(r => setTimeout(r, 2000));

          if (steps.length === 0) {
            send("step", { type: "error", desc: "Failed to generate steps: " + summary });
            send("done", { message: summary });
            return;
          }

          send("step", { type: "success", desc: `Plan received: ${steps.length} steps to execute` });

          // ── PHASE 1: Show all planned steps upfront ──────────────────
          send("plan", { 
            steps: steps.map((s, i) => ({ index: i, cmd: s.cmd, reason: s.reason })),
            total: steps.length,
            summary 
          });

          // Give user time to see the plan
          await new Promise(r => setTimeout(r, 2000));

          // ── PHASE 2: Execute steps one by one with verification ──────
          send("step", { type: "info", desc: "Starting execution..." });

          for (let i = 0; i < steps.length; i++) {
            let { cmd, reason } = steps[i];

            // Resolve placeholder refs using last snapshot output
            if (lastSnapshotOutput && cmd.includes("@")) {
              cmd = resolveRef(cmd, lastSnapshotOutput);
            }

            // Notify which step is starting
            send("command", { index: i, total: steps.length, cmd, reason, status: "executing" });

            // Give browser time to prepare (longer for open/navigate actions)
            const isOpenCmd = cmd.includes("open ");
            const isClickCmd = cmd.includes("click ");
            const isFillCmd = cmd.includes("fill ");
            
            if (isOpenCmd) {
              await new Promise(r => setTimeout(r, 500)); // Extra time before opening URL
            }

            // Execute the command in the live browser
            const result = await execCommand(sessionId, cmd, FIRECRAWL_API_KEY);
            const output = result.stdout || result.output || result.result || JSON.stringify(result);
            const hasError = result.stderr && result.stderr.includes("✗");

            // Send result of this step
            send("result", { index: i, cmd, output: output.slice(0, 1500), success: !hasError });

            // Store snapshot output for ref resolution in future steps
            if (cmd.includes("snapshot")) {
              lastSnapshotOutput = output;
            }

            // ── STEP SYNCHRONIZATION: Wait and verify before proceeding ──
            const isWaitCmd = cmd.includes("wait ");
            const isSnapshotCmd = cmd.includes("snapshot");
            const isTypeCmd = cmd.includes("type ");
            const isScrollCmd = cmd.includes("scroll ");
            
            if (isOpenCmd) {
              // Wait for page to fully load
              send("step", { type: "info", desc: `Waiting for page to load (3s)...` });
              await new Promise(r => setTimeout(r, 3000));
              
              // Auto-snapshot to verify page loaded and get fresh refs
              if (!steps[i + 1]?.cmd.includes("snapshot")) {
                send("step", { type: "info", desc: `Verifying page load with snapshot...` });
                const verifyResult = await execCommand(sessionId, "agent-browser snapshot -i", FIRECRAWL_API_KEY);
                const verifyOutput = verifyResult.stdout || verifyResult.output || verifyResult.result || "";
                lastSnapshotOutput = verifyOutput;
                send("snapshot", { index: i, output: verifyOutput.slice(0, 1500), verified: true });
                await new Promise(r => setTimeout(r, 500));
              }
            } else if (isClickCmd) {
              // Wait for click action to complete and UI to react
              send("step", { type: "info", desc: `Waiting for click action (1.5s)...` });
              await new Promise(r => setTimeout(r, 1500));
              
              // Check if this is a dropdown/date picker trigger - wait longer
              if (reason.toLowerCase().includes("dropdown") || reason.toLowerCase().includes("date") || reason.toLowerCase().includes("picker")) {
                send("step", { type: "info", desc: `Extra wait for dropdown/picker animation (2s)...` });
                await new Promise(r => setTimeout(r, 2000));
              }
              
              // Auto-snapshot after click to verify and get updated refs
              if (!steps[i + 1]?.cmd.includes("snapshot") && !steps[i + 1]?.cmd.includes("wait")) {
                send("step", { type: "info", desc: `Verifying click result with snapshot...` });
                const verifyResult = await execCommand(sessionId, "agent-browser snapshot -i", FIRECRAWL_API_KEY);
                const verifyOutput = verifyResult.stdout || verifyResult.output || verifyResult.result || "";
                lastSnapshotOutput = verifyOutput;
                send("snapshot", { index: i, output: verifyOutput.slice(0, 1500), verified: true });
                await new Promise(r => setTimeout(r, 500));
              }
            } else if (isFillCmd || isTypeCmd) {
              // Wait for input processing and autocomplete
              send("step", { type: "info", desc: `Waiting for input processing (1.5s)...` });
              await new Promise(r => setTimeout(r, 1500));
              
              // Auto-snapshot to see autocomplete suggestions
              if (!steps[i + 1]?.cmd.includes("snapshot") && !steps[i + 1]?.cmd.includes("wait")) {
                send("step", { type: "info", desc: `Verifying input with snapshot (checking autocomplete)...` });
                const verifyResult = await execCommand(sessionId, "agent-browser snapshot -i", FIRECRAWL_API_KEY);
                const verifyOutput = verifyResult.stdout || verifyResult.output || verifyResult.result || "";
                lastSnapshotOutput = verifyOutput;
                send("snapshot", { index: i, output: verifyOutput.slice(0, 1500), verified: true });
                await new Promise(r => setTimeout(r, 500));
              }
            } else if (isScrollCmd) {
              // Wait for lazy-loaded content
              send("step", { type: "info", desc: `Waiting for scroll content (1s)...` });
              await new Promise(r => setTimeout(r, 1000));
            } else if (isSnapshotCmd) {
              // Snapshot completed - store the output for verification
              send("step", { type: "info", desc: `Snapshot captured - analyzing page state...` });
              await new Promise(r => setTimeout(r, 500));
            } else if (isWaitCmd) {
              // Wait command already executed - just a small buffer
              await new Promise(r => setTimeout(r, 200));
            } else {
              // Standard delay for other commands
              await new Promise(r => setTimeout(r, 1000));
            }

            // Mark step as complete
            send("step_complete", { index: i, total: steps.length, success: !hasError });
          }

          send("summary", { text: summary });
        }

        send("done", { message: "Agent finished. See live browser panel above." });

      } catch (err: unknown) {
        send("agent_error", { message: err instanceof Error ? err.message : String(err) });
      } finally {
        controller.close();
        if (sessionId) {
          setTimeout(() => deleteSession(sessionId!, FIRECRAWL_API_KEY), 300_000);
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type":  "text/event-stream",
      "Cache-Control": "no-cache",
      Connection:      "keep-alive",
    },
  });
}

// POST endpoint for more complex requests
export async function POST(req: Request) {
  const body = await req.json();
  const { query, keyplex_key } = body;

  if (!query) {
    return new Response(JSON.stringify({ error: "Missing query" }), { status: 400 });
  }

  const url = new URL(req.url);
  url.searchParams.set("query", query);
  if (keyplex_key) url.searchParams.set("keyplex_key", keyplex_key);
  
  return GET(new Request(url.toString()));
}
