"""文字正規化：直排標點、全形／半形、破折號與刪節號的各種寫法，統一成同一種，方便比對。

注意：不用 NFKC——它會把全形「，」變成半形「,」，而稿紙上的標點應該是全形。
"""
# 直排專用字形（U+FE10、U+FE30 區）→ 一般全形標點
VERTICAL = {
    "︐": "，", "︑": "、", "︒": "。", "︓": "：", "︔": "；", "︕": "！", "︖": "？", "︙": "…", "︰": "‥",
    "﹁": "「", "﹂": "」", "﹃": "『", "﹄": "』", "︵": "（", "︶": "）", "︷": "｛", "︸": "｝",
    "︹": "〔", "︺": "〕", "︻": "【", "︼": "】", "︽": "《", "︾": "》", "︿": "〈", "﹀": "〉",
}
# 半形標點 → 全形（作文稿紙上的標點都是全形）
HALFWIDTH = {",": "，", ";": "；", ":": "：", "?": "？", "!": "！", "(": "（", ")": "）"}
# 比對時視為相同的寫法
DASHES = set("—–－-─━︱｜|︲")
ELLIPSES = ("……", "…", "⋯", "︙", "...", "。。。")
PUNCT = set("，。、；：？！「」『』（）《》〈〉【】〔〕｛｝—…‥・‧·．")


def fold(text):
    """顯示用的正規化：直排字形與半形標點換成一般全形標點，去掉空白。"""
    if not text:
        return ""
    out = []
    for ch in text:
        if ch.isspace():
            continue
        out.append(VERTICAL.get(ch, HALFWIDTH.get(ch, ch)))
    return "".join(out)


def key(text):
    """比對用：在 fold 之外，再把各種破折號、刪節號寫法視為相同。"""
    s = fold(text)
    for e in ELLIPSES:
        s = s.replace(e, "…")
    return "".join("—" if ch in DASHES else ch for ch in s)


def is_punct(text):
    s = key(text)
    return bool(s) and all(ch in PUNCT for ch in s)
