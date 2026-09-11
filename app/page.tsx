import { SessionLauncher } from "@/components/conversation/SessionLauncher";

/**
 * One viewport, no page scroll. The orb is the page and everything else floats
 * over it, so `SessionLauncher` owns the full-screen layering rather than
 * sitting inside a scrolling document.
 */
export default function HomePage() {
  return (
    <main className="h-dvh w-full overflow-hidden">
      <SessionLauncher />
    </main>
  );
}
