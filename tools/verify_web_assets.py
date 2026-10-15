"""Check the classic-script inventory and offline precache without a build step."""
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit, unquote
import re

PUBLIC = Path(__file__).resolve().parents[1] / "phlip-web" / "public"


class References(HTMLParser):
    def __init__(self):
        super().__init__()
        self.scripts = []
        self.assets = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "script" and "src" in attrs:
            self.scripts.append(attrs["src"])
        if tag in {"script", "img", "link"}:
            value = attrs.get("href" if tag == "link" else "src")
            if value:
                self.assets.append(value)


def local_path(url):
    parsed = urlsplit(url)
    return None if parsed.scheme or parsed.netloc or not parsed.path else unquote(parsed.path).removeprefix("./")


def verify():
    refs = References()
    refs.feed((PUBLIC / "index.html").read_text(encoding="utf-8"))
    sw = (PUBLIC / "sw.js").read_text(encoding="utf-8")
    shell_block = re.search(r"const SHELL\s*=\s*\[([\s\S]*?)\];", sw)
    assert shell_block, "Cannot find service-worker SHELL manifest"
    shell = [local_path(p) for p in re.findall(r'"([^"\n]+)"', shell_block[1])]
    scripts = [local_path(p) for p in refs.scripts]
    assert len(scripts) == len(set(scripts)), "Duplicate script load"
    assert len(shell) == len(set(shell)), "Duplicate precache entry"
    for asset in [local_path(p) for p in refs.assets] + shell:
        if asset:
            assert (PUBLIC / asset).exists(), f"Missing packaged asset: {asset}"
    for script in scripts:
        assert script in shell, f"Script missing from offline cache: {script}"
    runtime = {p.relative_to(PUBLIC).as_posix() for p in (PUBLIC / "scripts").rglob("*.js")}
    runtime.discard("scripts/drive/drive-config.local.js")  # optional, developer-owned credentials/config
    assert runtime == {p for p in scripts if p and p.startswith("scripts/")}, "Orphan or unlisted runtime script"
    styles = [local_path(p) for p in re.findall(r'@import\s+url\(["\']?([^"\')]+)', (PUBLIC / "style.css").read_text(encoding="utf-8"))]
    for style in styles:
        style = local_path(style)
        assert style in shell and (PUBLIC / style).is_file(), f"Uncached stylesheet: {style}"
    assert set(styles) == {p.relative_to(PUBLIC).as_posix() for p in (PUBLIC / "styles").glob("*.css")}, "Orphan stylesheet"
    assert scripts.index("scripts/boot/storage.js") < scripts.index("scripts/hand/hand-storage.js"), "Storage aliases load before their owner"
    for retired in ("hand-render", "hand-borrow", "hand-order", "phlippy-fab"):
        assert not any(retired in p for p in scripts), f"Retired script packaged: {retired}"
    print(f"Verified {len(scripts)} scripts, {len(styles)} stylesheets and {len(shell)} offline assets")


if __name__ == "__main__":
    verify()
