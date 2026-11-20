"""讓測試找得到服務的程式（服務資料夾本身就是根目錄）。"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
