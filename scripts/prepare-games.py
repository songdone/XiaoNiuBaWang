#!/usr/bin/env python3
"""Prepare the seven pinned NES games offline; use Python 3 with -I.

Run without arguments to prepare resources, or with --check to verify them without
writing. Inputs are the original downloads or the already-vendored counterparts.
No downloaded code is imported, extracted wholesale, built, or executed.
"""

import argparse
import hashlib
import json
import os
from pathlib import Path
import struct
import sys
import tempfile
import zipfile


ROOT = Path(__file__).resolve().parents[1]
DOWNLOADS = Path("build/20261121-core-01/downloads")
PUBLIC = Path("web/public/games")
VENDOR = Path("third_party/games")
SNAPSHOT_DATE = "2026-11-23"
KEYBOARD = "键盘：方向键=十字键，X=A，Z=B，Enter=START，右 Shift=SELECT。"
SHIRU_INTRODUCTION = (
    'The game is not licensed or endorsed by Nintendo company in any way. It is free\n'
    'of charge, released into Public Domain, and provided "as is", without warranty or\n'
    'responsibility of any kind.'
)
GAMES = [
    {
        "id": "table-tennis", "title": "双人乒乓球 · 8-Bit Table Tennis", "version": "1.0",
        "genre": "体育 / 双人对战", "tags": ["体育", "双人", "自制游戏"], "license": "MIT",
        "description": "两位玩家各执球拍，用上下移动与发球展开像素乒乓对战。需要两名玩家与第二只手柄。",
        "controls": "Enter（START）开始；↑/↓移动 1P 球拍，X（A）发球。2P 使用第二只手柄的上下与 A 键；本作是双人游戏。",
        "homepage": "https://github.com/mike42/8bit-table-tennis/tree/v1.0",
        "romFile": "table_tennis_v1.0.nes", "romMember": None,
        "romUrl": "https://github.com/mike42/8bit-table-tennis/releases/download/v1.0/table_tennis_v1.0.nes",
        "romSha256": "05122457672f95fcf2ee518c3f37e506617725c2d031100b1b1c8b7785068ea3", "romSize": 40976,
        "downloadSha256": "05122457672f95fcf2ee518c3f37e506617725c2d031100b1b1c8b7785068ea3", "downloadSize": 40976,
        "sourceDir": "table-tennis-source-v1.0", "sourceUrl": "https://codeload.github.com/mike42/8bit-table-tennis/zip/refs/tags/v1.0",
        "sourceSha256": "284e2b6fb9ac2c4309c897f2153133fdf024440aac15f89bd5910fb86f7d725f", "sourceSize": 26476,
        "sourceRoot": "8bit-table-tennis-1.0/", "tag": "v1.0", "commit": "7dbc27460e01f5d7fa85228ed4c637bfc9fb7b9b",
        "documents": [("LICENSE", "LICENSE.txt"), ("README.md", "README.upstream.txt")],
        "evidence": [("LICENSE", "Whole-project MIT license and copyright notice", None), ("README.md", "Project scope, two-player game, MIT license, and Brad Smith example-code attribution", None), ("table_tennis.s", "START on title; both gamepads use Up/Down and A to serve", "482-491,585-615,774-856")],
        "permission": "Whole project under MIT; the upstream README credits Brad Smith's NES-ca65-example as its basis.",
        "caveats": ["Two-player game; the second player needs a second controller."],
    },
    {
        "id": "lan-master", "title": "网络大师 · LAN Master", "version": "1.09",
        "genre": "益智 / 连线", "tags": ["益智", "单人", "密码续关", "自制游戏"], "license": "Public Domain",
        "description": "在限时内旋转线路与电脑，让整张网络连通。共 50 关，通关密码可用于续玩。",
        "controls": "方向键移动光标；X（A）与 Z（B）向相反方向旋转，右 Shift（SELECT）转半圈；Enter（START）确认或打开暂停菜单。记录通关密码，在主菜单 CODE 输入可续关。",
        "homepage": "https://shiru.untergrund.net/files/nes/lan_master.zip",
        "romFile": "lan_master.zip", "romMember": "lan_master/Lan_Master.nes",
        "romUrl": "https://shiru.untergrund.net/files/nes/lan_master.zip",
        "romSha256": "becfeafb80479c330333c9e9385417f68f3c88e85443dfb37b05ae9283f3ea45", "romSize": 40976,
        "downloadSha256": "79410cc133f1100d2fe5409fd49297a62afc748aeeb5faccb8fe69c68c16e6aa", "downloadSize": 1126553,
        "sourceDir": "lan-master-source", "sourceUrl": "https://shiru.untergrund.net/files/src/lan_master_src.zip",
        "sourceSha256": "d4058bd0f6d31fbd9ba71b2ec15e9646f00520de075c9c18f8520e8d18e0b3ee", "sourceSize": 85742,
        "sourceRoot": "lan_master_src/", "tag": None, "commit": None,
        "manualMember": "lan_master/manual.pdf", "documents": [],
        "evidence": [("game.asm", "Whole game and source public-domain declaration", "1-4"), ("game.asm", "START pause, A/B quarter rotations, SELECT half-turn, D-pad cursor", "825-905"), ("mainmenu.asm", "A/B/START menu confirmation and code entry", "35-57,370-390")],
        "permission": "Shiru declares the whole game and its source code Public Domain in game.asm line 4; the official manual independently declares the game Public Domain and credits Shiru for code, graphics, and music.",
        "caveats": ["Official downloads have no version tag. These exact archive and ROM bytes are pinned by SHA-256.", "The official development notes mention a 2015 pause fix; version 1.09 is independently verified in the source and the ROM's embedded text.", "Gameplay is inspired by NetWalk; the official notes credit Shiru's own graphics and music."],
    },
    {
        "id": "lawn-mower", "title": "欢乐割草 · Lawn Mower", "version": "1.12",
        "genre": "街机 / 动作", "tags": ["街机", "单人", "自制游戏"], "license": "Public Domain",
        "description": "驾驶持续前进的割草机修剪十片草坪；留意油量，拾取油罐，并避开耗油的花丛与石块。",
        "controls": "Enter（START）开始或暂停；方向键改变行进方向；按住 X（A）或 Z（B）加速。割草机持续移动；收集油罐补充燃料，穿过花丛和石块会额外耗油。",
        "homepage": "https://shiru.untergrund.net/files/nes/lawn_mower.zip",
        "romFile": "lawn_mower.zip", "romMember": "Lawn_Mower.nes",
        "romUrl": "https://shiru.untergrund.net/files/nes/lawn_mower.zip",
        "romSha256": "181ef3ff1769a85ae98736e02809e65e5d758b453ebb43ec4b9fe60c93ad224c", "romSize": 24592,
        "downloadSha256": "af7378b522a7d11efd0306aebf15c193a2de31f5a7b130919699d4f1e7219f70", "downloadSize": 751619,
        "sourceDir": "lawn-mower-source", "sourceUrl": "https://shiru.untergrund.net/files/src/lawn_mower_src.zip",
        "sourceSha256": "8986e2057ad0ef3ccc2ab8bb39c9c54819ff402980b3468efde89da15a5d9dd5", "sourceSize": 263681,
        "sourceRoot": "lawn_mower_src/", "tag": None, "commit": None,
        "manualMember": "manual.pdf", "documents": [],
        "evidence": [("game.asm", "Whole game and source public-domain declaration", "1-4"), ("game.asm", "D-pad steering, hold A/B to accelerate, START pause", "650-760"), ("title.asm", "START begins play", "229-234")],
        "permission": "Shiru declares the whole game and its source code Public Domain in game.asm line 4; the official manual independently declares the game Public Domain and credits Shiru for code, graphics, and music.",
        "caveats": ["Official downloads have no version tag. These exact archive and ROM bytes are pinned by SHA-256.", "The official notes describe inspiration from older lawn-mower games and palette differences between emulators."],
    },
    {
        "id": "void-lancer", "title": "虚空枪骑兵 · VOID LANCER", "version": "1.0.0",
        "genre": "纵向射击", "tags": ["射击", "单人", "原创音乐", "自制游戏"], "license": "MIT",
        "description": "穿越三种太空关卡，升级武器、使用脉冲炸弹，并迎战最终首领。包含原创像素画与六首原创芯片音乐。",
        "controls": "Enter（START）开始或重新开始；方向键移动；X（A）射击；Z（B）使用脉冲炸弹。初始拥有 3 条生命与 3 枚炸弹。",
        "homepage": "https://github.com/Riyoway/void-lancer-nes/tree/v1.0.0",
        "romFile": "VOID-LANCER-v1.0.0.nes", "romMember": None,
        "romUrl": "https://github.com/Riyoway/void-lancer-nes/releases/download/v1.0.0/VOID-LANCER-v1.0.0.nes",
        "romSha256": "5eb801aca68131a3d17fa82d8901d46f6098b878d1e00cd1c47d00c001c2405a", "romSize": 40976,
        "downloadSha256": "5eb801aca68131a3d17fa82d8901d46f6098b878d1e00cd1c47d00c001c2405a", "downloadSize": 40976,
        "sourceDir": "void-lancer-source-v1.0.0", "sourceUrl": "https://codeload.github.com/Riyoway/void-lancer-nes/zip/refs/tags/v1.0.0",
        "sourceSha256": "e7df30c2cd48a7008418c98840161d4d5ca168cddf50c4eb6b1c307f56786b04", "sourceSize": 107080,
        "sourceRoot": "void-lancer-nes-1.0.0/", "tag": "v1.0.0", "commit": "3eb87532f11d30dba2b7a8e3832a52213ab6b62b",
        "documents": [("LICENSE", "LICENSE.txt"), ("README.md", "README.upstream.txt"), ("docs/SOUNDTRACK.md", "SOUNDTRACK.upstream.txt")],
        "evidence": [("LICENSE", "Whole-project MIT license and copyright notice", None), ("README.md", "Original art/code/music policy, controls, three lives and three bombs", None), ("docs/SOUNDTRACK.md", "Original six-track 2A03 soundtrack; no commercial melodies or samples", None)],
        "permission": "MIT for the project, including its original graphics and synthesized soundtrack. README and docs/SOUNDTRACK.md explicitly document originality. External historical references are excluded by the upstream license note and are not bundled as game assets.",
        "caveats": ["Upstream targets NTSC; its own control-flow smoke test is not a cycle-accurate PPU/APU test."],
    },
    {
        "id": "cargo-shift", "title": "仓库推箱 · Cargo Shift", "version": "0.1.0",
        "genre": "益智 / 推箱子", "tags": ["益智", "单人", "推箱子", "自制游戏"], "license": "MIT",
        "description": "将箱子逐一推到目标点，挑战 18 个原创仓库关卡。支持撤销和重开，考验空间规划与推动顺序。",
        "controls": "Enter（START）开始或打开暂停菜单；方向键移动并推箱；Z（B）撤销；X（A）打开重开确认。菜单用 ↑/↓ 或右 Shift（SELECT）切换，Enter 确认，Z 返回。",
        "homepage": "https://github.com/Hxyspace/cargo-shift/tree/v0.1.0",
        "romFile": "cargo_shift.nes", "romMember": None,
        "romUrl": "https://github.com/Hxyspace/cargo-shift/releases/download/v0.1.0/cargo_shift.nes",
        "romSha256": "d1a6deb7528d5349b69b02fe918fba8fa9e7fdfbd5d8be455d6b9d173d7545ef", "romSize": 40976,
        "downloadSha256": "d1a6deb7528d5349b69b02fe918fba8fa9e7fdfbd5d8be455d6b9d173d7545ef", "downloadSize": 40976,
        "sourceDir": "cargo-shift-source-v0.1.0", "sourceUrl": "https://codeload.github.com/Hxyspace/cargo-shift/zip/refs/tags/v0.1.0",
        "sourceSha256": "21053e7af03c5eb0e732eb21086e325340e2e82accd2c9ee3f5dce51a396521c", "sourceSize": 87574,
        "sourceRoot": "cargo-shift-0.1.0/", "tag": "v0.1.0", "commit": "6bd3b0a92213914e09f744c76308f5e9d569ce00",
        "documents": [("LICENSE", "LICENSE.txt"), ("README.md", "README.upstream.txt"), ("docs/LEVELS.md", "LEVELS.upstream.txt")],
        "evidence": [("LICENSE", "Whole-project MIT license and copyright notice", None), ("README.md", "18 original levels, MIT license, release ROM SHA-256 and hardware limits", None), ("docs/LEVELS.md", "Original level-design declaration and retained inspiration attribution", "1-11"), ("src/cargo_shift/main.c", "START title/pause, B undo, A retry confirmation, menu controls", "85-201"), ("src/common/nes.c", "Synthesized APU effects; direct pulse-channel register writes", "151-165"), ("assets/cargo_shift/sprites.png", "Project sprite source, covered by repository MIT license", None), ("assets/cargo_shift/levels.json", "Project level data, covered by repository MIT license", None)],
        "permission": "Whole project under MIT. Original sprites and levels are present in the tagged source; docs/LEVELS.md declares original levels and retains its design-inspiration credit. Effects are synthesized through NES APU register writes in src/common/nes.c.",
        "caveats": ["NTSC target; PAL is explicitly unverified upstream. No in-game battery save.", "Upstream README independently publishes the exact bundled ROM SHA-256."],
    },
    {
        "id": "thwaite", "title": "烟花守卫 · Thwaite", "version": "0.04",
        "genre": "街机 / 防守", "tags": ["街机", "单人", "双人合作", "自制游戏"], "license": "GPL-3.0-or-later",
        "description": "移动准星，从左右发射井放出烟花拦截来袭导弹，保护小镇。支持单人、双人合作与练习模式；画面包含闪烁效果。",
        "controls": "Enter（START）跳过声明、确认菜单或暂停；↑/↓选择模式。单人用方向键移动准星，Z（B）从左井发射，X（A）从右井发射。双人合作需要两只手柄，各自 A/B 均从对应发射井发射。练习中暂停后右 Shift（SELECT）结束练习。",
        "homepage": "https://github.com/pinobatch/thwaite-nes/tree/v0.04",
        "downloadDir": "build/20261123-games-01/download", "romDownloadId": "thwaite-rom",
        "romFile": "thwaite.nes", "romMember": None,
        "romUrl": "https://github.com/pinobatch/thwaite-nes/releases/download/v0.04/thwaite.nes",
        "romSha256": "a2df24d9c9f72e56c2fdc4c703becc47a5700ad0158da8208247635ebeb3779c", "romSize": 24592,
        "downloadSha256": "a2df24d9c9f72e56c2fdc4c703becc47a5700ad0158da8208247635ebeb3779c", "downloadSize": 24592,
        "sourceDir": "thwaite-source", "sourceUrl": "https://codeload.github.com/pinobatch/thwaite-nes/zip/refs/tags/v0.04",
        "sourceSha256": "222f392b417185435f447ae5f17a2461d9bdd82c8b9a8e0d263ce6a97a911173", "sourceSize": 142346,
        "sourceRoot": "thwaite-nes-0.04/", "tag": "v0.04", "commit": "ccd27ccbe3e201755b86c1b5f932b2e11ba74110",
        "documents": [("LICENSE.txt", "LICENSE.txt"), ("README.md", "README.upstream.txt"), ("USAGE.html", "USAGE.upstream.txt"), ("makefile", "makefile.upstream.txt"), ("src/musicseq.s", "musicseq.upstream.txt")],
        "evidence": [("LICENSE.txt", "Complete upstream GPL version 3 license", None), ("README.md", "Whole-program GPL-3.0-or-later grant, program/graphics/music credits, build requirements and flicker warning", "17-50"), ("USAGE.html", "Official gamepad controls, modes and manual permission/credits", "48-110"), ("makefile", "Tagged build scripts and both NROM-128/NROM-256 targets retained; published ROM is NROM-128", "12-18,101-108"), ("src/nrom128.s", "Source for exact 16 KiB PRG / 8 KiB CHR mapper-0 header", "1-8"), ("src/main.s", "Program GPL notice and gamepad firing logic", "1-21,458-491"), ("src/musicseq.s", "Damian Yerrick music data notice and Beethoven Pathetique melody attribution; synthesized note data, not a commercial recording", "1-11,155-157,308-312"), ("tilesets/maingfx.png", "Tagged main graphics source retained in complete source archive", None), ("tilesets/cuthouses.png", "Tagged cutscene graphics source retained in complete source archive", None)],
        "permission": "The tagged README and USAGE.html license the accompanying whole game GPL version 3 or later and credit Damian Yerrick for program, graphics and music, with extra music credited to Ludwig van Beethoven. The full GPL and unmodified corresponding tagged source, including build scripts, graphics and music data, are bundled. No source-free ROM exception is claimed for Thwaite.",
        "permissionQuote": "This program is free software: you can redistribute it and/or modify\nit under the terms of the GNU General Public License as published by\nthe Free Software Foundation, either version 3 of the License, or\n(at your option) any later version.",
        "credits": {"program": ["Damian Yerrick"], "graphics": ["Damian Yerrick"], "music": ["Damian Yerrick", "Ludwig van Beethoven (extra music)"]},
        "caveats": ["Official v0.04 release asset thwaite.nes is NROM-128, despite the tagged makefile naming its NROM-256 target thwaite.nes; the original release bytes and complete tag are retained, without claiming a bit-identical rebuild.", "Graphics flicker; preserve the upstream photosensitive-seizure warning. SNES Mouse support is upstream functionality, not a claim of this application's mouse support.", "Source credits historical concept/setting and musical rhythm inspiration; these references are not distributed as third-party ROMs, artwork or sampled audio. The exact whole-program GPL grant, not a blanket originality claim, is the distribution basis."],
    },
    {
        "id": "croom", "title": "记忆翻牌 · Concentration Room", "version": "0.02a",
        "genre": "益智 / 记忆配对", "tags": ["益智", "单人", "双人轮流", "自制游戏"], "license": "GPL-3.0-or-later",
        "description": "翻开两张卡片，记住图案并找出相同的一对。可选 10、20、36、52 或 72 张卡片，提供故事、单人、双人轮流与电脑对战模式。",
        "controls": "菜单用 ↑/↓选择，Enter（START）或 X（A）确认，Z（B）返回可返回的子菜单；游戏中方向键移动光标，X（A）翻牌，Z（B）随机移动光标。双人可共用一只手柄或使用两只手柄，交接时下一位同时按 A+B（键盘 X+Z）。",
        "homepage": "https://github.com/pinobatch/croom-nes/tree/v0.02a",
        "downloadDir": "build/20261123-games-01/download", "romDownloadId": "croom-rom",
        "romFile": "croom.nes", "romMember": None,
        "romUrl": "https://github.com/pinobatch/croom-nes/releases/download/v0.02a/croom.nes",
        "romSha256": "2ce17df1ad66a8a0533c0a8739f5b5ebe275c264924bbe350c42c5ac0394f20e", "romSize": 24592,
        "downloadSha256": "2ce17df1ad66a8a0533c0a8739f5b5ebe275c264924bbe350c42c5ac0394f20e", "downloadSize": 24592,
        "sourceDir": "croom-source", "sourceUrl": "https://codeload.github.com/pinobatch/croom-nes/zip/refs/tags/v0.02a",
        "sourceSha256": "b83fe31dd5ece865215a4d3b4fb48cf673d0990f162edac52ff21bdd7c327e9f", "sourceSize": 91087,
        "sourceRoot": "croom-nes-0.02a/", "tag": "v0.02a", "commit": "209e628564ab890d05c188e7c84f80217088aa5a",
        "documents": [("LICENSE.txt", "LICENSE.txt"), ("README.md", "README.upstream.txt"), ("makefile", "makefile.upstream.txt"), ("src/musicseq.s", "musicseq.upstream.txt")],
        "evidence": [("LICENSE.txt", "Complete upstream GPL version 3 license", None), ("README.md", "Whole-program GPL-3.0-or-later with explicit exact-published-iNES/UNIF source-code exemption; modes and retained historical/font inspiration credits", None), ("src/litetitle.s", "Fixed-tag exact-ROM exception flag and program/graphics credits: Damian Yerrick and Sara Crickard; menu/instruction text", "23-26,127-132,749-779"), ("src/memorygame.s", "D-pad cursor, A flips, B random cursor, A+B handoff", "87-138,247-314,704-727"), ("src/litemain.s", "GPL program notice and NROM-128 header", "1-40"), ("src/musicseq.s", "Damian Yerrick synthesized music data and permissive source-file notice", "1-55"), ("makefile", "Complete tagged build rules retained with tools/shuffle.py and graphics converters", None), ("tilesets/gamegfx.png", "Tagged game graphics source; whole-program license and in-ROM art credits retained", None), ("tilesets/titlegfx.png", "Tagged title graphics source retained; no cover extracted for public use", None)],
        "permission": "The fixed-tag README licenses the accompanying whole program GPL version 3 or later and explicitly permits exact iNES/UNIF copies as published by Damian Yerrick without source code. Only the exact official v0.02a iNES ROM is bundled. We include the complete corresponding tagged source and full GPL regardless. Fixed-tag src/litetitle.s credits program by Damian Yerrick and graphics by Damian Yerrick and Sara Crickard; musicseq.s credits Damian Yerrick.",
        "permissionQuote": "The accompanying program is free software: you can redistribute it and/or modify it under the terms of the [GNU General Public License], version 3 or later. As a special exception, you may copy and distribute exact copies of the program, as published by Damian Yerrick, in iNES or UNIF executable form without source code.",
        "credits": {"program": ["Damian Yerrick"], "graphics": ["Damian Yerrick", "Sara Crickard"], "music": ["Damian Yerrick"]},
        "exactRomException": "As a special exception, you may copy and distribute exact copies of the program, as published by Damian Yerrick, in iNES or UNIF executable form without source code.",
        "caveats": ["The source-free exception applies only to exact published iNES/UNIF executables; not modified ROMs or arbitrary extracted/reused graphics. We retain the source anyway.", "The fixed tag credits Sara Crickard for graphics; current HEAD is not substituted. README font/game inspirations are retained, not represented as independently cleared cover art or wholly original assets.", "No battery-backed save in the iNES header; emulator snapshots remain available. The complete tag is preserved without executing its build tools or claiming a bit-identical rebuild."],
    },
]
ORIGINAL_TITLES = {
    "table-tennis": "8-Bit Table Tennis", "lan-master": "LAN Master",
    "lawn-mower": "Lawn Mower", "void-lancer": "VOID LANCER", "cargo-shift": "Cargo Shift",
    "thwaite": "Thwaite", "croom": "Concentration Room",
}
LANGUAGES = {
    "thwaite": {"language": "en", "label": "英文原版", "evidence": "Fixed-tag src/texts.txt includes Thwaite 0.04, practice menu, warranty notice and Press Start Button; these exact English source texts are retained without translating the ROM.", "member": "src/texts.txt"},
    "croom": {"language": "en", "label": "英文原版", "evidence": "Fixed-tag src/litetitle.s embeds English instructions, menus and program/graphics credits, including Flip two cards and Graphics by Damian Yerrick and Sara Crickard; no ROM translation.", "member": "src/litetitle.s"},
    "table-tennis": {"language": "en", "label": "英文原版", "evidence": "Pinned v1.0 source screenshot screenshot/table_tennis_start_screen.png reads 8-BIT TABLE TENNIS / PUSH START; source table_tennis.s lines 417-434 stores its title tiles.", "member": "screenshot/table_tennis_start_screen.png"},
    "lan-master": {"language": "und", "label": "原版未汉化，画面语言待运行核验", "evidence": "The original unmodified ROM and official English/Russian manual are preserved. Game text uses CHR/RLE tiles; manual language is not treated as proof of the ROM screen language.", "member": "title.rle"},
    "lawn-mower": {"language": "und", "label": "原版未汉化，画面语言待运行核验", "evidence": "The original unmodified ROM and official English/Russian manual are preserved. Game text uses CHR/RLE tiles; manual language is not treated as proof of the ROM screen language.", "member": "title.rle"},
    "void-lancer": {"language": "en", "label": "英文原版", "evidence": "tools/gen_assets.py lines 958-970 writes English ROM nametable text: MISSION COMPLETE, RETRY THE VOID, PRESS START, FINAL SCORE. This is source evidence, not a claim of runtime capture.", "member": "tools/gen_assets.py"},
    "cargo-shift": {"language": "en", "label": "英文原版", "evidence": "tools/build_graphics.py lines 131 and 162-164 writes PRESS START, PAUSE, CONTINUE, RETRY, TITLE, and RETRY STAGE? into the ROM scene data. The Chinese README does not imply Chinese ROM text.", "member": "tools/build_graphics.py"},
}
MANUAL_FILES = {
    "lan-master": {"manual.pdf": ("5d47e2e28e768de7d11ab50abb5bdbf909449032f74e994c90a67361d0c53a42", 96491), "notes.upstream.txt": ("f0634fc616686427878ae9169c2234a4c12281fc349c2d4b8bf2373b06c8d6fe", 2528)},
    "lawn-mower": {"manual.pdf": ("9d321ce8d0fcb804375b0c21a7a12a32bfd291ee8978254ab0a4cd3f44c996aa", 92476), "notes.upstream.txt": ("f6b90fa508faafce1e4e02d16462987bd4e68902843e8a42d611fdac6ac9c0ed", 3338)},
}
EMBEDDED_VERSIONS = {
    "lan-master": ("1.09", "Lan Master v1.09 14.06.11", 2084),
    "lawn-mower": ("1.12", "Lawn Mower v1.12 01.07.11", 2498),
}


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def require(condition, message):
    if not condition:
        raise ValueError(message)


