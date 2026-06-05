/** CRANK-A, CRANK-B, … (0-indexed, Excel 열 방식) */
export function crankLetterLabel(index: number): string {
  let n = index + 1;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return `CRANK-${s}`;
}
