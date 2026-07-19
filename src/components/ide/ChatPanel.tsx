import { useAction, useMutation, useQuery } from "convex/react";
import {
  AlertCircle,
  Bot,
  ChevronDown,
  Coins,
  Send,
  User,
  Zap,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { useAuthToken } from "@/hooks/useAuthToken";
import { cn } from "@/lib/utils";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { QuickActions } from "./QuickActions";
import { UsageMeter } from "./UsageMeter";

interface FileContext {
  path: string;
  content: string;
}

interface ChatPanelProps {
  projectId: Id<"projects">;
  sessionId: Id<"chatSessions"> | null;
  currentFileContent?: string;
  currentFileName?: string;
  openFiles?: FileContext[];
}

// Tier badges for the model picker
const TIER_LABELS: Record<string, { label: string; color: string }> = {
  strong: { label: "Strong", color: "text-amber-400" },
  balanced: { label: "Balanced", color: "text-blue-400" },
  fast: { label: "Fast", color: "text-green-400" },
};

export function ChatPanel({
  projectId,
  sessionId,
  currentFileContent,
  currentFileName,
  openFiles,
}: ChatPanelProps) {
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [loadingStartTime, setLoadingStartTime] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const messages = useQuery(
    api.chat.listMessages,
    sessionId ? { sessionId } : "skip",
  );
  const session = useQuery(
    api.chat.getSession,
    sessionId ? { sessionId } : "skip",
  );
  const backendModels = useQuery(api.chat.listModels, {});
  const sendMessage = useAction(api.chat.sendMessage);
  const updateModel = useMutation(api.chat.updateModel);
  const userId = useAuthToken();

  const currentModel = session?.model ?? "deepseek-v3";
  const currentModelConfig = backendModels?.find(
    (m: any) => m.id === currentModel,
  );

  // Elapsed time counter during loading
  useEffect(() => {
    if (!isLoading || !loadingStartTime) return;
    const interval = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - loadingStartTime) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [isLoading, loadingStartTime]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages?.length]);

  // Auto-grow textarea, max 120px
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    e.target.style.height = "auto";
    e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
  };

  const handleSend = async () => {
    if (!input.trim() || !sessionId || isLoading || !userId) return;
    const msg = input.trim();
    setInput("");
    if (inputRef.current) {
      inputRef.current.style.height = "auto";
    }
    setIsLoading(true);
    setLoadingStartTime(Date.now());
    setElapsedSeconds(0);
    try {
      const cleanMsg = msg.replace(/@codeforge\s*/gi, "").trim();
      const fileContexts =
        openFiles && openFiles.length > 0
          ? openFiles
          : currentFileContent && currentFileName
            ? [{ path: currentFileName, content: currentFileContent }]
            : undefined;
      await sendMessage({
        sessionId,
        projectId,
        content: cleanMsg,
        model: currentModel,
        fileContext: currentFileContent,
        fileContexts,
        userId: userId as Id<"users">,
      });
    } catch (error) {
      console.error("Failed to send:", error);
    } finally {
      setIsLoading(false);
      setLoadingStartTime(null);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Group models by tier for the dropdown
  const modelsByTier = (backendModels ?? []).reduce(
    (acc: Record<string, any[]>, m: any) => {
      const tier = m.tier ?? "balanced";
      if (!acc[tier]) acc[tier] = [];
      acc[tier].push(m);
      return acc;
    },
    {} as Record<string, any[]>,
  );

  return (
    <div className="h-full flex flex-col bg-[oklch(0.11_0.02_260)] min-w-0 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <Bot className="h-4 w-4 text-primary shrink-0" />
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground truncate">
            AI Chat
          </span>
        </div>

        {/* Model selector */}
        <div className="relative shrink-0">
          <button
            type="button"
            className="flex items-center gap-1.5 px-2 py-1 text-xs rounded bg-[oklch(0.18_0.02_260)] hover:bg-[oklch(0.22_0.02_260)] transition-colors max-w-[200px]"
            aria-label="Select AI model"
            aria-expanded={modelDropdownOpen}
            onClick={() => setModelDropdownOpen(!modelDropdownOpen)}
          >
            <span className="text-primary truncate">
              {currentModelConfig?.name ?? currentModel}
            </span>
            <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />
          </button>
          {modelDropdownOpen && (
            <>
              {/* Backdrop to close dropdown */}
              <div
                className="fixed inset-0 z-40"
                onClick={() => setModelDropdownOpen(false)}
              />
              <div className="absolute right-0 top-full mt-1 z-50 bg-[oklch(0.14_0.02_260)] border border-border rounded-lg shadow-2xl py-1 min-w-[260px] max-h-[400px] overflow-y-auto">
                {(["strong", "balanced", "fast"] as const).map(tier => {
                  const models = modelsByTier[tier];
                  if (!models?.length) return null;
                  const tierMeta = TIER_LABELS[tier];
                  return (
                    <div key={tier}>
                      <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 border-b border-border/30">
                        {tierMeta.label}
                      </div>
                      {models.map((model: any) => (
                        <button
                          key={model.id}
                          type="button"
                          className={cn(
                            "flex items-center justify-between w-full px-3 py-2 text-xs hover:bg-[oklch(0.20_0.02_260)] transition-colors",
                            currentModel === model.id &&
                              "bg-[oklch(0.18_0.02_260)]",
                          )}
                          onClick={() => {
                            if (sessionId)
                              updateModel({ sessionId, model: model.id });
                            setModelDropdownOpen(false);
                          }}
                        >
                          <span className="text-foreground truncate">
                            {model.name}
                          </span>
                          <span className="flex items-center gap-1.5 shrink-0 ml-2">
                            {model.inputCostPer1M === 0 ? (
                              <span className="text-[9px] bg-green-500/15 text-green-400 px-1 rounded">
                                FREE
                              </span>
                            ) : (
                              <span className="text-[9px] text-muted-foreground/50">
                                ${model.inputCostPer1M.toFixed(2)}/M
                              </span>
                            )}
                            {currentModel === model.id && (
                              <Zap className="h-3 w-3 text-primary" />
                            )}
                          </span>
                        </button>
                      ))}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Cost tracker */}
      {session && session.totalCost > 0 && (
        <div className="flex items-center gap-2 px-3 py-1 border-b border-border bg-[oklch(0.12_0.02_260)] text-xs text-muted-foreground shrink-0">
          <Coins className="h-3 w-3 shrink-0" />
          <span className="truncate">
            {session.totalTokensUsed.toLocaleString()} tokens · $
            {session.totalCost.toFixed(4)}
          </span>
        </div>
      )}

      {/* Usage meter */}
      <div className="relative flex items-center justify-end px-3 py-1.5 border-b border-border/40 shrink-0 bg-[oklch(0.095_0.02_260)]">
        <UsageMeter />
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden px-3 py-2 space-y-3 min-w-0">
        {(!messages || messages.length === 0) && !isLoading && (
          <div className="flex flex-col items-center justify-center h-full text-center p-6 space-y-4">
            <div className="w-16 h-16 bg-[oklch(0.18_0.02_260)] rounded-full flex items-center justify-center">
              <Bot className="w-8 h-8 text-primary" />
            </div>
            <div className="space-y-2 max-w-[280px]">
              <h3 className="text-sm font-semibold text-foreground">
                Welcome to CodeForge AI
              </h3>
              <p className="text-xs text-muted-foreground">
                Ask questions about your code, or use{" "}
                <span className="text-primary font-medium">@build</span> to
                launch an AI agent that writes code for you.
              </p>
              <div className="flex flex-wrap gap-1.5 justify-center mt-3">
                {[
                  "Explain this code",
                  "@build a todo app",
                  "Find bugs",
                  "How do I...",
                ].map(suggestion => (
                  <button
                    key={suggestion}
                    type="button"
                    className="text-[10px] px-2 py-1 rounded-full bg-[oklch(0.16_0.02_260)] text-muted-foreground hover:text-foreground hover:bg-[oklch(0.20_0.02_260)] transition-colors"
                    onClick={() => {
                      setInput(suggestion);
                      inputRef.current?.focus();
                    }}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {messages?.map((msg: NonNullable<typeof messages>[number]) => (
          <div
            key={msg._id}
            className={cn(
              "flex gap-2 min-w-0",
              msg.role === "user" ? "justify-end" : "justify-start",
            )}
          >
            {msg.role === "assistant" && (
              <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center shrink-0 mt-0.5">
                {msg.isError ? (
                  <AlertCircle className="h-3.5 w-3.5 text-destructive" />
                ) : (
                  <Bot className="h-3.5 w-3.5 text-primary" />
                )}
              </div>
            )}
            <div
              className={cn(
                "rounded-lg px-3 py-2 text-sm min-w-0",
                "max-w-[85%] overflow-hidden",
                msg.role === "user"
                  ? "bg-primary/20 text-foreground"
                  : msg.isError
                    ? "bg-destructive/10 text-destructive border border-destructive/20"
                    : "bg-[oklch(0.16_0.02_260)] text-foreground",
              )}
            >
              {msg.role === "assistant" && !msg.isError ? (
                <div className="prose prose-invert prose-sm max-w-none break-words [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      code({ className, children, ...props }) {
                        const match = /language-(\w+)/.exec(className || "");
                        const codeString = String(children).replace(/\n$/, "");
                        if (match) {
                          return (
                            <SyntaxHighlighter
                              style={oneDark}
                              language={match[1]}
                              PreTag="div"
                              customStyle={{
                                margin: "0.5rem 0",
                                borderRadius: "0.5rem",
                                fontSize: "0.75rem",
                              }}
                            >
                              {codeString}
                            </SyntaxHighlighter>
                          );
                        }
                        return (
                          <code
                            className="bg-[oklch(0.12_0.02_260)] px-1 py-0.5 rounded text-[0.8em] text-primary"
                            {...props}
                          >
                            {children}
                          </code>
                        );
                      },
                      pre({ children }) {
                        return <>{children}</>;
                      },
                    }}
                  >
                    {msg.content}
                  </ReactMarkdown>
                </div>
              ) : (
                <div className="whitespace-pre-wrap break-words overflow-wrap-anywhere text-[13px] leading-relaxed">
                  {msg.content}
                </div>
              )}
              {msg.model && (
                <div className="flex items-center gap-1 mt-1 text-[10px] text-muted-foreground flex-wrap">
                  <span>{msg.model}</span>
                  {msg.tokensUsed && (
                    <>
                      <span>·</span>
                      <span>{msg.tokensUsed} tok</span>
                    </>
                  )}
                  {msg.cost !== undefined && msg.cost > 0 && (
                    <>
                      <span>·</span>
                      <span>${msg.cost.toFixed(4)}</span>
                    </>
                  )}
                </div>
              )}
            </div>
            {msg.role === "user" && (
              <div className="w-8 h-8 rounded-full bg-[oklch(0.25_0.02_260)] flex items-center justify-center shrink-0 mt-0.5">
                <User className="h-4 w-4 text-muted-foreground" />
              </div>
            )}
          </div>
        ))}

        {isLoading && (
          <div className="flex gap-2">
            <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
              <Bot className="h-3.5 w-3.5 text-primary animate-pulse" />
            </div>
            <div className="bg-[oklch(0.16_0.02_260)] rounded-lg px-3 py-2">
              <div className="flex items-center gap-2">
                <div className="flex gap-1">
                  {[0, 0.15, 0.3].map((delay, i) => (
                    <div
                      key={i}
                      className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce"
                      style={{ animationDelay: `${delay}s` }}
                    />
                  ))}
                </div>
                <span className="text-xs text-muted-foreground">
                  Thinking...{" "}
                  {elapsedSeconds > 0 && (
                    <span className="text-muted-foreground/50">
                      {elapsedSeconds}s
                    </span>
                  )}
                </span>
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* File context indicator */}
      {currentFileName && (
        <div className="px-3 py-1 text-[10px] text-muted-foreground border-t border-border flex items-center gap-1 shrink-0 min-w-0">
          <span className="truncate">📄 Context: {currentFileName}</span>
        </div>
      )}

      {/* Quick Actions */}
      {currentFileName && !input && (
        <QuickActions
          disabled={isLoading}
          onSelect={prompt => {
            setInput(prompt);
            setTimeout(() => {
              if (inputRef.current) inputRef.current.focus();
            }, 0);
          }}
        />
      )}

      {/* Input */}
      <div className="px-3 py-2 border-t border-border shrink-0">
        <div className="flex gap-2 items-end">
          <textarea
            ref={inputRef}
            className="flex-1 min-w-0 bg-[oklch(0.18_0.02_260)] border border-border rounded-lg px-4 py-3 text-base text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary resize-none overflow-hidden"
            aria-label="Type a message"
            style={{ minHeight: "48px" }}
            placeholder="Ask anything... (@build to run agent)"
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            rows={1}
            disabled={isLoading}
          />
          <button
            type="button"
            className="shrink-0 w-12 h-12 flex items-center justify-center rounded-lg bg-primary hover:bg-primary/80 disabled:opacity-40 transition-colors"
            disabled={!input.trim() || isLoading}
            onClick={handleSend}
            aria-label="Send"
          >
            <Send className="h-5 w-5 text-primary-foreground" />
          </button>
        </div>
      </div>
    </div>
  );
}
