# Bundled game notices

Seven unmodified NES homebrew ROMs are bundled. The three MIT notices below are verbatim. Shiru's whole-game public-domain declarations and original manual excerpts are preserved beside the ROMs. Thwaite and Concentration Room include the complete GPL v3 text, exact tagged whole-program grants/credits, and complete corresponding source including build scripts, art and music.

Reprepare offline with `python3 -I scripts/prepare-games.py`; validate without writing with `python3 -I scripts/prepare-games.py --check`. `provenance.json` records payloads, archive hashes, pinned tags/commits, permission paths, source evidence, and snapshot hashes.

The public game directory contains ROMs, catalog metadata, and required notices. Original source archives are legal/provenance counterparts; bundled public files contain no upstream label art or editor executables. No upstream code was executed. Source archives themselves are preserved byte-for-byte, including any upstream tools. No runtime screenshots or source rebuild are claimed.

All seven use mapper 0 / iNES 1.0. `keyboard: false` means no learning-keyboard peripheral is required; the host keyboard remains usable. Keyboard mapping is arrows, X=A, Z=B, Enter=START, right Shift=SELECT.

ROM language is separate from localized catalog text. All seven retain their original English names and unmodified ROM bytes. The catalog titles, descriptions, and controls are Chinese; no ROM is marked as a Chinese translation. `language` uses `en` for source-supported English screens and `und` where the tile-based screen text still needs runtime verification. A Chinese README is not evidence of a Chinese ROM.

## 双人乒乓球 · 8-Bit Table Tennis

- ID: `table-tennis`; version: `1.0`; license: MIT.
- Project: https://github.com/mike42/8bit-table-tennis/tree/v1.0
- ROM download: https://github.com/mike42/8bit-table-tennis/releases/download/v1.0/table_tennis_v1.0.nes
- ROM SHA-256: `05122457672f95fcf2ee518c3f37e506617725c2d031100b1b1c8b7785068ea3` (40976 bytes).
- Source snapshot: https://codeload.github.com/mike42/8bit-table-tennis/zip/refs/tags/v1.0
- Source SHA-256: `284e2b6fb9ac2c4309c897f2153133fdf024440aac15f89bd5910fb86f7d725f`.
- Permission evidence: `third_party/games/table-tennis/source.zip!8bit-table-tennis-1.0/LICENSE`.
- ROM language: `en` (英文原版); catalog metadata: `zh-CN`; translated ROM: no.

Whole project under MIT; the upstream README credits Brad Smith's NES-ca65-example as its basis.

Enter（START）开始；↑/↓移动 1P 球拍，X（A）发球。2P 使用第二只手柄的上下与 A 键；本作是双人游戏。

Language evidence: Pinned v1.0 source screenshot screenshot/table_tennis_start_screen.png reads 8-BIT TABLE TENNIS / PUSH START; source table_tennis.s lines 417-434 stores its title tiles.

Caveat: Two-player game; the second player needs a second controller.

```text
MIT License

Copyright (c) 2020 Michael Billington

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## 网络大师 · LAN Master

- ID: `lan-master`; version: `1.09`; license: Public Domain.
- Project: https://shiru.untergrund.net/files/nes/lan_master.zip
- ROM download: https://shiru.untergrund.net/files/nes/lan_master.zip
- ROM SHA-256: `becfeafb80479c330333c9e9385417f68f3c88e85443dfb37b05ae9283f3ea45` (40976 bytes).
- Source snapshot: https://shiru.untergrund.net/files/src/lan_master_src.zip
- Source SHA-256: `d4058bd0f6d31fbd9ba71b2ec15e9646f00520de075c9c18f8520e8d18e0b3ee`.
- Permission evidence: `third_party/games/lan-master/source.zip!lan_master_src/game.asm:4`.
- ROM language: `und` (原版未汉化，画面语言待运行核验); catalog metadata: `zh-CN`; translated ROM: no.

Shiru declares the whole game and its source code Public Domain in game.asm line 4; the official manual independently declares the game Public Domain and credits Shiru for code, graphics, and music.

方向键移动光标；X（A）与 Z（B）向相反方向旋转，右 Shift（SELECT）转半圈；Enter（START）确认或打开暂停菜单。记录通关密码，在主菜单 CODE 输入可续关。

Language evidence: The original unmodified ROM and official English/Russian manual are preserved. Game text uses CHR/RLE tiles; manual language is not treated as proof of the ROM screen language.

Caveat: Official downloads have no version tag. These exact archive and ROM bytes are pinned by SHA-256.
Caveat: The official development notes mention a 2015 pause fix; version 1.09 is independently verified in the source and the ROM's embedded text.
Caveat: Gameplay is inspired by NetWalk; the official notes credit Shiru's own graphics and music.

```text
网络大师 · LAN Master
Public Domain declaration — original author: Shiru

Official ROM/manual archive: https://shiru.untergrund.net/files/nes/lan_master.zip
Manual member: lan_master/manual.pdf
Official source archive: https://shiru.untergrund.net/files/src/lan_master_src.zip
Source member: lan_master_src/game.asm, lines 1–4

Verbatim source declaration:
;Lan Master NES game
;by Shiru (shiru@mail.ru) 05'11
;Compile with NESASM3
;The game and its source code are released into Public Domain

Verbatim manual cover text (page 1):
PD 2011 Shiru

Verbatim English introduction excerpt (page 2):
The game is not licensed or endorsed by Nintendo company in any way. It is free
of charge, released into Public Domain, and provided "as is", without warranty or
responsibility of any kind.

Verbatim manual credit (page 4):
Code, graphics, music: Shiru
```

## 欢乐割草 · Lawn Mower

- ID: `lawn-mower`; version: `1.12`; license: Public Domain.
- Project: https://shiru.untergrund.net/files/nes/lawn_mower.zip
- ROM download: https://shiru.untergrund.net/files/nes/lawn_mower.zip
- ROM SHA-256: `181ef3ff1769a85ae98736e02809e65e5d758b453ebb43ec4b9fe60c93ad224c` (24592 bytes).
- Source snapshot: https://shiru.untergrund.net/files/src/lawn_mower_src.zip
- Source SHA-256: `8986e2057ad0ef3ccc2ab8bb39c9c54819ff402980b3468efde89da15a5d9dd5`.
- Permission evidence: `third_party/games/lawn-mower/source.zip!lawn_mower_src/game.asm:4`.
- ROM language: `und` (原版未汉化，画面语言待运行核验); catalog metadata: `zh-CN`; translated ROM: no.

Shiru declares the whole game and its source code Public Domain in game.asm line 4; the official manual independently declares the game Public Domain and credits Shiru for code, graphics, and music.

Enter（START）开始或暂停；方向键改变行进方向；按住 X（A）或 Z（B）加速。割草机持续移动；收集油罐补充燃料，穿过花丛和石块会额外耗油。

Language evidence: The original unmodified ROM and official English/Russian manual are preserved. Game text uses CHR/RLE tiles; manual language is not treated as proof of the ROM screen language.

Caveat: Official downloads have no version tag. These exact archive and ROM bytes are pinned by SHA-256.
Caveat: The official notes describe inspiration from older lawn-mower games and palette differences between emulators.

```text
欢乐割草 · Lawn Mower
Public Domain declaration — original author: Shiru

Official ROM/manual archive: https://shiru.untergrund.net/files/nes/lawn_mower.zip
Manual member: manual.pdf
Official source archive: https://shiru.untergrund.net/files/src/lawn_mower_src.zip
Source member: lawn_mower_src/game.asm, lines 1–4

Verbatim source declaration:
;Lawn Mower NES game
;by Shiru (shiru@mail.ru) 05'11
;Compile with NESASM3
;The game and its source code are released into Public Domain

Verbatim manual cover text (page 1):
PD 2011 Shiru

Verbatim English introduction excerpt (page 2):
The game is not licensed or endorsed by Nintendo company in any way. It is free
of charge, released into Public Domain, and provided "as is", without warranty or
responsibility of any kind.

Verbatim manual credit (page 4):
Code, graphics, music: Shiru
```

## 虚空枪骑兵 · VOID LANCER

- ID: `void-lancer`; version: `1.0.0`; license: MIT.
- Project: https://github.com/Riyoway/void-lancer-nes/tree/v1.0.0
- ROM download: https://github.com/Riyoway/void-lancer-nes/releases/download/v1.0.0/VOID-LANCER-v1.0.0.nes
- ROM SHA-256: `5eb801aca68131a3d17fa82d8901d46f6098b878d1e00cd1c47d00c001c2405a` (40976 bytes).
- Source snapshot: https://codeload.github.com/Riyoway/void-lancer-nes/zip/refs/tags/v1.0.0
- Source SHA-256: `e7df30c2cd48a7008418c98840161d4d5ca168cddf50c4eb6b1c307f56786b04`.
- Permission evidence: `third_party/games/void-lancer/source.zip!void-lancer-nes-1.0.0/LICENSE`.
- ROM language: `en` (英文原版); catalog metadata: `zh-CN`; translated ROM: no.

MIT for the project, including its original graphics and synthesized soundtrack. README and docs/SOUNDTRACK.md explicitly document originality. External historical references are excluded by the upstream license note and are not bundled as game assets.

Enter（START）开始或重新开始；方向键移动；X（A）射击；Z（B）使用脉冲炸弹。初始拥有 3 条生命与 3 枚炸弹。

Language evidence: tools/gen_assets.py lines 958-970 writes English ROM nametable text: MISSION COMPLETE, RETRY THE VOID, PRESS START, FINAL SCORE. This is source evidence, not a claim of runtime capture.

Caveat: Upstream targets NTSC; its own control-flow smoke test is not a cycle-accurate PPU/APU test.

```text
MIT License

Copyright (c) 2026 VOID LANCER contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## 仓库推箱 · Cargo Shift

