"""辨識引擎。每個引擎實作 base.Engine 的 recognize(page) → EngineResult。"""
from .base import Engine, ResponseCache, assign_points  # noqa: F401
