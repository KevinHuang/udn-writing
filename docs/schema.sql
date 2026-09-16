--
-- PostgreSQL database dump
--

-- Dumped from database version 14.22
-- Dumped by pg_dump version 14.4

-- Started on 2026-09-16 10:44:37 CST

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- TOC entry 235 (class 1259 OID 288331)
-- Name: assignment; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.assignment (
    id bigint NOT NULL,
    ref_course_id bigint NOT NULL,
    ref_task_id bigint NOT NULL,
    ref_user_id bigint,
    assigned_at timestamp with time zone DEFAULT now() NOT NULL,
    opened boolean DEFAULT false NOT NULL,
    week_no smallint,
    opened_at timestamp with time zone
);


ALTER TABLE public.assignment OWNER TO postgres;

--
-- TOC entry 4146 (class 0 OID 0)
-- Dependencies: 235
-- Name: TABLE assignment; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.assignment IS '任務指派。由 opened 來控制學生是否可看到此份作業。';


--
-- TOC entry 4147 (class 0 OID 0)
-- Dependencies: 235
-- Name: COLUMN assignment.id; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.assignment.id IS '系統編號';


--
-- TOC entry 4148 (class 0 OID 0)
-- Dependencies: 235
-- Name: COLUMN assignment.ref_course_id; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.assignment.ref_course_id IS '所屬課程編號。 ref: course.id';


--
-- TOC entry 4149 (class 0 OID 0)
-- Dependencies: 235
-- Name: COLUMN assignment.ref_task_id; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.assignment.ref_task_id IS '任務編號。 ref: task.id';


--
-- TOC entry 4150 (class 0 OID 0)
-- Dependencies: 235
-- Name: COLUMN assignment.ref_user_id; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.assignment.ref_user_id IS '指派人員編號。 ref: user.id';


--
-- TOC entry 4151 (class 0 OID 0)
-- Dependencies: 235
-- Name: COLUMN assignment.assigned_at; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.assignment.assigned_at IS '指派時間';


--
-- TOC entry 4152 (class 0 OID 0)
-- Dependencies: 235
-- Name: COLUMN assignment.opened; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.assignment.opened IS '這指派作業是否開啟';


--
-- TOC entry 4153 (class 0 OID 0)
-- Dependencies: 235
-- Name: COLUMN assignment.week_no; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.assignment.week_no IS '指派給課程的第幾周的任務。最多 20 週。';


--
-- TOC entry 234 (class 1259 OID 288330)
-- Name: assignment_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.assignment_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.assignment_id_seq OWNER TO postgres;

--
-- TOC entry 4155 (class 0 OID 0)
-- Dependencies: 234
-- Name: assignment_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.assignment_id_seq OWNED BY public.assignment.id;


--
-- TOC entry 244 (class 1259 OID 345759)
-- Name: batch_proxy_submission; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.batch_proxy_submission (
    id bigint NOT NULL,
    ref_assignment_id bigint,
    ref_user_id bigint,
    submitter_id bigint,
    created_at timestamp with time zone DEFAULT now(),
    file_url character varying,
    ocr_time timestamp with time zone,
    batch_uuid character varying,
    is_valid boolean DEFAULT true,
    last_update timestamp with time zone DEFAULT now(),
    img_files json,
    ocr_model character varying,
    input_tokens integer,
    output_tokens integer
);


ALTER TABLE public.batch_proxy_submission OWNER TO postgres;

--
-- TOC entry 4157 (class 0 OID 0)
-- Dependencies: 244
-- Name: TABLE batch_proxy_submission; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.batch_proxy_submission IS '教師批次代為繳交';


--
-- TOC entry 4158 (class 0 OID 0)
-- Dependencies: 244
-- Name: COLUMN batch_proxy_submission.submitter_id; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.batch_proxy_submission.submitter_id IS '提交者編號，ref: user.id';


--
-- TOC entry 4159 (class 0 OID 0)
-- Dependencies: 244
-- Name: COLUMN batch_proxy_submission.file_url; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.batch_proxy_submission.file_url IS '此欄位棄用，改 image_files';


--
-- TOC entry 4160 (class 0 OID 0)
-- Dependencies: 244
-- Name: COLUMN batch_proxy_submission.is_valid; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.batch_proxy_submission.is_valid IS '是否有效。教師可能多次代學生繳交';


--
-- TOC entry 227 (class 1259 OID 288261)
-- Name: course; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.course (
    id bigint NOT NULL,
    ref_org_id integer,
    ref_school_id integer,
    school_year integer,
    semester integer,
    course_name character varying,
    ref_user_id integer,
    course_type character varying,
    uid character varying,
    created_at timestamp with time zone DEFAULT now(),
    is_active boolean DEFAULT true,
    source_index bigint DEFAULT '-1'::integer
);


ALTER TABLE public.course OWNER TO postgres;

--
-- TOC entry 4162 (class 0 OID 0)
-- Dependencies: 227
-- Name: TABLE course; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.course IS '課程。';


--
-- TOC entry 4163 (class 0 OID 0)
-- Dependencies: 227
-- Name: COLUMN course.id; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.course.id IS '系統編號';


--
-- TOC entry 4164 (class 0 OID 0)
-- Dependencies: 227
-- Name: COLUMN course.ref_org_id; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.course.ref_org_id IS '所屬組織編號， ref: org.id';


--
-- TOC entry 4165 (class 0 OID 0)
-- Dependencies: 227
-- Name: COLUMN course.ref_school_id; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.course.ref_school_id IS '課程所屬學校的 school.id';


--
-- TOC entry 4166 (class 0 OID 0)
-- Dependencies: 227
-- Name: COLUMN course.school_year; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.course.school_year IS '學年度';


--
-- TOC entry 4167 (class 0 OID 0)
-- Dependencies: 227
-- Name: COLUMN course.semester; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.course.semester IS '學期';


--
-- TOC entry 4168 (class 0 OID 0)
-- Dependencies: 227
-- Name: COLUMN course.course_name; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.course.course_name IS '課程名稱';


--
-- TOC entry 4169 (class 0 OID 0)
-- Dependencies: 227
-- Name: COLUMN course.ref_user_id; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.course.ref_user_id IS '教師編號，對應 users.id';


--
-- TOC entry 4170 (class 0 OID 0)
-- Dependencies: 227
-- Name: COLUMN course.course_type; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.course.course_type IS '課程類型，可能是 class 或  course';


--
-- TOC entry 4171 (class 0 OID 0)
-- Dependencies: 227
-- Name: COLUMN course.uid; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.course.uid IS '課程的 uuid，目前不會用到';


--
-- TOC entry 4172 (class 0 OID 0)
-- Dependencies: 227
-- Name: COLUMN course.created_at; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.course.created_at IS '此紀錄建立時間';


--
-- TOC entry 4173 (class 0 OID 0)
-- Dependencies: 227
-- Name: COLUMN course.is_active; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.course.is_active IS '課程是否有效？';


--
-- TOC entry 4174 (class 0 OID 0)
-- Dependencies: 227
-- Name: COLUMN course.source_index; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.course.source_index IS '對應 dsa 的 course.id';


--
-- TOC entry 248 (class 1259 OID 779939)
-- Name: course_bk; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.course_bk (
    id bigint,
    ref_org_id integer,
    ref_school_id integer,
    school_year integer,
    semester integer,
    course_name character varying,
    ref_user_id integer,
    course_type character varying,
    uid character varying,
    created_at timestamp with time zone,
    is_active boolean,
    source_index bigint
);


ALTER TABLE public.course_bk OWNER TO postgres;

--
-- TOC entry 226 (class 1259 OID 288260)
-- Name: course_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.course_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.course_id_seq OWNER TO postgres;

--
-- TOC entry 4176 (class 0 OID 0)
-- Dependencies: 226
-- Name: course_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.course_id_seq OWNED BY public.course.id;


--
-- TOC entry 247 (class 1259 OID 681636)
-- Name: final_report; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.final_report (
    id bigint NOT NULL,
    ref_user_id bigint,
    ref_course_id bigint,
    avg_score double precision,
    theme_and_content_score numeric(4,1),
    structure_and_organization_score numeric(4,1),
    diction_and_sentence_structure_score numeric(4,1),
    mechanics_and_punctuation_score numeric(4,1),
    theme_and_content_score_summary character varying,
    structure_and_organization_score_summary character varying,
    diction_and_sentence_structure_score_summary character varying,
    mechanics_and_punctuation_score_summary character varying,
    created_at timestamp with time zone DEFAULT now(),
    article_count integer,
    created_by bigint,
    model_name character varying,
    input_tokens integer,
    output_tokens integer,
    hightest_score_title character varying,
    hightest_score_remark character varying,
    final_summarys character varying
);


