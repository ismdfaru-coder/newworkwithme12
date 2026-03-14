// app/api/agent/route.ts
// AGENTIC LOOP implementation — LLM called each step with current snapshot

export const runtime = "nodejs";
export const maxDuration = 300;

const FC_BASE = "https://api.firecrawl.dev";
const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY || "fc-5d2cfe6d91f44adf9a20f4489eaa5e0d";
const KEYPLEX_API_KEY_DEFAULT = process.env.KEYPLEX_API_KEY || "kpx_f72cdf30d9cec9f7b8e354ec174710fd79ac6c9ae4938a056dfef78b10903fdf";

// ═══════════════════════════════════════════════════════════════════════════════
// FIRECRAWL BROWSER AUTOMATION AGENT SYSTEM PROMPT (AGENTIC LOOP)
// ═══════════════════════════════════════════════════════════════════════════════
const FIRECRAWL_SYSTEM_PROMPT = `You are a Firecrawl Browser Automation Agent operating in an AGENTIC LOOP.

You do NOT pre-generate all steps upfront.
You take ONE action, see the result, then decide the NEXT action.

════════════════════════════════════════
HOW YOU WORK (AGENTIC LOOP)
════════════════════════════════════════

Each turn you receive:
  → The user's original task
  → The current page snapshot (what the browser sees RIGHT NOW)
  → The result of your last action

You must respond with ONLY ONE next agent-browser command.
Then wait for the result before deciding the next action.

LOOP STRUCTURE:
  1. Read snapshot → understand current page state
  2. Decide ONE best next action
  3. Execute it
  4. Receive result + new snapshot
  5. Repeat until task is complete
  6. Output: TASK COMPLETE + summary of what was found

════════════════════════════════════════
AVAILABLE COMMANDS
════════════════════════════════════════

  agent-browser open <url>
  agent-browser snapshot -i
  agent-browser click @eN
  agent-browser type @eN "text"
  agent-browser press @eN Control+A
  agent-browser press @eN ArrowDown
  agent-browser press @eN Enter
  agent-browser wait <ms>
  agent-browser scroll down
  agent-browser scroll up
  agent-browser scrape
  agent-browser get url

════════════════════════════════════════
DECISION RULES — READ EVERY TURN
════════════════════════════════════════

RULE 1 — ALWAYS READ SNAPSHOT BEFORE ACTING
  Every @eN ref comes from the CURRENT snapshot only.
  Never reuse @eN from a previous turn — they change after every action.
  If you are unsure what is on screen → emit: agent-browser snapshot -i

RULE 2 — TEXT INPUT (React/JS sites)
  When you need to type into a field:
  → agent-browser click @eN          (focus)
  → agent-browser press @eN Control+A (clear)
  → agent-browser type @eN "value"   (type)
  → agent-browser wait 1500          (wait for autocomplete)
  → [next turn: snapshot shows dropdown → use ArrowDown + Enter]

  NEVER use fill on React/JS sites
  NEVER click autocomplete — always ArrowDown + Enter

RULE 3 — DROPDOWNS
  → agent-browser click @eN          (open dropdown)
  → [next turn: snapshot shows options → click the right one]

  NEVER use agent-browser select on React/JS sites

RULE 4 — DATE PICKERS
  → click to open → snapshot -i
  → click arrow to navigate month → snapshot -i  ← always snapshot after
  → click the correct date → snapshot -i

RULE 5 — URL GUARD
  After any click that could navigate:
  → Check snapshot — are we still on the correct site?
  → If drifted: agent-browser open <original-url>

RULE 6 — POPUPS / MODALS
  If snapshot shows a popup blocking the page:
  → First action must be: close/dismiss the popup
  → Then continue with original task

RULE 7 — DATA EXTRACTION
  When results are visible on screen:
  → agent-browser scrape
  This gets ALL visible data at once. Never use get text @eN per field.

════════════════════════════════════════
GOOGLE FLIGHTS SPECIAL BEHAVIOUR
════════════════════════════════════════

When task involves google.com/travel/flights:

CITY INPUT SEQUENCE (each line is one turn):
  Turn: agent-browser click @eN           ← FROM field
  Turn: agent-browser press @eN Control+A
  Turn: agent-browser type @eN "Chennai"
  Turn: agent-browser wait 1500
  Turn: agent-browser snapshot -i         ← READ dropdown
  Turn: agent-browser press @eN ArrowDown ← first airport option
  Turn: agent-browser press @eN Enter     ← confirm
  Turn: agent-browser snapshot -i         ← verify city accepted

AFTER SEARCH RESULTS LOAD — extract TWO tabs:

  BEST tab:
  → click Best tab → wait 2000 → snapshot -i → scroll down → scrape

  CHEAPEST tab:
  → click Cheapest tab → wait 2000 → snapshot -i → scroll down → scrape

  Report both results to user at end.

════════════════════════════════════════
WHEN TO STOP
════════════════════════════════════════

Stop the loop and output TASK COMPLETE when:
  → Required data has been scraped
  → Form has been submitted and confirmed
  → Final page/result is visible in snapshot

Output format when done:
  TASK COMPLETE
  ─────────────
  What was found: [summary of scraped data]
  Final URL: [where browser ended up]
  Steps taken: [count]

════════════════════════════════════════
IF STUCK
════════════════════════════════════════

If the same action fails twice:
  → Take snapshot -i to reassess
  → Try alternate approach (ArrowDown instead of click)
  → If CAPTCHA visible: output MANUAL INTERVENTION REQUIRED

════════════════════════════════════════
OUTPUT FORMAT — EVERY TURN
════════════════════════════════════════

Respond with ONLY the agent-browser command on a single line.
Then optionally add a brief reason on the next line starting with "Reason:"

Example:
agent-browser click @e3
Reason: Clicking to focus the FROM city input field

When task is complete, output:
TASK COMPLETE
What was found: [summary]
Steps taken: [count]

Wait for result before next action.`;

