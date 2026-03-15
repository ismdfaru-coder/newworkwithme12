import { NextRequest, NextResponse } from "next/server"

// Browser Use API v3 - Session-based agent API
// Documentation: https://docs.browser-use.com/cloud/api-reference
const BROWSER_USE_API_URL = "https://api.browser-use.com/api/v3"
const BROWSER_USE_API_KEY = process.env.BROWSER_USE_API_KEY || "bu_7DCoBFfKI2IaGqA8S6tHOA2fLQmk0UghmERu8RTzXyg"

interface BrowserUseSessionResponse {
  id: string
  status: "created" | "idle" | "running" | "stopped" | "timed_out" | "error"
  model: "bu-mini" | "bu-max"
  title?: string | null
  output?: unknown
  outputSchema?: Record<string, unknown> | null
  liveUrl?: string | null
  profileId?: string | null
  workspaceId?: string | null
  proxyCountryCode?: string | null
  maxCostUsd?: string | null
  totalInputTokens?: number
  totalOutputTokens?: number
  proxyUsedMb?: string
  llmCostUsd?: string
  proxyCostUsd?: string
  totalCostUsd?: string
  createdAt: string
  updatedAt: string
}

interface BrowserUseMessage {
  role: string
  content: string
  timestamp?: string
}

// Create a new browser session and optionally dispatch a task
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { action, sessionId, task, model = "bu-mini", keepAlive = false } = body

    // Create a new browser session (with or without task)
    if (action === "create" || action === "run") {
      console.log("[v0] Creating Browser Use session...", task ? `with task: ${task}` : "idle session")
      
      const requestBody: {
        task?: string
        model: string
        keepAlive: boolean
        proxyCountryCode?: string
      } = {
        model,
        keepAlive,
        proxyCountryCode: "us",
      }
      
      // If task is provided, the session will execute it immediately
      if (task) {
        requestBody.task = task
      }

      const response = await fetch(`${BROWSER_USE_API_URL}/sessions`, {
        method: "POST",
        headers: {
          "x-api-key": BROWSER_USE_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      })

      if (!response.ok) {
        const errorText = await response.text()
        console.log("[v0] Create session error:", response.status, errorText)
        return NextResponse.json(
          { error: `Browser Use API error: ${response.status} - ${errorText}` },
          { status: response.status }
        )
      }

      const data: BrowserUseSessionResponse = await response.json()
      console.log("[v0] Session created:", data.id, "status:", data.status)
      
      // Return in a format compatible with the existing frontend
      return NextResponse.json({
        success: true,
        id: data.id,
        sessionId: data.id,
        status: data.status,
        liveViewUrl: data.liveUrl || null,
        liveUrl: data.liveUrl || null,
        model: data.model,
        output: data.output,
        totalCostUsd: data.totalCostUsd,
        createdAt: data.createdAt,
      })
    }

    // Dispatch a task to an existing session
    if (action === "dispatch" && sessionId) {
      console.log("[v0] Dispatching task to session:", sessionId)
      
      if (!task) {
        return NextResponse.json(
          { error: "Task is required when dispatching to existing session" },
          { status: 422 }
        )
      }

      const response = await fetch(`${BROWSER_USE_API_URL}/sessions`, {
        method: "POST",
        headers: {
          "x-api-key": BROWSER_USE_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sessionId,
          task,
          model,
          keepAlive,
        }),
      })

      if (!response.ok) {
        const errorText = await response.text()
        console.log("[v0] Dispatch task error:", response.status, errorText)
        return NextResponse.json(
          { error: `Browser Use API error: ${response.status} - ${errorText}` },
          { status: response.status }
        )
      }

      const data: BrowserUseSessionResponse = await response.json()
      console.log("[v0] Task dispatched:", data.id, "status:", data.status)
      
      return NextResponse.json({
        success: true,
        id: data.id,
        sessionId: data.id,
        status: data.status,
        liveViewUrl: data.liveUrl || null,
        liveUrl: data.liveUrl || null,
        model: data.model,
        output: data.output,
      })
    }

    // Stop a session or task
    if (action === "stop" && sessionId) {
      console.log("[v0] Stopping session:", sessionId)
      
      const strategy = body.strategy || "session" // "session" destroys sandbox, "task" keeps it alive
      
      const response = await fetch(`${BROWSER_USE_API_URL}/sessions/${sessionId}/stop`, {
        method: "POST",
        headers: {
          "x-api-key": BROWSER_USE_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ strategy }),
      })

      if (!response.ok) {
        const errorText = await response.text()
        console.log("[v0] Stop session error:", response.status, errorText)
        return NextResponse.json(
          { error: `Browser Use API error: ${response.status} - ${errorText}` },
          { status: response.status }
        )
      }

      const data: BrowserUseSessionResponse = await response.json()
      return NextResponse.json({
        success: true,
        id: data.id,
        status: data.status,
        message: "Session stopped",
      })
    }

    // Delete a session (alias for stop with strategy=session)
    if (action === "close" && sessionId) {
      console.log("[v0] Closing session:", sessionId)
      
      const response = await fetch(`${BROWSER_USE_API_URL}/sessions/${sessionId}/stop`, {
        method: "POST",
        headers: {
          "x-api-key": BROWSER_USE_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ strategy: "session" }),
      })

      if (!response.ok) {
        // Session may already be stopped/deleted
        const errorText = await response.text()
        console.log("[v0] Close session error (may already be closed):", response.status, errorText)
      }

      return NextResponse.json({ success: true, message: "Session closed" })
    }

    return NextResponse.json(
      { error: "Invalid action. Use 'create', 'run', 'dispatch', 'stop', or 'close'" },
      { status: 400 }
    )
  } catch (error) {
    console.error("Error in Browser Use API:", error)
    return NextResponse.json(
      { error: "Failed to process request" },
      { status: 500 }
    )
  }
}

