import { ColorSwatch, FoundationAction, NumberedCard } from "../components/visual-foundation";

const paletteGroups = [
  {
    accent: "cinnabar",
    caption: "醒目，但保留纸本的温度",
    colors: [
      { colorCode: "red", name: "红色", value: "#c63d32" },
      { colorCode: "orange", name: "橙色", value: "#df762c" },
      { colorCode: "purple", name: "紫色", value: "#8b5a91" },
      { colorCode: "pink", name: "粉色", value: "#df8fa5" },
    ],
    label: "重点层级",
    number: "01",
  },
  {
    accent: "pine",
    caption: "自然、沉静，适合快速扫读",
    colors: [
      { colorCode: "green", name: "绿色", value: "#4f8a5b" },
      { colorCode: "cyan", name: "青色", value: "#3f9892" },
      { colorCode: "emerald", name: "翠色", value: "#26806a" },
      { colorCode: "lake-blue", name: "湖蓝", value: "#498ca4" },
    ],
    label: "稳妥层级",
    number: "02",
  },
  {
    accent: "ochre",
    caption: "浅色也保持清楚的边界",
    colors: [
      { colorCode: "white", isLight: true, name: "白色", value: "#fffef9" },
      { colorCode: "ivory", isLight: true, name: "乳白", value: "#f5edd7" },
      { colorCode: "silver", name: "银色", value: "#c9c9c5" },
      { colorCode: "gold", name: "金色", value: "#c99a43" },
    ],
    label: "日常层级",
    number: "03",
  },
] as const;

export default function HomePage() {
  return (
    <main className="page-shell">
      <div className="foundation-page">
        <header className="foundation-hero">
          <div className="foundation-hero__topline">
            <p className="eyebrow">FIVE · P0 DESIGN FOUNDATION</p>
            <span className="foundation-seal" aria-hidden="true">
              五
            </span>
          </div>
          <h1>Five P0 视觉基础</h1>
          <p className="foundation-hero__lead">
            从探索原型提取的温暖纸本气质，用于后续手机网页的卡片、色彩和文字层级。
          </p>
          <p className="foundation-hero__note">这里展示基础样式，不代表任何一天的实际结果。</p>
          <FoundationAction href="#palette">查看色彩样本</FoundationAction>
        </header>

        <section className="foundation-section" id="palette" aria-labelledby="palette-title">
          <div className="section-heading">
            <div>
              <p className="section-heading__kicker">CARD &amp; COLOR</p>
              <h2 id="palette-title">卡片与色彩</h2>
            </div>
            <p>圆点和中文色名始终一起出现</p>
          </div>

          <div className="foundation-stack">
            {paletteGroups.map((group) => (
              <NumberedCard
                accent={group.accent}
                caption={group.caption}
                key={group.number}
                label={group.label}
                number={group.number}
              >
                <ul className="color-grid">
                  {group.colors.map((color) => (
                    <ColorSwatch key={color.colorCode} {...color} />
                  ))}
                </ul>
              </NumberedCard>
            ))}
          </div>
        </section>

        <footer className="foundation-footer">
          <span className="foundation-footer__mark" aria-hidden="true">
            五
          </span>
          <p>
            本地工程已启动
            <small>网页基础样式可以继续被后续页面复用</small>
          </p>
        </footer>
      </div>
    </main>
  );
}
