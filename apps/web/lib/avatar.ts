/**
 * 頭像：預先配好的造型（男、女各五個），在個人設定裡挑。學生、老師各一組。
 *
 * 以前頭像是拿姓名當 DiceBear 的 seed 隨機產生的，髮型也是隨機 ——
 * 抽到沒有頭髮的就是光頭，換不掉。現在每個造型都指定了髮型、
 * 髮色、衣服，沒有隨機成分。
 *
 * ⚠️ **選擇只記在這台裝置的瀏覽器裡（localStorage）。**
 *    資料庫的 user 表沒有可以放頭像的欄位，而這次的前提是不改資料庫。
 *    換一台電腦或手機登入時會回到預設造型，要再選一次。
 *    要跨裝置記住，得在 user 表加一欄（例如 avatar varchar），再由後端讀寫。
 */

import { useCallback, useState } from 'react';

/** 學生用一組、老師用一組：老師的是西裝外套、襯衫，學生的是帽 T、吊帶褲 */
export type AvatarAudience = 'student' | 'teacher';

export type AvatarGroup = 'male' | 'female';

export interface AvatarPreset {
  id: string;
  group: AvatarGroup;
  /** DiceBear avataaars 的參數。全部指定，不留隨機 */
  params: Record<string, string>;
}

/** 每個造型共用的設定：不要鬍子、眉毛自然 */
const BASE = {
  facialHairProbability: '0',
  eyebrows: 'defaultNatural',
  accessoriesProbability: '0',
};

const preset = (id: string, group: AvatarGroup, params: Record<string, string>): AvatarPreset => ({
  id,
  group,
  params: { ...BASE, ...params },
});

/*
  以台灣使用者的樣子為主：膚色只用兩個偏淺的暖色（ffdbb4、edb98a），
  髮色只用黑與深褐（2c1b18、4a312c），髮型都是直髮或微捲的常見款。
  DiceBear 的參數值要用它給的清單，打錯整張圖會回 400 —— 改了之後要實際開網址看一次。

  id 一旦上線就不要改：已經選過的人存的是 id，改了會退回預設造型。
*/
export const AVATAR_SETS: Record<AvatarAudience, AvatarPreset[]> = {
  student: [
    preset('boy-1', 'male', { top: 'shortFlat', hairColor: '2c1b18', skinColor: 'ffdbb4', clothing: 'hoodie', clothesColor: '65c9ff', eyes: 'happy', mouth: 'smile', backgroundColor: 'b6e3f4' }),
    preset('boy-2', 'male', { top: 'shortRound', hairColor: '2c1b18', skinColor: 'edb98a', clothing: 'shirtCrewNeck', clothesColor: '5199e4', eyes: 'default', mouth: 'smile', backgroundColor: 'c0aede' }),
    preset('boy-3', 'male', { top: 'shaggy', hairColor: '4a312c', skinColor: 'ffdbb4', clothing: 'collarAndSweater', clothesColor: 'a7ffc4', eyes: 'wink', mouth: 'twinkle', backgroundColor: 'd1d4f9' }),
    preset('boy-4', 'male', { top: 'shortWaved', hairColor: '2c1b18', skinColor: 'edb98a', clothing: 'graphicShirt', clothesColor: 'ff5c5c', eyes: 'default', mouth: 'smile', accessories: 'prescription02', accessoriesProbability: '100', backgroundColor: 'ffdfbf' }),
    preset('boy-5', 'male', { top: 'shortCurly', hairColor: '2c1b18', skinColor: 'ffdbb4', clothing: 'overall', clothesColor: '25557c', eyes: 'happy', mouth: 'smile', backgroundColor: 'ffd5dc' }),
    preset('girl-1', 'female', { top: 'straight01', hairColor: '2c1b18', skinColor: 'ffdbb4', clothing: 'shirtScoopNeck', clothesColor: 'ffafb9', eyes: 'happy', mouth: 'smile', backgroundColor: 'ffd5dc' }),
    preset('girl-2', 'female', { top: 'bob', hairColor: '2c1b18', skinColor: 'edb98a', clothing: 'hoodie', clothesColor: 'ffffb1', eyes: 'default', mouth: 'smile', backgroundColor: 'b6e3f4' }),
    preset('girl-3', 'female', { top: 'miaWallace', hairColor: '4a312c', skinColor: 'ffdbb4', clothing: 'collarAndSweater', clothesColor: 'b1e2ff', eyes: 'wink', mouth: 'twinkle', backgroundColor: 'ffdfbf' }),
    preset('girl-4', 'female', { top: 'straightAndStrand', hairColor: '2c1b18', skinColor: 'edb98a', clothing: 'shirtVNeck', clothesColor: 'ff488e', eyes: 'happy', mouth: 'smile', accessories: 'round', accessoriesProbability: '100', backgroundColor: 'c0aede' }),
    preset('girl-5', 'female', { top: 'straight02', hairColor: '4a312c', skinColor: 'ffdbb4', clothing: 'blazerAndShirt', clothesColor: '3c4f5c', eyes: 'default', mouth: 'smile', backgroundColor: 'd1d4f9' }),
  ],
  // 老師：同樣的膚色、髮色範圍，衣服換成西裝外套、襯衫、針織衫，多兩副眼鏡
  teacher: [
    preset('t-male-1', 'male', { top: 'shortFlat', hairColor: '2c1b18', skinColor: 'ffdbb4', clothing: 'blazerAndShirt', clothesColor: '25557c', eyes: 'default', mouth: 'smile', backgroundColor: 'b6e3f4' }),
    preset('t-male-2', 'male', { top: 'shortRound', hairColor: '2c1b18', skinColor: 'edb98a', clothing: 'collarAndSweater', clothesColor: '5199e4', eyes: 'happy', mouth: 'smile', accessories: 'prescription01', accessoriesProbability: '100', backgroundColor: 'd1d4f9' }),
    preset('t-male-3', 'male', { top: 'shortWaved', hairColor: '4a312c', skinColor: 'ffdbb4', clothing: 'blazerAndSweater', clothesColor: '3c4f5c', eyes: 'default', mouth: 'smile', backgroundColor: 'ffdfbf' }),
    preset('t-male-4', 'male', { top: 'shaggy', hairColor: '2c1b18', skinColor: 'edb98a', clothing: 'shirtCrewNeck', clothesColor: '65c9ff', eyes: 'happy', mouth: 'smile', accessories: 'round', accessoriesProbability: '100', backgroundColor: 'c0aede' }),
    preset('t-male-5', 'male', { top: 'shortCurly', hairColor: '4a312c', skinColor: 'ffdbb4', clothing: 'blazerAndShirt', clothesColor: '262e33', eyes: 'default', mouth: 'twinkle', backgroundColor: 'ffd5dc' }),
    preset('t-female-1', 'female', { top: 'straight01', hairColor: '2c1b18', skinColor: 'ffdbb4', clothing: 'blazerAndShirt', clothesColor: 'ffafb9', eyes: 'happy', mouth: 'smile', backgroundColor: 'ffd5dc' }),
    preset('t-female-2', 'female', { top: 'bob', hairColor: '4a312c', skinColor: 'edb98a', clothing: 'collarAndSweater', clothesColor: 'b1e2ff', eyes: 'default', mouth: 'smile', accessories: 'prescription02', accessoriesProbability: '100', backgroundColor: 'b6e3f4' }),
    preset('t-female-3', 'female', { top: 'miaWallace', hairColor: '2c1b18', skinColor: 'ffdbb4', clothing: 'blazerAndSweater', clothesColor: '3c4f5c', eyes: 'default', mouth: 'smile', backgroundColor: 'ffdfbf' }),
    preset('t-female-4', 'female', { top: 'straightAndStrand', hairColor: '4a312c', skinColor: 'edb98a', clothing: 'shirtScoopNeck', clothesColor: 'ff488e', eyes: 'happy', mouth: 'smile', accessories: 'round', accessoriesProbability: '100', backgroundColor: 'c0aede' }),
    preset('t-female-5', 'female', { top: 'longButNotTooLong', hairColor: '2c1b18', skinColor: 'ffdbb4', clothing: 'shirtVNeck', clothesColor: 'a7ffc4', eyes: 'default', mouth: 'twinkle', backgroundColor: 'd1d4f9' }),
  ],
};