- ID: `cargo-shift`; version: `0.1.0`; license: MIT.
- Project: https://github.com/Hxyspace/cargo-shift/tree/v0.1.0
- ROM download: https://github.com/Hxyspace/cargo-shift/releases/download/v0.1.0/cargo_shift.nes
- ROM SHA-256: `d1a6deb7528d5349b69b02fe918fba8fa9e7fdfbd5d8be455d6b9d173d7545ef` (40976 bytes).
- Source snapshot: https://codeload.github.com/Hxyspace/cargo-shift/zip/refs/tags/v0.1.0
- Source SHA-256: `21053e7af03c5eb0e732eb21086e325340e2e82accd2c9ee3f5dce51a396521c`.
- Permission evidence: `third_party/games/cargo-shift/source.zip!cargo-shift-0.1.0/LICENSE`.
- ROM language: `en` (英文原版); catalog metadata: `zh-CN`; translated ROM: no.

Whole project under MIT. Original sprites and levels are present in the tagged source; docs/LEVELS.md declares original levels and retains its design-inspiration credit. Effects are synthesized through NES APU register writes in src/common/nes.c.

Enter（START）开始或打开暂停菜单；方向键移动并推箱；Z（B）撤销；X（A）打开重开确认。菜单用 ↑/↓ 或右 Shift（SELECT）切换，Enter 确认，Z 返回。

Language evidence: tools/build_graphics.py lines 131 and 162-164 writes PRESS START, PAUSE, CONTINUE, RETRY, TITLE, and RETRY STAGE? into the ROM scene data. The Chinese README does not imply Chinese ROM text.

Caveat: NTSC target; PAL is explicitly unverified upstream. No in-game battery save.
Caveat: Upstream README independently publishes the exact bundled ROM SHA-256.

```text
MIT License

Copyright (c) 2026 Cargo Shift contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## 烟花守卫 · Thwaite

- ID: `thwaite`; version: `0.04`; license: GPL-3.0-or-later.
- Project: https://github.com/pinobatch/thwaite-nes/tree/v0.04
- ROM download: https://github.com/pinobatch/thwaite-nes/releases/download/v0.04/thwaite.nes
- ROM SHA-256: `a2df24d9c9f72e56c2fdc4c703becc47a5700ad0158da8208247635ebeb3779c` (24592 bytes).
- Source snapshot: https://codeload.github.com/pinobatch/thwaite-nes/zip/refs/tags/v0.04
- Source SHA-256: `222f392b417185435f447ae5f17a2461d9bdd82c8b9a8e0d263ce6a97a911173`.
- Permission evidence: `third_party/games/thwaite/source.zip!thwaite-nes-0.04/README.md`.
- ROM language: `en` (英文原版); catalog metadata: `zh-CN`; translated ROM: no.

The tagged README and USAGE.html license the accompanying whole game GPL version 3 or later and credit Damian Yerrick for program, graphics and music, with extra music credited to Ludwig van Beethoven. The full GPL and unmodified corresponding tagged source, including build scripts, graphics and music data, are bundled. No source-free ROM exception is claimed for Thwaite.

Enter（START）跳过声明、确认菜单或暂停；↑/↓选择模式。单人用方向键移动准星，Z（B）从左井发射，X（A）从右井发射。双人合作需要两只手柄，各自 A/B 均从对应发射井发射。练习中暂停后右 Shift（SELECT）结束练习。

Language evidence: Fixed-tag src/texts.txt includes Thwaite 0.04, practice menu, warranty notice and Press Start Button; these exact English source texts are retained without translating the ROM.

Caveat: Official v0.04 release asset thwaite.nes is NROM-128, despite the tagged makefile naming its NROM-256 target thwaite.nes; the original release bytes and complete tag are retained, without claiming a bit-identical rebuild.
Caveat: Graphics flicker; preserve the upstream photosensitive-seizure warning. SNES Mouse support is upstream functionality, not a claim of this application's mouse support.
Caveat: Source credits historical concept/setting and musical rhythm inspiration; these references are not distributed as third-party ROMs, artwork or sampled audio. The exact whole-program GPL grant, not a blanket originality claim, is the distribution basis.

```text
烟花守卫 · Thwaite
License: GPL-3.0-or-later
Exact unmodified official ROM: https://github.com/pinobatch/thwaite-nes/releases/download/v0.04/thwaite.nes
ROM SHA-256: a2df24d9c9f72e56c2fdc4c703becc47a5700ad0158da8208247635ebeb3779c
Corresponding source (unmodified, including build scripts, art and music): https://codeload.github.com/pinobatch/thwaite-nes/zip/refs/tags/v0.04
Bundled source: third_party/games/thwaite/source.zip; also in the application's source/source.zip
Tagged commit: ccd27ccbe3e201755b86c1b5f932b2e11ba74110

Verbatim tagged README (permission, credits, requirements and caveats):

Thwaite
=======
Missiles are falling from the sky. Shoot them down with your fireworks.

Requirements
------------
Thwaite is designed for Nintendo Entertainment System.  It works on
a [PowerPak], an NROM cartridge board, or popular NES emulators.
It attempts to adapt the game and music speed to NTSC or PAL NES
at runtime.  It can be played with the standard NES controller or a
Super NES Mouse connected to a Super NES controller to NES adapter
or an FC Twin famiclone.

Building from source requires GNU Make, GNU Coreutils, Python 3,
Pillow, and ca65. For detailed instructions to bring up a build
environment, see [nrom-template].

[PowerPak]: http://www.retrousb.com/product_info.php?products_id=34
[nrom-template]: https://github.com/pinobatch/nrom-template

For gameplay instructions, see USAGE.html.

Credits
-------
* program, graphics, music: Damian Yerrick
* extra music: Ludwig van Beethoven
* testers: Jeroen, Shiru, NovaSquirrel
* original game concept: Dave Theurer / Atari
* setting inspiration: Nintendo

Legal
-----
© 2011-2012 Damian Yerrick

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful, but
WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
General Public License for more details.

You should have received a copy of the GNU General Public License
along with this program.  If not, see [GNU licenses].

Thwaite makes explosions and smoke appear translucent by flickering
them. A very small percentage of people have [seizures] after looking
at flickering patterns in television and video games. If you have had
convulsions or loss of awareness of surroundings, see a health care
professional before playing any video game.

Intense video games can be tiring and cause [Nintendo thumb], a form
of repetitive strain injury. Take a five-minute break at least every
half hour or so, and don't play when you need sleep.

[GNU licenses]: https://www.gnu.org/licenses/
[seizures]: https://en.wikipedia.org/wiki/Photosensitive_epilepsy
[Nintendo thumb]: https://en.wikipedia.org/wiki/Nintendo_thumb


Complete verbatim upstream GPL license:

                    GNU GENERAL PUBLIC LICENSE
                       Version 3, 29 June 2007

 Copyright (C) 2007 Free Software Foundation, Inc. <http://fsf.org/>
 Everyone is permitted to copy and distribute verbatim copies
 of this license document, but changing it is not allowed.

                            Preamble

  The GNU General Public License is a free, copyleft license for
software and other kinds of works.

  The licenses for most software and other practical works are designed
to take away your freedom to share and change the works.  By contrast,
the GNU General Public License is intended to guarantee your freedom to
share and change all versions of a program--to make sure it remains free
software for all its users.  We, the Free Software Foundation, use the
GNU General Public License for most of our software; it applies also to
any other work released this way by its authors.  You can apply it to
your programs, too.

  When we speak of free software, we are referring to freedom, not
price.  Our General Public Licenses are designed to make sure that you
have the freedom to distribute copies of free software (and charge for
them if you wish), that you receive source code or can get it if you
want it, that you can change the software or use pieces of it in new
free programs, and that you know you can do these things.

  To protect your rights, we need to prevent others from denying you
these rights or asking you to surrender the rights.  Therefore, you have
certain responsibilities if you distribute copies of the software, or if
you modify it: responsibilities to respect the freedom of others.

  For example, if you distribute copies of such a program, whether
gratis or for a fee, you must pass on to the recipients the same
freedoms that you received.  You must make sure that they, too, receive
or can get the source code.  And you must show them these terms so they
know their rights.

  Developers that use the GNU GPL protect your rights with two steps:
(1) assert copyright on the software, and (2) offer you this License
giving you legal permission to copy, distribute and/or modify it.

  For the developers' and authors' protection, the GPL clearly explains
that there is no warranty for this free software.  For both users' and
authors' sake, the GPL requires that modified versions be marked as
changed, so that their problems will not be attributed erroneously to
authors of previous versions.

  Some devices are designed to deny users access to install or run
modified versions of the software inside them, although the manufacturer
can do so.  This is fundamentally incompatible with the aim of
protecting users' freedom to change the software.  The systematic
pattern of such abuse occurs in the area of products for individuals to
use, which is precisely where it is most unacceptable.  Therefore, we
have designed this version of the GPL to prohibit the practice for those
products.  If such problems arise substantially in other domains, we
stand ready to extend this provision to those domains in future versions
of the GPL, as needed to protect the freedom of users.

  Finally, every program is threatened constantly by software patents.
States should not allow patents to restrict development and use of
software on general-purpose computers, but in those that do, we wish to
avoid the special danger that patents applied to a free program could
make it effectively proprietary.  To prevent this, the GPL assures that
patents cannot be used to render the program non-free.

  The precise terms and conditions for copying, distribution and
modification follow.

                       TERMS AND CONDITIONS

  0. Definitions.

  "This License" refers to version 3 of the GNU General Public License.

  "Copyright" also means copyright-like laws that apply to other kinds of
works, such as semiconductor masks.

  "The Program" refers to any copyrightable work licensed under this
