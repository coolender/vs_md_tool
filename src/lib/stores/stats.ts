/**
 * 字数 / 字符 / 阅读时间统计。
 * 由活动标签内容派生，纯前端计算，无 IO。
 *
 * - 中文字符按 1 字计
 * - 英文按"词"计（连续字母数字为一个词）
 * - 阅读时间：中文 300 字/分，英文 200 词/分（粗略平均）
 */
import { derived } from "svelte/store";
import { doc } from "./doc.ts";

export interface Stats {
  chars: number; // 总字符数（含空格）
  charsNoSpaces: number; // 不含空格
  words: number; // "字数"：中文按字 + 英文按词
  lines: number;
  readingMinutes: number; // 预计阅读分钟（向上取整）
}

function compute(text: string): Stats {
  const chars = text.length;
  const charsNoSpaces = text.replace(/\s/g, "").length;
  const lines = text === "" ? 0 : text.split(/\r\n|\r|\n/).length;

  // 中文字符数
  const cjk = (text.match(/[一-鿿㐀-䶿]/g) ?? []).length;
  // 英文词数（连续英文字母/数字/下划线为一个词）
  const enWords = (text.match(/[A-Za-z0-9]+(?:[''-][A-Za-z0-9]+)*/g) ?? []).length;
  const words = cjk + enWords;

  // 阅读速度：中文 300/分，英文 200/分，混合取加权平均
  const cjkMins = cjk / 300;
  const enMins = enWords / 200;
  const readingMinutes = Math.max(1, Math.ceil(cjkMins + enMins));

  return { chars, charsNoSpaces, words, lines, readingMinutes };
}

export const stats = derived<typeof doc, Stats>(doc, ($d) => compute($d.content));
