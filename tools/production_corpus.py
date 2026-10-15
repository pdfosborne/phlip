"""Production-only reference corpus shared by the cleanup review tools.

References are conservative evidence, not a reachability proof. Native bridge
strings and registrations count; archives, tests and developer tools do not.
"""
from pathlib import Path
import os

ROOT = Path(__file__).resolve().parents[1]
EXCLUDED = {
    "build", "node_modules", "DerivedData", "xcuserdata", "archive",
    "test", "tests", "androidTest", "commonTest", "androidUnitTest", "iosTest",
    "testFixtures", "Tests", "UITests", "tools", "e2e", "qa-screenshots", "__pycache__",
}
EXTENSIONS = {".js", ".html", ".kt", ".kts", ".java", ".swift", ".m", ".mm",
              ".xml", ".json", ".plist", ".pro"}


def iter_production_files(root=ROOT):
    root = Path(root)
    roots = [root / "phlip-web" / "public", root / "phlip-ios"]
    for project in ("phlip-android", "phlip-hosting"):
        roots.extend(sorted((root / project).glob("*/src")))
    for source in roots:
        for directory, directories, files in os.walk(source):
            directories[:] = sorted(d for d in directories
                                    if d not in EXCLUDED and not d.startswith("."))
            for name in sorted(files):
                path = Path(directory) / name
                if path.suffix in EXTENSIONS or "META-INF" in path.parts:
                    yield path