License.  Each licensee is addressed as "you".  "Licensees" and
"recipients" may be individuals or organizations.

  To "modify" a work means to copy from or adapt all or part of the work
in a fashion requiring copyright permission, other than the making of an
exact copy.  The resulting work is called a "modified version" of the
earlier work or a work "based on" the earlier work.

  A "covered work" means either the unmodified Program or a work based
on the Program.

  To "propagate" a work means to do anything with it that, without
permission, would make you directly or secondarily liable for
infringement under applicable copyright law, except executing it on a
computer or modifying a private copy.  Propagation includes copying,
distribution (with or without modification), making available to the
public, and in some countries other activities as well.

  To "convey" a work means any kind of propagation that enables other
parties to make or receive copies.  Mere interaction with a user through
a computer network, with no transfer of a copy, is not conveying.

  An interactive user interface displays "Appropriate Legal Notices"
to the extent that it includes a convenient and prominently visible
feature that (1) displays an appropriate copyright notice, and (2)
tells the user that there is no warranty for the work (except to the
extent that warranties are provided), that licensees may convey the
work under this License, and how to view a copy of this License.  If
the interface presents a list of user commands or options, such as a
menu, a prominent item in the list meets this criterion.

  1. Source Code.

  The "source code" for a work means the preferred form of the work
for making modifications to it.  "Object code" means any non-source
form of a work.

  A "Standard Interface" means an interface that either is an official
standard defined by a recognized standards body, or, in the case of
interfaces specified for a particular programming language, one that
is widely used among developers working in that language.

  The "System Libraries" of an executable work include anything, other
than the work as a whole, that (a) is included in the normal form of
packaging a Major Component, but which is not part of that Major
Component, and (b) serves only to enable use of the work with that
Major Component, or to implement a Standard Interface for which an
implementation is available to the public in source code form.  A
"Major Component", in this context, means a major essential component
(kernel, window system, and so on) of the specific operating system
(if any) on which the executable work runs, or a compiler used to
produce the work, or an object code interpreter used to run it.

  The "Corresponding Source" for a work in object code form means all
the source code needed to generate, install, and (for an executable
work) run the object code and to modify the work, including scripts to
control those activities.  However, it does not include the work's
System Libraries, or general-purpose tools or generally available free
programs which are used unmodified in performing those activities but
which are not part of the work.  For example, Corresponding Source
includes interface definition files associated with source files for
the work, and the source code for shared libraries and dynamically
linked subprograms that the work is specifically designed to require,
such as by intimate data communication or control flow between those
subprograms and other parts of the work.

  The Corresponding Source need not include anything that users
can regenerate automatically from other parts of the Corresponding
Source.

  The Corresponding Source for a work in source code form is that
same work.

  2. Basic Permissions.

  All rights granted under this License are granted for the term of
copyright on the Program, and are irrevocable provided the stated
conditions are met.  This License explicitly affirms your unlimited
permission to run the unmodified Program.  The output from running a
covered work is covered by this License only if the output, given its
content, constitutes a covered work.  This License acknowledges your
rights of fair use or other equivalent, as provided by copyright law.

  You may make, run and propagate covered works that you do not
convey, without conditions so long as your license otherwise remains
in force.  You may convey covered works to others for the sole purpose
of having them make modifications exclusively for you, or provide you
with facilities for running those works, provided that you comply with
the terms of this License in conveying all material for which you do
not control copyright.  Those thus making or running the covered works
for you must do so exclusively on your behalf, under your direction
and control, on terms that prohibit them from making any copies of
your copyrighted material outside their relationship with you.

  Conveying under any other circumstances is permitted solely under
the conditions stated below.  Sublicensing is not allowed; section 10
makes it unnecessary.

  3. Protecting Users' Legal Rights From Anti-Circumvention Law.

  No covered work shall be deemed part of an effective technological
measure under any applicable law fulfilling obligations under article
11 of the WIPO copyright treaty adopted on 20 December 1996, or
similar laws prohibiting or restricting circumvention of such
measures.

  When you convey a covered work, you waive any legal power to forbid
circumvention of technological measures to the extent such circumvention
is effected by exercising rights under this License with respect to
the covered work, and you disclaim any intention to limit operation or
modification of the work as a means of enforcing, against the work's
users, your or third parties' legal rights to forbid circumvention of
technological measures.

  4. Conveying Verbatim Copies.

  You may convey verbatim copies of the Program's source code as you
receive it, in any medium, provided that you conspicuously and
appropriately publish on each copy an appropriate copyright notice;
keep intact all notices stating that this License and any
non-permissive terms added in accord with section 7 apply to the code;
keep intact all notices of the absence of any warranty; and give all
recipients a copy of this License along with the Program.

  You may charge any price or no price for each copy that you convey,
and you may offer support or warranty protection for a fee.

  5. Conveying Modified Source Versions.

  You may convey a work based on the Program, or the modifications to
produce it from the Program, in the form of source code under the
terms of section 4, provided that you also meet all of these conditions:

    a) The work must carry prominent notices stating that you modified
    it, and giving a relevant date.

    b) The work must carry prominent notices stating that it is
    released under this License and any conditions added under section
    7.  This requirement modifies the requirement in section 4 to
    "keep intact all notices".

    c) You must license the entire work, as a whole, under this
    License to anyone who comes into possession of a copy.  This
    License will therefore apply, along with any applicable section 7
    additional terms, to the whole of the work, and all its parts,
    regardless of how they are packaged.  This License gives no
    permission to license the work in any other way, but it does not
    invalidate such permission if you have separately received it.

    d) If the work has interactive user interfaces, each must display
    Appropriate Legal Notices; however, if the Program has interactive
    interfaces that do not display Appropriate Legal Notices, your
    work need not make them do so.

  A compilation of a covered work with other separate and independent
works, which are not by their nature extensions of the covered work,
and which are not combined with it such as to form a larger program,
in or on a volume of a storage or distribution medium, is called an
"aggregate" if the compilation and its resulting copyright are not
used to limit the access or legal rights of the compilation's users
beyond what the individual works permit.  Inclusion of a covered work
in an aggregate does not cause this License to apply to the other
parts of the aggregate.

  6. Conveying Non-Source Forms.

  You may convey a covered work in object code form under the terms
of sections 4 and 5, provided that you also convey the
machine-readable Corresponding Source under the terms of this License,
in one of these ways:

    a) Convey the object code in, or embodied in, a physical product
    (including a physical distribution medium), accompanied by the
    Corresponding Source fixed on a durable physical medium
    customarily used for software interchange.

    b) Convey the object code in, or embodied in, a physical product
    (including a physical distribution medium), accompanied by a
    written offer, valid for at least three years and valid for as
    long as you offer spare parts or customer support for that product
    model, to give anyone who possesses the object code either (1) a
    copy of the Corresponding Source for all the software in the
    product that is covered by this License, on a durable physical
    medium customarily used for software interchange, for a price no
    more than your reasonable cost of physically performing this
    conveying of source, or (2) access to copy the
    Corresponding Source from a network server at no charge.

    c) Convey individual copies of the object code with a copy of the
    written offer to provide the Corresponding Source.  This
    alternative is allowed only occasionally and noncommercially, and
    only if you received the object code with such an offer, in accord
    with subsection 6b.

    d) Convey the object code by offering access from a designated
    place (gratis or for a charge), and offer equivalent access to the
    Corresponding Source in the same way through the same place at no
    further charge.  You need not require recipients to copy the
    Corresponding Source along with the object code.  If the place to
    copy the object code is a network server, the Corresponding Source
    may be on a different server (operated by you or a third party)
    that supports equivalent copying facilities, provided you maintain
    clear directions next to the object code saying where to find the
    Corresponding Source.  Regardless of what server hosts the
    Corresponding Source, you remain obligated to ensure that it is
    available for as long as needed to satisfy these requirements.

    e) Convey the object code using peer-to-peer transmission, provided
    you inform other peers where the object code and Corresponding
    Source of the work are being offered to the general public at no
    charge under subsection 6d.

  A separable portion of the object code, whose source code is excluded
from the Corresponding Source as a System Library, need not be
included in conveying the object code work.

  A "User Product" is either (1) a "consumer product", which means any
tangible personal property which is normally used for personal, family,
or household purposes, or (2) anything designed or sold for incorporation
into a dwelling.  In determining whether a product is a consumer product,
doubtful cases shall be resolved in favor of coverage.  For a particular
product received by a particular user, "normally used" refers to a
typical or common use of that class of product, regardless of the status
of the particular user or of the way in which the particular user
actually uses, or expects or is expected to use, the product.  A product
is a consumer product regardless of whether the product has substantial
commercial, industrial or non-consumer uses, unless such uses represent
the only significant mode of use of the product.

  "Installation Information" for a User Product means any methods,
procedures, authorization keys, or other information required to install
and execute modified versions of a covered work in that User Product from
a modified version of its Corresponding Source.  The information must
suffice to ensure that the continued functioning of the modified object
code is in no case prevented or interfered with solely because
modification has been made.

  If you convey an object code work under this section in, or with, or
specifically for use in, a User Product, and the conveying occurs as
part of a transaction in which the right of possession and use of the
User Product is transferred to the recipient in perpetuity or for a
fixed term (regardless of how the transaction is characterized), the
Corresponding Source conveyed under this section must be accompanied
by the Installation Information.  But this requirement does not apply
if neither you nor any third party retains the ability to install
modified object code on the User Product (for example, the work has
been installed in ROM).

  The requirement to provide Installation Information does not include a
requirement to continue to provide support service, warranty, or updates
for a work that has been modified or installed by the recipient, or for
the User Product in which it has been modified or installed.  Access to a
network may be denied when the modification itself materially and
adversely affects the operation of the network or violates the rules and
protocols for communication across the network.

  Corresponding Source conveyed, and Installation Information provided,
