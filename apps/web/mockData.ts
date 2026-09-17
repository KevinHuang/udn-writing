
import { Course, Question, Folder, QuestionType, Assignment, Submission, AssignmentStatus, SchoolCourse, SchoolLevel } from './types';
import { hashString } from './lib/hash';

// --- HELPER FOR MOCK DATES ---
export const getRelativeDate = (days: number) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  const pad = (n: number) => (n < 10 ? "0" + n : n);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T23:59`;
};

export const getRelativeDateTime = (days: number, hours: number) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(date.getHours() + hours);
  return date.toISOString();
};

export const AVAILABLE_AI_MODELS = [
  // 主力：國中教育會考寫作測驗（六級分）
  "教育會考國寫輔助AI_Ver2",
  "教育會考國寫輔助AI",
  // 其他國文寫作情境
  "國_學測國寫輔助AI(V3)",
  "學測國寫知性題輔助AI_Ver2",
  "學測國寫情意題輔助AI_Ver2",
  "統測國文寫作輔助AI_Ver2",
  // 英文作文（本校目前較少使用，保留供跨科老師選用）
  "英_學測英文作文批改助手(gemini)",
  "中階英文作文輔助AI",
];

/**
 * 一個學年度裡的學期順序：第一學期 → 寒假 → 第二學期 → 暑假。
 * 寒暑假用 W／S 當代碼，避免和學期的 1／2 混淆。
 */
const TERMS = [
  { code: "1", label: "第1學期" },
  { code: "W", label: "寒假" },
  { code: "2", label: "第2學期" },
  { code: "S", label: "暑假" },
] as const;

/** 開放選擇的學年度。要往後延伸就加數字，選項會自動長出來 */
const ACADEMIC_YEARS = [115] as const;

export const SEMESTER_OPTIONS = ACADEMIC_YEARS.flatMap((year) =>
  TERMS.map((term) => ({
    value: `${year}-${term.code}`,
    label: `${year}學年度 ${term.label}`,
  })),
);

/**
 * 把 "115-2" 這種代碼換成「115學年度 第2學期」。
 *
 * 課程卡片、班級頁、成績表都直接印 course.semester，代碼裡有 W／S 之後
 * 直接印會變成「115-W」，所以統一走這支。查不到就原樣回傳。
 */
export const semesterLabel = (value: string): string =>
  SEMESTER_OPTIONS.find((opt) => opt.value === value)?.label ?? value;

/** 目前學期。改這裡就會換掉整個原型的預設落點 */
export const CURRENT_SEMESTER = "115-1";


// ══════════════════════════════════════════════════════════════
//  校務系統目錄
//
//  聯合報的寫作課橫跨全台國中小，課程來源是各校校務系統。
//  這裡是「同步校務系統」看得到的那份目錄：縣市 → 學校 → 班級。
//
//  縣市與校名只活在這一層。班級被匯入成 Course 之後，
//  只留下合併好的名稱字串（例：「新北市淡江中學 國三孝班」）。
// ══════════════════════════════════════════════════════════════

interface DirectoryClass {
  /** 班級代碼。跨校必須唯一 —— 同步視窗是用 code 去重的 */
  code: string;
  className: string;
}

interface DirectorySchool {
  id: string;
  name: string;
  level: SchoolLevel;
  classes: DirectoryClass[];
}

export interface DirectoryCity {
  city: string;
  schools: DirectorySchool[];
}

/** 國中班級用忠孝仁愛信義和平，國小用班號 —— 與實際校務系統的習慣一致 */
export const SCHOOL_DIRECTORY: DirectoryCity[] = [
  {
    city: '臺北市',
    schools: [
      {
        id: 'ta', name: '大安國中', level: '國中',
        classes: [
          // 903 與 SC-01 是已經匯入系統的班級，代碼沿用既有課程
          { code: '903', className: '國三愛班' },
          { code: 'SC-01', className: '寫作社：文思工坊' },
          { code: 'TA-101', className: '國一忠班' },
          { code: 'TA-202', className: '國二孝班' },
        ],
      },
      {
        id: 'wc', name: '五常國小', level: '國小',
        classes: [
          { code: 'WC-501', className: '501班' },
          { code: 'WC-502', className: '502班' },
          { code: 'WC-601', className: '601班' },
          { code: 'WC-602', className: '602班' },
        ],
      },
    ],
  },
  {
    city: '新北市',
    schools: [
      {
        id: 'tj', name: '淡江中學', level: '國中',
        classes: [
          { code: '701', className: '國一忠班' },
          { code: '802', className: '國二仁班' },
          { code: '901', className: '國三孝班' },
          { code: 'TJ-902', className: '國三信班' },
        ],
      },
      {
        id: 'bq', name: '板橋國小', level: '國小',
        classes: [
          { code: 'BQ-501', className: '501班' },
          { code: 'BQ-502', className: '502班' },
          { code: 'BQ-601', className: '601班' },
          { code: 'BQ-602', className: '602班' },
        ],
      },
    ],
  },
  {
    city: '桃園市',
    schools: [
      {
        id: 'qp', name: '青埔國中', level: '國中',
        classes: [
          { code: 'QP-101', className: '國一義班' },
          { code: 'QP-202', className: '國二和班' },
          { code: 'QP-301', className: '國三平班' },
          { code: 'QP-302', className: '國三忠班' },
        ],
      },
      {
        id: 'dm', name: '東門國小', level: '國小',
        classes: [
          { code: 'FX-01', className: '彈性學習：閱讀與寫作' },
          { code: 'DM-501', className: '501班' },
          { code: 'DM-502', className: '502班' },
          { code: 'DM-601', className: '601班' },
        ],
      },
    ],
  },
  {
    city: '臺中市',
    schools: [
      {
        id: 'xs', name: '向上國中', level: '國中',
        classes: [
          { code: 'XS-101', className: '國一孝班' },
          { code: 'XS-202', className: '國二愛班' },
          { code: 'XS-301', className: '國三信班' },
          { code: 'XS-302', className: '國三義班' },
        ],
      },
      {
        id: 'dt', name: '大同國小', level: '國小',
        classes: [
          { code: 'DT-501', className: '501班' },
          { code: 'DT-502', className: '502班' },
          { code: 'DT-601', className: '601班' },
          { code: 'DT-602', className: '602班' },
        ],
      },
    ],
  },
  {
    city: '高雄市',
    schools: [
      {
        id: 'wf', name: '五福國中', level: '國中',
        classes: [
          { code: 'WF-101', className: '國一仁班' },
          { code: 'WF-202', className: '國二信班' },
          { code: 'WF-301', className: '國三和班' },
          { code: 'WF-302', className: '國三平班' },
        ],
      },
      {
        id: 'sw', name: '四維國小', level: '國小',
        classes: [
          { code: 'SW-501', className: '501班' },
          { code: 'SW-502', className: '502班' },
          { code: 'SW-601', className: '601班' },
          { code: 'SW-602', className: '602班' },
        ],
      },
    ],
  },
];

// ── 學生姓名產生器 ────────────────────────────────────────────

const SURNAMES = [
  '陳', '林', '黃', '張', '李', '王', '吳', '劉', '蔡', '楊',
  '許', '鄭', '謝', '郭', '洪', '曾', '邱', '廖', '徐', '賴',
  '周', '葉', '蘇', '莊', '呂', '江', '何', '羅', '高', '蕭',
  '潘', '簡', '朱', '鍾', '游', '詹', '胡', '施', '沈', '余',
];

const GIVEN_NAMES = [
  '冠宇', '建宏', '怡君', '志明', '雅婷', '淑芬', '家豪', '俊傑', '欣怡', '宗翰',
  '惠如', '志偉', '秀英', '明哲', '麗華', '偉哲', '美玲', '國華', '淑華', '文雄',
  '志強', '美慧', '俊宏', '雅雯', '志豪', '明輝', '美惠', '雅琪', '建宇', '婷婷',
  '承翰', '詩涵', '家偉', '思妤', '孟哲', '心怡', '哲瑋', '雅君', '柏宇', '郁雯',
  '子傑', '佩君', '冠廷', '宜君', '宗憲', '彥廷', '筱涵', '凱文', '婉君', '宗緯',
  '靜怡', '文凱', '佩芬', '家銘', '詩雅', '韋廷', '郁涵', '哲宇', '佳琪', '俊霖',
  '思涵', '品妤', '柏翰', '家瑋', '佩珊', '佳穎', '宜蓁', '子萱', '承恩', '宇軒',
];

/** 決定性地產生一個姓名。salt 用來在班內撞名時換一個 */
const nameFor = (seed: string, salt: number): string => {
  const h = hashString(`${seed}#${salt}`);
  return (
    SURNAMES[h % SURNAMES.length] +
    GIVEN_NAMES[Math.floor(h / SURNAMES.length) % GIVEN_NAMES.length]
  );
};

