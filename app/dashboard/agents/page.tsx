"use client"

import { useState, useRef, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { 
  ArrowUp,
  Loader2,
  X,
  Monitor,
  Play,
  PanelRightClose,
} from "lucide-react"
import { cn } from "@/lib/utils"

interface BrowserSession {
  id: string
  liveViewUrl: string
  interactiveLiveViewUrl?: string
}

interface Message {
  id: string
  role: "user" | "assistant"
  content: string
  timestamp: Date
}

export default function AgentsPage() {
  const [inputValue, setInputValue] = useState("")
  const [messages, setMessages] = useState<Message[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [browserSession, setBrowserSession] = useState<BrowserSession | null>(null)
  const [showBrowserPanel, setShowBrowserPanel] = useState(false)
  const [isBrowserLoading, setIsBrowserLoading] = useState(false)
  const [showWorkWithMeButton, setShowWorkWithMeButton] = useState(false)
  const [currentTask, setCurrentTask] = useState("")
  const [executionLogs, setExecutionLogs] = useState<string[]>([])
  
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages, executionLogs])

  // Cleanup browser session on unmount
  useEffect(() => {
    return () => {
      if (browserSession?.id) {
        fetch("/api/firecrawl", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "close", sessionId: browserSession.id }),
        }).catch(console.error)
      }
    }
  }, [browserSession])

  // Create browser session (or reuse existing)
  const createBrowserSession = async () => {
    // If we already have a session, reuse it
    if (browserSession?.id) {
      setShowBrowserPanel(true)
      setExecutionLogs(prev => [...prev, `Reusing session: ${browserSession.id}`])
      return browserSession
    }

    setIsBrowserLoading(true)
    setExecutionLogs(prev => [...prev, "Creating browser session..."])
    
    try {
      const response = await fetch("/api/firecrawl", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create" }),
      })

      const data = await response.json()

      if (!response.ok || !data.id) {
        throw new Error(data.error || "Failed to create browser session")
      }

      const session: BrowserSession = {
        id: data.id,
        liveViewUrl: data.liveViewUrl || "",
        interactiveLiveViewUrl: data.interactiveLiveViewUrl || "",
      }

      setBrowserSession(session)
      setShowBrowserPanel(true)
      setExecutionLogs(prev => [...prev, `Session created: ${data.id}`])
      return session
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error"
      setExecutionLogs(prev => [...prev, `Error: ${errorMsg}`])
      return null
    } finally {
      setIsBrowserLoading(false)
    }
  }

  // Execute code in browser
  const executeCode = async (code: string, language: string = "python") => {
    if (!browserSession?.id) return null

    setExecutionLogs(prev => [...prev, `Executing: ${code}`])

    try {
      const response = await fetch("/api/firecrawl", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "execute",
          sessionId: browserSession.id,
          code,
          language,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || "Failed to execute code")
      }

      if (data.result) {
        setExecutionLogs(prev => [...prev, `Result: ${data.result}`])
      }

      return data
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error"
      setExecutionLogs(prev => [...prev, `Error: ${errorMsg}`])
      return null
    }
  }

  // Close browser session
  const closeBrowserSession = async () => {
    if (!browserSession?.id) return

    try {
      await fetch("/api/firecrawl", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "close", sessionId: browserSession.id }),
      })
      setExecutionLogs(prev => [...prev, "Session closed"])
    } catch (error) {
      console.error("Error closing session:", error)
    } finally {
      setBrowserSession(null)
      setShowBrowserPanel(false)
    }
  }

  // Handle form submit - user enters prompt
  const handleSubmit = async () => {
    if (!inputValue.trim() || isLoading) return

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: inputValue.trim(),
      timestamp: new Date(),
    }

    setMessages(prev => [...prev, userMessage])
    setCurrentTask(inputValue.trim())
    setInputValue("")
    setIsLoading(true)

    // Show assistant response with "Work with me" button
    setTimeout(() => {
      const assistantMessage: Message = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: `I can help you with: "${userMessage.content}"\n\nClick "Work with me" to start a live browser session where I'll execute this task.`,
        timestamp: new Date(),
      }
      setMessages(prev => [...prev, assistantMessage])
      setShowWorkWithMeButton(true)
      setIsLoading(false)
    }, 500)
  }

  // Handle "Work with me" button - starts browser and executes task
  const handleWorkWithMe = async () => {
    if (!currentTask.trim()) return

    setShowWorkWithMeButton(false)
    setIsLoading(true)
    setExecutionLogs([])

    // Create browser session
    const session = await createBrowserSession()
    
    if (!session) {
      setIsLoading(false)
      return
    }

    // Execute a sample navigation based on the task
    const url = extractUrlFromTask(currentTask) || "https://google.com"
    await executeCode(`await page.goto("${url}")`, "python")

    // Add completion message
    const completionMessage: Message = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: `Browser session is now active. You can see the live view in the panel on the right.\n\nSession ID: ${session.id}`,
      timestamp: new Date(),
    }
    setMessages(prev => [...prev, completionMessage])
    setIsLoading(false)
  }

  // Extract URL from task (simple implementation)
  const extractUrlFromTask = (task: string): string | null => {
    const urlMatch = task.match(/https?:\/\/[^\s]+/)
    if (urlMatch) return urlMatch[0]
    
    if (task.toLowerCase().includes("google")) return "https://google.com"
    if (task.toLowerCase().includes("hacker news") || task.toLowerCase().includes("ycombinator")) return "https://news.ycombinator.com"
    if (task.toLowerCase().includes("github")) return "https://github.com"
    if (task.toLowerCase().includes("twitter") || task.toLowerCase().includes("x.com")) return "https://x.com"
    
    return null
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  return (
    <div className="flex h-[calc(100vh-4rem)] bg-background">
      {/* Left Panel - Chat */}
      <div className={cn(
        "flex flex-col transition-all duration-300",
        showBrowserPanel ? "w-1/2" : "w-full"
      )}>
        {/* Messages Area */}
        <div className="flex-1 overflow-y-auto p-6">
          {messages.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              <div className="text-center">
                <Monitor className="mx-auto h-12 w-12 text-muted-foreground/50" />
                <h2 className="mt-4 text-xl font-semibold">Browser Agent</h2>
                <p className="mt-2 text-muted-foreground">
                  Enter a task and I will execute it in a live browser session
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={cn(
                    "flex",
                    message.role === "user" ? "justify-end" : "justify-start"
                  )}
                >
                  <div
                    className={cn(
                      "max-w-[80%] rounded-2xl px-4 py-3",
                      message.role === "user"
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted"
                    )}
                  >
                    <p className="whitespace-pre-wrap">{message.content}</p>
                  </div>
                </div>
              ))}

              {/* Work with me button */}
              {showWorkWithMeButton && (
                <div className="flex justify-start">
                  <Button
                    onClick={handleWorkWithMe}
                    disabled={isLoading}
                    className="gap-2"
                  >
                    {isLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Play className="h-4 w-4" />
                    )}
                    Work with me
                  </Button>
                </div>
              )}

              {/* Execution Logs */}
              {executionLogs.length > 0 && (
                <div className="rounded-lg border bg-muted/50 p-4">
                  <h4 className="mb-2 text-sm font-medium">Execution Logs</h4>
                  <div className="space-y-1 font-mono text-xs">
                    {executionLogs.map((log, index) => (
                      <p key={index} className="text-muted-foreground">
                        {log}
                      </p>
                    ))}
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Input Area */}
        <div className="border-t p-4">
          <div className="flex items-end gap-2">
            <textarea
              ref={textareaRef}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Enter a task... (e.g., 'Go to google.com and search for AI news')"
              className="flex-1 resize-none rounded-xl border bg-background px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              rows={1}
              disabled={isLoading}
            />
            <Button
              onClick={handleSubmit}
              disabled={!inputValue.trim() || isLoading}
              size="icon"
              className="h-10 w-10 rounded-full"
            >
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ArrowUp className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>
      </div>

      {/* Right Panel - Browser View */}
      {showBrowserPanel && (
        <div className="w-1/2 border-l flex flex-col">
          <div className="flex items-center justify-between border-b px-4 py-2">
            <div className="flex items-center gap-2">
              <Monitor className="h-4 w-4" />
              <span className="text-sm font-medium">Live Browser</span>
              {browserSession && (
                <span className="text-xs text-muted-foreground">
                  {browserSession.id.slice(0, 8)}...
                </span>
              )}
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={closeBrowserSession}
              className="h-8 w-8"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          <div className="flex-1 bg-muted/20">
            {isBrowserLoading ? (
              <div className="flex h-full items-center justify-center">
                <div className="text-center">
                  <Loader2 className="mx-auto h-8 w-8 animate-spin text-muted-foreground" />
                  <p className="mt-2 text-sm text-muted-foreground">
                    Starting browser session...
                  </p>
                </div>
              </div>
            ) : browserSession?.liveViewUrl ? (
              <iframe
                src={browserSession.interactiveLiveViewUrl || browserSession.liveViewUrl}
                className="h-full w-full border-0"
                title="Live Browser View"
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
              />
            ) : (
              <div className="flex h-full items-center justify-center">
                <p className="text-sm text-muted-foreground">
                  No active browser session
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
