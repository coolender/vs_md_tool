/** 源码 ↔ 预览 双向滚动同步（按比例映射） */
export function syncScroll(source: HTMLElement, target: HTMLElement) {
  let syncing = false;

  function apply() {
    if (syncing) return;
    syncing = true;
    const smax = source.scrollHeight - source.clientHeight;
    const tmax = target.scrollHeight - target.clientHeight;
    const ratio = smax > 0 ? source.scrollTop / smax : 0;
    target.scrollTop = tmax > 0 ? ratio * tmax : 0;
    requestAnimationFrame(() => {
      syncing = false;
    });
  }

  source.addEventListener("scroll", apply, { passive: true });
  return () => source.removeEventListener("scroll", apply);
}
