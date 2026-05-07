import Header from "@/components/header";
import { ChatWorkspace } from "@/components/chat-workspace";

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground selection:bg-white/20">
      <Header />
      <ChatWorkspace />
    </div>
  );
}