ALTER TABLE public.final_report OWNER TO postgres;

--
-- TOC entry 4178 (class 0 OID 0)
-- Dependencies: 247
-- Name: TABLE final_report; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.final_report IS '學生期末成績總結';


--
-- TOC entry 4179 (class 0 OID 0)
-- Dependencies: 247
-- Name: COLUMN final_report.ref_user_id; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.final_report.ref_user_id IS '學生編號';


--
-- TOC entry 4180 (class 0 OID 0)
-- Dependencies: 247
-- Name: COLUMN final_report.ref_course_id; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.final_report.ref_course_id IS '修哪一堂課';


--
-- TOC entry 4181 (class 0 OID 0)
-- Dependencies: 247
-- Name: COLUMN final_report.avg_score; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.final_report.avg_score IS '最後總成績，由每次作文的分數平均';


--
-- TOC entry 4182 (class 0 OID 0)
-- Dependencies: 247
-- Name: COLUMN final_report.theme_and_content_score; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.final_report.theme_and_content_score IS '立意取材分數';


--
-- TOC entry 4183 (class 0 OID 0)
-- Dependencies: 247
-- Name: COLUMN final_report.structure_and_organization_score; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.final_report.structure_and_organization_score IS '結構組織分數。';


--
-- TOC entry 4184 (class 0 OID 0)
-- Dependencies: 247
-- Name: COLUMN final_report.diction_and_sentence_structure_score; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.final_report.diction_and_sentence_structure_score IS '遣詞造句分數';


--
-- TOC entry 4185 (class 0 OID 0)
-- Dependencies: 247
-- Name: COLUMN final_report.mechanics_and_punctuation_score; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.final_report.mechanics_and_punctuation_score IS '錯別字與標點分數。';


--
-- TOC entry 4186 (class 0 OID 0)
-- Dependencies: 247
-- Name: COLUMN final_report.theme_and_content_score_summary; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.final_report.theme_and_content_score_summary IS '立意取材分數總結。';


--
-- TOC entry 4187 (class 0 OID 0)
-- Dependencies: 247
-- Name: COLUMN final_report.structure_and_organization_score_summary; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.final_report.structure_and_organization_score_summary IS '結構組織分數總結。';


--
-- TOC entry 4188 (class 0 OID 0)
-- Dependencies: 247
-- Name: COLUMN final_report.diction_and_sentence_structure_score_summary; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.final_report.diction_and_sentence_structure_score_summary IS '遣詞造句分數總結';


--
-- TOC entry 4189 (class 0 OID 0)
-- Dependencies: 247
-- Name: COLUMN final_report.mechanics_and_punctuation_score_summary; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.final_report.mechanics_and_punctuation_score_summary IS '錯別字與標點分數總結';


--
-- TOC entry 4190 (class 0 OID 0)
-- Dependencies: 247
-- Name: COLUMN final_report.created_by; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.final_report.created_by IS '建立者，對應 user.id';


--
-- TOC entry 210 (class 1259 OID 288113)
-- Name: login_history; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.login_history (
    id bigint NOT NULL,
    user_name character varying NOT NULL,
    dsns character varying,
    role_type character varying,
    login_time timestamp with time zone DEFAULT now() NOT NULL,
    name character varying,
    user_info jsonb,
    client_ip character varying NOT NULL
);


ALTER TABLE public.login_history OWNER TO postgres;

--
-- TOC entry 4192 (class 0 OID 0)
-- Dependencies: 210
-- Name: TABLE login_history; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.login_history IS 'identity_code 登入歷程';


--
-- TOC entry 209 (class 1259 OID 288112)
-- Name: login_history_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.login_history_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.login_history_id_seq OWNER TO postgres;

--
-- TOC entry 4194 (class 0 OID 0)
-- Dependencies: 209
-- Name: login_history_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.login_history_id_seq OWNED BY public.login_history.id;


--
-- TOC entry 225 (class 1259 OID 288252)
-- Name: org; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.org (
    id bigint NOT NULL,
    name character varying NOT NULL
);


ALTER TABLE public.org OWNER TO postgres;

--
-- TOC entry 4196 (class 0 OID 0)
-- Dependencies: 225
-- Name: TABLE org; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.org IS '組織';


--
-- TOC entry 4197 (class 0 OID 0)
-- Dependencies: 225
-- Name: COLUMN org.id; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.org.id IS '系統編號';


--
-- TOC entry 4198 (class 0 OID 0)
-- Dependencies: 225
-- Name: COLUMN org.name; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.org.name IS '組織名稱';


--
-- TOC entry 231 (class 1259 OID 288299)
-- Name: org_admin; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.org_admin (
    id bigint NOT NULL,
    ref_org_id bigint,
    account character varying,
    name character varying,
    role_type character varying,
    updated_time timestamp with time zone DEFAULT now(),
    ref_user_id bigint
);


ALTER TABLE public.org_admin OWNER TO postgres;

--
-- TOC entry 4200 (class 0 OID 0)
-- Dependencies: 231
-- Name: TABLE org_admin; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.org_admin IS '組織管理者';


--
-- TOC entry 4201 (class 0 OID 0)
-- Dependencies: 231
-- Name: COLUMN org_admin.id; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.org_admin.id IS '自動編號';


--
-- TOC entry 4202 (class 0 OID 0)
-- Dependencies: 231
-- Name: COLUMN org_admin.ref_org_id; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.org_admin.ref_org_id IS '組織編號, ref: org.id';


--
-- TOC entry 4203 (class 0 OID 0)
-- Dependencies: 231
-- Name: COLUMN org_admin.account; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.org_admin.account IS '帳號';


--
-- TOC entry 4204 (class 0 OID 0)
-- Dependencies: 231
-- Name: COLUMN org_admin.name; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.org_admin.name IS '姓名';


--
-- TOC entry 4205 (class 0 OID 0)
-- Dependencies: 231
-- Name: COLUMN org_admin.role_type; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.org_admin.role_type IS '身份類別，目前就只有 admin';


--
-- TOC entry 4206 (class 0 OID 0)
-- Dependencies: 231
-- Name: COLUMN org_admin.updated_time; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.org_admin.updated_time IS '最後更新時間';


--
-- TOC entry 4207 (class 0 OID 0)
-- Dependencies: 231
-- Name: COLUMN org_admin.ref_user_id; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.org_admin.ref_user_id IS '最後編輯者，參考 user.id';


--
-- TOC entry 230 (class 1259 OID 288298)
-- Name: org_admin_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.org_admin_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.org_admin_id_seq OWNER TO postgres;

--
-- TOC entry 4209 (class 0 OID 0)
-- Dependencies: 230
-- Name: org_admin_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.org_admin_id_seq OWNED BY public.org_admin.id;


--
-- TOC entry 224 (class 1259 OID 288251)
-- Name: org_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.org_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.org_id_seq OWNER TO postgres;

--
-- TOC entry 4211 (class 0 OID 0)
-- Dependencies: 224
-- Name: org_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.org_id_seq OWNED BY public.org.id;


--
-- TOC entry 243 (class 1259 OID 288394)
-- Name: system_instruction; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.system_instruction (
    id bigint NOT NULL,
    title character varying,
    content character varying,
    last_update timestamp with time zone DEFAULT now(),
    ref_user_id bigint,
    is_valid boolean DEFAULT false
);


ALTER TABLE public.system_instruction OWNER TO postgres;

--
-- TOC entry 4213 (class 0 OID 0)
-- Dependencies: 243
-- Name: TABLE system_instruction; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.system_instruction IS '批改作文的系統提示詞';


--
-- TOC entry 242 (class 1259 OID 288393)
-- Name: prompt_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.prompt_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.prompt_id_seq OWNER TO postgres;

--
-- TOC entry 4215 (class 0 OID 0)
-- Dependencies: 242
-- Name: prompt_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.prompt_id_seq OWNED BY public.system_instruction.id;