/** 一個班的人數：25–32，由學校與班級代碼決定 */
const classSizeFor = (schoolId: string, code: string): number =>
  25 + (hashString(`${schoolId}/${code}/size`) % 8);

/** 一個班的完整名冊。同班不重名 */
function rosterFor(schoolId: string, code: string, size: number): string[] {
  const used = new Set<string>();
  const names: string[] = [];
  for (let seat = 1; seat <= size; seat++) {
    let salt = 0;
    let name = nameFor(`${schoolId}/${code}/${seat}`, salt);
    while (used.has(name) && salt < 40) {
      salt += 1;
      name = nameFor(`${schoolId}/${code}/${seat}`, salt);
    }
    used.add(name);
    names.push(name);
  }
  return names;
}

/** 校務系統回傳的班級清單。同步視窗的資料來源 */
/** 示範用的授課教師。第一位是登入的示範帳號 */
export const TEACHER_POOL = [
  'Charles 老師',
  '王雅琪 老師',
  '林俊宏 老師',
  '陳美玲 老師',
  '張建宏 老師',
  '李淑芬 老師',
];

/** 決定性地指派授課教師，讓兩種身分的差異每次重整都一樣 */
const teacherFor = (schoolId: string, code: string): string =>
  TEACHER_POOL[hashString(`${schoolId}/${code}/teacher`) % TEACHER_POOL.length];

/**
 * 校務系統回傳的班級清單。
 *
 * name 刻意組成**一整串、不留空白** —— 真實校務系統就是這樣給的。
 * 縣市與學校要由 lib/schoolName.ts 的 parseCourseName 解析出來，
 * 這樣示範的流程才是真的，而不是我們自己先拆好再假裝解析。
 */
