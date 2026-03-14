import { NextRequest, NextResponse } from "next/server"

const FIRECRAWL_API_KEY = "fc-21c577cb2e1a48d1a850e2850aceb4b4"
const FIRECRAWL_BASE_URL = "https://api.firecrawl.dev/v2/browser"

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { action, sessionId, code, language = "python" } = body

    const headers = {
      "Authorization": `Bearer ${FIRECRAWL_API_KEY}`,
      "Content-Type": "application/json",
    }

    // Step 1: Launch a session
    if (action === "create") {
      const response = await fetch(FIRECRAWL_BASE_URL, {
        method: "POST",
        headers,
      })

      const data = await response.json()
      
      if (!response.ok) {
        return NextResponse.json(
          { error: data.error || "Failed to create session" },
          { status: response.status }
        )
      }

      return NextResponse.json({
        success: true,
        id: data.id,
        cdpUrl: data.cdpUrl,
        liveViewUrl: data.liveViewUrl,
        interactiveLiveViewUrl: data.interactiveLiveViewUrl,
      })
    }

    // Step 2: Execute code
    if (action === "execute") {
      if (!sessionId) {
        return NextResponse.json(
          { error: "Session ID is required" },
          { status: 400 }
        )
      }

      const response = await fetch(`${FIRECRAWL_BASE_URL}/${sessionId}/execute`, {
        method: "POST",
        headers,
        body: JSON.stringify({ code, language }),
      })

      const data = await response.json()

      if (!response.ok) {
        return NextResponse.json(
          { error: data.error || "Failed to execute code" },
          { status: response.status }
        )
      }

      return NextResponse.json({
        success: true,
        result: data.result,
        screenshot: data.screenshot,
      })
    }

    // Step 3: List sessions
    if (action === "list") {
      const response = await fetch(`${FIRECRAWL_BASE_URL}?status=active`, {
        method: "GET",
        headers,
      })

      const data = await response.json()

      return NextResponse.json({
        success: true,
        sessions: data.sessions || data,
      })
    }

    // Step 4: Close session
    if (action === "close") {
      if (!sessionId) {
        return NextResponse.json(
          { error: "Session ID is required" },
          { status: 400 }
        )
      }

      const response = await fetch(`${FIRECRAWL_BASE_URL}/${sessionId}`, {
        method: "DELETE",
        headers,
      })

      if (!response.ok) {
        const data = await response.json()
        return NextResponse.json(
          { error: data.error || "Failed to close session" },
          { status: response.status }
        )
      }

      return NextResponse.json({ success: true })
    }

    return NextResponse.json(
      { error: "Invalid action" },
      { status: 400 }
    )
  } catch (error) {
    console.error("Firecrawl API error:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}
