import Header from "@/components/header";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Image as ImageIcon,
  Video,
  Sparkles,
  ChevronDown,
  Paperclip,
  Settings2,
  Mic,
  ArrowUp,
  Globe,
  MonitorPlay,
  Presentation,
  Layers,
  FileText,
} from "lucide-react";

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground selection:bg-primary/30">
      <Header />

      <main className="flex-1 flex flex-col items-center justify-center px-4 md:px-8 py-24">
        {/* Hero Section */}
        <div className="text-center max-w-4xl w-full space-y-6 mb-12 animate-in fade-in slide-in-from-bottom-4 duration-1000">
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight text-foreground">
            What do you want to create?
          </h1>
          <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto">
            Type your prompt — turn ideas into stunning animations and AI
            visuals instantly.
          </p>
        </div>

        {/* Main Prompt Input Area */}
        <div className="w-full max-w-3xl bg-card border border-border rounded-xl shadow-sm flex flex-col focus-within:ring-1 focus-within:ring-border transition-all duration-300 animate-in fade-in zoom-in-95 duration-700 delay-150 fill-mode-both">
          {/* Tabs */}
          <div className="flex items-center gap-1 p-2 border-b border-border/50 bg-muted/10 rounded-t-xl">
            <Button
              variant="ghost"
              size="sm"
              className="rounded-md bg-accent text-foreground hover:bg-accent hover:text-foreground h-8 font-medium"
            >
              <ImageIcon className="w-4 h-4 mr-2" />
              Image Generation
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="rounded-md text-muted-foreground hover:bg-accent hover:text-foreground h-8 font-medium"
            >
              <Video className="w-4 h-4 mr-2" />
              Video Generation
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="rounded-md text-muted-foreground hover:bg-accent hover:text-foreground h-8 font-medium"
            >
              <Sparkles className="w-4 h-4 mr-2" />
              AI Agent
            </Button>
          </div>

          <Textarea
            placeholder="Write what you want to create..."
            className="min-h-[120px] resize-none border-0 focus-visible:ring-0 shadow-none text-base bg-transparent p-5 placeholder:text-muted-foreground/70"
          />

          {/* Bottom Bar */}
          <div className="flex items-center justify-between p-3 pt-0">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Button
                variant="ghost"
                size="icon"
                className="rounded-md hover:bg-accent hover:text-foreground w-8 h-8"
              >
                <Paperclip className="w-4 h-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="rounded-md hover:bg-accent hover:text-foreground h-8 text-xs font-medium bg-muted/20"
              >
                <Sparkles className="w-3.5 h-3.5 mr-1.5 text-blue-500" />
                Auto Model
                <ChevronDown className="w-3.5 h-3.5 ml-1.5 opacity-50" />
              </Button>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                className="rounded-md hover:bg-accent hover:text-foreground h-8 text-xs font-medium hidden sm:flex"
              >
                <Globe className="w-3.5 h-3.5 mr-1.5" />
                Public
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="rounded-md hover:bg-accent hover:text-foreground w-8 h-8"
              >
                <Settings2 className="w-4 h-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="rounded-md hover:bg-accent hover:text-foreground w-8 h-8"
              >
                <Mic className="w-4 h-4" />
              </Button>
              <Button
                size="icon"
                className="rounded-md w-8 h-8 bg-foreground text-background hover:bg-foreground/90 transition-colors ml-2"
              >
                <ArrowUp className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>

        {/* Quick Template Suggestions */}
        <div className="flex flex-wrap items-center justify-center gap-3 mt-6 animate-in fade-in duration-700 delay-200 fill-mode-both w-full max-w-3xl">
          <Button
            variant="outline"
            size="sm"
            className="rounded-md border-border/50 bg-transparent hover:bg-accent text-muted-foreground font-normal transition-all"
          >
            <MonitorPlay className="w-4 h-4 mr-2 text-muted-foreground/70" />
            Product Explainer
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="rounded-md border-border/50 bg-transparent hover:bg-accent text-muted-foreground font-normal transition-all"
          >
            <Presentation className="w-4 h-4 mr-2 text-muted-foreground/70" />
            Pitch Deck Infographic
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="rounded-md border-border/50 bg-transparent hover:bg-accent text-muted-foreground font-normal transition-all"
          >
            <Layers className="w-4 h-4 mr-2 text-muted-foreground/70" />
            Logo Reveal
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="rounded-md border-border/50 bg-transparent hover:bg-accent text-muted-foreground font-normal transition-all"
          >
            <FileText className="w-4 h-4 mr-2 text-muted-foreground/70" />
            Data Visualization
          </Button>
        </div>

        {/* Suggestion / Showcase Hint */}
        <div className="mt-20 animate-in fade-in duration-1000 delay-300 fill-mode-both">
          <Button
            variant="outline"
            className="rounded-md text-muted-foreground border-border bg-transparent hover:bg-accent hover:text-foreground transition-all"
          >
            Explore showcases
            <ChevronDown className="w-4 h-4 ml-2 opacity-70" />
          </Button>
        </div>
      </main>
    </div>
  );
}