in accord with this section must be in a format that is publicly
documented (and with an implementation available to the public in
source code form), and must require no special password or key for
unpacking, reading or copying.

  7. Additional Terms.

  "Additional permissions" are terms that supplement the terms of this
License by making exceptions from one or more of its conditions.
Additional permissions that are applicable to the entire Program shall
be treated as though they were included in this License, to the extent
that they are valid under applicable law.  If additional permissions
apply only to part of the Program, that part may be used separately
under those permissions, but the entire Program remains governed by
this License without regard to the additional permissions.

  When you convey a copy of a covered work, you may at your option
remove any additional permissions from that copy, or from any part of
it.  (Additional permissions may be written to require their own
removal in certain cases when you modify the work.)  You may place
additional permissions on material, added by you to a covered work,
for which you have or can give appropriate copyright permission.

  Notwithstanding any other provision of this License, for material you
add to a covered work, you may (if authorized by the copyright holders of
that material) supplement the terms of this License with terms:

    a) Disclaiming warranty or limiting liability differently from the
    terms of sections 15 and 16 of this License; or

    b) Requiring preservation of specified reasonable legal notices or
    author attributions in that material or in the Appropriate Legal
    Notices displayed by works containing it; or

    c) Prohibiting misrepresentation of the origin of that material, or
    requiring that modified versions of such material be marked in
    reasonable ways as different from the original version; or

    d) Limiting the use for publicity purposes of names of licensors or
    authors of the material; or

    e) Declining to grant rights under trademark law for use of some
    trade names, trademarks, or service marks; or

    f) Requiring indemnification of licensors and authors of that
    material by anyone who conveys the material (or modified versions of
    it) with contractual assumptions of liability to the recipient, for
    any liability that these contractual assumptions directly impose on
    those licensors and authors.

  All other non-permissive additional terms are considered "further
restrictions" within the meaning of section 10.  If the Program as you
received it, or any part of it, contains a notice stating that it is
governed by this License along with a term that is a further
restriction, you may remove that term.  If a license document contains
a further restriction but permits relicensing or conveying under this
License, you may add to a covered work material governed by the terms
of that license document, provided that the further restriction does
not survive such relicensing or conveying.

  If you add terms to a covered work in accord with this section, you
must place, in the relevant source files, a statement of the
additional terms that apply to those files, or a notice indicating
where to find the applicable terms.

  Additional terms, permissive or non-permissive, may be stated in the
form of a separately written license, or stated as exceptions;
the above requirements apply either way.

  8. Termination.

  You may not propagate or modify a covered work except as expressly
provided under this License.  Any attempt otherwise to propagate or
modify it is void, and will automatically terminate your rights under
this License (including any patent licenses granted under the third
paragraph of section 11).

  However, if you cease all violation of this License, then your
license from a particular copyright holder is reinstated (a)
provisionally, unless and until the copyright holder explicitly and
finally terminates your license, and (b) permanently, if the copyright
holder fails to notify you of the violation by some reasonable means
prior to 60 days after the cessation.

  Moreover, your license from a particular copyright holder is
reinstated permanently if the copyright holder notifies you of the
violation by some reasonable means, this is the first time you have
received notice of violation of this License (for any work) from that
copyright holder, and you cure the violation prior to 30 days after
your receipt of the notice.

  Termination of your rights under this section does not terminate the
licenses of parties who have received copies or rights from you under
this License.  If your rights have been terminated and not permanently
reinstated, you do not qualify to receive new licenses for the same
material under section 10.

  9. Acceptance Not Required for Having Copies.

  You are not required to accept this License in order to receive or
run a copy of the Program.  Ancillary propagation of a covered work
occurring solely as a consequence of using peer-to-peer transmission
to receive a copy likewise does not require acceptance.  However,
nothing other than this License grants you permission to propagate or
modify any covered work.  These actions infringe copyright if you do
not accept this License.  Therefore, by modifying or propagating a
covered work, you indicate your acceptance of this License to do so.

  10. Automatic Licensing of Downstream Recipients.

  Each time you convey a covered work, the recipient automatically
receives a license from the original licensors, to run, modify and
propagate that work, subject to this License.  You are not responsible
for enforcing compliance by third parties with this License.

  An "entity transaction" is a transaction transferring control of an
organization, or substantially all assets of one, or subdividing an
organization, or merging organizations.  If propagation of a covered
work results from an entity transaction, each party to that
transaction who receives a copy of the work also receives whatever
licenses to the work the party's predecessor in interest had or could
give under the previous paragraph, plus a right to possession of the
Corresponding Source of the work from the predecessor in interest, if
the predecessor has it or can get it with reasonable efforts.

  You may not impose any further restrictions on the exercise of the
rights granted or affirmed under this License.  For example, you may
not impose a license fee, royalty, or other charge for exercise of
rights granted under this License, and you may not initiate litigation
(including a cross-claim or counterclaim in a lawsuit) alleging that
any patent claim is infringed by making, using, selling, offering for
sale, or importing the Program or any portion of it.

  11. Patents.

  A "contributor" is a copyright holder who authorizes use under this
License of the Program or a work on which the Program is based.  The
work thus licensed is called the contributor's "contributor version".

  A contributor's "essential patent claims" are all patent claims
owned or controlled by the contributor, whether already acquired or
hereafter acquired, that would be infringed by some manner, permitted
by this License, of making, using, or selling its contributor version,
but do not include claims that would be infringed only as a
consequence of further modification of the contributor version.  For
purposes of this definition, "control" includes the right to grant
patent sublicenses in a manner consistent with the requirements of
this License.

  Each contributor grants you a non-exclusive, worldwide, royalty-free
patent license under the contributor's essential patent claims, to
make, use, sell, offer for sale, import and otherwise run, modify and
propagate the contents of its contributor version.

  In the following three paragraphs, a "patent license" is any express
agreement or commitment, however denominated, not to enforce a patent
(such as an express permission to practice a patent or covenant not to
sue for patent infringement).  To "grant" such a patent license to a
party means to make such an agreement or commitment not to enforce a
patent against the party.

  If you convey a covered work, knowingly relying on a patent license,
and the Corresponding Source of the work is not available for anyone
to copy, free of charge and under the terms of this License, through a
publicly available network server or other readily accessible means,
then you must either (1) cause the Corresponding Source to be so
available, or (2) arrange to deprive yourself of the benefit of the
patent license for this particular work, or (3) arrange, in a manner
consistent with the requirements of this License, to extend the patent
license to downstream recipients.  "Knowingly relying" means you have
actual knowledge that, but for the patent license, your conveying the
covered work in a country, or your recipient's use of the covered work
in a country, would infringe one or more identifiable patents in that
country that you have reason to believe are valid.

  If, pursuant to or in connection with a single transaction or
arrangement, you convey, or propagate by procuring conveyance of, a
covered work, and grant a patent license to some of the parties
receiving the covered work authorizing them to use, propagate, modify
or convey a specific copy of the covered work, then the patent license
you grant is automatically extended to all recipients of the covered
work and works based on it.

  A patent license is "discriminatory" if it does not include within
the scope of its coverage, prohibits the exercise of, or is
conditioned on the non-exercise of one or more of the rights that are
specifically granted under this License.  You may not convey a covered
work if you are a party to an arrangement with a third party that is
in the business of distributing software, under which you make payment
to the third party based on the extent of your activity of conveying
the work, and under which the third party grants, to any of the
parties who would receive the covered work from you, a discriminatory
patent license (a) in connection with copies of the covered work
conveyed by you (or copies made from those copies), or (b) primarily
for and in connection with specific products or compilations that
contain the covered work, unless you entered into that arrangement,
or that patent license was granted, prior to 28 March 2007.

  Nothing in this License shall be construed as excluding or limiting
any implied license or other defenses to infringement that may
otherwise be available to you under applicable patent law.

  12. No Surrender of Others' Freedom.

  If conditions are imposed on you (whether by court order, agreement or
otherwise) that contradict the conditions of this License, they do not
excuse you from the conditions of this License.  If you cannot convey a
covered work so as to satisfy simultaneously your obligations under this
License and any other pertinent obligations, then as a consequence you may
not convey it at all.  For example, if you agree to terms that obligate you
to collect a royalty for further conveying from those to whom you convey
the Program, the only way you could satisfy both those terms and this
License would be to refrain entirely from conveying the Program.

  13. Use with the GNU Affero General Public License.

  Notwithstanding any other provision of this License, you have
permission to link or combine any covered work with a work licensed
under version 3 of the GNU Affero General Public License into a single
combined work, and to convey the resulting work.  The terms of this
License will continue to apply to the part which is the covered work,
but the special requirements of the GNU Affero General Public License,
section 13, concerning interaction through a network will apply to the
combination as such.

  14. Revised Versions of this License.

  The Free Software Foundation may publish revised and/or new versions of
the GNU General Public License from time to time.  Such new versions will
be similar in spirit to the present version, but may differ in detail to
address new problems or concerns.

  Each version is given a distinguishing version number.  If the
Program specifies that a certain numbered version of the GNU General
Public License "or any later version" applies to it, you have the
option of following the terms and conditions either of that numbered
version or of any later version published by the Free Software
Foundation.  If the Program does not specify a version number of the
GNU General Public License, you may choose any version ever published
by the Free Software Foundation.

  If the Program specifies that a proxy can decide which future
versions of the GNU General Public License can be used, that proxy's
public statement of acceptance of a version permanently authorizes you
to choose that version for the Program.

  Later license versions may give you additional or different
permissions.  However, no additional obligations are imposed on any
author or copyright holder as a result of your choosing to follow a
later version.

  15. Disclaimer of Warranty.

  THERE IS NO WARRANTY FOR THE PROGRAM, TO THE EXTENT PERMITTED BY
