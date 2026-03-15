import { NextRequest, NextResponse } from "next/server"

// Browser Use API v2 - Task-based agent API
// Documentation: https://docs.browser-use.com/cloud/api-v2
const BROWSER_USE_API_URL = "https://api.browser-use.com/api/v2"
const BROWSER_USE_API_KEY = process.env.BROWSER_USE_API_KEY || ""

// Helper to get auth headers - uses X-Browser-Use-API-Key header
const getAuthHeaders = () => ({
  "X-Browser-Use-API-Key": BROWSER_USE_API_KEY,
  "Content-Type": "application/json",
})

// Response from POST /tasks - only returns id and sessionId
interface TaskCreatedResponse {
  id: string
  sessionId: string
}

// Response from GET /tasks/{id}
interface TaskView {
  id: string
  sessionId: string
  task: string
  status: "created" | "started" | "finished" | "stopped"
  output?: string | null
  isSuccess?: boolean | null
  cost?: string | null
  error?: string
}

// Response from GET /sessions/{id}
interface SessionView {
  id: string
  status: "active" | "stopped"
  liveUrl?: string | null
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
      const requestBody = {
        task: task || "Navigate to google.com",
      }

      const response = await fetch(`${BROWSER_USE_API_URL}/tasks`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify(requestBody),
      })

      if (!response.ok) {
        const errorText = await response.text()
        
        if (response.status === 401 || response.status === 403) {
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

      const data: TaskCreatedResponse = await response.json()
      
      // Fetch session to get liveUrl
      let liveUrl: string | null = null
      try {
        const sessionResponse = await fetch(`${BROWSER_USE_API_URL}/sessions/${data.sessionId}`, {
          method: "GET",
          headers: getAuthHeaders(),
        })
        
        if (sessionResponse.ok) {
          const sessionData: SessionView = await sessionResponse.json()
          liveUrl = sessionData.liveUrl || null
        }
      } catch (e) {
        // Ignore session fetch errors
      }
      
      return NextResponse.json({
        success: true,
        id: data.id,
        sessionId: data.sessionId,
        taskId: data.id,
        status: "started",
        liveViewUrl: liveUrl,
        liveUrl: liveUrl,
      })
    }

    // Get task status
    if (action === "status" && (sessionId || taskId)) {
      const id = taskId || sessionId
      
      const response = await fetch(`${BROWSER_USE_API_URL}/tasks/${id}`, {
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

      const data: TaskView = await response.json()
      
      // Fetch session to get liveUrl
      let liveUrl: string | null = null
      try {
        const sessionResponse = await fetch(`${BROWSER_USE_API_URL}/sessions/${data.sessionId}`, {
          method: "GET",
          headers: getAuthHeaders(),
        })
        
        if (sessionResponse.ok) {
          const sessionData: SessionView = await sessionResponse.json()
          liveUrl = sessionData.liveUrl || null
        }
      } catch (e) {
        // Ignore session fetch errors
      }
      
      return NextResponse.json({
        success: true,
        id: data.id,
        sessionId: data.sessionId,
        taskId: data.id,
        status: data.status,
        liveViewUrl: liveUrl,
        liveUrl: liveUrl,
        output: data.output,
        error: data.error,
        isSuccess: data.isSuccess,
        cost: data.cost,
      })
    }

    // Stop a task
    if ((action === "stop" || action === "close") && (sessionId || taskId)) {
      const id = taskId || sessionId
      
      // v2 API uses PUT to stop task
      const response = await fetch(`${BROWSER_USE_API_URL}/tasks/${id}/stop`, {
        method: "PUT",
        headers: getAuthHeaders(),
      })

      if (!response.ok) {
        // May already be stopped, that's okay
      }

      return NextResponse.json({ success: true, message: "Task stopped" })
    }

    // Dispatch additional task (same as create for v2 API)
    if (action === "dispatch") {
      const requestBody = {
        task: task,
      }

      const response = await fetch(`${BROWSER_USE_API_URL}/tasks`, {
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

      const data: TaskCreatedResponse = await response.json()
      
      // Fetch session to get liveUrl
      let liveUrl: string | null = null
      try {
        const sessionResponse = await fetch(`${BROWSER_USE_API_URL}/sessions/${data.sessionId}`, {
          method: "GET",
          headers: getAuthHeaders(),
        })
        
        if (sessionResponse.ok) {
          const sessionData: SessionView = await sessionResponse.json()
          liveUrl = sessionData.liveUrl || null
        }
      } catch (e) {
        // Ignore session fetch errors
      }
      
      return NextResponse.json({
        success: true,
        id: data.id,
        sessionId: data.sessionId,
        taskId: data.id,
        status: "started",
        liveViewUrl: liveUrl,
        liveUrl: liveUrl,
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
      const response = await fetch(`${BROWSER_USE_API_URL}/tasks/${taskId}`, {
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

      const data: TaskView = await response.json()
      
      // Fetch session to get liveUrl
      let liveUrl: string | null = null
      try {
        const sessionResponse = await fetch(`${BROWSER_USE_API_URL}/sessions/${data.sessionId}`, {
          method: "GET",
          headers: getAuthHeaders(),
        })
        
        if (sessionResponse.ok) {
          const sessionData: SessionView = await sessionResponse.json()
          liveUrl = sessionData.liveUrl || null
        }
      } catch (e) {
        // Ignore session fetch errors
      }
      
      return NextResponse.json({
        success: true,
        id: data.id,
        sessionId: data.sessionId,
        taskId: data.id,
        status: data.status,
        liveViewUrl: liveUrl,
        liveUrl: liveUrl,
        output: data.output,
        error: data.error,
        isSuccess: data.isSuccess,
        cost: data.cost,
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