export const MOCK_SCHOOL_COURSES: SchoolCourse[] = SCHOOL_DIRECTORY.flatMap(
  ({ city, schools }) =>
    schools.flatMap((school) =>
      school.classes.map((cls) => {
        const studentCount = classSizeFor(school.id, cls.code);
        return {
          id: `sc-${school.id}-${cls.code}`,
          code: cls.code,
          name: `${city}${school.name}${cls.className}`,
          semester: CURRENT_SEMESTER,
          studentCount,
          roster: rosterFor(school.id, cls.code, studentCount),
          teacherName: teacherFor(school.id, cls.code),
        };
      }),
    ),
).concat(
  /*
   * 刻意難解析的字串，用來示範「待確認」流程。
   * 真實校務系統的資料就是會長這樣：全銜、分校、缺縣市、公私立前綴。
   */
  [
    { id: 'sc-odd-1', code: 'FG-301', name: '臺北市立第一女子高級中學國三忠班', teacher: 'Charles 老師' },
    { id: 'sc-odd-2', code: 'TJ-BL-202', name: '新北市淡江中學八里分校國二仁班', teacher: '王雅琪 老師' },
    { id: 'sc-odd-3', code: 'DA-303', name: '大安國中國三愛班', teacher: 'Charles 老師' },
    { id: 'sc-odd-4', code: 'HL-101', name: '花蓮縣私立海星高級中學國一忠班', teacher: '林俊宏 老師' },
  ].map(({ id, code, name, teacher }) => {
    const studentCount = classSizeFor(id, code);
    return {
      id,
      code,
      name,
      semester: CURRENT_SEMESTER,
      studentCount,
      roster: rosterFor(id, code, studentCount),
      teacherName: teacher,
    };
  }),
);

/** 所有縣市，供同步視窗的篩選晶片使用 */
export const SCHOOL_CITIES = SCHOOL_DIRECTORY.map((d) => d.city);

export const MOCK_COURSES: Course[] = [
  {
    id: "c1",
    code: "701",
    name: "新北市淡江中學國一忠班",
    semester: "115-1",
    // 名冊有 33 人，這裡曾經寫 32 —— 畫面上「全班人數 32」但表格列出 33 位。
    // 人數以 RAW_ROSTERS 為準，scripts/check-mockdata.mjs 會擋住再次漂掉
    studentCount: 33,
    aiModels: ["教育會考國寫輔助AI_Ver2", "教育會考國寫輔助AI"],
    city: "新北市",
    schoolName: "淡江中學",
    schoolLevel: "國中",
    className: "國一忠班",
    parseConfidence: "high",
    teacherName: "Charles 老師",
  },
  {
    id: "c2",
    code: "802",
    name: "新北市淡江中學國二仁班",
    semester: "115-1",
    studentCount: 28,
    aiModels: ["教育會考國寫輔助AI_Ver2"],
    city: "新北市",
    schoolName: "淡江中學",
    schoolLevel: "國中",
    className: "國二仁班",
    parseConfidence: "high",
    teacherName: "Charles 老師",
  },
  {
    id: "c3",
    code: "901",
    name: "新北市淡江中學國三孝班",
    semester: "115-1",
    studentCount: 15,
    aiModels: ["教育會考國寫輔助AI_Ver2", "教育會考國寫輔助AI"],
    city: "新北市",
    schoolName: "淡江中學",
    schoolLevel: "國中",
    className: "國三孝班",
    parseConfidence: "high",
    teacherName: "Charles 老師",
  },
  {
    id: "c4",
    code: "SC-01",
    name: "臺北市大安國中寫作社：文思工坊",
    semester: "115-1",
    studentCount: 22,
    aiModels: ["教育會考國寫輔助AI_Ver2", "教育會考國寫輔助AI"],
    city: "臺北市",
    schoolName: "大安國中",
    schoolLevel: "國中",
    className: "寫作社：文思工坊",
    parseConfidence: "high",
    teacherName: "王雅琪 老師",
  },
  {
    id: "c5",
    code: "903",
    name: "臺北市大安國中國三愛班",
    semester: "115-1",
    studentCount: 40,
    aiModels: ["教育會考國寫輔助AI_Ver2", "教育會考國寫輔助AI"],
    city: "臺北市",
    schoolName: "大安國中",
    schoolLevel: "國中",
    className: "國三愛班",
    parseConfidence: "high",
    teacherName: "王雅琪 老師",
  },
  {
    id: "c6",
    code: "FX-01",
    name: "桃園市東門國小彈性學習：閱讀與寫作",
    semester: "115-1",
    studentCount: 18,
    aiModels: ["教育會考國寫輔助AI_Ver2", "教育會考國寫輔助AI"],
    city: "桃園市",
    schoolName: "東門國小",
    schoolLevel: "國小",
    className: "彈性學習：閱讀與寫作",
    parseConfidence: "high",
    teacherName: "林俊宏 老師",
  },
  {
    id: "c-old-1",
    code: "705",
    name: "新北市淡江中學國一信班",
    semester: "115-1",
    isArchived: true,
    studentCount: 30,
    aiModels: ["教育會考國寫輔助AI_Ver2", "教育會考國寫輔助AI"],
    city: "新北市",
    schoolName: "淡江中學",
    schoolLevel: "國中",
    className: "國一信班",
    parseConfidence: "high",
    teacherName: "Charles 老師",
  },
  {
    id: "c-old-2",
    code: "702",
    name: "新北市淡江中學國一忠班（上學年）",
    semester: "115-1",
    isArchived: true,
    studentCount: 32,
    aiModels: ["教育會考國寫輔助AI_Ver2", "教育會考國寫輔助AI"],
    city: "新北市",
    schoolName: "淡江中學",
    schoolLevel: "國中",
    className: "國一忠班（上學年）",
    parseConfidence: "high",
    teacherName: "王雅琪 老師",
  },
  {
    id: "c-old-3",
    code: "SC-00",
    name: "臺北市大安國中寫作基礎班",
    semester: "115-1",
    isArchived: true,
    studentCount: 20,
    aiModels: ["教育會考國寫輔助AI_Ver2", "教育會考國寫輔助AI"],
    city: "臺北市",
    schoolName: "大安國中",
    schoolLevel: "國中",
    className: "寫作基礎班",
    parseConfidence: "high",
    teacherName: "林俊宏 老師",
  },
];

