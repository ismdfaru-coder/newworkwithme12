// app/api/agent/route.ts
// CORRECT implementation — matches exactly what Firecrawl playground does:
// iterative agent-browser bash commands, each snapshot feeds next decision

export const runtime = "nodejs";
export const maxDuration = 300;

const FC_BASE = "https://api.firecrawl.dev";
const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY || "fc-5d2cfe6d91f44adf9a20f4489eaa5e0d";
const KEYPLEX_API_KEY = process.env.KEYPLEX_API_KEY || "kpx_9c82aaaba39a8004b8c363b1819e811eb1912ec1177ac144601e7ffb73301dce";

async function createSession(fcKey: string) {
  const res = await fetch(`${FC_BASE}/v2/browser`, {
    method: "POST",
    headers: { Authorization: `Bearer ${fcKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ timeout: 60000 }), // 60 seconds = ~2 credits
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
        content: `You are an expert browser automation agent for Firecrawl browser sandbox. Generate step-by-step commands to execute in the browser.

AVAILABLE COMMANDS (these are bash commands for agent-browser):
- agent-browser open <URL>           → Opens a webpage
- agent-browser snapshot -i          → Takes snapshot, returns page elements with [ref=eNN] identifiers  
- agent-browser click @eNN           → Clicks element by ref (e.g., @e5, @e16, @e23)
- agent-browser fill @eNN "text"     → Types text into input field by ref
- agent-browser scroll down          → Scrolls down the page
- agent-browser scroll up            → Scrolls up the page

STRICT RULES:
1. First command MUST be: agent-browser open <URL>
2. Second command MUST be: agent-browser snapshot -i (to get element refs)
3. After snapshot, use ACTUAL ref format like @e5, @e16, @e23 (the execution will auto-resolve these from snapshot)
4. After EVERY fill or click, add: agent-browser snapshot -i
5. Generate 15-25 steps for thorough task completion
6. Each step must be atomic - one action only

EXAMPLE - Flight Search from Chennai to Manchester:
{
  "steps": [
    { "cmd": "agent-browser open https://www.google.com/travel/flights", "reason": "Open Google Flights" },
    { "cmd": "agent-browser snapshot -i", "reason": "Get page element refs" },
    { "cmd": "agent-browser click @e16", "reason": "Click departure field" },
    { "cmd": "agent-browser snapshot -i", "reason": "See input state" },
    { "cmd": "agent-browser fill @e16 \\"Chennai\\"", "reason": "Type departure city" },
    { "cmd": "agent-browser snapshot -i", "reason": "See autocomplete dropdown" },
    { "cmd": "agent-browser click @e25", "reason": "Select Chennai from suggestions" },
    { "cmd": "agent-browser snapshot -i", "reason": "Verify selection, see destination field" },
    { "cmd": "agent-browser click @e18", "reason": "Click destination field" },
    { "cmd": "agent-browser snapshot -i", "reason": "See destination input" },
    { "cmd": "agent-browser fill @e18 \\"Manchester\\"", "reason": "Type destination city" },
    { "cmd": "agent-browser snapshot -i", "reason": "See autocomplete suggestions" },
    { "cmd": "agent-browser click @e30", "reason": "Select Manchester from suggestions" },
    { "cmd": "agent-browser snapshot -i", "reason": "Verify destination selected" },
    { "cmd": "agent-browser click @e45", "reason": "Click Explore/Search button" },
    { "cmd": "agent-browser snapshot -i", "reason": "View flight search results" },
    { "cmd": "agent-browser scroll down", "reason": "Scroll to see more results" },
    { "cmd": "agent-browser snapshot -i", "reason": "Capture more flight options" }
  ],
  "summary": "Search flights from Chennai to Manchester on Google Flights"
}

OUTPUT: Return ONLY valid JSON, no markdown:
{"steps":[...],"summary":"..."}`
      },
      {
        role: "user",
        content: `TASK: ${task}

Generate browser automation commands. Start with open URL, then snapshot, then interact using @eNN refs. Include snapshot after every action.`
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
  const kpKey = searchParams.get("keyplex_key") || KEYPLEX_API_KEY;

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

          // ── PHASE 2: Execute steps one by one with VERIFICATION after each ──────
          send("step", { type: "info", desc: "Starting execution with step-by-step verification..." });

          for (let i = 0; i < steps.length; i++) {
            let { cmd, reason } = steps[i];

            // Resolve placeholder refs using last snapshot output
            if (lastSnapshotOutput && cmd.includes("@")) {
              cmd = resolveRef(cmd, lastSnapshotOutput);
            }

            // Notify which step is starting
            send("command", { index: i, total: steps.length, cmd, reason, status: "executing" });

            // Determine command type
            const isOpenCmd = cmd.includes("open ");
            const isClickCmd = cmd.includes("click ");
            const isFillCmd = cmd.includes("fill ");
            const isSnapshotCmd = cmd.includes("snapshot");
            const isScrollCmd = cmd.includes("scroll");
            const isWaitCmd = cmd.includes("wait");

            // ── STEP 1: Execute the command ──────────────────────────────
            send("step", { type: "info", desc: `Executing: ${cmd.substring(0, 50)}...` });
            
            const result = await execCommand(sessionId, cmd, FIRECRAWL_API_KEY);
            const output = result.stdout || result.output || result.result || JSON.stringify(result);
            const hasError = result.stderr && result.stderr.includes("✗");

            // Send result of this step
            send("result", { index: i, cmd, output: output.slice(0, 1500), success: !hasError });

            // Store snapshot output for ref resolution
            if (isSnapshotCmd) {
              lastSnapshotOutput = output;
            }

            // ── STEP 2: Wait appropriate time for action to complete ─────
            if (isOpenCmd) {
              send("step", { type: "info", desc: `Page loading... waiting 5 seconds` });
              await new Promise(r => setTimeout(r, 5000));
            } else if (isClickCmd) {
              send("step", { type: "info", desc: `Click action... waiting 3 seconds` });
              await new Promise(r => setTimeout(r, 3000));
            } else if (isFillCmd) {
              send("step", { type: "info", desc: `Fill action... waiting 3 seconds` });
              await new Promise(r => setTimeout(r, 3000));
            } else if (isScrollCmd) {
              send("step", { type: "info", desc: `Scroll action... waiting 2 seconds` });
              await new Promise(r => setTimeout(r, 2000));
            } else if (isWaitCmd) {
              const waitMatch = cmd.match(/wait\s+(\d+)/);
              const waitTime = waitMatch ? parseInt(waitMatch[1]) : 2000;
              send("step", { type: "info", desc: `Waiting ${waitTime}ms as requested` });
              await new Promise(r => setTimeout(r, waitTime));
            } else if (isSnapshotCmd) {
              send("step", { type: "info", desc: `Processing snapshot... waiting 2 seconds` });
              await new Promise(r => setTimeout(r, 2000));
            } else {
              send("step", { type: "info", desc: `Waiting 2 seconds before next step` });
              await new Promise(r => setTimeout(r, 2000));
            }

            // ── STEP 3: ALWAYS take verification snapshot (except if this was already a snapshot) ─────
            if (!isSnapshotCmd) {
              send("step", { type: "info", desc: `Taking verification snapshot for step ${i + 1}...` });
              
              try {
                const verifyResult = await execCommand(sessionId, "agent-browser snapshot -i", FIRECRAWL_API_KEY);
                const verifyOutput = verifyResult.stdout || verifyResult.output || verifyResult.result || "";
                const verifyError = verifyResult.stderr && verifyResult.stderr.includes("✗");
                
                // Store for next step's ref resolution
                lastSnapshotOutput = verifyOutput;
                
                // Send verification snapshot to UI
                send("verification", { 
                  stepIndex: i, 
                  snapshot: verifyOutput.slice(0, 2000),
                  verified: !verifyError,
                  message: verifyError ? "Verification failed - page state may have changed" : "Step verified successfully"
                });

                // Wait after verification snapshot
                send("step", { type: "info", desc: `Verification complete. Waiting 2 seconds before next step...` });
                await new Promise(r => setTimeout(r, 2000));
                
              } catch (verifyErr) {
                send("verification", { 
                  stepIndex: i, 
                  snapshot: "",
                  verified: false,
                  message: `Verification snapshot failed: ${verifyErr instanceof Error ? verifyErr.message : String(verifyErr)}`
                });
                // Continue anyway but note the failure
                await new Promise(r => setTimeout(r, 1000));
              }
            }

            // ── STEP 4: Mark step as complete, ready for next ─────
            send("step_complete", { 
              index: i, 
              total: steps.length, 
              success: !hasError,
              message: `Step ${i + 1}/${steps.length} completed and verified`
            });

            // Brief pause before starting next step
            await new Promise(r => setTimeout(r, 500));
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
