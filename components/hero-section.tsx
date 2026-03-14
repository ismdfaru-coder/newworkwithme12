"use client"

import { useState, useEffect } from "react"
import { Plus, ArrowUp, Presentation, Globe, Smartphone, Paintbrush } from "lucide-react"
import { Button } from "@/components/ui/button"

const heroTexts = [
  "What can I do for you?",
  "What do you want to know?",
  "Lightning Speed Chat in Turbo mode.",
  "I can Browse and remove your Hassle, You Just WorkwithMe",
]

export function HeroSection() {
  const [inputValue, setInputValue] = useState("")
  const [textIndex, setTextIndex] = useState(0)
  const [isVisible, setIsVisible] = useState(true)

  useEffect(() => {
    const interval = setInterval(() => {
      setIsVisible(false)
      
      setTimeout(() => {
        setTextIndex((prev) => (prev + 1) % heroTexts.length)
        setIsVisible(true)
      }, 500)
    }, 3000)

    return () => clearInterval(interval)
  }, [])

  const quickActions = [
    { icon: Presentation, label: "Create slides" },
    { icon: Globe, label: "Build website" },
    { icon: Smartphone, label: "Develop apps" },
    { icon: Paintbrush, label: "Design" },
  ]

  return (
    <section className="flex flex-col items-center justify-center px-4 py-24">
      <h1 className="mb-12 text-center text-4xl font-serif md:text-5xl lg:text-6xl min-h-[1.5em]">
        <span
          className={`inline-block transition-opacity duration-500 ${
            isVisible ? "opacity-100" : "opacity-0"
          }`}
        >
          {heroTexts[textIndex]}
        </span>
      </h1>

      <div className="w-full max-w-3xl">
        <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <textarea
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder="Assign a task or ask anything"
            className="min-h-[60px] w-full resize-none bg-transparent text-base outline-none placeholder:text-muted-foreground"
            rows={2}
          />

          <div className="flex items-center justify-between pt-2">
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full">
                <Plus className="h-4 w-4" />
              </Button>
            </div>

            <Button
              size="icon"
              className="h-10 w-10 rounded-full"
              disabled={!inputValue.trim()}
            >
              <ArrowUp className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          {quickActions.map((action) => (
            <Button
              key={action.label}
              variant="outline"
              className="gap-2 rounded-full"
            >
              <action.icon className="h-4 w-4" />
              {action.label}
            </Button>
          ))}
          <Button variant="outline" className="rounded-full">
            More
          </Button>
        </div>
      </div>
    </section>
  )
}
