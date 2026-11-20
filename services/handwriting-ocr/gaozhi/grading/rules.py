"""程式比對錯別字：不連網、不花錢、每次結果都一樣，只做幾乎不會誤判的幾項；其他錯別字交給 AI——

- 注音代替（老師的決定：一律標成錯別字）：連續的注音只標一次；正確的字由 AI 依上下文補上（或老師填）。
- 簡體字：台灣通行的正體字字集（Big5）裡沒有的字，多半是簡體字或不規範寫法；
  常見的簡體字附上建議的正體字（一對多的字取最常見的寫法，老師可以改）。
- 不規範寫法：Big5 裡有、但不是教育部標準字體的常見寫法（例如「着」應為「著」）。
- 常見錯詞：common_typos.txt 列出的錯誤寫法（只收幾乎不可能是對的，例如「迫不急待」）。
- 成語比對（dictionary.py，有下載萌典資料時）：四字詞（多半是成語）不是辭典裡的詞、但換掉一個同音字就是，
  例如「迫不急待」→「迫不及待」（模擬 1,000 個這類錯，99% 抓到並給對字，幾乎不誤判）。
辭典只用來比對成語：兩字詞等其他同音字的比對誤判太多，老師決定不用（2026-10-07）。要看上下文才能判斷的
別字（的／得／地、在／再、兩字詞同音錯…）都交給 AI。
"""
import re
from pathlib import Path

RULES_VERSION = 4               # 比對規則改了就加一：批改畫面打開時會自動用新規則重做（4：辭典只比對成語）
COMMON_FILE = Path(__file__).with_name("common_typos.txt")
BOPOMOFO = re.compile("[㄀-ㄯㆠ-ㆿˊˇˋ˙ˉ]")
NONSTANDARD = {"着": "著", "綫": "線", "爲": "為", "衆": "眾", "囘": "回", "牀": "床", "麪": "麵"}
# 常見簡體字 → 建議的正體字（成對排列：簡、正、簡、正…）
_PAIRS = (
    "这這们們学學来來时時说說为為个個会會对對发發过過还還没沒让讓给給听聽见見觉覺东東车車门門开開关關"
    "问問间間现現点點头頭长長书書写寫读讀话話语語认認识識记記气氣爱愛欢歡乐樂妈媽爷爺孙孫师師习習业業"
    "场場岁歲买買卖賣钱錢鸡雞鱼魚鸟鳥马馬龙龍万萬与與两兩机機电電视視脑腦网網应應该該经經实實难難边邊"
    "远遠运運动動劳勞从從众眾优優伤傷体體华華单單历歷压壓厅廳县縣号號叶葉园園图圖圣聖坏壞块塊声聲处處"
    "备備复復够夠夺奪奋奮妇婦宝寶宁寧层層岛島帅帥带帶帮幫广廣庆慶张張弹彈归歸当當录錄彻徹忆憶忧憂怀懷"
    "态態总總恋戀恶惡惊驚战戰扑撲执執扩擴扫掃扬揚护護报報担擔拥擁择擇挂掛挡擋挥揮换換据據携攜摄攝无無"
    "旧舊显顯晓曉暂暫术術杀殺杂雜权權条條极極构構标標样樣树樹桥橋梦夢检檢欧歐毕畢毁毀汉漢汤湯沟溝泪淚"
    "泽澤洁潔浅淺测測济濟浓濃涨漲湿濕满滿灭滅灯燈灵靈灾災烦煩热熱牵牽犹猶狮獅独獨猎獵献獻环環画畫疗療"
    "疯瘋痒癢皱皺盖蓋盘盤睁睜矿礦码碼确確礼禮离離种種积積称稱稳穩穷窮窃竊竞競笔筆简簡粮糧紧緊纪紀约約"
    "级級纯純纸紙线線练練组組细細终終结結绝絕统統继繼绩績续續绿綠编編缘緣罗羅罢罷职職联聯肃肅胜勝脏髒"
    "脚腳节節艺藝苏蘇药藥获獲虽雖补補装裝观觀规規览覽计計讨討训訓议議讲講许許论論设設访訪证證评評诉訴"
    "词詞译譯试試诗詩诚誠误誤请請谁誰课課谈談谢謝贝貝负負责責败敗货貨质質贵貴费費资資赛賽赶趕跃躍践踐"
    "轻輕载載较較辅輔辆輛辈輩辉輝输輸达達迁遷进進违違连連迟遲适適选選递遞遗遺邻鄰释釋钟鐘钢鋼钥鑰铁鐵"
    "银銀锅鍋错錯镜鏡闭閉闲閒闹鬧闻聞阅閱队隊阳陽阴陰阵陣阶階际際陆陸陈陳险險随隨隐隱雾霧静靜韩韓页頁"
    "顶頂项項顺順须須顾顧顿頓预預领領频頻题題颜顏风風飞飛饭飯饮飲饱飽饼餅馆館驾駕验驗骑騎鲜鮮鸣鳴麦麥"
    "黄黃齐齊齿齒丰豐亲親仅僅优優伞傘传傳伦倫侦偵俭儉债債兴興兰蘭养養兽獸冲衝况況冻凍净淨减減凤鳳凭憑"
    "击擊刘劉则則刚剛创創删刪别別剧劇劝勸办辦务務动動势勢勋勳区區医醫华華协協卫衛却卻厂廠厌厭县縣参參"
    "双雙发發变變叠疊叹嘆吓嚇吗嗎吨噸听聽启啟呜嗚响響哑啞喷噴团團围圍国國图圖场場坚堅坛壇坝壩垄壟壮壯"
    "奖獎妆妝娱娛婴嬰孝孝宽寬寻尋导導寿壽尔爾尘塵尝嘗尽盡岗崗币幣帐帳幸幸并並庄莊庙廟废廢开開异異弃棄"
    "张張彦彥征徵御禦怜憐恳懇恼惱悬懸惭慚愿願惧懼戏戲户戶扰擾抢搶拟擬拣揀择擇挤擠损損捡撿换換掷擲搀攙"
)
SIMPLIFIED = {_PAIRS[i]: _PAIRS[i + 1] for i in range(0, len(_PAIRS) - 1, 2) if _PAIRS[i] != _PAIRS[i + 1]}
# 這些簡體字剛好也是 Big5 裡的罕用字或異體字，字集檢查抓不到；學生作文裡幾乎都是簡體用法，標「很可能」
SIMPLIFIED_IN_BIG5 = set("听气机体万与网优坏圣宁怀惊扑极构洁确离种赶厂吨扰复并庄异怜愿适")


