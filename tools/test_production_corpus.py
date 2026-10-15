"""Regression coverage for archive/test references hiding unused production code."""
import tempfile
import unittest
from pathlib import Path

from production_corpus import iter_production_files


class ProductionCorpusTest(unittest.TestCase):
    def test_runtime_bridges_and_registrations_but_not_history_or_tests(self):
        included = {
            "phlip-web/public/scripts/channel/board-home.js",
            "phlip-web/public/index.html",
            "phlip-android/app/src/main/java/Bridge.kt",
            "phlip-android/app/src/main/AndroidManifest.xml",
            "phlip-hosting/tunnel/src/main/resources/META-INF/services/Provider",
            "phlip-hosting/server/src/main/assets/edge/worker.js",
            "phlip-ios/Phlip/AshNativeBridge.swift",
        }
        excluded = {
            "archive/web/old.js", "feature-planning/old.js",
            "phlip-web/demo-host/test.js", "phlip-android/tools/selftest.js",
            "phlip-android/app/src/androidTest/java/Bridge.kt",
            "phlip-hosting/server/src/test/java/Test.kt",
            "phlip-hosting/server/src/testFixtures/assets/public/index.html",
            "phlip-hosting/e2e/node_modules/test.js",
            "phlip-ios/DerivedData/generated.swift",
            "phlip-ios/Phlip/Tests/BridgeTests.swift",
            "phlip-ios/Phlip/UITests/Flow.swift",
        }
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for name in included | excluded:
                path = root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("retiredFunction()", encoding="utf-8")
            self.assertEqual({p.relative_to(root).as_posix()
                              for p in iter_production_files(root)}, included)


if __name__ == "__main__":
    unittest.main()
