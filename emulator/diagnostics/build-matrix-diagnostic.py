#!/usr/bin/env python3
"""Build only an input-port diagnostic, derived from KeyTest ReadKeyboard (MIT).

Copyright (C) 2023 Zorchenhimer. See ../licenses/KeyTest-MIT.txt for the
complete MIT permission and warranty notice retained with this derivative.

No external assembler is required. The emit/label helpers below encode the small
6502 scanner directly. Guest code reads the REAL $4016/$4017 bus and records raw
active-low matrix bytes in $0200..$0219, plus joypad bytes at $0300..$0301.
Completed matrix reads are published at $0400..$0419 and joypads at $0420..$0421.
The 13-row loop covers Family's 9 rows (then wraps) and Subor's 13 rows.
"""
from pathlib import Path

HERE = Path(__file__).resolve().parent
code = bytearray()
labels = {}
fixups = []


def emit(*values):
    code.extend(values)


def label(name):
    labels[name] = 0x8000 + len(code)


def branch(op, target):
    emit(op, 0)
    fixups.append((len(code) - 1, target, True))


def jump(op, target):
    emit(op, 0, 0)
    fixups.append((len(code) - 2, target, False))


label('reset')
emit(0x78, 0xD8)                       # SEI / CLD
emit(0xA2, 0xFF, 0x9A)                 # LDX #$ff / TXS
emit(0xA9, 0x00, 0x8D, 0x00, 0x20)     # disable PPU NMI
emit(0x8D, 0x01, 0x20)                 # disable rendering
emit(0xA9, 0x40, 0x8D, 0x17, 0x40)     # disable APU IRQ
emit(0xA9, 0x00, 0x8D, 0x10, 0x40)     # disable DMC IRQ
emit(0x85, 0x00)                       # scan count
label('scan')
# KeyTest keyboard.asm ReadKeyboard lines 158..188: reset row, read both
# columns, falling edge advances row. Retain raw bytes for unambiguous asserts.
emit(0xA9, 0x05, 0x8D, 0x16, 0x40)
emit(0xA9, 0x04, 0x8D, 0x16, 0x40)
emit(0xA2, 0x00)
label('matrix')
emit(0xAD, 0x17, 0x40, 0x29, 0x1E, 0x9D, 0x00, 0x02, 0xE8)
emit(0xA9, 0x06, 0x8D, 0x16, 0x40)
emit(0xAD, 0x17, 0x40, 0x29, 0x1E, 0x9D, 0x00, 0x02, 0xE8)
emit(0xA9, 0x04, 0x8D, 0x16, 0x40)
emit(0xE0, 0x1A)
branch(0xD0, 'matrix')
# Read 2 standard controllers through the same guest bus. Serial A becomes
# bit 7, B bit 6, Select bit 5, Start bit 4, Up bit 3 .. Right bit 0.
emit(0xA9, 0x01, 0x8D, 0x16, 0x40)
emit(0xA9, 0x00, 0x8D, 0x16, 0x40)
emit(0x8D, 0x00, 0x03, 0x8D, 0x01, 0x03)
emit(0xA2, 0x08)
label('joy')
emit(0xAD, 0x16, 0x40, 0x4A, 0x2E, 0x00, 0x03)
emit(0xAD, 0x17, 0x40, 0x4A, 0x2E, 0x01, 0x03)
emit(0xCA)
branch(0xD0, 'joy')
# Publish completed reads separately: the host can pause the CPU mid-scan.
emit(0xAD, 0x00, 0x03, 0x8D, 0x20, 0x04)
emit(0xAD, 0x01, 0x03, 0x8D, 0x21, 0x04)
emit(0xA2, 0x19)
label('publish')
emit(0xBD, 0x00, 0x02, 0x9D, 0x00, 0x04, 0xCA)
branch(0x10, 'publish')
emit(0xE6, 0x00)
jump(0x4C, 'scan')
label('irq')
emit(0x40)

for pos, target, relative in fixups:
    address = labels[target]
    if relative:
        offset = address - (0x8000 + pos + 1)
        if not -128 <= offset <= 127:
            raise ValueError('branch too far')
        code[pos] = offset & 0xFF
    else:
        code[pos:pos+2] = address.to_bytes(2, 'little')

prg = bytearray([0xEA] * 16384)
prg[:len(code)] = code
for offset, name in [(0x3FFA, 'irq'), (0x3FFC, 'reset'), (0x3FFE, 'irq')]:
    prg[offset:offset+2] = labels[name].to_bytes(2, 'little')
# battery flag gives the SRAM API a real mapped 8 KiB bank for round-trip tests.
header = b'NES\x1a' + bytes([1, 0, 2, 0]) + bytes(8)
output = HERE / 'matrix-diagnostic.nes'
output.write_bytes(header + prg)
print(f'{output}: {len(code)} diagnostic code bytes, {len(header + prg)} ROM bytes')
