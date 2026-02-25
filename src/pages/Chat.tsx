import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import ReactMarkdown from "react-markdown";
import {
  GraduationCap, Send, LogOut, MessageSquare, Plus, Trash2, Menu, X, BrainCircuit, User as UserIcon,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { motion, AnimatePresence } from "framer-motion";

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface ChatHistory {
  id: string;
  message: string;
  response: string;
  created_at: string;
}

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/career-chat`;

const Chat = () => {
  const { user, profile, signOut, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [history, setHistory] = useState<ChatHistory[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!authLoading && !user) navigate("/login");
  }, [user, authLoading]);

  useEffect(() => {
    if (user) fetchHistory();
  }, [user]);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const fetchHistory = async () => {
    const { data } = await supabase
      .from("chats")
      .select("*")
      .eq("user_id", user!.id)
      .order("created_at", { ascending: false })
      .limit(50);
    if (data) setHistory(data);
  };

  const saveChat = async (message: string, response: string) => {
    await supabase.from("chats").insert({
      user_id: user!.id,
      message,
      response,
    });
    fetchHistory();
  };

  const deleteChat = async (id: string) => {
    await supabase.from("chats").delete().eq("id", id);
    fetchHistory();
  };

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;
    const userMsg: Message = { role: "user", content: input.trim() };
    const allMessages = [...messages, userMsg];
    setMessages(allMessages);
    setInput("");
    setIsLoading(true);

    let assistantSoFar = "";
    try {
      const resp = await fetch(CHAT_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({ messages: allMessages }),
      });

      if (resp.status === 429) {
        toast({ title: "Rate limited", description: "Too many requests. Please wait a moment.", variant: "destructive" });
        setIsLoading(false);
        return;
      }
      if (resp.status === 402) {
        toast({ title: "Credits needed", description: "Please add credits to continue using AI.", variant: "destructive" });
        setIsLoading(false);
        return;
      }
      if (!resp.ok || !resp.body) throw new Error("Failed to start stream");

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let textBuffer = "";
      let streamDone = false;

      const upsertAssistant = (chunk: string) => {
        assistantSoFar += chunk;
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.role === "assistant") {
            return prev.map((m, i) => (i === prev.length - 1 ? { ...m, content: assistantSoFar } : m));
          }
          return [...prev, { role: "assistant", content: assistantSoFar }];
        });
      };

      while (!streamDone) {
        const { done, value } = await reader.read();
        if (done) break;
        textBuffer += decoder.decode(value, { stream: true });

        let newlineIndex: number;
        while ((newlineIndex = textBuffer.indexOf("\n")) !== -1) {
          let line = textBuffer.slice(0, newlineIndex);
          textBuffer = textBuffer.slice(newlineIndex + 1);
          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (line.startsWith(":") || line.trim() === "") continue;
          if (!line.startsWith("data: ")) continue;
          const jsonStr = line.slice(6).trim();
          if (jsonStr === "[DONE]") { streamDone = true; break; }
          try {
            const parsed = JSON.parse(jsonStr);
            const content = parsed.choices?.[0]?.delta?.content as string | undefined;
            if (content) upsertAssistant(content);
          } catch {
            textBuffer = line + "\n" + textBuffer;
            break;
          }
        }
      }

      // Final flush
      if (textBuffer.trim()) {
        for (let raw of textBuffer.split("\n")) {
          if (!raw) continue;
          if (raw.endsWith("\r")) raw = raw.slice(0, -1);
          if (!raw.startsWith("data: ")) continue;
          const jsonStr = raw.slice(6).trim();
          if (jsonStr === "[DONE]") continue;
          try {
            const parsed = JSON.parse(jsonStr);
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) upsertAssistant(content);
          } catch {}
        }
      }

      if (assistantSoFar) {
        await saveChat(userMsg.content, assistantSoFar);
      }
    } catch (e: any) {
      toast({ title: "Error", description: e.message || "Something went wrong", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  const loadHistoryItem = (item: ChatHistory) => {
    setMessages([
      { role: "user", content: item.message },
      { role: "assistant", content: item.response },
    ]);
  };

  const newChat = () => setMessages([]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (authLoading) return <div className="min-h-screen flex items-center justify-center"><div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" /></div>;

  return (
    <div className="h-screen flex bg-background overflow-hidden">
      {/* Sidebar */}
      <AnimatePresence>
        {sidebarOpen && (
          <motion.aside
            initial={{ x: -300, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: -300, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="w-72 flex-shrink-0 bg-sidebar text-sidebar-foreground flex flex-col h-full border-r border-sidebar-border"
          >
            {/* Sidebar Header */}
            <div className="p-4 border-b border-sidebar-border">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg gradient-primary flex items-center justify-center">
                    <GraduationCap className="w-4 h-4 text-primary-foreground" />
                  </div>
                  <span className="font-semibold text-sm">CareerAI</span>
                </div>
                <Button variant="ghost" size="icon" onClick={() => setSidebarOpen(false)} className="text-sidebar-foreground hover:bg-sidebar-accent h-8 w-8">
                  <X className="w-4 h-4" />
                </Button>
              </div>
              <Button onClick={newChat} className="w-full gradient-primary border-0 text-sm" size="sm">
                <Plus className="w-4 h-4 mr-2" /> New Chat
              </Button>
            </div>

            {/* Chat History */}
            <ScrollArea className="flex-1 p-3">
              <p className="text-xs text-sidebar-foreground/50 uppercase tracking-wider mb-2 px-2">History</p>
              {history.length === 0 && (
                <p className="text-xs text-sidebar-foreground/40 px-2">No chats yet</p>
              )}
              {history.map((item) => (
                <div key={item.id} className="group flex items-center gap-1 mb-1">
                  <button
                    onClick={() => loadHistoryItem(item)}
                    className="flex-1 text-left text-xs px-3 py-2 rounded-lg hover:bg-sidebar-accent truncate transition-colors"
                  >
                    <MessageSquare className="w-3 h-3 inline mr-2 opacity-50" />
                    {item.message.slice(0, 40)}...
                  </button>
                  <button
                    onClick={() => deleteChat(item.id)}
                    className="opacity-0 group-hover:opacity-100 p-1 hover:text-destructive transition-opacity"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </ScrollArea>

            {/* User Section */}
            <div className="p-4 border-t border-sidebar-border">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-8 h-8 rounded-full gradient-primary flex items-center justify-center flex-shrink-0">
                    <UserIcon className="w-4 h-4 text-primary-foreground" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-medium truncate">{profile?.name || "Student"}</p>
                    <p className="text-[10px] text-sidebar-foreground/50 truncate">{profile?.email}</p>
                  </div>
                </div>
                <Button variant="ghost" size="icon" onClick={async () => { await signOut(); navigate("/"); }} className="text-sidebar-foreground hover:bg-sidebar-accent h-8 w-8">
                  <LogOut className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header className="h-14 border-b border-border flex items-center px-4 gap-3 flex-shrink-0 bg-card">
          {!sidebarOpen && (
            <Button variant="ghost" size="icon" onClick={() => setSidebarOpen(true)} className="h-8 w-8">
              <Menu className="w-4 h-4" />
            </Button>
          )}
          <BrainCircuit className="w-5 h-5 text-primary" />
          <span className="font-semibold text-sm">AI Career Guide</span>
        </header>

        {/* Messages */}
        <ScrollArea className="flex-1">
          <div className="max-w-3xl mx-auto py-6 px-4">
            {messages.length === 0 && (
              <div className="text-center py-20">
                <div className="w-16 h-16 rounded-2xl gradient-primary flex items-center justify-center mx-auto mb-6">
                  <BrainCircuit className="w-8 h-8 text-primary-foreground" />
                </div>
                <h2 className="text-2xl font-bold mb-2">AI Career Guide</h2>
                <p className="text-muted-foreground mb-8 max-w-md mx-auto">
                  Ask me anything about career paths, skills, education, job market, resume tips, interview preparation, and more!
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-lg mx-auto">
                  {[
                    "What career suits my interests?",
                    "How to prepare for tech interviews?",
                    "Best skills to learn in 2026?",
                    "How to write a strong resume?",
                  ].map((q) => (
                    <button
                      key={q}
                      onClick={() => { setInput(q); }}
                      className="p-3 text-left text-sm border border-border rounded-xl hover:bg-accent transition-colors"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((msg, i) => (
              <div key={i} className={`flex gap-3 mb-6 ${msg.role === "user" ? "justify-end" : ""}`}>
                {msg.role === "assistant" && (
                  <div className="w-8 h-8 rounded-lg gradient-primary flex items-center justify-center flex-shrink-0 mt-1">
                    <BrainCircuit className="w-4 h-4 text-primary-foreground" />
                  </div>
                )}
                <div className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm ${
                  msg.role === "user"
                    ? "gradient-primary text-primary-foreground rounded-br-md"
                    : "bg-muted rounded-bl-md"
                }`}>
                  {msg.role === "assistant" ? (
                    <div className="prose prose-sm max-w-none dark:prose-invert [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
                      <ReactMarkdown>{msg.content}</ReactMarkdown>
                    </div>
                  ) : (
                    <p className="whitespace-pre-wrap">{msg.content}</p>
                  )}
                </div>
                {msg.role === "user" && (
                  <div className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center flex-shrink-0 mt-1">
                    <UserIcon className="w-4 h-4 text-secondary-foreground" />
                  </div>
                )}
              </div>
            ))}

            {isLoading && messages[messages.length - 1]?.role !== "assistant" && (
              <div className="flex gap-3 mb-6">
                <div className="w-8 h-8 rounded-lg gradient-primary flex items-center justify-center flex-shrink-0">
                  <BrainCircuit className="w-4 h-4 text-primary-foreground" />
                </div>
                <div className="bg-muted rounded-2xl rounded-bl-md px-4 py-3">
                  <div className="flex gap-1">
                    <span className="w-2 h-2 bg-muted-foreground/40 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                    <span className="w-2 h-2 bg-muted-foreground/40 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                    <span className="w-2 h-2 bg-muted-foreground/40 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                  </div>
                </div>
              </div>
            )}
            <div ref={scrollRef} />
          </div>
        </ScrollArea>

        {/* Input */}
        <div className="border-t border-border p-4 bg-card">
          <div className="max-w-3xl mx-auto flex gap-2">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about careers, skills, education..."
              className="min-h-[44px] max-h-32 resize-none rounded-xl"
              rows={1}
            />
            <Button onClick={handleSend} disabled={!input.trim() || isLoading} size="icon" className="gradient-primary border-0 rounded-xl h-11 w-11 flex-shrink-0">
              <Send className="w-4 h-4" />
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground text-center mt-2">
            CareerAI can make mistakes. Verify important information.
          </p>
        </div>
      </div>
    </div>
  );
};

export default Chat;
