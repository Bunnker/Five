const runningParts = [
  { label: "网页", value: "可以访问" },
  { label: "HTTP", value: "等待健康检查" },
  { label: "Worker", value: "等待数据库任务" },
] as const;

export default function HomePage() {
  return (
    <main className="shell">
      <section className="status-card">
        <p className="eyebrow">FIVE · P0</p>
        <div className="status-mark" aria-hidden="true">
          五
        </div>
        <h1>Five 本地工程已启动</h1>
        <p className="lead">当前只验证网页与服务能够正常运行。</p>
        <p className="note">
          正式的每日颜色、穿搭建议和图片会在后续 Ticket 中接入，这里不使用临时算法或假内容。
        </p>

        <dl className="process-list">
          {runningParts.map((part) => (
            <div key={part.label}>
              <dt>{part.label}</dt>
              <dd>{part.value}</dd>
            </div>
          ))}
        </dl>
      </section>
    </main>
  );
}
