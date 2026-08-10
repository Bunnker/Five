"use client";

import { useEffect, useState } from "react";

import type { ContentDraft, DraftModuleCode, DraftModuleUpdate } from "../../../admin-api";

type Props = {
  disabled: boolean;
  modules: ContentDraft["modules"];
  onSave: (moduleCode: DraftModuleCode, module: DraftModuleUpdate) => Promise<boolean>;
};

type SaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "success"; message: string }
  | { kind: "error"; message: string };

const tierNames: Record<string, string> = {
  bu_li: "不利",
  ci_ji: "次吉",
  da_ji: "大吉",
  jiao_cha: "较差",
  ping: "平",
};

export function VisualCopyEditor({ disabled, modules, onSave }: Props) {
  const calendar = modules.calendar_algorithm;
  const copy = modules.copy_and_formula;
  const [tierExplanations, setTierExplanations] = useState<Record<string, string>>({});
  const [formulaTitles, setFormulaTitles] = useState<string[]>([]);
  const [formulaDisclaimers, setFormulaDisclaimers] = useState<string[]>([]);
  const [shareSummary, setShareSummary] = useState("");
  const [shareCopy, setShareCopy] = useState("");
  const [tierState, setTierState] = useState<SaveState>({ kind: "idle" });
  const [copyState, setCopyState] = useState<SaveState>({ kind: "idle" });

  useEffect(() => {
    setTierExplanations(
      Object.fromEntries(calendar?.tiers.map((tier) => [tier.tierCode, tier.explanation]) ?? []),
    );
  }, [calendar]);

  useEffect(() => {
    setFormulaTitles(copy?.outfitFormulas.map((formula) => formula.title) ?? []);
    setFormulaDisclaimers(copy?.outfitFormulas.map((formula) => formula.disclaimer) ?? []);
    setShareSummary(copy?.share.summaryText ?? "");
    setShareCopy(copy?.share.copyText ?? "");
  }, [copy]);

  async function saveTiers() {
    if (calendar === null || tierState.kind === "saving") return;
    setTierState({ kind: "saving" });
    const saved = await onSave("calendar_algorithm", {
      ...calendar,
      tiers: calendar.tiers.map((tier) => ({
        ...tier,
        explanation: tierExplanations[tier.tierCode]?.trim() || tier.explanation,
      })),
    });
    setTierState(
      saved
        ? { kind: "success", message: "五档说明已保存，手机预览已更新。" }
        : { kind: "error", message: "五档说明没有保存，请查看页面提示。" },
    );
  }

  async function saveCopy() {
    if (copy === null || copyState.kind === "saving") return;
    setCopyState({ kind: "saving" });
    const saved = await onSave("copy_and_formula", {
      ...copy,
      outfitFormulas: copy.outfitFormulas.map((formula, index) => ({
        ...formula,
        disclaimer: formulaDisclaimers[index]?.trim() || formula.disclaimer,
        title: formulaTitles[index]?.trim() || formula.title,
      })),
      share: {
        ...copy.share,
        copyText: shareCopy.trim(),
        summaryText: shareSummary.trim(),
      },
    });
    setCopyState(
      saved
        ? { kind: "success", message: "穿搭与分享文案已保存，手机预览已更新。" }
        : { kind: "error", message: "穿搭文案没有保存，请查看页面提示。" },
    );
  }

  if (calendar === null || copy === null) {
    return (
      <section className="admin-visual-correction" id="visual-correction">
        <p className="admin-kicker">VISUAL CORRECTION</p>
        <h2>可视化订正</h2>
        <p className="admin-content-empty">
          系统正在生成当天文字，完成后这里会出现可直接修改的表单。
        </p>
      </section>
    );
  }

  return (
    <section className="admin-visual-correction" id="visual-correction">
      <header className="admin-visual-correction__heading">
        <div>
          <p className="admin-kicker">VISUAL CORRECTION</p>
          <h2>直接修改用户会看到的文字</h2>
          <p>只显示日常需要订正的内容；算法版本、引用关系和完整载荷留在下方高级设置。</p>
        </div>
        <span>所见即所得</span>
      </header>

      <div className="admin-visual-correction__grid">
        <section className="admin-visual-form-card">
          <header>
            <span>01</span>
            <div>
              <h3>五档颜色说明</h3>
              <p>颜色和顺序由算法固定，只订正用户文案。</p>
            </div>
          </header>
          <div className="admin-tier-copy-fields">
            {calendar.tiers.map((tier) => (
              <label key={tier.tierCode}>
                <span>
                  <strong>{tierNames[tier.tierCode] ?? tier.algorithmLabel}</strong>
                  <small>{tier.colors.map((color) => color.name).join(" · ")}</small>
                </span>
                <textarea
                  aria-label={`${tier.algorithmLabel}说明`}
                  disabled={disabled || tierState.kind === "saving"}
                  maxLength={300}
                  onChange={(event) => {
                    const value = event.currentTarget.value;
                    setTierExplanations((current) => ({
                      ...current,
                      [tier.tierCode]: value,
                    }));
                    setTierState({ kind: "idle" });
                  }}
                  rows={2}
                  value={tierExplanations[tier.tierCode] ?? ""}
                />
              </label>
            ))}
          </div>
          <button
            className="admin-button admin-button--primary"
            disabled={disabled || tierState.kind === "saving"}
            onClick={() => void saveTiers()}
            type="button"
          >
            {tierState.kind === "saving" ? "正在保存…" : "保存五档说明"}
          </button>
          {tierState.kind === "success" || tierState.kind === "error" ? (
            <p
              className={`admin-message admin-message--${tierState.kind === "success" ? "success" : "error"}`}
              role={tierState.kind === "success" ? "status" : "alert"}
            >
              {tierState.message}
            </p>
          ) : null}
        </section>

        <section className="admin-visual-form-card">
          <header>
            <span>02</span>
            <div>
              <h3>穿搭、补充建议与分享</h3>
              <p>修改标题后，用户端预览会使用同一份内容。</p>
            </div>
          </header>
          <div className="admin-copy-form-fields">
            <div className="admin-safe-copy-note">
              <span>固定安全文案</span>
              <strong>{copy.balanceSuggestion.title}</strong>
              <p>{copy.balanceSuggestion.description}</p>
              <small>{copy.balanceSuggestion.accessoryExamples.join(" · ")}</small>
            </div>
            {copy.outfitFormulas.map((formula, index) => (
              <div className="admin-formula-copy-row" key={formula.formulaId}>
                <strong>
                  {formula.kind === "mono" ? "单色" : formula.kind === "dual" ? "双色" : "三色"}
                </strong>
                <label>
                  <span>穿搭标题</span>
                  <input
                    aria-label={`${formula.kind}穿搭标题`}
                    disabled={disabled || copyState.kind === "saving"}
                    maxLength={80}
                    onChange={(event) => {
                      const value = event.currentTarget.value;
                      setFormulaTitles((current) =>
                        current.map((item, itemIndex) => (itemIndex === index ? value : item)),
                      );
                    }}
                    value={formulaTitles[index] ?? ""}
                  />
                </label>
                <label>
                  <span>穿搭说明</span>
                  <input
                    aria-label={`${formula.kind}穿搭说明`}
                    disabled={disabled || copyState.kind === "saving"}
                    maxLength={300}
                    onChange={(event) => {
                      const value = event.currentTarget.value;
                      setFormulaDisclaimers((current) =>
                        current.map((item, itemIndex) => (itemIndex === index ? value : item)),
                      );
                    }}
                    value={formulaDisclaimers[index] ?? ""}
                  />
                </label>
              </div>
            ))}
            <label>
              <span>分享摘要</span>
              <textarea
                disabled={disabled || copyState.kind === "saving"}
                maxLength={300}
                onChange={(event) => setShareSummary(event.currentTarget.value)}
                rows={2}
                value={shareSummary}
              />
            </label>
            <label>
              <span>复制分享文字</span>
              <textarea
                disabled={disabled || copyState.kind === "saving"}
                maxLength={500}
                onChange={(event) => setShareCopy(event.currentTarget.value)}
                rows={3}
                value={shareCopy}
              />
            </label>
          </div>
          <button
            className="admin-button admin-button--primary"
            disabled={disabled || copyState.kind === "saving"}
            onClick={() => void saveCopy()}
            type="button"
          >
            {copyState.kind === "saving" ? "正在保存…" : "保存穿搭与分享"}
          </button>
          {copyState.kind === "success" || copyState.kind === "error" ? (
            <p
              className={`admin-message admin-message--${copyState.kind === "success" ? "success" : "error"}`}
              role={copyState.kind === "success" ? "status" : "alert"}
            >
              {copyState.message}
            </p>
          ) : null}
        </section>
      </div>
    </section>
  );
}