export const RAW_ROSTERS: Record<string, string[]> = {
  c1: [
    "林冠宇", "陳建宏", "林怡君", "黃志明", "張雅婷", "李淑芬", "王家豪", "吳俊傑", "劉欣怡", "蔡宗翰", "楊惠如", "許志偉", "鄭秀英", "謝明哲", "郭麗華", "洪偉哲", "曾美玲", "邱國華", "廖淑華", "徐文雄", "賴志強", "周美慧", "葉俊宏", "蘇雅雯", "莊志豪", "呂明輝", "江美惠", "何志明", "羅雅婷", "高俊傑", "蕭麗華", "潘志偉", "林宏",
  ],
  c2: [
    "王小明", "陳怡婷", "張偉倫", "林雅雯", "李志豪", "黃郁婷", "吳承恩", "蔡佩珊", "楊子軒", "許嘉玲", "鄭冠宇", "謝佳穎", "郭昱翔", "洪宜蓁", "曾宗翰", "邱孟儒", "廖子萱", "徐承恩", "賴宇軒", "周品妤", "葉子豪", "蘇曉雯", "莊柏翰", "呂家瑋", "江佩珊", "何佳穎", "羅宜蓁", "劉平",
  ],
  c3: [
    "林志豪", "陳雅琪", "黃建宇", "張婷婷", "李承翰", "王詩涵", "吳家偉", "劉思妤", "蔡孟哲", "楊心怡", "許哲瑋", "鄭雅君", "謝柏宇", "郭郁雯", "洪子傑",
  ],
  c4: [
    "陳俊賢", "林佩君", "黃冠廷", "張宜君", "李宗憲", "王彥廷", "吳筱涵", "劉凱文", "蔡婉君", "楊宗緯", "許靜怡", "鄭文凱", "謝佩芬", "郭家銘", "洪詩雅", "曾韋廷", "邱郁涵", "廖哲宇", "徐佳琪", "賴俊霖", "周思涵", "葉天",
  ],
  c5: [
    "陳志強", "林惠婷", "黃國華", "張美玉", "李文傑", "王淑娟", "吳志明", "劉真實", "蔡榮傑", "楊秀琴", "許志豪", "鄭美玲", "謝建宏", "郭雅婷", "洪俊傑", "曾淑芬", "邱志明", "廖雅婷", "徐俊傑", "賴淑芬", "周志明", "葉雅婷", "蘇俊傑", "莊淑芬", "呂志明", "江雅婷", "何俊傑", "羅淑芬", "高志明", "蕭雅婷", "潘俊傑", "林淑芬", "陳志明", "林雅婷", "黃俊傑", "張淑芬", "李志明", "王雅婷", "吳俊傑", "劉淑芬",
  ],
  c6: [
    "陳美玲", "林志明", "黃雅婷", "張俊傑", "李淑芬", "王志明", "吳雅婷", "劉俊傑", "蔡淑芬", "楊志明", "許雅婷", "鄭俊傑", "謝淑芬", "郭志明", "洪雅婷", "曾俊傑", "邱淑芬", "廖志明",
  ],
};

/**
 * 往年（已封存）課程的名冊。
 *
 * 這三個班原本 studentCount 宣告 30／32／20，卻**完全沒有名冊** ——
 * 從班級挑選視窗點進去會看到「全班人數 30」配一張空表，
 * 而它們的 15 份作業也永遠不可能有人繳交。
 *
 * 用決定性的名字產生器補齊，人數與 MOCK_COURSES 宣告的一致
 * （scripts/check-mockdata.mjs 會擋住再次對不上）。
 */
([
  ['c-old-1', 30],
  ['c-old-2', 32],
  ['c-old-3', 20],
] as const).forEach(([id, size]) => {
  const names: string[] = [];
  for (let i = 0; names.length < size; i++) {
    // salt 用來避開班內撞名，與 nameFor 的設計一致
    const n = nameFor(`${id}/roster`, i);
    if (!names.includes(n)) names.push(n);
  }
  RAW_ROSTERS[id] = names;
});

