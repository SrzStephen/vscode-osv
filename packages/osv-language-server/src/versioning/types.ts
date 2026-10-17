export interface Comparator {
  isValid(v: string): boolean;
  compare(a: string, b: string): number;
  normalize(v: string): string;
  major(v: string): number;
}
