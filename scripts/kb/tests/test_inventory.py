"""Safety tests for scripts/kb/inventory.py. Run: python3 -I -m unittest discover -s scripts/kb/tests"""
import json
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import inventory  # noqa: E402


class InventoryTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name) / "src"
        self.root.mkdir()
        self.addCleanup(self._tmp.cleanup)

    def run_manifest(self):
        return inventory.build_manifest([self.root])

    def by_name(self, manifest):
        return {r["name"]: r for r in manifest["records"]}

    def test_secret_named_files_are_sensitive_and_never_hashed(self):
        for name in (".env", ".env.local", ".app.env", "hostinger-recovery-codes.txt", "api_token.txt", "server.pem", "kaggle.json"):
            (self.root / name).write_text("TOP-SECRET-VALUE")
        recs = self.by_name(self.run_manifest())
        for name in (".env", ".env.local", ".app.env", "hostinger-recovery-codes.txt", "api_token.txt", "server.pem", "kaggle.json"):
            self.assertEqual(recs[name]["class"], "SENSITIVE", name)
            self.assertEqual(recs[name]["sha256"], "not-computed", name)

    def test_secret_file_content_is_never_read(self):
        real_open = open
        opened = []

        def spy(file, *a, **k):
            opened.append(str(file))
            return real_open(file, *a, **k)

        (self.root / ".env").write_text("x")
        (self.root / "notes.md").write_text("hello")
        inventory.open = spy  # module-level shadow of the builtin
        try:
            self.run_manifest()
        finally:
            del inventory.open
        self.assertTrue(any(p.endswith("notes.md") for p in opened))
        self.assertFalse(any(p.endswith(".env") for p in opened))

    def test_default_class_is_private_never_public(self):
        (self.root / "readme.md").write_text("hi")
        (self.root / "logo.png").write_bytes(b"\x89PNG")
        manifest = self.run_manifest()
        self.assertEqual(manifest["summary"]["by_class"]["PUBLIC"], 0)
        self.assertTrue(all(r["class"] == "PRIVATE" for r in manifest["records"]))

    def test_duplicates_and_name_conflicts(self):
        (self.root / "a").mkdir()
        (self.root / "b").mkdir()
        (self.root / "a" / "plan.md").write_text("same")
        (self.root / "b" / "plan.md").write_text("same")
        (self.root / "b" / "other.md").write_text("different")
        (self.root / "a" / "other.md").write_text("changed")
        m = self.run_manifest()
        self.assertEqual(m["summary"]["duplicate_files"], 2)
        conflicts = [r for r in m["records"] if r["name_conflict"]]
        self.assertEqual({r["name"] for r in conflicts}, {"other.md"})

    def test_zip_is_listed_not_extracted_and_flags_unsafe_paths(self):
        zp = self.root / "bundle.zip"
        with zipfile.ZipFile(zp, "w") as zf:
            zf.writestr("docs/readme.md", "hello")
            zf.writestr("../escape.txt", "x")
            zf.writestr("tool.exe", "MZ")
            zf.writestr(".env", "SECRET")
        m = self.run_manifest()
        rec = self.by_name(m)["bundle.zip"]
        self.assertEqual(rec["zip"]["entries"], 4)
        self.assertGreaterEqual(rec["zip"]["unsafe_paths"], 1)
        self.assertEqual(rec["zip"]["executables"], 1)
        self.assertFalse((self.root / "docs").exists(), "zip must not be extracted")
        self.assertFalse((self.root.parent / "escape.txt").exists())

    def test_corrupt_zip_is_reported_not_fatal(self):
        (self.root / "broken.zip").write_bytes(b"not a zip")
        rec = self.by_name(self.run_manifest())["broken.zip"]
        self.assertIsNotNone(rec["zip"]["error"])

    def test_refuses_to_write_inside_a_git_repo(self):
        repo = Path(self._tmp.name) / "repo"
        (repo / ".git").mkdir(parents=True)
        rc = inventory.main([str(self.root), "--out", str(repo / "out")])
        self.assertEqual(rc, 2)
        self.assertFalse((repo / "out").exists())

    def test_outputs_are_valid_json(self):
        (self.root / "a.md").write_text("x")
        out = Path(self._tmp.name) / "out"
        self.assertEqual(inventory.main([str(self.root), "--out", str(out)]), 0)
        data = json.loads((out / "manifest.json").read_text())
        self.assertEqual(data["summary"]["files"], 1)


if __name__ == "__main__":
    unittest.main()