export const MOCK_FOLDERS: Folder[] = [
  // 共同題庫（根目錄）
  { id: 'f1', name: '記敘抒情', parentId: null, type: QuestionType.SHARED },
  { id: 'f2', name: '議論說明', parentId: null, type: QuestionType.SHARED },
  { id: 'f3', name: '會考題型練習', parentId: null, type: QuestionType.SHARED },
  { id: 'f4', name: '節慶與民俗', parentId: null, type: QuestionType.SHARED },
  { id: 'f5', name: '圖表判讀寫作', parentId: null, type: QuestionType.SHARED },
  { id: 'f6', name: '修辭技巧練習', parentId: null, type: QuestionType.SHARED },

  // 記敘抒情底下
  { id: 'f1-1', name: '成長與自我', parentId: 'f1', type: QuestionType.SHARED },
  { id: 'f1-2', name: '家人與生活', parentId: 'f1', type: QuestionType.SHARED },

  // 議論說明底下
  { id: 'f2-1', name: '科技與生活', parentId: 'f2', type: QuestionType.SHARED },
  { id: 'f2-2', name: '校園與人際', parentId: 'f2', type: QuestionType.SHARED },
  { id: 'f2-3', name: '環境與社會', parentId: 'f2', type: QuestionType.SHARED },

  // 個人題庫（根目錄）
  { id: 'pf1', name: '七年級備課', parentId: null, type: QuestionType.PERSONAL },
  { id: 'pf2', name: '寫作社講義', parentId: null, type: QuestionType.PERSONAL },
  { id: 'pf3', name: '寒假作業', parentId: null, type: QuestionType.PERSONAL },
  { id: 'pf4', name: '補救教學', parentId: null, type: QuestionType.PERSONAL },

  // 個人題庫（第二層）
  { id: 'pf1-1', name: '第一次段考', parentId: 'pf1', type: QuestionType.PERSONAL },
  { id: 'pf1-2', name: '第二次段考', parentId: 'pf1', type: QuestionType.PERSONAL },
];