--
-- TOC entry 245 (class 1259 OID 345762)
-- Name: proxy_submission_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.proxy_submission_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.proxy_submission_id_seq OWNER TO postgres;

--
-- TOC entry 4217 (class 0 OID 0)
-- Dependencies: 245
-- Name: proxy_submission_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.proxy_submission_id_seq OWNED BY public.batch_proxy_submission.id;


--
-- TOC entry 212 (class 1259 OID 288123)
-- Name: school; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.school (
    id bigint NOT NULL,
    dsns character varying,
    school_name character varying,
    last_update timestamp with time zone DEFAULT now(),
    school_type character varying,
    source_index bigint,
    is_valid boolean DEFAULT true
);


ALTER TABLE public.school OWNER TO postgres;

--
-- TOC entry 4219 (class 0 OID 0)
-- Dependencies: 212
-- Name: TABLE school; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.school IS '學校清單';


--
-- TOC entry 4220 (class 0 OID 0)
-- Dependencies: 212
-- Name: COLUMN school.id; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.school.id IS '自動編號';


--
-- TOC entry 4221 (class 0 OID 0)
-- Dependencies: 212
-- Name: COLUMN school.dsns; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.school.dsns IS '學校的 DSNS';


--
-- TOC entry 4222 (class 0 OID 0)
-- Dependencies: 212
-- Name: COLUMN school.school_name; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.school.school_name IS '學校名稱';


--
-- TOC entry 4223 (class 0 OID 0)
-- Dependencies: 212
-- Name: COLUMN school.last_update; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.school.last_update IS '最後更新日期';


--
-- TOC entry 4224 (class 0 OID 0)
-- Dependencies: 212
-- Name: COLUMN school.source_index; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.school.source_index IS '校務系統的班級編號 class.id
因為 聯合智慧+ 的班級其實是各個學校。';


--
-- TOC entry 218 (class 1259 OID 288165)
-- Name: school_admin; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.school_admin (
    id bigint NOT NULL,
    ref_school_id bigint,
    account character varying,
    name character varying,
    role_type character varying,
    updated_time timestamp with time zone DEFAULT now(),
    ref_user_id bigint
);


ALTER TABLE public.school_admin OWNER TO postgres;

--
-- TOC entry 4226 (class 0 OID 0)
-- Dependencies: 218
-- Name: TABLE school_admin; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.school_admin IS '學校管理者';


--
-- TOC entry 4227 (class 0 OID 0)
-- Dependencies: 218
-- Name: COLUMN school_admin.id; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.school_admin.id IS '自動編號';


--
-- TOC entry 4228 (class 0 OID 0)
-- Dependencies: 218
-- Name: COLUMN school_admin.ref_school_id; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.school_admin.ref_school_id IS '學校編號, ref: school.id';


--
-- TOC entry 4229 (class 0 OID 0)
-- Dependencies: 218
-- Name: COLUMN school_admin.account; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.school_admin.account IS '帳號';


--
-- TOC entry 4230 (class 0 OID 0)
-- Dependencies: 218
-- Name: COLUMN school_admin.name; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.school_admin.name IS '姓名';


--
-- TOC entry 4231 (class 0 OID 0)
-- Dependencies: 218
-- Name: COLUMN school_admin.role_type; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.school_admin.role_type IS '身份類別，目前就只有 admin';


--
-- TOC entry 4232 (class 0 OID 0)
-- Dependencies: 218
-- Name: COLUMN school_admin.updated_time; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.school_admin.updated_time IS '最後更新時間';


--
-- TOC entry 4233 (class 0 OID 0)
-- Dependencies: 218
-- Name: COLUMN school_admin.ref_user_id; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.school_admin.ref_user_id IS '最後編輯者，參考 user.id';


--
-- TOC entry 217 (class 1259 OID 288164)
-- Name: school_admin_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.school_admin_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.school_admin_id_seq OWNER TO postgres;

--
-- TOC entry 4235 (class 0 OID 0)
-- Dependencies: 217
-- Name: school_admin_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.school_admin_id_seq OWNED BY public.school_admin.id;


--
-- TOC entry 211 (class 1259 OID 288122)
-- Name: school_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.school_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.school_id_seq OWNER TO postgres;

--
-- TOC entry 4237 (class 0 OID 0)
-- Dependencies: 211
-- Name: school_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.school_id_seq OWNED BY public.school.id;


--
-- TOC entry 240 (class 1259 OID 288368)
-- Name: semesters_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.semesters_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.semesters_id_seq OWNER TO postgres;

--
-- TOC entry 241 (class 1259 OID 288369)
-- Name: semesters; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.semesters (
    id bigint DEFAULT nextval('public.semesters_id_seq'::regclass) NOT NULL,
    start_date date,
    end_date date,
    school_year integer,
    semester integer
);


ALTER TABLE public.semesters OWNER TO postgres;

--
-- TOC entry 221 (class 1259 OID 288194)
-- Name: session; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.session (
    session_id character varying NOT NULL,
    expiry_date bigint NOT NULL,
    data json NOT NULL
);


ALTER TABLE public.session OWNER TO postgres;

--
-- TOC entry 246 (class 1259 OID 681635)
-- Name: stud_final_report_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.stud_final_report_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.stud_final_report_id_seq OWNER TO postgres;

--
-- TOC entry 4242 (class 0 OID 0)
-- Dependencies: 246
-- Name: stud_final_report_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.stud_final_report_id_seq OWNED BY public.final_report.id;


--
-- TOC entry 237 (class 1259 OID 288337)
-- Name: submission; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.submission (
    id bigint NOT NULL,
    ref_user_id bigint,
    ref_assignment_id bigint,
    content character varying,
    pic_files jsonb,
    submited_time timestamp with time zone DEFAULT now(),
    last_update timestamp with time zone DEFAULT now(),
    word_count integer DEFAULT 0
);


ALTER TABLE public.submission OWNER TO postgres;

--
-- TOC entry 4244 (class 0 OID 0)
-- Dependencies: 237
-- Name: TABLE submission; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.submission IS '學生提交作業';


--
-- TOC entry 4245 (class 0 OID 0)
-- Dependencies: 237
-- Name: COLUMN submission.ref_user_id; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.submission.ref_user_id IS '學生編號。 ref:  user.id';


--
-- TOC entry 4246 (class 0 OID 0)
-- Dependencies: 237
-- Name: COLUMN submission.ref_assignment_id; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.submission.ref_assignment_id IS '指派任務編號，ref: assignment.id';


--
-- TOC entry 4247 (class 0 OID 0)
-- Dependencies: 237
-- Name: COLUMN submission.content; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.submission.content IS '繳交的文字內容';


--
-- TOC entry 4248 (class 0 OID 0)
-- Dependencies: 237
-- Name: COLUMN submission.pic_files; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.submission.pic_files IS '繳交的檔案清單，此為 json 字串陣列。';


--
-- TOC entry 4249 (class 0 OID 0)
-- Dependencies: 237
-- Name: COLUMN submission.submited_time; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.submission.submited_time IS '系統提交時間';


--
-- TOC entry 4250 (class 0 OID 0)
-- Dependencies: 237
-- Name: COLUMN submission.word_count; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.submission.word_count IS '文章字數';


--
-- TOC entry 238 (class 1259 OID 288346)
-- Name: submission_feedback; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.submission_feedback (
    id bigint NOT NULL,
    ref_submission_id bigint,
    score real,
    content character varying,
    is_valid boolean DEFAULT true,
    created_time timestamp with time zone DEFAULT now(),
    ref_user_id bigint,
    input_tokens integer,
    output_tokens integer,
    is_returned boolean DEFAULT false,
    returned_time timestamp with time zone DEFAULT now(),
    updated_time timestamp with time zone DEFAULT now(),
    is_ai boolean DEFAULT true,
    sub_scores jsonb,
    sub_scores_input_tokens integer,
    sub_scores_output_tokens integer,
    sub_scores_time timestamp with time zone
);


ALTER TABLE public.submission_feedback OWNER TO postgres;

--
-- TOC entry 4252 (class 0 OID 0)
-- Dependencies: 238
-- Name: TABLE submission_feedback; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.submission_feedback IS '批改結果';


--
-- TOC entry 4253 (class 0 OID 0)
-- Dependencies: 238
-- Name: COLUMN submission_feedback.ref_submission_id; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.submission_feedback.ref_submission_id IS '提交作業編號, ref: submission.id';