APPLICABLE LAW.  EXCEPT WHEN OTHERWISE STATED IN WRITING THE COPYRIGHT
HOLDERS AND/OR OTHER PARTIES PROVIDE THE PROGRAM "AS IS" WITHOUT WARRANTY
OF ANY KIND, EITHER EXPRESSED OR IMPLIED, INCLUDING, BUT NOT LIMITED TO,
THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
PURPOSE.  THE ENTIRE RISK AS TO THE QUALITY AND PERFORMANCE OF THE PROGRAM
IS WITH YOU.  SHOULD THE PROGRAM PROVE DEFECTIVE, YOU ASSUME THE COST OF
ALL NECESSARY SERVICING, REPAIR OR CORRECTION.

  16. Limitation of Liability.

  IN NO EVENT UNLESS REQUIRED BY APPLICABLE LAW OR AGREED TO IN WRITING
WILL ANY COPYRIGHT HOLDER, OR ANY OTHER PARTY WHO MODIFIES AND/OR CONVEYS
THE PROGRAM AS PERMITTED ABOVE, BE LIABLE TO YOU FOR DAMAGES, INCLUDING ANY
GENERAL, SPECIAL, INCIDENTAL OR CONSEQUENTIAL DAMAGES ARISING OUT OF THE
USE OR INABILITY TO USE THE PROGRAM (INCLUDING BUT NOT LIMITED TO LOSS OF
DATA OR DATA BEING RENDERED INACCURATE OR LOSSES SUSTAINED BY YOU OR THIRD
PARTIES OR A FAILURE OF THE PROGRAM TO OPERATE WITH ANY OTHER PROGRAMS),
EVEN IF SUCH HOLDER OR OTHER PARTY HAS BEEN ADVISED OF THE POSSIBILITY OF
SUCH DAMAGES.

  17. Interpretation of Sections 15 and 16.

  If the disclaimer of warranty and limitation of liability provided
above cannot be given local legal effect according to their terms,
reviewing courts shall apply local law that most closely approximates
an absolute waiver of all civil liability in connection with the
Program, unless a warranty or assumption of liability accompanies a
copy of the Program in return for a fee.

                     END OF TERMS AND CONDITIONS

            How to Apply These Terms to Your New Programs

  If you develop a new program, and you want it to be of the greatest
possible use to the public, the best way to achieve this is to make it
free software which everyone can redistribute and change under these terms.

  To do so, attach the following notices to the program.  It is safest
