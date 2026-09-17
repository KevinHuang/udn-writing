import { api } from './client';
import { toSemester, type Semester } from '../lib/semester';

interface RawSemester {
  school_year: number;
  semester: number;
  start_date: string;
  end_date: string;
}

export interface Semesters {
  options: Semester[];
  /** 今天落在哪一個學年期。理論上一定有（區間是連續的），但仍可能是 null */
  current: Semester | null;
}

export async function fetchSemesters(): Promise<Semesters> {
  const raw = await api.get<{ semesters: RawSemester[]; current: RawSemester | null }>(
    '/service/semesters',
  );
  return {
    options: raw.semesters.map((s) => toSemester(s.school_year, s.semester)),
    current: raw.current ? toSemester(raw.current.school_year, raw.current.semester) : null,
  };
}