--
-- TOC entry 4254 (class 0 OID 0)
-- Dependencies: 238
-- Name: COLUMN submission_feedback.score; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.submission_feedback.score IS '分數';


--
-- TOC entry 4255 (class 0 OID 0)
-- Dependencies: 238
-- Name: COLUMN submission_feedback.content; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.submission_feedback.content IS '批改內容';


--
-- TOC entry 4256 (class 0 OID 0)
-- Dependencies: 238
-- Name: COLUMN submission_feedback.is_valid; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.submission_feedback.is_valid IS '是否有效？如果某提交作業重新批改，則前一份批改為無效。';


--
-- TOC entry 4257 (class 0 OID 0)
-- Dependencies: 238
-- Name: COLUMN submission_feedback.created_time; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.submission_feedback.created_time IS '批改時間';


--
-- TOC entry 4258 (class 0 OID 0)
-- Dependencies: 238
-- Name: COLUMN submission_feedback.ref_user_id; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.submission_feedback.ref_user_id IS '執行批改者的使用者編號， ref: user.id';


--
-- TOC entry 4259 (class 0 OID 0)
-- Dependencies: 238
-- Name: COLUMN submission_feedback.input_tokens; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.submission_feedback.input_tokens IS 'input token 數量';


--
-- TOC entry 4260 (class 0 OID 0)
-- Dependencies: 238
-- Name: COLUMN submission_feedback.output_tokens; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.submission_feedback.output_tokens IS 'output token 數量';


--
-- TOC entry 4261 (class 0 OID 0)
-- Dependencies: 238
-- Name: COLUMN submission_feedback.is_returned; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.submission_feedback.is_returned IS '是否已發還給學生。預設 false';


--
-- TOC entry 4262 (class 0 OID 0)
-- Dependencies: 238
-- Name: COLUMN submission_feedback.returned_time; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.submission_feedback.returned_time IS '發還時間';


--
-- TOC entry 4263 (class 0 OID 0)
-- Dependencies: 238
-- Name: COLUMN submission_feedback.updated_time; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.submission_feedback.updated_time IS '最後修改時間。如果教師有手動修改結果，則時間會晚於 created_time。';


--
-- TOC entry 4264 (class 0 OID 0)
-- Dependencies: 238
-- Name: COLUMN submission_feedback.is_ai; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.submission_feedback.is_ai IS '這筆紀錄是否由 AI 產生。若是由 AI 批改產生，則 true，否則就是由教師修改的結果。';


--
-- TOC entry 239 (class 1259 OID 288349)
-- Name: submission_feedback_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.submission_feedback_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.submission_feedback_id_seq OWNER TO postgres;

--
-- TOC entry 4266 (class 0 OID 0)
-- Dependencies: 239
-- Name: submission_feedback_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.submission_feedback_id_seq OWNED BY public.submission_feedback.id;


--
-- TOC entry 236 (class 1259 OID 288336)
-- Name: submission_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.submission_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.submission_id_seq OWNER TO postgres;

--
-- TOC entry 4268 (class 0 OID 0)
-- Dependencies: 236
-- Name: submission_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.submission_id_seq OWNED BY public.submission.id;


