/** 課表範例 */
const COURSE_DATA_SAMPLE = [
    {
        "course": "101",
        "teachers": [{ "name": "趙老師", "account": "teacher@gmail.com" }],
        "students": [
            { "name": "王大明", "account": "stud01@gmail.com" },
            { "name": "王小明", "account": "stud02@gmail.com" },
            { "name": "王中明", "account": "stud03@gmail.com" },
        ]
    },
    {
        "course": "102",
        "teachers": [{ "name": "汪老師", "account": "teacher2@gmail.com" }],
        "students": [
            { "name": "尤小柏", "account": "j355027@stud.tksh.ntpc.edu.tw" },
            { "name": "尤中柏", "account": "j355027@stud.tksh.ntpc.edu.tw" },
            { "name": "尤大柏", "account": "j355027@stud.tksh.ntpc.edu.tw" }
        ]
    },
]



const COURSE_DATA = [...COURSE_DATA_SAMPLE];

export { COURSE_DATA };
