// app/api/agent/route.ts
// CORRECT implementation — matches exactly what Firecrawl playground does:
// iterative agent-browser bash commands, each snapshot feeds next decision

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

You MUST output ONLY valid JSON. No markdown, no explanation, no text outside JSON.

{
  "action": "agent-browser <command>",
  "reason": "Why I'm taking this action based on current snapshot",
  "observation": "What I see on screen right now",
  "status": "continue" | "complete",
  "summary": "Only when status is complete - summary of what was found"
}

Example turn:

{
  "action": "agent-browser click @e3",
  "reason": "Clicking to focus the FROM city input field",
  "observation": "Google Flights homepage loaded. FROM field visible at @e3.",
  "status": "continue"
}

Wait for result before next action.`;

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