def in_big5(ch):
    try:
        ch.encode("cp950")
        return True
    except UnicodeEncodeError:
        return False


def load_common(path=None):
    """常見錯詞表：[(錯誤寫法, 正確寫法)]。字數不同的行略過。"""
    p = Path(path) if path else COMMON_FILE
    out = []
    if not p.is_file():
        return out
    for line in p.read_text(encoding="utf-8-sig").splitlines():
        line = line.split("#", 1)[0].strip()
        if "→" not in line:
            continue
        wrong, correct = (s.strip() for s in line.split("→", 1))
        if wrong and len(wrong) == len(correct) and wrong != correct:
            out.append((wrong, correct))
    return out


def _mark(key, wrong, correct, mtype, reason):
    return {"keys": [key], "wrong": wrong, "correct": correct, "type": mtype, "reason": reason,
            "confidence": "high", "source": "rule"}


def zhuyin_marks(paras):
    """注音代替：連續的注音符號（含聲調）算一處，一處只標一次。正確的字先空著，由 AI 依上下文補上（或老師填）。"""
    marks = []
    for p in paras:
        chars = [ch for ch, _ in p]
        i = 0
        while i < len(p):
            if not BOPOMOFO.search(chars[i]):
                i += 1
                continue
            j = i
            while j < len(p) and BOPOMOFO.search(chars[j]):
                j += 1
            zhuyin = "".join(chars[i:j])
            marks.append({"keys": list(dict.fromkeys(k for _, k in p[i:j])), "wrong": zhuyin, "correct": "",
                          "type": "注音代替", "reason": f"用注音「{zhuyin}」代替不會寫的字", "confidence": "high",
                          "source": "rule", "zhuyin": zhuyin})
            i = j
    return marks


def dict_marks(paras, d):
    """成語比對：四個字只差一個同音字就是辭典裡的四字詞（多半是成語）。d：dictionary.Dictionary。"""
    from .dictionary import CREDIT
    marks = []
    for p in paras:
        chars = [ch for ch, _ in p]
        for i in range(len(chars) - 3):
            s = "".join(chars[i:i + 4])
            cands = d.near_words(s)
            fixes = {(j, c) for j, c, _ in cands}
            if len(fixes) != 1:                                # 沒有、或有好幾種改法：不猜
                continue
            j, c = next(iter(fixes))
            word = sorted(w for jj, cc, w in cands if (jj, cc) == (j, c))[0]
            m = _mark(p[i + j][1], chars[i + j], c, "別字",
                      f"應為「{word}」：「{chars[i + j]}」和「{c}」同音（{CREDIT}）")
            m["source"] = "dict"
            marks.append(m)
    return marks


def rule_marks(paras, common=None, dictionary=None):
    """paras：[[(字, 格子), …], …]。回傳程式找到的錯別字標記。dictionary：有萌典資料時一起比對成語。"""
    marks = zhuyin_marks(paras)
    for p in paras:
        for ch, k in p:
            if BOPOMOFO.search(ch):
                continue                                         # 注音代替：上面已經處理
            elif ch in NONSTANDARD:
                marks.append(_mark(k, ch, NONSTANDARD[ch], "不規範寫法", f"教育部標準字體是「{NONSTANDARD[ch]}」"))
            elif not ch.isascii() and ch != "□" and not in_big5(ch):
                marks.append(_mark(k, ch, SIMPLIFIED.get(ch, ""), "簡體字",
                                   "台灣通行的正體字裡沒有這個字，可能是簡體字或不規範寫法"))
            elif ch in SIMPLIFIED_IN_BIG5:
                m = _mark(k, ch, SIMPLIFIED.get(ch, ""), "簡體字", f"台灣通常寫作「{SIMPLIFIED.get(ch, '')}」")
                m["confidence"] = "medium"
                marks.append(m)
    for p in paras:                                          # 常見錯詞（不跨段比對）
        text = "".join(ch for ch, _ in p)
        for wrong, correct in (load_common() if common is None else common):
            if dictionary is not None and wrong in dictionary.words:     # 教育部辭典有收的寫法不算錯
                continue
            for m in re.finditer(re.escape(wrong), text):
                for j, (a, b) in enumerate(zip(wrong, correct)):
                    if a != b:
                        marks.append(_mark(p[m.start() + j][1], a, b, "別字", f"「{correct}」常被寫成「{wrong}」"))
    if dictionary is not None:
        keys = {k for m in marks for k in m["keys"]}
        marks += [m for m in dict_marks(paras, dictionary) if not set(m["keys"]) & keys]   # 錯詞表已經標的不重複
    return marks
