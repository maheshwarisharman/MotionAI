import Header from "@/components/header";
import { ChatWorkspace } from "@/components/chat-workspace";
import Image from "next/image";
import backgroundImage from "@/assets/ChatGPT Image May 8, 2026, 12_49_05 AM.png";

export default function Home() {
  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-background text-foreground selection:bg-white/20">
      <Image
        alt=""
        aria-hidden="true"
        priority
        src={backgroundImage}
        className="pointer-events-none absolute inset-0 z-0 h-full w-full object-cover object-center"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-0 bg-gradient-to-b from-black/40 via-black/20 to-black/55"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-0 opacity-[0.22] mix-blend-overlay"
        style={{
          backgroundImage:
            "radial-gradient(circle at top, rgba(255,255,255,0.18), transparent 42%), radial-gradient(circle at 25% 70%, rgba(255,120,45,0.18), transparent 52%)",
        }}
      />

      <div className="relative z-10 flex min-h-screen flex-col">
        <Header />
        <ChatWorkspace />
      </div>
    </div>
  );
}