export const AVATAR_GROUP_LABEL: Record<AvatarAudience, Record<AvatarGroup, string>> = {
  student: { male: '男生', female: '女生' },
  teacher: { male: '男老師', female: '女老師' },
};

/** 造型的圖片網址。seed 固定，同一個造型每次都長一樣 */
export function avatarUrl(p: AvatarPreset): string {
  const q = new URLSearchParams({ seed: 'udn', ...p.params });
  return `https://api.dicebear.com/7.x/avataaars/svg?${q.toString()}`;
}

/**
 * 還沒選過時用哪一個：依使用者 id 固定挑一個。
 * 同一個人每次都一樣，也保證不會是光頭（每個造型都有頭髮）。
 */
export function defaultAvatar(userKey: string, audience: AvatarAudience): AvatarPreset {
  const set = AVATAR_SETS[audience];
  let h = 0;
  for (let i = 0; i < userKey.length; i++) h = (h * 31 + userKey.charCodeAt(i)) >>> 0;
  return set[h % set.length];
}

/** 學生、老師分開存 —— 同一個帳號兩種身分都有時，兩邊各選各的 */
const storageKey = (userKey: string, audience: AvatarAudience) =>
  `udn.avatar.${audience}.${userKey}`;

/**
 * 這個人選過的造型。沒選過、存的 id 已經不存在、或瀏覽器擋了 localStorage
 * （無痕模式、清掉網站資料）時，退回 defaultAvatar —— 頭像一定畫得出來。
 */
export function loadAvatar(userKey: string, audience: AvatarAudience): AvatarPreset {
  try {
    const id = window.localStorage.getItem(storageKey(userKey, audience));
    const found = AVATAR_SETS[audience].find((p) => p.id === id);
    if (found) return found;
  } catch {
    // 讀不到就用預設
  }
  return defaultAvatar(userKey, audience);
}

function saveAvatar(userKey: string, audience: AvatarAudience, id: string): void {
  try {
    window.localStorage.setItem(storageKey(userKey, audience), id);
  } catch {
    // 存不了（無痕模式等）就只在這次開著的期間有效
  }
}

/**
 * 頭像的 state。key 用 user.id —— 同一台電腦多人輪流登入時各記各的。
 * 換人登入（userKey 變了）時重新讀一次。
 */
export function useAvatar(
  userKey: string,
  audience: AvatarAudience,
): [AvatarPreset, (id: string) => void] {
  const stateKey = `${audience}:${userKey}`;
  const [state, setState] = useState(() => ({ key: stateKey, preset: loadAvatar(userKey, audience) }));
  // render 階段依 prop 調整 state（React 官方寫法），不用 effect 同步
  let current = state;
  if (state.key !== stateKey) {
    current = { key: stateKey, preset: loadAvatar(userKey, audience) };
    setState(current);
  }
  const choose = useCallback(
    (id: string) => {
      const p = AVATAR_SETS[audience].find((x) => x.id === id);
      if (!p) return;
      saveAvatar(userKey, audience, id);
      setState({ key: `${audience}:${userKey}`, preset: p });
    },
    [userKey, audience],
  );
  return [current.preset, choose];
}
