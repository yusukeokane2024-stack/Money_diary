// 起動高速化: JS の読み込み・解析を待たずに、前回開いていた家計簿のデータ取得を即開始する
(function () {
  try {
    var last = JSON.parse(localStorage.getItem('md:last') || 'null');
    if (last && last.bookId) {
      var d = new Date(Date.now() + 9 * 36e5), m = last.month || d.toISOString().slice(0, 7);
      window.__boot = { bookId: last.bookId, month: m,
        p: fetch('/api/books/' + last.bookId + '/bootstrap?month=' + m, { credentials: 'same-origin' })
          .then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }) };
    }
  } catch (e) {}
})();
