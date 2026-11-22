# VOID LANCER

**Current release: v1.0.0**

An original open-source vertical shooter for the Nintendo Entertainment System / Famicom.

![VOID LANCER title screen](docs/screenshots/title.png)

![VOID LANCER gameplay preview](docs/screenshots/gameplay.png)

![VOID LANCER Dust Belt preview](docs/screenshots/gameplay-s1.png)

![VOID LANCER boss preview](docs/screenshots/gameplay-s3.png)

VOID LANCER is designed around real NES constraints rather than a modern game wearing an 8-bit filter. It targets **mapper 0 / NROM-256**, uses an original **8 KiB CHR-ROM**, updates OAM through DMA during NMI, and drives the native NES APU directly.

No graphics, music, code, maps, or names are ripped from commercial games. Historical shooters were studied only to understand pacing, stage readability, scoring, power-up cadence, adaptive pressure, and hardware-era presentation.

## Current playable build

- 256×240 NTSC-oriented vertical shooter
- Illustrated title screen with beveled custom logo, 48×48 void core, hero craft and palette-zoned texture
- 3 stage themes: Dust Belt, Neon Orbit, Core Relay
- Final boss
- 3 lives / 3 Pulse bombs
- 3 weapon levels
- Formation-style enemy spawning
- Visible 0–7 **Threat** gauge inspired by the idea of adaptive pressure in early shooters
- Compact sprite HUD for score, weapon level, stage, lives, Pulse stock and Threat
- Six-track original 2A03 soundtrack: Title, Stage 1, Stage 2, Stage 3/Core, Boss and Victory
- 128-step music engine with per-song tempo, animated pulse duty, per-frame volume shaping, subtle lead vibrato and authored Noise drums
- Original pulse/triangle/noise SFX with channel stealing/recovery
- Original generated CHR graphics and nametables
- Stage-specific **16×16 regular enemies** with two animation frames per type, biome-specific enemy bullets, animated power crystal and weapon-level projectile silhouettes
- Expanded CHR art vocabulary: Dust Belt rock/crater/debris tiles, Neon Orbit vents/hatches/conduits, Core Relay coils/ports/broken machinery, six 16×16 explosion frames, boss modules and extension-ready special-enemy art
- Filled late-80s-style sprite silhouettes, animated engine flame, dense scenery tiles and a 32×24 final carrier boss
- Game Over and Mission Complete screens

## Controls

| Input | Action |
| --- | --- |
| D-pad | Move |
| A | Fire |
| B | Pulse bomb |
| Start | Start / restart |

## Build a `.nes` ROM

The default build has **no third-party Python dependencies**.

### Windows / PowerShell

```powershell
py tools/build.py
py tools/smoke_test.py
```

### Linux / macOS

```bash
python3 tools/build.py
python3 tools/smoke_test.py
```

Output:

```text
build/void-lancer.nes
```

The build script generates the CHR and nametable assets, assembles the 6502 source, writes an iNES header, validates interrupt vectors, and emits a SHA-256 checksum.

## Development

```bash
make          # build ROM
make test     # build + soundtrack validation + CPU control-flow smoke test
make preview  # regenerate repository screenshots
make audio    # render approximate WAV audition files
make clean
```

The project includes a tiny purpose-built assembler in `tools/asm6502.py`. It supports only the 6502 addressing modes/directives used by this project and expands conditional branches into safe long-branch sequences. This keeps the repository self-contained and makes the ROM buildable on a clean machine with Python 3.

## Hardware target

- CPU: Ricoh 2A03 / 6502-family instruction set
- PPU: 2C02-style NTSC target
- Mapper: 0 (NROM)
- PRG-ROM: 32 KiB
- CHR-ROM: 8 KiB
- Mirroring: vertical
- Audio: Pulse 1, Pulse 2, Triangle, Noise
- DPCM: not used
- Save RAM: not used

See [`docs/TECHNICAL.md`](docs/TECHNICAL.md) for the memory map/rendering architecture and [`docs/SOUNDTRACK.md`](docs/SOUNDTRACK.md) for the music design.

## Design research

The design study focused on representative NES/Famicom shooters, including gameplay systems **and title-screen composition**:

- **Star Soldier** — speed, enemy density, score-attack focus and Caravan-era readability
- **Zanac** — the idea of pressure changing in response to player behavior
- **Gradius** — visible upgrade cadence and formation-linked reward logic
- **1943** — mission progression, special-resource decisions and formation rewards
- **Life Force / Over Horizon / The Guardian Legend / Recca** — large filled logos, focal illustrations, palette/value hierarchy and minimal menu chrome

The actual mechanics are deliberately not direct copies. Research notes and source links are in [`docs/RESEARCH.md`](docs/RESEARCH.md), and the full game specification is in [`docs/GAME_DESIGN.md`](docs/GAME_DESIGN.md).

## Repository layout

```text
src/main.asm                 Game code and APU music data
assets/chr.bin               Generated 8 KiB CHR-ROM
assets/*.nam                 Generated 1 KiB nametables
assets/tiles.png             Raw BG + sprite CHR contact sheet
assets/art-atlas.png         Assembled sprite/effect atlas
 tools/asm6502.py            Tiny two-pass 6502 assembler
 tools/gen_assets.py         Original pixel/font/nametable generator
 tools/build.py              iNES ROM builder
 tools/smoke_test.py         Lightweight 6502 control-flow test
 tools/music_test.py         Static soundtrack/pattern validator
 tools/render_audio_preview.py Approximate desktop WAV audition renderer
 tools/render_preview.py     Screenshot renderer for docs
 docs/                       Research/spec/technical notes
.github/workflows/build.yml  CI ROM build + artifact
```

## Prepare a release

The repository includes a small release packager. It builds the ROM, runs both tests, and creates versioned ROM/source/checksum files under `dist/`.

```powershell
py tools/release.py 1.0.0
```

`VERSION` is the canonical release version.

## Publish to GitHub

From the repository root, the included PowerShell helper can create the public repository, fill the About description/topics, push `main`, tag `v1.0.0`, and push the tag:

```powershell
pwsh -File tools/publish_github.ps1
```

Or run the equivalent commands manually; see the release notes accompanying the source package.

After that, pushing a tag such as `v1.0.0` triggers `.github/workflows/release.yml`, which builds/tests the ROM and attaches a versioned `.nes` plus its SHA-256 file to a GitHub Release.

## Emulator / hardware notes

The ROM is built to standard mapper-0 iNES conventions. The included smoke test executes the game code with stubbed I/O to catch assembler/control-flow errors, but it is **not a cycle-accurate PPU/APU emulator**. Before making a physical cartridge, verify the release ROM on an accurate emulator such as Mesen or on a flash cartridge / test board.

## License

MIT. See [`LICENSE`](LICENSE).

Historical screenshots and external research references are **not** included in this repository and are not covered by the project license.