def json_bytes(value):
    return (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode("utf-8")


def checked_file(path, digest, size=None):
    data = path.read_bytes()
    require(sha256(data) == digest, f"SHA-256 mismatch: {path}")
    if size:
        require(len(data) == size, f"Size mismatch: {path}")
    return data


def archive_checks(archive):
    members = archive.infolist()
    require(len(members) <= 2000, "Too many ZIP entries")
    require(len({m.filename for m in members}) == len(members), "Duplicate ZIP entries")
    require(sum(m.file_size for m in members) <= 32 * 1024 * 1024, "Oversized ZIP payload")
    require(archive.testzip() is None, "ZIP CRC failure")


def nes_info(data):
    require(len(data) >= 16 and data[:4] == b"NES\x1a", "Invalid NES header")
    require(data[7] & 0x0C == 0 and data[12:16] == bytes(4), "Expected clean iNES 1.0 header")
    mapper = (data[6] >> 4) | (data[7] & 0xF0)
    require(mapper == 0 and data[6] & 0x0E == 0, "Expected mapper 0 without trainer/battery/four-screen")
    prg, chr_size = data[4] * 16384, data[5] * 8192
    require(prg in (16384, 32768) and chr_size == 8192, "Unexpected PRG/CHR bank count")
    require(len(data) == 16 + prg + chr_size, "NES size does not match declared banks")
    vectors = struct.unpack_from("<HHH", data, 16 + prg - 6)
    # Shiru's LAN Master dispatches NMI through internal RAM ($00FA), and both
    # Shiru games leave the disabled IRQ vector at zero. Only RESET must be PRG.
    require(vectors[1] >= 0x8000, "Reset vector outside cartridge PRG")
    return {"format": "iNES 1.0", "mapper": mapper, "prgBytes": prg, "chrBytes": chr_size,
            "mirroring": "vertical" if data[6] & 1 else "horizontal", "headerHex": data[:16].hex(),
            "nmiVector": vectors[0], "resetVector": vectors[1], "irqVector": vectors[2]}


def public_domain_notice(game, declaration):
    return (
        f"{game['title']}\nPublic Domain declaration — original author: Shiru\n\n"
        f"Official ROM/manual archive: {game['romUrl']}\n"
        f"Manual member: {game['manualMember']}\n"
        f"Official source archive: {game['sourceUrl']}\n"
        f"Source member: {game['sourceRoot']}game.asm, lines 1–4\n\n"
        "Verbatim source declaration:\n" + declaration + "\n\n"
        "Verbatim manual cover text (page 1):\nPD 2011 Shiru\n\n"
        "Verbatim English introduction excerpt (page 2):\n" + SHIRU_INTRODUCTION + "\n\n"
        "Verbatim manual credit (page 4):\nCode, graphics, music: Shiru\n"
    ).encode("utf-8")


def gpl_notice(game, readme, license_text):
    require(game["permissionQuote"].encode("utf-8") in readme, f"Missing exact whole-ROM permission: {game['id']}")
    require(b"GNU GENERAL PUBLIC LICENSE" in license_text and b"Version 3, 29 June 2007" in license_text
            and b"END OF TERMS AND CONDITIONS" in license_text, f"Incomplete GPL license: {game['id']}")
    return (
        f"{game['title']}\nLicense: GPL-3.0-or-later\n"
        f"Exact unmodified official ROM: {game['romUrl']}\n"
        f"ROM SHA-256: {game['romSha256']}\n"
        f"Corresponding source (unmodified, including build scripts, art and music): {game['sourceUrl']}\n"
        f"Bundled source: third_party/games/{game['id']}/source.zip; also in the application's source/source.zip\n"
        f"Tagged commit: {game['commit']}\n\n"
        "Verbatim tagged README (permission, credits, requirements and caveats):\n\n"
    ).encode("utf-8") + readme + b"\n\nComplete verbatim upstream GPL license:\n\n" + license_text


def build_outputs():
    outputs, catalog, records = {}, [], []
    for game in GAMES:
        game_id = game["id"]
        private = VENDOR / game_id
        rom_path = PUBLIC / f"{game_id}.nes"
        source_path = private / "source.zip"
        downloads = Path(game.get("downloadDir", DOWNLOADS))
        source_input = ROOT / source_path
        if not source_input.is_file():
            source_input = ROOT / downloads / game["sourceDir"] / "source.zip"
        source = checked_file(source_input, game["sourceSha256"], game["sourceSize"])
        outputs[source_path] = source
        download_path = downloads / game.get("romDownloadId", game_id) / game["romFile"]
        original = ROOT / download_path
        container = checked_file(original, game["downloadSha256"], game["downloadSize"]) if original.is_file() else None
        manual = None
        if game["romMember"] and container is not None:
            with zipfile.ZipFile(original) as archive:
                archive_checks(archive)
                rom = archive.read(game["romMember"])
                manual = archive.read(game["manualMember"])
                notes = archive.read(game["manualMember"].replace("manual.pdf", "notes.txt"))
        else:
            rom = container if container is not None else checked_file(ROOT / rom_path, game["romSha256"], game["romSize"])
        require(sha256(rom) == game["romSha256"] and len(rom) == game["romSize"], f"Invalid pinned ROM: {game_id}")
        info = nes_info(rom)
        outputs[rom_path] = rom
        evidence = []
        with zipfile.ZipFile(source_input) as archive:
            archive_checks(archive)
            if game["commit"]:
                require(archive.comment.decode("ascii") == game["commit"], f"Source commit mismatch: {game_id}")
            for member, destination in game["documents"]:
                outputs[private / destination] = archive.read(game["sourceRoot"] + member)
            for member, purpose, lines in game["evidence"]:
                full_member = game["sourceRoot"] + member
                data = archive.read(full_member)
                entry = {"archiveMember": full_member, "sha256": sha256(data), "size": len(data), "purpose": purpose}
                if lines:
                    entry["lines"] = lines
                evidence.append(entry)
            if game["license"] == "MIT":
                license_text = archive.read(game["sourceRoot"] + "LICENSE")
                require(b'Permission is hereby granted' in license_text and b'Copyright (c)' in license_text, "Missing MIT notice")
                permission_member = game["sourceRoot"] + "LICENSE"
            elif game["license"] == "GPL-3.0-or-later":
                readme = archive.read(game["sourceRoot"] + "README.md")
                license_text = gpl_notice(game, readme, archive.read(game["sourceRoot"] + "LICENSE.txt"))
                permission_member = game["sourceRoot"] + "README.md"
                if game_id == "croom":
                    art_credits = archive.read(game["sourceRoot"] + "src/litetitle.s")
                    require(b'Graphics by Damian Yerrick' in art_credits and b'and Sara Crickard' in art_credits,
                            "Missing fixed-tag Croom art credits")
                    require(b'COPYLEFT_FBI_WARNING = 0' in art_credits, "Croom unpublished-build exception flag changed")
                    license_text += b"\n\nVerbatim fixed-tag program/graphics credit source:\n" + b"\n".join(art_credits.splitlines()[748:762]) + b"\n"
            else:
                declaration = "\n".join(archive.read(game["sourceRoot"] + "game.asm").decode("utf-8").splitlines()[:4])
                require(declaration.splitlines()[3] == ";The game and its source code are released into Public Domain", "Missing whole-game PD declaration")
                license_text = public_domain_notice(game, declaration)
                permission_member = game["sourceRoot"] + "game.asm:4"
                if manual is None:
                    manual = checked_file(ROOT / private / "manual.pdf", *MANUAL_FILES[game_id]["manual.pdf"])
                    notes = checked_file(ROOT / private / "notes.upstream.txt", *MANUAL_FILES[game_id]["notes.upstream.txt"])
                require(manual.startswith(b"%PDF-"), f"Invalid manual: {game_id}")
                for name, data in (("manual.pdf", manual), ("notes.upstream.txt", notes)):
                    digest, size = MANUAL_FILES[game_id][name]
                    require(sha256(data) == digest and len(data) == size, f"Invalid pinned document: {game_id}/{name}")
                outputs[private / "manual.pdf"] = manual
                outputs[private / "notes.upstream.txt"] = notes
                outputs[private / "LICENSE.txt"] = license_text
            language = LANGUAGES[game_id]
            language_member = game["sourceRoot"] + language["member"]
            language_data = archive.read(language_member)
            language_evidence = {"archiveMember": language_member, "sha256": sha256(language_data), "size": len(language_data), "purpose": language["evidence"]}
            evidence.append(language_evidence)
            version_evidence = None
            if game_id in EMBEDDED_VERSIONS:
                version, embedded, line = EMBEDDED_VERSIONS[game_id]
                source_text = archive.read(game["sourceRoot"] + "game.asm").decode("utf-8")
                require(embedded in source_text and embedded.encode("ascii") in rom, f"Missing embedded version: {game_id}")
                version_evidence = {"version": version, "embeddedText": embedded, "archiveMember": game["sourceRoot"] + "game.asm", "line": line, "verifiedInRom": True}
        license_path = PUBLIC / "licenses" / f"{game_id}.txt"
        outputs[license_path] = license_text
        item = {"id": game_id, "title": game["title"], "filename": rom_path.name,
                "sha256": game["romSha256"], "category": "game", "genre": game["genre"],
                "license": game["license"], "sourceUrl": game["homepage"],
                "description": game["description"] + " " + language["label"] + "；提供中文标题、简介与操作说明。",
                "tags": game["tags"] + [language["label"]], "keyboard": False, "version": version_evidence["version"] if version_evidence else game["version"],
                "controls": game["controls"] + " " + KEYBOARD, "system": "NES",
                "originalTitle": ORIGINAL_TITLES[game_id], "language": language["language"],
                "languageLabel": language["label"], "metadataLanguage": "zh-CN", "romTranslated": False}
        catalog.append(item)
        files = [{"path": str(path), "sha256": sha256(data), "size": len(data)}
                 for path, data in outputs.items() if path.parts[:3] == private.parts]
        records.append({
            "id": game_id, "title": game["title"], "originalTitle": ORIGINAL_TITLES[game_id],
            "version": item["version"], "versionEvidence": version_evidence, "system": "NES",
            "language": {"rom": language["language"], "label": language["label"], "metadata": "zh-CN", "translated": False, "evidence": language_evidence, "runtimeVerified": False},
            "projectUrl": game["homepage"], "source": {"url": game["sourceUrl"], "path": str(source_path),
                "sha256": game["sourceSha256"], "size": game["sourceSize"], "tag": game["tag"],
                "commit": game["commit"], "archiveRoot": game["sourceRoot"], "unmodified": True},
            "download": {"url": game["romUrl"], "path": str(download_path), "sha256": game["downloadSha256"],
                "size": len(container) if container is not None else game["downloadSize"], "payloadMember": game["romMember"]},
            "rom": {"path": str(rom_path), "sha256": game["romSha256"], "size": len(rom), "modified": False, **info},
            "permission": {"license": game["license"], "scope": game["permission"], "sourcePath": str(source_path) + "!" + permission_member,
                "publicNotice": {"path": str(license_path), "sha256": sha256(license_text), "size": len(license_text)},
                "verbatimMitNotice": game["license"] == "MIT",
                "manualPath": str(private / "manual.pdf") if game["license"] == "Public Domain" else None,
                "manualPermissionPages": [1, 2, 4] if game["license"] == "Public Domain" else [],
                **({"verbatimWholeProgramGrant": game["permissionQuote"], "credits": game["credits"],
                    "completeGplNotice": True, "correspondingSourceIncluded": True,
                    "sourceIncludesBuildArtMusic": True,
                    "exactPublishedRomException": game.get("exactRomException"),
                    "sourceFreeDistributionClaimed": False}
                   if game["license"] == "GPL-3.0-or-later" else {})},
            "evidence": evidence, "snapshots": files, "controls": item["controls"], "caveats": game["caveats"],
        })
    outputs[PUBLIC / "catalog.json"] = json_bytes({"games": catalog})
    outputs[VENDOR / "provenance.json"] = json_bytes({
        "schemaVersion": 1, "snapshotDate": SNAPSHOT_DATE,
        "preparation": "python3 -I scripts/prepare-games.py", "validation": "python3 -I scripts/prepare-games.py --check",
        "policy": {"romsModified": False, "upstreamCodeExecuted": False, "networkRequired": False,
            "publicFiles": "Seven ROMs, catalog.json, and required per-game notices only.",
            "sourceArchives": "Unmodified archives retained only as provenance/source counterparts. Upstream editor executables and artwork remain inside archives; none are extracted into the public game resources or executed.",
            "screenshots": "Absent until captured from these exact ROMs in the actual runtime.",
            "keyboardFlag": "false means no Family/Subor learning-keyboard peripheral is required; ordinary host keyboard/gamepad controls remain available.",
            "runtimeVerification": "Resource validation checks hashes, ZIP CRCs, iNES layout, and interrupt vectors; it does not claim gameplay/audio/core verification or bit-for-bit source rebuilds."},
        "games": records,
    })
    notices = ["# Bundled game notices", "", "Seven unmodified NES homebrew ROMs are bundled. The three MIT notices below are verbatim. Shiru's whole-game public-domain declarations and original manual excerpts are preserved beside the ROMs. Thwaite and Concentration Room include the complete GPL v3 text, exact tagged whole-program grants/credits, and complete corresponding source including build scripts, art and music.", "", "Reprepare offline with `python3 -I scripts/prepare-games.py`; validate without writing with `python3 -I scripts/prepare-games.py --check`. `provenance.json` records payloads, archive hashes, pinned tags/commits, permission paths, source evidence, and snapshot hashes.", "", "The public game directory contains ROMs, catalog metadata, and required notices. Original source archives are legal/provenance counterparts; bundled public files contain no upstream label art or editor executables. No upstream code was executed. Source archives themselves are preserved byte-for-byte, including any upstream tools. No runtime screenshots or source rebuild are claimed.", "", "All seven use mapper 0 / iNES 1.0. `keyboard: false` means no learning-keyboard peripheral is required; the host keyboard remains usable. Keyboard mapping is arrows, X=A, Z=B, Enter=START, right Shift=SELECT.", ""]
    notices.extend(["ROM language is separate from localized catalog text. All seven retain their original English names and unmodified ROM bytes. The catalog titles, descriptions, and controls are Chinese; no ROM is marked as a Chinese translation. `language` uses `en` for source-supported English screens and `und` where the tile-based screen text still needs runtime verification. A Chinese README is not evidence of a Chinese ROM.", ""])
    for game, record in zip(GAMES, records):
        notices.extend([f"## {game['title']}", "", f"- ID: `{game['id']}`; version: `{game['version']}`; license: {game['license']}.",
                        f"- Project: {game['homepage']}", f"- ROM download: {game['romUrl']}",
                        f"- ROM SHA-256: `{game['romSha256']}` ({game['romSize']} bytes).",
                        f"- Source snapshot: {game['sourceUrl']}", f"- Source SHA-256: `{game['sourceSha256']}`.",
                        f"- Permission evidence: `{record['permission']['sourcePath']}`.",
                        f"- ROM language: `{record['language']['rom']}` ({record['language']['label']}); catalog metadata: `zh-CN`; translated ROM: no.",
                        "", game["permission"], "", game["controls"], ""])
        notices.extend(["Language evidence: " + record["language"]["evidence"]["purpose"], ""])
        notices.extend(["Caveat: " + caveat for caveat in game["caveats"]])
        notices.extend(["", "```text", outputs[PUBLIC / "licenses" / f"{game['id']}.txt"].decode("utf-8").rstrip("\n"), "```", ""])
    outputs[VENDOR / "notices.md"] = ("\n".join(notices) + "\n").encode("utf-8")
    return outputs, records


def write_if_changed(path, data):
    require(not path.is_symlink(), f"Refusing symlink output: {path}")
    if path.is_file() and path.read_bytes() == data:
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=path.parent, prefix=".prepare-games-", delete=False) as temporary:
        temporary.write(data)
        temp_path = Path(temporary.name)
    try:
        os.chmod(temp_path, 0o644)
        os.replace(temp_path, path)
    finally:
        temp_path.unlink(missing_ok=True)
    return True


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Verify all pinned resources without writing")
    args = parser.parse_args()
    outputs, records = build_outputs()
    changed = 0
    for relative, data in outputs.items():
        require(relative.is_relative_to(PUBLIC) or relative.is_relative_to(VENDOR), "Output outside owned game directories")
        path = ROOT / relative
        if args.check:
            require(path.is_file() and path.read_bytes() == data, f"Missing or stale generated file: {relative}")
        else:
            changed += write_if_changed(path, data)
    expected_public = {path for path in outputs if path.is_relative_to(PUBLIC)}
    actual_public = {path.relative_to(ROOT) for path in (ROOT / PUBLIC).rglob("*") if path.is_file()}
    require(actual_public == expected_public, "Unexpected files in public games; only pinned ROMs, notices, and catalog are allowed")
    for game in records:
        rom = game["rom"]
        print(f"OK {game['id']}: {rom['size']} bytes, {rom['format']}, mapper {rom['mapper']}, SHA-256 {rom['sha256']}")
    print(f"Validated {len(records)} games and {len(outputs)} resource/snapshot files; " + ("no files written." if args.check else f"{changed} files updated."))


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, KeyError, zipfile.BadZipFile) as error:
        print(f"prepare-games: {error}", file=sys.stderr)
        raise SystemExit(1)
