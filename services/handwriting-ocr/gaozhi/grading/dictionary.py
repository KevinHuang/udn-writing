"""萌典（教育部《重編國語辭典修訂本》）：在這台電腦上查詞，找出「四字詞只差一個同音字」的錯別字。

例：「迫不急待」不是辭典裡的詞，但把「急」換成同音的「及」就是「迫不及待」→ 很可能是錯別字。
只看四字詞（多半是成語）：兩、三個字的組合太常剛好不是詞（例如「我在見他之前」的「在見」），容易誤判。

資料來源：教育部《重編國語辭典修訂本》（CC BY-ND 3.0 臺灣授權，著作權屬教育部），經由萌典（g0v/moedict-data）取得。
只在本機查詢、不修改、不散布辭典內容；資料不放進版本庫，放在 data/moedict/（約 15 MB，需要時下載一次）。
"""
import json
import lzma
import re
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT / "data" / "moedict"
DATA_FILE = DATA_DIR / "dict-revised.json.xz"
INDEX_FILE = DATA_DIR / "index-v1.json"
URL = "https://raw.githubusercontent.com/g0v/moedict-data/main/dict-revised.json.xz"
CREDIT = "教育部《重編國語辭典修訂本》"
TONES = set("ˊˇˋ˙")
CJK = re.compile(r"^[㐀-䶿一-鿿]+$")
_LABEL = re.compile(r"（[^）]*）")


def strip_tone(bopomofo):
    """「（讀音）ㄐㄧˊ」→「ㄐㄧ」：去掉標籤與聲調，只比較聲母韻母。"""
    return "".join(ch for ch in _LABEL.sub("", bopomofo) if ch not in TONES and not ch.isspace())


class Dictionary:
    def __init__(self, words, readings):
        self.words = set(words)
        self.readings = {ch: set(r) for ch, r in readings.items()}
        self.by_pattern = {}
        for w in self.words:
            if len(w) == 4:
                for j in range(4):
                    self.by_pattern.setdefault(w[:j] + "?" + w[j + 1:], []).append(w)

    @classmethod
    def from_entries(cls, entries):
        """萌典原始資料（每筆有 title、heteronyms[].bopomofo）→ 查詢用的資料。"""
        words, readings = [], {}
        for e in entries:
            t = e.get("title", "")
            if not t or not CJK.match(t):                      # 造字（{[…]}）等特殊標記的詞條略過
                continue
            words.append(t)
            if len(t) == 1:
                for h in e.get("heteronyms") or []:
                    b = strip_tone(h.get("bopomofo") or "")
                    if b:
                        readings.setdefault(t, set()).add(b)
        return cls(words, readings)

    def homophone(self, a, b):
        return bool(self.readings.get(a, set()) & self.readings.get(b, set()))

    def near_words(self, s):
        """s 是四個字：不是辭典裡的詞，但換掉一個同音字就是 → [(位置, 正確的字, 正確的詞)]。"""
        if len(s) != 4 or s in self.words or not CJK.match(s):
            return []
        out = []
        for j in range(4):
            for w in self.by_pattern.get(s[:j] + "?" + s[j + 1:], []):
                if w != s and self.homophone(s[j], w[j]):
                    out.append((j, w[j], w))
        return out


_LOADED = None


def available():
    return INDEX_FILE.is_file() or DATA_FILE.is_file()


def load():
    """讀取辭典（第一次從原始資料建立查詢索引並存起來，之後直接讀索引）。沒有資料時回傳 None。"""
    global _LOADED
    if _LOADED is not None:
        return _LOADED
    if INDEX_FILE.is_file():
        data = json.loads(INDEX_FILE.read_text(encoding="utf-8"))
        _LOADED = Dictionary(data["words"], data["readings"])
        return _LOADED
    if not DATA_FILE.is_file():
        return None
    d = Dictionary.from_entries(json.loads(lzma.decompress(DATA_FILE.read_bytes())))
    INDEX_FILE.write_text(json.dumps({"credit": CREDIT, "words": sorted(d.words),
                                      "readings": {k: sorted(v) for k, v in d.readings.items()}},
                                     ensure_ascii=False), encoding="utf-8")
    _LOADED = d
    return d


def download(log=print):
    """從萌典的 GitHub 下載辭典資料（約 15 MB），檢查能解開後才放到正式位置。"""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    tmp = DATA_FILE.with_name(DATA_FILE.name + ".part")
    log("下載萌典辭典資料（約 15 MB）…")
    with urllib.request.urlopen(URL, timeout=300) as r, open(tmp, "wb") as f:
        while True:
            chunk = r.read(1 << 20)
            if not chunk:
                break
            f.write(chunk)
    entries = json.loads(lzma.decompress(tmp.read_bytes()))
    if not isinstance(entries, list) or len(entries) < 100000:
        tmp.unlink()
        raise ValueError("下載的辭典資料不完整")
    tmp.replace(DATA_FILE)
    log(f"完成：{len(entries):,} 個詞條")
    return len(entries)
