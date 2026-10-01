import type { CampusIdentity } from './portfolio_identity';

/**
 * 家長 → 子女。**預留的接口，還沒有接上。**
 *
 * 使用者說明（2026-10-01）：1Campus 會提供家長身分，並且已經與子女完成綁定。
 * 但目前這個系統登入時拿到的 userinfo（scope：User.Mail,User.BasicInfo,User.Application）
 * 只有 mail、uuid、姓名，沒有家長資料；要哪一支 API、哪個 scope、回傳長什麼樣子，
 * 還沒有文件。**不要用猜的接** —— 接錯就是家長看到別人小孩的作品。
 *
 * 拿到 1Campus 的文件後，實作 childrenOf()：回傳這位家長的子女在這個系統的帳號
 * （"user".account，也就是子女的 1Campus mail）。routes/portfolio.ts 的家長端點
 * 已經寫好權限檢查，只差這一支。
 */
export interface ParentLinkResolver {
  /** 還沒接上時是 false，家長端點回 501 */
  readonly available: boolean;
  /** 這位家長的子女帳號。不是家長回傳空陣列 */
  childrenOf(parent: CampusIdentity, accessToken: string): Promise<string[]>;
}

export const notConfiguredParentLinks: ParentLinkResolver = {
  available: false,
  async childrenOf() {
    return [];
  },
};

/** 測試可以換掉（setParentLinkResolver），正式環境等 1Campus 的文件 */
let current: ParentLinkResolver = notConfiguredParentLinks;

export const parentLinks = (): ParentLinkResolver => current;

export function setParentLinkResolver(resolver: ParentLinkResolver): void {
  current = resolver;
}