export const MOCK_QUESTIONS: Question[] = [
  // ── 會考題型練習 (f3) ──
  {
    id: '1',
    title: '看圖寫作：那個角落',
    content: '請仔細觀察右方圖片，並依下列提示寫一篇文章。\n\n每個人的生活裡，都有一個特別的角落。它可能是教室後排的窗邊、巷口的老樹下，或是家中某張總是坐同一個位置的椅子。那個角落不一定漂亮，卻因為發生過某些事，而在你心裡留下位置。\n\n請以「那個角落」為題，寫下你和某個角落的故事，並說明它對你的意義。文長不限，不可用詩歌體。',
    type: QuestionType.SHARED,
    folderId: 'f3',
    folderName: '會考題型練習',
    gradeLevel: '看圖寫作',
    isArchived: false,
    imageUrl: 'https://images.unsplash.com/photo-1481627834876-b7833e8f5570?q=80&w=1000&auto=format&fit=crop',
    aiImageDescription: '木造的舊書桌靠著窗，桌面堆著幾本翻開的書與一個馬克杯，窗外的光斜斜打在桌角，木頭被磨得發亮。',
    imagePosition: 'before',
    targetGrades: ['junior'],
    sources: ['exam_archive'],
    teacherNotes: '先看圖，再想自己的角落。圖片只是引子，不必照著寫。\n寫出那個角落的細節：光線、聲音、你在那裡做什麼。\n「意義」不要直接說出來，讓事情自己說。',
  },
  { id: '1b', title: '一句話的力量', content: '有時候，別人隨口說的一句話，會在我們心裡待上很久。它可能是一句鼓勵，也可能是一句傷人的評語。\n\n請以「一句話的力量」為題，寫出那句話是誰說的、在什麼情境下說的，以及它如何影響了你。不可用詩歌體。', type: QuestionType.SHARED, folderId: null, folderName: '未分類', gradeLevel: '記敘抒情', isArchived: false , targetGrades: ['junior'], sources: ['exam_archive'], teacherNotes: '這句話為什麼留得住？先把當時的場景寫出來——誰在場、你正在做什麼。\n不要只說「我很感動」，寫出你身體的反應。\n結尾回到現在：那句話今天對你還有作用嗎？' },

  // ── 記敘抒情 > 成長與自我 (f1-1) ──
  { id: '2', title: '那一次，我沒有放棄', content: '請回想一件你原本想放棄、最後卻堅持下來的事。寫出當時遇到的困難、你如何撐過去，以及事後的體會。不可用詩歌體。', type: QuestionType.SHARED, folderId: 'f1-1', folderName: '成長與自我', gradeLevel: '記敘抒情', isArchived: false , targetGrades: ['junior'], sources: ['exam_archive'], teacherNotes: '「差一點放棄」的那個時刻是全篇的重心，慢慢寫。\n把困難寫具體：是體力、時間，還是別人的一句話？\n最後一段不要喊口號，說出你現在看這件事的角度。' },
  { id: 'q-new-1', title: '我從錯誤中學到的事', content: '每個人都會犯錯。有些錯誤讓人懊悔，卻也讓人成長。\n\n請寫出一次你犯錯的經驗：發生了什麼事、你當時的反應，以及後來的改變。不可用詩歌體。', type: QuestionType.SHARED, folderId: 'f1-1', folderName: '成長與自我', gradeLevel: '記敘抒情', isArchived: false , targetGrades: ['junior'], sources: ['udn'] },
  { id: 'q-new-1b', title: '在群體中的我', content: '在班級、社團或家庭裡，你可能是帶頭的人，也可能習慣待在後面。\n\n請描述你在某個群體中的位置與感受，並談談這樣的自己讓你滿意或困擾的地方。不可用詩歌體。', type: QuestionType.SHARED, folderId: 'f1-1', folderName: '成長與自我', gradeLevel: '記敘抒情', isArchived: false , targetGrades: ['junior'], sources: ['udn'] },

  // ── 記敘抒情 > 家人與生活 (f1-2) ──
  { id: 'q-new-2', title: '我家的餐桌', content: '餐桌是許多家庭一天中少數聚在一起的時刻。桌上的菜色、說的話、或是沉默，都藏著這個家的樣子。\n\n請以「我家的餐桌」為題，寫出你家餐桌上的情景與其中的情感。不可用詩歌體。', type: QuestionType.SHARED, folderId: 'f1-2', folderName: '家人與生活', gradeLevel: '記敘抒情', isArchived: false , targetGrades: ['junior'], sources: ['udn_cup'], teacherNotes: '從一道菜或一個座位寫起，不要從「我家有一張餐桌」開始。\n沉默也是內容。想想沒有人說話的那幾分鐘。' },
  { id: 'q-new-2b', title: '窗外', content: '請以「窗外」為題寫一篇文章。你可以寫某一扇窗外的景象，也可以寫透過那扇窗，你看見或想起了什麼。不可用詩歌體。', type: QuestionType.SHARED, folderId: 'f1-2', folderName: '家人與生活', gradeLevel: '記敘抒情', isArchived: false , targetGrades: ['elementary', 'junior'], sources: ['udn_cup'] },

  // ── 議論說明 > 科技與生活 (f2-1) ──
  { id: '3', title: '手機該不該帶進校園', content: '有人認為手機是學習與聯絡的必要工具，也有人認為它讓學生分心、影響同學相處。\n\n請說明你的立場，並提出至少兩個理由或例子支持你的看法。不可用詩歌體。', type: QuestionType.SHARED, folderId: 'f2-1', folderName: '科技與生活', gradeLevel: '議論說明', isArchived: false , targetGrades: ['junior'], sources: ['exam_archive'], teacherNotes: '立場要在第一段就清楚。\n兩個理由不要重複同一件事，找一個對方也會同意的例子。\n可以承認反方有道理，再說明為什麼你還是這樣主張。' },
  { id: 'q-new-3', title: '當 AI 可以幫我寫作業', content: 'AI 工具愈來愈普及，只要輸入題目，就能得到一篇看起來完整的文章。\n\n請談談你對「學生用 AI 完成作業」的看法。你認為界線應該畫在哪裡？為什麼？不可用詩歌體。', type: QuestionType.SHARED, folderId: 'f2-1', folderName: '科技與生活', gradeLevel: '議論說明', isArchived: false , targetGrades: ['junior', 'senior'], sources: ['original'] },

  // ── 議論說明 > 環境與社會 (f2-3) ──
  { id: 'q-new-4', title: '如果我可以改變一件事', content: '在你生活的環境裡——學校、社區或整個社會——如果能改變一件事，你會選擇改變什麼？\n\n請說明你想改變的事、為什麼想改變，以及你認為可以怎麼做。不可用詩歌體。', type: QuestionType.SHARED, folderId: 'f2-3', folderName: '環境與社會', gradeLevel: '議論說明', isArchived: false , targetGrades: ['junior'], sources: ['exam_archive'] },

  // ── 節慶與民俗 (f4) ──
  { id: 'q-new-5', title: '在這樣的節日裡', content: '每個節日都有它的習俗：圍爐、掃墓、提燈籠、拜拜。這些看似重複的動作，年年做著，卻可能在某一年忽然對你有了不同的意義。\n\n請寫出一次你參與某個節日的經驗，以及你從中看見的事。不可用詩歌體。', type: QuestionType.SHARED, folderId: 'f4', folderName: '節慶與民俗', gradeLevel: '記敘抒情', isArchived: false , targetGrades: ['junior'], sources: ['udn'] },
  { id: 'q-new-5b', title: '一項正在消失的習俗', content: '有些傳統習俗因為生活方式改變，正逐漸被人遺忘。\n\n請介紹一項你觀察到正在消失的習俗，說明它原本的意義，並談談你認為它是否值得被保留。不可用詩歌體。', type: QuestionType.SHARED, folderId: 'f4', folderName: '節慶與民俗', gradeLevel: '議論說明', isArchived: false , targetGrades: ['junior'], sources: ['textbook'] },

  // ── 圖表判讀寫作 (f5) ──
  { id: 'q-new-8', title: '圖表判讀：中學生的課餘時間', content: '下方統計圖顯示某校中學生課餘時間的運用情形。\n\n請先說明你從圖表中觀察到的現象（至少兩項），再談談你對這個現象的看法或建議。不可用詩歌體。', type: QuestionType.SHARED, folderId: 'f5', folderName: '圖表判讀寫作', gradeLevel: '圖表寫作', isArchived: false , targetGrades: ['junior'], sources: ['exam_archive'] },

  // ── 個人題庫（根目錄）──
  {
    id: 'p-img-1',
    title: '看圖寫作：放學後的走廊',
    content: '請仔細觀察圖片。\n\n放學後的校園和白天很不一樣：人少了，聲音散了，光線也換了角度。\n\n請以「放學後的走廊」為題，寫下你在這個時刻看見的、聽見的，以及心裡浮現的事。不可用詩歌體。',
    type: QuestionType.PERSONAL,
    folderId: null,
    folderName: '未分類',
    gradeLevel: '看圖寫作',
    isArchived: false,
    imageUrl: 'https://images.unsplash.com/photo-1503676260728-1c00da094a0b?q=80&w=1000&auto=format&fit=crop',
    aiImageDescription: '校園走廊的一側是整排窗戶，午後的光斜斜照進來，在磨石子地板上拉出長方形的亮塊，走廊盡頭空無一人。',
    imagePosition: 'before',
    targetGrades: ['junior'],
    sources: ['original'],
    teacherNotes: '先寫你站的位置，再寫看出去的東西。\n安靜也是可以描寫的：少了什麼聲音？\n結尾不要硬要有道理，停在一個畫面也可以。',
  },
  { id: 'p-note-1', title: '一句想對三年後的自己說的話', content: '三年後的你可能在另一個學校、另一個城市。\n\n請寫一封短信給那時候的自己：說說你現在在意的事，以及你希望那時的自己還記得什麼。不可用詩歌體。', type: QuestionType.PERSONAL, folderId: null, folderName: '未分類', gradeLevel: '記敘抒情', isArchived: false, targetGrades: ['junior'], sources: ['original'] },

  // ── 個人題庫 ──
  { id: '4', title: '我想開設一家這樣的店', content: '如果有一天你能開一家店，你想開什麼樣的店？\n\n請描述這家店的樣子、你想提供給客人的東西，以及你為什麼想開它。不可用詩歌體。', type: QuestionType.PERSONAL, folderId: 'pf2', folderName: '寫作社講義', gradeLevel: '想像寫作', isArchived: false , targetGrades: ['junior'], sources: ['original'] },
  { id: '5', title: '說到努力這件事', content: '有人說努力一定有回報，也有人說努力不一定有結果。\n\n請談談你對「努力」的看法，並用自己的經驗或見聞來支持。不可用詩歌體。', type: QuestionType.PERSONAL, folderId: 'pf2', folderName: '寫作社講義', gradeLevel: '議論說明', isArchived: false , targetGrades: ['junior'], sources: ['original'] },
  { id: 'q-new-6', title: '謝謝你當時沒有說出口的話', content: '有時候，別人選擇不說，反而是一種體貼。\n\n請寫出一次有人對你「沒有說出口」的經驗，以及你後來明白了什麼。不可用詩歌體。', type: QuestionType.PERSONAL, folderId: 'pf2', folderName: '寫作社講義', gradeLevel: '記敘抒情', isArchived: false , targetGrades: ['junior'], sources: ['original'] },
  { id: 'q-new-6b', title: '寒假讀書心得：一本書的一句話', content: '請從寒假閱讀的書中選出最有感觸的一句話，抄錄下來，並說明它為什麼打動你。不可用詩歌體。', type: QuestionType.PERSONAL, folderId: 'pf3', folderName: '寒假作業', gradeLevel: '心得寫作', isArchived: false , targetGrades: ['junior'], sources: ['textbook'] },
  { id: 'q-new-7', title: '句子重組與擴寫練習', content: '請將下列平舖直述的句子，改寫成有畫面、有情緒的段落（至少三句）：\n\n「今天很熱，我走路回家。」', type: QuestionType.PERSONAL, folderId: 'pf4', folderName: '補救教學', gradeLevel: '基礎練習', isArchived: false , targetGrades: ['elementary', 'junior'], sources: ['original'] },
  { id: 'q-new-9', title: '（已封存）舊版段考題：我的暑假', content: '請寫出你這個暑假印象最深刻的一件事。', type: QuestionType.PERSONAL, folderId: 'pf1-1', folderName: '第一次段考', gradeLevel: '記敘抒情', isArchived: true },

  // ── 看圖寫作（家人與生活）──
  {
    id: 'img-1',
    title: '看圖寫作：市場的早晨',
    content: '請觀察圖片中的市場景象，寫下你對這個場景的觀察與感受。\n\n可以從聲音、氣味、人們的動作寫起，也可以寫這個畫面讓你想起的人或事。不可用詩歌體。',
    type: QuestionType.SHARED,
    folderId: 'f1-2',
    folderName: '家人與生活',
    gradeLevel: '看圖寫作',
    isArchived: false,
    imageUrl: 'https://images.unsplash.com/photo-1505253149613-112d21d9f6a9?q=80&w=1000&auto=format&fit=crop'
  }
];

