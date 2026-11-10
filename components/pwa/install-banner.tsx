"use client";

import { useEffect, useRef, useState } from "react";
import { installGuide } from "@/lib/pwa/install-support";

type InstallPromptEvent = Event & {
  prompt(): Promise<{ outcome: "accepted" | "dismissed" }>;
};

const DISMISSED_KEY = "group-expense:install-dismissed:v1";
type InstallMode = { kind: "prompt" } | { kind: "guide"; instructions: string };

export function InstallBanner() {
  const [mode, setMode] = useState<InstallMode | null>(null);
  const [hint, setHint] = useState("");
  const promptRef = useRef<InstallPromptEvent | null>(null);
  const dismissedRef = useRef(false);

  useEffect(() => {
    const nav = navigator as Navigator & { standalone?: boolean };
    const displayMode = window.matchMedia(
      "(display-mode: standalone), (display-mode: minimal-ui), (display-mode: fullscreen)",
    );
    const guide = installGuide(nav);
    let installed = false;
    let active = true;
    try {
      dismissedRef.current = sessionStorage.getItem(DISMISSED_KEY) === "1";
    } catch { /* The banner still works when browser storage is blocked. */ }

    const isInstalled = () => installed || displayMode.matches || nav.standalone === true;
    const refresh = () => {
      if (!active) return;
      if (isInstalled() || dismissedRef.current || !window.isSecureContext) {
        promptRef.current = null;
        setMode(null);
        setHint("");
      } else {
        // Manual-install browsers cannot reliably report installations from a tab.
        setMode(promptRef.current ? { kind: "prompt" }
          : guide ? { kind: "guide", instructions: guide } : null);
      }
    };
    const onPrompt = (event: Event) => {
      if (isInstalled() || dismissedRef.current || !window.isSecureContext) return;
      event.preventDefault();
      promptRef.current = event as InstallPromptEvent;
      setHint("");
      setMode({ kind: "prompt" });
    };
    const onInstalled = () => {
      installed = true;
      refresh();
    };
    const onResume = () => { if (!document.hidden) refresh(); };

    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    displayMode.addEventListener("change", refresh);
    document.addEventListener("visibilitychange", onResume);
    queueMicrotask(refresh);
    return () => {
      active = false;
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
      displayMode.removeEventListener("change", refresh);
      document.removeEventListener("visibilitychange", onResume);
    };
  }, []);

  function dismiss() {
    dismissedRef.current = true;
    promptRef.current = null;
    setMode(null);
    setHint("");
    try {
      sessionStorage.setItem(DISMISSED_KEY, "1");
    } catch { /* Keep the in-memory dismissal for this page. */ }
  }

  async function install() {
    if (mode?.kind === "guide") {
      setHint(hint ? "" : mode.instructions);
      return;
    }
    const prompt = promptRef.current;
    if (!prompt) return;
    // Each event can be used once; invoke prompt directly in the tap handler.
    promptRef.current = null;
    setMode(null);
    setHint("");
    try {
      await prompt.prompt();
    } catch {
      setHint("Chưa mở được hộp thoại cài đặt. Hãy dùng mục cài ứng dụng trong menu trình duyệt.");
    }
  }

  if (!mode && !hint) return null;

  return <aside aria-label="Cài ứng dụng" className="install-banner shrink-0 border-b bg-secondary/70">
    <div className="install-banner-inner mx-auto flex max-w-2xl items-center gap-1">
      <p className="min-w-0 flex-1 truncate text-xs">Cài Group Expense</p>
      {mode && <button type="button" onClick={() => void install()}
        aria-label="Cài ứng dụng Group Expense"
        aria-expanded={mode.kind === "guide" ? Boolean(hint) : undefined}
        aria-controls={mode.kind === "guide" ? "install-banner-hint" : undefined}
        className="flex h-11 shrink-0 items-center px-2 text-xs font-semibold underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
          strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="mr-1.5 size-4">
          <path d="M12 3v12m-4-4 4 4 4-4M4 16v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/>
        </svg>
        Cài đặt
      </button>}
      <button type="button" onClick={dismiss} aria-label="Đóng lời mời cài ứng dụng"
        className="flex size-11 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
          strokeLinecap="round" aria-hidden="true" className="size-4">
          <path d="m6 6 12 12M18 6 6 18"/>
        </svg>
      </button>
    </div>
    {hint && <p id="install-banner-hint" role="status"
      className="install-banner-inner mx-auto max-w-2xl pb-3 text-xs leading-relaxed text-muted-foreground">
      {hint}
    </p>}
  </aside>;
}
