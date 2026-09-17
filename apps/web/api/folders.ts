import { api } from './client';
import { QuestionType, type Folder } from '@udn/shared';

interface RawFolder {
  id: string;
  name: string;
  ref_parent_id: string | null;
  shared: boolean | null;
}

/**
 * 資料夾的可視範圍與題目**完全一致**（自己的 + 組織共享）。
 * 兩邊規則一致，才不會出現「看得到題目卻看不到它的資料夾」。
 */
function toFolder(r: RawFolder): Folder {
  return {
    id: String(r.id),
    name: r.name ?? '',
    parentId: r.ref_parent_id != null ? String(r.ref_parent_id) : null,
    type: r.shared ? QuestionType.SHARED : QuestionType.PERSONAL,
  };
}

export async function fetchFolders(): Promise<Folder[]> {
  const rows = await api.get<RawFolder[]>('/service/instructor/folders');
  return rows.map(toFolder);
}

export async function createFolder(
  name: string, parentId: string | null, type: QuestionType,
): Promise<Folder> {
  const row = await api.post<RawFolder>('/service/instructor/folders', {
    name, parentId, shared: type === QuestionType.SHARED,
  });
  return toFolder(row);
}

export async function renameFolder(id: string, name: string, parentId: string | null): Promise<void> {
  await api.put(`/service/instructor/folders/${id}`, { name, parentId });
}

/**
 * 刪除資料夾。
 *
 * 子資料夾由資料庫的外鍵連帶清掉；**底下的題目會退回上一層**，不會跟著消失
 * —— 老師刪的是分類，不是題目本身（後端 FolderHelper.deleteById 用一個交易做完）。
 */
export async function deleteFolder(id: string): Promise<void> {
  await api.del(`/service/instructor/folders/${id}`);
}
