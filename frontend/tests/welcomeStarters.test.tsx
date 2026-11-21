// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import WelcomeStarters from "../src/components/WelcomeStarters";
import DesktopWelcomeScene from "../src/components/DesktopWelcomeScene";

let host: HTMLDivElement, root: Root;
let desktop = true, reduced = false;
const choose = vi.fn();
const render = async (paused = false) => act(async () => {
  root.render(<WelcomeStarters busy={false} paused={paused} onChoose={choose} />);
});
const advance = async (ms: number) => act(async () => { vi.advanceTimersByTime(ms); });
const slots = () => [...host.querySelectorAll('button')].map(e => e.getAttribute('data-slot'));

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  desktop = true; reduced = false; choose.mockClear();
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('min-width') ? desktop : reduced,
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
  }));
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  expect(vi.getTimerCount()).toBe(0);
  host.remove(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

it('桌面逐条出现并循环；推荐按钮的身份及选择参数不随视觉位置改变', async () => {
  await render();
  expect(host.querySelectorAll('[data-revealed="true"]')).toHaveLength(0);
  await advance(500);
  expect(host.querySelectorAll('[data-revealed="true"]')).toHaveLength(1);
  await advance(2200);
  expect(host.querySelectorAll('[data-revealed="true"]')).toHaveLength(3);
  await advance(2500);
  expect(host.firstElementChild?.getAttribute('data-phase')).toBe('exit');
  await advance(430);
  expect(slots()).toEqual(['2', '0', '1']);
  await act(async () => (host.querySelectorAll('button')[0] as HTMLButtonElement).click());
  expect(choose).toHaveBeenCalledExactlyOnceWith(0);
});

it('暂停或键盘聚焦时停止重排，恢复后可继续；卸载清除全部定时器', async () => {
  await render(); await advance(3000);
  await render(true);
  const pausedSlots = slots();
  await advance(10000);
  expect(slots()).toEqual(pausedSlots);
  expect(vi.getTimerCount()).toBe(0);
  await render(false); await advance(2200); await advance(430);
  expect(slots()).not.toEqual(pausedSlots);
  await act(async () => (host.querySelector('button') as HTMLButtonElement).focus());
  const focusedSlots = slots();
  await advance(10000);
  expect(slots()).toEqual(focusedSlots);
  expect(vi.getTimerCount()).toBe(0);
});

it.each(['phone', 'reduced'])('%s 模式显示全部入口，不创建轮播定时器', async mode => {
  desktop = mode !== 'phone'; reduced = mode === 'reduced';
  await render();
  expect(host.querySelectorAll('[data-revealed="true"]')).toHaveLength(3);
  expect(vi.getTimerCount()).toBe(0);
  await advance(10000);
  expect(slots()).toEqual(['0','1','2']);
});

it('旧视频卸载后的播放失败不会暂停新首页', async () => {
  let rejectOld!: (reason: Error) => void;
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementationOnce(() => new Promise<void>((_, reject) => { rejectOld = reject; }))
    .mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  const onPause = vi.fn();
  await act(async () => root.render(<DesktopWelcomeScene paused={false} onPausedChange={onPause} />));
  await act(async () => root.render(null));
  await act(async () => root.render(<DesktopWelcomeScene paused={false} onPausedChange={onPause} />));
  await act(async () => rejectOld(new Error('old source interrupted')));
  expect(onPause).not.toHaveBeenCalled();
  expect(host.querySelector('video')).not.toBeNull();
});

it('浏览器阻止当前视频播放时，暂停状态同步到共享控制', async () => {
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockRejectedValue(new DOMException('blocked', 'NotAllowedError'));
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  const onPause = vi.fn();
  await act(async () => root.render(<DesktopWelcomeScene paused={false} onPausedChange={onPause} />));
  expect(onPause).toHaveBeenCalledExactlyOnceWith(true);
});
