#!/usr/bin/env python3
"""Static release metadata regression; never executes build or package code.

Run: python3 -I -B tests/release-metadata.py [project-root]
Historical evidence, dependency versions, and upstream game versions are not
application version inputs and must not be rewritten by release synchronization.
"""

import hashlib
import json
from pathlib import Path
import re
import sys
import unittest

ROOT = Path(sys.argv.pop(1)).resolve() if len(sys.argv) > 1 else Path(__file__).resolve().parents[1]
VERSION = "0.3.1"
GAME_VERSIONS = {
    "table-tennis": "1.0", "lan-master": "1.09", "lawn-mower": "1.12",
    "void-lancer": "1.0.0", "cargo-shift": "0.1.0", "thwaite": "0.04", "croom": "0.02a",
}


def text(path):
    return (ROOT / path).read_text(encoding="utf-8")


def data(path):
    return json.loads(text(path))


def digest(path):
    return hashlib.sha256((ROOT / path).read_bytes()).hexdigest()


def compact(value):
    return re.sub(r"\s+", "", value)


class ReleaseMetadata(unittest.TestCase):
    def setUp(self):
        lines = text("packaging/fnos/manifest").splitlines()
        self.manifest = {}
        for line in lines:
            if not line or line.startswith("#"):
                continue
            key, value = line.split("=", 1)
            self.assertNotIn(key, self.manifest, "duplicate manifest field")
            self.manifest[key] = value

    def test_application_versions_and_lock_root(self):
        brand = data("branding/brand.json")
        package = data("web/package.json")
        lock = data("web/package-lock.json")
        self.assertEqual(brand["version"], VERSION)
        self.assertEqual(self.manifest["version"], VERSION)
        self.assertEqual(package["version"], VERSION)
        self.assertEqual(lock["version"], VERSION)
        self.assertEqual(lock["packages"][""]["version"], VERSION)
        self.assertEqual(self.manifest["appname"], brand["id"])
        self.assertEqual(self.manifest["display_name"], brand["name"])
        self.assertEqual(brand["repositoryUrl"], "https://github.com/songdone/XiaoNiuBaWang")
        for field in ("maintainer_url", "distributor_url"):
            self.assertEqual(self.manifest[field], brand["repositoryUrl"])
        for field in ("dependencies", "devDependencies"):
            self.assertEqual(package[field], lock["packages"][""][field])
        self.assertEqual(self.manifest["platform"], "@PLATFORM@")
        self.assertEqual(self.manifest["os_min_version"], "1.2.0401")
        self.assertEqual(self.manifest["disable_authorization_path"], "false")

    def test_six_manifest_sections_match_store_copy(self):
        desc = self.manifest["desc"]
        self.assertEqual(desc.count("<h3>"), 6)
        self.assertEqual(desc.count("</h3>"), 6)
        self.assertTrue(set(re.findall(r"</?([a-z0-9]+)", desc)) <= {"h3", "p", "ul", "li"})
        self.assertNotRegex(desc, r"@(?!PLATFORM)|<script|<img|/Users/|localhost|127\.0\.0\.1")
        store = text("docs/应用中心文案.md")
        intro = store.split("## 应用介绍", 1)[1].split("## 版本更新说明", 1)[0]
        headings = re.findall(r"^### (.+)$", intro, re.M)
        self.assertEqual(headings, re.findall(r"<h3>(.*?)</h3>", desc))
        plain_html = re.sub(r"<[^>]+>", "", desc)
        plain_markdown = re.sub(r"^### |^- ", "", intro, flags=re.M)
        self.assertEqual(compact(plain_html), compact(plain_markdown))
        changelog = store.split("## 版本更新说明", 1)[1].split("## 搜索关键词", 1)[0].strip()
        self.assertEqual(self.manifest["changelog"], changelog)
        self.assertTrue(changelog.startswith(VERSION + " "))

    def test_player_keys_viewport_and_safety_copy(self):
        desc = self.manifest["desc"]
        for term in ("可见窗口", "整台学习机", "虚拟控制", "页内大屏", "Esc", "1P／2P", "按键设置", "手动继续", "文本框", "弹窗", "失焦", "释放输入", "ACL", "关闭或刷新", "仍待实测"):
            self.assertIn(term, desc)
        for mapping in ("A=X", "B=Z", "开始=Enter", "选择=右 Shift", "W/S/A/D", "A=H", "B=G", "开始=U", "选择=T"):
            self.assertIn(mapping, desc)
        mappings = text("web/src/input/mappings.ts")
        for code in ("ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "KeyX", "KeyZ", "Enter", "ShiftRight", "KeyW", "KeyS", "KeyA", "KeyD", "KeyH", "KeyG", "KeyU", "KeyT"):
            self.assertIn("'" + code + "'", mappings)
        wizard = data("packaging/fnos/wizard/install")
        copy = json.dumps(wizard, ensure_ascii=False)
        for term in (VERSION, "七款", "当前", "1P", "2P", "按键设置", "页内大屏", "ACL", "备份", "仍待实测"):
            self.assertIn(term, copy)
        self.assertNotIn("0.2.0", copy)

    def test_seven_unmodified_roms_sources_and_upstream_versions(self):
        catalog = data("web/public/games/catalog.json")["games"]
        provenance = data("third_party/games/provenance.json")["games"]
        self.assertEqual({game["id"]: game["version"] for game in catalog}, GAME_VERSIONS)
        self.assertEqual({game["id"]: game["version"] for game in provenance}, GAME_VERSIONS)
        for game in catalog:
            self.assertFalse(game["romTranslated"])
            self.assertEqual(digest("web/public/games/" + game["filename"]), game["sha256"])
        for game in provenance:
            self.assertFalse(game["rom"]["modified"])
            self.assertTrue(game["source"]["unmodified"])
            self.assertEqual(digest(game["source"]["path"]), game["source"]["sha256"])
            if game["id"] in ("thwaite", "croom"):
                license_text = text("third_party/games/" + game["id"] + "/LICENSE.txt")
                self.assertIn("GNU GENERAL PUBLIC LICENSE", license_text)
                self.assertIn("Version 3", license_text)

    def test_author_credits_and_approved_support_originals(self):
        for path in ("README.md", "docs/应用中心文案.md", "docs/第三方组件.md", "docs/内置游戏授权.md"):
            value = text(path)
            for author in ("Michael Billington", "Shiru", "Riyoway", "VOID LANCER contributors", "Hxyspace", "Cargo Shift contributors", "Damian Yerrick", "Ludwig van Beethoven", "Sara Crickard"):
                self.assertIn(author, value, path + " missing credit")
        self.assertIn("Sara Crickard", self.manifest["desc"])
        approval = data("scripts/support-assets-approved.json")
        self.assertEqual(approval["version"], "0.1.0", "historical approval version must stay unchanged")
        for filename, record in approval["files"].items():
            # Redistributable source deliberately excludes private QR images.
            image = ROOT / "assets/support" / filename
            if image.exists():
                self.assertEqual(digest("assets/support/" + filename), record["sha256"])
                self.assertEqual(image.stat().st_size, record["bytes"])

    def test_dynamic_version_chain_is_not_a_fake_ui_label(self):
        source = text("scripts/make-source.py")
        build = text("scripts/build.py")
        app = text("web/src/App.tsx")
        about = text("web/src/components/AboutDialog.tsx")
        self.assertIn('ROOT / "branding/brand.json"', source)
        self.assertIn('source_module["application_brand"]()["version"]', build)
        self.assertIn("main.version={version}", build)
        self.assertIn('f"xiaoniubawang-{version}-', build)
        self.assertIn("health?.version", app)
        self.assertIn("版本 ${version}", about)
        self.assertNotIn(VERSION, app + about, "UI must report real server version")

    def test_current_docs_distinguish_historical_and_unverified_evidence(self):
        for path in ("README.md", "docs/使用说明.md", "docs/安装更新卸载.md", "docs/应用中心文案.md", "docs/第三方组件.md", "docs/内置游戏授权.md", "docs/兼容性报告.md"):
            self.assertIn(VERSION, text(path))
        report = text("docs/兼容性报告.md")
        for term in ("156", "原生系统全屏成功未验证", "合成事件", "块设备", "对应源码", "内部交接", "不能", "待验证"):
            self.assertIn(term, report)
        self.assertNotRegex(report, r"主线程|test185|202611\d\d-fpk-|roundtrip-0\d")
        install = text("docs/安装更新卸载.md")
        self.assertIn("先确认备份", install)
        self.assertIn("当前平台提交要求", install)
        self.assertIn("不据此断言", install)
        self.assertNotIn("必须开发者证书才能上架", install)


if __name__ == "__main__":
    unittest.main(verbosity=2)
