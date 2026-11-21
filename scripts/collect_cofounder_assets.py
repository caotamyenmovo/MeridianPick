"""收集 Cofounder 公开页面引用的视觉素材，并生成本地预览与来源清单。"""

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from hashlib import sha256
from html import escape, unescape
from html.parser import HTMLParser
import json
import mimetypes
from pathlib import Path
import re
from urllib.parse import parse_qs, quote, unquote, urljoin, urlsplit
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / "assets/references/cofounder"
ORIGIN = "https://cofounder.co"
PAGES = ["/", "/how-to/start", "/how-to/build", "/how-to/sell", "/how-to/scale", "/resources", "/pricing", "/support"]
MEDIA = re.compile(r"\.(?:png|jpe?g|webp|avif|gif|svg|mp4|webm)(?:\?|$)", re.I)
PATHS = re.compile(r'''["'(]((?:https://cofounder\.co)?/[^\s"'<>)]*?\.(?:png|jpg|jpeg|webp|avif|gif|svg|mp4|webm)(?:\?[^\s"'<>)]*)?)["')]''', re.I)


def fetch(url):
    request = Request(url, headers={"User-Agent": "Meridian-Design-Reference/1.0"})
    with urlopen(request, timeout=45) as response:
        return response.read(), response.headers.get_content_type()


class References(HTMLParser):
    def __init__(self):
        super().__init__()
        self.urls = set()
        self.bundles = set()
        self.svg_stack = []
        self.svg_depth = 0
        self.svgs = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        for key in ("src", "href", "poster", "srcset"):
            value = attrs.get(key, "")
            if key == "srcset":
                self.urls.update(part.strip().split(" ")[0] for part in value.split(",") if part.strip())
            elif value:
                self.urls.add(value)
        if tag == "script" and attrs.get("src", "").startswith("/_next/"):
            self.bundles.add(attrs["src"])
        if tag == "link" and attrs.get("rel") == "stylesheet":
            self.bundles.add(attrs.get("href", ""))
        if tag == "svg" or self.svg_depth:
            self.svg_stack.append(self.get_starttag_text())
            if tag == "svg":
                self.svg_depth += 1

    def handle_endtag(self, tag):
        if self.svg_depth:
            self.svg_stack.append(f"</{tag}>")
            if tag == "svg":
                self.svg_depth -= 1
                if not self.svg_depth:
                    self.svgs.append("".join(self.svg_stack))
                    self.svg_stack = []

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)

    def handle_data(self, data):
        if self.svg_depth:
            self.svg_stack.append(escape(data))


def canonical(raw):
    raw = unescape(raw).replace("\\/", "/")
    url = urljoin(ORIGIN, raw)
    parts = urlsplit(url)
    if parts.netloc != "cofounder.co":
        return None
    if parts.path == "/_next/image":
        return canonical(parse_qs(parts.query).get("url", [""])[0])
    if not MEDIA.search(parts.path):
        return None
    path = unquote(parts.path)
    if ".." in Path(path).parts:
        return None
    return ORIGIN + quote(path, safe="/"), path


def category(path):
    if path.endswith((".webm", ".mp4")):
        return "动态背景与视频"
    if "/hero/" in path:
        return "首页主背景"
    if "/books-covers/" in path:
        return "四章封面与插画"
    if "/build-ui-bits/" in path or "/decor/" in path or "/footer/" in path:
        return "像素背景与装饰"
    if "/icon" in path or path.endswith(".svg"):
        return "图标与标识"
    return "页面展示图片"


