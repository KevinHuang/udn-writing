"""辨識模組之間交接的資料格式。

- 引擎（engines/）輸出 EngineResult：每一格讀到什麼字、信心值、旗標。
- 合併（fuse.py）把多個引擎的結果合成一頁的辨識結果（_ocr.json），每格一個狀態：
  blank 空白／agree 可信（綠）／single 建議看一下（黃）／review 需確認（紅）。
"""
from dataclasses import dataclass, field

OCR_FORMAT = 1

# 引擎可附在每一格的旗標
FLAG_NAMES = {
    "uncertain": "辨識結果不確定",
    "illegible": "無法辨識",
    "crossed": "可能是劃掉的字",
    "multi": "一格裡讀到多個字",
    "spill": "字跨到別的格子",
    "count_mismatch": "這一行的字數對不上",
}
STATUS_NAMES = {"blank": "空白", "agree": "可信", "single": "建議看一下", "review": "需確認"}
STATUS_ORDER = {"blank": 0, "agree": 1, "single": 2, "review": 3}


@dataclass
class CellReading:
    text: str                                   # 讀到的字（已正規化前的原樣）；劃掉的字為 ""
    conf: float | None = None                   # 信心值 0~1（Gemini 3 沒有，為 None）
    flags: list = field(default_factory=list)   # FLAG_NAMES 的鍵

    def to_json(self):
        d = {"text": self.text}
        if self.conf is not None:
            d["conf"] = round(self.conf, 3)
        if self.flags:
            d["flags"] = list(self.flags)
        return d


@dataclass
class EngineResult:
    engine: str
    settings: dict
    readings: dict                                  # (col, row) → CellReading
    insertions: list = field(default_factory=list)  # 行間補寫：{"right_col","left_col","row","text"}
    usage: dict = field(default_factory=dict)       # Vision：units；Gemini：tokens
    seconds: float = 0.0
    error: str | None = None                        # 引擎失敗時的訊息（其他引擎照常合併）
    warnings: list = field(default_factory=list)    # 部分失敗（例如某幾行沒有回應）
