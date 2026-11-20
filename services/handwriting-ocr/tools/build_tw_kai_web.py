"""把全字庫正楷體（TW-Kai.ttf）切成網頁用的小檔，給原稿上錯字旁的正確字用。

只留 Big5 常用字＋次常用字（13,053 字）和全形標點，依 Big5 的順序每 CHUNK 個字切一個 woff2，
再產生一份 CSS（@font-face＋unicode-range）：瀏覽器只下載畫面上用到的字所在的小檔。

用法（需要 fonttools 與 brotli：pip install fonttools brotli）：
    python services/handwriting-ocr/tools/build_tw_kai_web.py <TW-Kai.ttf 的路徑> apps/web/public/fonts/tw-kai
    （從 1Campus Write 的 dev/fonts/build_tw_kai.py 複製來；原稿紅筆上正確的字用的字型，見 docs/manuscript.md）

字型來源與授權見 docs/manuscript.md（依 SIL OFL 1.1 使用，授權全文 apps/web/public/licenses/tw-kai-font-OFL.txt）。
"""
import io
import os
import sys

from fontTools import subset
from fontTools.ttLib import TTFont

FAMILY = "TW-Kai"
PREFIX = "tw-kai"
CHUNK = 100


def big5_chars(first_lead, last_lead, last_code):
    chars = []
    for lead in range(first_lead, last_lead + 1):
        for trail in list(range(0x40, 0x7F)) + list(range(0xA1, 0xFF)):
            if (lead << 8 | trail) > last_code:
                break
            try:
                ch = bytes([lead, trail]).decode("big5")
            except UnicodeDecodeError:
                continue
            if len(ch) == 1:
                chars.append(ch)
    return chars


def wanted_chars():
    common = big5_chars(0xA4, 0xC6, 0xC67E)  # 常用字 5,401
    secondary = big5_chars(0xC9, 0xF9, 0xF9D5)  # 次常用字 7,652
    punct = [chr(cp) for cp in list(range(0x3000, 0x3040)) + list(range(0xFF01, 0xFF5F))]
    seen, ordered = set(), []
    for ch in punct + common + secondary:
        if ch not in seen:
            seen.add(ch)
            ordered.append(ch)
    return ordered


def options():
    opts = subset.Options()
    opts.flavor = "woff2"
    opts.layout_features = []  # 每個字單獨橫排畫，不需要直排替換等排版功能
    opts.hinting = False
    opts.name_IDs = ["*"]  # 保留版權與授權說明（name 0）
    opts.name_languages = ["*"]
    opts.drop_tables += ["FFTM", "vhea", "vmtx"]
    return opts


def subset_bytes(font_bytes, chars, flavor):
    font = TTFont(io.BytesIO(font_bytes))
    opts = options()
    opts.flavor = flavor
    subsetter = subset.Subsetter(opts)
    subsetter.populate(unicodes=[ord(c) for c in chars])
    subsetter.subset(font)
    out = io.BytesIO()
    font.flavor = flavor
    font.save(out)
    return out.getvalue()


def unicode_range(chars):
    cps = sorted(ord(c) for c in chars)
    ranges, start, prev = [], cps[0], cps[0]
    for cp in cps[1:]:
        if cp == prev + 1:
            prev = cp
            continue
        ranges.append((start, prev))
        start = prev = cp
    ranges.append((start, prev))
    return ", ".join(f"U+{a:X}" if a == b else f"U+{a:X}-{b:X}" for a, b in ranges)


def main():
    source, out_dir = sys.argv[1], sys.argv[2]
    os.makedirs(out_dir, exist_ok=True)
    for name in os.listdir(out_dir):
        if name.startswith(PREFIX) and (name.endswith(".woff2") or name.endswith(".css")):
            os.remove(os.path.join(out_dir, name))

    full = TTFont(source)
    cmap = full.getBestCmap()
    chars = [c for c in wanted_chars() if ord(c) in cmap]
    copyright_notice = full["name"].getDebugName(0)
    version = full["name"].getDebugName(5)
    full.close()

    # 先切出只含需要的字的 TTF，之後每一塊從這個小很多的檔切，比較快
    with open(source, "rb") as f:
        base = subset_bytes(f.read(), chars, None)

    blocks = []
    total = 0
    for index in range(0, len(chars), CHUNK):
        part = chars[index:index + CHUNK]
        number = index // CHUNK + 1
        file_name = f"{PREFIX}-{number:03d}.woff2"
        data = subset_bytes(base, part, "woff2")
        with open(os.path.join(out_dir, file_name), "wb") as f:
            f.write(data)
        total += len(data)
        blocks.append(
            "@font-face {\n"
            f"  font-family: '{FAMILY}';\n"
            "  font-style: normal;\n"
            "  font-weight: 400;\n"
            "  font-display: swap;\n"
            f"  src: url('./{file_name}') format('woff2');\n"
            f"  unicode-range: {unicode_range(part)};\n"
            "}\n"
        )

    header = (
        "/*\n"
        f" * 全字庫正楷體 {FAMILY} {version}（只留 Big5 常用＋次常用字與全形標點，{len(chars)} 字，切成 {len(blocks)} 塊）\n"
        f" * {copyright_notice}\n"
        " * 本站依 SIL Open Font License 1.1 使用，授權全文見 /licenses/tw-kai-font-OFL.txt。\n"
        " * 由 dev/fonts/build_tw_kai.py 產生，不要手改。\n"
        " */\n"
    )
    with open(os.path.join(out_dir, f"{PREFIX}.css"), "w", encoding="utf-8", newline="\n") as f:
        f.write(header + "\n".join(blocks))
    print(f"{len(chars)} chars, {len(blocks)} files, {total / 1_000_000:.2f} MB")


if __name__ == "__main__":
    main()