// Get session status, messages, or list sessions
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const sessionId = searchParams.get("sessionId")
  const action = searchParams.get("action") // "status", "messages", or null for list

  try {
    // Get specific session info
    if (sessionId) {
      // Get session messages
      if (action === "messages") {
        console.log("[v0] Getting session messages:", sessionId)
        
        const response = await fetch(`${BROWSER_USE_API_URL}/sessions/${sessionId}/messages`, {
          method: "GET",
          headers: {
            "x-api-key": BROWSER_USE_API_KEY,
          },
        })

        if (!response.ok) {
          const errorText = await response.text()
          return NextResponse.json(
            { error: `Browser Use API error: ${response.status} - ${errorText}` },
            { status: response.status }
          )
        }

        const data: BrowserUseMessage[] = await response.json()
        return NextResponse.json({ success: true, messages: data })
      }
      
      // Get session status (default)
      console.log("[v0] Getting session info:", sessionId)
      
      const response = await fetch(`${BROWSER_USE_API_URL}/sessions/${sessionId}`, {
        method: "GET",
        headers: {
          "x-api-key": BROWSER_USE_API_KEY,
        },
      })

      if (!response.ok) {
        const errorText = await response.text()
        return NextResponse.json(
          { error: `Browser Use API error: ${response.status} - ${errorText}` },
          { status: response.status }
        )
      }

      const data: BrowserUseSessionResponse = await response.json()
      return NextResponse.json({
        success: true,
        id: data.id,
        sessionId: data.id,
        status: data.status,
        liveViewUrl: data.liveUrl || null,
        liveUrl: data.liveUrl || null,
        model: data.model,
        output: data.output,
        totalCostUsd: data.totalCostUsd,
        createdAt: data.createdAt,
        updatedAt: data.updatedAt,
      })
    }

    // List all sessions
    console.log("[v0] Listing all sessions...")
    
    const response = await fetch(`${BROWSER_USE_API_URL}/sessions`, {
      method: "GET",
      headers: {
        "x-api-key": BROWSER_USE_API_KEY,
      },
    })

    if (!response.ok) {
      const errorText = await response.text()
      return NextResponse.json(
        { error: `Browser Use API error: ${response.status} - ${errorText}` },
        { status: response.status }
      )
    }

    const data = await response.json()
    return NextResponse.json({ success: true, sessions: data })
  } catch (error) {
    console.error("Error fetching Browser Use session:", error)
    return NextResponse.json(
      { error: "Failed to fetch session info" },
      { status: 500 }
    )
  }
}