to attach them to the start of each source file to most effectively
state the exclusion of warranty; and each file should have at least
the "copyright" line and a pointer to where the full notice is found.

    {one line to give the program's name and a brief idea of what it does.}
    Copyright (C) {year}  {name of author}

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with this program.  If not, see <http://www.gnu.org/licenses/>.

Also add information on how to contact you by electronic and paper mail.

  If the program does terminal interaction, make it output a short
notice like this when it starts in an interactive mode:

    {project}  Copyright (C) {year}  {fullname}
    This program comes with ABSOLUTELY NO WARRANTY; for details type `show w'.
    This is free software, and you are welcome to redistribute it
    under certain conditions; type `show c' for details.

The hypothetical commands `show w' and `show c' should show the appropriate
parts of the General Public License.  Of course, your program's commands
might be different; for a GUI interface, you would use an "about box".

  You should also get your employer (if you work as a programmer) or school,
if any, to sign a "copyright disclaimer" for the program, if necessary.
For more information on this, and how to apply and follow the GNU GPL, see
<http://www.gnu.org/licenses/>.

  The GNU General Public License does not permit incorporating your program
into proprietary programs.  If your program is a subroutine library, you
may consider it more useful to permit linking proprietary applications with
the library.  If this is what you want to do, use the GNU Lesser General
Public License instead of this License.  But first, please read
<http://www.gnu.org/philosophy/why-not-lgpl.html>.
```

## 记忆翻牌 · Concentration Room

- ID: `croom`; version: `0.02a`; license: GPL-3.0-or-later.
- Project: https://github.com/pinobatch/croom-nes/tree/v0.02a
- ROM download: https://github.com/pinobatch/croom-nes/releases/download/v0.02a/croom.nes
- ROM SHA-256: `2ce17df1ad66a8a0533c0a8739f5b5ebe275c264924bbe350c42c5ac0394f20e` (24592 bytes).
- Source snapshot: https://codeload.github.com/pinobatch/croom-nes/zip/refs/tags/v0.02a
- Source SHA-256: `b83fe31dd5ece865215a4d3b4fb48cf673d0990f162edac52ff21bdd7c327e9f`.
- Permission evidence: `third_party/games/croom/source.zip!croom-nes-0.02a/README.md`.
- ROM language: `en` (英文原版); catalog metadata: `zh-CN`; translated ROM: no.

The fixed-tag README licenses the accompanying whole program GPL version 3 or later and explicitly permits exact iNES/UNIF copies as published by Damian Yerrick without source code. Only the exact official v0.02a iNES ROM is bundled. We include the complete corresponding tagged source and full GPL regardless. Fixed-tag src/litetitle.s credits program by Damian Yerrick and graphics by Damian Yerrick and Sara Crickard; musicseq.s credits Damian Yerrick.

菜单用 ↑/↓选择，Enter（START）或 X（A）确认，Z（B）返回可返回的子菜单；游戏中方向键移动光标，X（A）翻牌，Z（B）随机移动光标。双人可共用一只手柄或使用两只手柄，交接时下一位同时按 A+B（键盘 X+Z）。

Language evidence: Fixed-tag src/litetitle.s embeds English instructions, menus and program/graphics credits, including Flip two cards and Graphics by Damian Yerrick and Sara Crickard; no ROM translation.

Caveat: The source-free exception applies only to exact published iNES/UNIF executables; not modified ROMs or arbitrary extracted/reused graphics. We retain the source anyway.
Caveat: The fixed tag credits Sara Crickard for graphics; current HEAD is not substituted. README font/game inspirations are retained, not represented as independently cleared cover art or wholly original assets.
Caveat: No battery-backed save in the iNES header; emulator snapshots remain available. The complete tag is preserved without executing its build tools or claiming a bit-identical rebuild.

```text
记忆翻牌 · Concentration Room
License: GPL-3.0-or-later
Exact unmodified official ROM: https://github.com/pinobatch/croom-nes/releases/download/v0.02a/croom.nes
ROM SHA-256: 2ce17df1ad66a8a0533c0a8739f5b5ebe275c264924bbe350c42c5ac0394f20e
Corresponding source (unmodified, including build scripts, art and music): https://codeload.github.com/pinobatch/croom-nes/zip/refs/tags/v0.02a
Bundled source: third_party/games/croom/source.zip; also in the application's source/source.zip
Tagged commit: 209e628564ab890d05c188e7c84f80217088aa5a

Verbatim tagged README (permission, credits, requirements and caveats):

Concentration Room
==================
![Concentration Room](https://raw.githubusercontent.com/pinobatch/croom-nes/master/docs/croomlogo320.png)

A tile matching game for NES by Damian Yerrick

Overview
--------
![Screenshot](https://github.com/pinobatch/croom-nes/blob/master/docs/croom_screenshot01.png?raw=true)

An accident at the biochemical lab has released a neurotoxin,
and you've been quarantined after exposure.  Maintain your
sanity by playing a card-matching game.

The table is littered with 10, 20, 36, 52, or 72 face-down cards.
Flip two cards, and if they show the same emblem, you keep them.
If they don't, flip them back.

System Requirements
-------------------
Concentration Room is for Nintendo Entertainment System and compatible consoles (also called "famiclones"). This version is an NROM-128 (16 KiB PRG, 8 KiB CHR), and it has been tested on a [PowerPak] CompactFlash to NES adapter.
It also works in emulators such as [FCEUX].

[PowerPak]: http://www.retrousb.com/index.php?cPath=24
[FCEUX]: http://fceux.com/

Modes
-----
* 1 Player Story  
  Play solitaire to start to work the toxin out of your system.
  Then defeat other contaminated technicians and children one on one.
* 1 Player Solitaire  
  Select a difficulty level, then try to clear the table without
* 2 Players  
  Two players take turns turning over cards.  They can pass one
  controller back and forth or use one controller each.  If a pair
  doesn't match, the other player presses the A and B Buttons and
  takes a turn. The first player to take half the pairs wins.
* Vs. CPU  
  Like 2 Players, except the second player is controlled by the NES.

Questions
---------
"How long have you been working on this?"

This is actually my third try. The logo and the earliest background sketch date back to 2000. It got held up because I lacked artistic skill on the 16x16 pixel canvas. The second try in 2007 finalized the appearance of the game, and I did some work on the "emblem designer" that will show up in a future release.
In late November 2009, I discovered *[Dian Shi Mali][Waluigious Dian Shi Mali]*,
a [gambling simulator][Wikipedia Dian Shi Mali] for the Famicom (Asian version of the NES) that also uses 16x16 pixel emblems.
After a few hours of [pushing Start to rich][Dian Shi Mali video], I was inspired to create a set of 36 emblems. By then, I was ready to code most of the game in spare time during December 2009.

"Why are you still making games that don't scroll? You're better than that, as I saw in the [President video]."

I saw it as something simple that I could finish fairly quickly in order to push falling block games off the front page of [my web site][Pin Eight].

"GameTek already made two other Concentration games on the NES. Why did you make this one?"

You're referring to *I Can Remember* and *Classic Concentration*. I tried them; their controls are clunky. Neither of them features a full 72-card deck. Neither is [free software], or software that respects users' freedom.

"In vs. modes, why end the game at half the cards matched instead of one more than half?"

Pairs early in a game require more skill to clear, and the last pair requires absolutely no skill.  For example, a 20-card game tied at 4-4 will always end up 6-4.  And at 5-3, the player in the lead likely got more early matches.  So if we award no points for the last pair, the first player to reach half always wins.

"What's that font?"

* The font in the game's logo is called [Wasted Collection]. The font in [Multiboot Menu] for Game Boy Advance was based on it. <a title="Launcher for small programs for Game Boy Advance" href="http://www.pineight.com/gba/#mbmenu">Multiboot Menu</a> was based on it.
* The monospace font for menu text originally appeared in the "Who's Cuter" demo and is based on Apple [Chicago] by Susan Kare.

"Are you a Nazi?"
No, and that's why this game is called Concentration *Room,* not [Concentration Camp][National Lampoon video].

[Waluigious Dian Shi Mali]: http://www.waluigious.com/2008/09/in-which-dian-shi-ma-li.html
[Wikipedia Dian Shi Mali]: https://en.wikipedia.org/wiki/Dian_Shi_Mali
[Dian Shi Mali video]: https://www.youtube.com/watch?v=4s1mAPISOzw
[President video]: https://www.youtube.com/watch?v=GY693NxC9xU
[Pin Eight]: https://pineight.com/
[free software]: https://www.gnu.org/philosophy/free-sw.html
[Wasted Collection]: http://www.windowfonts.com/fonts/wasted-collection.html
[Multiboot Menu]: https://pineight.com/gba/#mbmenu
[Chicago]: http://en.wikipedia.org/wiki/Chicago_%28typeface%29
[National Lampoon video]: http://www.youtube.com/watch?v=cXeHn9k27Iw

Legal
-----
© 2010 Damian Yerrick &lt;croom&#64;pineight.com&gt;

Copying and distribution of this file, with or without modification, are permitted in any medium without royalty provided the copyright notice and this notice are preserved.  This file is offered as-is, without any warranty.

The accompanying program is free software: you can redistribute it and/or modify it under the terms of the [GNU General Public License], version 3 or later. As a special exception, you may copy and distribute exact copies of the program, as published by Damian Yerrick, in iNES or UNIF executable form without source code.

This product is not sponsored or endorsed by Nintendo, Ravensburger, Hasbro, Mattel, Quaker Oats, NBCUniversal, GameTek, or Apple.

[GNU General Public License]: https://www.gnu.org/licenses/gpl.html


Complete verbatim upstream GPL license:


		    GNU GENERAL PUBLIC LICENSE
		       Version 3, 29 June 2007

 Copyright (C) 2007 Free Software Foundation, Inc. <http://fsf.org/>
 Everyone is permitted to copy and distribute verbatim copies
 of this license document, but changing it is not allowed.

			    Preamble

  The GNU General Public License is a free, copyleft license for
software and other kinds of works.

  The licenses for most software and other practical works are designed
to take away your freedom to share and change the works.  By contrast,
the GNU General Public License is intended to guarantee your freedom to
share and change all versions of a program--to make sure it remains free
software for all its users.  We, the Free Software Foundation, use the
GNU General Public License for most of our software; it applies also to
any other work released this way by its authors.  You can apply it to
your programs, too.

  When we speak of free software, we are referring to freedom, not
price.  Our General Public Licenses are designed to make sure that you
have the freedom to distribute copies of free software (and charge for
them if you wish), that you receive source code or can get it if you
want it, that you can change the software or use pieces of it in new
free programs, and that you know you can do these things.

  To protect your rights, we need to prevent others from denying you
these rights or asking you to surrender the rights.  Therefore, you have
certain responsibilities if you distribute copies of the software, or if
you modify it: responsibilities to respect the freedom of others.

  For example, if you distribute copies of such a program, whether
gratis or for a fee, you must pass on to the recipients the same
freedoms that you received.  You must make sure that they, too, receive
or can get the source code.  And you must show them these terms so they
know their rights.

  Developers that use the GNU GPL protect your rights with two steps:
(1) assert copyright on the software, and (2) offer you this License
giving you legal permission to copy, distribute and/or modify it.

  For the developers' and authors' protection, the GPL clearly explains
that there is no warranty for this free software.  For both users' and
authors' sake, the GPL requires that modified versions be marked as
changed, so that their problems will not be attributed erroneously to
authors of previous versions.

  Some devices are designed to deny users access to install or run
modified versions of the software inside them, although the manufacturer
can do so.  This is fundamentally incompatible with the aim of
protecting users' freedom to change the software.  The systematic
pattern of such abuse occurs in the area of products for individuals to
use, which is precisely where it is most unacceptable.  Therefore, we
have designed this version of the GPL to prohibit the practice for those
products.  If such problems arise substantially in other domains, we
stand ready to extend this provision to those domains in future versions
of the GPL, as needed to protect the freedom of users.

  Finally, every program is threatened constantly by software patents.
States should not allow patents to restrict development and use of
software on general-purpose computers, but in those that do, we wish to
avoid the special danger that patents applied to a free program could
make it effectively proprietary.  To prevent this, the GPL assures that
patents cannot be used to render the program non-free.

  The precise terms and conditions for copying, distribution and
modification follow.

		       TERMS AND CONDITIONS

  0. Definitions.

  "This License" refers to version 3 of the GNU General Public License.

  "Copyright" also means copyright-like laws that apply to other kinds of
works, such as semiconductor masks.
 
  "The Program" refers to any copyrightable work licensed under this
License.  Each licensee is addressed as "you".  "Licensees" and
"recipients" may be individuals or organizations.

  To "modify" a work means to copy from or adapt all or part of the work
in a fashion requiring copyright permission, other than the making of an
exact copy.  The resulting work is called a "modified version" of the
earlier work or a work "based on" the earlier work.

  A "covered work" means either the unmodified Program or a work based
on the Program.

  To "propagate" a work means to do anything with it that, without
permission, would make you directly or secondarily liable for
infringement under applicable copyright law, except executing it on a
computer or modifying a private copy.  Propagation includes copying,
distribution (with or without modification), making available to the
public, and in some countries other activities as well.

  To "convey" a work means any kind of propagation that enables other
parties to make or receive copies.  Mere interaction with a user through
a computer network, with no transfer of a copy, is not conveying.

  An interactive user interface displays "Appropriate Legal Notices"
to the extent that it includes a convenient and prominently visible
feature that (1) displays an appropriate copyright notice, and (2)
tells the user that there is no warranty for the work (except to the
extent that warranties are provided), that licensees may convey the
work under this License, and how to view a copy of this License.  If
the interface presents a list of user commands or options, such as a
menu, a prominent item in the list meets this criterion.

  1. Source Code.

  The "source code" for a work means the preferred form of the work
for making modifications to it.  "Object code" means any non-source
form of a work.

  A "Standard Interface" means an interface that either is an official
standard defined by a recognized standards body, or, in the case of
interfaces specified for a particular programming language, one that
is widely used among developers working in that language.

  The "System Libraries" of an executable work include anything, other
than the work as a whole, that (a) is included in the normal form of
packaging a Major Component, but which is not part of that Major
Component, and (b) serves only to enable use of the work with that
Major Component, or to implement a Standard Interface for which an
implementation is available to the public in source code form.  A
"Major Component", in this context, means a major essential component
(kernel, window system, and so on) of the specific operating system
(if any) on which the executable work runs, or a compiler used to
produce the work, or an object code interpreter used to run it.

  The "Corresponding Source" for a work in object code form means all
the source code needed to generate, install, and (for an executable
work) run the object code and to modify the work, including scripts to
control those activities.  However, it does not include the work's
System Libraries, or general-purpose tools or generally available free
programs which are used unmodified in performing those activities but
which are not part of the work.  For example, Corresponding Source
includes interface definition files associated with source files for
the work, and the source code for shared libraries and dynamically
linked subprograms that the work is specifically designed to require,
such as by intimate data communication or control flow between those
subprograms and other parts of the work.

  The Corresponding Source need not include anything that users
can regenerate automatically from other parts of the Corresponding
Source.

  The Corresponding Source for a work in source code form is that
same work.

  2. Basic Permissions.

  All rights granted under this License are granted for the term of
copyright on the Program, and are irrevocable provided the stated
conditions are met.  This License explicitly affirms your unlimited
permission to run the unmodified Program.  The output from running a
covered work is covered by this License only if the output, given its
content, constitutes a covered work.  This License acknowledges your
rights of fair use or other equivalent, as provided by copyright law.

  You may make, run and propagate covered works that you do not
convey, without conditions so long as your license otherwise remains
in force.  You may convey covered works to others for the sole purpose
of having them make modifications exclusively for you, or provide you
with facilities for running those works, provided that you comply with
the terms of this License in conveying all material for which you do
not control copyright.  Those thus making or running the covered works
for you must do so exclusively on your behalf, under your direction
and control, on terms that prohibit them from making any copies of
your copyrighted material outside their relationship with you.

  Conveying under any other circumstances is permitted solely under
the conditions stated below.  Sublicensing is not allowed; section 10
makes it unnecessary.

  3. Protecting Users' Legal Rights From Anti-Circumvention Law.

  No covered work shall be deemed part of an effective technological
measure under any applicable law fulfilling obligations under article
11 of the WIPO copyright treaty adopted on 20 December 1996, or
similar laws prohibiting or restricting circumvention of such
measures.

  When you convey a covered work, you waive any legal power to forbid
circumvention of technological measures to the extent such circumvention
is effected by exercising rights under this License with respect to
the covered work, and you disclaim any intention to limit operation or
modification of the work as a means of enforcing, against the work's
users, your or third parties' legal rights to forbid circumvention of
technological measures.

  4. Conveying Verbatim Copies.

  You may convey verbatim copies of the Program's source code as you
receive it, in any medium, provided that you conspicuously and
appropriately publish on each copy an appropriate copyright notice;
keep intact all notices stating that this License and any
non-permissive terms added in accord with section 7 apply to the code;
keep intact all notices of the absence of any warranty; and give all
recipients a copy of this License along with the Program.

  You may charge any price or no price for each copy that you convey,
and you may offer support or warranty protection for a fee.

  5. Conveying Modified Source Versions.

  You may convey a work based on the Program, or the modifications to
produce it from the Program, in the form of source code under the
terms of section 4, provided that you also meet all of these conditions:

    a) The work must carry prominent notices stating that you modified
    it, and giving a relevant date.

    b) The work must carry prominent notices stating that it is
    released under this License and any conditions added under section
    7.  This requirement modifies the requirement in section 4 to
    "keep intact all notices".

    c) You must license the entire work, as a whole, under this
    License to anyone who comes into possession of a copy.  This
    License will therefore apply, along with any applicable section 7
    additional terms, to the whole of the work, and all its parts,
    regardless of how they are packaged.  This License gives no
    permission to license the work in any other way, but it does not
    invalidate such permission if you have separately received it.

    d) If the work has interactive user interfaces, each must display
    Appropriate Legal Notices; however, if the Program has interactive
    interfaces that do not display Appropriate Legal Notices, your
    work need not make them do so.

  A compilation of a covered work with other separate and independent
