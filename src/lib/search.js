// 取引の絞り込み (メモ / カテゴリ名 / 金額 / 種類 / 期間)。全件を端末内で検索する。

export function searchTx(txs, cats, f = {}) {
  const terms = (f.q || '').trim().split(/\s+/).filter(Boolean).slice(0, 5).map((t) => t.toLowerCase());
  const min = f.min !== '' && f.min != null ? Number(f.min) : null;
  const max = f.max !== '' && f.max != null ? Number(f.max) : null;
  const nameOf = (id) => cats.get(id)?.name.toLowerCase() || '';
  const parentNameOf = (id) => {
    const p = cats.get(id)?.parentId;
    return p != null ? nameOf(p) : '';
  };
  const underCategory = (id) => {
    if (!f.category) return true;
    const c = cats.get(id);
    return id === f.category || c?.parentId === f.category;
  };
  const out = [];
  for (const t of txs) {
    if (f.type && t.type !== f.type) continue;
    if (f.from && t.date < f.from) continue;
    if (f.to && t.date > f.to) continue;
    if (min != null && t.amount < min) continue;
    if (max != null && t.amount > max) continue;
    if (!underCategory(t.categoryId)) continue;
    if (terms.length) {
      const memo = (t.memo || '').toLowerCase();
      const cn = nameOf(t.categoryId), pn = parentNameOf(t.categoryId);
      const ok = terms.every((term) => memo.includes(term) || cn.includes(term) || pn.includes(term) ||
        (/^[\d,]+$/.test(term) && t.amount === Number(term.replace(/,/g, ''))));
      if (!ok) continue;
    }
    out.push(t);
  }
  out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.id < b.id ? 1 : -1));
  return out;
}
