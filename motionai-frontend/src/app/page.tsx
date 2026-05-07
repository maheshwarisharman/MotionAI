import Header from "@/components/header";
import { PromptForm } from "@/components/prompt-form";

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
            Type your prompt — turn ideas into stunning infographic animations
            instantly.
          </p>
        </div>

        <div className="w-full animate-in fade-in zoom-in-95 duration-700 delay-150 fill-mode-both">
          <PromptForm />
        </div>
      </main>
    </div>
  );
}