// Generate assignments and submissions
export const generateMockAssignmentsAndSubmissions = () => {
  const assignments: Assignment[] = [];
  const submissions: Submission[] = [];

  MOCK_COURSES.forEach((course) => {
    // 5 assignments per course to show variety in student view
    for (let i = 0; i < 5; i++) {
      const randomQuestion = MOCK_QUESTIONS[i % MOCK_QUESTIONS.length];
      const assignmentId = `a-${course.id}-${i}`;
      const status = i < 3 ? "Published" : i === 3 ? "Closed" : "Published";

      const assignment: Assignment = {
        id: assignmentId,
        title: randomQuestion.title,
        courseId: course.id,
        questionId: randomQuestion.id,
        config: {
          deadline: getRelativeDate(i === 0 ? -10 : i === 1 ? -5 : i === 2 ? 2 : i === 3 ? -1 : 7),
          allowLateSubmission: true,
        },
        status: status as AssignmentStatus,
        totalStudents: course.studentCount,
        // 依索引錯開，否則 45 份作業的建立時間全部相同，「最近新增」排序看不出差別
        createdAt: getRelativeDate(-30 + i * 4),
      };
      assignments.push(assignment);

      // Generate submissions for this assignment
      const roster = RAW_ROSTERS[course.id] || [];
      roster.forEach((studentName, sIndex) => {
        const studentId = studentIdFor(course.id, sIndex + 1);
        const submissionId = `sub-${assignmentId}-${studentId}`;
        
        // For the first student (林冠宇 in c1), we want specific scenarios
        let subStatus: Submission['status'] = 'Unsubmitted';
        
        if (sIndex === 0) {
          // Specific scenarios for the first student to showcase student portal
          const scenarios: Submission['status'][] = ['Published', 'Pending', 'Draft', 'Published', 'Unsubmitted'];
          subStatus = scenarios[i];
          
          if (i === 0) {
            subStatus = 'Published';
          }
        } else {
          /*
            其他學生的狀態。用決定性雜湊，不要用 Math.random() ——
            這些資料會存進 localStorage，每次重新產生都不一樣的話，
            重現問題與比對畫面都會失準（理由同上面的 hashString）。

            一定要有 Graded（已批改、還沒發還）：批改清單的「發還」與
            「重置批改」兩顆都是靠這個狀態驅動的，先前完全沒產生 Graded，
            兩顆按鈕永遠是 (0) 且停用，看起來像壞掉。
          */
          const r = hashString(`${submissionId}/status`) % 100;
          if (r < 40) subStatus = 'Published';
          else if (r < 62) subStatus = 'Graded';
          else if (r < 82) subStatus = 'Pending';
          else if (r < 92) subStatus = 'Draft';
        }

        const submission: Submission = {
          id: submissionId,
          assignmentId: assignmentId,
          studentId: studentId,
          studentName: studentName,
          content:
            subStatus === 'Unsubmitted'
              ? ""
              : `那天放學的時候，天色已經有點暗了。我一個人走在回家的路上，想著白天發生的事。\n\n關於「${randomQuestion.title}」這個題目，我後來想了很久。有些事情當下不覺得怎麼樣，可是隔了一段時間再回頭看，才明白它其實改變了我一些什麼。\n\n我不確定自己有沒有寫清楚，但這就是我真正想說的。`,
          // 繳交時間刻意打散。原本寫成 getRelativeDateTime(-1, -sIndex)，
          // 等於時間由座號決定、座號 1 永遠最晚繳，
          // 於是儀表板的「最新繳交狀況」每次都只撈到各班第一位學生。
          submittedAt:
            subStatus === 'Unsubmitted' || subStatus === 'Draft'
              ? ""
              : getRelativeDateTime(
                  -Math.floor(Math.random() * 3),
                  -Math.floor(Math.random() * 24),
                ),
          status: subStatus,
        };

        if (subStatus === 'Published' || subStatus === 'Graded') {
          // 級分 3-6，讓班級平均落在四級分上下，接近真實會考分布
          let score = 3 + Math.floor(Math.random() * 4);
          // 示範用的低分案例：讓學生端能看到「需要補救」的樣子。
          // 原本寫 13（百分制），改制後要對應成一級分。
          if (sIndex === 0 && i === 0) {
            score = 1;
          }
          
          submission.result = {
            totalScore: score,
            categoryScores: {
              content: score,
              structure: Math.max(1, score - 1),
              grammar: score,
              vocabulary: Math.max(1, score - 1),
            },
            /*
              評語是 **markdown** —— 真實後端存的就是一整份 markdown 報告，
              示範資料照著長，畫面才測得到真正會遇到的排版。
            */
            feedback: [
              "### 綜合評語",
              "取材貼近題目，開頭用具體的生活場景切入，讀起來有畫面。第二段轉到自己的感受時稍嫌快了些，如果能多寫一個動作或對話，情緒的轉折會更有說服力。",
              "### 修改建議",
              "- 第二段「我忽然明白了」前面，補一個具體的動作或畫面，讓情緒有落點。",
              "- 第三段「渡過」應為「度過」，「藉口」的「藉」不要寫成「借」。",
              "- 全文多用短句，可以試著把其中兩句合併成長句，讓節奏有變化。",
            ].join("\n\n"),
            // 示範資料當作 AI 批改的版本。老師改過之後才會是 false
            isAi: true,
            isPublished: subStatus === 'Published',
          };
          submission.publishedAt = getRelativeDateTime(-1, 0);

        }

        submissions.push(submission);
      });
    }
  });

  return { assignments, submissions };
};

