#!/usr/bin/env python3
"""
Extract all unique c1/c2 字根 from keytao-split.csv,
map each to its stroke code, and write to zixing.csv.
"""

import csv
import os

# Stroke-to-code mapping based on keytao stroke rules:
# Basic strokes: 一(v) 丨(i) 丿(u) 丶(o) 乙(a)
# Named single-key radicals share the same key as their primary stroke type
# Dual-code radicals use two-character codes
CHAR_TO_CODE = {
    # Basic strokes
    '一': 'v',
    '丨': 'i',
    '丿': 'u',
    '丶': 'o',
    '乙': 'a',
    # Named radicals (single key, same as basic stroke)
    '人': 'i',
    '口': 'o',
    '月': 'u',
    '木': 'v',
    '水': 'a',
    # Dual-code radicals
    '贝': 'ao',
    '艹': 'ii',
    '金': 'io',
    '手': 'iu',
    '日': 'oi',
    '十': 'uo',
    '土': 'vo',
}


def encode(zixing: str) -> str:
    code = []
    for ch in zixing:
        if ch in CHAR_TO_CODE:
            code.append(CHAR_TO_CODE[ch])
        else:
            code.append('?')
    return ''.join(code)


def main():
    src = os.path.join(os.path.dirname(__file__), '../config/keytao-split.csv')
    dst = os.path.join(os.path.dirname(__file__), '../config/zixing.csv')

    chars = set()
    with open(src, encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            for col in ('c1', 'c2'):
                for ch in (row.get(col) or ''):
                    chars.add(ch)

    rows = sorted(chars)

    with open(dst, 'w', encoding='utf-8', newline='') as f:
        writer = csv.writer(f)
        writer.writerow(['字形', '编码'])
        for zixing in rows:
            code = CHAR_TO_CODE.get(zixing, '?')
            writer.writerow([zixing, code])

    print(f'Written {len(rows)} unique 字根 to {dst}')

    unknown = [z for z in rows if CHAR_TO_CODE.get(z) is None]
    if unknown:
        print(f'Unknown: {unknown}')


if __name__ == '__main__':
    main()
