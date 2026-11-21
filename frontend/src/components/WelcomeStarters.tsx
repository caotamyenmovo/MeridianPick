import { useEffect, useRef, useState, type CSSProperties } from "react";
import Icon from "./Icon";

const IDEAS = [
  { title: "旅行好物，一起挑", description: "看看 12 款装备 · 单件 500 元内", category: "旅行装备" },
  { title: "日常好声音", description: "挑一副适合通勤的耳机", category: "日常通勤" },
  { title: "小预算，也出彩", description: "发现 100 元以内的好物", category: "百元好物" },
];

type Props = { busy: boolean; paused: boolean; onChoose: (index: number) => void };

/** 桌面使用透视通知轮播；手机保留原来的三个推荐入口。 */
export default function WelcomeStarters({ busy, paused, onChoose }: Props) {
  const [motionEnabled, setMotionEnabled] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [order, setOrder] = useState([0, 1, 2]);
  const [revealed, setRevealed] = useState(0);
  const revealedRef = useRef(0);
  const [phase, setPhase] = useState("idle");

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const desktop = window.matchMedia("(min-width: 761px)");
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setMotionEnabled(desktop.matches && !reduced.matches && !document.hidden);
    sync();
    desktop.addEventListener("change", sync);
    reduced.addEventListener("change", sync);
    document.addEventListener("visibilitychange", sync);
    return () => {
      desktop.removeEventListener("change", sync);
      reduced.removeEventListener("change", sync);
      document.removeEventListener("visibilitychange", sync);
    };
  }, []);

  const stopped = !motionEnabled || paused || hovered || focused || busy;
  useEffect(() => {
    // 停止期间显示所有入口，聚焦或悬停的按钮不会被轮播移走。
    if (stopped) {
      setPhase("idle");
      return;
    }
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const later = (fn: () => void, delay: number) => {
      const timer = setTimeout(() => { timers.delete(timer); fn(); }, delay);
      timers.add(timer);
    };
    const cycle = () => {
      setPhase("exit");
      later(() => {
        setOrder(items => [items[1], items[2], items[0]]);
        setPhase("enter");
        later(() => setPhase("idle"), 520);
        later(cycle, 2200);
      }, 430);
    };
    if (revealedRef.current < IDEAS.length) {
      for (let index = revealedRef.current; index < IDEAS.length; index++) {
        later(() => { revealedRef.current = index + 1; setRevealed(index + 1); }, 500 + index * 1100);
      }
      later(cycle, 5200);
    } else later(cycle, 2200);
    return () => timers.forEach(clearTimeout);
  }, [stopped]);

  return <div className="welcome-ideas" data-motion={stopped ? "paused" : "playing"} data-phase={phase}
    onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
    onFocusCapture={() => setFocused(true)}
    onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}>
    {IDEAS.map((idea, index) => {
      const slot = order.indexOf(index);
      return <button key={index} disabled={busy} onClick={() => onChoose(index)}
        aria-label={`${idea.title}，${idea.description}`} data-slot={slot}
        data-revealed={stopped || index < revealed}
        style={{ "--starter-slot": slot } as CSSProperties}>
        <span className="starter-icon">{index === 1
          ? <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 14v-3a8 8 0 0 1 16 0v3" /><rect x="3" y="12" width="4" height="8" rx="2" /><rect x="17" y="12" width="4" height="8" rx="2" /></svg>
          : <Icon name={index === 0 ? "bag" : "spark"} />}</span>
        <span><strong data-category={idea.category}>{idea.title}</strong><small>{idea.description}</small></span>
        <Icon name="arrow" />
      </button>;
    })}
  </div>;
}