works, which are not by their nature extensions of the covered work,
and which are not combined with it such as to form a larger program,
in or on a volume of a storage or distribution medium, is called an
"aggregate" if the compilation and its resulting copyright are not
used to limit the access or legal rights of the compilation's users
beyond what the individual works permit.  Inclusion of a covered work
in an aggregate does not cause this License to apply to the other
parts of the aggregate.

  6. Conveying Non-Source Forms.

  You may convey a covered work in object code form under the terms
of sections 4 and 5, provided that you also convey the
machine-readable Corresponding Source under the terms of this License,
in one of these ways:

    a) Convey the object code in, or embodied in, a physical product
    (including a physical distribution medium), accompanied by the
    Corresponding Source fixed on a durable physical medium
    customarily used for software interchange.

    b) Convey the object code in, or embodied in, a physical product
    (including a physical distribution medium), accompanied by a
    written offer, valid for at least three years and valid for as
    long as you offer spare parts or customer support for that product
    model, to give anyone who possesses the object code either (1) a
    copy of the Corresponding Source for all the software in the
    product that is covered by this License, on a durable physical
    medium customarily used for software interchange, for a price no
    more than your reasonable cost of physically performing this
    conveying of source, or (2) access to copy the
    Corresponding Source from a network server at no charge.

    c) Convey individual copies of the object code with a copy of the
    written offer to provide the Corresponding Source.  This
    alternative is allowed only occasionally and noncommercially, and
    only if you received the object code with such an offer, in accord
    with subsection 6b.

    d) Convey the object code by offering access from a designated
    place (gratis or for a charge), and offer equivalent access to the
    Corresponding Source in the same way through the same place at no
    further charge.  You need not require recipients to copy the
    Corresponding Source along with the object code.  If the place to
    copy the object code is a network server, the Corresponding Source
    may be on a different server (operated by you or a third party)
    that supports equivalent copying facilities, provided you maintain
    clear directions next to the object code saying where to find the
    Corresponding Source.  Regardless of what server hosts the
    Corresponding Source, you remain obligated to ensure that it is
    available for as long as needed to satisfy these requirements.

    e) Convey the object code using peer-to-peer transmission, provided
    you inform other peers where the object code and Corresponding
    Source of the work are being offered to the general public at no
    charge under subsection 6d.

  A separable portion of the object code, whose source code is excluded
from the Corresponding Source as a System Library, need not be
included in conveying the object code work.

  A "User Product" is either (1) a "consumer product", which means any
tangible personal property which is normally used for personal, family,
or household purposes, or (2) anything designed or sold for incorporation
into a dwelling.  In determining whether a product is a consumer product,
doubtful cases shall be resolved in favor of coverage.  For a particular
product received by a particular user, "normally used" refers to a
typical or common use of that class of product, regardless of the status
of the particular user or of the way in which the particular user
actually uses, or expects or is expected to use, the product.  A product
is a consumer product regardless of whether the product has substantial
commercial, industrial or non-consumer uses, unless such uses represent
the only significant mode of use of the product.

  "Installation Information" for a User Product means any methods,
procedures, authorization keys, or other information required to install
and execute modified versions of a covered work in that User Product from
a modified version of its Corresponding Source.  The information must
suffice to ensure that the continued functioning of the modified object
code is in no case prevented or interfered with solely because
modification has been made.

  If you convey an object code work under this section in, or with, or
specifically for use in, a User Product, and the conveying occurs as
part of a transaction in which the right of possession and use of the
User Product is transferred to the recipient in perpetuity or for a
fixed term (regardless of how the transaction is characterized), the
Corresponding Source conveyed under this section must be accompanied
by the Installation Information.  But this requirement does not apply
if neither you nor any third party retains the ability to install
modified object code on the User Product (for example, the work has
been installed in ROM).

  The requirement to provide Installation Information does not include a
requirement to continue to provide support service, warranty, or updates
for a work that has been modified or installed by the recipient, or for
the User Product in which it has been modified or installed.  Access to a
network may be denied when the modification itself materially and
adversely affects the operation of the network or violates the rules and
protocols for communication across the network.

  Corresponding Source conveyed, and Installation Information provided,
in accord with this section must be in a format that is publicly
documented (and with an implementation available to the public in
source code form), and must require no special password or key for
unpacking, reading or copying.

  7. Additional Terms.

  "Additional permissions" are terms that supplement the terms of this
License by making exceptions from one or more of its conditions.
Additional permissions that are applicable to the entire Program shall
be treated as though they were included in this License, to the extent
that they are valid under applicable law.  If additional permissions
apply only to part of the Program, that part may be used separately
under those permissions, but the entire Program remains governed by
this License without regard to the additional permissions.

  When you convey a copy of a covered work, you may at your option
remove any additional permissions from that copy, or from any part of
it.  (Additional permissions may be written to require their own
removal in certain cases when you modify the work.)  You may place
additional permissions on material, added by you to a covered work,
for which you have or can give appropriate copyright permission.

  Notwithstanding any other provision of this License, for material you
add to a covered work, you may (if authorized by the copyright holders of
that material) supplement the terms of this License with terms:

    a) Disclaiming warranty or limiting liability differently from the
    terms of sections 15 and 16 of this License; or

    b) Requiring preservation of specified reasonable legal notices or
    author attributions in that material or in the Appropriate Legal
    Notices displayed by works containing it; or

    c) Prohibiting misrepresentation of the origin of that material, or
    requiring that modified versions of such material be marked in
    reasonable ways as different from the original version; or

    d) Limiting the use for publicity purposes of names of licensors or
    authors of the material; or

    e) Declining to grant rights under trademark law for use of some
    trade names, trademarks, or service marks; or

    f) Requiring indemnification of licensors and authors of that
    material by anyone who conveys the material (or modified versions of
    it) with contractual assumptions of liability to the recipient, for
    any liability that these contractual assumptions directly impose on
    those licensors and authors.

  All other non-permissive additional terms are considered "further
restrictions" within the meaning of section 10.  If the Program as you
received it, or any part of it, contains a notice stating that it is
governed by this License along with a term that is a further
restriction, you may remove that term.  If a license document contains
a further restriction but permits relicensing or conveying under this
License, you may add to a covered work material governed by the terms
of that license document, provided that the further restriction does
not survive such relicensing or conveying.

  If you add terms to a covered work in accord with this section, you
must place, in the relevant source files, a statement of the
additional terms that apply to those files, or a notice indicating
where to find the applicable terms.

  Additional terms, permissive or non-permissive, may be stated in the
form of a separately written license, or stated as exceptions;
the above requirements apply either way.

  8. Termination.

  You may not propagate or modify a covered work except as expressly
provided under this License.  Any attempt otherwise to propagate or
modify it is void, and will automatically terminate your rights under
this License (including any patent licenses granted under the third
paragraph of section 11).

  However, if you cease all violation of this License, then your
license from a particular copyright holder is reinstated (a)
provisionally, unless and until the copyright holder explicitly and
finally terminates your license, and (b) permanently, if the copyright
holder fails to notify you of the violation by some reasonable means
prior to 60 days after the cessation.

  Moreover, your license from a particular copyright holder is
reinstated permanently if the copyright holder notifies you of the
violation by some reasonable means, this is the first time you have
received notice of violation of this License (for any work) from that
copyright holder, and you cure the violation prior to 30 days after
your receipt of the notice.

  Termination of your rights under this section does not terminate the
licenses of parties who have received copies or rights from you under
this License.  If your rights have been terminated and not permanently
reinstated, you do not qualify to receive new licenses for the same
material under section 10.

  9. Acceptance Not Required for Having Copies.

  You are not required to accept this License in order to receive or
run a copy of the Program.  Ancillary propagation of a covered work
occurring solely as a consequence of using peer-to-peer transmission
to receive a copy likewise does not require acceptance.  However,
nothing other than this License grants you permission to propagate or
modify any covered work.  These actions infringe copyright if you do
not accept this License.  Therefore, by modifying or propagating a
covered work, you indicate your acceptance of this License to do so.

  10. Automatic Licensing of Downstream Recipients.

  Each time you convey a covered work, the recipient automatically
receives a license from the original licensors, to run, modify and
propagate that work, subject to this License.  You are not responsible
for enforcing compliance by third parties with this License.

  An "entity transaction" is a transaction transferring control of an
organization, or substantially all assets of one, or subdividing an
organization, or merging organizations.  If propagation of a covered
work results from an entity transaction, each party to that
transaction who receives a copy of the work also receives whatever
licenses to the work the party's predecessor in interest had or could
give under the previous paragraph, plus a right to possession of the
Corresponding Source of the work from the predecessor in interest, if
the predecessor has it or can get it with reasonable efforts.

  You may not impose any further restrictions on the exercise of the
