import { useEffect, useRef, useState } from "react";

/** 手机端和减少动态效果模式保留静态界面，不下载背景视频。 */
export default function DesktopWelcomeScene({ paused, onPausedChange, variant = "welcome" }: {
  paused: boolean; onPausedChange: (paused: boolean) => void; variant?: "welcome" | "workspace";
}) {
  const [enabled, setEnabled] = useState(() => typeof window.matchMedia === "function"
    && window.matchMedia("(min-width: 761px)").matches
    && !window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const desktop = window.matchMedia("(min-width: 761px)");
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setEnabled(desktop.matches && !reducedMotion.matches);
    sync();
    desktop.addEventListener("change", sync);
    reducedMotion.addEventListener("change", sync);
    return () => {
      desktop.removeEventListener("change", sync);
      reducedMotion.removeEventListener("change", sync);
    };
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let active = true;
    const syncPlayback = () => {
      if (paused || document.hidden) video.pause();
      else void video.play().catch((error: unknown) => {
        // 切换页面或卸载造成的旧播放中断，不应暂停新页面的共享动效。
        if (active && !(error instanceof DOMException && error.name === "AbortError")) onPausedChange(true);
      });
    };
    syncPlayback();
    document.addEventListener("visibilitychange", syncPlayback);
    return () => { active = false; document.removeEventListener("visibilitychange", syncPlayback); };
  }, [enabled, paused, onPausedChange]);

  if (!enabled) return null;

  const video = <video ref={videoRef} className="welcome-scene-video" aria-hidden="true"
      autoPlay={!paused} muted loop playsInline preload="metadata"
      poster="/assets/cofounder-inspired/hero-landscape.webp">
      <source src="/assets/cofounder-inspired/cofounder-hero.webm" type="video/webm" />
      <source src="/assets/cofounder-inspired/cofounder-hero.mp4" type="video/mp4" />
    </video>;
  const label = variant === "workspace" ? "页面动画" : "首页动画";
  return <>
    {variant === "workspace" ? <div className="workspace-scene" aria-hidden="true">{video}</div> : video}
    <button type="button" className={`welcome-motion-toggle${variant === "workspace" ? " workspace-motion-toggle" : ""}`} aria-pressed={paused}
      aria-label={`${paused ? "播放" : "暂停"}${label}`} onClick={() => onPausedChange(!paused)}>
      <svg viewBox="0 0 16 16" aria-hidden="true">
        {paused ? <path d="m5 3 8 5-8 5Z" /> : <path d="M5 3v10M11 3v10" />}
      </svg>
      {paused ? "播放动态" : "暂停动态"}
    </button>
  </>;
}