// ═══════════════════════════════════════════════════════════════════════════════
// FIRECRAWL API HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════════════════════
// LLM CALL — Get next action based on current snapshot
// ═══════════════════════════════════════════════════════════════════════════════

interface AgentMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

async function getNextAction(
  messages: AgentMessage[],
  kpKey: string
): Promise<string> {
  const requestBody = {
    model: "openai/gpt-4o-mini",
    max_tokens: 1000,
    messages: [
      { role: "system", content: FIRECRAWL_SYSTEM_PROMPT },
      ...messages
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
  const content = data.choices?.[0]?.message?.content ?? "";
  return content;
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPER: Extract agent-browser command from LLM response
// ═══════════════════════════════════════════════════════════════════════════════

function extractCommand(response: string): string | null {
  if (!response) return null;

  // Find line starting with agent-browser
  const lines = response.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("agent-browser")) {
      return trimmed;
    }
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPER: Extract summary from completed task
// ═══════════════════════════════════════════════════════════════════════════════

function extractSummary(messages: AgentMessage[]): string {
  // Find the last assistant message containing TASK COMPLETE
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "assistant" && messages[i].content.includes("TASK COMPLETE")) {
      return messages[i].content;
    }
  }
  return "Task completed";
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN AGENTIC LOOP
// ═══════════════════════════════════════════════════════════════════════════════

async function runAgentLoop(
  userTask: string,
  sessionId: string,
  kpKey: string,
  send: (event: string, data: object) => void
): Promise<{ success: boolean; steps: number; summary: string }> {
  const messages: AgentMessage[] = [];
  let taskComplete = false;
  let stepCount = 0;
  const MAX_STEPS = 30;

  try {
    // Step 1 — take first snapshot
    send("step", { type: "info", desc: "Taking initial snapshot..." });
    
    const firstSnapshotResult = await execCommand(sessionId, "agent-browser snapshot -i", FIRECRAWL_API_KEY);
    const firstSnapshot = firstSnapshotResult.stdout || firstSnapshotResult.output || firstSnapshotResult.result || "";

    if (!firstSnapshot) {
      send("step", { type: "error", desc: "Failed to get initial snapshot" });
      return { success: false, steps: 0, summary: "Failed to get initial snapshot" };
    }

    send("snapshot", { index: 0, output: firstSnapshot.slice(0, 2000) });

    // Seed first message with task and snapshot
    messages.push({
      role: "user",
      content: `Task: ${userTask}\n\nCurrent page snapshot:\n${firstSnapshot}`
    });

    // ── AGENTIC LOOP ─────────────────────────────────────────────────────────
    while (!taskComplete && stepCount < MAX_STEPS) {
      stepCount++;

      // ── 1. Call LLM to get next action ─────────────────────────────────────
      send("step", { type: "info", desc: `Step ${stepCount}: Asking LLM for next action...` });

      let response: string;
      try {
        response = await getNextAction(messages, kpKey);
        
        if (!response) {
          send("step", { type: "error", desc: "LLM returned no response" });
          break;
        }
      } catch (llmError) {
        send("step", { type: "error", desc: `LLM call failed: ${llmError instanceof Error ? llmError.message : String(llmError)}` });
        break;
      }

      // Add LLM response to history
      messages.push({ role: "assistant", content: response });

      // Send LLM response to UI
      send("llm_response", { step: stepCount, response: response.slice(0, 1000) });

      // ── 2. Check if task is done ───────────────────────────────────────────
      if (response.includes("TASK COMPLETE")) {
        taskComplete = true;
        send("step", { type: "success", desc: "Task completed!" });
        break;
      }

      // Check for manual intervention required
      if (response.includes("MANUAL INTERVENTION REQUIRED")) {
        send("step", { type: "warning", desc: "Manual intervention required (CAPTCHA or similar)" });
        break;
      }

      // ── 3. Extract the agent-browser command ───────────────────────────────
      const action = extractCommand(response);

      if (!action) {
        send("step", { type: "warning", desc: "No agent-browser command found, asking LLM to retry..." });
        // Ask LLM to try again
        messages.push({
          role: "user",
          content: "No valid agent-browser command found. Please respond with exactly one agent-browser command starting with 'agent-browser'."
        });
        continue;
      }

      send("command", { index: stepCount, cmd: action, status: "executing" });

      // ── 4. Execute the command ─────────────────────────────────────────────
      let result: string;
      try {
        const execResult = await execCommand(sessionId, action, FIRECRAWL_API_KEY);
        result = execResult.stdout || execResult.output || execResult.result || JSON.stringify(execResult);
      } catch (execError) {
        result = `ERROR: ${execError instanceof Error ? execError.message : String(execError)}`;
        send("step", { type: "error", desc: `Command failed: ${result}` });
      }

      send("result", { index: stepCount, cmd: action, output: result.slice(0, 1500), success: !result.startsWith("ERROR") });

      // ── 5. Wait appropriate time based on command type ─────────────────────
      if (action.includes("open ")) {
        await new Promise(r => setTimeout(r, 3000));
      } else if (action.includes("click ")) {
        await new Promise(r => setTimeout(r, 1500));
      } else if (action.includes("type ") || action.includes("fill ")) {
        await new Promise(r => setTimeout(r, 1500));
      } else if (action.includes("wait ")) {
        // Wait command - extract ms if possible
        const waitMatch = action.match(/wait\s+(\d+)/);
        if (waitMatch) {
          await new Promise(r => setTimeout(r, parseInt(waitMatch[1])));
        }
      } else {
        await new Promise(r => setTimeout(r, 1000));
      }

      // ── 6. Take fresh snapshot ─────────────────────────────────────────────
      let snapshot = "";
      try {
        const snapResult = await execCommand(sessionId, "agent-browser snapshot -i", FIRECRAWL_API_KEY);
        snapshot = snapResult.stdout || snapResult.output || snapResult.result || "";
        send("snapshot", { index: stepCount, output: snapshot.slice(0, 2000) });
      } catch (snapError) {
        snapshot = "Snapshot unavailable";
        send("step", { type: "warning", desc: "Failed to get snapshot" });
      }

      // ── 7. Feed result back to LLM ─────────────────────────────────────────
      messages.push({
        role: "user",
        content: [
          `Step ${stepCount} result: ${result.slice(0, 500) || "No result returned"}`,
          `Current snapshot:\n${snapshot.slice(0, 3000) || "No snapshot available"}`
        ].join("\n\n")
      });
    }

    if (stepCount >= MAX_STEPS && !taskComplete) {
      send("step", { type: "warning", desc: `Reached max steps (${MAX_STEPS}) without completing task` });
    }

    return {
      success: taskComplete,
      steps: stepCount,
      summary: extractSummary(messages)
    };

  } catch (fatalError) {
    send("step", { type: "error", desc: `Fatal error: ${fatalError instanceof Error ? fatalError.message : String(fatalError)}` });
    return { success: false, steps: stepCount, summary: `Fatal error: ${fatalError}` };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// GET ENDPOINT — SSE streaming
// ═══════════════════════════════════════════════════════════════════════════════

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const query = searchParams.get("query") ?? "";
  const kpKey = searchParams.get("keyplex_key") ?? KEYPLEX_API_KEY_DEFAULT;

  if (!query) {
    return new Response(JSON.stringify({ error: "Missing query" }), { status: 400 });
  }

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
        
        if (session.success === false) {
          throw new Error(session.error ?? "Failed to create session");
        }
        
        if (!session.id || !session.liveViewUrl) {
          throw new Error("Invalid session response: missing id or liveViewUrl");
        }

        sessionId = session.id;

        // Send liveViewUrl immediately so iframe appears in UI
        send("session", {
          sessionId: session.id,
          liveViewUrl: session.liveViewUrl,
          interactiveLiveViewUrl: session.interactiveLiveViewUrl,
        });

        send("step", { type: "success", desc: `Session created. ID: ${session.id}` });

        // ── 2. Run the agentic loop ──────────────────────────────
        send("step", { type: "info", desc: "Starting agentic loop..." });

        const result = await runAgentLoop(query, sessionId, kpKey, send);

        // ── 3. Send completion ───────────────────────────────────
        send("summary", { 
          success: result.success, 
          steps: result.steps, 
          text: result.summary 
        });

        send("done", { message: "Agent finished." });

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
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// POST ENDPOINT — for more complex requests
// ═══════════════════════════════════════════════════════════════════════════════

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