--
-- TOC entry 220 (class 1259 OID 288185)
-- Name: system_admin; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.system_admin (
    id bigint NOT NULL,
    account character varying,
    editor_account character varying,
    create_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.system_admin OWNER TO postgres;

--
-- TOC entry 4270 (class 0 OID 0)
-- Dependencies: 220
-- Name: TABLE system_admin; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.system_admin IS '系統管理員';


--
-- TOC entry 219 (class 1259 OID 288184)
-- Name: system_admin_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.system_admin_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.system_admin_id_seq OWNER TO postgres;

--
-- TOC entry 4272 (class 0 OID 0)
-- Dependencies: 219
-- Name: system_admin_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.system_admin_id_seq OWNED BY public.system_admin.id;


--
-- TOC entry 233 (class 1259 OID 288320)
-- Name: task; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.task (
    id bigint NOT NULL,
    level jsonb,
    source jsonb,
    title character varying,
    description character varying,
    note character varying,
    pic1 character varying,
    ref_user_id bigint,
    ref_org_id bigint,
    shared boolean,
    created_time timestamp with time zone DEFAULT now(),
    updated_time timestamp with time zone DEFAULT now(),
    ref_instruction_id bigint,
    pic_position character varying DEFAULT 'after'::character varying
);


ALTER TABLE public.task OWNER TO postgres;

--
-- TOC entry 4274 (class 0 OID 0)
-- Dependencies: 233
-- Name: TABLE task; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.task IS '任務。教師個人建立的任務屬於個人。組織管理者建立的任務屬於組織的共享任務。';


--
-- TOC entry 4275 (class 0 OID 0)
-- Dependencies: 233
-- Name: COLUMN task.level; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.task.level IS '適用階段 ( json 陣列，[ 國小, 國中, 高中]，可複選)';


--
-- TOC entry 4276 (class 0 OID 0)
-- Dependencies: 233
-- Name: COLUMN task.source; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.task.source IS '題目來源 (JSON 陣列，[ 會考歷屆、聯合報、聯合盃 ]，可複選)';


--
-- TOC entry 4277 (class 0 OID 0)
-- Dependencies: 233
-- Name: COLUMN task.title; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.task.title IS '題目名稱';


--
-- TOC entry 4278 (class 0 OID 0)
-- Dependencies: 233
-- Name: COLUMN task.description; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.task.description IS '題說 (簡短描述)';


--
-- TOC entry 4279 (class 0 OID 0)
-- Dependencies: 233
-- Name: COLUMN task.note; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.task.note IS '教師的話 (寫作引導或注意事項)';


--
-- TOC entry 4280 (class 0 OID 0)
-- Dependencies: 233
-- Name: COLUMN task.ref_user_id; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.task.ref_user_id IS '作者。ref: user.id';


--
-- TOC entry 4281 (class 0 OID 0)
-- Dependencies: 233
-- Name: COLUMN task.ref_org_id; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.task.ref_org_id IS '所屬組織。ref: org.id';


--
-- TOC entry 4282 (class 0 OID 0)
-- Dependencies: 233
-- Name: COLUMN task.shared; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.task.shared IS '是否共享。 如果是，就一定要指定 ref_org_id';


--
-- TOC entry 4283 (class 0 OID 0)
-- Dependencies: 233
-- Name: COLUMN task.created_time; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.task.created_time IS '建立時間';


--
-- TOC entry 4284 (class 0 OID 0)
-- Dependencies: 233
-- Name: COLUMN task.updated_time; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.task.updated_time IS '最後更新時間';


--
-- TOC entry 4285 (class 0 OID 0)
-- Dependencies: 233
-- Name: COLUMN task.ref_instruction_id; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.task.ref_instruction_id IS '使用 genai 批改這篇作文所需要的 system instruction。 ref to: system_instruction.id
';


--
-- TOC entry 4286 (class 0 OID 0)
-- Dependencies: 233
-- Name: COLUMN task.pic_position; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.task.pic_position IS '圖片位置在題說的前或後。值為 after / before。 預設是 after';


--
-- TOC entry 232 (class 1259 OID 288319)
-- Name: task_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.task_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.task_id_seq OWNER TO postgres;

--
-- TOC entry 4288 (class 0 OID 0)
-- Dependencies: 232
-- Name: task_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.task_id_seq OWNED BY public.task.id;


--
-- TOC entry 223 (class 1259 OID 288244)
-- Name: uc_instructor; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.uc_instructor (
    id bigint NOT NULL,
    ref_course_id bigint,
    ref_user_id bigint,
    created_at timestamp with time zone DEFAULT now(),
    created_by character varying,
    is_primary boolean
);


ALTER TABLE public.uc_instructor OWNER TO postgres;

--
-- TOC entry 4290 (class 0 OID 0)
-- Dependencies: 223
-- Name: TABLE uc_instructor; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.uc_instructor IS '授課教師';


--
-- TOC entry 4291 (class 0 OID 0)
-- Dependencies: 223
-- Name: COLUMN uc_instructor.ref_course_id; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.uc_instructor.ref_course_id IS '所屬課程，對照 course.id';


--
-- TOC entry 4292 (class 0 OID 0)
-- Dependencies: 223
-- Name: COLUMN uc_instructor.ref_user_id; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.uc_instructor.ref_user_id IS '使用者編號，對照 user.id';


--
-- TOC entry 4293 (class 0 OID 0)
-- Dependencies: 223
-- Name: COLUMN uc_instructor.created_at; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.uc_instructor.created_at IS '紀錄建立時間';


--
-- TOC entry 4294 (class 0 OID 0)
-- Dependencies: 223
-- Name: COLUMN uc_instructor.created_by; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.uc_instructor.created_by IS '紀錄者的帳號';


--
-- TOC entry 4295 (class 0 OID 0)
-- Dependencies: 223
-- Name: COLUMN uc_instructor.is_primary; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.uc_instructor.is_primary IS '是否是主要教師';


--
-- TOC entry 222 (class 1259 OID 288243)
-- Name: uc_instructor_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.uc_instructor_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.uc_instructor_id_seq OWNER TO postgres;

--
-- TOC entry 4297 (class 0 OID 0)
-- Dependencies: 222
-- Name: uc_instructor_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.uc_instructor_id_seq OWNED BY public.uc_instructor.id;


--
-- TOC entry 229 (class 1259 OID 288289)
-- Name: uc_learner; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.uc_learner (
    id bigint NOT NULL,
    ref_course_id bigint,
    ref_user_id bigint,
    created_at timestamp with time zone DEFAULT now(),
    created_by character varying,
    seat_no smallint,
    source_class character varying
);


ALTER TABLE public.uc_learner OWNER TO postgres;

--
-- TOC entry 4299 (class 0 OID 0)
-- Dependencies: 229
-- Name: TABLE uc_learner; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.uc_learner IS '修課學生';


--
-- TOC entry 4300 (class 0 OID 0)
-- Dependencies: 229
-- Name: COLUMN uc_learner.ref_course_id; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.uc_learner.ref_course_id IS '所屬課程，對照 course.id';


--
-- TOC entry 4301 (class 0 OID 0)
-- Dependencies: 229
-- Name: COLUMN uc_learner.ref_user_id; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.uc_learner.ref_user_id IS '使用者編號，對照 user.id';


--
-- TOC entry 4302 (class 0 OID 0)
-- Dependencies: 229
-- Name: COLUMN uc_learner.created_at; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.uc_learner.created_at IS '紀錄建立時間';


--
-- TOC entry 4303 (class 0 OID 0)
-- Dependencies: 229
-- Name: COLUMN uc_learner.created_by; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.uc_learner.created_by IS '紀錄者的帳號';


--
-- TOC entry 4304 (class 0 OID 0)
-- Dependencies: 229
-- Name: COLUMN uc_learner.seat_no; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.uc_learner.seat_no IS '座號';


--
-- TOC entry 4305 (class 0 OID 0)
-- Dependencies: 229
-- Name: COLUMN uc_learner.source_class; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.uc_learner.source_class IS '原始校務班級';


--
-- TOC entry 228 (class 1259 OID 288288)
-- Name: uc_learner_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.uc_learner_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.uc_learner_id_seq OWNER TO postgres;

--
-- TOC entry 4307 (class 0 OID 0)
-- Dependencies: 228
-- Name: uc_learner_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.uc_learner_id_seq OWNED BY public.uc_learner.id;


--
-- TOC entry 214 (class 1259 OID 288133)
-- Name: user; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."user" (
    id bigint NOT NULL,
    account character varying,
    name character varying,
    created_at timestamp with time zone DEFAULT now(),
    last_signin timestamp with time zone,
    auth_uuid character varying,
    current_class character varying
);


ALTER TABLE public."user" OWNER TO postgres;

--
-- TOC entry 4309 (class 0 OID 0)
-- Dependencies: 214
-- Name: TABLE "user"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public."user" IS '使用者';


--
-- TOC entry 4310 (class 0 OID 0)
-- Dependencies: 214
-- Name: COLUMN "user".id; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public."user".id IS '自動編號';


--
-- TOC entry 4311 (class 0 OID 0)
-- Dependencies: 214
-- Name: COLUMN "user".account; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public."user".account IS '帳號';


--
-- TOC entry 4312 (class 0 OID 0)
-- Dependencies: 214
-- Name: COLUMN "user".name; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public."user".name IS '姓名';


--
-- TOC entry 4313 (class 0 OID 0)
-- Dependencies: 214
-- Name: COLUMN "user".created_at; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public."user".created_at IS '建立時間';


--
-- TOC entry 4314 (class 0 OID 0)
-- Dependencies: 214
-- Name: COLUMN "user".last_signin; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public."user".last_signin IS '最後更新時間';


--
-- TOC entry 4315 (class 0 OID 0)
-- Dependencies: 214
-- Name: COLUMN "user".auth_uuid; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public."user".auth_uuid IS 'auth 的 uuid ';


--
-- TOC entry 4316 (class 0 OID 0)
-- Dependencies: 214
-- Name: COLUMN "user".current_class; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public."user".current_class IS '目前的校務班級';


--
-- TOC entry 213 (class 1259 OID 288132)
-- Name: user_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.user_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.user_id_seq OWNER TO postgres;

--
-- TOC entry 4318 (class 0 OID 0)
-- Dependencies: 213
-- Name: user_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.user_id_seq OWNED BY public."user".id;


--
-- TOC entry 216 (class 1259 OID 288144)
-- Name: user_role; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.user_role (
    id bigint NOT NULL,
    ref_user_id bigint,
    role_type character varying,
    name character varying,
    school_year integer,
    semester integer,
    school_dsns character varying,
    school_name character varying,
    schoo_type character varying,
    sso_detail jsonb,
    create_at timestamp with time zone DEFAULT now(),
    last_update timestamp with time zone DEFAULT now(),
    ref_school_id bigint,
    school_system_id bigint
);


ALTER TABLE public.user_role OWNER TO postgres;

--
-- TOC entry 4320 (class 0 OID 0)
-- Dependencies: 216
-- Name: TABLE user_role; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.user_role IS '使用者身份';


--
-- TOC entry 4321 (class 0 OID 0)
-- Dependencies: 216
-- Name: COLUMN user_role.id; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.user_role.id IS '自動編號';


--
-- TOC entry 4322 (class 0 OID 0)
-- Dependencies: 216
-- Name: COLUMN user_role.ref_user_id; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.user_role.ref_user_id IS '使用者編號';


--
-- TOC entry 4323 (class 0 OID 0)
-- Dependencies: 216
-- Name: COLUMN user_role.role_type; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.user_role.role_type IS '身份類別';


--
-- TOC entry 4324 (class 0 OID 0)
-- Dependencies: 216
-- Name: COLUMN user_role.name; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.user_role.name IS '姓名';


--
-- TOC entry 4325 (class 0 OID 0)
-- Dependencies: 216
-- Name: COLUMN user_role.school_year; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.user_role.school_year IS '學年度';


--
-- TOC entry 4326 (class 0 OID 0)
-- Dependencies: 216
-- Name: COLUMN user_role.semester; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.user_role.semester IS '學期';


--
-- TOC entry 4327 (class 0 OID 0)
-- Dependencies: 216
-- Name: COLUMN user_role.school_dsns; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.user_role.school_dsns IS '學校 DSNS';


--
-- TOC entry 4328 (class 0 OID 0)
-- Dependencies: 216
-- Name: COLUMN user_role.school_name; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.user_role.school_name IS '學校名稱';


--
-- TOC entry 4329 (class 0 OID 0)
-- Dependencies: 216
-- Name: COLUMN user_role.schoo_type; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.user_role.schoo_type IS '學校類型';


--
-- TOC entry 4330 (class 0 OID 0)
-- Dependencies: 216
-- Name: COLUMN user_role.sso_detail; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.user_role.sso_detail IS '身份詳細資訊';


--
-- TOC entry 4331 (class 0 OID 0)
-- Dependencies: 216
-- Name: COLUMN user_role.create_at; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.user_role.create_at IS '建立時間';


--
-- TOC entry 4332 (class 0 OID 0)
-- Dependencies: 216
-- Name: COLUMN user_role.last_update; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.user_role.last_update IS '最後更新時間';


--
-- TOC entry 4333 (class 0 OID 0)
-- Dependencies: 216
-- Name: COLUMN user_role.school_system_id; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.user_role.school_system_id IS '校務系統的系統編號。如果 role_type =''teacher''，則是校務的 teacher.id。 若 role_type=''student''，則對應校務的 student.id 。';


--
-- TOC entry 215 (class 1259 OID 288143)
-- Name: user_role_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.user_role_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.user_role_id_seq OWNER TO postgres;

--
-- TOC entry 4335 (class 0 OID 0)
-- Dependencies: 215
-- Name: user_role_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.user_role_id_seq OWNED BY public.user_role.id;


--
-- TOC entry 3915 (class 2604 OID 288334)
-- Name: assignment id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.assignment ALTER COLUMN id SET DEFAULT nextval('public.assignment_id_seq'::regclass);


--
-- TOC entry 3933 (class 2604 OID 345763)
-- Name: batch_proxy_submission id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.batch_proxy_submission ALTER COLUMN id SET DEFAULT nextval('public.proxy_submission_id_seq'::regclass);


--
-- TOC entry 3903 (class 2604 OID 288264)
-- Name: course id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.course ALTER COLUMN id SET DEFAULT nextval('public.course_id_seq'::regclass);


--
-- TOC entry 3937 (class 2604 OID 681639)
-- Name: final_report id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.final_report ALTER COLUMN id SET DEFAULT nextval('public.stud_final_report_id_seq'::regclass);


--
-- TOC entry 3886 (class 2604 OID 288116)
-- Name: login_history id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.login_history ALTER COLUMN id SET DEFAULT nextval('public.login_history_id_seq'::regclass);


--
-- TOC entry 3902 (class 2604 OID 288255)
-- Name: org id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.org ALTER COLUMN id SET DEFAULT nextval('public.org_id_seq'::regclass);


--
-- TOC entry 3909 (class 2604 OID 288302)
-- Name: org_admin id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.org_admin ALTER COLUMN id SET DEFAULT nextval('public.org_admin_id_seq'::regclass);


--
-- TOC entry 3888 (class 2604 OID 288126)
-- Name: school id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.school ALTER COLUMN id SET DEFAULT nextval('public.school_id_seq'::regclass);


--
-- TOC entry 3896 (class 2604 OID 288168)
-- Name: school_admin id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.school_admin ALTER COLUMN id SET DEFAULT nextval('public.school_admin_id_seq'::regclass);


--
-- TOC entry 3918 (class 2604 OID 288340)
-- Name: submission id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.submission ALTER COLUMN id SET DEFAULT nextval('public.submission_id_seq'::regclass);


--
-- TOC entry 3922 (class 2604 OID 288350)
-- Name: submission_feedback id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.submission_feedback ALTER COLUMN id SET DEFAULT nextval('public.submission_feedback_id_seq'::regclass);


--
-- TOC entry 3898 (class 2604 OID 288188)
-- Name: system_admin id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.system_admin ALTER COLUMN id SET DEFAULT nextval('public.system_admin_id_seq'::regclass);


--
-- TOC entry 3930 (class 2604 OID 288397)
-- Name: system_instruction id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.system_instruction ALTER COLUMN id SET DEFAULT nextval('public.prompt_id_seq'::regclass);


--
-- TOC entry 3911 (class 2604 OID 288323)
-- Name: task id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.task ALTER COLUMN id SET DEFAULT nextval('public.task_id_seq'::regclass);


--
-- TOC entry 3900 (class 2604 OID 288247)
-- Name: uc_instructor id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.uc_instructor ALTER COLUMN id SET DEFAULT nextval('public.uc_instructor_id_seq'::regclass);


--
-- TOC entry 3907 (class 2604 OID 288292)
-- Name: uc_learner id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.uc_learner ALTER COLUMN id SET DEFAULT nextval('public.uc_learner_id_seq'::regclass);


--
-- TOC entry 3891 (class 2604 OID 288136)
-- Name: user id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."user" ALTER COLUMN id SET DEFAULT nextval('public.user_id_seq'::regclass);


--
-- TOC entry 3893 (class 2604 OID 288147)
-- Name: user_role id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_role ALTER COLUMN id SET DEFAULT nextval('public.user_role_id_seq'::regclass);


--
-- TOC entry 3955 (class 2606 OID 288250)
-- Name: uc_instructor UQIX_INSTRUCTOR; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.uc_instructor
    ADD CONSTRAINT "UQIX_INSTRUCTOR" UNIQUE (ref_course_id, ref_user_id);


--
-- TOC entry 3967 (class 2606 OID 288297)
-- Name: uc_learner UQIX_LEARNER; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.uc_learner
    ADD CONSTRAINT "UQIX_LEARNER" UNIQUE (ref_course_id, ref_user_id);


--
-- TOC entry 3976 (class 2606 OID 288377)
-- Name: assignment assignment_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.assignment
    ADD CONSTRAINT assignment_pkey PRIMARY KEY (id);


--
-- TOC entry 3965 (class 2606 OID 288269)
-- Name: course course_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.course
    ADD CONSTRAINT course_pkey PRIMARY KEY (id);


--
-- TOC entry 3940 (class 2606 OID 288121)
-- Name: login_history login_history_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.login_history
    ADD CONSTRAINT login_history_pkey PRIMARY KEY (id);


--
-- TOC entry 3972 (class 2606 OID 288307)
-- Name: org_admin org_admin_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.org_admin
    ADD CONSTRAINT org_admin_pkey PRIMARY KEY (id);


--
-- TOC entry 3960 (class 2606 OID 288259)
-- Name: org org_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.org
    ADD CONSTRAINT org_pkey PRIMARY KEY (id);


--
-- TOC entry 3984 (class 2606 OID 288402)
-- Name: system_instruction prompt_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.system_instruction
    ADD CONSTRAINT prompt_pkey PRIMARY KEY (id);


--
-- TOC entry 3986 (class 2606 OID 345771)
-- Name: batch_proxy_submission proxy_submission_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.batch_proxy_submission
    ADD CONSTRAINT proxy_submission_pkey PRIMARY KEY (id);


--
-- TOC entry 3949 (class 2606 OID 288173)
-- Name: school_admin school_admin_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.school_admin
    ADD CONSTRAINT school_admin_pkey PRIMARY KEY (id);


--
-- TOC entry 3942 (class 2606 OID 288131)
-- Name: school school_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.school
    ADD CONSTRAINT school_pkey PRIMARY KEY (id);


--
-- TOC entry 3982 (class 2606 OID 288374)
-- Name: semesters semesters_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.semesters
    ADD CONSTRAINT semesters_pkey PRIMARY KEY (id);


--
-- TOC entry 3953 (class 2606 OID 288200)
-- Name: session session_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.session
    ADD CONSTRAINT session_pkey PRIMARY KEY (session_id);


--
-- TOC entry 3988 (class 2606 OID 681643)
-- Name: final_report stud_final_report_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.final_report
    ADD CONSTRAINT stud_final_report_pkey PRIMARY KEY (id);


--
-- TOC entry 3980 (class 2606 OID 288359)
-- Name: submission_feedback submission_feedback_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.submission_feedback
    ADD CONSTRAINT submission_feedback_pkey PRIMARY KEY (id);


--
-- TOC entry 3978 (class 2606 OID 288345)
-- Name: submission submission_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.submission
    ADD CONSTRAINT submission_pkey PRIMARY KEY (id);


--
-- TOC entry 3951 (class 2606 OID 288193)
-- Name: system_admin system_admin_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.system_admin
    ADD CONSTRAINT system_admin_pkey PRIMARY KEY (id);


--
-- TOC entry 3974 (class 2606 OID 288329)
-- Name: task task_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.task
    ADD CONSTRAINT task_pkey PRIMARY KEY (id);


--
-- TOC entry 3958 (class 2606 OID 288362)
-- Name: uc_instructor uc_instructor_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.uc_instructor
    ADD CONSTRAINT uc_instructor_pkey PRIMARY KEY (id);


--
-- TOC entry 3970 (class 2606 OID 288364)
-- Name: uc_learner uc_learner_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.uc_learner
    ADD CONSTRAINT uc_learner_pkey PRIMARY KEY (id);


--
-- TOC entry 3945 (class 2606 OID 288142)
-- Name: user user_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."user"
    ADD CONSTRAINT user_pkey PRIMARY KEY (id);


--
-- TOC entry 3947 (class 2606 OID 288153)
-- Name: user_role user_role_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_role
    ADD CONSTRAINT user_role_pkey PRIMARY KEY (id);


--
-- TOC entry 3961 (class 1259 OID 288270)
-- Name: IDX_Course_RefOrgID; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "IDX_Course_RefOrgID" ON public.course USING btree (ref_org_id);


--
-- TOC entry 3962 (class 1259 OID 288272)
-- Name: IDX_Course_RefSchoolID; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "IDX_Course_RefSchoolID" ON public.course USING btree (ref_school_id);


--
-- TOC entry 3963 (class 1259 OID 288271)
-- Name: IDX_Course_RefUserID; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "IDX_Course_RefUserID" ON public.course USING btree (ref_user_id);


--
-- TOC entry 3956 (class 1259 OID 288366)
-- Name: idx_uc_instructor_ref_user_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_uc_instructor_ref_user_id ON public.uc_instructor USING btree (ref_user_id);


--
-- TOC entry 3968 (class 1259 OID 288365)
-- Name: idx_uc_learner_ref_user_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_uc_learner_ref_user_id ON public.uc_learner USING btree (ref_user_id);


--
-- TOC entry 3943 (class 1259 OID 288367)
-- Name: idx_user_account; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_user_account ON public."user" USING btree (account);


--
-- TOC entry 4133 (class 0 OID 0)
-- Dependencies: 3
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: cloudsqlsuperuser
--

REVOKE ALL ON SCHEMA public FROM cloudsqladmin;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT ALL ON SCHEMA public TO cloudsqlsuperuser;
GRANT ALL ON SCHEMA public TO PUBLIC;


--
-- TOC entry 4134 (class 0 OID 0)
-- Dependencies: 261
-- Name: FUNCTION pg_replication_origin_advance(text, pg_lsn); Type: ACL; Schema: pg_catalog; Owner: cloudsqladmin
--

GRANT ALL ON FUNCTION pg_catalog.pg_replication_origin_advance(text, pg_lsn) TO cloudsqlsuperuser;


--
-- TOC entry 4135 (class 0 OID 0)
-- Dependencies: 249
-- Name: FUNCTION pg_replication_origin_create(text); Type: ACL; Schema: pg_catalog; Owner: cloudsqladmin
--

GRANT ALL ON FUNCTION pg_catalog.pg_replication_origin_create(text) TO cloudsqlsuperuser;


--
-- TOC entry 4136 (class 0 OID 0)
-- Dependencies: 250
-- Name: FUNCTION pg_replication_origin_drop(text); Type: ACL; Schema: pg_catalog; Owner: cloudsqladmin
--

GRANT ALL ON FUNCTION pg_catalog.pg_replication_origin_drop(text) TO cloudsqlsuperuser;


--
-- TOC entry 4137 (class 0 OID 0)
-- Dependencies: 251
-- Name: FUNCTION pg_replication_origin_oid(text); Type: ACL; Schema: pg_catalog; Owner: cloudsqladmin
--

GRANT ALL ON FUNCTION pg_catalog.pg_replication_origin_oid(text) TO cloudsqlsuperuser;


--
-- TOC entry 4138 (class 0 OID 0)
-- Dependencies: 252
-- Name: FUNCTION pg_replication_origin_progress(text, boolean); Type: ACL; Schema: pg_catalog; Owner: cloudsqladmin
--

GRANT ALL ON FUNCTION pg_catalog.pg_replication_origin_progress(text, boolean) TO cloudsqlsuperuser;


--
-- TOC entry 4139 (class 0 OID 0)
-- Dependencies: 253
-- Name: FUNCTION pg_replication_origin_session_is_setup(); Type: ACL; Schema: pg_catalog; Owner: cloudsqladmin
--

GRANT ALL ON FUNCTION pg_catalog.pg_replication_origin_session_is_setup() TO cloudsqlsuperuser;


--
-- TOC entry 4140 (class 0 OID 0)
-- Dependencies: 262
-- Name: FUNCTION pg_replication_origin_session_progress(boolean); Type: ACL; Schema: pg_catalog; Owner: cloudsqladmin
--

GRANT ALL ON FUNCTION pg_catalog.pg_replication_origin_session_progress(boolean) TO cloudsqlsuperuser;


--
-- TOC entry 4141 (class 0 OID 0)
-- Dependencies: 254
-- Name: FUNCTION pg_replication_origin_session_reset(); Type: ACL; Schema: pg_catalog; Owner: cloudsqladmin
--

GRANT ALL ON FUNCTION pg_catalog.pg_replication_origin_session_reset() TO cloudsqlsuperuser;


--
-- TOC entry 4142 (class 0 OID 0)
-- Dependencies: 255
-- Name: FUNCTION pg_replication_origin_session_setup(text); Type: ACL; Schema: pg_catalog; Owner: cloudsqladmin
--

GRANT ALL ON FUNCTION pg_catalog.pg_replication_origin_session_setup(text) TO cloudsqlsuperuser;


--
-- TOC entry 4143 (class 0 OID 0)
-- Dependencies: 256
-- Name: FUNCTION pg_replication_origin_xact_reset(); Type: ACL; Schema: pg_catalog; Owner: cloudsqladmin
--

GRANT ALL ON FUNCTION pg_catalog.pg_replication_origin_xact_reset() TO cloudsqlsuperuser;


--
-- TOC entry 4144 (class 0 OID 0)
-- Dependencies: 257
-- Name: FUNCTION pg_replication_origin_xact_setup(pg_lsn, timestamp with time zone); Type: ACL; Schema: pg_catalog; Owner: cloudsqladmin
--

GRANT ALL ON FUNCTION pg_catalog.pg_replication_origin_xact_setup(pg_lsn, timestamp with time zone) TO cloudsqlsuperuser;


--
-- TOC entry 4145 (class 0 OID 0)
-- Dependencies: 263
-- Name: FUNCTION pg_show_replication_origin_status(OUT local_id oid, OUT external_id text, OUT remote_lsn pg_lsn, OUT local_lsn pg_lsn); Type: ACL; Schema: pg_catalog; Owner: cloudsqladmin
--

GRANT ALL ON FUNCTION pg_catalog.pg_show_replication_origin_status(OUT local_id oid, OUT external_id text, OUT remote_lsn pg_lsn, OUT local_lsn pg_lsn) TO cloudsqlsuperuser;


--
-- TOC entry 4154 (class 0 OID 0)
-- Dependencies: 235
-- Name: TABLE assignment; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.assignment TO writing_mng;
GRANT SELECT ON TABLE public.assignment TO writing_showcase;


--
-- TOC entry 4156 (class 0 OID 0)
-- Dependencies: 234
-- Name: SEQUENCE assignment_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON SEQUENCE public.assignment_id_seq TO writing_mng;
GRANT SELECT ON SEQUENCE public.assignment_id_seq TO writing_showcase;


--
-- TOC entry 4161 (class 0 OID 0)
-- Dependencies: 244
-- Name: TABLE batch_proxy_submission; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.batch_proxy_submission TO writing_mng;
GRANT SELECT ON TABLE public.batch_proxy_submission TO writing_showcase;


--
-- TOC entry 4175 (class 0 OID 0)
-- Dependencies: 227
-- Name: TABLE course; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.course TO writing_mng WITH GRANT OPTION;
GRANT SELECT ON TABLE public.course TO writing_showcase;


--
-- TOC entry 4177 (class 0 OID 0)
-- Dependencies: 226
-- Name: SEQUENCE course_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON SEQUENCE public.course_id_seq TO writing_mng;
GRANT SELECT ON SEQUENCE public.course_id_seq TO writing_showcase;


--
-- TOC entry 4191 (class 0 OID 0)
-- Dependencies: 247
-- Name: TABLE final_report; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.final_report TO writing_mng;


--
-- TOC entry 4193 (class 0 OID 0)
-- Dependencies: 210
-- Name: TABLE login_history; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.login_history TO writing_mng WITH GRANT OPTION;
GRANT SELECT ON TABLE public.login_history TO writing_showcase;


--
-- TOC entry 4195 (class 0 OID 0)
-- Dependencies: 209
-- Name: SEQUENCE login_history_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON SEQUENCE public.login_history_id_seq TO writing_mng;
GRANT SELECT ON SEQUENCE public.login_history_id_seq TO writing_showcase;


--
-- TOC entry 4199 (class 0 OID 0)
-- Dependencies: 225
-- Name: TABLE org; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.org TO writing_mng;
GRANT SELECT ON TABLE public.org TO writing_showcase;


--
-- TOC entry 4208 (class 0 OID 0)
-- Dependencies: 231
-- Name: TABLE org_admin; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.org_admin TO writing_mng WITH GRANT OPTION;
GRANT SELECT ON TABLE public.org_admin TO writing_showcase;


--
-- TOC entry 4210 (class 0 OID 0)
-- Dependencies: 230
-- Name: SEQUENCE org_admin_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON SEQUENCE public.org_admin_id_seq TO writing_mng;
GRANT SELECT ON SEQUENCE public.org_admin_id_seq TO writing_showcase;


--
-- TOC entry 4212 (class 0 OID 0)
-- Dependencies: 224
-- Name: SEQUENCE org_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON SEQUENCE public.org_id_seq TO writing_mng;
GRANT SELECT ON SEQUENCE public.org_id_seq TO writing_showcase;


--
-- TOC entry 4214 (class 0 OID 0)
-- Dependencies: 243
-- Name: TABLE system_instruction; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.system_instruction TO writing_mng;
GRANT SELECT ON TABLE public.system_instruction TO writing_showcase;


--
-- TOC entry 4216 (class 0 OID 0)
-- Dependencies: 242
-- Name: SEQUENCE prompt_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON SEQUENCE public.prompt_id_seq TO writing_mng;
GRANT SELECT ON SEQUENCE public.prompt_id_seq TO writing_showcase;


--
-- TOC entry 4218 (class 0 OID 0)
-- Dependencies: 245
-- Name: SEQUENCE proxy_submission_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON SEQUENCE public.proxy_submission_id_seq TO writing_mng;
GRANT SELECT ON SEQUENCE public.proxy_submission_id_seq TO writing_showcase;


--
-- TOC entry 4225 (class 0 OID 0)
-- Dependencies: 212
-- Name: TABLE school; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.school TO writing_mng WITH GRANT OPTION;
GRANT SELECT ON TABLE public.school TO writing_showcase;


--
-- TOC entry 4234 (class 0 OID 0)
-- Dependencies: 218
-- Name: TABLE school_admin; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.school_admin TO writing_mng WITH GRANT OPTION;
GRANT SELECT ON TABLE public.school_admin TO writing_showcase;


--
-- TOC entry 4236 (class 0 OID 0)
-- Dependencies: 217
-- Name: SEQUENCE school_admin_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON SEQUENCE public.school_admin_id_seq TO writing_mng;
GRANT SELECT ON SEQUENCE public.school_admin_id_seq TO writing_showcase;


--
-- TOC entry 4238 (class 0 OID 0)
-- Dependencies: 211
-- Name: SEQUENCE school_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON SEQUENCE public.school_id_seq TO writing_mng;
GRANT SELECT ON SEQUENCE public.school_id_seq TO writing_showcase;


--
-- TOC entry 4239 (class 0 OID 0)
-- Dependencies: 240
-- Name: SEQUENCE semesters_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON SEQUENCE public.semesters_id_seq TO writing_mng;
GRANT SELECT ON SEQUENCE public.semesters_id_seq TO writing_showcase;


--
-- TOC entry 4240 (class 0 OID 0)
-- Dependencies: 241
-- Name: TABLE semesters; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.semesters TO writing_mng;
GRANT SELECT ON TABLE public.semesters TO writing_showcase;


--
-- TOC entry 4241 (class 0 OID 0)
-- Dependencies: 221
-- Name: TABLE session; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.session TO writing_mng WITH GRANT OPTION;
GRANT SELECT ON TABLE public.session TO writing_showcase;


--
-- TOC entry 4243 (class 0 OID 0)
-- Dependencies: 246
-- Name: SEQUENCE stud_final_report_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON SEQUENCE public.stud_final_report_id_seq TO writing_mng;


--
-- TOC entry 4251 (class 0 OID 0)
-- Dependencies: 237
-- Name: TABLE submission; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.submission TO writing_mng;
GRANT SELECT ON TABLE public.submission TO writing_showcase;


--
-- TOC entry 4265 (class 0 OID 0)
-- Dependencies: 238
-- Name: TABLE submission_feedback; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.submission_feedback TO writing_mng;
GRANT SELECT ON TABLE public.submission_feedback TO writing_showcase;


--
-- TOC entry 4267 (class 0 OID 0)
-- Dependencies: 239
-- Name: SEQUENCE submission_feedback_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON SEQUENCE public.submission_feedback_id_seq TO writing_mng;
GRANT SELECT ON SEQUENCE public.submission_feedback_id_seq TO writing_showcase;


--
-- TOC entry 4269 (class 0 OID 0)
-- Dependencies: 236
-- Name: SEQUENCE submission_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON SEQUENCE public.submission_id_seq TO writing_mng;
GRANT SELECT ON SEQUENCE public.submission_id_seq TO writing_showcase;


--
-- TOC entry 4271 (class 0 OID 0)
-- Dependencies: 220
-- Name: TABLE system_admin; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.system_admin TO writing_mng WITH GRANT OPTION;
GRANT SELECT ON TABLE public.system_admin TO writing_showcase;


--
-- TOC entry 4273 (class 0 OID 0)
-- Dependencies: 219
-- Name: SEQUENCE system_admin_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON SEQUENCE public.system_admin_id_seq TO writing_mng;
GRANT SELECT ON SEQUENCE public.system_admin_id_seq TO writing_showcase;


--
-- TOC entry 4287 (class 0 OID 0)
-- Dependencies: 233
-- Name: TABLE task; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.task TO writing_mng;
GRANT SELECT ON TABLE public.task TO writing_showcase;


--
-- TOC entry 4289 (class 0 OID 0)
-- Dependencies: 232
-- Name: SEQUENCE task_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON SEQUENCE public.task_id_seq TO writing_mng;
GRANT SELECT ON SEQUENCE public.task_id_seq TO writing_showcase;


--
-- TOC entry 4296 (class 0 OID 0)
-- Dependencies: 223
-- Name: TABLE uc_instructor; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.uc_instructor TO writing_mng;
GRANT SELECT ON TABLE public.uc_instructor TO writing_showcase;


--
-- TOC entry 4298 (class 0 OID 0)
-- Dependencies: 222
-- Name: SEQUENCE uc_instructor_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON SEQUENCE public.uc_instructor_id_seq TO writing_mng;
GRANT SELECT ON SEQUENCE public.uc_instructor_id_seq TO writing_showcase;


--
-- TOC entry 4306 (class 0 OID 0)
-- Dependencies: 229
-- Name: TABLE uc_learner; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.uc_learner TO writing_mng;
GRANT SELECT ON TABLE public.uc_learner TO writing_showcase;


--
-- TOC entry 4308 (class 0 OID 0)
-- Dependencies: 228
-- Name: SEQUENCE uc_learner_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON SEQUENCE public.uc_learner_id_seq TO writing_mng;
GRANT SELECT ON SEQUENCE public.uc_learner_id_seq TO writing_showcase;


--
-- TOC entry 4317 (class 0 OID 0)
-- Dependencies: 214
-- Name: TABLE "user"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public."user" TO writing_mng WITH GRANT OPTION;
GRANT SELECT ON TABLE public."user" TO writing_showcase;


--
-- TOC entry 4319 (class 0 OID 0)
-- Dependencies: 213
-- Name: SEQUENCE user_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON SEQUENCE public.user_id_seq TO writing_mng;
GRANT SELECT ON SEQUENCE public.user_id_seq TO writing_showcase;


--
-- TOC entry 4334 (class 0 OID 0)
-- Dependencies: 216
-- Name: TABLE user_role; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.user_role TO writing_mng WITH GRANT OPTION;
GRANT SELECT ON TABLE public.user_role TO writing_showcase;


--
-- TOC entry 4336 (class 0 OID 0)
-- Dependencies: 215
-- Name: SEQUENCE user_role_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON SEQUENCE public.user_role_id_seq TO writing_mng;
GRANT SELECT ON SEQUENCE public.user_role_id_seq TO writing_showcase;


-- Completed on 2026-09-16 10:45:51 CST

--
-- PostgreSQL database dump complete
--

