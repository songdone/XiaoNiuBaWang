/**
 * NES Game Genie (6-char & 8-char PRG-ROM patch) and System RAM lock ($0000-$07FF) engine.
 */

const GG_ALPHABET = 'APZLGITYEOXUKSVN';
const CHEATS_STORAGE_KEY = 'xnbw.cheats.v1';
const MAX_CHEATS_PER_GAME = 32;

export interface ParsedGameGenie {
  kind: 'gg';
  code: string;
  address: number; // 0x8000..0xFFFF
  value: number;   // 0x00..0xFF
  compare?: number; // 0x00..0xFF (8-char codes only)
}

export interface ParsedRamCheat {
  kind: 'ram';
  code: string;
  address: number; // 0x0000..0x07FF
  value: number;   // 0x00..0xFF
}

export type ParsedCheat = ParsedGameGenie | ParsedRamCheat;

export interface CheatEntry {
  id: string;
  code: string;
  label: string;
  enabled: boolean;
}

export interface RamCheatLock {
  address: number;
  value: number;
}

/** Parse a 6/8-letter NES Game Genie code or a RAM lock code like `0032:1E`. */
export function parseCheatCode(raw: string): ParsedCheat {
  const cleaned = raw.trim().toUpperCase().replace(/[\s-]+/g, '');
  if (!cleaned) {
    throw new Error('请输入金手指代码。');
  }

  // RAM lock syntax: optional $, 1-4 hex digits, colon/equals, 1-2 hex digits (e.g. 0032:1E)
  const ramMatch = /^\$?([0-9A-F]{1,4})[:=]([0-9A-F]{1,2})$/.exec(cleaned);
  if (ramMatch) {
    const address = Number.parseInt(ramMatch[1], 16);
    const value = Number.parseInt(ramMatch[2], 16);
    if (address < 0 || address > 0x07ff) {
      throw new Error('内存锁定地址需在 0000–07FF（NES 2 KiB 系统内存）范围内。');
    }
    return {
      kind: 'ram',
      code: `${address.toString(16).toUpperCase().padStart(4, '0')}:${value.toString(16).toUpperCase().padStart(2, '0')}`,
      address,
      value,
    };
  }

  if (cleaned.length !== 6 && cleaned.length !== 8) {
    throw new Error('金手指格式无效：请输入 6 位或 8 位 Game Genie 字母码（如 SXIOPO / SLXPLOVS），或内存锁定码（如 0032:1E）。');
  }
  const nibbles: number[] = [];
  for (const ch of cleaned) {
    const idx = GG_ALPHABET.indexOf(ch);
    if (idx < 0) {
      throw new Error(`Game Genie 代码包含无效字符“${ch}”，仅支持字母 ${GG_ALPHABET}。`);
    }
    nibbles.push(idx);
  }
  const [n0, n1, n2, n3, n4, n5, n6, n7] = nibbles;
  const address = 0x8000
    | ((n3 & 7) << 12)
    | ((n5 & 7) << 8) | ((n4 & 8) << 8)
    | ((n2 & 7) << 4) | ((n1 & 8) << 4)
    | (n4 & 7) | (n3 & 8);

  if (cleaned.length === 6) {
    const value = ((n1 & 7) << 4) | ((n0 & 8) << 4) | (n0 & 7) | (n5 & 8);
    return { kind: 'gg', code: cleaned, address, value };
  }
  const value = ((n1 & 7) << 4) | ((n0 & 8) << 4) | (n0 & 7) | (n7 & 8);
  const compare = ((n7 & 7) << 4) | ((n6 & 8) << 4) | (n6 & 7) | (n5 & 8);
  return { kind: 'gg', code: cleaned, address, value, compare };
}

/**
 * Apply enabled Game Genie PRG-ROM patches to an iNES / NES 2.0 ROM copy.
 * Original ROM bytes are never mutated; returns patched copy + total modified bytes.
 */
