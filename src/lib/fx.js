// 外貨での入力: 通貨の一覧 / 為替レートの取得 / 円への換算

/** hist: 日付ごとの過去レートが取れる通貨 (欧州中央銀行の参考レート)。それ以外は最新レートのみ */
export const CURRENCIES = [
  { code: 'USD', name: '米ドル', sym: '$', hist: true },
  { code: 'EUR', name: 'ユーロ', sym: '€', hist: true },
  { code: 'GBP', name: '英ポンド', sym: '£', hist: true },
  { code: 'KRW', name: '韓国ウォン', sym: '₩', hist: true },
  { code: 'CNY', name: '中国元', sym: '元', hist: true },
  { code: 'TWD', name: '台湾ドル', sym: 'NT$', hist: false },
  { code: 'HKD', name: '香港ドル', sym: 'HK$', hist: true },
  { code: 'THB', name: 'タイバーツ', sym: '฿', hist: true },
  { code: 'SGD', name: 'シンガポールドル', sym: 'S$', hist: true },
  { code: 'AUD', name: '豪ドル', sym: 'A$', hist: true },
  { code: 'NZD', name: 'NZドル', sym: 'NZ$', hist: true },
  { code: 'CAD', name: 'カナダドル', sym: 'C$', hist: true },
  { code: 'CHF', name: 'スイスフラン', sym: 'CHF', hist: true },
  { code: 'MYR', name: 'マレーシアリンギット', sym: 'RM', hist: true },
  { code: 'PHP', name: 'フィリピンペソ', sym: '₱', hist: true },
  { code: 'IDR', name: 'インドネシアルピア', sym: 'Rp', hist: true },
  { code: 'INR', name: 'インドルピー', sym: '₹', hist: true },
  { code: 'VND', name: 'ベトナムドン', sym: '₫', hist: false },
];
export const currencyOf = (code) => CURRENCIES.find((c) => c.code === code);

/** 外貨の金額 (小数2桁まで) とレート (円/1単位) から円へ。四捨五入 */
export const toYen = (amt, rate) => Math.round(Number(amt) * Number(rate));
/** レートは有効数字6桁に丸める */
export const roundRate = (r) => Number(Number(r).toPrecision(6));

/** 入力欄の文字を「数字と小数点1つ、小数2桁まで」に整える */
export function cleanDecimal(s) {
  const t = String(s).replace(/[^\d.]/g, '');
  const i = t.indexOf('.');
  if (i < 0) return t;
  return t.slice(0, i + 1) + t.slice(i + 1).replace(/\./g, '').slice(0, 2);
}

/** 記録に添える表示 (例: "$25.50") */
export function fxText(fx) {
  if (!fx || !fx.cur) return '';
  const c = currencyOf(fx.cur);
  const n = Number(fx.amt).toLocaleString('en-US', { maximumFractionDigits: 2 });
  return c && c.sym.length <= 3 && c.code !== 'CHF' ? `${c.sym}${n}` : `${fx.cur} ${n}`;
}

const getJson = async (url, f) => {
  const res = await f(url);
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
};

/**
 * 1単位あたりの円のレートを取る。日付が今日より前なら、その日 (休日なら直前の営業日) のレート。
 * 取れなければ null (手入力にする)。
 * f / todayStr は差し替え用 (テスト)。
 */
export async function fetchRate(cur, date, todayStr, f = fetch) {
  const c = currencyOf(cur);
  if (!c) return null;
  try {
    if (c.hist) {
      const path = date && date < todayStr ? date : 'latest';
      const j = await getJson(`https://api.frankfurter.dev/v1/${path}?base=${cur}&symbols=JPY`, f);
      const r = j?.rates?.JPY;
      if (r > 0) return { rate: roundRate(r), exact: path !== 'latest' };
    }
  } catch { /* 次の手段へ */ }
  try {
    const j = await getJson(`https://open.er-api.com/v6/latest/${cur}`, f);
    const r = j?.rates?.JPY;
    if (r > 0) return { rate: roundRate(r), exact: false };
  } catch { /* 手入力 */ }
  return null;
}