/**
 * 學生 ID 的唯一產生方式。
 *
 * 座號是 1 起算（COURSE_ROSTERS 用 index + 1），但 ID 裡放的是 0 起算的索引。
 * 這個落差先前害關心名單完全失效：那裡自己組了 `st-{課程}-{座號}`，
 * 前綴和編號基準都跟這裡不一樣，比對永遠落空，
 * 於是每個學生的作業都被算成未繳、平均分數都是 0。
 * 要組學生 ID 一律呼叫這個函式，不要自己拼字串。
 */
export const studentIdFor = (courseId: string, seatNo: number): string =>
  `s-${courseId}-${seatNo - 1}`;

/**
 * 從學生 ID 反推座號。與 studentIdFor 成對，不要自己用 split 解析。
 *
 * 用 lastIndexOf 而不是 split('-')[2]：課程 id 本身可能含連字號
 * （例如 c-old-1），切成陣列後第 3 段會變成 "old" 而不是編號。
 * 另外要 +1 —— ID 裡放的是 0 起算的索引，座號是 1 起算。
 */
export const seatNoFromStudentId = (studentId: string): number => {
  const n = Number(studentId.slice(studentId.lastIndexOf('-') + 1));
  return Number.isFinite(n) ? n + 1 : 0;
};

/** 座號的顯示字串，補零至兩位 */
export const seatLabel = (studentId: string): string =>
  String(seatNoFromStudentId(studentId)).padStart(2, '0');

export const COURSE_ROSTERS: Record<string, { seatNo: number; name: string }[]> =
  Object.fromEntries(
    Object.entries(RAW_ROSTERS).map(([key, names]) => [
      key,
      names.map((name, index) => ({ seatNo: index + 1, name })),
    ]),
  );

const { assignments: MOCK_ASSIGNMENTS, submissions: MOCK_SUBMISSIONS } = generateMockAssignmentsAndSubmissions();

export { MOCK_ASSIGNMENTS, MOCK_SUBMISSIONS };
