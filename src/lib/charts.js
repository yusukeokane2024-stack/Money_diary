// グラフ用の集計 (純粋関数)

const rootOf = (cats, id) => {
  let c = cats.get(id);
  for (let i = 0; c && c.parentId != null && cats.has(c.parentId) && i < 100; i++) c = cats.get(c.parentId);
  return c;
};

/**
 * 指定した種類 (expense | income) をカテゴリごとに集計する。
 * 大カテゴリにまとめ、内訳 (children) に直接のカテゴリ別の金額を持つ。割合の高い順。
 */
export function categoryBreakdown(txs, cats, type) {
  const roots = new Map();
  let total = 0;
  for (const t of txs || []) {
    if (t.type !== type) continue;
    total += t.amount;
    const root = rootOf(cats, t.categoryId);
    const key = root?.id ?? '_none';
    const r = roots.get(key) || { id: key, name: root?.name || '未分類', color: root?.color || '#8a8b91', icon: root?.icon || 'tag', total: 0, kids: new Map() };
    r.total += t.amount;
    const own = cats.get(t.categoryId);
    const kk = own?.id ?? '_none';
    const kid = r.kids.get(kk) || { id: kk, name: own?.name || '未分類', total: 0 };
    kid.total += t.amount;
    r.kids.set(kk, kid);
    roots.set(key, r);
  }
  const list = [...roots.values()].map((r) => ({
    id: r.id, name: r.name, color: r.color, icon: r.icon, total: r.total, share: total ? r.total / total : 0,
    children: [...r.kids.values()].sort((a, b) => b.total - a.total).map((k) => ({ ...k, share: r.total ? k.total / r.total : 0 })),
  }));
  list.sort((a, b) => b.total - a.total);
  return { total, items: list };
}

/** endMonth を最後の月として、直近 n か月の収入・支出 */
export function monthlyTrend(txs, endMonth, n = 6) {
  const [y, m] = endMonth.split('-').map(Number);
  const months = [];
  for (let i = n - 1; i >= 0; i--) {
    const t = y * 12 + (m - 1) - i;
    months.push(`${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`);
  }
  const map = new Map(months.map((k) => [k, { month: k, income: 0, expense: 0 }]));
  for (const t of txs || []) {
    const e = map.get(t.date.slice(0, 7));
    if (e) e[t.type] += t.amount;
  }
  return months.map((k) => map.get(k));
}

/** メンバーごとの合計 (割合の高い順) */
export function memberTotals(txs, type) {
  const map = new Map();
  let total = 0;
  for (const t of txs || []) {
    if (t.type !== type) continue;
    map.set(t.userId, (map.get(t.userId) || 0) + t.amount);
    total += t.amount;
  }
  return { total, items: [...map].map(([id, v]) => ({ id, total: v, share: total ? v / total : 0 })).sort((a, b) => b.total - a.total) };
}

/** 予算ゲージ用: 残り・使用率 (使用率は 0〜1 に丸めず、超過は over で示す) */
export function budgetStatus(budget, spent) {
  if (!budget) return null;
  return { remaining: budget - spent, ratio: spent / budget, over: spent > budget };
}