def main():
    DEST.mkdir(parents=True, exist_ok=True)
    captured_at = datetime.now(ZoneInfo("Asia/Shanghai")).isoformat()
    references, bundles, pages, failures = {}, {}, [], []
    inline = {}

    def add(raw, page):
        item = canonical(raw)
        if item:
            url, path = item
            entry = references.setdefault(url, {"source_url": url, "source_path": path, "pages": set()})
            entry["pages"].add(page)

    for page in PAGES:
        url = ORIGIN + page
        try:
            data, _ = fetch(url)
            source = data.decode("utf-8")
            parser = References()
            parser.feed(source)
            for raw in parser.urls:
                add(raw, page)
            for raw in PATHS.findall(unescape(source).replace('\\"', '"')):
                add(raw, page)
            for bundle in parser.bundles:
                bundles.setdefault(bundle, set()).add(page)
            for svg in parser.svgs:
                fingerprint = sha256(svg.encode()).hexdigest()[:16]
                entry = inline.setdefault(fingerprint, {"source": svg, "pages": set()})
                entry["pages"].add(page)
            raw_file = DEST / "page-source" / (page.strip("/").replace("/", "-") or "home")
            raw_file.parent.mkdir(exist_ok=True)
            raw_file.with_suffix(".html").write_bytes(data)
            pages.append({"page": page, "status": 200, "sha256": sha256(data).hexdigest()})
        except Exception as exc:
            failures.append({"url": url, "error": str(exc)})

    # 部分图标由交互组件的公开脚本引用，只提取图片路径，不执行远端代码。
    for bundle, origins in bundles.items():
        try:
            source = fetch(urljoin(ORIGIN, bundle))[0].decode("utf-8")
            for raw in PATHS.findall(source.replace('\\"', '"')):
                for page in origins:
                    add(raw, page)
        except Exception as exc:
            failures.append({"url": urljoin(ORIGIN, bundle), "error": str(exc)})

    def download(item):
        url, entry = item
        try:
            dest = DEST / "originals" / entry["source_path"].lstrip("/")
            dest.parent.mkdir(parents=True, exist_ok=True)
            if dest.exists():
                data = dest.read_bytes()
                mime = mimetypes.guess_type(dest)[0] or "application/octet-stream"
            else:
                data, mime = fetch(url)
            if not (mime.startswith("image/") or mime.startswith("video/") or mime == "application/octet-stream"):
                raise ValueError(f"非媒体响应: {mime}")
            if not dest.exists():
                dest.write_bytes(data)
            return {**entry, "pages": sorted(entry["pages"]), "local_path": dest.relative_to(DEST).as_posix(), "mime": mime, "bytes": len(data), "sha256": sha256(data).hexdigest(), "category": category(entry["source_path"]), "status": "downloaded"}
        except Exception as exc:
            return {**entry, "pages": sorted(entry["pages"]), "status": "failed", "error": str(exc)}

    with ThreadPoolExecutor(max_workers=4) as pool:
        assets = list(pool.map(download, sorted(references.items())))
    for fingerprint, entry in inline.items():
        svg = entry["source"]
        if "xmlns=" not in svg:
            svg = svg.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"', 1)
        dest = DEST / "inline-icons" / f"{fingerprint}.svg"
        dest.parent.mkdir(exist_ok=True)
        dest.write_text(svg, encoding="utf-8")
        assets.append({"source_url": ORIGIN + sorted(entry["pages"])[0], "source_path": f"inline-svg/{fingerprint}.svg", "pages": sorted(entry["pages"]), "local_path": dest.relative_to(DEST).as_posix(), "mime": "image/svg+xml", "bytes": dest.stat().st_size, "sha256": sha256(dest.read_bytes()).hexdigest(), "category": "页面内嵌图标", "status": "extracted"})

    manifest = {"captured_at": captured_at, "origin": ORIGIN, "scope": "公开导航页面及其直接引用的视觉资源；不含登录后应用或未引用隐藏文件", "license_status": "页面素材的再分发/商用授权未核实；保留来源，不标注为原创", "pages": pages, "page_failures": failures, "assets": assets}
    (DEST / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    cards = []
    downloaded = [a for a in assets if a["status"] != "failed"]
    for item in downloaded:
        path = quote(item["local_path"], safe="/")
        media = f'<video controls preload="none" src="{path}"></video>' if item["mime"].startswith("video/") else f'<img loading="lazy" src="{path}" alt="{escape(item["source_path"])}">'
        cards.append(f'<article data-category="{escape(item["category"])}"><div class="media">{media}</div><h2>{escape(item["source_path"].split("/")[-1])}</h2><p>{escape(item["category"])} · {item["bytes"] // 1024} KB</p><small>{escape(", ".join(item["pages"]))}</small><a href="{path}">打开本地原图</a><a href="{escape(item["source_url"])}">官网来源</a></article>')
    options = ''.join(f'<option>{escape(c)}</option>' for c in sorted({a['category'] for a in downloaded}))
    html = f'''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Cofounder 素材库</title>
<style>*{{box-sizing:border-box}}body{{margin:0;background:#f5f6f7;color:#17212a;font:14px/1.6 system-ui,sans-serif}}header{{padding:24px 32px;background:white;border-bottom:1px solid #ddd}}h1{{font-size:24px;margin:0 0 6px}}header p{{margin:4px 0}}input,select{{font:inherit;padding:9px;border:1px solid #bbc3ca;border-radius:4px;max-width:100%;margin-top:12px}}main{{padding:24px;display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:18px}}article{{background:white;border:1px solid #dce0e3;border-radius:6px;overflow:hidden;padding:12px;min-width:0}}.media{{height:180px;display:flex;align-items:center;justify-content:center;background-color:#e9eff2;background-image:linear-gradient(45deg,#dfe6eb 25%,transparent 25%,transparent 75%,#dfe6eb 75%),linear-gradient(45deg,#dfe6eb 25%,transparent 25%,transparent 75%,#dfe6eb 75%);background-size:20px 20px;background-position:0 0,10px 10px}}img,video{{width:100%;height:100%;object-fit:contain}}h2{{font-size:13px;overflow-wrap:anywhere}}small{{display:block;overflow-wrap:anywhere;color:#657381}}article a{{display:inline-block;color:#185aaa;margin:8px 12px 0 0}}[hidden]{{display:none}}</style>
<header><h1>Cofounder 视觉素材库</h1><p>{len(downloaded)} 个本地素材 · {len(pages)} 个公开页面 · {escape(captured_at)}</p><p>图 1：首页背景见 hero；图 2：章节封面见 books-covers。来源与 SHA-256 记录在 manifest.json。</p><p>素材来自 Cofounder 公开页面，未核实再分发或商用授权。</p><input id="search" placeholder="按文件名或页面搜索" aria-label="搜索素材"><select id="category" aria-label="素材分类"><option value="">全部分类</option>{options}</select></header><main>{''.join(cards)}</main>
<script>const search=document.querySelector('#search'),category=document.querySelector('#category');function filter(){{for(const card of document.querySelectorAll('article'))card.hidden=!(card.textContent.toLowerCase().includes(search.value.toLowerCase())&&(!category.value||card.dataset.category===category.value));}}search.oninput=filter;category.onchange=filter;</script></html>'''
    (DEST / "index.html").write_text(html, encoding="utf-8")
    summary = {"pages": len(pages), "downloaded": sum(a["status"] == "downloaded" for a in assets), "inline_icons": len(inline), "bytes": sum(a.get("bytes", 0) for a in assets), "failed_assets": [a for a in assets if a["status"] == "failed"], "page_failures": failures}
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
