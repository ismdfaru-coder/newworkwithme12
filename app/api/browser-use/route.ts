import { NextRequest, NextResponse } from "next/server"

// Browser Use API v1 - Task-based agent API
// Documentation: https://docs.browser-use.com/cloud/api-reference
const BROWSER_USE_API_URL = "https://api.browser-use.com/api/v1"
const BROWSER_USE_API_KEY = process.env.BROWSER_USE_API_KEY || ""

// Helper to get auth headers - uses Bearer token
const getAuthHeaders = () => ({
  "Authorization": `Bearer ${BROWSER_USE_API_KEY}`,
  "Content-Type": "application/json",
})

interface BrowserUseTaskResponse {
  id: string
  status: "pending" | "running" | "finished" | "failed" | "stopped"
  output?: unknown
  live_url?: string
  created_at?: string
  finished_at?: string
  error?: string
}

interface BrowserUseRunResponse {
  task_id: string
  live_url?: string
}

// Create a new task and run it
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { action, sessionId, task, taskId } = body

    if (!BROWSER_USE_API_KEY) {
      return NextResponse.json(
        { error: "BROWSER_USE_API_KEY environment variable is not set" },
        { status: 500 }
      )
    }

    // Create and run a new task
    if (action === "create" || action === "run") {
      console.log("[v0] Creating Browser Use task...", task ? `with task: ${task}` : "")
      
      const requestBody = {
        task: task || "Navigate to google.com",
      }

      const response = await fetch(`${BROWSER_USE_API_URL}/run-task`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify(requestBody),
      })

      if (!response.ok) {
        const errorText = await response.text()
        console.log("[v0] Create task error:", response.status, errorText)
        
        if (response.status === 401) {
          return NextResponse.json(
            { error: "Invalid API key. Please check your BROWSER_USE_API_KEY environment variable." },
            { status: 401 }
          )
        }
        
        return NextResponse.json(
          { error: `Browser Use API error: ${response.status} - ${errorText}` },
          { status: response.status }
        )
      }

      const data: BrowserUseRunResponse = await response.json()
      console.log("[v0] Task created:", data.task_id, "live_url:", data.live_url)
      
      return NextResponse.json({
        success: true,
        id: data.task_id,
        sessionId: data.task_id,
        taskId: data.task_id,
        status: "running",
        liveViewUrl: data.live_url || null,
        liveUrl: data.live_url || null,
      })
    }

    // Get task status
    if (action === "status" && (sessionId || taskId)) {
      const id = taskId || sessionId
      console.log("[v0] Getting task status:", id)
      
      const response = await fetch(`${BROWSER_USE_API_URL}/task/${id}`, {
        method: "GET",
        headers: getAuthHeaders(),
      })

      if (!response.ok) {
        const errorText = await response.text()
        console.log("[v0] Get task error:", response.status, errorText)
        return NextResponse.json(
          { error: `Browser Use API error: ${response.status} - ${errorText}` },
          { status: response.status }
        )
      }

      const data: BrowserUseTaskResponse = await response.json()
      console.log("[v0] Task status:", data.id, "status:", data.status)
      
      return NextResponse.json({
        success: true,
        id: data.id,
        sessionId: data.id,
        taskId: data.id,
        status: data.status,
        liveViewUrl: data.live_url || null,
        liveUrl: data.live_url || null,
        output: data.output,
        error: data.error,
        finishedAt: data.finished_at,
      })
    }

    // Stop a task
    if ((action === "stop" || action === "close") && (sessionId || taskId)) {
      const id = taskId || sessionId
      console.log("[v0] Stopping task:", id)
      
      const response = await fetch(`${BROWSER_USE_API_URL}/stop-task`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ task_id: id }),
      })

      if (!response.ok) {
        const errorText = await response.text()
        console.log("[v0] Stop task error (may already be stopped):", response.status, errorText)
      }

      return NextResponse.json({ success: true, message: "Task stopped" })
    }

    // Dispatch additional task (same as create for v1 API)
    if (action === "dispatch") {
      console.log("[v0] Dispatching new task:", task)
      
      const requestBody = {
        task: task,
      }

      const response = await fetch(`${BROWSER_USE_API_URL}/run-task`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify(requestBody),
      })

      if (!response.ok) {
        const errorText = await response.text()
        return NextResponse.json(
          { error: `Browser Use API error: ${response.status} - ${errorText}` },
          { status: response.status }
        )
      }

      const data: BrowserUseRunResponse = await response.json()
      
      return NextResponse.json({
        success: true,
        id: data.task_id,
        sessionId: data.task_id,
        taskId: data.task_id,
        status: "running",
        liveViewUrl: data.live_url || null,
        liveUrl: data.live_url || null,
      })
    }

    return NextResponse.json(
      { error: "Invalid action. Use 'create', 'run', 'status', 'dispatch', 'stop', or 'close'" },
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

// Get task status
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const taskId = searchParams.get("taskId") || searchParams.get("sessionId")

  if (!BROWSER_USE_API_KEY) {
    return NextResponse.json(
      { error: "BROWSER_USE_API_KEY environment variable is not set" },
      { status: 500 }
    )
  }

  try {
    if (taskId) {
      console.log("[v0] Getting task info:", taskId)
      
      const response = await fetch(`${BROWSER_USE_API_URL}/task/${taskId}`, {
        method: "GET",
        headers: getAuthHeaders(),
      })

      if (!response.ok) {
        const errorText = await response.text()
        return NextResponse.json(
          { error: `Browser Use API error: ${response.status} - ${errorText}` },
          { status: response.status }
        )
      }

      const data: BrowserUseTaskResponse = await response.json()
      return NextResponse.json({
        success: true,
        id: data.id,
        sessionId: data.id,
        taskId: data.id,
        status: data.status,
        liveViewUrl: data.live_url || null,
        liveUrl: data.live_url || null,
        output: data.output,
        error: data.error,
        finishedAt: data.finished_at,
      })
    }

    return NextResponse.json(
      { error: "taskId or sessionId parameter required" },
      { status: 400 }
    )
  } catch (error) {
    console.error("Error fetching Browser Use task:", error)
    return NextResponse.json(
      { error: "Failed to fetch task info" },
      { status: 500 }
    )
  }
}
