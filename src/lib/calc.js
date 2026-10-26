// 金額欄の計算 (レシートが複数あるとき: 1200+850+300 など)。eval は使わない。

/** 入力できる文字だけにそろえる (全角・× ÷ の別表記・カンマを吸収) */
export function cleanExpr(s) {
  return String(s)
    .normalize('NFKC')
    .replace(/[*xX]/g, '×')
    .replace(/\//g, '÷')
    .replace(/[−ー‐-―]/g, '-')
    .replace(/[^\d.+\-×÷()]/g, '')
    .slice(0, 80);
}

/** 式を計算する。計算できない式 (途中の「100+」や 0 での割り算) は null */
export function evalExpr(input) {
  const s = cleanExpr(input);
  if (!s) return null;
  let i = 0;
  const peek = () => s[i];
  function number() {
    const m = /^\d*\.?\d*/.exec(s.slice(i))[0];
    if (!m || m === '.') throw new Error('num');
    i += m.length;
    return Number(m);
  }
  function factor() {
    if (peek() === '-') { i++; return -factor(); }
    if (peek() === '+') { i++; return factor(); }
    if (peek() === '(') {
      i++;
      const v = expr();
      if (peek() !== ')') throw new Error('paren');
      i++;
      return v;
    }
    return number();
  }
  function term() {
    let v = factor();
    while (peek() === '×' || peek() === '÷') {
      const op = s[i++];
      const r = factor();
      if (op === '÷') { if (r === 0) throw new Error('div0'); v /= r; } else v *= r;
    }
    return v;
  }
  function expr() {
    let v = term();
    while (peek() === '+' || peek() === '-') v = s[i++] === '+' ? v + term() : v - term();
    return v;
  }
  try {
    const v = expr();
    return i === s.length && Number.isFinite(v) ? v : null;
  } catch { return null; }
}

/** 式に演算子があるか (数字だけなら計算結果の表示は不要) */
export const hasOperator = (s) => /[+\-×÷()]/.test(cleanExpr(s).replace(/^-/, ''));
