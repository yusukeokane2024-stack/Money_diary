"""アプリアイコン (src/icon.svg) を生成する。絵柄を変えたいときはこのファイルを編集して実行する。
   python3 scripts/make-icons.py  →  src/icon.svg を書き出す。PNG は scripts/make-icons.mjs で作る。"""
import math

CX = CY = 256
R, W = 128, 64            # ドーナツの半径と太さ
GAP = 4.5                 # セグメントの隙間 (度)
# (割合, 明るい色, 濃い色)  — アプリのカテゴリ色と揃えたパレット
SEGS = [
    (0.36, '#ffb35c', '#e8730c'),   # オレンジ
    (0.27, '#6fd0f5', '#1f8fd6'),   # ブルー
    (0.19, '#ffe27a', '#f0b400'),   # イエロー
    (0.11, '#ff8f9a', '#e0364f'),   # レッド
    (0.07, '#7ee2a6', '#27a468'),   # グリーン
]

def pt(deg, r):
    a = math.radians(deg - 90)
    return CX + r * math.cos(a), CY + r * math.sin(a)

def arc(a0, a1, r0, r1):
    large = 1 if (a1 - a0) > 180 else 0
    x0, y0 = pt(a0, r1); x1, y1 = pt(a1, r1); x2, y2 = pt(a1, r0); x3, y3 = pt(a0, r0)
    return (f'M{x0:.2f} {y0:.2f}A{r1} {r1} 0 {large} 1 {x1:.2f} {y1:.2f}'
            f'L{x2:.2f} {y2:.2f}A{r0} {r0} 0 {large} 0 {x3:.2f} {y3:.2f}Z')

defs, paths, start = [], [], 0.0
for i, (share, light, dark) in enumerate(SEGS):
    a0, a1 = start + GAP / 2, start + share * 360 - GAP / 2
    mid = (a0 + a1) / 2
    gx0, gy0 = pt(mid - 20, R + W / 2); gx1, gy1 = pt(mid + 20, R - W / 2)
    defs.append(f'<linearGradient id="s{i}" gradientUnits="userSpaceOnUse" x1="{gx0:.1f}" y1="{gy0:.1f}" x2="{gx1:.1f}" y2="{gy1:.1f}">'
                f'<stop offset="0" stop-color="{light}"/><stop offset="1" stop-color="{dark}"/></linearGradient>')
    paths.append(f'<path d="{arc(a0, a1, R - W / 2, R + W / 2)}" fill="url(#s{i})"/>')
    start += share * 360

svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
<defs>
<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#e6ebf3"/></linearGradient>
<radialGradient id="glow" cx="0.3" cy="0.18" r="0.8"><stop offset="0" stop-color="#ffffff" stop-opacity=".9"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></radialGradient>
<linearGradient id="coin" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a3d46"/><stop offset="1" stop-color="#111216"/></linearGradient>
<linearGradient id="rim" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff" stop-opacity=".55"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></linearGradient>
<filter id="drop" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="10" stdDeviation="11" flood-color="#1b2a45" flood-opacity=".28"/></filter>
<filter id="soft" x="-30%" y="-30%" width="160%" height="170%"><feDropShadow dx="0" dy="5" stdDeviation="6" flood-color="#000" flood-opacity=".4"/></filter>
{''.join(defs)}
</defs>
<rect width="512" height="512" fill="url(#bg)"/>
<rect width="512" height="512" fill="url(#glow)"/>
<g filter="url(#drop)">{''.join(paths)}</g>
<circle cx="{CX}" cy="{CY}" r="{R - W / 2}" fill="#ffffff" opacity=".0"/>
<g filter="url(#soft)"><circle cx="{CX}" cy="{CY}" r="64" fill="url(#coin)"/></g>
<circle cx="{CX}" cy="{CY}" r="62" fill="none" stroke="url(#rim)" stroke-width="3"/>
<g transform="translate({CX} {CY}) scale(.255) translate(-256 -260)" fill="none" stroke="#fff" stroke-width="36" stroke-linecap="round" stroke-linejoin="round"><path d="M158 118l98 146 98-146"/><path d="M256 264v138"/><path d="M186 306h140"/><path d="M186 358h140"/></g>
</svg>
'''
open('src/icon.svg', 'w').write(svg)
print('wrote src/icon.svg', len(svg), 'bytes')