rights granted or affirmed under this License.  For example, you may
not impose a license fee, royalty, or other charge for exercise of
rights granted under this License, and you may not initiate litigation
(including a cross-claim or counterclaim in a lawsuit) alleging that
any patent claim is infringed by making, using, selling, offering for
sale, or importing the Program or any portion of it.

  11. Patents.

  A "contributor" is a copyright holder who authorizes use under this
License of the Program or a work on which the Program is based.  The
work thus licensed is called the contributor's "contributor version".

  A contributor's "essential patent claims" are all patent claims
owned or controlled by the contributor, whether already acquired or
hereafter acquired, that would be infringed by some manner, permitted
by this License, of making, using, or selling its contributor version,
but do not include claims that would be infringed only as a
consequence of further modification of the contributor version.  For
purposes of this definition, "control" includes the right to grant
patent sublicenses in a manner consistent with the requirements of
this License.

  Each contributor grants you a non-exclusive, worldwide, royalty-free
patent license under the contributor's essential patent claims, to
make, use, sell, offer for sale, import and otherwise run, modify and
propagate the contents of its contributor version.

  In the following three paragraphs, a "patent license" is any express
agreement or commitment, however denominated, not to enforce a patent
(such as an express permission to practice a patent or covenant not to
sue for patent infringement).  To "grant" such a patent license to a
party means to make such an agreement or commitment not to enforce a
patent against the party.

  If you convey a covered work, knowingly relying on a patent license,
and the Corresponding Source of the work is not available for anyone
to copy, free of charge and under the terms of this License, through a
publicly available network server or other readily accessible means,
then you must either (1) cause the Corresponding Source to be so
available, or (2) arrange to deprive yourself of the benefit of the
patent license for this particular work, or (3) arrange, in a manner
consistent with the requirements of this License, to extend the patent
license to downstream recipients.  "Knowingly relying" means you have
actual knowledge that, but for the patent license, your conveying the
covered work in a country, or your recipient's use of the covered work
in a country, would infringe one or more identifiable patents in that
country that you have reason to believe are valid.
  
  If, pursuant to or in connection with a single transaction or
arrangement, you convey, or propagate by procuring conveyance of, a
covered work, and grant a patent license to some of the parties
receiving the covered work authorizing them to use, propagate, modify
or convey a specific copy of the covered work, then the patent license
you grant is automatically extended to all recipients of the covered
work and works based on it.

  A patent license is "discriminatory" if it does not include within
the scope of its coverage, prohibits the exercise of, or is
conditioned on the non-exercise of one or more of the rights that are
specifically granted under this License.  You may not convey a covered
work if you are a party to an arrangement with a third party that is
in the business of distributing software, under which you make payment
to the third party based on the extent of your activity of conveying
the work, and under which the third party grants, to any of the
parties who would receive the covered work from you, a discriminatory
patent license (a) in connection with copies of the covered work
conveyed by you (or copies made from those copies), or (b) primarily
for and in connection with specific products or compilations that
contain the covered work, unless you entered into that arrangement,
or that patent license was granted, prior to 28 March 2007.

  Nothing in this License shall be construed as excluding or limiting
any implied license or other defenses to infringement that may
otherwise be available to you under applicable patent law.

  12. No Surrender of Others' Freedom.

  If conditions are imposed on you (whether by court order, agreement or
otherwise) that contradict the conditions of this License, they do not
excuse you from the conditions of this License.  If you cannot convey a
covered work so as to satisfy simultaneously your obligations under this
License and any other pertinent obligations, then as a consequence you may
not convey it at all.  For example, if you agree to terms that obligate you
to collect a royalty for further conveying from those to whom you convey
the Program, the only way you could satisfy both those terms and this
License would be to refrain entirely from conveying the Program.

  13. Use with the GNU Affero General Public License.

  Notwithstanding any other provision of this License, you have
permission to link or combine any covered work with a work licensed
under version 3 of the GNU Affero General Public License into a single
combined work, and to convey the resulting work.  The terms of this
License will continue to apply to the part which is the covered work,
but the special requirements of the GNU Affero General Public License,
section 13, concerning interaction through a network will apply to the
combination as such.

  14. Revised Versions of this License.

  The Free Software Foundation may publish revised and/or new versions of
the GNU General Public License from time to time.  Such new versions will
be similar in spirit to the present version, but may differ in detail to
address new problems or concerns.

  Each version is given a distinguishing version number.  If the
Program specifies that a certain numbered version of the GNU General
Public License "or any later version" applies to it, you have the
option of following the terms and conditions either of that numbered
version or of any later version published by the Free Software
Foundation.  If the Program does not specify a version number of the
GNU General Public License, you may choose any version ever published
by the Free Software Foundation.

  If the Program specifies that a proxy can decide which future
versions of the GNU General Public License can be used, that proxy's
public statement of acceptance of a version permanently authorizes you
to choose that version for the Program.

  Later license versions may give you additional or different
permissions.  However, no additional obligations are imposed on any
author or copyright holder as a result of your choosing to follow a
later version.

  15. Disclaimer of Warranty.

  THERE IS NO WARRANTY FOR THE PROGRAM, TO THE EXTENT PERMITTED BY
APPLICABLE LAW.  EXCEPT WHEN OTHERWISE STATED IN WRITING THE COPYRIGHT
HOLDERS AND/OR OTHER PARTIES PROVIDE THE PROGRAM "AS IS" WITHOUT WARRANTY
OF ANY KIND, EITHER EXPRESSED OR IMPLIED, INCLUDING, BUT NOT LIMITED TO,
THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
PURPOSE.  THE ENTIRE RISK AS TO THE QUALITY AND PERFORMANCE OF THE PROGRAM
IS WITH YOU.  SHOULD THE PROGRAM PROVE DEFECTIVE, YOU ASSUME THE COST OF
ALL NECESSARY SERVICING, REPAIR OR CORRECTION.

  16. Limitation of Liability.

  IN NO EVENT UNLESS REQUIRED BY APPLICABLE LAW OR AGREED TO IN WRITING
WILL ANY COPYRIGHT HOLDER, OR ANY OTHER PARTY WHO MODIFIES AND/OR CONVEYS
THE PROGRAM AS PERMITTED ABOVE, BE LIABLE TO YOU FOR DAMAGES, INCLUDING ANY
GENERAL, SPECIAL, INCIDENTAL OR CONSEQUENTIAL DAMAGES ARISING OUT OF THE
USE OR INABILITY TO USE THE PROGRAM (INCLUDING BUT NOT LIMITED TO LOSS OF
DATA OR DATA BEING RENDERED INACCURATE OR LOSSES SUSTAINED BY YOU OR THIRD
PARTIES OR A FAILURE OF THE PROGRAM TO OPERATE WITH ANY OTHER PROGRAMS),
EVEN IF SUCH HOLDER OR OTHER PARTY HAS BEEN ADVISED OF THE POSSIBILITY OF
SUCH DAMAGES.

  17. Interpretation of Sections 15 and 16.

  If the disclaimer of warranty and limitation of liability provided
above cannot be given local legal effect according to their terms,
reviewing courts shall apply local law that most closely approximates
an absolute waiver of all civil liability in connection with the
Program, unless a warranty or assumption of liability accompanies a
copy of the Program in return for a fee.

		     END OF TERMS AND CONDITIONS

	    How to Apply These Terms to Your New Programs

  If you develop a new program, and you want it to be of the greatest
possible use to the public, the best way to achieve this is to make it
free software which everyone can redistribute and change under these terms.

  To do so, attach the following notices to the program.  It is safest
to attach them to the start of each source file to most effectively
state the exclusion of warranty; and each file should have at least
the "copyright" line and a pointer to where the full notice is found.

    <one line to give the program's name and a brief idea of what it does.>
    Copyright (C) <year>  <name of author>

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with this program.  If not, see <http://www.gnu.org/licenses/>.

Also add information on how to contact you by electronic and paper mail.

  If the program does terminal interaction, make it output a short
notice like this when it starts in an interactive mode:

    <program>  Copyright (C) <year>  <name of author>
    This program comes with ABSOLUTELY NO WARRANTY; for details type `show w'.
    This is free software, and you are welcome to redistribute it
    under certain conditions; type `show c' for details.

The hypothetical commands `show w' and `show c' should show the appropriate
parts of the General Public License.  Of course, your program's commands
might be different; for a GUI interface, you would use an "about box".

  You should also get your employer (if you work as a programmer) or school,
if any, to sign a "copyright disclaimer" for the program, if necessary.
For more information on this, and how to apply and follow the GNU GPL, see
<http://www.gnu.org/licenses/>.

  The GNU General Public License does not permit incorporating your program
into proprietary programs.  If your program is a subroutine library, you
may consider it more useful to permit linking proprietary applications with
the library.  If this is what you want to do, use the GNU Lesser General
Public License instead of this License.  But first, please read
<http://www.gnu.org/philosophy/why-not-lgpl.html>.



Verbatim fixed-tag program/graphics credit source:
coprNoticeText:
  .byt "Build time: "
  decbytes .time
  .byt $0A
  .byt $07," 2010 Damian Yerrick",$0A
  .byt "Comes with ABSOLUTELY NO",$0A
  .byt "WARRANTY.  This is free",$0A     
  .byt "software, and you are",$0A
  .byt "welcome to spread it",$0A  
  .byt "under certain conditions;",$0A
  .byt "see GPLv3.txt for details.",$0A,$0A
  .byt "Program by Damian Yerrick",$0A
  .byt "Graphics by Damian Yerrick",$0A
  .byt "and Sara Crickard",$0A,$0A
```

