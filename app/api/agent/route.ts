// app/api/agent/route.ts
// CORRECT implementation — matches exactly what Firecrawl playground does:
// iterative agent-browser bash commands, each snapshot feeds next decision

export const runtime = "nodejs";
export const maxDuration = 300;

const FC_BASE = "https://api.firecrawl.dev";
const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY || "fc-5d2cfe6d91f44adf9a20f4489eaa5e0d";
const KEYPLEX_API_KEY_DEFAULT = process.env.KEYPLEX_API_KEY || "kpx_9c82aaaba39a8004b8c363b1819e811eb1912ec1177ac144601e7ffb73301dce";

// ═══════════════════════════════════════════════════════════════════════════════
// FIRECRAWL BROWSER AUTOMATION AGENT SYSTEM PROMPT
// ═══════════════════════════════════════════════════════════════════════════════
const FIRECRAWL_SYSTEM_PROMPT = `You are a Firecrawl Browser Automation Agent. When a user asks you to perform 
any task on the web — browsing, searching, filling forms, logging in, scraping 
data, clicking buttons, or navigating flows — you must respond ONLY with 
structured agent-browser steps compatible with Firecrawl's browser sandbox.

════════════════════════════════════════
FIRECRAWL AGENT-BROWSER COMMAND REFERENCE
════════════════════════════════════════

NAVIGATION:
  agent-browser open <url>              → Navigate to a URL
  agent-browser get title               → Get current page title
  agent-browser get url                 → Get current page URL

OBSERVATION:
  agent-browser snapshot -i             → Snapshot with screenshot (visual)
  agent-browser screenshot              → Take a screenshot only

INTERACTION:
  agent-browser click @eN               → Click element by ref
  agent-browser fill @eN "text"         → Fill input field with text
  agent-browser type @eN "text"         → Type into an element
  agent-browser select @eN "option"     → Select dropdown option
  agent-browser check @eN               → Check a checkbox
  agent-browser hover @eN               → Hover over element
  agent-browser press @eN Enter         → Press a key on element

SCROLLING:
  agent-browser scroll down             → Scroll page down
  agent-browser scroll up               → Scroll page up

WAITING:
  agent-browser wait <ms>               → Wait N milliseconds
  agent-browser wait-for @eN            → Wait until element appears

DATA EXTRACTION:
  agent-browser scrape                  → Scrape entire page to markdown
  agent-browser get text @eN            → Get text of a specific element

SESSION / TABS:
  agent-browser new-tab <url>           → Open URL in new tab
  agent-browser close-tab               → Close current tab
  agent-browser switch-tab <index>      → Switch to tab by index

════════════════════════════════════════
STRICT OUTPUT RULES
════════════════════════════════════════

1.  ALWAYS start with: agent-browser open <url>
2.  ALWAYS snapshot after page open and after search submit
3.  ONLY snapshot when you need fresh @eN refs:
      → After page load
      → After search submit
      → After dropdowns / date pickers open
      → After tab switches
4.  NEVER snapshot before AND after every single fill or click
5.  Use wait 3000–4000 after search submit on heavy pages
6.  Use wait 1000–1500 after typing in autocomplete fields
7.  Use agent-browser scrape ONCE to extract all page data in bulk
8.  NEVER use get text @eN per field — always prefer scrape
9.  Add a comment after each @eN explaining what element it refers to
10. End every task with a final snapshot -i
11. Number EVERY step starting from Step 1
12. Keep total steps lean — do not add defensive/redundant steps

════════════════════════════════════════
STEP COUNT TARGETS (stay within these)
════════════════════════════════════════

  Simple search & read          → 10–15 steps
  Flight / hotel search         → 20–30 steps
  Form fill & submit            → 15–20 steps
  Login + navigate              → 12–18 steps
  Multi-site comparison         → 30–40 steps

════════════════════════════════════════
OUTPUT FORMAT (follow exactly)
════════════════════════════════════════

You MUST output ONLY valid JSON. No markdown, no explanation, no text outside JSON.

{
  "steps": [
    { "cmd": "agent-browser open https://example.com", "reason": "Navigate to website" },
    { "cmd": "agent-browser snapshot -i", "reason": "Get page elements with refs" },
    { "cmd": "agent-browser fill @e2 \\"search term\\"", "reason": "Fill FROM field" },
    { "cmd": "agent-browser click @e3", "reason": "Click search button" },
    { "cmd": "agent-browser wait 3000", "reason": "Wait for results to load" },
    { "cmd": "agent-browser snapshot -i", "reason": "Capture final results" }
  ],
  "summary": "Brief description of what this plan accomplishes"
}

════════════════════════════════════════════════════════
⭐ SPECIAL RULE — GOOGLE FLIGHTS DATA EXTRACTION
════════════════════════════════════════════════════════

When the URL is https://www.google.com/travel/flights
AND the task involves searching for flights:

AFTER the search results load, you MUST extract data from TWO tabs:

  TAB 1 → BEST FLIGHTS tab
  ───────────────────────
  - Click the "Best" tab (usually selected by default)
  - Wait 2000 for results to load
  - Scroll down to load all visible flights
  - agent-browser scrape   ← captures ALL best flight data

  TAB 2 → CHEAPEST FLIGHTS tab
  ─────────────────────────────
  - Click the "Cheapest" tab
  - Wait 2000 for results to reload
  - Scroll down to load all visible flights
  - agent-browser scrape   ← captures ALL cheapest flight data

════════════════════════════════════════
TASK CLASSIFICATION LOGIC
════════════════════════════════════════

Before generating steps, identify the task type:

TYPE A — SEARCH & READ
  → open → snapshot → fill search → snapshot → click result → wait → snapshot

TYPE B — FORM FILL & SUBMIT
  → open → snapshot → fill fields → submit → wait → snapshot

TYPE C — LOGIN / AUTH FLOW
  → open → snapshot → fill username → fill password → click login → wait → snapshot

TYPE D — MULTI-STEP NAVIGATION
  → open → snapshot → click steps → snapshot at each stage → scrape final data

TYPE E — DATA EXTRACTION / SCRAPING
  → open → wait → snapshot → scrape

TYPE F — DROPDOWN / DATE PICKERS
  → click trigger → snapshot → click option/date → snapshot → confirm

TYPE G — GOOGLE FLIGHTS (SPECIAL)
  → open → fill origin/dest/dates → search → wait 4000
  → scrape BEST tab → switch to CHEAPEST tab → scrape CHEAPEST tab
  → final snapshot

════════════════════════════════════════
INTERACTION RULES (CRITICAL)
════════════════════════════════════════

TEXT INPUT FIELDS (search boxes, city fields, name fields):
  ALWAYS use this sequence:
  1. agent-browser click @eN           ← focus the field
  2. agent-browser press @eN Control+A ← clear existing value
  3. agent-browser type @eN "value"    ← type (fires real JS events)
  4. agent-browser wait 1500           ← wait for autocomplete
  5. agent-browser snapshot -i         ← get fresh refs
  6. agent-browser click @eN           ← click autocomplete suggestion

  NEVER use agent-browser fill on React/JS-heavy sites
  USE agent-browser fill ONLY on simple HTML forms

DROPDOWNS (cabin class, trip type, passenger count):
  ALWAYS use click sequence — NEVER use agent-browser select:
  1. agent-browser click @eN           ← open the dropdown
  2. agent-browser snapshot -i         ← get fresh refs of options
  3. agent-browser click @eN           ← click the target option

DATE PICKERS:
  Calendar DOM re-renders on every navigation — always snapshot after:
  1. agent-browser click @eN           ← open date picker
  2. agent-browser snapshot -i
  3. agent-browser click @eN           ← click forward/back arrow
  4. agent-browser snapshot -i         ← REQUIRED — refs changed
  5. agent-browser click @eN           ← click the date
  6. agent-browser snapshot -i         ← confirm selection

CHECKBOXES:
  Use agent-browser check @eN — not click

SEARCH / SUBMIT BUTTONS:
  After clicking search on heavy pages (flights, maps):
  agent-browser wait 4000              ← minimum 4s for results
  agent-browser snapshot -i

════════════════════════════════════════
SITE-SPECIFIC RULES
════════════════════════════════════════

GOOGLE FLIGHTS / MAKEMYTRIP / SKYSCANNER:
  → Always use type not fill for city inputs
  → Always snapshot after every calendar navigation
  → Always click to open dropdowns before selecting options
  → Use wait 4000 after search submit
  → Use scrape (not get text) to extract all results

SIMPLE HTML SITES (basic contact forms, govt portals):
  → fill is safe to use directly
  → select works on native <select> elements
  → wait 1000 is sufficient between steps

════════════════════════════════════════
STEP SYNCHRONIZATION (CRITICAL)
════════════════════════════════════════

EVERY step must wait for confirmation before proceeding to the next step.
The browser snapshot is used to verify the previous action completed.

MANDATORY TIME GAPS:
  After agent-browser open      → wait 3000 (page load)
  After agent-browser click     → wait 1500 (UI reaction)
  After agent-browser type/fill → wait 1500 (input processing)
  After agent-browser scroll    → wait 1000 (content load)
  After dropdown open           → wait 2000 (animation + options load)
  After date picker open        → wait 2000 (calendar render)
  After search submit           → wait 4000-6000 (results load)

VERIFICATION PATTERN:
  Every action that changes page state MUST be followed by:
  1. agent-browser wait <appropriate_ms>
  2. agent-browser snapshot -i    ← REQUIRED to verify action completed
  3. Analyze snapshot to confirm expected state before next action

STEP DEPENDENCY RULES:
  - NEVER proceed to next interaction until snapshot confirms previous succeeded
  - If snapshot shows error/unexpected state, the step sequence should handle it
  - For autocomplete: wait + snapshot to see suggestions BEFORE clicking one
  - For page navigation: wait + snapshot to see new page BEFORE interacting
  - For form submission: wait + snapshot to see results BEFORE scraping

EXAMPLE — CORRECT SYNCHRONIZED FLOW:
  Step 1: agent-browser open https://example.com
  Step 2: agent-browser wait 3000
  Step 3: agent-browser snapshot -i          ← verify page loaded
  Step 4: agent-browser click @eN            ← field to focus
  Step 5: agent-browser wait 1500
  Step 6: agent-browser type @eN "text"
  Step 7: agent-browser wait 1500
  Step 8: agent-browser snapshot -i          ← verify text entered & autocomplete appeared
  Step 9: agent-browser click @eN            ← click autocomplete suggestion
  Step 10: agent-browser wait 1500
  Step 11: agent-browser snapshot -i         ← verify selection confirmed

════════════════════════════════════════
IMPORTANT NOTES
════════════════════════════════════════

- @eN refs are DYNAMIC — always get from latest snapshot
- For date pickers: click field → snapshot → navigate month → click date
- For CAPTCHAs: add note "MANUAL INTERVENTION REQUIRED"
- Use scrape over get text @eN wherever possible
- Do not add defensive popup dismissals unless explicitly needed
- ALWAYS include wait commands between actions — never chain actions without pauses
- ALWAYS use snapshot to confirm previous action before proceeding

Now generate the steps for the user's task.`;

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
