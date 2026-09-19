/**
 * 頭像的造型（lib/avatar.ts）。學生、老師各一組。
 *
 * 以前頭像的髮型是隨機的，會抽到光頭。這裡釘住：
 * 每組男女各五個、每個都指定了髮型，沒選過時的預設也一定是那一組之一。
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  AVATAR_SETS,
  avatarUrl,
  defaultAvatar,
  loadAvatar,
  type AvatarAudience,
} from "../lib/avatar";

const AUDIENCES: AvatarAudience[] = ["student", "teacher"];

for (const audience of AUDIENCES) {
  const set = AVATAR_SETS[audience];

  describe(`頭像造型（${audience}）`, () => {
    test("男、女各 5 個，id 不重複", () => {
      assert.equal(set.filter((p) => p.group === "male").length, 5);
      assert.equal(set.filter((p) => p.group === "female").length, 5);
      assert.equal(new Set(set.map((p) => p.id)).size, 10);
    });

    test("每個造型都指定了髮型，而且不長鬍子（不留隨機，不會抽到光頭）", () => {
      for (const p of set) {
        assert.ok(p.params.top, `${p.id} 沒有指定髮型`);
        assert.equal(p.params.facialHairProbability, "0");
        assert.match(avatarUrl(p), /[?&]top=/);
      }
    });

    test("以台灣使用者的樣子為主：膚色偏淺暖色、髮色黑或深褐", () => {
      for (const p of set) {
        assert.ok(["ffdbb4", "edb98a"].includes(p.params.skinColor), `${p.id} 膚色 ${p.params.skinColor}`);
        assert.ok(["2c1b18", "4a312c"].includes(p.params.hairColor), `${p.id} 髮色 ${p.params.hairColor}`);
      }
    });

    test("沒選過時，同一個人的預設造型每次都一樣，而且是這一組的", () => {
      assert.equal(defaultAvatar("12345", audience).id, defaultAvatar("12345", audience).id);
      assert.ok(set.includes(defaultAvatar("", audience)));
    });

    test("讀不到儲存（沒有瀏覽器、無痕模式）時退回預設，不會丟錯", () => {
      assert.equal(loadAvatar("12345", audience).id, defaultAvatar("12345", audience).id);
    });
  });
}

test("學生與老師兩組的 id 不重疊（分開存，但 id 撞了會讓人看不出是哪一組）", () => {
  const ids = [...AVATAR_SETS.student, ...AVATAR_SETS.teacher].map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length);
});