export function applyGameGeniePatches(rom: Uint8Array, cheats: CheatEntry[]): { bytes: Uint8Array; patchedBytes: number; ramLocks: RamCheatLock[] } {
  const ggCodes: ParsedGameGenie[] = [];
  const ramLocks: RamCheatLock[] = [];
  for (const entry of cheats) {
    if (!entry.enabled) continue;
    try {
      const parsed = parseCheatCode(entry.code);
      if (parsed.kind === 'gg') ggCodes.push(parsed);
      else ramLocks.push({ address: parsed.address, value: parsed.value });
    } catch {
      // Ignore malformed stored entries rather than blocking playback.
    }
  }
  if (!ggCodes.length || rom.length < 16 || rom[0] !== 0x4e || rom[1] !== 0x45 || rom[2] !== 0x53 || rom[3] !== 0x1a) {
    return { bytes: rom, patchedBytes: 0, ramLocks };
  }

  const trainer = (rom[6] & 0x04) !== 0 ? 512 : 0;
  const prgStart = 16 + trainer;
  const isNes2 = (rom[7] & 0x0c) === 0x08;
  let prgBanks16k = rom[4];
  if (isNes2) {
    const hi = rom[9] & 0x0f;
    if (hi < 0x0f) prgBanks16k |= hi << 8;
  }
  const prgLen = Math.min(rom.length - prgStart, prgBanks16k * 16384);
  if (prgLen <= 0) return { bytes: rom, patchedBytes: 0, ramLocks };

  const out = rom.slice();
  let patchedBytes = 0;

  for (const code of ggCodes) {
    const cpuOffset = code.address - 0x8000;
    if (code.compare !== undefined) {
      // 8-char Game Genie intercepts any 8 KiB PRG window whose byte matches `compare`.
      const bankSize = 8192;
      const withinBank = cpuOffset & (bankSize - 1);
      for (let bankStart = 0; bankStart + withinBank < prgLen; bankStart += bankSize) {
        const fileIdx = prgStart + bankStart + withinBank;
        if (rom[fileIdx] === code.compare) {
          out[fileIdx] = code.value;
          patchedBytes++;
        }
      }
    } else if (prgLen <= 32768) {
      // NROM-128 (16 KiB mirrored) or NROM-256 (32 KiB linear)
      const fileIdx = prgStart + (cpuOffset % prgLen);
      if (fileIdx < prgStart + prgLen) {
        out[fileIdx] = code.value;
        patchedBytes++;
      }
    } else {
      // Larger ROM with 6-char code: apply across each 32 KiB window.
      const bankSize = 32768;
      const withinBank = cpuOffset & (bankSize - 1);
      for (let bankStart = 0; bankStart + withinBank < prgLen; bankStart += bankSize) {
        const fileIdx = prgStart + bankStart + withinBank;
        out[fileIdx] = code.value;
        patchedBytes++;
      }
    }
  }
  return { bytes: out, patchedBytes, ramLocks };
}

function readCheatStore(): Record<string, CheatEntry[]> {
  try {
    const raw = window.localStorage.getItem(CHEATS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? parsed as Record<string, CheatEntry[]> : {};
  } catch {
    return {};
  }
}

export function loadGameCheats(gameKey: string): CheatEntry[] {
  if (!gameKey) return [];
  const list = readCheatStore()[gameKey];
  if (!Array.isArray(list)) return [];
  return list
    .filter((item): item is CheatEntry => !!item && typeof item.id === 'string' && typeof item.code === 'string' && typeof item.label === 'string' && typeof item.enabled === 'boolean')
    .slice(0, MAX_CHEATS_PER_GAME);
}

export function saveGameCheats(gameKey: string, entries: CheatEntry[]) {
  if (!gameKey) return;
  try {
    const store = readCheatStore();
    if (entries.length === 0) delete store[gameKey];
    else store[gameKey] = entries.slice(0, MAX_CHEATS_PER_GAME);
    window.localStorage.setItem(CHEATS_STORAGE_KEY, JSON.stringify(store));
  } catch { /* Ignore storage quota/availability failures. */ }
}
