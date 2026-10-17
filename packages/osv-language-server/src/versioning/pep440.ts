import { clean, compare, major, valid } from "@renovatebot/pep440";
import type { Comparator } from "./types.js";

export const pep440Comparator: Comparator = {
  isValid: (v) => valid(v) !== null,
  compare: (a, b) => compare(a, b),
  normalize: (v) => clean(v) ?? v,
  major: (v) => major(v),
};
